import { Point2D, ToolMode } from '../../types/pollen';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class PanToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'pan';
  private isMouseDown: boolean = false;

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    _worldPt: Point2D,
    _ctx: ToolContext
  ): boolean {
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      this.isMouseDown = true;
      return true;
    }
    return false;
  }

  public onMouseMove(
    _e: MouseEvent,
    _screenPt: Point2D,
    _worldPt: Point2D,
    delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean {
    if (this.isMouseDown) {
      ctx.viewport.panBy(delta.x, delta.y);
      ctx.requestRender();
      return true;
    }
    return false;
  }

  public onMouseUp(
    _e: MouseEvent,
    _screenPt: Point2D,
    _worldPt: Point2D,
    _ctx: ToolContext
  ): boolean {
    if (this.isMouseDown) {
      this.isMouseDown = false;
      return true;
    }
    return false;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.isMouseDown = false;
  }

  public getCursor(_ctx: ToolContext): string {
    return this.isMouseDown ? 'grabbing' : 'grab';
  }
}
