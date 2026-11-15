/**
 * 写回控制点时把 x 钳到**当前** 0 点下界。
 *
 * 为什么需要：前端 `col.controlPoints` 是镜像，里面的 x 是上一次 `core.digitize` /
 * 标定的产物。用户改标定（组斜率、轴粗）之后 0 点（`resolveColumnScale(col).px0`）
 * 会右移，旧 x 可能落在新 0 点左侧；后端现在拒绝这种点（读数不能为负，`-32602`），
 * 于是整列写回失败，导出面板与 data.csv 停在旧值。
 *
 * 这里只把**越界的陈旧值**抬到 0 点，`x >= zeroX` 时原样返回——用户亲手点/拖的
 * 位置不会被悄悄挪动。0 点本身是合法读数（丰度 0）。
 */
export function clampToZeroPoint(x: number, zeroX: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(zeroX)) return x;
  return x < zeroX ? zeroX : x;
}

/** 整列写回的载荷：行取整、x 钳到当前 0 点、manual 缺省为 true。 */
export function controlPointsForWriteback(
  points: Array<{ x: number; y: number; isManual?: boolean }>,
  zeroX: number
): Array<{ row: number; x: number; manual: boolean }> {
  return points.map((p) => ({
    row: Math.round(p.y),
    x: clampToZeroPoint(p.x, zeroX),
    manual: p.isManual !== false,
  }));
}
