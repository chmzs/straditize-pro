import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'roi-indicator';
export const z = 10;

export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  if (!data.rois || data.rois.length === 0) return;

  const scale = vp.scale || 1;
  const activeId = data.active_roi_id || (data as any).activeRoiId || data.rois[0]?.id;

  for (const roi of data.rois) {
    if (!roi.visible) continue;
    // Active ROI is already drawn with 8 resize handles by GeologyCanvas.drawRoiOverlay
    if (roi.id === activeId) continue;

    const x0 = roi.xlim?.[0] ?? roi.xMin ?? 0;
    const x1 = roi.xlim?.[1] ?? roi.xMax ?? 0;
    const y0 = roi.ylim?.[0] ?? roi.yMin ?? 0;
    const y1 = roi.ylim?.[1] ?? roi.yMax ?? 0;
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0) continue;

    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.strokeRect(x0, y0, w, h);
    ctx.setLineDash([]);

    // 标签标识（世界坐标系下按 scale 反算字号保持清晰）
    ctx.fillStyle = 'rgba(2, 132, 199, 0.85)';
    ctx.font = `bold ${Math.max(10, 11 / scale)}px sans-serif`;
    ctx.fillText(`${roi.name ?? 'ROI'}${roi.composition ? ' (100%)' : ''}`, x0 + 4 / scale, y0 - 6 / scale);
    ctx.restore();
  }
}
