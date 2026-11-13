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
  // 未标定场景**故意**触发 -32003：面板会把它写成 caption 与 toast。
  // 这条 console.error 是预期的（fixtures 的 telemetry 要求显式声明豁免，不是放宽判据）。
  test.use({
    allowlists: {
      consoleError: [/导出需要深度标定/],
      // `export.csv` 的 -32003 是本场景**被测的行为**（面板必须把它写成 caption），
      // 不是被吞掉的失败：断言在 caption 上。
      rpcError: [/导出需要深度标定/],
      // 面板首次取数失败会弹一条通知（「读取 <dataset> 数据集失败… -32003」），
      // 这也是本场景的被测行为：用户必须看到为什么没有数据。
      notice: [/读取 .* 数据集失败/],
    },
  });

  test('打开导出面板时默认就是 NA，不是 0.0', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 3);

    await page.locator('#btn-export-csv').click();
    const sel = page.locator('#wpd-na-fill');
    await expect(sel).toBeVisible({ timeout: 15_000 });

    // 未标定也必须**先把面板打开**：取不到数据只能在面板里说明原因，
    // 不能“点了导出没反应”（旧实现把 open() 放在 core.exportData 成功之后）。
    const caption = page.locator('#wpd-rowset-caption');
    await expect(caption).toBeVisible();
    await expect(caption, '面板必须说明为什么没有数据（需要步骤 3 的深度标定）').toHaveText(/标定/);

    await expect(sel, '缺测填充默认值必须是 NA（缺测 ≠ 0）').toHaveValue('NA');

    // 0.0 仍然可选，但不得是默认项
    const options = await sel.locator('option').evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value)
    );
    expect(options).toContain('0.0');
  });
});
