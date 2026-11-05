/**
 * 步骤 4（清理）几何体的命中测试：移动 / 改长度（端点）/ 改厚度（长边中点）。
 *
 * ## 三条容易写错的细节
 *
 * 1. **手柄只对「已选中」的几何体生效**：不选中就连手柄都不该画，命中自然也不该有；
 *    否则细线端点永远抓不住（光标在线上，命中的却是移动）。
 * 2. **手柄位置必须取 `bandOf` 的渲染矩形**，不是几何体真实矩形：薄线真实只有 2px、
 *    显示被撑到 8px，按真实矩形做命中会「看着抓到、实际抓空」。
 * 3. **从后往前遍历**：后加入的几何体视觉上在上层，应优先命中。
 *
 * 抽成纯函数：阈值（pad / 手柄半径）与选中态全部由调用方给，函数只做几何判断。
 */
import { bandOf } from './CleanupOverlay';
import type { Point2D } from '../../types/pollen';

export type GeometryHitHandle = 'move' | 'start' | 'end' | 'thick0' | 'thick1';

export interface GeometryHit {
  id: string;
  handle: GeometryHitHandle;
}

export interface GeometryCandidate {
  id: string;
  axis?: 'h' | 'v';
  geometry?: { x0: number; y0: number; x1: number; y1: number };
}

export interface GeometryHitEnv {
  worldPt: Point2D;
  /** 1 / viewport.scale：屏幕像素阈值换算成世界单位。 */
  invScale: number;
  /** 线体命中容差（屏幕 px）。 */
  padScreen: number;
  /** 手柄直径（屏幕 px）。 */
  handleSizeScreen: number;
  /** 当前选中 id；只有它判手柄。 */
  selectedId: string | null;
  candidates: GeometryCandidate[];
}

export function findHitGeometryAt(env: GeometryHitEnv): GeometryHit | null {
  const { worldPt, invScale: inv, padScreen, handleSizeScreen, selectedId, candidates } = env;
  const pad = padScreen * inv;
  const handleR = (handleSizeScreen * inv) / 2 + 2 * inv;

  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = candidates[i];
    const g = c.geometry;
    if (!g) continue;
    const x0 = Math.min(g.x0, g.x1);
    const x1 = Math.max(g.x0, g.x1);
    const y0 = Math.min(g.y0, g.y1);
    const y1 = Math.max(g.y0, g.y1);
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;

    // 已选中的几何体先判手柄，否则细线端点永远抓不住。
    if (c.id === selectedId) {
      const band = bandOf(g, inv);
      const bMidX = band.x + band.w / 2;
      const bMidY = band.y + band.h / 2;
      const handles: Array<[GeometryHitHandle, Point2D]> =
        c.axis === 'h'
          ? [
              ['start', { x: x0, y: midY }],
              ['end', { x: x1, y: midY }],
              ['thick0', { x: bMidX, y: band.y }],
              ['thick1', { x: bMidX, y: band.y + band.h }],
            ]
          : [
              ['start', { x: midX, y: y0 }],
              ['end', { x: midX, y: y1 }],
              ['thick0', { x: band.x, y: bMidY }],
              ['thick1', { x: band.x + band.w, y: bMidY }],
            ];
      for (const [key, pt] of handles) {
        if (Math.hypot(worldPt.x - pt.x, worldPt.y - pt.y) <= handleR) {
          return { id: c.id, handle: key };
        }
      }
    }

    if (worldPt.x >= x0 - pad && worldPt.x <= x1 + pad && worldPt.y >= y0 - pad && worldPt.y <= y1 + pad) {
      return { id: c.id, handle: 'move' };
    }
  }
  return null;
}
