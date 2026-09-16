import { Point2D } from '../types/pollen';

export type ImageDisplayMode = 'normal' | 'invert' | 'contrast' | 'binary';

export class Viewport {
  // 视口变换参数 (World to Screen: screenX = worldPt.x * scale + panX; screenY = worldPt.y * scale + panY)
  public scale: number = 1.0;
  public panX: number = 0;
  public panY: number = 0;
  public dpr: number = 1.0;

  public minScale: number = 0.05;
  public maxScale: number = 30.0;

  // 图像高保真滤镜与透视遮罩模式
  public imageMode: ImageDisplayMode = 'normal';
  public showBinaryOverlay: boolean = false; // B 键快速透视遮罩
  public binaryThreshold: number = 138;      // 墨迹灰度阈值
  public degridStrength: 'off' | 'weak' | 'medium' | 'strong' = 'off'; // 去网格横线灵敏度模式

  constructor() {
    this.updateDpr();
  }

  public updateDpr(): void {
    this.dpr = window.devicePixelRatio || 1;
  }

  /**
   * 循环切换底图渲染模式: normal -> invert -> contrast -> binary -> normal
   */
  public cycleImageMode(): ImageDisplayMode {
    const modes: ImageDisplayMode[] = ['normal', 'invert', 'contrast', 'binary'];
    const curIdx = modes.indexOf(this.imageMode);
    this.imageMode = modes[(curIdx + 1) % modes.length];
    return this.imageMode;
  }

  /**
   * 切换 B 键二值化墨迹叠加透视
   */
  public toggleBinaryOverlay(): boolean {
    this.showBinaryOverlay = !this.showBinaryOverlay;
    return this.showBinaryOverlay;
  }

  /**
   * 将屏幕坐标（以 Canvas 左上角为原点的 CSS 像素）转换为世界（图谱图像）真实坐标
   */
  public screenToWorld(screenPt: Point2D): Point2D {
    return {
      x: (screenPt.x - this.panX) / this.scale,
      y: (screenPt.y - this.panY) / this.scale,
    };
  }

  /**
   * 将世界坐标转换为屏幕 CSS 像素坐标
   */
  public worldToScreen(worldPt: Point2D): Point2D {
    return {
      x: worldPt.x * this.scale + this.panX,
      y: worldPt.y * this.scale + this.panY,
    };
  }

  /**
   * 平移视口
   */
  public panBy(deltaScreenX: number, deltaScreenY: number): void {
    this.panX += deltaScreenX;
    this.panY += deltaScreenY;
  }

  /**
   * 以某个屏幕点为锚点进行缩放（常用于鼠标滚轮）
   */
  public zoomAt(screenPt: Point2D, zoomFactor: number): void {
    const oldScale = this.scale;
    const newScale = Math.min(Math.max(oldScale * zoomFactor, this.minScale), this.maxScale);

    if (newScale === oldScale) return;

    const worldPt = this.screenToWorld(screenPt);
    this.scale = newScale;
    this.panX = screenPt.x - worldPt.x * newScale;
    this.panY = screenPt.y - worldPt.y * newScale;
  }

  /**
   * 将整幅图谱适中并完全居中适应屏幕
   */
  public fitToScreen(canvasW: number, canvasH: number, imageW: number, imageH: number, padding: number = 40): void {
    if (imageW <= 0 || imageH <= 0 || canvasW <= 0 || canvasH <= 0) return;

    const availableW = Math.max(10, canvasW - padding * 2);
    const availableH = Math.max(10, canvasH - padding * 2);

    const scaleW = availableW / imageW;
    const scaleH = availableH / imageH;
    this.scale = Math.min(scaleW, scaleH, 1.5);

    this.panX = (canvasW - imageW * this.scale) / 2;
    this.panY = (canvasH - imageH * this.scale) / 2;
  }

  /**
   * 重置缩放到 100% 原始尺寸并在当前中心居中
   */
  public reset100(canvasW: number, canvasH: number, imageW: number, imageH: number): void {
    this.scale = 1.0;
    this.panX = (canvasW - imageW) / 2;
    this.panY = (canvasH - imageH) / 2;
  }

  /**
   * 应用变换矩阵到 CanvasRenderingContext2D (已包含 DPR 处理)
   */
  public applyTransform(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.translate(this.panX, this.panY);
    ctx.scale(this.scale, this.scale);
  }
}
