import { test, expect } from './fixtures';
import { gotoStage, openApp } from './helpers';

/**
 * 界面诚实性：**保存项目必须等结果再报成功**。
 *
 * 缺陷背景：旧实现是 `void saveProjectFile()` 紧跟一句"已打包导出成功"——
 * 后端失败也照样显示成功，用户无法区分"存了"和"没存"。这属于用乐观文案掩盖失败。
 *
 * 判据：让 `project.save` 返回 RPC 错误 → HUD 必须出现"失败"，
 * 且**不得**同时出现"已保存"。修复前这条必红（文案永远是成功）。
 */
test.describe('保存项目的反馈必须真实', () => {
  // 故意让后端失败：错误冒泡到控制台与提示通道是**期望行为**，不是缺陷。
  // 注意：Playwright 的**对象型 option 整体替换**，所以豁免只能写在这一处——
  // 再写第二个 `test.use({ allowlists: ... })` 会把上面的完全覆盖掉（本轮踩过）。
  test.use({
    allowlists: {
      consoleError: [/模拟后端保存失败/],
      notice: [/导出失败/, /工程包保存失败/],
      rpcError: [/模拟后端保存失败/],
    },
  });

  test('project.save 失败时 HUD 必须报失败，不得报成功', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 3);

    // 让保存请求返回 JSON-RPC 错误（其余 RPC 原样放行）
    await page.route('**/rpc', async (route) => {
      const body = route.request().postData() ?? '';
      if (body.includes('project.save')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            error: { code: -32603, message: '模拟后端保存失败' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.locator('#btn-save-project').click();

    const hud = page.locator('#hud-text');
    await expect
      .poll(async () => (await hud.innerText()).trim(), {
        message: 'HUD 必须出现保存失败提示',
        timeout: 15_000,
      })
      .toContain('失败');

    const text = (await hud.innerText()).trim();
    expect(text, `失败时不得同时宣称已保存，实际：${text}`).not.toContain('已保存');
  });
});
