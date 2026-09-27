import { DataRoi, DiagramData, TaxaColumn, ControlPoint, DiagramCalibration } from '../types/pollen';
import { HistoryManager } from '../core/HistoryManager';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { tokens } from '../styles/tokens';
import { DeletePointCommand, ResizeRoiCommand } from '../core/Commands';
import { getStepPanel } from './steps/_registry';
import { t, onLocaleChange } from '../i18n';

export interface InspectorCallbacks {
  onDataChange: () => void;
  onSelectTaxa: (taxaId: string) => void;
  onToggleCollapse: (collapsed: boolean) => void;
  onDigitizeActiveColumn: () => Promise<void>;
  onAdvanceWorkflowStage?: (targetStage: number) => void;
  onOpenDataViewer?: () => void;
  onToggleLayerVisibility?: (layer: string, visible: boolean) => void;
  onChangeDegridStrength?: (strength: 'off' | 'weak' | 'medium' | 'strong') => void;
  /** 切换「去竖线」开关：竖线（轴线/列基线）与横线分开控制。 */
  onToggleVerticalLineRemoval?: (enabled: boolean) => void;
  /** 进入线掩膜人工修正笔刷（erase=擦掉误标 / restore=补回漏标）。 */
  onStartLineFix?: (mode: 'erase' | 'restore') => void;
  /** 清空全部人工修正笔迹并重新下发自动掩膜。 */
  onClearLineFix?: () => void;
  /** 启动 Y 轴两点标定（由画布收点，再弹窗收真实值）。 */
  onStartYCalibration?: () => void;
  /** 手动输入两点数值重新标定（兜底：不使用画布点选）。 */
  onSubmitYCalibration?: (top_px: number, topValue: number, bottom_px: number, bottomValue: number, unit: string) => void;
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
  onDetectLineCandidates?: () => void;
  onAddExclusionRect?: () => void;
  onToggleCandidateSelection?: (candId: string, selected: boolean) => void;
  onDetectXTicks?: () => void;
  onExtractConsensusHorizons?: () => void;
  onClearHorizons?: () => void;
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

  public render(): void {
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
    } else if (selected?.type === 'column' && activeCol) {
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
            <span class="prop-val">${bounds ? `${bounds.topValue} ~ ${bounds.bottomValue} ${cal.unit}` : '<span style="color:#f59e0b;">未标定 (S4 两点标定)</span>'}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">标准层位采样点:</span>
            <span class="prop-val">${numHorizons !== null ? `${numHorizons} 层 (Δ=${interval}${cal.unit})` : '--'}</span>
          </div>
        </div>
      </div>
    `;
  }

  private renderColumnInspector(col: TaxaColumn): string {
    const sc = col.scaleCalib || {
      originX: col.startX,
      originVal: col.startValue ?? 0,
      calibX: (col.tickEndX && col.tickEndX > col.startX) ? col.tickEndX : col.endX,
      calibVal: col.maxPercent ?? 20,
      unit: col.unit || '%',
    };

    const currentScaleType = col.scale_type || 'linear';
    const logCheck = CoordinateSystem.validateLogScale(col);
    const isLogValid = logCheck.valid;

    return `
      <div class="inspector-section">
        <div class="section-title" style="display:flex; justify-content:space-between; align-items:center;">
          <span>属种列属性: ${col.name.toUpperCase()}</span>
          <span class="badge" style="background:${col.color}22; color:${col.color}; border:1px solid ${col.color}66;">${col.plotType || 'area'}</span>
        </div>

        <div class="form-group">
          <label>属种名称 (Taxa Name):</label>
          <input type="text" id="inp-col-name" value="${col.name}" class="text-input" />
        </div>

        <div class="form-group" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px; font-weight: bold; color: ${tokens.color.column.baseline};">📍 两点式 X 轴物理刻度标定</label>
            <span style="font-size: 9.5px; color: var(--text-muted);">斜率: ${CoordinateSystem.getScaleRatio(col).toFixed(3)} ${col.unit || '%'}/px</span>
          </div>

          <div style="display: flex; gap: 8px; margin-top: 6px;">
            <div style="flex: 1;">
              <label style="font-size: 10px; color: var(--text-muted);">端点 1 (原点像素 X):</label>
              <input type="number" id="inp-sc-origin-x" value="${sc.originX}" style="font-size: 11px;" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 10px; color: var(--text-muted);">端点 1 对应数值:</label>
              <input type="number" id="inp-sc-origin-val" value="${sc.originVal}" style="font-size: 11px;" />
            </div>
          </div>

          <!-- 物理数轴跨度指示器 (自适应主题配色) -->
          <div class="scale-axis-indicator">
            <div class="scale-axis-header">
              <span class="scale-axis-origin">基线: ${sc.originVal}${sc.unit || '%'} (X=${sc.originX})</span>
              <span class="scale-axis-target">刻度: ${sc.calibVal}${sc.unit || '%'} (X=${sc.calibX})</span>
            </div>
            <div class="scale-axis-track">
              <div class="scale-axis-bar"></div>
            </div>
          </div>

          <!-- 端点 2: 真实刻度齿 -->
          <div style="display: flex; gap: 8px;">
            <div style="flex: 1;">
              <label style="font-size: 10px; color: #f97316;">端点 2 (刻度齿像素 X):</label>
              <input type="number" id="inp-sc-calib-x" value="${sc.calibX}" style="font-size: 11px; border-color: rgba(249,115,22,0.4);" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 10px; color: #f97316;">端点 2 刻度齿数值:</label>
              <div class="input-row">
                <input type="number" id="inp-sc-calib-val" value="${sc.calibVal}" style="font-size: 11px; border-color: rgba(249,115,22,0.4);" />
                <input type="text" id="inp-sc-unit" value="${sc.unit || '%'}" style="width: 45px; font-size: 11px;" />
              </div>
            </div>
          </div>

          <!-- 常用刻度快捷填入胶囊 -->
          <div class="btn-group" style="margin-top: 8px; width: 100%; display: flex; gap: 4px;">
            <button class="tool-btn quick-tick-val-btn" data-val="100" style="flex:1; font-size: 10px;">齿:100%</button>
            <button class="tool-btn quick-tick-val-btn" data-val="50" style="flex:1; font-size: 10px;">齿:50%</button>
            <button class="tool-btn quick-tick-val-btn" data-val="20" style="flex:1; font-size: 10px;">齿:20%</button>
            <button class="tool-btn quick-tick-val-btn" data-val="10" style="flex:1; font-size: 10px;">齿:10%</button>
          </div>
        </div>

        <!-- 刻度尺度模式 (线性 Linear / 对数 Log) -->
        <div class="form-group" style="margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px;">刻度尺度 (Scale Type):</label>
            <span style="font-size: 10px; color: ${currentScaleType === 'log' ? '#f59e0b' : '#38bdf8'}; font-weight: 600;">${currentScaleType.toUpperCase()}</span>
          </div>
          <div class="btn-group" style="display: flex; gap: 4px; width: 100%; margin-top: 4px;">
            <button class="tool-btn quick-scaletype-btn ${currentScaleType === 'linear' ? 'active-mode' : ''}" data-scale="linear" style="flex: 1; font-size: 10px;">线性 (Linear)</button>
            <button class="tool-btn quick-scaletype-btn ${currentScaleType === 'log' ? 'active-mode' : ''}" data-scale="log" ${!isLogValid ? 'disabled title="对数刻度要求: 起点值 > 0 且 刻度值 > 0" style="flex: 1; font-size: 10px; opacity: 0.45; cursor: not-allowed;"' : 'style="flex: 1; font-size: 10px;"'}>对数 (Log)</button>
          </div>
          ${!isLogValid ? `
            <div id="log-scale-err" style="color: #ef4444; font-size: 10px; margin-top: 4px; line-height: 1.3;">
              ⚠️ ${logCheck.reason}
            </div>
          ` : ''}
        </div>

        <!-- 图表形态选择 (面积图 / 柱状图 / 纯折线 / 散点符号) -->
        <div class="form-group" style="margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px;">图表形态类型 (Plot Type):</label>
            <button id="btn-apply-type-all" class="tool-btn" style="font-size: 9.5px; padding: 1px 5px; color: var(--text-muted);" title="将当前形态应用至全部属种列">应用至全列</button>
          </div>
          <div class="btn-group" style="display: flex; gap: 3px; width: 100%; margin-top: 4px;">
            <button class="tool-btn quick-plottype-btn ${(col.plotType || 'area') === 'area' ? 'active-mode' : ''}" data-type="area" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">🌊 面积</button>
            <button class="tool-btn quick-plottype-btn ${col.plotType === 'bar' ? 'active-mode' : ''}" data-type="bar" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">📊 柱状</button>
            <button class="tool-btn quick-plottype-btn ${col.plotType === 'line' ? 'active-mode' : ''}" data-type="line" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">📈 折线</button>
            <button class="tool-btn quick-plottype-btn ${col.plotType === 'symbol' ? 'active-mode' : ''}" data-type="symbol" style="flex: 1; font-size: 10.5px; padding: 4px 2px;">➕ 符号</button>
          </div>
        </div>

        <!-- 局部放大曲线设置 (Exaggeration: 由用户负责填写图中标注的放大倍数) -->
        <div class="form-group" style="margin-top: 8px; padding: 6px 8px; background: rgba(148,163,184,0.06); border-radius: 4px; border: 1px dashed rgba(148,163,184,0.25);">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label style="font-size: 11px; display: flex; align-items: center; gap: 6px; cursor: pointer; margin: 0;">
              <input type="checkbox" id="chk-has-exag" ${col.hasExaggeration ? 'checked' : ''} style="cursor: pointer;" />
              <span style="font-weight: 500;">局部放大曲线 (Exaggeration)</span>
            </label>
            <span style="font-size: 10px; color: #a855f7; font-weight: 600;">${col.hasExaggeration ? `${col.exaggerationMult || 5}× 启用` : '未勾选'}</span>
          </div>
          ${col.hasExaggeration ? `
            <div style="margin-top: 6px; display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 10px; color: #94a3b8;">放大倍数:</span>
              <input type="number" id="inp-exag-mult" value="${col.exaggerationMult || 5}" min="1" max="100" style="width: 50px; font-size: 11px; padding: 2px 4px;" />
              <div class="btn-group" style="display: flex; gap: 2px; flex: 1;">
                <button class="tool-btn quick-exag-btn" data-exag="3" style="flex: 1; font-size: 9px; padding: 2px;">3×</button>
                <button class="tool-btn quick-exag-btn" data-exag="5" style="flex: 1; font-size: 9px; padding: 2px;">5×</button>
                <button class="tool-btn quick-exag-btn" data-exag="10" style="flex: 1; font-size: 9px; padding: 2px;">10×</button>
              </div>
            </div>
          ` : ''}
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button id="btn-col-digitize" class="tool-btn" style="flex: 1; font-size: 11px; padding: 6px; color: #0284c7; border-color: rgba(2,132,199,0.3); background: rgba(2,132,199,0.06);">
            ⚡ 重新识别此列
          </button>
          <button id="btn-col-delete" class="tool-btn" style="color: #dc2626; border-color: rgba(220,38,38,0.3); background: rgba(220,38,38,0.04); font-size: 11px; padding: 6px;">
            🗑 删除列
          </button>
        </div>
      </div>
    `;
  }

  private renderPointInspector(col: TaxaColumn, pt: ControlPoint): string {
    const depth = CoordinateSystem.imageYToDepth(pt.y, this.data.calibration);
    const percent = CoordinateSystem.imageXToPercent(pt.x, col);

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
            <span class="prop-val">${depth !== undefined ? depth.toFixed(2) : '--'} ${this.data.calibration.unit}</span>
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

        <button id="btn-delete-point" class="btn btn-secondary" style="width: 100%; margin-top: 12px; color: #ef4444; border-color: rgba(239,68,68,0.4);">
          🗑 删除此控制锚点
        </button>
      </div>
    `;
  }

  private bindEvents(): void {
    this.element.querySelector('#btn-collapse-inspector')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // 属种名称改名
    const nameInp = this.element.querySelector('#inp-col-name') as HTMLInputElement;
    nameInp?.addEventListener('change', () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (activeCol && nameInp.value.trim()) {
        const old = activeCol.name;
        activeCol.name = nameInp.value.trim();
        this.history.push(`Rename Taxa ${old} to ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
        this.callbacks.onDataChange();
      }
    });

    // 刻度更新
    const updateScaleCalib = () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (!activeCol) return;

      const originX = parseInt((this.element.querySelector('#inp-sc-origin-x') as HTMLInputElement)?.value, 10);
      const originVal = parseFloat((this.element.querySelector('#inp-sc-origin-val') as HTMLInputElement)?.value);
      const calibX = parseInt((this.element.querySelector('#inp-sc-calib-x') as HTMLInputElement)?.value, 10);
      const calibVal = parseFloat((this.element.querySelector('#inp-sc-calib-val') as HTMLInputElement)?.value);
      const unit = (this.element.querySelector('#inp-sc-unit') as HTMLInputElement)?.value.trim() || '%';

      if (!isNaN(originX) && !isNaN(calibX) && !isNaN(calibVal) && calibX !== originX) {
        activeCol.scaleCalib = {
          originX,
          originVal: isNaN(originVal) ? 0 : originVal,
          calibX,
          calibVal,
          unit,
        };
        activeCol.startX = originX;
        activeCol.startValue = isNaN(originVal) ? 0 : originVal;
        activeCol.unit = unit;
        activeCol.maxPercent = calibVal;
        activeCol.tickValue = calibVal;
        activeCol.tickEndX = calibX;
        activeCol.isLocked = true;

        if (activeCol.scale_type === 'log') {
          const check = CoordinateSystem.validateLogScale(activeCol);
          if (!check.valid) {
            activeCol.scale_type = 'linear';
          }
        }

        if (activeCol.controlPoints) {
          activeCol.controlPoints.forEach((p) => {
            p.value = CoordinateSystem.imageXToValue(p.x, activeCol);
          });
        }

        this.history.push(`Update Tick Calibration for ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
        this.render();
        this.callbacks.onDataChange();
      }
    };

    this.element.querySelector('#inp-sc-origin-x')?.addEventListener('change', updateScaleCalib);
    this.element.querySelector('#inp-sc-origin-val')?.addEventListener('change', updateScaleCalib);
    this.element.querySelector('#inp-sc-calib-x')?.addEventListener('change', updateScaleCalib);
    this.element.querySelector('#inp-sc-calib-val')?.addEventListener('change', updateScaleCalib);
    this.element.querySelector('#inp-sc-unit')?.addEventListener('change', updateScaleCalib);

    this.element.querySelectorAll('.quick-tick-val-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.getAttribute('data-val') || '20');
        const calibValInp = this.element.querySelector('#inp-sc-calib-val') as HTMLInputElement;
        if (calibValInp && !isNaN(val)) {
          calibValInp.value = String(val);
          updateScaleCalib();
        }
      });
    });

    this.element.querySelectorAll('.quick-scaletype-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sType = btn.getAttribute('data-scale') as 'linear' | 'log';
        const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
        if (activeCol && sType && activeCol.scale_type !== sType) {
          if (sType === 'log') {
            const check = CoordinateSystem.validateLogScale(activeCol);
            if (!check.valid) {
              alert(`无法切换到对数刻度：\n${check.reason}`);
              return;
            }
          }
          activeCol.scale_type = sType;
          if (activeCol.controlPoints) {
            activeCol.controlPoints.forEach((p) => {
              p.value = CoordinateSystem.imageXToValue(p.x, activeCol);
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
      btn.addEventListener('click', () => {
        const pType = btn.getAttribute('data-type') as 'area' | 'bar' | 'line' | 'symbol';
        const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
        if (activeCol && pType) {
          activeCol.plotType = pType;
          this.history.push(`Change ${activeCol.name} Plot Type to ${pType}`, this.data.columns, this.data.activeTaxaId);
          this.render();
          this.callbacks.onDataChange();
        }
      });
    });

    this.element.querySelector('#btn-apply-type-all')?.addEventListener('click', () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (activeCol) {
        const pType = activeCol.plotType || 'area';
        this.data.columns.forEach((c) => {
          c.plotType = pType;
        });
        this.history.push(`Apply Plot Type ${pType} to All Columns`, this.data.columns, this.data.activeTaxaId);
        this.render();
        this.callbacks.onDataChange();
      }
    });

    // 粘贴真实钻孔深度序列
    this.element.querySelector('#btn-open-paste-depths')?.addEventListener('click', () => {
      this.openPasteDepthsModal();
    });

    this.element.querySelector('#btn-clear-custom-depths')?.addEventListener('click', () => {
      // 只清层位序列，不动标定端点（旧实现把两者写在一起，清理层位会顺手改刻度）。
      delete this.data.calibration.customDepths;
      this.history.push('Clear Custom Depths', this.data.columns, this.data.activeTaxaId, this.data.calibration, this.data.roi);
      this.render();
      this.callbacks.onDataChange();
    });

    // 局部放大曲线勾选与倍数
    this.element.querySelector('#chk-has-exag')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (activeCol) {
        activeCol.hasExaggeration = checked;
        if (checked && !activeCol.exaggerationMult) {
          activeCol.exaggerationMult = 5;
        }
        this.history.push(`Toggle Exaggeration for ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
        this.render();
        this.callbacks.onDataChange();
      }
    });

    this.element.querySelector('#inp-exag-mult')?.addEventListener('change', (e) => {
      const mult = parseFloat((e.target as HTMLInputElement).value);
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (activeCol && !isNaN(mult) && mult >= 1) {
        activeCol.exaggerationMult = mult;
        this.history.push(`Set Exaggeration to ${mult}x for ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
        this.render();
        this.callbacks.onDataChange();
      }
    });

    this.element.querySelectorAll('.quick-exag-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mult = parseFloat(btn.getAttribute('data-exag') || '5');
        const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
        if (activeCol && !isNaN(mult)) {
          activeCol.exaggerationMult = mult;
          this.history.push(`Set Exaggeration to ${mult}x for ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
          this.render();
          this.callbacks.onDataChange();
        }
      });
    });

    // 删除列
    this.element.querySelector('#btn-col-delete')?.addEventListener('click', () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (activeCol && this.data.columns.length > 1) {
        const idx = this.data.columns.findIndex((c) => c.id === activeCol.id);
        if (idx !== -1) {
          this.data.columns.splice(idx, 1);
          this.data.activeTaxaId = this.data.columns[0]?.id || '';
          this.history.push(`Delete Column ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
          this.callbacks.onDataChange();
          this.callbacks.onSelectTaxa(this.data.activeTaxaId);
        }
      }
    });

    // 重新识别此列
    this.element.querySelector('#btn-col-digitize')?.addEventListener('click', () => {
      this.callbacks.onDigitizeActiveColumn();
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
    this.element.querySelector('#btn-apply-roi')?.addEventListener('click', () => {
      const x0 = parseInt((this.element.querySelector('#inp-roi-xmin') as HTMLInputElement).value, 10);
      const x1 = parseInt((this.element.querySelector('#inp-roi-xmax') as HTMLInputElement).value, 10);
      const y0 = parseInt((this.element.querySelector('#inp-roi-ymin') as HTMLInputElement).value, 10);
      const y1 = parseInt((this.element.querySelector('#inp-roi-ymax') as HTMLInputElement).value, 10);

      const prev = { ...this.data.roi };
      const next: DataRoi = {
        xMin: isNaN(x0) ? prev.xMin : x0,
        xMax: isNaN(x1) ? prev.xMax : x1,
        yMin: isNaN(y0) ? prev.yMin : y0,
        yMax: isNaN(y1) ? prev.yMax : y1,
      };

      new ResizeRoiCommand(prev, next).execute(this.data);
      this.history.push('Update ROI', this.data.columns, this.data.activeTaxaId, this.data.calibration, next);
      this.callbacks.onRoiCommitted?.(next);
      this.callbacks.onDataChange();
    });

    // 图层显隐控制 (S6)
    this.element.querySelector('#layer-chk-ghost')?.addEventListener('change', (e) => {
      this.callbacks.onToggleLayerVisibility?.('ghost', (e.target as HTMLInputElement).checked);
    });

    this.element.querySelector('#btn-inspector-open-table')?.addEventListener('click', () => {
      this.callbacks.onOpenDataViewer?.();
    });

    this.element.querySelector('#btn-inspector-open-export')?.addEventListener('click', () => {
      this.callbacks.onOpenDataViewer?.();
    });

    // S2 图像清理灵敏度（横线 + 竖线由后端在同一档位内一起判定）
    this.element.querySelector('#select-inspector-degrid')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value as 'off' | 'weak' | 'medium' | 'strong';
      this.callbacks.onChangeDegridStrength?.(val);
    });

    this.element.querySelector('#chk-degrid-vertical')?.addEventListener('change', (e) => {
      this.callbacks.onToggleVerticalLineRemoval?.((e.target as HTMLInputElement).checked);
    });

    // 线掩膜人工修正
    this.element.querySelector('#btn-linefix-erase')?.addEventListener('click', () => {
      this.callbacks.onStartLineFix?.('erase');
    });
    this.element.querySelector('#btn-linefix-restore')?.addEventListener('click', () => {
      this.callbacks.onStartLineFix?.('restore');
    });
    this.element.querySelector('#btn-linefix-clear')?.addEventListener('click', () => {
      this.callbacks.onClearLineFix?.();
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

  /**
   * 手动输入两点坐标的兜底入口：适合已从图上量好像素行、只想填数字的场景。
   * 与画布点选走同一条后端通路（core.calibrateAxes），不另立算法。
   */
  public openPasteDepthsModal(): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog" style="width: 440px; max-width: 95vw;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
            </svg>
            <h3 style="margin: 0; font-size: 13px;">从 Excel 粘贴钻孔真实样品层位序列</h3>
          </div>
          <button class="close-btn" id="modal-close-depths">&times;</button>
        </div>
        <div class="modal-body" style="padding: 14px; display: flex; flex-direction: column; gap: 10px;">
          <p style="font-size: 11px; color: var(--text-secondary); margin: 0; line-height: 1.5;">
            请在 Excel、Word 或纯文本中选中深度/年代列（允许非均匀/非等距采样），按 <strong>Ctrl+C</strong> 复制，然后直接在此处按 <strong>Ctrl+V</strong> 粘贴：
          </p>
          <textarea id="txt-paste-depths" placeholder="示例:\n12.5\n14.0\n18.2\n22.0\n35.5\n..." style="width: 100%; height: 160px; font-family: var(--font-mono); font-size: 11px; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); box-sizing: border-box;"></textarea>
          <div id="paste-depths-feedback" style="font-size: 10.5px; color: var(--text-muted);">
            尚未录入数据
          </div>
        </div>
        <div class="modal-footer" style="padding: 10px 14px; display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid var(--border-color);">
          <button class="btn btn-secondary" id="btn-cancel-depths">取消</button>
          <button class="btn btn-primary" id="btn-confirm-depths" disabled style="padding: 5px 14px; font-size: 11px;">
            确定应用真实层位
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const txt = modal.querySelector('#txt-paste-depths') as HTMLTextAreaElement;
    const fb = modal.querySelector('#paste-depths-feedback') as HTMLElement;
    const confirmBtn = modal.querySelector('#btn-confirm-depths') as HTMLButtonElement;

    txt.focus();

    let parsedDepths: number[] = [];

    const updateFeedback = () => {
      const raw = txt.value;
      const lines = raw.split(/[\r\n,;]+/);
      const nums = lines
        .map((l) => parseFloat(l.trim()))
        .filter((n) => !isNaN(n));

      // 排序并去重
      parsedDepths = Array.from(new Set(nums)).sort((a, b) => a - b);

      if (parsedDepths.length >= 2) {
        const minD = parsedDepths[0];
        const maxD = parsedDepths[parsedDepths.length - 1];
        fb.innerHTML = `✅ 已成功识别 <strong style="color: #10b981;">${parsedDepths.length}</strong> 个真实钻孔层位 (跨度: ${minD} ~ ${maxD} ${this.data.calibration.unit})`;
        confirmBtn.disabled = false;
      } else {
        fb.innerHTML = `⚠️ 请输入至少 2 个有效数字层位`;
        confirmBtn.disabled = true;
      }
    };

    txt.addEventListener('input', updateFeedback);

    modal.querySelector('#modal-close-depths')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-cancel-depths')?.addEventListener('click', () => modal.remove());

    confirmBtn.addEventListener('click', () => {
      if (parsedDepths.length >= 2) {
        // 只登记层位序列；**不**改写标定端点。旧实现把这两个概念混在一起，
        // 粘贴一次 Excel 就悄悄把 Y 轴刻度换成了样品深度范围。
        this.data.calibration.customDepths = parsedDepths;
        const bounds = CoordinateSystem.calibrationBounds(this.data.calibration);
        const outside =
          bounds !== null &&
          (parsedDepths[0] < Math.min(bounds.topValue, bounds.bottomValue) ||
            parsedDepths[parsedDepths.length - 1] > Math.max(bounds.topValue, bounds.bottomValue));
        if (outside && bounds) {
          this.callbacks.onDataChange();
          // 如实告知需要外推，而不是悄悄把标定改成能容纳它的样子。
          alert(
            `提示：粘贴的层位范围 (${parsedDepths[0]} ~ ${parsedDepths[parsedDepths.length - 1]} ${this.data.calibration.unit}) ` +
              `超出现有 Y 轴标定范围 (${bounds.topValue} ~ ${bounds.bottomValue} ${this.data.calibration.unit})，` +
              `超出的层位属于外推区，请确认标定是否准确。`
          );
        }
        this.history.push(`Apply ${parsedDepths.length} Custom Sample Depths from Excel`, this.data.columns, this.data.activeTaxaId, this.data.calibration, this.data.roi);
        this.render();
        this.callbacks.onDataChange();
        modal.remove();
      }
    });
  }
}
