/**
 * ROI（取数区）叠层：半透明遮罩 + 虚线边框 + 8 个屏幕像素恒定的手柄 + 像素范围标签。
 *
 * 手柄尺寸是**屏幕 px 恒定**的（ROI_HANDLE_SIZE_SCREEN / scale）：缩放后手柄看起来一样大，
 * 否则 25% 缩放下手柄只剩 1 个像素，用户抓不到。命中判定在 canvas/hitTest.ts 用同一口径。
 *
 * 标签只报像素范围（ROI 不是刻度）：若写成 0–20%，用户会以为那是读数。
 */
import type { DataRoi, Point2D } from '../../types/pollen';
import type { RoiHandle } from '../../core/tools';

export interface RoiOverlayEnv {
  ctx: CanvasRenderingContext2D;
  isLight: boolean;
  roi: DataRoi;
  scale: number;
  /** 当前工具是 roi（决定强调色与虚线与否）。 */
  isRoiMode: boolean;
  /** 手柄边长（屏幕 px）。 */
  handleSizeScreen: number;
  hoveredHandle: RoiHandle | null;
  draggingHandle: RoiHandle | null;
}

export function drawRoiOverlay(env: RoiOverlayEnv): void {
  const { ctx, isLight, roi, scale, isRoiMode, handleSizeScreen, hoveredHandle, draggingHandle } = env;
  ctx.save();

  const boxW = roi.xMax - roi.xMin;
  const boxH = roi.yMax - roi.yMin;

  // 1. 半透明取数区遮罩框
  ctx.fillStyle = isLight
    ? (isRoiMode ? 'rgba(2, 132, 199, 0.08)' : 'rgba(2, 132, 199, 0.03)')
    : (isRoiMode ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.03)');
  ctx.fillRect(roi.xMin, roi.yMin, boxW, boxH);

  // 2. 数据有效区外边框
  ctx.strokeStyle = isLight
    ? (isRoiMode ? '#0284c7' : 'rgba(2, 132, 199, 0.7)')
    : (isRoiMode ? '#38bdf8' : 'rgba(56, 189, 248, 0.7)');
  ctx.lineWidth = (isRoiMode ? 2.2 : 1.5) / scale;
  ctx.setLineDash(isRoiMode ? [] : [6 / scale, 4 / scale]);
  ctx.strokeRect(roi.xMin, roi.yMin, boxW, boxH);

  // 3. 8 个手柄（四角 + 四边中点）
  const handleSize = handleSizeScreen / scale;
  const midX = (roi.xMin + roi.xMax) / 2;
  const midY = (roi.yMin + roi.yMax) / 2;
  const handles: Record<string, Point2D> = {
    tl: { x: roi.xMin, y: roi.yMin },
    tr: { x: roi.xMax, y: roi.yMin },
    bl: { x: roi.xMin, y: roi.yMax },
    br: { x: roi.xMax, y: roi.yMax },
    t: { x: midX, y: roi.yMin },
    b: { x: midX, y: roi.yMax },
    l: { x: roi.xMin, y: midY },
    r: { x: roi.xMax, y: midY },
  };

  ctx.setLineDash([]);
  for (const [key, pt] of Object.entries(handles)) {
    const isHovered = hoveredHandle === key || draggingHandle === key;
    const hSize = isHovered ? handleSize * 1.3 : handleSize;

    ctx.fillStyle = isHovered ? '#f97316' : '#ffffff';
    ctx.strokeStyle = isLight ? '#0f172a' : '#0b0f19';
    ctx.lineWidth = 1.5 / scale;

    ctx.fillRect(pt.x - hSize / 2, pt.y - hSize / 2, hSize, hSize);
    ctx.strokeRect(pt.x - hSize / 2, pt.y - hSize / 2, hSize, hSize);
  }

  // 4. 标签只报像素范围（ROI 不是刻度）
  ctx.fillStyle = isLight ? '#0284c7' : '#7dd3fc';
  ctx.font = 'bold ' + Math.max(10, 11 / scale) + 'px JetBrains Mono, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('ROI Y: ' + Math.round(roi.yMin) + 'px', roi.xMin - 8 / scale, roi.yMin + 4 / scale);
  ctx.fillText('ROI Y: ' + Math.round(roi.yMax) + 'px', roi.xMin - 8 / scale, roi.yMax + 4 / scale);

  ctx.restore();
}
