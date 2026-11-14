/**
 * 步骤 6「对齐本组」用到的纯计算（无 DOM、无 RPC，可直接单测）。
 *
 * 只做三件事：把后端 `algorithm.measureRuler` 的几何摊成"每列基线→末齿"的像素跨度、
 * 取全 ROI 最长的那个跨度、以及把检测结果写成一句话。
 *
 * 这里不产生任何读数：末齿读数由用户从图上读出，本模块只做几何与线性换算。
 * 对齐时每列**用自己检测到的末齿**当第二端点，所以跨度天生落在列内，
 * 不需要任何夹取或斜率折算。
 */

import type { RulerGeometry } from '../../types/ruler';

/** 单列检测到的刻度跨度（0 点 → 末齿）。 */
export interface DetectedSpan {
  colIndex: number;
  /** 列切分给的边界（仅当轴线未识别时才当 0 点用）。 */
  startX: number;
  endX: number;
  /** 实测轴线右缘 = 真正的 0 点（未识别时退回 startX）。 */
  axisX: number;
  /** 末齿 x − 轴线 x；未检测到刻线时为 null。 */
  span: number | null;
}

/**
 * 把后端几何按列序号摊开，算出每列「0 点 → 末齿」的像素跨度。
 *
 * 0 点只有**一个**权威定义：`col.startX + 轴粗`（ARCHITECTURE §6.4，轴粗取列级 > 组级 > 5）。
 * 调用点必须传 `zeroXOf` 走这条定义，别再各自取 `axis_x_right` —— 那是**测量近似**，
 * 与权威值可差 1px；两套口径并存，画布绿线、面板跨度、读数锚点就会各说一个数。
 *
 * `zeroXOf` 缺省时退回实测轴右缘（`axis_x_right` / `axis_x`），只为不依赖组上下文的
 * 纯函数单测保留（见 `frontend/test-ruler-geometry.mjs`），产品路径不许走缺省。
 */
export function detectedSpans(
  cols: Array<{ col_index?: number; startX: number; endX: number; axis_stroke_px?: number | null }>,
  geo: RulerGeometry | null,
  zeroXOf?: (col: { startX: number; axis_stroke_px?: number | null }, index: number) => number
): DetectedSpan[] {
  const byIdx = new Map<number, { ticks: number[]; axis: number | null }>();
  for (const g of geo?.per_column ?? []) {
    if (typeof g.col_index === 'number') {
      const axis =
        typeof g.axis_x_right === 'number'
          ? g.axis_x_right
          : typeof g.axis_x === 'number'
            ? g.axis_x
            : null;
      byIdx.set(g.col_index, { ticks: g.ticks ?? [], axis });
    }
  }
  return (cols ?? []).map((c, i) => {
    const idx = typeof c.col_index === 'number' ? c.col_index : i;
    const found = byIdx.get(idx);
    const ticks = found?.ticks ?? [];
    const last = ticks.length > 0 ? ticks[ticks.length - 1] : null;
    const startX = Number(c.startX ?? 0);
    const axisX =
      typeof zeroXOf === 'function' ? zeroXOf(c, i) : (found?.axis ?? startX);
    return {
      colIndex: idx,
      startX,
      endX: Number(c.endX ?? 0),
      axisX,
      span: last == null ? null : last - axisX,
    };
  });
}

/** 全 ROI 最长的「基线 → 末齿」跨度：跨度越长，量化误差越小。 */
export function maxDetectedSpan(spans: DetectedSpan[]): number | null {
  const values = (spans ?? [])
    .map((s) => s.span)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  return values.length === 0 ? null : Math.round(Math.max(...values) * 10) / 10;
}

/** 面板第一行：一句话说清检测到了什么（失败就如实说失败，不给默认值）。 */
export function describeRulerDetection(
  geo: RulerGeometry | null,
  error: string | null,
  pending: boolean
): string {
  if (error) return `检测失败：${error}`;
  if (pending || !geo) return '正在检测刻度尺…';
  const cols = geo.per_column ?? [];
  const measured = cols.filter((g) => (g.ticks?.length ?? 0) >= 2);
  if (measured.length === 0) return `检测：${cols.length} 列，未找到刻度尺（无法自动取跨度）`;
  const median = geo.median_spacing_px;
  const regular = geo.all_regular;
  const regText = regular === true ? '规则' : regular === false ? '刻距不均' : '规则性未知';
  return `检测：${cols.length} 列 · 刻距 ${median == null ? '—' : `${Math.round(median * 10) / 10}px`} · ${regText}`;
}

/**
 * ROI 下边界偏高时的诊断文案（`null` = 不适用，不显示）。
 *
 * ## 为什么需要它：旧文案把"框没盖住轴行"说成了"图上没有刻度尺"
 *
 * 齿的搜索带来自 ROI 的 `ylim`：`find_axis_row` 只在
 * `[max(0.70·h, y0), min(h, y1))` 里找下轴线（`straditize_core/ruler.py:114-117`）。
 * 用户框选时若不把**印刷轴行**框进来，整段齿搜索带就落在轴行之上。实测 hoya：
 * herb 的框 (0,0)–(1900,1300)，而各列下轴在 y=1306/1307（`roi_1` 的 ylim 到 1311
 * 时实测 `axis_row=1307`）—— 于是 29 列里 26 列 `axis_row=null`、3 列各检出 1 条
 * 孤齿，面板只报「检测：29 列，未找到刻度尺」。用户无从知道该改哪里。
 *
 * ## 判据只用实测值，不写死、也不猜轴行的 y
 *
 * 这里能说的是**有实测依据的那部分**：哪些列在有效区内测到了轴线（`axis_row`）、
 * 哪些列测到了 ≥2 条齿。轴行的真实像素 y **不在**这份 payload 里——
 * `axis_row` 被 `ylim[1]` 夹住（同一处代码），ROI 下边界之上的情况它给的就是 null，
 * 拿不到"印刷轴行在 1306"这个数。所以文案不报轴行 y，只报实测的列数与下边界值，
 * 并把可执行动作写清楚（把下边界下移到轴线以下再重测）。
 *
 * 放这里而不是面板里：纯函数可直接单测，判据见 `frontend/test-ruler-geometry.mjs` 第 4 组。
 */
export function describeAxisCoverageGap(
  geo: RulerGeometry | null,
  roiYlim: readonly [number, number] | null | undefined
): string | null {
  if (!geo || !roiYlim) return null;
  const cols = geo.per_column ?? [];
  if (cols.length === 0) return null;
  // 检测本来成功（任何列有 ≥2 条齿）⇒ 不是"框没盖住轴行"这个病因，不插嘴。
  if (cols.some((g) => (g.ticks?.length ?? 0) >= 2)) return null;
  const measuredAxis = cols.filter((g) => g.axis_row != null).length;
  // 各列都测到了轴线却没齿 ⇒ 轴行在框内，问题在别处（无刻度尺/齿太淡），不误报。
  if (measuredAxis === cols.length) return null;
  const missing = cols.length - measuredAxis;
  const bottom = Math.round(Number(roiYlim[1]));
  return (
    `有效区下边界（y=${bottom}）以内有 ${missing}/${cols.length} 列测不到刻度轴线：` +
    `刻度齿只在轴线下方 1–8px 内搜索，框选时若没把印刷的轴行框进有效区，` +
    `整段搜索带就落在轴行之上，一条齿也检不出来。` +
    `请把有效区下边界下移到印刷轴行以下（框住那条横轴本身）后点【重新检测】。`
  );
}
