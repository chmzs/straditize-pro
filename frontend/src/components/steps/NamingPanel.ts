import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notifyError } from '../../ui/feedback';
import { renderSplitLostXTicksNotice } from './XTicksDroppedNotice';
import { renderSplitSuspectNotice } from './SuspectBlockNotice';
import { renderResetButton } from '../../ui/resetButton';
import { showConfirmDialog } from '../../ui/confirm';

export const step = 4;
export const title = '4. 自动分列与属种命名';

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
    <div class="step-panel" data-step="4"
         data-label-assign="${assignPairs.join(',')}"
         data-without-label="${recon.columns_without_label.join(',')}"
         data-without-column="${recon.labels_without_column.join(',')}"
         data-lost-x-ticks="${lostTicksNotice ? 'true' : 'false'}"
         data-highlight-col="${activeColId}">
      <div class="step-title">${t('step4.title')}</div>
      <div class="step-desc">
        ${t('step4.desc')}
      </div>

      ${suspectNotice}
      ${lostTicksNotice}

      <!-- OCR 属种识别：按钮常驻（主操作），说明文字收进 title，不再占版面 -->
      <div style="display: flex; gap: 6px; margin-bottom: 6px;">
        <button id="btn-trigger-ocr" class="ui-btn ui-btn--secondary" style="flex: 1; font-size: 11px; padding: 5px;" title="${t('step4.ocrDesc')}">
          ${t('step4.ocrBtn')}
        </button>
      </div>

      <!-- 对账清单与逐列说明：默认折叠成一行摘要。
           侧栏的主要职责是让用户浏览属种表格，这三个常驻区块会把表格挤到只剩
           几行（用户实测反馈"表格浏览留着这么小的空间"）。 -->
      <details class="inspector-section" style="margin-bottom: 6px; padding: 3px 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 4px;">
        <summary style="font-size: 10px; font-weight: 600; color: var(--text-secondary); cursor: pointer; list-style: none; display: flex; align-items: center; gap: 4px;">
          <span style="flex-shrink: 0;">${t('step4.reconTitle')}</span>
          <span style="color: ${recon.columns_without_label.length > 0 || recon.labels_without_column.length > 0 ? 'var(--status-warning)' : 'var(--text-muted)'}; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${recon.columns_without_label.length > 0 || recon.labels_without_column.length > 0 ? '有未配对项，点击展开' : '全部已配对'}
          </span>
        </summary>
        <div id="naming-recon-box" class="info-kv-box" style="line-height: 1.5; font-family: monospace; font-size: 9.5px; padding: 4px 0 2px 0;">
          <div>• 配对列表: <span id="lbl-assign" style="color: var(--accent-blue); font-weight: 600;">${assignGrammar}</span></div>
          <div>• 缺标签列: <span id="lbl-without-label" style="color: ${recon.columns_without_label.length > 0 ? 'var(--status-warning)' : 'inherit'}; font-weight: 600;">${withoutLabelGrammar}</span></div>
          <div>• 列外标签: <span id="lbl-without-column" style="color: ${recon.labels_without_column.length > 0 ? 'var(--accent-red)' : 'inherit'}; font-weight: 600;">${withoutColumnGrammar}</span></div>
          <div>• 跨界/歧义: <span>[${recon.ambiguous.join(',')}]</span></div>
          <div style="margin-top: 4px; color: var(--text-muted);">${t('step4.sequentialTitle')} ${t('step4.selectedCol')} <strong id="naming-sequential-highlight" style="color: var(--accent-green);">${activeColId}</strong> — ${t('step4.sequentialDesc')}</div>
        </div>
      </details>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-naming-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px; font-weight: 600;">
        ${t('step4.next')}
      </button>

      <!-- 重设本步 (图2样式) -->
      <div style="display: flex; justify-content: center; margin-top: 8px;">
        ${renderResetButton({
          id: 'btn-reset-step4-split',
          title: '清空全部已切分的属种分列线并重新自动切分',
          label: '重新切分列',
        })}
      </div>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-trigger-ocr')?.addEventListener('click', () => {
    if (ctx.onOpenOcrReviewModal) {
      ctx.onOpenOcrReviewModal();
      return;
    }
    notifyError('请使用顶栏【OCR】按钮框选并识别图谱顶部标签。');
  });

  root.querySelector('#btn-apply-naming-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(5);
  });

  root.querySelector('#btn-reset-step4-split')?.addEventListener('click', async () => {
    if (
      !(await showConfirmDialog(
        '清空属种列',
        '确定清空当前所有属种列吗？已有的列边界与命名将被重置。',
        { destructive: true }
      ))
    ) {
      return;
    }
    if (ctx.onClearAllColumns) {
      await ctx.onClearAllColumns();
    }
    if (ctx.onRedetectColumns) {
      await ctx.onRedetectColumns();
    } else if (!ctx.onClearAllColumns) {
      ctx.onAdvanceWorkflowStage?.(4);
    }
  });
}
