/**
 * 底图绘制：原图 / 反相 / 高对比 / 纯二值化，加 B 键去线透视遮罩。
 *
 * ## 为什么单独成模块
 *
 * 这段是渲染管线的第一层，却和视口裁剪、图像的 broken 状态、二值掩膜三件事缠在一起。
 * 搬出来后依赖全部摆在 env 上：谁提供图像、谁判加载完成、谁给视口矩形，一目了然。
 *
 * ## 两条容易退化的不变量
 *
 * 1. **broken 图必须短路**：`naturalWidth === 0` 时 `drawImage` 抛 InvalidStateError，
 *    会中断整条渲染管线（历史缺陷）。`isImageLoaded` 只是第一道闸，这里要再兜一次。
 * 2. **遮罩画的就是后端掩膜**：白=保留墨迹、红=实际剔除像素。所见即数字化实际所用，
 *    前端绝不自绘另一套（否则"看到的"和"删掉的"会打架）。
 */
import type { ImageDisplayMode } from '../../core/Viewport';
import type { Point2D } from '../../types/pollen';

export interface BackgroundEnv {
  ctx: CanvasRenderingContext2D;
  isLight: boolean;
  /** 底图；null = 无图（零状态）。 */
  image: HTMLImageElement | null;
  /** 底图是否已完成解码。 */
  imageLoaded: boolean;
  /** 后端 `algorithm.degrid` 产生的掩膜图；B 键透视与 binary 模式都用它。 */
  overlayImage: HTMLImageElement | null;
  imageMode: ImageDisplayMode;
  showBinaryOverlay: boolean;
  scale: number;
  /** 视口 CSS 尺寸（用于只光栅化可见切片）。 */
  viewportSize: Point2D;
  screenToWorld: (pt: Point2D) => Point2D;
  data: { imageSrc?: string | null; imageWidth?: number; imageHeight?: number };
}

export function drawBackgroundDiagramOverlay(env: BackgroundEnv): void {
  const { ctx, isLight, image, imageLoaded, overlayImage, imageMode, showBinaryOverlay, scale } = env;

  if (image && imageLoaded && image.naturalWidth > 0) {
    const w = image.naturalWidth;
    const h = image.naturalHeight;

    // 日间模式下给图谱底纸加柔和投影（立体感）
    if (isLight) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
      ctx.shadowBlur = 16 / scale;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4 / scale;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 纯二值化模式：直接用后端掩膜铺在深色画板上
    if (imageMode === 'binary' && overlayImage) {
      ctx.fillStyle = '#090f19';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(overlayImage, 0, 0, w, h);
    } else {
      if (imageMode === 'invert') {
        ctx.filter = 'invert(1) hue-rotate(180deg) brightness(105%) contrast(120%)';
      } else if (imageMode === 'contrast') {
        ctx.filter = 'contrast(240%) brightness(105%)';
      }

      // 视口裁剪：超大图谱只光栅化可见切片，显著降 GPU 负荷
      const minW = env.screenToWorld({ x: 0, y: 0 });
      const maxW = env.screenToWorld({ x: env.viewportSize.x, y: env.viewportSize.y });

      const sx = Math.max(0, Math.floor(minW.x));
      const sy = Math.max(0, Math.floor(minW.y));
      const sw = Math.min(w - sx, Math.ceil(maxW.x - minW.x) + 2);
      const sh = Math.min(h - sy, Math.ceil(maxW.y - minW.y) + 2);

      if (sw > 0 && sh > 0 && sx < w && sy < h) {
        ctx.drawImage(image, sx, sy, sw, sh, sx, sy, sw, sh);
      } else {
        ctx.drawImage(image, 0, 0);
      }
      ctx.filter = 'none';
    }
    ctx.restore();

    // B 键去线透视遮罩：画的是后端掩膜本身
    if (showBinaryOverlay && overlayImage) {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.drawImage(overlayImage, 0, 0, w, h);
      ctx.restore();
    }
  } else if (env.data.imageSrc) {
    // 仅"已声明路径但尚未解码完成"的短暂瞬间显示占位；零状态交给 emptyStateOverlay。
    ctx.save();
    ctx.fillStyle = isLight ? '#f8fafc' : '#1e293b';
    ctx.fillRect(0, 0, env.data.imageWidth || 1600, env.data.imageHeight || 1000);
    ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
    ctx.font = '16px sans-serif';
    ctx.fillText('正在解码图谱...', 40, 60);
    ctx.restore();
  }
}
