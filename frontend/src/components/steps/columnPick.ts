/**
 * 步骤 6「在图上选列」的共享状态。
 *
 * 为什么放模块级而不是塞进 `StepContext`：画布（`GeologyCanvas`）与面板
 * （`XTicksPanel`）分属两棵子树，串一层回调要穿过 `InspectorBridge` 与 `main` 三处；
 * 而这里真的只有「是否在选 / 选了谁」两个字段，加两个钩子就够。
 *
 * 语义（用户 2026-11-01 定）：
 * 默认全部列属于默认组 → 点「+ 分组」进入选列模式 → 在图上点选（Shift 连选）
 * → 确认后这些列成一组，**其余列留在默认组**（不需要显式移出）。
 */
export const columnPick = {
  /** 是否处于「在图上选列」模式。 */
  active: false,
  /** 已选列 id，按用户点击顺序累积；Shift 连选取两次点击之间的连续段。 */
  ids: [] as string[],
  /** 画布注册的重绘钩子：选中集变化后必须重画高亮。 */
  requestRedraw: null as null | (() => void),
  /** 面板注册的重渲染钩子：让「已选 N 列」跟着变。 */
  onChanged: null as null | (() => void),
};

/** 退出选列模式并清空选中。 */
export function resetColumnPick(): void {
  columnPick.active = false;
  columnPick.ids = [];
  columnPick.requestRedraw?.();
  columnPick.onChanged?.();
}

/** 覆写选中集，并通知画布与面板。 */
export function setPickedColumnIds(ids: string[]): void {
  columnPick.ids = [...ids];
  columnPick.requestRedraw?.();
  columnPick.onChanged?.();
}

/** 进入选列模式（从空集开始）。 */
export function beginColumnPick(): void {
  columnPick.active = true;
  columnPick.ids = [];
  columnPick.requestRedraw?.();
  columnPick.onChanged?.();
}
