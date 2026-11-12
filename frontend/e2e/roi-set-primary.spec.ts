import { test, expect } from './fixtures';
import { gotoStage, openApp, rpc } from './helpers';

/**
 * 「设为主」必须真的把 `primary_roi_id` 改到后端。
 *
 * 独立黑盒复核实测：点击后 `[rpc] primary` 仍是旧值。若成立，影响的是 `data.csv`
 * 到底是哪个分区——属于会改变交付数据含义的操作，必须钉住。
 */
test.describe('设为主 ROI', () => {
  test('点「设为主」后后端 primary_roi_id 必须换成该 ROI', async ({ page }) => {
    await openApp(page);
    await gotoStage(page, 2);

    const before = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    const rois = (before.rois ?? []) as any[];
    expect(rois.length).toBeGreaterThanOrEqual(1);

    // 造第二个 ROI（不依赖 UI 框选，避免把造场失败当成产品缺陷）
    await rpc(page, 'roi.create', {
      name: 'probe_primary',
      x0: 300,
      x1: 700,
      y0: 200,
      y1: 600,
      composition: false,
    });
    await page.reload();
    await openApp(page);
    await gotoStage(page, 2);

    const mid = (await rpc(page, 'straditize.getDiagramData', {})) as any;
    const target = (mid.rois ?? []).find((r: any) => r.name === 'probe_primary');
    expect(target, '新 ROI 必须存在').toBeTruthy();
    expect(mid.primary_roi_id ?? mid.primaryRoiId, '前置：主 ROI 此时不应已经是 probe_primary').not.toBe(target.id);

    const btn = page.locator(`.btn-set-primary[data-roi-id="${target.id}"]`);
    await expect(btn, '「设为主」按钮必须可见').toBeVisible({ timeout: 10_000 });
    await btn.click();

    await expect
      .poll(
        async () => {
          const d = (await rpc(page, 'straditize.getDiagramData', {})) as any;
          return d.primary_roi_id ?? d.primaryRoiId;
        },
        { message: '点「设为主」后后端 primary_roi_id 必须变', timeout: 15_000 }
      )
      .toBe(target.id);
  });
});
