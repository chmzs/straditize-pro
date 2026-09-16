import { DiagramData, TaxaColumn, ControlPoint, DiagramCalibration } from '../types/pollen';
import { HistoryManager } from '../core/HistoryManager';
import { DeletePointCommand, ResizeRoiCommand } from '../core/Commands';
import { CoordinateSystem } from '../core/CoordinateSystem';

export interface InspectorCallbacks {
  onDataChange: () => void;
  onSelectTaxa: (taxaId: string) => void;
  onToggleCollapse: (collapsed: boolean) => void;
  onDigitizeActiveColumn: () => void;
}

export class Inspector {
  private element: HTMLElement;
  private data: DiagramData;
  private history: HistoryManager;
  private callbacks: InspectorCallbacks;
  private isCollapsed: boolean = false;

  constructor(
    data: DiagramData,
    history: HistoryManager,
    callbacks: InspectorCallbacks
  ) {
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

  public toggleCollapse(): boolean {
    this.isCollapsed = !this.isCollapsed;
    if (this.isCollapsed) {
      this.element.classList.add('collapsed');
    } else {
      this.element.classList.remove('collapsed');
    }
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

    if (selected?.type === 'point') {
      const col = this.data.columns.find((c) => c.id === selected.colId);
      const pt = col?.controlPoints.find((p) => p.id === selected.pointId);
      if (col && pt) {
        contentHtml = this.renderPointInspector(col, pt);
      } else {
        contentHtml = this.renderProjectOverview(cal);
      }
    } else if (selected?.type === 'column') {
      const col = this.data.columns.find((c) => c.id === selected.id) || activeCol;
      if (col) {
        contentHtml = this.renderColumnInspector(col);
      } else {
        contentHtml = this.renderProjectOverview(cal);
      }
    } else if (selected?.type === 'roi') {
      contentHtml = this.renderRoiInspector(cal);
    } else if (activeCol) {
      contentHtml = this.renderColumnInspector(activeCol);
    } else {
      contentHtml = this.renderProjectOverview(cal);
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
          <div class="prop-row">
            <span class="prop-label">数据有效区 ROI:</span>
            <span class="prop-val">[X: ${cal.dataXMin}~${cal.dataXMax}] [Y: ${cal.dataYMin}~${cal.dataYMax}]</span>
          </div>
        </div>
      </div>

      <div class="inspector-section">
        <div class="section-title">快速操作指南</div>
        <div class="tip-card" style="margin: 0;">
          <p style="font-size: 11px; line-height: 1.6; color: #94a3b8;">
            • 鼠标在画布直接<strong>左键点击</strong>拉扯花粉轮廓<br>
            • 快捷键 <strong>[</strong> 和 <strong>]</strong> 分别折叠左右面板<br>
            • 按 <strong>V / H / R / C / P / E</strong> 切换工具模式<br>
            • 任意误操作随时按 <strong>Ctrl+Z</strong> 撤销
          </p>
        </div>
      </div>
    `;
  }

  private renderRoiInspector(cal: DiagramCalibration): string {
    return `
      <div class="inspector-section">
        <div class="section-title">第 2 步：地质数据有效区 (ROI Bounding Box)</div>
        <div class="tip-card" style="margin-bottom: 10px; border-left: 3px solid #38bdf8; background: rgba(56, 189, 248, 0.08); padding: 8px 10px;">
          <p style="font-size: 11px; line-height: 1.5; color: #bae6fd; margin: 0;">
            <strong>科学工作流要点：</strong><br>
            拖动画布四周的控制手柄，将纯花粉数据区框选，<strong>严格将左侧 Y 轴线、右侧聚类树和底部 X 刻度排除在外</strong>。有效区界定越干净，后续分列识别 100% 零错位！
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
          <label>数据区像素 X 范围 [Left, Right]:</label>
          <div class="input-row">
            <input type="number" id="inp-roi-xmin" value="${cal.dataXMin}" />
            <span style="color:#64748b;">~</span>
            <input type="number" id="inp-roi-xmax" value="${cal.dataXMax}" />
          </div>
        </div>

        <div class="form-group">
          <label>数据区像素 Y 范围 [Top, Bottom]:</label>
          <div class="input-row">
            <input type="number" id="inp-roi-ymin" value="${cal.dataYMin}" />
            <span style="color:#64748b;">~</span>
            <input type="number" id="inp-roi-ymax" value="${cal.dataYMax}" />
          </div>
        </div>

        <div class="form-group">
          <label>剖面采样间隔 (Depth Interval):</label>
          <div class="input-row">
            <input type="number" id="inp-roi-interval" value="${cal.depthInterval || 2}" min="0.1" step="0.5" />
            <span class="unit-label">${cal.unit}/层</span>
          </div>
        </div>

        <button id="btn-apply-roi" class="btn btn-primary" style="width: 100%; margin-top: 10px;">
          应用数据区修改
        </button>
      </div>
    `;
  }

  private renderColumnInspector(col: TaxaColumn): string {
    const sc = col.scaleCalib || {
      originX: col.startX,
      originVal: 0,
      calibX: col.tickEndX || (col.startX + 60),
      calibVal: col.maxPercent || 20,
      unit: col.unit || '%',
    };

    const tickSpanPx = sc.calibX - sc.originX;
    const tickValSpan = sc.calibVal - sc.originVal;
    const slope = tickSpanPx > 0 ? (tickValSpan / tickSpanPx) : 0;

    const logCheck = CoordinateSystem.validateLogScale(col);
    const isLogValid = logCheck.valid;
    const currentScaleType = col.scale_type || 'linear';

    return `
      <div class="inspector-section">
        <div class="section-title">属种列属性: <strong style="color:${col.color}">${col.name}</strong></div>

        <div class="form-group">
          <label>属种名称 (Taxa Name):</label>
          <input type="text" id="inp-col-name" value="${col.name}" class="text-input" />
        </div>

        <div class="form-group" style="background: rgba(15,23,42,0.4); padding: 10px; border-radius: 6px; border: 1px solid var(--border-light);">
          <div style="font-weight: 700; font-size: 11px; color: #38bdf8; margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
            <span>📍 两点式 X 轴物理刻度标定</span>
            <span style="font-size: 10px; color: var(--text-muted);">斜率: ${slope.toFixed(3)} ${sc.unit}/px</span>
          </div>

          <!-- 端点 1: 起点基线齿 (默认 0，可改) -->
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div style="flex: 1;">
              <label style="font-size: 10px; color: var(--text-muted);">端点 1 (原点像素 X):</label>
              <input type="number" id="inp-sc-origin-x" value="${sc.originX}" style="font-size: 11px;" />
            </div>
            <div style="flex: 1;">
              <label style="font-size: 10px; color: var(--text-muted);">端点 1 对应数值:</label>
              <input type="number" id="inp-sc-origin-val" value="${sc.originVal}" style="font-size: 11px;" />
            </div>
          </div>

          <!-- 物理数轴跨度指示器 -->
          <div style="margin: 6px 0; padding: 4px 6px; background: rgba(15, 23, 42, 0.5); border-radius: 4px; border: 1px solid rgba(255,255,255,0.06);">
            <div style="display: flex; justify-content: space-between; font-size: 9.5px; font-family: var(--font-mono); color: var(--text-muted); margin-bottom: 2px;">
              <span style="color: #38bdf8;">基线: ${sc.originVal}${sc.unit || '%'} (X=${sc.originX})</span>
              <span style="color: #f97316;">刻度: ${sc.calibVal}${sc.unit || '%'} (X=${sc.calibX})</span>
            </div>
            <div style="position: relative; height: 5px; background: rgba(51, 65, 85, 0.6); border-radius: 3px; overflow: hidden;">
              <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 100%; background: linear-gradient(90deg, #38bdf8, #f97316); opacity: 0.85;"></div>
            </div>
          </div>

          <!-- 端点 2: 真实刻度齿 (用户直接看图输入对应数值) -->
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
          <small style="color: #64748b; font-size: 10px; display: block; margin-top: 4px;">
            提示: 画布横轴上的橙色刻度手柄可直接拖动微调端点 2 位置
          </small>
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
            <small style="color: #64748b; font-size: 9px; display: block; margin-top: 4px; line-height: 1.3;">
              由用户负责填写图谱注明的放大倍数，提取数值将按该倍率几何还原实际物理百分比
            </small>
          ` : ''}
        </div>

        <div class="form-group" style="margin-top: 8px;">
          <label>曲线控制拐点统计:</label>
          <div class="prop-val" style="font-size: 11px; color: #94a3b8;">
            共 ${col.controlPoints.length} 个拐点 (${col.controlPoints.filter(p => p.type === 'peak' || p.type === 'trough').length} 物理极值, ${col.controlPoints.filter(p => p.type === 'manual' || p.isManual).length} 手工微调)
          </div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button id="btn-col-digitize" class="btn btn-primary" style="flex: 1; font-size: 11px; padding: 6px;">
            ⚡ 重新识别此列
          </button>
          <button id="btn-col-delete" class="btn btn-secondary" style="color: #ef4444; border-color: rgba(239,68,68,0.4); font-size: 11px; padding: 6px;">
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
            <span class="prop-label">所属花粉属种:</span>
            <span class="prop-val" style="color: ${col.color}; font-weight: bold;">${col.name}</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">层位物理深度:</span>
            <span class="prop-val"><strong style="color: #38bdf8;">${depth !== undefined ? depth + ' ' + this.data.calibration.unit : '未标定'}</strong></span>
          </div>
          <div class="prop-row">
            <span class="prop-label">花粉百分比丰度:</span>
            <span class="prop-val"><strong style="color: #34d399;">${percent} ${col.unit || '%'}</strong></span>
          </div>
          <div class="prop-row">
            <span class="prop-label">图像物理像素:</span>
            <span class="prop-val">X: ${pt.x} px, Y: ${pt.y} px</span>
          </div>
          <div class="prop-row">
            <span class="prop-label">拐点科学类型:</span>
            <span class="prop-val" style="color: ${typeInfo.color};">${typeInfo.text}</span>
          </div>
        </div>

        <button id="btn-delete-point" class="btn btn-secondary" style="width: 100%; color: #ef4444; border-color: rgba(239,68,68,0.4); margin-top: 16px;">
          🗑 删除此控制拐点
        </button>
      </div>
    `;
  }

  private bindEvents(): void {
    // 折叠按钮
    this.element.querySelector('#btn-collapse-inspector')?.addEventListener('click', () => {
      this.toggleCollapse();
    });

    // 属种属性修改
    const nameInp = this.element.querySelector('#inp-col-name') as HTMLInputElement;
    nameInp?.addEventListener('change', () => {
      const activeCol = this.data.columns.find((c) => c.id === this.data.activeTaxaId);
      if (activeCol && nameInp.value.trim()) {
        const oldName = activeCol.name;
        activeCol.name = nameInp.value.trim();
        this.history.push(`Rename Taxa ${oldName} to ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
        this.callbacks.onDataChange();
      }
    });

    // 两点式物理刻度钉参数绑定与更新
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

    // 局部放大曲线勾选与倍数事件
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

    // 删除列按钮
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

    // 重新识别该列
    this.element.querySelector('#btn-col-digitize')?.addEventListener('click', () => {
      this.callbacks.onDigitizeActiveColumn();
    });

    // 删除点按钮
    this.element.querySelector('#btn-delete-point')?.addEventListener('click', () => {
      const sel = this.data.selectedEntity;
      if (sel?.type === 'point') {
        const col = this.data.columns.find((c) => c.id === sel.colId);
        const pt = col?.controlPoints.find((p) => p.id === sel.pointId);
        if (col && pt) {
          const cmd = new DeletePointCommand(col.id, pt, col.name);
          cmd.execute(this.data);
          this.data.selectedEntity = null;
          this.history.push(`Delete Anchor from ${col.name}`, this.data.columns, this.data.activeTaxaId);
          this.render();
          this.callbacks.onDataChange();
        }
      }
    });

    // 应用 ROI 修改
    this.element.querySelector('#btn-apply-roi')?.addEventListener('click', () => {
      const xmin = parseInt((this.element.querySelector('#inp-roi-xmin') as HTMLInputElement).value, 10);
      const xmax = parseInt((this.element.querySelector('#inp-roi-xmax') as HTMLInputElement).value, 10);
      const ymin = parseInt((this.element.querySelector('#inp-roi-ymin') as HTMLInputElement).value, 10);
      const ymax = parseInt((this.element.querySelector('#inp-roi-ymax') as HTMLInputElement).value, 10);
      const topD = parseFloat((this.element.querySelector('#inp-roi-top') as HTMLInputElement).value);
      const botD = parseFloat((this.element.querySelector('#inp-roi-bot') as HTMLInputElement).value);
      const unit = (this.element.querySelector('#inp-roi-unit') as HTMLInputElement).value.trim() || 'cm';
      const interval = parseFloat((this.element.querySelector('#inp-roi-interval') as HTMLInputElement).value) || 2;

      const oldCal = { ...this.data.calibration };
      const newCal: DiagramCalibration = {
        ...this.data.calibration,
        dataXMin: isNaN(xmin) ? oldCal.dataXMin : xmin,
        dataXMax: isNaN(xmax) ? oldCal.dataXMax : xmax,
        dataYMin: isNaN(ymin) ? oldCal.dataYMin : ymin,
        dataYMax: isNaN(ymax) ? oldCal.dataYMax : ymax,
        depthTopValue: isNaN(topD) ? oldCal.depthTopValue : topD,
        depthBottomValue: isNaN(botD) ? oldCal.depthBottomValue : botD,
        unit,
        depthInterval: interval,
        isCalibrated: true,
      };

      const cmd = new ResizeRoiCommand(oldCal, newCal);
      cmd.execute(this.data);
      this.history.push('Update ROI & Calibration', this.data.columns, this.data.activeTaxaId, this.data.calibration);
      this.callbacks.onDataChange();
    });
  }
}
