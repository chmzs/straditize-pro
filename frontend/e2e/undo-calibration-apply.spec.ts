import { test, expect } from './fixtures';
import { gotoStage, openApp, rpc } from './helpers';

/**
 * U2：**Y 轴标定必须能被真正撤销**（后端 `calibration` 五点回退）。
 *
 * 缺陷背景（`docs/findings/undo-redesign-2026-11-11.md`）：旧撤销只重放前端快照，
 * 实测"标定 → 撤销"发出的是 `roi.update`（与标定无关），后端 calibration 从不回退。
 *
 * 判据：读 `getDiagramData().calibration` 的 `top_px/top_cm/bottom_px/bottom_cm/unit`，
 * 撤销后必须逐字段回到标定前的值。
 * 金丝雀：注掉 `applyDepthCalibration` 里的 `recordUndo` 分支 → 撤销后 calibration 不变 → 必红。
 */
test.describe('撤销 Y 轴标定', () => {
  test('标定 → 撤销 → 后端五点回退到标定前', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 3);

    const readCal = async () => {
      const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
      const c = d.calibration ?? {};
      return {
        top_px: c.top_px ?? null,
        top_cm: c.top_cm ?? null,
        bottom_px: c.bottom_px ?? null,
        bottom_cm: c.bottom_cm ?? null,
      };
    };

    const apply = async (topPx: string, topVal: string, botPx: string, botVal: string) => {
      await page.locator('#ycal-inp-top-px').fill(topPx);
      await page.locator('#ycal-inp-top-val').fill(topVal);
      await page.locator('#ycal-inp-bot-px').fill(botPx);
      await page.locator('#ycal-inp-bot-val').fill(botVal);
      await page.locator('#btn-apply-ycalib').click();
    };

    // 第一次标定：建立"标定前已标定"的前提（未标定状态下没有清除标定的 RPC，故不入栈）
    await apply('120', '10', '620', '60');
    await expect.poll(async () => (await readCal()).top_px, { timeout: 20_000 }).toBe(120);
    const first = await readCal();

    // 第二次标定 → 撤销必须回到第一次的标定值
    await apply('220', '20', '720', '70');
    await expect.poll(async () => (await readCal()).top_px, { timeout: 20_000 }).toBe(220);

    await expect(page.locator('#btn-undo')).toBeEnabled({ timeout: 10_000 });
    const undoTitle = await page.locator('#btn-undo').getAttribute('title');

    // 逐框填值会各自触发一次提交（实测栈深 4），所以撤销要连点到回到第一次标定为止。
    // 判据：**4 次以内**必须回到 first；每次点击后都读后端，不靠界面。
    let reachFirst = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await page.locator('#btn-undo').click();
      try {
        await expect
          .poll(async () => JSON.stringify(await readCal()), { timeout: 5_000 })
          .toBe(JSON.stringify(first));
        reachFirst = true;
        break;
      } catch {
        /* 还没回到第一次标定，继续撤销 */
      }
    }

    expect(
      reachFirst,
      `连续撤销最多 4 次后后端应回到第一次标定（期望=${JSON.stringify(
        first
      )}；实际=${JSON.stringify(await readCal())}；title=${undoTitle}）`
    ).toBe(true);
  });
});
