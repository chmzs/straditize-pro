import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'cleanup-lines-and-exclusions';
export const z = 20;

export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  // 1. 绘制排除区 (Exclusion Regions) -> 灰斜纹或半透明灰遮罩
  const exclusions = data.exclusion_regions || [];
  for (const ex of exclusions) {
    if (!ex.points || ex.points.length < 3) continue;
    const pts = ex.points.map((p) => vp.worldToScreen({ x: p[0], y: p[1] }));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.closePath();

    ctx.fillStyle = 'rgba(156, 163, 175, 0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    // 绘制排除区标识
    ctx.fillStyle = 'rgba(75, 85, 99, 0.9)';
    ctx.font = '10px sans-serif';
    ctx.fillText('排除区 [Exclusion]', pts[0].x + 4, pts[0].y + 12);
    ctx.restore();
  }

  // 2. 绘制已检测/选中的候选线高亮 (红=A/B，黄=C)
  const cands = data.line_candidates || [];
  const selected = new Set(data.selected_candidate_ids || []);

  for (const c of cands) {
    if (!selected.has(c.id)) continue;
    ctx.save();
    if (c.kind === 'C') {
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.7)'; // 黄色
    } else {
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.8)'; // 红色
    }
    ctx.lineWidth = Math.max(1, (c.width || 1) * vp.scale);

    if (c.axis === 'h') {
      const p0 = vp.worldToScreen({ x: c.span[0], y: c.at });
      const p1 = vp.worldToScreen({ x: c.span[1], y: c.at });
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    } else {
      const p0 = vp.worldToScreen({ x: c.at, y: c.span[0] });
      const p1 = vp.worldToScreen({ x: c.at, y: c.span[1] });
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();
  }
}
