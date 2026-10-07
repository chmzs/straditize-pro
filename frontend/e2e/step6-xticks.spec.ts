/**
 * 步骤 6（标定列与 X 刻度）逐动作门禁。
 *
 * ## 为什么必须单独补这一份
 *
 * 步骤 6 此前在 e2e 里完全不存在。逐个动作排查后，本步面板的 6 个控件里有
 * **4 个从未被任何测试碰过**，而且两条用户主路径是断的：
 *
 * ① **【保存】一个请求都不发。** `#btn-save-manual-ticks` 只把值写进
 *    `activeCol.x_ticks` 内存，从不发 RPC（实测点击后后端收到的 RPC 列表为空）。
 *    于是"标定成功"只活到下一次重取为止：切步骤、重分列、载入工程都会丢。
 * ② **【清空】按钮从来渲染不出来。** 面板靠 `hasTicks = x_ticks && length===2`
 *    决定是否渲染 `#btn-clear-col-ticks`，而后端 `getDiagramData` 的列载荷白名单
 *    里根本没有 `x_ticks` 字段——前端拿到的永远是 `undefined`，`hasTicks` 恒为
 *    false。实测该按钮在画布上出现次数为 **0**。
 *
 * 两头堵上之后，本文件钉住三件事：**动作真的到达后端**、**状态真的读得回来**、
 * **失败真的冒泡给用户**。
 *
 * ## 判据一律读后端权威字段
 *
 * 所有断言走 `straditize.getDiagramData`（后端列对象）或**真实重载页面**，
 * 不读 `window.__straditize` 里的前端镜像——否则"前端改了、后端没改"恰恰是绿的。
 * T4 之所以要 reload 而不是切步骤：重载会把前端所有内存清空，`x_ticks` 还在，
 * 就只能是因为它真的写进了后端会话。
 *
 * ## 像素端点来自列几何，不是用户输入
 *
 * 面板只让用户填两个**读数**，像素端点取 `startX` 与 `tickEndX ?? endX`
 * （列左边界与标尺终点）。所以断言的期望值必须由列几何算出，写死数字会在
 * 换图后变成假绿。
 */
import { expect, test } from './fixtures';
import { diagramData, getState, gotoStage, openApp, resetBaseline } from './helpers';
import type { Page } from '@playwright/test';

interface Tick {
  px: number;
  value: number;
}

interface BackendColumn {
  id: string;
  name?: string;
  col_index?: number;
  startX?: number;
  endX?: number;
  tickEndX?: number;
  unit?: string;
  x_ticks?: Tick[] | null;
}

const SAVE_BTN = '.step-panel[data-step="6"] #btn-save-manual-ticks';
const CLEAR_BTN = '.step-panel[data-step="6"] #btn-clear-col-ticks';
const VAL1 = '.step-panel[data-step="6"] #inp-manual-tick-val1';
const VAL2 = '.step-panel[data-step="6"] #inp-manual-tick-val2';

/** 后端权威列清单（`straditize.getDiagramData`）。 */
async function columns(page: Page): Promise<BackendColumn[]> {
  return (await diagramData<{ columns: BackendColumn[] }>(page)).columns;
}

/** 面板认的那一列：与 `XTicksPanel.render` 的选列规则保持一致。 */
async function panelColumn(page: Page): Promise<BackendColumn> {
  const { columns: cols, activeTaxaId } = await diagramData<{
    columns: BackendColumn[];
    activeTaxaId: string;
  }>(page);
  return cols.find((c) => c.id === activeTaxaId) ?? cols[0];
}

/** 面板算出的一对像素端点（列左边界 → 标尺终点）。 */
function expectedPx(col: BackendColumn): [number, number] {
  return [col.startX as number, (col.tickEndX ?? col.endX) as number];
}

/**
 * 收集发往后端的 JSON-RPC 方法名。
 *
 * 这条观测本身是判据：缺陷 ① 的特征就是"点了按钮，但请求列表为空"——
 * 只断言后端字段变了是不够的（先前的假绿正是这么来的）。
 */
function watchRpc(page: Page): string[] {
  const methods: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
    try {
      const body = req.postDataJSON() as { method?: string };
      if (body?.method) methods.push(body.method);
    } catch {
      /* 非 JSON 体不关心 */
    }
  });
  return methods;
}

/** 走真实 UI 标定当前列：填两个读数 → 点【保存】。 */
async function calibrateViaUI(page: Page, val1: string, val2: string): Promise<void> {
  await page.locator(VAL1).fill(val1);
  await page.locator(VAL2).fill(val2);
  await page.locator(SAVE_BTN).click();
}

/**
 * 真实重载：前端内存全清，只留后端会话。
 *
 * 两件准备工作缺一不可：
 * - 抑制 `beforeunload`（有未保存改动时它会拦下 reload，测试会假死在 60s 超时）；
 * - 清掉自动草稿，否则开机横幅可能把前端镜像塞回来，断言就退化成"localStorage 里有"，
 *   无法证伪"后端有"。用前缀匹配而非写死键名，键名改了也不会悄悄失去这层保护。
 *
 * ⚠️ 这里**不能**用"离开到步骤 5 再回来"来制造重渲染：进入步骤 5 会发
 * `core.detectColumns` 重新分列，而重新分列目前会**静默抹掉全部列的 x_ticks**
 * （实测：标定后 `[{px:322,value:0},{px:497,value:40}]` → 重新分列后 `null`）。
 * 那是另一个待决缺陷，不该混进本文件的判据里。
 */
async function reloadFresh(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __straditize_suppress_beforeunload?: () => void })
      .__straditize_suppress_beforeunload?.();
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('straditize_autosave')) localStorage.removeItem(k);
    }
  });
  await page.reload();
  await openApp(page);
}

test.describe('步骤 6 标定列与 X 刻度', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('T1 【保存】真的发 RPC 并把 x_ticks 写进后端（此前一个请求都不发）', async ({
    page,
    telemetry,
  }) => {
    await gotoStage(page, 6);
    const col = await panelColumn(page);
    const [px1, px2] = expectedPx(col);
    expect(col.x_ticks ?? null, '前置条件：该列初始必须是未标定').toBeNull();

    const methods = watchRpc(page);
    await calibrateViaUI(page, '0', '40');

    await expect
      .poll(async () => (await panelColumn(page)).x_ticks, {
        message: '【保存】必须把标定写进后端列对象（此前后端字段纹丝不动）',
        timeout: 10_000,
      })
      .toEqual([
        { px: px1, value: 0 },
        { px: px2, value: 40 },
      ]);

    expect(
      methods,
      '判据是"这个动作发了什么请求"：必须真的发出 column.calibrateXTicks'
    ).toContain('column.calibrateXTicks');
    expect(telemetry.notices, '正常标定不该出现任何用户通知').toEqual([]);
    expect(telemetry.rpcErrors).toEqual([]);
  });

  test('T2 标定后【清空】按钮出现，点击后后端回到未标定（此前该按钮恒不渲染）', async ({
    page,
    telemetry,
  }) => {
    await gotoStage(page, 6);
    const col = await panelColumn(page);
    const [px1, px2] = expectedPx(col);

    // 缺陷 ② 的前置断言：未标定时按钮本来就不该在。
    await expect(page.locator(CLEAR_BTN), '未标定时不该出现【清空】').toHaveCount(0);

    await calibrateViaUI(page, '0', '40');
    await expect
      .poll(async () => (await panelColumn(page)).x_ticks, { timeout: 10_000 })
      .toEqual([
        { px: px1, value: 0 },
        { px: px2, value: 40 },
      ]);

    // 关键：让面板**按后端载荷重新渲染**一次。缺陷 ② 的特征就是载荷缺 x_ticks，
    // 于是无论重渲染多少次 `hasTicks` 都恒为 false（改前实测出现次数为 0）。
    await reloadFresh(page);
    await gotoStage(page, 6);
    await expect(
      page.locator(CLEAR_BTN),
      '已标定后必须渲染出【清空】——它此前因为载荷缺 x_ticks 而永不出现'
    ).toBeVisible();

    const methods = watchRpc(page);
    await page.locator(CLEAR_BTN).click();

    await expect
      .poll(async () => (await panelColumn(page)).x_ticks ?? null, {
        message: '【清空】必须真的清掉后端标定（此前只改前端内存）',
        timeout: 10_000,
      })
      .toBeNull();
    expect(methods, '【清空】必须发出 column.clearXTicks').toContain('column.clearXTicks');
    await expect(page.locator(CLEAR_BTN), '清空后按钮必须消失').toHaveCount(0);
    expect(telemetry.notices).toEqual([]);
  });

  test.describe('T3 空读数', () => {
    // 这是应用自己发出的用户可见错误，放行并断言它。
    test.use({ allowlists: { notice: [/标定列 X 刻度失败/], consoleError: [/标定列 X 刻度/] } });

    test('T3 空读数当场拦下：弹错误、不发 RPC、后端不变（绝不悄悄兜底成 0）', async ({
      page,
      telemetry,
    }) => {
      await gotoStage(page, 6);
      const before = await panelColumn(page);

      const methods = watchRpc(page);
      await calibrateViaUI(page, '', '');

      await expect.poll(() => telemetry.notices.length, { timeout: 10_000 }).toBe(1);
      expect(
        telemetry.notices[0],
        '空输入必须冒泡成用户可见的失败，而不是静默当成 0/20'
      ).toContain('标定列 X 刻度失败');

      expect(methods, '输入非法时不该把坏请求发到后端').not.toContain(
        'column.calibrateXTicks'
      );
      expect(
        (await panelColumn(page)).x_ticks ?? null,
        '被拒绝的标定绝不能留在后端'
      ).toBe(before.x_ticks ?? null);
    });
  });

  test('T4 真实重载页面后标定仍在（证伪"只活在浏览器内存里"）', async ({ page, telemetry }) => {
    await gotoStage(page, 6);
    const col = await panelColumn(page);
    const [px1, px2] = expectedPx(col);

    await calibrateViaUI(page, '5', '25');
    await expect
      .poll(async () => (await panelColumn(page)).x_ticks, { timeout: 10_000 })
      .toEqual([
        { px: px1, value: 5 },
        { px: px2, value: 25 },
      ]);

    // 重载 = 前端内存全清，`x_ticks` 还在就只能是因为它真的写进了后端会话。
    await reloadFresh(page);
    await gotoStage(page, 6);

    await expect(
      page.locator(VAL1),
      '重载后读数必须从后端种子回填（能存活就证明标定在后端会话里）'
    ).toHaveValue('5');
    await expect(page.locator(VAL2)).toHaveValue('25');
    expect(
      (await panelColumn(page)).x_ticks,
      '重载后后端标定必须原样存在'
    ).toEqual([
      { px: px1, value: 5 },
      { px: px2, value: 25 },
    ]);
    expect(telemetry.notices).toEqual([]);
  });

  test('T5 列载荷必须同时带 x_ticks 与 col_index（前端寻址与判定的依据）', async ({ page }) => {
    await gotoStage(page, 6);
    const cols = await columns(page);

    for (const c of cols.slice(0, 3)) {
      expect(c, `列 ${c.id} 的载荷缺 x_ticks：前端 hasTicks 会恒为 false`).toHaveProperty(
        'x_ticks'
      );
      expect(c.x_ticks ?? null, `列 ${c.id} 初始应为未标定（null）`).toBeNull();
      expect(
        typeof c.col_index,
        `列 ${c.id} 的载荷缺 col_index：前端无法稳定寻址列级 RPC`
      ).toBe('number');
    }

    // 前端镜像是从后端载荷建的，所以它也必须带着这两个字段。
    const st = await getState<{ columns: BackendColumn[] }>(page);
    expect(st.columns[0]).toHaveProperty('x_ticks');
    expect(typeof st.columns[0].col_index).toBe('number');
  });

  test('T6 属种列属性面板 (Inspector) 标定与形态修改必须真发 RPC 并落后端（缺陷 #23 回归）', async ({ page }) => {
    await gotoStage(page, 6);
    const rpcmethods = watchRpc(page);

    // 选中第一列，激活 Inspector 的 renderColumnInspector
    await page.evaluate(() => {
      const col = (window as any).__straditize.getState().columns[0];
      (window as any).__straditize.selectColumn(col.id);
    });

    // 确认 Inspector 切换到属种列属性
    const inspector = page.locator('.app-inspector');
    await expect(inspector.locator('#inp-sc-calib-val')).toBeVisible();

    // 1. 点击快捷刻度齿 50%
    await inspector.locator('.quick-tick-val-btn[data-val="50"]').click();
    await expect
      .poll(async () => (await panelColumn(page)).x_ticks, { timeout: 10_000 })
      .toEqual([
        expect.objectContaining({ value: 0 }),
        expect.objectContaining({ value: 50 }),
      ]);
    expect(rpcmethods).toContain('column.calibrateXTicks');

    // 2. 切换图表形态为柱状图 (bar)
    await inspector.locator('.quick-plottype-btn[data-type="bar"]').click();
    await expect
      .poll(async () => {
        const c = await panelColumn(page);
        return (c as any).plot_type ?? (c as any).plotType;
      }, { timeout: 10_000 })
      .toBe('bar');
    expect(rpcmethods).toContain('column.update');

    // 3. 开启局部放大曲线 (5x)
    await inspector.locator('#chk-has-exag').check();
    await expect
      .poll(async () => {
        const c = await panelColumn(page);
        return (c as any).exaggeration_mult ?? (c as any).exaggerationMult;
      }, { timeout: 10_000 })
      .toBe(5);
  });
});
