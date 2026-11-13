/**
 * U-ROWS-01：导出面板里「预览」与「下载」必须是同一个行集，且预览里的数值必须对得上后端。
 *
 * ## 缺陷（用户实测）
 *
 * 预览默认数据集是**所有列控制点 y 的并集**，而 CSV / XLSX / LiPD / TAR 四个下载按钮走
 * 后端 `export.csv` 等，后端按 **`samples` 采样层位**出表。用户看到"预览 125 行、下载
 * 35 行"，选择器还标着「推荐」，界面一个字都没说。
 *
 * ## 本文件的两类判据，各自能证明什么、不能证明什么
 *
 * **A. 同源钉子**（行数 / 表头 / 前 5 行逐格相等，下载物 vs 预览表）
 *   能证明：下载的就是用户眼前这张表（选择器同时控制两者）。
 *   不能证明：数值本身算得对 —— 两边一起错时它照样绿。**它只是同源，不是正确性门禁。**
 *
 * **B. 数值判据**（预览 vs 后端 `core.extractGridValues` 同 (列, 层位) 比对）
 *   这条才抓得到"前端把百分比算错"：把预览的 depth 列原样传给后端，让后端在同一批
 *   层位上算一遍，再逐格比。因为 depths 由本用例显式给出，**不存在两套网格对不齐**的
 *   问题（不需要取交集）；唯一排除的是两类根本不可比的格子，见下。
 *
 * ## 为什么现场必须先做 X 标定
 *
 * 只做 Y 标定的现场，每列 `hasRealCalibration=false`，`ExportModal` 会把**每一格**
 * 写成 `UNCALIBRATED_NA`。那样 A 判据比的是 `"NA" == "NA"`（同义反复），B 判据也
 * 一格都比不了 —— 这是上一版用例被 Verifier 判死的直接原因，所以本文件第一步就用
 * 组斜率（`x_groups[].value_per_px`，与 `step6-group-slope.spec.ts` 同一路）把
 * 数值造出来，并显式断言"现场确有 ≥100 个有限数值格、max>1"。
 *
 * ## 两类被排除的格子（保守选择，宁可少比也不假绿）
 *
 * 1. 后端给 `null`：未标定列，后端自己不出数，无从比较；
 * 2. 预览是 `0`：`ExportModal` 把"该层位没插值到"写成 `naStr`（默认 `0.0`），
 *    与"真的读到 0%"在表格里不可区分。控制点范围之外（后端用 np.interp 端点钳制、
 *    前端不给值）正是这种情况 —— 排除零值后比较的是明确有墨迹的格子。
 *    代价：若前端把整表写成 0.00，可比的格子数会掉到 0，被判据的 `≥100` 兜住。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import { backendRpc, gotoStage, resetBaseline, rpc } from './helpers';

const RID = 'roi_1';
const GID = 'roi_1_grp1';
/** 组斜率（与 `step6-group-slope.spec.ts` 同量级），让每列真的有百分比读数。 */
const SLOPE = 0.16129;

/** 比对容差：两侧都按 2 位小数取整，留一个舍入位。 */
const VALUE_TOL = 0.02;

interface PreviewTable {
  headers: string[];
  rows: string[][];
}

/** 步骤 3：填两个像素行 + 两个数值，点一次「应用」，等后端确认。 */
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
    for (const [selector, value] of pairs) {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error(`标定面板缺少控件 ${selector}`);
      el.value = value;
    }
    (document.querySelector('#btn-apply-ycalib') as HTMLButtonElement | null)?.click();
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const api = (window as unknown as { __straditize?: { rpc: Function } }).__straditize;
          const data = (await api!.rpc('straditize.getDiagramData')) as {
            calibration: { isCalibrated: boolean };
          };
          return data.calibration.isCalibrated;
        }),
      { message: 'Y 标定必须落到后端', timeout: 15_000 }
    )
    .toBe(true);
}

/**
 * 组级 X 标定（`x_groups[].value_per_px`，与步骤 6「点齿+填数字」同一条后端写入）。
 *
 * **不导航、不重载、不开工程包**：`RpcClient.call` 对标度类写入会广播 `onScaleMutated`
 * （B 的修复），`app/scaleSync.ts` 随即回填 `scale_provenance`。
 *
 * 就绪判据**只认"预览里有没有数"**：步骤 6 面板的「已标定 / 进度 N/28」读的是本地
 * group 状态与 `x_ticks`，不是回填后的 provenance（U-NA-01 里已记过这个同屏矛盾），
 * 拿它当门会永远等到"未标定"。所以这里由 `openExportWithNumbers` 反复开面板直到
 * 预览真的出现数值为止 —— 每次迭代都在观察最终被判定的那个量。
 */
async function calibrateColumnsX(page: Page): Promise<void> {
  await gotoStage(page, 6);
  await rpc(page, 'roi.groupUpdate', {
    roi_id: RID,
    group_id: GID,
    updates: { value_per_px: SLOPE },
  });
}

/** 打开导出模态并等到预览表出现。 */
/** 打开导出面板，等到**真的有行**（异步取数后"表格节点存在"不等于"有数据"）。 */
async function openExport(page: Page): Promise<void> {
  await page.locator('#btn-export-csv').click();
  await expect
    .poll(() => page.locator('#wpd-preview-table tbody tr').count(), {
      message: '导出面板必须渲染出数据行',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
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

/** 选择器下方那行"行集来源 + 行数"说明。 */
async function rowSetCaption(page: Page): Promise<string> {
  return (await page.locator('#wpd-rowset-caption').innerText()).trim();
}

/** 点 CSV 下载，返回解析后的表（表头 + 数据行）。 */
async function downloadCsv(page: Page, tag: string): Promise<PreviewTable> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('#btn-wpd-download-csv').click(),
  ]);
  const savedPath = test.info().outputPath(`rows-${tag}.csv`);
  await download.saveAs(savedPath);
  const text = readFileSync(savedPath, 'utf8').trim();
  const lines = text.split(/\r?\n/);
  return {
    headers: lines[0].split(',').map((s) => s.trim()),
    rows: lines.slice(1).map((line) => line.split(',').map((s) => s.trim())),
  };
}

/** 选择器切到某个数据集（`change` 处理器同步重算预览与文本）。 */
async function selectDataset(page: Page, value: string): Promise<void> {
  await page.locator('#wpd-dataset-select').selectOption(value);
  await expect(page.locator('#wpd-dataset-select')).toHaveValue(value);
}

/** 把预览深度的表头减掉，得到数据列名（表头可能还有一个行号列 `#`）。 */
function dataHeaders(preview: PreviewTable): string[] {
  const width = preview.rows[0]?.length ?? 0;
  return preview.headers.slice(preview.headers.length - width);
}

/**
 * 让后端在**同一批层位**上重算一遍：`core.extractGridValues{depths}`。
 *
 * 返回 `{ taxa, data: Array<Record<taxon, number|null>> }`，`data[i]` 对应用户传入的
 * 第 i 个深度 —— 所以预览行与后端行按索引一一对应，不需要按数值对深度做模糊匹配。
 */
async function backendGrid(
  page: Page,
  depths: number[]
): Promise<{ taxa: string[]; data: Array<Record<string, number | null>> }> {
  const res = await backendRpc<{
    taxa: string[];
    data: Array<Record<string, number | null>>;
  }>(page, 'core.extractGridValues', { depths });
  return { taxa: res.taxa ?? [], data: res.data ?? [] };
}

test.describe('U-ROWS-01 预览与下载必须同一行集', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('选择器同时控制预览与 CSV 下载；预览数值必须对得上后端同层位取值', async ({ page }) => {
    // 这条用例要做：Y 标定 → 重载页面 → 3 次下载/比对 → 后端同层位重算，
    // 在基线 28 列 × 298 行的矩阵上跑，60s 的默认预算不够（实测会被单步 reload 吃掉）。
    test.setTimeout(150_000);
    // ---- 造现场 ----
    // 3 个样品层位（让"后端样品层位"与"控制点并集"行数必然不同）＋ 组斜率 X 标定
    // （让预览真的有数字）。全程不导航：标定写完后前端会自己回填（B 的修复）。
    await backendRpc(page, 'samples.set', {
      samples: [
        { row_px: 300, depth: 10.0, source: 'manual' },
        { row_px: 420, depth: 20.0, source: 'manual' },
        { row_px: 540, depth: 30.0, source: 'manual' },
      ],
    });
    await calibrateColumnsX(page);
    await calibrateDepth(page);

    await openExport(page);
    const preview = await readPreview(page);
    const headers = dataHeaders(preview);

    // ---- 现场自检：预览里必须真的有数字 ----
    // 没有这一段，后面所有"逐格相等"都可能退化成 `"NA" == "NA"`（Verifier 判死的原因）。
    const allCells = preview.rows.flatMap((row) => row.slice(1));
    const finite = allCells
      .map((cell) => Number.parseFloat(cell))
      .filter((v) => Number.isFinite(v));
    const nonZero = finite.filter((v) => v !== 0);
    expect(
      finite.length,
      `现场必须有 ≥100 个有限数值格（实际 ${finite.length}；若全是 NA，说明 X 标定没生效）`
    ).toBeGreaterThanOrEqual(100);
    expect(
      Math.max(...nonZero, 0),
      '现场必须有 >1 量级的真实读数，否则比的是舍入噪声'
    ).toBeGreaterThan(1);
    expect(
      preview.rows.length,
      '现场必须让两套行集不同（控制点并集 vs 3 个样品层位），否则本用例没有判别力'
    ).not.toBe(3);

    // ---- A. 同源钉子：下载物 == 预览表 ----
    // 只证明"下载的就是眼前这张表"，不证明数值正确（两边一起错它照样绿）。
    const unionDownload = await downloadCsv(page, 'union');
    expect(
      unionDownload.rows.length,
      `预览 ${preview.rows.length} 行，下载物必须同样行数（旧实现走后端样品层位，只有 3 行）`
    ).toBe(preview.rows.length);
    expect(unionDownload.headers, '下载物表头必须与预览表头一致').toEqual(headers);
    expect(unionDownload.rows.slice(0, 5), '下载物前 5 行必须与预览逐格一致').toEqual(
      preview.rows.slice(0, 5)
    );

    // ---- 行集说明 ----
    const unionCaption = await rowSetCaption(page);
    expect(unionCaption, '选择器下方必须有可见的行集说明').toContain('行');
    expect(
      unionCaption,
      `行集说明里的行数必须等于预览行数（说明：${unionCaption}，预览 ${preview.rows.length} 行）`
    ).toContain(String(preview.rows.length));

    // ---- B. 数值判据：预览 vs 后端同 (列, 层位) ----
    const depths = preview.rows.map((row) => Number.parseFloat(row[0]));
    expect(depths.every((d) => Number.isFinite(d)), '预览第一列必须是可解析的深度').toBe(true);
    const grid = await backendGrid(page, depths);
    expect(grid.data.length, '后端必须对每个传入深度返回一行').toBe(preview.rows.length);

    const mismatches: string[] = [];
    let compared = 0;
    for (let r = 0; r < preview.rows.length; r++) {
      const backendRow = grid.data[r] ?? {};
      for (let c = 1; c < headers.length; c++) {
        const taxon = headers[c];
        const backendVal = backendRow[taxon];
        if (backendVal === null || backendVal === undefined) continue; // 后端不出数
        const previewVal = Number.parseFloat(preview.rows[r][c]);
        if (!Number.isFinite(previewVal)) continue; // 预览是 NA（不该发生，但别在这里误判）
        if (previewVal === 0) continue; // 与 naStr 缺测填充不可区分，见文件头注释
        compared++;
        if (Math.abs(previewVal - Number(backendVal)) > VALUE_TOL) {
          mismatches.push(
            `depth=${depths[r]} 列=${taxon} 预览=${previewVal} 后端=${Number(backendVal)}`
          );
        }
      }
    }
    expect(
      compared,
      `必须有 ≥100 个"预览与后端都可比"的格子（实际 ${compared}）`
    ).toBeGreaterThanOrEqual(100);
    expect(
      mismatches.slice(0, 3).join(' | '),
      `预览与后端同 (列, 层位) 的取值必须一致（共 ${mismatches.length}/${compared} 个不一致，前 3 个）`
    ).toBe('');

    // ---- 切到另一项数据集：预览与下载必须一起变 ----
    await selectDataset(page, 'depth_grid');
    const gridPreview = await readPreview(page);
    expect(
      gridPreview.rows.length,
      `切换数据集后预览行数必须变化（控制点并集 ${preview.rows.length} → 均匀层位 ${gridPreview.rows.length}）`
    ).not.toBe(preview.rows.length);
    const gridCaption = await rowSetCaption(page);
    expect(gridCaption, '切换后行集说明必须跟着更新').toContain(String(gridPreview.rows.length));
    expect(gridCaption, '说明必须点明来源换了').toContain('标尺');

    const gridDownload = await downloadCsv(page, 'grid');
    expect(
      gridDownload.rows.length,
      `切到均匀层位后，下载物行数必须跟着变成 ${gridPreview.rows.length}`
    ).toBe(gridPreview.rows.length);
    expect(gridDownload.rows.slice(0, 5), '切换后下载物必须与预览逐格一致').toEqual(
      gridPreview.rows.slice(0, 5)
    );

    // ---- 工作簿类导出必须自报行集 ----
    const workbookNote = (await page.locator('#wpd-workbook-rowset-note').innerText()).trim();
    expect(workbookNote, 'XLSX / LiPD / TAR 必须写明它们的行集来源').toContain('样品层位');
  });
});

test.describe('U-ROWS-01 行集为空时的说法', () => {
  // 未标定场景**故意**触发 -32003：面板会把原因写进 caption + toast，这条错误路径是
  // 本用例的被测行为，不是静默兜底，所以在用例文件里显式豁免。
  // 注意： Playwright 的 `allowlists` 是**对象整体替换**：同一作用域写第二个 `test.use`
  // 会把前一个整个覆盖掉（这里曾因此漏掉 notice，导致用例仍报未预期通知）。
  test.use({
    allowlists: {
      consoleError: [/导出需要深度标定/],
      rpcError: [/导出需要深度标定/, /export\.csv/],
      notice: [/行集为空/, /读取 .* 数据集失败/],
    },
  });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('未标定时选「均匀层位」得到空行集：必须说明为空，且不得产出假成功的文件', async ({
    page,
    telemetry,
  }) => {
    // 本场景故意未标定 ⇒ 预览按定义 0 行，不能用要求 rows>0 的 openExport()。
    await page.locator('#btn-export-csv').click();
    await expect(page.locator('.wpd-export-dialog')).toBeVisible();
    await page.locator('#wpd-dataset-select').selectOption('depth_grid');
    await expect
      .poll(async () => (await readPreview(page)).rows.length, {
        message: '未标定时均匀层位必须是 0 行',
        timeout: 10_000,
      })
      .toBe(0);

    const caption = await rowSetCaption(page);
    // 本场景是**未标定**：后端在取数阶段就回 -32003，面板此时只有一条
    // 「导出需要深度标定…」的说明（见 ExportModal 的 CALIBRATION 分支），
    // 因此这里只钉"必须说明需要标定 / 给出下一步"。「空行集（0 行）」的
    // 文案由另一条已标定但行集为空的场景覆盖，不塞进这条（两种失败原因不同）。
    expect(caption, '必须说明为什么没有数据，并给出下一步该做什么').toContain('标定');

    let downloads = 0;
    page.on('download', () => {
      downloads++;
    });
    await page.locator('#btn-wpd-download-csv').click();
    await expect
      .poll(() => telemetry.notices.filter((text) => text.includes('行集为空')).length, {
        message: '空行集点下载必须明确报错，不能静默下载一个空文件',
        timeout: 10_000,
      })
      .toBe(1);
    expect(downloads, '空行集时不得触发下载').toBe(0);
  });
});

test.describe('U-ROWS-01 CSV 按钮自己的失败面', () => {
  // 这条路径不经过后端（前端拼字符串 + 造 Blob），所以后端注入打不到它；
  // 失败必须由前端自己报出来，不能"点了没反应"。
  test.use({ allowlists: { notice: [/导出 CSV 失败/, /INJECTED_BLOB_FAIL/] } });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    // 本用例要先有真实行集才谈得上"序列化后造 Blob"：未标定时后端直接拒绝导出，
    // 面板里一行都没有（判据 `rows.length > 0` 会先炸）。标定与主线同款。
    await calibrateColumnsX(page);
    await calibrateDepth(page);
  });

  test('Blob 构造失败时必须 notifyError，且不产生下载', async ({ page, telemetry }) => {
    await openExport(page);
    await expect
      .poll(async () => (await readPreview(page)).rows.length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    // 注入点选 `Blob`：CSV 下载在序列化之后必须先造 Blob，是最靠前的可注入失败点，
    // 且不依赖任何内部函数名（不碰产品实现细节）。
    await page.evaluate(() => {
      const RealBlob = window.Blob;
      (window as unknown as { Blob: unknown }).Blob = function PatchedBlob() {
        throw new Error('INJECTED_BLOB_FAIL');
      } as unknown as typeof Blob;
      (window as unknown as { __realBlob?: unknown }).__realBlob = RealBlob;
    });

    let downloads = 0;
    page.on('download', () => {
      downloads++;
    });
    await page.locator('#btn-wpd-download-csv').click();

    await expect
      .poll(() => telemetry.notices.filter((text) => text.includes('导出 CSV 失败')).length, {
        message: 'Blob 构造失败必须通知用户（不能静默什么都不发生）',
        timeout: 10_000,
      })
      .toBe(1);
    expect(telemetry.notices.join('\n'), '通知里应带上原始错误，便于排查').toContain(
      'INJECTED_BLOB_FAIL'
    );
    expect(downloads, '失败时不得产出下载').toBe(0);
  });
});
