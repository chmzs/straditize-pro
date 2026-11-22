/**
 * 花粉曲线（area / bar / line / symbol）与控制锚点的绘制。
 *
 * ## 只有一条渲染路径：稠密曲线，且从 0 点起填充
 *
 * 画布与导出必须画/读**同一条曲线**：后端载荷的 curvePoints 就是导出 CSV 用的
 * column_points（同一个字段，同一个 _ensure_export_column_points 产出）。
 *
 * 填充左端是 **0 点（绿线 = 列左缘 + 轴粗）**，不是列左缘 —— 从列左缘起等于把轴线
 * 涂进数据区（#31 的判据）。三件事正交：
 * 0 点决定「从哪起」（`zeroSpanOfColumn`），稠密曲线决定「画到哪」（#33），
 * 形态决定「走哪条分支」（`resolvePlotType`，组级参数，列上那份只是显式覆盖）。
 *
 * **没有回退**：稠密点缺失时不画折线、不插值、不猜 —— 画布上直接写
 * 「本列无法取数：<原因>」（原因由后端 curveError 给出）。仓库不变量：
 * 取不到就报错停在原地，绝不返回替代数据。
 *
 * symbol 例外：它的语义就是"控制点处的存在/缺失标记"，与曲线读数无关。
 */
import { SplineInterpolator } from '../../core/SplineInterpolator.ts';
import { resolvePlotType } from '../../core/plotType.ts';
import type { PlotTypeHolder } from '../../core/plotType.ts';
import type { TaxaColumn } from '../../types/pollen';
import { zeroSpanOfColumn } from './groupBandRect.ts';

export interface PollenCurveEnv {
  ctx: CanvasRenderingContext2D;
  scale: number;
  columns: TaxaColumn[];
  activeTaxaId: string | null;
  /**
   * 列所属的 x 组。组上挂着**两个组级参数**，两者都必须从这里取：
   *
   * - `axis_stroke_px` → 0 点（`zeroSpanOfColumn`，填充/柱条的左边界）；
   * - `plot_type` → 图形形态（`resolvePlotType`）。
   *
   * 为什么形态也必须走组：`plot_type` 按 ARCHITECTURE §6.4 是**组级参数**，列上那份
   * 是分列期从组值抄来的快照。画布此前只读 `col.plotType`，于是用户在步骤 6 把组切
   * 「折线」后照旧画面积（"改了不生效"）。
   *
   * 取不到组时按缺省处理：轴粗 5（0 点仍然不等于列左缘）、形态 `area`。
   */
  groupOfColumn?: (
    col: TaxaColumn
  ) => (PlotTypeHolder & { axis_stroke_px?: number | null }) | undefined;
  /** 视口 y 区间（图像像素）。不给时按 ctx 当前变换反解，保证裁剪总是生效。 */
  viewY?: { min: number; max: number };
}

export interface MissingCurve {
  id: string;
  name: string;
  reason: string;
}

export interface PollenCurveResult {
  /** 取不到稠密读数的列（画布上已写明原因，不画替代曲线）。 */
  missingColumns: MissingCurve[];
}

/** 该列是否有可渲染的稠密曲线（唯一判据；不提供控制点回退）。 */
export function hasDenseCurve(col: TaxaColumn): boolean {
  return Array.isArray(col.curvePoints) && col.curvePoints.length >= 2;
}

/**
 * 每列的 Path2D 缓存：只在「数据或视口变了」时重建。
 *
 * 28 列 x 1249 行 = 35k 点/帧，逐帧重建会把重绘预算吃光（实测未缓存 2.8ms/帧）。
 * 签名含**全量 x 求和**（不做抽样：抽样会漏检"中间某个点被拖动"，复用陈旧路径）。
 */
const pathCache = new Map<
  string,
  { signature: string; curve: Path2D; area: Path2D | null }
>();

/**
 * 路径缓存的签名。
 *
 * `plotType` 必须是**解析后**的形态（`resolvePlotType`），不能是 `col.plotType`：
 * 形态由组决定时，用户把组从面积切成折线，列字段可能一个字都没变 —— 签名不变就会
 * 复用缓存里那条**已经建好的 area 路径**，画布继续填充，等于没切。
 */
function curveSignature(
  col: TaxaColumn,
  view: { min: number; max: number },
  zeroX: number,
  plotType: string
): string {
  const points = col.curvePoints as Array<{ y: number; x: number }>;
  let sum = 0;
  for (let index = 0; index < points.length; index++) {
    sum += points[index].x;
  }
  return [
    col.id,
    points.length,
    sum.toFixed(3),
    view.min.toFixed(2),
    view.max.toFixed(2),
    zeroX.toFixed(2),
    plotType,
  ].join('|');
}

/** 从当前变换反解视口 y 区间（世界坐标 = 图像像素）。 */
function viewFromContext(ctx: CanvasRenderingContext2D): { min: number; max: number } {
  const matrix = ctx.getTransform();
  const factor = matrix.d || 1;
  const height = ctx.canvas.height || 0;
  return { min: -matrix.f / factor, max: (height - matrix.f) / factor };
}

/** 取不到数：把原因写在画布上，屏幕恒定字号。 */
function drawMissingNotice(
  ctx: CanvasRenderingContext2D,
  col: TaxaColumn,
  reason: string,
  scale: number,
  view: { min: number; max: number }
): void {
  ctx.save();
  ctx.fillStyle = 'rgba(248, 113, 113, 0.95)';
  ctx.font = String(11 / scale) + 'px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('本列无法取数：' + reason, col.startX + 6 / scale, view.min + 6 / scale);
  ctx.restore();
}

export function drawPollenCurvesOverlay(env: PollenCurveEnv): PollenCurveResult {
  const { ctx, scale, columns, activeTaxaId } = env;
  const view = env.viewY
    ? { min: env.viewY.min, max: env.viewY.max }
    : viewFromContext(ctx);
  const denseView = { yMin: view.min, yMax: view.max };
  const missingColumns: MissingCurve[] = [];
  ctx.save();

  columns.forEach((col) => {
    if (!col.visible) return;

    const isActive = col.id === activeTaxaId;
    // 组上挂着两个组级参数：`axis_stroke_px` → 0 点；`plot_type` → 形态。
    const group = env.groupOfColumn?.(col);
    // 0 点 = 列左缘 + 轴粗（画布绿线，ARCHITECTURE §6.4）。所有从基线出发的填充都必须
    // 从这里起：从 col.startX 起等于把轴线涂进数据区，用户看到的就是「遮罩包住轴线」。
    // 宽度 ≤ 0 时 zero 为 null：只跳过填充，曲线照画。
    const zero = zeroSpanOfColumn(col, group);
    // 列级显式覆盖 > 组级 > 'area'（与 `resolveAxisStroke` 同构的唯一入口）。
    // 形态只决定「走哪条分支」，稠密曲线决定「画到哪」——两者正交，互不替代。
    const pType = resolvePlotType(col, group);
    const sortedControl = [...col.controlPoints].sort((a, b) => a.y - b.y);

    if (pType === 'symbol') {
      // 符号图的语义是"控制点处的存在/缺失"，不是曲线读数。
      ctx.strokeStyle = col.color;
      ctx.lineWidth = 1.5 / scale;
      const symR = 4 / scale;
      sortedControl.forEach((pt) => {
        if (pt.x > col.startX + 0.5) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, symR, 0, Math.PI * 2);
          ctx.fillStyle = isActive ? col.color : col.color + '88';
          ctx.fill();
          ctx.stroke();
        }
      });
      return;
    }

    if (!hasDenseCurve(col)) {
      const reason = col.curveError || '后端未给出该列的逐行读数';
      missingColumns.push({ id: col.id, name: col.name, reason });
      drawMissingNotice(ctx, col, reason, scale, view);
      return;
    }

    const dense = col.curvePoints as Array<{ y: number; x: number }>;

    if (pType === 'bar') {
      // 柱状图：从 0 点向右延伸水平柱条（起点是绿线，不是列左缘）
      if (!zero) return;
      ctx.fillStyle = col.color;
      ctx.strokeStyle = col.color;
      const barThickness = Math.max(1.5, 3.0 / scale);
      dense.forEach((pt) => {
        if (pt.y < view.min - barThickness || pt.y > view.max + barThickness) return;
        const barWidth = Math.max(0, pt.x - zero.x);
        if (barWidth > 0) {
          ctx.fillRect(zero.x, pt.y - barThickness / 2, barWidth, barThickness);
        }
      });
      return;
    }

    const zeroX = zero ? zero.x : col.startX;
    const signature = curveSignature(col, view, zeroX, pType);
    let cached = pathCache.get(col.id);
    if (!cached || cached.signature !== signature) {
      cached = {
        signature,
        curve: SplineInterpolator.buildDensePath(dense, denseView),
        area:
          pType === 'area' && zero
            ? SplineInterpolator.buildDenseAreaPath(dense, zero.x, denseView)
            : null,
      };
      pathCache.set(col.id, cached);
    }

    if (cached.area) {
      ctx.fillStyle = isActive ? col.color + '44' : col.color + '1a';
      ctx.fill(cached.area);
    }

    ctx.strokeStyle = col.color;
    ctx.lineWidth = (isActive ? 2.5 : 1.4) / scale;
    ctx.setLineDash([]);
    ctx.stroke(cached.curve);
  });

  ctx.restore();
  return { missingColumns };
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
      ctx.fillStyle =
        pt.isManual || pt.type === 'manual'
          ? 'rgba(217, 70, 239, 0.45)'
          : isDragging
            ? 'rgba(249, 115, 22, 0.4)'
            : 'rgba(56, 189, 248, 0.35)';
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);

    // 控制点多色语义化：
    // 1. 人工介入点：鲜明品红 (#d946ef) + 纯白描边，与黄/蓝拉开绝对色差
    // 2. 截断内线点：蓝色 (#3b82f6) + 深蓝描边，代表外线截断回退抓内线
    // 3. 常规外线点：默认黄色 (峰值 #fbbf24 / 谷值 #f59e0b)，直接画在外线上供视觉核验
    if (pt.isManual || pt.type === 'manual') {
      ctx.fillStyle = isDragging ? '#c026d3' : '#d946ef';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.0 / scale;
      ctx.stroke();
    } else if (pt.source === 'main_1x') {
      // 蓝色：截断内线点 (main_1x)
      ctx.fillStyle = isDragging ? '#2563eb' : '#3b82f6';
      ctx.fill();
      ctx.strokeStyle = '#1e3a8a';
      ctx.lineWidth = 1.8 / scale;
      ctx.stroke();
    } else if (pt.type === 'peak') {
      ctx.fillStyle = isDragging ? '#d97706' : '#fbbf24';
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.8 / scale;
      ctx.stroke();
    } else if (pt.type === 'trough') {
      ctx.fillStyle = isDragging ? '#d97706' : '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#111827';
      ctx.lineWidth = 1.8 / scale;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(17, 24, 39, 0.75)';
      ctx.fill();
      ctx.strokeStyle = activeColumn.color || '#ffffff';
      ctx.lineWidth = 1.6 / scale;
      ctx.stroke();
    }
  });

  ctx.restore();
}
