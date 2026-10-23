/**
 * OCR 复核弹窗里的「自动配对未完成」提示（P1-E）。
 *
 * ## 这条提示治的是哪个缺陷
 *
 * `ocr.recognizeLabels` 返回的 `reconciliation` 常常是 `matched: false`，
 * 原因是后端配对规则要求「标签数 == 列数」并且标签不得跨界。真实图版上很容易不满足：
 * 一列上方可能压着两个标签（如 `Ranunculaceae` 与 `Herbs`），也可能有列完全没有标签。
 * 此时后端 `assigned` 是空的，**没有一个标签拿到 `associated_column_id`**。
 *
 * 但界面当时**什么都不说**：用户看到识别出的一串正确属种名，直接点【应用到图谱各列】，
 * 结果只有那些"按位置恰好落进某列"的标签生效，其余列保留 `col07` 这类编号名。
 * 用户无从知道"哪些列没配上、为什么、该怎么办"——这就是静默失败。
 *
 * ## 实测事实（本模块文案必须与之一致，不许写成"一个都没配上"）
 *
 * 真实图版 `fig3_raw.jpeg`（2132×928），**建议取数区** [69,1867]×[266,744] → 22 列，
 * OCR 识别 24 个标签，后端 `matched=false`、`ambiguous=21`。但前端表格按 `anchor_x`
 * 做位置兜底，实际能配上 20/22 列，只有 2 列完全没标签（raw 显示 `--`）。
 *
 * 所以本提示**不谎称"全部失败"**：它报的是"后端自动配对没成功"这个事实，外加
 * "有 N 列没有识别到标签、需要你手工填"这个可操作的具体数字，两者不混为一谈。
 * 若写成"16 列全是 col01..col16"就是错的——真实链路上绝大多数列是配上了的。
 *
 * ## 为什么手工路径必须被点出来
 *
 * 用户真正的困难不是"看不见失败"，而是"不知道可以自己填"。表格里没标签的行原本
 * 只有一个灰掉的「采纳」勾选框和一个占位的列名，看起来像"这列就是没有名字"。
 * 实测确认：在那种行里输入任意名字后，勾选框会自动启用并被勾上，提交后该名字真的
 * 写进后端（E2E `T2` 走的就是这条真实路径）。所以文案里必须明确写出这一步。
 */
import type { OcrLabelEntry } from './types';

/** 后端 `reconciliation` 的形状（与 `NamingPanel.LabelReconciliation` 同源）。 */
export interface OcrReconciliation {
  columns_without_label?: string[];
  labels_without_column?: string[];
  ambiguous?: string[];
  matched?: boolean;
  assigned?: Record<string, string>;
}

/** 需要提示的判定结果：为什么提示、以及可操作的数字。 */
export interface OcrMatchNotice {
  /** 后端是否报告自动配对成功。 */
  matched: boolean;
  /** 识别到的标签总数（真实来自 `labels.length`）。 */
  labelCount: number;
  /** 一列都没配上的列数（表格里 raw 为 `--` 的那些行）。 */
  columnsWithoutLabel: number;
  /** 同一列上方压了多个标签的列数（`ambiguous` 里真实存在的那些）。 */
  ambiguousCount: number;
  /** 当前是否应当显示提示。 */
  visible: boolean;
}

/**
 * 计算提示状态。
 *
 * `matched === true` 时不提示：那是正常结果，弹提示等于噪音。
 * `labels` 为空时不提示：那是"什么都没识别到"，属于另一条错误路径，不该被本提示冒充。
 *
 * `columnsWithoutLabel` 必须由调用方按**表格真实呈现**数出来传进来，不能在这里从
 * `labels` 反推——后端 `matched=false` 时一个 `associated_column_id` 都不给，而前端
 * 表格会用 `anchor_x` 兜底，两者口径不同。用户看的是表格，判据就必须与表格同口径。
 * （第一版这里写了个恒返回 0 的占位函数，那等于没有判别力，已删掉。）
 */
export function computeOcrMatchNotice(
  reconciliation: OcrReconciliation | null | undefined,
  labels: OcrLabelEntry[],
  columnsWithoutLabel: number
): OcrMatchNotice {
  const labelCount = labels.length;
  const matched = reconciliation?.matched === true;
  const ambiguousCount = Array.isArray(reconciliation?.ambiguous)
    ? reconciliation!.ambiguous!.length
    : 0;
  const visible = !matched && labelCount > 0;
  return { matched, labelCount, columnsWithoutLabel, ambiguousCount, visible };
}

/**
 * 渲染提示块。
 *
 * 三件事必须都在（缺一条用户就得自己推）：
 * ① 识别到了多少个属种名；
 * ② 为什么没自动对上（后端要求标签数与列数一致、且不得跨界）；
 * ③ 用户怎么自己指定——在表格里给没有标签的那一行输入名字，勾选框会自动启用。
 *
 * 颜色只用 `--status-warning`（语义状态色），不用装饰色，不用 emoji。
 */
export function renderOcrMatchNotice(notice: OcrMatchNotice): string {
  if (!notice.visible) return '';

  const ambiguousLine =
    notice.ambiguousCount > 0
      ? `<div style="margin-top: 3px;"><strong>②</strong> 有 ${notice.ambiguousCount} 个标签落在列边界上或与其它标签同列（例如一列上方压着两个名字），后端因此没有把它们自动指派给任何列。</div>`
      : `<div style="margin-top: 3px;"><strong>②</strong> 后端未能把这些标签自动指派到列（标签数与列数不一致，或标签跨列）。</div>`;

  const noLabelLine =
    notice.columnsWithoutLabel > 0
      ? `<div style="margin-top: 3px;"><strong>③</strong> 其中 <strong>${notice.columnsWithoutLabel}</strong> 列完全没有识别到标签（表格里「OCR 原始读数」显示为 <code>--</code>），这些列会保留 <code>colNN</code> 编号名。</div>`
      : '';

  return `
      <!-- OCR 自动配对未完成（P1-E）。判定来自后端 reconciliation.matched，不猜。 -->
      <div class="ocr-match-notice" role="alert"
           data-ocr-match="failed"
           data-label-count="${notice.labelCount}"
           data-columns-without-label="${notice.columnsWithoutLabel}"
           data-ambiguous-count="${notice.ambiguousCount}"
           style="padding: 9px 10px; background: color-mix(in srgb, var(--status-warning) 8%, transparent); border: 1px solid var(--status-warning); border-left: 3px solid var(--status-warning); border-radius: 6px; margin-bottom: 8px;">
        <div style="font-size: 11.5px; font-weight: 700; color: var(--status-warning); margin-bottom: 6px;">
          OCR 已识别出属种名，但未能全部自动对应到列
        </div>
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          <div><strong>①</strong> 本次共识别到 <strong>${notice.labelCount}</strong> 个标签，属种名与中文名见下表。</div>
          ${ambiguousLine}
          ${noLabelLine}
          <div style="margin-top: 3px;"><strong>④</strong> 请在下表逐行核对：没有标签的行，直接在「建议属种名称」框里输入你判读的名字——输入后该行的「采纳」勾选框会自动启用并勾上，再点右下角【应用到图谱各列】即写入后端。有标签的行可以改字，同样会自动采纳。</div>
        </div>
      </div>
    `;
}
