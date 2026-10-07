import { Point2D, ToolMode } from '../../types/pollen';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class DrawLineToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode;
  public readonly axis: 'h' | 'v';

  private geometryCreate: {
    axis: 'h' | 'v';
    startWorld: Point2D;
    endWorld: Point2D;
  } | null = null;

  constructor(mode: 'drawLineH' | 'drawLineV') {
    this.mode = mode;
    this.axis = mode === 'drawLineH' ? 'h' : 'v';
  }

  public getGeometryCreate(): { axis: 'h' | 'v'; startWorld: Point2D; endWorld: Point2D } | null {
    return this.geometryCreate;
  }

  public onDeactivate(_ctx: ToolContext): void {
    this.geometryCreate = null;
  }

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;

    this.geometryCreate = {
      axis: this.axis,
      startWorld: worldPt,
      endWorld: worldPt,
    };
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
    if (this.geometryCreate) {
      this.geometryCreate.endWorld = worldPt;
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
    if (this.geometryCreate) {
      const create = this.geometryCreate;
      const x0 = Math.min(create.startWorld.x, create.endWorld.x);
      const x1 = Math.max(create.startWorld.x, create.endWorld.x);
      const y0 = Math.min(create.startWorld.y, create.endWorld.y);
      const y1 = Math.max(create.startWorld.y, create.endWorld.y);
      this.geometryCreate = null;

      const moved = Math.hypot(x1 - x0, y1 - y0);
      if (moved * ctx.viewport.scale >= 6) {
        ctx.commitGeometry(null, create.axis, {
          x0: Math.round(x0),
          y0: Math.round(y0),
          x1: Math.round(x1),
          y1: Math.round(y1),
        });
      } else {
        ctx.notifyNotice('拖拽距离太短，未新建干扰线。请在图上按住并拖出一段距离。');
      }
      ctx.requestRender();
      return true;
    }
    return false;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.geometryCreate = null;
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, toolCtx: ToolContext): void {
    const create = this.geometryCreate;
    if (!create) return;
    const inv = 1 / (toolCtx.viewport.scale || 1);
    const x0 = Math.min(create.startWorld.x, create.endWorld.x);
    const x1 = Math.max(create.startWorld.x, create.endWorld.x);
    const y0 = Math.min(create.startWorld.y, create.endWorld.y);
    const y1 = Math.max(create.startWorld.y, create.endWorld.y);

    ctx.save();
    ctx.fillStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 * inv;
    ctx.setLineDash([6 * inv, 4 * inv]);
    if (create.axis === 'h') {
      ctx.fillRect(x0, y0, Math.max(x1 - x0, inv), Math.max(y1 - y0, inv));
      ctx.strokeRect(x0, y0, Math.max(x1 - x0, inv), Math.max(y1 - y0, inv));
    } else {
      ctx.fillRect(x0, y0, Math.max(x1 - x0, inv), Math.max(y1 - y0, inv));
      ctx.strokeRect(x0, y0, Math.max(x1 - x0, inv), Math.max(y1 - y0, inv));
    }
    ctx.restore();
  }
}
