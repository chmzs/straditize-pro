import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';

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
      <div class="step-title">5. 自动分列与属种命名 (Columns &amp; Naming)</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5;">
        基于墨迹切分属种垂直区间。支持 OCR 自动识别属种名与区间对账，或在左栏逐列输入。
      </div>

      <!-- OCR 属种识别区域 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">🔍 顶栏属种标签 OCR 识别</div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
          自动框选并透视矫正图顶属种标签带，执行 PP-OCRv4 离线识别与植物属种词典纠错。
        </p>
        <button id="btn-trigger-ocr" class="tool-btn" style="width: 100%; font-size: 11px; padding: 4px;">
          ⚡ 扫描并匹配属种名称
        </button>
      </div>

      <!-- 区间归属与对账清单 (Ticket T11) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">区间归属对账状态</div>
        <div id="naming-recon-box" style="padding: 6px 8px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 4px; font-size: 10px; line-height: 1.6; font-family: monospace;">
          <div>• 配对列表: <span id="lbl-assign" style="color: var(--accent-blue);">${assignGrammar}</span></div>
          <div>• 缺标签列: <span id="lbl-without-label" style="color: ${recon.columns_without_label.length > 0 ? '#f59e0b' : 'inherit'};">${withoutLabelGrammar}</span></div>
          <div>• 列外标签: <span id="lbl-without-column" style="color: ${recon.labels_without_column.length > 0 ? '#ef4444' : 'inherit'};">${withoutColumnGrammar}</span></div>
          <div>• 跨界/歧义: <span>[${recon.ambiguous.join(',')}]</span></div>
        </div>
      </div>

      <!-- 逐列点名模式说明 -->
      <div class="inspector-section" style="padding: 8px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 6px; margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--accent-blue); margin-bottom: 4px;">📝 逐列点名模式 (顺序无关)</div>
        <div style="font-size: 10px; color: var(--text-secondary); line-height: 1.4;">
          当前选中列: <strong id="naming-sequential-highlight" style="color: var(--accent-green, #10b981);">${activeColId}</strong><br>
          在左侧栏中直接输入各列属种名，获得焦点时画布将即时高亮该列，杜绝顺序假定。
        </div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-naming-next" class="primary-btn" style="width: 100%; padding: 6px 12px; font-size: 12px;">
        👉 确认列命名，进入 X 轴刻度标定 (步骤 6)
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
