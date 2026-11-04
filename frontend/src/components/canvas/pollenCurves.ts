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

export interface PollenCurveEnv {
  ctx: CanvasRenderingContext2D;
  scale: number;
  columns: TaxaColumn[];
  activeTaxaId: string | null;
}

export function drawPollenCurvesOverlay(env: PollenCurveEnv): void {
  const { ctx, scale, columns, activeTaxaId } = env;
  ctx.save();

  columns.forEach((col) => {
    if (!col.visible || col.controlPoints.length === 0) return;

    const isActive = col.id === activeTaxaId;
    const sortedPoints = [...col.controlPoints].sort((a, b) => a.y - b.y);
    const pType = col.plotType || 'area';

    if (pType === 'bar') {
      // 柱状图：从 startX 向右延伸水平柱条
      ctx.fillStyle = col.color;
      ctx.strokeStyle = col.color;
      const barThickness = Math.max(1.5, 3.0 / scale);

      sortedPoints.forEach((pt) => {
        const barWidth = Math.max(0, pt.x - col.startX);
        ctx.fillRect(col.startX, pt.y - barThickness / 2, barWidth, barThickness);
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
      if (pType === 'area') {
        const areaPath = SplineInterpolator.buildAreaPath(sortedPoints, col.startX);
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
