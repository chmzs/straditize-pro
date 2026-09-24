import { DiagramData } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';

export interface OverlayModule {
  id: string;
  z: number;
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
