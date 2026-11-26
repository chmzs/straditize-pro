/**
 * #172 / #156 UI 回归门禁：
 * - #172：步骤 3 浏览四个轴类型按钮（不点「应用标定」）不得写后端 unit 与 primary_axis；
 * - #156：步骤 7 网格生成后点行锁，samples.list 长度不得减少。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc, waitForDiagram } from './helpers';

test.describe('#172 & #156：状态机安全门禁', () => {
  test('#172 连点四个轴类型按钮但不点应用标定，core.getStatus 单位与轴名不变', async ({
    page,
  }) => {
    await resetBaseline(page);
    await rpc(page, 'core.calibrateAxes', {
      y_marks: [
        { pixel: 511, val: 0 },
        { pixel: 1311, val: 1500 },
      ],
      unit: 'cal yrBP',
      primary_axis: 'age',
    });
    await page.reload();
    await waitForDiagram(page);
    await gotoStage(page, 3);

    const before = await rpc<{ unit?: string; primary_axis?: string }>(page, 'core.getStatus', {});

    for (const type of ['depth', 'code', 'custom', 'age'] as const) {
      await page.locator(`.btn-ytype-select[data-type="${type}"]`).click();
    }
    await page.waitForTimeout(300);

    const after = await rpc<{ unit?: string; primary_axis?: string }>(page, 'core.getStatus', {});
    expect(after.unit).toBe(before.unit);
    expect(after.primary_axis).toBe(before.primary_axis);
  });

  test.describe('#156 网格生成与行锁', () => {
    test.use({ allowlists: { notice: [/已生成 \d+ 个层位/] } });

    test('#156 等距网格生成后点行锁，samples.list 长度不得减少', async ({ page }) => {
    await resetBaseline(page);
    await rpc(page, 'core.calibrateAxes', {
      y_marks: [
        { pixel: 511, val: 0 },
        { pixel: 1311, val: 100 },
      ],
      unit: 'cm',
      primary_axis: 'depth',
    });
    await rpc(page, 'samples.set', {
      samples: [
        { row_px: 600, depth: 10, source: 'manual' },
        { row_px: 700, depth: 20, source: 'manual' },
      ],
    });
    await page.reload();
    await waitForDiagram(page);
    await gotoStage(page, 7);

    // 展开等距网格折叠区并生成（步长 10 cm → 11 层位）
    await page.locator('#input-grid-step').evaluate((el) => {
      const details = el.closest('details');
      if (details) details.open = true;
    });
    await page.locator('#input-grid-step').fill('10');
    await page.locator('#btn-grid-samples').click();
    // 确认替换既有 2 条采样层位
    const confirmBtn = page.locator('.ui-confirm-ok, button:has-text("确认"), button:has-text("确定")').last();
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await confirmBtn.click();
    }

    await expect
      .poll(async () => (await rpc<{ count: number }>(page, 'samples.list', {})).count, {
        timeout: 15_000,
      })
      .toBeGreaterThan(2);

    const countAfterGrid = (await rpc<{ count: number }>(page, 'samples.list', {})).count;

    // 等待 UI 完成网格层位列表渲染后再点第一行的行锁按钮
    const lockBtns = page.locator('.btn-toggle-lock-sample');
    await expect(lockBtns).toHaveCount(countAfterGrid, { timeout: 10_000 });
    await lockBtns.first().click();
    await page.waitForTimeout(500);

    const afterLock = await rpc<{ count: number; samples: Array<{ locked?: boolean }> }>(
      page,
      'samples.list',
      {}
    );
    expect(afterLock.count).toBe(countAfterGrid);
    expect(afterLock.samples[0]?.locked).toBe(true);
    });
  });
});
