/**
 * 关于面板的**版本真相**：面板上显示的版本必须等于 `frontend/package.json` 的 `version`。
 *
 * ## 为什么这条判据必须存在
 *
 * `AboutModal.ts` 曾把 `CURRENT_VERSION = '2.0.0'` 写死在源码里，而
 * `frontend/package.json` 与 `pyproject.toml` 已到 2.0.5。后果不只是"显示旧版本"：
 * `handleCheckUpdate` 拿这个常量跟 GitHub Release 的 `tag_name` 做**字符串不等**
 * 比较，于是 2.0.1–2.0.5 全部被判成"发现新版本"，用户点了更新也没意义。
 *
 * 这与 `e896bff` 修过的站点徽章写死版本是同一类漂移：**版本号有多个事实源**。
 * 修法是构建期从 package.json 注入（`vite.config.ts` 的 `define` →
 * `src/core/appVersion.ts` 的 `APP_VERSION`），所以本用例的比较对象是
 * **两个独立的推导路径**：
 *
 *   - 左：页面 DOM 里渲染出来的徽标文本（来自构建产物里的注入值）；
 *   - 右：本测试进程直接读 `frontend/package.json`。
 *
 * 两侧不共享任何量，因此把 package.json 的 version 改一个值、重新构建，
 * 本用例就会跟着变——这才叫"证明真的读的是单一源"。
 *
 * 语序上的另一条（语义化比较）由 `frontend/test-core.js` 的三向断言钉住：
 * `2.0.10 > 2.0.9`、`2.0.5 == 2.0.5`。本文件只证明"显示的就是 package.json 的值"。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from './fixtures';
import { resetBaseline } from './helpers';

/** 唯一事实源：与 `vite.config.ts` 读的是同一个文件，但**独立求值**。 */
const PKG_VERSION: string = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as {
    version: string;
  }
).version;

test.describe('关于面板：版本号与 package.json 同源', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('面板显示的版本必须等于 frontend/package.json 的 version', async ({ page }) => {
    await page.locator('#btn-about').click();

    const dialog = page.locator('.about-dialog');
    await expect(dialog, '关于弹窗必须可见').toBeVisible();

    const badge = dialog.locator('#about-version');
    await expect(badge, '版本徽标必须存在且只有一个').toHaveCount(1);

    // 相等判据：不是"包含 v 开头"，是逐字符等于 package.json 的值。
    await expect(
      badge,
      `关于面板显示的版本必须等于 frontend/package.json 的 version（${PKG_VERSION}）；` +
        '不一致说明版本号又出现了第二个事实源',
    ).toHaveText(`v${PKG_VERSION}`);

    // 反向哨兵：修前那个写死的 2.0.0 不得再出现（它让 2.0.1–2.0.5 全被判成"有新版本"）。
    // 仅当真实版本不是 2.0.0 时才断言，否则这条与上面的相等判据重复且恒真。
    if (PKG_VERSION !== '2.0.0') {
      await expect(badge, '面板不得再显示写死的 2.0.0').not.toHaveText('v2.0.0');
    }
  });
});
