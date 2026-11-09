/**
 * 画布画「刻度齿」用的像素间距来源。
 *
 * ## 为什么需要这个模块
 *
 * `columnBoundaries` 原来只认组级 `ref_span_px`——那是**用户确认**的值（点齿标定后写入）。
 * 但用户在步骤 6 看到的刻距是 `algorithm.measureRuler` **实测**的（面板写着「检测: 4 列 ·
 * 刻距 124.5px · 规则」），画布却因为 `ref_span_px` 还是 null 而**一条齿都不画**：
 * 面板说检测到了，图上什么都没有，于是「点一个刻度齿」无从点起。
 *
 * 所以：齿的**位置**可以来自实测（纯视觉参考，不改任何数值）；
 * 齿的**读数含义**仍然只在用户确认后才存在（`ref_span_px` / `value_per_px`）。
 * 这个模块只是把「实测刻距」这一个数从面板递给画布，不承载任何判定。
 */
let measuredTickSpacingPx: number | null = null;

/** 画布注册的重绘钩子（与 `columnPick.requestRedraw` 同一个模式）。 */
let requestRedraw: (() => void) | null = null;

export function setTickRedrawHook(fn: (() => void) | null): void {
  requestRedraw = fn;
}

/**
 * 面板每次 `algorithm.measureRuler` 成功后写入；失败或换图时传 null 清空。
 *
 * **值变了必须让画布重画**：测量是异步的，画布在面板挂载时就画完了，`rulerGeo` 晚到
 * 而没有重绘请求的话，齿永远不会出现（实测：递了 124.5px 却一条齿都没有）。
 */
export function setMeasuredTickSpacing(px: number | null): void {
  const next = Number.isFinite(Number(px)) && Number(px) > 2 ? Number(px) : null;
  if (next === measuredTickSpacingPx) return;
  measuredTickSpacingPx = next;
  requestRedraw?.();
}

/**
 * 画齿用的间距：**用户确认值 > 实测值 > null（不画）**。
 * 与 `resolveAxisStroke` 同一套优先级思路：用户显式给的值压过自动测量。
 */
export function resolveTickSpacingPx(groupRefSpanPx: unknown): number | null {
  const declared = Number(groupRefSpanPx);
  return Number.isFinite(declared) && declared > 2 ? declared : measuredTickSpacingPx;
}
