/**
 * 顶栏精简 + 设置弹窗（语言 / 主题 / 远程访问） —— 迁移自旧 tests/e2e/test_settings.py。
 *
 * 两类断言各归其位：
 * - "顶栏没有旧的中英切换 / 主题图标 / RPC 胶囊"、"切英文后全站文案变英文" 是**纯 UI 事实**，
 *   只能在 DOM 上验证（后端没有"顶栏按钮"这种东西），这部分保留 DOM 断言。
 * - 旧测试把"保存"完全当成前端事件：只断言了 localStorage 与 DOM 文案，
 *   **从未验证配置是否真的到了后端**。而保存路径恰恰是"modal.remove() 之后才 await
 *   后端 RPC"（SettingsModal.ts:318-329），前端看起来成功不代表后端存下来了。
 *   这里补上后端 `system.getConfig` 的权威断言。
 *
 * 注意副作用：`system.updateConfig` 会调 `save_config()` 落盘。本机
 * `~/.straditize/config.json` 是安全的 —— e2e 后端已把配置隔离到临时目录
 * （`support/serve_e2e_backend.py:_isolate_config`）。但该临时配置在**同一次 server
 * 运行内是共享且持久的**，所以仍用 before/afterEach 记录并复原原值，避免这个"会改配置"
 * 的用例污染同一次运行中的后续用例。
 */
import { expect, test } from './fixtures';
import { resetBaseline, rpc } from './helpers';

interface SystemConfig {
  remote_access_enabled: boolean;
  allowed_hosts: string[];
  locale: string;
  theme: string;
}

let originalConfig: SystemConfig | null = null;

test.describe('顶栏与设置弹窗', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    originalConfig = await rpc<SystemConfig>(page, 'system.getConfig');
  });

  test.afterEach(async ({ page }) => {
    // 测试失败也要复原：临时配置在本次 server 运行期间是共享的，
    // 留下的 en / dark / 远程白名单会改变后续用例的起始状态。
    if (!originalConfig) return;
    await rpc(page, 'system.updateConfig', {
      remote_access_enabled: originalConfig.remote_access_enabled,
      allowed_hosts: originalConfig.allowed_hosts,
      locale: originalConfig.locale,
      theme: originalConfig.theme,
    });
  });

  test('顶栏精简：旧的中英切换/主题图标/RPC 胶囊已移除，[设置] 与导出/OCR/年代按钮常驻', async ({
    page,
  }) => {
    // 这三个 id 曾经是顶栏控件，已被 [⚙ 设置] 收拢；用 toHaveCount(0) 断言它们确实不再渲染。
    for (const id of ['btn-toggle-locale', 'btn-toggle-theme', 'rpc-status-pill']) {
      await expect(page.locator(`#${id}`), `${id} 属于旧顶栏，必须已被移除`).toHaveCount(0);
    }
    for (const id of [
      'btn-settings',
      'btn-export-csv',
      'btn-ocr-review-modal',
      'btn-age-depth-modal',
    ]) {
      await expect(page.locator(`#${id}`), `${id} 必须常驻顶栏`).toBeVisible();
    }
  });

  test('设置弹窗：切英文 + 暗色 + 开远程白名单，保存后浏览器与后端两侧都要生效', async ({
    page,
  }) => {
    await page.locator('#btn-settings').click();
    const dialog = page.locator('.settings-dialog');
    await expect(dialog).toBeVisible();
    // 弹窗打开时会异步拉一次后端配置回填开关与白名单（SettingsModal.ts:198-214）。
    // 不等它落定就先填值，可能被它覆盖，保存下去的就是被覆盖后的旧值。
    await page.waitForLoadState('networkidle');

    await page.locator('#settings-language').selectOption('en');
    // 主题单选与远程开关都走真实点击：远程 checkbox 是 opacity:0/0×0 的隐藏控件，
    // 点它外层的 label 才是用户的真实路径（label 激活会派发 change）。
    await page.locator('label:has(#theme-dark-radio)').click();
    await page.locator('label.switch:has(#settings-remote-toggle)').click();
    await page.locator('#settings-allowed-hosts').fill('192.168.1.100');
    await page.locator('#btn-settings-save').click();

    await expect(dialog, '保存后弹窗必须关闭').toHaveCount(0);

    // ---- 浏览器侧：localStorage 与 <html lang> ----
    expect(await page.evaluate(() => localStorage.getItem('straditize-theme'))).toBe('dark');
    expect(await page.evaluate(() => localStorage.getItem('straditize-locale'))).toBe('en');
    expect(
      await page.evaluate(() => document.body.classList.contains('theme-light')),
      '暗色主题必须体现在 body 类上'
    ).toBe(false);
    expect(await page.evaluate(() => document.documentElement.getAttribute('lang'))).toBe('en');

    // ---- 后端侧：保存路径是"先关弹窗再 await RPC"，所以要轮询等它真的落库 ----
    await expect
      .poll(async () => (await rpc<SystemConfig>(page, 'system.getConfig')).locale, {
        message: '后端 locale 必须持久化为 en（旧测试只看了 localStorage）',
        timeout: 10_000,
      })
      .toBe('en');
    const persisted = await rpc<SystemConfig>(page, 'system.getConfig');
    expect(persisted.theme).toBe('dark');
    expect(persisted.remote_access_enabled).toBe(true);
    expect(persisted.allowed_hosts).toContain('192.168.1.100');

    // ---- 语言确实整站生效：这是纯 UI 事实，只能读 DOM ----
    const englishTexts: [string, string][] = [
      ['#btn-open-file', 'Diagram'],
      ['#btn-settings', 'Settings'],
      ['#btn-export-csv', 'Export'],
      // 断言整颗按钮的文本，而不是 `span:last-child`：按钮内部是
      // `<span class="step-num">` + `<span>{label}</span>`，靠子元素顺序定位会在
      // 任何一次徽标/图标插入后失效（知乎《大型 ToB 项目的前端自动化测试实践》
      // 的"可维护的 CSS 选择器"一节即针对这类位置依赖）。
      ['.workflow-step-btn[data-step="1"]', '1.Load'],
      ['#footer-dimensions', 'Image'],
      ['.sidebar-title span', 'Taxa Columns List'],
      ['#btn-insert-gap-col', 'Insert Gap'],
      ['.inspector-title span', 'Inspector'],
    ];
    for (const [selector, text] of englishTexts) {
      await expect(page.locator(selector), `${selector} 应切换为英文 ${text}`).toContainText(text);
    }
    await expect(page.locator('#inp-search-taxa')).toHaveAttribute('placeholder', /Search taxa/);
    await expect(
      page.locator('[data-fmode="select"] span').first(),
      '悬浮工具条上的"调整"应切换为 Adjust'
    ).toContainText('Adjust');

  });
});
