/**
 * 步骤 6「列组」折叠区：**默认展开**，收起后在本次会话内保持（用户偏好 2026-11-16）。
 *
 * ## 判据
 *
 * 1. 进入步骤 6 → `details[data-role="groups-fold"]` 的 `open` 为真；
 * 2. 点 summary 收起 → `open` 为假；再点一次 → 重新展开（折叠行为本身不变）；
 * 3. 收起后切到别的步骤再回来 → 仍为收起（`state.groupsFoldOpen` 会话内记忆；
 *    面板每次 `onDataChange` 都整块重渲染、DOM 会重建，所以这条必须实测）；
 * 4. 默认展开**不许把主动作挤出首屏**：1280×720（设计系统 §「最低支持 1280×720」）下
 *    `#btn-apply-xticks-next` 必须完整落在视口内；
 * 5. 折叠区内容**不得被裁剪、不得自成滚动容器**：参数卡片（单位 / 形态 / 尺度 / 轴粗）
 *    必须整块可读，滚动只由 `.inspector-body` 承担。曾经的 132px 限高会把卡片从半行切断，
 *    并且与勾选清单的 max-height 形成嵌套滚动——那是本用例现在要挡住的回归。
 *
 * ## 反向验证
 *
 * - 把 `INITIAL_XTICKS_STATE.groupsFoldOpen` 改回 `false` → 判据 1 红；
 * - 删掉 `mount()` 里 `details.toggle` 的回写 → 判据 3 红；
 * - 把主动作搬回 `.inspector-body`（去掉 `.inspector-footer`）→ 判据 4 红：留在滚动区里时
 *   button bottom 790 > 720，且会压住轴粗输入框（见 step6-panel-layout.spec.ts 判据 4）；
 * - 给折叠区加回 `max-height: 132px; overflow-y: auto` → 判据 5 红（裁剪 + 嵌套滚动）。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline } from './helpers';

const FOLD = '.step-panel[data-step="6"] details[data-role="groups-fold"]';
const FOLD_BODY = '[data-role="groups-fold-body"]';
const NEXT_BTN = '#btn-apply-xticks-next';

test.describe('步骤 6 列组折叠区', () => {
  test('默认展开、可收起、收起后会话内保持，且主动作仍在首屏', async ({ page }) => {
    // 设计系统：最低支持 1280×720。这个档位最容易暴露「展开把按钮挤下去」。
    await page.setViewportSize({ width: 1280, height: 720 });
    await resetBaseline(page);
    await gotoStage(page, 5);
    await gotoStage(page, 6);

    const fold = page.locator(FOLD);
    await expect(fold).toBeVisible();
    await expect(fold, '列组必须默认展开').toHaveAttribute('open', '');

    // 判据 4：主动作完整在视口内（不用滚动就能点到）
    const box = await page.locator(NEXT_BTN).boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport, '主动作与视口都必须有尺寸').toBeTruthy();
    expect(
      box!.y + box!.height <= viewport!.height,
      `主动作被挤出首屏：bottom=${Math.round(box!.y + box!.height)} viewport=${viewport!.height}`
    ).toBe(true);

    // 判据 5：参数区不得被裁剪，也不许自成滚动容器（嵌套滚动是上一版的真实缺陷）
    const layout = await page.locator(FOLD_BODY).evaluate((el) => {
      const body = el as HTMLElement;
      const scrollAncestors: string[] = [];
      let node: HTMLElement | null = body;
      while (node) {
        const style = getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) {
          scrollAncestors.push(node.className || node.tagName);
        }
        node = node.parentElement;
      }
      return {
        foldOverflowY: getComputedStyle(body).overflowY,
        clipped: body.scrollHeight > body.clientHeight + 1,
        scrollAncestors,
      };
    });
    expect(layout.foldOverflowY, '折叠区内容不许设 overflow-y（会切断参数卡片）').toBe('visible');
    expect(layout.clipped, '折叠区内容被裁剪：参数卡片看不全').toBe(false);
    expect(
      layout.scrollAncestors,
      `滚动只许由 .inspector-body 承担，实测 ${JSON.stringify(layout.scrollAncestors)}`
    ).toEqual(['inspector-body']);

    // 判据 2：收起 / 再展开
    await fold.locator('summary').click();
    await expect(fold, '点一次 summary 必须收起').not.toHaveAttribute('open', '');
    await fold.locator('summary').click();
    await expect(fold, '再点一次必须重新展开').toHaveAttribute('open', '');

    // 判据 3：收起后切步骤再回来，保持收起
    await fold.locator('summary').click();
    await expect(fold).not.toHaveAttribute('open', '');
    await gotoStage(page, 7);
    await gotoStage(page, 6);
    await expect(
      page.locator(FOLD),
      '收起状态必须在本次会话内保持（面板每次重渲染会重建 DOM）'
    ).not.toHaveAttribute('open', '');
  });
});