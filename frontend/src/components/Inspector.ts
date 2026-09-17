import { DiagramData, TaxaColumn, ControlPoint, DiagramCalibration } from '../types/pollen';
import { HistoryManager } from '../core/HistoryManager';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { tokens } from '../styles/tokens';
import { DeletePointCommand, ResizeRoiCommand } from '../core/Commands';

export interface InspectorCallbacks {
  onDataChange: () => void;
  onSelectTaxa: (taxaId: string) => void;
  onToggleCollapse: (collapsed: boolean) => void;
  onDigitizeActiveColumn: () => Promise<void>;
  onAdvanceWorkflowStage?: (targetStage: number) => void;
  onOpenDataViewer?: () => void;
  onToggleLayerVisibility?: (layer: string, visible: boolean) => void;
  onChangeDegridStrength?: (strength: 'off' | 'weak' | 'medium' | 'strong') => void;
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
          <span>属性检查器</span>
        </div>
        <button id="btn-collapse-inspector" class="icon-btn" title="收起/展开面板 (快捷键: ])">
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
    switch (this.currentStage) {
      case 0:
        return this.renderS0Panel();
      case 1:
        return this.renderS1RoiPanel(cal);
      case 2:
        return this.renderS2CleanPanel(cal);
      case 3:
        return this.renderS3ColumnsPanel(activeCol);
      case 4:
        return activeCol ? this.renderColumnInspector(activeCol) : this.renderS3ColumnsPanel(activeCol);
      case 5:
        return activeCol ? this.renderS5DigitizePanel(activeCol) : this.renderProjectOverview(cal);
      case 6:
        return this.renderS6VerificationPanel();
      case 7:
        return this.renderS7ExportPanel();
      default:
        return activeCol ? this.renderColumnInspector(activeCol) : this.renderProjectOverview(cal);
    }
  }

  private renderS0Panel(): string {
    return `
      <div class="inspector-section">
        <div class="section-title">S0：空状态</div>
        <div class="tip-card" style="margin: 0; background: rgba(56, 189, 248, 0.08); border-color: rgba(56, 189, 248, 0.3);">
          <p style="font-size: 11px; line-height: 1.6; color: ${tokens.color.text.secondary}; margin: 0;">
            当前尚未载入地层图谱图像。<br><br>
            请点击顶栏 <strong>[📁 图谱]</strong> 按钮，或直接将图片文件拖拽至中央画布区域。
          </p>
        </div>
      </div>
    `;
  }

  private renderS1RoiPanel(cal: DiagramCalibration): string {
    return `
      <div class="inspector-section">
        <div class="section-title">S1：界定纯数据有效区 (ROI)</div>
        <div class="tip-card" style="margin-bottom: 10px; border-left: 3px solid #38bdf8; background: rgba(56, 189, 248, 0.08); padding: 8px 10px;">
          <p style="font-size: 11px; line-height: 1.5; color: #bae6fd; margin: 0;">
            <strong>工作流要点：</strong><br>
            请在画布上拖拽 8 个十字手柄框选花粉数据区，<strong>务必将左侧 Y 轴线、右侧聚类树和底部 X 刻度排除在外</strong>，确保分列 100% 准确。
          </p>
        </div>
        <div class="form-group">
          <label>顶界深度 (Top Depth):</label>
          <div class="input-row">
            <input type="number" id="inp-roi-top" value="${cal.depthTopValue}" step="1" />
            <input type="text" id="inp-roi-unit" value="${cal.unit}" style="width: 55px;" />
          </div>
        </div>
        <div class="form-group">
          <label>底界深度 (Bottom Depth):</label>
          <div class="input-row">
            <input type="number" id="inp-roi-bot" value="${cal.depthBottomValue}" step="1" />
            <span class="unit-label">${cal.unit}</span>
          </div>
        </div>
        <div class="form-group">
          <label>有效区像素 X 范围:</label>
          <div class="input-row">
            <input type="number" id="inp-roi-xmin" value="${cal.dataXMin}" />
            <span style="color:#64748b;">~</span>
            <input type="number" id="inp-roi-xmax" value="${cal.dataXMax}" />
          </div>
        </div>
        <div class="form-group">
          <label>有效区像素 Y 范围:</label>
          <div class="input-row">
            <input type="number" id="inp-roi-ymin" value="${cal.dataYMin}" />
            <span style="color:#64748b;">~</span>
            <input type="number" id="inp-roi-ymax" value="${cal.dataYMax}" />
          </div>
        </div>
        <button id="btn-apply-roi" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
          保存有效区设置
        </button>
      </div>
    `;
  }

  private renderS2CleanPanel(cal: DiagramCalibration): string {
    return `
      <div class="inspector-section">
        <div class="section-title">S2：数据区域与图像清理</div>
        <div class="prop-row" style="margin-bottom: 8px;">
          <span class="prop-label">有效区尺寸:</span>
          <span class="prop-val">${cal.dataXMax - cal.dataXMin} × ${cal.dataYMax - cal.dataYMin} px</span>
        </div>
        <div class="form-group" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light);">
          <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 6px;">图像去横线与网格降噪:</label>
          <select id="select-inspector-degrid" class="sample-select" style="width: 100%; font-size: 11px; margin-bottom: 6px;">
            <option value="off">去横线: 关闭</option>
            <option value="weak">去横线: 弱 (仅细线)</option>
            <option value="medium" selected>去横线: 中 (推荐)</option>
            <option value="strong">去横线: 强 (粗网格)</option>
          </select>
          <small style="font-size: 10px; color: var(--text-muted); line-height: 1.4; display: block;">
            提示: 按键盘 <strong>B</strong> 键可在画布上即时透视查看被切除的横线（鲜红色标记）。
          </small>
        </div>
      </div>
    `;
  }

  private renderS3ColumnsPanel(activeCol?: TaxaColumn): string {
    return `
      <div class="inspector-section">
        <div class="section-title">S3：分列与属种名单对齐</div>
        <div class="tip-card" style="margin-bottom: 10px; background: rgba(56, 189, 248, 0.06);">
          <p style="font-size: 11px; line-height: 1.5; color: var(--text-secondary); margin: 0;">
            当前已识别出 <strong>${this.data.columns.length}</strong> 个属种列。<br>
            • 在侧边栏使用 <strong>[批量导入]</strong> 粘贴名单<br>
            • 发现漏列点击 <strong>[➕插空列]</strong><br>
            • 使用 <strong>▲/▼</strong> 箭头就地对调顺位
          </p>
        </div>
        ${activeCol ? this.renderColumnInspector(activeCol) : ''}
      </div>
    `;
  }

  private renderS5DigitizePanel(activeCol: TaxaColumn): string {
    return `
      <div class="inspector-section">
        <div class="section-title">S5：轮廓精修与特征拐点</div>
        ${this.renderColumnInspector(activeCol)}
      </div>
    `;
  }

  private renderS6VerificationPanel(): string {
    return `
      <div class="inspector-section">
        <div class="section-title">S6：地学校验与图层审查</div>
        <div class="form-group" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; border: 1px solid var(--border-light); margin-bottom: 12px;">
          <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 8px;">图层显隐开关 (Layer Toggles):</label>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-secondary);">
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-ghost" checked />
              <span>🟢 绿色原位半透明重叠层 (Visual Ghosting)</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-curves" checked />
              <span>🌊 属种轮廓曲线与面积填充</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-anchors" checked />
              <span>🟡 稀疏物理拐点手柄</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-grid" checked />
              <span>📏 地层标准深度网格线</span>
            </label>
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="layer-chk-roi" checked />
              <span>🟦 ROI 数据有效区边框</span>
            </label>
          </div>
        </div>

        <button id="btn-inspector-open-table" class="btn btn-primary" style="width: 100%; font-size: 11.5px; padding: 7px;">
          📊 打开数据表格与 100% 总和自检
        </button>
      </div>
    `;
  }

  private renderS7ExportPanel(): string {
    return `
      <div class="inspector-section">
        <div class="section-title">S7：导出交付 (Export)</div>
        <div class="tip-card" style="margin-bottom: 12px; background: rgba(34, 197, 94, 0.08); border-color: rgba(34, 197, 94, 0.3);">
          <p style="font-size: 11px; line-height: 1.5; color: #4ade80; margin: 0;">
            <strong>科学导出已就绪：</strong><br>
            • CSV 矩阵首列严格为 depth，未出现属种为 0.0<br>
            • POSIX UStar .tar 开放归档兼容任意系统<br>
            • rioja 脚本自动适配每列形态与放大倍数
          </p>
        </div>
        <button id="btn-inspector-open-export" class="btn btn-primary" style="width: 100%; font-size: 12px; padding: 8px;">
          💾 打开科学数据导出面板
        </button>
      </div>
    `;
  }

  private renderProjectOverview(cal: DiagramCalibration): string {
    const numCols = this.data.columns.length;
    const totalDepth = cal.depthBottomValue - cal.depthTopValue;
    const interval = cal.depthInterval || 2;
    const numHorizons = Math.round(totalDepth / interval) + 1;

    return `
      <div class="inspector-section">
        <div class="section-title">地质剖面与数据区概览</div>
        <div class="property-grid">
          <div class="prop-row">
            <span class="prop-label">底图分辨率:</span>
            <span class="prop-val">${this.data.imageWidth} × ${this.data.imageHeight} px</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">属种列总数:</span>
            <span class="prop-val"><strong style="color: #38bdf8;">${numCols}</strong> 列</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">沉积深度跨度:</span>
            <span class="prop-val">${cal.depthTopValue} ~ ${cal.depthBottomValue} ${cal.unit}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">标准层位采样点:</span>
            <span class="prop-val">${numHorizons} 层 (Δ=${interval}${cal.unit})</span>
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

    // 应用有效区
    this.element.querySelector('#btn-apply-roi')?.addEventListener('click', () => {
      const x0 = parseInt((this.element.querySelector('#inp-roi-xmin') as HTMLInputElement).value, 10);
      const x1 = parseInt((this.element.querySelector('#inp-roi-xmax') as HTMLInputElement).value, 10);
      const y0 = parseInt((this.element.querySelector('#inp-roi-ymin') as HTMLInputElement).value, 10);
      const y1 = parseInt((this.element.querySelector('#inp-roi-ymax') as HTMLInputElement).value, 10);
      const top = parseFloat((this.element.querySelector('#inp-roi-top') as HTMLInputElement).value);
      const bot = parseFloat((this.element.querySelector('#inp-roi-bot') as HTMLInputElement).value);
      const unit = (this.element.querySelector('#inp-roi-unit') as HTMLInputElement).value.trim() || 'cm';

      const prev = { ...this.data.calibration };
      new ResizeRoiCommand(prev, {
        ...this.data.calibration,
        dataXMin: isNaN(x0) ? prev.dataXMin : x0,
        dataXMax: isNaN(x1) ? prev.dataXMax : x1,
        dataYMin: isNaN(y0) ? prev.dataYMin : y0,
        dataYMax: isNaN(y1) ? prev.dataYMax : y1,
        depthTopValue: isNaN(top) ? prev.depthTopValue : top,
        depthBottomValue: isNaN(bot) ? prev.depthBottomValue : bot,
        unit,
        isCalibrated: true,
      }).execute(this.data);

      this.history.push('Update ROI & Calibration', this.data.columns, this.data.activeTaxaId, this.data.calibration);
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

    // S2 图像清理灵敏度
    this.element.querySelector('#select-inspector-degrid')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value as 'off' | 'weak' | 'medium' | 'strong';
      this.callbacks.onChangeDegridStrength?.(val);
    });
  }
}
