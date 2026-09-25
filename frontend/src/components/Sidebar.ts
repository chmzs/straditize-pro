import { DiagramData, TaxaColumn } from '../types/pollen';

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
        <div style="display: flex; align-items: center; gap: 4px;">
          <span class="badge">${this.data.columns.length}</span>
          <button id="btn-toggle-compact" class="tool-btn" style="padding: 2px 5px; font-size: 10px;" title="切换紧凑列表/详细卡片视图">
            ${this.isCompactView ? '☲ 卡片' : '≡ 紧凑'}
          </button>
          <button id="btn-collapse-sidebar" class="icon-btn panel-toggle" title="收起侧边栏 (Ctrl+[)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="sidebar-actions-bar" style="display: flex; gap: 4px; padding: 6px 10px 4px 10px;">
        <button id="btn-insert-gap-col" class="btn-sidebar-action" title="在当前属种后插入空缺列（抢救中间漏切一列，将后续名字后推一格）" style="width: 100%; padding: 4px 8px; font-size: 11px;">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>插空列 (急救)</span>
        </button>
      </div>

      <div style="padding: 2px 10px 6px 10px;">
        <input type="text" id="inp-search-taxa" placeholder="🔍 快速搜索属种 (输入即过滤)..." value="${this.searchQuery}" style="width: 100%; font-size: 10.5px; padding: 4px 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); box-sizing: border-box;" />
      </div>

      <div class="taxa-list" id="taxa-list-container" style="flex: 1; overflow-y: auto;">
        ${this.data.columns.length === 0
          ? `
            <div class="sidebar-empty-hint" style="padding: 30px 16px; text-align: center; color: var(--text-muted); font-size: 11.5px; line-height: 1.6;">
              <div style="font-size: 26px; margin-bottom: 8px;">📏</div>
              <strong style="color: var(--text-primary); font-size: 12px; display: block; margin-bottom: 6px;">暂未切分属种列</strong>
              请先在图谱上框选数据有效区 (ROI)，进入分列步骤。<br><br>
              系统将自动切分各列并生成 <code>col01</code>, <code>col02</code>... 默认编号列，随后您可在步骤 5 进行 OCR 识别或逐列命名。
            </div>
          `
          : this.data.columns
              .slice()
              .sort((a, b) => a.startX - b.startX)
              .filter((col) => !this.searchQuery || col.name.toLowerCase().includes(this.searchQuery.toLowerCase()))
              .map((col) => this.renderTaxaItem(col, col.id === this.data.activeTaxaId))
              .join('')}
      </div>
    `;

    this.bindEvents();
  }

  private renderTaxaItem(col: TaxaColumn, isActive: boolean): string {
    const totalCount = col.controlPoints.length;
    const pType = col.plotType || 'area';
    const typeIcons: Record<string, string> = {
      area: '🌊',
      bar: '📊',
      line: '📈',
      symbol: '➕',
    };
    const typeIcon = typeIcons[pType] || '🌊';

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

    if (this.isCompactView) {
      return `
        <div class="taxa-card compact-taxa-row ${isActive ? 'active' : ''}" data-taxa-id="${col.id}">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
            <span class="color-dot" style="background-color: ${col.color}; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;"></span>
            <input type="text" class="taxa-name-inline-input" data-col-id="${col.id}" data-action="inline-rename" value="${col.name}" style="font-size: 11px; font-weight: ${isActive ? '600' : '400'}; border: none; background: transparent; color: inherit; width: 100%; text-overflow: ellipsis; overflow: hidden; padding: 1px 2px;" title="点击直接改名，获得焦点时画布高亮该列" />
          </div>
          <div style="display: flex; align-items: center; gap: 3px; flex-shrink: 0;">
            <!-- 最大实测峰值呈现 (一眼识别优势种) -->
            <span class="taxa-peak-badge" style="font-size: 9.5px; font-weight: 700; color: ${isActive ? '#38bdf8' : 'var(--text-secondary)'}; font-family: var(--font-mono); min-width: 34px; text-align: right;" title="实测最大丰度峰值: ${maxValStr}">
              ${maxValStr}
            </span>

            <!-- 就地快速切换形态微图标 [🌊/📊/📈/➕] -->
            <button class="icon-btn" data-action="cycle-plot-type" title="当前形态: ${pType.toUpperCase()} (点击就地循环切换: 面积->柱状->折线->符号)" style="padding: 1px 3px; font-size: 11px; line-height: 1;">
              ${typeIcon}
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
            <button class="icon-btn" data-action="cycle-plot-type" title="当前形态: ${pType.toUpperCase()} (点击切换)" style="font-size: 11px;">
              ${typeIcon}
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

    // 插空列急救按钮
    this.element.querySelector('#btn-insert-gap-col')?.addEventListener('click', () => {
      if (this.data.columns.length === 0) {
        alert('提示：当前图谱尚未切分属种列，请先执行分列。');
        return;
      }
      this.callbacks.onInsertGapColumn?.(this.data.activeTaxaId);
    });

    // 搜索输入过滤
    const searchInp = this.element.querySelector('#inp-search-taxa') as HTMLInputElement;
    if (searchInp) {
      searchInp.addEventListener('input', (e) => {
        this.searchQuery = (e.target as HTMLInputElement).value;
        const list = this.element.querySelector('#taxa-list-container');
        if (list) {
          list.innerHTML = this.data.columns
            .slice()
            .sort((a, b) => a.startX - b.startX)
            .filter((col) => !this.searchQuery || col.name.toLowerCase().includes(this.searchQuery.toLowerCase()))
            .map((col) => this.renderTaxaItem(col, col.id === this.data.activeTaxaId))
            .join('');
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
            alert(`列名 '${newName}' 在当前有效区已存在，严禁重名！`);
            target.value = col.name;
            return;
          }
          col.name = newName;
          col.species = newName;
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

      // 循环就地切换形态微图标 [🌊/📊/📈/➕]
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
