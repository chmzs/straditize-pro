import { Point2D, TaxaColumn, ToolMode } from '../../types/pollen';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class AddColToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'addCol';

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;

    const newX = Math.round(worldPt.x);
    const colWidth = 80;
    const colNum = String(ctx.data.columns.length + 1).padStart(2, '0');
    const newCol: TaxaColumn = {
      id: `taxa_${Date.now()}`,
      name: `col${colNum}`,
      species: `col${colNum}`,
      color: '#38bdf8',
      startX: newX,
      endX: newX + colWidth,
      tickEndX: newX + colWidth,
      maxPercent: 50,
      unit: '%',
      curveType: 'linear',
      visible: true,
      isLocked: true,
      controlPoints: [
        { id: `pt_${Date.now()}_top`, x: newX + 5, y: ctx.data.roi.yMin, type: 'manual', createdAt: Date.now() },
        { id: `pt_${Date.now()}_bot`, x: newX + 5, y: ctx.data.roi.yMax, type: 'manual', createdAt: Date.now() + 1 },
      ],
    };

    ctx.data.columns.push(newCol);
    ctx.data.columns.sort((a, b) => a.startX - b.startX);
    ctx.data.activeTaxaId = newCol.id;
    ctx.history.push(`Add Column ${newCol.name}`, ctx.data.columns, ctx.data.activeTaxaId);
    ctx.notifyNotice(`已在 X:${newX}px 处插入新属种分列！`);
    ctx.setToolMode('select');
    ctx.requestRender();
    ctx.callbacks.onDataChange?.();
    ctx.callbacks.onTaxaChange?.(newCol.id);
    return true;
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }
}
