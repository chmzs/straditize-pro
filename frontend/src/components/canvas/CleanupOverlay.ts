import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export const id = 'cleanup-lines-and-exclusions';
export const z = 20;

/** 手柄边长（屏幕像素）——与 GeologyCanvas.ROI_HANDLE_SIZE_SCREEN 同量级。 */
const HANDLE_SIZE_SCREEN = 8;
/**
 * 条带最小渲染厚度（屏幕像素）。
 *
 * zone 干扰线实际只有 1–2 px 高，按真实厚度画在缩略视图上就是一根发丝，
 * 用户根本看不到 —— 这正是"几何没有视觉显示"的观感来源之一。
 * 只影响显示，不影响后端 mask。
 */
const MIN_BAND_SCREEN = 8;

const COLOR_CANDIDATE = 'rgba(245, 158, 11, 0.95)';
const COLOR_CANDIDATE_FILL = 'rgba(245, 158, 11, 0.28)';
const COLOR_REMOVED = 'rgba(239, 68, 68, 0.95)';
const COLOR_REMOVED_FILL = 'rgba(239, 68, 68, 0.30)';
const COLOR_SELECTED = '#ffffff';

interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 把一个 geometry 归一化成世界坐标条带，并施加最小屏幕厚度。 */
function bandOf(
  geometry: { x0: number; y0: number; x1: number; y1: number },
  inv: number
): Band {
  const minH = MIN_BAND_SCREEN * inv;
  let x = Math.min(geometry.x0, geometry.x1);
  let y = Math.min(geometry.y0, geometry.y1);
  const w = Math.max(Math.abs(geometry.x1 - geometry.x0), inv);
  let h = Math.max(Math.abs(geometry.y1 - geometry.y0), inv);

  // 只在"真实厚度"不足时向两侧补足，保持条带中心不变。
  if (h < minH) {
    y -= (minH - h) / 2;
    h = minH;
  }
  if (w < minH) {
    x -= (minH - w) / 2;
  }
  return { x, y, w: Math.max(w, inv), h };
}

/** 绘制选中 geometry 的端点手柄，提示"可以拖动/缩放"。 */
function drawHandles(ctx: CanvasRenderingContext2D, band: Band, axis: 'h' | 'v', inv: number): void {
  const size = HANDLE_SIZE_SCREEN * inv;
  const midX = band.x + band.w / 2;
  const midY = band.y + band.h / 2;

  const points: Array<[number, number]> =
    axis === 'h'
      ? [
          [band.x, midY],
          [band.x + band.w, midY],
        ]
      : [
          [midX, band.y],
          [midX, band.y + band.h],
        ];

  ctx.save();
  ctx.setLineDash([]);
  for (const [px, py] of points) {
    ctx.fillStyle = COLOR_SELECTED;
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.lineWidth = 1.5 * inv;
    ctx.beginPath();
    ctx.rect(px - size / 2, py - size / 2, size, size);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Step 4 清理叠加层：干扰线 geometry + 排除区。
 *
 * 世界坐标绘制（见 `_registry.ts` 的坐标契约）。任何"屏幕恒定"的尺寸都通过
 * `1 / vp.scale` 反算。
 */
export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void {
  const inv = 1 / (vp.scale || 1);

  // 1. 排除区：最高优先级，用灰色实心块表示"这块不是数据"。
  for (const ex of data.exclusion_regions || []) {
    const pts = ex.points || [];
    if (pts.length < 3) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(156, 163, 175, 0.35)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(107, 114, 128, 0.9)';
    ctx.lineWidth = 1.5 * inv;
    ctx.setLineDash([5 * inv, 4 * inv]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(55, 65, 81, 0.95)';
    ctx.font = `${11 * inv}px sans-serif`;
    ctx.fillText('排除区', pts[0][0] + 4 * inv, pts[0][1] + 13 * inv);
    ctx.restore();
  }

  // 2. 干扰线 geometry：先画未选中的，保证选中项永远压在最上层。
  const selectedId = data.cleanup_selected_id ?? null;
  const candidates = data.line_candidates || [];
  const ordered = [
    ...candidates.filter((c) => c.id !== selectedId),
    ...candidates.filter((c) => c.id === selectedId),
  ];

  for (const c of ordered) {
    const geometry = c.geometry;
    if (!geometry) continue;
    const isSelected = c.id === selectedId;
    const isRemoved = c.status === 'removed';
    const band = bandOf(geometry, inv);

    ctx.save();
    ctx.fillStyle = isRemoved ? COLOR_REMOVED_FILL : COLOR_CANDIDATE_FILL;
    ctx.fillRect(band.x, band.y, band.w, band.h);

    ctx.strokeStyle = isSelected
      ? COLOR_SELECTED
      : isRemoved
        ? COLOR_REMOVED
        : COLOR_CANDIDATE;
    ctx.lineWidth = (isSelected ? 2.5 : 1.5) * inv;
    // 已确认=实线，待确认=虚线：状态一眼可辨。
    ctx.setLineDash(isRemoved ? [] : [6 * inv, 4 * inv]);
    ctx.strokeRect(band.x, band.y, band.w, band.h);
    ctx.setLineDash([]);

    if (isSelected) {
      drawHandles(ctx, band, c.axis, inv);
    }
    ctx.restore();
  }
}
