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

  // 前置：导出要求深度标定（未标定一律拒绝）。用与步骤 3 面板同款的两点标定建立它，
  // 否则本用例会卡在"导出被拒绝"，测不到"组斜率写完预览是否同步"这件事。
  await gotoStage(page, 3);
  await page.locator('#ycal-inp-top-px').fill('550');
  await page.locator('#ycal-inp-top-val').fill('0');
  await page.locator('#ycal-inp-bot-px').fill('1300');
  await page.locator('#ycal-inp-bot-val').fill('40');
  await page.locator('#btn-apply-ycalib').click();
  await expect
    .poll(
      async () => {
        const data = (await rpc(page, 'straditize.getDiagramData', {})) as {
          calibration?: { isCalibrated?: boolean };
        };
        return Boolean(data?.calibration?.isCalibrated);
      },
      { message: '前置：Y 轴两点标定必须生效', timeout: 20_000 }
    )
    .toBe(true);

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

    // 必须让列真的从图像取到数：本 spec 只关心"标定后预览是否需要刷新"，
    // 但预览的数据必须来自真实取数。此前这条用例是**靠旧的「等距采样造点」兜底**
    // 才有数（整列常数、每条读数都等于列左缘），那个兜底已按第一不变量删除，
    // 所以这里显式数字化前两列，让判据测的是"刷新同步"而不是"能不能造数"。
    // 场景必须有**真实取数**才谈得上"预览出数"。旧版靠后端"把列左缘当读数"的兜底
  // 才有数值（整列常数），那个兜底已按第一不变量删除；`core.digitize` 在本场景
  // 又取不到点（返回 0）。所以这里直接用控制点建立取数（控制点优先于数字化，
  // 与 `_ensure_export_column_points` 的回落顺序一致），再让组斜率生效。
  const scene = (await rpc(page, 'straditize.getDiagramData', {})) as {
    columns: Array<{ col_index: number; startX?: number | null; start?: number | null }>;
  };
  // **先数字化**：`update_control_point` 在未数字化的列上会被后端拒绝
  // （`-32001 Column N has not been digitized yet. Call core.digitize first.`），
  // 空点集则报「该列缺少可读点（点的 x 全为空）」。本基线（hoya + pollen ROI）
  // 数字化能真出点：实测每列 801 点、x 无 None，所以场景用 digitize 取数，
  // 控制点只是在此之上覆盖少数行。
  const digitizedCounts: number[] = [];
  for (const col of scene.columns.slice(0, 2)) {
    const res = (await rpc(page, 'core.digitize', { col_index: col.col_index })) as {
      points?: unknown[];
    };
    const n = res?.points?.length ?? 0;
    expect(
      n,
      `core.digitize 必须真的从图像取到点（列 ${col.col_index}），实际 ${n} 点`
    ).toBeGreaterThan(0);
    digitizedCounts.push(n);
  }

  const rowsToFill = [300, 360, 420, 480, 540, 600];
  for (const col of scene.columns.slice(0, 2)) {
    // 列左缘的正确字段是 **startX**（`straditize_core/rpc_methods/system.py:296`），
    // 不是 `start`。取错字段得到 `undefined` → `Number(undefined)` 是 `NaN` →
    // JSON 序列化成 `null` → 后端 `update_control_point` 的 `float(x)`
    // （`session_parts/digitize.py:430`）抛 `float() argument must be … not 'NoneType'`，
    // 冒成 -32603「后端算法执行异常」。所以这里显式取 `startX ?? start` 并断言有限，
    // 让红点落在"场景取不到列左缘"，而不是落在一个看不出所以然的后端 500 上。
    const left = Number(col.startX ?? col.start);
    expect(
      Number.isFinite(left),
      `列 ${col.col_index} 的左缘必须是有限数值（startX=${String(col.startX)}、start=${String(col.start)}），否则控制点的 x 会是 null`
    ).toBe(true);
    for (let i = 0; i < rowsToFill.length; i += 1) {
      await rpc(page, 'core.updateControlPoint', {
        col_index: col.col_index,
        row: rowsToFill[i],
        x: left + 5 + i * 3,
      });
    }
  }

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

    // 导出就绪前置：`computeExportReadiness`（ExportReadinessPanel.ts:23-34）把
    // `name_source === 'default'` 的 ROI **直接**列入未就绪清单，未就绪 ⇒ 预览 0 行。
    // 基线 ROI 名字虽叫 `pollen`，来源却是 default，所以这里按用户的动作显式命名一次，
    // 让 readiness 通过；否则本用例会红在"预览空表"，测不到"组斜率写完是否同步"。
    await rpc(page, 'roi.update', { roi_id: RID, name: 'pollen_usr' });
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const api = (window as unknown as { __straditize?: { rpc: Function } }).__straditize;
            const d = (await api!.rpc('straditize.getDiagramData')) as {
              rois: Array<{ id: string; name_source?: string }>;
            };
            return d.rois.every((r) => r.name_source === 'user');
          }),
        { message: '前置：ROI 必须已被用户命名（readiness 依赖 name_source）', timeout: 20_000 }
      )
      .toBe(true);

    // 判据①：预览的取数必须**只发生一次**。面板初始化会连触发多次 `updateFullDisplay`
    // （datasetSelect 赋值、排序/精度 change、末尾显式调用），旧实现让同一个数据集并发
    // 发两条 `export.csv`，并且 `displayToken` 会把先回来的有效结果丢掉 ⇒ 表格 0 行、
    // caption 空串。用 Node 侧计请求（页面内包 fetch 会改时序，不可用）。
    const csvCalls: string[] = [];
    page.on('request', (req) => {
      if (req.method() !== 'POST') return;
      const b = req.postData() ?? '';
      if (b.includes('"export.csv"')) csvCalls.push(b.slice(0, 120));
    });

    await openExport(page);

    // 预览表在面板打开后**异步**填充：`openExport` 只等到 `#wpd-preview-table` 这个
    // 壳子出现，而 `updateFullDisplay()` 里的取数（`extractRawMatrix`）→ `renderTableGrid()`
    // → `updateRowSetCaption()` 是之后才跑完的。旧版在这里同步读表，稳定读到 0 行，
    // 且 `#wpd-rowset-caption` 还是空串（实测 `{"caption":"","rows":0}`）——红点
    // 会被误读成"预览不出数"，其实是读得太早。这里等行集真正落地再断言内容。
    await expect
      .poll(() => page.locator('#wpd-preview-table tbody tr').count(), {
        message: '预览行集必须在面板打开后落地（异步取数）',
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    // 判据②：caption 必须非空且给出行数（"这些数从哪来"不能留白）。
    const caption = (await page.locator('#wpd-rowset-caption').innerText()).trim();
    expect(caption.length, '行集说明不得为空').toBeGreaterThan(0);
    expect(caption, `行集说明必须带行数，实际：${caption}`).toMatch(/\d+\s*行/);

    expect(
      csvCalls.length,
      `预览取数必须只发生一次，实际 ${csvCalls.length} 次（重复取数会把有效结果挤掉）`
    ).toBe(1);

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
