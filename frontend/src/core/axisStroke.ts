/**
 * 轴线粗解析：**列级覆盖 > 组级初值 > 缺省 5**（ARCHITECTURE §6.4）。
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

export function resolveAxisStroke(
  col: AxisStrokeHolder | null | undefined,
  group: AxisStrokeHolder | null | undefined
): number {
  const colStroke = Number(col?.axis_stroke_px);
  if (Number.isFinite(colStroke) && colStroke > 0) return colStroke;
  const groupStroke = Number(group?.axis_stroke_px);
  if (Number.isFinite(groupStroke) && groupStroke > 0) return groupStroke;
  return 5;
}
