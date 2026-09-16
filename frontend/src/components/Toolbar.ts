import { BackendStatus } from '../types/rpc';
import { HistoryManager } from '../core/HistoryManager';
import { ImageDisplayMode } from '../core/Viewport';
import { ToolMode } from '../types/pollen';

export interface ToolbarCallbacks {
  onFit: () => void;
  onReset100: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDigitize: () => void;
  onExport: (format: 'csv' | 'json') => void;
  onOpenCalibrationModal: () => void;
  onToggleRpcConfig: () => void;
  onOpenFile: (file: File) => void;
  onLoadSample: (sampleKey: string) => void;
  onChangeImageMode: (mode: ImageDisplayMode) => void;
  onToggleBinaryOverlay: () => void;
  onChangeDegridStrength?: (strength: 'off' | 'weak' | 'medium' | 'strong') => void;
  onSelectToolMode?: (mode: ToolMode) => void;
  onAddColumn?: () => void;
  onDeleteSelected?: () => void;
  onSaveProject?: () => void;
  onOpenProjectFile?: (file: File) => void;
}

export class Toolbar {
  private element: HTMLElement;
  private history: HistoryManager;
  private backendStatus: BackendStatus;
  private callbacks: ToolbarCallbacks;
  private currentScaleText: string = '100%';
  private currentImageMode: ImageDisplayMode = 'normal';
  private isBinaryOverlayActive: boolean = false;
  private currentToolMode: ToolMode = 'select';
  private currentWorkflowStep: number = 3;
  private isDesktopMode: boolean = false;

  constructor(
    history: HistoryManager,
    backendStatus: BackendStatus,
    callbacks: ToolbarCallbacks
  ) {
    this.history = history;
    this.backendStatus = backendStatus;
    this.callbacks = callbacks;
    this.element = document.createElement('header');
    this.element.className = 'app-toolbar';
    this.render();
  }

  public setDesktopMode(isDesktop: boolean): void {
    this.isDesktopMode = isDesktop;
    this.render();
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public getImageMode(): ImageDisplayMode {
    return this.currentImageMode;
  }

  public setWorkflowStep(step: number): void {
    this.currentWorkflowStep = step;
    this.element.querySelectorAll('.workflow-step-btn').forEach((btn, idx) => {
      if (idx + 1 === step) {
        btn.classList.add('active-step');
      } else {
        btn.classList.remove('active-step');
      }
    });
  }

  public setToolMode(mode: ToolMode): void {
    this.currentToolMode = mode;
    this.element.querySelectorAll('[data-tool-mode]').forEach((el) => {
      if (el.getAttribute('data-tool-mode') === mode) {
        el.classList.add('active-mode');
      } else {
        el.classList.remove('active-mode');
      }
    });
  }

  public updateStatus(status: BackendStatus): void {
    this.backendStatus = status;
    if (typeof status.isDesktopMode === 'boolean' && status.isDesktopMode !== this.isDesktopMode) {
      this.isDesktopMode = status.isDesktopMode;
      this.render();
      return;
    }
    const rpcPill = this.element.querySelector('#rpc-status-pill');
    if (rpcPill) {
      rpcPill.className = `status-pill ${status.connected ? 'online' : 'mock'}`;
      const dot = rpcPill.querySelector('.status-dot');
      const text = rpcPill.querySelector('.status-text');
      if (text) text.textContent = status.connected ? 'RPC: Online' : 'Mock';
      if (dot && status.connected) (dot as HTMLElement).style.boxShadow = '0 0 8px #10b981';
    }
  }

  public updateScale(scale: number): void {
    this.currentScaleText = `${Math.round(scale * 100)}%`;
    const scaleEl = this.element.querySelector('#zoom-indicator');
    if (scaleEl) {
      scaleEl.textContent = this.currentScaleText;
    }
  }

  public updateFilterState(mode: ImageDisplayMode, binaryOverlay: boolean): void {
    this.currentImageMode = mode;
    this.isBinaryOverlayActive = binaryOverlay;

    const binaryBtn = this.element.querySelector('#btn-toggle-binary') as HTMLButtonElement;
    if (binaryBtn) {
      if (binaryOverlay || mode === 'binary') {
        binaryBtn.classList.add('active');
      } else {
        binaryBtn.classList.remove('active');
      }
    }

    const modeSelect = this.element.querySelector('#select-image-mode') as HTMLSelectElement;
    if (modeSelect) {
      modeSelect.value = mode;
    }
  }

  public updateHistoryState(): void {
    const undoBtn = this.element.querySelector('#btn-undo') as HTMLButtonElement;
    const redoBtn = this.element.querySelector('#btn-redo') as HTMLButtonElement;
    if (undoBtn) undoBtn.disabled = !this.history.canUndo();
    if (redoBtn) redoBtn.disabled = !this.history.canRedo();
  }

  public render(): void {
    const isConnected = this.backendStatus.connected;

    this.element.innerHTML = `
      <div class="toolbar-left">
        <div class="brand">
          <div class="brand-logo">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M3 3v18h18M7 16l4-8 4 6 5-10" />
            </svg>
          </div>
          <span class="brand-name">Straditize <span style="background: linear-gradient(135deg, #0284c7, #38bdf8); color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; margin-left: 3px; letter-spacing: 0.5px;">PRO</span></span>
        </div>

        <div class="divider"></div>

        <div class="btn-group file-actions-group">
          <button id="btn-open-file" class="tool-btn open-file-btn highlight" title="打开本地地质图谱图片">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
            </svg>
            <span>图谱</span>
          </button>
          <input type="file" id="file-input-image" accept="image/*" style="display: none;" />

          <button id="btn-save-project" class="tool-btn" title="保存完整地质数字化项目 (.tar 开放归档) 供后续二次修改与复用">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>存项目</span>
          </button>

          <button id="btn-open-project" class="tool-btn" title="打开已有数字化项目 (.tar / .json)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span>开项目</span>
          </button>
          <input type="file" id="file-input-project" accept=".tar,.json,.tar.gz" style="display: none;" />

          <select id="select-sample-diagram" class="sample-select" title="快速载入内置地学范例" style="max-width: 85px; font-size: 11px;">
            <option value="" disabled selected>📂 范例...</option>
            <option value="hoya">Hoya</option>
            <option value="verification">验证图谱</option>
            <option value="beginner">沉积图谱</option>
          </select>
        </div>
      </div>

      <div class="toolbar-center">
        <!-- 现代化 4 步地学工作流导引 (Workflow Stepper) -->
        <div class="workflow-stepper">
          <button class="workflow-step-btn ${this.currentWorkflowStep === 1 ? 'active-step' : ''}" id="step-btn-load" title="第 1 步：打开本地图谱或内置经典地学范例">
            <span class="step-num">1</span>
            <span>载入</span>
          </button>
          <span class="workflow-arrow">›</span>
          <button class="workflow-step-btn ${this.currentWorkflowStep === 2 ? 'active-step' : ''}" id="step-btn-roi" title="第 2 步：调整地质数据有效区与顶底物理深度">
            <span class="step-num">2</span>
            <span>有效区</span>
          </button>
          <span class="workflow-arrow">›</span>
          <button class="workflow-step-btn ${this.currentWorkflowStep === 3 ? 'active-step' : ''}" id="step-btn-columns" title="第 3 步：确认各花粉属种分列线与两点式物理刻度">
            <span class="step-num">3</span>
            <span>分列刻度</span>
          </button>
          <span class="workflow-arrow">›</span>
          <button class="workflow-step-btn ${this.currentWorkflowStep === 4 ? 'active-step' : ''}" id="step-btn-export" title="第 4 步：运行数字化并导出科学表格">
            <span class="step-num">4</span>
            <span>导出</span>
          </button>
        </div>

        <div class="divider"></div>

        <!-- 显式 6 大工具模式工具箱 -->
        <div class="btn-group tool-mode-group">
          <button class="tool-btn ${this.currentToolMode === 'select' ? 'active-mode' : ''}" data-tool-mode="select" title="选择与微调模式 (快捷键: V)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m3 3 7 18 3-7 7-3L3 3z"/>
            </svg>
            <span>选择 (V)</span>
          </button>

          <button class="tool-btn ${this.currentToolMode === 'pan' ? 'active-mode' : ''}" data-tool-mode="pan" title="抓手平移模式 (快捷键: H / 空格)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 11V6a2 2 0 0 0-4 0v3M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8M6 14v-2a2 2 0 0 0-4 0v5a7 7 0 0 0 7 7h3a7 7 0 0 0 7-7v-6a2 2 0 0 0-4 0"/>
            </svg>
            <span>抓手 (H)</span>
          </button>

          <button class="tool-btn ${this.currentToolMode === 'roi' ? 'active-mode' : ''}" data-tool-mode="roi" title="数据有效区 ROI 工具 (快捷键: R)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>
            </svg>
            <span>数据区 (R)</span>
          </button>

          <button class="tool-btn ${this.currentToolMode === 'addCol' ? 'active-mode' : ''}" data-tool-mode="addCol" title="添加分列线 (快捷键: C)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="19" y1="5" x2="19" y2="19" stroke-dasharray="2 2"/>
            </svg>
            <span>+列 (C)</span>
          </button>

          <button class="tool-btn ${this.currentToolMode === 'addPoint' ? 'active-mode' : ''}" data-tool-mode="addPoint" title="添加控制拐点 (快捷键: P)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="4" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
            </svg>
            <span>+点 (P)</span>
          </button>

          <button class="tool-btn ${this.currentToolMode === 'eraser' ? 'active-mode' : ''}" data-tool-mode="eraser" title="删除工具 (快捷键: E)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>
            </svg>
            <span>删 (E)</span>
          </button>
        </div>
      </div>

      <div class="toolbar-right">
        <!-- 视图缩放控制 -->
        <div class="btn-group">
          <button id="btn-zoom-out" class="tool-btn" title="缩小">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
          <span id="zoom-indicator" class="zoom-badge" style="min-width: 32px; font-size: 10px;">${this.currentScaleText}</span>
          <button id="btn-zoom-in" class="tool-btn" title="放大">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
        </div>

        <!-- 滤镜与二值透视 -->
        <div class="btn-group" style="display: flex; align-items: center; gap: 4px;">
          <button id="btn-toggle-binary" class="tool-btn ${this.isBinaryOverlayActive ? 'active' : ''}" title="二值化墨迹透视遮罩 (快捷键: B)">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 3v18A9 9 0 0 0 12 3z" fill="currentColor"/>
            </svg>
            <span>透视 [B]</span>
          </button>
          <select id="select-degrid-strength" class="sample-select" title="去网格横线灵敏度 (配合 B 键红色高亮预览切除效果)" style="font-size: 10px; max-width: 68px; padding: 2px 3px;">
            <option value="off">去线:关</option>
            <option value="weak">去线:弱</option>
            <option value="medium" selected>去线:中</option>
            <option value="strong">去线:强</option>
          </select>
        </div>

        <!-- 撤销/重做 -->
        <div class="btn-group">
          <button id="btn-undo" class="tool-btn" title="撤销 (Ctrl+Z)" ${!this.history.canUndo() ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
            </svg>
          </button>
          <button id="btn-redo" class="tool-btn" title="重做 (Ctrl+Y)" ${!this.history.canRedo() ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/>
            </svg>
          </button>
        </div>

        <div class="dropdown-container">
          <button id="btn-export-csv" class="tool-btn export" title="导出为 CSV 表格" style="padding: 4px 7px; font-size: 11px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
            </svg>
            <span>导出 CSV</span>
          </button>
          <button id="btn-export-json" class="tool-btn export-sub" title="导出完整 JSON 数据" style="padding: 4px 5px; font-size: 10px;">JSON</button>
        </div>

        <!-- 日夜间主题切换按钮 -->
        <button id="btn-toggle-theme" class="tool-btn" title="切换日间模式 / 夜间模式 (快捷键: T)" style="padding: 4px 6px;">
          <svg id="theme-icon-moon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
          </svg>
          <span id="theme-text">主题</span>
        </button>

        <div id="rpc-status-pill" class="status-pill ${isConnected ? 'online' : 'mock'}" title="点击配置后端 JSON-RPC" style="padding: 3px 6px; font-size: 10px;">
          <span class="status-dot"></span>
          <span class="status-text">${isConnected ? 'RPC' : 'Mock'}</span>
        </div>

        ${this.isDesktopMode ? `
          <button id="btn-shutdown" class="tool-btn danger" title="退出程序并安全终止后台服务" style="background: rgba(239, 68, 68, 0.12); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.35); padding: 4px 8px; font-weight: 600; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
            </svg>
            <span>退出</span>
          </button>
        ` : ''}
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    // 桌面模式退出程序按钮
    this.element.querySelector('#btn-shutdown')?.addEventListener('click', async () => {
      if (!window.confirm('确定要退出 Straditize Pro 应用程序并停止后台服务吗？')) {
        return;
      }
      try {
        await fetch('/shutdown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'shutdown' }),
        });
      } catch {
        // Ignored as server shuts down immediately
      }
      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;background:rgba(15,23,42,0.95);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);';
      overlay.innerHTML = `
        <div style="background:#1e293b;padding:36px 48px;border-radius:12px;border:1px solid #334155;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.6);max-width:440px;">
          <div style="font-size:42px;margin-bottom:12px;">🛑</div>
          <h2 style="font-size:20px;font-weight:700;color:#f8fafc;margin:0 0 8px 0;">服务已安全终止</h2>
          <p style="font-size:14px;color:#94a3b8;margin:0 0 16px 0;">Straditize 后台进程已退出。</p>
          <p style="font-size:13px;color:#64748b;margin:0;">您可以安全关闭此浏览器标签页。</p>
        </div>
      `;
      document.body.appendChild(overlay);
    });

    // 现代化工作流步骤导引快速触发
    this.element.querySelector('#step-btn-load')?.addEventListener('click', () => {
      this.setWorkflowStep(1);
      (this.element.querySelector('#btn-open-file') as HTMLButtonElement)?.click();
    });

    this.element.querySelector('#step-btn-roi')?.addEventListener('click', () => {
      this.setWorkflowStep(2);
      this.callbacks.onSelectToolMode?.('roi');
      this.callbacks.onOpenCalibrationModal();
    });

    this.element.querySelector('#step-btn-columns')?.addEventListener('click', () => {
      this.setWorkflowStep(3);
      this.callbacks.onSelectToolMode?.('select');
    });

    this.element.querySelector('#step-btn-export')?.addEventListener('click', () => {
      this.setWorkflowStep(4);
      this.callbacks.onExport('csv');
    });

    // 工具模式切换
    this.element.querySelectorAll('[data-tool-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-tool-mode') as ToolMode;
        if (mode && this.callbacks.onSelectToolMode) {
          this.callbacks.onSelectToolMode(mode);
        }
      });
    });

    // 视图操作
    this.element.querySelector('#btn-fit')?.addEventListener('click', () => this.callbacks.onFit());
    this.element.querySelector('#btn-100')?.addEventListener('click', () => this.callbacks.onReset100());
    this.element.querySelector('#btn-zoom-in')?.addEventListener('click', () => this.callbacks.onZoomIn());
    this.element.querySelector('#btn-zoom-out')?.addEventListener('click', () => this.callbacks.onZoomOut());
    this.element.querySelector('#btn-undo')?.addEventListener('click', () => this.callbacks.onUndo());
    this.element.querySelector('#btn-redo')?.addEventListener('click', () => this.callbacks.onRedo());
    this.element.querySelector('#btn-digitize')?.addEventListener('click', () => this.callbacks.onDigitize());
    this.element.querySelector('#btn-calibrate')?.addEventListener('click', () => this.callbacks.onOpenCalibrationModal());
    this.element.querySelector('#btn-export-csv')?.addEventListener('click', () => this.callbacks.onExport('csv'));
    this.element.querySelector('#btn-export-json')?.addEventListener('click', () => this.callbacks.onExport('json'));
    this.element.querySelector('#rpc-status-pill')?.addEventListener('click', () => this.callbacks.onToggleRpcConfig());

    // 日间/夜间主题切换
    this.element.querySelector('#btn-toggle-theme')?.addEventListener('click', () => {
      const isLight = document.body.classList.toggle('theme-light');
      const textEl = this.element.querySelector('#theme-text');
      const iconEl = this.element.querySelector('#theme-icon-moon');
      if (textEl) {
        textEl.textContent = isLight ? '夜间' : '日间';
      }
      if (iconEl) {
        iconEl.innerHTML = isLight
          ? `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>`
          : `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`;
      }
    });

    // 保存与打开项目文件
    this.element.querySelector('#btn-save-project')?.addEventListener('click', () => {
      this.callbacks.onSaveProject?.();
    });

    const projectFileInput = this.element.querySelector('#file-input-project') as HTMLInputElement;
    const openProjectBtn = this.element.querySelector('#btn-open-project');

    openProjectBtn?.addEventListener('click', () => {
      projectFileInput?.click();
    });

    projectFileInput?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        this.callbacks.onOpenProjectFile?.(files[0]);
        projectFileInput.value = '';
      }
    });

    // 打开文件相关
    const fileInput = this.element.querySelector('#file-input-image') as HTMLInputElement;
    const openBtn = this.element.querySelector('#btn-open-file');

    openBtn?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        this.callbacks.onOpenFile(files[0]);
        // 重置 input value 以便允许重复选择同名文件
        fileInput.value = '';
      }
    });

    // 范例图谱下拉
    const sampleSelect = this.element.querySelector('#select-sample-diagram') as HTMLSelectElement;
    sampleSelect?.addEventListener('change', () => {
      const key = sampleSelect.value;
      if (key) {
        this.callbacks.onLoadSample(key);
      }
    });

    // 滤镜与二值化透视
    const binaryBtn = this.element.querySelector('#btn-toggle-binary');
    binaryBtn?.addEventListener('click', () => {
      this.callbacks.onToggleBinaryOverlay();
    });

    this.element.querySelector('#select-degrid-strength')?.addEventListener('change', (e) => {
      const val = (e.target as HTMLSelectElement).value as 'off' | 'weak' | 'medium' | 'strong';
      this.callbacks.onChangeDegridStrength?.(val);
    });

    const modeSelect = this.element.querySelector('#select-image-mode') as HTMLSelectElement;
    modeSelect?.addEventListener('change', () => {
      this.callbacks.onChangeImageMode(modeSelect.value as ImageDisplayMode);
    });
  }
}
