/**
 * QA 结论的**唯一**判定入口。
 *
 * ## 为什么必须收口到一个函数
 *
 * 同一个"数据到底合不合格"的结论，界面上有两个渲染点：
 * ① 步骤 8 面板横幅 `#qa-banner`（`steps/QaPanel.ts`）；
 * ② 导出模态的「百分比总和自检」行（`ExportModal.ts`）。
 * 两处各写一套阈值，就是下一次分叉的源头：修好一处、另一处继续谎报。
 * 实测就是这样——面板横幅早已按后端 `violations_over` 判红，而导出模态那条
 * 自检行仍用前端自算的 `minSum >= 85 && maxSum <= 115`，于是同屏出现
 * 「门禁失败」与「质检达标」两个互相矛盾的结论。
 *
 * ## 判定的两条硬约束（都是"全绿陷阱"的形态）
 *
 * 1. **空集不得判通过。** 一行都没被检验时（`nChecked === 0`），"没有超标"是
 *    无信息的，不能等价于"合格"。旧实现把未初始化的哨兵 `minSum = 999999`
 *    直接拿去比较，`999999 >= 85 && 0 <= 115` 恒真，于是 0 层位质检也报"达标"，
 *    还把 `999999.0%` 当真实数值印给用户。
 * 2. **缺值不得冒充合格。** `maxSum === null` 表示"不知道"，不是 0。
 *
 * 判定只接受**已经算好的量**（谁算的由调用方负责，见下），本模块不做任何
 * 像素/表格读取，也不产生替代数据。
 */

export type QaLevel = 'green' | 'yellow' | 'red';

export interface QaVerdictInput {
  /**
   * 总和超过 `100% + tolerance` 的层位数。
   *
   * 面板侧来自后端 `qa.summarize().violations_over.length`（权威）：
   * 后端按同一 `tolerance` 逐层比对，前端不重算。
   */
  nOverHorizons: number;
  /** 最大总和；`null` = 未知（不得当成 0）。 */
  maxSum: number | null;
  /** 容差（百分点），与后端 `qa.summarize` 的入参一致。 */
  tolerance: number;
  /** 未在步骤 6 标定 X 刻度的列数（后端 `n_uncalibrated`）。 */
  nUncalibrated: number;
  /** **实际被检验**的层位数；0 表示空集，空集不得判通过。 */
  nChecked: number;
}

export interface QaVerdict {
  level: QaLevel;
  /** 一句话结论（用户看到的全部内容）。 */
  headline: string;
  /** 判定依据的量化细节；空串表示没有额外信息。 */
  detail: string;
}

/** 后端与前端共用的容差口径（百分点）。 */
export const QA_DEFAULT_TOLERANCE = 2.0;

export function computeQaVerdict(input: QaVerdictInput): QaVerdict {
  const { nOverHorizons, maxSum, tolerance, nUncalibrated, nChecked } = input;

  // ① 空集：没有任何层位被检验 ⇒ 无信息，不得判通过。
  //
  // 注（2026-11-10）：这里在共享工作区里被留成了 `if (false && nChecked <= 0)`
  // 并带一行 `[CANARY 临时删除空集守卫]` 注释——某个会话为了验证"空集不得绿"这条
  // 判据临时把守卫注掉，之后没有还原。危险点：守卫被注掉后 `computeQaVerdict` 会走到
  // 末尾的 green 分支，`999999 >= 85 && 0 <= 115` 那类"全绿陷阱"立刻复活——0 层位
  // 质检也会报「门禁通过」。已恢复为真守卫，并保留此说明，避免再被当成可随手注掉的开关。
  if (nChecked <= 0) {
    return {
      level: 'yellow',
      headline: '无可校验层位：没有任何分区产出可检验的层位读数，不得判通过',
      detail: '先在步骤 5/6 完成分列与刻度标定，让剖面产出可检验的层位读数。',
    };
  }

  // ② 有层位总和越限：这是硬失败，必须先于其它分支报出来。
  if (nOverHorizons > 0) {
    const limit = 100 + tolerance;
    return {
      level: 'red',
      headline: `组分总和超标报警 (发现 ${nOverHorizons} 个层位总和 > ${limit}%)`,
      detail:
        maxSum === null
          ? `已检验 ${nChecked} 个层位`
          : `已检验 ${nChecked} 个层位，最大总和 ${maxSum}%`,
    };
  }

  // ③ 没有越限计数、但已知最大和值越限（后端未必给出逐层清单时仍要拦住）。
  if (maxSum !== null && maxSum > 100 + tolerance) {
    return {
      level: 'red',
      headline: `最大层位总和 ${maxSum}% 超出容差 (上限 ${100 + tolerance}%)`,
      detail: `已检验 ${nChecked} 个层位`,
    };
  }

  // ④ 有列没标定：读数不完整，"合格"这句话就还不成立。
  if (nUncalibrated > 0) {
    return {
      level: 'yellow',
      headline: `存在未标定列 (发现 ${nUncalibrated} 列未在步骤 6 标定 X 刻度，这些列不出数、导出记为空)`,
      detail: `已检验 ${nChecked} 个层位`,
    };
  }

  return {
    level: 'green',
    headline: '地学校验门禁通过，数据符合规律',
    detail: maxSum === null ? `已检验 ${nChecked} 个层位` : `已检验 ${nChecked} 个层位，最大总和 ${maxSum}%`,
  };
}

/** 结论文案里是否含"通过/达标"这类**成功断言**（供测试与调用方统一判断）。 */
export function isPassingVerdict(verdict: QaVerdict): boolean {
  return verdict.level === 'green';
}

/* ------------------------------------------------------------------ *
 * 多分区聚合：QA 必须覆盖**所有"有列"的分区**，而不是只算当前 active 分区
 * ------------------------------------------------------------------ */

/**
 * 一个分区 `qa.summarize` 的返回（结构上兼容 `steps/QaPanel` 的 `QaSummary` 与
 * `ExportModal` 里的同名类型；这里只声明聚合真正用到的字段）。
 */
export interface QaScopeSummary {
  ratio?: number;
  n_horizons: number;
  n_horizons_with_data: number;
  n_horizons_empty?: number;
  violations_over: unknown[];
  empty_horizons?: { depth: number | null; reason?: string }[];
  per_column_max?: {
    name: string;
    peak: number;
    declared_max: number;
    over: boolean;
    calibrated?: boolean;
  }[];
  sum: { max: number };
  n_uncalibrated?: number;
  uncalibrated_columns?: string[];
}

export interface QaScopePart {
  roiId: string;
  roiName: string;
  columnCount: number;
  summary: QaScopeSummary;
}

export interface QaScopeSkip {
  roiId: string;
  roiName: string;
}

export interface QaAggregate {
  level: QaLevel;
  headline: string;
  detail: string;
  /** 「已校验 2 个分区（dirty, clean）」 */
  scopeLabel: string;
  /** 「跳过 1 个无列分区（empty）」；没有跳过时为空串 */
  skippedLabel: string;
  nChecked: number;
  nHorizons: number;
  nHorizonsEmpty: number;
  nOverHorizons: number;
  maxSum: number | null;
  /** 各分区"非空层位平均缺额"的加权平均（按被检层位数加权）；无数据时为 null。 */
  shortfallMean: number | null;
  nUncalibrated: number;
  parts: QaScopePart[];
  skipped: QaScopeSkip[];
}

function scopeNames(parts: { roiName: string }[]): string {
  return parts.map((p) => p.roiName).join(', ');
}

/**
 * 把"每个有列分区各自的 QA 汇总"合并成**一个**结论。
 *
 * 三条规则（横幅与导出模态自检共用，不许再各写一份）：
 *
 * 1. **任一分区超标 > 0 ⇒ 红。** 曾经只对 active 分区算，于是"选中哪个分区"
 *    决定门禁结论：把 active 从脏分区切到干净分区，同一份数据从红变绿，而脏分区
 *    的 788 个超标层位一颗都没算。
 * 2. **空集（所有分区都没层位）⇒ 不得判通过**，交 `computeQaVerdict` 的黄条。
 * 3. 全部合格 ⇒ 绿。
 *
 * 范围必须写进结论文案：用户看到的"通过"必须能对应到"校验了哪几个分区"。
 */
export function aggregateQaScope(
  parts: QaScopePart[],
  skipped: QaScopeSkip[],
  tolerance: number
): QaAggregate {
  const nChecked = parts.reduce(
    (sum, p) => sum + (p.summary.n_horizons_with_data ?? p.summary.n_horizons ?? 0),
    0
  );
  const nHorizons = parts.reduce((sum, p) => sum + (p.summary.n_horizons ?? 0), 0);
  const nHorizonsEmpty = parts.reduce((sum, p) => sum + (p.summary.n_horizons_empty ?? 0), 0);
  const nOverHorizons = parts.reduce((sum, p) => sum + (p.summary.violations_over?.length ?? 0), 0);
  const nUncalibrated = parts.reduce(
    (sum, p) =>
      sum + (p.summary.n_uncalibrated ?? p.summary.uncalibrated_columns?.length ?? 0),
    0
  );

  const maxes = parts
    .map((p) => p.summary.sum?.max)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const maxSum = maxes.length > 0 ? Math.max(...maxes) : null;

  const weighted = parts.filter(
    (p) =>
      typeof (p.summary as { shortfall?: { mean?: number } }).shortfall?.mean === 'number' &&
      (p.summary.n_horizons_with_data ?? 0) > 0
  );
  const weightedTotal = weighted.reduce((s, p) => s + (p.summary.n_horizons_with_data ?? 0), 0);
  const shortfallMean =
    weightedTotal > 0
      ? weighted.reduce(
          (s, p) =>
            s +
            ((p.summary as { shortfall?: { mean?: number } }).shortfall?.mean ?? 0) *
              (p.summary.n_horizons_with_data ?? 0),
          0
        ) / weightedTotal
      : null;

  const verdict = computeQaVerdict({
    nOverHorizons,
    maxSum,
    tolerance,
    nUncalibrated,
    nChecked,
  });

  const scopeLabel =
    parts.length === 0
      ? '没有可校验的分区（所有分区都没有列）'
      : `已校验 ${parts.length} 个分区（${scopeNames(parts)}）`;
  const skippedLabel =
    skipped.length === 0 ? '' : `跳过 ${skipped.length} 个无列分区（${scopeNames(skipped)}）`;

  return {
    level: verdict.level,
    headline: verdict.headline,
    detail: verdict.detail,
    scopeLabel,
    skippedLabel,
    nChecked,
    nHorizons,
    nHorizonsEmpty,
    nOverHorizons,
    maxSum,
    shortfallMean,
    nUncalibrated,
    parts,
    skipped,
  };
}

/** 横幅/自检行显示的唯一文案：结论 + 范围（+ 跳过的分区）。 */
export function aggregateHeadline(agg: QaAggregate): string {
  return [agg.headline, agg.scopeLabel, agg.skippedLabel].filter(Boolean).join(' ｜ ');
}
