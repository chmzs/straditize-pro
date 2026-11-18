/**
 * 放大倍数的**组级**输入逻辑：写入值归一、列级被组覆盖的判定、图上/真实量程换算。
 *
 * 为什么单独成文件：`frontend/test-exaggeration-group-input.mjs` 用
 * `node --experimental-strip-types` 直接 import 这里的纯函数做判据（不需要 DOM）。
 * 若让 UI 各写一遍这三件事，测试测到的就只是副本。
 *
 * 语义底线（与后端 `xscale._resolve_exaggeration` 同源）：
 * 放大倍数 **>1 才有意义**；空 / 0 / 1 / 非数值一律等于"未放大"，写库发 `null`，
 * 绝不能发一个会被 `px_to_value` 真除的坏因子。
 */

/** 列级输入被组覆盖时用的 i18n 键（中英都要有这条）。 */
export const COLUMN_EXAG_OVERRIDDEN_KEY = 'step6.columnExagOverriddenByGroup';

/** 组级倍率的上限：界面上 1–100，超出的输入直接判非法（不静默截断）。 */
export const MAX_GROUP_EXAGGERATION = 100;

/**
 * 把输入框/接口里的倍率收敛成「可写入组的值」。
 *
 * - `null` / `undefined` / 空串 / 纯空白 → `null`（= 清除，未放大）；
 * - 非数值（"abc"、NaN）→ `null`：宁可不放大，也不留一个错的因子；
 * - `<=1` → `null`（放大 1 倍等于没放大，后端的换算也只在 >1 时才除）；
 * - `>100` → `null`：这是非法输入，由 UI 先提示再拦，不在这里截断成 100；
 * - 其余 → 该数字。
 */
export function normalizeGroupExaggeration(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = typeof raw === 'string' ? raw.trim() : raw;
  if (text === '') return null;
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (value <= 1 || value > MAX_GROUP_EXAGGERATION) return null;
  return value;
}

/** 组上是否真的在放大（>1）。组是真源，别的判断都以它为准。 */
export function isGroupExaggerated(groupMult: unknown): boolean {
  const value = normalizeGroupExaggeration(groupMult);
  return value !== null && value > 1;
}

/**
 * 列级放大输入是否必须置灰。
 *
 * 组倍率 >1 时组是真相源（后端解析顺序：组级 > 列级 > 历史键），列级那个输入
 * 即便可编辑也不会生效。留着它可点，用户会以为"改列级能覆盖组"——那是错的。
 */
export function isColumnExagDisabled(groupMult: unknown): boolean {
  return isGroupExaggerated(groupMult);
}

/**
 * 列级输入旁边那一行提示：`以组级 5× 为准（列级设置已忽略）`。
 *
 * `translate` 就是 UI 的 `t`（`t(key, params)` 做 `{name}` 替换）。测试里传一个
 * 用真实字典实现的 translate，于是"提示里含组级倍数"测的是**上线的那段文案**。
 * 组未放大时返回空串（不显示提示）。
 */
export function columnExagNotice(
  groupMult: unknown,
  translate: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!isGroupExaggerated(groupMult)) return '';
  return translate(COLUMN_EXAG_OVERRIDDEN_KEY, { mult: String(normalizeGroupExaggeration(groupMult)) });
}

export interface ExaggerationRange {
  /** 图上满刻度（列宽范围内的表观量程）= 组斜率 × 平均列宽。 */
  onFigure: number;
  /** 真实量程 = 图上满刻度 ÷ 倍率。 */
  real: number;
}

/**
 * 「图上满刻度 = 真实量程 × 倍率」的换算。
 *
 * 放大过的列画得比真实值高：图上量程 = 真实量程 × 倍率，所以
 * `真实 = 斜率 × 列宽 ÷ 倍率`。斜率为 0/缺、列宽非正、倍率未放大时返回 `null`
 * （无从谈起，不编一个 0 出来）。
 */
export function exaggerationRange(
  slope: unknown,
  widthPx: unknown,
  mult: unknown,
): ExaggerationRange | null {
  const slopeValue = Number(slope);
  const width = Number(widthPx);
  const factor = normalizeGroupExaggeration(mult);
  if (factor === null) return null;
  if (!Number.isFinite(slopeValue) || slopeValue === 0) return null;
  if (!Number.isFinite(width) || width <= 0) return null;
  const onFigure = slopeValue * width;
  return { onFigure, real: onFigure / factor };
}
