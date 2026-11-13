import { test, expect } from './fixtures';
import { gotoStage, openApp } from './helpers';

/**
 * Esc 必须关闭模态（界面诚实性）。
 *
 * 缺陷背景：实测三个模态（元数据 / 年代模型 / 设置）按 Esc **3/3 都不关闭**，
 * 只能点右上角 × 。项目里 10+ 处各自手写 `modal-backdrop`，没有统一基类，
 * 所以没有任何一处绑过 Esc。
 *
 * 判据：打开导出模态 → 按 Esc → backdrop 必须消失。
 * 正对照：再打开 → 点关闭按钮 → 同样消失（证明判据不是"永远为空"）。
 */
test.describe('Esc 关闭模态', () => {
  // 契约：点【导出】必然打开面板（未标定也开），面板一打开就发 `export.csv` 取行集，
  // 未标定会话被后端按 CALIBRATION_ERROR(`-32003`) 拒绝。这条失败是**预期**的，
  // 用户看得见（行集 caption + toast），不是被吞掉。豁免只覆盖这一种具体病因：
  // 别的方法失败、别的错误码、别的原因仍然判红。
  test.use({
    allowlists: {
      rpcError: [/export\.csv \[-32003\]/],
      notice: [/数据集失败：.*导出需要深度标定/],
    },
  });

  test('打开导出模态后按 Esc 必须关闭；点关闭按钮同样能关', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 3);

    const backdrop = page.locator('.modal-backdrop');

    // 打开导出模态
    await page.locator('#btn-export-csv').click();
    await expect(backdrop).toHaveCount(1, { timeout: 10_000 });

    // Esc 关闭
    await page.keyboard.press('Escape');
    await expect(backdrop, '按 Esc 后模态必须关闭').toHaveCount(0, { timeout: 10_000 });

    // 正对照：关闭按钮也能关（证明遮挡确实能被关掉，判据不是恒空）
    await page.locator('#btn-export-csv').click();
    await expect(backdrop).toHaveCount(1, { timeout: 10_000 });
    await page.locator('#export-modal-close').click();
    await expect(backdrop, '点关闭按钮必须能关').toHaveCount(0, { timeout: 10_000 });
  });
});
