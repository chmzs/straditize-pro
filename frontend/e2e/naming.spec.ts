/**
 * Step 5 分列 / 属种命名与区间标签对账 —— 迁移自旧 tests/e2e/test_naming.py。
 *
 * 旧测试有三条断言是**自证式**的：它把 `label_assign` / `without_label` /
 * `without_column` 直接写成测试自己 JS 里的字符串常量（`'label_001=col_3,label_002=col_4'`
 * 等），再断言这三个常量等于同样的字面量。它们既没读后端、也没读 DOM，
 * 无论产品怎么坏都恒为真。
 *
 * 这里把它们换成后端真实计算结果的断言：区间归属由 `naming.snapLabels` 落到
 * `snap_labels_to_columns`（契约 §8：锚点落在 [startX, endX) 内、数量不匹配则整体拒绝配对、
 * 三类对账）。把列集合作为 RPC 入参直接传入，就不必再伪造 `session.columns`。
 *
 * 旧测试里真正有效的一条是"逐列点名高亮必须给出一个真实列标识"（它自己也注释说
 * 多 ROI 后 id 形态会从 col_7 变成 roi_3_col01，所以只钉形态）。这条保留并加强为
 * "高亮值必须真的存在于后端当前的列集合里"。
 */
import { expect, test } from '@playwright/test';
import {
  diagramData,
  expectNoDialogs,
  gotoStage,
  resetBaseline,
  rpc,
  watchPage,
  type PageTelemetry,
} from './helpers';

/** 旧测试摆的三列：col_3 [100,200)、col_4 [200,300)、col_7 [300,400)。 */
const STAGED_COLUMNS = [
  { id: 'col_3', col_index: 0, name: 'Taxa3', start: 100, end: 200, startX: 100, endX: 200 },
  { id: 'col_4', col_index: 1, name: 'Taxa4', start: 200, end: 300, startX: 200, endX: 300 },
  { id: 'col_7', col_index: 2, name: 'Taxa7', start: 300, end: 400, startX: 300, endX: 400 },
];

interface Label {
  id: string;
  anchor_x: number;
  bbox?: number[][];
  associated_column_id?: string | null;
  associated_column_index?: number | null;
  associated_column_name?: string | null;
}

interface Reconciliation {
  columns_without_label: string[];
  labels_without_column: string[];
  ambiguous: string[];
  matched: boolean;
}

interface SnapResult {
  labels: Label[];
  reconciliation: Reconciliation;
}

let telemetry: PageTelemetry = { consoleErrors: [], dialogs: [] };

test.describe('Step 5 分列与属种命名', () => {
  test.beforeEach(async ({ page }) => {
    telemetry = watchPage(page);
    await resetBaseline(page);
  });

  test('区间归属对账：标签数不匹配必须整体拒绝配对，缺标签列/列外标签分别点名', async ({ page }) => {
    // 注意默认值必须给出具体数组：`JSON.stringify` 会把值为 undefined 的键整个丢掉，
    // 于是 `{columns: undefined}` 到后端就变成"没传 columns"→ 退回会话里的真实列，
    // 断言就会莫名其妙地拿到 29 个 roi_1_colNN。
    const snap = (labels: Label[], columns: typeof STAGED_COLUMNS = STAGED_COLUMNS) =>
      rpc<SnapResult>(page, 'naming.snapLabels', { labels, columns });

    // 2 个标签对 3 列：数量不匹配 → 按契约整体拒绝配对，associated_column_* 全部保持 null，
    // 并点名没被覆盖的 col_7。旧测试写死的 'label_001=col_3,label_002=col_4' / 'col_7'
    // 正是这三个值，但它从未真的算过。
    const twoLabels = await snap([
      { id: 'label_001', anchor_x: 150 },
      { id: 'label_002', anchor_x: 250 },
    ]);
    expect(twoLabels.reconciliation.columns_without_label).toEqual(['col_7']);
    expect(twoLabels.reconciliation.labels_without_column).toEqual([]);
    expect(twoLabels.reconciliation.ambiguous).toEqual([]);
    expect(twoLabels.reconciliation.matched, '数量不等时必须拒绝配对').toBe(false);
    expect(
      twoLabels.labels.map((l) => l.associated_column_id),
      '拒绝配对时不得残留任何归属'
    ).toEqual([null, null]);
    expect(twoLabels.labels.map((l) => l.associated_column_index)).toEqual([null, null]);

    // 3 个标签逐列命中，才允许 1:1 配对。
    const threeLabels = await snap([
      { id: 'label_001', anchor_x: 150 },
      { id: 'label_002', anchor_x: 250 },
      { id: 'label_003', anchor_x: 350 },
    ]);
    expect(threeLabels.reconciliation.matched).toBe(true);
    expect(threeLabels.reconciliation.columns_without_label).toEqual([]);
    expect(threeLabels.labels.map((l) => l.associated_column_id)).toEqual([
      'col_3',
      'col_4',
      'col_7',
    ]);
    expect(threeLabels.labels.map((l) => l.associated_column_index)).toEqual([0, 1, 2]);

    // 锚点 450 落在 col_7 的 [300,400) 之外 → 必须进"列外标签"，不得硬塞给最近的列。
    const outside = await snap([
      { id: 'label_001', anchor_x: 150 },
      { id: 'label_002', anchor_x: 250 },
      { id: 'label_003', anchor_x: 450 },
    ]);
    expect(outside.reconciliation.labels_without_column).toEqual(['label_003']);
    expect(outside.reconciliation.matched).toBe(false);

    // 标签横向跨过列边界：仍归锚点所在列，同时记入歧义供人工复核。
    const crossing = await snap([
      { id: 'label_001', anchor_x: 150 },
      { id: 'label_002', anchor_x: 250, bbox: [[250, 0], [310, 10]] },
      { id: 'label_003', anchor_x: 350 },
    ]);
    expect(crossing.reconciliation.ambiguous).toEqual(['label_002']);
    expect(crossing.labels[1].associated_column_id, '跨界标签仍归锚点所在列').toBe('col_4');

    // 不传 columns 时必须退回到会话里的真实列。先真的推进到 Step 5（会触发后端重新分列），
    // 再断言"缺标签列"恰好等于后端当前的列集合 —— 这条把函数与真实会话绑在一起。
    await gotoStage(page, 5);
    const live = await diagramData<{ columns: { id: string }[] }>(page);
    const liveIds = live.columns.map((c) => c.id).sort();
    expect(liveIds.length, 'Step 5 重新分列后应至少有一列').toBeGreaterThan(0);
    const noLabels = await rpc<SnapResult>(page, 'naming.snapLabels', { labels: [] });
    expect(noLabels.reconciliation.columns_without_label).toEqual(liveIds);

    expectNoDialogs(telemetry);
  });

  test('Step 5 面板：逐列点名高亮必须指向后端当前真实存在的列', async ({ page }) => {
    await gotoStage(page, 5);

    const panel = page.locator('.step-panel[data-step="5"]');
    await expect(panel).toBeVisible();

    const data = await diagramData<{ columns: { id: string }[]; activeTaxaId: string }>(page);
    expect(data.columns.length, '真实分列后应存在属种列').toBeGreaterThan(0);

    // 旧测试只钉了 id 形态（多 ROI 之后由 col_7 变成 roi_3_col01）。这里加强：
    // 高亮值必须真的出现在后端当前列集合里，"指向一个已不存在的列"也要能被抓到。
    const highlight = (await page.locator('#naming-sequential-highlight').innerText()).trim();
    expect(
      data.columns.map((c) => c.id),
      `逐列点名高亮 ${highlight} 必须存在于后端列集合`
    ).toContain(highlight);
    expect(highlight, '高亮必须是一个真实列标识').toMatch(/^(?:roi_\d+_)?col_?\d+$/);
    await expect(panel).toHaveAttribute('data-highlight-col', highlight);

    // 侧栏逐列点名输入框获得焦点时应切到对应列（旧测试注释里声称的行为）。
    // 旧测试点的是 data-col-id="col_7" —— 那只存在于它自己伪造的 session.columns 里，
    // Step 5 一重新分列就没了，所以那个 focus 永远落空；这里用真实列 id。
    const other = data.columns.find((c) => c.id !== highlight);
    if (!other) throw new Error(`后端只给出了 1 列（${highlight}），无法验证点名切换`);
    await page.locator(`input.taxa-name-inline-input[data-col-id="${other.id}"]`).focus();
    await expect(
      page.locator('#naming-sequential-highlight'),
      '侧栏点名后，Step 5 面板的高亮必须跟着切到该列'
    ).toHaveText(other.id);

    expectNoDialogs(telemetry);
  });
});
