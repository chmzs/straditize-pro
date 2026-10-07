import { DataRoi, Point2D, ToolMode } from '../../types/pollen';
import { RoiHandle, ToolContext, ToolStrategy } from './ToolStrategy';

export class RoiToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'roi';

  private draggingRoiHandle: RoiHandle | null = null;
  private dragInitialRoi: DataRoi | null = null;

  public getDraggingHandle(): RoiHandle | null {
    return this.draggingRoiHandle;
  }

  public onMouseDown(
    e: MouseEvent,
    screenPt: Point2D,
    _worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;
    const hitRoi = ctx.findHitRoiHandle(screenPt);
    if (hitRoi) {
      this.draggingRoiHandle = hitRoi;
      this.dragInitialRoi = { ...ctx.data.roi };
      ctx.updateCursor();
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
    if (!this.draggingRoiHandle) return false;

    const h = this.draggingRoiHandle;
    const maxW = ctx.data.imageWidth || 8000;
    const maxH = ctx.data.imageHeight || 12000;
    const x = Math.max(0, Math.min(Math.round(worldPt.x), maxW));
    const y = Math.max(0, Math.min(Math.round(worldPt.y), maxH));
    const roi = ctx.data.roi;

    if (h.includes('l')) roi.xMin = Math.max(0, Math.min(x, roi.xMax - 20));
    if (h.includes('r')) roi.xMax = Math.min(maxW, Math.max(x, roi.xMin + 20));
    if (h.includes('t')) roi.yMin = Math.max(0, Math.min(y, roi.yMax - 20));
    if (h.includes('b')) roi.yMax = Math.min(maxH, Math.max(y, roi.yMin + 20));

    ctx.requestRender();
    return true;
  }

  public onMouseUp(
    _e: MouseEvent,
    _screenPt: Point2D,
    _worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (this.draggingRoiHandle && this.dragInitialRoi) {
      const roi = ctx.data.roi;
      ctx.history.push(
        'Resize Data ROI',
        ctx.data.columns,
        ctx.data.activeTaxaId,
        ctx.data.calibration,
        roi
      );
      ctx.notifyNotice(
        `数据有效区已调整为: X [${roi.xMin}, ${roi.xMax}] × Y [${roi.yMin}, ${roi.yMax}] px（深度标定不受影响）`
      );
      ctx.callbacks.onRoiCommitted?.({ ...roi });
      ctx.callbacks.onDataChange?.();
      this.draggingRoiHandle = null;
      this.dragInitialRoi = null;
      ctx.updateCursor();
      ctx.requestRender();
      return true;
    }

    this.draggingRoiHandle = null;
    this.dragInitialRoi = null;
    return false;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    this.draggingRoiHandle = null;
    this.dragInitialRoi = null;
  }

  public getCursor(_ctx: ToolContext): string | null {
    if (this.draggingRoiHandle) {
      const h = this.draggingRoiHandle;
      if (h === 'tl' || h === 'br') return 'nwse-resize';
      if (h === 'tr' || h === 'bl') return 'nesw-resize';
      if (h === 't' || h === 'b') return 'ns-resize';
      if (h === 'l' || h === 'r') return 'ew-resize';
    }
    return null;
  }
}
