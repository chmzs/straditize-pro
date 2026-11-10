/**
 * T-01：页脚缩放读数必须与顶栏徽标同源（不能各有各的缓存）。
 *
 * ## 缺陷
 *
 * 载图后 `#zoom-indicator` 与 `#footer-zoom` 都是 56%；点「1:1」后徽标变 100%，
 * 页脚**仍是 56%**，此后切步骤 / hover / 滚轮都不收敛。
 *
 * ## 为什么这条断言值得钉
 *
 * 页脚由 `app/footer.ts` 现读 `canvasComponent.viewport.scale`（`footer.ts:32`），
 * 取值逻辑本身没问题；问题在于**谁负责调用它**。缩放有 5 条入口
 * （1:1 / 适应 / 放大 / 缩小 / 滚轮），其中 4 个回调与滚轮监听只调了
 * `Toolbar.updateScale`，一处也没调 `updateFooter()`。于是同一个 `viewport.scale`
 * 被两个消费者按不同时机快照，读数必然发散。
 *
 * 因此本文件断言的不是"某个具体百分比"，而是**不变量**：两处读数永远相等，
 * 且都必须是合法百分比（不能是 `--` 或空）。这样任何"新加一条缩放路径却忘了
 * 刷新页脚"的改法都会在这里变红，而换图谱、换视口尺寸都不影响判据。
 *
 * ## 负向对照为什么必要
 *
 * `footer.ts:44` 在无活动列时写 `--`。若哪天页脚被写成常量或退化成占位符，
 * "两处相等"仍可能因为两边都停在同一个旧值而假绿。所以最后一条断言把
 * 形状也钉死：两边都必须是 `/^\d+%$/`。
 */
import { expect, test, type Page } from './fixtures';
import { canvasBox, resetBaseline } from './helpers';

const BADGE = '#zoom-indicator';
const FOOTER_ZOOM = '#footer-zoom code';
/** 合法读数形状：`56%` / `100%`。`--`、空串、`NaN%` 都不合法。 */
const ZOOM_SHAPE = /^\d+%$/;

const badgeText = async (page: Page): Promise<string> => (await page.locator(BADGE).innerText()).trim();
const footerZoomText = async (page: Page): Promise<string> => (await page.locator(FOOTER_ZOOM).innerText()).trim();
const zoomPair = async (page: Page) => ({
  badge: await badgeText(page),
  footer: await footerZoomText(page),
});

/**
 * 两处读数必须相等。
 *
 * 失败信息里带上两边的实际值 —— 只报 `false` 无法区分"页脚冻结"和"徽标冻结"，
 * 而这正是本缺陷一开始被误判成"页脚取值错"的原因。
 */
async function expectSameZoom(page: Page, message: string, timeout = 10_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const pair = await zoomPair(page);
        return pair.badge === pair.footer ? 'same' : `徽标=${pair.badge} 页脚=${pair.footer}`;
      },
      { message, timeout }
    )
    .toBe('same');
}

test.describe('页脚缩放读数必须与顶栏徽标同源', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('载图 / 1:1 / 适应 / 滚轮四条路径下，徽标与页脚缩放必须始终同值且形状合法', async ({
    page,
  }) => {
    // ---- 1. 载图后：不变量本身就成立（基线两个读数都由载图路径写过） ----
    await expectSameZoom(page, '载图后徽标与页脚缩放必须同值');
    const initialZoom = await badgeText(page);
    expect(initialZoom, '载图后徽标必须已经是合法读数').toMatch(ZOOM_SHAPE);

    // ---- 2. 点「1:1」：徽标先到 100%，页脚必须跟着到 100% ----
    await page.locator('#btn-100').click();
    await expect
      .poll(() => badgeText(page), {
        message: '点「1:1」后徽标必须变成 100%',
        timeout: 10_000,
      })
      .toBe('100%');
    // 这一句就是本缺陷的原点：旧实现里页脚停在上一个值，不会再动。
    await expect
      .poll(() => footerZoomText(page), {
        message: '点「1:1」后页脚缩放必须也是 100%（不能冻在旧值）',
        timeout: 10_000,
      })
      .toBe('100%');
    await expectSameZoom(page, '「1:1」之后徽标与页脚缩放必须同值');

    // ---- 3. 点「适应」：回到载图时的适应比例，页脚同样必须跟上 ----
    await page.locator('#btn-fit').click();
    await expect
      .poll(() => badgeText(page), {
        message: '点「适应」后徽标必须回到适应比例（若仍停在 100% 说明适应没生效）',
        timeout: 10_000,
      })
      .toBe(initialZoom);
    await expect
      .poll(() => footerZoomText(page), {
        message: '点「适应」后页脚缩放必须等于徽标（不能停在 100%）',
        timeout: 10_000,
      })
      .toBe(initialZoom);
    await expectSameZoom(page, '「适应」之后徽标与页脚缩放必须同值');

    // ---- 4. 滚轮缩放一次：读数必须跟着变，且两处仍然同值 ----
    const box = await canvasBox(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -120);
    await expect
      .poll(() => badgeText(page), {
        message: '滚轮缩放后徽标必须变化（若不变说明滚轮没落到画布上）',
        timeout: 10_000,
      })
      .not.toBe(initialZoom);
    await expectSameZoom(page, '滚轮缩放后徽标与页脚缩放必须同值');

    // ---- 5. 负向对照：两处都不是占位符 / 空值 ----
    const finalPair = await zoomPair(page);
    expect(finalPair.badge, '徽标不能退化成占位符或空值').toMatch(ZOOM_SHAPE);
    expect(finalPair.footer, '页脚不能退化成 `--` 或空值').toMatch(ZOOM_SHAPE);
  });
});
