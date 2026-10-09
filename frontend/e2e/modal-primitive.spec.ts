/**
 * 模态框原语（`.ui-modal__header` / `.ui-modal__footer`）的**运行时**契约：计算样式 + 主题作用域。
 *
 * ## 为什么静态门禁不够
 *
 * `test-ui-consistency.mjs` 第 15 组只做两件静态检查：同一处 `class="..."` 里不得混挂
 * legacy `modal-header`/`modal-footer` 与 `ui-modal__*`；三处上下文选择器必须指向原语。
 * 它证明的是"源码里没写错"，**证明不了层叠结果**：两套规则同时存在时谁生效、
 * `body.theme-light .ocr-review-dialog .ui-modal__header` 到底找不找得到元素，只有渲染后才算数。
 * 本文件就是那一层的运行时对照（静态门禁在 `src`，运行时证据在这里）。
 *
 * ## 主题取值（易错，实测钉住）
 *
 * `index.html` 的 `<body class="theme-light">` 加上 `main.ts:190` 的
 * `savedTheme === 'dark' ? 移除 : 添加`，意味着**默认主题是浅色**——深色只在
 * `localStorage['straditize-theme'] === 'dark'` 时出现。两种主题都要断言：
 * 浅色是默认路径（用例 1/2），深色靠 `addInitScript` 显式进入（用例 3），
 * 否则"浅色覆盖只在浅色生效"这条契约永远只有一半证据。
 *
 * 断言口径统一为 `toHaveCSS`（自动重试）+ 把 CSS 变量解析成计算后的颜色再比对，
 * 避免把 token 的字面量（`#fff` / `rgba(...)`）抄进用例——token 改值时用例跟着变，
 * 但"原语背景必须等于 `--bg-card`"这个关系不变。
 */
import { expect, test, type Page } from './fixtures';
import { gotoStage, resetBaseline } from './helpers';

/** 把某个 CSS 变量解析成计算后的颜色（`rgb()`/`rgba()`），用于和 `toHaveCSS` 同口径比对。 */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((name: string) => {
    const probe = document.createElement('div');
    probe.style.background = `var(${name})`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return value;
  }, token);
}

test.describe('模态框原语与主题契约', () => {
  test('设置弹窗：header/footer 的计算样式来自 token，且不得混挂 legacy 类名', async ({ page }) => {
    await resetBaseline(page);
    expect(
      await page.evaluate(() => document.body.classList.contains('theme-light')),
      '默认主题为浅色（index.html 的 body.theme-light + main.ts:190 的 else 分支）',
    ).toBe(true);

    await page.locator('#btn-settings').click();
    const dialog = page.locator('.settings-dialog');
    await expect(dialog).toBeVisible();

    const header = dialog.locator('.ui-modal__header');
    const footer = dialog.locator('.ui-modal__footer');
    await expect(header, '设置弹窗必须有唯一的原语 header').toHaveCount(1);
    await expect(footer, '设置弹窗必须有唯一的原语 footer').toHaveCount(1);

    // 静态门禁第 15 组的运行时对照：渲染出来的 class 里不得再挂 legacy 类名。
    // 静态扫描只看 `class="..."` 字面量，JS 拼出来的类名它看不见，这里补上。
    for (const [name, loc] of [
      ['header', header],
      ['footer', footer],
    ] as const) {
      const cls = (await loc.getAttribute('class')) ?? '';
      const tokens = cls.split(/\s+/).filter((t) => t !== '');
      expect(tokens, `${name} 不得混挂 legacy 类名：${cls}`).not.toContain('modal-header');
      expect(tokens, `${name} 不得混挂 legacy 类名：${cls}`).not.toContain('modal-footer');
    }

    // 原语契约：padding 走 --space-3/--space-4，边框走 --border-color。
    await expect(header).toHaveCSS('display', 'flex');
    await expect(header).toHaveCSS('align-items', 'center');
    await expect(header).toHaveCSS('justify-content', 'space-between');
    await expect(header).toHaveCSS('padding-top', '12px');
    await expect(header).toHaveCSS('padding-left', '16px');
    await expect(header).toHaveCSS('border-bottom-width', '1px');
    await expect(header).toHaveCSS('background-color', await tokenColor(page, '--bg-card'));

    await expect(footer).toHaveCSS('display', 'flex');
    await expect(footer).toHaveCSS('justify-content', 'flex-end');
    await expect(footer).toHaveCSS('border-top-width', '1px');
    await expect(footer).toHaveCSS('background-color', await tokenColor(page, '--bg-footer'));
  });

  test('浅色（默认）：OCR 复核弹窗的浅色覆盖确实命中原语元素', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 5);
    await page.locator('#btn-ocr-review-modal').click();
    const ocr = page.locator('.ocr-review-dialog');
    await expect(ocr).toBeVisible();

    const header = ocr.locator('.ui-modal__header');
    const footer = ocr.locator('.ui-modal__footer');
    await expect(header).toHaveCount(1);
    await expect(footer).toHaveCount(1);

    // 判据说明：浅色覆盖把边框写成 #e2e8f0，而 token `--border-color` 是 #e5e7eb。
    // 下面这条断言把两者的差异钉住——否则一旦有人把 token 改成同一个值，
    // 后两条边框断言就会退化成"永远通过"，本用例的判别力会静默归零。
    expect(
      await tokenColor(page, '--border-color'),
      'token --border-color 必须与浅色覆盖的 #e2e8f0 不同，否则本用例失去判别力',
    ).toBe('rgb(229, 231, 235)');

    // 背景在浅色下与 token 同值（#ffffff / #f8fafc），真正能抓到回归的是边框色：
    // 若选择器退回 legacy 类名，这两条会变成 rgb(229, 231, 235)。
    await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(header).toHaveCSS('border-bottom-color', 'rgb(226, 232, 240)');
    await expect(footer).toHaveCSS('background-color', 'rgb(248, 250, 252)');
    await expect(footer).toHaveCSS('border-top-color', 'rgb(226, 232, 240)');
  });

  test('深色：浅色覆盖完全失效，原语回到深色 token', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('straditize-theme', 'dark'));
    await resetBaseline(page);
    expect(
      await page.evaluate(() => document.body.classList.contains('theme-light')),
      '显式选择深色时不得再带 theme-light（main.ts:191 的 remove 分支）',
    ).toBe(false);

    await gotoStage(page, 5);
    await page.locator('#btn-ocr-review-modal').click();
    const ocr = page.locator('.ocr-review-dialog');
    await expect(ocr).toBeVisible();

    const header = ocr.locator('.ui-modal__header');
    const footer = ocr.locator('.ui-modal__footer');
    // 浅色覆盖是 `body.theme-light` 作用域 → 深色下必须完全失效，取值回到 token。
    await expect(header).toHaveCSS('background-color', await tokenColor(page, '--bg-card'));
    await expect(header).toHaveCSS('border-bottom-color', await tokenColor(page, '--border-color'));
    await expect(footer).toHaveCSS('background-color', await tokenColor(page, '--bg-footer'));
    await expect(footer).toHaveCSS('border-top-color', await tokenColor(page, '--border-color'));
  });

  test('词汇表弹窗（批次 G-e 迁移）：header/footer/title 取自原语，内联旧值确实清除', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 5);
    await page.locator('#btn-ocr-review-modal').click();
    await expect(page.locator('.ocr-review-dialog')).toBeVisible();
    await page.locator('#btn-ocr-taxa-dict').click();

    // 词汇表弹窗与 OCR 复核弹窗同为 .modal-backdrop，用关闭钮 id 唯一定位（弹窗本体无专属类名）。
    const dict = page.locator('.modal-backdrop').filter({ has: page.locator('#dict-close-btn') });
    await expect(dict, '词汇表弹窗必须能打开（open() 依赖 ocr.getTaxaDict，失败会提前 return）').toBeVisible();

    const header = dict.locator('.ui-modal__header');
    const footer = dict.locator('.ui-modal__footer');
    await expect(header, '词汇表弹窗必须有唯一的原语 header').toHaveCount(1);
    await expect(footer, '词汇表弹窗必须有唯一的原语 footer').toHaveCount(1);

    for (const [name, loc] of [
      ['header', header],
      ['footer', footer],
    ] as const) {
      const cls = (await loc.getAttribute('class')) ?? '';
      const tokens = cls.split(/\s+/).filter((t) => t !== '');
      expect(tokens, `${name} 不得混挂 legacy 类名：${cls}`).not.toContain('modal-header');
      expect(tokens, `${name} 不得混挂 legacy 类名：${cls}`).not.toContain('modal-footer');
    }

    // 迁移前 header 内联 `padding: 10px 16px`、footer 内联 `padding: 10px 16px` + `gap: 8px`。
    // 断言原语取值（12px / 12px）即可证明内联旧值被移除——若内联还在，这里会是 10px / 8px。
    await expect(header).toHaveCSS('padding-top', '12px');
    await expect(header).toHaveCSS('padding-left', '16px');
    await expect(header).toHaveCSS('justify-content', 'space-between');
    await expect(footer).toHaveCSS('padding-top', '12px');
    await expect(footer).toHaveCSS('padding-left', '16px');
    await expect(footer).toHaveCSS('justify-content', 'flex-end');
    await expect(footer).toHaveCSS('column-gap', '12px');

    // 标题此前内联 `font-size: 13.5px; font-weight: 700`，原语统一 16px 且 margin: 0。
    const title = header.locator('.ui-modal__title');
    await expect(title, '标题必须挂原语 .ui-modal__title').toHaveCount(1);
    await expect(title).toHaveCSS('font-size', '16px');
    await expect(title).toHaveCSS('margin-top', '0px');
  });

  test('关于弹窗：顶栏与设置入口均可呼出，符合原语契约且完整包含作者、单位、依赖与检查更新', async ({ page }) => {
    await resetBaseline(page);

    // 1. 从顶栏点击【关于】按钮呼出
    const aboutBtn = page.locator('#btn-about');
    await expect(aboutBtn).toBeVisible();
    await aboutBtn.click();

    const aboutDialog = page.locator('.about-dialog');
    await expect(aboutDialog, '关于弹窗必须可见').toBeVisible();

    const header = aboutDialog.locator('.ui-modal__header');
    const footer = aboutDialog.locator('.ui-modal__footer');
    await expect(header, '关于弹窗必须有唯一的原语 header').toHaveCount(1);
    await expect(footer, '关于弹窗必须有唯一的原语 footer').toHaveCount(1);

    // 验证原语类名纯净
    for (const [name, loc] of [
      ['header', header],
      ['footer', footer],
    ] as const) {
      const cls = (await loc.getAttribute('class')) ?? '';
      const tokens = cls.split(/\s+/).filter((t) => t !== '');
      expect(tokens, `${name} 不得混挂 legacy 类名：${cls}`).not.toContain('modal-header');
      expect(tokens, `${name} 不得混挂 legacy 类名：${cls}`).not.toContain('modal-footer');
    }

    // 验证标题
    const title = header.locator('.ui-modal__title');
    await expect(title).toHaveText('关于 Straditize Pro');
    await expect(title).toHaveCSS('font-size', '16px');

    // 验证核心内容字段
    await expect(aboutDialog).toContainText('陈鸿明');
    await expect(aboutDialog).toContainText('chmzs@outlook.com');
    await expect(aboutDialog).toContainText('兰州大学资源环境学院 黄小忠课题组');
    await expect(aboutDialog).toContainText('GPL-3.0-or-later');
    await expect(aboutDialog).toContainText('Python 3.12+');

    // 验证检查更新按钮存在
    const checkUpdateBtn = aboutDialog.locator('#btn-check-update');
    await expect(checkUpdateBtn).toBeVisible();

    // 关闭弹窗
    await aboutDialog.locator('#about-close-btn').click();
    await expect(aboutDialog).toHaveCount(0);

    // 2. 从设置弹窗底部的【关于与检查更新】也可呼出
    await page.locator('#btn-settings').click();
    const settingsDialog = page.locator('.settings-dialog');
    await expect(settingsDialog).toBeVisible();

    const settingsAboutBtn = settingsDialog.locator('#btn-settings-about');
    await expect(settingsAboutBtn).toBeVisible();
    await settingsAboutBtn.click();

    // 再次断言关于弹窗可见
    await expect(page.locator('.about-dialog')).toBeVisible();
    await page.locator('.about-dialog #about-confirm-btn').click();
    await expect(page.locator('.about-dialog')).toHaveCount(0);

    // 关闭设置弹窗
    await settingsDialog.locator('#settings-close-btn').click();
    await expect(settingsDialog).toHaveCount(0);
  });
});
