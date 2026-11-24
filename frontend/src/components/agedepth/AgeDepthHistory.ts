import type { AgeDepthHistorySnapshot, CalibMarker, ControlPoint, DatingPoint } from './types.ts';

export class AgeDepthHistory {
  private undoStack: AgeDepthHistorySnapshot[] = [];
  private redoStack: AgeDepthHistorySnapshot[] = [];
  private maxStack: number;
  public onChange: ((canUndo: boolean, canRedo: boolean) => void) | null = null;

  constructor(maxStack: number = 50) {
    this.maxStack = maxStack;
  }

  public static cloneSnapshot(
    description: string,
    state: {
      controlPoints: ControlPoint[];
      selectedControlPointIndex: number | null;
      editTarget: 'curve' | 'lower' | 'upper' | 'min' | 'max';
      calibMarkers?: CalibMarker[];
      excludeBoxes?: number[][];
      datingPoints?: DatingPoint[];
    }
  ): AgeDepthHistorySnapshot {
    return {
      timestamp: Date.now(),
      description,
      controlPoints: state.controlPoints.map((cp) => ({ ...cp })),
      selectedControlPointIndex: state.selectedControlPointIndex,
      editTarget: state.editTarget,
      calibMarkers: state.calibMarkers ? state.calibMarkers.map((m) => ({ ...m })) : undefined,
      excludeBoxes: state.excludeBoxes ? state.excludeBoxes.map((b) => [...b]) : undefined,
      datingPoints: state.datingPoints ? state.datingPoints.map((d) => ({ ...d })) : undefined,
    };
  }

  public push(
    description: string,
    state: {
      controlPoints: ControlPoint[];
      selectedControlPointIndex: number | null;
      editTarget: 'curve' | 'lower' | 'upper' | 'min' | 'max';
      calibMarkers?: CalibMarker[];
      excludeBoxes?: number[][];
      datingPoints?: DatingPoint[];
    }
  ): void {
    const snap = AgeDepthHistory.cloneSnapshot(description, state);
    this.pushSnapshot(snap);
  }

  public pushSnapshot(snap: AgeDepthHistorySnapshot): void {
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxStack) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.notify();
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(
    currentState: {
      controlPoints: ControlPoint[];
      selectedControlPointIndex: number | null;
      editTarget: 'curve' | 'lower' | 'upper' | 'min' | 'max';
      calibMarkers?: CalibMarker[];
      excludeBoxes?: number[][];
      datingPoints?: DatingPoint[];
    }
  ): AgeDepthHistorySnapshot | null {
    if (!this.canUndo()) return null;
    const target = this.undoStack.pop()!;
    const currentSnap = AgeDepthHistory.cloneSnapshot(target.description, currentState);
    this.redoStack.push(currentSnap);
    if (this.redoStack.length > this.maxStack) {
      this.redoStack.shift();
    }
    this.notify();
    return target;
  }

  public redo(
    currentState: {
      controlPoints: ControlPoint[];
      selectedControlPointIndex: number | null;
      editTarget: 'curve' | 'lower' | 'upper' | 'min' | 'max';
      calibMarkers?: CalibMarker[];
      excludeBoxes?: number[][];
      datingPoints?: DatingPoint[];
    }
  ): AgeDepthHistorySnapshot | null {
    if (!this.canRedo()) return null;
    const target = this.redoStack.pop()!;
    const currentSnap = AgeDepthHistory.cloneSnapshot(target.description, currentState);
    this.undoStack.push(currentSnap);
    if (this.undoStack.length > this.maxStack) {
      this.undoStack.shift();
    }
    this.notify();
    return target;
  }

  public clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  private notify(): void {
    this.onChange?.(this.canUndo(), this.canRedo());
  }
}
