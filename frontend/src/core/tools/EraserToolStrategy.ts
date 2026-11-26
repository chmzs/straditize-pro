import { Point2D, ToolMode } from '../../types/pollen';
import { DeletePointCommand } from '../Commands';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class EraserToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'eraser';
  private isErasing: boolean = false;
  private erasedCount: number = 0;
  private affectedColIds: Set<string> = new Set();

  private tryEraseAt(screenPt: Point2D, ctx: ToolContext): boolean {
    let hitAnchor = ctx.findHitAnchor(screenPt);
    if (!hitAnchor) {
      // 容差适度放宽至屏幕 18px，支持点在拐点附近快速吸附删除（方案 1.3）
      const activeCol = ctx.getActiveColumn();
      const colsToScan = activeCol
        ? [activeCol, ...ctx.data.columns.filter((c) => c.id !== activeCol.id)]
        : ctx.data.columns;
      for (const col of colsToScan) {
        if (!col.visible) continue;
        for (const pt of col.controlPoints) {
          const s = ctx.viewport.worldToScreen(pt);
          if (Math.hypot(s.x - screenPt.x, s.y - screenPt.y) <= 18) {
            hitAnchor = { taxaId: col.id, pointId: pt.id };
            break;
          }
        }
        if (hitAnchor) break;
      }
    }

    if (hitAnchor) {
      const col = ctx.data.columns.find((c) => c.id === hitAnchor.taxaId);
      if (col) {
        const pt = col.controlPoints.find((p) => p.id === hitAnchor.pointId);
        if (pt) {
          ctx.recordControlPointsBeforeEdit?.(col.id);
          const cmd = new DeletePointCommand(col.id, pt, col.name);
          cmd.execute(ctx.data);
          this.erasedCount++;
          this.affectedColIds.add(col.id);
          ctx.requestRender();
          return true;
        }
      }
    }
    return false;
  }

  public onMouseDown(
    e: MouseEvent,
    screenPt: Point2D,
    _worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;

    this.isErasing = true;
    this.erasedCount = 0;
    this.affectedColIds.clear();

    // 1. 尝试擦除命中控制点
    const erased = this.tryEraseAt(screenPt, ctx);
    if (erased) {
      ctx.callbacks.onDataChange?.();
      return true;
    }

    // 方案 1.3：彻底移除画布点击分界线删列逻辑！
    // 画布仅服务于局部控制点的增/删/改，严禁因点偏误删整列；删列仅保留在左侧边栏管理。
    return true; // 橡皮擦模式点击空白吞噬事件
  }

  public onMouseMove(
    e: MouseEvent,
    screenPt: Point2D,
    _worldPt: Point2D,
    _delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean {
    // 按住鼠标左键连续拖拽擦除经过的控制点
    if (this.isErasing && (e.buttons & 1) === 1) {
      const erased = this.tryEraseAt(screenPt, ctx);
      if (erased) {
        ctx.notifyNotice(`连续擦除控制点中... 已擦除 ${this.erasedCount} 个点`);
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
  ): void {
    if (this.isErasing) {
      this.isErasing = false;
      if (this.erasedCount > 0) {
        for (const colId of this.affectedColIds) {
          ctx.commitControlPoints(colId);
        }
        this.affectedColIds.clear();
        ctx.notifyNotice(`橡皮擦擦除完成：已删除 ${this.erasedCount} 个控制点`);
        ctx.callbacks.onDataChange?.();
      }
    }
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.isErasing = false;
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }
}
