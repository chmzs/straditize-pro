/**
 * B2：删除「有列的 ROI」在 UI 上必须可达（旧实现是死路）。
 *
 * ## 缺陷
 *
 * 后端 `roi.remove` 对"该 ROI 下有列且未确认"返回 `-32002`，要求调用方带
 * `confirm_drop_columns: true` 重试（`session_parts/roi.py:303-309`）。
 * 前端没有任何确认通道，永远只发 `{ roi_id }` ⇒ 这条删除**永远做不到**：用户点删除
 * 只拿到一条"请带 confirm_drop_columns=true 重试"的报错，而界面上没有地方能确认。
 *
 * ## 判据（全部读后端 `straditize.getDiagramData`，DOM 只用来操作与定位）
 *
 * 1. 点删除**不得**落进 -32002 死路：必须出现 `#ui-confirm-modal`，文案含真实列数；
 * 2. **取消**：ROI 数、列数都不变，且**一条 `roi.remove` 请求都没发出**（不许
 *    "先试着删，失败了再问"）；
 * 3. **确认**：ROI 少一个、它的列全部消失，**另一个 ROI 的列逐值不变**
 *    （级联不许误伤别人）。
 *
 * 被删 ROI 的列数是 28（`e2e.reset` 预跑分列），另一个 ROI 故意也带 1 列，
 * 这样"其它 ROI 逐值不变"才有内容可断，不是对空集恒真。
 */
import { expect, test, type Page } from './fixtures';
import { diagramData, gotoStage, resetBaseline, rpc } from './helpers';

interface ColumnLite {
  id: string;
  name?: string;
  roi_id?: string;
  startX: number;
  endX: number;
}
interface WireData {
  rois: Array<{ id: string; name?: string }>;
  columns: ColumnLite[];
}

// hoya 基线的数据区（`support/serve_e2e_backend.py` 的 HOYA_X_BOUNDS / HOYA_Y_BOUNDS）。
const DATA_X0 = 315;
const DATA_X1 = 1946;
const DATA_Y0 = 511;
const DATA_Y1 = 1311;

const backend = (page: Page): Promise<WireData> => diagramData<WireData>(page);

const columnsOf = (data: WireData, roiId: string): ColumnLite[] =>
  data.columns.filter((c) => c.roi_id === roiId);

/**
 * 列的**用户可见值**签名：名 + 起止像素。
 *
 * 为什么不用 `id`：`column.add` 造的列在会话里**没有 id**，payload 用
 * `taxa_{col_index}` 现合成（`rpc_methods/system.py:291` 明文记着这一点）。
 * 级联删掉另一个 ROI 的 28 列后 `_reindex_columns` 会重编号（0..27 变 0），
 * 于是同一列前后 id 从 `taxa_28` 变成 `taxa_0` —— 拿 id 断言"逐值不变"是在断言
 * 一个按定义会漂移的合成名，只会得到假红，测不到"级联误伤"这件真事。
 */
const valueSignatureOf = (cols: ColumnLite[]): string[] =>
  cols
    .map((c) => `${c.name ?? ''}@${c.startX}..${c.endX}`)
    .sort((a, b) => a.localeCompare(b));

test.describe('B2 删除有列的 ROI：先确认，再级联，且只级联自己', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('点删除 → 确认（含列数）→ 取消零写请求 / 确认只级联本 ROI', async ({ page }) => {
    await gotoStage(page, 2);
    const panel = page.locator('.step-panel[data-step="2"]');

    const before = await backend(page);
    expect(before.rois.map((r) => r.id), '基线应只有一个 ROI').toEqual(['roi_1']);
    const doomedBefore = columnsOf(before, 'roi_1');
    expect(doomedBefore.length, '基线 ROI 必须真有列，否则测的不是"有列"这条死路').toBeGreaterThan(
      0
    );

    // 删除按钮只在 ROI 数 > 1 时渲染：先建第二个 ROI，并给它 1 列（反例对照组）。
    await panel.locator('#btn-create-roi').click();
    await expect
      .poll(async () => (await backend(page)).rois.length, {
        message: '新建后后端 ROI 数应为 2',
        timeout: 15_000,
      })
      .toBe(2);
    const survivorId = (await backend(page)).rois.find((r) => r.id !== 'roi_1')!.id;

    // 新建 ROI 是**零面积壳**（`InspectorBridge.onCreateRoi` 刻意不传边界，产品决策 ③：
    // 新建即待用户框选，不克隆当前分区）。零面积壳里加列会被后端判
    // 「Column ... lies entirely outside the data ROI (x 0..0)」(-32602)，
    // 所以这里先给它一个真实数据区（同 hoya 基线 315..1946 × 511..1311），再建列。
    await rpc(page, 'roi.update', {
      roi_id: survivorId,
      x0: DATA_X0,
      x1: DATA_X1,
      y0: DATA_Y0,
      y1: DATA_Y1,
    });
    // `column.add` 不接收 roi_id（就地把未知键丢弃），归属只能靠 `column.update` 写进去
    // ——与 `export.spec.ts:136` 记的同一处口径。
    const added = await rpc<{ col_index: number }>(page, 'column.add', {
      column: { name: 'Survivor', startX: 400, endX: 460 },
    });
    await rpc(page, 'column.update', {
      col_index: added.col_index,
      updates: { roi_id: survivorId },
    });
    await expect
      .poll(async () => columnsOf(await backend(page), survivorId).length, {
        message: '对照组 ROI 必须真的有 1 列（否则"不误伤别人"是对空集断言）',
        timeout: 15_000,
      })
      .toBe(1);
    const survivorColsBefore = valueSignatureOf(columnsOf(await backend(page), survivorId));

    // 记录所有 ROI 写请求，用来断言"取消 = 零写"。
    const roiRemoveRequests: string[] = [];
    page.on('request', (req) => {
      if (!req.url().includes('/rpc')) return;
      const body = req.postData() ?? '';
      if (body.includes('"roi.remove"')) roiRemoveRequests.push(body);
    });

    // ── ① 点删除 → 必须出现确认框
    await panel.locator('.btn-delete-roi[data-roi-id="roi_1"]').click();
    const confirm = page.locator('#ui-confirm-modal');
    await expect(confirm, '删除有列的 ROI 必须先给确认机会，而不是弹 -32002').toBeVisible({
      timeout: 10_000,
    });
    await expect(
      confirm,
      `确认框必须写明会连带删除多少列（实际 ${doomedBefore.length} 列）`
    ).toContainText(String(doomedBefore.length));

    // ── ② 取消：两样都不变，且零写请求
    await page.locator('#ui-confirm-cancel').click();
    await expect(confirm).toHaveCount(0);
    const afterCancel = await backend(page);
    expect(afterCancel.rois.length, '取消后 ROI 数不得变化').toBe(2);
    expect(columnsOf(afterCancel, 'roi_1').length, '取消后列数不得变化').toBe(
      doomedBefore.length
    );
    expect(roiRemoveRequests, '取消不得发出任何 roi.remove 请求（零写）').toEqual([]);

    // ── ③ 确认：只级联删本 ROI
    await panel.locator('.btn-delete-roi[data-roi-id="roi_1"]').click();
    await expect(page.locator('#ui-confirm-modal')).toBeVisible({ timeout: 10_000 });
    await page.locator('#ui-confirm-ok').click();

    await expect
      .poll(async () => (await backend(page)).rois.map((r) => r.id), {
        message: '确认后后端应只剩对照 ROI',
        timeout: 15_000,
      })
      .toEqual([survivorId]);

    const afterConfirm = await backend(page);
    expect(columnsOf(afterConfirm, 'roi_1').length, '被删 ROI 的列必须真被级联删除').toBe(0);
    expect(
      valueSignatureOf(columnsOf(afterConfirm, survivorId)),
      '另一个 ROI 的列必须逐值不变（级联不许误伤）'
    ).toEqual(survivorColsBefore);
    expect(afterConfirm.columns.length, '列集里不得留下悬挂列').toBe(survivorColsBefore.length);
  });
});
