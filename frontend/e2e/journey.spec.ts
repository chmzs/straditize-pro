/**
 * 八步黄金旅程 —— 迁移自旧 tests/e2e/test_golden_journey.py。
 *
 * 旧测试声称"Zero-Staging Policy：全部通过真实 DOM 点击驱动"，确实点完了 8 步，
 * 但它**只**断言了两件事：标定面板里两个像素输入框非空且互不相同，以及后端
 * `export_multi_tar()` 出的 tar 里有 4 个成员、data.csv 首行以 `depth,` 开头。
 * 也就是说：ROI 改名、主区切换、Y 轴标定、分列、采样这些**状态变化**全都没有被验证，
 * 走完流程本身并不证明状态正确（旧套件 94 条断言里只有 1 条读后端，这正是其中一处盲区）。
 *
 * 这里保留"真实点击驱动"的骨架（不用 RPC 摆状态），但在每一步都补上后端权威状态断言：
 * 每个阶段必须真的落到目标 stage、ROI 改名真的进后端、主区切换真的换 id、
 * 标定真的写进 depth_calib、分列真的产出列、采样真的产出层位；最后 tar 的
 * data.csv 必须等于主 ROI 的那张分表。
 *
 * 另一处旧注释是错的：`primBtns[0]` 属于**非主区**卡片（`.btn-set-primary` 只渲染在
 * 非主区上），所以那次点击其实是把 herb_pollen 提升为主区，而不是注释里写的
 * "Set tree_pollen as primary"。这里按真实语义断言，并记录该差异。
 */
import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import {
  canvasBox,
  diagramData,
  expectNoDialogs,
  getState,
  resetBaseline,
  rpc,
  watchPage,
  type PageTelemetry,
} from './helpers';

interface RoiSummary {
  id: string;
  name: string;
  name_source: string;
}

interface DiagramData {
  rois: RoiSummary[];
  primaryRoiId: string;
  columns: { id: string }[];
  calibration: {
    isCalibrated: boolean;
    top_px: number | null;
    bottom_px: number | null;
    unit: string | null;
  };
}

interface Readiness {
  sheets: string[];
  primary_roi: string;
  primary_roi_id: string;
}

let telemetry: PageTelemetry = { consoleErrors: [], dialogs: [] };

/** 等前端状态机真的落到目标步骤（旧测试用固定 sleep，是假绿的主要来源）。 */
async function waitStage(page: Page, step: number): Promise<void> {
  await expect
    .poll(async () => (await getState<{ stage: number }>(page)).stage, {
      message: `应推进到步骤 ${step}`,
      timeout: 20_000,
    })
    .toBe(step);
}

/** 极简 POSIX UStar 读取器（同 export.spec.ts：engine 里的 TarArchive 没有挂到 window）。 */
function untarArchive(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    if (Number.isNaN(size)) {
      throw new Error(`tar 头解析失败：偏移 ${offset} 处 size 字段为 ${JSON.stringify(sizeText)}`);
    }
    const typeFlag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    if (typeFlag !== 'x' && typeFlag !== 'g') {
      entries.set(name, buf.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

test.describe('八步黄金旅程（全 DOM 点击驱动）', () => {
  test.beforeEach(async ({ page }) => {
    telemetry = watchPage(page);
    await resetBaseline(page);
  });

  test('走完 8 步后，ROI/标定/分列/采样与导出的 tar 都必须与后端状态一致', async ({ page }) => {
    // ===== Step 1 → 2 =====
    await page.locator('#btn-wf-next').click();
    await waitStage(page, 2);

    // ===== Step 2：改名 + 新建第二个 ROI + 切主区 =====
    const roiName = page.locator('#inp-roi-name');
    await roiName.fill('tree_pollen');
    await roiName.press('Tab'); // 面板监听 change/blur 提交
    await expect.poll(async () => (await diagramData<DiagramData>(page)).rois.find((r) => r.id === 'roi_1')?.name).toBe('tree_pollen');

    await page.locator('#btn-create-roi').click();
    // 等待新建的第二个 ROI 激活挂载到输入框
    await expect(page.locator('.roi-item-card').nth(1)).toBeVisible();
    await expect(roiName).toHaveValue(/roi_2/);

    await roiName.fill('herb_pollen');
    await roiName.press('Tab');
    await expect.poll(async () => (await diagramData<DiagramData>(page)).rois.find((r) => r.id === 'roi_2')?.name).toBe('herb_pollen');

    // 改名必须真的写进后端（旧测试完全没验证这一步）。
    const afterRename = await diagramData<DiagramData>(page);
    expect(afterRename.rois.map((r) => r.name).sort(), '两个 ROI 的新名字都要进后端').toEqual([
      'herb_pollen',
      'tree_pollen',
    ]);
    const herb = afterRename.rois.find((r) => r.name === 'herb_pollen');
    if (!herb) throw new Error('后端缺少 herb_pollen');
    expect(afterRename.primaryRoiId, '基线的 roi_1 仍是主区').not.toBe(herb.id);

    // `.btn-set-primary` 只渲染在非主区卡片上，所以 .first() 是 herb_pollen 的按钮。
    // 旧注释写的是 "Set tree_pollen as primary"，与按钮实际归属相反；这里断言真实语义。
    await page.locator('.btn-set-primary').first().click();
    const afterPrimary = await diagramData<DiagramData>(page);
    expect(afterPrimary.primaryRoiId, '点非主区卡片上的按钮应把该 ROI 提升为主区').toBe(herb.id);

    await page.locator('#btn-apply-roi-next').click();
    await waitStage(page, 3);

    // ===== Step 3：画布两点 + 侧栏两点标定 =====
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 120, box.y + 150);
    await page.mouse.click(box.x + 120, box.y + 350);

    // 画布取点必须回填到侧栏表单、并在画布上留下两个标记。
    const pickedTop = await page.locator('#ycal-inp-top-px').inputValue();
    const pickedBottom = await page.locator('#ycal-inp-bot-px').inputValue();
    expect(pickedTop, '画布第一次点击必须回填上面那个参考点').not.toBe('');
    expect(pickedBottom, '画布第二次点击必须回填下面那个参考点').not.toBe('');
    expect(pickedTop, '两个参考点必须是不同的像素行').not.toBe(pickedBottom);
    expect(
      (await getState<{ yCalibMarks: unknown[] }>(page)).yCalibMarks.length,
      '画布上应留下 2 个标定标记'
    ).toBe(2);

    await page.locator('#ycal-inp-top-px').fill('511');
    await page.locator('#ycal-inp-top-val').fill('0.0');
    await page.locator('#ycal-inp-bot-px').fill('1311');
    await page.locator('#ycal-inp-bot-val').fill('1300.0');
    await page.locator('#ycal-inp-unit').fill('cm');
    await page.locator('#btn-apply-ycalib-next').click();
    await waitStage(page, 4);

    // 标定必须真的落到后端 depth_calib（旧测试只看了输入框非空，没验证标定结果）。
    const calibrated = await diagramData<DiagramData>(page);
    expect(calibrated.calibration.isCalibrated, '后端必须已标定').toBe(true);
    expect(calibrated.calibration.top_px).toBe(511);
    expect(calibrated.calibration.bottom_px).toBe(1311);
    expect(calibrated.calibration.unit).toBe('cm');

    // ===== Step 4：候选线清理 → 分列 =====
    await page.locator('#btn-detect-candidates').click();
    await page.locator('#btn-apply-cleanup-next').click();
    // 进入 Step 5 会真的跑一遍后端分列，且 currentStage 在分列完成后才落定，
    // 所以 waitStage(5) 同时是"分列结果已回到前端"的屏障。
    await waitStage(page, 5);
    const split = await diagramData<DiagramData>(page);
    expect(split.columns.length, '分列必须真的产出属种列').toBeGreaterThan(0);

    // ===== Step 5 → 6 → 7 =====
    await page.locator('#btn-apply-naming-next').click();
    await waitStage(page, 6);
    await page.locator('#btn-apply-xticks-next').click();
    await waitStage(page, 7);
    await page.locator('#btn-extract-consensus').click();
    await page.locator('#btn-apply-samples-next').click();
    await waitStage(page, 8);

    // 采样必须真的产出层位，否则 data.csv 只有表头 —— 旧测试是等到解包 tar 才发现的行数问题。
    const qa = await rpc<{ n_horizons: number }>(page, 'qa.summarize', {});
    expect(qa.n_horizons, '共识层位必须真的写进后端').toBeGreaterThan(0);

    // ===== Step 8 → 导出 =====
    await expect(page.locator('#qa-banner'), 'Step 8 诊断横幅必须渲染').toBeVisible();
    await page.locator('#btn-qa-export').click();
    await expect(page.locator('.wpd-export-dialog')).toBeVisible();
    const readinessBox = page.locator('#export-readiness-container');
    await expect(readinessBox).toBeVisible();

    const readiness = await rpc<Readiness>(page, 'export.getReadiness', {});
    expect(readiness.sheets.length).toBeGreaterThan(0);
    await expect(
      readinessBox,
      '就绪清单的分表必须与后端一致'
    ).toHaveAttribute('data-sheets', readiness.sheets.join(','));
    await expect(readinessBox).toHaveAttribute('data-primary', readiness.primary_roi);

    // ===== tar 归档：成员、data.csv 归属、首行 =====
    const tarRes = await rpc<{ tar_base64: string; size: number; success: boolean }>(
      page,
      'export.tar',
      {}
    );
    const bytes = Buffer.from(tarRes.tar_base64, 'base64');
    expect(bytes.length).toBe(tarRes.size);
    const entries = untarArchive(bytes);

    expect([...entries.keys()].sort()).toContain('manifest.json');
    expect([...entries.keys()]).toContain('data.csv');
    expect([...entries.keys()]).toContain('plot_strat.R');
    expect([...entries.keys()]).toContain('README.txt');

    const dataCsv = entries.get('data.csv');
    if (!dataCsv) throw new Error('归档缺少 data.csv');
    const lines = dataCsv.toString('utf8').split('\n');
    expect(lines.length, 'data.csv 必须含真实数字化行，而不只是表头').toBeGreaterThan(1);
    expect(lines[0], 'data.csv 第一列必须是 depth').toMatch(/^depth,/);

    // 每个 ROI 一张分表，且 data.csv 必须等于主 ROI 的那张（旧测试完全没验证归属）。
    const dataMembers = [...entries.keys()].filter((n) => n.startsWith('data/'));
    expect(dataMembers.length, '分表数量必须等于后端 ROI 数量').toBe(readiness.sheets.length);
    const primaryCsv = entries.get(`data/${readiness.primary_roi}.csv`);
    if (!primaryCsv) throw new Error(`归档缺少主 ROI 分表 data/${readiness.primary_roi}.csv`);
    expect(dataCsv.equals(primaryCsv), 'data.csv 必须等于主 ROI 的分表').toBe(true);

    expect((await getState<{ stage: number }>(page)).stage, '旅程结束时必须停在 Step 8').toBe(8);
    expectNoDialogs(telemetry);
  });
});
