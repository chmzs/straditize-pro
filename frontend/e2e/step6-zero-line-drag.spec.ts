/**
 * 步骤 6：**拖动绿线（0 点）= 改轴线粗**，不是改列宽。
 *
 * 绿线 = `列左缘 + axis_stroke_px`（0 点），红线才是列切分线。两者以前都只能靠
 * 步骤 6 面板里的输入框改，画布上拖不动——用户在这条线上拖半天没反应（截图现场）。
 *
 * 判据三件事：① 拖完后端 `axis_stroke_px` 真的变了；② 列几何（startX）**没变**；
 * ③ 拖动量约等于鼠标位移（±1px）。第 ② 条是关键：若拖绿线同时改了列宽，
 * 那它就是在悄悄挪列切分线，会把上一列的量程一起改掉。
 */

import { expect, test } from './fixtures';
import { canvasBox, diagramData, gotoStage, resetBaseline } from './helpers';

interface ColumnPayload {
  startX: number;
  endX: number;
  x_group_id?: string | null;
  axis_stroke_px?: number | null;
  col_index?: number | null;
}

interface Payload {
  columns: ColumnPayload[];
  rois?: Array<{ x_groups?: Array<{ id: string; axis_stroke_px?: number | null }> }>;
}

async function payload(page: import('@playwright/test').Page): Promise<Payload> {
  return diagramData<Payload>(page);
}

function effectiveStroke(data: Payload): number {
  const col = data.columns[0];
  const group = (data.rois ?? [])
    .flatMap((r) => r.x_groups ?? [])
    .find((g) => g.id === col.x_group_id);
  const value = Number(col.axis_stroke_px ?? group?.axis_stroke_px ?? 5);
  return Number.isFinite(value) && value > 0 ? value : 5;
}

test.describe('步骤 6：拖绿线微调 0 点', () => {
  test('拖动绿线改轴线粗，列几何不动', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);

    const before = await payload(page);
    const startStroke = effectiveStroke(before);
    const col0 = before.columns[0];

    const geometry = await page.evaluate(() => {
      const api = (window as unknown as { __straditize: { getState: () => any } }).__straditize;
      const s = api.getState();
      return {
        startX: Number(s.columns[0].startX),
        imageHeight: Number(s.image.height),
        scale: Number(s.viewport.scale),
        panX: Number(s.viewport.panX),
        panY: Number(s.viewport.panY),
      };
    });

    const box = await canvasBox(page);
    const worldZeroX = geometry.startX + startStroke;
    const worldY = geometry.imageHeight / 2;
    const screenX = box.x + worldZeroX * geometry.scale + geometry.panX;
    const screenY = box.y + worldY * geometry.scale + geometry.panY;

    // 拖 +5 个**世界像素**：轴线粗是图像像素量，不是屏幕像素。
    const dragWorld = 5;
    const targetX = box.x + (worldZeroX + dragWorld) * geometry.scale + geometry.panX;

    await page.mouse.move(screenX, screenY);
    await page.mouse.down();
    await page.mouse.move(targetX, screenY, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => effectiveStroke(await payload(page)), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(startStroke + dragWorld - 1);

    const after = await payload(page);
    expect(Number(after.columns[0].startX), '拖绿线**不得**改列左缘（那是红线的职责）').toBe(
      Number(col0.startX)
    );
  });
});
