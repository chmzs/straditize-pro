import { Point2D, ToolMode } from '../../types/pollen';
import { ToolContext, ToolStrategy } from './ToolStrategy';

/**
 * 点选 X 轴刻度齿（步骤 6 的组级标定用）。
 *
 * 分工与 `YCalibToolStrategy` 一致：**画布只报坐标，判定全在面板**。
 * 工具本身不判断"最近的齿是哪个、距 0 点多少" —— 那需要
 * `measureRulerGeometry` 的结果，而它归步骤 6 面板持有。
 * 这样画布不必知道刻度检测的任何细节。
 */
export class PickTickToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'pickTick';

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;
    // 只有步骤 6 起才有"X 轴刻度标定"这回事。
    if (ctx.workflowStage < 6) return false;
    const maxW = ctx.data.imageWidth || 8000;
    const maxH = ctx.data.imageHeight || 12000;
    const x = Math.max(0, Math.min(Math.round(worldPt.x), maxW));
    const y = Math.max(0, Math.min(Math.round(worldPt.y), maxH));
    ctx.callbacks.onTickPicked?.({ x, y });
    return true;
  }

  public getCursor(): string {
    return 'crosshair';
  }
}
