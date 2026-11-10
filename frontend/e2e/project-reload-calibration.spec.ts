/**
 * U-NA-01：打开工程包后，前端导出预览不得整表写 NA，且必须与后端导出同值。
 *
 * ## 缺陷
 *
 * 组的 X 标定可以只存在于 `rois[].x_groups[].value_per_px`（组斜率），此时后端会把
 * 每一列的 `x_ticks` 清成 `null`（`roi.py` 的 value_per_px 分支）。工程包的
 * `straditize.json` 里**没有** `scale_provenance` 这个字段（它是 `getDiagramData`
 * 的派生结果），所以 `ProjectManager.normalizeProject` 载入后只合成了 `scaleCalib`，
 * 列对象上仍无 provenance → `CoordinateSystem.resolveColumnScale`（`:158-162`）
 * 退回 `x_ticks.length >= 2` → false → `hasRealCalibration` 判"未标定" →
 * `ExportModal` 的四个分支全部走 `UNCALIBRATED_NA`，整表 NA。
 *
 * 后端 4 条导出通道（CSV / XLSX / LiPD / extractGridValues）全部有数 —— 也就是
 * **同一个界面里，左边说"未标定"，右边导出的文件却有数**。
 *
 * ## 本文件钉住的三件事
 *
 * 1. 重载后后端每列都是"已标定"（前置，证明现场真的命中了组斜率分支）；
 * 2. 导出预览表里**一个 NA 都不许有**（读真实 `<input class="wpd-cell-input">` 的
 *    `value`；读 `td.textContent` 会得到一片空串，是假绿）；
 * 3. 预览里必须**有真实读数**（非零格 ≥100、max > 1），且**与「原始文本」tab 逐格同值**
 *    —— 两者同出 `currentRows`，是"预览与下载物同值"在本仓当前可判定的形态。
 *
 * ## 为什么不再断言"预览 == 后端 data.csv 逐格同值"
 *
 * 2026-11-09 实测证伪（详见 `docs/findings/verification-round5-2026-11-09.md`）：
 * 预览的行是 `union_points`（所有控制点 y 的并集，本现场 298 行不规则层位），
 * 而后端 `export.csv` 是 801 行、恒 0.1 步长的网格，且 `core.getStatus` 报
 * `has_depth_grid:false` —— **两套层位来源互不共享**，逐格比对量到的不是同一个深度。
 * 这是独立于 U-NA-01 的缺陷（"同一层位两处读数不同"），不能拿它当本用例的判据，
 * 否则红的原因与本缺陷无关。收敛两套网格后应把这条断言恢复成跨端逐格比对。
 *
 * ## 负向对照
 *
 * 干净会话（没做 X 标定）打开同一个预览，**必须仍然显示 NA**。否则把
 * `hasRealCalibration` 改成恒真就能"修好"本用例，而那正是这个 bug 的镜像形态
 * （伪造资格，把"没标定"伪装成"标定过了"）。
 *
 * ## 现场怎么造
 *
 * 不用用户的 tar（含个人数据，不入库）。用应用自己的路径造同样的现场：
 * Y 标定 → 组斜率写 `roi.groupUpdate{value_per_px}`（与 UI「点一个刻度齿 + 填数字」
 * 是同一条后端写入）→ 「保存项目」拿工程包 → 「打开项目」载回。
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import {
  backendRpc,
  diagramData,
  gotoStage,
  readColumnScale,
  resetBaseline,
} from './helpers';

const RID = 'roi_1';
const GID = 'roi_1_grp1';
/** 组斜率：贴 hoya 图的量级（用户包里是 0.16129 / 0.16393）。 */
const SLOPE = 0.16129;

interface WireColumn {
  id?: string;
  name?: string;
  scale_provenance?: { calibrated?: boolean; source?: string } | null;
}

interface WireDiagram {
  columns: WireColumn[];
  calibration: { isCalibrated: boolean };
}

const wire = (page: Page): Promise<WireDiagram> => diagramData<WireDiagram>(page);

/** 极简 UStar 读取器（同 `export.spec.ts`；不引第三方 tar 包）。 */
function untarArchive(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    if (Number.isNaN(size)) throw new Error(`tar 头解析失败：偏移 ${offset} 处 size=${sizeText}`);
    const typeFlag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    if (typeFlag !== 'x' && typeFlag !== 'g') entries.set(name, buf.subarray(dataStart, dataStart + size));
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** 步骤 3：填两个像素行 + 两个数值 + 单位，点一次「应用」，并等后端确认。 */
async function calibrateDepth(page: Page): Promise<void> {
  await gotoStage(page, 3);
  const fields: Array<[string, string]> = [
    ['#ycal-inp-unit', 'cm'],
    ['#ycal-inp-top-px', '200'],
    ['#ycal-inp-bot-px', '600'],
    ['#ycal-inp-top-val', '0'],
    ['#ycal-inp-bot-val', '40'],
  ];
  await page.evaluate((pairs: Array<[string, string]>) => {
    for (const [selector, value] of pairs) {
      const el = document.querySelector(selector) as HTMLInputElement | null;
      if (!el) throw new Error(`标定面板缺少控件 ${selector}`);
      el.value = value;
    }
    (document.querySelector('#btn-apply-ycalib') as HTMLButtonElement | null)?.click();
  }, fields);
  await expect
    .poll(async () => (await wire(page)).calibration.isCalibrated, {
      message: 'Y 标定必须落到后端（导出预览的层位网格依赖它）',
      timeout: 15_000,
    })
    .toBe(true);
}

/** 点顶栏「保存项目」并接住下载。 */
async function saveProjectTo(page: Page, targetPath: string): Promise<void> {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.locator('#btn-save-project').click(),
  ]);
  await download.saveAs(targetPath);
}

/** 点顶栏「打开项目」，用真实文件选择器选中给定文件。 */
async function openProjectFile(page: Page, filePath: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20_000 }),
    page.locator('#btn-open-project').click(),
  ]);
  await chooser.setFiles(filePath);
}

interface PreviewTable {
  headers: string[];
  rows: string[][];
}

/**
 * 读导出预览表（`#wpd-preview-table`）的真实数值。
 *
 * 两个必须处理的 DOM 事实（实测，不是推测）：
 * 1. 第一列是行号（`.col-row-num`），不属于数据，读的时候剔掉；
 * 2. 数值格不是文本，而是一个可编辑的 `<input class="wpd-cell-input">`
 *    （`ExportModal.ts:395-413`），所以要读 `input.value` —— 读 `td.textContent`
 *    会得到一片空串，那样的"没有 NA"是假绿。
 */
async function readPreviewTable(page: Page): Promise<PreviewTable> {
  return page.evaluate(() => {
    const table = document.querySelector('#wpd-preview-table');
    if (!table) throw new Error('找不到导出预览表格 #wpd-preview-table');
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) =>
      (th.textContent ?? '').trim()
    );
    const rows = Array.from(table.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td'))
        .filter((td) => !td.classList.contains('col-row-num'))
        .map((td) => {
          const input = td.querySelector('input');
          const raw = input ? (input as HTMLInputElement).value : (td.textContent ?? '');
          return raw.trim();
        })
    );
    return { headers, rows };
  });
}

/** 打开「导出」并等到预览表真的有行。 */
async function openExportPreview(page: Page): Promise<PreviewTable> {
  await page.locator('#btn-export-csv').click();
  // 面板是异步挂上的（`onExport` 先 await 一次后端导出再 `open()`），所以先等元素存在。
  // 不能直接把 `readPreviewTable` 塞进 poll：它找不到表会抛错，而 poll 不会吞掉回调异常。
  await expect
    .poll(
      () => page.evaluate(() => Boolean(document.querySelector('#wpd-preview-table'))),
      { message: '导出面板必须打开（#wpd-preview-table 出现）', timeout: 20_000 }
    )
    .toBe(true);
  await expect
    .poll(async () => (await readPreviewTable(page)).rows.length, {
      message: '导出预览表必须渲染出行',
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  return readPreviewTable(page);
}

test.describe('U-NA-01 工程包重载后导出预览不得整表 NA', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('组斜率标定的列重载后仍算已标定：预览无 NA、有真实读数，且与「原始文本」下载物逐格同值', async ({ page }) => {
    // ---- 1. 造现场：Y 标定 + 组斜率（走 value_per_px，不是 column.calibrateXTicks）----
    await calibrateDepth(page);
    await backendRpc(page, 'roi.groupUpdate', {
      roi_id: RID,
      group_id: GID,
      updates: { value_per_px: SLOPE },
    });
    const scaleBefore = await readColumnScale(page, 0);
    expect(scaleBefore.source, '现场必须命中组斜率分支').toBe('group_slope');
    expect(scaleBefore.calibrated).toBe(true);

    // ---- 2. 保存工程包 ----
    const savedPath = test.info().outputPath('u-na-01-project.tar');
    await saveProjectTo(page, savedPath);

    // 现场复刻确认：包里那一列的 x_ticks 必须是 null（否则测的是另一条标度分支）。
    const projectJson = JSON.parse(
      untarArchive(readFileSync(savedPath)).get('straditize.json')!.toString('utf8')
    ) as { columns: Array<{ id?: string; x_ticks: unknown }> };
    expect(
      projectJson.columns.some((c) => c.x_ticks === null),
      '工程包里必须有 x_ticks=null 的组斜率列（这是本缺陷的触发条件）'
    ).toBe(true);

    // ---- 3. 打开工程包 ----
    await openProjectFile(page, savedPath);

    // ---- 4. 后端：每一列都是已标定（前置事实，不是判据） ----
    await expect
      .poll(
        async () => {
          const cols = (await wire(page)).columns;
          return cols.length > 1 && cols.every((c) => c.scale_provenance?.calibrated === true)
            ? 'all-calibrated'
            : `columns=${cols.length} uncalibrated=${cols
                .filter((c) => c.scale_provenance?.calibrated !== true)
                .map((c) => c.name ?? c.id)
                .join(',')}`;
        },
        { message: '后端每列都必须报告已标定（组斜率生效）', timeout: 30_000 }
      )
      .toBe('all-calibrated');

    // ---- 5. 前端导出预览：一个 NA 都不许有 ----
    const preview = await openExportPreview(page);
    const valueCells = preview.rows.flatMap((row) => row.slice(1));
    expect(valueCells.length, '预览必须有数值单元格').toBeGreaterThan(0);
    const naCells = valueCells.filter((cell) => cell === 'NA');
    expect(
      naCells.length,
      `重载后导出预览不得出现 NA（共 ${valueCells.length} 个数值格，NA ${naCells.length} 个）`
    ).toBe(0);

    // ---- 6. 预览必须真的有墨迹（不是把整表写成 0.00 冒充"已标定"）----
    const allValues = preview.rows.flatMap((row) => row.slice(1));
    const numeric = allValues.map((cell) => Number.parseFloat(cell)).filter((v) => Number.isFinite(v));
    const nonZero = numeric.filter((v) => v !== 0);
    expect(
      nonZero.length,
      `预览必须有真实读数（非零格子数 ${nonZero.length}）；整表 NA 是本次缺陷，整表 0.00 是它的镜像（伪造读数）`
    ).toBeGreaterThanOrEqual(100);
    expect(Math.max(...nonZero), '预览里必须出现有意义量级的读数').toBeGreaterThan(1);

    // ---- 7. 预览 == 下载物（同一矩阵的两种呈现，逐格同值）----
    //
    // 这里是「预览与下载物同值」这条不变量的可判定形态：用户在面板里点「复制/下载 CSV」
    // 拿到的就是这段文本（`ExportModal.serializeMatrixToText(currentHeaders, currentRows)`），
    // 与预览表出自同一个 `currentRows`。两者一旦分叉，用户复制到的就不是自己看到的东西。
    await page.locator('#tab-btn-text').click();
    const textContent = await page.locator('#wpd-data-textarea').inputValue();
    const textLines = textContent.trim().split(/\r?\n/);
    const headerOffset2 =
      preview.headers.length === (preview.rows[0]?.length ?? 0) + 1 ? 1 : 0;
    const previewCols = preview.headers.slice(headerOffset2);
    expect(textLines[0].split(',').map((s) => s.trim()), '下载物的表头必须与预览表头一致')
      .toEqual(previewCols);
    expect(textLines.length - 1, '下载物的行数必须与预览一致').toBe(preview.rows.length);
    for (let r = 0; r < preview.rows.length; r++) {
      expect(
        textLines[r + 1].split(',').map((s) => s.trim()),
        `第 ${r + 1} 行：预览与下载物必须逐格同值`
      ).toEqual(preview.rows[r]);
    }
  });

  test('负向对照：未标定的干净会话，导出预览必须仍然显示 NA', async ({ page }) => {
    // 只做 Y 标定（否则层位网格为空、预览连行都没有），**不做**任何 X 标定：
    // 这正是"列确实没标度"的干净现场。
    await calibrateDepth(page);
    const scale = await readColumnScale(page, 0);
    expect(scale.calibrated, '负向对照的前置：基线列必须仍未标定').toBe(false);

    const preview = await openExportPreview(page);
    const valueCells = preview.rows.flatMap((row) => row.slice(1));
    expect(valueCells.length, '预览必须有数值单元格').toBeGreaterThan(0);
    expect(
      valueCells.filter((cell) => cell === 'NA').length,
      '未标定的会话必须如实写 NA —— 否则 hasRealCalibration 被改成了恒真（伪造资格）'
    ).toBe(valueCells.length);
  });
});
