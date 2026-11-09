/**
 * 组归属条（步骤 6）：≥2 组时每列上方出现组色横条，不同组颜色不同。
 *
 * ## 为什么这里只留这一条判据
 *
 * 原本还想在这里钉「刻度齿真的画出来」（像素级）。写了三版都**没有判别力**：
 * 把 `cellPx` 强制成 null（等于完全不画齿）时它依然绿——底图自带水平虚线阴影，
 * 任意两条竖线的均值差都能超过阈值。按 `docs/testing-strategy.md` 的规矩，
 * 无判别力的判据不许混在全绿里，所以撤掉；「齿的间距来自哪里」改由纯函数单测钉
 * （`frontend/test-tick-spacing.mjs`），「面板把实测刻距递给画布」由
 * `[data-role="ruler-detect"][data-spacing]` 有值来钉。齿在屏幕上是否可见，
 * 登记在 §9 的盲区里，靠人眼验收。
 */

import { expect, test } from './fixtures';
import { backendRpc, canvasBox, diagramData, gotoStage, openApp, resetBaseline } from './helpers';

interface ColumnLite {
  id: string;
  col_index: number;
  startX: number;
  endX: number;
  x_group_id?: string;
}
interface Payload {
  columns: ColumnLite[];
  rois: Array<{ id: string; x_groups: Array<{ id: string; name: string }>; default_group_id?: string }>;
  roi: { yMin: number; yMax: number };
}

async function samplePixels(
  page: import('@playwright/test').Page,
  points: Array<{ x: number; y: number }>
): Promise<number[][]> {
  return page.evaluate((pts) => {
    const canvas = document.querySelector('#geology-canvas') as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const k = canvas.width / rect.width;
    const ctx = canvas.getContext('2d')!;
    return pts.map((q) => {
      const d = ctx.getImageData(Math.round(q.x * k), Math.round(q.y * k), 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  }, points);
}

test('组归属条：≥2 组时每列上方出现组色横条，不同组颜色不同', async ({ page }) => {
  await resetBaseline(page);
  const data = await diagramData<Payload>(page);
  const created = await backendRpc<{ group: { id: string } }>(page, 'roi.groupCreate', {
    roi_id: data.rois[0].id,
    name: '判据组',
    unit: '%',
    plot_type: 'area',
    scale_type: 'linear',
  });
  await backendRpc(page, 'column.update', {
    col_index: data.columns[1].col_index,
    updates: { x_group_id: created.group.id },
  });
  await openApp(page);
  await gotoStage(page, 6);

  const after = await diagramData<Payload>(page);
  const view = await page.evaluate(() => {
    const s = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
    return { scale: s.viewport.scale, panX: s.viewport.panX, panY: s.viewport.panY };
  });
  const box = await canvasBox(page);
  const roi = after.roi;
  const bandY = roi.yMin - 28; // 与 drawGroupBands 的 bandY 一致（yMin - 30 起、4px 厚）
  const midOf = (col: ColumnLite) => (col.startX + col.endX) / 2;
  const toLocal = (wx: number, wy: number) => ({
    x: wx * view.scale + view.panX,
    y: wy * view.scale + view.panY,
  });
  void box;

  const [c0, c1] = await samplePixels(page, [
    toLocal(midOf(after.columns[0]), bandY),
    toLocal(midOf(after.columns[1]), bandY),
  ]);
  const distance = Math.abs(c0[0] - c1[0]) + Math.abs(c0[1] - c1[1]) + Math.abs(c0[2] - c1[2]);
  expect(
    distance,
    `两个组的横条必须不同色：列1 rgb=${JSON.stringify(c0)} 列2 rgb=${JSON.stringify(c1)}`
  ).toBeGreaterThan(40);

  // 反向对照：把两列并回同一组后，横条颜色必须一致（否则「不同色」可能来自别的东西）
  await backendRpc(page, 'column.update', {
    col_index: data.columns[1].col_index,
    updates: { x_group_id: data.rois[0].default_group_id ?? data.rois[0].x_groups[0].id },
  });
  await openApp(page);
  await gotoStage(page, 6);
  const merged = await diagramData<Payload>(page);
  const [m0, m1] = await samplePixels(page, [
    toLocal(midOf(merged.columns[0]), bandY),
    toLocal(midOf(merged.columns[1]), bandY),
  ]);
  const sameGroupDistance =
    Math.abs(m0[0] - m1[0]) + Math.abs(m0[1] - m1[1]) + Math.abs(m0[2] - m1[2]);
  expect(sameGroupDistance, '同组两列必须是同一个组色').toBeLessThan(20);
});
