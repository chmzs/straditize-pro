import { Point2D, Column, DepthCalibration } from '../types/pollen';

export interface ViewportTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
  dpr: number;
}

export class CoordinateSystem {
  /**
   * 1. 视口变换：屏幕坐标 -> 图像物理世界坐标
   */
  public static screenToWorld(screenPt: Point2D, vt: ViewportTransform): Point2D {
    return {
      x: (screenPt.x - vt.offsetX) / vt.scale,
      y: (screenPt.y - vt.offsetY) / vt.scale,
    };
  }

  /**
   * 2. 视口变换：图像物理世界坐标 -> 屏幕坐标
   */
  public static worldToScreen(worldPt: Point2D, vt: ViewportTransform): Point2D {
    return {
      x: worldPt.x * vt.scale + vt.offsetX,
      y: worldPt.y * vt.scale + vt.offsetY,
    };
  }

  /**
   * 3. 图像物理 Y 像素 -> 真实地层物理深度 (cm / m / cal kyr BP)
   */
  public static imageYToDepth(y: number, cal: DepthCalibration): number | undefined {
    const topPx = cal.top_px ?? cal.dataYMin ?? 0;
    const bottomPx = cal.bottom_px ?? cal.dataYMax ?? 1000;
    const topCm = cal.top_cm ?? cal.depthTopValue ?? 0;
    const bottomCm = cal.bottom_cm ?? cal.depthBottomValue ?? 150;

    const pxRange = bottomPx - topPx;
    if (pxRange === 0) return undefined;

    const t = (y - topPx) / pxRange;
    const depth = topCm + t * (bottomCm - topCm);
    return Number(depth.toFixed(3));
  }

  /**
   * 4. 真实地层物理深度 -> 图像物理 Y 像素
   */
  public static depthToImageY(depth: number, cal: DepthCalibration): number | undefined {
    const topPx = cal.top_px ?? cal.dataYMin ?? 0;
    const bottomPx = cal.bottom_px ?? cal.dataYMax ?? 1000;
    const topCm = cal.top_cm ?? cal.depthTopValue ?? 0;
    const bottomCm = cal.bottom_cm ?? cal.depthBottomValue ?? 150;

    const depthRange = bottomCm - topCm;
    if (depthRange === 0) return undefined;

    const t = (depth - topCm) / depthRange;
    const y = topPx + t * (bottomPx - topPx);
    return Math.round(y);
  }

  /**
   * 4.1 获取列标定斜率 (单位物理值 / 像素)
   */
  public static getScaleRatio(col: Column): number {
    const startX = col.startX;
    const tickEndX = (col.tickEndX && col.tickEndX > col.startX) ? col.tickEndX : col.endX;
    const startVal = col.startValue ?? (col.scaleCalib ? col.scaleCalib.originVal : 0);
    const tickVal = col.tickValue ?? col.scaleCalib?.calibVal ?? col.maxPercent ?? 100;
    const spanPx = Math.max(1, tickEndX - startX);
    return Math.abs(tickVal - startVal) / spanPx;
  }

  /**
   * 5. 校验 Log 对数刻度约束: startValue > 0 且 tickValue > 0 且 startValue != tickValue
   */
  public static validateLogScale(col: Column): { valid: boolean; reason?: string } {
    const startVal = col.startValue ?? (col.scaleCalib ? col.scaleCalib.originVal : 0);
    const tickVal = col.tickValue ?? col.scaleCalib?.calibVal ?? col.maxPercent ?? 100;
    const startX = col.startX;
    const tickEndX = col.tickEndX ?? col.endX;

    if (startX === tickEndX) {
      return { valid: false, reason: '基线 X 与刻度终点 X 重合 (除以零)' };
    }
    if (startVal <= 0) {
      return { valid: false, reason: `对数刻度要求起点值 > 0 (当前: ${startVal}，ln(${startVal}) 无定义)` };
    }
    if (tickVal <= 0) {
      return { valid: false, reason: `对数刻度要求刻度值 > 0 (当前: ${tickVal}，ln(${tickVal}) 无定义)` };
    }
    if (startVal === tickVal) {
      return { valid: false, reason: '对数刻度起点值不能等于刻度值' };
    }
    return { valid: true };
  }

  /**
   * 6. 图像物理 X 像素 -> 花粉丰度或物理数值 (Linear / Log 统一真相源)
   *
   * Linear 映射公式:
   *   value(x) = startValue + (x - startX) / (tickEndX - startX) * (tickValue - startValue)
   *
   * Log 映射公式:
   *   value(x) = exp( ln(startValue) + (x - startX) / (tickEndX - startX) * (ln(tickValue) - ln(startValue)) )
   */
  public static imageXToValue(x: number, col: Column): number {
    const startX = col.startX;
    const tickEndX = (col.tickEndX && col.tickEndX !== startX) ? col.tickEndX : col.endX;
    const spanPx = tickEndX - startX;
    if (spanPx === 0) return 0;

    const t = (x - startX) / spanPx;
    const startVal = col.startValue ?? 0;
    const tickVal = col.tickValue ?? col.maxPercent ?? 100;

    if (col.scale_type === 'log') {
      const check = this.validateLogScale(col);
      if (!check.valid) {
        // Log 约束不满足时安全退回线性并输出
        const linearVal = startVal + t * (tickVal - startVal);
        return Number(linearVal.toFixed(2));
      }
      const lnStart = Math.log(startVal);
      const lnTick = Math.log(tickVal);
      const lnVal = lnStart + t * (lnTick - lnStart);
      const val = Math.exp(lnVal);
      return Number(val.toFixed(2));
    }

    // Linear 默认模式
    const linearVal = startVal + t * (tickVal - startVal);
    return Number(linearVal.toFixed(2));
  }

  /**
   * 兼容别名方法
   */
  public static imageXToPercent(x: number, col: Column): number {
    return this.imageXToValue(x, col);
  }

  /**
   * 7. 物理数值 (百分比 / 浓度) -> 图像物理 X 像素
   */
  public static valueToImageX(value: number, col: Column): number {
    const startX = col.startX;
    const tickEndX = (col.tickEndX && col.tickEndX !== startX) ? col.tickEndX : col.endX;
    const spanPx = tickEndX - startX;
    const startVal = col.startValue ?? 0;
    const tickVal = col.tickValue ?? col.maxPercent ?? 100;

    if (col.scale_type === 'log') {
      const check = this.validateLogScale(col);
      if (!check.valid || value <= 0) {
        const dVal = tickVal - startVal || 1;
        const t = (value - startVal) / dVal;
        return Math.round(startX + t * spanPx);
      }
      const lnStart = Math.log(startVal);
      const lnTick = Math.log(tickVal);
      const lnVal = Math.log(value);
      const t = (lnVal - lnStart) / (lnTick - lnStart || 1);
      return Math.round(startX + t * spanPx);
    }

    // Linear 模式
    const dVal = tickVal - startVal || 1;
    const t = (value - startVal) / dVal;
    return Math.round(startX + t * spanPx);
  }

  /**
   * 兼容别名方法
   */
  public static percentToImageX(percent: number, col: Column): number {
    return this.valueToImageX(percent, col);
  }

  /**
   * 8. 屏幕像素距离换算为图像内部物理距离 (保证高分屏及缩放下手柄尺寸屏幕物理恒定)
   */
  public static screenDistanceToImage(screenPx: number, vt: ViewportTransform): number {
    return screenPx / vt.scale;
  }

  public static imageDistanceToScreen(imagePx: number, vt: ViewportTransform): number {
    return imagePx * vt.scale;
  }
}
