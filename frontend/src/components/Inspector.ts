import { DataRoi, DiagramData, TaxaColumn, ControlPoint, DiagramCalibration } from '../types/pollen';
import { HistoryManager } from '../core/HistoryManager';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { calUnitLabel } from '../core/calUnit';
import { DeletePointCommand } from '../core/Commands';
import { getStepPanel } from './steps/_registry';
import { t, onLocaleChange } from '../i18n';
import { RpcClient } from '../services/RpcClient';

export interface InspectorCallbacks {
  onDataChange: () => void;
  onSelectTaxa: (taxaId: string, options?: { skipScroll?: boolean }) => void;
  onToggleCollapse: (collapsed: boolean) => void;
  onDigitizeActiveColumn: () => Promise<void>;
  onAdvanceWorkflowStage?: (targetStage: number) => void;
  onFocusWorldPoint?: (worldPt: { x: number; y: number }, targetScale?: number) => void;
  onFitToScreen?: () => void;
  onOpenDataViewer?: () => void;
  /** 打开 OCR 复核模态；由步骤 5 面板的【自动识别属种名】按钮调用。 */
  onOpenOcrReviewModal?: () => void;
  /** 步骤 6：两点式 X 轴（列标度）标定；像素取自列几何，用户只填两个读数（原始字符串）。 */
  onCalibrateXTicks?: (
    colIndex: number,
    val1Raw: string,
    val2Raw: string,
    measuredEndPx?: number | null
  ) => void;
  /** 步骤 6：清空该列的 X 标度，回到「未标定」。 */
  onClearXTicks?: (colIndex: number) => void;
  /** 步骤 6：清空全部列的 X 标度。 */
  onClearAllXTicks?: () => Promise<void>;
  /** 步骤 4：清空并重新自动分列。 */
  onRedetectColumns?: () => Promise<void>;
  onClearAllColumns?: () => Promise<void>;
  /** 步骤 3：清空 Y 轴两点标定。 */
  onClearYCalibration?: () => void;
  onToggleLayerVisibility?: (layer: string, visible: boolean) => void;
  /** 进入线掩膜人工修正笔刷（erase=擦掉误标 / restore=补回漏标）。 */
  onStartLineFix?: (mode: 'erase' | 'restore') => void;
  /** 清空全部人工修正笔迹并重新合成清理掩膜。 */
  onClearLineFix?: () => void;
  onConfirmAllCandidates?: () => Promise<void>;
  onRevertAllCandidates?: () => Promise<void>;
  onRedigitizeAllColumns?: (resetManual?: boolean) => Promise<void>;
  /** 启动 Y 轴两点标定（由画布收点，再弹窗收真实值）。 */
  onStartYCalibration?: () => void;
  /** 手动输入两点数值重新标定（兜底：不使用画布点选）。 */
  onSubmitYCalibration?: (top_px: number, topValue: number, bottom_px: number, bottomValue: number, unit: string, primaryAxis?: string) => void;
  /** 实时预览侧栏输入的 Y1 / Y2 像素位置。 */
  onPreviewYCalibrationPx?: (topPx: number | null, bottomPx: number | null) => void;
  /** ROI 输入框提交，需要同步后端并重算线掩膜。 */
  onRoiCommitted?: (roi: DataRoi) => void;
  onSelectRoi?: (roiId: string) => void;
  onCreateRoi?: () => void;
  onSetPrimaryRoi?: (roiId: string) => void;
  onDeleteRoi?: (roiId: string) => void;
  onRenameActiveRoi?: (name: string) => void;
  onUpdateRoiComposition?: (composition: boolean) => void;
  /**
   * 步骤 4：检测候选干扰线。`options` 决定**这一次**生成哪几类候选
   * （横线 = Kind A；竖线 = Kind B/C）。缺省两项都按 `true` 处理，与引入
   * 开关之前的行为一致。
   */
  onDetectLineCandidates?: (options?: {
    includeHorizontal?: boolean;
    includeVertical?: boolean;
  }) => void;
  onAddExclusionRect?: () => void;
  onToggleCandidateSelection?: (candId: string, selected: boolean) => void;
  onAddLineGeometry?: (axis: 'h' | 'v') => void;
  onEditLineGeometry?: (candidateId: string) => void;
  /** Step 4：画布拖拽/缩放 geometry 结束（新建时 id 为 null）。 */
  onGeometryCommit?: (
    id: string | null,
    axis: 'h' | 'v',
    rect: { x0: number; y0: number; x1: number; y1: number }
  ) => void;
  /** Step 4：画布上 Delete 删除选中的 geometry。 */
  onGeometryDelete?: (id: string) => void;
  /** Step 4：清空本步全部几何、排除区与笔迹。 */
  onClearCleanupEdits?: () => void;
  /** 统一厚度：`candidateId` 省略 = 该 ROI 内全部几何（步骤 4 侧栏）。 */
  onSetLineThickness?: (thickness: number, candidateId?: string) => void;
  onExtractConsensusHorizons?: () => void;
  onClearHorizons?: () => void;
  /**
   * 步骤面板直连后端的通道。面板不再各自裸写 fetch —— 共享客户端负责
   * 检查 HTTP 状态、解析 JSON-RPC 信封，并在 `200 + body.error` 时抛错，
   * 从而被 e2e 的全局错误门禁覆盖。
   */
  rpcClient?: RpcClient;
}

export class Inspector {
  private element: HTMLElement;
  private data: DiagramData;
  private history: HistoryManager;
  private callbacks: InspectorCallbacks;
  private isCollapsed: boolean = false;
  private currentStage: number = 1;

  constructor(data: DiagramData, history: HistoryManager, callbacks: InspectorCallbacks) {
    this.data = data;
    this.history = history;
    this.callbacks = callbacks;
    this.element = document.createElement('aside');
    this.element.className = 'app-inspector';
    this.render();

    onLocaleChange(() => {
      this.render();
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

  public setWorkflowStage(stage: number): void {
    this.currentStage = stage;
    this.render();
  }

  public toggleCollapse(): boolean {
    this.setCollapsed(!this.isCollapsed);
    this.callbacks.onToggleCollapse(this.isCollapsed);
    return this.isCollapsed;
  }

  public updateData(data: DiagramData): void {
    this.data = data;
    this.render();
  }

  /**
   * 重渲染时把「正在编辑的现场」搬到新节点上。
   *
   * `render()` 是整段重写 `innerHTML`，而 `updateData()` 在任何数据变化时都会被调到——
   * 记下 id / 值 / 选区，重建后回填并恢复焦点与光标。
   */
  private captureEditSnapshot(): {
    id: string;
    value: string;
    start: number | null;
    end: number | null;
  } | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLInputElement) && !(active instanceof HTMLTextAreaElement)) {
      return null;
    }
    if (!active.id || !this.element.contains(active)) return null;
    // **只恢复显式声明的输入**（`data-edit-preserve`）。
    if (active.getAttribute('data-edit-preserve') !== '1') return null;
    return {
      id: active.id,
      value: active.value,
      start: active.selectionStart,
      end: active.selectionEnd,
    };
  }

  private restoreEditSnapshot(
    snapshot: { id: string; value: string; start: number | null; end: number | null } | null
  ): void {
    if (!snapshot) return;
    const again = this.element.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `#${CSS.escape(snapshot.id)}`
    );
    if (!again) return;
    again.value = snapshot.value;
    again.focus();
    if (snapshot.start !== null && snapshot.end !== null) {
      again.setSelectionRange(snapshot.start, snapshot.end);
    }
  }

  public render(): void {
    const bodyEl = this.element.querySelector<HTMLElement>('.inspector-body');
    const prevScrollTop = bodyEl ? bodyEl.scrollTop : 0;
    const editSnapshot = this.captureEditSnapshot();

    const selected = this.data.selectedEntity;
    const cal = this.data.calibration;

    let contentHtml = this.renderStagePanel(cal);

    // 若用户显式选定了某个控制点，通过底部微型 HUD 展现，不覆盖当前步骤的工作流面板
    if (selected?.type === 'point') {
      const col = this.data.columns.find((c) => c.id === selected.colId);
      const pt = col?.controlPoints.find((p) => p.id === selected.pointId);
      if (col && pt) {
        contentHtml += this.renderPointMiniHud(col, pt);
      }
    }

    const registered = getStepPanel(this.currentStage);
    const panelTitle = registered?.title || t('inspector.title');

    this.element.innerHTML = `
      <div class="inspector-header">
        <div class="inspector-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/>
          </svg>
          <span>${panelTitle}</span>
        </div>
        <button id="btn-collapse-inspector" class="icon-btn panel-toggle" title="${t('inspector.collapseTitle')}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      <div class="inspector-body">
        ${contentHtml}
      </div>
    `;

    this.bindEvents();
    // 步骤面板的主动作必须落在滚动容器**之外**（见 hoistStepPrimaryAction）。
    // 必须在 bindEvents 之后搬：面板的点击接线是在 mount 里按 root.querySelector 挂的。
    this.hoistStepPrimaryAction();

    const newBodyEl = this.element.querySelector<HTMLElement>('.inspector-body');
    if (newBodyEl && prevScrollTop > 0) {
      newBodyEl.scrollTop = prevScrollTop;
    }

    this.restoreEditSnapshot(editSnapshot);
  }

  /**
   * 把当前步骤面板的主动作（`data-role="step-primary-action"`）从 `.inspector-body`
   * 提到滚动容器之外。
   */
  private hoistStepPrimaryAction(): void {
    const bodyEl = this.element.querySelector<HTMLElement>('.inspector-body');
    const action = bodyEl?.querySelector<HTMLElement>('[data-role="step-primary-action"]');
    if (!bodyEl || !action) return;
    let footer = this.element.querySelector<HTMLElement>('.inspector-footer');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'inspector-footer';
      this.element.appendChild(footer);
    }
    footer.appendChild(action);
    const secondaryAction = bodyEl.querySelector<HTMLElement>('[data-role="step-secondary-action"]');
    if (secondaryAction) {
      footer.appendChild(secondaryAction);
    }
  }

  private renderStagePanel(cal: DiagramCalibration): string {
    // 统一从 Step Registry 动态路由挂载 8 步工作流面板
    const registered = getStepPanel(this.currentStage);
    if (registered) {
      return registered.render(this.data);
    }
    return this.renderProjectOverview(cal);
  }

  private renderProjectOverview(cal: DiagramCalibration): string {
    const numCols = this.data.columns.length;
    const bounds = CoordinateSystem.calibrationBounds(cal);
    const interval = cal.depthInterval || 2;
    // 未标定时不报"层位数"：那会凭空给出一个并不存在的采样层数。
    const numHorizons = bounds
      ? Math.round(Math.abs(bounds.bottomValue - bounds.topValue) / interval) + 1
      : null;

    return `
      <div class="inspector-section">
        <div class="section-title">地质剖面与取数区概览</div>
        <div class="property-grid">
          <div class="prop-row">
            <span class="prop-label">底图分辨率:</span>
            <span class="prop-val">${this.data.imageWidth} × ${this.data.imageHeight} px</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">属种列总数:</span>
            <span class="prop-val"><strong style="color: var(--accent-blue);">${numCols}</strong> 列</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">取数区 (ROI):</span>
            <span class="prop-val">X ${Math.round(this.data.roi.xMin)}~${Math.round(this.data.roi.xMax)} × Y ${Math.round(this.data.roi.yMin)}~${Math.round(this.data.roi.yMax)} px</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">深度跨度:</span>
            <span class="prop-val">${bounds ? `${bounds.topValue} ~ ${bounds.bottomValue} ${calUnitLabel(cal)}` : '<span style="color:var(--status-warning);">未标定（步骤 3 两点标定）</span>'}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">标准层位采样点:</span>
            <span class="prop-val">${numHorizons !== null ? `${numHorizons} 层 (Δ=${interval} ${calUnitLabel(cal)})` : '--'}</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderPointMiniHud(col: TaxaColumn, pt: ControlPoint): string {
    const depth = CoordinateSystem.imageYToDepth(pt.y, this.data.calibration);
    const percent = CoordinateSystem.hasRealCalibration(col)
      ? CoordinateSystem.imageXToValue(pt.x, col)
      : undefined;

    const typeLabels: Record<string, { text: string; color: string }> = {
      peak: { text: '波峰', color: '#fbbf24' },
      trough: { text: '波谷', color: '#f59e0b' },
      manual: { text: '手工点', color: '#38bdf8' },
      transition: { text: '过渡点', color: '#94a3b8' },
    };
    const typeInfo = typeLabels[pt.type || 'transition'] || typeLabels.transition;

    return `
      <div class="selected-point-mini-hud" style="margin-top: 10px; padding: 6px 8px; background: color-mix(in srgb, var(--bg-tertiary) 80%, black 20%); border: 1px solid var(--accent-blue); border-radius: 4px; font-size: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 4px; font-weight: 700;">
            <span style="color: ${col.color};">${col.name}</span>
            <span style="font-size: 8.5px; padding: 1px 3px; border-radius: 2px; background: ${typeInfo.color}22; color: ${typeInfo.color}; border: 1px solid ${typeInfo.color}44;">${typeInfo.text}</span>
          </div>
          <button id="btn-delete-point" class="ui-btn ui-btn--quiet ui-btn--xs" style="color: var(--accent-red); padding: 1px 4px; font-size: 9px;" title="删除此控制锚点 (Delete)">删除点</button>
        </div>
        <div style="display: flex; gap: 8px; color: var(--text-secondary); font-size: 9.5px; font-family: var(--font-mono);">
          <span>深度: ${depth !== undefined ? depth.toFixed(2) : '--'} ${calUnitLabel(this.data.calibration)}</span>
          <span>丰度: ${percent !== undefined ? percent.toFixed(2) + '%' : '--'}</span>
          <span>(X:${Math.round(pt.x)}, Y:${Math.round(pt.y)})</span>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    this.element.querySelector('#btn-collapse-inspector')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // 删除点
    this.element.querySelector('#btn-delete-point')?.addEventListener('click', () => {
      const sel = this.data.selectedEntity;
      if (sel?.type === 'point') {
        const col = this.data.columns.find((c) => c.id === sel.colId);
        const pt = col?.controlPoints.find((p) => p.id === sel.pointId);
        if (col && pt) {
          new DeletePointCommand(col.id, pt, col.name).execute(this.data);
          this.data.selectedEntity = null;
          this.history.push(`Delete Anchor from ${col.name}`, this.data.columns, this.data.activeTaxaId);
          this.render();
          this.callbacks.onDataChange();
        }
      }
    });

    // 挂载当前步骤 Panel 的事件监听 (Step Registry)
    const registered = getStepPanel(this.currentStage);
    if (registered) {
      registered.mount(this.element, {
        ...this.callbacks,
        onDataChange: this.callbacks.onDataChange,
        onAdvanceWorkflowStage: this.callbacks.onAdvanceWorkflowStage,
      });
    }
  }

}
