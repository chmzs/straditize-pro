/**
 * 导出面板的 CSV 必须与后端 `export.csv` 逐格同值（三种 dataset 各一条）。
 *
 * ## 缺陷（发布阻断）
 *
 * 面板预览与面板 CSV 都由**前端** `SplineInterpolator` 在 `controlPoints` 上插值造出来，
 * 而后端 `export.csv` / 工程包 `data.csv` 走 `column_points` + `y_scale`。
 * 同一会话同一层位，两条链给出两套数（实测 1.63 vs 19.1935，比例逐格不同），
 * 于是"面板里看到的数"≠"用户下载到的数"。
 *
 * ## 判据
 *
 * 同一会话、同一 dataset：
 *   面板 CSV（`#wpd-data-textarea`，即 `#btn-wpd-download-csv` 写进 Blob 的那段文本）
 *   == 后端 `export.csv{dataset}` 返回的 CSV（表头 + 每一格，NaN 归一后）。
 *
 * 修好后两者应当**逐格相等**；修复前必然红（两套数）。
 */
import { expect, test, type Page } from './fixtures';
import { backendRpc, diagramData, gotoStage, resetBaseline, rpc } from './helpers';

const RID = 'roi_1';
const GID = 'roi_1_grp1';
const SLOPE = 0.16129;
const DATASETS = ['union_points', 'depth_grid', 'turning_points'] as const;

interface Matrix {
  headers: string[];
  rows: string[][];
}

/** 步骤 3：Y 标定（200px↔0cm / 600px↔40cm），等后端确认。 */
async function calibrateDepth(page: Page): Promise<void> {
  await gotoStage(page, 3);
  await page.evaluate(() => {
    const pairs: Array<[string, string]> = [
      ['#ycal-inp-unit', 'cm'],
      ['#ycal-inp-top-px', '200'],
      ['#ycal-inp-bot-px', '600'],
      ['#ycal-inp-top-val', '0'],
      ['#ycal-inp-bot-val', '40'],
    ];
    for (const [sel, v] of pairs) {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (el) el.value = v;
    }
    (document.querySelector('#btn-apply-ycalib') as HTMLButtonElement | null)?.click();
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const api = (window as unknown as { __straditize?: { rpc: Function } }).__straditize;
          const d = (await api!.rpc('straditize.getDiagramData')) as {
            calibration: { isCalibrated: boolean };
          };
          return d.calibration.isCalibrated;
        }),
      { message: 'Y 标定必须落后端', timeout: 15_000 }
    )
    .toBe(true);
}

/** 面板当前显示的 CSV 文本（= 点「CSV」下载时写进 Blob 的那段）。 */
async function panelCsv(page: Page): Promise<string> {
  return page.locator('#wpd-data-textarea').inputValue();
}

/** 后端权威 CSV（与顶栏导出、工程包 data.csv 同一入口）。 */
async function backendCsv(page: Page, dataset: string): Promise<string> {
  const res = await backendRpc<unknown>(page, 'export.csv', { dataset });
  return typeof res === 'string' ? res : ((res as { csv?: string }).csv ?? '');
}

/** 解析 CSV 文本为矩阵；数字按 6 位有效数字归一，`NaN`/`nan` 统一成 `NaN`。 */
function parseCsv(text: string): Matrix {
  const lines = text.trim().split(/\r?\n/);
  const norm = (cell: string): string => {
    const raw = cell.trim().replace(/^"|"$/g, '');
    // 只对"看起来是数字"的格子做数值归一；表头（taxon 名）必须原样比较，
    // 否则 `depth`/`col01` 会被 parseFloat 成 NaN，表头差异永远显示不出来。
    if (!/^[-+]?(\d|\.\d)/.test(raw)) return raw;
    const num = Number.parseFloat(raw);
    if (!Number.isFinite(num)) return 'NaN';
    return String(Number(num.toPrecision(6)));
  };
  return {
    headers: lines[0].split(',').map(norm),
    rows: lines.slice(1).map((line) => line.split(',').map(norm)),
  };
}

/** 两矩阵逐格比较，返回 'same' 或第一处差异的可读描述（便于红灯直接定位）。 */
function diffMatrix(panel: Matrix, backend: Matrix): string {
  if (panel.headers.join('|') !== backend.headers.join('|')) {
    return `表头不同：面板 [${panel.headers.slice(0, 4).join(',')}] vs 后端 [${backend.headers
      .slice(0, 4)
      .join(',')}]`;
  }
  if (panel.rows.length !== backend.rows.length) {
    return `行数不同：面板 ${panel.rows.length} vs 后端 ${backend.rows.length}`;
  }
  for (let r = 0; r < panel.rows.length; r++) {
    for (let c = 0; c < panel.headers.length; c++) {
      if ((panel.rows[r][c] ?? '') !== (backend.rows[r][c] ?? '')) {
        return `首个差异 (行 ${r + 1}, 列 ${panel.headers[c]})：面板 ${panel.rows[r][c]} vs 后端 ${backend.rows[r][c]}`;
      }
    }
  }
  return 'same';
}

/**
 * 该 dataset 按其**定义**应有的行数（用 `getDiagramData` 的权威数据算，不看面板）。
 *
 * 这条是防"两边一起缩水"的：只断言面板 == 后端，把两边都做成 3 行 samples 也能过。
 */
async function expectedRowCount(page: Page, dataset: string): Promise<number> {
  const d = await diagramData<{
    columns: Array<{ controlPoints?: Array<{ y: number }> }>;
    calibration: { top_cm: number | null; bottom_cm: number | null; depthInterval?: number };
  }>(page);
  const points = d.columns.flatMap((c) => c.controlPoints ?? []);
  if (dataset === 'union_points') {
    return new Set(points.map((p) => Math.round(p.y))).size;
  }
  if (dataset === 'turning_points') {
    return points.length;
  }
  const top = d.calibration.top_cm ?? 0;
  const bottom = d.calibration.bottom_cm ?? 0;
  const step = d.calibration.depthInterval ?? 2;
  const lo = Math.min(top, bottom);
  const hi = Math.max(top, bottom);
  return Math.round((hi - lo) / step) + 1;
}

for (const dataset of DATASETS) {
  test(`dataset=${dataset}：面板 CSV 必须与后端 export.csv 逐格同值`, async ({ page }) => {
    test.setTimeout(150_000);
    await resetBaseline(page);
    // samples 与「控制点并集」故意不同，让两种行源可区分。
    await backendRpc(page, 'samples.set', {
      samples: [
        { row_px: 513, depth: 31.3, source: 'manual' },
        { row_px: 520, depth: 32.0, source: 'manual' },
        { row_px: 540, depth: 34.0, source: 'manual' },
      ],
    });
    await gotoStage(page, 6);
    await rpc(page, 'roi.groupUpdate', {
      roi_id: RID,
      group_id: GID,
      updates: { value_per_px: SLOPE },
    });
    await calibrateDepth(page);

    await page.locator('#btn-export-csv').click();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.querySelector('#wpd-preview-table'))), {
        message: '导出面板必须打开',
        timeout: 20_000,
      })
      .toBe(true);

    await page.locator('#wpd-dataset-select').selectOption(dataset);
    await expect(page.locator('#wpd-dataset-select')).toHaveValue(dataset);

    // 等面板文本真的重算到该 dataset（避免读到上一 dataset 的残留）。
    await expect
      .poll(async () => (await panelCsv(page)).length, {
        message: `dataset=${dataset} 的面板文本必须重算`,
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    await expect
      .poll(
        async () => diffMatrix(parseCsv(await panelCsv(page)), parseCsv(await backendCsv(page, dataset))),
        {
          message: `dataset=${dataset}：面板 CSV 与后端 export.csv 必须逐格同值`,
          timeout: 20_000,
        }
      )
      .toBe('same');

    // 行数必须符合该 dataset 的**定义**，不能"两边一起缩水"。
    const panelRows = parseCsv(await panelCsv(page)).rows.length;
    expect(
      panelRows,
      `dataset=${dataset} 的行数必须符合其定义（若塌成 samples 的 3 行，就是语义回归）`
    ).toBe(await expectedRowCount(page, dataset));
  });
}
