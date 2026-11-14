/**
 * 多 ROI 列区间重叠时的**点齿归属**（本文件只测缺陷 ①；缺陷 ② 的可诊断性判据见
 * `step6-axis-coverage-hint.spec.ts`）。
 *
 * ## 缺陷 ①（归属错分区，本条用例的正向判据）
 *
 * `columns` 是全局扁平数组。多 ROI 图上两个分区的列区间可以**整段重叠**：本用例
 * 造的形态与实测一致——先建的 `roi_1`（tree，列 x 315–1946）在前，后建的 `roi_2`
 * （herb，列 x 161–1899）在后，重叠区 319–1899。旧 `columnAtX` 按数组顺序取**第一个**
 * 包含该 x 的列，于是在 `roi_2` 活动区里点它自己的齿，命中的是 `roi_1` 的列；那条齿
 * 不在 `roi_1` 的刻线表里，面板报「此处没有检测到刻度齿」——**齿明明有，点就是拒绝**。
 *
 * 修复后判据三条：
 * 1. 点 `roi_2` 自己的齿必须**吸附成功**（出现"已选齿 x = …"），不再报没齿；
 * 2. 吸附到的 x 必须**等于后端为 roi_2 测出的那条齿**（不是邻居、不是 roi_1 的齿）；
 * 3. 归属的列必须属于 `roi_2`（`roi_id` 对得上）——这是"归属正确"的直证。
 *
 * 另加负向对照：同一个画布位置，把活动区换成 `roi_1` 后点击的归属必须变成 `roi_1`
 * 的列。没有这条，把 `columnAtX` 写死成"永远返回 roi_2 的列"也能让上面三条全绿。
 *
 * ## 为什么都用 RPC 造现场
 *
 * 与 `qa-scope-multi-roi.spec.ts` 同一套手法：分区、列切分全部走真实后端，
 * 前端的 `columns` / `rois` / `rulerGeo` 都是后端算出来的，不是测试塞进去的。
 */
import { expect, test, type Page } from './fixtures';
import { canvasBox, diagramData, getState, gotoStage, openApp, resetBaseline, rpc } from './helpers';

const STEP6 = '.step-panel[data-step="6"]';
const PICK_BTN = `${STEP6} #btn-pick-tick`;
const PENDING = `${STEP6} [data-role="pending-tick"]`;
const NO_TICK_HINT = '此处没有检测到刻度齿';

interface WireColumn {
  id: string;
  col_index?: number;
  roi_id?: string;
  startX: number;
  endX: number;
}

interface WireRulerColumn {
  col_index: number | null;
  axis_row: number | null;
  ticks: number[];
}

interface WireRulerGeometry {
  roi_id: string | null;
  per_column: WireRulerColumn[];
  median_spacing_px: number | null;
}

/**
 * 在基线（hoya + `roi_1` 28 列 315–1946）之上再建一个**列区间整段重叠**的分区。
 *
 * `y1` 取 1340：hoya 的印刷轴行在 1306/1307，1340 把轴行框进有效区，齿才能检出——
 * 本用例要测的是**归属**，不是"没齿"，所以必须先保证齿存在。
 */
async function stageOverlappingRoi(page: Page, y1: number): Promise<string> {
  const created = await rpc<{ roi: { id: string } }>(page, 'roi.create', {
    x0: 0,
    x1: 1900,
    y0: 0,
    y1,
  });
  const roiId = created.roi.id;
  // `column.add` 把列挂到**当前 active ROI**，`detect_columns` 也按 active/入参分区过滤，
  // 所以必须先切活动区再分列（顺序反了列会落到 roi_1 名下）。
  await rpc(page, 'roi.setActive', { roi_id: roiId });
  await rpc(page, 'core.detectColumns', {
    data_xlim: [0, 1900],
    data_ylim: [0, y1],
    roi_id: roiId,
  });
  // 前端镜像不自己刷新：重载让 `getDiagramData` 带上新分区与新列。
  await page.reload();
  await openApp(page);
  await gotoStage(page, 6);
  return roiId;
}

/**
 * 画布/面板当前选中的列 id —— 读**侧栏里被标成 active 的那张卡片**。
 *
 * 为什么不能读后端 `straditize.getDiagramData().activeTaxaId`：那个字段在
 * `straditize_core/rpc_methods/system.py:391` 恒为 `formatted_cols[0]["id"]`，
 * 是"根载荷里第一列"，**不随用户选择变化**。拿它当"点齿归属哪一列"的判据，
 * 不论归属对错都会得到第一列 —— 判据没有判别力（本条用例第一版就栽在这上面：
 * 断言读的是恒为 roi_1 第一列的后端字段，修复与不修复都同样绿/同样红）。
 *
 * 侧栏 `active` 卡片是 `canvasComponent.data.activeTaxaId` 的直接投影，而
 * `XTicksPanel` 点齿吸附成功后正是调 `ctx.onSelectTaxa(col.id)` 改它
 * （`InspectorBridge.onSelectTaxa` → `canvasComponent.setActiveTaxa`）。
 * 折叠分区里的卡片仍留在 DOM 里，所以属性可读、不受折叠影响。
 */
async function selectedColumnId(page: Page): Promise<string | null> {
  const cards = page.locator('.app-sidebar .taxa-card.active');
  if ((await cards.count()) === 0) return null;
  return cards.first().getAttribute('data-taxa-id');
}

/** 后端为某分区实测的刻线几何（面板走的是同一条 RPC）。 */
async function rulerGeometry(page: Page, roiId: string): Promise<WireRulerGeometry> {
  return rpc<WireRulerGeometry>(page, 'algorithm.measureRuler', { roi_id: roiId });
}

/** 画布 x（相对 canvas 左上角）与世界 x 的换算参数（产品渲染用的同一组值）。 */
async function viewportOf(page: Page): Promise<{ scale: number; panX: number }> {
  const state = await getState<{ viewport?: { scale: number; panX: number } }>(page);
  const vp = state.viewport;
  expect(vp, '产品必须暴露 getState().viewport（取景策略改动后请同步本用例）').toBeTruthy();
  return { scale: Number(vp!.scale), panX: Number(vp!.panX) };
}

/** 世界 x → 画布点击坐标。吸附只判 x，y 取视野中线（落在列内即可）。 */
async function clickWorldX(
  page: Page,
  vp: { scale: number; panX: number },
  worldX: number
): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + Math.round(vp.scale * worldX + vp.panX), box.y + box.height * 0.55);
}

/** 该分区里齿数最多的一列（面板建议点离 0 点最远的那条齿，容差内最稳）。 */
function richestColumn(geo: WireRulerGeometry): WireRulerColumn {
  return [...(geo.per_column ?? [])].sort(
    (a, b) => (b.ticks?.length ?? 0) - (a.ticks?.length ?? 0)
  )[0];
}

test.describe('步骤 6：多 ROI 列区间重叠时的点齿归属', () => {
  // 点【点一个刻度齿】会弹一条 info toast（"请在画布上点一个刻度齿…"），这是正常流程。
  test.use({ allowlists: { notice: [/请在画布上点一个刻度齿/] } });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('在自己活动区点自己的齿必须吸附，且归属是本分区的列', async ({ page, telemetry }) => {
    const roiId = await stageOverlappingRoi(page, 1340);

    const geo = await rulerGeometry(page, roiId);
    expect(geo.roi_id, '刻度几何必须按活动区（新分区）测量').toBe(roiId);
    const richest = richestColumn(geo);
    const ticks = richest?.ticks ?? [];
    expect(
      ticks.length,
      `前置：新分区必须真的检出刻度齿（实得 ${ticks.length} 条），否则本用例测的不是归属而是"没齿"`
    ).toBeGreaterThanOrEqual(2);

    // 前置（判据的对照组）：这条齿的 x 确实同时落在**两个**分区的列带内 ——
    // 这正是旧实现会解析错的形态；不成立的话本用例就没有判别力。
    const data = await diagramData<{ columns: WireColumn[]; activeRoiId: string }>(page);
    expect(data.activeRoiId, '前置：活动区必须是新分区').toBe(roiId);
    const hostCol = data.columns.find((c) => c.col_index === richest.col_index);
    expect(hostCol?.roi_id, '前置：被测列的归属必须是新分区').toBe(roiId);
    const foreignCol = data.columns.find(
      (c) => c.roi_id !== roiId && ticks[ticks.length - 1] >= c.startX && ticks[ticks.length - 1] <= c.endX
    );
    expect(
      foreignCol,
      `前置：该 x=${ticks[ticks.length - 1]} 必须同时落在另一个分区的列带内（重叠形态），否则测不到本缺陷`
    ).toBeTruthy();

    const target = ticks[ticks.length - 1];
    const vp = await viewportOf(page);
    await page.locator(PICK_BTN).click();
    await clickWorldX(page, vp, target);

    // 判据 ①：必须吸附成功（不再报"此处没有检测到刻度齿"）。
    await expect(
      page.locator(PENDING),
      `在新分区活动区里点它自己的齿（x=${target}）必须吸附；报「${NO_TICK_HINT}」就是把有齿说成没齿`
    ).toContainText(`x = ${target}px`, { timeout: 10_000 });

    // 判据 ②：归属的列必须属于本分区（不是重叠区里另一个分区的列）。
    const after = await diagramData<{ columns: WireColumn[] }>(page);
    const selectedId = await selectedColumnId(page);
    expect(selectedId, '点齿成功后必须真的选中一列（侧栏 active 卡片）').toBeTruthy();
    const picked = after.columns.find((c) => c.id === selectedId);
    expect(
      picked?.roi_id,
      `点齿后选中的列（${String(selectedId)}）必须属于新分区 ${roiId}，实得 ${String(picked?.roi_id)}`
    ).toBe(roiId);

    // 判据 ③：成功路径不得产生额外通知（除【点一个刻度齿】那条 info）。
    expect(
      telemetry.notices.filter((n) => n.includes(NO_TICK_HINT)),
      '成功的点击不得同时报"没有检测到刻度齿"'
    ).toEqual([]);
    expect(telemetry.rpcErrors).toEqual([]);
  });

  test('负向对照：同一位置在另一分区活动区里必须归到那一分区的列', async ({ page }) => {
    const overlapRoi = await stageOverlappingRoi(page, 1340);
    const geo = await rulerGeometry(page, overlapRoi);
    const richest = richestColumn(geo);
    const ticks = richest?.ticks ?? [];
    expect(ticks.length, '前置：新分区必须检出齿').toBeGreaterThanOrEqual(2);
    const target = ticks[ticks.length - 1];

    // 切回基线分区（roi_1，列 315–1946，齿齐）——同一个世界 x 现在应当归它。
    const baseline = await rpc<{ rois: Array<{ id: string }> }>(page, 'roi.list');
    const baselineId = baseline.rois.find((r) => r.id !== overlapRoi)?.id;
    expect(baselineId, '前置：基线分区的 id 必须已知').toBeTruthy();
    await rpc(page, 'roi.setActive', { roi_id: baselineId! });
    await page.reload();
    await openApp(page);
    await gotoStage(page, 6);
    // 面板按活动区重测刻线几何：`data-spacing` 有值才说明就位。
    await expect
      .poll(
        async () => page.locator(`${STEP6} [data-role="ruler-detect"]`).getAttribute('data-spacing'),
        { timeout: 20_000, message: '切换活动区后必须重测刻度几何' }
      )
      .not.toBe('');

    const vp = await viewportOf(page);
    await page.locator(PICK_BTN).click();
    await clickWorldX(page, vp, target);

    // 判据：归属必须变成基线分区的列。写死成"永远返回某个分区"在这里会红。
    const after = await diagramData<{ columns: WireColumn[] }>(page);
    const selectedId = await selectedColumnId(page);
    expect(selectedId, '点齿成功后必须真的选中一列（侧栏 active 卡片）').toBeTruthy();
    const picked = after.columns.find((c) => c.id === selectedId);
    expect(
      picked?.roi_id,
      `活动区换成基线分区后，同一位置必须归到该分区的列（选中 ${String(selectedId)}），实得 ${String(picked?.roi_id)}`
    ).toBe(baselineId);
  });
});
