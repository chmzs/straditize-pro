// 显式带 .ts：本模块被 node 单测直接 import（`test-zero-point.mjs`），
// node 的 ESM 解析不做扩展名补全，而 tsc 已开 allowImportingTsExtensions。
import { resolveAxisStroke } from '../../core/axisStroke.ts';

/**
 * 组归属条的矩形：**从 0 点起**画到列右界。
 *
 * 0 点 = 列左缘 + 轴粗（ARCHITECTURE §6.4，画布上的绿线）；列左缘只是列切分线（红线）。
 * 从红线起画等于在画布上宣称"数据从红线起算"，与绿线语义矛盾——用户就是靠这条视觉差
 * 抓到的第 4 处 0 点不一致。
 *
 * 刻意做成无依赖的纯函数：轴粗的来源（列级覆盖 > 组级初值 > 缺省）留在调用方
 * （columnBoundaries 里的 resolveAxisStroke），这里只做几何，便于单测直接断言。
 */
export function groupBandRect(
  startX: number,
  endX: number,
  axisStrokePx: number
): { x: number; width: number } {
  const x = startX + axisStrokePx;
  return { x, width: endX - x };
}

/** 「从 0 点起算」的填充对象：组归属条、面积图填充、柱条、幽灵叠加。 */
export interface ZeroSpanColumn {
  startX: number;
  endX: number;
  axis_stroke_px?: number | null;
}

/**
 * 列的「0 点 → 右界」跨度：`x = startX + 轴粗`（画布绿线），`width = endX - x`。
 *
 * 所有以「列的基线」为左边界画填充/遮罩的地方都必须取这里，不许各写一遍
 * `col.startX`：那会把轴线本身涂进数据区（用户看到的「青绿色遮罩包住轴线」）。
 *
 * 宽度 ≤ 0（0 点落在列右界之外，例如列比轴还窄）时返回 `null`，调用方跳过绘制——
 * 负宽度填充只会画出反向的假象。
 */
export function zeroSpanOfColumn(
  col: ZeroSpanColumn,
  group: { axis_stroke_px?: number | null } | null | undefined
): { x: number; width: number } | null {
  const rect = groupBandRect(Number(col.startX), Number(col.endX), resolveAxisStroke(col, group));
  return Number.isFinite(rect.width) && rect.width > 0 ? rect : null;
}
