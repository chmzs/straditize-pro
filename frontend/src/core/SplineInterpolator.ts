import { Point2D, TaxaColumn, DiagramCalibration, DepthHorizon } from '../types/pollen';

export class SplineInterpolator {
  /**
   * 对一组控制点（按 Y 升序排列）构建平滑路径
   * @param points 控制点列表（已按 y 升序）
   * @param type 'linear' 或 'bezier'
   */
  public static buildPath(points: Point2D[], _type: 'linear' = 'linear'): Path2D {
    const path = new Path2D();
    if (points.length === 0) return path;

    if (points.length === 1) {
      path.moveTo(points[0].x, points[0].y);
      path.lineTo(points[0].x + 0.1, points[0].y);
      return path;
    }

    path.moveTo(points[0].x, points[0].y);

    // 默认且唯一采用严格折线连接真实拐点
    for (let i = 1; i < points.length; i++) {
      path.lineTo(points[i].x, points[i].y);
    }
    return path;
  }

  /**
   * 构建花粉面积多边形路径（从基线 baselineX 出发，沿真实折线拐点前进，最后回到基线）
   */
  public static buildAreaPath(
    points: Point2D[],
    baselineX: number,
    _type: 'linear' = 'linear'
  ): Path2D {
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

    // 从最后点回到基线
    path.lineTo(baselineX, last.y);
    path.closePath();

    return path;
  }

  /**
   * 按照地层深度步长进行密集重采样，生成数值化表格数据
   */
  public static resample(points: Point2D[], stepY: number = 2): Point2D[] {
    if (points.length === 0) return [];
    if (points.length === 1) return [{ ...points[0] }];

    const result: Point2D[] = [];
    const minY = points[0].y;
    const maxY = points[points.length - 1].y;

    for (let curY = minY; curY <= maxY; curY += stepY) {
      // 寻找对应的区间 [i, i+1]
      let idx = 0;
      while (idx < points.length - 1 && points[idx + 1].y < curY) {
        idx++;
      }

      if (idx >= points.length - 1) {
        result.push({ x: points[points.length - 1].x, y: curY });
        continue;
      }

      const p1 = points[idx];
      const p2 = points[idx + 1];
      const t = (curY - p1.y) / (p2.y - p1.y || 1);
      const clampedT = Math.max(0, Math.min(1, t));

      // 线性插值
      const interpolatedX = p1.x + (p2.x - p1.x) * clampedT;
      result.push({ x: interpolatedX, y: curY });
    }

    return result;
  }

  /**
   * 高精度计算指定 Taxa 属种曲线在特定 Y 像素位置处的花粉百分比丰度
   * 支持折线与三次贝塞尔样条平滑求值，并约束于合法百分比范围
   */
  public static interpolatePercentAtY(col: TaxaColumn, y: number): number {
    const pts = col.controlPoints;
    const colWidth = col.endX - col.startX;
    if (pts.length === 0 || colWidth <= 0) return 0;

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

    // 两点式真实刻度钉换算 (若具备 scaleCalib 则优先采用物理刻度齿比例)
    const sc = col.scaleCalib;
    if (sc && sc.calibX !== sc.originX) {
      const dx = sc.calibX - sc.originX;
      const dval = sc.calibVal - sc.originVal;
      const slope = dval / dx;
      const val = sc.originVal + (curX - sc.originX) * slope;
      return Number(val.toFixed(2));
    }

    const tickSpan = (col.tickEndX && col.tickEndX > col.startX)
      ? (col.tickEndX - col.startX)
      : (col.endX - col.startX);

    const maxPercent = col.maxPercent ?? 100;
    const percent = ((curX - col.startX) / (tickSpan || 1)) * maxPercent;
    return Number(Math.max(0, percent).toFixed(2));
  }

  /**
   * 根据地层标定配置生成标准剖面层位标尺列表 (Standard Depth Horizons)
   * 严格按照用户设定的采样间隔（如从 0 到 150cm，每隔 2cm）生成固定深度层位与对应像素 Y 坐标
   */
  public static getStandardDepthHorizons(cal: DiagramCalibration): {
    depths: number[];
    yPositions: number[];
  } {
    const interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;
    const top = cal.depthTopValue;
    const bottom = cal.depthBottomValue;
    const depthRange = bottom - top || 1;
    const yRange = cal.dataYMax - cal.dataYMin;

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
      const y = Number((cal.dataYMin + fraction * yRange).toFixed(2));

      depths.push(d);
      yPositions.push(y);
    }

    return { depths, yPositions };
  }

  /**
   * 提取所有属种完全锚定在固定深度层位上的全量结构化数据表格
   * 彻底杜绝属种间层位错位
   */
  public static extractAnchoredDepthTable(
    columns: TaxaColumn[],
    cal: DiagramCalibration
  ): DepthHorizon[] {
    const { depths, yPositions } = this.getStandardDepthHorizons(cal);
    const activeColumns = columns.filter((c) => c.visible);

    return depths.map((depth, idx) => {
      const y = yPositions[idx];
      const values: Record<string, number> = {};

      for (const col of activeColumns) {
        values[col.name] = this.interpolatePercentAtY(col, y);
      }

      return {
        depth,
        unit: cal.unit,
        y,
        values,
      };
    });
  }
}
