/**
 * 步骤 6「标定进度」的唯一计数口径。
 *
 * ## 为什么需要它
 * 面板上曾同时出现「标定进度 0 / 4 列 (0%)」和「已标定 · 0.1613 %/px」——
 * 因为进度条用 `col.x_ticks.length === 2` 计数，而列徽标用的是
 * `CoordinateSystem.resolveColumnScale(col).calibrated`。**通过分组斜率标定的列
 * 没有 `x_ticks`**（`x_groups[].value_per_px` 才是它的标定），于是同一列在
 * 两个地方得到相反结论。
 *
 * 现在两处都走 `resolveColumnScale`：单一事实源，不再各算一套。
 */
import { CoordinateSystem } from './CoordinateSystem.ts';
import type { TaxaColumn } from '../types/pollen';

export function isColumnCalibrated(col: TaxaColumn): boolean {
  try {
    return Boolean(CoordinateSystem.resolveColumnScale(col).calibrated);
  } catch {
    // 解析失败（几何缺失等）按"未标定"计——不能因为异常就把它算成已标定。
    return false;
  }
}

export function countCalibratedColumns(cols: readonly TaxaColumn[]): number {
  return cols.filter(isColumnCalibrated).length;
}
