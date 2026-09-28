import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export interface OverlayModule {
  id: string;
  z: number;
  /**
   * 绘制叠加层。
   *
   * **坐标契约：世界坐标（图谱图像像素）。** 叠加层在 `Viewport.applyTransform`
   * 之后被调用，ctx 已经带有 world→screen 变换，因此必须**直接**用世界坐标绘制，
   * 绝不能调用 `vp.worldToScreen()` —— 那会把变换应用第二次，几何会被画到错误
   * 位置（历史上 CleanupOverlay / XTickOverlay / SampleOverlay 都因此不可见）。
   *
   * 需要"屏幕上恒定"的线宽 / 手柄 / 字号时，用 `1 / vp.scale` 反算：
   * `ctx.lineWidth = 2 / vp.scale`。
   */
  draw: (ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport) => void;
}

// 自动扫描 canvas 目录下的所有 *Overlay.ts
const modules = import.meta.glob<OverlayModule>('./*Overlay.ts', { eager: true });

const overlayRegistry: OverlayModule[] = [];

for (const path in modules) {
  const mod = modules[path];
  if (typeof mod.id === 'string' && typeof mod.z === 'number' && typeof mod.draw === 'function') {
    overlayRegistry.push(mod);
  }
}

overlayRegistry.sort((a, b) => a.z - b.z);

export function getAllOverlays(): OverlayModule[] {
  return overlayRegistry;
}
