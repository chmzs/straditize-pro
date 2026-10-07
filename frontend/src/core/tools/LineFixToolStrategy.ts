import { LineMaskStroke, Point2D, ToolMode } from '../../types/pollen';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class LineFixToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'linefix';
  public readonly brushRadiusScreen = 18;

  private lineFixPoints: Point2D[] | null = null;

  public hasStrokePreview(): boolean {
    return Boolean(this.lineFixPoints && this.lineFixPoints.length > 0);
  }

  public getLineFixPoints(): Point2D[] | null {
    return this.lineFixPoints;
  }

  public onActivate(ctx: ToolContext): void {
    ctx.viewport.showBinaryOverlay = true;
    ctx.requestRender();
  }

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;
    this.lineFixPoints = [{ x: worldPt.x, y: worldPt.y }];
    ctx.requestRender();
    return true;
  }

  public onMouseMove(
    _e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    _delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean {
    if (this.lineFixPoints) {
      this.lineFixPoints.push({ x: worldPt.x, y: worldPt.y });
      ctx.requestRender();
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
    if (this.lineFixPoints && this.lineFixPoints.length > 0) {
      const stroke: LineMaskStroke = {
        id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        mode: ctx.lineFixMode,
        radius: Math.max(2, Math.round(this.brushRadiusScreen / ctx.viewport.scale)),
        points: this.lineFixPoints.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
      };
      this.lineFixPoints = null;
      ctx.callbacks.onLineFixStroke?.(stroke);
      ctx.requestRender();
      return true;
    }

    this.lineFixPoints = null;
    return false;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.lineFixPoints = null;
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, toolCtx: ToolContext): void {
    const pts = this.lineFixPoints;
    if (!pts || pts.length === 0) return;

    const scale = toolCtx.viewport.scale;
    const radius = Math.max(2, this.brushRadiusScreen / scale);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle =
      toolCtx.lineFixMode === 'erase' ? 'rgba(56, 189, 248, 0.85)' : 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = radius * 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) {
      ctx.lineTo(p.x, p.y);
    }
    if (pts.length === 1) {
      ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
