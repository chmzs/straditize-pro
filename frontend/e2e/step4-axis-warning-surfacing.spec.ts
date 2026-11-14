/**
 * 步骤 4 的两条「静默失败」必须出现在界面上（端到端判据）。
 *
 * ## 这两条为什么必须由 e2e 钉住
 *
 * 后端早已算好了两件事：`_recompose()` 返回的 `warnings`（哪一列的轴线被这次
 * 编辑抹掉了，含列名 / 覆盖比例 / 处理建议），以及 `digitize()` 在整列墨迹被
 * 擦光时抛的 `-32001`（文案点名列名 + 三个排查方向）。**但前端一行都没有读**：
 * 全仓 grep `warnings` 在 `frontend/src` 里是零命中。
 *
 * 单元测试证明不了这件事 —— 后端返回值一直是对的，用户看到的却一直是"什么都没
 * 发生"。判据必须落在界面上：
 *
 * 1. 排除区盖住整列 → 步骤 4 面板出现含**列名**、「排除区」、覆盖比例与建议的提示；
 * 2. 点【取数】被拒 → 详情弹窗出现后端**原文关键片段**（"墨迹像素"、"请检查"），
 *    而不是"取数失败"四个字。
 *
 * ## 现场怎么造（用真实用户路径）
 *
 * 面板上的「⬚ 添加排除区」会在 ROI 右缘放一个 `x∈[xMax-250, xMax]`、纵向贯穿的
 * 矩形。hoya 的 ROI 是 `[319, 2030]`，所以它覆盖 `x≥1780` 的那一列 —— 那一列的
 * 轴线（左缘）和全部墨迹都在里面。两个用例都从这里出发，不直接调后端改状态。
 *
 * ## 豁免
 *
 * 两条用例都**故意**触发用户可见通知（轴线告警 toast / 后端失败弹窗）与被拒的
 * RPC，因此必须显式声明豁免；豁免贴着用例意图写，见下方 `test.use`。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

interface ColumnLite {
  id: string;
  name: string;
  /** 后端下发 `start`；`RpcClient` 另映射一份 `startX`（旧读法），两者都认。 */
  start?: number;
  startX?: number;
  end: number;
  col_index: number;
}

interface Roi {
  id: string;
  xlim: [number, number];
  ylim: [number, number];
}

const PANEL = '.step-panel[data-step="4"]';
const WARNINGS = '#cleanup-axis-warnings';

/** 与 `InspectorBridge.onAddExclusionRect` 完全同一套算式（面板按钮放哪块）。 */
function exclusionSpan(roi: Roi): { x0: number; x1: number } {
  const [xMin, xMax] = roi.xlim;
  return {
    x0: Math.round(xMax - Math.min(250, (xMax - xMin) * 0.25)),
    x1: Math.round(xMax),
  };
}

async function readState(
  page: Parameters<typeof rpc>[0]
): Promise<{ columns: ColumnLite[]; rois: Roi[]; active_roi_id: string }> {
  return rpc(page, 'straditize.getDiagramData');
}

/** 放在排除区里的列（左缘落在 [x0, x1] 内）—— 后端的判据就是"轴线带被盖住"。 */
function columnsInsideExclusion(columns: ColumnLite[], span: { x0: number; x1: number }) {
  return columns.filter((c) => {
    const start = Number(c.start ?? c.startX);
    return Number.isFinite(start) && start >= span.x0 && start <= span.x1;
  });
}

test.describe('排除区盖住整列：轴线告警必须到界面', () => {
  // 这一条**故意**产生一条 warning toast（轴线告警）。豁免精确到"警告 + 轴线"，
  // 任何别的通知仍会让门禁变红。
  test.use({ allowlists: { notice: [/^警告：.*轴线/] } });

  test('面板显示列名 + 「排除区」 + 覆盖比例 + 建议', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 4);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });

    const state = await readState(page);
    const roi = state.rois.find((r) => r.id === state.active_roi_id) ?? state.rois[0];
    const span = exclusionSpan(roi);
    const covered = columnsInsideExclusion(state.columns, span);
    expect(
      covered.length,
      `前置：排除区 x∈[${span.x0},${span.x1}] 里必须有列（hoya 基线实测 3 列：` +
        `1711/1743/1774），实际命中 ` +
        `${covered.map((c) => `${c.name}@${c.start ?? c.startX}`).join(',') || '无'} —— ` +
        'ROI 或分列口径变了，本用例的现场需要重新核对'
    ).toBeGreaterThan(0);
    const target = covered[covered.length - 1];

    await page.locator('#btn-add-exclusion-rect').click();

    // 后端必须先真的报（否则下面"面板显示了"可能只是文案凑巧）
    const warning = page.locator(WARNINGS);
    await expect(warning, '排除区盖住了整列轴线，步骤 4 面板却没有出现任何告警').toBeVisible({
      timeout: 30_000,
    });

    // 列名必须是后端点的那一列，不是前端按坐标猜的
    await expect(warning, `告警必须点名被盖住轴线的列「${target.name}」`).toContainText(
      target.name
    );
    // 来源必须说清是"排除区"还是"已确认几何"——修复时这两者的处理方式不同
    await expect(warning, '告警必须说明是排除区造成的').toContainText('排除区');
    await expect(warning, '告警必须给出覆盖比例').toContainText('%');
    // 建议用后端原文（"把排除区从列左缘让开 2px 以上"），不是"请检查设置"
    await expect(warning, '告警必须带上可操作的处理建议').toContainText('让开');

    // 面板是常驻通道：toast 会消失，面板不能
    expect(await warning.locator('.cleanup-axis-warning').count()).toBe(covered.length);
  });
});

test.describe('点取数被拒：后端原文必须到界面', () => {
  // 故意触发 `core.digitize` 的 -32001 与随之而来的失败详情弹窗。
  //
  // `consoleError` 也要豁免：`reportBackendFailure` 除了弹窗还会 `console.error`
  // 一条完整诊断（那是给开发者的一手信息，正是"错误必须冒泡"的正面行为）。
  test.use({
    allowlists: {
      rpcError: [/core\.digitize \[-32001\]/],
      notice: [/^警告：.*轴线/, /墨迹像素/],
      consoleError: [/RPC failure\] 属种轮廓重识别: Error: 列 'col\d+'/],
    },
  });

  test('整列墨迹被排除区擦光 → 弹窗里有「墨迹像素」「请检查」', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 4);
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });

    const state = await readState(page);
    const roi = state.rois.find((r) => r.id === state.active_roi_id) ?? state.rois[0];
    const span = exclusionSpan(roi);
    const covered = columnsInsideExclusion(state.columns, span);
    expect(covered.length, '前置：排除区里必须有列').toBeGreaterThan(0);
    const target = covered[covered.length - 1];

    await page.locator('#btn-add-exclusion-rect').click();
    await expect
      .poll(
        async () =>
          (
            await rpc<{ exclusion_regions: unknown[] }>(page, 'straditize.getDiagramData')
          ).exclusion_regions.length,
        { message: '点【添加排除区】后后端必须有一个排除区', timeout: 30_000 }
      )
      .toBe(1);

    // 选中这一列（侧栏点列名 = 真实用户路径），【重新识别此列】就是取数入口
    await page
      .locator(`input.taxa-name-inline-input[data-col-id="${target.id}"]`)
      .first()
      .click();
    const digitizeBtn = page.locator('#btn-col-digitize');
    await expect(digitizeBtn, '选中列后应出现【重新识别此列】(取数入口)').toBeVisible({
      timeout: 10_000,
    });

    await digitizeBtn.click();

    const modal = page.locator('#rpc-error-modal');
    await expect(modal, '取数被拒必须弹出可复制的错误详情，不能静默').toBeVisible({
      timeout: 30_000,
    });
    // 断言后端原文关键片段，而不是"有弹窗"：
    // 「墨迹像素」只出现在 digitize 那条拒绝文案里，「请检查」后面跟着三个排查方向。
    await expect(modal, '弹窗必须带后端原文（墨迹像素计数）').toContainText('墨迹像素');
    await expect(modal, '弹窗必须带可操作信息（请检查…）').toContainText('请检查');
    await expect(modal, '排查方向之一：是否把这一列的轴线当干扰线删了').toContainText('轴线');
    await expect(modal, '弹窗必须点名列名').toContainText(target.name);
  });
});
