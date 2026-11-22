import { getLocale } from '../i18n';

export interface ShortcutServiceCallbacks {
  toggleSidebar: () => void;
  toggleInspector: () => void;
  openSettings: () => void;
}

export class ShortcutService {
  private canvasWrapper: HTMLElement;
  private helpPanel: HTMLElement;
  private callbacks: ShortcutServiceCallbacks;
  private onKeyDownHandler: (e: KeyboardEvent) => void;

  constructor(canvasWrapper: HTMLElement, callbacks: ShortcutServiceCallbacks) {
    this.canvasWrapper = canvasWrapper;
    this.callbacks = callbacks;

    this.helpPanel = document.createElement('div');
    this.helpPanel.className = 'floating-help-panel';
    this.helpPanel.style.display = 'none';
    this.canvasWrapper.appendChild(this.helpPanel);

    this.renderHelpPanelContent();

    this.onKeyDownHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'
      ) {
        return;
      }

      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'BracketLeft') {
        e.preventDefault();
        this.callbacks.toggleSidebar();
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'BracketRight') {
        e.preventDefault();
        this.callbacks.toggleInspector();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === ',' || e.code === 'Comma')
      ) {
        e.preventDefault();
        this.callbacks.openSettings();
      } else if (e.code === 'F1') {
        e.preventDefault();
        this.toggleHelpPanel();
      } else if (e.code === 'Escape' && this.helpPanel.style.display !== 'none') {
        e.preventDefault();
        this.helpPanel.style.display = 'none';
      }
    };

    window.addEventListener('keydown', this.onKeyDownHandler);
  }

  public renderHelpPanelContent(): void {
    const isEn = getLocale() === 'en';
    this.helpPanel.innerHTML = isEn
      ? `
      <div class="help-panel-header">
        <div style="display: flex; align-items: center; gap: 6px;">
          <strong style="color: var(--accent-blue); font-size: 12.5px;">Interaction Guide & Shortcuts</strong>
        </div>
        <span id="help-panel-close" title="Close (Esc)" style="cursor: pointer; font-size: 16px; color: var(--text-muted); line-height: 1; padding: 2px 4px;">&times;</span>
      </div>
      <div class="help-panel-body">
        <div class="help-section">
          <div class="help-section-title">Viewport Navigation</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">Right-drag / Mid-drag / Space+Left</span><span class="help-desc">Unified Viewport Pan</span></div>
            <div class="help-row"><span class="help-key">Wheel Scroll</span><span class="help-desc">Zoom centered on cursor (10%~1000%); Ctrl speeds up</span></div>
            <div class="help-row"><span class="help-key">Shift / Alt + Wheel</span><span class="help-desc">Horizontal Pan (Shift) / Vertical Pan (Alt)</span></div>
            <div class="help-row"><span class="help-key">Alt + Arrow Keys</span><span class="help-desc">Pan view 40px (never nudges selected elements)</span></div>
            <div class="help-row"><span class="help-key">F / Double Click</span><span class="help-desc">Fit to Screen (empty canvas)</span></div>
            <div class="help-row"><span class="help-key">Ctrl+1</span><span class="help-desc">100% 1:1 Scale</span></div>
            <div class="help-row"><span class="help-key">+ / -</span><span class="help-desc">Smooth Zoom In / Out</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">Workflow Tools</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">R</span><span class="help-desc">Step 2 · ROI Bounding Box</span></div>
            <div class="help-row"><span class="help-key">Y</span><span class="help-desc">Step 3 · Y-Axis Two-Point Calibration</span></div>
            <div class="help-row"><span class="help-key">C</span><span class="help-desc">Step 4 · Add Column Baseline</span></div>
            <div class="help-row"><span class="help-key">K</span><span class="help-desc">Step 5 · Line Mask Correction Brush</span></div>
            <div class="help-row"><span class="help-key">T</span><span class="help-desc">Step 6 · Pick an X-Axis Ruler Tick</span></div>
            <div class="help-row"><span class="help-key">A / S / D</span><span class="help-desc">Step 7 · Add (A) / Adjust (S) / Delete (D) Control Point</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">Element Editing & Nudge</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">Left Click</span><span class="help-desc">Select element / Insert anchor / Deselect on empty</span></div>
            <div class="help-row"><span class="help-key">Left Drag</span><span class="help-desc">Nudge anchor coords / Adjust column tick / Resize ROI</span></div>
            <div class="help-row"><span class="help-key">Arrow Keys</span><span class="help-desc">1px Precision Nudge for selected element</span></div>
            <div class="help-row"><span class="help-key">Shift + Arrow Keys</span><span class="help-desc">10px Fast Nudge for selected element</span></div>
            <div class="help-row"><span class="help-key">Delete / Backspace</span><span class="help-desc">Delete selected point, column, or geometry</span></div>
            <div class="help-row"><span class="help-key">Esc / Right Click</span><span class="help-desc">Exit active tool, return to Adjust (S) / Deselect</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">Display, History & System</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">B / I</span><span class="help-desc">Binary Overlay (B) / Invert (I)</span></div>
            <div class="help-row"><span class="help-key">Ctrl+Z / Ctrl+Y</span><span class="help-desc">Undo / Redo</span></div>
            <div class="help-row"><span class="help-key">Ctrl+[ / Ctrl+]</span><span class="help-desc">Collapse/Expand Left / Right Panels</span></div>
            <div class="help-row"><span class="help-key">Ctrl+,</span><span class="help-desc">Preferences & Settings</span></div>
            <div class="help-row"><span class="help-key">F1</span><span class="help-desc">Toggle Help Panel</span></div>
          </div>
        </div>
      </div>
    `
      : `
      <div class="help-panel-header">
        <div style="display: flex; align-items: center; gap: 6px;">
          <strong style="color: var(--accent-blue); font-size: 12.5px;">统一交互系统与快捷键速查</strong>
        </div>
        <span id="help-panel-close" title="关闭 (Esc)" style="cursor: pointer; font-size: 16px; color: var(--text-muted); line-height: 1; padding: 2px 4px;">&times;</span>
      </div>
      <div class="help-panel-body">
        <div class="help-section">
          <div class="help-section-title">视口与画布导航</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">右键拖拽 / 中键 / 空格+左键</span><span class="help-desc">全系统绝对统一视口平移 (Pan)</span></div>
            <div class="help-row"><span class="help-key">滚轮滚动</span><span class="help-desc">以光标为中心缩放 (10%~1000%)；Ctrl 加速</span></div>
            <div class="help-row"><span class="help-key">Shift / Alt + 滚轮</span><span class="help-desc">水平平移 (Shift) / 垂直平移 (Alt)</span></div>
            <div class="help-row"><span class="help-key">Alt + 方向键</span><span class="help-desc">平移视图 40px（不影响任何选中图元）</span></div>
            <div class="help-row"><span class="help-key">F / 双击空白</span><span class="help-desc">视图全图自适应屏幕居中 (Fit to Screen)</span></div>
            <div class="help-row"><span class="help-key">Ctrl+1</span><span class="help-desc">100% 原始物理分辨率 (1:1)</span></div>
            <div class="help-row"><span class="help-key">+ / -</span><span class="help-desc">平滑放大 / 缩小视图</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">各步骤专用工具</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">R</span><span class="help-desc">步骤 2 · ROI 矩形取数区框定模式</span></div>
            <div class="help-row"><span class="help-key">Y</span><span class="help-desc">步骤 3 · Y 轴两点物理标定模式</span></div>
            <div class="help-row"><span class="help-key">C</span><span class="help-desc">步骤 4 · 添加属种分列线模式</span></div>
            <div class="help-row"><span class="help-key">K</span><span class="help-desc">步骤 5 · 干扰线掩膜人工修复笔刷</span></div>
            <div class="help-row"><span class="help-key">T</span><span class="help-desc">步骤 6 · 点选 X 轴刻度齿 (列标定模式)</span></div>
            <div class="help-row"><span class="help-key">A / S / D</span><span class="help-desc">步骤 7 · 添加 (A) / 微调选择 (S) / 删除 (D) 控制点</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">图元编辑与精调</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">左键单击</span><span class="help-desc">选中图元 / 插入锚点；空白处取消选中</span></div>
            <div class="help-row"><span class="help-key">左键拖拽</span><span class="help-desc">微调锚点坐标 / 调整列基线刻度 / 调整 ROI</span></div>
            <div class="help-row"><span class="help-key">↑ ↓ ← →</span><span class="help-desc">选中图元 1 像素高精度微调 (1px Nudge)</span></div>
            <div class="help-row"><span class="help-key">Shift + 方向键</span><span class="help-desc">选中图元 10 像素快速微调 (10px Nudge)</span></div>
            <div class="help-row"><span class="help-key">Delete / Backspace</span><span class="help-desc">删除选中的控制点、分列线或干扰线几何</span></div>
            <div class="help-row"><span class="help-key">Esc / 右键单击</span><span class="help-desc">退出当前工具返回选择微调 (S) / 取消选中</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">底图滤镜与全局系统</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">B / I</span><span class="help-desc">二值化透视遮罩 (B) / 底图反相 (I)</span></div>
            <div class="help-row"><span class="help-key">Ctrl+Z / Ctrl+Y</span><span class="help-desc">撤销 / 重做 (Undo / Redo)</span></div>
            <div class="help-row"><span class="help-key">Ctrl+[ / Ctrl+]</span><span class="help-desc">展开 / 折叠左侧属种列表 / 右侧属性检查器</span></div>
            <div class="help-row"><span class="help-key">Ctrl+,</span><span class="help-desc">呼出全局偏好与系统设置 (Settings)</span></div>
            <div class="help-row"><span class="help-key">F1</span><span class="help-desc">呼出 / 关闭本速查指南</span></div>
          </div>
        </div>
      </div>
    `;

    this.helpPanel.querySelector('#help-panel-close')?.addEventListener('click', () => {
      this.helpPanel.style.display = 'none';
    });
  }

  public toggleHelpPanel(): void {
    const isHidden = this.helpPanel.style.display === 'none';
    this.helpPanel.style.display = isHidden ? 'block' : 'none';
  }

  public closeHelpPanel(): void {
    this.helpPanel.style.display = 'none';
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKeyDownHandler);
    this.helpPanel.remove();
  }
}
