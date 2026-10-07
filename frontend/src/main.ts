import './style.css';
import { RpcClient } from './services/RpcClient';
import { HistoryManager } from './core/HistoryManager';
import { GeologyCanvas } from './components/GeologyCanvas';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PropertyPanel } from './components/PropertyPanel';
import { ExportModal } from './components/ExportModal';
import { ProjectManager } from './core/ProjectManager';
import { Inspector } from './components/Inspector';
import { ResizeRoiCommand } from './core/Commands';
import { AgeDepthModal } from './components/AgeDepthModal';
import { MetadataModal } from './components/MetadataModal';
import { OcrReviewModal } from './components/OcrReviewModal';
import { SettingsModal } from './components/SettingsModal';
import { AuthModal } from './components/AuthModal';
import { DataRoi, DiagramCalibration, DiagramData, HistorySnapshot, LineCandidate, LineMaskStroke, Point2D } from './types/pollen';
import { onLocaleChange, applyLocaleToDocument, getLocale, t } from './i18n';
import { ImageDisplayMode } from './core/Viewport';
import { STAGE, visibleLayers } from './core/WorkflowStage';
import { WORKFLOW_STAGES, WorkflowStage } from './types/workflow';

/**
 * 数据来源闸门（Data Provenance Gate）
 *
 * 设计原则：面向用户的数据只有一个合法来源 —— 后端真实计算。
 * 历史上后端不可达时会静默降级为 Mock，返回前端编造的分列边界、随机抖动的曲线、
 * 固定名单的属种名，用户无法分辨，可能直接当成科研成果导出。该通路已整体删除。
 *
 * 因此这里没有"进入演示模式"这一退路：没有后端就没有结果，只能重连。
 */
function showProvenanceGate(message: string): Promise<void> {
  return new Promise((resolve) => {
    const isLight = document.body.classList.contains('theme-light');
    const overlay = document.createElement('div');
    overlay.id = 'provenance-gate';
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;' +
      'backdrop-filter:blur(10px);background:' +
      (isLight ? 'rgba(241,245,249,0.94)' : 'rgba(15,23,42,0.95)') + ';';
    overlay.innerHTML = `
      <div style="max-width:520px;padding:32px 36px;border-radius:14px;background:var(--bg-card);border:1px solid var(--border-color);box-shadow:0 25px 50px -12px rgba(0,0,0,0.3);">
        <h2 style="margin:0 0 10px;font-size:17px;font-weight:700;color:var(--text-heading);">${t('banner.backendOffline')}</h2>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.65;color:var(--text-secondary);">${message}</p>
        <p style="margin:0 0 20px;font-size:12.5px;line-height:1.65;color:var(--text-muted);">${t('gate.hint')}</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="gate-retry" class="btn btn-primary" style="padding:8px 16px;font-size:13px;font-weight:600;">${t('banner.reconnect')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#gate-retry')?.addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
  });
}

/**
 * 统一的后端失败上报。
 * 移除静默兜底后，后端错误会真的冒泡到这里；必须显式告知用户，
 * 且提供可直接划选和复制的富文本弹窗，取代阻塞且不可复制的原生 window.alert。
 *
 * 只走**一个**通道（可复制的详情弹窗），不叠加 toast：一次失败对应一个通知。
 * 叠加会让同一次失败同时出现在 toast 和弹窗里，用户读两遍同样的信息；
 * 且后端 detail 往往很长，toast 会截断并自动消失，反而不如弹窗可留可复制。
 */
export function reportBackendFailure(actionLabel: string, err: unknown): void {
  const message = (err as Error)?.message || t('error.unknown');
  console.error(`[RPC failure] ${actionLabel}:`, err);

  const existing = document.getElementById('rpc-error-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'rpc-error-modal';
  overlay.className = 'modal-backdrop';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);background:rgba(0,0,0,0.65);';

  const fullErrText = `[错误模块] ${actionLabel}\n[错误原因]\n${message}`;

  const escapeHtml = (str: string) =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  overlay.innerHTML = `
    <div class="modal-dialog ui-modal" style="--modal-width: 560px;">
      <div class="ui-modal__header">
        <h3 class="ui-modal__title">${escapeHtml(actionLabel)}失败</h3>
        <button id="rpc-err-close-x" class="ui-icon-btn" aria-label="关闭" title="关闭">&times;</button>
      </div>
      <div class="modal-body ui-modal__body">
        <p class="ui-detail-hint">后端执行操作时报告了以下错误或状态异常：</p>
        <pre class="ui-detail-text">${escapeHtml(message)}</pre>
      </div>
      <div class="ui-modal__footer">
        <button id="rpc-err-copy-btn" class="ui-btn ui-btn--secondary ui-btn--sm">复制错误详情</button>
        <button id="rpc-err-ok-btn" class="ui-btn ui-btn--primary ui-btn--sm">关闭</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeModal = () => overlay.remove();
  overlay.querySelector('#rpc-err-close-x')?.addEventListener('click', closeModal);
  overlay.querySelector('#rpc-err-ok-btn')?.addEventListener('click', closeModal);

  const copyBtn = overlay.querySelector('#rpc-err-copy-btn') as HTMLButtonElement | null;
  copyBtn?.addEventListener('click', async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullErrText);
      } else {
        const ta = document.createElement('textarea');
        ta.value = fullErrText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      copyBtn.textContent = '已复制到剪贴板';
      setTimeout(() => {
        if (copyBtn) copyBtn.textContent = '复制错误详情';
      }, 2000);
    } catch {
      copyBtn.textContent = '复制失败，请手动划选';
    }
  });
}

/** 后端未连接时阻塞启动，直到连上为止（没有演示模式这一退路） */
async function ensureDataProvenance(rpcClient: RpcClient): Promise<void> {
  for (;;) {
    await rpcClient.probeBackend();
    if (rpcClient.isAuthNeeded()) {
      // 正在等待密码验证，不弹出后端离线遮罩
      return;
    }
    if (rpcClient.getStatus().connected) return;
    // 如果已经弹出了密码解锁模态（document.getElementById('auth-gate-modal')），不显示后端离线遮罩
    if (document.getElementById('auth-gate-modal')) {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    await showProvenanceGate(t('error.backendOffline'));
  }
}

/** 离线状态常驻横幅：只要后端断开，界面就必须一直说清楚，避免用户误以为结果仍可信 */
function mountProvenanceBanner(rpcClient: RpcClient): void {
  const bar = document.createElement('div');
  bar.id = 'provenance-banner';
  bar.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:99998;display:none;align-items:center;justify-content:center;' +
    'gap:10px;padding:5px 12px;font-size:12px;font-weight:600;letter-spacing:0.2px;';
  document.body.appendChild(bar);

  const render = () => {
    const status = rpcClient.getStatus();
    if (!status.connected) {
      bar.style.display = 'flex';
      bar.style.background = '#b91c1c';
      bar.style.color = '#fff';
      bar.innerHTML =
        `<span>${t('banner.backendLost')}</span>` +
        `<button id="banner-retry" style="background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.45);color:#fff;border-radius:4px;padding:1px 8px;font-size:11px;cursor:pointer;">${t('banner.reconnect')}</button>`;
      bar.querySelector('#banner-retry')?.addEventListener('click', () => {
        rpcClient.probeBackend().then(render);
      });
    } else {
      bar.style.display = 'none';
    }
    // 顶栏与主体让出横幅高度，避免遮挡
    const app = document.getElementById('app');
    if (app) app.style.paddingTop = bar.style.display === 'flex' ? '26px' : '';
  };

  rpcClient.setStatusCallback(render);
  render();
}

async function bootstrap() {
  const appContainer = document.getElementById('app');
  if (!appContainer) throw new Error('Missing #app container');

  // 0. 恢复上次选择的语言并同步 <html lang>（必须在任何组件渲染之前执行）
  applyLocaleToDocument();

  // 0.1 恢复上次选择的主题外观 (默认日间模式)
  const savedTheme = localStorage.getItem('straditize-theme');
  if (savedTheme === 'dark') {
    document.body.classList.remove('theme-light');
  } else {
    document.body.classList.add('theme-light');
  }

  // 1. 初始化 JSON-RPC Client，并阻塞式确认数据来源（后端真实计算 / 用户显式演示模式）
  const rpcClient = new RpcClient();
  let authModalInstance: AuthModal | null = null;
  rpcClient.onAuthRequired(() => {
    // 隐藏后端离线弹窗，让出焦点给密码输入框
    const gate = document.getElementById('provenance-gate');
    if (gate) gate.remove();
    if (!authModalInstance) {
      authModalInstance = new AuthModal(rpcClient, () => {
        authModalInstance = null;
        window.location.reload();
      });
      authModalInstance.show();
    }
  });

  await ensureDataProvenance(rpcClient);

  // 1.5 如果需要密码认证，挂起主应用初始化流程，直到密码解锁成功（解锁回调会调用 reload）
  if (rpcClient.isAuthNeeded()) {
    return;
  }

  mountProvenanceBanner(rpcClient);

  // 2. 获取初始图谱数据。失败必须暴露，不再用任何替代数据蒙混。
  let initialData: DiagramData;
  try {
    initialData = await rpcClient.getDiagramData();
  } catch (err) {
    console.error('[bootstrap] 初始工程数据获取失败:', err);
    showProvenanceGate((err as Error).message || t('error.unknown')).then(() => window.location.reload());
    return;
  }

  // 2.1 同步用户自定义属种词汇表到前端纠错词典。
  //     前后端共用同一份词表，否则侧边栏"批量导入名单"认不出用户在
  //     OCR 弹窗里补充的属种（例如盘星藻、摇蚊等 NPP 与地方特有种）。
  try {
    const synced = await rpcClient.syncCustomTaxaToGlossary();
    if (synced > 0) {
      console.info(`[bootstrap] 已载入 ${synced} 条用户自定义属种词汇`);
    }
  } catch (err) {
    console.warn('[bootstrap] 自定义词汇表同步失败（不影响主流程）:', err);
  }

  // 3. 初始化历史状态管理器 (支持 500 步命令撤销/重做)
  const history = new HistoryManager(500);
  history.reset(initialData.columns, initialData.activeTaxaId, initialData.calibration, initialData.roi);

  // 自动暂存与草稿防翻车保护 (Autosave & Recovery Protection)
  const AUTOSAVE_KEY = 'straditize_autosave_draft_v2';
  let autosaveTimer: number | null = null;
  function scheduleAutosave() {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      try {
        const draft = {
          timestamp: Date.now(),
          data: canvasComponent.data,
        };
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(draft));
      } catch {
        // 忽略配额错误
      }
    }, 1000);
  }

  let isShuttingDown = false;
  (window as any).__straditize_suppress_beforeunload = () => {
    isShuttingDown = true;
  };

  window.addEventListener('beforeunload', (e) => {
    if (isShuttingDown) return;
    if (history.canUndo()) {
      e.preventDefault();
      e.returnValue = '您有未保存的地学数字化工程修改，确定离开吗？';
    }
  });

  let sidebar: any = null;
  let inspector: any = null;
  let toolbar: any = null;

  // 4. 构建工作区 DOM
  const workspace = document.createElement('main');
  workspace.className = 'app-workspace';

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'canvas-wrapper';

  // 左右抽屉展开把手 (Drawer Tabs) - 直接挂载在 workspace 边缘，折叠时永远清晰可见
  const leftDrawerTab = document.createElement('div');
  leftDrawerTab.className = 'drawer-toggle-tab left-tab';
  leftDrawerTab.style.display = 'none';
  workspace.appendChild(leftDrawerTab);

  const rightDrawerTab = document.createElement('div');
  rightDrawerTab.className = 'drawer-toggle-tab right-tab';
  rightDrawerTab.style.display = 'none';
  workspace.appendChild(rightDrawerTab);

  function updateDrawers() {
    leftDrawerTab.title = t('drawer.taxaTitle');
    leftDrawerTab.innerHTML = `<span>›</span><span>${t('drawer.taxa')}</span>`;
    rightDrawerTab.title = t('drawer.inspectorTitle');
    rightDrawerTab.innerHTML = `<span>‹</span><span>${t('drawer.inspector')}</span>`;
  }
  updateDrawers();

  // 恢复上次关闭时的侧边栏与检查器折叠记忆状态 (localStorage 持久化)
  const SIDEBAR_COLLAPSED_KEY = 'straditize_sidebar_collapsed';
  const INSPECTOR_COLLAPSED_KEY = 'straditize_inspector_collapsed';

  const initialSidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  const initialInspectorCollapsed = localStorage.getItem(INSPECTOR_COLLAPSED_KEY) === 'true';

  function setSidebarCollapsed(collapsed: boolean) {
    if (sidebar) sidebar.setCollapsed(collapsed);
    leftDrawerTab.style.display = collapsed ? 'flex' : 'none';
    if (toolbar) toolbar.setSidebarActive(!collapsed);
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    setHudNotice(collapsed ? t('hud.sidebarCollapsed') : t('hud.sidebarExpanded'), 2000);
    canvasComponent.handleResize();
  }

  function setInspectorCollapsed(collapsed: boolean) {
    if (inspector) inspector.setCollapsed(collapsed);
    rightDrawerTab.style.display = collapsed ? 'flex' : 'none';
    if (toolbar) toolbar.setInspectorActive(!collapsed);
    localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(collapsed));
    setHudNotice(collapsed ? t('hud.inspectorCollapsed') : t('hud.inspectorExpanded'), 2000);
    canvasComponent.handleResize();
  }

  function toggleSidebar() {
    setSidebarCollapsed(!sidebar?.getIsCollapsed());
  }

  function toggleInspector() {
    setInspectorCollapsed(!inspector?.getIsCollapsed());
  }

  leftDrawerTab.addEventListener('click', () => setSidebarCollapsed(false));
  rightDrawerTab.addEventListener('click', () => setInspectorCollapsed(false));

  // 悬浮帮助折叠面板 (统一交互系统与快捷键速查中心)
  const helpPanel = document.createElement('div');
  helpPanel.className = 'floating-help-panel';
  helpPanel.style.display = 'none';
  canvasWrapper.appendChild(helpPanel);

  function renderHelpPanelContent() {
    const isEn = getLocale() === 'en';
    helpPanel.innerHTML = isEn ? `
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
    ` : `
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
    helpPanel.querySelector('#help-panel-close')?.addEventListener('click', () => {
      helpPanel.style.display = 'none';
    });
  }
  renderHelpPanelContent();

  function toggleHelpPanel() {
    const isHidden = helpPanel.style.display === 'none';
    helpPanel.style.display = isHidden ? 'block' : 'none';
  }

  helpPanel.querySelector('#help-panel-close')?.addEventListener('click', () => {
    helpPanel.style.display = 'none';
  });

  // 浮动 HUD 提示
  const hud = document.createElement('div');
  hud.className = 'canvas-hud';
  hud.innerHTML = `
    <span class="hud-dot"></span>
    <span id="hud-text">${t('hud.default')}</span>
  `;
  canvasWrapper.appendChild(hud);

  let hudTimer: number | null = null;
  // 步骤 4 不复用全局提示：那里的键位（A 加点 / D 删点）在本步不可用。
  // 注意 canvasComponent 在下方才声明，而本函数只在 setTimeout 回调与阶段切换时被调用，
  // 全都晚于其初始化，故不存在 TDZ 问题。
  const getDefaultHudText = () =>
    canvasComponent.workflowStage === STAGE.CLEANUP ? t('hud.cleanup') : t('hud.default');

  function setHudNotice(text: string, duration: number = 3000) {
    const hudTextEl = document.getElementById('hud-text');
    if (!hudTextEl) return;
    hudTextEl.textContent = text;

    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = window.setTimeout(() => {
      hudTextEl.textContent = getDefaultHudText();
      hudTimer = null;
    }, duration);
  }

  // 5. 底部状态栏 (28px 恒定，竖线视觉分区，重要参数加粗)
  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  footer.innerHTML = `
    <div class="footer-left" style="display: flex; align-items: center; gap: 8px;">
      <div class="footer-item" id="footer-dimensions">${t('footer.image')}: <code>${initialData.imageWidth}×${initialData.imageHeight}</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-zoom">${t('footer.zoom')}: <code>100%</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-cursor">${t('footer.cursor')}: <code>--</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-depth">${t('footer.depth')}: <strong style="font-size: 11.5px; color: var(--text-primary);">--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-pollen">${t('footer.abundance')}: <strong style="font-size: 11.5px; color: #38bdf8;">--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-tool-mode">${t('footer.mode')}: <strong>${t('footer.modeSelect')}</strong></div>
    </div>
    <div class="footer-right" style="display: flex; align-items: center; gap: 8px;">
      <div class="footer-item" id="footer-active-taxa">${t('footer.activeTaxa')}: <strong>--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-anchors">${t('footer.anchors')}: <code>--</code></div>
    </div>
  `;

  // —— Step 4 几何的三个共享回调 ——
  // 画布（下方构造）与侧栏检查器（916 行构造）用的是两个互相独立的回调对象，
  // 而这三件事两边都要：画布侧负责"拖完提交 / 按 Delete 或 D 删除 / 选中联动"，
  // 侧栏侧负责清单里的按钮。此前只写进了检查器那个对象，画布那侧全是 undefined，
  // 被 `?.()` 静默吞掉——表现为"图上拖拽新建、移动、改范围、删除全都没反应"。
  // 故在此定义一次，两处共用。
  const handleGeometryCommit = async (
    id: string | null,
    axis: 'h' | 'v',
    rect: { x0: number; y0: number; x1: number; y1: number }
  ): Promise<void> => {
    await runCleanupAction(id ? '移动几何' : '新建几何', async () => {
      const res = await rpcClient.upsertLineGeometry({
        roi_id: activeCleanupRoiId(),
        axis,
        candidate_id: id,
        geometry: rect,
        // 新建默认待确认：不确认就不动像素。
        status: 'candidate',
      });
      if (!id && res.candidates?.length) {
        // 新建后自动选中它，便于立刻微调。
        const created = res.candidates[res.candidates.length - 1];
        canvasComponent.setSelectedGeometryId(created.id);
      }
      return res;
    });
  };

  const handleGeometryDelete = async (id: string): Promise<void> => {
    await runCleanupAction('删除几何', () => rpcClient.deleteLineGeometry(id));
    setHudNotice('已删除该几何。');
  };

  /**
   * 画布侧选中 geometry → 侧栏「候选线清单」联动高亮。
   *
   * `CleanupPanel` 的选中样式本来就是读 `data.cleanup_selected_id` 渲染的，
   * 但此前没有任何地方在「画布选中」之后触发侧栏重绘，所以清单里看不到联动。
   * 这里补上重绘，并把选中行滚进可视区——候选常有 20+ 条，否则会停在列表顶部。
   */
  const handleGeometrySelected = (id: string | null): void => {
    inspector?.updateData(canvasComponent.data);
    if (!id) return;
    const row = document.querySelector(`.cleanup-row[data-cand-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  };

  // 6. 实例化画布组件
  const canvasComponent = new GeologyCanvas(canvasWrapper, initialData, history, {
    // Step 4 几何：画布侧拖拽提交 / 删除 / 选中联动，缺一个就静默失效。
    onGeometryCommit: handleGeometryCommit,
    onGeometryDelete: handleGeometryDelete,
    onGeometrySelected: handleGeometrySelected,
    onTaxaChange: (_taxaId) => {
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      updateFooter();
    },
    onDataChange: () => {
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      scheduleAutosave();
    },
    /**
     * 底图重新加载后，后端下发的叠加层已失效，必须重取一次。
     *
     * 否则 `loadNewDiagram`（十余处调用点）之后画布上只剩矢量几何，
     * 已确认剔除的红色像素预览消失——用户会以为清理没生效。
     */
    onDiagramReloaded: () => {
      const data = canvasComponent.data;
      const hasCleanup =
        (data.line_candidates || []).length > 0 || (data.exclusion_regions || []).length > 0;
      if (hasCleanup) {
        void recomposeCleanupState('重载后重算清理掩膜');
      }
    },
    // ROI 拖拽结束：后端的分列/去线都以 ROI 为范围，必须同步过去，
    // 否则画布上框选的是新范围、后端算的还是旧范围。
    onRoiCommitted: (roi) => {
      void enqueueRoiCommit(roi);
    },
    // Y 轴标定选点：无论是第 1 个点 (Y1) 还是第 2 个点 (Y2)，实时同步到 Step 3 侧边栏与画布
    onYCalibPicked: (marks) => {
      const cal = canvasComponent.data.calibration;
      if (marks.length === 1) {
        cal.top_px = marks[0].y;
        cal.bottom_px = null;
        cal.isCalibrated = false;
        inspector?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
      } else if (marks.length >= 2) {
        const topPx = marks[0].y;
        const botPx = marks[1].y;
        cal.top_px = topPx;
        cal.bottom_px = botPx;
        inspector?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
        if (cal.top_cm !== null && cal.top_cm !== undefined && cal.bottom_cm !== null && cal.bottom_cm !== undefined) {
          void applyDepthCalibration(marks, [Number(cal.top_cm), Number(cal.bottom_cm)], cal.unit || 'cm');
        } else {
          setHudNotice(`已拾取两点像素行 (Y1=${Math.round(topPx)}px, Y2=${Math.round(botPx)}px)！请在右侧侧栏输入对应真实数值并应用标定。`, 5000);
        }
      }
    },
    // 线掩膜人工修正笔迹：提交后端重算叠加层
    onLineFixStroke: (stroke) => {
      void appendLineFixStroke(stroke);
    },
    onHoverInfo: (info) => {
      const cursorEl = document.getElementById('footer-cursor');
      const depthEl = document.getElementById('footer-depth');
      const pollenEl = document.getElementById('footer-pollen');

      if (info) {
        if (cursorEl) cursorEl.innerHTML = `${t('footer.coords')}: <code>X:${info.worldX} Y:${info.worldY}</code>`;
        if (depthEl) {
          const unit = canvasComponent.data.calibration.unit;
          if (info.horizonDepth !== undefined && info.horizonDepth !== null) {
            depthEl.innerHTML = `${t('footer.depth')}: <code>${info.depth !== undefined ? info.depth + ' ' + unit : '--'}</code> <strong style="color: #38bdf8; margin-left: 6px;">[${t('footer.horizon')}: ${info.horizonDepth} ${unit}]</strong>`;
          } else {
            depthEl.innerHTML = `${t('footer.depth')}: <code>${info.depth !== undefined ? info.depth + ' ' + unit : '--'}</code>`;
          }
        }
        if (pollenEl) {
          pollenEl.innerHTML = `${t('footer.abundance')}: <code>${info.percent !== undefined ? info.percent + '%' : '--'}</code>`;
        }
      }
    },
    onFilterChange: (mode, binaryOverlay) => {
      toolbar?.updateFilterState(mode, binaryOverlay);
    },
    onDropFile: (file) => {
      handleOpenFile(file);
    },
    onStatusNotice: (text) => {
      setHudNotice(text, 2500);
    },
    /**
     * 叠加层渲染失败必须显式暴露。
     *
     * 画布原先用 `catch {}` 把叠加层异常整体吞掉，任何绘制错误的表现都是
     * "画布上什么都没有"——用户无法区分"没检测到"与"画错了"。
     */
    onOverlayError: (overlayId, error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[overlay] ${overlayId} 渲染失败:`, error);
      setHudNotice(`叠加层 ${overlayId} 渲染失败：${detail}`, 8000);
    },
    onOpenCalibration: () => {
      propertyPanel.openCalibrationModal();
    },
    onOpenFileDialog: () => {
      (document.getElementById('file-input-image') as HTMLInputElement)?.click();
    },
    onToggleHelp: () => {
      toggleHelpPanel();
    },
    // 画布内切换工具（A/S/D/C/H/R 快捷键与左下浮动工具条）时同步刷新底部状态栏模式标签。
    // 此前该回调未被接线，导致经画布切换工具后页脚「模式:」长期停留在旧值。
    onToolModeChange: (mode) => {
      const desc = canvasComponent.toolModeManager.getToolDescription(mode);
      const footerModeEl = document.getElementById('footer-tool-mode');
      if (footerModeEl) {
        footerModeEl.innerHTML = `${t('footer.mode')}: <strong>${desc.name} (${desc.shortcut})</strong>`;
      }
    },
  });

  // 6.1 语言切换订阅：文案是渲染时烧进 DOM 的，切语言必须重绘（与主题的纯 CSS 切换不同）。
  //     组件都持有数据，DOM 只是派生物，因此重绘是安全的。
  onLocaleChange(() => {
    applyLocaleToDocument();
    toolbar?.render();
    updateWorkflowBar();
    updateFooter();
    updateDrawers();
    renderHelpPanelContent();
    const hudTextEl = document.getElementById('hud-text');
    if (hudTextEl && !hudTimer) {
      hudTextEl.textContent = getDefaultHudText();
    }
  });

  // 6.2 显式分步推进状态机 (Step-by-Step Workflow State Machine)
  let currentStage: WorkflowStage = STAGE.LOAD;
  let roiCommitPromise: Promise<void> = Promise.resolve();
  canvasComponent.setWorkflowStage(currentStage);

  const workflowActionBar = document.createElement('div');
  workflowActionBar.className = 'workflow-action-bar';
  workflowActionBar.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 95;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 14px;
    width: 100%;
    box-sizing: border-box;
    font-size: 11px;
    overflow: hidden;
    pointer-events: auto;
  `;
  canvasWrapper.appendChild(workflowActionBar);

  // 底部画布视口栏（缩放 / 透视）：由 Toolbar 在每次 render 后把对应控件搬进来。
  // 放在画布底部是为了就近操作画布，并给顶栏的 7 步工作流导引条腾出宽度。
  const viewControlsBar = document.createElement('div');
  viewControlsBar.className = 'canvas-view-bar';
  viewControlsBar.id = 'canvas-view-bar';
  canvasWrapper.appendChild(viewControlsBar);

  async function advanceToWorkflowStage(targetStage: WorkflowStage): Promise<void> {
    if (!Number.isInteger(targetStage) || targetStage < STAGE.LOAD || targetStage > STAGE.QA) {
      throw new RangeError(`Invalid workflow stage: ${String(targetStage)}`);
    }
    if (targetStage >= STAGE.Y_CALIB) {
      await roiCommitPromise;
    }
    if (targetStage === STAGE.LOAD) {
      currentStage = STAGE.LOAD;
      updateWorkflowBar();
      canvasComponent.setToolMode('pan');
      canvasComponent.requestRender();
      if (!canvasComponent.data.imageSrc) {
        (document.getElementById('file-input-image') as HTMLInputElement)?.click();
      }
    } else if (targetStage === STAGE.ROI) {
      currentStage = STAGE.ROI;
      updateWorkflowBar();
      canvasComponent.setToolMode('roi');
      canvasComponent.requestRender();
      setHudNotice('已进入 Step 2 数据有效区 (ROI) 划分！请拖拽手柄界定数据区或在侧栏新建多 ROI。', 4500);
    } else if (targetStage === STAGE.Y_CALIB) {
      currentStage = STAGE.Y_CALIB;
      updateWorkflowBar();
      canvasComponent.setToolMode('ycalib');
      canvasComponent.requestRender();
      setHudNotice('已进入 Step 3 Y 轴标定！请在图上点选两点，或在右侧侧栏直接填入已知刻度与真实深度值。', 5000);
    } else if (targetStage === STAGE.CLEANUP) {
      currentStage = STAGE.CLEANUP;
      updateWorkflowBar();
      // 进入 Step 4 必须落在「微调/选择 (S)」上——`getAllowedTools(STAGE.CLEANUP)[0]` 就是
      // select。这里曾经硬写 'linefix'，于是用户一进第 4 步手上就是橡皮笔刷：点候选线不是
      // 选中而是涂改，白/青手柄根本够不着，表现成"工具栏缺了微调(S)""图上拖了没反应"。
      // 画笔只在用户显式点「擦掉误标 / 补回漏标」或拖排除区时才切过去。
      canvasComponent.setToolMode('select');
      canvasComponent.requestRender();
      // Step 4 进入即显示候选几何；用户只确认是否删除，不必先猜该点哪个按钮。
      // 这一步（refreshCleanup + applyCleanupState）本身就是掩膜重算，无需另行刷新。
      queueMicrotask(() => {
        (document.querySelector('#btn-detect-candidates') as HTMLButtonElement | null)?.click();
      });
      setHudNotice('已进入 Step 4 干扰清理！候选 geometry 正在生成，橙色待确认、红色已去除。', 4500);
    } else if (targetStage === STAGE.SPLIT) {
      const wfNextBtn = document.querySelector('#btn-wf-next') as HTMLButtonElement | null;
      if (wfNextBtn) {
        wfNextBtn.disabled = true;
        wfNextBtn.textContent = '正在切分属种基线...';
      }
      setHudNotice('正在基于数据有效区与清理后墨迹切分属种垂直基线，请稍候...', 5000);
      try {
        const rois = canvasComponent.data.rois || [];
        if (rois.length > 0) {
          for (const r of rois) {
            const xMin = r.xMin ?? r.xlim?.[0] ?? canvasComponent.data.roi.xMin;
            const xMax = r.xMax ?? r.xlim?.[1] ?? canvasComponent.data.roi.xMax;
            const yMin = r.yMin ?? r.ylim?.[0] ?? canvasComponent.data.roi.yMin;
            const yMax = r.yMax ?? r.ylim?.[1] ?? canvasComponent.data.roi.yMax;
            await rpcClient.detectColumnsInRoi({
              ...r,
              xMin,
              xMax,
              yMin,
              yMax,
            });
          }
        } else {
          await rpcClient.detectColumnsInRoi({ ...canvasComponent.data.roi });
        }
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
      } catch (err) {
        if (wfNextBtn) {
          wfNextBtn.disabled = false;
        }
        reportBackendFailure('分列识别', err);
        setHudNotice('分列识别失败，已停留在 Step 4。请检查有效区后重试。', 6000);
        return;
      }
      currentStage = STAGE.SPLIT;
      canvasComponent.setToolMode('select');
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      updateWorkflowBar();
      updateFooter();
      canvasComponent.requestRender();
      setHudNotice(`成功切分 ${canvasComponent.data.columns.length} 个属种列！可点击 OCR 识别或在左栏输入各列名称。`, 5000);
    } else if (targetStage === STAGE.CALIBRATE_COLUMNS) {
      currentStage = STAGE.CALIBRATE_COLUMNS;
      updateWorkflowBar();
      inspector?.updateData(canvasComponent.data);
      setHudNotice('已进入 Step 6 列标定！在侧边栏点击自动提取刻度齿，或双击端点手动标定。', 4500);
    } else if (targetStage === STAGE.SPEARS_AND_SAMPLES) {
      currentStage = STAGE.SPEARS_AND_SAMPLES;
      updateWorkflowBar();
      inspector?.updateData(canvasComponent.data);
      setHudNotice('已进入 Step 7 采样层位！点击侧栏【提取采样共识】或从外部粘贴真实层位。', 4500);
    } else if (targetStage === STAGE.QA) {
      currentStage = STAGE.QA;
      updateWorkflowBar();
      inspector?.updateData(canvasComponent.data);
      setHudNotice('已进入 Step 8 地学校验！正在核验组分总和 ≤100% 门禁与空层位排查。', 4000);
    }
  }

  function updateWorkflowBar() {
    const meta = WORKFLOW_STAGES[currentStage];
    canvasComponent.setWorkflowStage(currentStage);
    if (typeof toolbar !== 'undefined' && toolbar) {
      toolbar.setWorkflowStep(currentStage);
    }
    if (typeof inspector !== 'undefined' && inspector) {
      inspector.setWorkflowStage(currentStage);
    }

    workflowActionBar.innerHTML = `
      <div class="workflow-action-bar__context">
        <span class="workflow-action-bar__step">${currentStage}</span>
        <strong>${meta.stepName}</strong>
        <span class="workflow-action-bar__guide">${meta.guideText}</span>
      </div>
      <div class="workflow-action-bar__actions">
        ${currentStage > 1 ? `<button id="btn-wf-prev" class="ui-btn ui-btn--quiet ui-btn--sm">${t('workflow.prev')}</button>` : ''}
        ${meta.primaryActionLabel ? `<button id="btn-wf-next" class="ui-btn ui-btn--primary ui-btn--sm">${meta.primaryActionLabel}</button>` : ''}
      </div>
    `;

    workflowActionBar.querySelector('#btn-wf-prev')?.addEventListener('click', () => {
      if (currentStage > 1) {
        void advanceToWorkflowStage((currentStage - 1) as WorkflowStage);
      }
    });

    workflowActionBar.querySelector('#btn-wf-next')?.addEventListener('click', async () => {
      if (currentStage === STAGE.QA) {
        exportModal.updateData(canvasComponent.data);
        exportModal.open();
      } else {
        await advanceToWorkflowStage((currentStage + 1) as WorkflowStage);
      }
    });
  }

  // 7. 实例化侧边栏
  sidebar = new Sidebar(canvasComponent.data, {
    onSelectTaxa: (taxaId) => {
      canvasComponent.setActiveTaxa(taxaId);
      updateFooter();
    },
    onToggleVisible: (taxaId) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.visible = !col.visible;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
      }
    },
    onUpdateTaxaColor: (taxaId, color) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.color = color;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
      }
    },
    onChangePlotType: (taxaId, plotType) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.plotType = plotType;
        history.push(`Change ${col.name} Plot Type to ${plotType}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
        canvasComponent.requestRender();
        inspector?.updateData(canvasComponent.data);
        setHudNotice(`已将属种 [${col.name}] 图形形态切换为: ${plotType.toUpperCase()}`);
      }
    },
    onRenameTaxa: (taxaId, newName) => {
      const col = canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (!col) return;
      const prevName = col.name ?? '';
      col.name = newName;
      col.species = newName;
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      scheduleAutosave();
      // 名字必须写回后端：`naming.renameColumn` 是唯一会更新 `session.taxa_names` 的通道，
      // 而每次重新分列都从 `taxa_names` 还原列名（`session.py:901-908`）。只改前端内存的话，
      // 重分列 / 重载 / 导出都会退回 colNN，后端那道 ROI 内重名校验也永远不会执行。
      // 失败必须回滚并冒泡——绝不允许留下"界面改了、后端没改"的假状态。
      void (async () => {
        try {
          await rpcClient.renameColumn(taxaId, newName);
          // 撤销项只在**后端确认之后**才入栈。后端也会拒绝非法名字（`COLUMN_NAME_PATTERN`），
          // 若先入栈再回滚，栈顶就留下一条"按下去什么都不变"的幽灵撤销项，
          // 且把 canUndo() 从 false 顶成 true（与步骤 4 第 3 号缺陷同族）。
          history.push(`Rename Taxa ${prevName} to ${newName}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
          toolbar?.updateHistoryState();
          // 成功提示放在 RPC 之后：后端也有它自己的名字合法性校验（`COLUMN_NAME_PATTERN`
          // 拒绝 `/`、`#`、超长等），先说"已更名"再被后端打脸就成了假状态。
          setHudNotice(`属种已更名为: ${newName}`);
        } catch (err) {
          col.name = prevName;
          col.species = prevName;
          // 先 blur：否则 sidebar.updateData 会把焦点输入框里那个已被拒绝的名字搬过去。
          (document.activeElement as HTMLElement | null)?.blur?.();
          canvasComponent.requestRender();
          sidebar?.updateData(canvasComponent.data);
          inspector?.updateData(canvasComponent.data);
          reportBackendFailure('属种改名', err);
        }
      })();
    },
    onToggleCollapse: (collapsed) => {
      setSidebarCollapsed(collapsed);
    },
    onInsertGapColumn: (afterTaxaId) => {
      const cols = canvasComponent.data.columns;
      const maxW = canvasComponent.data.imageWidth || 8000;
      const curIdx = cols.findIndex((c) => c.id === afterTaxaId);
      const insertAt = curIdx !== -1 ? curIdx + 1 : cols.length;
      const refCol = curIdx !== -1 ? cols[curIdx] : cols[cols.length - 1];
      const rawStartX = refCol ? refCol.endX : canvasComponent.data.roi.xMin;
      const width = Math.min(60, Math.max(20, refCol ? (refCol.endX - refCol.startX) : 60));
      const startX = Math.min(rawStartX, maxW - width);
      const endX = Math.min(startX + width, maxW);

      const newCol = {
        id: `col_${Date.now()}_gap`,
        name: `Gap_Col_${insertAt + 1}`,
        color: '#94a3b8',
        startX: startX,
        endX: endX,
        maxPercent: 20,
        tickEndX: endX,
        unit: '%',
        isLocked: false,
        curveType: 'linear' as const,
        visible: true,
        controlPoints: [],
        scale_type: 'linear' as const,
        startValue: 0,
        tickValue: 20,
        plotType: 'area' as const,
      };
      cols.splice(insertAt, 0, newCol);
      canvasComponent.data.activeTaxaId = newCol.id;
      history.push(`Insert Gap Column at ${insertAt + 1}`, cols, newCol.id);
      canvasComponent.requestRender();
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      scheduleAutosave();
      setHudNotice(`已插入空缺占位列 [Gap_Col_${insertAt + 1}]，后续属种名字已顺延后推！`, 4000);
    },
  });

  // 8.0 论文元数据半自动提取与审核弹窗 (DOI / PDF / LiPD / FAIR)
  const metadataModal = new MetadataModal(
    document.body,
    rpcClient,
    (_meta) => {
      setHudNotice(`论文元数据已保存更新！已同步至 XLSX / LiPD 导出引擎。`, 3500);
    }
  );

  // 8.1 年代-深度模型解译与视觉检查弹窗
  const ageDepthModal = new AgeDepthModal(
    document.body,
    canvasComponent.data,
    rpcClient,
    (ageModel) => {
      setHudNotice(`成功关联年代模型 [${ageModel.metadata.curve_type || "Median"}]！导出时将自动注入日历年代与 95% 置信区间。`, 4000);
    }
  );

  // 8.2 花粉属种名 OCR 自动识别与审核汇总表弹窗
  const ocrReviewModal = new OcrReviewModal(
    document.body,
    canvasComponent.data,
    rpcClient,
    () => {
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      setHudNotice('已把审核确认的属种名称与拉丁学名应用到当前图谱各列', 4000);
    }
  );

  /**
   * 打开 OCR 复核模态的统一入口（顶栏按钮与步骤 5 面板按钮共用）。
   *
   * 收敛成一个函数是因为步骤 5 面板原先自己 `document.querySelector` 去顶栏碰按钮，
   * 而它找的三个选择器（`#btn-open-ocr`、`#topbar-btn-ocr`、`[title*="OCR"]`）在仓库里
   * 一个都不存在 —— 顶栏真实按钮是 `#btn-ocr-review-modal`，title 为
   * "自动识别图谱顶部属种名并为各列匹配新列名"，不含 "OCR"。于是那个按钮永远只弹
   * 一句"请使用顶栏按钮"，从来没有真正打开过模态。
   */
  const openOcrReviewModal = (): void => {
    if (canvasComponent.data.columns.length === 0) {
      setHudNotice('当前图谱尚未切分属种列。请先框选 ROI 并点击【确认有效区，开始分列】，系统将自动生成 col01, col02... 编号列后再进行 OCR。', 4500);
      return;
    }
    ocrReviewModal.open(canvasComponent.data);
  };

  // 8.3 全局偏好与系统设置弹窗 (语言/外观/远程访问网关/WebMCP)
  const settingsModal = new SettingsModal(
    document.body,
    rpcClient,
    () => {
      setHudNotice(t('settings.saved'), 3500);
      toolbar?.updateStatus(rpcClient.getStatus());
    }
  );

  // 8. 标定与工程管理、数据导出面板
  const onProjectLoad = (projectData: DiagramData) => {
    canvasComponent.loadNewDiagram(projectData);
    history.reset(projectData.columns, projectData.activeTaxaId, projectData.calibration, projectData.roi);
    currentStage = STAGE.Y_CALIB;
    updateWorkflowBar();
    sidebar?.updateData(canvasComponent.data);
    inspector?.updateData(canvasComponent.data);
    toolbar?.updateHistoryState();
    toolbar?.updateScale(canvasComponent.viewport.scale);
    updateFooter();
    void recomposeCleanupState('载入项目后重算清理掩膜');
    setHudNotice('成功载入 Straditize 科学项目包 (.tar)！已 100% 还原全部属种、刻度钉与控制点。', 4500);
  };

  const projectManager = new ProjectManager(
    canvasComponent.data,
    rpcClient,
    onProjectLoad
  );

  const exportModal = new ExportModal(
    document.body,
    canvasComponent.data,
    rpcClient,
    projectManager
  );

  const propertyPanel = new PropertyPanel(
    document.body,
    canvasComponent.data,
    rpcClient,
    (newCal: DiagramCalibration) => {
      // 这里只落深度网格偏好：真正的两点标定走 applyDepthCalibration。
      canvasComponent.data.calibration = newCal;
      history.push('Update Grid Settings', canvasComponent.data.columns, canvasComponent.data.activeTaxaId, newCal, canvasComponent.data.roi);
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      updateFooter();
    },
    (roi: DataRoi) => {
      new ResizeRoiCommand(canvasComponent.data.roi, roi).execute(canvasComponent.data);
      canvasComponent.requestRender();
      void commitRoi(roi);
    },
    onProjectLoad
  );

  // 9. 动态属性检查器 (Context Inspector)
  inspector = new Inspector(canvasComponent.data, history, {
    onDataChange: () => {
      canvasComponent.requestRender();
      sidebar?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
    },
    onSelectTaxa: (taxaId) => {
      canvasComponent.setActiveTaxa(taxaId);
      sidebar?.updateData(canvasComponent.data);
      updateFooter();
    },
    onToggleCollapse: (collapsed) => {
      setInspectorCollapsed(collapsed);
    },
    onDigitizeActiveColumn: async () => {
      const activeCol = canvasComponent.getActiveColumn();
      if (!activeCol) return;
      try {
        const points = await rpcClient.digitizeColumn(activeCol.id);
        if (points.length > 0) {
          activeCol.controlPoints = points;
          history.push(`Re-digitize ${activeCol.name}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
          canvasComponent.requestRender();
          sidebar?.updateData(canvasComponent.data);
          inspector?.updateData(canvasComponent.data);
          setHudNotice(`属种 ${activeCol.name} 轮廓已根据图像算法完成重识别！`);
        }
      } catch (err) {
        reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onOpenDataViewer: () => {
      exportModal.updateData(canvasComponent.data);
      exportModal.open();
    },
    // 步骤 5 面板的【自动识别属种名】按钮走这里（Inspector 会把整份 callbacks 展开成
    // 步骤上下文交给各 Panel）。缺了它，那个按钮只能退回一句"请使用顶栏按钮"的提示。
    onOpenOcrReviewModal: openOcrReviewModal,
    onToggleLayerVisibility: (layer, visible) => {
      if (layer === 'ghost') {
        canvasComponent.viewport.showGhosting = visible;
        canvasComponent.requestRender();
        setHudNotice(visible ? '绿色原位半透明对比层已开启' : '绿色对比层已关闭');
      }
    },
    onStartLineFix: (mode) => {
      if (!canvasComponent.isToolAllowed('linefix')) {
        setHudNotice('线掩膜修正从步骤 4 (清理) 起可用。', 4000);
        return;
      }
      // 修正时必须看得见掩膜，否则等于闭眼涂改。B 键叠加层自动打开。
      canvasComponent.viewport.showBinaryOverlay = true;
      canvasComponent.setLineFixMode(mode);
      canvasComponent.setToolMode('linefix');
      toolbar?.updateFilterState(canvasComponent.viewport.imageMode, true);
      setHudNotice(
        mode === 'erase'
          ? '擦除笔：按住左键涂抹被误标成线的数据区，松手即重算。'
          : '补线笔：按住左键涂抹算法漏掉的线，松手即重算。',
        6000
      );
    },
    onClearLineFix: () => {
      void clearLineFixStrokes();
    },
    onStartYCalibration: () => {
      startYCalibration();
    },
    onAdvanceWorkflowStage: (targetStage: number) => {
      void advanceToWorkflowStage(targetStage as WorkflowStage);
    },
    onSelectRoi: async (roiId: string) => {
      try {
        await rpcClient.call('roi.setActive', { roi_id: roiId });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
      } catch (err) {
        reportBackendFailure('切换有效区', err);
      }
    },
    onCreateRoi: async () => {
      try {
        const nextIdx = (canvasComponent.data.rois?.length || 0) + 1;
        const x0 = canvasComponent.data.roi?.xMin || 315;
        const x1 = canvasComponent.data.roi?.xMax || (canvasComponent.data.imageWidth ? Math.round(canvasComponent.data.imageWidth * 0.85) : 1946);
        const y0 = canvasComponent.data.roi?.yMin || 511;
        const y1 = canvasComponent.data.roi?.yMax || (canvasComponent.data.imageHeight ? Math.round(canvasComponent.data.imageHeight * 0.85) : 1311);
        const res = await rpcClient.call<any, any>('roi.create', {
          name: `roi_${nextIdx}`,
          x0,
          x1,
          y0,
          y1,
          composition: true,
        });
        if (res?.roi) {
          await rpcClient.call('roi.setActive', { roi_id: res.roi.id });
          const freshData = await rpcClient.getDiagramData();
          canvasComponent.loadNewDiagram(freshData);
          sidebar?.updateData(canvasComponent.data);
          inspector?.updateData(canvasComponent.data);
          canvasComponent.requestRender();
          setHudNotice(`已新建并选中有效区: ${res.roi.name}`);
        }
      } catch (err) {
        reportBackendFailure('新建有效区', err);
      }
    },
    onSetPrimaryRoi: async (roiId: string) => {
      try {
        await rpcClient.call('roi.setPrimary', { roi_id: roiId });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        inspector?.updateData(canvasComponent.data);
        setHudNotice(`已将 ${roiId} 设为主有效区 (对应导出 data.csv)`);
      } catch (err) {
        reportBackendFailure('设置主有效区', err);
      }
    },
    onDeleteRoi: async (roiId: string) => {
      try {
        await rpcClient.call('roi.remove', { roi_id: roiId });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
        setHudNotice(`已删除有效区: ${roiId}`);
      } catch (err) {
        reportBackendFailure('删除有效区', err);
      }
    },
    onRenameActiveRoi: async (newName: string) => {
      try {
        const rois = canvasComponent.data.rois || [];
        if (rois.length === 0) {
          const x0 = canvasComponent.data.roi?.xMin || 315;
          const x1 = canvasComponent.data.roi?.xMax || (canvasComponent.data.imageWidth ? Math.round(canvasComponent.data.imageWidth * 0.85) : 1946);
          const y0 = canvasComponent.data.roi?.yMin || 511;
          const y1 = canvasComponent.data.roi?.yMax || (canvasComponent.data.imageHeight ? Math.round(canvasComponent.data.imageHeight * 0.85) : 1311);
          await rpcClient.call('roi.create', {
            name: newName,
            x0,
            x1,
            y0,
            y1,
            composition: true,
          });
        } else {
          const activeId = canvasComponent.data.active_roi_id || (canvasComponent.data as any).activeRoiId || rois[0]?.id;
          await rpcClient.call('roi.update', { roi_id: activeId, name: newName });
        }
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        setHudNotice(`有效区已更名为: ${newName}`);
      } catch (err) {
        reportBackendFailure('重命名有效区', err);
      }
    },
    onUpdateRoiComposition: async (composition: boolean) => {
      const activeId = canvasComponent.data.active_roi_id || canvasComponent.data.rois?.[0]?.id;
      if (!activeId) return;
      try {
        await rpcClient.call('roi.update', { roi_id: activeId, composition });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        inspector?.updateData(canvasComponent.data);
      } catch (err) {
        reportBackendFailure('更新有效区组分属性', err);
      }
    },
    onDetectLineCandidates: async () => {
      await runCleanupAction('检测候选线', async () => {
        const res = await rpcClient.call<any, any>('algorithm.detectLineCandidates', {
          roi_id: activeCleanupRoiId(),
        });
        // 检测只产出"待确认"geometry；紧接着重算一次掩膜，把叠加层与统计一起拿回来。
        const composed = await rpcClient.refreshCleanup(activeCleanupRoiId());
        canvasComponent.setSelectedGeometryId(null);
        const count = res?.candidates?.length ?? composed.candidates?.length ?? 0;
        setHudNotice(
          `已检测 ${count} 条候选干扰线（橙色=待确认）。在图上点选/拖动修正，确认后才会真正去除。`,
          5000
        );
        return composed;
      });
    },
    /**
     * 手动添加 geometry —— 不再弹窗要四个数字。
     *
     * 切到画布拖拽模式：用户在图上按住拖出一段，松手即由 `onGeometryCommit`
     * 提交后端。这是"在图中修改"的主路径，prompt 只作为精确微调的补充入口。
     */
    onAddLineGeometry: async (axis: 'h' | 'v') => {
      canvasComponent.setSelectedGeometryId(null);
      canvasComponent.setToolMode(axis === 'h' ? 'drawLineH' : 'drawLineV');
      setHudNotice(
        axis === 'h'
          ? '请在图上按住左键，横向拖出一段作为干扰线（拖出的厚度即线宽）。'
          : '请在图上按住左键，竖向拖出一段作为干扰线（拖出的宽度即线宽）。',
        6000
      );
    },
    /** 选中一条 geometry：在画布上高亮并允许拖动/缩放，不再弹窗改数值。 */
    onEditLineGeometry: async (candidateId: string) => {
      const cand = canvasComponent.data.line_candidates?.find((item) => item.id === candidateId);
      if (!cand) return;
      canvasComponent.setSelectedGeometryId(candidateId);
      setHudNotice(
        `已选中 ${cand.axis === 'h' ? '横向' : '竖向'}几何：拖动整体移动，拖端点手柄改范围，Delete 删除。`,
        6000
      );
    },
    onAddExclusionRect: async () => {
      const activeRoi = canvasComponent.data.active_roi_id || canvasComponent.data.rois?.[0]?.id || 'pollen';
      const roi = canvasComponent.data.roi;
      // 在当前有效区右侧区域默认添加排除区矩形 (CONISS / 图例树常见区)
      const exX0 = Math.round(roi.xMax - Math.min(250, (roi.xMax - roi.xMin) * 0.25));
      const exX1 = Math.round(roi.xMax);
      const exY0 = Math.round(roi.yMin);
      const exY1 = Math.round(roi.yMax);

      const newEx = {
        id: `ex_${Date.now()}`,
        roi_id: activeRoi,
        kind: 'rect' as const,
        points: [
          [exX0, exY0],
          [exX1, exY0],
          [exX1, exY1],
          [exX0, exY1],
        ] as [number, number][],
      };

      canvasComponent.data.exclusion_regions = canvasComponent.data.exclusion_regions || [];
      canvasComponent.data.exclusion_regions.push(newEx);
      canvasComponent.viewport.showBinaryOverlay = true;
      canvasComponent.setToolMode('linefix');
      toolbar?.updateFilterState(canvasComponent.viewport.imageMode, true);

      try {
        const maskRes = await rpcClient.call<any, any>('algorithm.applyLineRemoval', {
          roi_id: activeRoi,
          selected_ids: canvasComponent.data.selected_candidate_ids || [],
          exclusion_regions: canvasComponent.data.exclusion_regions,
        });
        if (maskRes?.overlay_png) {
          canvasComponent.setLineOverlay(maskRes.overlay_png);
        }
        inspector?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
        setHudNotice(`⛶ 已划定排除区 [X: ${exX0}~${exX1}]！该区域所有墨迹在数字化时将被绝对剔除。`, 4500);
      } catch (err) {
        reportBackendFailure('添加排除区', err);
      }
    },
    /** 确认 / 撤回一条 geometry：改的是后端 status，掩膜由后端重算。 */
    onToggleCandidateSelection: async (candId: string, selected: boolean) => {
      await runCleanupAction('更新候选线选择', () =>
        rpcClient.setGeometryStatus(candId, selected ? 'removed' : 'candidate')
      );
      setHudNotice(selected ? '已确认该几何：数字化将剔除这块像素。' : '已撤回为待确认：不再剔除。');
    },
    // 与画布侧共用同一份实现（见文件上方 handleGeometry*）。
    // 注意：onGeometrySelected 只属于画布回调（选中由画布发起），InspectorCallbacks 没有它。
    onGeometryCommit: handleGeometryCommit,
    onGeometryDelete: handleGeometryDelete,
    /** 清空本步全部 geometry / 排除区 / 笔迹。 */
    onClearCleanupEdits: async () => {
      await runCleanupAction('清空清理编辑', async () => {
        const roiId = activeCleanupRoiId();
        const res = await rpcClient.clearCleanupEdits(roiId);
        canvasComponent.setSelectedGeometryId(null);
        // 后端 `_recompose` 的返回体只含 candidates / selected_ids / stats / overlay_png，
        // **不含** `exclusion_regions` 与 `line_strokes`，而 `applyCleanupState` 只覆盖
        // 它认识的那四个键。所以这两项必须在这里同步归零，否则面板会继续显示
        // 「排除区 (N 个)」——后端已清空、界面还在宣称存在，等于这个按钮骗人。
        // 同 `clearLineFixStrokes()` 的做法（那里也是先清镜像再灌返回值）。
        //
        // 作用域要对齐后端语义（`cleanup.py` `clear_cleanup_edits`）：`line_strokes`
        // 是全局的，后端整个清空；`exclusion_regions` 只清 `roi_id` 为**本 ROI 或 None**
        // 的那些，别的 ROI 的要留着——所以这里是过滤而不是整体置空。
        canvasComponent.data.line_strokes = [];
        canvasComponent.data.exclusion_regions = (
          canvasComponent.data.exclusion_regions || []
        ).filter((e) => e.roi_id != null && e.roi_id !== roiId);
        setHudNotice('已清空本步的全部几何、排除区与笔迹。');
        return res;
      });
    },
    /** 统一厚度：把选中 / 全部几何的像素厚度改成用户填写的值，中心行不动。 */
    onSetLineThickness: async (thickness: number, candidateId?: string) => {
      await runCleanupAction('统一几何厚度', () =>
        rpcClient.setLineThickness(thickness, candidateId, activeCleanupRoiId())
      );
      setHudNotice(
        candidateId
          ? `已把选中几何的厚度统一改为 ${thickness}px。`
          : `已把本有效区全部几何的厚度统一改为 ${thickness}px（中心行未移动）。`,
        5000
      );
    },
    onDetectXTicks: async () => {
      try {
        const activeRoi = canvasComponent.data.active_roi_id || canvasComponent.data.rois?.[0]?.id;
        const res = await rpcClient.call<any, any>('algorithm.detectXTicks', { roi_id: activeRoi });
        if (res?.per_column) {
          setHudNotice(`已成功提取 ${res.per_column.length} 列刻度线齿`);
        }
      } catch (err) {
        reportBackendFailure('自动提取刻度', err);
      }
    },
    // 步骤 6【保存手动输入】：像素端点取自列几何（列左边界与标尺终点），用户只填两个读数。
    // `x_ticks` 是标度的唯一事实源，必须写回后端——只改前端内存的话，任何一次重取
    // （切步骤 / 重分列 / 重新载入）都会把它丢掉，而导出与步骤 7 采样读的也是后端。
    onCalibrateXTicks: async (colIndex: number, val1Raw: string, val2Raw: string) => {
      const col = canvasComponent.data.columns.find((c) => c.col_index === colIndex);
      if (!col) {
        reportBackendFailure('标定列 X 刻度', new Error(`载荷里找不到列 ${colIndex}`));
        return;
      }
      // 解析放在这里而不是面板里：面板拿不到统一错误出口，一旦在面板里写
      // `parseFloat(...) || 0` 就会把空输入悄悄变成 0（"界面显示的值来路不明"正是老毛病）。
      const val1 = Number.parseFloat(val1Raw);
      const val2 = Number.parseFloat(val2Raw);
      if (!Number.isFinite(val1) || !Number.isFinite(val2)) {
        reportBackendFailure(
          '标定列 X 刻度',
          new Error(`两个端点读数都必须填数字，当前收到「${val1Raw}」「${val2Raw}」。`)
        );
        return;
      }
      const px1 = col.startX;
      const px2 = col.tickEndX ?? col.endX;
      const unit = col.unit || '%';
      try {
        const res = await rpcClient.calibrateColumnXTicks(
          colIndex,
          [
            { px: px1, value: val1 },
            { px: px2, value: val2 },
          ],
          unit
        );
        // 镜像取**后端返回值**而不是用户输入：后端会校验并可能归一（排序/边界），
        // 用输入直接覆盖就又把"界面显示的值"和"后端存的值"分家了。
        col.x_ticks = res.x_ticks;
        // 撤销项只在后端确认之后入栈；否则栈顶会留下"按下去什么都没变"的幽灵项。
        history.push(
          `Calibrate X-Ticks ${col.name}`,
          canvasComponent.data.columns,
          canvasComponent.data.activeTaxaId
        );
        canvasComponent.requestRender();
        // 成功后按后端真值重建面板：状态徽标、两端点读数、以及只在已标定时才渲染的
        // 【清空】按钮都据此更新。这里是点击而非连续输入，重挂不会打断用户。
        inspector?.updateData(canvasComponent.data);
        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        updateFooter();
        scheduleAutosave();
        setHudNotice(
          `列 ${col.name} 已标定：X=${res.x_ticks[0].px}px → ${res.x_ticks[0].value}${unit}，` +
            `X=${res.x_ticks[1].px}px → ${res.x_ticks[1].value}${unit}`
        );
      } catch (err) {
        // 后端拒绝（像素越界 / 两端像素相同 / 值非法）时**不回写镜像**，只冒泡：
        // 步骤 5 的教训是把焦点框的旧值搬过去会掩盖后端的纠正。
        reportBackendFailure('标定列 X 刻度', err);
      }
    },
    onClearXTicks: async (colIndex: number) => {
      const col = canvasComponent.data.columns.find((c) => c.col_index === colIndex);
      if (!col) {
        reportBackendFailure('清空列 X 刻度', new Error(`载荷里找不到列 ${colIndex}`));
        return;
      }
      try {
        const res = await rpcClient.clearColumnXTicks(colIndex);
        col.x_ticks = null;
        // 后端对未标定列是幂等空操作（cleared=false）；那种情况不该产生撤销项。
        if (res.cleared) {
          history.push(
            `Clear X-Ticks ${col.name}`,
            canvasComponent.data.columns,
            canvasComponent.data.activeTaxaId
          );
          setHudNotice(`列 ${col.name} 的 X 标度已清空（回到未标定）`);
        }
        canvasComponent.requestRender();
        inspector?.updateData(canvasComponent.data);
        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        updateFooter();
        scheduleAutosave();
      } catch (err) {
        reportBackendFailure('清空列 X 刻度', err);
      }
    },
    onExtractConsensusHorizons: async () => {
      try {
        const cols = canvasComponent.data.columns || [];
        for (const col of cols) {
          if (!col.controlPoints || col.controlPoints.length === 0) {
            const pts = await rpcClient.digitizeColumn(col.id);
            if (pts.length > 0) col.controlPoints = pts;
          }
        }
        const res = await rpcClient.call<any, any>('samples.extractConsensus', { tolerance_px: 4.0, min_taxa_support: 1 });
        if (res?.samples) {
          canvasComponent.data.samples = res.samples;
          inspector?.updateData(canvasComponent.data);
          canvasComponent.requestRender();
          setHudNotice(`成功提取 ${res.samples.length} 个跨属种拐点共识采样层位！`, 4000);
        }
      } catch (err) {
        reportBackendFailure('提取采样层位', err);
      }
    },
    onClearHorizons: async () => {
      try {
        await rpcClient.call('samples.clear', {});
        canvasComponent.data.samples = [];
        inspector?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
        setHudNotice('已清空全部采样层位');
      } catch (err) {
        reportBackendFailure('清空层位', err);
      }
    },
    onPreviewYCalibrationPx: (topPx, bottomPx) => {
      canvasComponent.data.calibration.top_px = topPx;
      canvasComponent.data.calibration.bottom_px = bottomPx;
      const existingMarks = canvasComponent.getYCalibMarks();
      const railX = Math.max(20, canvasComponent.data.roi.xMin - 24);
      const nextMarks: Point2D[] = [];
      if (topPx !== null) {
        nextMarks.push({ x: existingMarks[0]?.x ?? railX, y: topPx });
      }
      if (bottomPx !== null) {
        nextMarks.push({ x: existingMarks[1]?.x ?? railX, y: bottomPx });
      }
      canvasComponent.setYCalibMarks(nextMarks);
    },
    onSubmitYCalibration: (topPx, topValue, bottomPx, bottomValue, unit) => {
      const existingMarks = canvasComponent.getYCalibMarks();
      const railX = Math.max(20, canvasComponent.data.roi.xMin - 24);
      void applyDepthCalibration(
        [
          { x: existingMarks[0]?.x ?? railX, y: topPx },
          { x: existingMarks[1]?.x ?? railX, y: bottomPx },
        ],
        [topValue, bottomValue],
        unit
      );
    },
    onRoiCommitted: (roi) => {
      void commitRoi(roi);
    },
    // 步骤面板直连后端的唯一通道（如 Step 8 的 qa.summarize）。
    rpcClient,
  });

  /**
   * 让后端按「当前 ROI + 已确认 geometry + 排除区 + 人工笔迹」重新合成清理掩膜，
   * 并把 QC 叠加层与统计回灌画布。
   *
   * 掩膜只在后端生成：前端历史上另有一套"每行连续墨迹 run 超阈值即整段标红"的
   * 显示逻辑，实测在 Hoya 图上把 Pinus 列 99% 的实心轮廓标成"可删除"，而那张图
   * ROI 内根本没有横向网格线。现在 B 键看到的就是数字化实际剔除的像素。
   *
   * 串行化 + 版本号：连拖 ROI 或连涂笔刷时，后发的请求必须等前一个完成，
   * 且只有最新版本的返回允许落地（否则旧掩膜会盖掉新掩膜）。
   */
  let cleanupRecomposePromise: Promise<void> = Promise.resolve();
  let cleanupRecomposeVersion = 0;

  function recomposeCleanupState(label = '重算清理掩膜'): Promise<void> {
    const requestVersion = ++cleanupRecomposeVersion;
    const task = cleanupRecomposePromise.then(async () => {
      try {
        const roiId = activeCleanupRoiId();
        const res = await rpcClient.refreshCleanup(roiId);
        if (requestVersion !== cleanupRecomposeVersion) return;
        applyCleanupState(res);
      } catch (err) {
        reportBackendFailure(label, err);
      }
    });
    cleanupRecomposePromise = task.catch(() => undefined);
    return task;
  }

  /**
   * 清空人工修正笔迹。
   *
   * 必须把**空的 strokes 显式推给后端**：`line_strokes` 是与 `line_candidates`
   * 并列的后端权威状态，而 `refreshCleanup` 发的是不带 `strokes` 的"只重算"请求
   * ——后端语义是 `strokes is None` → **保持原值**。所以"只清前端镜像 + 一次
   * refresh"会让后端把笔迹原样发回来：按钮看起来生效（HUD 提示、镜像瞬时归零），
   * 掩膜其实一点没变。走 `setLineStrokes([])` 才是真正的清空。
   */
  function clearLineFixStrokes(): Promise<void> {
    const requestVersion = ++cleanupRecomposeVersion;
    const task = cleanupRecomposePromise.then(async () => {
      try {
        const res = await rpcClient.setLineStrokes([], activeCleanupRoiId());
        if (requestVersion !== cleanupRecomposeVersion) return;
        canvasComponent.data.line_strokes = [];
        applyCleanupState(res);
        canvasComponent.requestRender();
        setHudNotice('已清空全部人工修正笔迹，掩膜回到算法结果。');
      } catch (err) {
        reportBackendFailure('清空人工修正笔迹', err);
      }
    });
    cleanupRecomposePromise = task.catch(() => undefined);
    return task;
  }

  /**
   * 把后端下发的**完整**清理状态灌回前端。
   *
   * Step 4 的唯一数据来源：candidates / 统计 / 叠加层 png 全部用后端返回值覆盖，
   * 前端不再自行拼装 `line_candidates`（自造状态会与后端 mask 脱节，
   * 表现为"界面显示已去除但数字化没变"）。
   */
  function applyCleanupState(res: {
    candidates?: LineCandidate[];
    selected_ids?: string[];
    stats?: Record<string, number>;
    overlay_png?: string;
  }): void {
    const data = canvasComponent.data;
    if (Array.isArray(res.candidates)) {
      data.line_candidates = res.candidates;
    }
    if (Array.isArray(res.selected_ids)) {
      data.selected_candidate_ids = res.selected_ids;
    }
    if (res.stats) {
      data.cleanup_stats = res.stats;
    }
    if (res.overlay_png) {
      canvasComponent.setLineOverlay(res.overlay_png);
      canvasComponent.viewport.showBinaryOverlay = true;
      toolbar?.updateFilterState(canvasComponent.viewport.imageMode, true);
    } else {
      canvasComponent.setLineOverlay(null);
    }
    inspector?.updateData(data);
    sidebar?.updateData(data);
    canvasComponent.requestRender();
  }

  /** 活动 ROI id（后端所有清理 RPC 都以 ROI 为作用域）。 */
  function activeCleanupRoiId(): string {
    return (
      canvasComponent.data.active_roi_id ||
      canvasComponent.data.rois?.[0]?.id ||
      canvasComponent.data.roi?.id ||
      'pollen'
    );
  }

  /** 统一入口：跑一个清理类 RPC 并把结果灌回前端。 */
  async function runCleanupAction(
    label: string,
    action: () => Promise<{
      candidates?: LineCandidate[];
      selected_ids?: string[];
      stats?: Record<string, number>;
      overlay_png?: string;
    }>
  ): Promise<void> {
    try {
      // 微调几何是「本地即时改 + 500ms 防抖提交」。这里是 Step 4 所有几何写操作
      // 的唯一入口（删除/改厚度/确认去除/重扫/清空），所以必须在这里先把待提交的
      // 微调 **await** 落库，再执行本次动作。
      //
      // 实测复现过不这么做的后果：微调后 60ms 内点侧栏「删除」，删除先落地（22→21），
      // 500ms 后那次延迟 upsert 到达，几何**原地复活**（21→22，还带着微调后的 at）。
      // 侧栏按钮走 RPC 直连，不经过画布的删除入口，所以只堵画布是堵不住的。
      await canvasComponent.flushPendingGeometryEdits();
      const res = await action();
      applyCleanupState(res);
    } catch (err) {
      reportBackendFailure(label, err);
    }
  }

  /** 按拖拽顺序提交 ROI，避免连续拖拽请求乱序覆盖。 */
  function enqueueRoiCommit(roi: DataRoi): Promise<void> {
    const task = roiCommitPromise.then(() => commitRoi(roi));
    roiCommitPromise = task.catch(() => undefined);
    return task;
  }

  /** 把取数区推给后端，并重算依赖 ROI 的线掩膜。 */
  async function commitRoi(roi: DataRoi): Promise<void> {
    try {
      await rpcClient.updateRoi(roi);
    } catch (err) {
      reportBackendFailure('同步取数区到后端', err);
      return;
    }
    // 后端此刻已是新范围，但本地 data.rois[] 还停在拖拽前的值。
    // 步骤 5 分列读的正是 data.rois（main.ts 步骤5），改名/组分两条路径
    // 都各自 getDiagramData() 刷新过，唯独拖拽这条没有——不补的话：
    // 分列会拿旧 r.xMin/r.xlim 当 data_xlim 盖回后端，用户拖的框等于白拖。
    // （不能用 loadNewDiagram：它会重新 loadImage，拖拽结束会闪一下。）
    syncActiveRoiBounds(roi);
    // commitRoi 是异步的，而 GeologyCanvas.onMouseUp 里 `onDataChange` 是在
    // `void commitRoi(...)` 之后同步执行的——它跑在 await 完成之前。所以
    // 数据同步完必须自己再刷一次界面，否则步骤 2 面板仍显示拖拽前的边界
    // （实测：后端已是 [161,1598]，面板还写着 [161,2206]）。
    sidebar?.updateData(canvasComponent.data);
    inspector?.updateData(canvasComponent.data);
    // 掩膜是 ROI 的函数：ROI 变了必须让后端按新范围重算，否则红标与实际剔除脱节。
    await recomposeCleanupState('ROI 变更后重算清理掩膜');
  }

  /**
   * 把刚提交的取数区范围回写到本地 `data.rois[]` 的活动 ROI 上。
   *
   * 画布拖拽只改 `data.roi`（派生自活动 ROI 的单数旧字段），而分列、
   * RoiPanel、CleanupPanel、ExportReadinessPanel、Sidebar 读的都是 `rois[]`。
   */
  function syncActiveRoiBounds(roi: DataRoi): void {
    const list = canvasComponent.data.rois ?? [];
    if (list.length === 0) return;
    const activeId = canvasComponent.data.active_roi_id || list[0]?.id;
    const idx = list.findIndex((r) => r.id === activeId);
    if (idx < 0) return;
    const x0 = Math.round(roi.xMin);
    const x1 = Math.round(roi.xMax);
    const y0 = Math.round(roi.yMin);
    const y1 = Math.round(roi.yMax);
    list[idx] = {
      ...list[idx],
      // 两套字段都要写：读方有的取 xMin/xMax、有的取 xlim/ylim（步骤5 两者都试）
      xMin: x0,
      xMax: x1,
      yMin: y0,
      yMax: y1,
      xlim: [x0, x1],
      ylim: [y0, y1],
    };
  }

  /**
   * 应用一条撤销/重做快照。
   *
   * 取数区与深度标定也必须一起回滚：它们和列一样是用户操作的结果，
   * 只回滚列会让"撤销"看起来生效、实际上框选与刻度停在撤销后的状态。
   */
  function applyHistorySnapshot(snapshot: HistorySnapshot): void {
    canvasComponent.data.columns = snapshot.columns;
    canvasComponent.data.activeTaxaId = snapshot.activeTaxaId;
    if (snapshot.calibration) {
      canvasComponent.data.calibration = { ...snapshot.calibration };
    }
    if (snapshot.roi) {
      canvasComponent.data.roi = { ...snapshot.roi };
    }
    canvasComponent.clearYCalibMarks();
    canvasComponent.requestRender();
    sidebar?.updateData(canvasComponent.data);
    inspector?.updateData(canvasComponent.data);
    toolbar?.updateHistoryState();
    updateFooter();
    if (snapshot.roi) {
      // 掩膜是 ROI 的函数，ROI 回滚了就必须让后端按新范围重算。
      void commitRoi(canvasComponent.data.roi);
    }
  }

  /**
   * 追加一条线掩膜人工修正笔迹并让后端重新合成掩膜。
   *
   * 笔迹是当前清理模型的一部分（后端 `_recompose` 会把它们栅格化成
   * manual_erase / manual_restore 掩膜），所以这里必须把**全量**笔迹提交给
   * `algorithm.applyLineRemoval`，而不是只提交这一条增量。
   */
  async function appendLineFixStroke(stroke: LineMaskStroke): Promise<void> {
    canvasComponent.data.line_strokes.push(stroke);
    // 刻意**不进撤销栈**：`HistorySnapshot` 只覆盖前端自有的 columns / calibration / roi(s)，
    // 不含 line_strokes，所以为笔迹 push 只会得到一条"按下去什么都不会变"的幽灵记录——
    // 撤销栈深度被虚假占用，用户以为能撤销笔迹。清理编辑的回收出口是本步显式提供的
    // 「清空笔迹」/「清空本步编辑」两个按钮（上游原版根本没有撤销机制，无须追求 parity）。
    const roiId = activeCleanupRoiId();
    try {
      const res = await rpcClient.setLineStrokes(canvasComponent.data.line_strokes, roiId);
      applyCleanupState(res);
      const total = canvasComponent.data.line_strokes.length;
      setHudNotice(
        stroke.mode === 'erase'
          ? `已擦除该处误标（人工修正共 ${total} 条）。`
          : `已补回该处漏标（人工修正共 ${total} 条）。`,
        3500
      );
    } catch (err) {
      // 提交失败必须把本地刚追加的笔迹撤回，否则前端会显示一条后端并不知道的笔迹。
      canvasComponent.data.line_strokes.pop();
      canvasComponent.requestRender();
      reportBackendFailure('提交人工修正笔迹', err);
    }
  }

  /** 进入 Y 轴两点标定：由画布收集两个像素行，实时落格到 Step 3 侧栏。 */
  function startYCalibration(): void {
    currentStage = 3;
    updateWorkflowBar();
    canvasComponent.clearYCalibMarks();
    canvasComponent.setToolMode('ycalib');
    setHudNotice('请在图上依次点击 Y 轴上两个已知刻度所在的行，数值将实时填入侧栏。', 7000);
  }

  /** 提交两点标定到后端，成功后写回前端标定结构。 */
  async function applyDepthCalibration(
    marks: Point2D[],
    values: number[],
    unit: string
  ): Promise<void> {
    const cal = canvasComponent.data.calibration;
    try {
      const res = await rpcClient.calibrateDepthAxis(
        [
          { pixel: marks[0].y, value: values[0] },
          { pixel: marks[1].y, value: values[1] },
        ],
        unit
      );
      const previous = { ...cal };
      canvasComponent.data.calibration = { ...res.canvas, depthInterval: cal.depthInterval, depthGridEnabled: cal.depthGridEnabled };
      history.push(
        'Set Y-Axis Two-Point Calibration',
        canvasComponent.data.columns,
        canvasComponent.data.activeTaxaId,
        previous,
        canvasComponent.data.roi
      );
      canvasComponent.setYCalibMarks(marks);
      if (currentStage === 3) {
        canvasComponent.setToolMode('ycalib');
      } else {
        canvasComponent.setToolMode('select');
      }
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      updateFooter();
      setHudNotice(
        `Y 轴已标定: Y1=${res.canvas.top_px}px → ${res.canvas.top_cm} ${unit}，` +
          `Y2=${res.canvas.bottom_px}px → ${res.canvas.bottom_cm} ${unit}`,
        6000
      );
    } catch (err) {
      reportBackendFailure('Y 轴两点标定', err);
    }
  }

  // 9. 处理自定义图片或项目包打开与加载逻辑
  async function handleOpenFile(file: File) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.tar') || lowerName.endsWith('.json') || lowerName.endsWith('.tar.gz')) {
      projectManager.openProjectFile(file);
      return;
    }

    const validImgExts = ['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.webp', '.bmp', '.pdf'];
    const hasValidExt = validImgExts.some((ext) => lowerName.endsWith(ext));
    if (!file.type.startsWith('image/') && !hasValidExt) {
      setHudNotice('请选择或拖入有效的图片文件 (.png, .jpg, .tiff, .pdf) 或项目文件 (.tar / .json)');
      return;
    }

    if (history.canUndo()) {
      if (!window.confirm('当前项目有未保存修改，重新加载图片将清空当前工作区。是否继续？')) {
        return;
      }
    }

    setHudNotice(`正在载入地质图谱: ${file.name}...`, 8000);

    const isPdf = file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
    const reader = new FileReader();
    reader.onload = async (e) => {
      let dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      if (isPdf) {
        const inputPage = window.prompt(`检测到 PDF 文档 [${file.name}]\n请输入要提取图谱的页码 (从 1 开始):`, '1');
        if (inputPage === null) {
          setHudNotice('已取消载入 PDF');
          return;
        }
        const pageNum = Math.max(1, parseInt(inputPage.trim() || '1', 10) || 1);

        let newDiagramData: DiagramData;
        try {
          newDiagramData = await rpcClient.loadCustomImage(dataUrl, 0, 0, file.name, pageNum);
        } catch (err) {
          reportBackendFailure('图谱载入', err);
          return;
        }

        canvasComponent.loadNewDiagram(newDiagramData);
        history.reset([], '');
        currentStage = 1;
        updateWorkflowBar();

        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        toolbar?.updateScale(canvasComponent.viewport.scale);
        toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
        updateFooter();

        setHudNotice(`成功载入 PDF [${file.name}] 第 ${pageNum} 页图谱 (${newDiagramData.imageWidth}×${newDiagramData.imageHeight})！请在画布上调整数据有效区 (Step 1)。`, 5000);
        return;
      }

      const img = new Image();
      img.onerror = () => {
        reportBackendFailure('图谱载入', new Error('浏览器无法解码该图像文件，请确认是否为有效图片格式。'));
      };
      img.onload = async () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        // 图像尺寸与性能预算安全检查 (规范第一节)
        const MAX_W = 8000;
        const MAX_H = 12000;
        const WARN_W = 6000;
        const WARN_H = 9000;

        if (w > MAX_W || h > MAX_H) {
          const okDownsample = window.confirm(
            `【图像尺寸过大提示】\n当前图像尺寸为 ${w}×${h} px，超过建议最大限制 (${MAX_W}×${MAX_H} px)。\n直接加载可能会耗尽浏览器内存导致崩溃。\n\n点击【确定】以 50% 降采样安全加载 (${Math.round(w / 2)}×${Math.round(h / 2)} px)；\n点击【取消】中止加载。`
          );
          if (!okDownsample) {
            setHudNotice('已取消加载超限大图');
            return;
          }
          const downsampled = downsampleImage(img, 0.5);
          dataUrl = downsampled.dataUrl;
          w = downsampled.w;
          h = downsampled.h;
        } else if (w >= WARN_W && h >= WARN_H) {
          setHudNotice(`提示: 图像尺寸较大 (${w}×${h} px)，建议在充足内存环境下操作。`, 4000);
        }

        // 调用 RPC 客户端：图像必须由后端真正载入成功，失败即中止
        let newDiagramData: DiagramData;
        try {
          newDiagramData = await rpcClient.loadCustomImage(dataUrl, w, h, file.name);
        } catch (err) {
          reportBackendFailure('图谱载入', err);
          setHudNotice('图谱载入失败：后端未确认接收该图像，未进入工作流。', 6000);
          return;
        }

        // 进入 S1 时清空：ROI、所有列、所有点、深度标定、撤销栈、选中状态
        canvasComponent.loadNewDiagram(newDiagramData);
        history.reset([], '');
        currentStage = 1;
        updateWorkflowBar();

        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        toolbar?.updateScale(canvasComponent.viewport.scale);
        toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
        updateFooter();

        setHudNotice(`成功载入图谱 [${file.name}] (${w}×${h})！请在画布上调整数据有效区 (Step 1)，随后点击下方推进。`, 5000);

        // 异步执行微小倾斜检测提示 (Deskew Helper)
        rpcClient.detectDeskew().then((skewRes) => {
          if (skewRes && skewRes.has_skew && Math.abs(skewRes.suggested_rotation_angle) >= 0.3) {
            const ang = skewRes.suggested_rotation_angle;
            const banner = document.createElement('div');
            banner.className = 'deskew-notice-banner';
            banner.style.cssText = 'position: fixed; top: 52px; right: 20px; z-index: 9999;';
            banner.innerHTML = `
              <div class="app-toast-badge" style="border: 1px solid #f59e0b;">
                <span><strong>图谱微斜提示</strong>: 检测到主轴倾斜约 <strong>${ang > 0 ? '+' : ''}${ang}°</strong>，是否自动水平矫正？</span>
                <div style="display: flex; gap: 6px;">
                  <button id="btn-deskew-apply" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px; background: #f59e0b; border-color: #f59e0b;">旋转校正</button>
                  <button id="btn-deskew-ignore" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">忽略</button>
                </div>
              </div>
            `;
            document.body.appendChild(banner);
            banner.querySelector('#btn-deskew-apply')?.addEventListener('click', async () => {
              banner.remove();
              setHudNotice(`正在旋转矫正图谱 (${ang}°)...`, 5000);
              try {
                const rotRes = await rpcClient.rotateImage(ang);
                if (rotRes && rotRes.success) {
                  // 重新拉取图片数据
                  const refreshed = await rpcClient.getDiagramData();
                  canvasComponent.loadNewDiagram(refreshed);
                  history.reset([], '');
                  currentStage = 1;
                  updateWorkflowBar();
                  setHudNotice(`已水平矫正图谱！有效区已重置。`, 3500);
                } else {
                  throw new Error(t('error.unknown'));
                }
              } catch (err) {
                reportBackendFailure('图谱旋转校正', err);
              }
            });
            banner.querySelector('#btn-deskew-ignore')?.addEventListener('click', () => {
              banner.remove();
            });
          }
        }).catch((err) => {
          // 倾斜探测失败不再伪报"未倾斜"：如实告知，让用户自己决定是否手动校正
          reportBackendFailure('图谱倾斜检测', err);
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function downsampleImage(img: HTMLImageElement, ratio: number = 0.5): { dataUrl: string; w: number; h: number } {
    const targetW = Math.round(img.naturalWidth * ratio);
    const targetH = Math.round(img.naturalHeight * ratio);
    const offCanvas = document.createElement('canvas');
    offCanvas.width = targetW;
    offCanvas.height = targetH;
    const ctx = offCanvas.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, targetW, targetH);
    }
    return {
      dataUrl: offCanvas.toDataURL('image/png'),
      w: targetW,
      h: targetH,
    };
  }

  // 10. 处理范例图谱切换
  async function handleLoadSample(sampleKey: string) {
    setHudNotice(`正在切换内置范例图谱: ${sampleKey}...`, 5000);
    let newDiagramData: DiagramData;
    try {
      newDiagramData = await rpcClient.loadSampleDiagram(sampleKey);
    } catch (err) {
      reportBackendFailure('内置范例载入', err);
      return;
    }

    canvasComponent.loadNewDiagram(newDiagramData);
    history.reset(newDiagramData.columns, newDiagramData.activeTaxaId);
    // 范例只提供"内置输入"；分列与数字化必须由用户走真实流程产生，因此停在 S1。
    currentStage = 1;
    updateWorkflowBar();

    sidebar?.updateData(canvasComponent.data);
    toolbar?.updateHistoryState();
    toolbar?.updateScale(canvasComponent.viewport.scale);
    toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
    updateFooter();

    const nameMap: Record<string, string> = {
      hoya: 'Hoya del Castillo 花粉剖面',
      verification: '标定验证地质图谱',
      beginner: '初学者沉积图谱',
    };
    setHudNotice(`已载入范例: ${nameMap[sampleKey] || sampleKey}，已自动居中重置！`, 3500);
  }

  // 11. 实例化顶部工具栏（缩放/透视控件在 render 后搬到底部视口栏）
  toolbar = new Toolbar(history, rpcClient.getStatus(), {
    onFit: () => {
      canvasComponent.fitToScreen();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onReset100: () => {
      canvasComponent.resetZoom100();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onZoomIn: () => {
      const rect = canvasComponent.canvas.getBoundingClientRect();
      canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 1.25);
      canvasComponent.requestRender();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onZoomOut: () => {
      const rect = canvasComponent.canvas.getBoundingClientRect();
      canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 0.8);
      canvasComponent.requestRender();
      toolbar?.updateScale(canvasComponent.viewport.scale);
    },
    onUndo: () => {
      const prev = history.undo();
      if (prev) {
        applyHistorySnapshot(prev);
      }
    },
    onRedo: () => {
      const next = history.redo();
      if (next) {
        applyHistorySnapshot(next);
      }
    },
    onDigitize: async () => {
      const activeCol = canvasComponent.getActiveColumn();
      if (!activeCol) return;
      try {
        const points = await rpcClient.digitizeColumn(activeCol.id);
        if (points.length > 0) {
          activeCol.controlPoints = points;
          history.push(`Re-digitize ${activeCol.name}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
          canvasComponent.requestRender();
          sidebar?.updateData(canvasComponent.data);
        }
      } catch (err) {
        reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onExport: async (format) => {
      exportModal.updateData(canvasComponent.data);
      const cols = canvasComponent.data.columns || [];
      const hasPoints = cols.some((c) => c.controlPoints && c.controlPoints.length > 0);

      // 若尚未完成分列或提取数据：打开就绪清单面板温和呈现未就绪状态，杜绝冷冰冰报错
      if (cols.length === 0 || !hasPoints) {
        setHudNotice(
          getLocale() === 'en'
            ? 'Notice: Please complete Step 5 columns & extraction before exporting. Opening readiness checklist.'
            : '提示：当前图谱尚未切分属种列或提取数据，已为您打开导出就绪清单。请先完成 Step 5 分列与提取再导出。',
          5000
        );
        exportModal.open('', format);
        return;
      }

      try {
        const exportContent = await rpcClient.exportData(format);
        exportModal.open(exportContent, format);
      } catch (err) {
        reportBackendFailure('数据导出', err);
      }
    },
    onSaveProject: () => {
      void projectManager.saveProjectFile();
      setHudNotice('数字化项目已打包导出为标准归档包 (.tar)！', 3500);
    },
    onOpenProjectFile: (file) => {
      projectManager.openProjectFile(file);
    },
    onResetAll: () => {
      const confirmed = window.confirm(
        '确定要重置当前图谱的全部操作吗？\n\n' +
          '· 将清空：全部分列、控制点、刻度钉、深度标尺与 ROI 边界\n' +
          '· 撤销历史将一并清空，且本操作不可撤销\n' +
          '· 底图图片本身会完整保留\n\n' +
          '重置后可从 S1（框选数据有效区）重新开始。'
      );
      if (!confirmed) return;

      canvasComponent.resetAllOperations();
      void rpcClient.resetProjectState();

      // 清空自动草稿，避免重载后又弹出旧进度
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      try {
        localStorage.removeItem(AUTOSAVE_KEY);
      } catch {
        // 忽略隐私模式下的存储异常
      }

      currentStage = 1;
      updateWorkflowBar();
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      toolbar?.updateScale(canvasComponent.viewport.scale);
      toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);
      updateFooter();
      // 归零同时要让后端丢掉旧掩膜（仅当底图存在时；空图时不应触发需要图像前置状态的重算）
      if (canvasComponent.data.imageSrc) {
        void recomposeCleanupState('归零后重算清理掩膜');
      }
      setHudNotice('已重置：本图全部分列、控制点与标尺已清空，请从步骤 1 重新框选数据有效区。', 5000);
    },
    onOpenCalibrationModal: () => {
      propertyPanel.openCalibrationModal();
    },
    onOpenMetadataModal: () => {
      metadataModal.open();
    },
    onOpenOcrReviewModal: openOcrReviewModal,
    onOpenAgeDepthModal: () => {
      ageDepthModal.open();
    },
    onOpenSettings: () => {
      settingsModal.open();
    },
    onToggleRpcConfig: () => {
      settingsModal.open();
    },
    onOpenFile: (file) => {
      handleOpenFile(file);
    },
    onLoadSample: (sampleKey) => {
      handleLoadSample(sampleKey);
    },
    onChangeImageMode: (mode: ImageDisplayMode) => {
      canvasComponent.viewport.imageMode = mode;
      canvasComponent.requestRender();
      toolbar?.updateFilterState(mode, canvasComponent.viewport.showBinaryOverlay);
      setHudNotice(`底图滤镜模式切换为: ${mode}`);
    },
    onToggleBinaryOverlay: () => {
      const active = canvasComponent.viewport.toggleBinaryOverlay();
      canvasComponent.requestRender();
      toolbar?.updateFilterState(canvasComponent.viewport.imageMode, active);
      setHudNotice(active ? '透视遮罩: 去线复核模式 [开启] (白=保留墨迹，红=实际剔除像素，快捷键 B)' : '透视遮罩: [关闭]');
    },
    onSelectToolMode: (mode) => {
      canvasComponent.setToolMode(mode);
      toolbar.setToolMode(mode);
      const desc = canvasComponent.toolModeManager.getToolDescription(mode);
      const footerModeEl = document.getElementById('footer-tool-mode');
      if (footerModeEl) {
        footerModeEl.innerHTML = `模式: <strong>${desc.name} (${desc.shortcut})</strong>`;
      }
      setHudNotice(`工具模式切换: ${desc.name} (${desc.shortcut}) - ${desc.hint}`);
    },
    onToggleSidebar: () => {
      toggleSidebar();
    },
    onToggleInspector: () => {
      toggleInspector();
    },
    onStepClick: (step) => {
      void advanceToWorkflowStage(step as WorkflowStage);
      const meta = WORKFLOW_STAGES[currentStage];
      setHudNotice(`切换至步骤 ${step}: ${meta.stepName} - ${meta.title}`);
    },
    // 进程控制不是数据 RPC：由 RpcClient 统一下发，并集中说明"为什么可以忽略异常"。
    onShutdown: () => {
      void rpcClient.requestShutdown();
    },
  });

  // 把缩放/透视控件交到底部画布视口栏（Toolbar 每次 render 后会同步搬移）
  toolbar.setViewControlsHost(viewControlsBar);

  // 顶栏状态胶囊订阅同一份后端状态（横幅已订阅，setStatusCallback 为多监听者，不会互相覆盖）
  rpcClient.setStatusCallback((status) => {
    toolbar?.updateStatus(status);
  });

  const clientStatus = rpcClient.getStatus();
  if (clientStatus.isDesktopMode ?? initialData.isDesktopMode) {
    toolbar.setDesktopMode(true);
  }

  // 13. 组装与挂载页面
  workspace.appendChild(sidebar.getElement());
  workspace.appendChild(canvasWrapper);
  workspace.appendChild(inspector.getElement());

  appContainer.appendChild(toolbar.getElement());
  appContainer.appendChild(workspace);
  appContainer.appendChild(footer);

  // 应用初始折叠持久化状态
  if (initialSidebarCollapsed) setSidebarCollapsed(true);
  if (initialInspectorCollapsed) setInspectorCollapsed(true);

  // 挂载就绪后更新初始工作流向导条
  updateWorkflowBar();

  // 全局快捷键（唯一规范键位，无冗余别名）：
  //   Ctrl+[  展开 / 折叠左侧属种分列列表
  //   Ctrl+]  展开 / 折叠右侧属性检查器
  //   F1      呼出 / 关闭《统一交互系统与快捷键速查中心》
  //   Esc     关闭帮助面板
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT') return;

    if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'BracketLeft') {
      e.preventDefault();
      toggleSidebar();
    } else if (e.ctrlKey && !e.shiftKey && !e.altKey && e.code === 'BracketRight') {
      e.preventDefault();
      toggleInspector();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === ',' || e.code === 'Comma')) {
      e.preventDefault();
      settingsModal.open();
    } else if (e.code === 'F1') {
      e.preventDefault();
      toggleHelpPanel();
    } else if (e.code === 'Escape' && helpPanel.style.display !== 'none') {
      e.preventDefault();
      helpPanel.style.display = 'none';
    }
  });

  function updateFooter() {
    const col = canvasComponent.getActiveColumn();
    const activeEl = document.getElementById('footer-active-taxa');
    const anchorsEl = document.getElementById('footer-anchors');
    const dimEl = document.getElementById('footer-dimensions');
    const zoomEl = document.getElementById('footer-zoom');

    if (dimEl) {
      dimEl.innerHTML = `${t('footer.image')}: <code>${canvasComponent.data.imageWidth}×${canvasComponent.data.imageHeight}</code>`;
    }
    if (zoomEl) {
      zoomEl.innerHTML = `${t('footer.zoom')}: <code>${Math.round(canvasComponent.viewport.scale * 100)}%</code>`;
    }
    // 无激活列（含重置后的空状态）时必须回落占位符，避免残留上一张图的属种与锚点数
    if (activeEl) {
      activeEl.innerHTML = col
        ? `${t('footer.activeTaxa')}: <span style="color: ${col.color};">●</span> <strong>${col.name}</strong>`
        : `${t('footer.activeTaxa')}: <strong>--</strong>`;
    }
    if (anchorsEl) {
      if (col) {
        const manual = col.controlPoints.filter((p) => p.isManual).length;
        anchorsEl.innerHTML = `${t('footer.anchors')}: <code>${manual} ${t('footer.manual')} / ${col.controlPoints.length} ${t('footer.total')}</code>`;
      } else {
        anchorsEl.innerHTML = `${t('footer.anchors')}: <code>--</code>`;
      }
    }
  }

  // 监听滚轮更新 Toolbar 显示的缩放比例
  canvasComponent.canvas.addEventListener('wheel', () => {
    toolbar?.updateScale(canvasComponent.viewport.scale);
  });

  window.addEventListener('resize', () => {
    canvasComponent.handleResize();
  });

  // 容器初次挂载后自适应画布尺寸并居中图谱
  requestAnimationFrame(() => {
    canvasComponent.handleResize();
    canvasComponent.fitToScreen();
    toolbar?.updateScale(canvasComponent.viewport.scale);
  });

  updateFooter();
  toolbar?.updateScale(canvasComponent.viewport.scale);
  toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);

  // 检查是否存在未保存的自动草稿快照
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) {
      const draft = JSON.parse(saved);
      if (draft && draft.data && Array.isArray(draft.data.columns) && draft.data.columns.length > 0 && (Date.now() - draft.timestamp < 7 * 86400 * 1000)) {
        const draftTime = new Date(draft.timestamp).toLocaleTimeString();
        const banner = document.createElement('div');
        banner.className = 'draft-recovery-banner';
        banner.style.cssText = 'position: fixed; top: 48px; left: 50%; transform: translateX(-50%); z-index: 9999;';
        banner.innerHTML = `
          <div class="app-toast-badge" style="border: 1px solid var(--accent-blue);">
            <span>${t('draft.found', { time: draftTime, count: draft.data.columns.length })}</span>
            <div style="display: flex; gap: 6px;">
              <button id="btn-restore-draft" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px;">${t('draft.restore')}</button>
              <button id="btn-discard-draft" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">${t('draft.ignore')}</button>
            </div>
          </div>
        `;
        document.body.appendChild(banner);
        banner.querySelector('#btn-restore-draft')?.addEventListener('click', () => {
          canvasComponent.loadNewDiagram(draft.data);
          history.reset(draft.data.columns, draft.data.activeTaxaId);
          sidebar?.updateData(canvasComponent.data);
          inspector?.updateData(canvasComponent.data);
          toolbar?.updateHistoryState();
          updateFooter();
          banner.remove();
          setHudNotice(t('draft.restored'), 3500);
        });
        banner.querySelector('#btn-discard-draft')?.addEventListener('click', () => {
          localStorage.removeItem(AUTOSAVE_KEY);
          banner.remove();
        });
      }
    }
  } catch {
    // 忽略异常
  }

  // 14. 注册浏览器端 WebMCP (W3C Web Model Context Protocol) 桥接器 + /events 实时同步入撤销栈
  const syncWebMcpState = async (actionName: string) => {
    const freshData = await rpcClient.getDiagramData();
    canvasComponent.loadNewDiagram(freshData);
    history.push(
      `WebMCP: ${actionName}`,
      canvasComponent.data.columns,
      canvasComponent.data.activeTaxaId,
      canvasComponent.data.calibration,
      canvasComponent.data.roi
    );
    sidebar?.updateData(canvasComponent.data);
    inspector?.updateData(canvasComponent.data);
    toolbar?.updateHistoryState();
    updateFooter();
    scheduleAutosave();
    setHudNotice(`WebMCP 已执行: ${actionName}（支持 Ctrl+Z 撤销）`, 3500);
  };

  let inPageCallInFlight = false;
  const webMcpApi = {
    version: '2024-11-05',
    endpoint: typeof window !== 'undefined' && window.location.origin ? `${window.location.origin}/mcp` : 'http://127.0.0.1:8765/mcp',
    listTools: async () => {
      const res = await rpcClient.call<any, any>('tools/list', {});
      return res?.tools || [];
    },
    callTool: async (name: string, args: Record<string, any> = {}) => {
      inPageCallInFlight = true;
      try {
        const res = name.startsWith('straditize_')
          ? await rpcClient.call<any, any>('tools/call', { name, arguments: args })
          : await rpcClient.call<any, any>(name, args);
        await syncWebMcpState(name);
        return res;
      } finally {
        inPageCallInFlight = false;
      }
    },
    setWorkflowStep: (step: WorkflowStage) => {
      currentStage = step;
      updateWorkflowBar();
      canvasComponent.requestRender();
    },
  };
  (window as any).webMCP = webMcpApi;
  if (typeof navigator !== 'undefined' && !('modelContext' in navigator)) {
    try {
      Object.defineProperty(navigator, 'modelContext', { value: webMcpApi, configurable: true });
    } catch {
      // Ignore read-only navigator environments
    }
  }

  // 订阅后端 /events SSE 流：当外部 AI Agent 通过 http://127.0.0.1:8765/mcp 调用工具时，
  // 浏览器画布自动同步最新状态并压入 HistoryManager 撤销栈
  if (typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource('/events');
      es.addEventListener('rpc_call', (ev: MessageEvent) => {
        if (inPageCallInFlight) return;
        try {
          const payload = JSON.parse(ev.data || '{}');
          if ((payload.method === 'tools/call' || payload.method === 'webmcp.callTool') && payload.tool) {
            void syncWebMcpState(payload.tool);
          }
        } catch {
          // Ignore malformed event
        }
      });
    } catch {
      // Ignore if SSE unavailable
    }
  }

  // ---------------------------------------------------------------------------
  // 调试/验收句柄：window.__straditize
  //
  // 给 MCP 与 e2e 提供**权威状态**与直达入口。此前只能读 DOM 文本反推状态，
  // 于是出现过「evaluate 报 S5、紧接着截图是 S3」这类误判，也拿不到 data.rois
  // 这种只有前端镜像才知道的值——而这恰恰是「分列用错 ROI」那个 bug 的藏身处。
  //
  // 不构成提权：页面本身就能发同样的 RPC，这里只是把状态显式化。
  // ---------------------------------------------------------------------------
  (window as unknown as Record<string, unknown>).__straditize = {
    /** 一次拿到判题所需的全部状态，免去轮询 DOM 与可见性过滤 */
    getState: () => {
      canvasComponent.render();
      const data = canvasComponent.data;
      const cal = data.calibration;
      return {
        stage: currentStage,
        image: { src: data.imageSrc || null, width: data.imageWidth, height: data.imageHeight },
        // 分列/去线/就绪清单读的就是这个 rois[] 镜像——出问题时先看它和 roi 是否一致
        rois: (data.rois ?? []).map((r) => ({
          id: r.id, name: r.name, xlim: r.xlim, ylim: r.ylim, name_source: r.name_source,
        })),
        activeRoiId: data.active_roi_id ?? null,
        // 派生自活动 ROI 的旧单数字段（画布拖拽改的就是它）
        legacyRoi: {
          xMin: data.roi?.xMin ?? null, xMax: data.roi?.xMax ?? null,
          yMin: data.roi?.yMin ?? null, yMax: data.roi?.yMax ?? null,
        },
        columns: data.columns.map((c) => ({
          id: c.id, name: c.name, startX: c.startX, endX: c.endX, roi_id: c.roi_id,
          // 步骤 6 之后判题要看这两个：x_ticks 是列标度的唯一事实源（null = 未标定），
          // col_index 是前端寻址列级 RPC 用的后端权威序号。投影里漏掉它们，
          // 测试就只能去读 DOM 文本反推"到底标定没有"。
          col_index: c.col_index ?? null,
          x_ticks: c.x_ticks ?? null,
        })),
        calibration: {
          isCalibrated: !!cal?.isCalibrated,
          top_px: cal?.top_px ?? null, bottom_px: cal?.bottom_px ?? null,
          unit: cal?.unit ?? null,
        },
        yCalibMarks: canvasComponent.getYCalibMarks().map((m) => ({ x: m.x, y: m.y })),
        // eligibleLayers 是阶段能力，不代表 Canvas 实际已绘制；renderedLayers 才是最近一帧的真实调用记录。
        eligibleLayers: visibleLayers(currentStage, {
          hasImage: !!data.imageSrc,
          columnCount: data.columns.length,
        }),
        renderedLayers: canvasComponent.getLastRenderedLayers(),
      };
    },
    /** 直达任意步骤；走的是与工作流按钮完全相同的 advanceToWorkflowStage */
    gotoStage: (stage: number) => advanceToWorkflowStage(stage as WorkflowStage),
    /** 直发后端 RPC，用于断言后端权威值（与前端镜像对账） */
    rpc: (method: string, params: Record<string, unknown> = {}) =>
      rpcClient.call(method, params),
    /** 选中指定属种列并激活属性面板 */
    selectColumn: (colId: string) => {
      canvasComponent.data.selectedEntity = { type: 'column', id: colId };
      canvasComponent.data.activeTaxaId = colId;
      inspector?.updateData(canvasComponent.data);
      sidebar?.updateData(canvasComponent.data);
    },
  };

  console.log('Straditize Modern Frontend Initialized Successfully');
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to bootstrap Straditize frontend:', err);
  });
});
