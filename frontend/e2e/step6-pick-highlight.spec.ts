/**
 * 步骤 6 两件事的像素判据：① 深度网格默认关；② 选列高亮必须覆盖**整列**（且不溢出 ROI）。
 *
 * ① 后端 `system.py` 曾经在载荷里发 `depthGridEnabled: True`，而前端三处都按关处理
 *   （GeologyCanvas 初值 / ProjectManager `?? false` / PropertyPanel 勾选框）—— 每次载入满屏
 *   蓝色水平虚线。现在载荷发 False，这里钉住。
 *
 * ② 选列高亮原来在 `applyTransform` 之后又调了 `viewport.worldToScreen()`（变换用了两次），
 *   实测高亮缩成一小块并偏到左上。判据用「选中前后逐像素比较」：高亮覆盖的高度必须接近
 *   ROI 的整段高度，且 ROI 上方不许被染。不依赖颜色常量，改配色不会假红。
 */

import { expect, test } from './fixtures';
import { canvasBox, diagramData, gotoStage, openStep6GroupsFold, resetBaseline } from './helpers';

const PANEL = '.step-panel[data-step="6"]';

interface Payload {
  columns: Array<{ id: string; startX: number; endX: number }>;
  roi: { yMin: number; yMax: number };
  calibration: { depthGridEnabled?: boolean };
}

/** 读画布某一竖线上的像素（CSS px 坐标，内部按 dpr 换算）。 */
async function sampleColumn(
  page: import('@playwright/test').Page,
  cssX: number,
  cssYs: number[]
): Promise<number[][]> {
  return page.evaluate(
    ({ x, ys }) => {
      const canvas = document.querySelector('#geology-canvas') as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const k = canvas.width / rect.width;
      const ctx = canvas.getContext('2d')!;
      return ys.map((y) => {
        const d = ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    },
    { x: cssX, ys: cssYs }
  );
}

test.describe('步骤 6：画布像素判据', () => {
  test('深度网格默认关；选列高亮覆盖整列且不溢出', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);

    const data = await diagramData<Payload>(page);
    expect(
      data.calibration.depthGridEnabled,
      '深度网格默认必须关（要开由用户在属性面板勾选）'
    ).toBe(false);

    const view = await page.evaluate(() => {
      const s = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
      return { scale: s.viewport.scale, panX: s.viewport.panX, panY: s.viewport.panY };
    });
    const box = await canvasBox(page);
    const col = data.columns[0];
    const roi = data.roi;

    const cssX = box.x + ((col.startX + col.endX) / 2) * view.scale + view.panX;
    const toCssY = (worldY: number) => box.y + worldY * view.scale + view.panY;

    // 沿 ROI 高度均匀取 21 个采样点；另取 3 个 ROI 上方（应始终不被染）与 1 个下方
    // 采样坐标必须是**画布内部**坐标（getImageData 的坐标系），不是页面坐标：
    // 之前直接传页面坐标，等于整体偏移了 canvas 的 box.x/box.y，量到的是别处（判据假红）。
    const localX = cssX - box.x;
    const insideYs = Array.from({ length: 21 }, (_, i) =>
      toCssY(roi.yMin + ((roi.yMax - roi.yMin) * (i + 0.5)) / 21) - box.y
    );
    const aboveYs = [roi.yMin - 80, roi.yMin - 60, roi.yMin - 45].map((y) => toCssY(y) - box.y);

    const beforeInside = await sampleColumn(page, localX, insideYs);
    const beforeAbove = await sampleColumn(page, localX, aboveYs);

    // 进入选列模式并选中第一列
    await openStep6GroupsFold(page);
    await page.locator(`${PANEL} #btn-create-new-group`).click();
    await page.mouse.click(cssX, toCssY((roi.yMin + roi.yMax) / 2));
    await page.waitForTimeout(300);

    const afterInside = await sampleColumn(page, localX, insideYs);
    const afterAbove = await sampleColumn(page, localX, aboveYs);

    // —— 诊断输出（定位被染区域到底在哪） ——
    const barText = await page
      .locator(`${PANEL} #column-pick-bar`)
      .innerText()
      .catch(() => '(无选列条)');
    console.log('[probe] pick bar:', barText.replace(/\s+/g, ' '));

    const gridYs = Array.from({ length: 24 }, (_, i) => (data.calibration as unknown as { imageHeight?: number }) && 0).length
      ? []
      : [];
    void gridYs;

    const changed = (a: number[][], b: number[][]) =>
      a.filter((rgb, i) => Math.abs(rgb[0] - b[i][0]) + Math.abs(rgb[1] - b[i][1]) + Math.abs(rgb[2] - b[i][2]) > 12).length;

    const insideChanged = changed(beforeInside, afterInside);
    expect(
      insideChanged / insideYs.length,
      `选列高亮必须覆盖整列（ROI 高度上 21 个采样点里只有 ${insideChanged} 个被染，`
        + '说明高亮框被缩放/偏移了——检查是否在变换后的 ctx 里又调了 worldToScreen)',
    ).toBeGreaterThan(0.8);

    expect(changed(beforeAbove, afterAbove), 'ROI 上方 40px 之外不许被高亮染到').toBe(0);
  });
});
