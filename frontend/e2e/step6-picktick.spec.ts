/**
 * 步骤 6「点一个刻度齿」的 UI 连通测试（组级点齿标定，ARCHITECTURE §6.4）。
 *
 * ## 这条链路此前一次都没被端到端跑过
 *
 * 标定从「每列填两个端点」改成「点一个齿 + 填它的数字」之后，`#btn-pick-tick`
 * → 画布工具切 `pickTick` → 点齿吸附 → 面板待标定态 → 填数字 →【应用】→
 * `roi.groupUpdate({value_per_px})` 这一串没有任何用例走过。本文件逐环节钉住：
 *
 * | 环节 | 判据 | 改坏后会怎样 |
 * | --- | --- | --- |
 * | 点按钮真的切工具 | 画布 `cursor` 从 `default` 变 `crosshair` | 去掉 `onSetToolMode('pickTick')` → 停在 `default`，点齿毫无反应 |
 * | 点齿真的吸附 | 面板报 `已选齿：x = <齿>px`，且该 x 在后端齿表里 | 点任意位置都"选中"就说明吸附是假的 |
 * | 应用真的落后端 | `roi.groupUpdate` 载荷 + 后端 `rois[].x_groups[].value_per_px` | 只改前端内存时后端仍为空 |
 * | 远离齿必须拒绝 | 提示「此处没有检测到刻度齿」，输入框**不出现** | 容差被放宽就全绿 |
 *
 * ## 工具模式的唯一可读来源是画布光标（页脚会说谎）
 *
 * 实测（2026-11-03）：`pickTick` **在浮动工具条里没有按钮**，所以
 * `paletteActiveTool()` 切到该模式后返回 `null`（没有任何按钮带 `active-mode`）。
 * 页脚当时是错的：`ToolModeManager.getToolDescription()` 的 `switch` 没有
 * `pickTick` 分支、落进 `default`，于是页面显示「模式: 选择与微调 (V)」。
 * **该缺陷已修**（issue #9：补齐 `pickTick` / `drawLineH` / `drawLineV` 三条描述，
 * `default` 改成编译期穷尽检查，页脚现在会如实显示「点选刻度齿（X 轴标定） (T)」；
 * 判据见 `issue9-tool-description.spec.ts`）。本文件的判据仍然一律用画布光标而不是
 * 页脚：光标是"策略真的激活了"的直证，页脚只是它的文案投影，两者不该互为替身。
 *
 * ## 为什么点齿坐标必须**实测**，不能按 `Viewport.fitToScreen` 复刻
 *
 * 初版理由是"`window.__straditize` 不暴露 viewport 的 scale/pan，按公式复刻会算错"，
 * 并把偏差记在"容器从 954×914 长到 1140×943、视口停在旧值"上。**该归因已被实测
 * 推翻**（2026-11-03，issue #8 排查）：容器在步骤 5→6 之间并没有变；0.436/60 是
 * `fitToScreen` 对**当时真正在画的 hoya 图（2339×1654）**在 1140×943 下算出的正确值，
 * 而 0.4582/129.4 是 beginner 范例（1923×1796）的同一公式值 —— 两者相差 80px 的原因是
 * **期望值用错了图像尺寸**，不是视口没重算。现在 `getState().viewport` 已暴露
 * scale/panX/panY（见 `issue8-fit-to-screen.spec.ts`）。
 *
 * 即便如此，本文件仍坚持量**画出来的分列竖线**（列边界的世界坐标是权威的）反解换算：
 * 反解不依赖任何内部字段，产品哪天又改了取景策略也不会假绿。再在 ±10px 内把目标齿的
 * 吸附窗口实测到亚像素 —— 点击落点与用户看到的一致。
 *
 * ## 判据一律读后端权威值
 *
 * 不查 `col.x_ticks`：写 `value_per_px` 时后端会**清空**组内各列的 `x_ticks`
 * （`session_parts/roi.py` 的 `if "value_per_px" in updates` 分支），查它只能
 * 测到"清空"这个副作用。标定是否成立一律读 `scale_provenance`
 * （`helpers.readColumnScale`）与组上的 `value_per_px`。
 */
import { expect, test } from './fixtures';
import {
  backendRpc,
  canvasBox,
  diagramData,
  gotoStage,
  readColumnScale,
  resetBaseline,
} from './helpers';
import type { Page } from '@playwright/test';

const PANEL = '.step-panel[data-step="6"]';
const PICK_BTN = `${PANEL} #btn-pick-tick`;
const APPLY_BTN = `${PANEL} #btn-apply-tick-calib`;
const CANCEL_BTN = `${PANEL} #btn-cancel-tick-calib`;
const TICK_INPUT = `${PANEL} #inp-tick-value`;
const PENDING = `${PANEL} [data-role="pending-tick"]`;

/** 面板拒绝"不在齿上"的点击时的原文（`XTicksPanel.mount` 的吸附分支）。 */
const NO_TICK_HINT = '此处没有检测到刻度齿';

/** 吸附容差（世界 px），与 `XTicksPanel.ts` 的 `SNAP_TOL` 同一口径。 */
const SNAP_TOL = 6;

interface BackendColumn {
  id: string;
  col_index?: number;
  startX?: number;
  endX?: number;
  x_group_id?: string;
  x_ticks?: Array<{ px: number; value: number }> | null;
  scale_provenance?: { calibrated?: boolean; source?: string };
}

interface BackendGroup {
  id: string;
  value_per_px?: number | null;
  axis_stroke_px?: number | null;
}

interface RulerGeo {
  per_column?: Array<{ col_index?: number | null; ticks?: number[] }>;
  median_spacing_px?: number | null;
}

/** 后端权威图谱数据（一次取样，避免同一断言里多次往返）。 */
async function snapshot(page: Page): Promise<{
  columns: BackendColumn[];
  groups: BackendGroup[];
  activeTaxaId?: string;
}> {
  const d = await diagramData<{
    columns: BackendColumn[];
    activeTaxaId?: string;
    rois?: Array<{ id: string; x_groups?: BackendGroup[] }>;
  }>(page);
  return {
    columns: d.columns ?? [],
    groups: (d.rois ?? []).flatMap((r) => r.x_groups ?? []),
    activeTaxaId: d.activeTaxaId,
  };
}

/** 面板认的那一列（与 `XTicksPanel.render` 的选列规则一致）。 */
async function activeColumn(page: Page): Promise<BackendColumn> {
  const { columns, activeTaxaId } = await snapshot(page);
  return columns.find((c) => c.id === activeTaxaId) ?? columns[0];
}

/** 该列所属组（组斜率是组的属性，见 ARCHITECTURE §6.4）。 */
async function groupOf(page: Page, col: BackendColumn): Promise<BackendGroup | undefined> {
  const { groups } = await snapshot(page);
  return groups.find((g) => g.id === col.x_group_id) ?? groups[0];
}

/**
 * 面板算「距 0 点多少」用的 0 点：`列左缘 + 轴线粗`，轴线粗缺省 5。
 *
 * 后端实测口径一致（写 0.0971 后 `scaleCalib.originX = 264 = startX 259 + 5`），
 * 所以这个 5 是两端共用的缺省，不是测试自己编的。
 */
function zeroPointOf(col: BackendColumn, group?: BackendGroup): number {
  const stroke = Number(group?.axis_stroke_px) > 0 ? Number(group?.axis_stroke_px) : 5;
  return Number(col.startX) + stroke;
}

/** 载入「沉积图谱」（beginner，四列都有真刻齿）并走到步骤 6。 */
async function openBeginnerStep6(page: Page): Promise<void> {
  await resetBaseline(page);
  await page.selectOption('#select-sample-diagram', 'beginner');
  await expect
    .poll(
      async () => {
        const d = await diagramData<{ imageWidth: number; imageHeight: number }>(page);
        return [d.imageWidth, d.imageHeight];
      },
      { timeout: 30_000, message: '范例下拉必须真的把后端切到 beginner-tutorial.png' }
    )
    .toEqual([1923, 1796]);

  await gotoStage(page, 5);
  await gotoStage(page, 6);
  // 面板的刻线几何是异步拉的：`data-spacing` 有值才说明 `rulerGeo` 就位，
  // 否则吸附判定拿不到齿表，点齿必然被拒（会把缺陷误判成"点不中"）。
  await expect
    .poll(
      async () =>
        page
          .locator(`${PANEL} [data-role="ruler-detect"]`)
          .getAttribute('data-spacing'),
      { timeout: 20_000 }
    )
    .not.toBe('');
}

/** 后端实测的齿位（`algorithm.measureRuler`，只读几何；面板走的是同一条链路）。 */
async function detectedTicks(page: Page, colIndex: number): Promise<number[]> {
  const geo = await backendRpc<RulerGeo>(page, 'algorithm.measureRuler', {});
  const per = geo.per_column ?? [];
  const own = per.find((c) => c.col_index === colIndex) ?? per[0];
  const ticks = (own?.ticks ?? []) as number[];
  expect(
    ticks.length,
    `前置：第 ${colIndex} 列必须有检测到的刻度齿（beginner 图第一列实测 5 个齿）`
  ).toBeGreaterThanOrEqual(2);
  return ticks;
}

/** 画布 x（相对 canvas 左上角）与世界 x 的线性换算。 */
interface CanvasMapping {
  scale: number;
  panX: number;
}

/** 吸附只判 x，点击的 y 取视野中线（落在列内即可）。 */
function clickY(box: { y: number; height: number }): number {
  return box.y + box.height * 0.55;
}

/** 世界 x → 画布 x。 */
function toCanvasX(mapping: CanvasMapping, worldX: number): number {
  return mapping.scale * worldX + mapping.panX;
}

/** 当前点击是否吸附到了指定的齿。 */
async function snappedTo(page: Page, worldX: number): Promise<boolean> {
  if ((await page.locator(TICK_INPUT).count()) === 0) return false;
  const text = await page.locator(PENDING).innerText();
  return text.includes(`x = ${worldX}px`);
}

/**
 * 清掉当前"已选齿"状态。
 *
 * 只点【取消】，**不重按**【点一个刻度齿】：取消只清 `pendingTick`，工具模式仍是
 * `pickTick`（`#btn-cancel-tick-calib` 的 handler 不碰 tool mode），画布点击照旧被
 * `PickTickToolStrategy` 接住。多按一次反而会在面板重渲染期间被判成"元素不稳定"。
 */
async function rearm(page: Page): Promise<void> {
  await page.locator(CANCEL_BTN).click();
  await expect(page.locator(PICK_BTN)).toBeVisible();
}

/**
 * 从**画布像素**反解「画布 x → 世界 x」。
 *
 * 做法：分列竖线贯穿列高，暗像素数远高于普通像素列；它们的 x 能精确量出来，
 * 而对应列边界的世界坐标是权威的（`col.startX / endX`）。于是对 scale 做网格搜索、
 * 每个候选用「竖线↔列边界」匹配投票，取匹配最多且残差最小的那一组。
 * 整幅图只扫一次，不点任何东西。
 */
async function estimateCanvasMapping(page: Page, worldEdges: number[]): Promise<CanvasMapping> {
  const detected: number[] = await page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('#geology-canvas')!;
    const W = cv.width;
    const H = cv.height;
    const d = cv.getContext('2d')!.getImageData(0, 0, W, H).data;
    const dark = (i: number) => d[i + 3] > 150 && d[i] + d[i + 1] + d[i + 2] < 430;
    const peaks: Array<{ x: number; n: number }> = [];
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let y = 0; y < H; y++) if (dark((y * W + x) * 4)) c++;
      if (c > H * 0.35) peaks.push({ x, n: c });
    }
    // 抗锯齿会让一条线占 2–3 列：相邻像素合并，按暗像素数加权取中心。
    const lines: number[] = [];
    let run: Array<{ x: number; n: number }> = [];
    const flush = (): void => {
      if (!run.length) return;
      const wsum = run.reduce((a, p) => a + p.n, 0);
      lines.push(run.reduce((a, p) => a + p.x * p.n, 0) / wsum);
      run = [];
    };
    for (const p of peaks) {
      if (run.length && p.x - run[run.length - 1].x > 3) flush();
      run.push(p);
    }
    flush();
    return lines;
  });

  expect(
    detected.length,
    '画布上必须能找到贯穿列高的分列竖线：找不到就说明列没画出来，后续点击无从谈起'
  ).toBeGreaterThanOrEqual(2);

  let best = { scale: NaN, panX: NaN, matched: -1, residual: Infinity };
  for (let s = 0.25; s <= 0.7; s += 0.0005) {
    const cands: number[] = [];
    for (const cx of detected) for (const w of worldEdges) cands.push(cx - s * w);
    for (const panX of cands) {
      let matched = 0;
      let resid = 0;
      for (const cx of detected) {
        let nearest = Infinity;
        for (const w of worldEdges) nearest = Math.min(nearest, Math.abs(cx - (s * w + panX)));
        if (nearest <= 4) {
          matched += 1;
          resid += nearest;
        }
      }
      const better =
        matched > best.matched ||
        (matched === best.matched && matched > 0 && resid / matched < best.residual);
      if (better) best = { scale: s, panX, matched, residual: matched ? resid / matched : Infinity };
    }
  }

  expect(
    best.matched,
    `画布竖线必须能与列边界对上（实测竖线 ${JSON.stringify(detected.map((x) => Math.round(x)))}，`
      + `列边界 ${JSON.stringify(worldEdges)}，最佳只对上 ${best.matched} 条）`
  ).toBeGreaterThanOrEqual(3);
  expect(
    best.residual,
    `换算残差必须足够小（实测 ${best.residual.toFixed(2)}px，scale=${best.scale.toFixed(4)}，panX=${best.panX.toFixed(1)}）：`
      + '残差大说明画的是另一套变换，或竖线不是列边界'
  ).toBeLessThan(2.5);

  return { scale: best.scale, panX: best.panX };
}

/**
 * 点某条齿：先按换算落点，再在 ±10px 内以 1px 步长找**真正会被接受**的位置，
 * 取接受区间中点，然后正式点下去。
 *
 * 换算精度约 1px，而吸附窗口只有 2×6 世界 px（≈5.3 画布 px）宽，直接按换算落点
 * 偶尔会踩到窗口边缘；量到亚像素后点击就稳定了。搜索本身也是判据：窗口必须
 * 落在**这条**齿上，否则说明吸附落到了别的齿、或压根没吸附。
 */
async function clickTick(page: Page, mapping: CanvasMapping, tick: number): Promise<void> {
  const box = await canvasBox(page);
  const y = clickY(box);
  const seed = Math.round(toCanvasX(mapping, tick));
  const accepted: number[] = [];
  for (let cx = seed - 10; cx <= seed + 10; cx++) {
    await page.mouse.click(box.x + cx, y);
    if (await snappedTo(page, tick)) {
      accepted.push(cx);
      await rearm(page);
    }
  }
  expect(
    accepted.length,
    `齿 x=${tick} 的吸附窗口必须落在换算预测位置 ${seed}px 附近（实测接受点 ${JSON.stringify(accepted)}）：`
      + '一个都没有说明点击位置与齿的真实位置不一致'
  ).toBeGreaterThan(0);

  const center = Math.round((accepted[0] + accepted[accepted.length - 1]) / 2);
  await page.mouse.click(box.x + center, y);
  await expect(page.locator(TICK_INPUT), '点齿后必须进入待标定态').toBeVisible({
    timeout: 10_000,
  });
}

/** 点任意世界 x（负向取样用：这里刻意不做吸附窗口搜索）。 */
async function clickWorldX(page: Page, mapping: CanvasMapping, worldX: number): Promise<void> {
  const box = await canvasBox(page);
  await page.mouse.click(box.x + toCanvasX(mapping, worldX), clickY(box));
}

/** 收集发往后端的 JSON-RPC（方法名 + 载荷），用于"动作真的发了请求"这类判据。 */
function watchRpc(page: Page): Array<{ method: string; params: any }> {
  const calls: Array<{ method: string; params: any }> = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
    try {
      const body = req.postDataJSON() as { method?: string; params?: unknown };
      if (body?.method) calls.push({ method: body.method, params: body.params ?? null });
    } catch {
      /* 非 JSON 体不关心 */
    }
  });
  return calls;
}

/** 该列所有列边界的世界 x（换算标定用；列宽与列序由后端权威给出）。 */
async function worldEdgesOf(page: Page): Promise<number[]> {
  const { columns } = await snapshot(page);
  const edges = columns.flatMap((c) => [Number(c.startX), Number(c.endX)]);
  return [...new Set(edges.filter((v) => Number.isFinite(v)))];
}

test.describe('步骤 6 组级点齿标定', () => {
  // 本文件故意制造"点不到齿"的负向用例，窗口搜索也会点空若干次。
  test.use({
    allowlists: {
      notice: [/此处没有检测到刻度齿/, /请在画布上点一个刻度齿/, /已按「/],
    },
  });

  test('T1 点【点一个刻度齿】→ 画布工具真的切到 pickTick → 点齿进入待标定态', async ({
    page,
    telemetry,
  }) => {
    await openBeginnerStep6(page);
    const col = await activeColumn(page);
    const group = await groupOf(page, col);
    const ticks = await detectedTicks(page, col.col_index ?? 0);

    // 前置：进入本步时默认工具是 select —— 光标 default。这条负向前置让下面那条
    // 断言有判别力：若一直就是 crosshair，切换与否都看不出来。
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('#geology-canvas')!).cursor
      ),
      '前置：进入步骤 6 时的默认工具是 select（光标 default）'
    ).toBe('default');

    await page.locator(PICK_BTN).click();

    // 判据 ①：工具模式真的切了。页脚/工具条都不能用（见文件头注释），
    // 只有 `syncToolModeUi()` 一起驱动的画布光标是如实的。
    expect(
      await page.evaluate(
        () => getComputedStyle(document.querySelector('#geology-canvas')!).cursor
      ),
      'pickTick 的 getCursor() 是 crosshair：光标不变就说明 onSetToolMode 没生效'
    ).toBe('crosshair');

    // 判据 ②：点击真的被 pickTick 策略接住，并吸附到一条**真实存在的**齿。
    const mapping = await estimateCanvasMapping(page, await worldEdgesOf(page));
    const target = ticks[ticks.length - 1];
    await clickTick(page, mapping, target);

    const pending = await page.locator(PENDING).innerText();
    expect(pending, '面板必须报出被吸附的那条齿').toContain(`x = ${target}px`);

    const zero = zeroPointOf(col, group);
    expect(
      pending.replace(/\s+/g, ' '),
      `距 0 点必须是「齿 − (列左缘 + 轴线粗)」= ${target} − ${zero} = ${target - zero}`
    ).toContain(`距 0 点 ${target - zero}px`);

    // 待标定态不该产生后端写入：这只是"选了一条齿"。
    expect(
      (await activeColumn(page)).scale_provenance?.calibrated,
      '仅选中齿不得把列标成已标定（标定要等用户填数字并应用）'
    ).toBe(false);
    expect(telemetry.rpcErrors).toEqual([]);
  });

  test('T2 填数字 →【应用】→ 后端落组斜率 value_per_px，且列 x_ticks 被清空', async ({
    page,
    telemetry,
  }) => {
    await openBeginnerStep6(page);
    const col = await activeColumn(page);
    const group = await groupOf(page, col);
    const ticks = await detectedTicks(page, col.col_index ?? 0);
    const target = ticks[ticks.length - 1];
    const expectedDist = target - zeroPointOf(col, group);
    const readValue = 30;

    await page.locator(PICK_BTN).click();
    const mapping = await estimateCanvasMapping(page, await worldEdgesOf(page));
    await clickTick(page, mapping, target);

    const calls = watchRpc(page);
    await page.locator(TICK_INPUT).fill(String(readValue));
    await page.locator(APPLY_BTN).click();

    // 判据 ①：动作真的发了请求，载荷就是契约里那一个字段。
    const expectedSlope = readValue / expectedDist;
    await expect
      .poll(
        () =>
          calls
            .filter((c) => c.method === 'roi.groupUpdate')
            .map((c) => Number(c.params?.updates?.value_per_px))
            .pop() ?? null,
        { timeout: 10_000, message: '【应用】必须发 roi.groupUpdate 并携带 value_per_px' }
      )
      .toBeCloseTo(expectedSlope, 9);

    // 判据 ②：后端权威值。组斜率 = 数字 / 距0点px。
    await expect
      .poll(async () => Number((await groupOf(page, col))?.value_per_px ?? NaN), {
        timeout: 10_000,
        message: `组斜率必须落后端，期望 ${expectedSlope}`,
      })
      .toBeCloseTo(expectedSlope, 9);

    // 判据 ③：派生标度成立（source 标明来自组斜率），且列上的旧 x_ticks 被清空。
    const scale = await readColumnScale(page, col.col_index ?? 0);
    expect(scale.calibrated, '后端必须认这一列已标定（resolve_column_scale 派生）').toBe(true);
    expect(scale.source, '标定来源必须标明是组斜率').toBe('group_slope');
    expect(
      (await activeColumn(page)).x_ticks ?? null,
      '写组斜率必须清空列上的 x_ticks：两个事实源并存会让读数有两种答案'
    ).toBeNull();

    // 判据 ④：面板回到"未选齿"，且成功通知如实说"已按 X 对应 Ypx 标定"。
    await expect(page.locator(PICK_BTN), '应用后面板必须回到【点一个刻度齿】').toBeVisible();
    await expect
      .poll(() => telemetry.notices.some((n) => n.includes('已按「')), { timeout: 5_000 })
      .toBe(true);
    expect(telemetry.rpcErrors).toEqual([]);
  });

  test('T3 点在两条齿正中间（+30px）必须拒绝，且不进待标定态、不写后端', async ({
    page,
    telemetry,
  }) => {
    await openBeginnerStep6(page);
    const col = await activeColumn(page);
    const ticks = await detectedTicks(page, col.col_index ?? 0);

    await page.locator(PICK_BTN).click();
    const mapping = await estimateCanvasMapping(page, await worldEdgesOf(page));

    // 负向取样点：两齿正中间再右移 30px —— 与最近能吸附的齿相距 33px，
    // 远大于 6px 的吸附容差；若这里也能选中，说明"必须点在齿上"这条约束没生效。
    const gapMid = (ticks[0] + ticks[1]) / 2 + 30;
    const nearest = Math.min(...ticks.map((t) => Math.abs(t - gapMid)));
    expect(
      nearest,
      `前置：取样点必须真的远离所有齿（实测最近距离 ${nearest}px > 容差 ${SNAP_TOL}px）`
    ).toBeGreaterThan(SNAP_TOL);

    const groupBefore = Number((await groupOf(page, col))?.value_per_px ?? NaN);
    const noticesBefore = telemetry.notices.length;

    await clickWorldX(page, mapping, gapMid);

    // 判据 ①：必须**如实拒绝**，而不是悄悄选一个最近的齿。
    await expect
      .poll(
        () =>
          telemetry.notices
            .slice(noticesBefore)
            .some((n) => n.includes(NO_TICK_HINT)),
        { timeout: 10_000, message: `点空必须提示「${NO_TICK_HINT}」` }
      )
      .toBe(true);

    // 判据 ②：不吸附就不许进待标定态（输入框与"已选齿"块都不能出现）。
    await expect(
      page.locator(TICK_INPUT),
      '没有吸附到齿就不得出现数字输入框——否则用户会在一个空选择上填数'
    ).toHaveCount(0);
    await expect(page.locator(PENDING)).toHaveCount(0);

    // 判据 ③：拒绝的点击绝不写后端。
    const groupAfter = Number((await groupOf(page, col))?.value_per_px ?? NaN);
    expect(
      Number.isNaN(groupBefore) ? Number.isNaN(groupAfter) : groupAfter === groupBefore,
      `点空不得改动组斜率（点前 ${String(groupBefore)}，点后 ${String(groupAfter)}）`
    ).toBe(true);
    expect(
      (await activeColumn(page)).scale_provenance?.calibrated,
      '点空不得把列标成已标定'
    ).toBe(false);
    expect(telemetry.rpcErrors).toEqual([]);
  });
});
