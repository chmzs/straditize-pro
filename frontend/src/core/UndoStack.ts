/**
 * 撤销/重做的**动作栈**（U1，纯逻辑，不碰 DOM 与 RPC）。
 *
 * ## 为什么不用旧的那套（快照重放）
 * 实测（`docs/findings/undo-redesign-2026-11-11.md`）：旧实现只把"前端快照"整体重放，
 * 而用户动作的真实效果分散在后端多个存储（`control_points` / `manual_points` /
 * `calibration` / `line_strokes` / `column.name`）。结果撤销永不命中被撤销的那个动作：
 * 撤销标定发 `roi.update`、撤销改名发 `applyLineRemoval`、拖手柄则一条请求都不发。
 *
 * 本模块把"撤销"建模成**每个动作自带的逆操作**（`inverse()`），因此：
 * - 没有逆操作的动作**不允许入栈** —— UI 上撤销按钮保持 disabled，而不是"可点但无效"；
 * - 撤销后可以要求 `verify()` 复核后端真的变了；**复核失败不弹出栈**（不允许静默失败）。
 *
 * 这里只负责顺序、容量与状态通知；具体 inverse 由调用方（各动作的提交点）提供。
 */

export interface UndoableOp {
  /** 显示用的动作名，例如「改名 Pinus → Pinus2」。 */
  label: string;
  /** 撤销：把后端状态改回动作之前。 */
  inverse: () => Promise<void>;
  /** 重做：再改回来。缺省表示该动作不可重做（撤销后不提供重做）。 */
  forward?: () => Promise<void>;
  /**
   * 可选复核：撤销/重做后读一次后端，确认状态真的到了预期。
   * 返回 false 时栈**不吃掉**这条操作（用户可以重试或报告）。
   */
  verify?: () => Promise<boolean>;
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  depth: number;
}

export class UndoStack {
  private undoOps: UndoableOp[] = [];
  private redoOps: UndoableOp[] = [];
  private listeners = new Set<(s: UndoState) => void>();
  private busy = false;

  private readonly limit: number;

  constructor(limit = 50) {
    if (limit < 1) throw new Error('UndoStack limit 必须 ≥ 1');
    // 注意：不要用参数属性（`constructor(private readonly limit = 50)`）——
    // node --experimental-strip-types 不支持它（ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX），
    // 而本模块的单元判据就是用它直接跑 .ts 源的。
    this.limit = limit;
  }

  /** 记录一个已完成（且成功后端已落地）的动作。新动作会清空重做栈。 */
  push(op: UndoableOp): void {
    if (!op || typeof op.inverse !== 'function') {
      throw new Error('UndoableOp 必须提供 inverse()');
    }
    this.undoOps.push(op);
    if (this.undoOps.length > this.limit) this.undoOps.shift();
    this.redoOps = [];
    this.emit();
  }

  get state(): UndoState {
    return {
      canUndo: this.undoOps.length > 0,
      canRedo: this.redoOps.length > 0,
      undoLabel: this.undoOps.at(-1)?.label ?? null,
      redoLabel: this.redoOps.at(-1)?.label ?? null,
      depth: this.undoOps.length,
    };
  }

  /**
   * 撤销一条。返回 true 表示**后端已确认回退**（无 verify 时按 inverse 成功计）。
   * 失败/复核不通过时该操作留在栈里（可重试），并返回 false（异常会原样抛出）。
   */
  async undo(): Promise<boolean> {
    if (this.busy) return false;
    const op = this.undoOps.at(-1);
    if (!op) return false;

    this.busy = true;
    try {
      await op.inverse();
      if (op.verify && !(await op.verify())) return false;
      this.undoOps.pop();
      if (op.forward) this.redoOps.push(op);
      this.emit();
      return true;
    } finally {
      this.busy = false;
    }
  }

  /** 重做一条。返回 true 表示已重做。 */
  async redo(): Promise<boolean> {
    if (this.busy) return false;
    const op = this.redoOps.at(-1);
    if (!op || !op.forward) return false;

    this.busy = true;
    try {
      await op.forward();
      if (op.verify && !(await op.verify())) return false;
      this.redoOps.pop();
      this.undoOps.push(op);
      this.emit();
      return true;
    } finally {
      this.busy = false;
    }
  }

  /** 清空（换图 / 新建 / 载入工程包时必须调用：跨工程的历史没有意义）。 */
  clear(): void {
    this.undoOps = [];
    this.redoOps = [];
    this.emit();
  }

  subscribe(fn: (s: UndoState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }
}
