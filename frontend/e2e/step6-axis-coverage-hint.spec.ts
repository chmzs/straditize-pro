/**
 * 「框没盖住印刷轴行」时的**可诊断性**。
 *
 * 本文件只测缺陷 ②；缺陷 ①（多 ROI 列区间重叠时的点齿归属）的判据见
 * `step6-multi-roi-tick-routing.spec.ts`，两者共用同一套 RPC 造现场手法。
 *
 * ## 缺陷：界面把"框选范围不对"说成"图上没有刻度尺"
 *
 * 齿的搜索带来自 ROI 的 `ylim`：后端 `find_axis_row` 只在
 * `[max(0.70·h, y0), min(h, y1))` 里找下轴线（`straditize_core/ruler.py:114-117`）。
 * 用户框选时若不把**印刷轴行**框进来，整段齿搜索带就落在轴行之上。实测 hoya：
 * 把分区框成 (0,0)–(1900,1300) 后，29 列里 26 列测不到轴线、3 列各检出 1 条孤齿，
 * 面板只报「检测：29 列，未找到刻度尺」——用户无从知道该改哪里。
 *
 * ## 判据：诊断里的数字全部来自实测，一条也不写死
 *
 * | 判据 | 为什么必须这么写 |
 * | --- | --- |
 * | 诊断真的出现（`data-gap="1"`） | 只有"未找到刻度尺"就是原缺陷 |
 * | 文案含实测下边界 `roi.ylim[1]` | 期望值从后端 ROI 读，不写死 1300 |
 * | 文案含实测缺失列数 `missing/total` | 从同一份 `measureRuler` payload 数出来，不写死 26/29 |
 * | 文案含可执行动作（"下移"） | 只说"没找到"等于没诊断；用户要知道改哪里 |
 * | 「未找到刻度尺」仍在 | 两句话说的是不同的事（是什么 / 该怎么办），不能互相顶替 |
 * | 负向对照：检测正常时 `data-gap="0"` 且不可见 | 否则"永远显示这条诊断"也能全绿 |
 *
 * ## 为什么轴行的像素 y 不出现在文案里
 *
 * `axis_row` 被 `ylim[1]` 夹住（同一处 `find_axis_row`），框没盖住它时后端给的就是
 * `null`——payload 里**没有**"印刷轴行在 1307"这个数。所以面板只报它真有据可依的
 * 部分（下边界值 + 列数 + 动作），不编一个轴行 y。若将来后端能测 ROI 之外的轴行，
 * 再把这个数接进来即可（届时改 `rulerSpan.describeAxisCoverageGap` 一处）。
 */
import { expect, test, type Page } from './fixtures';
import { diagramData, gotoStage, openApp, resetBaseline, rpc } from './helpers';

const STEP6 = '.step-panel[data-step="6"]';
const GAP_HINT = `${STEP6} [data-role="axis-coverage-hint"]`;

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
 * 在基线（hoya + `roi_1`：[315,1946]×[511,1311]，各列实测 `axis_row=1307`）之上
 * 再建一个 `ylim` 下边界高于印刷轴行的分区，并把活动区切过去。
 *
 * `y1=1300` 是复现值：hoya 的轴行在 1306/1307，1300 恰好把它挡在框外。
 */
async function stageClippedRoi(page: Page, y1: number): Promise<string> {
  const created = await rpc<{ roi: { id: string } }>(page, 'roi.create', {
    x0: 0,
    x1: 1900,
    y0: 0,
    y1,
  });
  const roiId = created.roi.id;
  // 先切活动区再分列：`detect_columns` 按 active/入参分区过滤，顺序反了列会落到 roi_1 名下。
  await rpc(page, 'roi.setActive', { roi_id: roiId });
  await rpc(page, 'core.detectColumns', {
    data_xlim: [0, 1900],
    data_ylim: [0, y1],
    roi_id: roiId,
  });
  await page.reload();
  await openApp(page);
  await gotoStage(page, 6);
  return roiId;
}

/** 后端为某分区实测的刻线几何（面板走的是同一条 RPC）。 */
async function rulerGeometry(page: Page, roiId: string): Promise<WireRulerGeometry> {
  return rpc<WireRulerGeometry>(page, 'algorithm.measureRuler', { roi_id: roiId });
}

test.describe('步骤 6：有效区没盖住印刷轴行', () => {
  test.beforeEach(async ({ page }) => {
    await resetBaseline(page);
  });

  test('下边界高于轴行时必须给出实测诊断，而不是只说「未找到刻度尺」', async ({
    page,
    telemetry,
  }) => {
    const roiId = await stageClippedRoi(page, 1300);

    // 期望值全部来自后端同一份 payload + ROI 自身边界，不写死。
    const geo = await rulerGeometry(page, roiId);
    const cols = geo.per_column ?? [];
    expect(cols.length, '前置：该分区必须真的有列').toBeGreaterThan(0);
    const missing = cols.filter((c) => c.axis_row == null).length;
    expect(
      missing,
      `前置：必须真的出现"框没盖住轴行"的形态（实测 ${missing}/${cols.length} 列测不到轴线）`
    ).toBeGreaterThan(0);
    expect(
      cols.every((c) => (c.ticks?.length ?? 0) < 2),
      '前置：该形态下每列至多 1 条孤齿，凑不出刻距'
    ).toBe(true);

    const data = await diagramData<{ rois: Array<{ id: string; ylim: [number, number] }> }>(page);
    const bottom = data.rois.find((r) => r.id === roiId)?.ylim?.[1];
    expect(bottom, '前置：必须读得到该分区的下边界').toBeTruthy();

    await expect
      .poll(async () => page.locator(GAP_HINT).getAttribute('data-gap'), {
        timeout: 20_000,
        message: '检测完成后面板必须给出「框没盖住轴行」的诊断',
      })
      .toBe('1');

    const text = (await page.locator(GAP_HINT).innerText()).replace(/\s+/g, ' ');
    expect(text, `诊断必须报出实测下边界 y=${bottom}，实得：${text}`).toContain(
      String(Math.round(Number(bottom)))
    );
    expect(
      text,
      `诊断必须报出实测的缺失列数 ${missing}/${cols.length}，实得：${text}`
    ).toContain(`${missing}/${cols.length}`);
    expect(text, `诊断必须写明可执行动作（把有效区下边界下移），实得：${text}`).toMatch(/下移/);

    // 旧的"未找到刻度尺"仍要在：两句话说的是不同的事（是什么 / 该怎么办）。
    await expect(page.locator(`${STEP6} [data-role="ruler-detect"]`)).toContainText('未找到刻度尺');
    expect(telemetry.rpcErrors).toEqual([]);
  });

  test('负向对照：框盖住轴行（检测正常）时不得出现该诊断', async ({ page }) => {
    // 基线 roi_1 的 ylim 到 1311，实测各列 axis_row=1307，齿能检出。
    await gotoStage(page, 6);
    await expect
      .poll(
        async () => page.locator(`${STEP6} [data-role="ruler-detect"]`).getAttribute('data-spacing'),
        { timeout: 20_000, message: '基线必须真的检出刻度尺' }
      )
      .not.toBe('');

    await expect(
      page.locator(GAP_HINT),
      '检测正常时不得把病因归给"框没盖住轴行"'
    ).toHaveAttribute('data-gap', '0');
    await expect(page.locator(GAP_HINT)).toBeHidden();
  });
});
