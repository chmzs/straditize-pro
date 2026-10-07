import { Point2D, ToolMode } from '../../types/pollen';
import { ToolContext, ToolStrategy } from './ToolStrategy';

export class MeasureToolStrategy implements ToolStrategy {
  public readonly mode: ToolMode = 'measure';

  private measureDrag: { a: Point2D; b: Point2D } | null = null;
  private measureLine: { a: Point2D; b: Point2D } | null = null;

  public hasActiveRuler(): boolean {
    return Boolean(this.measureDrag || this.measureLine);
  }

  public getMeasureRuler(): { a: Point2D; b: Point2D } | null {
    return this.measureDrag || this.measureLine;
  }

  public onDeactivate(ctx: ToolContext): void {
    if (this.measureDrag || this.measureLine) {
      this.measureDrag = null;
      this.measureLine = null;
      ctx.requestRender();
    }
  }

  public onMouseDown(
    e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (e.button !== 0) return false;

    this.measureDrag = { a: { x: worldPt.x, y: worldPt.y }, b: { x: worldPt.x, y: worldPt.y } };
    this.measureLine = null;
    ctx.requestRender();
    return true;
  }

  public onMouseMove(
    _e: MouseEvent,
    _screenPt: Point2D,
    worldPt: Point2D,
    _delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean {
    if (this.measureDrag) {
      this.measureDrag.b = { x: worldPt.x, y: worldPt.y };
      ctx.requestRender();
      return true;
    }
    return false;
  }

  public onMouseUp(
    _e: MouseEvent,
    _screenPt: Point2D,
    _worldPt: Point2D,
    ctx: ToolContext
  ): boolean {
    if (this.measureDrag) {
      const m = this.measureDrag;
      this.measureDrag = null;
      this.measureLine = m;
      const dx = Math.abs(m.b.x - m.a.x);
      const dy = Math.abs(m.b.y - m.a.y);
      const dist = Math.hypot(dx, dy);
      const thin = dx > 0 && dy > 0 && Math.min(dx, dy) <= 12 && Math.max(dx, dy) > 12;
      ctx.notifyNotice(
        `测量: Δx ${dx.toFixed(1)} · Δy ${dy.toFixed(1)} · 距离 ${dist.toFixed(1)} px` +
          (thin ? `（横跨方向的 ${Math.min(dx, dy).toFixed(1)}px 即线宽，可填入侧栏"统一厚度"）` : '')
      );
      ctx.requestRender();
      return true;
    }
    return false;
  }

  public onMouseLeave(_e: MouseEvent, _ctx: ToolContext): void {
    if (this.measureDrag) {
      this.measureDrag = null;
    }
  }

  public getCursor(_ctx: ToolContext): string {
    return 'crosshair';
  }

  public renderOverlay(ctx: CanvasRenderingContext2D, toolCtx: ToolContext): void {
    const m = this.measureDrag || this.measureLine;
    if (!m) return;
    const inv = 1 / toolCtx.viewport.scale;
    const dx = Math.abs(m.b.x - m.a.x);
    const dy = Math.abs(m.b.y - m.a.y);
    const dist = Math.hypot(dx, dy);

    ctx.save();

    // 主测量线
    ctx.setLineDash([6 * inv, 4 * inv]);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5 * inv;
    ctx.beginPath();
    ctx.moveTo(m.a.x, m.a.y);
    ctx.lineTo(m.b.x, m.b.y);
    ctx.stroke();

    // 正交投影边：量线宽看 Δy，量间距看 Δx
    ctx.setLineDash([3 * inv, 3 * inv]);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
    ctx.beginPath();
    ctx.moveTo(m.a.x, m.a.y);
    ctx.lineTo(m.b.x, m.a.y);
    ctx.lineTo(m.b.x, m.b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 两端十字准星
    for (const p of [m.a, m.b]) {
      ctx.beginPath();
      ctx.moveTo(p.x - 5 * inv, p.y);
      ctx.lineTo(p.x + 5 * inv, p.y);
      ctx.moveTo(p.x, p.y - 5 * inv);
      ctx.lineTo(p.x, p.y + 5 * inv);
      ctx.stroke();
    }

    // 读数标签
    const label = `Δx ${dx.toFixed(1)} · Δy ${dy.toFixed(1)} · ${dist.toFixed(1)} px`;
    ctx.font = `${12 * inv}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const tw = ctx.measureText(label).width;
    const padX = 6 * inv;
    const padY = 4 * inv;
    const boxH = 12 * inv + padY * 2;
    const bx = m.b.x + 10 * inv;
    const by = m.b.y - boxH - 10 * inv;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(bx, by, tw + padX * 2, boxH);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1 * inv;
    ctx.strokeRect(bx, by, tw + padX * 2, boxH);
    ctx.fillStyle = '#e0f2fe';
    ctx.textBaseline = 'top';
    ctx.fillText(label, bx + padX, by + padY);

    ctx.restore();
  }
}
