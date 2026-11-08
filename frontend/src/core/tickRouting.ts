import type { DiagramData } from '../types/pollen';
// 显式带 .ts：本模块被 node 单测直接 import（`test-tick-routing.mjs`），
// node 的 ESM 解析不做扩展名补全，而 tsc 已开 allowImportingTsExtensions。
import { resolveAxisStroke } from './axisStroke.ts';

/** 单列 0 点 = 列左缘 + 轴粗（与画布绿线、后端 `resolve_column_scale` 同源，ARCHITECTURE §6.4）。 */
export function zeroXOfColumn(
  col: { startX?: number; axis_stroke_px?: number | null; roi_id?: string; x_group_id?: string },
  data: DiagramData | null
): number {
  const roi =
    data?.rois?.find((r) => r.id === (col.roi_id ?? data?.active_roi_id)) ?? data?.rois?.[0];
  const group = roi?.x_groups?.find((g) => g.id === col.x_group_id) ?? roi?.x_groups?.[0];
  return Number(col.startX) + resolveAxisStroke(col as never, group as never);
}

/**
 * 点选位置落在**哪一列**：列的取数带 = [0 点, endX]。
 *
 * 为什么要按位置解析：步骤 6 的「点一个刻度齿」原来是恒对 `activeColumn()` 生效，
 * 多列图里无论点哪一列的齿都只改当前活动列（通常就是第一列）——用户看到的是
 * 「只有第一列有用，其他列点了没反应」。判据见 `frontend/test-tick-routing.mjs`。
 *
 * 带外返回 null（由调用方决定要不要报错）；带内互不重叠（相邻列的 endX 就是下一列 startX），
 * 取第一个命中的即可。
 */
export function columnAtX<T extends { startX?: number; endX?: number; visible?: boolean }>(
  columns: readonly T[],
  data: DiagramData | null,
  x: number
): T | null {
  for (const col of columns) {
    if (col.visible === false) continue;
    const zero = zeroXOfColumn(col as never, data);
    const right = Number(col.endX);
    if (x >= zero - 2 && x <= right + 2) return col;
  }
  return null;
}
