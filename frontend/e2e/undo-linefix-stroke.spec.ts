import { test, expect } from './fixtures';
import { canvasBox, gotoStage, openApp, rpc } from './helpers';

/**
 * U5：**单笔人工修正可撤销**（用户决策②「撤销应覆盖清理编辑」的落点）。
 *
 * 缺陷背景：旧撤销只重放前端快照，而人工笔迹的权威存储是后端 `line_strokes`；
 * 实测涂一笔后 `#btn-undo` 是 disabled，Ctrl+Z 也无效 —— 用户的手工修正一旦画错就没退路。
 *
 * 判据（读后端，不看 DOM）：
 * 1. 涂一笔后 `line_strokes` 增加；
 * 2. 撤销后 `line_strokes` 回到涂之前（长度相等）；
 * 3. 重做后再次回到涂之后。
 *
 * 金丝雀：注掉 `appendLineFixStroke` 里的 `undoStack.push(...)` → 第 2 条必红。
 */
test.describe('撤销人工修正笔迹', () => {
  test('涂一笔 → 撤销 → 后端笔迹数回退；重做 → 再回来', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 4);

    const strokes = async () => {
      const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
      return (d.line_strokes ?? d.lineStrokes ?? []) as unknown[];
    };

    const before = (await strokes()).length;

    // 进入「擦掉误标」笔刷态
    await page.locator('#btn-trigger-linefix').click();
    await expect
      .poll(async () => page.locator('#hud-text').innerText(), { timeout: 10_000 })
      .toContain('擦除笔');

    // 在画布中上部拖一笔
    const box = await canvasBox(page);
    const x1 = box.x + box.width * 0.30;
    const y1 = box.y + box.height * 0.28;
    await page.mouse.move(x1, y1);
    await page.mouse.down();
    await page.mouse.move(x1 + 180, y1 + 60, { steps: 15 });
    await page.mouse.up();

    await expect
      .poll(async () => (await strokes()).length, {
        message: '涂一笔后后端 line_strokes 必须增加',
        timeout: 20_000,
      })
      .toBe(before + 1);

    // 撤销：笔迹数回退
    const undoBtn = page.locator('#btn-undo');
    await expect(undoBtn, '涂一笔后撤销按钮必须可用（旧实现是灰的）').toBeEnabled({
      timeout: 10_000,
    });
    await undoBtn.click();
    await expect
      .poll(async () => (await strokes()).length, {
        message: '撤销后后端笔迹数必须回到涂之前',
        timeout: 20_000,
      })
      .toBe(before);

    // 重做：再回来
    const redoBtn = page.locator('#btn-redo');
    await expect(redoBtn).toBeEnabled({ timeout: 10_000 });
    await redoBtn.click();
    await expect
      .poll(async () => (await strokes()).length, {
        message: '重做后后端笔迹数必须回到涂之后',
        timeout: 20_000,
      })
      .toBe(before + 1);
  });
});
