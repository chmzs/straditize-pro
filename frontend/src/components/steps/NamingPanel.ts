import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';

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

  const assignPairs = Object.entries(recon.assigned).map(([lbl, col]) => `${lbl}=${col}`);
  const assignGrammar = `[${assignPairs.join(',')}]`;
  const withoutLabelGrammar = `[${recon.columns_without_label.join(',')}]`;
  const withoutColumnGrammar = `[${recon.labels_without_column.join(',')}]`;

  return `
    <div class="step-panel" data-step="5"
         data-label-assign="${assignPairs.join(',')}"
         data-without-label="${recon.columns_without_label.join(',')}"
         data-without-column="${recon.labels_without_column.join(',')}"
         data-highlight-col="${activeColId}">
      <div class="step-title">${t('step5.title')}</div>
      <div class="step-desc">
        ${t('step5.desc')}
      </div>

      <!-- OCR 属种识别区域 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">${t('step5.ocrSection')}</div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
          ${t('step5.ocrDesc')}
        </p>
        <button id="btn-trigger-ocr" class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 5px;">
          ⚡ ${t('step5.ocrBtn')}
        </button>
      </div>

      <!-- 区间归属与对账清单 (Ticket T11) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">${t('step5.reconTitle')}</div>
        <div id="naming-recon-box" class="info-kv-box" style="line-height: 1.6; font-family: monospace;">
          <div>• 配对列表: <span id="lbl-assign" style="color: var(--accent-blue); font-weight: 600;">${assignGrammar}</span></div>
          <div>• 缺标签列: <span id="lbl-without-label" style="color: ${recon.columns_without_label.length > 0 ? '#f59e0b' : 'inherit'}; font-weight: 600;">${withoutLabelGrammar}</span></div>
          <div>• 列外标签: <span id="lbl-without-column" style="color: ${recon.labels_without_column.length > 0 ? '#ef4444' : 'inherit'}; font-weight: 600;">${withoutColumnGrammar}</span></div>
          <div>• 跨界/歧义: <span>[${recon.ambiguous.join(',')}]</span></div>
        </div>
      </div>

      <!-- 逐列点名模式说明 -->
      <div class="info-callout" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--accent-blue); margin-bottom: 4px;">${t('step5.sequentialTitle')}</div>
        <div style="font-size: 10px; line-height: 1.4;">
          ${t('step5.selectedCol')} <strong id="naming-sequential-highlight" style="color: var(--accent-green, #10b981);">${activeColId}</strong><br>
          ${t('step5.sequentialDesc')}
        </div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-naming-next" class="btn btn-primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step5.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-trigger-ocr')?.addEventListener('click', () => {
    const ocrBtn = document.querySelector('#btn-open-ocr, #topbar-btn-ocr, [title*="OCR"]') as HTMLButtonElement | null;
    if (ocrBtn) {
      ocrBtn.click();
    } else {
      alert('请使用顶栏【🔍 OCR】按钮框选并识别图谱顶部标签。');
    }
  });

  root.querySelector('#btn-apply-naming-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(6);
  });
}
