/**
 * 花粉曲线（area / bar / line / symbol）与控制锚点的绘制。
 *
 * 两者都只读列数据 + 画 ctx，原本混在 GeologyCanvas 的渲染管线里。抽出来后：
 * - 曲线绘制只认 columns / activeTaxaId / scale；
 * - 锚点绘制只认 activeColumn / hoveredPointId / draggingPointId（拖拽态由调用方取）。
 *
 * 为什么不合并成一个函数：曲线与锚点是同名阶段的**两层**，可见性分别受
 * showsPollenCurves 与选中列控制；将来采样层位若要单独画，混在一起反而难拆。
 */
import { SplineInterpolator } from '../../core/SplineInterpolator';
import type { TaxaColumn } from '../../types/pollen';
import { zeroSpanOfColumn } from './groupBandRect';

export interface PollenCurveEnv {
  ctx: CanvasRenderingContext2D;
  scale: number;
  columns: TaxaColumn[];
  activeTaxaId: string | null;
  /**
   * 列所属的 x 组（组级 `axis_stroke_px` 是列级覆盖的初值）。取不到时按缺省轴粗处理——
   * 0 点仍然不等于列左缘。
   */
  groupOfColumn?: (col: TaxaColumn) => { axis_stroke_px?: number | null } | undefined;
}

export function drawPollenCurvesOverlay(env: PollenCurveEnv): void {
  const { ctx, scale, columns, activeTaxaId } = env;
  ctx.save();

  columns.forEach((col) => {
    if (!col.visible || col.controlPoints.length === 0) return;

    const isActive = col.id === activeTaxaId;
    // 0 点 = 列左缘 + 轴粗（画布绿线，ARCHITECTURE §6.4）。所有从基线出发的填充都必须
    // 从这里起：从 `col.startX` 起等于把轴线涂进数据区，用户看到的就是「遮罩包住轴线」。
    // 宽度 ≤ 0 时 `zero` 为 null：只跳过填充，曲线照画。
    const zero = zeroSpanOfColumn(col, env.groupOfColumn?.(col));
    const sortedPoints = [...col.controlPoints].sort((a, b) => a.y - b.y);
    const pType = col.plotType || 'area';

    if (pType === 'bar') {
      // 柱状图：从 0 点向右延伸水平柱条（起点是绿线，不是列左缘）
      if (!zero) return;
      ctx.fillStyle = col.color;
      ctx.strokeStyle = col.color;
      const barThickness = Math.max(1.5, 3.0 / scale);

      sortedPoints.forEach((pt) => {
        const barWidth = Math.max(0, pt.x - zero.x);
        if (barWidth > 0) {
          ctx.fillRect(zero.x, pt.y - barThickness / 2, barWidth, barThickness);
        }
      });
    } else if (pType === 'symbol') {
      // 散点符号标记图（存在/缺失）
      ctx.strokeStyle = col.color;
      ctx.lineWidth = 1.5 / scale;
      const symR = 4 / scale;
      sortedPoints.forEach((pt) => {
        if (pt.x > col.startX + 0.5) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, symR, 0, Math.PI * 2);
          ctx.fillStyle = isActive ? col.color : `${col.color}88`;
          ctx.fill();
          ctx.stroke();
        }
      });
    } else {
      // 面积图或纯折线图
      if (pType === 'area' && zero) {
        const areaPath = SplineInterpolator.buildAreaPath(sortedPoints, zero.x);
        ctx.fillStyle = isActive ? `${col.color}44` : `${col.color}1a`;
        ctx.fill(areaPath);
      }

      const curvePath = SplineInterpolator.buildPath(sortedPoints);
      ctx.strokeStyle = col.color;
      ctx.lineWidth = (isActive ? 2.5 : 1.4) / scale;
      ctx.setLineDash([]);
      ctx.stroke(curvePath);
    }
  });

  ctx.restore();
}

export interface AnchorEnv {
  ctx: CanvasRenderingContext2D;
  scale: number;
  /** 当前激活列；null / 不可见时整段不画（未选中列不画手柄）。 */
  activeColumn: TaxaColumn | null;
  hoveredPointId: string | null;
  draggingPointId: string | null;
}

export function drawAnchorsOverlay(env: AnchorEnv): void {
  const { ctx, scale, activeColumn, hoveredPointId, draggingPointId } = env;
  if (!activeColumn || !activeColumn.visible) return;

  ctx.save();

  activeColumn.controlPoints.forEach((pt) => {
    const isHovered = hoveredPointId === pt.id;
    const isDragging = draggingPointId === pt.id;

    // 手柄半径屏幕恒定
    const baseRadius =
      pt.type === 'peak' || pt.type === 'trough'
        ? 6.0
        : pt.type === 'manual' || pt.isManual
          ? 5.5
          : 4.0;
    const radius =
      (isDragging ? baseRadius * 1.35 : isHovered ? baseRadius * 1.25 : baseRadius) / scale;

    // 悬停/拖动时光晕
    if (isHovered || isDragging) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius + 3.5 / scale, 0, Math.PI * 2);
      ctx.fillStyle = isDragging ? 'rgba(249, 115, 22, 0.4)' : 'rgba(56, 189, 248, 0.35)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);

    if (pt.type === 'peak') {
      // 一级物理极大值（峰顶）：实心金黄色
      ctx.fillStyle = isDragging ? '#f97316' : '#fbbf24';
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.8 / scale;
      ctx.stroke();
    } else if (pt.type === 'trough') {
      // 一级物理极小值（谷底/基线）：实心琥珀色
      ctx.fillStyle = isDragging ? '#f97316' : '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.8 / scale;
      ctx.stroke();
    } else if (pt.type === 'manual' || pt.isManual) {
      // 手工强控制锚点：实心亮青色
      ctx.fillStyle = isDragging ? '#f97316' : '#38bdf8';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.8 / scale;
      ctx.stroke();
    } else {
      // 二级平缓过渡点：空心白圈
      ctx.fillStyle = 'rgba(17, 24, 39, 0.75)';
      ctx.fill();
      ctx.strokeStyle = activeColumn.color || '#ffffff';
      ctx.lineWidth = 1.6 / scale;
      ctx.stroke();
    }
  });

  ctx.restore();
}
