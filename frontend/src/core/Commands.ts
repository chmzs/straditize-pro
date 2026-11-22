import type { ControlPoint, DataRoi, DiagramData } from '../types/pollen.ts';

export interface Command {
  readonly description: string;
  execute(data: DiagramData): void;
  undo(data: DiagramData): void;
}

/**
 * 添加控制拐点命令
 */
export class AddPointCommand implements Command {
  public readonly description: string;
  private colId: string;
  private point: ControlPoint;

  constructor(colId: string, point: ControlPoint, taxaName: string) {
    this.colId = colId;
    this.point = { ...point };
    this.description = `添加 ${taxaName} 锚点 (X:${point.x}, Y:${point.y})`;
  }

  public execute(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    col.controlPoints.push({ ...this.point });
    col.isLocked = true;
    col.controlPoints.sort((a, b) => a.y - b.y);
  }

  public undo(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    col.controlPoints = col.controlPoints.filter((p) => p.id !== this.point.id);
  }
}

/**
 * 删除控制拐点命令
 */
export class DeletePointCommand implements Command {
  public readonly description: string;
  private colId: string;
  private deletedPoint: ControlPoint;

  constructor(colId: string, point: ControlPoint, taxaName: string) {
    this.colId = colId;
    this.deletedPoint = { ...point };
    this.description = `删除 ${taxaName} 锚点 (Y:${point.y})`;
  }

  public execute(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    col.controlPoints = col.controlPoints.filter((p) => p.id !== this.deletedPoint.id);
    col.isLocked = true;
  }

  public undo(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    col.controlPoints.push({ ...this.deletedPoint });
    col.controlPoints.sort((a, b) => a.y - b.y);
  }
}

/**
 * 调整地质数据有效区 (ROI) 边界命令。
 *
 * 只动 `data.roi`：取数区域与 Y 轴标定是两个独立概念，本命令绝不触碰
 * `data.calibration`（历史实现把两者塞进同一个结构体，导致拖框改深度）。
 */
function copyRoiBounds(target: DataRoi, source: DataRoi): void {
  const xMin = source.xMin ?? source.xlim?.[0] ?? 0;
  const xMax = source.xMax ?? source.xlim?.[1] ?? 0;
  const yMin = source.yMin ?? source.ylim?.[0] ?? 0;
  const yMax = source.yMax ?? source.ylim?.[1] ?? 0;
  target.xMin = xMin;
  target.xMax = xMax;
  target.yMin = yMin;
  target.yMax = yMax;
  target.xlim = [xMin, xMax];
  target.ylim = [yMin, yMax];
}

export class ResizeRoiCommand implements Command {
  public readonly description: string;
  private oldRoi: DataRoi;
  private newRoi: DataRoi;

  constructor(oldRoi: DataRoi, newRoi: DataRoi) {
    this.oldRoi = { ...oldRoi };
    this.newRoi = { ...newRoi };
    this.description = '调整地质数据有效区 (ROI)';
  }

  public execute(data: DiagramData): void {
    data.roi = { ...this.newRoi };
    const target = data.rois?.find((r) => r.id === data.active_roi_id) || data.rois?.[0];
    if (target) copyRoiBounds(target, this.newRoi);
  }

  public undo(data: DiagramData): void {
    data.roi = { ...this.oldRoi };
    const target = data.rois?.find((r) => r.id === data.active_roi_id) || data.rois?.[0];
    if (target) copyRoiBounds(target, this.oldRoi);
  }
}
