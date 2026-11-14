/**
 * 步骤 4「轴线被抹掉」告警的人话化 —— 面板与 toast 共用同一份文案。
 *
 * 为什么必须共用：同一个事实出现两种说法时，用户会以为看到了两件事
 * （面板说"排除区覆盖 100%"，toast 说"轴线没了"），而归因（是排除区还是
 * 已确认几何造成的）恰恰是修复时最需要的信息。所以来源标签与覆盖比例
 * 只在这里生成一次。
 */
import { CleanupAxisWarning } from '../types/pollen';

/** 造成覆盖的来源：排除区（绝对剔除）还是已确认的几何（线掩膜）。 */
export function axisWarningSource(w: CleanupAxisWarning): string {
  return w.kind === 'confirmed_line_covers_column_axis' ? '已确认几何' : '排除区';
}

/** 覆盖比例，直接取后端算好的值，不在前端重算。 */
export function axisWarningPercent(w: CleanupAxisWarning): string {
  const ratio = Number(w.covered_fraction);
  const safe = Number.isFinite(ratio) ? ratio : 0;
  return `${Math.round(safe * 100)}%`;
}

/**
 * 一行事实：谁盖住了哪一列的轴线、盖了多少。
 *
 * `column_name` / `column_start_x` / `covered_fraction` 全部取后端字段，
 * 前端不重算（重算就会在两个地方出现两套"覆盖比例"）。
 */
export function axisWarningHeadline(w: CleanupAxisWarning): string {
  return (
    `${axisWarningSource(w)}盖住了列「${w.column_name}」的轴线` +
    `（x=${w.column_start_x}），覆盖该列纵向 ${axisWarningPercent(w)}`
  );
}

/**
 * 面板里展示的完整告警：事实 + 后端给的处理建议。
 *
 * `note` 用后端原文（`cleanup._axis_erasure_warnings()` 的 `note`）：
 * 那里写着具体到像素的办法（"把排除区/擦除区从列左缘让开 2px 以上"），
 * 前端自己改写只会把它稀释成"请检查设置"。
 */
export function axisWarningNote(w: CleanupAxisWarning): string {
  return String(w.note ?? '').trim();
}
