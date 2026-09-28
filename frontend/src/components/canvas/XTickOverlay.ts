import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'xticks-ruler-overlay';
export const z = 25;

/**
 * X 轴两点刻度钉与刻度值。
 *
 * 世界坐标绘制（见 `_registry.ts` 的坐标契约）：ctx 已带 world→screen 变换，
 * 这里直接使用 `t.px` / `roi.ylim`，屏幕恒定尺寸用 `1 / scale` 反算。
 */
export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  const cols = data.columns || [];
  const inv = 1 / (vp.scale || 1);
  const y = data.roi?.ylim?.[1] ?? data.roi?.yMax ?? 100;

  for (const col of cols) {
    if (!col.visible || !col.x_ticks || col.x_ticks.length < 2) continue;

    const t0 = col.x_ticks[0];
    const t1 = col.x_ticks[1];
    const isActive = col.id === data.activeTaxaId;

    ctx.save();
    ctx.strokeStyle = isActive ? '#38bdf8' : 'rgba(148, 163, 184, 0.75)';
    ctx.lineWidth = (isActive ? 2 : 1) * inv;

    // 底部刻度齿短线
    ctx.beginPath();
    ctx.moveTo(t0.px, y - 3 * inv);
    ctx.lineTo(t0.px, y + 5 * inv);
    ctx.moveTo(t1.px, y - 3 * inv);
    ctx.lineTo(t1.px, y + 5 * inv);
    ctx.moveTo(t0.px, y);
    ctx.lineTo(t1.px, y);
    ctx.stroke();

    // 刻度值标注
    ctx.fillStyle = isActive ? '#38bdf8' : 'rgba(148, 163, 184, 0.9)';
    ctx.font = `${10 * inv}px monospace`;
    ctx.fillText(String(t0.value), t0.px - 4 * inv, y + 16 * inv);
    ctx.fillText(String(t1.value), t1.px - 4 * inv, y + 16 * inv);
    ctx.restore();
  }
}
