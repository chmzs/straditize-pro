/**
 * 画布命中测试（纯函数）：锚点 / 列边界 / ROI 手柄。
 *
 * 三条判据都是**屏幕像素恒定**的（阈值按 CSS px 给），与缩放无关——
 * 所以必须换算到屏幕坐标再比距离，不能直接比世界坐标。
 *
 * 抽出来的原因：这三段原来写在 2400 行的类里，靠 this.viewport / this.data 隐式取数，
 * 想测"缩放 25% 时 6px 命中带宽还对不对"必须起整个画布。现在只喂 viewport + 数据。
 *
 * 优先级（调用方负责）：锚点 > 列边界；ROI 手柄由 workflowStage 门控后再查。
 */
import type { DataRoi, Point2D, TaxaColumn } from '../../types/pollen';
import type { Viewport } from '../../core/Viewport';
import type { RoiHandle } from '../../core/tools';
import { getColumnCalibX } from './columnBoundaries';

export interface HitTestEnv {
  screenPt: Point2D;
  viewport: Viewport;
  columns: TaxaColumn[];
  activeTaxaId: string | null;
  roi: DataRoi;
  /** 锚点命中半径（屏幕 px）。 */
  anchorHitRadius: number;
  /** 列边界命中半宽（屏幕 px）。 */
  boundaryHitWidth: number;
  /** ROI 手柄命中距离（屏幕 px）。 */
  roiHandleHitDist: number;
}

export interface AnchorHit {
  taxaId: string;
  pointId: string;
}

export interface BoundaryHit {
  taxaId: string;
  type: 'start' | 'tick' | 'end';
  /** 世界坐标 x（调用方拖拽时直接用）。 */
  x: number;
}

/** 先查激活列（用户正在编辑的那列优先），再扫其余列。 */
export function findHitAnchorAt(env: HitTestEnv): AnchorHit | null {
  const { screenPt, viewport, columns, activeTaxaId, anchorHitRadius } = env;
  const activeCol = columns.find((c) => c.id === activeTaxaId) ?? null;

  if (activeCol && activeCol.visible) {
    for (const pt of activeCol.controlPoints) {
      const ptScreen = viewport.worldToScreen(pt);
      if (Math.hypot(ptScreen.x - screenPt.x, ptScreen.y - screenPt.y) <= anchorHitRadius) {
        return { taxaId: activeCol.id, pointId: pt.id };
      }
    }
  }

  for (const col of columns) {
    if (col.id === activeTaxaId || !col.visible) continue;
    for (const pt of col.controlPoints) {
      const ptScreen = viewport.worldToScreen(pt);
      if (Math.hypot(ptScreen.x - screenPt.x, ptScreen.y - screenPt.y) <= anchorHitRadius) {
        return { taxaId: col.id, pointId: pt.id };
      }
    }
  }

  return null;
}

/** 列起点（红）/ 刻度端点（蓝）/ 列终点（仅悬停）。 */
export function findHitBoundaryAt(env: HitTestEnv): BoundaryHit | null {
  const { screenPt, viewport, columns, boundaryHitWidth } = env;
  for (const col of columns) {
    if (!col.visible) continue;

    const startScreenX = viewport.worldToScreen({ x: col.startX, y: 0 }).x;
    if (Math.abs(screenPt.x - startScreenX) <= boundaryHitWidth) {
      return { taxaId: col.id, type: 'start', x: col.startX };
    }

    const actualTickX = getColumnCalibX(col);
    const tickScreenX = viewport.worldToScreen({ x: actualTickX, y: 0 }).x;
    if (Math.abs(screenPt.x - tickScreenX) <= boundaryHitWidth) {
      return { taxaId: col.id, type: 'tick', x: actualTickX };
    }

    // 列终点只在它明显大于刻度端点时才可命中（否则两者重叠，拖拽会打架）。
    if (col.endX > actualTickX + 4) {
      const endScreenX = viewport.worldToScreen({ x: col.endX, y: 0 }).x;
      if (Math.abs(screenPt.x - endScreenX) <= boundaryHitWidth) {
        return { taxaId: col.id, type: 'end', x: col.endX };
      }
    }
  }
  return null;
}

/** ROI 八个手柄（含四边中点）。门控（workflowStage）由调用方负责。 */
export function findHitRoiHandleAt(env: HitTestEnv): RoiHandle | null {
  const { screenPt, viewport, roi, roiHandleHitDist } = env;
  const tlScreen = viewport.worldToScreen({ x: roi.xMin, y: roi.yMin });
  const brScreen = viewport.worldToScreen({ x: roi.xMax, y: roi.yMax });
  const midX = (tlScreen.x + brScreen.x) / 2;
  const midY = (tlScreen.y + brScreen.y) / 2;

  const handles: Record<RoiHandle, Point2D> = {
    tl: { x: tlScreen.x, y: tlScreen.y },
    tr: { x: brScreen.x, y: tlScreen.y },
    bl: { x: tlScreen.x, y: brScreen.y },
    br: { x: brScreen.x, y: brScreen.y },
    t: { x: midX, y: tlScreen.y },
    b: { x: midX, y: brScreen.y },
    l: { x: tlScreen.x, y: midY },
    r: { x: brScreen.x, y: midY },
  };

  // 零面积的"待框选" ROI（新建后尚未框选）：8 个手柄全部重合在同一个点。
  //
  // 按下面的名单顺序会先命中 `tl`，而 `RoiToolStrategy` 对 `tl` 的夹取是
  // `xMin = min(x, xMax - 20)`——xMax 还是 0 时它恒等于 0，于是拖拽纹丝不动，
  // 用户只会觉得画布坏了。此时唯一有意义的抓手是右下角：它能把矩形向右下打开。
  if (roi.xMax - roi.xMin === 0 || roi.yMax - roi.yMin === 0) {
    const hitDegenerate =
      Math.hypot(screenPt.x - tlScreen.x, screenPt.y - tlScreen.y) <= roiHandleHitDist;
    return hitDegenerate ? 'br' : null;
  }

  for (const [key, pt] of Object.entries(handles) as [RoiHandle, Point2D][]) {
    if (Math.hypot(screenPt.x - pt.x, screenPt.y - pt.y) <= roiHandleHitDist) {
      return key;
    }
  }
  return null;
}
