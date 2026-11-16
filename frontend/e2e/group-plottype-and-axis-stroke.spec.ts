/**
 * 组形态（`plot_type`）与轴线粗（`axis_stroke_px`）：**写入之后界面必须跟着变**。
 *
 * ## 用户原话
 *
 * 1. 「这个分组我想切换为折线不成功」——组值改了，画布照旧画面积；
 * 2. 「轴线粗……我目视解读想设置为 1px 不成功，没法改掉默认值」，
 *    补充现象：「我输入了 1，但是**显示数字会跳没**，给人感觉没设置成功一样，
 *    图中 **0 线位置视觉位置也没更新**」。
 *
 * ## 实测到的失败链（三条同时成立）
 *
 * a. `main.ts:251` 的 `onDataChange` 只把**本地镜像**重画一遍，**不重拉后端**；
 * b. `app/scaleSync.ts` 的 `onScaleMutated` 会重拉数据，但只回填**列级**标度，
 *    组级字段（`plot_type` / `axis_stroke_px`）所在的 `rois` 被整个丢掉；
 * c. `XTicksPanel` 的 `patchGroup` 是 `void client.roiGroupUpdate(...).then(...)`，
 *    **没有 `.catch`**，失败静默。
 *
 * 于是：后端确实写进去了（`roi.list` 里就是 1），界面却用旧数据重画 ——
 * 输入框回落到 placeholder（"数字跳没"），绿线停在旧位置（"0 线没更新"）。
 *
 * ## 判据
 *
 * - P1：切「折线」→ 后端组值变 line，且组内各列的旧快照被清空（单一事实源）；
 * - S1：设 1px → ①请求体里 `axis_stroke_px === 1` ②后端 `=== 1`
 *   ③输入框**仍显示 1**（不得回落 placeholder）④绿线世界 x `== startX + 1`；
 * - S2：后端拒绝时**必须**出现用户可见的报错（不许 `void` 吞掉）。
 */
import { expect, test } from './fixtures';
import { backendRpc, gotoStage, openStep6GroupsFold, resetBaseline } from './helpers';
import type { Page } from '@playwright/test';

interface GroupSnapshot {
  id: string;
  plot_type?: string;
  axis_stroke_px?: number | null;
}

async function readGroups(
  page: Page
): Promise<{ groups: GroupSnapshot[]; defaultId?: string; roiId?: string }> {
  const res = await backendRpc<{
    rois: Array<{ id: string; default_group_id?: string; x_groups?: GroupSnapshot[] }>;
  }>(page, 'roi.list');
  const roi = res.rois[0];
  return { groups: roi?.x_groups ?? [], defaultId: roi?.default_group_id, roiId: roi?.id };
}

/**
 * 列快照：**读后端载荷**，不读 `getState()`。
 *
 * `getState().columns` 是给画布用的轻量投影（只有 id/name/startX/endX/col_index/
 * x_ticks/controlPointCount），没有 `x_group_id` 也没有 `plot_type` —— 用它判
 * 「列属于哪个组」会恒得 0 列（实测），那是一条永远绿的假断言。
 */
async function readColumns(
  page: Page
): Promise<
  Array<{
    name: string;
    startX: number;
    col_index: number | null;
    x_group_id?: string;
    plot_type?: string | null;
    axis_stroke_px?: number | null;
  }>
> {
  const dg = await backendRpc<any>(page, 'straditize.getDiagramData');
  return (dg.columns ?? []).map((c: any) => ({
    name: c.name,
    startX: Number(c.startX ?? c.start),
    col_index: c.col_index ?? null,
    x_group_id: c.x_group_id,
    plot_type: c.plot_type ?? null,
    axis_stroke_px: c.axis_stroke_px ?? null,
  }));
}

/**
 * 画布上绿线（0 点）的世界 x：在期望位置附近扫一行像素，取绿色分的加权质心。
 *
 * 与 `legend-and-axis-stroke.spec.ts` 的 A3 同法（那边是私有函数，这里复制一份；
 * 两处口径必须一致：质心、像素中心 +0.5、FLOOR 12）。
 */
async function greenLineWorldX(page: Page, nearWorldX: number): Promise<number> {
  return page.evaluate((expected) => {
    const ROWS = [0.5, 0.35, 0.65, 0.2, 0.8];
    const cv = document.querySelector('#geology-canvas') as HTMLCanvasElement | null;
    if (!cv) throw new Error('#geology-canvas 不存在');
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('取不到 2d context');
    const st = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
    const { panX, scale } = st.viewport as { panX: number; scale: number };
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const expectedCss = expected * scale + panX;
    const lo = Math.max(0, Math.round((expectedCss - 25) * dpr));
    const hi = Math.min(cv.width - 1, Math.round((expectedCss + 25) * dpr));
    const FLOOR = 12;
    let best: { worldX: number; score: number } | null = null;
    // 扫多行：100% 缩放下列带可能只占画面的一段，单行（正中）会整行落空。
    for (const rel of ROWS) {
      const row = ctx.getImageData(0, Math.round(cv.height * rel), cv.width, 1).data;
      let weight = 0;
      let moment = 0;
      let peak = -Infinity;
      for (let x = lo; x <= hi; x++) {
        const r = row[x * 4];
        const g = row[x * 4 + 1];
        const b = row[x * 4 + 2];
        const a = row[x * 4 + 3];
        if (a < 64) continue;
        const score = g - Math.max(r, b);
        if (score > peak) peak = score;
        const w = Math.max(0, score - FLOOR);
        moment += w * (x + 0.5);
        weight += w;
      }
      if (weight > 0 && peak >= 20) {
        // 设备像素 → CSS 像素 → 世界坐标
        const worldX = (moment / weight / dpr - panX) / scale;
        if (!best || peak > best.score) best = { worldX, score: peak };
      }
    }
    if (!best) {
      throw new Error(
        `在期望位置 ${expectedCss.toFixed(1)}px 附近（扫 ${ROWS.length} 行）没找到绿线`
      );
    }
    return best.worldX;
  }, nearWorldX);
}

/** 100% 视口：屏幕 px 与世界 px 1:1，1px 的位移才量得准。 */
async function toHundred(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(150);
}


/** 在画布上把 columns[0] 的绿线（0 点）往右拖 `worldDelta` 个世界像素。 */
async function dragGreenLine(page: Page, worldDelta: number): Promise<void> {
  const view = await page.evaluate(() => {
    const api = (window as unknown as { __straditize: { getState: () => any } }).__straditize;
    const s = api.getState();
    return {
      startX: Number(s.columns[0].startX),
      imageHeight: Number(s.image.height),
      scale: Number(s.viewport.scale),
      panX: Number(s.viewport.panX),
      panY: Number(s.viewport.panY),
    };
  });
  const groups = await readGroups(page);
  const cols = await readColumns(page);
  const groupStroke =
    Number(groups.groups.find((g) => g.id === cols[0].x_group_id)?.axis_stroke_px ?? 5) || 5;
  const box = await page.locator('#geology-canvas').boundingBox();
  if (!box) throw new Error('画布未布局');
  const zeroWorld = view.startX + groupStroke;
  const screenX = box.x + zeroWorld * view.scale + view.panX;
  const screenY = box.y + (view.imageHeight / 2) * view.scale + view.panY;
  await page.mouse.move(screenX, screenY);
  await page.mouse.down();
  await page.mouse.move(screenX + worldDelta * view.scale, screenY, { steps: 6 });
  await page.mouse.up();
}

test.describe('组形态与轴线粗：写入后界面必须跟着变', () => {

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);
    await openStep6GroupsFold(page);
  });

  test('P1 改组形态为折线 → 后端组值变 line，且组内列的旧快照被清空', async ({ page }) => {
    const { groups, roiId, defaultId } = await readGroups(page);
    const gid = defaultId ?? groups[0].id;
    const before = groups.find((g) => g.id === gid);
    expect(before, '前置：默认组必须存在').toBeTruthy();
    // 前置必须是 area：否则下面"切成 line"可能什么都没变，断言没有判别力。
    expect(before?.plot_type, '前置：基线默认组应为面积形态').toBe('area');

    await page.locator(`.btn-switch-group-tab[data-group-id="${gid}"]`).click();
    await page.locator('.grp-plottype-btn[data-plottype="line"]').first().click();

    await expect
      .poll(async () => (await readGroups(page)).groups.find((g) => g.id === gid)?.plot_type, {
        message: '点「折线」后后端组值必须变成 line',
        timeout: 15_000,
      })
      .toBe('line');

    // 单一事实源：组内各列的旧快照必须被清掉，否则前端解析时列级赢过组级。
    // 载荷里的列 `plot_type` 是**后端解析结果**（xscale._resolve_column_visual：
    // 列级覆盖 > 组级 > area），不是原始字段。所以判据是「组内每列的解析结果
    // 都等于组值」：列上若还留着 area 快照，这里就会读到 area（用户看到的形态）。
    const cols = await readColumns(page);
    const groupCols = cols.filter((c) => c.x_group_id === gid);
    expect(groupCols.length, '前置：默认组里必须有列').toBeGreaterThan(0);
    expect(
      groupCols.filter((c) => c.plot_type !== 'line').map((c) => `${c.name}=${c.plot_type}`),
      '组形态改成 line 后，组内每列的解析形态都必须是 line（旧 area 快照必须作废）'
    ).toEqual([]);
    // 负向对照：别的组（若有）的列不受影响，否则清除逻辑越界了。
    const otherGroups = cols.filter((c) => c.x_group_id && c.x_group_id !== gid);
    expect(
      otherGroups.length,
      '前置：基线只有一组时本对照为空，断言恒真——显式说明以免误以为覆盖到了'
    ).toBe(0);

    // 面板按钮状态必须跟着走（否则用户看不出"已经切了"）。
    await expect(
      page.locator('.grp-plottype-btn[data-plottype="line"]').first()
    ).toHaveClass(/active-mode/);
    expect(roiId, '前置：必须有 ROI').toBeTruthy();
    // 画布真的按折线重画，由 `test-plot-type.mjs` 用**绘制调用**断言
    // （fill(areaPath) 次数 = 0）；这里只覆盖"后端与面板已经一致"这一段。
  });

  test('S1 组轴粗设 1px → 请求体/后端都是 1，输入框仍显示 1，绿线 = startX + 1', async ({
    page,
  }) => {
    const { groups, defaultId } = await readGroups(page);
    const gid = defaultId ?? groups[0].id;
    expect(
      groups.find((g) => g.id === gid)?.axis_stroke_px ?? null,
      '前置：hoya 基线测不出轴粗，组上应当没有值（本用例才有"从缺省改成 1"的语义）'
    ).toBeNull();

    // 抓真实请求体：判据要断言"前端发出去的就是 1"，不是只看后端最终状态。
    const sent: Array<Record<string, unknown>> = [];
    page.on('request', (req) => {
      if (!req.url().endsWith('/rpc') || req.method() !== 'POST') return;
      const raw = req.postData();
      if (!raw) return;
      try {
        const body = JSON.parse(raw) as { method?: string; params?: any };
        if (body.method === 'roi.groupUpdate') sent.push(body.params);
      } catch {
        /* 非 JSON 不参与本断言 */
      }
    });

    await toHundred(page);
    const cols = await readColumns(page);
    // 100% 视口下按**可见范围**挑目标列：挑到画布外的列，绿线根本不在像素里，
    // 那条断言会以"找不到绿线"的形式失败，看起来像产品缺陷。
    const vp = await page.evaluate(() => {
      const cv = document.querySelector('#geology-canvas') as HTMLCanvasElement;
      const st = (window as unknown as { __straditize: { getState: () => any } }).__straditize.getState();
      return {
        panX: Number(st.viewport.panX),
        scale: Number(st.viewport.scale),
        cssWidth: cv.getBoundingClientRect().width,
      };
    });
    const worldLeft = -vp.panX / vp.scale;
    const worldRight = worldLeft + vp.cssWidth / vp.scale;
    const target =
      cols.find((c) => c.startX > worldLeft + 40 && c.startX < worldRight - 40) ?? cols[0];
    expect(
      target.startX > worldLeft && target.startX < worldRight,
      `目标列 startX=${target.startX} 必须落在可见世界范围 [${worldLeft.toFixed(0)}, ${worldRight.toFixed(0)}] 内`
    ).toBe(true);

    await page.locator(`.btn-switch-group-tab[data-group-id="${gid}"]`).click();
    const input = page.locator('#inp-axis-stroke');
    await input.fill('1');
    await input.dispatchEvent('change');

    await expect
      .poll(async () => (await readGroups(page)).groups.find((g) => g.id === gid)?.axis_stroke_px, {
        message: '组轴粗必须落库为 1',
        timeout: 15_000,
      })
      .toBe(1);

    // ① 请求体
    expect(
      sent.some((p) => p.group_id === gid && p.updates && (p.updates as any).axis_stroke_px === 1),
      `发给后端的 roi.groupUpdate 里 axis_stroke_px 必须是 1；实发 ${JSON.stringify(sent)}`
    ).toBe(true);

    // ② 输入框不得回落到 placeholder（用户原话「显示数字会跳没」）
    await expect(input, '保存后输入框必须显示 1，不得回落成空（placeholder 5）').toHaveValue('1');

    // ③ 绿线位置 = 列左缘 + 1
    await toHundred(page);
    const expected = target.startX + 1;
    const measured = await greenLineWorldX(page, expected);
    console.log(
      `[S1] startX=${target.startX} 轴粗→1px；绿线世界 x 实测 ${measured.toFixed(2)}（期望 ${expected}）`
    );
    expect(
      Math.abs(measured - expected),
      `绿线必须落在 startX(${target.startX}) + 1 = ${expected}；实测 ${measured.toFixed(2)}`
    ).toBeLessThanOrEqual(0.6);
  });

  test('S3 拖绿线改轴粗 → 后端落库、绿线跟着走、面板「仅本列」立即显示新值', async ({
    page,
  }) => {
    const before = await readColumns(page);
    const col0 = before[0];
    const startStroke = Number(
      (await readGroups(page)).groups.find((g) => g.id === col0.x_group_id)?.axis_stroke_px ?? 5
    ) || 5;

    const view = await page.evaluate(() => {
      const api = (window as unknown as { __straditize: { getState: () => any } }).__straditize;
      const s = api.getState();
      return {
        startX: Number(s.columns[0].startX),
        imageHeight: Number(s.image.height),
        scale: Number(s.viewport.scale),
        panX: Number(s.viewport.panX),
        panY: Number(s.viewport.panY),
      };
    });
    const box = await page.locator('#geology-canvas').boundingBox();
    if (!box) throw new Error('画布未布局');

    const dragWorld = 5;
    const zeroWorld = view.startX + startStroke;
    const screenX = box.x + zeroWorld * view.scale + view.panX;
    const screenY = box.y + (view.imageHeight / 2) * view.scale + view.panY;

    await page.mouse.move(screenX, screenY);
    await page.mouse.down();
    await page.mouse.move(screenX + dragWorld * view.scale, screenY, { steps: 6 });
    await page.mouse.up();

    // 屏幕→世界取整会吃掉 1px（fit 视口 scale≈0.44，5 世界 px 只有 2.2 屏幕 px），
    // 所以**以后端实际落库值为准**做后续断言：本用例判的是「界面跟不跟得上」，
    // 不是「鼠标位移换算精确到 1px」。
    await expect
      .poll(
        async () => (await readColumns(page))[0]?.axis_stroke_px ?? null,
        { message: '拖完绿线后列级 axis_stroke_px 必须落库', timeout: 15_000 }
      )
      .not.toBeNull();
    const actual = Number((await readColumns(page))[0]?.axis_stroke_px);
    expect(actual, '拖完必须真的比拖之前大（否则本用例测的是「没拖」）').toBeGreaterThan(
      startStroke
    );
    expect(actual, '拖动量应在 +3…+5px 之间（屏幕取整会少 1px）').toBeLessThanOrEqual(
      startStroke + dragWorld
    );
    const expected = actual;

    // ③ 面板「仅本列」必须**自己**跟上（旧实现只 push history，面板停在旧值）
    await expect
      .poll(() => page.locator('#inp-col-axis-stroke').inputValue(), {
        message: '拖完绿线后「仅本列」输入框必须显示新值，不需要用户再点一次',
        timeout: 15_000,
      })
      .toBe(String(expected));

    // ② 画布绿线 = startX + 新轴粗
    const measured = await greenLineWorldX(page, view.startX + actual);
    console.log(
      `[S3] 轴粗 ${startStroke}→${actual}px；绿线世界 x 实测 ${measured.toFixed(2)}（期望 ${view.startX + actual}）`
    );
    expect(
      Math.abs(measured - (view.startX + actual)),
      `绿线必须落在 startX(${view.startX}) + ${actual}；实测 ${measured.toFixed(2)}`
    ).toBeLessThanOrEqual(1.2);
  });

  test('S4 拖到列宽边界必须停在 20px（不发越界值给后端）', async ({ page }) => {
    const before = await readColumns(page);
    const col0 = before[0];
    const startStroke = Number(
      (await readGroups(page)).groups.find((g) => g.id === col0.x_group_id)?.axis_stroke_px ?? 5
    ) || 5;

    const sent: Array<Record<string, unknown>> = [];
    page.on('request', (req) => {
      if (!req.url().endsWith('/rpc') || req.method() !== 'POST') return;
      const raw = req.postData();
      if (!raw) return;
      try {
        const body = JSON.parse(raw) as { method?: string; params?: any };
        if (body.method === 'column.update') sent.push(body.params);
      } catch {
        /* 非 JSON 不参与本断言 */
      }
    });

    const view = await page.evaluate(() => {
      const api = (window as unknown as { __straditize: { getState: () => any } }).__straditize;
      const s = api.getState();
      return {
        startX: Number(s.columns[0].startX),
        endX: Number(s.columns[0].endX),
        imageHeight: Number(s.image.height),
        scale: Number(s.viewport.scale),
        panX: Number(s.viewport.panX),
        panY: Number(s.viewport.panY),
      };
    });
    const box = await page.locator('#geology-canvas').boundingBox();
    if (!box) throw new Error('画布未布局');
    // 前置：列宽必须 > 21px，否则「拖到右界」本身就到不了 20px，断言没有判别力。
    expect(Math.round(view.endX - view.startX), '前置：列宽必须 > 21px').toBeGreaterThan(21);

    const zeroWorld = view.startX + startStroke;
    const screenX = box.x + zeroWorld * view.scale + view.panX;
    const screenY = box.y + (view.imageHeight / 2) * view.scale + view.panY;

    // 往右拖 40 个世界像素：远超 20px 上限，也接近列右界。
    await page.mouse.move(screenX, screenY);
    await page.mouse.down();
    await page.mouse.move(screenX + 40 * view.scale, screenY, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () => (await readColumns(page))[0]?.axis_stroke_px, {
        message: '拖到边界应停在 20px',
        timeout: 15_000,
      })
      .toBe(20);

    // 发出去的每一个值都必须在 1–20 内（后端会拒越界值，那会变成"拖到一半弹回去"）。
    const strokes = sent
      .map((params) => (params.updates as Record<string, unknown> | undefined)?.axis_stroke_px)
      .filter((value) => value !== undefined);
    expect(strokes.length, '前置：必须真的发出过 column.update').toBeGreaterThan(0);
    expect(
      strokes.filter((value) => Number(value) > 20 || Number(value) < 1),
      `发出去的 axis_stroke_px 必须都在 1–20 内；实发 ${JSON.stringify(strokes)}`
    ).toEqual([]);

    // 且不得因为越界被后端拒绝（拒绝会弹「调整 0 点失败」）。
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText.includes('调整 0 点（轴线粗）失败'), '不得出现"调整 0 点失败"的报错').toBe(
      false
    );
  });

  test('S5 「回到组值」清空本列覆盖 → 后端字段被清、绿线回到组轴粗', async ({ page }) => {
    // 先造出真实的列级覆盖（走用户主路径：拖绿线），而不是直接调 RPC。
    await dragGreenLine(page, 5);
    await expect
      .poll(async () => (await readColumns(page))[0]?.axis_stroke_px ?? null, {
        message: '前置：拖绿线后必须产生列级覆盖',
        timeout: 15_000,
      })
      .not.toBeNull();
    const override = Number((await readColumns(page))[0]?.axis_stroke_px);

    const groups = await readGroups(page);
    const cols = await readColumns(page);
    const groupStroke =
      Number(groups.groups.find((g) => g.id === cols[0].x_group_id)?.axis_stroke_px ?? 5) || 5;
    expect(override, '前置：覆盖值必须与组值不同，否则「回到组值」看不出变化').not.toBe(groupStroke);

    const btn = page.locator('#btn-clear-col-axis-stroke');
    await expect(btn, '有列级覆盖时必须给出显式的「回到组值」入口').toBeVisible();
    await btn.click();

    // ① 后端字段被清成 null（不是写 0）
    await expect
      .poll(async () => (await readColumns(page))[0]?.axis_stroke_px ?? null, {
        message: '点「回到组值」后列级 axis_stroke_px 必须被清空（null）',
        timeout: 15_000,
      })
      .toBeNull();

    // ② 面板「仅本列」跟着清空，且按钮自己消失（已无覆盖可清）
    await expect(page.locator('#inp-col-axis-stroke')).toHaveValue('');
    await expect(page.locator('#btn-clear-col-axis-stroke')).toHaveCount(0);

    // ③ 绿线回到 startX + 组轴粗
    const view = await page.evaluate(() => {
      const api = (window as unknown as { __straditize: { getState: () => any } }).__straditize;
      const s = api.getState();
      return { startX: Number(s.columns[0].startX) };
    });
    const measured = await greenLineWorldX(page, view.startX + groupStroke);
    console.log(
      `[S5] 覆盖 ${override}→null；绿线世界 x 实测 ${measured.toFixed(2)}（期望 ${view.startX + groupStroke}）`
    );
    expect(
      Math.abs(measured - (view.startX + groupStroke)),
      `清除覆盖后绿线必须回到 startX(${view.startX}) + 组轴粗(${groupStroke})`
    ).toBeLessThanOrEqual(1.2);
  });

  test('S6 步骤 6 的画布图例里有一句「拖绿线改本列 / 组参数改整组」', async ({ page }) => {
    const hint = page.locator('.canvas-legend [data-role="hint-zero-drag"]');
    await expect(hint, '步骤 6 必须在画布内给出两级轴粗的提示').toBeVisible();
    await expect(hint).toContainText('本列');
    await expect(hint).toContainText('整组');

    // 必须落在画布容器内（不是面板里），且不拦截鼠标（pointer-events: none）。
    const placement = await page.evaluate(() => {
      const hintEl = document.querySelector('.canvas-legend [data-role="hint-zero-drag"]');
      const legend = document.querySelector('.canvas-legend');
      const canvas = document.querySelector('#geology-canvas');
      return {
        insideCanvasContainer: Boolean(hintEl && canvas && canvas.parentElement?.contains(hintEl)),
        pointerEvents: legend ? getComputedStyle(legend).pointerEvents : '',
      };
    });
    expect(placement.insideCanvasContainer, '提示必须在画布容器内').toBe(true);
    expect(placement.pointerEvents, '图例不得拦截画布上的鼠标（否则拖不动绿线）').toBe('none');

    // 负向对照：步骤 5 还不该讲这件只有步骤 6 能做的事。
    await gotoStage(page, 5);
    await expect(hint).toBeHidden();
  });

});

test.describe('组属性写入失败必须冒泡给用户', () => {
  // 本组故意让后端失败：失败提示与失败 RPC 都由本组声明豁免。
  test.use({ allowlists: { notice: [/保存列组属性失败/], rpcError: [/forced-failure/] } });

  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);
    await openStep6GroupsFold(page);
  });

  test('S2 后端拒绝时必须冒泡给用户（不许 void 吞掉）', async ({ page }) => {
    const { groups, defaultId } = await readGroups(page);
    const gid = defaultId ?? groups[0].id;

    // 让 roi.groupUpdate 一律失败：用户看到"点了没反应"是旧实现的形态，
    // 修好之后必须出现一条明确的错误提示。
    await page.route('**/rpc', async (route) => {
      const raw = route.request().postData();
      let body: any = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      if (body?.method === 'roi.groupUpdate') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: body.id ?? 1,
            error: { code: -32602, message: 'forced-failure' },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.locator(`.btn-switch-group-tab[data-group-id="${gid}"]`).click();
    const input = page.locator('#inp-axis-stroke');
    await input.fill('1');
    await input.dispatchEvent('change');

    await expect
      .poll(
        async () =>
          page.evaluate(() => document.body.innerText.includes('保存列组属性失败')),
        { message: '组属性写入失败必须弹出用户可见的报错', timeout: 15_000 }
      )
      .toBe(true);

    // 失败后乐观值必须撤掉：继续显示 1 等于骗用户"已经设上了"。
    await expect(input, '写入失败后不得继续显示乐观值 1').not.toHaveValue('1');
    expect(groups.find((g) => g.id === gid)?.axis_stroke_px ?? null).toBeNull();
  });
});