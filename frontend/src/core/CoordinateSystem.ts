// 仅类型导入：显式 `import type` 让本模块能被 Node 的类型剥离直接加载做单元测试
// （见 frontend/test-roi-calibration.mjs），不会留下指向 .ts 的运行时依赖。
import type { Point2D, Column, DepthCalibration } from '../types/pollen';

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
   *
   * 只读标定结构：未标定时返回 undefined，**绝不**回落到 ROI 边界。
   * 历史上这里写作 `cal.top_px ?? cal.dataYMin`，于是"框选数据的方框"被当成了
   * 时间轴 —— 拖动 ROI 就静默改写深度，这正是本次修复的核心缺陷。
   */
  public static imageYToDepth(y: number, cal: DepthCalibration): number | undefined {
    const bounds = CoordinateSystem.calibrationBounds(cal);
    if (!bounds) return undefined;

    const t = (y - bounds.topPx) / (bounds.bottomPx - bounds.topPx);
    const depth = bounds.topValue + t * (bounds.bottomValue - bounds.topValue);
    return Number(depth.toFixed(3));
  }

  /**
   * 4. 真实地层物理深度 -> 图像物理 Y 像素
   */
  public static depthToImageY(depth: number, cal: DepthCalibration): number | undefined {
    const bounds = CoordinateSystem.calibrationBounds(cal);
    if (!bounds) return undefined;

    const depthRange = bounds.bottomValue - bounds.topValue;
    if (depthRange === 0) return undefined;

    const t = (depth - bounds.topValue) / depthRange;
    return Math.round(bounds.topPx + t * (bounds.bottomPx - bounds.topPx));
  }

  /**
   * 3.1 标定的四个端点；未标定（或端点缺失、像素跨度为零）时返回 null。
   *
   * 单一判定入口：调用方不得各自写一套 `??` 兜底，否则又会长出新的隐式耦合。
   */
  public static calibrationBounds(cal: DepthCalibration | undefined): {
    topPx: number;
    bottomPx: number;
    topValue: number;
    bottomValue: number;
  } | null {
    if (!cal || !cal.isCalibrated) return null;
    const { top_px, bottom_px, top_cm, bottom_cm } = cal;
    if (top_px === null || bottom_px === null || top_cm === null || bottom_cm === null) return null;
    if (!Number.isFinite(top_px) || !Number.isFinite(bottom_px)) return null;
    if (top_px === bottom_px) return null;
    return { topPx: top_px, bottomPx: bottom_px, topValue: top_cm, bottomValue: bottom_cm };
  }

  /**
   * 4.0 唯一列标度解析入口（与后端 resolve_column_scale 对齐）：
   * 优先级：x_ticks（两真实刻度端点） -> legacy 三件套 / scaleCalib 兜底。
   */
  public static resolveColumnScale(col: Column): {
    px0: number;
    val0: number;
    px1: number;
    val1: number;
    unit: string;
    plotType: 'area' | 'bar' | 'line' | 'symbol';
    scaleType: 'linear' | 'log';
    exaggerationMult: number | null;
    calibrated: boolean;
    source: 'x_ticks' | 'legacy' | 'default';
  } {
    const scaleType: 'linear' | 'log' = col.scale_type === 'log' ? 'log' : 'linear';
    const unit = col.unit || col.scaleCalib?.unit || '%';
    const plotType = col.plot_type || col.plotType || 'area';

    let exaggerationMult: number | null = null;
    if (col.exaggeration_mult !== undefined && col.exaggeration_mult !== null) {
      if (col.exaggeration_mult > 1) exaggerationMult = col.exaggeration_mult;
    } else if (col.hasExaggeration && col.exaggerationMult && col.exaggerationMult > 1) {
      exaggerationMult = col.exaggerationMult;
    }

    if (Array.isArray(col.x_ticks) && col.x_ticks.length >= 2) {
      const t0 = col.x_ticks[0];
      const t1 = col.x_ticks[1];
      return {
        px0: Number(t0.px),
        val0: Number(t0.value),
        px1: Number(t1.px),
        val1: Number(t1.value),
        unit,
        plotType,
        scaleType,
        exaggerationMult,
        calibrated: true,
        source: 'x_ticks',
      };
    }

    const hasExplicitLegacy =
      col.startValue !== undefined || col.tickValue !== undefined || col.tickEndX !== undefined;
    const sc = col.scaleCalib;
    const px0 = !hasExplicitLegacy && sc ? sc.originX : col.startX;
    const rawTickEnd =
      col.tickEndX !== undefined && col.tickEndX !== px0
        ? col.tickEndX
        : sc && sc.calibX !== px0
          ? sc.calibX
          : col.endX;
    const px1 = rawTickEnd !== px0 ? rawTickEnd : px0 + 100;
    const defaultVal0 = scaleType === 'log' ? 1 : 0;
    const val0 = col.startValue ?? sc?.originVal ?? defaultVal0;
    const val1 = col.tickValue ?? sc?.calibVal ?? col.maxPercent ?? 100;

    return {
      px0,
      val0,
      px1,
      val1,
      unit,
      plotType,
      scaleType,
      exaggerationMult,
      calibrated: false,
      source: hasExplicitLegacy || sc ? 'legacy' : 'default',
    };
  }

  /**
   * 4.1 获取列标定斜率 (单位物理值 / 像素)
   */
  public static getScaleRatio(col: Column): number {
    const scale = this.resolveColumnScale(col);
    const spanPx = Math.max(1, Math.abs(scale.px1 - scale.px0));
    return Math.abs(scale.val1 - scale.val0) / spanPx;
  }

  /**
   * 5. 校验 Log 对数刻度约束: startValue > 0 且 tickValue > 0 且 startValue != tickValue
   */
  public static validateLogScale(col: Column): { valid: boolean; reason?: string } {
    const scale = this.resolveColumnScale(col);
    const startVal = scale.val0;
    const tickVal = scale.val1;
    const startX = scale.px0;
    const tickEndX = scale.px1;

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
    const scale = this.resolveColumnScale(col);
    const startX = scale.px0;
    const tickEndX = scale.px1;
    const spanPx = tickEndX - startX;
    if (spanPx === 0) return 0;

    const t = (x - startX) / spanPx;
    const startVal = scale.val0;
    const tickVal = scale.val1;

    if (scale.scaleType === 'log') {
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
    const scale = this.resolveColumnScale(col);
    const startX = scale.px0;
    const tickEndX = scale.px1;
    const spanPx = tickEndX - startX;
    const startVal = scale.val0;
    const tickVal = scale.val1;

    if (scale.scaleType === 'log') {
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
