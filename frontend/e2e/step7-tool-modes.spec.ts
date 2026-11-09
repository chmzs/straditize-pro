/**
 * 步骤 7 工具语义：**微调（S）点击只选择、加点（A）点击才加点**。
 *
 * 现场问题：微调模式下左键点一下就多出一个控制点。根因在 `SelectToolStrategy.onMouseDown`
 * 的第 5 段——`if (ctx.isToolAllowed('addPoint'))` 成立（步骤 7 起 addPoint 是允许的工具），
 * 于是微调模式也执行了加点；而 `AddPointToolStrategy`（键位 A）本来就负责这件事，这段是重复。
 * 键位表写着 `A 加点 / S 微调 / D 删点`（ARCHITECTURE §9.6），工具行为必须与之一致。
 *
 * 判据是一对 A/B：
 *   ① S 模式点列内空白 → 控制点数**不变**；
 *   ② A 模式点同一位置 → 控制点数 **+1**。
 * ② 同时证明这套计数能发现变化（否则 ① 的「不变」没有意义）。
 */

import { expect, test } from './fixtures';
import { activeTool, diagramData, gotoStage, resetBaseline } from './helpers';

interface Payload {
  columns: Array<{ id: string; col_index: number; startX: number; endX: number; controlPoints?: unknown[] }>;
  activeTaxaId?: string;
  roi: { yMin: number; yMax: number };
}

/**
 * 控制点数读**前端**权威状态（`getState().columns[].controlPointCount`）。
 *
 * 不读后端载荷：加点先把点写进 `data.columns`，`onDataChange` 之后才异步落库——
 * 读后端会拿到加之前的数（第一版就是这样，A 半边一直显示 52）。
 */
async function countPoints(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const s = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
    return Number(s.columns[0]?.controlPointCount ?? 0);
  });
}

test('微调模式点击不加点；加点模式才加点', async ({ page }) => {
  await resetBaseline(page);
  await page.selectOption('#select-sample-diagram', 'beginner');
  await expect
    .poll(
      async () => {
        const d = await diagramData<{ imageWidth: number; imageHeight: number }>(page);
        return [d.imageWidth, d.imageHeight];
      },
      { timeout: 30_000, message: '需要带列的真实图谱' }
    )
    .toEqual([1923, 1796]);
  await gotoStage(page, 5);
  await gotoStage(page, 7);

  const data = await diagramData<Payload>(page);
  const col = data.columns[0];
  const before = await countPoints(page);

  const view = await page.evaluate(() => {
    const s = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
    return { scale: s.viewport.scale, panX: s.viewport.panX, panY: s.viewport.panY };
  });
  const box = await page.locator('#geology-canvas').boundingBox();
  if (!box) throw new Error('画布没有布局');
  const worldX = (col.startX + col.endX) / 2;
  const worldY = (data.roi.yMin + data.roi.yMax) / 2;
  const clickX = box.x + worldX * view.scale + view.panX;
  const clickY = box.y + worldY * view.scale + view.panY;

  // ① 微调模式（S）：点列内空白，控制点数不变
  await page.keyboard.press('s');
  await page.mouse.click(clickX, clickY);
  await page.waitForTimeout(400);
  expect(await countPoints(page), '微调模式下点击不得新增控制点').toBe(before);

  // ② 加点模式（A）：同一点击，控制点数 +1
  //    先确认工具真的切过去了（页脚是工具描述的投影，切失败它会立刻暴露），
  //    再避开已有锚点：底图上那列已有几十个控制点，点中锚点只会变成选择。
  await page.keyboard.press('a');
  await expect
    .poll(async () => (await activeTool(page)).footer, { timeout: 10_000, message: '工具必须切到加点' })
    .toContain('添加控制点');
  const emptyWorldY = data.roi.yMin + 6; // ROI 顶部 6px 处几乎不可能已有锚点
  const emptyClickY = box.y + emptyWorldY * view.scale + view.panY;
  await page.mouse.click(clickX, emptyClickY);
  await expect
    .poll(async () => countPoints(page), { timeout: 10_000 })
    .toBeGreaterThan(before);
});
