import { DiagramData } from '../types/pollen';

export interface Command {
  readonly description: string;
  execute(data: DiagramData): void;
  undo(data: DiagramData): void;
}

/**
 * 现代命令模式历史栈 (Undo/Redo)
 * 一次完整的用户交互（如拖动一个手柄结束、批量修改名字）合并为一条不可逆原子 Command，
 * 绝不在每帧重复写历史。
 */
export class CommandManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private maxHistory: number;
  private onStateChange: (() => void) | null = null;

  constructor(maxHistory: number = 50) {
    this.maxHistory = maxHistory;
  }

  public setChangeListener(listener: () => void): void {
    this.onStateChange = listener;
  }

  public execute(command: Command, data: DiagramData): void {
    command.execute(data);
    this.undoStack.push(command);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = []; // 清空重做栈
    this.notify();
  }

  public undo(data: DiagramData): string | null {
    const cmd = this.undoStack.pop();
    if (!cmd) return null;

    cmd.undo(data);
    this.redoStack.push(cmd);
    this.notify();
    return cmd.description;
  }

  public redo(data: DiagramData): string | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;

    cmd.execute(data);
    this.undoStack.push(cmd);
    this.notify();
    return cmd.description;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    if (this.onStateChange) {
      this.onStateChange();
    }
  }
}
