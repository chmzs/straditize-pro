/**
 * Issue #9：页脚工具提示对 `pickTick` 说谎。
 *
 * ## 缺陷
 *
 * `ToolModeManager.getToolDescription()` 的 `switch` 漏了 `pickTick`，落进 `default`
 * 分支返回「选择与微调 (V)」。用户点了【点一个刻度齿】、画布光标已变十字，页脚却
 * 宣称他在"选择与微调"——指令与状态相反。
 *
 * ## 为什么判据是页脚文本而不再是光标
 *
 * 光标（`crosshair`）只能证明"工具切了"，证明不了"界面如实描述了这个工具"。
 * `e2e/step6-picktick.spec.ts` 的文件头注释里明确写过一句"页脚会说谎，只有光标
 * 是如实的"——本文件就是来把这句话作废的：光标与页脚必须同时为真。
 *
 * ## 反面判据
 *
 * `pickTick` 时页脚**不得**出现"选择与微调"：只断言"包含 点选刻度齿"不够，
 * 因为旧实现下若有人把两条文案拼在一起，包含关系仍然成立。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline } from './helpers';
import type { Page } from '@playwright/test';

const PANEL = '.step-panel[data-step="6"]';
const FOOTER = '#footer-tool-mode';
const CANVAS = '#geology-canvas';

async function cursorOf(page: Page): Promise<string> {
  return page.evaluate(
    (sel) => getComputedStyle(document.querySelector(sel)!).cursor,
    CANVAS
  );
}

async function footerText(page: Page): Promise<string> {
  return (await page.locator(FOOTER).innerText()).replace(/\s+/g, ' ').trim();
}

test.describe('Issue #9：pickTick 的页脚文案', () => {
  // 点【点一个刻度齿】会主动弹出「请在画布上点一个刻度齿」的引导提示 —— 这是产品
  // 刻意的用户可见说明，不是静默兜底，故在通知门禁里显式豁免（与
  // `step6-picktick.spec.ts` 同一口径）。
  test.use({ allowlists: { notice: [/请在画布上点一个刻度齿/] } });

  test('P1 点【点一个刻度齿】后，页脚说的是点选刻度齿而不是选择与微调', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    await resetBaseline(page);
    await gotoStage(page, 6);

    // 前置：进入步骤 6 的默认工具是 select —— 页脚此刻**应该**是「选择与微调」。
    // 有这条前置，下面那条"不含选择与微调"才有判别力：否则文案若根本没渲染，
    // 断言也会通过。
    expect(await footerText(page), '前置：步骤 6 的默认工具是 select').toContain('选择与微调');

    await page.locator(`${PANEL} #btn-pick-tick`).click();
    await page.waitForTimeout(200);

    expect(await cursorOf(page), '前置：切到 pickTick 后光标必须是十字').toBe('crosshair');

    const footer = await footerText(page);
    expect(footer, `页脚必须说"点选刻度齿"（实测「${footer}」）`).toContain('点选刻度齿');
    expect(footer, `pickTick 下页脚不得再说"选择与微调"（实测「${footer}」）`).not.toContain(
      '选择与微调'
    );
  });

  test('P2 T 键切到 pickTick 同样如实反映在页脚，再按一次回到 select', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    await resetBaseline(page);
    await gotoStage(page, 6);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    expect(await cursorOf(page), 'T 键必须切到 pickTick（光标十字）').toBe('crosshair');
    expect(await footerText(page), 'T 键切过去的模式页脚也必须如实').toContain('点选刻度齿');

    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    expect(await cursorOf(page), '再按 T 回到 select').toBe('default');
    expect(await footerText(page), '回到 select 后页脚如实显示选择与微调').toContain('选择与微调');
  });

  test('P3 pickTick 在不允许的阶段按 T 会被门禁拦下并给出阶段提示', async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 1050 });
    await resetBaseline(page);
    await gotoStage(page, 3);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

    await page.keyboard.press('t');
    await page.waitForTimeout(200);
    expect(await cursorOf(page), '步骤 3 不该允许 pickTick').toBe('crosshair');
    // 步骤 3 的默认工具是 ycalib，光标也是 crosshair —— 所以判据必须看页脚。
    expect(await footerText(page), '步骤 3 按 T 不得把页脚改成点选刻度齿').not.toContain(
      '点选刻度齿'
    );
  });
});
