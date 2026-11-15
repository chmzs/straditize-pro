/**
 * 步骤 6 手动标定：点哪儿记哪儿，不依赖任何自动检测（2026-11-15 契约）。
 *
 * ## 为什么单独一份
 *
 * 旧的 `step6-picktick.spec.ts` 整份建立在「点齿必须吸附到检测齿 ±6px」之上，
 * 该能力已随 `algorithm.detectXTicks` / `algorithm.measureRuler` 一起下架。
 * 本文件钉住新契约的三条：
 *
 * ① 点任意位置（列内、0 点右侧）都记为待标定齿，面板报的像素**就是落点**；
 * ② 点在 0 点或左侧必须被拒，且不出现数字输入框；
 * ③ 「应用」写的是组级斜率 = 读数 / (落点 − 0 点)，后端认成 `group_slope`。
 */
import { expect, test, type Page } from './fixtures';
import {
  canvasBox,
  diagramData,
  getState,
  gotoStage,
  readColumnScale,
  resetBaseline,
} from './helpers';

const STEP6 = '.step-panel[data-step="6"]';
const READING = 30;

interface Geom {
  rois: Array<{
    id?: string;
    x_groups?: Array<{ id?: string; axis_stroke_px?: number | null; value_per_px?: number | null }>;
  }>;
  columns: Array<{
    col_index?: number;
    roi_id?: string;
    x_group_id?: string;
    startX?: number;
    endX?: number;
  }>;
}

/** 取活动 ROII 最宽一列的几何与 0 点（左缘 + 轴粗，ARCHITECTURE §6.4）。 */
async function pickGeometry(page: Page): Promise<{ px: number; zero: number; startX: number; slopeBefore: number | null }> {
  const data = await diagramData<Geom>(page);
  const activeId = (await diagramData<{ activeRoiId?: string }>(page)).activeRoiId;
  const cols = data.columns.filter((c) => !activeId || (c.roi_id ?? activeId) === activeId);
  const widest = [...cols].sort(
    (a, b) =>
      Number(b.endX ?? 0) - Number(b.startX ?? 0) - (Number(a.endX ?? 0) - Number(a.startX ?? 0))
  )[0];
  expect(widest, '前置：步骤 5 必须已分列').toBeTruthy();
  const group = data.rois
    .flatMap((r) => r.x_groups ?? [])
    .find((g) => g.id === widest!.x_group_id);
  const stroke = Number(group?.axis_stroke_px ?? 5) || 5;
  const zero = Number(widest!.startX ?? 0) + stroke;
  const px = Math.round(zero + (Number(widest!.endX ?? 0) - zero) * 0.6);
  return { px, zero, startX: Number(widest!.startX ?? 0), slopeBefore: group?.value_per_px ?? null };
}

/** 世界 x → 画布 x（与渲染同一组视口参数）。 */
async function clickWorldX(page: Page, x: number): Promise<void> {
  const vp = (await getState<{ viewport: { scale: number; panX: number } }>(page)).viewport;
  const box = await canvasBox(page);
  await page.mouse.click(box.x + Math.round(vp.scale * x + vp.panX), box.y + box.height * 0.55);
}

test.describe('步骤 6 手动标定（不依赖检测）', () => {
  // 这三条提示是用户该看到的正常反馈（操作指引 / 应用成功 / 点在 0 点左侧被拒）。
  test.use({ allowlists: { notice: [/请在画布上点一个刻度齿/, /已按「/, /请点在绿线/] } });
  test('① 点任意位置：面板记录的像素就是落点，应用后组斜率 = 读数 / (落点 − 0 点)', async ({
    page,
  }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);
    const { px, zero } = await pickGeometry(page);

    await page.locator(`${STEP6} #btn-pick-tick`).click();
    await clickWorldX(page, px);

    const pending = page.locator(`${STEP6} [data-role="pending-tick"]`);
    await expect(pending, '点完齿面板必须出现待标定态').toHaveCount(1);
    const text = (await pending.textContent()) ?? '';
    const gotPx = Number(/x = (\d+)px/.exec(text)?.[1] ?? NaN);
    // 只允许 1px 的取整误差：面板记录的必须是落点本身，不是被纠正到别处。
    expect(Math.abs(gotPx - px), `落点必须被原样记录：期望 x = ${px}px，实得 ${text}`).toBeLessThanOrEqual(1);
    const gotDist = Number(/距 0 点 (\d+)px/.exec(text)?.[1] ?? NaN);
    expect(Math.abs(gotDist - (gotPx - zero)), '距 0 点必须与落点、0 点自洽').toBeLessThanOrEqual(2);

    await page.locator(`${STEP6} #inp-tick-value`).fill(String(READING));
    await page.locator(`${STEP6} #btn-apply-tick-calib`).click();

    const expected = READING / (gotPx - zero);
    await expect
      .poll(async () => Number((await readColumnScale(page, 0)).val1), { timeout: 15_000 })
      .toBeCloseTo(expected, 3);
    const snap = await readColumnScale(page, 0);
    expect(snap.calibrated, '标定必须落到后端').toBe(true);
    expect(snap.source).toBe('group_slope');
  });

  test('② 点在 0 点或左侧必须被拒：不出现数字输入框，组斜率不变', async ({ page }) => {
    await resetBaseline(page);
    await gotoStage(page, 6);
    const { zero, slopeBefore } = await pickGeometry(page);

    await page.locator(`${STEP6} #btn-pick-tick`).click();
    await clickWorldX(page, Math.round(zero) - 1);

    await expect(
      page.locator(`${STEP6} #inp-tick-value`),
      '拒绝时不得出现数字输入框（否则用户会在空气选择上填数）'
    ).toHaveCount(0);
    await expect(
      page.locator(`${STEP6} [data-role="pending-tick"]`)
    ).toHaveCount(0);

    const after = await diagramData<Geom>(page);
    const slopeAfter =
      after.rois.flatMap((r) => r.x_groups ?? []).find((g) => g.value_per_px != null)?.value_per_px ??
      null;
    expect(slopeAfter, '被拒绝的点击不得改动组斜率').toBe(slopeBefore);
  });
});
