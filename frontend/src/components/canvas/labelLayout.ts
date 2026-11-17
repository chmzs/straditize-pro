/**
 * 名称防重叠：45° 斜排的相邻标签**垂直净距** = 水平间距 × sin45°，
 * 要 ≥ 一行高（约 11px）才不压字 → 水平净距至少 16px，取 24px 留余量。
 *
 * 现场（`.recon_20261117`，19 列，37% 适配缩放）：列间距约 20 图像 px = 7.4 设备 px，
 * 远小于一行文字宽度，于是 19 个斜排名称叠成一团（截图里 Picea/Pinus/Betula/Quercus
 * 与 Artemisia/Amaranthaceae/Poaceae 两处糊在一起）。斜排本身救不了这种密度。
 *
 * 判据：相邻两个**已画**标签的中心距（换算到设备像素）必须 ≥ 该值。
 * 为什么是"距上一个已画标签"而不是"距上一列"：跳过的列不占额度，
 * 这样 19 列在 7.4px 间距下仍能均匀留下 5 个名称，而不是挤在头部几列。
 */
export const LABEL_MIN_GAP_PX = 24;

/** 本列名称是否该画（`lastLabeledCenterX` 是上一个**已画**标签的中心，没有则传 -Infinity）。 */
export function shouldDrawColumnLabel(
  centerX: number,
  lastLabeledCenterX: number,
  scale: number,
  minGapPx: number = LABEL_MIN_GAP_PX
): boolean {
  return (centerX - lastLabeledCenterX) * scale >= minGapPx;
}
