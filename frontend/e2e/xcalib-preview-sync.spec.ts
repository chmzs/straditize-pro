/**
 * B：组斜率 X 标定写完之后，**不刷新页面**导出预览就必须出数。
 *
 * ## 这是用户原始抱怨的另一半
 *
 * 用户在步骤 6「点一个刻度齿 → 填数字 → 应用」之后，界面提示"已标定 · 0.1613 %/px"，
 * 但打开导出面板看到的却是整表 NA —— 因为标度写入**没有触发前端回填**：
 *
 *   XTicksPanel.ts:743  patchGroup({ value_per_px })
 *   XTicksPanel.ts:609  client.roiGroupUpdate(roiId, gid, field)
 *   RpcClient.ts:1165   roiGroupUpdate → this.call('roi.groupUpdate', …)   ← 无 notifyScaleMutated
 *
 * `app/scaleSync.ts` 只在 `RpcClient.notifyScaleMutated()` 之后才去拉权威数据、
 * 回填 `scale_provenance`。所以 `CoordinateSystem.resolveColumnScale` 仍按
 * "没有 provenance → 看 x_ticks" 判定，而组斜率写入恰恰会把 `x_ticks` 清成 null
 * ⇒ 预览整表 `UNCALIBRATED_NA`。用户只能靠刷新页面（工程包重开/重载）才能看到数。
 *
 * ## 本用例怎么避免"测到别的东西"
 *
 * - 用**与 UI 同款的那条 RPC** 写入（`roi.groupUpdate{value_per_px}`），不碰后端直连；
 * - **全程不导航、不重载、不开工程包** —— 一旦允许导航，`ProjectManager.hydrateScaleProvenance`
 *   那条路也会让预览出数，就测不出"写完有没有通知"了；
 * - 判据是预览表里真的出现数值（`finite ≥ 100`、`max > 1`），且**没有任何一格是 `NA`**。
 */
import { expect, test, type Page } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

const RID = 'roi_1';
const GID = 'roi_1_grp1';
const SLOPE = 0.16129;

interface PreviewTable {
  headers: string[];
  rows: string[][];
}

/** 读预览表：数值格读 `<input class="wpd-cell-input">.value`，深度格读文本。 */
async function readPreview(page: Page): Promise<PreviewTable> {
  return page.evaluate(() => {
    const table = document.querySelector('#wpd-preview-table');
    if (!table) throw new Error('找不到导出预览表格');
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
      (th.textContent ?? '').trim()
    );
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td'))
        .filter((td) => !td.classList.contains('col-row-num'))
        .map((td) => {
          const input = td.querySelector('input');
          return (input ? (input as HTMLInputElement).value : (td.textContent ?? '')).trim();
        })
    );
    return { headers, rows };
  });
}

async function openExport(page: Page): Promise<void> {
  await page.locator('#btn-export-csv').click();
  await expect
    .poll(() => page.evaluate(() => Boolean(document.querySelector('#wpd-preview-table'))), {
      message: '导出面板必须打开',
      timeout: 20_000,
    })
    .toBe(true);
}

test.describe('B 组斜率标定后，不刷新页面导出预览也必须出数', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('写完 value_per_px 不导航：预览必须有真实读数、且一格 NA 都没有', async ({ page }) => {
    test.setTimeout(120_000);
    await gotoStage(page, 6);

    // 与 UI 同款写入（`XTicksPanel.patchGroup` → `roiGroupUpdate` → `roi.groupUpdate`）。
    await rpc(page, 'roi.groupUpdate', {
      roi_id: RID,
      group_id: GID,
      updates: { value_per_px: SLOPE },
    });

    // 后端必须已经认这条标定（前置，不是判据）。
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (window as unknown as { __straditize?: { rpc: Function } }).__straditize;
            const d = (await api!.rpc('straditize.getDiagramData')) as {
              columns: Array<{ scale_provenance?: { calibrated?: boolean } }>;
            };
            return d.columns.every((c) => c.scale_provenance?.calibrated === true);
          }),
        { message: '后端必须认所有列已标定', timeout: 20_000 }
      )
      .toBe(true);

    // 给 `scaleSync` 的 120ms 防抖 + 一次 getDiagramData 留出时间；这里只是等待，
    // 判据在下面的预览表上。
    // 等待前端回填（最多 8s）。**这里刻意不判失败**：回填没发生正是本缺陷本身，
    // 判据统一留给下面的预览断言，好让红灯落在"预览是 NA"这个用户症状上，
    // 而不是落在"面板文案没更新"这个中间步骤上。
    await expect
      .poll(() => page.locator('.step-panel[data-step="6"]').innerText(), { timeout: 8_000 })
      .toContain('已标定')
      .catch(() => undefined);

    await openExport(page);
    const preview = await readPreview(page);
    const valueCells = preview.rows.flatMap((row) => row.slice(1));
    expect(valueCells.length, '预览必须有数值单元格').toBeGreaterThan(0);

    const naCount = valueCells.filter((cell) => cell === 'NA').length;
    expect(
      naCount,
      `标定完的列不得再写 NA（共 ${valueCells.length} 格，NA ${naCount} 格）——` +
        '用户在步骤 6 已经看到"已标定"，导出预览却整表 NA 就是这个缺陷'
    ).toBe(0);

    const finite = valueCells
      .map((cell) => Number.parseFloat(cell))
      .filter((v) => Number.isFinite(v));
    expect(
      finite.length,
      `预览必须真的有数（有限数值格 ${finite.length}，要求 ≥100）`
    ).toBeGreaterThanOrEqual(100);
    expect(Math.max(...finite, 0), '预览里必须出现 >1 量级的读数').toBeGreaterThan(1);
  });
});
