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

/** 一次点选解析出的列归属。 */
export interface ColumnHit<T> {
  col: T;
  /** 命中列所属的有效区 id；列上没有 `roi_id` 时按活动区算（后端单 ROI 时不下发该键）。 */
  roiId: string | null;
  /** 命中列是否属于**当前活动有效区**。 */
  inActiveRoi: boolean;
}

/**
 * 点选位置落在**哪一列**：先只在**当前活动有效区**的列里找，找不到再看其它分区。
 *
 * ## 为什么必须按活动区分组，而不能按数组顺序取第一个命中
 *
 * 多 ROI 图上两个分区的列区间可以**整段重叠**：实测 hoya 双 ROI，先建的 tree 列
 * x 315–1946、后建的 herb 列 x 161–1899，重叠区 319–1899。`columns` 是全局扁平
 * 数组，tree 的 28 列排在前面，于是「第一个包含该 x 的列」恒为 tree 的列——在
 * herb 活动区里点 herb 自己的齿，命中的是 tree 的列，而那条齿不在 tree 的刻线表里，
 * 界面报「此处没有检测到刻度齿」。用户的感受是「齿明明有，点就是拒绝」。
 *
 * 判据见 `frontend/test-tick-routing.mjs`（多 ROI 段）与
 * `frontend/e2e/step6-multi-roi-tick-routing.spec.ts`。
 *
 * ## 返回值为什么带 `inActiveRoi`
 *
 * 只在别的分区命中时，界面必须**指名那个分区**（「这条齿属于有效区「tree」…请先
 * 把它设为活动区」），而不是退回「没有检测到刻度齿」——后者把"有齿但不在本区"
 * 说成"没齿"，是用户看到的那条错误文案的直接来源。
 */
export function resolveColumnAtX<
  T extends { startX?: number; endX?: number; visible?: boolean; roi_id?: string },
>(columns: readonly T[], data: DiagramData | null, x: number): ColumnHit<T> | null {
  const activeId = data?.active_roi_id ?? data?.rois?.[0]?.id ?? null;
  // 列上没有 roi_id 时按活动区算：单 ROI 工程里后端不下发该键，那些列就是活动区的列。
  const roiOf = (col: T): string | null => col.roi_id ?? activeId;
  const contains = (col: T): boolean => {
    if (col.visible === false) return false;
    const zero = zeroXOfColumn(col as never, data);
    const right = Number(col.endX);
    return x >= zero - 2 && x <= right + 2;
  };

  // 第一遍：只认活动有效区。带内互不重叠（相邻列的 endX 就是下一列 startX）。
  for (const col of columns) {
    if (roiOf(col) !== activeId) continue;
    if (contains(col)) return { col, roiId: activeId, inActiveRoi: true };
  }
  // 第二遍：其它分区。只为把「有齿但不在本区」如实报给用户，不改变归属判定。
  for (const col of columns) {
    const roiId = roiOf(col);
    if (roiId === activeId) continue;
    if (contains(col)) return { col, roiId, inActiveRoi: false };
  }
  return null;
}

/**
 * 点选位置落在**哪一列**：列的取数带 = [0 点, endX]，返回列本身或 null。
 *
 * 归属判定一律走 `resolveColumnAtX`（活动分区优先），本函数只是它的薄壳，
 * 供只关心"落在哪一列"、不关心分区归属的调用点使用。
 */
export function columnAtX<T extends { startX?: number; endX?: number; visible?: boolean }>(
  columns: readonly T[],
  data: DiagramData | null,
  x: number
): T | null {
  return resolveColumnAtX(columns, data, x)?.col ?? null;
}
