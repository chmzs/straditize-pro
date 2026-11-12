import { test, expect } from './fixtures';
import { gotoStage, openApp, rpc } from './helpers';

/**
 * 左栏列面板必须**跟随 active ROI**。
 *
 * 缺陷背景（hands-on ledger H-15）：两个分区时，把 active 切到空分区 roi_2，
 * 卡片写「roi_2 (0列)」，左栏却仍列着 roi_1 的 29 列 —— 后端 `columns[].roi_id` 正确，
 * 是前端只渲染一组、不订阅 active 变化。后果是用户在 A 分区界面里改名/点选，动的是 B 分区的列。
 *
 * 判据：左栏渲染的列数必须等于**后端记录的 active ROI 的列数**。
 */
test.describe('左栏列面板跟随 active ROI', () => {
  test('切到空分区后左栏不再渲染另一个分区的列；切回后恢复', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 2);

    // 基线：roi_1 有若干列；新建一个空分区 roi_2
    const d0 = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    const roi1 = (d0.rois ?? [])[0];
    expect(roi1, '基线应有 roi').toBeTruthy();
    const colsOfRoi1 = (d0.columns ?? []).filter((c: any) => !c.roi_id || c.roi_id === roi1.id);
    expect(colsOfRoi1.length, '基线 roi_1 应有列').toBeGreaterThan(0);

    const created = (await rpc(page, 'roi.create', {
      name: 'empty_roi',
      x0: Math.max(0, (d0.width ?? 2339) - 320),
      x1: (d0.width ?? 2339) - 120,
      y0: 200,
      y1: 600,
      composition: true,
    })) as any;
    const roi2Id = created.roi.id;

    // 切到空分区
    await rpc(page, 'roi.setActive', { roi_id: roi2Id });
    await page.reload();
    await openApp(page);
    await gotoStage(page, 2);

    const emptyCount = await page.locator('input.taxa-name-inline-input').count();
    expect(emptyCount, '切到 0 列的分区后，左栏不得再显示另一个分区的列').toBe(0);

    // 切回 roi_1
    await rpc(page, 'roi.setActive', { roi_id: roi1.id });
    await page.reload();
    await openApp(page);
    await gotoStage(page, 2);

    const backCount = await page.locator('input.taxa-name-inline-input').count();
    expect(backCount, '切回 roi_1 后左栏应恢复它的列').toBe(colsOfRoi1.length);
  });
});
