import { DiagramData, TaxaColumn } from '../types/pollen';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { peakValueFromScale } from '../core/scaleDisplay';
import { resolvePlotType } from '../core/plotType';
import { resolveColumnGroup } from '../core/columnGroup';
import { groupColorAt } from './canvas/groupColor';
import { t, onLocaleChange } from '../i18n';
import { notifyError } from '../ui/feedback';
import { renderActiveColumnSuspectNotice } from './steps/SuspectBlockNotice';

/** 标度值显示：整数原样，非整数保留 1 位小数。
 *  实测几何算出来的满刻度常是 49.799196787148595 这种，直接显示等于把浮点误差当读数。 */
function formatScaleValue(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export interface SidebarCallbacks {
  onSelectTaxa: (taxaId: string) => void;
  onToggleVisible: (taxaId: string) => void;
  onUpdateTaxaColor: (taxaId: string, color: string) => void;
  /** `null` = 清除列级覆盖、回到组级形态。 */
  onChangePlotType?: (taxaId: string, plotType: 'area' | 'bar' | 'line' | 'symbol' | null) => void;
  onRenameTaxa?: (taxaId: string, newName: string) => void;
  onInsertGapColumn?: (afterTaxaId: string) => void;
  onToggleCollapse?: (collapsed: boolean) => void;
  onDigitizeColumn?: (taxaId: string) => Promise<void> | void;
  onRedigitizeColumn?: (taxaId: string) => Promise<void> | void;
  onExtractTurningPoints?: (taxaId: string) => Promise<void> | void;
  onDeleteColumn?: (taxaId: string) => Promise<void> | void;
  /** 批量形态修改 */
  onBatchChangePlotType?: (taxaIds: string[], plotType: 'area' | 'bar' | 'line' | 'symbol' | null) => Promise<void> | void;
  /** 批量重新数字化取数 */
  onBatchDigitizeColumns?: (taxaIds: string[]) => Promise<void> | void;
  /** 批量重新识别轮廓与拐点 */
  onBatchRedigitizeColumns?: (taxaIds: string[]) => Promise<void> | void;
  /** 批量提取峰谷控制点 */
  onBatchExtractTurningPoints?: (taxaIds: string[]) => Promise<void> | void;
  /** 全量重设所有列轮廓与拐点 */
  onRedigitizeAllColumns?: (resetManual?: boolean) => Promise<void> | void;
}

export class Sidebar {
  private element: HTMLElement;
  private data: DiagramData;
  private callbacks: SidebarCallbacks;
  private isCollapsed: boolean = false;
  private searchQuery: string = '';      // 属种快速搜索关键词
  private collapsedRois: Set<string> = new Set(); // 折叠的 ROI 分组
  private selectedColumnIds: Set<string> = new Set(); // 多选列 ID 集合 (#126)
  private lastClickedColId: string | null = null;     // 用于 Shift 连选
  /** 正在把焦点还给重建后的行内改名输入框；此期间必须忽略 focusin，否则重渲染递归。 */
  private restoringInlineEdit = false;
  private delArmedAt: number = 0;
  private delArmedColId: string = '';

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
   * 联动滚动：将当前激活的属种列卡片滚动到侧边栏可见区域 (#131)。
   * 如果该列所属的 ROI 分组处于折叠状态，先解除折叠。
   */
  public scrollToActiveColumn(smooth = true): void {
    if (!this.data.activeTaxaId) return;
    const activeCol = this.data.columns?.find((c) => c.id === this.data.activeTaxaId);
    if (!activeCol) return;

    const rois = this.data.rois && this.data.rois.length > 0 ? this.data.rois : [{ id: 'pollen', name: 'pollen' }];
    const primaryId = this.data.primary_roi_id || rois[0]?.id || 'pollen';
    const roiId = activeCol.roi_id || primaryId;
    if (this.collapsedRois.has(roiId)) {
      this.collapsedRois.delete(roiId);
      this.renderPreservingInlineEdit();
    }

    const listEl = this.element.querySelector<HTMLElement>('#taxa-list-container');
    if (!listEl) return;
    const activeCard = listEl.querySelector<HTMLElement>(
      `.taxa-card[data-taxa-id="${CSS.escape(this.data.activeTaxaId)}"]`
    );
    if (activeCard) {
      activeCard.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'nearest',
        inline: 'nearest',
      });
    }
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
    const listEl = this.element.querySelector<HTMLElement>('#taxa-list-container');
    const prevScrollTop = listEl ? listEl.scrollTop : 0;

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

    const newListEl = this.element.querySelector<HTMLElement>('#taxa-list-container');
    if (newListEl && prevScrollTop > 0) {
      newListEl.scrollTop = prevScrollTop;
    }

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
    const listEl = this.element.querySelector<HTMLElement>('#taxa-list-container');
    const prevScrollTop = listEl ? listEl.scrollTop : 0;

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
          <button id="btn-collapse-sidebar" class="ui-icon-btn panel-toggle" aria-label="${t('sidebar.collapseTitle')}" title="${t('sidebar.collapseTitle')}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
        </div>
      </div>

      ${this.data.columns.length > 0 ? `
        <div class="sidebar-actions-bar" style="display: flex; gap: 6px; align-items: center;">
          <button id="btn-insert-gap-col" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex: 1;" title="${t('sidebar.insertGapTitle')}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            <span>${t('sidebar.insertGap')}</span>
          </button>
          <button id="btn-toggle-batch-select" class="ui-btn ${this.selectedColumnIds.size > 0 ? 'ui-btn--primary' : 'ui-btn--secondary'} ui-btn--xs" style="flex: 1;" title="${t('sidebar.batchSelectTitle')}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>${this.selectedColumnIds.size > 0 ? t('sidebar.batchExit') : t('sidebar.batchSelect')}</span>
          </button>
        </div>
        <div class="sidebar-search">
          <input type="text" id="inp-search-taxa" class="ui-field" placeholder="${t('sidebar.searchPlaceholder')}" value="${this.searchQuery}" />
        </div>
        ${this.selectedColumnIds.size >= 2 ? `
          <div class="sidebar-batch-bar" style="padding: 6px 8px; background: color-mix(in srgb, var(--accent-blue) 12%, transparent); border-radius: 4px; margin: 0 8px 8px 8px; border: 1px solid var(--accent-blue);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <span style="font-size: 11px; font-weight: 700; color: var(--accent-blue);">${t('sidebar.batchSelected', { count: this.selectedColumnIds.size })}</span>
              <div style="display: flex; gap: 4px;">
                <button type="button" id="btn-batch-select-all" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 9.5px; padding: 1px 4px;">${t('sidebar.selectAll')}</button>
                <button type="button" id="btn-batch-clear-selection" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 9.5px; padding: 1px 4px;">${t('sidebar.clearSelection')}</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span style="font-size: 9.5px; color: var(--text-secondary);">${t('sidebar.batchPlotType')}</span>
              <div class="btn-group" style="display: flex; gap: 2px;">
                <button type="button" class="ui-btn ui-btn--quiet ui-btn--xs btn-batch-plottype" data-type="area" style="font-size: 9px; padding: 1px 4px;">面积</button>
                <button type="button" class="ui-btn ui-btn--quiet ui-btn--xs btn-batch-plottype" data-type="bar" style="font-size: 9px; padding: 1px 4px;">柱状</button>
                <button type="button" class="ui-btn ui-btn--quiet ui-btn--xs btn-batch-plottype" data-type="line" style="font-size: 9px; padding: 1px 4px;">折线</button>
                <button type="button" class="ui-btn ui-btn--quiet ui-btn--xs btn-batch-plottype" data-type="symbol" style="font-size: 9px; padding: 1px 4px;">符号</button>
              </div>
            </div>
            <div>
              <button type="button" id="btn-batch-redigitize" class="ui-btn ui-btn--primary ui-btn--xs" style="width: 100%; font-size: 10.5px; padding: 5px 4px; font-weight: 600;" title="${t('sidebar.batchRedigitizeTitle')}">
                ${t('sidebar.batchRedigitize')}
              </button>
            </div>
          </div>
        ` : ''}
      ` : ''}

      <div class="taxa-list" id="taxa-list-container">
        ${this.renderColumnsList()}
      </div>
    `;

    this.bindEvents();

    const newListEl = this.element.querySelector<HTMLElement>('#taxa-list-container');
    if (newListEl && prevScrollTop > 0) {
      newListEl.scrollTop = prevScrollTop;
    }
  }

  /**
   * 左栏要渲染哪些列：**跟随当前 active ROI**。
   *
   * 缺陷背景（hands-on ledger H-15）：切换 active/primary ROI 后左栏仍渲染原来那一组列，
   * 卡片上写「roi_2 (0列)」而左栏列着 roi_1 的 29 列 —— 后端 `columns[].roi_id` 是对的，
   * 是显示层没跟随。后果：用户在 A 分区里点选/改名，改的其实是 B 分区的列。
   *
   * 只在"有多个分区"且列带 roi_id 时才过滤；单分区或旧数据（无 roi_id）保持原样，
   * 避免把本来正常的单 ROI 场景改坏。
   */
  private visibleColumns(): TaxaColumn[] {
    const all = this.data.columns || [];
    const rois = (this.data as unknown as { rois?: { id: string }[] }).rois;
    if (!rois || rois.length <= 1) return all;
    const d = this.data as unknown as { active_roi_id?: string; activeRoiId?: string };
    const activeId = d.active_roi_id || d.activeRoiId;
    if (!activeId) return all;
    return all.filter((c) => {
      const rid = (c as unknown as { roi_id?: string }).roi_id;
      return !rid || rid === activeId;
    });
  }

  private renderColumnsList(): string {
    const cols = this.visibleColumns();
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

  /** 列所属的 x 组（组级 `plot_type` 是形态的单一事实源）。 */
  private groupOfColumn(col: TaxaColumn) {
    for (const roi of this.data.rois ?? []) {
      const group = (roi.x_groups ?? []).find((g) => g.id === col.x_group_id);
      if (group) return group;
    }
    return undefined;
  }

  private renderTaxaItem(col: TaxaColumn, isActive: boolean): string {
    const totalCount = col.controlPoints.length;
    // 形态：列级显式覆盖 > 组级 > 'area'（组级是单一事实源，见 `core/plotType.ts`）。
    // 直接读 `col.plotType` 会把从组值抄来的旧快照当用户意图，改组后界面不跟着变。
    const pType = resolvePlotType(col, this.groupOfColumn(col));
    const typeLabels: Record<string, string> = {
      area: '面积',
      bar: '柱状',
      line: '折线',
      symbol: '符号',
    };

    // 实测峰值与满刻度只在**真标定**后才有意义。判据与画布同源（x_ticks），
    // 标度解析走 CoordinateSystem.resolveColumnScale（唯一入口，优先 x_ticks）。
    // 未标定时 tickEndX / maxPercent 都是分列期写入的猜测值，
    // 把它们显示成数字，等于在界面上编造读数。
    const resolved = CoordinateSystem.resolveColumnScale(col);
    // 判别式用解析结果自己的 `calibrated`（与画布同源）；不要在这里另判一次 x_ticks，
    // 两处判据分叉正是这一类缺陷的起点。
    const scale = resolved.calibrated ? resolved : null;
    // 组斜率模型下 `val1` 是斜率（每像素单位数），不是满刻度——见下方标签分支。
    const isSlopeScale =
      resolved.source === 'group_slope' || resolved.source === 'group';
    let maxValStr = scale ? `${formatScaleValue(scale.val1)}${scale.unit}` : '未标定';
    if (scale && col.controlPoints && col.controlPoints.length > 0) {
      const maxX = Math.max(...col.controlPoints.map((p) => p.x));
      // 峰值必须与导出表同口径：`peakValueFromScale` 里除掉了 exaggeration_mult。
      // 不除的话，5× 放大的列在侧栏显示 13.6%、在 data.csv 里是 2.7%（实测缺陷）。
      maxValStr = `${peakValueFromScale(scale, maxX).toFixed(1)}${scale.unit}`;
    }

    const roi = this.data.rois?.find((r) => r.id === col.roi_id) || this.data.rois?.[0];
    const group = resolveColumnGroup(col, roi);
    const groupName = group?.name || '默认组';
    const gIdx = roi?.x_groups?.findIndex((g) => g.id === group?.id) ?? 0;
    const gColor = groupColorAt(gIdx >= 0 ? gIdx : 0);

    const activeDetailHtml = `
      <div class="active-column-detail" style="margin-top: 6px; padding: 6px 8px; background: rgba(148,163,184,0.08); border-radius: 4px; border: 1px solid rgba(148,163,184,0.2);">
        ${renderActiveColumnSuspectNotice(col)}
        <div style="display: flex; gap: 4px;">
          <button type="button" id="btn-col-digitize" class="ui-btn ui-btn--quiet ui-btn--xs sidebar-btn-digitize sidebar-btn-redigitize" data-col-id="${col.id}" style="flex: 1; font-size: 10px; padding: 4px 2px; color: var(--accent-blue); border-color: rgba(2,132,199,0.3); background: rgba(2,132,199,0.06);" title="${t('sidebar.redigitizeTitle')}">
            ${t('sidebar.redigitize')}
          </button>
          <button type="button" id="btn-extract-turning-points" class="ui-btn ui-btn--quiet ui-btn--xs sidebar-btn-turning-points" data-col-id="${col.id}" style="flex: 1; font-size: 10px; padding: 4px 2px; color: var(--accent-violet); border-color: rgba(139,92,246,0.3); background: rgba(139,92,246,0.06);" title="按几何曲线自动提取峰/谷控制点（保留已有手工点）">
            提取峰谷
          </button>
          <button type="button" id="btn-col-delete" class="ui-btn ui-btn--quiet ui-btn--xs sidebar-btn-delete-col" data-col-id="${col.id}" style="font-size: 10px; padding: 4px 6px; color: var(--accent-red); border-color: rgba(220,38,38,0.3); background: rgba(220,38,38,0.04);" title="删除此列">
            删除列
          </button>
        </div>
      </div>
    `;

    const isBatchSelected = this.selectedColumnIds.has(col.id);

    return `
      <div class="taxa-card ${isActive ? 'active' : ''} ${isBatchSelected ? 'batch-selected' : ''}" data-taxa-id="${col.id}">
        <div class="taxa-header">
          <div class="taxa-title-row" style="display: flex; align-items: center; gap: 4px;">
            <input type="checkbox" class="taxa-select-checkbox" data-col-id="${col.id}" ${isBatchSelected ? 'checked' : ''} style="cursor: pointer; width: 13px; height: 13px; margin: 0; flex-shrink: 0;" title="勾选多选列" />
            <span class="color-dot" style="background-color: ${col.color};"></span>
            <input type="text" class="taxa-name-inline-input" data-col-id="${col.id}" data-action="inline-rename" value="${col.name}" title="点击可直接编辑此属种名称，获得焦点时画布高亮该列" />
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
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
            <span class="badge" style="font-size: 9.5px; padding: 1px 5px; border-left: 3px solid ${gColor}; background: rgba(148, 163, 184, 0.12); display: inline-flex; align-items: center; gap: 4px;">
              <span style="width: 6px; height: 6px; border-radius: 50%; background: ${gColor}; display: inline-block;"></span>
              <span>${groupName} (${typeLabels[pType] || '面积'})</span>
            </span>
          </div>
          <div class="meta-item">
            <span>X 刻度:</span>
            ${
              scale
                ? `<span class="badge" style="font-size: 9.5px; padding: 1px 5px; background: rgba(16, 185, 129, 0.15); color: var(--status-success); font-weight: 600;">已标定 (${formatScaleValue(scale.val0)} ~ ${formatScaleValue(scale.val1)} ${scale.unit})</span>`
                : `<span class="badge" style="font-size: 9.5px; padding: 1px 5px; background: rgba(245, 158, 11, 0.15); color: var(--status-warning);">未标定</span>`
            }
          </div>
          <div class="meta-item">
            <span>基线范围:</span>
            <code>${col.startX} ~ ${col.endX} px</code>
          </div>
          <div class="meta-item">
            <span>峰值（实测最大）:</span>
            <code>${scale ? `<strong>${maxValStr}</strong>` : '未标定（X 轴刻度未设定）'}</code>
          </div>
          <div class="meta-item">
            <!-- 两种标定模型的 val1 语义不同，标签必须跟着 source 走：
                 - group_slope：val1 是**斜率**（每像素多少单位），不是满刻度；
                 - x_ticks：val1 才是第二齿的真实读数（满刻度）。
                 把它们都写成「满刻度」会让用户看到「峰值 112% / 满刻度 1%」这种自相矛盾的行。 -->
            <span>${isSlopeScale ? '标定斜率（每像素）:' : '满刻度（末齿读数）:'}</span>
            <code>${scale ? `${formatScaleValue(scale.val1)}${scale.unit}${isSlopeScale ? '/px' : ''}` : '—'}</code>
          </div>
          <div class="meta-item">
            <span>锚点总数:</span>
            <span>${totalCount} 点</span>
          </div>
        </div>
        ${isActive ? activeDetailHtml : ''}
      </div>
    `;
  }

  private bindEvents(): void {
    // 0. 折叠侧边栏
    this.element.querySelector('#btn-collapse-sidebar')?.addEventListener('click', () => {
      this.callbacks.onToggleCollapse?.(true);
    });

    // 在当前列后添加空白列；无列状态下入口不渲染。
    this.element.querySelector('#btn-insert-gap-col')?.addEventListener('click', () => {
      if (this.data.columns.length === 0) return;
      this.callbacks.onInsertGapColumn?.(this.data.activeTaxaId);
    });

    // 快捷批量多选切换：已选时清空，未选时全选
    this.element.querySelector('#btn-toggle-batch-select')?.addEventListener('click', () => {
      if (this.selectedColumnIds.size > 0) {
        this.selectedColumnIds.clear();
      } else {
        this.visibleColumns().forEach((c) => this.selectedColumnIds.add(c.id));
      }
      this.renderPreservingInlineEdit();
    });

    // 批量操作工具栏事件绑定 (#126)
    this.element.querySelector('#btn-batch-select-all')?.addEventListener('click', () => {
      this.visibleColumns().forEach((c) => this.selectedColumnIds.add(c.id));
      this.renderPreservingInlineEdit();
    });

    this.element.querySelector('#btn-batch-clear-selection')?.addEventListener('click', () => {
      this.selectedColumnIds.clear();
      this.renderPreservingInlineEdit();
    });

    this.element.querySelectorAll('.btn-batch-plottype').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-type') as 'area' | 'bar' | 'line' | 'symbol';
        if (type && this.selectedColumnIds.size > 0) {
          this.callbacks.onBatchChangePlotType?.(Array.from(this.selectedColumnIds), type);
        }
      });
    });

    this.element.querySelector('#btn-batch-redigitize, #btn-batch-digitize')?.addEventListener('click', () => {
      if (this.selectedColumnIds.size > 0) {
        const ids = Array.from(this.selectedColumnIds);
        (this.callbacks.onBatchRedigitizeColumns || this.callbacks.onBatchDigitizeColumns)?.(ids);
      }
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

    // 列勾选多选事件绑定与行内即时改名事件绑定
    list.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target && target.classList.contains('taxa-select-checkbox')) {
        const colId = target.getAttribute('data-col-id');
        if (colId) {
          if (target.checked) {
            this.selectedColumnIds.add(colId);
            this.lastClickedColId = colId;
          } else {
            this.selectedColumnIds.delete(colId);
          }
          this.renderPreservingInlineEdit();
        }
        return;
      }
      if (target && target.getAttribute('data-action') === 'inline-rename') {
        const card = target.closest('.taxa-card') as HTMLElement;
        const taxaId = card?.getAttribute('data-taxa-id');
        const col = this.data.columns.find((c) => c.id === taxaId);
        const newName = target.value.trim();
        if (col && newName && newName !== col.name) {
          // Check for duplicate in same ROI
          const duplicate = this.data.columns.some((c) => c.id !== col.id && c.roi_id === col.roi_id && c.name === newName);
          if (duplicate) {
            notifyError(`列名 '${newName}' 在当前有效区已存在；同一有效区内的列名必须唯一，未改名。`);
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

      // 重新取数/重新识别按钮
      if (target.closest('.sidebar-btn-redigitize, .sidebar-btn-digitize, #btn-col-digitize')) {
        e.stopPropagation();
        (this.callbacks.onRedigitizeColumn || this.callbacks.onDigitizeColumn)?.(taxaId);
        return;
      }

      // 提取峰谷按钮
      if (target.closest('.sidebar-btn-turning-points, #btn-extract-turning-points')) {
        e.stopPropagation();
        this.callbacks.onExtractTurningPoints?.(taxaId);
        return;
      }

      // 删除列按钮（3秒二次确认上膛机制）
      const delBtn = target.closest('.sidebar-btn-delete-col, #btn-col-delete') as HTMLButtonElement | null;
      if (delBtn) {
        e.stopPropagation();
        const now = Date.now();
        if (now - this.delArmedAt > 3000 || this.delArmedColId !== taxaId) {
          this.delArmedAt = now;
          this.delArmedColId = taxaId;
          delBtn.textContent = '再点一次确认';
          delBtn.dataset.armed = '1';
          window.setTimeout(() => {
            if (this.delArmedColId === taxaId && delBtn.dataset.armed === '1') {
              this.delArmedAt = 0;
              this.delArmedColId = '';
              delBtn.textContent = '删除列';
              delete delBtn.dataset.armed;
            }
          }, 3000);
          return;
        }

        this.delArmedAt = 0;
        this.delArmedColId = '';
        this.callbacks.onDeleteColumn?.(taxaId);
        return;
      }

      // 复选框点击时阻止向上冒泡触发卡片单选（change 事件处理多选）
      if (target.closest('.taxa-select-checkbox')) {
        e.stopPropagation();
        return;
      }

      // 切换显隐按钮
      if (target.closest('[data-action="toggle-visible"]')) {
        e.stopPropagation();
        this.callbacks.onToggleVisible(taxaId);
        return;
      }

      const me = e as MouseEvent;
      const isCtrl = me.ctrlKey || me.metaKey;
      const isShift = me.shiftKey;

      // Ctrl + 点击：切换加入/移出多选集合
      if (isCtrl) {
        e.stopPropagation();
        if (this.selectedColumnIds.has(taxaId)) {
          this.selectedColumnIds.delete(taxaId);
        } else {
          this.selectedColumnIds.add(taxaId);
          this.lastClickedColId = taxaId;
        }
        this.renderPreservingInlineEdit();
        return;
      }

      // Shift + 点击：区间连续多选
      if (isShift && this.lastClickedColId) {
        e.stopPropagation();
        const cols = this.visibleColumns();
        const idx1 = cols.findIndex((c) => c.id === this.lastClickedColId);
        const idx2 = cols.findIndex((c) => c.id === taxaId);
        if (idx1 !== -1 && idx2 !== -1) {
          const start = Math.min(idx1, idx2);
          const end = Math.max(idx1, idx2);
          for (let i = start; i <= end; i++) {
            this.selectedColumnIds.add(cols[i].id);
          }
          this.renderPreservingInlineEdit();
          return;
        }
      }

      // 普通单击卡片：记录锚点，若处于无多选状态则同步选中态
      this.lastClickedColId = taxaId;
      if (this.selectedColumnIds.size <= 1) {
        this.selectedColumnIds.clear();
        this.selectedColumnIds.add(taxaId);
      }
      this.callbacks.onSelectTaxa(taxaId);
    });
  }
}
