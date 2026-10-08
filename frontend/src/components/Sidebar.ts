import { DiagramData, TaxaColumn } from '../types/pollen';
import { t, onLocaleChange } from '../i18n';
import { notifyError } from '../ui/feedback';

export interface SidebarCallbacks {
  onSelectTaxa: (taxaId: string) => void;
  onToggleVisible: (taxaId: string) => void;
  onUpdateTaxaColor: (taxaId: string, color: string) => void;
  onChangePlotType?: (taxaId: string, plotType: 'area' | 'bar' | 'line' | 'symbol') => void;
  onRenameTaxa?: (taxaId: string, newName: string) => void;
  onInsertGapColumn?: (afterTaxaId: string) => void;
  onToggleCollapse?: (collapsed: boolean) => void;
}

export class Sidebar {
  private element: HTMLElement;
  private data: DiagramData;
  private callbacks: SidebarCallbacks;
  private isCollapsed: boolean = false;
  private isCompactView: boolean = true; // 默认紧凑列表，极大提升大剖面属种浏览检索效率
  private searchQuery: string = '';      // 属种快速搜索关键词
  private collapsedRois: Set<string> = new Set(); // 折叠的 ROI 分组
  /** 正在把焦点还给重建后的行内改名输入框；此期间必须忽略 focusin，否则重渲染递归。 */
  private restoringInlineEdit = false;

  constructor(data: DiagramData, callbacks: SidebarCallbacks) {
    this.data = data;
    this.callbacks = callbacks;
    this.element = document.createElement('aside');
    this.element.className = 'app-sidebar';
    this.render();

    onLocaleChange(() => {
      this.renderPreservingInlineEdit();
    });
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public getIsCollapsed(): boolean {
    return this.isCollapsed;
  }

  public setCollapsed(collapsed: boolean): void {
    this.isCollapsed = collapsed;
    if (this.isCollapsed) {
      this.element.classList.add('collapsed');
    } else {
      this.element.classList.remove('collapsed');
    }
  }

  public toggleCollapse(): boolean {
    this.setCollapsed(!this.isCollapsed);
    return this.isCollapsed;
  }

  public updateData(data: DiagramData): void {
    this.data = data;
    this.renderPreservingInlineEdit();
  }

  /**
   * 重渲染侧栏，但**不打断正在进行的行内改名**。
   *
   * `render()` 会整体重写 `innerHTML`。而用户点开改名输入框时，`focusin` 会经由
   * `onSelectTaxa` → `setActiveTaxa` → `onTaxaChange`（`main.ts:498`）触发一次
   * `updateData`，于是刚拿到焦点的那个 `<input>` 立刻被销毁：焦点掉回 `<body>`，
   * 用户一个字也打不进去，已敲入但尚未 `change` 的内容也一起消失。
   *
   * 步骤 5 e2e 实测（改前）：聚焦前后不是同一个 DOM 节点、`document.activeElement`
   * 的 tagName 变成 `BODY`、逐字符输入 9 个字符后 `value` 仍是 `col01`。
   *
   * 重渲染本身躲不掉——画布高亮与步骤 5 对账清单都依赖它——所以只能把编辑现场
   * 搬到新节点上：焦点、光标位置、以及"还没提交的值"。
   */
  private renderPreservingInlineEdit(): void {
    const active = document.activeElement;
    const snapshot =
      active instanceof HTMLInputElement &&
      this.element.contains(active) &&
      active.getAttribute('data-action') === 'inline-rename'
        ? {
            colId: active.getAttribute('data-col-id') ?? '',
            value: active.value,
            caret: active.selectionStart,
          }
        : null;

    this.render();

    if (!snapshot?.colId) return;
    const again = this.element.querySelector<HTMLInputElement>(
      `input.taxa-name-inline-input[data-col-id="${CSS.escape(snapshot.colId)}"]`
    );
    if (!again) return;
    again.value = snapshot.value;
    this.restoringInlineEdit = true;
    try {
      // focus() 同步派发 focusin —— 那正是下面那个监听器会再次触发重渲染的时刻，
      // 所以标志必须在 focus() 之前立起来。
      again.focus();
      if (snapshot.caret !== null) again.setSelectionRange(snapshot.caret, snapshot.caret);
    } finally {
      this.restoringInlineEdit = false;
    }
  }

  public render(): void {
    this.element.innerHTML = `
      <div class="sidebar-header">
        <div class="sidebar-title">
          <svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
          </svg>
          <span>${t('sidebar.title')}</span>
        </div>
        <div class="sidebar-header-actions">
          <span class="badge">${this.data.columns.length}</span>
          ${this.data.columns.length > 0 ? `
            <button id="btn-toggle-compact" class="ui-icon-btn ui-btn--sm" aria-label="${t('sidebar.viewToggleTitle')}" title="${t('sidebar.viewToggleTitle')}">
              ${this.isCompactView ? '▦' : '☰'}
            </button>
          ` : ''}
          <button id="btn-collapse-sidebar" class="ui-icon-btn panel-toggle" aria-label="${t('sidebar.collapseTitle')}" title="${t('sidebar.collapseTitle')}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
      </div>

      ${this.data.columns.length > 0 ? `
        <div class="sidebar-actions-bar">
          <button id="btn-insert-gap-col" class="ui-btn ui-btn--secondary ui-btn--sm" title="${t('sidebar.insertGapTitle')}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>${t('sidebar.insertGap')}</span>
          </button>
        </div>
        <div class="sidebar-search">
          <input type="text" id="inp-search-taxa" class="ui-field" placeholder="${t('sidebar.searchPlaceholder')}" value="${this.searchQuery}" />
        </div>
      ` : ''}

      <div class="taxa-list" id="taxa-list-container">
        ${this.renderColumnsList()}
      </div>
    `;

    this.bindEvents();
  }

  private renderColumnsList(): string {
    const cols = this.data.columns || [];
    if (cols.length === 0) {
      return `
        <div class="sidebar-empty-hint">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
            <rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>
          </svg>
          <strong>${t('sidebar.emptyTitle')}</strong>
          <span>${t('sidebar.emptyDesc')}</span>
        </div>
      `;
    }

    const rois = this.data.rois && this.data.rois.length > 0 ? this.data.rois : [{ id: 'pollen', name: 'pollen' }];
    const primaryId = this.data.primary_roi_id || rois[0]?.id;

    const filteredCols = cols
      .slice()
      .sort((a, b) => a.startX - b.startX)
      .filter((col) => !this.searchQuery || col.name.toLowerCase().includes(this.searchQuery.toLowerCase()));

    if (rois.length <= 1) {
      return filteredCols.map((col) => this.renderTaxaItem(col, col.id === this.data.activeTaxaId)).join('');
    }

    // 多 ROI 分组折叠渲染
    return rois
      .map((roi) => {
        const roiId = roi.id || 'pollen';
        const isPrim = roiId === primaryId;
        const groupCols = filteredCols.filter((c) => (c.roi_id || primaryId) === roiId);
        const isCollapsed = this.collapsedRois.has(roiId) && !this.searchQuery;
        return `
          <div class="sidebar-roi-group" data-group-roi="${roiId}" style="margin-bottom: 8px;">
            <div class="sidebar-roi-header" data-toggle-roi="${roiId}" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; background: rgba(56, 189, 248, 0.08); border-left: 3px solid ${isPrim ? 'var(--accent-blue)' : 'var(--text-secondary)'}; cursor: pointer; user-select: none; border-radius: 0 4px 4px 0; margin-bottom: 4px;">
              <div style="display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700;">
                <span style="font-size: 9px; color: ${isPrim ? 'var(--accent-blue)' : 'var(--text-secondary)'};">${isCollapsed ? '▶' : '▼'}</span>
                <span style="color: var(--text-heading);">${roi.name || roiId}</span>
                ${isPrim ? `<span style="font-size: 8.5px; background: rgba(16, 185, 129, 0.15); color: var(--status-success); padding: 1px 4px; border-radius: 3px;">${t('step2.primary')}</span>` : ''}
              </div>
              <span style="font-size: 10px; color: var(--text-muted); font-weight: 500;">${groupCols.length} ${t('step2.cols')}</span>
            </div>
            <div class="sidebar-roi-items" style="display: ${isCollapsed ? 'none' : 'flex'}; flex-direction: column; gap: 4px; padding-left: 4px;">
              ${groupCols.length > 0 ? groupCols.map((col) => this.renderTaxaItem(col, col.id === this.data.activeTaxaId)).join('') : '<div style="font-size: 10px; color: var(--text-muted); padding: 4px 8px;">--</div>'}
            </div>
          </div>
        `;
      })
      .join('');
  }

  private renderTaxaItem(col: TaxaColumn, isActive: boolean): string {
    const totalCount = col.controlPoints.length;
    const pType = col.plotType || 'area';
    const typeLabels: Record<string, string> = {
      area: '面积',
      bar: '柱状',
      line: '折线',
      symbol: '符号',
    };
    const typeLabel = typeLabels[pType] || typeLabels.area;

    // 计算实测最大峰值 (若已标定且有控制点)
    let maxValStr = `${col.maxPercent}%`;
    if (col.controlPoints && col.controlPoints.length > 0) {
      const maxX = Math.max(...col.controlPoints.map((p) => p.x));
      const originX = col.scaleCalib ? col.scaleCalib.originX : col.startX;
      const calibX = col.scaleCalib ? col.scaleCalib.calibX : col.tickEndX || col.endX;
      const originVal = col.scaleCalib ? col.scaleCalib.originVal : 0;
      const calibVal = col.scaleCalib ? col.scaleCalib.calibVal : col.maxPercent || 100;
      const span = Math.max(1, calibX - originX);
      const measuredMax = Math.max(0, originVal + ((maxX - originX) / span) * (calibVal - originVal));
      maxValStr = `${measuredMax.toFixed(1)}%`;
    }

    const roi = this.data.rois?.find((r) => r.id === col.roi_id) || this.data.rois?.[0];
    const groupName = roi?.x_groups?.find((g) => g.id === col.x_group_id)?.name || '默认组';

    if (this.isCompactView) {
      return `
        <div class="taxa-card compact-taxa-row ${isActive ? 'active' : ''}" data-taxa-id="${col.id}">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
            <span class="color-dot" style="background-color: ${col.color}; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;"></span>
            <input type="text" class="taxa-name-inline-input" data-col-id="${col.id}" data-action="inline-rename" value="${col.name}" style="font-size: 11px; font-weight: ${isActive ? '600' : '400'}; border: none; background: transparent; color: inherit; width: 100%; text-overflow: ellipsis; overflow: hidden; padding: 1px 2px;" title="点击直接改名，获得焦点时画布高亮该列" />
          </div>
          <div style="display: flex; align-items: center; gap: 3px; flex-shrink: 0;">
            <!-- 最大实测峰值呈现 (一眼识别优势种) -->
            <span class="taxa-peak-badge" style="font-size: 9.5px; font-weight: 700; color: ${isActive ? 'var(--accent-blue)' : 'var(--text-secondary)'}; font-family: var(--font-mono); min-width: 34px; text-align: right;" title="实测最大丰度峰值: ${maxValStr}">
              ${maxValStr}
            </span>

            <!-- 就地快速切换形态微图标 [///] -->
            <button class="icon-btn plot-type-btn" data-action="cycle-plot-type" title="当前形态: ${pType.toUpperCase()} (点击切换形态: 面积/柱状/折线/符号)" style="padding: 1px 4px; font-size: 10px; line-height: 1.2; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 3px; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;">
              <span>${typeLabel}</span><span style="font-size: 7px; opacity: 0.6;">▾</span>
            </button>

            <button class="icon-btn toggle-visibility ${col.visible ? 'visible' : 'hidden'}" data-action="toggle-visible" title="显隐属种" style="padding: 2px;">
              ${
                col.visible
                  ? `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
                  : `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
              }
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="taxa-card ${isActive ? 'active' : ''}" data-taxa-id="${col.id}">
        <div class="taxa-header">
          <div class="taxa-title-row">
            <span class="color-dot" style="background-color: ${col.color};"></span>
            <input type="text" class="taxa-name-inline-input" data-col-id="${col.id}" data-action="inline-rename" value="${col.name}" title="点击可直接编辑此属种名称，获得焦点时画布高亮该列" />
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <button class="icon-btn plot-type-btn" data-action="cycle-plot-type" title="当前形态: ${pType.toUpperCase()} (点击切换形态: 面积/柱状/折线/符号)" style="font-size: 10px; padding: 2px 4px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 3px; cursor: pointer; display: inline-flex; align-items: center; gap: 2px;">
              <span>${typeLabel}</span><span style="font-size: 8px; opacity: 0.6;">▾</span>
            </button>
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
            <span>所属组:</span>
            <span class="badge" style="font-size: 9.5px; padding: 1px 4px;">${groupName}</span>
          </div>
          <div class="meta-item">
            <span>基线范围:</span>
            <code>${col.startX} ~ ${col.endX} px</code>
          </div>
          <div class="meta-item">
            <span>实测峰值 / 满刻度:</span>
            <code><strong>${maxValStr}</strong> / ${col.maxPercent}%</code>
          </div>
          <div class="meta-item">
            <span>锚点总数:</span>
            <span>${totalCount} 点</span>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    // 0. 折叠侧边栏与紧凑/卡片视图切换
    this.element.querySelector('#btn-collapse-sidebar')?.addEventListener('click', () => {
      this.callbacks.onToggleCollapse?.(true);
    });

    this.element.querySelector('#btn-toggle-compact')?.addEventListener('click', () => {
      this.isCompactView = !this.isCompactView;
      this.render();
    });

    // 在当前列后添加空白列；无列状态下入口不渲染。
    this.element.querySelector('#btn-insert-gap-col')?.addEventListener('click', () => {
      if (this.data.columns.length === 0) return;
      this.callbacks.onInsertGapColumn?.(this.data.activeTaxaId);
    });

    // ROI 分组折叠切换
    this.element.querySelectorAll('[data-toggle-roi]').forEach((hdr) => {
      hdr.addEventListener('click', () => {
        const roiId = hdr.getAttribute('data-toggle-roi');
        if (!roiId) return;
        if (this.collapsedRois.has(roiId)) {
          this.collapsedRois.delete(roiId);
        } else {
          this.collapsedRois.add(roiId);
        }
        this.render();
      });
    });

    // 搜索输入过滤
    const searchInp = this.element.querySelector('#inp-search-taxa') as HTMLInputElement;
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value;
        const list = this.element.querySelector('#taxa-list-container');
        if (list) {
          list.innerHTML = this.renderColumnsList();
        }
      });
      searchInp.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.searchQuery = '';
          searchInp.value = '';
          searchInp.blur();
          this.render();
        }
      });
    }

    // 列表卡片内部交互
    const list = this.element.querySelector('#taxa-list-container');
    if (!list) return;

    // 逐列点名获得焦点时画布高亮该列 (Ticket T11)
    list.addEventListener('focusin', (e) => {
      // 见 renderPreservingInlineEdit：把焦点还给重建后的输入框时也会走到这里，
      // 不挡住就是 focusin → onSelectTaxa → updateData → 重建 → focus → focusin… 无限递归。
      if (this.restoringInlineEdit) return;
      const target = e.target as HTMLInputElement;
      if (target && target.getAttribute('data-action') === 'inline-rename') {
        const colId = target.getAttribute('data-col-id');
        if (colId) {
          this.callbacks.onSelectTaxa(colId);
        }
      }
    });

    // 行内即时改名事件绑定 (检查 ROI 内唯一性)
    list.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target && target.getAttribute('data-action') === 'inline-rename') {
        const card = target.closest('.taxa-card') as HTMLElement;
        const taxaId = card?.getAttribute('data-taxa-id');
        const col = this.data.columns.find((c) => c.id === taxaId);
        const newName = target.value.trim();
        if (col && newName && newName !== col.name) {
          // Check for duplicate in same ROI
          const duplicate = this.data.columns.some((c) => c.id !== col.id && c.roi_id === col.roi_id && c.name === newName);
          if (duplicate) {
            notifyError(`列名 '${newName}' 在当前有效区已存在，严禁重名！`);
            target.value = col.name;
            return;
          }
          // 状态变更统一交给 onRenameTaxa：它要先把**旧名字**记下来，后端拒绝时才好回滚。
          // 这里抢先改 col.name 会让旧名字当场丢失（撤销标签也会退化成
          // "Rename Taxa 新名 to 新名"）。
          this.callbacks.onRenameTaxa?.(col.id, newName);
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

      // 循环就地切换形态微图标 [///]
      if (target.closest('[data-action="cycle-plot-type"]')) {
        e.stopPropagation();
        const col = this.data.columns.find((c) => c.id === taxaId);
        if (col) {
          const sequence: ('area' | 'bar' | 'line' | 'symbol')[] = ['area', 'bar', 'line', 'symbol'];
          const curIdx = sequence.indexOf(col.plotType || 'area');
          const nextType = sequence[(curIdx + 1) % sequence.length];
          col.plotType = nextType;
          this.callbacks.onChangePlotType?.(taxaId, nextType);
          this.render();
        }
        return;
      }

      // 切换显隐按钮
      if (target.closest('[data-action="toggle-visible"]')) {
        e.stopPropagation();
        this.callbacks.onToggleVisible(taxaId);
        return;
      }

      // 单击卡片选中该属种
      this.callbacks.onSelectTaxa(taxaId);
    });
  }
}
