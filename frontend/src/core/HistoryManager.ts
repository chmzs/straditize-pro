import { DiagramCalibration, HistorySnapshot, TaxaColumn } from '../types/pollen';

export class HistoryManager {
  private undoStack: HistorySnapshot[] = [];
  private redoStack: HistorySnapshot[] = [];
  private maxHistory: number = 50;
  public onChange: (() => void) | null = null;

  constructor(maxHistory: number = 50) {
    this.maxHistory = maxHistory;
  }

  public push(
    description: string,
    columns: TaxaColumn[],
    activeTaxaId: string,
    calibration?: DiagramCalibration
  ): void {
    const snapshot: HistorySnapshot = {
      timestamp: Date.now(),
      description,
      columns: JSON.parse(JSON.stringify(columns)),
      activeTaxaId,
      calibration: calibration ? JSON.parse(JSON.stringify(calibration)) : undefined,
    };

    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }

    // 产生新操作时清空 redo 栈
    this.redoStack = [];
    this.notify();
  }

  public canUndo(): boolean {
    // 至少需要保留当前状态 + 1 个之前状态才能 undo
    return this.undoStack.length > 1;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): HistorySnapshot | null {
    if (!this.canUndo()) return null;

    const current = this.undoStack.pop()!;
    this.redoStack.push(current);

    const previous = this.undoStack[this.undoStack.length - 1];
    this.notify();
    return JSON.parse(JSON.stringify(previous));
  }

  public redo(): HistorySnapshot | null {
    if (!this.canRedo()) return null;

    const next = this.redoStack.pop()!;
    this.undoStack.push(next);

    this.notify();
    return JSON.parse(JSON.stringify(next));
  }

  public reset(initialColumns: TaxaColumn[], activeTaxaId: string, calibration?: DiagramCalibration): void {
    this.undoStack = [
      {
        timestamp: Date.now(),
        description: 'Initial State',
        columns: JSON.parse(JSON.stringify(initialColumns)),
        activeTaxaId,
        calibration: calibration ? JSON.parse(JSON.stringify(calibration)) : undefined,
      },
    ];
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    if (this.onChange) {
      this.onChange();
    }
  }
}
