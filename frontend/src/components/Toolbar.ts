import { BackendStatus } from '../types/rpc';
import { HistoryManager } from '../core/HistoryManager';
import { ImageDisplayMode } from '../core/Viewport';
import { ToolMode } from '../types/pollen';
import { WORKFLOW_STEP_ITEMS } from '../types/workflow';
import { t } from '../i18n';

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
  onSelectToolMode?: (mode: ToolMode) => void;
  onAddColumn?: () => void;
  onDeleteSelected?: () => void;
  onSaveProject?: () => void;
  onOpenProjectFile?: (file: File) => void;
  onOpenAgeDepthModal?: () => void;
  onOpenMetadataModal?: () => void;
  onOpenOcrReviewModal?: () => void;
  onOpenSettings?: () => void;
  onToggleSidebar?: () => void;
  onToggleInspector?: () => void;
  onStepClick?: (step: number) => void;
  onResetAll?: () => void;
  /** 请求后端进程退出。进程控制不是数据 RPC，所以经回调交给 main.ts 统一下发。 */
  onShutdown?: () => void;
}

export class Toolbar {
  private element: HTMLElement;
  private history: HistoryManager;
  private backendStatus: BackendStatus;
  private callbacks: ToolbarCallbacks;
  private currentScaleText: string = '100%';
  private currentImageMode: ImageDisplayMode = 'normal';
  private isBinaryOverlayActive: boolean = false;
  private currentWorkflowStep: number = 3;
  private isDesktopMode: boolean = false;
  private viewControlsHost: HTMLElement | null = null;

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

  public setSidebarActive(_active: boolean): void {
    // 侧边栏开关已收敛至侧边栏自身内部折叠按钮与边缘悬浮拉手
  }

  public setInspectorActive(_active: boolean): void {
    // 检查器开关已收敛至检查器自身内部折叠按钮与边缘悬浮拉手
  }

  public setDesktopMode(isDesktop: boolean): void {
    this.isDesktopMode = isDesktop;
    this.render();
  }

  /**
   * 底部画布视口栏宿主。设置后，缩放组与透视组会在每次 render 后被搬进该容器，
   * 让它们留在画布底部（就近操作画布），而非占用顶栏宽度。
   */
  public setViewControlsHost(host: HTMLElement): void {
    this.viewControlsHost = host;
    this.relocateViewControls();
  }

  private relocateViewControls(): void {
    if (!this.viewControlsHost) return;
    const ids = ['tb-view-group', 'tb-binary-group'];
    // render() 会重建节点，但不会清掉已搬走的旧节点 —— 先清除遗留，避免重复 ID
    for (const id of ids) {
      this.viewControlsHost.querySelector('#' + id)?.remove();
    }
    for (const id of ids) {
      const el = this.element.querySelector('#' + id);
      if (el) this.viewControlsHost.appendChild(el);
    }
  }

  public getElement(): HTMLElement {
    return this.element;
  }

  public getBackendStatus(): BackendStatus {
    return this.backendStatus;
  }

  public getImageMode(): ImageDisplayMode {
    return this.currentImageMode;
  }

  public setWorkflowStep(step: number): void {
    if (this.currentWorkflowStep === step) return;
    this.currentWorkflowStep = step;
    this.render();
  }

  public setToolMode(_mode: ToolMode): void {
    // 6 大工具模式已完全下沉至左下角 40x40 浮动工具条，避免顶栏重复冗余
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
      // 两种状态：RPC（真实后端）/ 离线（后端断开，不产出任何数据）。不存在第三种数据来源。
      rpcPill.className = `status-pill ${status.connected ? 'online' : 'mock'}`;
      const dot = rpcPill.querySelector('.status-dot');
      const text = rpcPill.querySelector('.status-text');
      if (text) {
        text.textContent = status.connected ? 'RPC: Online' : t('lang.badge') === 'EN' ? 'Offline' : '离线';
      }
      if (dot) {
        (dot as HTMLElement).style.boxShadow = status.connected ? '0 0 8px #10b981' : '0 0 8px #b91c1c';
      }
      rpcPill.setAttribute('title', status.connected ? 'JSON-RPC' : t('banner.backendLost'));
    }
  }

  public updateScale(scale: number): void {
    this.currentScaleText = `${Math.round(scale * 100)}%`;
    const scaleEl = document.getElementById('zoom-indicator');
    if (scaleEl) {
      scaleEl.textContent = this.currentScaleText;
    }
  }

  public updateFilterState(mode: ImageDisplayMode, binaryOverlay: boolean): void {
    this.currentImageMode = mode;
    this.isBinaryOverlayActive = binaryOverlay;

    const binaryBtn = document.getElementById('btn-toggle-binary') as HTMLButtonElement;
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
    // 构建标准 7 步工作流导引胶囊条
    const stepperHtml = WORKFLOW_STEP_ITEMS.map((item, idx) => {
      const isCompleted = item.step < this.currentWorkflowStep;
      const isCurrent = item.step === this.currentWorkflowStep;
      const cls = isCurrent ? 'active-step' : (isCompleted ? 'completed-step' : 'upcoming-step');
      return `
        ${idx > 0 ? `<span class="workflow-arrow" aria-hidden="true">›</span>` : ''}
        <button class="workflow-step-btn ${cls}" data-step="${item.step}" ${isCurrent ? 'aria-current="step"' : ''} title="${t('workflow.stepPrefix')} ${item.step}: ${item.name}${isCompleted ? ` (${t('workflow.completed')})` : ''}">
          <span class="step-num" aria-hidden="true">${item.step}</span>
          <span>${item.name}</span>
        </button>
      `;
    }).join('');

    this.element.innerHTML = `
      <div class="toolbar-left">
        <div class="brand">
          <div class="brand-logo" style="background: transparent; padding: 0;">
            <svg viewBox="0 0 512 512" width="20" height="20" style="border-radius: 4px; display: block;">
              <rect class="brand-icon-rect" x="64" y="64" width="384" height="384" rx="84" fill="#1E293B" />
              <path d="M 256 122 C 215 122, 202 144, 197 162 C 189 182, 138 195, 125 221 C 112 247, 163 260, 171 280 C 178 301, 155 326, 171 347 C 183 365, 215 379, 256 379 Z" fill="#E2E8F0" />
              <line x1="256" y1="102" x2="256" y2="398" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" />
              <g stroke="#2DD4BF" fill="#2DD4BF" stroke-width="4.5" stroke-linecap="round">
                <line x1="256" y1="138" x2="279" y2="138" /><circle cx="279" cy="138" r="8" stroke="none" />
                <line x1="256" y1="161" x2="305" y2="161" /><circle cx="305" cy="161" r="8" stroke="none" />
                <line x1="256" y1="184" x2="328" y2="184" /><circle cx="328" cy="184" r="8" stroke="none" />
                <line x1="256" y1="207" x2="310" y2="207" /><circle cx="310" cy="207" r="8" stroke="none" />
                <line x1="256" y1="230" x2="325" y2="230" /><circle cx="325" cy="230" r="8" stroke="none" />
                <line x1="256" y1="253" x2="348" y2="253" /><circle cx="348" cy="253" r="8" stroke="none" />
                <line x1="256" y1="276" x2="380" y2="276" /><circle cx="380" cy="276" r="8" stroke="none" />
                <line x1="256" y1="299" x2="353" y2="299" /><circle cx="353" cy="299" r="8" stroke="none" />
                <line x1="256" y1="322" x2="326" y2="322" /><circle cx="326" cy="322" r="8" stroke="none" />
                <line x1="256" y1="345" x2="303" y2="345" /><circle cx="303" cy="345" r="8" stroke="none" />
                <line x1="256" y1="368" x2="278" y2="368" /><circle cx="278" cy="368" r="8" stroke="none" />
              </g>
            </svg>
          </div>
          <span class="brand-name">Straditize <span style="background: var(--brand-gradient); color: #fff; font-size: 9.5px; font-weight: 700; padding: 1px 4px; border-radius: 4px; margin-left: 2px; letter-spacing: 0.5px;">PRO</span></span>
        </div>

        <div class="divider"></div>

        <div class="btn-group file-actions-group">
          <button id="btn-open-file" class="tool-btn ui-btn ui-btn--primary ui-btn--sm open-file-btn" title="${t('toolbar.diagramTitle')}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
            </svg>
            <span>${t('toolbar.diagram')}</span>
          </button>
          <input type="file" id="file-input-image" accept="image/*,.pdf,application/pdf" hidden />

          <button id="btn-save-project" class="tool-btn ui-btn ui-btn--secondary ui-btn--sm" title="${t('toolbar.saveProjTitle')}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
              <polyline points="7 3 7 8 15 8"/>
            </svg>
            <span>${t('toolbar.saveProj')}</span>
          </button>

          <button id="btn-open-project" class="tool-btn ui-btn ui-btn--secondary ui-btn--sm" title="${t('toolbar.openProjTitle')}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <span>${t('toolbar.openProj')}</span>
          </button>
          <input type="file" id="file-input-project" accept=".tar,.json,.tar.gz" hidden />

          <select id="select-sample-diagram" class="sample-select" title="${t('toolbar.sampleTitle')}">
            <option value="" disabled selected>${t('toolbar.sample')}</option>
            <option value="hoya">Hoya</option>
            <!--
              曾有 value="verification"（验证图谱）：它的图片是 scripts/verify_real_pollen_edit.py
              的产物、且被 .gitignore 的 verification_*.png 规则排除，任何全新克隆都拿不到 →
              选中必定 -32004 失败。后端 core.loadImage 仍保留该 key，只是不再作为菜单项暴露。
              新增选项前请确认图片真的随仓库分发：step1-load.spec.ts 会把每个可选项逐个载入。
            -->
            <option value="beginner">沉积图谱</option>
          </select>

          <button id="btn-reset-all" class="tool-btn ui-btn ui-btn--quiet ui-btn--sm reset-all-btn" title="${t('toolbar.resetTitle')}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>
            </svg>
            <span>${t('toolbar.reset')}</span>
          </button>

          <!-- 撤销/重做 -->
          <button id="btn-undo" class="tool-btn ui-icon-btn" aria-label="${t('toolbar.undoTitle')}" title="${t('toolbar.undoTitle')}" ${!this.history.canUndo() ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/>
            </svg>
          </button>
          <button id="btn-redo" class="tool-btn ui-icon-btn" aria-label="${t('toolbar.redoTitle')}" title="${t('toolbar.redoTitle')}" ${!this.history.canRedo() ? 'disabled' : ''}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="toolbar-center">
        <!-- 7 步工作流导引 Stepper -->
        <div class="workflow-stepper">
          ${stepperHtml}
        </div>
      </div>

      <div class="toolbar-right">
        <!-- 缩放控制 (10% ~ 1000%)：运行时被搬到底部画布视口栏 -->
        <div class="btn-group" id="tb-view-group">
          <button id="btn-zoom-out" class="tool-btn" title="${t('toolbar.zoomOutTitle')}" style="padding: 3px 5px;">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
          <span id="zoom-indicator" class="zoom-badge" style="min-width: 32px; font-size: 10px; cursor: pointer; padding: 2px 4px;" title="${t('toolbar.oneToOneTitle')}">${this.currentScaleText}</span>
          <button id="btn-zoom-in" class="tool-btn" title="${t('toolbar.zoomInTitle')}" style="padding: 3px 5px;">
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
            </svg>
          </button>
          <button id="btn-fit" class="tool-btn" title="${t('toolbar.fitTitle')}" style="padding: 3px 6px; font-size: 10.5px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3"/>
            </svg>
            <span>${t('toolbar.fit')}</span>
          </button>
          <button id="btn-100" class="tool-btn" title="${t('toolbar.oneToOneTitle')}" style="padding: 3px 6px; font-size: 10.5px;">
            <span>1:1</span>
          </button>
        </div>

        <!-- 滤镜与二值透视：运行时被搬到底部画布视口栏 -->
        <div class="btn-group" id="tb-binary-group" style="display: flex; align-items: center; gap: 3px;">
          <button id="btn-toggle-binary" class="tool-btn ${this.isBinaryOverlayActive ? 'active' : ''}" title="${t('toolbar.binaryTitle')}" style="padding: 3px 6px; font-size: 10.5px;">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="9"/>
              <path d="M12 3v18A9 9 0 0 0 12 3z" fill="currentColor"/>
            </svg>
            <span>${t('toolbar.binary')}</span>
          </button>
        </div>

        <!-- 论文与站点 FAIR / LiPD 元数据提取与录入入口 -->
        <button id="btn-metadata-modal" class="tool-btn ui-btn ui-btn--quiet ui-btn--sm" title="${t('toolbar.metadataTitle')}">
          <span>${t('toolbar.metadata')}</span>
        </button>

        <!-- 花粉属种名 OCR 自动识别与审核入口 (S3阶段高亮引导，S1/S2未分列阶段弱化) -->
        <button id="btn-ocr-review-modal" class="tool-btn ui-btn ui-btn--quiet ui-btn--sm ${this.currentWorkflowStep === 5 ? 'is-recommended' : ''}" title="${this.currentWorkflowStep < 5 ? t('toolbar.ocrTitleDisabled') : t('toolbar.ocrTitle')}" ${this.currentWorkflowStep < 5 ? 'disabled' : ''}>
          <span>${t('toolbar.ocr')}</span>
        </button>

        <!-- 年代-深度模型视觉检查与解译入口 -->
        <button id="btn-age-depth-modal" class="tool-btn ui-btn ui-btn--quiet ui-btn--sm" title="${t('toolbar.ageDepthTitle')}">
          <span>${t('toolbar.ageDepth')}</span>
        </button>

        <!-- 导出主按钮 -->
        <button id="btn-export-csv" class="ui-btn ui-btn--primary ui-btn--sm" title="${t('toolbar.exportTitle')}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          <span>${t('toolbar.export')}</span>
        </button>

        <!-- 唯一常驻偏好入口：[设置] 齿轮图标按钮 -->
        <button id="btn-settings" class="tool-btn ui-btn ui-btn--secondary ui-btn--sm" title="${t('toolbar.settingsTitle')}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          <span>${t('toolbar.settings')}</span>
        </button>

        ${this.isDesktopMode ? `
          <button id="btn-shutdown" class="tool-btn ui-icon-btn" aria-label="${t('toolbar.shutdownTitle')}" title="${t('toolbar.shutdownTitle')}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
            </svg>
          </button>
        ` : ''}
      </div>
    `;

    this.bindEvents();
    this.relocateViewControls();
  }

  private bindEvents(): void {
    // 桌面模式退出程序按钮
    this.element.querySelector('#btn-shutdown')?.addEventListener('click', async () => {
      if (!window.confirm('确定要退出并关闭 Straditize 本地服务吗？')) {
        return;
      }
      if (typeof (window as any).__straditize_suppress_beforeunload === 'function') {
        (window as any).__straditize_suppress_beforeunload();
      }
      const isLight = document.body.classList.contains('theme-light');
      const overlay = document.createElement('div');
      overlay.id = 'shutdown-overlay';
      overlay.style.cssText =
        `position:fixed;inset:0;background:${isLight ? 'rgba(241,245,249,0.92)' : 'rgba(15,23,42,0.95)'};z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);`;
      overlay.innerHTML = `
        <div style="background:var(--bg-card);padding:36px 48px;border-radius:12px;border:1px solid var(--border-color);text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);max-width:440px;">
          <div style="font-size:36px;margin-bottom:12px;color:#10b981;line-height:1;">✓</div>
          <h2 style="font-size:18px;font-weight:700;color:var(--text-heading);margin:0 0 10px 0;">Straditize 服务已安全退出</h2>
          <p style="font-size:13.5px;color:var(--text-secondary);margin:0;line-height:1.6;">您可以安全关闭此浏览器标签页。</p>
        </div>
      `;
      document.body.appendChild(overlay);

      try {
        await this.callbacks.onShutdown?.();
      } catch {
        // Ignored as server shuts down immediately
      }
    });

    // 现代化 7 步工作流导引胶囊点击触发
    this.element.querySelectorAll('.workflow-step-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const step = parseInt(btn.getAttribute('data-step') || '1', 10);
        this.setWorkflowStep(step);
        this.callbacks.onStepClick?.(step);
      });
    });

    // 视图操作
    this.element.querySelector('#btn-fit')?.addEventListener('click', () => this.callbacks.onFit());
    this.element.querySelector('#btn-100')?.addEventListener('click', () => this.callbacks.onReset100());

    // 缩放百分比徽标：点击即回到 100% 原始尺寸
    this.element.querySelector('#zoom-indicator')?.addEventListener('click', () => this.callbacks.onReset100());
    // 重置当前图谱的全部操作
    this.element.querySelector('#btn-reset-all')?.addEventListener('click', () => this.callbacks.onResetAll?.());
    this.element.querySelector('#btn-zoom-in')?.addEventListener('click', () => this.callbacks.onZoomIn());
    this.element.querySelector('#btn-zoom-out')?.addEventListener('click', () => this.callbacks.onZoomOut());
    this.element.querySelector('#btn-undo')?.addEventListener('click', () => this.callbacks.onUndo());
    this.element.querySelector('#btn-redo')?.addEventListener('click', () => this.callbacks.onRedo());
    this.element.querySelector('#btn-digitize')?.addEventListener('click', () => this.callbacks.onDigitize());
    this.element.querySelector('#btn-calibrate')?.addEventListener('click', () => this.callbacks.onOpenCalibrationModal());
    this.element.querySelector('#btn-metadata-modal')?.addEventListener('click', () => this.callbacks.onOpenMetadataModal?.());
    this.element.querySelector('#btn-ocr-review-modal')?.addEventListener('click', () => this.callbacks.onOpenOcrReviewModal?.());
    this.element.querySelector('#btn-age-depth-modal')?.addEventListener('click', () => this.callbacks.onOpenAgeDepthModal?.());
    this.element.querySelector('#btn-export-csv')?.addEventListener('click', () => this.callbacks.onExport('csv'));
    this.element.querySelector('#btn-export-json')?.addEventListener('click', () => this.callbacks.onExport('json'));
    this.element.querySelector('#btn-settings')?.addEventListener('click', () => this.callbacks.onOpenSettings?.());

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

    const modeSelect = this.element.querySelector('#select-image-mode') as HTMLSelectElement;
    modeSelect?.addEventListener('change', () => {
      this.callbacks.onChangeImageMode(modeSelect.value as ImageDisplayMode);
    });
  }
}
