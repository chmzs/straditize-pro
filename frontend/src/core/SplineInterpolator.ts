import type { Point2D, TaxaColumn, DiagramCalibration } from '../types/pollen';
import { CoordinateSystem } from './CoordinateSystem.ts';

export class SplineInterpolator {
  /**
   * 对一组控制点（按 Y 升序排列）构建折线路径
   * @param points 控制点列表（已按 y 升序）
   */
  public static buildPath(points: Point2D[]): Path2D {
    const path = new Path2D();
    if (points.length === 0) return path;

    if (points.length === 1) {
      path.moveTo(points[0].x, points[0].y);
      path.lineTo(points[0].x + 0.1, points[0].y);
      return path;
    }

    path.moveTo(points[0].x, points[0].y);

    // 严格折线连接各拐点
    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x, points[i].y);
    }
    return path;
  }

  /**
   * 构建花粉面积多边形路径（从基线 baselineX 出发，沿真实折线拐点前进，最后回到基线）
   */
  public static buildAreaPath(points: Point2D[], baselineX: number): Path2D {
    const path = new Path2D();
    if (points.length < 2) return path;

    const first = points[0];
    const last = points[points.length - 1];

    // 起点：基线处
    path.moveTo(baselineX, first.y);
    // 连线到曲线首个控制点
    path.lineTo(first.x, first.y);

    // 严格折线连接各拐点
    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x, points[i].y);
    }

    // 闭合到基线并回到底部起点
    path.lineTo(baselineX, last.y);
    path.closePath();
    return path;
  }

  /**
   * 稠密点列在视口 y 区间内的切片（二分查找，两端各留 1 点，跨界线段不断裂）。
   *
   * 为什么要裁剪：28 列 x 1249 行 = 35k 点/帧，全量建路径会把重绘时间花在
   * 屏幕外的点上；二分是 O(log n)，不随缩放变化。
   */
  private static denseSlice(
    points: ReadonlyArray<{ x: number; y: number }>,
    yMin: number,
    yMax: number
  ): { start: number; end: number } {
    const n = points.length;
    if (n === 0) return { start: 0, end: 0 };
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].y < yMin) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - 1);
    lo = 0;
    hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid].y <= yMax) lo = mid;
      else hi = mid - 1;
    }
    return { start, end: Math.min(n, lo + 2) };
  }

  /**
   * 稠密折线：**一次 Path2D**、一个 moveTo + 连续 lineTo，不逐点开关路径。
   *
   * makePath 可注入（node 单测里没有 Path2D）：性能与调用次数因此可被断言，
   * 而不是只能靠肉眼。
   */
  public static buildDensePath(
    points: ReadonlyArray<{ x: number; y: number }>,
    view: { yMin: number; yMax: number },
    makePath: () => Path2D = () => new Path2D(),
    stride = 1
  ): Path2D {
    const path = makePath();
    const { start, end } = SplineInterpolator.denseSlice(points, view.yMin, view.yMax);
    if (end - start < 2) return path;
    const step = Math.max(1, Math.floor(stride));
    path.moveTo(points[start].x, points[start].y);
    for (let index = start + step; index < end; index += step) {
      path.lineTo(points[index].x, points[index].y);
    }
    // 末点必须落在裁剪区末尾，否则线段会短一截。
    const lastIndex = end - 1;
    if ((lastIndex - start) % step !== 0) {
      path.lineTo(points[lastIndex].x, points[lastIndex].y);
    }
    return path;
  }

  /** 稠密面积多边形：基线 -> 曲线 -> 基线闭合，同样一次 Path2D。 */
  public static buildDenseAreaPath(
    points: ReadonlyArray<{ x: number; y: number }>,
    baselineX: number,
    view: { yMin: number; yMax: number },
    makePath: () => Path2D = () => new Path2D(),
    stride = 1
  ): Path2D {
    const path = makePath();
    const { start, end } = SplineInterpolator.denseSlice(points, view.yMin, view.yMax);
    if (end - start < 2) return path;
    const step = Math.max(1, Math.floor(stride));
    path.moveTo(baselineX, points[start].y);
    path.lineTo(points[start].x, points[start].y);
    for (let index = start + step; index < end; index += step) {
      path.lineTo(points[index].x, points[index].y);
    }
    const lastIndex = end - 1;
    if ((lastIndex - start) % step !== 0) {
      path.lineTo(points[lastIndex].x, points[lastIndex].y);
    }
    path.lineTo(baselineX, points[lastIndex].y);
    path.closePath();
    return path;
  }

  /**
   * 高精度计算指定 Taxa 属种曲线在特定 Y 像素位置处的花粉百分比丰度
   * 支持折线与三次贝塞尔样条平滑求值，并约束于合法百分比范围
   */
  public static interpolatePercentAtY(col: TaxaColumn, y: number): number | undefined {
    const pts = col.controlPoints;
    const colWidth = col.endX - col.startX;
    // 没有控制点 = 没有读数，不是 0%。0 表示"这一层该属种确实没有花粉"，
    // 与"还没数字化"是两件事，混用会让导出表出现看着正常的假零。
    if (pts.length === 0 || colWidth <= 0) return undefined;

    const sorted = [...pts].sort((a, b) => a.y - b.y);
    let curX: number;

    if (y <= sorted[0].y) {
      curX = sorted[0].x;
    } else if (y >= sorted[sorted.length - 1].y) {
      curX = sorted[sorted.length - 1].x;
    } else {
      let idx = 0;
      while (idx < sorted.length - 1 && sorted[idx + 1].y < y) {
        idx++;
      }
      const p1 = sorted[idx];
      const p2 = sorted[idx + 1];
      const span = p2.y - p1.y;
      const t = span !== 0 ? (y - p1.y) / span : 0;
      const clampedT = Math.max(0, Math.min(1, t));

      // 严格折线线性插值（彻底移除贝塞尔插值，确保数值可重复性与零虚假漂移）
      curX = p1.x + (p2.x - p1.x) * clampedT;
    }

    // 统一走 CoordinateSystem.imageXToValue（唯一解析入口；未标定返回 undefined）
    const val = CoordinateSystem.imageXToValue(curX, col);
    if (val === undefined) return undefined;
    return Number(Math.max(0, val).toFixed(2));
  }

  /**
   * 根据 Y 轴标定生成剖面层位标尺列表 (Depth Horizons)。
   *
   * 深度只来自用户的两点标定（`calibration`），像素跨度只来自取数区域（`roi`）——
   * 二者互不推导。未标定时返回空列表：宁可没有刻度，也不能把 ROI 边界冒充成深度。
   *
   * 优先采用用户从 Excel 粘贴的真实非等距深度层位序列 (customDepths)；
   * 未提供时，才回退到基于用户指定步长的参考线 (如 0~150cm, Δ=2cm)。
   */
  public static getStandardDepthHorizons(
    cal: DiagramCalibration,
    roi?: { yMin: number; yMax: number }
  ): {
    depths: number[];
    yPositions: number[];
  } {
    const bounds = CoordinateSystem.calibrationBounds(cal);
    if (!bounds) return { depths: [], yPositions: [] };

    const { topPx, bottomPx, topValue, bottomValue } = bounds;
    const top = topValue;
    const bottom = bottomValue;
    const depthRange = bottom - top || 1;
    const yRange = bottomPx - topPx;
    if (Math.abs(yRange) < 1e-6) {
      return { depths: [], yPositions: [] };
    }

    const slope = (bottomValue - topValue) / yRange;
    const intercept = topValue - slope * topPx;

    // 采样层位不再走前端专属字段（customDepths 已删除）：粘贴的深度经
    // samples.pasteDepths 落库，画布由 SampleOverlay 按 samples 画，导出也读 samples。

    const totalSpan = Math.abs(bottom - top);
    let interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;
    if (cal.depthInterval === undefined || (cal.depthInterval === 2 && totalSpan > 200)) {
      if (totalSpan > 5000) interval = 500;
      else if (totalSpan > 2000) interval = 200;
      else if (totalSpan > 1000) interval = 100;
      else if (totalSpan > 500) interval = 50;
      else if (totalSpan > 200) interval = 20;
    }

    // 若提供了数据有效区 ROI，则网格线依据标尺比例尺外推至整个数据区，彻底消除"截断图谱"错觉
    if (roi && roi.yMin !== undefined && roi.yMax !== undefined && roi.yMax > roi.yMin) {
      const yStart = roi.yMin;
      const yEnd = roi.yMax;
      const d1 = slope * yStart + intercept;
      const d2 = slope * yEnd + intercept;
      const minD = Math.min(d1, d2);
      const maxD = Math.max(d1, d2);

      const isTopDown = slope > 0;
      const firstTick = Math.ceil(minD / interval) * interval;
      const lastTick = Math.floor(maxD / interval) * interval;

      const depths: number[] = [];
      const yPositions: number[] = [];

      if (isTopDown) {
        for (let d = firstTick; d <= lastTick + 1e-6; d += interval) {
          const roundedD = Number(d.toFixed(4));
          const y = Number(((roundedD - intercept) / slope).toFixed(2));
          depths.push(roundedD);
          yPositions.push(y);
        }
      } else {
        for (let d = lastTick; d >= firstTick - 1e-6; d -= interval) {
          const roundedD = Number(d.toFixed(4));
          const y = Number(((roundedD - intercept) / slope).toFixed(2));
          depths.push(roundedD);
          yPositions.push(y);
        }
      }

      return { depths, yPositions };
    }

    // 未提供 ROI 时保持标定跨度内网格 (向后兼容)
    const startDepth = Math.min(top, bottom);
    const endDepth = Math.max(top, bottom);
    const isTopDown = top <= bottom;

    const count = Math.round((endDepth - startDepth) / interval);
    const depths: number[] = [];
    const yPositions: number[] = [];

    for (let i = 0; i <= count; i++) {
      const d = Number((isTopDown ? top + i * interval : top - i * interval).toFixed(4));
      // 物理深度映射到像素 Y 坐标
      const fraction = (d - top) / depthRange;
      const y = Number((topPx + fraction * yRange).toFixed(2));

      depths.push(d);
      yPositions.push(y);
    }

    return { depths, yPositions };
  }


}
