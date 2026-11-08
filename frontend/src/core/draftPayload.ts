import type { Column } from '../types/pollen';

/**
 * 草稿载荷里该列的**数值端点**（`x_values`）：只有真标定才给，未标定给 `null`。
 *
 * 为什么必须单独抽出来并可单测：后端 `resolve_column_scale` 的 Case A1 只要看到
 * 「组 tick_layout + 列 x_values」就判 `calibrated=true`。若这里把 legacy 占位
 * （`startValue`/`tickValue`，默认 0→100 或 0→20）填进去，**未标定的列在恢复草稿后
 * 会开始出数**，而且是一整表看起来完全正常的百分比（实测 `68.4211, 67.5676, …`）。
 * 占位值不是读数，所以这里返回 null。
 */
export function draftColumnXValues(col: Column): [number, number] | null {
  if (Array.isArray(col.x_ticks) && col.x_ticks.length >= 2) {
    return [Number(col.x_ticks[0].value), Number(col.x_ticks[1].value)];
  }
  return null;
}
