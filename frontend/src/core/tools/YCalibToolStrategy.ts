import { Point2D, ToolMode } from '../../types/pollen';
import { canPickYCalibMark } from '../WorkflowStage';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class YCalibToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'ycalib';

  public hasMarksOrHover(toolCtx: ToolContext): boolean {
    const cal = toolCtx.data.calibration;
    const marks = toolCtx.yCalibMarks;
    const y1Px = marks[0]?.y ?? (cal.top_px !== null && cal.top_px !== undefined ? Number(cal.top_px) : null);
    const y2Px = marks[1]?.y ?? (cal.bottom_px !== null && cal.bottom_px !== undefined ? Number(cal.bottom_px) : null);
    const hasItems = (y1Px !== null && !Number.isNaN(y1Px)) || (y2Px !== null && !Number.isNaN(y2Px));
    const isYCalibMode = toolCtx.workflowStage === 3;
    return hasItems || (isYCalibMode && Boolean(toolCtx.hoverWorldPt));
  }

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;

    if (canPickYCalibMark(ctx.workflowStage, this.mode)) {
      const maxH = ctx.data.imageHeight || 12000;
      const maxW = ctx.data.imageWidth || 8000;
      const markY = Math.max(0, Math.min(Math.round(worldPt.y), maxH));
      const markX = Math.max(0, Math.min(Math.round(worldPt.x), maxW));

      let marks = [...ctx.yCalibMarks];
      if (marks.length >= 2) {
        marks = [];
      }
      if (marks.some((m) => m.y === markY)) {
        ctx.notifyNotice('两点标定需要两个不同的像素行，请再点另一行。');
        return true;
      }
      marks.push({ x: markX, y: markY });
      ctx.setYCalibMarks(marks);
      ctx.requestRender();

      if (marks.length === 2) {
        const picked = [...marks].sort((a, b) => a.y - b.y);
        ctx.setYCalibMarks(picked);
        ctx.callbacks.onYCalibPicked?.(picked);
      } else {
        ctx.callbacks.onYCalibPicked?.([...marks]);
        ctx.notifyNotice(
          `已记录第 1 个标定点 Y1 = ${markY}px。请在 Y 轴上再点第 2 个已知刻度的位置 (Y2)。`
        );
      }
      return true;
    }

    return false;
  }

  public onMouseMove(
    _e: MouseEvent,
    _screenPt: Point2D,
    _worldPt: Point2D,
    _delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean {
    // 鼠标在 Y 标定模式下悬停移动，需要重绘更新跟随水平指引线
    ctx.requestRender();
    return false;
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, toolCtx: ToolContext): void {
    const cal = toolCtx.data.calibration;
    const roi = toolCtx.data.roi;
    const scale = toolCtx.viewport.scale;
    const marks = toolCtx.yCalibMarks;

    const defaultRailX = Math.max(20 / scale, roi.xMin - 24 / scale);

    interface CalibPointItem {
      tag: 'Y1' | 'Y2';
      x: number;
      y: number;
      val: number | null | undefined;
      color: string;
    }
    const items: CalibPointItem[] = [];

    const y1Px = marks[0]?.y ?? (cal.top_px !== null && cal.top_px !== undefined ? Number(cal.top_px) : null);
    const y1X = marks[0]?.x ?? defaultRailX;
    if (y1Px !== null && !Number.isNaN(y1Px)) {
      items.push({
        tag: 'Y1',
        x: y1X,
        y: y1Px,
        val: cal.top_cm,
        color: '#f59e0b',
      });
    }

    const y2Px = marks[1]?.y ?? (cal.bottom_px !== null && cal.bottom_px !== undefined ? Number(cal.bottom_px) : null);
    const y2X = marks[1]?.x ?? defaultRailX;
    if (y2Px !== null && !Number.isNaN(y2Px)) {
      items.push({
        tag: 'Y2',
        x: y2X,
        y: y2Px,
        val: cal.bottom_cm,
        color: '#10b981',
      });
    }

    if (items.length === 0 && !toolCtx.hoverWorldPt) return;

    ctx.save();
    const fontPx = Math.max(10, 11.5 / scale);
    ctx.font = `bold ${fontPx}px 'JetBrains Mono', monospace`;

    const drawPill = (
      text: string,
      anchorX: number,
      centerY: number,
      borderColor: string,
      textColor: string,
      alignLeft: boolean = true
    ) => {
      const padX = 6 / scale;
      const padY = 3.5 / scale;
      const textW = ctx.measureText(text).width;
      const boxW = textW + padX * 2;
      const boxH = fontPx + padY * 2;
      const boxX = alignLeft ? anchorX : anchorX - boxW;
      const boxY = centerY - boxH / 2;
      const radius = 4 / scale;

      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, radius);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fill();
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = borderColor;
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, boxX + padX, centerY);
    };

    // 绘制已记录点
    for (const item of items) {
      ctx.beginPath();
      ctx.setLineDash([4 / scale, 4 / scale]);
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 1.5 / scale;
      ctx.moveTo(item.x, item.y);
      ctx.lineTo(roi.xMax, item.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(item.x, item.y, 5 / scale, 0, Math.PI * 2);
      ctx.fillStyle = item.color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 / scale;
      ctx.stroke();

      const label =
        item.val !== null && item.val !== undefined
          ? `${item.tag}: ${item.val} ${cal.unit || 'cm'} (${item.y}px)`
          : `${item.tag}: ${item.y}px`;
      drawPill(label, item.x + 10 / scale, item.y, item.color, item.color, true);
    }

    // 悬停指引线
    if (toolCtx.hoverWorldPt) {
      const hy = Math.round(toolCtx.hoverWorldPt.y);
      ctx.beginPath();
      ctx.setLineDash([3 / scale, 3 / scale]);
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
      ctx.lineWidth = 1.2 / scale;
      ctx.moveTo(0, hy);
      ctx.lineTo(Math.max(toolCtx.data.imageWidth || 4000, roi.xMax), hy);
      ctx.stroke();
      ctx.setLineDash([]);

      const nextTag = marks.length === 0 ? 'Y1' : marks.length === 1 ? 'Y2' : 'Y1 (重置)';
      drawPill(
        `点击确定 ${nextTag}: ${hy}px`,
        toolCtx.hoverWorldPt.x + 12 / scale,
        hy,
        '#f59e0b',
        '#facc15',
        true
      );
    }

    ctx.restore();
  }
}
