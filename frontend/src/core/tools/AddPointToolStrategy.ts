import { ControlPoint, Point2D, ToolMode } from '../../types/pollen';
import { AddPointCommand } from '../Commands';
import { CoordinateSystem } from '../CoordinateSystem';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class AddPointToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'addPoint';

  private draggingAnchor: { taxaId: string; pointId: string } | null = null;
  private hasDraggedAnchor: boolean = false;
  private dragInitialPointPos: Point2D | null = null;

  public getDraggingAnchor(): { taxaId: string; pointId: string } | null {
    return this.draggingAnchor;
  }

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;
    if (!ctx.isToolAllowed('addPoint')) return false;

    const activeCol = ctx.getActiveColumn();
    if (activeCol && ctx.isWithinDiagramBounds(worldPt)) {
      let targetY = Math.round(worldPt.y);

      // 磁力吸附到标准层位高度（仅在已完成 Y 轴标定时才有层位可言）
      const calib = CoordinateSystem.calibrationBounds(ctx.data.calibration);
      if (ctx.hoveredDepthHorizon !== null && calib) {
        const depthFraction =
          (ctx.hoveredDepthHorizon - calib.topValue) /
          (calib.bottomValue - calib.topValue || 1);
        const horizonY = Math.round(calib.topPx + depthFraction * (calib.bottomPx - calib.topPx));
        if (Math.abs(worldPt.y - horizonY) <= 10 / ctx.viewport.scale) {
          targetY = horizonY;
        }
      }

      const newPoint: ControlPoint = {
        id: `pt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        x: Math.round(worldPt.x),
        y: targetY,
        type: 'manual',
        isManual: true,
        createdAt: Date.now(),
      };

      const cmd = new AddPointCommand(activeCol.id, newPoint, activeCol.name);
      ctx.history.push(`Add Anchor to ${activeCol.name}`, ctx.data.columns, ctx.data.activeTaxaId);
      cmd.execute(ctx.data);

      this.dragInitialPointPos = { x: newPoint.x, y: newPoint.y };
      this.draggingAnchor = {
        taxaId: activeCol.id,
        pointId: newPoint.id,
      };
      this.hasDraggedAnchor = false;
      ctx.data.selectedEntity = { type: 'point', colId: activeCol.id, pointId: newPoint.id };

      ctx.requestRender();
      ctx.callbacks.onDataChange?.();
      return true;
    }

    return false;
  }

  public onMouseMove(
    _e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    _delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean {
    if (this.draggingAnchor) {
      this.hasDraggedAnchor = true;
      const col = ctx.data.columns.find((c) => c.id === this.draggingAnchor!.taxaId);
      if (col) {
        const pt = col.controlPoints.find((p) => p.id === this.draggingAnchor!.pointId);
        if (pt) {
          pt.x = Math.round(worldPt.x);
          pt.y = Math.round(worldPt.y);
          pt.isManual = true;
          col.controlPoints.sort((a, b) => a.y - b.y);
          ctx.requestRender();
        }
      }
      return true;
    }
    return false;
  }

  public onMouseUp(
    _e: MouseEvent,
    _screenPt: Point2D,
    _worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (this.draggingAnchor && this.hasDraggedAnchor && this.dragInitialPointPos) {
      const col = ctx.data.columns.find((c) => c.id === this.draggingAnchor!.taxaId);
      if (col) {
        ctx.history.push(`Move Anchor in ${col.name}`, ctx.data.columns, ctx.data.activeTaxaId);
        ctx.callbacks.onDataChange?.();
      }
      this.draggingAnchor = null;
      this.hasDraggedAnchor = false;
      this.dragInitialPointPos = null;
      return true;
    }

    this.draggingAnchor = null;
    this.hasDraggedAnchor = false;
    this.dragInitialPointPos = null;
    return false;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.draggingAnchor = null;
    this.hasDraggedAnchor = false;
    this.dragInitialPointPos = null;
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }
}
