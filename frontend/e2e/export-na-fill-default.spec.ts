import { test, expect } from './fixtures';
import { gotoStage, openApp } from './helpers';

/**
 * 导出面板的「缺测填充」默认值必须是 `NA`。
 *
 * 缺陷背景：默认选中 `0.0（地学）`，等于默认把"未测到"写成"测到 0 丰度"。
 * 目前这个选项并不影响 CSV/XLSX 产物（实测），但默认值是**界面在教用户做事**，
 * 它必须表达正确语义：缺测 ≠ 0。
 */
test.describe('导出缺测填充默认值', () => {
  test('打开导出面板时默认就是 NA，不是 0.0', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 3);

    await page.locator('#btn-export-csv').click();
    const sel = page.locator('#wpd-na-fill');
    await expect(sel).toBeVisible({ timeout: 15_000 });

    await expect(sel, '缺测填充默认值必须是 NA（缺测 ≠ 0）').toHaveValue('NA');

    // 0.0 仍然可选，但不得是默认项
    const options = await sel.locator('option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value)
    );
    expect(options).toContain('0.0');
  });
});
