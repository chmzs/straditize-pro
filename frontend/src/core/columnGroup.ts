/**
 * 列所属的 x 组：**唯一解析入口**。
 *
 * 规则与后端 `xscale._resolve_column_group` 对齐：
 * 列的 `x_group_id` → ROI 的 `default_group_id` → 第一个组。
 *
 * 为什么必须收敛：`components/canvas/columnBoundaries.ts` 里画**组色带**用了一套
 * （`col.x_group_id ?? default_group_id ?? groups[0]`），画**绿线**（0 点 =
 * 列左缘 + 组轴粗）用的是另一套（只按 `col.x_group_id` 精确匹配、无回退）。
 * 列上没有 `x_group_id` 的工程里两套给出不同答案：绿线回落缺省 5，色带用的却是组值
 * —— 同一张图上两个 0 点。
 */
export interface ColumnGroupRef {
  id?: string;
}

export function resolveColumnGroup<G extends ColumnGroupRef>(
  col: { x_group_id?: string | null } | null | undefined,
  roi: { x_groups?: G[] | null; default_group_id?: string | null } | null | undefined
): G | undefined {
  const groups = roi?.x_groups ?? [];
  if (groups.length === 0) return undefined;
  const wanted = col?.x_group_id ?? roi?.default_group_id;
  return (
    groups.find((g) => g.id === wanted) ??
    groups.find((g) => g.id === roi?.default_group_id) ??
    groups[0]
  );
}
