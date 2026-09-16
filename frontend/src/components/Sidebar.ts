import { DiagramData, TaxaColumn } from '../types/pollen';
import { PollenGlossary, TaxaParseResult } from '../core/PollenGlossary';

export interface SidebarCallbacks {
  onSelectTaxa: (taxaId: string) => void;
  onToggleVisible: (taxaId: string) => void;
  onChangeCurveType: (taxaId: string, type: 'linear' | 'bezier') => void;
  onUpdateTaxaColor: (taxaId: string, color: string) => void;
  onBatchImportTaxa?: (taxaNames: string[]) => void;
  onInsertGapColumn?: (afterTaxaId: string) => void;
  onSwapTaxaNames?: (idx1: number, idx2: number) => void;
}

export class Sidebar {
  private element: HTMLElement;
  private data: DiagramData;
  private callbacks: SidebarCallbacks;
  private isCollapsed: boolean = false;

  constructor(data: DiagramData, callbacks: SidebarCallbacks) {
    this.data = data;
    this.callbacks = callbacks;
    this.element = document.createElement('aside');
    this.element.className = 'app-sidebar';
    this.render();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public toggleCollapse(): boolean {
    this.isCollapsed = !this.isCollapsed;
    if (this.isCollapsed) {
      this.element.classList.add('collapsed');
    } else {
      this.element.classList.remove('collapsed');
    }
    return this.isCollapsed;
  }

  public updateData(data: DiagramData): void {
    this.data = data;
    this.render();
  }

  public render(): void {
    this.element.innerHTML = `
      <div class="sidebar-header">
        <div class="sidebar-title">
          <svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span>Taxa 属种分列清单</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="badge">${this.data.columns.length}</span>
          <button id="btn-collapse-sidebar" class="icon-btn" title="收起/展开属种树 (快捷键: [)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="sidebar-actions-bar" style="display: flex; gap: 4px; padding: 6px 10px;">
        <button id="btn-open-paste-taxa" class="btn-sidebar-action" style="flex: 1;" title="从 Excel / 文献 Word 批量复制并粘贴属种名单">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
            <path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>
          </svg>
          <span>批量导入</span>
        </button>
        <button id="btn-insert-gap-col" class="btn-sidebar-action" title="在当前属种后插入空缺列（抢救中间漏切一列，将后续名字后推一格）" style="width: auto; padding: 4px 8px; font-size: 11px;">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>插空列</span>
        </button>
      </div>

      <div class="taxa-list" id="taxa-list-container">
        ${this.data.columns
          .map((col) => this.renderTaxaItem(col, col.id === this.data.activeTaxaId))
          .join('')}
      </div>

      <div class="sidebar-footer">
        <div class="tip-card">
          <div class="tip-title">⚡ 交互操作指南</div>
          <ul class="tip-list">
            <li><strong>📋 批量导入：</strong>一键从 Excel / Word 粘贴数十列属种名，自动 OCR 纠错</li>
            <li><strong>普通左键单击：</strong>在点击位置直接添加控制点，轮廓吸附拉伸</li>
            <li><strong>左键按住控制点：</strong>实时拖动修改轮廓形态</li>
            <li><strong>右键点击控制点：</strong>直接删除该锚点</li>
            <li><strong>红色垂线：</strong>鼠标悬停拖拽调整属种列基线与分界</li>
            <li><strong>淡蓝横线：</strong>地层深度标尺网格，严格统一层位数据</li>
            <li><strong>Ctrl+Z / Ctrl+Y：</strong>撤销与重做</li>
          </ul>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  private renderTaxaItem(col: TaxaColumn, isActive: boolean): string {
    const manualCount = col.controlPoints.filter((p) => p.isManual).length;
    const totalCount = col.controlPoints.length;

    return `
      <div class="taxa-card ${isActive ? 'active' : ''}" data-taxa-id="${col.id}">
        <div class="taxa-header">
          <div class="taxa-title-row">
            <span class="color-dot" style="background-color: ${col.color};"></span>
            <input type="text" class="taxa-name-inline-input" data-action="inline-rename" value="${col.name}" title="点击可直接编辑此属种名称" />
          </div>
          <div style="display: flex; align-items: center; gap: 3px;">
            <button class="icon-btn" data-action="swap-up" title="向上对调属种名称" style="padding: 1px 3px; font-size: 10px; line-height: 1;">▲</button>
            <button class="icon-btn" data-action="swap-down" title="向下对调属种名称" style="padding: 1px 3px; font-size: 10px; line-height: 1;">▼</button>
            <button class="icon-btn toggle-visibility ${col.visible ? 'visible' : 'hidden'}" data-action="toggle-visible" title="显隐属种">
              ${
                col.visible
                  ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
                  : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
              }
            </button>
          </div>
        </div>

        <div class="taxa-meta">
          <div class="meta-item">
            <span>基线范围:</span>
            <code>${col.startX} ~ ${col.endX} px</code>
          </div>
          <div class="meta-item">
            <span>满刻度:</span>
            <code>${col.maxPercent}%</code>
          </div>
          <div class="meta-item">
            <span>锚点总数:</span>
            <span><strong style="color: #fbbf24;">${manualCount}</strong> 手动 / ${totalCount} 点</span>
          </div>
        </div>

        <div class="taxa-actions">
          <div class="btn-group">
            <button class="segmented-btn ${col.curveType === 'bezier' ? 'active' : ''}" data-action="curve-bezier">
              贝塞尔平滑
            </button>
            <button class="segmented-btn ${col.curveType === 'linear' ? 'active' : ''}" data-action="curve-linear">
              折线连接
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    // 0. 折叠侧边栏
    this.element.querySelector('#btn-collapse-sidebar')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // 1. 批量导入属种名单弹窗触发按钮
    const pasteBtn = this.element.querySelector('#btn-open-paste-taxa');
    if (pasteBtn) {
      pasteBtn.addEventListener('click', () => {
        this.openPasteTaxaModal();
      });
    }

    // 插空列急救按钮
    this.element.querySelector('#btn-insert-gap-col')?.addEventListener('click', () => {
      this.callbacks.onInsertGapColumn?.(this.data.activeTaxaId);
    });

    // 2. 列表卡片内部交互
    const list = this.element.querySelector('#taxa-list-container');
    if (!list) return;

    // 行内即时改名事件绑定
    list.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target && target.getAttribute('data-action') === 'inline-rename') {
        const card = target.closest('.taxa-card') as HTMLElement;
        const taxaId = card?.getAttribute('data-taxa-id');
        const col = this.data.columns.find((c) => c.id === taxaId);
        const newName = target.value.trim();
        if (col && newName && newName !== col.name) {
          col.name = newName;
          this.callbacks.onBatchImportTaxa?.(this.data.columns.map((c) => c.name));
        }
      }
    });

    list.addEventListener('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      const target = ke.target as HTMLInputElement;
      if (target && target.getAttribute('data-action') === 'inline-rename' && ke.key === 'Enter') {
        target.blur();
      }
    });

    list.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const card = target.closest('.taxa-card') as HTMLElement;
      if (!card) return;

      const taxaId = card.getAttribute('data-taxa-id');
      if (!taxaId) return;

      // 向上对调属种名称
      if (target.closest('[data-action="swap-up"]')) {
        e.stopPropagation();
        const idx = this.data.columns.findIndex((c) => c.id === taxaId);
        if (idx > 0) {
          this.callbacks.onSwapTaxaNames?.(idx, idx - 1);
        }
        return;
      }

      // 向下对调属种名称
      if (target.closest('[data-action="swap-down"]')) {
        e.stopPropagation();
        const idx = this.data.columns.findIndex((c) => c.id === taxaId);
        if (idx >= 0 && idx < this.data.columns.length - 1) {
          this.callbacks.onSwapTaxaNames?.(idx, idx + 1);
        }
        return;
      }

      // 切换显隐按钮
      if (target.closest('[data-action="toggle-visible"]')) {
        e.stopPropagation();
        this.callbacks.onToggleVisible(taxaId);
        return;
      }

      // 切换贝塞尔
      if (target.closest('[data-action="curve-bezier"]')) {
        e.stopPropagation();
        this.callbacks.onChangeCurveType(taxaId, 'bezier');
        return;
      }

      // 切换折线
      if (target.closest('[data-action="curve-linear"]')) {
        e.stopPropagation();
        this.callbacks.onChangeCurveType(taxaId, 'linear');
        return;
      }

      // 单击卡片选中该属种
      this.callbacks.onSelectTaxa(taxaId);
    });
  }

  /**
   * 弹出轻量文本区域：支持从 Excel / Word 批量粘贴属种名单，自动切分、词典模糊纠错与自动列拓展
   */
  public openPasteTaxaModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';

    const currentCount = this.data.columns.length;

    modal.innerHTML = `
      <div class="modal-dialog modal-large paste-taxa-dialog">
        <div class="modal-header">
          <div class="modal-title-wrap">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
              <path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>
            </svg>
            <h3>批量导入属种名单 (Paste Taxa List)</h3>
          </div>
          <button class="close-btn" id="paste-modal-close">&times;</button>
        </div>

        <div class="modal-body">
          <p class="modal-description">
            可直接从 <strong>Excel（整行或整列）</strong> 或 <strong>文献 Word</strong> 中复制拉丁属种名单粘贴于此（支持包含 Markdown <i>*Pinus*</i> 格式）。<br>
            系统自动按回车或制表符切分，按图谱<strong>从左到右顺序重命名全部列</strong>；当属种数多于当前列数时，<strong>自动依据列间距向右拓展分列</strong>。
          </p>

          <div class="paste-options-bar">
            <div class="file-import-btn-wrap">
              <button id="btn-upload-taxa-file" class="tool-btn highlight" style="font-size: 11px; padding: 4px 8px;">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>从 CSV / TXT 文件导入</span>
              </button>
              <input type="file" id="taxa-file-input" accept=".csv,.txt,.tsv" style="display: none;" />
            </div>

            <label class="checkbox-label" title="自动匹配标准第四纪古生态词典并修正 OCR 扫描错字 (如 Pmus➔Pinus, Artemesia➔Artemisia)">
              <input type="checkbox" id="chk-enable-glossary" checked />
              <span>启用标准花粉词典自动校正 (Pollen Glossary)</span>
            </label>
            <div class="delimiter-tag">支持换行 (\\n)、制表符 (\\t)、逗号/分号</div>
          </div>

          <div class="form-group">
            <textarea
              id="taxa-raw-input"
              class="paste-taxa-textarea"
              rows="6"
              placeholder="在此直接粘贴 (Ctrl+V) 属种名称列表...&#10;&#10;示例 1 (Excel 列复制 / 回车换行)：&#10;*Pinus canariensis*&#10;Artemesia&#10;Chenopodiacee&#10;Poacee&#10;Betla&#10;&#10;示例 2 (Excel 行复制 / 制表符)：&#10;Pinus&#9;Artemisia&#9;Chenopodiaceae&#9;Poaceae"
            ></textarea>
          </div>

          <!-- 实时解析与 OCR 纠错预览 -->
          <div class="paste-preview-section">
            <div class="preview-header">
              <span id="preview-count-badge" class="preview-badge">已解析: 0 个属种</span>
              <span id="preview-diff-info" class="preview-diff">当前图谱共有 ${currentCount} 列</span>
            </div>
            <div id="preview-chips-container" class="preview-chips-container">
              <div class="preview-placeholder">等待粘贴属种数据...</div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary" id="paste-modal-cancel">取消</button>
          <button class="btn btn-primary" id="paste-modal-apply" disabled>
            应用并重命名 / 拓展分列
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const textarea = modal.querySelector('#taxa-raw-input') as HTMLTextAreaElement;
    const chkGlossary = modal.querySelector('#chk-enable-glossary') as HTMLInputElement;
    const badgeEl = modal.querySelector('#preview-count-badge') as HTMLElement;
    const diffEl = modal.querySelector('#preview-diff-info') as HTMLElement;
    const chipsContainer = modal.querySelector('#preview-chips-container') as HTMLElement;
    const applyBtn = modal.querySelector('#paste-modal-apply') as HTMLButtonElement;

    let currentParsed: TaxaParseResult[] = [];

    const updatePreview = () => {
      const text = textarea.value;
      const enableGlossary = chkGlossary.checked;
      currentParsed = PollenGlossary.parseTaxaList(text, enableGlossary);

      const parsedCount = currentParsed.length;
      badgeEl.textContent = `已解析: ${parsedCount} 个属种`;

      if (parsedCount === 0) {
        diffEl.textContent = `当前图谱共有 ${currentCount} 列`;
        diffEl.className = 'preview-diff';
        chipsContainer.innerHTML = '<div class="preview-placeholder">等待粘贴属种数据...</div>';
        applyBtn.disabled = true;
        return;
      }

      applyBtn.disabled = false;

      // 计算列拓展情况
      if (parsedCount > currentCount) {
        const added = parsedCount - currentCount;
        diffEl.innerHTML = `覆盖前 ${currentCount} 列，并将<strong>自动拓展 ${added} 个新属种列</strong> (保持列间距)`;
        diffEl.className = 'preview-diff expansion-highlight';
      } else if (parsedCount < currentCount) {
        diffEl.textContent = `将重命名最左侧 ${parsedCount} 列 (其余 ${currentCount - parsedCount} 列保留原有名称)`;
        diffEl.className = 'preview-diff';
      } else {
        diffEl.textContent = `精准覆盖当前全部 ${currentCount} 列`;
        diffEl.className = 'preview-diff match-highlight';
      }

      // 渲染 Chips 标签
      chipsContainer.innerHTML = currentParsed
        .map((p, idx) => {
          if (p.wasCorrected) {
            return `
              <div class="taxa-chip corrected" title="原始输入: ${p.original}&#10;纠错说明: ${p.note || 'OCR 模糊修正'}">
                <span class="chip-index">${idx + 1}</span>
                <span class="chip-name">${p.corrected}</span>
                <span class="chip-tag">OCR纠正</span>
              </div>
            `;
          }
          return `
            <div class="taxa-chip" title="${p.corrected}">
              <span class="chip-index">${idx + 1}</span>
              <span class="chip-name">${p.corrected}</span>
            </div>
          `;
        })
        .join('');
    };

    textarea.addEventListener('input', updatePreview);
    chkGlossary.addEventListener('change', updatePreview);

    // 文件上传读取事件
    const fileInput = modal.querySelector('#taxa-file-input') as HTMLInputElement;
    const uploadBtn = modal.querySelector('#btn-upload-taxa-file') as HTMLButtonElement;

    uploadBtn?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        const file = files[0];
        const reader = new FileReader();
        reader.onload = (re) => {
          const content = (re.target?.result as string) || '';
          textarea.value = content;
          updatePreview();
        };
        reader.readAsText(file, 'utf-8');
        fileInput.value = '';
      }
    });

    const closeModal = () => modal.remove();
    modal.querySelector('#paste-modal-close')?.addEventListener('click', closeModal);
    modal.querySelector('#paste-modal-cancel')?.addEventListener('click', closeModal);

    // 点击应用
    applyBtn.addEventListener('click', () => {
      if (currentParsed.length === 0) return;
      const names = currentParsed.map((p) => p.corrected);

      if (this.callbacks.onBatchImportTaxa) {
        this.callbacks.onBatchImportTaxa(names);
      }
      closeModal();
    });

    // 自动聚焦输入框
    setTimeout(() => textarea.focus(), 50);
  }
}
