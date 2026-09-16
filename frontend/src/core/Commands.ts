import { ControlPoint, DiagramCalibration, DiagramData, Point2D, TaxaColumn } from '../types/pollen';
import { Command } from './CommandManager';

/**
 * 拖动/微调单个拐点命令
 */
export class MovePointCommand implements Command {
  public readonly description: string;
  private colId: string;
  private pointId: string;
  private oldPos: Point2D;
  private newPos: Point2D;

  constructor(colId: string, pointId: string, oldPos: Point2D, newPos: Point2D, taxaName: string) {
    this.colId = colId;
    this.pointId = pointId;
    this.oldPos = { ...oldPos };
    this.newPos = { ...newPos };
    this.description = `移动 ${taxaName} 拐点至 (X:${newPos.x}, Y:${newPos.y})`;
  }

  public execute(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    const pt = col.controlPoints.find((p) => p.id === this.pointId);
    if (!pt) return;

    pt.x = this.newPos.x;
    pt.y = this.newPos.y;
    pt.type = 'manual';
    col.isLocked = true;
    col.controlPoints.sort((a, b) => a.y - b.y);
  }

  public undo(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    const pt = col.controlPoints.find((p) => p.id === this.pointId);
    if (!pt) return;

    pt.x = this.oldPos.x;
    pt.y = this.oldPos.y;
    col.controlPoints.sort((a, b) => a.y - b.y);
  }
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
 * 拖动调整分列线 (基线 / 刻度线 / 隔离边界) 命令
 */
export class MoveColumnBoundaryCommand implements Command {
  public readonly description: string;
  private colId: string;
  private oldStartX: number;
  private newStartX: number;
  private oldEndX: number;
  private newEndX: number;
  private oldTickEndX: number;
  private newTickEndX: number;

  constructor(
    col: TaxaColumn,
    newStartX: number,
    newEndX: number,
    newTickEndX?: number
  ) {
    this.colId = col.id;
    this.oldStartX = col.startX;
    this.newStartX = newStartX;
    this.oldEndX = col.endX;
    this.newEndX = newEndX;
    this.oldTickEndX = col.tickEndX ?? col.endX;
    this.newTickEndX = newTickEndX ?? newEndX;
    this.description = `调整 ${col.name} 列宽与标尺`;
  }

  public execute(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    col.startX = this.newStartX;
    col.endX = this.newEndX;
    col.tickEndX = this.newTickEndX;
    col.isLocked = true;
  }

  public undo(data: DiagramData): void {
    const col = data.columns.find((c) => c.id === this.colId);
    if (!col) return;
    col.startX = this.oldStartX;
    col.endX = this.oldEndX;
    col.tickEndX = this.oldTickEndX;
  }
}

/**
 * 调整地质数据有效区 (ROI) 边界命令
 */
export class ResizeRoiCommand implements Command {
  public readonly description: string;
  private oldCal: DiagramCalibration;
  private newCal: DiagramCalibration;

  constructor(oldCal: DiagramCalibration, newCal: DiagramCalibration) {
    this.oldCal = { ...oldCal };
    this.newCal = { ...newCal };
    this.description = '调整地质数据有效区 (ROI)';
  }

  public execute(data: DiagramData): void {
    data.calibration.dataXMin = this.newCal.dataXMin;
    data.calibration.dataXMax = this.newCal.dataXMax;
    data.calibration.dataYMin = this.newCal.dataYMin;
    data.calibration.dataYMax = this.newCal.dataYMax;
  }

  public undo(data: DiagramData): void {
    data.calibration.dataXMin = this.oldCal.dataXMin;
    data.calibration.dataXMax = this.oldCal.dataXMax;
    data.calibration.dataYMin = this.oldCal.dataYMin;
    data.calibration.dataYMax = this.oldCal.dataYMax;
  }
}

/**
 * 批量更新属种名称与分列命令
 */
export class BatchUpdateTaxaCommand implements Command {
  public readonly description: string = '批量导入属种名单';
  private oldColumns: TaxaColumn[];
  private newColumns: TaxaColumn[];

  constructor(oldCols: TaxaColumn[], newCols: TaxaColumn[]) {
    this.oldColumns = JSON.parse(JSON.stringify(oldCols));
    this.newColumns = JSON.parse(JSON.stringify(newCols));
  }

  public execute(data: DiagramData): void {
    data.columns = JSON.parse(JSON.stringify(this.newColumns));
  }

  public undo(data: DiagramData): void {
    data.columns = JSON.parse(JSON.stringify(this.oldColumns));
  }
}
