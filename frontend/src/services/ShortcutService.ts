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
          <div class="help-section-title">Mouse Operations</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">Right-drag / Mid-drag / Space+Left</span><span class="help-desc">Unified Viewport Pan</span></div>
            <div class="help-row"><span class="help-key">Wheel Scroll</span><span class="help-desc">Zoom centered on cursor (10%~1000%); Ctrl speeds up</span></div>
            <div class="help-row"><span class="help-key">Shift / Alt + Wheel</span><span class="help-desc">Horizontal Pan (Shift) / Vertical Pan (Alt)</span></div>
            <div class="help-row"><span class="help-key">Left Click</span><span class="help-desc">Select element / Insert anchor / Deselect on empty</span></div>
            <div class="help-row"><span class="help-key">Double Click</span><span class="help-desc">Fit to screen (empty) / Focus anchor</span></div>
            <div class="help-row"><span class="help-key">Left Drag</span><span class="help-desc">Nudge anchor coords / Adjust column tick / Resize ROI</span></div>
            <div class="help-row"><span class="help-key">Right Click</span><span class="help-desc">Exit active tool, return to Adjust (S) / Deselect</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">Manual Extraction Modes</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">A</span><span class="help-desc">Add Control Point</span></div>
            <div class="help-row"><span class="help-key">S / V</span><span class="help-desc">Select & Adjust Point</span></div>
            <div class="help-row"><span class="help-key">D</span><span class="help-desc">Delete Control Point</span></div>
            <div class="help-row"><span class="help-key">C</span><span class="help-desc">Add Column Baseline</span></div>
            <div class="help-row"><span class="help-key">H</span><span class="help-desc">Hand Pan Mode</span></div>
            <div class="help-row"><span class="help-key">R</span><span class="help-desc">Data ROI Bounding Box</span></div>
            <div class="help-row"><span class="help-key">K</span><span class="help-desc">Line Mask Correction Brush</span></div>
            <div class="help-row"><span class="help-key">Y</span><span class="help-desc">Y-Axis Two-Point Calibration</span></div>
            <div class="help-row"><span class="help-key">Esc</span><span class="help-desc">Return to Adjust (S) / Deselect</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">Navigation & Nudge</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">Arrow Keys</span><span class="help-desc">1px Precision Nudge</span></div>
            <div class="help-row"><span class="help-key">Shift + Arrow Keys</span><span class="help-desc">10px Fast Nudge</span></div>
            <div class="help-row"><span class="help-key">F</span><span class="help-desc">Fit to Screen</span></div>
            <div class="help-row"><span class="help-key">Ctrl+1</span><span class="help-desc">100% 1:1 Scale</span></div>
            <div class="help-row"><span class="help-key">+ / -</span><span class="help-desc">Smooth Zoom In / Out</span></div>
            <div class="help-row"><span class="help-key">B / I / C</span><span class="help-desc">Binary Overlay (B) / Invert (I) / Contrast (C)</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">History & Layout</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">Ctrl+Z / Ctrl+Y</span><span class="help-desc">Undo / Redo</span></div>
            <div class="help-row"><span class="help-key">Delete</span><span class="help-desc">Delete selected point or column</span></div>
            <div class="help-row"><span class="help-key">Ctrl+[ / Ctrl+]</span><span class="help-desc">Collapse/Expand Left/Right Drawers</span></div>
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
          <div class="help-section-title">鼠标交互规范</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">右键拖拽 / 中键 / 空格+左键</span><span class="help-desc">全系统绝对统一视口平移 (Pan)</span></div>
            <div class="help-row"><span class="help-key">滚轮滚动</span><span class="help-desc">以光标为中心缩放 (10%~1000%)；Ctrl 加速</span></div>
            <div class="help-row"><span class="help-key">Shift / Alt + 滚轮</span><span class="help-desc">水平平移 (Shift) / 垂直平移 (Alt)</span></div>
            <div class="help-row"><span class="help-key">左键单击</span><span class="help-desc">选中图元 / 插入锚点拉伸轮廓 / 空白取消选中</span></div>
            <div class="help-row"><span class="help-key">左键双击</span><span class="help-desc">空白处快速适应屏幕 (Fit) / 锚点聚焦</span></div>
            <div class="help-row"><span class="help-key">左键拖拽</span><span class="help-desc">微调锚点坐标 / 调整列基线刻度 / 调整 ROI</span></div>
            <div class="help-row"><span class="help-key">右键单击</span><span class="help-desc">退出临时工具返回微调 (S) / 取消选中</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">手动提取模式</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">A</span><span class="help-desc">添加控制点模式 (Add Point)</span></div>
            <div class="help-row"><span class="help-key">S / V</span><span class="help-desc">微调与选择模式 (Adjust Point)</span></div>
            <div class="help-row"><span class="help-key">D</span><span class="help-desc">删除控制点模式 (Delete Point)</span></div>
            <div class="help-row"><span class="help-key">C</span><span class="help-desc">添加属种分列线 (Add Column)</span></div>
            <div class="help-row"><span class="help-key">H</span><span class="help-desc">抓手平移模式 (Hand / Pan)</span></div>
            <div class="help-row"><span class="help-key">R</span><span class="help-desc">ROI 矩形取数区模式（只框定取数范围，与深度无关）</span></div>
            <div class="help-row"><span class="help-key">K</span><span class="help-desc">线掩膜人工修正笔刷（涂抹擦掉误标 / 补回漏标）</span></div>
            <div class="help-row"><span class="help-key">Y</span><span class="help-desc">Y 轴两点标定（点两个已知刻度所在的行，再填真实值）</span></div>
            <div class="help-row"><span class="help-key">Esc</span><span class="help-desc">退出当前工具返回微调 (S) / 取消选中</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">方向键微调与视图导航</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">↑ ↓ ← →</span><span class="help-desc">1 像素高精度微调 (1px Nudge)</span></div>
            <div class="help-row"><span class="help-key">Shift + 方向键</span><span class="help-desc">10 像素快速微调 (10px Nudge)</span></div>
            <div class="help-row"><span class="help-key">F</span><span class="help-desc">视图全图自适应屏幕居中 (Fit to Screen)</span></div>
            <div class="help-row"><span class="help-key">Ctrl+1</span><span class="help-desc">100% 原始物理分辨率 (1:1)</span></div>
            <div class="help-row"><span class="help-key">+ / -</span><span class="help-desc">平滑放大 / 缩小视图</span></div>
            <div class="help-row"><span class="help-key">B / I / C</span><span class="help-desc">二值化透视遮罩 (B) / 反相 (I) / 对比度 (C)</span></div>
          </div>
        </div>
        <div class="help-section">
          <div class="help-section-title">编辑历史与界面布局</div>
          <div class="help-grid">
            <div class="help-row"><span class="help-key">Ctrl+Z / Ctrl+Y</span><span class="help-desc">撤销 / 重做</span></div>
            <div class="help-row"><span class="help-key">Delete</span><span class="help-desc">删除当前选中的控制点或属种分列</span></div>
            <div class="help-row"><span class="help-key">Ctrl+[ / Ctrl+]</span><span class="help-desc">展开 / 折叠左侧属种分列列表 / 右侧属性检查器</span></div>
            <div class="help-row"><span class="help-key">Ctrl+,</span><span class="help-desc">呼出全局偏好与系统设置 (Settings)</span></div>
            <div class="help-row"><span class="help-key">F1</span><span class="help-desc">呼出 / 关闭本交互系统与快捷键速查中心</span></div>
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
