import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'xticks-ruler-overlay';
export const z = 25;

export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  const cols = data.columns || [];
  for (const col of cols) {
    if (!col.visible || !col.x_ticks || col.x_ticks.length < 2) continue;

    const t0 = col.x_ticks[0];
    const t1 = col.x_ticks[1];

    const p0 = vp.worldToScreen({ x: t0.px, y: (data.roi?.ylim?.[1] ?? data.roi?.yMax ?? 100) });
    const p1 = vp.worldToScreen({ x: t1.px, y: (data.roi?.ylim?.[1] ?? data.roi?.yMax ?? 100) });

    ctx.save();
    ctx.strokeStyle = col.id === data.activeTaxaId ? '#38bdf8' : 'rgba(148, 163, 184, 0.6)';
    ctx.lineWidth = col.id === data.activeTaxaId ? 2 : 1;

    // 绘制底部刻度齿短线
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y - 3);
    ctx.lineTo(p0.x, p0.y + 5);
    ctx.moveTo(p1.x, p1.y - 3);
    ctx.lineTo(p1.x, p1.y + 5);
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    // 刻度值标注
    ctx.fillStyle = col.id === data.activeTaxaId ? '#38bdf8' : 'rgba(148, 163, 184, 0.8)';
    ctx.font = '9px monospace';
    ctx.fillText(String(t0.value), p0.x - 4, p0.y + 14);
    ctx.fillText(String(t1.value), p1.x - 4, p1.y + 14);
    ctx.restore();
  }
}
