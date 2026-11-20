import { DataRoi, DiagramData, TaxaColumn, ControlPoint, DiagramCalibration } from '../types/pollen';
import { STAGE } from '../core/WorkflowStage';
import { HistoryManager } from '../core/HistoryManager';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { calUnitLabel } from '../core/calUnit';
import { DeletePointCommand } from '../core/Commands';
import { getStepPanel } from './steps/_registry';
import { renderActiveColumnSuspectNotice } from './steps/SuspectBlockNotice';
import {
  columnExagNotice,
  isColumnExagDisabled,
  isGroupExaggerated,
  normalizeGroupExaggeration,
} from './steps/exaggerationGroupInput';
import { t, onLocaleChange, type MessageKey } from '../i18n';
import { RpcClient } from '../services/RpcClient';
import { notify, notifyCaught, notifyError } from '../ui/feedback';

/**
 * `exaggerationGroupInput` 的纯函数只认 `(key: string, params?) => string`，
 * i18n 的键是强类型 `MessageKey`；这个适配器是两者之间唯一的一次转换。
 */
const translate = (key: string, params?: Record<string, string | number>): string =>
  t(key as MessageKey, params);

export interface InspectorCallbacks {
  onDataChange: () => void;
  onSelectTaxa: (taxaId: string) => void;
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
  onToggleLayerVisibility?: (layer: string, visible: boolean) => void;
  /** 进入线掩膜人工修正笔刷（erase=擦掉误标 / restore=补回漏标）。 */
  onStartLineFix?: (mode: 'erase' | 'restore') => void;
  /** 清空全部人工修正笔迹并重新合成清理掩膜。 */
  onClearLineFix?: () => void;
  /** 启动 Y 轴两点标定（由画布收点，再弹窗收真实值）。 */
  onStartYCalibration?: () => void;
  /** 手动输入两点数值重新标定（兜底：不使用画布点选）。 */
  onSubmitYCalibration?: (top_px: number, topValue: number, bottom_px: number, bottomValue: number, unit: string, primaryAxis?: 'depth' | 'age') => void;
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
  private currentStage: number = 3;

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
   * 于是用户点进属种名/倍数输入框后，一次后台数据刷新就会把那个 `<input>` 销毁：
   * 焦点掉回 `<body>`（一个字打不进去），已敲入但未 `change` 的内容一起消失。
   * 侧栏当年踩过同一个坑（`Sidebar.renderPreservingInlineEdit`），这里是同一套做法：
   * 记下 id / 值 / 选区，重建后回填并恢复焦点与光标。
   *
   * 已知边界：IME 组合输入进行中被重建，组合串仍会丢（e2e 难稳定触发）；`<select>` 的
   * 展开状态无法恢复（值由数据推导，无损）。
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
    // 不能对所有输入做：面板里有些控件的聚焦本身会触发业务动作
    // （`#inp-roi-name` 的聚焦走 `onRenameActiveRoi`），恢复焦点等于替用户重新触发一次，
    // 实测会让「取消组分勾选」整条 case 60s 超时（step2-roi，2026-11-06）。
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
    // Inspector 没有自己的 focusin 监听（侧栏有，所以那边才需要再入标志），直接恢复即可。
    // 若日后给本组件加 focusin 回调，必须在回调里跳过"正在回填"的情形，否则会自激重渲染。
    again.focus();
    if (snapshot.start !== null && snapshot.end !== null) {
      again.setSelectionRange(snapshot.start, snapshot.end);
    }
  }
  public render(): void {
    const bodyEl = this.element.querySelector<HTMLElement>('.inspector-body');
    const prevScrollTop = bodyEl ? bodyEl.scrollTop : 0;
    const editSnapshot = this.captureEditSnapshot();

    const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
    const selected = this.data.selectedEntity;
    const cal = this.data.calibration;

    let contentHtml = '';

    // 若用户显式点击了某个控制点
    if (selected?.type === 'point') {
      const col = this.data.columns.find((c) => c.id === selected.colId);
      const pt = col?.controlPoints.find((p) => p.id === selected.pointId);
      if (col && pt) {
        contentHtml = this.renderPointInspector(col, pt);
      } else {
        contentHtml = this.renderStagePanel(activeCol, cal);
      }
    } else if (selected?.type === 'column' && activeCol && (this.currentStage === STAGE.SPLIT || this.currentStage === STAGE.SPEARS_AND_SAMPLES)) {
      contentHtml = this.renderColumnInspector(activeCol);
    } else {
      contentHtml = this.renderStagePanel(activeCol, cal);
    }

    this.element.innerHTML = `
      <div class="inspector-header">
        <div class="inspector-title">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18M9 21V9"/>
          </svg>
          <span>${t('inspector.title')}</span>
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
   *
   * 为什么必须提出来：`.inspector-body` 是唯一滚动容器，面板内容比它高时，贴在滚动区
   * 里的 `position: sticky` 按钮会**盖住**下方的内容。实测 1280×720 下它与分组按钮的
   * 矩形相交——用户既看不见那排按钮，也点不着，还以为功能没了。放到 `.inspector-footer`
   * 后：滚动只发生在 body 内，主动作恒定可见且与任何控件不相交。
   *
   * 面板侧只声明「这是主动作」，布局约束由 Inspector 统一承担，所有步骤共用一条规则。
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
  }

  private renderStagePanel(activeCol: TaxaColumn | undefined, cal: DiagramCalibration): string {
    // 统一从 Step Registry 动态路由挂载 8 步工作流面板
    const registered = getStepPanel(this.currentStage);
    if (registered) {
      return registered.render(this.data);
    }
    return activeCol ? this.renderColumnInspector(activeCol) : this.renderProjectOverview(cal);
  }

  /**
   * S4：Y 轴两点标定。
   *
   * 标定与 ROI 完全无关：用户在图上的 Y 轴点两个已知刻度的位置，填入其真实值，
   * 像素↔数值的线性映射由此确定。这里只呈现状态与入口，收点在画布上完成。
   */
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

  /**
   * 该列所属**组**的放大倍数（>1 才算，否则 null）。
   *
   * 组是真源：后端的解析顺序是「组级 > 列级 > 历史键」。载入时后端还会把老工程包里
   * 写在列上的倍率搬到组上（`project._migrate_column_exaggeration_to_group`），
   * 所以这里只认组即可，不用再兜列级。
   */
  private columnGroupExaggeration(col: TaxaColumn): number | null {
    const groupId = col.x_group_id;
    if (!groupId) return null;
    for (const roi of this.data.rois ?? []) {
      for (const group of roi.x_groups ?? []) {
        if (group.id === groupId) {
          return isGroupExaggerated(group.exaggeration_mult)
            ? normalizeGroupExaggeration(group.exaggeration_mult)
            : null;
        }
      }
    }
    return null;
  }

  private renderColumnInspector(col: TaxaColumn): string {
    const resolved = CoordinateSystem.resolveColumnScale(col);
    // 面板预填：已标定才填真实端点；未标定时端点为**空**，由用户填或不填。
    // 历史上这里回落到 tickEndX（分列期猜测），于是"点一下快捷刻度齿"就把
    // 猜测像素当用户读数写进后端——本仓库最后一条这样的路径。
    const sc = {
      originX: resolved.px0,
      originVal: resolved.calibrated ? resolved.val0 : '',
      calibX: resolved.calibrated ? resolved.px1 : '',
      calibVal: resolved.calibrated ? resolved.val1 : '',
      unit: resolved.unit,
    };

    const currentPlotType = resolved.plotType;
    // 只有一个值：`exaggeration_mult`（null = 未放大）。曾用 `?? col.exaggerationMult ?? 5`
    // 兜底，于是「没设放大」在界面上显示成 5×，勾一下就写进库——而 px_to_value
    // 会真的除以它，整列读数因此缩小 5 倍。
    const exagMult = resolved.exaggerationMult;
    const hasExag = exagMult !== null;
    const exagInputValue = exagMult === null ? '' : String(exagMult);

    // 组级倍率 >1 时组是真相源（后端 `_resolve_exaggeration`：组级 > 列级 > 历史键）。
    // 列级这份保留存档但不生效，所以**置灰 + 说明**：留着可点会让人以为改了列级就能
    // 覆盖组，而实际整列读数仍按组倍率除。
    const groupExagMult = this.columnGroupExaggeration(col);
    const exagLockedByGroup = isColumnExagDisabled(groupExagMult);
    const exagDisabledAttr = exagLockedByGroup ? 'disabled' : '';

    return `
      <div class="inspector-section">
        <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>属种列属性: ${col.name.toUpperCase()}</span>
          <div style="display:flex; gap: 4px; align-items:center;">
            <span class="badge" style="background:${col.color}22; color:${col.color}; border:1px solid ${col.color}66;">${currentPlotType}</span>
            <button id="btn-back-to-step" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 9.5px; padding: 1px 5px; color: var(--text-muted);" title="返回步骤面板">✕</button>
          </div>
        </div>

        <!-- 该列被后端标记为「色块/填充带而非曲线」时，在用户能直接删列的这个面板里说清楚
             （P1 suspect_block）。用户点选某一列时走的正是本面板，而【删除列】按钮也在这里，
             所以提示必须落在这里才能指向真实可达的控件——放进步骤面板（XTicksPanel）时
             用户根本看不到，那等于没提示。 -->
        ${renderActiveColumnSuspectNotice(col)}

        <div class="form-group">
          <label>属种名称 (Taxa Name):</label>
          <input type="text" id="inp-col-name" value="${col.name}" class="text-input" data-edit-preserve="1" />
        </div>

        <!-- 几何只读展示：标定/形态/尺度都是**组级**属性（见步骤 6 面板），
             本面板不再重复提供输入框 —— 之前同一组读数在两处各有一个输入框，
             改一处另一处不知道，属于会写错数据的设计缺陷。 -->
        <div class="form-group" style="padding: 6px 8px; background: var(--bg-tertiary); border-radius: 6px;">
          <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 3px;">几何（只读）：标定在步骤 6 的组参数里改</div>
          <div style="font-size: 10.5px; line-height: 1.5; color: var(--text-secondary);">
            左缘 ${col.startX.toFixed(0)}px → 0 点 ${sc.originX.toFixed(0)}px
            ${sc.calibX === '' ? '　|　未标定' : `　|　组斜率 ${Number(sc.calibVal).toFixed(3)} ${sc.unit}/px`}
          </div>
        </div>

        <!-- 局部放大曲线设置 (Exaggeration: 由用户负责填写图中标注的放大倍数) -->
        <div class="form-group" style="margin-top: 8px; padding: 6px 8px; background: rgba(148,163,184,0.06); border-radius: 4px; border: 1px dashed rgba(148,163,184,0.25);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px; display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
              <input type="checkbox" id="chk-has-exag" ${hasExag ? 'checked' : ''} ${exagDisabledAttr} style="cursor: pointer;" />
              <span style="font-weight: 500;">局部放大曲线 (Exaggeration)</span>
            </label>
            <span style="font-size: 10px; color: var(--accent-violet); font-weight: 600;">${hasExag ? `${exagMult}× 启用` : '未启用'}</span>
          </div>
          <!-- 输入框常显：先有数字才谈得上启用。空值时勾选框不写库，只提示。 -->
          <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 10px; color: var(--text-secondary);">放大倍数:</span>
            <input type="number" id="inp-exag-mult" value="${exagInputValue}" min="1" max="100" placeholder="必填" data-edit-preserve="1" ${exagDisabledAttr} style="width: 50px; font-size: 11px; padding: 2px 4px;" />
            <div class="btn-group" style="display: flex; gap: 2px; flex: 1;">
              <button class="ui-btn ui-btn--quiet ui-btn--xs quick-exag-btn" data-exag="3" ${exagDisabledAttr} style="flex: 1; font-size: 9px; padding: 2px;">3×</button>
              <button class="ui-btn ui-btn--quiet ui-btn--xs quick-exag-btn" data-exag="5" ${exagDisabledAttr} style="flex: 1; font-size: 9px; padding: 2px;">5×</button>
              <button class="ui-btn ui-btn--quiet ui-btn--xs quick-exag-btn" data-exag="10" ${exagDisabledAttr} style="flex: 1; font-size: 9px; padding: 2px;">10×</button>
            </div>
          </div>
          <!-- 组倍率 >1 时列级输入不生效：说明原因并指向真正的入口（步骤 6 的组参数）。 -->
          ${exagLockedByGroup ? `
          <div data-role="exag-group-override-notice" style="margin-top: 5px; font-size: 10px; line-height: 1.45; color: var(--status-warning);">
            ${columnExagNotice(groupExagMult, translate)}
            <div style="color: var(--text-muted);">改倍率请到步骤 6 →「列组」→ 本组参数的「${t('step6.groupExagLabel')}」。</div>
          </div>` : ''}
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button id="btn-col-digitize" class="ui-btn ui-btn--quiet ui-btn--xs" style="flex: 1; font-size: 11px; padding: 6px; color: var(--accent-blue); border-color: rgba(2,132,199,0.3); background: rgba(2,132,199,0.06);">
            重新识别此列
          </button>
          <!-- 自动峰谷：后端算法早已实现（保留手工点），此前没有任何入口 —— 属于
               有能力没入口，而不是死代码。入口放在这里，因为它改的正是"这一列的控制点"。 -->
          <button id="btn-extract-turning-points" class="ui-btn ui-btn--quiet ui-btn--xs" style="flex: 1; font-size: 11px; padding: 6px; color: var(--accent-violet); border-color: rgba(139,92,246,0.3); background: rgba(139,92,246,0.06);" title="按几何曲线自动提取峰/谷控制点（已手工加的点会保留）">
            自动提取峰谷
          </button>
          <button id="btn-col-delete" class="ui-btn ui-btn--quiet ui-btn--xs" style="color: var(--accent-red); border-color: rgba(220,38,38,0.3); background: rgba(220,38,38,0.04); font-size: 11px; padding: 6px;">
            删除列
          </button>
        </div>
      </div>
    `;
  }

  private renderPointInspector(col: TaxaColumn, pt: ControlPoint): string {
    const depth = CoordinateSystem.imageYToDepth(pt.y, this.data.calibration);
    // 未标定列不给数：模板里 percent === undefined 显示 '--'（与深度缺标定同一通道）。
    const percent = CoordinateSystem.hasRealCalibration(col)
      ? CoordinateSystem.imageXToPercent(pt.x, col)
      : undefined;

    const typeLabels: Record<string, { text: string; color: string }> = {
      peak: { text: '物理极大值 (波峰)', color: '#fbbf24' },
      trough: { text: '物理极小值 (波谷/基线)', color: '#f59e0b' },
      manual: { text: '手工强控制锚点', color: '#38bdf8' },
      transition: { text: '长坡过渡折线点', color: '#94a3b8' },
    };

    const typeInfo = typeLabels[pt.type || 'transition'] || typeLabels.transition;

    return `
      <div class="inspector-section">
        <div class="section-title">选中的控制拐点</div>
        <div class="property-grid">
          <div class="prop-row">
            <span class="prop-label">所属属种:</span>
            <span class="prop-val"><strong style="color: ${col.color};">${col.name}</strong></span>
          </div>
          <div class="prop-row">
            <span class="prop-label">控制点类型:</span>
            <span class="prop-val" style="color: ${typeInfo.color}; font-weight: 600;">${typeInfo.text}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">地层深度:</span>
            <span class="prop-val">${depth !== undefined ? depth.toFixed(2) : '--'} ${calUnitLabel(this.data.calibration)}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">物理丰度:</span>
            <span class="prop-val">${percent !== undefined ? percent.toFixed(2) : '--'}%</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">像素坐标:</span>
            <span class="prop-val">X:${Math.round(pt.x)}, Y:${Math.round(pt.y)}</span>
          </div>
        </div>

        <button id="btn-delete-point" class="ui-btn ui-btn--secondary" style="width: 100%; margin-top: 12px; color: var(--accent-red); border-color: rgba(239,68,68,0.4);">
          删除此控制锚点
        </button>
      </div>
    `;
  }

  private bindEvents(): void {
    this.element.querySelector('#btn-collapse-inspector')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    this.element.querySelector('#btn-back-to-step')?.addEventListener('click', () => {
      this.data.selectedEntity = null;
      this.render();
    });

    const getColIdx = (col: TaxaColumn) => col.col_index ?? this.data.columns.indexOf(col);

    // 属种名称改名（同步后端 core.renameColumn，失败冒泡且不留幻影撤销项）
    const nameInp = this.element.querySelector('#inp-col-name') as HTMLInputElement;
    nameInp?.addEventListener('change', async () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      const nextName = nameInp.value.trim();
      if (!activeCol || !nextName) return;
      const old = activeCol.name;
      if (this.callbacks.rpcClient) {
        try {
          await this.callbacks.rpcClient.renameColumn(getColIdx(activeCol), nextName);
        } catch (err) {
          notifyError(err instanceof Error ? err.message : String(err));
          this.render();
          return;
        }
      }
      activeCol.name = nextName;
      activeCol.species = nextName;
      this.history.push(`Rename Taxa ${old} to ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
      this.callbacks.onDataChange();
    });



    this.element.querySelectorAll('.quick-scaletype-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sType = btn.getAttribute('data-scale') as 'linear' | 'log';
        const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
        if (activeCol && sType && activeCol.scale_type !== sType) {
          if (sType === 'log') {
            const check = CoordinateSystem.validateLogScale(activeCol);
            if (!check.valid) {
              notifyError(`无法切换到对数刻度：\n${check.reason}`);
              return;
            }
          }
          if (this.callbacks.rpcClient) {
            try {
              await this.callbacks.rpcClient.updateColumn(getColIdx(activeCol), { scale_type: sType });
            } catch (err) {
              notifyError(err instanceof Error ? err.message : String(err));
              return;
            }
          }
          activeCol.scale_type = sType;
          if (activeCol.controlPoints) {
            activeCol.controlPoints.forEach((p) => {
              const value = CoordinateSystem.imageXToValue(p.x, activeCol);
          // 未标定时 imageXToValue 返回 undefined：保留控制点原值，不写入 undefined
          // （写进去会让 updateColumn 载荷出现 undefined 字段，后端整条更新失败）。
          if (value !== undefined) p.value = value;
            });
          }
          this.history.push(
            `Switch ${activeCol.name} scale to ${sType}`,
            this.data.columns,
            this.data.activeTaxaId
          );
          this.render();
          this.callbacks.onDataChange();
        }
      });
    });

    this.element.querySelectorAll('.quick-plottype-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pType = btn.getAttribute('data-type') as 'area' | 'bar' | 'line' | 'symbol';
        const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
        if (activeCol && pType) {
          if (this.callbacks.rpcClient) {
            try {
              await this.callbacks.rpcClient.updateColumn(getColIdx(activeCol), { plot_type: pType });
            } catch (err) {
              notifyError(err instanceof Error ? err.message : String(err));
              return;
            }
          }
          activeCol.plot_type = pType;
          activeCol.plotType = pType;
          this.history.push(`Change ${activeCol.name} Plot Type to ${pType}`, this.data.columns, this.data.activeTaxaId);
          this.render();
          this.callbacks.onDataChange();
        }
      });
    });


    // 粘贴真实钻孔深度序列


    // 局部放大曲线：**一个值**，三个入口（勾选框 / 倍数输入 / 快捷按钮）。
    // 曾经的实现里勾选就写 `5`（`|| 5` 兜底），而 `px_to_value` 会真的除以它 ——
    // 等于用户只是点了一下勾，整列读数就缩小 5 倍。现在没有数字就不启用。
    const writeExaggeration = async (value: number | null): Promise<void> => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (!activeCol) return;
      // 组倍率 >1 时列级写进去也不生效（解析是组优先）。控件已置灰，这里是最后一道
      // 拦截：不给"点了没反应"留任何入口。
      const groupMult = this.columnGroupExaggeration(activeCol);
      if (isColumnExagDisabled(groupMult)) {
        notifyError(columnExagNotice(groupMult, translate));
        return;
      }
      if (this.callbacks.rpcClient) {
        try {
          await this.callbacks.rpcClient.updateColumn(getColIdx(activeCol), {
            exaggeration_mult: value,
          });
        } catch (err) {
          notifyError(err instanceof Error ? err.message : String(err));
          this.render();
          return;
        }
      }
      activeCol.exaggeration_mult = value;
      this.history.push(
        value === null
          ? `Clear Exaggeration for ${activeCol.name}`
          : `Set Exaggeration to ${value}x for ${activeCol.name}`,
        this.data.columns,
        this.data.activeTaxaId
      );
      this.render();
      this.callbacks.onDataChange();
    };

    this.element.querySelector('#chk-has-exag')?.addEventListener('change', async (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      if (!checked) {
        await writeExaggeration(null);
        return;
      }
      const typed = Number(
        (this.element.querySelector('#inp-exag-mult') as HTMLInputElement | null)?.value
      );
      if (!Number.isFinite(typed) || typed <= 1) {
        // 不重建 DOM：重建会把勾选弹回未选，用户的这次操作就白点了。
        // 界面保持"已勾选、待填倍数"，填完并有值时才真正写库。
        notifyError('请先填写放大倍数（>1）再启用：没有倍数的“放大”会把读数除错。');
        this.element.querySelector<HTMLInputElement>('#inp-exag-mult')?.focus();
        return;
      }
      await writeExaggeration(typed);
    });

    this.element.querySelector('#inp-exag-mult')?.addEventListener('change', async (e) => {
      const input = e.target as HTMLInputElement;
      const typed = Number(input.value);
      // 清空输入 = 取消放大；<=1 与非法值同样归为「未放大」，不写一个错的因子。
      if (input.value.trim() === '' || !Number.isFinite(typed) || typed <= 1) {
        await writeExaggeration(null);
        return;
      }
      await writeExaggeration(typed);
    });

    this.element.querySelectorAll('.quick-exag-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mult = Number(btn.getAttribute('data-exag'));
        if (Number.isFinite(mult) && mult > 1) await writeExaggeration(mult);
      });
    });

    // 删除列（同步后端 column.remove，并重编前端镜像的 col_index）
    // 破坏性操作要二次确认：第一次点击只"上膛"（按钮文案变），3 秒内再点才真删。
    // 不用 window.confirm：本应用没有原生对话框通道，且全局错误门禁会把原生弹窗
    // 当成"未预期的用户通知"，原生 confirm 反而与既有测试基建冲突。
    const delBtn = this.element.querySelector<HTMLButtonElement>('#btn-col-delete');
    let delArmedAt = 0;
    delBtn?.addEventListener('click', async () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (!activeCol || this.data.columns.length <= 1) return;

      const now = Date.now();
      if (now - delArmedAt > 3000) {
        delArmedAt = now;
        delBtn.textContent = '再点一次确认删除';
        delBtn.dataset.armed = '1';
        window.setTimeout(() => {
          delArmedAt = 0;
          if (delBtn.dataset.armed === '1') {
            delBtn.textContent = '删除列';
            delete delBtn.dataset.armed;
          }
        }, 3000);
        return;
      }

      delArmedAt = 0;
      if (this.callbacks.rpcClient) {
        try {
          await this.callbacks.rpcClient.removeColumn(getColIdx(activeCol));
        } catch (err) {
          notifyError(err instanceof Error ? err.message : String(err));
          return;
        }
      }
      const idx = this.data.columns.findIndex((c) => c.id === activeCol.id);
      if (idx !== -1) {
        this.data.columns.splice(idx, 1);
        this.data.columns.forEach((c, i) => {
          c.col_index = i;
        });
        this.data.activeTaxaId = this.data.columns[0]?.id || '';
        // 删除列**不可撤销**（后端没有恢复列的通道），所以不压任何历史。
        // 压旧 history 只会让撤销按钮亮起来、点下去却什么也回不来 ——
        // 那正是"可点但没反应"的形态，按设计不入栈（见 core/undoActions.ts 的 NON_UNDOABLE）。
        this.callbacks.onDataChange();
        this.callbacks.onSelectTaxa(this.data.activeTaxaId);
      }
    });

    // 重新识别此列
    this.element.querySelector('#btn-col-digitize')?.addEventListener('click', () => {
      this.callbacks.onDigitizeActiveColumn();
    });

    this.element.querySelector('#btn-extract-turning-points')?.addEventListener('click', async () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (!activeCol || !this.callbacks.rpcClient) return;
      const colIndex = activeCol.col_index ?? getColIdx(activeCol);
      try {
        const res = await this.callbacks.rpcClient.call<
          { col_index?: number },
          { success?: boolean; columns_updated?: number[]; message?: string }
        >('algorithm.extractTurningPoints', { col_index: colIndex });
        if (res?.success !== true) {
          throw new Error(res?.message || 'algorithm.extractTurningPoints 未返回 success=true');
        }
        const fresh = await this.callbacks.rpcClient.getDiagramData();
        const freshCol = fresh.columns?.find((c: any) => c.id === activeCol.id);
        if (freshCol && freshCol.controlPoints) {
          activeCol.controlPoints = freshCol.controlPoints;
        }
        const updated = res.columns_updated ?? [];
        // 结果必须让用户看见：控制点变多/变少都会改曲线形状，静默完成等于让用户猜。
        notify(`已自动提取峰谷：更新 ${updated.length} 列控制点（手工点保留）`);
        this.callbacks.onDataChange();
      } catch (err) {
        notifyCaught('自动提取峰谷失败', err);
      }
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

    // 应用有效区：只改 ROI。深度标定由 S4 的两点标定负责，绝不在这里顺带改写。

    // 图层显隐控制 (S6)



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
