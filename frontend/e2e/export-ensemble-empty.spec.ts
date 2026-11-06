/**
 * 导出弹窗：集成表**空态**必须给出可见理由。
 *
 * ## 判据为什么这么写
 *
 * `ensemble.list` 为空时，勾选框会被禁用——这是对的。但如果连"为什么禁用"都不显示，
 * 用户面对的就是一个看得见、永远灰着、没有解释的选项。原来正是这样：提示文案
 * 「暂无原生或导入集成表」写在一个被 `display='none'` 的容器里，等于没写。
 *
 * 而原生集成表只有跑年代模型（依赖 R）才会产生，所以在没装 R 的机器上，
 * 这个空态是**常态**而不是边界情况。
 *
 * 断言两件事：勾选框禁用、且理由**可见**（不是存在于 DOM 里）。
 */

import { expect, test } from './fixtures';
import { resetBaseline } from './helpers';

test.describe('导出弹窗：集成表空态', () => {
  test('没有集成表时，勾选框禁用且理由可见', async ({ page }) => {
    await resetBaseline(page);

    await page.locator('#btn-export-csv').click();
    await expect(page.locator('.wpd-export-dialog')).toBeVisible();

    const checkbox = page.locator('#chk-export-ensemble');
    await expect(checkbox, '没有集成表就必须禁用，不能让用户勾一个无效选项').toBeDisabled();

    const hint = page.locator('#ensemble-list-hint');
    await expect(hint, '禁用必须说明理由，否则用户只能猜').toBeVisible();
    await expect(hint).toHaveText(/暂无/);
  });
});
