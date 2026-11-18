/**
 * 侧栏/面板上"峰值"与"满刻度"的显示值换算——**唯一入口**。
 *
 * ## 为什么单独一个模块
 *
 * 图上像素 → 数值的换算，后端只有一个出口（`xscale.px_to_value`，它会在
 * `exaggeration_mult > 1` 时把值除以倍率）。前端过去在两个地方各写了一遍线性外推：
 *
 * * 侧栏的"峰值（实测最大）"—— `Sidebar.ts` 用 `scale.val0/val1` 外推，**没有**除倍率；
 * * 前端自造 CSV（`ProjectManager`）—— 除了倍率。
 *
 * 于是同一屏上「表里 0.86% / 侧栏 13.6%」并存。用户看到的是两个数，谁也不知道该信哪个。
 * 把这段外推收成一个纯函数，是为了让"除倍率"这件事只有一处可写、也只有一处可测。
 *
 * ## 语义
 *
 * * 输入 `scale` 是 `CoordinateSystem.resolveColumnScale()` 的结果：`px0/val0` 是 0 点，
 *   `px1/val1` 是标定点（组斜率模型下 `val1` 是"每像素单位数"）；
 * * `exaggerationMult > 1` 时，图上的曲线是按放大后的量程画的，因此显示值要除回去；
 * * 未标定（`val0/val1` 为 null）时调用方不该调本函数——本函数不做兜底，直接按数值算。
 */

export interface PeakScaleLike {
  px0: number;
  val0: number;
  px1: number | null;
  val1: number | null;
  exaggerationMult?: number | null;
}

/** 生效的放大倍数；`<= 1` / 非数值一律视为未放大（1）。 */
export function exaggerationOf(scale: PeakScaleLike | null | undefined): number {
  const mult = scale?.exaggerationMult;
  return typeof mult === 'number' && Number.isFinite(mult) && mult > 1 ? mult : 1;
}

/**
 * 某列在像素 `maxX` 处的**真实**读数（已除放大倍率）。
 *
 * 与 `xscale.px_to_value` 用同一套参数（0 点、标定点、倍率），只是在前端做展示用。
 * 负值钳到 0：曲线不该越过 0 点，真出现了说明标定或锚点有问题，显示 0 比显示负丰度诚实。
 */
export function peakValueFromScale(scale: PeakScaleLike, maxX: number): number {
  const px0 = Number(scale.px0);
  const val0 = Number(scale.val0);
  const px1 = scale.px1 === null ? px0 : Number(scale.px1);
  const val1 = scale.val1 === null ? val0 : Number(scale.val1);
  const span = Math.max(1, px1 - px0);
  const raw = val0 + ((maxX - px0) / span) * (val1 - val0);
  return Math.max(0, raw) / exaggerationOf(scale);
}

/**
 * 该列**满刻度**（列右缘）的真实读数，用于"实际量程"提示。
 *
 * 组倍率 > 1 时，图上刻度是放大后的值（如 14.29），真实量程是 14.29 ÷ 5 = 2.86。
 * 标定前把这行显示出来，用户才知道「标定时该填 14.29 还是 2.86」。
 */
export function fullScaleValueFromScale(scale: PeakScaleLike): number {
  const px1 = scale.px1 === null ? null : Number(scale.px1);
  if (px1 === null) return 0;
  return peakValueFromScale(scale, px1);
}

/**
 * 该列在**列右缘**处的真实读数（已除放大倍率）。
 *
 * 为什么需要它：组斜率模型的 `val1` 是"每像素单位数"而不是满刻度，直接把它当刻度显示
 * 就会出现「0.2%」这种数字（现场：列宽 60px、斜率 0.2381%/px，侧栏却显示 0.2%）。
 * 满刻度 = (列右缘 − 0点) × 斜率 ÷ 倍率。
 */
export function fullScaleAtColumnEdge(scale: PeakScaleLike, endX: number): number {
  return peakValueFromScale(scale, Number(endX));
}
