/**
 * 步骤 4「检测横线 / 检测竖线」两个勾选框的 e2e 门禁。
 *
 * ## 判据盯的是 `kind`，不是"列表变短"
 *
 * 用户需求原话：「竖线大多不用检测，可以一键取消勾选竖线」。真正的失败形态不是
 * "条数没变"，而是**取消了勾选却仍返回竖线候选**（开关没透传到后端），或者
 * **取消竖线顺手把横线一起弄没了**（关错一类）。所以这里一律断言候选的
 * `kind`（`A`=贯穿横线，`B`=贯穿竖线，`C`=列内竖线）与 `(kind, at)` 集合，
 * 而不是行数。
 *
 * ## 前置为什么要把列删光
 *
 * hoya 的 29 条列轴被 `_is_column_axis` 按结构判据排除（见
 * `tests/unit/test_line_candidates_column_axis.py`），于是**已分列**状态下竖线
 * 恒为 0 —— 在那个状态上验"取消勾选后竖线为 0"是无判别力的空断言（真开关没透传
 * 也会绿）。删掉列之后后端不知道轴在哪，竖线候选真的会出现（实测 14 条）。
 * 删列走真实 RPC `column.remove`，不改后端、不 mock、不加时间等待。
 *
 * ## 为什么每次交互前都要 `settle()`
 *
 * 后端落库与面板重挂不是同一时刻（`applyCleanupState` 之后整个面板重建）。点击
 * 落在替换窗口里会"既不报错也不生效"，于是断言的失败原因与代码无关。面板候选行数
 * 追上后端几何数，就是这条窗口关闭的可观测信号。
 */
import { expect, test } from './fixtures';
import { gotoStage, resetBaseline, rpc } from './helpers';

interface LineCandidate {
  id: string;
  kind: 'A' | 'B' | 'C';
  axis: 'h' | 'v';
  at: number;
  status: 'candidate' | 'removed';
  roi_id: string;
}

interface DiagramData {
  columns: { id: string }[];
  line_candidates: LineCandidate[];
}

const PANEL = '.step-panel[data-step="4"]';
const read = (page: Parameters<typeof rpc>[0]) => rpc<DiagramData>(page, 'straditize.getDiagramData');

/** 竖线 = `kind` 为 B（贯穿网格线）或 C（列内短竖线）；横线 = A。 */
const verticals = (candidates: LineCandidate[]) => candidates.filter((c) => c.kind !== 'A');
const horizontals = (candidates: LineCandidate[]) => candidates.filter((c) => c.kind === 'A');
/** 集合口径：排序后的 `(kind, at)`，用来发现"掉一条又补一条"。 */
const keySet = (candidates: LineCandidate[]) =>
  candidates.map((c) => `${c.kind}@${c.at}`).sort();

async function settle(page: Parameters<typeof rpc>[0]): Promise<void> {
  await expect
    .poll(
      async () => {
        const backend = (await read(page)).line_candidates.length;
        return (await page.locator('.cleanup-row').count()) === backend;
      },
      {
        message: '面板候选行数必须已追上后端几何数（否则点击会打在正在替换的节点上）',
        timeout: 20_000,
        intervals: [250],
      }
    )
    .toBe(true);
}

/** 进入步骤 4，并把列删光 —— 让竖线候选真的存在（见文件头"前置"）。 */
async function openStep4WithVerticals(page: Parameters<typeof rpc>[0]): Promise<void> {
  const columns = (await read(page)).columns;
  expect(columns.length, '前置：hoya 基线应有列，否则本判据的前置不成立').toBeGreaterThan(0);
  for (let i = 0; i < columns.length; i += 1) {
    await rpc(page, 'column.remove', { col_index: 0 });
  }
  await gotoStage(page, 4);
  await expect(page.locator(PANEL)).toBeVisible();
  await settle(page);
}

/** 走面板按钮检测，返回后端落库后的候选（真实用户路径）。 */
async function detectViaPanel(page: Parameters<typeof rpc>[0]): Promise<LineCandidate[]> {
  await settle(page);
  await page.locator('#btn-detect-candidates').click();
  await expect
    .poll(async () => (await read(page)).line_candidates.length, {
      message: '点检测后后端应产出候选几何',
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await settle(page);
  return (await read(page)).line_candidates;
}

/** 走面板按钮清空本步几何，回到"未检测"状态。 */
async function clearViaPanel(page: Parameters<typeof rpc>[0]): Promise<void> {
  await settle(page);
  await page.locator('#btn-clear-cleanup-edits').click();
  await expect
    .poll(async () => (await read(page)).line_candidates.length, {
      message: '清空本步编辑后后端不应再有几何',
      timeout: 30_000,
    })
    .toBe(0);
  await settle(page);
}

test.describe('步骤 4 横/竖线检测开关', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('取消勾选「检测竖线」后不再产出竖线候选，重新勾选后竖线候选回来（按 kind 断言）', async ({
    page,
  }) => {
    await openStep4WithVerticals(page);

    // ---- 前置：两项都勾（默认）时，横线与竖线都必须真的被检出 ----
    const both = await detectViaPanel(page);
    expect(
      horizontals(both).length,
      `前置：默认检测应产出横线候选，实测 kinds=${keySet(both)}`
    ).toBeGreaterThan(0);
    expect(
      verticals(both).length,
      `前置：删列后默认检测应产出竖线候选，实测 kinds=${keySet(both)}`
    ).toBeGreaterThan(0);
    const bothHorizontals = keySet(horizontals(both));
    const bothVerticals = keySet(verticals(both));

    // ---- 取消勾选「检测竖线」→ 竖线必须一条都没有，横线集合不变 ----
    await clearViaPanel(page);
    const verticalBox = page.locator('#chk-detect-vertical');
    await expect(verticalBox, '面板必须提供「检测竖线」勾选框').toBeVisible();
    await expect(verticalBox, '默认应勾选').toBeChecked();
    await verticalBox.uncheck();
    await expect(verticalBox, '取消勾选后 DOM 状态必须跟着变').not.toBeChecked();

    const onlyHorizontals = await detectViaPanel(page);
    expect(
      verticals(onlyHorizontals),
      `取消勾选竖线后仍返回了竖线候选（kinds=${keySet(onlyHorizontals)}）——` +
        '开关没有透传到后端，或后端在生成后才过滤'
    ).toEqual([]);
    expect(
      keySet(horizontals(onlyHorizontals)),
      '关掉竖线不得影响横线候选集合（掉一条又补一条也算变）'
    ).toEqual(bothHorizontals);

    // DOM 侧同一件事：列表里不能有竖线行（`data-cand-kind` 由面板渲染时写入）
    expect(
      await page.locator('.cleanup-row[data-cand-kind="B"], .cleanup-row[data-cand-kind="C"]').count(),
      '面板列表里仍有竖线行'
    ).toBe(0);

    // ---- 重新勾选 → 竖线候选必须回来，且与第一次的集合相同 ----
    await clearViaPanel(page);
    await verticalBox.check();
    await expect(verticalBox, '重新勾选后 DOM 状态必须跟着变').toBeChecked();
    const again = await detectViaPanel(page);
    expect(
      keySet(verticals(again)),
      '重新勾选竖线后竖线候选没有回到原来的集合——开关只单向生效，或状态在重渲染时被打回默认'
    ).toEqual(bothVerticals);

    // 勾选状态在重挂之后仍然保持（面板会因 applyCleanupState 整块重建）
    await expect(verticalBox, '重挂后勾选状态不应被打回默认').toBeChecked();
  });

  test('取消勾选「检测横线」后不再产出横线候选，竖线集合不变', async ({ page }) => {
    await openStep4WithVerticals(page);

    const both = await detectViaPanel(page);
    const bothVerticals = keySet(verticals(both));
    expect(bothVerticals.length, '前置：删列后应检出竖线候选').toBeGreaterThan(0);

    await clearViaPanel(page);
    const horizontalBox = page.locator('#chk-detect-horizontal');
    await expect(horizontalBox, '面板必须提供「检测横线」勾选框').toBeVisible();
    await horizontalBox.uncheck();

    const onlyVerticals = await detectViaPanel(page);
    expect(
      horizontals(onlyVerticals),
      `取消勾选横线后仍返回了横线候选（kinds=${keySet(onlyVerticals)}）`
    ).toEqual([]);
    expect(keySet(verticals(onlyVerticals)), '关掉横线不得影响竖线候选集合').toEqual(bothVerticals);
  });

  test('取消勾选只影响下一次检测：已检出的候选留在列表里，并给出条数与重新检测提示', async ({
    page,
  }) => {
    await openStep4WithVerticals(page);

    const both = await detectViaPanel(page);
    const verticalCount = verticals(both).length;
    expect(verticalCount, '前置：应有竖线候选可提示').toBeGreaterThan(0);
    const rowsBefore = await page.locator('.cleanup-row').count();

    // 只取消勾选，不点检测：列表不得变化（否则用户会以为丢数据）
    await page.locator('#chk-detect-vertical').uncheck();
    await expect
      .poll(async () => page.locator('.cleanup-row').count(), {
        message: '取消勾选不得删除已检出的候选',
        timeout: 10_000,
      })
      .toBe(rowsBefore);

    const hint = page.locator('#cleanup-orientation-hint');
    await expect(hint, '当前列表仍有被取消勾选的那一类时必须提示').toContainText(
      `当前列表仍有 ${verticalCount} 条竖线候选`
    );
    await expect(hint).toContainText('如需仅看横线请重新检测');

    // 重新勾选：提示消失（提示是条件性的，不能常驻）
    await page.locator('#chk-detect-vertical').check();
    await expect(hint, '重新勾选后提示必须消失').toHaveText('');
  });
});
