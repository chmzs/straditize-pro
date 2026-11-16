/**
 * Step 8 QA 诊断门禁 —— 迁移自旧 tests/e2e/test_qa.py。
 *
 * 旧套件靠直接往 Python 会话对象里塞 `session.roi_create(...)`、`session.column_points = {...}`、
 * `session.samples = [...]` 来伪造一张"已数字化完毕"的图谱。新套件的硬约束是
 * **面向用户的数据只能来自后端对用户输入的真实计算**（docs/ARCHITECTURE.md §2），
 * 所以这里不碰任何后端内存字段，而是走真实 RPC 造一张可控但真实的图谱：
 *
 *   roi.create / column.add / column.update（写 x_ticks）
 *     → core.digitize 真数字化
 *     → core.updateControlPoint 把 76 个层位行的读数逐个钉到目标值
 *     → samples.set 声明层位
 *
 * 于是 76 / 103.2 / 4.0 / 2 这几个数字是后端 compute_qa_summary 从真实状态推出来的，
 * 而不是测试自己写死的期望。
 */
import { expect, test, type Page } from './fixtures';
import {
  getState,
  gotoStage,
  openApp,
  resetBaseline,
  rpc,
} from './helpers';
// `qa.summarize` 的返回形状只有一份来源（`types/pollen.ts::QaSummary`），e2e 也用它。
// 本地再声明一份同名接口（本文件曾如此）会与真实契约各自演化，而 tsc 两边都能过
// ——那正是 issue #16/#17 修掉的那类分叉。`check-e2e-skips.mjs` 现在机械禁止
// e2e 目录下再出现 `interface QaSummary`。
import type { QaSummary } from '../src/types/pollen';

const ROI_X0 = 100;
/**
 * 右缘留 10px 余量：0 点 = 列左缘 + 轴粗（本用例实测 5px），而控制点的最大 x
 * 是 0 点 + 103.2%，必须仍落在列内。
 */
const ROI_X1 = 210;
/**
 * ROI 的 y 范围直接决定 digitize / updateControlPoint 逐行重建曲线的行区间，
 * 必须与 76 个层位行 100,105,...,475 完全重合，否则 qa 在层位行上取不到读数。
 */
const ROI_Y0 = 100;
const ROI_Y1 = 475;
const HORIZON_COUNT = 76;
const ROW_STEP = 5;

/**
 * 旧测试的目标和值：前 72 层各 96%，其余依次 92%、103.2%、0%、0%。
 *
 * 两个 0 是"无墨迹读数"的空层位；103.2% 越过 100% + 2 的容差，必须触发红条。
 * 该列的像素→百分比映射为 value = raw_x - (列左缘 + 轴粗)，所以钉 x = 0 点 + 目标和值即可。
 */
const TARGET_SUMS: number[] = [...new Array<number>(72).fill(96), 92, 103.2, 0, 0];

test.describe('Step 8 QA 诊断门禁', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  /** 用真实 RPC 造出"一个成分 ROI + 一个属种列 + 76 个已钉死的层位读数"。 */
  async function stageControlledDiagram(page: Page): Promise<string> {
    // 基线里 detect_columns 已经给 roi_1 分好了列。旧测试的 `session.rois.clear()` /
    // `session.columns.clear()` 在 RPC 面上没有等价物（不存在 roi.clear / column.clear），
    // 只能逐条 roi.remove；好在 roi.remove 会级联删掉该 ROI 的列。
    //
    // 该 ROI **下有列**，删除会级联删列且不可撤销，所以按新契约显式
    // `confirm_drop_columns: true`（后端对"有列且未确认"的删除返回 -32002）。
    // 这里是测试跟随契约，不是放宽断言：级联是否真的删掉列仍由下一行的
    // `expect(emptied.columns).toEqual([])` 正面检查。
    const { rois } = await rpc<{ rois: { id: string }[] }>(page, 'roi.list');
    for (const roi of rois) {
      await rpc(page, 'roi.remove', { roi_id: roi.id, confirm_drop_columns: true });
    }
    const emptied = await rpc<{ columns: { id: string }[] }>(page, 'straditize.getDiagramData');
    expect(emptied.columns, 'roi.remove 必须级联清掉该 ROI 的属种列').toEqual([]);

    const created = await rpc<{ roi: { id: string; ylim: number[] } }>(page, 'roi.create', {
      name: 'pollen',
      x0: ROI_X0,
      x1: ROI_X1,
      y0: ROI_Y0,
      y1: ROI_Y1,
      composition: true,
    });
    const roiId = created.roi.id;
    expect(created.roi.ylim, 'ROI 的 y 范围就是逐行重建曲线的行区间').toEqual([ROI_Y0, ROI_Y1]);

    await rpc(page, 'column.add', { column: { name: 'Pinus', startX: ROI_X0, endX: ROI_X1 } });
    // 0 点 = 列左缘 + 轴粗（与后端 xscale.resolve_axis_stroke 同源：列级 > 组级 > 5）。
    // 后端现在拒绝落在 0 点左侧的手工控制点（-32602 读数不能为负），而 x_ticks 分支
    // 会把 abs_px0 直接取成这里的 px —— 写 startX 就等于宣称"0 点在列左缘"，
    // 随后把控制点压到 0% 必然被拒（实测 x=100 vs 真 0 点 105）。
    const { columns: freshCols } = await rpc<{ columns: Array<{ axis_stroke_px?: number }> }>(
      page,
      'straditize.getDiagramData'
    );
    const ZERO_X = ROI_X0 + (freshCols[0]?.axis_stroke_px ?? 5);
    // x_ticks 既是像素→百分比的映射依据，也是契约里"声明最大丰度"的唯一来源。
    // 映射取 1%/px（ZERO_X → 0%，ZERO_X + 100 → 100%），于是目标和值直接等于 x 偏移量。
    await rpc(page, 'column.update', {
      col_index: 0,
      updates: {
        roi_id: roiId,
        scale_type: 'linear',
        startValue: 0,
        tickValue: 100,
        x_ticks: [
          { px: ZERO_X, value: 0 },
          { px: ZERO_X + 100, value: 100 },
        ],
      },
    });

    // 真数字化：column_points 由后端从前景掩膜算出来（这之后才允许改控制点）。
    await rpc(page, 'core.digitize', { col_index: 0 });

    for (let i = 0; i < HORIZON_COUNT; i++) {
      await rpc(page, 'core.updateControlPoint', {
        col_index: 0,
        row: ROI_Y0 + i * ROW_STEP,
        x: ZERO_X + TARGET_SUMS[i],
      });
    }

    await rpc(page, 'samples.set', {
      samples: TARGET_SUMS.map((_sum, i) => ({
        row_px: ROI_Y0 + i * ROW_STEP,
        depth: i * 2,
        source: 'auto',
      })),
    });

    return roiId;
  }

  test('76 层位里 2 层空、最大和值 103.2%、平均缺额 4.0%：后端算得出，面板显示的是同一个数', async ({
    page,
  }) => {
    await stageControlledDiagram(page);

    // 后端权威值：对上面这张真实图谱的真实计算结果。
    const summary = await rpc<QaSummary>(page, 'qa.summarize', {});
    expect(summary.n_horizons, '76 个层位').toBe(HORIZON_COUNT);
    expect(summary.n_horizons_empty, '两个 0% 层位必须算作空层位').toBe(2);
    expect(summary.sum.max, '最大和值 103.2%').toBe(103.2);
    expect(summary.shortfall.mean, '非空层位平均缺额 = (72×4 + 8 + 0) / 74 = 4.0').toBe(4.0);
    expect(
      summary.violations_over.length,
      '103.2% > 100% + 2 容差，成分 ROI 必须记入越限'
    ).toBeGreaterThan(0);

    // 前端镜像只有重新加载后才拿得到上面那批后端改动（改后端不会推送状态）。
    await page.reload();
    await openApp(page);
    await gotoStage(page, 8);

    await expect(page.locator('#qa-banner')).toBeVisible();
    await page.locator('#btn-run-qa').click();

    // 面板上的数字必须是后端值本身。这里同时是"调用已走共享 RpcClient"的
    // 回归证据：`QaPanel` 曾自己裸 fetch 且把 `200 + body.error` 当成功，
    // 失败时 DOM 会静默停在默认值 0 —— 只断言"面板存在"会漏掉这种失败。
    // 失败路径本身由 `error-surfacing.spec.ts` 的 banner 用例正面覆盖。
    await expect(page.locator('#qa-n-horizons')).toHaveText('76');
    await expect(page.locator('#qa-n-empty')).toHaveText('2');
    await expect(page.locator('#qa-sum-max')).toHaveText('103.2');
    await expect(page.locator('#qa-shortfall-mean')).toHaveText('4.0');
    await expect(page.locator('#qa-banner')).toHaveAttribute('data-level', 'red');

    expect((await getState<{ stage: number }>(page)).stage, '应停在步骤 8').toBe(8);

  });
});
