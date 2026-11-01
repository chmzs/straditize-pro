/**
 * 步骤 6【对齐本组】：没有检测到刻度尺时的行为。
 *
 * ## 为什么这份只剩一条用例
 *
 * 面板已收敛成「一行检测结果 + 一个读数 + 一个按钮」，跨度不再让用户填，
 * 而是**自动取自 `algorithm.measureRuler`**（基线→末齿）。正向路径
 * （沉积图谱：566px = 0~90%，四列共用 6.29 px/单位）在
 * `step6-ruler-geometry.spec.ts` 里钉住；本文件只守反面：
 *
 * 基线图（hoya）的图版里**没有可检测的刻度尺**（实测 `per_column` 全为空、
 * `median_spacing_px = null`）。此时点【对齐本组】必须如实报错并一列都不写——
 * 旧实现会默默用写死的 40px 把这 29 列全部标定上，等于替用户编造刻度。
 */
import { expect, test } from './fixtures';
import { diagramData, gotoStage, resetBaseline } from './helpers';

interface BackendColumn {
  id: string;
  x_ticks?: Array<{ px: number; value: number }> | null;
}

test.describe('对齐本组：无刻度尺时必须停手', () => {
  test.use({ allowlists: { notice: [/未检测到刻度尺/] } });

  test('没有检测到刻度尺时，【对齐本组】如实报错且不写任何列', async ({ page, telemetry }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);

    const line = page.locator('.step-panel[data-step="6"] [data-role="ruler-detect"]');
    await expect(line).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => line.innerText(), { timeout: 20_000 })
      .toContain('未找到刻度尺');

    // 检测不到就取不到跨度：输入框照旧要用户读图填，但点下去必须先拒绝取跨度
    const before = (
      await diagramData<{ columns: BackendColumn[] }>(page)
    ).columns;
    expect(before.length).toBeGreaterThan(10);
    expect(before.every((c) => (c.x_ticks ?? null) === null), '前置条件：全部未标定').toBe(true);

    await page.locator('.step-panel[data-step="6"] #inp-ref-units-per-cell').fill('20');
    await page.locator('.step-panel[data-step="6"] #btn-apply-group-scale').click();

    await expect
      .poll(() => telemetry.notices.some((n) => n.includes('未检测到刻度尺')), { timeout: 10_000 })
      .toBe(true);
    const after = (await diagramData<{ columns: BackendColumn[] }>(page)).columns;
    expect(
      after.every((c) => (c.x_ticks ?? null) === null),
      '取不到跨度时不得回退到任何写死的默认值（旧实现会套用 40px）'
    ).toBe(true);
    expect(telemetry.rpcErrors).toEqual([]);
  });
});
