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
 * 5. 折叠区内容**限高 + 内部滚动**：内容超过上限时 `clientHeight <= 132`（限高生效），
 *    不是把整块撑开。
 *
 * ## 反向验证
 *
 * - 把 `INITIAL_XTICKS_STATE.groupsFoldOpen` 改回 `false` → 判据 1 红；
 * - 删掉 `mount()` 里 `details.toggle` 的回写 → 判据 3 红；
 * - 去掉 `position: sticky` → 判据 4 红（实测未粘住时 button bottom 790 > 720）；
 * - 去掉折叠区的 `max-height` → 判据 5 红（实测限高前 foldBody clientHeight = 198）。
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

    // 判据 5：折叠区限高 + 内部滚动（内容超限时窗口不超过上限）
    const foldBody = await page.locator(FOLD_BODY).evaluate((el) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
    }));
    expect(foldBody.client, `折叠区内容窗口必须限高（实测 ${foldBody.client}px）`).toBeLessThanOrEqual(133);
    if (foldBody.scroll > foldBody.client) {
      expect(foldBody.scroll, '限高时内容应可内部滚动').toBeGreaterThan(foldBody.client);
    }

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