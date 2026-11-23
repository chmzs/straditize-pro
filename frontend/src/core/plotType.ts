/**
 * 图形形态解析：**列级显式覆盖 > 组级 > 'area'**（ARCHITECTURE §6.4）。
 *
 * `plot_type` 按 §6.4 是**组级参数**（与 `scale_type` 并列，组参数表里同行）。
 * 列上的 `plot_type` 只允许放**用户显式覆盖**；分列/载入期从组值抄下来的那份是
 * 快照，改组后不会跟着变 —— 画布若直接读列字段，用户切「折线」就看不到任何变化
 * （实测：grp1 area / grp2 line / grp3 line，但 col02 仍是 area，画布照旧画面积）。
 *
 * 与 `axisStroke.resolveAxisStroke` 同构：0 点绿线与曲线形态都只能有一个解析入口。
 * 两处调用点（画布 `pollenCurves`、`GeologyCanvas.drawGhostingOverlay`）必须取同一个值。
 */
export type PlotType = 'area' | 'bar' | 'line' | 'symbol';

/** 参与解析的最小结构：列与组都满足（组只认 `plot_type`）。 */
export interface PlotTypeHolder {
  plot_type?: PlotType | null;
}

const PLOT_TYPES: readonly PlotType[] = ['area', 'bar', 'line', 'symbol'];

/** 只接受四个合法字面量；其余（undefined / null / 拼错）一律视为「未设置」。 */
function normalizePlotType(value: unknown): PlotType | null {
  return typeof value === 'string' && (PLOT_TYPES as readonly string[]).includes(value)
    ? (value as PlotType)
    : null;
}

export function resolvePlotType(
  col: PlotTypeHolder | null | undefined,
  group: PlotTypeHolder | null | undefined
): PlotType {
  return (
    normalizePlotType(col?.plot_type) ??
    normalizePlotType(group?.plot_type) ??
    'area'
  );
}
