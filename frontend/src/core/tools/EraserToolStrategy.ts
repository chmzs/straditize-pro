import { Point2D, ToolMode } from '../../types/pollen';
import { DeletePointCommand } from '../Commands';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class EraserToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'eraser';

  public onMouseDown(
    e: MouseEvent,
    screenPt: Point2D,
    _worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;

    const hitAnchor = ctx.findHitAnchor(screenPt);
    if (hitAnchor) {
      const col = ctx.data.columns.find((c) => c.id === hitAnchor.taxaId);
      if (col) {
        const pt = col.controlPoints.find((p) => p.id === hitAnchor.pointId);
        if (pt) {
          const cmd = new DeletePointCommand(col.id, pt, col.name);
          ctx.history.push(`Delete Anchor from ${col.name}`, ctx.data.columns, ctx.data.activeTaxaId);
          cmd.execute(ctx.data);
          ctx.notifyNotice(`已删除 ${col.name} 在深度层位 Y:${pt.y} 处的拐点`);
          ctx.requestRender();
          ctx.callbacks.onDataChange?.();
        }
      }
      return true;
    }

    const hitBoundary = ctx.findHitBoundary(screenPt);
    if (hitBoundary) {
      const colIdx = ctx.data.columns.findIndex((c) => c.id === hitBoundary.taxaId);
      if (colIdx !== -1 && ctx.data.columns.length > 1) {
        const deleted = ctx.data.columns.splice(colIdx, 1)[0];
        ctx.history.push(`Delete Column ${deleted.name}`, ctx.data.columns, ctx.data.activeTaxaId);
        ctx.notifyNotice(`已删除属种列: ${deleted.name}`);
        ctx.requestRender();
        ctx.callbacks.onDataChange?.();
      }
      return true;
    }

    return true; // 橡皮擦模式点击空白吞噬事件
  }

  public getCursor(_ctx: ToolContext): string {
    return 'not-allowed';
  }
}
