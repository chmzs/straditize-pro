import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'sample-horizons-overlay';
export const z = 30;

export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  const samples = data.samples || [];
  if (samples.length === 0) return;

  const roi = data.rois?.find((r) => r.id === data.active_roi_id) || data.rois?.[0];
  const rx0 = roi?.xlim?.[0] ?? roi?.xMin ?? 0;
  const rx1 = roi?.xlim?.[1] ?? roi?.xMax ?? (data.imageWidth || 1000);

  const p0 = vp.worldToScreen({ x: rx0, y: 0 });
  const p1 = vp.worldToScreen({ x: rx1, y: 0 });

  ctx.save();
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);

  for (const s of samples) {
    const sy = vp.worldToScreen({ x: 0, y: s.row_px }).y;

    if (s.source === 'auto') {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.6)'; // 绿色虚线
    } else if (s.source === 'paste') {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)'; // 蓝色虚线
    } else {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)'; // 橙色虚线
    }

    ctx.beginPath();
    ctx.moveTo(p0.x, sy);
    ctx.lineTo(p1.x, sy);
    ctx.stroke();

    // 绘制层位深度标签
    if (s.depth !== null) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '9px monospace';
      ctx.fillText(`${s.depth}`, p0.x - 28, sy + 3);
    }
  }

  ctx.restore();
}
