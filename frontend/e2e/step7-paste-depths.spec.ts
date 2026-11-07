/**
 * 步骤 7：**导入自定义深度** —— 走 `samples.pasteDepths` 落库，导出的行随之改变。
 *
 * ## 为什么钉这两条
 *
 * 1. 粘贴深度曾是"有能力没入口"：后端 `samples.pasteDepths` 完整（含未标定时的
 *    `-32001` 指路文案），前端却只把它写进 `calibration.customDepths` 这个**前端专属**
 *    字段——后端从不认识它，刷新即丢，导出也仍按"逐行点并集"出行。现在入口在步骤 7，
 *    写的是后端的 `samples`。
 * 2. 「取值按深度来」这句话要能被验证：断言导出 CSV 的 depth 列**就是**粘贴的三个数，
 *    而不是默认并集（后者动辄几百行）。
 */

import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

interface SamplesList {
  samples: Array<{ row_px: number; depth: number | null; source: string }>;
}

/**
 * 读**后端**的 samples（`samples.list`），不是载荷里的 `data.samples`——
 * 后者是 client-owned 字段（由采样共识那条 RPC 单独返回），getDiagramData 不下发。
 */
async function pastedSamples(page: import('@playwright/test').Page) {
  const listed = await rpc<SamplesList>(page, 'samples.list');
  return (listed.samples ?? []).map((s) => [Math.round(Number(s.depth)), s.source]);
}

test.describe('步骤 7：导入自定义深度', () => {
  test('粘贴深度 → 落库成 samples(paste) → 导出的行由这些深度决定', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 7);
    // 先把 Y 轴标定成 0..150cm（row 511..1311），否则 pasteDepths 会按 -32001 拒绝。
    await rpc(page, 'core.calibrateAxes', {
      y_marks: [
        { pixel: 511, val: 0 },
        { pixel: 1311, val: 150 },
      ],
      unit: 'cm',
    });
    await rpc(page, 'samples.set', { samples: [] });

    const button = page.locator('#btn-paste-depths');
    await expect(button, '步骤 7 必须有「导入自定义深度」的入口').toBeVisible();
    await button.click();

    await page.locator('#txt-paste-depths').fill('20\n40\n60');
    await page.locator('#btn-confirm-paste').click();

    await expect
      .poll(() => pastedSamples(page), { timeout: 15_000 })
      .toEqual([
        [20, 'paste'],
        [40, 'paste'],
        [60, 'paste'],
      ]);

    // 取值/出行：导出 CSV 的 depth 列必须就是这三个深度
    const exported = await rpc<{ csv: string }>(page, 'core.exportData', { format: 'csv' });
    const depths = exported.csv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => Number(line.split(',')[0]));
    expect(depths, '导出的行必须由粘贴的深度决定，而不是默认的逐行点并集').toEqual([20, 40, 60]);
  });
});
