/**
 * 撤销/重做的**运行时装配**（U2/U3 接线层）。
 *
 * 与 `UndoStack`（纯逻辑）和 `undoActions`（构造器，纯逻辑）分开：本文件是唯一
 * 允许接触 DOM 与 UI 的地方，且只做两件事：
 * 1. 暴露**单例** `undoStack`，供各动作的提交点 push；
 * 2. 把栈里的 op 优先于旧的 `history` 快照（迁移期两套并存，见下）。
 *
 * ## 迁移期策略（为什么还留着旧 history）
 * 旧实现（`canvasComponent.history` + `applyHistorySnapshot`）覆盖了 ROI 拖动等动作，
 * 但它不能真正回退后端（实测 7/7 零回退）。这次迁移**逐动作替换**：
 * - 已迁移的动作（列改名 / ROI 改名 / 标定）push 到 `undoStack`，撤销走真逆操作；
 * - 未迁移的动作仍落在旧 history 上，`undo` 回落到旧实现（**不比现在差**）；
 * - 未迁移的动作在栈里没有 op ⇒ 撤销按钮状态由"栈或旧 history 有内容"决定，
 *   `title` 会写明当前可用的是哪一套，避免"可点但什么也没发生"被静默掩盖。
 */
import { UndoStack, type UndoState } from './UndoStack';

export const undoStack = new UndoStack();

/**
 * 刷新 `#btn-undo` / `#btn-redo` 的可用状态与提示。
 *
 * @param legacy 旧 history 的可用性（迁移期未迁移动作的来源）
 */
export function refreshUndoButtons(legacy: { canUndo: boolean; canRedo: boolean }): void {
  const s: UndoState = undoStack.state;
  const undo = document.getElementById('btn-undo') as HTMLButtonElement | null;
  const redo = document.getElementById('btn-redo') as HTMLButtonElement | null;
  if (undo) {
    undo.disabled = !(s.canUndo || legacy.canUndo);
    undo.title = s.canUndo
      ? `撤销：${s.undoLabel ?? ''}`
      : legacy.canUndo
        ? '撤销（旧历史：可回退界面，未必回退后端）'
        : '没有可撤销的操作';
  }
  if (redo) {
    redo.disabled = !s.canRedo;
    redo.title = s.canRedo ? `重做：${s.redoLabel ?? ''}` : '没有可重做的操作';
  }
}

/** 订阅栈变化并同步按钮（返回退订函数）。 */
export function bindUndoButtons(getLegacy: () => { canUndo: boolean; canRedo: boolean }): () => void {
  return undoStack.subscribe(() => refreshUndoButtons(getLegacy()));
}
