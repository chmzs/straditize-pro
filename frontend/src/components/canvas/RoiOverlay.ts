import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'roi-indicator';
export const z = 10;

export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  if (!data.rois || data.rois.length === 0) return;

  for (const roi of data.rois) {
    if (!roi.visible) continue;
    const x0 = roi.xlim?.[0] ?? roi.xMin ?? 0;
    const x1 = roi.xlim?.[1] ?? roi.xMax ?? 0;
    const y0 = roi.ylim?.[0] ?? roi.yMin ?? 0;
    const y1 = roi.ylim?.[1] ?? roi.yMax ?? 0;
    const s0 = vp.worldToScreen({ x: x0, y: y0 });
    const s1 = vp.worldToScreen({ x: x1, y: y1 });

    const w = s1.x - s0.x;
    const h = s1.y - s0.y;

    ctx.save();
    ctx.strokeStyle = roi.id === data.active_roi_id ? '#38bdf8' : 'rgba(56, 189, 248, 0.4)';
    ctx.lineWidth = roi.id === data.active_roi_id ? 2 : 1;
    ctx.strokeRect(s0.x, s0.y, w, h);

    // 标签标识
    ctx.fillStyle = roi.id === data.active_roi_id ? '#38bdf8' : 'rgba(56, 189, 248, 0.6)';
    ctx.font = '10px sans-serif';
    ctx.fillText(`${roi.name ?? 'ROI'}${roi.composition ? ' (100%)' : ''}`, s0.x + 4, s0.y - 4);
    ctx.restore();
  }
}
