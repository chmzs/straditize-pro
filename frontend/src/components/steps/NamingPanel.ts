import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notifyError } from '../../ui/feedback';
import { renderSplitLostXTicksNotice } from './XTicksDroppedNotice';
import { renderSplitSuspectNotice } from './SuspectBlockNotice';

export const step = 5;
export const title = '5. 自动分列与属种命名';

export interface LabelReconciliation {
  columns_without_label: string[];
  labels_without_column: string[];
  ambiguous: string[];
  matched: boolean;
  assigned: Record<string, string>; // label_id -> col_id
}

let latestReconciliation: LabelReconciliation | null = null;

export function setLatestReconciliation(recon: LabelReconciliation | null): void {
  latestReconciliation = recon;
}

export function render(data: DiagramData): string {
  const columns = data.columns || [];
  const activeCol = columns.find((c) => c.id === data.activeTaxaId) || columns[0];
  const activeColId = activeCol ? activeCol.id : 'none';

  const recon: LabelReconciliation = latestReconciliation || {
    columns_without_label: columns.map((c) => c.id),
    labels_without_column: [],
    ambiguous: [],
    matched: false,
    assigned: {},
  };

  const assignPairs = Object.entries(recon.assigned || {}).map(([lbl, col]) => `${lbl}=${col}`);
  const assignGrammar = `[${assignPairs.join(',')}]`;
  const withoutLabelGrammar = `[${(recon.columns_without_label || []).join(',')}]`;
  const withoutColumnGrammar = `[${(recon.labels_without_column || []).join(',')}]`;

  // 分列正是把列边界改掉的那一步，所以「原来的标定被清空」必须在这里就报出来，
  // 而不是等用户走到步骤 6 才发现读数不见了。纯函数渲染：没有丢弃列时是空串。
  const lostTicksNotice = renderSplitLostXTicksNotice(columns);
  // 分列正是产生色块标记的那一步（P1 suspect_block），必须在这一步就报出来。
  const suspectNotice = renderSplitSuspectNotice(columns);

  return `
    <div class="step-panel" data-step="5"
         data-label-assign="${assignPairs.join(',')}"
         data-without-label="${recon.columns_without_label.join(',')}"
         data-without-column="${recon.labels_without_column.join(',')}"
         data-lost-x-ticks="${lostTicksNotice ? 'true' : 'false'}"
         data-highlight-col="${activeColId}">
      <div class="step-title">${t('step5.title')}</div>
      <div class="step-desc">
        ${t('step5.desc')}
      </div>

      ${suspectNotice}
      ${lostTicksNotice}

      <!-- OCR 属种识别：按钮常驻（主操作），说明文字收进 title，不再占版面 -->
      <div style="display: flex; gap: 6px; margin-bottom: 6px;">
        <button id="btn-trigger-ocr" class="ui-btn ui-btn--secondary" style="flex: 1; font-size: 11px; padding: 5px;" title="${t('step5.ocrDesc')}">
          ${t('step5.ocrBtn')}
        </button>
      </div>

      <!-- 对账清单与逐列说明：默认折叠成一行摘要。
           侧栏的主要职责是让用户浏览属种表格，这三个常驻区块会把表格挤到只剩
           几行（用户实测反馈"表格浏览留着这么小的空间"）。 -->
      <details class="inspector-section" style="margin-bottom: 6px; padding: 3px 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 4px;">
        <summary style="font-size: 10px; font-weight: 600; color: var(--text-secondary); cursor: pointer; list-style: none; display: flex; align-items: center; gap: 4px;">
          <span style="flex-shrink: 0;">${t('step5.reconTitle')}</span>
          <span style="color: ${recon.columns_without_label.length > 0 || recon.labels_without_column.length > 0 ? 'var(--status-warning)' : 'var(--text-muted)'}; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${recon.columns_without_label.length > 0 || recon.labels_without_column.length > 0 ? '有未配对项，点击展开' : '全部已配对'}
          </span>
        </summary>
        <div id="naming-recon-box" class="info-kv-box" style="line-height: 1.5; font-family: monospace; font-size: 9.5px; padding: 4px 0 2px 0;">
          <div>• 配对列表: <span id="lbl-assign" style="color: var(--accent-blue); font-weight: 600;">${assignGrammar}</span></div>
          <div>• 缺标签列: <span id="lbl-without-label" style="color: ${recon.columns_without_label.length > 0 ? 'var(--status-warning)' : 'inherit'}; font-weight: 600;">${withoutLabelGrammar}</span></div>
          <div>• 列外标签: <span id="lbl-without-column" style="color: ${recon.labels_without_column.length > 0 ? 'var(--accent-red)' : 'inherit'}; font-weight: 600;">${withoutColumnGrammar}</span></div>
          <div>• 跨界/歧义: <span>[${recon.ambiguous.join(',')}]</span></div>
          <div style="margin-top: 4px; color: var(--text-muted);">${t('step5.sequentialTitle')} ${t('step5.selectedCol')} <strong id="naming-sequential-highlight" style="color: var(--accent-green);">${activeColId}</strong> — ${t('step5.sequentialDesc')}</div>
        </div>
      </details>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-naming-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step5.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-trigger-ocr')?.addEventListener('click', () => {
    // 旧实现是去顶栏"碰"按钮：`#btn-open-ocr`、`#topbar-btn-ocr`、`[title*="OCR"]`
    // 这三个选择器在整个仓库里一个都不存在（顶栏真实按钮是 `#btn-ocr-review-modal`，
    // 其 title 为"自动识别图谱顶部属种名并为各列匹配新列名"，不含 "OCR"），
    // 于是永远走 else 分支只弹一句提示 —— 这个按钮从来没有打开过 OCR 模态。
    // 步骤 5 e2e 实测：点击后可见的 `[id^="ocr-"]` 元素数为 0，弹窗是那句提示。
    if (ctx.onOpenOcrReviewModal) {
      ctx.onOpenOcrReviewModal();
      return;
    }
    notifyError('请使用顶栏【OCR】按钮框选并识别图谱顶部标签。');
  });

  root.querySelector('#btn-apply-naming-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(6);
  });
}
