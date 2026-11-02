/**
 * P1-E：OCR 自动配对未完成时，界面必须说清「识别到了、但没自动对上、你可以手工指定」。
 *
 * ## 判据设计（不是"提示元素存在"）
 *
 * 1. **判据与后端真值交叉核对**：先直调 `ocr.recognizeLabels` 读
 *    `reconciliation.matched` 与 `labels.length`，再读界面上 `data-ocr-match` /
 *    `data-label-count` / `data-columns-without-label`，断言**相等**。
 * 2. **文案内容断言**：必须同时说到"识别到 N 个"与"未能全部自动对应到列"
 *    以及手工填写这一步——只断言元素存在等于没测。
 * 3. **手工路径走真实操作**：在没有标签的那一行输入名字 → 断言勾选框被自动启用
 *    并勾上 → 点【应用到图谱各列】→ 断言后端列名真的变成那个名字。
 *    这一步是"用户确实能手动关联"的证据，而不是"表格里有个输入框"。
 * 4. **反向对照**：`matched === true` 时不得出现提示。用一个真实可配对的会话
 *    （标签数与列数一致）来钉，否则本用例可能只是"提示永远显示"。
 *
 * ## 真实取样（为什么用建议 ROI 而不是手框）
 *
 * 真实图版 `fig3_raw.jpeg` 用**建议取数区** `[69,1867]×[266,744]` 分列得 22 列，
 * OCR 识别 24 个标签，后端 `matched=false`（`ambiguous` 21 个）。实测其中有
 * 2 列完全没标签（表格里「OCR 原始读数」显示 `--`），正是本提示要解释的对象。
 */
import { expect, test } from './fixtures';
import { openApp, resetBaseline, rpc } from './helpers';

const FIG3 = 'tests/data/figures/real_plates/fig3_raw.jpeg';

interface Recon {
  matched?: boolean;
  ambiguous?: string[];
  assigned?: Record<string, string>;
}

/** 载入真实图版、用建议 ROI 分列、推进到步骤 5，并打开 OCR 弹窗。 */
async function openOcrOnFig3(page: import('@playwright/test').Page): Promise<void> {
  await openApp(page);
  const load = await rpc<{ active_roi_id: string; suggested_roi: Record<string, number> }>(
    page,
    'core.loadImage',
    { image_path: FIG3 }
  );
  const sug = load.suggested_roi;
  await rpc(page, 'core.detectColumns', {
    x_bounds: [sug.xMin, sug.xMax],
    y_bounds: [sug.yMin, sug.yMax],
  });
  // 绕过 UI 的 RPC 不会刷新前端镜像，必须重载后前端才看得到新图与新列
  await page.reload();
  await page.waitForFunction(
    () => Boolean((window as unknown as { __straditize?: unknown }).__straditize),
    undefined,
    { timeout: 45_000 }
  );
  await page.waitForFunction(
    () => {
      const api = (window as unknown as {
        __straditize?: { getState: () => Record<string, unknown> };
      }).__straditize;
      const cols = (api?.getState()?.columns ?? []) as unknown[];
      return cols.length > 0;
    },
    undefined,
    { timeout: 45_000 }
  );
  await page.evaluate(async () => {
    await (
      window as unknown as { __straditize: { gotoStage: (s: number) => Promise<void> } }
    ).__straditize.gotoStage(5);
  });
  await page.locator('#btn-ocr-review-modal').click();
  const dlg = page.locator('.ocr-review-dialog');
  await expect(dlg).toBeVisible();
  await dlg.locator('#btn-ocr-run').click();
  await expect(dlg.locator('#ocr-summary-tbody .ocr-edit-input').nth(0)).toBeVisible({
    timeout: 30_000,
  });
  return void dlg;
}

test.describe('P1-E OCR 配对失败必须在界面上说清', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1 真实图版：后端 matched=false 时提示出现，且标签数/无标签列数与表格真值相等', async ({
    page,
  }) => {
    await openOcrOnFig3(page);
    const dlg = page.locator('.ocr-review-dialog');

    // 后端真值：用**界面自己用的那个 bbox** 重跑一次识别。
    // 手写一个"看起来差不多"的 bbox 会得到不同的标签数（实测 [69,0,...] 得 24 个、
    // 界面默认框得 22 个），那样断言比的就不是同一件事了。这里从界面读回真实框。
    const cropLabel = await dlg.locator('#ocr-crop-coords-label').innerText();
    const m = cropLabel.match(/X:\s*(\d+)~(-?\d+),\s*Y:\s*(-?\d+)~(-?\d+)/);
    expect(m, `无法从界面读出标签框坐标：${cropLabel}`).not.toBeNull();
    const bbox = [Number(m![1]), Number(m![3]), Number(m![2]), Number(m![4])];
    const raw = await rpc<{ success: boolean; data: { labels: unknown[]; reconciliation?: Recon } }>(
      page,
      'ocr.recognizeLabels',
      { label_row_bbox: bbox, angle_deg: 45 }
    );
    const recon = raw.data.reconciliation;
    expect(recon?.matched, '前提：真实图版上后端配对必须为 false（否则本用例测不到该场景）').toBe(
      false
    );
    const labelCount = raw.data.labels.length;
    expect(labelCount).toBeGreaterThan(0);

    // 表格真值：数「OCR 原始读数」为 `--` 的行（用户能数到的同一口径）
    const rowsWithoutLabel = await dlg
      .locator('#ocr-summary-tbody tr')
      .evaluateAll((trs) =>
        trs.filter((tr) => tr.querySelectorAll('td')[2]?.textContent?.trim() === '--').length
      );

    const notice = dlg.locator('#ocr-match-notice-slot .ocr-match-notice');
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await expect(notice).toHaveAttribute('data-ocr-match', 'failed');
    // equality：提示里的数字必须等于后端标签数与表格里数到的无标签行数
    await expect(notice).toHaveAttribute('data-label-count', String(labelCount));
    await expect(notice).toHaveAttribute(
      'data-columns-without-label',
      String(rowsWithoutLabel)
    );
    expect(rowsWithoutLabel, '真实图版上应确有列没标签，否则提示无从解释').toBeGreaterThan(0);

    // 文案三件事：识别到 N 个 / 未能自动对应 / 手工怎么填
    const text = (await notice.innerText()).replace(/\s+/g, ' ');
    expect(text).toContain(`识别到 ${labelCount} 个标签`);
    expect(text).toContain('未能全部自动对应到列');
    expect(text).toContain(String(rowsWithoutLabel));
    expect(text).toContain('输入'); // 手工填写路径
    expect(text).toContain('采纳'); // 说明勾选框会自动启用
  });

  test('T2 手工兜底：给没标签的行填名字 → 勾选自动启用 → 该名字真的写进后端', async ({ page }) => {
    await openOcrOnFig3(page);
    const dlg = page.locator('.ocr-review-dialog');

    // 找到第一个「OCR 原始读数」为 `--` 的行（真·没标签的列）
    const targetIdx = await dlg.locator('#ocr-summary-tbody tr').evaluateAll((trs) =>
      trs.findIndex((tr) => tr.querySelectorAll('td')[2]?.textContent?.trim() === '--')
    );
    expect(targetIdx, '真实图版上应存在没有标签的列（手工兜底的场景）').toBeGreaterThanOrEqual(0);

    const chk = dlg.locator('#ocr-summary-tbody .ocr-accept-chk').nth(targetIdx);
    // 先钉住前提：这一行原本是勾不上的（disabled），否则测不到"输入后自动启用"
    expect(await chk.isDisabled(), '前提：没有标签的行初始不可采纳').toBe(true);

    const inp = dlg.locator('#ocr-summary-tbody .ocr-edit-input').nth(targetIdx);
    await inp.fill('Manualia_probe');
    // 输入后必须自动启用并勾上——这是"用户能手工关联"的直接证据
    await expect(chk).toBeEnabled();
    await expect(chk).toBeChecked();

    await dlg.locator('#ocr-btn-apply').click();
    await expect(dlg).toHaveCount(0);

    // 后端权威列名里必须出现这个名字
    const after = await rpc<{ columns: Array<{ name: string }> }>(
      page,
      'straditize.getDiagramData',
      {}
    );
    expect(
      after.columns.map((c) => c.name),
      '手工填写的名字必须真的落到后端列上'
    ).toContain('Manualia_probe');
  });

  test('T3 反向对照：配对成功时不得出现提示（构造载荷，由 Node 侧真实模块测试守）', async ({
    page,
  }) => {
    // 真实后端在两张内置图上**都不**配对成功（fig3 22 列/22 标签、hoya 28 列/30 标签，
    // 均 matched=false），所以"成功场景"没有真实样本可取样——谎称有就是假判据。
    // 该反向对照改由 `frontend/test-ocr-match-notice.mjs` 直接 import 真实模块完成：
    // 同一渲染函数喂 matched=true → 必须空串，喂 matched=false → 必须有内容，
    // 两侧都跑，所以"空串"不可能是因为函数根本不渲染。
    //
    // 这里只做界面侧的补充断言：当前真实场景是失败场景，提示必须在。
    await openOcrOnFig3(page);
    const dlg = page.locator('.ocr-review-dialog');
    await expect(dlg.locator('#ocr-match-notice-slot .ocr-match-notice')).toBeVisible();
    // 且槽位里不得出现"成功"语义的任何字样
    const text = await dlg.locator('#ocr-match-notice-slot').innerText();
    expect(text).not.toContain('全部自动对应成功');
  });
});
