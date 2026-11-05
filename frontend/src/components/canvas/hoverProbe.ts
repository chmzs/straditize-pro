/**
 * 鼠标悬停探测：世界坐标 → 深度 / 层位 / 标尺徽标 / 状态栏 payload。
 *
 * 原来这一整段（约 60 行）写在 onMouseMove 里，与「谁该触发渲染」混在一起。
 * 抽出来后画布只剩三件事：调它、把结果写进 `pointer`、必要时渲染。
 *
 * 三条与真实行为对齐的细节（别"顺手优化"）：
 * 1. 深度只在已标定时才有；未标定时 `depth` 是 `undefined`，状态栏显示 `--`。
 * 2. 层位吸附容差是 **8 屏幕像素**（`8 / scale`），随缩放变化——固定世界像素会让
 *    放大后吸不住、缩小后粘一片。
 * 3. `percent` 用 `CoordinateSystem.hasRealCalibration` 把门：未标定列的换算只是
 *    猜测标度下的数字，宁可显示 `--` 也不编一个丰度出来。
 */
import { CoordinateSystem } from '../../core/CoordinateSystem';
import type { DataRoi, DiagramCalibration, Point2D, TaxaColumn } from '../../types/pollen';

export interface HoverInfoPayload {
  worldX: number;
  worldY: number;
  depth?: number;
  percent?: number;
  horizonDepth: number | null;
}

export interface HoverProbeEnv {
  worldPt: Point2D;
  calibration: DiagramCalibration;
  roi: DataRoi;
  scale: number;
  activeColumn: TaxaColumn | null;
}

export interface HoverProbe {
  /** 当前世界 y 对应的深度（未标定时 undefined）。 */
  depth?: number;
  /** 悬停在某个标准层位 ±8 屏幕像素内时的层位深度。 */
  horizon: number | null;
  /** 是否悬停在左侧标尺顶部的设定徽标上。 */
  overRulerBadge: boolean;
  /** 状态栏 payload。 */
  info: HoverInfoPayload;
}

export function probeHover(env: HoverProbeEnv): HoverProbe {
  const { worldPt, calibration: cal, roi, scale, activeColumn } = env;
  const calib = CoordinateSystem.calibrationBounds(cal);
  const interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;

  let depth: number | undefined;
  let horizon: number | null = null;

  if (calib) {
    const totalPx = calib.bottomPx - calib.topPx;
    depth =
      calib.topValue +
      ((worldPt.y - calib.topPx) / totalPx) * (calib.bottomValue - calib.topValue);

    if (worldPt.y >= calib.topPx - 15 && worldPt.y <= calib.bottomPx + 15) {
      const nearestHorizon = Math.round(depth / interval) * interval;
      const nearestHorizonY =
        calib.topPx +
        ((nearestHorizon - calib.topValue) / (calib.bottomValue - calib.topValue || 1)) * totalPx;
      if (Math.abs(worldPt.y - nearestHorizonY) <= 8 / scale) {
        horizon = Number(nearestHorizon.toFixed(2));
      }
    }
  }

  const gridStartX = Math.max(0, roi.xMin - 50);
  const overRulerBadge =
    worldPt.x <= gridStartX &&
    worldPt.x >= gridStartX - 160 &&
    worldPt.y >= roi.yMin - 35 &&
    worldPt.y <= roi.yMin + 5;

  // 未标定列的换算只会给出猜测标度下的数字，宁可留空也不编造丰度。
  const percent =
    activeColumn && CoordinateSystem.hasRealCalibration(activeColumn)
      ? CoordinateSystem.imageXToPercent(worldPt.x, activeColumn)
      : undefined;

  return {
    depth,
    horizon,
    overRulerBadge,
    info: {
      worldX: Math.round(worldPt.x),
      worldY: Math.round(worldPt.y),
      // 保持原行为：0 也按"无"处理（状态栏显示 --），不要顺手改成 ??。
      depth: depth ? Number(depth.toFixed(2)) : undefined,
      percent: percent ? Number(Math.max(0, percent).toFixed(1)) : undefined,
      horizonDepth: horizon,
    },
  };
}
