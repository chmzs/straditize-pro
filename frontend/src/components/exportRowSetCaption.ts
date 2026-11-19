/**
 * 导出行集标题的**唯一**生成器（issue #113 / #100，2026-11-19）。
 *
 * ## 为什么必须是纯函数 + 后端供词
 *
 * 面板原来按 dataset 名字写死一套同义词（`ROWSET_SOURCE`）：
 *
 * ```ts
 * samples: '按共识层位（samples）'
 * ```
 *
 * 但 `samples` 为空时后端交付的是**逐列数字化的像素行并集**（现场：625 行 =
 * ROI 高度 864−239），标题却说"按共识层位"——用户看到 625 行，误以为是 625 个
 * 样品。这是 issue #100 的本体：行集的"身份"不能由前端猜。
 *
 * 现在 identity 只从后端来（`export.getReadiness {dataset}` 的 `rowset`），本文件
 * 只负责把它排版成人话，并按 `is_sample_rows` 决定是否用警告色。
 *
 * 后端没给身份时**不得**替它编一个来源名：回落到中性文案，并保持 `warning=false`
 * （宁可什么都不说，也不说错）。
 */

/** 后端 `rowset` 里本文件用到的字段（其余字段不参与标题）。 */
export interface RowSetIdentityLike {
  label?: unknown;
  is_sample_rows?: unknown;
  provenance?: unknown;
  rows_count?: unknown;
  samples_count?: unknown;
  why?: unknown;
  quality?: {
    rows?: unknown;
    samples?: unknown;
    support_columns_median?: unknown;
    support_columns_min?: unknown;
    support_columns_max?: unknown;
    support_columns_n?: unknown;
    support_columns_source?: unknown;
    tolerance_px?: unknown;
    default_tolerance_px?: unknown;
    roi_height_px?: unknown;
    rows_equal_roi_height?: unknown;
  } | null;
}

export interface RowSetCaption {
  /** 面板标题文本。 */
  text: string;
  /** true → 用 warning 色：这批行**不是**样品层位，用户需要知道。 */
  warning: boolean;
}

const NEUTRAL_SOURCE = '按当前数据集';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `19` → `19`，`2.0` → `2`，`null` → `—`（不把缺失写成 0）。 */
function formatNumber(value: unknown): string {
  const parsed = num(value);
  if (parsed === null) return '—';
  return Number.isInteger(parsed) ? String(parsed) : String(Math.round(parsed * 100) / 100);
}

/**
 * 标题正文：`<来源> · 当前表 N 行 · 预览、复制与 CSV 下载都按此行集导出`。
 *
 * `rowsInTable` 取**面板实际渲染**的行数（解析后端 CSV 得到），不是后端估计值：
 * 标题里的行数必须与用户眼前那张表一致，两者不一致时以表为准。
 */
export function buildRowSetCaption(
  rowset: RowSetIdentityLike | null | undefined,
  rowsInTable: number
): RowSetCaption {
  const rows = Number.isFinite(rowsInTable) ? Math.max(0, Math.trunc(rowsInTable)) : 0;
  const label = text(rowset?.label);
  const isSamples = rowset?.is_sample_rows === true;
  const source = label || NEUTRAL_SOURCE;
  const suffix = `当前表 ${rows} 行 · 预览、复制与 CSV 下载都按此行集导出`;
  return {
    text: label ? `${source} ｜ ${suffix}` : `${source}（${rows} 行）`,
    // 只有"明确来自样品层位"才用普通色。后端没给身份时保持中性（不误报）。
    warning: Boolean(label) && !isSamples,
  };
}

/**
 * 质量指标提示（判断"要不要重跑共识优化"用，`#100` 要求"结果必须带质量指标"）。
 *
 * 三个量：层位数 / 支持列数中位 / 容差。缺失一律写 `—`，不写 0、不拿默认值冒充
 * 实际值（`tolerance_px` 是"当初用的容差"，`default_tolerance_px` 才是"重跑会用
 * 多少"）。
 */
export function buildRowSetQualityHint(
  rowset: RowSetIdentityLike | null | undefined
): string {
  const quality = rowset?.quality;
  if (!quality) return '';
  const rows = formatNumber(quality.rows);
  const supportMedian = formatNumber(quality.support_columns_median);
  const supportN = formatNumber(quality.support_columns_n);
  const supportRange =
    num(quality.support_columns_min) !== null && num(quality.support_columns_max) !== null
      ? `${formatNumber(quality.support_columns_min)}..${formatNumber(quality.support_columns_max)}`
      : '—';
  const tolerance = formatNumber(quality.tolerance_px);
  const defaultTolerance = formatNumber(quality.default_tolerance_px);
  const roiHeight = formatNumber(quality.roi_height_px);
  const rowsEqualRoiHeight = quality.rows_equal_roi_height === true;

  const parts = [
    `层位 ${rows} 行`,
    `支持列数中位 ${supportMedian}（${supportRange}，n=${supportN}）`,
    `tolerance_px ${tolerance === '—' ? '未记录' : tolerance}（默认 ${defaultTolerance}）`,
  ];
  if (rowsEqualRoiHeight) {
    parts.push(`行数=${roiHeight} px 等于 ROI 高度 → 逐像素行`);
  }
  return parts.join(' · ');
}
