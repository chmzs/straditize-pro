/**
 * 「程序替你补了多少行」的一句话。
 *
 * 为什么需要它：`core.digitize` 一直返回两份行号——`broken_rows`（外线断开、按
 * 「内线 × 放大倍数」补回的行）与 `ambiguous_rows`（内线太窄、判不准、读数保持原样
 * 的行）。真机上 `recon-20261117` 的四个夸大列分别是 139/254/87/298 行，界面上却
 * 一个字都没有，用户无从知道自己看到的曲线里有多少格是算出来的。按「不许静默兜底」
 * 这条，凡是有替用户改数据的动作，就得说出来。
 *
 * 两处计数为 0 时返回空串：0 行补偿不是信息，报「补偿 0 行」只会淹没真提示。
 */
export interface CompensationCounts {
  brokenRows: number;
  ambiguousRows: number;
}

export function compensationNote({ brokenRows, ambiguousRows }: CompensationCounts): string {
  const parts: string[] = [];
  if (brokenRows > 0) {
    parts.push(`${brokenRows} 行外线断开，已按「内线 × 放大倍数」补回`);
  }
  if (ambiguousRows > 0) {
    parts.push(`${ambiguousRows} 行内线过窄判不准，读数保持原样`);
  }
  return parts.length > 0 ? `补偿明细：${parts.join('；')}。` : '';
}

/** 多列累加：批量数字化时逐列累加成一条提示，而不是逐列刷屏。 */
export function addCompensation(total: CompensationCounts, part: CompensationCounts): CompensationCounts {
  return {
    brokenRows: total.brokenRows + part.brokenRows,
    ambiguousRows: total.ambiguousRows + part.ambiguousRows,
  };
}
