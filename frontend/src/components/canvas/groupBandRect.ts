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
