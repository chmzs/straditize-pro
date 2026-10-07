import {
  ControlPoint,
  Point2D,
  ToolMode,
} from '../../types/pollen';
import { AddPointCommand } from '../Commands';
import { CoordinateSystem } from '../CoordinateSystem';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class SelectToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'select';

  private draggingAnchor: { taxaId: string; pointId: string } | null = null;
  private hasDraggedAnchor: boolean = false;
  private dragInitialPointPos: Point2D | null = null;

  private draggingBoundary: {
    taxaId: string;
    type: 'start' | 'end' | 'tick';
  } | null = null;
  private dragInitialColumn: { startX: number; endX: number; tickEndX: number } | null = null;

  private geometryDrag: {
    id: string;
    handle: 'move' | 'start' | 'end' | 'thick0' | 'thick1';
    startWorld: Point2D;
    startRect: { x0: number; y0: number; x1: number; y1: number };
  } | null = null;

  public getDraggingAnchor(): { taxaId: string; pointId: string } | null {
    return this.draggingAnchor;
  }

  public getDraggingBoundary(): { taxaId: string; type: 'start' | 'end' | 'tick' } | null {
    return this.draggingBoundary;
  }

  public onMouseDown(
    e: MouseEvent,
    screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;

    // 1. 优先命中 Step 4 geometry
    const hitGeometry = ctx.findHitGeometry(worldPt);
    if (hitGeometry) {
      const cand = (ctx.data.line_candidates || []).find((c) => c.id === hitGeometry.id);
      ctx.setSelectedGeometryId(hitGeometry.id);
      if (cand?.geometry) {
        const g = cand.geometry;
        this.geometryDrag = {
          id: hitGeometry.id,
          handle: hitGeometry.handle,
          startWorld: worldPt,
          startRect: { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 },
        };
        ctx.updateCursor();
        ctx.requestRender();
        return true;
      }
    }

    // 2. 检查控制锚点
    const hitAnchor = ctx.findHitAnchor(screenPt);
    if (hitAnchor) {
      this.draggingAnchor = hitAnchor;
      this.hasDraggedAnchor = false;
      ctx.data.activeTaxaId = hitAnchor.taxaId;
      ctx.data.selectedEntity = { type: 'point', colId: hitAnchor.taxaId, pointId: hitAnchor.pointId };
      const col = ctx.data.columns.find((c) => c.id === hitAnchor.taxaId);
      const pt = col?.controlPoints.find((p) => p.id === hitAnchor.pointId);
      if (pt) {
        this.dragInitialPointPos = { x: pt.x, y: pt.y };
      }
      ctx.callbacks.onTaxaChange?.(hitAnchor.taxaId);
      ctx.updateCursor();
      ctx.requestRender();
      return true;
    }

    // 3. 检查垂直分界标线 / 刻度钉
    const hitBoundary = ctx.findHitBoundary(screenPt);
    if (hitBoundary) {
      this.draggingBoundary = {
        taxaId: hitBoundary.taxaId,
        type: hitBoundary.type,
      };
      ctx.data.activeTaxaId = hitBoundary.taxaId;
      ctx.data.selectedEntity = { type: 'column', id: hitBoundary.taxaId, part: hitBoundary.type };
      const col = ctx.data.columns.find((c) => c.id === hitBoundary.taxaId);
      if (col) {
        this.dragInitialColumn = { startX: col.startX, endX: col.endX, tickEndX: col.tickEndX ?? col.endX };
      }
      ctx.callbacks.onTaxaChange?.(hitBoundary.taxaId);
      ctx.updateCursor();
      return true;
    }

    // 4. 点击属种列区域
    const hitCol = ctx.findHitColumn(worldPt);
    if (hitCol) {
      ctx.data.activeTaxaId = hitCol.id;
      ctx.data.selectedEntity = { type: 'column', id: hitCol.id };
      ctx.notifyNotice(`已选中属种列: ${hitCol.name} (可直接在图上拉点修改)`);
      ctx.callbacks.onTaxaChange?.(hitCol.id);
      ctx.requestRender();
      return true;
    }

    // 5. 若在已激活列内点击且允许加点，执行加点操作
    if (ctx.isToolAllowed('addPoint') && ctx.isWithinDiagramBounds(worldPt)) {
      const activeCol = ctx.getActiveColumn();
      if (activeCol && ctx.isWithinDiagramBounds(worldPt)) {
        let targetY = Math.round(worldPt.y);

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
    }

    // 6. 点击空白处取消选择
    ctx.data.selectedEntity = null;
    ctx.setSelectedGeometryId(null);
    ctx.updateCursor();
    ctx.requestRender();
    ctx.callbacks.onDataChange?.();
    return true;
  }

  public onMouseMove(
    _e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    _delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean {
    // A. 拖拽已有 geometry
    if (this.geometryDrag) {
      const drag = this.geometryDrag;
      const cand = (ctx.data.line_candidates || []).find((c) => c.id === drag.id);
      if (cand) {
        const dx = Math.round(worldPt.x - drag.startWorld.x);
        const dy = Math.round(worldPt.y - drag.startWorld.y);
        const r = drag.startRect;
        let next: { x0: number; y0: number; x1: number; y1: number };

        if (drag.handle === 'move') {
          next = { x0: r.x0 + dx, y0: r.y0 + dy, x1: r.x1 + dx, y1: r.y1 + dy };
        } else if (cand.axis === 'h') {
          if (drag.handle === 'start') next = { ...r, x0: r.x0 + dx };
          else if (drag.handle === 'end') next = { ...r, x1: r.x1 + dx };
          else if (drag.handle === 'thick0') next = { ...r, y0: r.y0 + dy };
          else next = { ...r, y1: r.y1 + dy };
        } else {
          if (drag.handle === 'start') next = { ...r, y0: r.y0 + dy };
          else if (drag.handle === 'end') next = { ...r, y1: r.y1 + dy };
          else if (drag.handle === 'thick0') next = { ...r, x0: r.x0 + dx };
          else next = { ...r, x1: r.x1 + dx };
        }

        if (cand.axis === 'h' && Math.abs(next.y1 - next.y0) < 1) {
          next = drag.handle === 'thick0' ? { ...next, y0: next.y1 - 1 } : { ...next, y1: next.y0 + 1 };
        }
        if (cand.axis === 'v' && Math.abs(next.x1 - next.x0) < 1) {
          next = drag.handle === 'thick0' ? { ...next, x0: next.x1 - 1 } : { ...next, x1: next.x0 + 1 };
        }

        cand.geometry = { type: 'rect', ...next };
        if (cand.axis === 'h') {
          cand.at = Math.round((next.y0 + next.y1) / 2);
          cand.span = [Math.min(next.x0, next.x1), Math.max(next.x0, next.x1)];
          cand.width = Math.abs(next.y1 - next.y0) + 1;
        } else {
          cand.at = Math.round((next.x0 + next.x1) / 2);
          cand.span = [Math.min(next.y0, next.y1), Math.max(next.y0, next.y1)];
          cand.width = Math.abs(next.x1 - next.x0) + 1;
        }
        ctx.requestRender();
      }
      return true;
    }

    // B. 拖拽锚点
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

    // C. 拖拽垂直边界或刻度钉
    if (this.draggingBoundary) {
      const { taxaId, type } = this.draggingBoundary;
      const colIndex = ctx.data.columns.findIndex((c) => c.id === taxaId);
      if (colIndex !== -1) {
        const targetCol = ctx.data.columns[colIndex];
        const newX = Math.round(worldPt.x);

        if (type === 'start') {
          targetCol.startX = newX;
          if (targetCol.scaleCalib) {
            targetCol.scaleCalib.originX = newX;
          }
          if (colIndex > 0) {
            ctx.data.columns[colIndex - 1].endX = newX;
          }
        } else if (type === 'tick') {
          targetCol.tickEndX = newX;
          if (targetCol.scaleCalib) {
            targetCol.scaleCalib.calibX = newX;
          }
        } else {
          targetCol.endX = newX;
          if (colIndex < ctx.data.columns.length - 1) {
            const nextCol = ctx.data.columns[colIndex + 1];
            if (nextCol) {
              nextCol.startX = newX;
              if (nextCol.scaleCalib) {
                nextCol.scaleCalib.originX = newX;
              }
            }
          }
        }
        ctx.requestRender();
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
    let handled = false;

    if (this.geometryDrag) {
      const drag = this.geometryDrag;
      const cand = (ctx.data.line_candidates || []).find((c) => c.id === drag.id);
      if (cand?.geometry) {
        const g = cand.geometry;
        ctx.commitGeometry(drag.id, cand.axis, { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 });
      }
      this.geometryDrag = null;
      handled = true;
    }

    if (this.draggingAnchor && this.hasDraggedAnchor && this.dragInitialPointPos) {
      const col = ctx.data.columns.find((c) => c.id === this.draggingAnchor!.taxaId);
      if (col) {
        ctx.history.push(`Move Anchor in ${col.name}`, ctx.data.columns, ctx.data.activeTaxaId);
        ctx.callbacks.onDataChange?.();
      }
      handled = true;
    }

    if (this.draggingBoundary && this.dragInitialColumn) {
      const col = ctx.data.columns.find((c) => c.id === this.draggingBoundary!.taxaId);
      if (col) {
        ctx.history.push(`Adjust Column Boundary ${col.name}`, ctx.data.columns, ctx.data.activeTaxaId);
        ctx.callbacks.onDataChange?.();
      }
      handled = true;
    }

    this.draggingAnchor = null;
    this.draggingBoundary = null;
    this.dragInitialPointPos = null;
    this.dragInitialColumn = null;
    this.hasDraggedAnchor = false;
    ctx.updateCursor();
    return handled;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.draggingAnchor = null;
    this.draggingBoundary = null;
    this.dragInitialPointPos = null;
    this.dragInitialColumn = null;
    this.hasDraggedAnchor = false;
    this.geometryDrag = null;
  }

  public getCursor(_ctx: ToolContext): string | null {
    if (this.draggingAnchor) return 'move';
    if (this.draggingBoundary) return 'col-resize';
    return null;
  }
}
