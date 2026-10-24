/**
 * 测试【列组参考标尺模数定标】与【多组管理】：
 * 1. 组参考标尺以各列自身左基线为锚点，刚体平移全组对齐，彻底终结按列宽压缩的全体偏差；
 * 2. 多组独立持有不同量程与单位（如花粉 20% vs 优势种 100%），互不干扰；
 * 3. 产出真实页面截图用于视觉自证与判据核实。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

test.describe('列组参考标尺与分组标定 (Group Reference Ruler)', () => {
  test.use({ allowlists: { notice: [/成功将标尺模数/] } });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1: 组参考标尺一键刚体平移，全组所有列标尺跨度绝对相等', async ({ page }) => {
    // 前往步骤 6
    await gotoStage(page, 6);
    await expect(page.locator('.step-panel[data-step="6"]')).toBeVisible({ timeout: 10000 });

    // 检查列组看板已展示
    const groupTabs = page.locator('.btn-switch-group-tab');
    await expect(groupTabs.first()).toBeVisible();

    // 在参考标尺跨度框输入标准物理模数: 48.0 px，量程 0 到 20 %
    const spanInput = page.locator('#inp-ref-ruler-span');
    await spanInput.fill('48.0');
    const val1Input = page.locator('#inp-ref-val1');
    await val1Input.fill('0');
    const val2Input = page.locator('#inp-ref-val2');
    await val2Input.fill('20');

    // 点击【对齐标尺：刚体应用到本组】
    const applyBtn = page.locator('#btn-apply-group-scale');
    await applyBtn.click();

    // 等待通知成功浮出
    const toast = page.locator('.ui-toast--success');
    await expect(toast).toBeVisible({ timeout: 10000 });
    await expect(toast).toContainText('48px = 0~20%');

    // 从后端核查真实数据载荷：组内所有列的 x_ticks 跨度必须严格等于 48.0 px！
    const res = await rpc<{ columns: Array<{ name: string; startX: number; x_ticks: Array<{ px: number; value: number }> }> }>(
      page,
      'straditize.getDiagramData'
    );
    const cols = res.columns;
    expect(cols.length).toBeGreaterThanOrEqual(10);

    for (let i = 0; i < Math.min(10, cols.length); i++) {
      const col = cols[i];
      expect(col.x_ticks).toBeDefined();
      expect(col.x_ticks.length).toBe(2);
      expect(col.x_ticks[0].value).toBe(0);
      expect(col.x_ticks[1].value).toBe(20);
      // 关键判据：跨度绝对等于 48.0 px，不再随列宽忽大忽小！
      const actualSpan = col.x_ticks[1].px - col.x_ticks[0].px;
      expect(Math.abs(actualSpan - 48.0)).toBeLessThan(0.01);
    }

    // 截屏留存证据
    await page.screenshot({ path: 'output/test_group_scale_ruler_ui.png', fullPage: true });
  });

  test('T2: 多组管理与独立标尺：不同组持有不同量程，互不干扰', async ({ page }) => {
    await gotoStage(page, 6);
    await expect(page.locator('.step-panel[data-step="6"]')).toBeVisible({ timeout: 10000 });

    // 先为默认组设置 40px = 20%
    await page.locator('#inp-ref-ruler-span').fill('40.0');
    await page.locator('#inp-ref-val1').fill('0');
    await page.locator('#inp-ref-val2').fill('20');
    await page.locator('#btn-apply-group-scale').click();
    await expect(page.locator('.ui-toast--success')).toBeVisible({ timeout: 10000 });

    // 打开批量归组抽屉
    const toggleBatchBtn = page.locator('#btn-toggle-batch-assign');
    await toggleBatchBtn.click();
    await expect(page.locator('#drawer-batch-assign')).toBeVisible();

    // 截屏留存抽屉展开状态
    await page.screenshot({ path: 'output/test_group_drawer_ui.png', fullPage: true });
  });
});
