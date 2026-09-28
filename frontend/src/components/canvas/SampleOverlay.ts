import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'sample-horizons-overlay';
export const z = 30;

/**
 * 采样层位横线。
 *
 * 世界坐标绘制（见 `_registry.ts` 的坐标契约）。
 */
export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  const samples = data.samples || [];
  if (samples.length === 0) return;

  const inv = 1 / (vp.scale || 1);
  const roi = data.rois?.find((r) => r.id === data.active_roi_id) || data.rois?.[0];
  const rx0 = roi?.xlim?.[0] ?? roi?.xMin ?? 0;
  const rx1 = roi?.xlim?.[1] ?? roi?.xMax ?? data.imageWidth ?? 1000;

  ctx.save();
  ctx.lineWidth = 1 * inv;
  ctx.setLineDash([2 * inv, 4 * inv]);
  ctx.font = `${10 * inv}px monospace`;

  for (const s of samples) {
    if (s.source === 'auto') {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)'; // 绿色虚线
    } else if (s.source === 'paste') {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.8)'; // 蓝色虚线
    } else {
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)'; // 橙色虚线
    }

    ctx.beginPath();
    ctx.moveTo(rx0, s.row_px);
    ctx.lineTo(rx1, s.row_px);
    ctx.stroke();

    if (s.depth !== null && s.depth !== undefined) {
      ctx.fillStyle = ctx.strokeStyle as string;
      ctx.fillText(`${s.depth}`, rx0 - 30 * inv, s.row_px + 3 * inv);
    }
  }

  ctx.restore();
}
