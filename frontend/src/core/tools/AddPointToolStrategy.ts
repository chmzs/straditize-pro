import { ControlPoint, Point2D, ToolMode } from '../../types/pollen';
import { AddPointCommand } from '../Commands';
import { CoordinateSystem } from '../CoordinateSystem';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class AddPointToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'addPoint';

  private draggingAnchor: { taxaId: string; pointId: string } | null = null;

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

      ctx.recordControlPointsBeforeEdit?.(activeCol.id);
      const cmd = new AddPointCommand(activeCol.id, newPoint, activeCol.name);
      cmd.execute(ctx.data);

      this.draggingAnchor = {
        taxaId: activeCol.id,
        pointId: newPoint.id,
      };
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
    if (this.draggingAnchor) {
      const col = ctx.data.columns.find((c) => c.id === this.draggingAnchor!.taxaId);
      if (col) {
        ctx.commitControlPoints(col.id);
        ctx.callbacks.onDataChange?.();
      }
      this.draggingAnchor = null;
      return true;
    }

    this.draggingAnchor = null;
    return false;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.draggingAnchor = null;
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }
}
