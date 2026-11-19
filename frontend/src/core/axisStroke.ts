/**
 * 轴线粗解析：**列级覆盖 > 组级初值 > 缺省 2**（ARCHITECTURE §6.4）。
 *
 * 组的 `axis_stroke_px` 是初值（分列时后端 `measure_axis_stroke` 实测中位数，
 * 或用户在步骤 6 手填）；列的 `axis_stroke_px` 只放用户显式覆盖，分列不写它。
 *
 * 为什么不能各写一遍：0 点 = 列左缘 + 轴粗，画布绿线、点齿标定、e2e 断言三处
 * 必须取同一个值；任何一处漏掉列级覆盖，绿线和读数锚点就会差 1~2px。
 * 后端同名函数是 `xscale.resolve_axis_stroke`，两边语义必须逐字对齐。
 */
export interface AxisStrokeHolder {
  axis_stroke_px?: number | null;
}

/**
 * 轴粗的兜底值（列级与组级都没设时用），单位 px。
 *
 * **必须与后端 `straditize_core/session_parts/xscale.py::DEFAULT_AXIS_STROKE_PX`
 * 取同一个数**（两边常量同名，就是为了 `grep DEFAULT_AXIS_STROKE_PX` 能一次找全）。
 * 前端不硬编码在解析函数里，是为了让"改兜底"只有一个可搜索的落点 —— 2026-11-19
 * 由 5 改 2 时，正是两处各写一个 5 导致画布绿线与 0 点差 3px。
 */
export const DEFAULT_AXIS_STROKE_PX = 2;

/**
 * 轴粗的合法区间，与后端 `column.update` 的校验（1–20px）逐字对齐。
 *
 * 画布拖动必须钳在这里：只按「不越过列右界」钳（span − 1，实测列宽 58px）会把
 * 45px 这种值发出去，后端当场 `-32602` 拒绝 → 画布回滚 + 弹错，用户看到的是
 * 「拖到一半自己弹回去了」。
 */
export const AXIS_STROKE_MIN_PX = 0;
export const AXIS_STROKE_MAX_PX = 20;

export function resolveAxisStroke(
  col: AxisStrokeHolder | null | undefined,
  group: AxisStrokeHolder | null | undefined
): number {
  const colStroke = Number(col?.axis_stroke_px);
  // 显式判 null：Number(null) === 0，不判会把「没有覆盖」误当成「覆盖为 0」。
  if (col?.axis_stroke_px != null && Number.isFinite(colStroke) && colStroke >= 0)
    return colStroke;
  const groupStroke = Number(group?.axis_stroke_px);
  if (group?.axis_stroke_px != null && Number.isFinite(groupStroke) && groupStroke >= 0)
    return groupStroke;
  return DEFAULT_AXIS_STROKE_PX;
}
