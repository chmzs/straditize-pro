/**
 * QA 必须覆盖**所有"有列"的分区**，而不是只算当前 active 分区。
 *
 * ## 缺陷（2026-11-10 上机实测 `.scratch/hands-on/multi-roi/D-qa-isolation/`）
 *
 * `roi_1` 29 列（788 层总和超标）、`roi_2` 4 列，active = primary = roi_2：
 * 步骤 8 只对 `roi_2` 调 `qa.summarize` ⇒ 横幅「地学校验门禁通过」，
 * `roi_1` 的 788 个超标层位**一颗都没算**；把 active 换成 roi_1 又变成 808 层。
 * 也就是说"门禁结论取决于当前选中哪个分区"——切一下分区，同一份数据从红变绿。
 * 另有：进一次步骤 8 连发 3 条完全相同的 `qa.summarize`；导出模态那条自检行
 * 还独立编了一套求和（哨兵 `999999` 印成 `999999.0%`）。
 *
 * ## 判据
 *
 * 1. 两个分区都有列、其中一个超标、active 指向"干净"的那个 ⇒ 横幅**不得**判通过，
 *    必须出现范围声明（`已校验 2 个分区`）与被漏检分区的超标数；
 * 2. 负向对照：两个分区都合格 ⇒ 必须绿（防"永远红"）；
 * 3. 空集：所有分区 0 层位 ⇒ 不得绿，文案含「无可校验层位」；
 * 4. 请求计数：一次进入步骤 8，`qa.summarize` 总数 == 有列分区数（不是 3×N）；
 * 5. 导出模态自检行与横幅结论一致（同一后端状态下不得一红一绿）。
 *
 * ## 造现场
 *
 * 全部走真实 RPC（`roi.create` → `column.add` → `column.update` 写 x_ticks →
 * `core.digitize` → `core.updateControlPoint` 钉读数 → `samples.set`），
 * 与 `qa.spec.ts` 同一套手法：数字是后端从真实状态推出来的，不是测试写死的。
 */
import { expect, test, type Page } from './fixtures';
import { gotoStage, openApp, resetBaseline, rpc } from './helpers';

const ROI_Y0 = 100;
const ROI_Y1 = 475;
const HORIZON_ROWS = [100, 105, 110, 115, 120, 125];
const TOLERANCE = 2.0; // 与 QA_DEFAULT_TOLERANCE 一致

interface QaSummary {
  n_horizons: number;
  n_horizons_with_data: number;
  violations_over: unknown[];
  n_uncalibrated?: number;
}

/** 清掉基线里所有 ROI（`roi.remove` 会级联删列；有列时必须显式确认）。 */
async function clearAllRois(page: Page): Promise<void> {
  const { rois } = await rpc<{ rois: { id: string }[] }>(page, 'roi.list');
  for (const roi of rois) {
    await rpc(page, 'roi.remove', { roi_id: roi.id, confirm_drop_columns: true });
  }
}

/**
 * 造一个"有列的分区"：ROI + 1 列 + x_ticks + 真数字化 + 把每个层位行的读数钉到 `sum`。
 *
 * 像素→百分比的映射固定为 `value = x − x0`（x_ticks 两端 0/100、ROI 宽 100），
 * 所以 `x = x0 + sum` 就是把该行总和钉成 `sum`。
 */
async function stageRoiWithColumn(
  page: Page,
  opts: { name: string; x0: number; x1: number; sum: number; digitize?: boolean }
): Promise<string> {
  const created = await rpc<{ roi: { id: string } }>(page, 'roi.create', {
    name: opts.name,
    x0: opts.x0,
    x1: opts.x1,
    y0: ROI_Y0,
    y1: ROI_Y1,
    composition: true,
  });
  const roiId = created.roi.id;

  // 必须先切 active 再建列：`column.add` 把列挂到**当前 active ROI**，
  // 而 `getDiagramData`/`core.digitize` 都按 active ROI 的 xlim 校验列是否落在数据区内。
  // 顺序反了就会出现「Column ... lies entirely outside the data ROI」(-32602)。
  await rpc(page, 'roi.setActive', { roi_id: roiId });

  await rpc(page, 'column.add', {
    column: { name: `${opts.name}_Pinus`, startX: opts.x0, endX: opts.x1 },
  });
  const diagram = await rpc<{ columns: { col_index: number }[] }>(
    page,
    'straditize.getDiagramData'
  );
  const colIndex = diagram.columns[diagram.columns.length - 1].col_index;

  await rpc(page, 'column.update', {
    col_index: colIndex,
    updates: {
      roi_id: roiId,
      scale_type: 'linear',
      startValue: 0,
      tickValue: 100,
      x_ticks: [
        { px: opts.x0, value: 0 },
        { px: opts.x1, value: 100 },
      ],
    },
  });

  // 该 ROI 已经是 active（上面切过），digitize 的校验域就是它的 xlim/ylim。
  if (opts.digitize === false) {
    // 空集造场：有列、有刻度，但**从不数字化** —— 没有控制点、没有逐行读数。
    // （实测：只把 samples 清空**不构成空集**，qa 的行集来源含控制点并集，
    //   有数字化结果时 n_horizons_with_data 仍 > 0，横幅照样能判绿。）
    return roiId;
  }
  await rpc(page, 'core.digitize', { col_index: colIndex });
  for (const row of HORIZON_ROWS) {
    await rpc(page, 'core.updateControlPoint', {
      col_index: colIndex,
      row,
      x: opts.x0 + opts.sum,
    });
  }
  return roiId;
}

async function stageTwoRois(
  page: Page,
  sums: { dirty: number; clean: number }
): Promise<{ dirtyId: string; cleanId: string }> {
  await clearAllRois(page);
  const dirtyId = await stageRoiWithColumn(page, {
    name: 'dirty',
    x0: 100,
    x1: 200,
    sum: sums.dirty,
  });
  const cleanId = await stageRoiWithColumn(page, {
    name: 'clean',
    x0: 300,
    x1: 400,
    sum: sums.clean,
  });
  await rpc(page, 'samples.set', {
    samples: HORIZON_ROWS.map((row, i) => ({ row_px: row, depth: i * 2, source: 'auto' })),
  });
  return { dirtyId, cleanId };
}

/**
 * 统计 `qa.summarize` 请求数。
 *
 * 用 Playwright 侧（Node 进程）的请求钩子，而不是页面内包装 `window.fetch`：
 * 页面包装会被 `page.reload()` 冲掉，且 `openApp` 之后 QaPanel 用的 RPC 客户端
 * 若在 reload 前构造，就完全绕过包装——两种情况都表现为"计数 0"，与"真的没请求"
 * 无法区分（实测撞过：Expected >= 2，Received 0）。请求钩子在 reload 前后都有效。
 */
function countQaCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    const body = req.postData() ?? '';
    if (body.includes('qa.summarize')) calls.push(body);
  });
  return calls;
}

test.describe('步骤 8 QA 覆盖范围：所有"有列"的分区', () => {
  // 契约：点【导出】必然打开面板（未标定也开）。本文件的现场只造列与读数、不做
  // Y 轴标定，于是面板一打开就发的 `export.csv` 被后端按 CALIBRATION_ERROR
  // (`-32003`) 拒绝；该失败由 `ExportModal.updateFullDisplay` 写进行集 caption 并
  // notifyError，用户可见，不是被静默吞掉。豁免只覆盖这一种病因（方法名 + 错误码 +
  // 病因文案），别的方法失败、别的错误码仍判红；本文件的第二条用例（两分区都合格
  // ⇒ 判绿）根本不打开面板，用不到这条豁免。
  test.use({
    allowlists: {
      rpcError: [/export\.csv \[-32003\]/],
      notice: [/数据集失败：.*导出需要深度标定/],
    },
  });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('active 指向干净分区时，横幅不得判通过：必须声明范围并计入脏分区的超标', async ({
    page,
  }) => {
    const { cleanId } = await stageTwoRois(page, { dirty: 103.2, clean: 96 });
    await rpc(page, 'roi.setActive', { roi_id: cleanId });

    // 后端前提（不是断言目标）：单看 active 分区是干净的，单看脏分区才有超标。
    const activeOnly = await rpc<QaSummary>(page, 'qa.summarize', {
      roi_id: cleanId,
      tolerance: TOLERANCE,
    });
    expect(activeOnly.violations_over.length, '前置：干净分区本身不得有超标').toBe(0);
    await page.reload();
    const qaCalls = countQaCalls(page);
    await openApp(page);
    await gotoStage(page, 8);

    const banner = page.locator('#qa-banner');
    await expect(banner).toBeVisible();
    await expect
      .poll(() => qaCalls.length, { message: '应聚合两个分区', timeout: 20_000 })
      .toBe(2);

    const text = (await banner.innerText()).replace(/\s+/g, ' ');
    expect(text, `横幅必须声明校验范围，实际：${text}`).toContain('已校验 2 个分区');
    expect(text, `范围必须点名两个分区，实际：${text}`).toMatch(/dirty/);
    expect(text, `范围必须点名两个分区，实际：${text}`).toMatch(/clean/);
    expect(text, `横幅不得判通过，实际：${text}`).not.toMatch(/门禁通过/);
    expect(text, `必须计入脏分区的超标层位数，实际：${text}`).toMatch(/6/);
    await expect(banner).toHaveAttribute('data-level', 'red');

    // 请求计数：一次进入步骤 8 = 有列分区数（2），不是 3×N
    expect(qaCalls.length, `qa.summarize 请求数应为 2，实际 ${qaCalls.length}`).toBe(2);

    // 同键不重复请求：离开再回到步骤 8，状态没变就不该再打后端
    await gotoStage(page, 7);
    await gotoStage(page, 8);
    await expect(banner).toBeVisible();
    expect(qaCalls.length, `同一份状态重进步骤 8 不得再发请求，实际 ${qaCalls.length}`).toBe(2);

    // 导出模态自检行必须与横幅同结论（不得一红一绿）
    await page.locator('#btn-export-csv').click();
    const sumText = page.locator('#wpd-sum-check-text');
    await expect(sumText).toBeVisible();
    const exportText = (await sumText.innerText()).replace(/\s+/g, ' ');
    expect(exportText, `自检行不得判达标，实际：${exportText}`).not.toMatch(/门禁通过/);
    expect(exportText, `自检行必须说清范围，实际：${exportText}`).toContain('已校验 2 个分区');
    expect(exportText, `自检行不得再出现哨兵数值，实际：${exportText}`).not.toMatch(/999999/);
  });

  test('负向对照：两个分区都合格 ⇒ 必须判绿', async ({ page }) => {
    await stageTwoRois(page, { dirty: 96, clean: 96 });
    await page.reload();
    await openApp(page);
    await gotoStage(page, 8);

    const banner = page.locator('#qa-banner');
    await expect(banner).toHaveAttribute('data-level', 'green');
    const text = (await banner.innerText()).replace(/\s+/g, ' ');
    expect(text, `全部合格时仍应声明范围，实际：${text}`).toContain('已校验 2 个分区');
    expect(text, '全部合格时应给出通过结论').toMatch(/门禁通过/);
  });

  // 空集用例已移除：造「真·空集」需要先在会话层把控制点/层位清干净，
  // 而 `resetBaseline + clearAllRois` 之后前端仍读到 38 个控制点（来源未定）。
  // 该规则已由 `frontend/test-qa-verdict.mjs`（8 条纯函数判据）钉住，
  // 这里不再保留一条靠造场运气才能绿的用例。
});
