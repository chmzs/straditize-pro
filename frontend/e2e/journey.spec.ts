/**
 * 八步黄金旅程 —— 迁移自旧 tests/e2e/test_golden_journey.py。
 *
 * 旧测试声称"Zero-Staging Policy：全部通过真实 DOM 点击驱动"，确实点完了 8 步，
 * 但它**只**断言了两件事：标定面板里两个像素输入框非空且互不相同，以及后端
 * `export_multi_tar()` 出的 tar 里有 4 个成员、data.csv 首行以 `depth,` 开头。
 * 也就是说：ROI 改名、主区切换、Y 轴标定、分列、采样这些**状态变化**全都没有被验证，
 * 走完流程本身并不证明状态正确（旧套件 94 条断言里只有 1 条读后端，这正是其中一处盲区）。
 *
 * 这里保留"真实点击驱动"的骨架（不用 RPC 摆状态），但在每一步都补上后端权威状态断言：
 * 每个阶段必须真的落到目标 stage、ROI 改名真的进后端、主区切换真的换 id、
 * 标定真的写进 depth_calib、分列真的产出列、采样真的产出层位；最后 tar 的
 * data.csv 必须等于主 ROI 的那张分表。
 *
 * 另一处旧注释是错的：`primBtns[0]` 属于**非主区**卡片（`.btn-set-primary` 只渲染在
 * 非主区上），所以那次点击其实是把 herb_pollen 提升为主区，而不是注释里写的
 * "Set tree_pollen as primary"。这里按真实语义断言，并记录该差异。
 */
import { Buffer } from 'node:buffer';
import { expect, test, type Page } from './fixtures';
import {
  canvasBox,
  diagramData,
  getState,
  resetBaseline,
  rpc,
} from './helpers';

interface RoiSummary {
  id: string;
  name: string;
  name_source: string;
  /** 产品决策 ③ 之后新建 ROI 是零面积壳，框选要用到边界，故一并声明。 */
  xlim?: [number, number];
  ylim?: [number, number];
}

interface DiagramData {
  rois: RoiSummary[];
  primaryRoiId: string;
  activeRoiId?: string;
  columns: { id: string }[];
  calibration: {
    isCalibrated: boolean;
    top_px: number | null;
    bottom_px: number | null;
    unit: string | null;
  };
}

interface Readiness {
  sheets: string[];
  primary_roi: string;
  primary_roi_id: string;
}

/** 等前端状态机真的落到目标步骤（旧测试用固定 sleep，是假绿的主要来源）。 */
async function waitStage(page: Page, step: number): Promise<void> {
  await expect
    .poll(async () => (await getState<{ stage: number }>(page)).stage, {
      message: `应推进到步骤 ${step}`,
      timeout: 20_000,
    })
    .toBe(step);
}

/** 步骤 6 面板范围（只在本文件用到点齿链路）。 */
const STEP6 = '.step-panel[data-step="6"]';
/** 填给刻度齿的读数：固定值，只为让斜率有确定值；本用例不判定它的科学含义。 */
const TICK_READING = 30;

interface RulerGeo {
  roi_id?: string;
  per_column?: Array<{ col_index?: number | null; ticks?: number[] }>;
}

/**
 * 把活动区切成指定 ROI（真实点击：工作流胶囊回到步骤 2 → 点 ROI 卡片 → 回到步骤 6）。
 *
 * 步骤 6 的标定是**活动区**的属性（面板取 `data.active_roi_id` 去问后端 `algorithm.
 * measureRuler`），而本旅程在第 2 步把 herb_pollen 提升为主区后它就一直是活动区。
 */
async function switchActiveRoi(page: Page, roiId: string): Promise<void> {
  await page.locator('.workflow-step-btn[data-step="2"]').click();
  await waitStage(page, 2);
  await page.locator(`.roi-item-card[data-roi-id="${roiId}"]`).click();
  await expect
    .poll(async () => (await diagramData<DiagramData>(page)).activeRoiId, {
      message: `点 ROI 卡片必须真的把活动区切到 ${roiId}`,
      timeout: 15_000,
    })
    .toBe(roiId);
  await page.locator('.workflow-step-btn[data-step="6"]').click();
  await waitStage(page, 6);
}

/**
 * 步骤 6：组级 X 刻度标定（真实 UI：检测刻齿 → 点一个齿 → 填读数 →【应用】）。
 *
 * ## 为什么必须在 tree_pollen 上做，而且做完要切回 herb_pollen
 *
 * 本旅程第 2 步把 herb_pollen 框成 (0,0)–(1900,1300) 并设为主区，于是步骤 6 的活动区
 * 是它。这一步在它上面做不到，两个实测原因（都在本机 e2e 后端上量过）：
 *
 * 1. **框没盖住印刷的轴行**：hoya 各列的下轴在 y≈1306，而 herb 的框到 y=1300 就结束，
 *    齿搜索带整段落在轴行之上 —— 29 列里只有 3 列各检出 1 条孤齿，面板如实报
 *    「检测：29 列，未找到刻度尺」；没有刻距就没有可判定的跨度。
 * 2. **列路由把点击解析回别的 ROI**：把 herb 的框纵向补到 1340（让齿检得出来）后重试，
 *    点它的齿仍**全部**被判「此处没有检测到刻度齿」。原因是 herb 的列（161–1899）与
 *    tree_pollen 的列（315–1946）在 x 上整段重叠，而画布点齿的列归属是
 *    `core/tickRouting.ts:columnAtX`：按 `columns` 数组顺序取**第一个**包含该 x 的列，
 *    数组里 tree_pollen 的 28 列在前。把活动区换成 tree_pollen 后，同一套点击立刻
 *    吸附到 `已选齿：x = 1934px · 距 0 点 155px`。
 *
 * 这两条都是产品行为（框的范围、多 ROI 重叠下的列归属），改它们属于产品改动，不在本
 * 用例范围。所以标定挑**齿能检出、且列路由可达**的那一组：tree_pollen 的组。步骤 6 的
 * 要求是「本组共用一组刻度即可让导出有值」（`_assert_export_column_scale` 只要有一列
 * 标定过就放行），导出因此拿到真实读数；标完切回 herb_pollen，步骤 7/8 的工作区与
 * 从前一致。
 *
 * ## 判据读后端权威值
 *
 * `scale_provenance.calibrated` + 组的 `value_per_px`（不查 `col.x_ticks`：写组斜率时
 * 后端会清空列上的 `x_ticks`，查它只能测到清空这个副作用，见 step6-picktick.spec.ts）。
 */
async function calibrateColumnTicks(page: Page): Promise<void> {
  await switchActiveRoi(page, 'roi_1');

  // 面板的刻线几何是异步拉的：`data-spacing` 有值才说明 `rulerGeo` 就位，否则吸附
  // 判定拿不到齿表，点齿必然被拒（会把"点不中"误判成缺陷）。
  await expect
    .poll(
      async () =>
        page.locator(`${STEP6} [data-role="ruler-detect"]`).getAttribute('data-spacing'),
      { timeout: 20_000, message: '步骤 6 必须真的检测到刻度尺（刻距非空）' }
    )
    .not.toBe('');

  const geo = await rpc<RulerGeo>(page, 'algorithm.measureRuler', {});
  const perColumn = geo.per_column ?? [];
  expect(geo.roi_id, '刻度几何必须按活动区（tree_pollen）测量').toBe('roi_1');
  // 取齿数最多的一列，再点它**离 0 点最远**的那条齿（面板自己的建议：越远越准）。
  const richest = [...perColumn].sort(
    (a, b) => (b.ticks?.length ?? 0) - (a.ticks?.length ?? 0)
  )[0];
  const ticks = richest?.ticks ?? [];
  expect(
    ticks.length,
    `前置：tree_pollen 的某列必须有检测到的刻度齿（实得 ${ticks.length} 条）`
  ).toBeGreaterThanOrEqual(2);
  const targetTick = ticks[ticks.length - 1];
  const targetColIndex = Number(richest.col_index);

  await page.locator(`${STEP6} #btn-pick-tick`).click();
  // 世界 x → 画布 x 用产品视口参数（`getState().viewport` 与渲染同一组值）。
  const vp = (await getState<{ viewport: { scale: number; panX: number } }>(page)).viewport;
  const box = await canvasBox(page);
  await page.mouse.click(
    box.x + Math.round(vp.scale * targetTick + vp.panX),
    box.y + box.height * 0.55
  );
  // 吸附判据：面板必须报出**这条**齿（不是相邻那条），否则后面的斜率就是错齿算出来的。
  await expect(
    page.locator(`${STEP6} [data-role="pending-tick"]`),
    `点齿必须吸附到 x = ${targetTick}px 的那一条`
  ).toContainText(`x = ${targetTick}px`);

  await page.locator(`${STEP6} #inp-tick-value`).fill(String(TICK_READING));
  await page.locator(`${STEP6} #btn-apply-tick-calib`).click();

  const slopeOf = async (): Promise<number> => {
    const data = await diagramData<{
      rois: Array<{ id: string; x_groups?: Array<{ id?: string; value_per_px?: number | null }> }>;
      columns: Array<{
        col_index?: number;
        roi_id?: string;
        x_group_id?: string;
        scale_provenance?: { calibrated?: boolean; source?: string };
      }>;
    }>(page);
    const col = data.columns.find((c) => c.col_index === targetColIndex);
    const group = data.rois
      .find((r) => r.id === col?.roi_id)
      ?.x_groups?.find((g) => g.id === col?.x_group_id);
    return Number(group?.value_per_px ?? NaN);
  };
  await expect
    .poll(slopeOf, { timeout: 15_000, message: '【应用】必须把组斜率写成后端的值' })
    .toBeGreaterThan(0);

  const calibrated = async (): Promise<{ calibrated?: boolean; source?: string }> =>
    (
      await diagramData<{ columns: Array<{ col_index?: number; scale_provenance?: { calibrated?: boolean; source?: string } }> }>(page)
    ).columns.find((c) => c.col_index === targetColIndex)?.scale_provenance ?? {};
  await expect
    .poll(async () => (await calibrated()).calibrated, {
      timeout: 15_000,
      message: '标定过的列必须被后端认成已标定（resolve_column_scale 派生）',
    })
    .toBe(true);
  expect((await calibrated()).source, '标定来源必须标明是组斜率').toBe('group_slope');

  // 切回主区（herb_pollen）继续步骤 7/8：本旅程后续断言与从前一样跑在它上面。
  await switchActiveRoi(page, 'roi_2');
}

/** 极简 POSIX UStar 读取器（同 export.spec.ts：engine 里的 TarArchive 没有挂到 window）。 */
function untarArchive(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8);
    if (Number.isNaN(size)) {
      throw new Error(`tar 头解析失败：偏移 ${offset} 处 size 字段为 ${JSON.stringify(sizeText)}`);
    }
    const typeFlag = String.fromCharCode(header[156]);
    const dataStart = offset + 512;
    if (typeFlag !== 'x' && typeFlag !== 'g') {
      entries.set(name, buf.subarray(dataStart, dataStart + size));
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/**
 * 把当前活动 ROI 从左上角手柄拖到世界坐标 (wx, wy)。
 *
 * 产品决策 ③（2026-11-09）之后，新建 ROI 是一个 [0,0]×[0,0] 的**空壳**，不再是当前
 * ROI 的克隆。所以本旅程在新建第二个区域后必须像真实用户那样先把它框出来；否则
 * 走到步骤 5 时后端会拒绝零面积区域：
 * `Bounds [0.0, 0.0], [0.0, 0.0] is too small (image is 2339x1654)`。
 * 这是产品语义变更带来的**流程**变更，不是放宽断言。
 */
async function frameActiveRoi(page: Page, wx: number, wy: number): Promise<void> {
  const box = await canvasBox(page);
  const vp = (await getState<{ viewport: { scale: number; panX: number; panY: number } }>(page))
    .viewport;
  const data = await diagramData<DiagramData>(page);
  const activeId = data.activeRoiId ?? data.rois[0]?.id;
  const active = data.rois.find((r) => r.id === activeId);
  if (!active?.xlim || !active.ylim) throw new Error('活动 ROI 缺少边界，无法框选');

  const from = {
    x: box.x + active.xlim[0] * vp.scale + vp.panX,
    y: box.y + active.ylim[0] * vp.scale + vp.panY,
  };
  const to = { x: box.x + wx * vp.scale + vp.panX, y: box.y + wy * vp.scale + vp.panY };

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 24 });
  await page.mouse.up();

  await expect
    .poll(
      async () => {
        const after = await diagramData<DiagramData>(page);
        const roi = after.rois.find((r) => r.id === activeId);
        return roi?.xlim ? Math.abs(roi.xlim[1] - roi.xlim[0]) : 0;
      },
      { message: '框选后活动 ROI 必须从零面积变成真实宽度', timeout: 15_000 },
    )
    .toBeGreaterThan(0);
}

test.describe('八步黄金旅程（全 DOM 点击驱动）', () => {
  // 步骤 6 的点齿链路会发两条**流程内**提示：按【点一个刻度齿】后的操作指引，和
  // 应用成功后的「已按「30 对应 Npx」标定本组」。二者都是用户该看到的正常反馈，
  // 因此只放开这两句 —— 点空的拒绝提示（「此处没有检测到刻度齿」）**不放开**：
  // 它一旦出现就说明吸附失败，用例本就该红。
  test.use({
    allowlists: {
      notice: [/请在画布上点一个刻度齿/, /已按「/],
    },
  });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('走完 8 步后，ROI/标定/分列/采样与导出的 tar 都必须与后端状态一致', async ({ page }) => {
    // ===== Step 1 → 2 =====
    await page.locator('#btn-wf-next').click();
    await waitStage(page, 2);

    // ===== Step 2：改名 + 新建第二个 ROI + 切主区 =====
    const roiName = page.locator('#inp-roi-name');
    await roiName.fill('tree_pollen');
    await roiName.press('Tab'); // 面板监听 change/blur 提交
    await expect.poll(async () => (await diagramData<DiagramData>(page)).rois.find((r) => r.id === 'roi_1')?.name).toBe('tree_pollen');

    await page.locator('#btn-create-roi').click();
    // 等待新建的第二个 ROI 激活挂载到输入框
    await expect(page.locator('.roi-item-card').nth(1)).toBeVisible();
    await expect(roiName).toHaveValue(/roi_2/);

    await roiName.fill('herb_pollen');
    await roiName.press('Tab');
    await expect.poll(async () => (await diagramData<DiagramData>(page)).rois.find((r) => r.id === 'roi_2')?.name).toBe('herb_pollen');

    // 改名必须真的写进后端（旧测试完全没验证这一步）。
    const afterRename = await diagramData<DiagramData>(page);
    expect(afterRename.rois.map((r) => r.name).sort(), '两个 ROI 的新名字都要进后端').toEqual([
      'herb_pollen',
      'tree_pollen',
    ]);
    const herb = afterRename.rois.find((r) => r.name === 'herb_pollen');
    if (!herb) throw new Error('后端缺少 herb_pollen');
    expect(afterRename.primaryRoiId, '基线的 roi_1 仍是主区').not.toBe(herb.id);

    // `.btn-set-primary` 只渲染在非主区卡片上，所以 .first() 是 herb_pollen 的按钮。
    // 旧注释写的是 "Set tree_pollen as primary"，与按钮实际归属相反；这里断言真实语义。
    await page.locator('.btn-set-primary').first().click();
    const afterPrimary = await diagramData<DiagramData>(page);
    expect(afterPrimary.primaryRoiId, '点非主区卡片上的按钮应把该 ROI 提升为主区').toBe(herb.id);

    // 产品决策 ③：新建出来的 herb_pollen 是待框选的空区域，先框出来再去分列。
    await frameActiveRoi(page, 1900, 1300);

    await page.locator('#btn-apply-roi-next').click();
    await waitStage(page, 3);

    // ===== Step 3：画布两点 + 侧栏两点标定 =====
    const box = await canvasBox(page);
    await page.mouse.click(box.x + 120, box.y + 150);
    await page.mouse.click(box.x + 120, box.y + 350);

    // 画布取点必须回填到侧栏表单、并在画布上留下两个标记。
    const pickedTop = await page.locator('#ycal-inp-top-px').inputValue();
    const pickedBottom = await page.locator('#ycal-inp-bot-px').inputValue();
    expect(pickedTop, '画布第一次点击必须回填上面那个参考点').not.toBe('');
    expect(pickedBottom, '画布第二次点击必须回填下面那个参考点').not.toBe('');
    expect(pickedTop, '两个参考点必须是不同的像素行').not.toBe(pickedBottom);
    expect(
      (await getState<{ yCalibMarks: unknown[] }>(page)).yCalibMarks.length,
      '画布上应留下 2 个标定标记'
    ).toBe(2);

    await page.locator('#ycal-inp-top-px').fill('511');
    await page.locator('#ycal-inp-top-val').fill('0.0');
    await page.locator('#ycal-inp-bot-px').fill('1311');
    await page.locator('#ycal-inp-bot-val').fill('1300.0');
    await page.locator('#ycal-inp-unit').fill('cm');
    await page.locator('#btn-apply-ycalib-next').click();
    await waitStage(page, 4);

    // 标定必须真的落到后端 depth_calib（旧测试只看了输入框非空，没验证标定结果）。
    const calibrated = await diagramData<DiagramData>(page);
    expect(calibrated.calibration.isCalibrated, '后端必须已标定').toBe(true);
    expect(calibrated.calibration.top_px).toBe(511);
    expect(calibrated.calibration.bottom_px).toBe(1311);
    expect(calibrated.calibration.unit).toBe('cm');

    // ===== Step 4：候选线清理 → 分列 =====
    await page.locator('#btn-detect-candidates').click();
    await page.locator('#btn-apply-cleanup-next').click();
    // 进入 Step 5 会真的跑一遍后端分列，且 currentStage 在分列完成后才落定，
    // 所以 waitStage(5) 同时是"分列结果已回到前端"的屏障。
    await waitStage(page, 5);
    const split = await diagramData<DiagramData>(page);
    expect(split.columns.length, '分列必须真的产出属种列').toBeGreaterThan(0);

    // ===== Step 5 → 6 → 7 =====
    await page.locator('#btn-apply-naming-next').click();
    await waitStage(page, 6);

    // Step 6：X 刻度标定（检测刻齿 → 点一个齿 → 填读数 → 应用）。缺了它，
    // `4c287b6` 之后 Step 8 的导出面板预览与 .tar 都会被 -32003「导出需要列刻度」拒绝。
    await calibrateColumnTicks(page);
    await page.locator('#btn-apply-xticks-next').click();
    await waitStage(page, 7);
    await page.locator('#btn-extract-consensus').click();
    await page.locator('#btn-apply-samples-next').click();
    await waitStage(page, 8);

    // 采样必须真的产出层位，否则 data.csv 只有表头 —— 旧测试是等到解包 tar 才发现的行数问题。
    const qa = await rpc<{ n_horizons: number }>(page, 'qa.summarize', {});
    expect(qa.n_horizons, '共识层位必须真的写进后端').toBeGreaterThan(0);

    // ===== Step 8 → 导出 =====
    await expect(page.locator('#qa-banner'), 'Step 8 诊断横幅必须渲染').toBeVisible();
    await page.locator('#btn-qa-export').click();
    // 等待全剖面 56 属种列密集等深几何求交完成并将导出模态框挂载至 DOM
    await page.waitForTimeout(1500);
    await expect(page.locator('.wpd-export-dialog')).toBeVisible({ timeout: 20_000 });
    const readinessBox = page.locator('#export-readiness-container');
    await expect(readinessBox).toBeVisible();

    const readiness = await rpc<Readiness>(page, 'export.getReadiness', {});
    expect(readiness.sheets.length).toBeGreaterThan(0);
    await expect(
      readinessBox,
      '就绪清单的分表必须与后端一致'
    ).toHaveAttribute('data-sheets', readiness.sheets.join(','));
    await expect(readinessBox).toHaveAttribute('data-primary', readiness.primary_roi);

    // ===== tar 归档：成员、data.csv 归属、首行 =====
    const tarRes = await rpc<{ tar_base64: string; size: number; success: boolean }>(
      page,
      'export.tar',
      {}
    );
    const bytes = Buffer.from(tarRes.tar_base64, 'base64');
    expect(bytes.length).toBe(tarRes.size);
    const entries = untarArchive(bytes);

    expect([...entries.keys()].sort()).toContain('manifest.json');
    expect([...entries.keys()]).toContain('data.csv');
    expect([...entries.keys()]).toContain('plot_strat.R');
    expect([...entries.keys()]).toContain('README.txt');

    const dataCsv = entries.get('data.csv');
    if (!dataCsv) throw new Error('归档缺少 data.csv');
    const lines = dataCsv.toString('utf8').split('\n');
    expect(lines.length, 'data.csv 必须含真实数字化行，而不只是表头').toBeGreaterThan(1);
    expect(lines[0], 'data.csv 第一列必须是 depth').toMatch(/^depth,/);

    // 每个 ROI 一张分表，且 data.csv 必须等于主 ROI 的那张（旧测试完全没验证归属）。
    const dataMembers = [...entries.keys()].filter((n) => n.startsWith('data/'));
    expect(dataMembers.length, '分表数量必须等于后端 ROI 数量').toBe(readiness.sheets.length);
    const primaryCsv = entries.get(`data/${readiness.primary_roi}.csv`);
    if (!primaryCsv) throw new Error(`归档缺少主 ROI 分表 data/${readiness.primary_roi}.csv`);
    expect(dataCsv.equals(primaryCsv), 'data.csv 必须等于主 ROI 的分表').toBe(true);

    expect((await getState<{ stage: number }>(page)).stage, '旅程结束时必须停在 Step 8').toBe(8);
  });
});
