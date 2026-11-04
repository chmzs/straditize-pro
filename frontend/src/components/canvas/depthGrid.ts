/**
 * 深度层位网格（水平淡蓝虚线 + 左侧深度标尺）。
 *
 * ## 为什么默认关
 *
 * 它铺满画布却不承载任何判定信息（0 点是每列各自的，层位线只是等距参考），
 * 在步骤 4/5 会"抹黑图谱"。只有用户在属性面板显式勾选（`depthGridEnabled === true`）
 * 才画；未标定时 `calibrationBounds` 返回 null，整段短路，绝不画假刻度。
 *
 * 抽成独立模块是因为它是**纯绘制**：只读标定/ROI/列，写 ctx，不改任何状态。
 * 留在 2853 行的画布类里时，每次改它都要重新理解整条渲染管线。
 */
import { CoordinateSystem } from '../../core/CoordinateSystem';
import { SplineInterpolator } from '../../core/SplineInterpolator';
import type { DataRoi, DiagramCalibration, TaxaColumn } from '../../types/pollen';

export interface DepthGridEnv {
  ctx: CanvasRenderingContext2D;
  isLight: boolean;
  calibration: DiagramCalibration;
  roi: DataRoi;
  columns: TaxaColumn[];
  scale: number;
  hoveredDepthHorizon: number | null;
  hoveringRulerBadge: boolean;
}

/** 画一层深度网格；返回是否真的画了（调用方据此记账 `depthGrid` 层）。 */
export function drawDepthGridOverlay(env: DepthGridEnv): boolean {
  const { ctx, isLight, calibration: cal, roi, columns, scale } = env;
  const bounds = CoordinateSystem.calibrationBounds(cal);
  if (!bounds || cal.depthGridEnabled !== true) return false;

  const totalSpan = Math.abs(bounds.bottomValue - bounds.topValue);
  let interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;
  if (cal.depthInterval === undefined || (cal.depthInterval === 2 && totalSpan > 200)) {
    if (totalSpan > 5000) interval = 500;
    else if (totalSpan > 2000) interval = 200;
    else if (totalSpan > 1000) interval = 100;
    else if (totalSpan > 500) interval = 50;
    else if (totalSpan > 200) interval = 20;
  }
  const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(cal, roi);
  if (depths.length === 0) return false;

  const totalCols = columns;
  const gridStartX = Math.max(0, roi.xMin - 50);
  const gridEndX =
    totalCols.length > 0
      ? Math.max(roi.xMax, totalCols[totalCols.length - 1].endX + 30)
      : roi.xMax + 60;

  ctx.save();

  // 步进标签显示频率计算，防止过度拥挤
  const labelStep = depths.length > 60 ? Math.ceil(depths.length / 30) : 1;

  for (let i = 0; i < depths.length; i++) {
    const d = depths[i];
    const y = yPositions[i];
    const isMajor = i % 5 === 0;
    const isHovered =
      env.hoveredDepthHorizon !== null &&
      Math.abs(env.hoveredDepthHorizon - d) <= interval * 0.45;

    // 1. 贯穿所有属种列的水平层位标线
    ctx.beginPath();
    ctx.moveTo(gridStartX, y);
    ctx.lineTo(gridEndX, y);

    if (isHovered) {
      ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.lineWidth = 2.2 / scale;
      ctx.setLineDash([]);
    } else if (isMajor) {
      ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.65)' : 'rgba(56, 189, 248, 0.45)';
      ctx.lineWidth = 1.3 / scale;
      ctx.setLineDash([5 / scale, 4 / scale]);
    } else {
      ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.35)' : 'rgba(125, 211, 252, 0.22)';
      ctx.lineWidth = 0.95 / scale;
      ctx.setLineDash([3 / scale, 3.5 / scale]);
    }
    ctx.stroke();

    // 2. 左侧标尺深度数值
    if (i % labelStep === 0 || isHovered) {
      ctx.fillStyle = isHovered
        ? isLight ? '#0284c7' : '#38bdf8'
        : isMajor
          ? isLight ? '#0369a1' : '#7dd3fc'
          : isLight ? '#64748b' : 'rgba(125, 211, 252, 0.7)';
      ctx.font = `${isMajor || isHovered ? 'bold ' : ''}${Math.max(9, 11 / scale)}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${d}`, gridStartX - 8, y);
    }
  }

  // 3. 左侧垂直深度标尺主轴
  ctx.beginPath();
  ctx.moveTo(gridStartX - 4, roi.yMin);
  ctx.lineTo(gridStartX - 4, roi.yMax);
  ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.7)' : 'rgba(56, 189, 248, 0.6)';
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([]);
  ctx.stroke();

  // 4. 顶部单位与层位间隔 Badge
  const badgeX = gridStartX - 8;
  const badgeY = bounds.topPx - 16;
  ctx.font = `bold ${Math.max(10, 11.5 / scale)}px 'JetBrains Mono', monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  if (env.hoveringRulerBadge) {
    ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
    ctx.fillText(`标尺: ${interval}${cal.unit} [点击修改]`, badgeX, badgeY);
  } else {
    ctx.fillStyle = isLight ? 'rgba(2, 132, 199, 0.9)' : 'rgba(56, 189, 248, 0.85)';
    ctx.fillText(`Depth (${cal.unit}) [Δ=${interval}]`, badgeX, badgeY);
  }

  ctx.restore();
  return true;
}
