import './style.css';
import { RpcClient } from './services/RpcClient';
import { HistoryManager } from './core/HistoryManager';
import { GeologyCanvas } from './components/GeologyCanvas';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PropertyPanel } from './components/PropertyPanel';
import { Inspector } from './components/Inspector';
import { AgeDepthModal } from './components/AgeDepthModal';
import { MetadataModal } from './components/MetadataModal';
import { OcrReviewModal } from './components/OcrReviewModal';
import { DiagramCalibration, DiagramData } from './types/pollen';
import { onLocaleChange, applyLocaleToDocument } from './i18n';
import { ImageDisplayMode } from './core/Viewport';
import { WORKFLOW_STAGES, WorkflowStage } from './types/workflow';
import { tokens } from './styles/tokens';

import { t } from './i18n';

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
        <div style="font-size:34px;margin-bottom:10px;">🔌</div>
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
 * 否则会变成 unhandled rejection 而"点了没反应"，比假数据更糟。
 */
export function reportBackendFailure(actionLabel: string, err: unknown): void {
  const message = (err as Error)?.message || t('error.unknown');
  console.error(`[RPC failure] ${actionLabel}:`, err);
  window.alert(`❌ ${actionLabel}失败\n\n${message}`);
}

/** 后端未连接时阻塞启动，直到连上为止（没有演示模式这一退路） */
async function ensureDataProvenance(rpcClient: RpcClient): Promise<void> {
  for (;;) {
    await rpcClient.probeBackend();
    if (rpcClient.getStatus().connected) return;
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
        `<span>⛔ ${t('banner.backendLost')}</span>` +
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

  // 1. 初始化 JSON-RPC Client，并阻塞式确认数据来源（后端真实计算 / 用户显式演示模式）
  const rpcClient = new RpcClient();
  await ensureDataProvenance(rpcClient);
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
  history.reset(initialData.columns, initialData.activeTaxaId);

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

  window.addEventListener('beforeunload', (e) => {
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
  leftDrawerTab.title = '展开属种分列清单 (快捷键: [)';
  leftDrawerTab.innerHTML = `<span>›</span><span>属种清单</span>`;
  leftDrawerTab.style.display = 'none';
  workspace.appendChild(leftDrawerTab);

  const rightDrawerTab = document.createElement('div');
  rightDrawerTab.className = 'drawer-toggle-tab right-tab';
  rightDrawerTab.title = '展开属性检查器 (快捷键: ])';
  rightDrawerTab.innerHTML = `<span>‹</span><span>属性检查器</span>`;
  rightDrawerTab.style.display = 'none';
  workspace.appendChild(rightDrawerTab);

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
    setHudNotice(collapsed ? '属种分列列表已收起 (Ctrl+[ 或点击左侧拉手展开)' : '属种分列列表已展开', 2000);
    canvasComponent.handleResize();
  }

  function setInspectorCollapsed(collapsed: boolean) {
    if (inspector) inspector.setCollapsed(collapsed);
    rightDrawerTab.style.display = collapsed ? 'flex' : 'none';
    if (toolbar) toolbar.setInspectorActive(!collapsed);
    localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(collapsed));
    setHudNotice(collapsed ? '属性检查器已收起 (Ctrl+] 或点击右侧拉手展开)' : '属性检查器已展开', 2000);
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
  helpPanel.innerHTML = `
    <div class="help-panel-header">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="font-size: 14px;">⚡</span>
        <strong style="color: var(--accent-blue); font-size: 12.5px;">统一交互系统与快捷键速查</strong>
      </div>
      <span id="help-panel-close" title="关闭 (Esc)" style="cursor: pointer; font-size: 16px; color: var(--text-muted); line-height: 1; padding: 2px 4px;">&times;</span>
    </div>

    <div class="help-panel-body">
      <!-- 1. 鼠标交互规范 -->
      <div class="help-section">
        <div class="help-section-title">🖱️ 鼠标交互规范 (Mouse)</div>
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

      <!-- 2. 手动提取工具模式 (WebPlotDigitizer 规范) -->
      <div class="help-section">
        <div class="help-section-title">🛠️ 手动提取模式 (Manual Extraction)</div>
        <div class="help-grid">
          <div class="help-row"><span class="help-key">A</span><span class="help-desc">添加控制点模式 (Add Point)</span></div>
          <div class="help-row"><span class="help-key">S / V</span><span class="help-desc">微调与选择模式 (Adjust Point)</span></div>
          <div class="help-row"><span class="help-key">D</span><span class="help-desc">删除控制点模式 (Delete Point)</span></div>
          <div class="help-row"><span class="help-key">C</span><span class="help-desc">添加属种分列线 (Add Column)</span></div>
          <div class="help-row"><span class="help-key">H</span><span class="help-desc">抓手平移模式 (Hand / Pan)</span></div>
          <div class="help-row"><span class="help-key">R</span><span class="help-desc">ROI 矩形数据有效区模式</span></div>
          <div class="help-row"><span class="help-key">Esc</span><span class="help-desc">退出当前工具返回微调 (S) / 取消选中</span></div>
        </div>
      </div>

      <!-- 3. 方向键微调与视图导航 -->
      <div class="help-section">
        <div class="help-section-title">🎯 方向键微调与视图导航</div>
        <div class="help-grid">
          <div class="help-row"><span class="help-key">↑ ↓ ← →</span><span class="help-desc">1 像素高精度微调 (1px Nudge)</span></div>
          <div class="help-row"><span class="help-key">Shift + 方向键</span><span class="help-desc">10 像素快速微调 (10px Nudge)</span></div>
          <div class="help-row"><span class="help-key">F</span><span class="help-desc">视图全图自适应屏幕居中 (Fit to Screen)</span></div>
          <div class="help-row"><span class="help-key">Ctrl+1</span><span class="help-desc">100% 原始物理分辨率 (1:1)</span></div>
          <div class="help-row"><span class="help-key">+ / -</span><span class="help-desc">平滑放大 / 缩小视图</span></div>
          <div class="help-row"><span class="help-key">B / I / C</span><span class="help-desc">二值化透视遮罩 (B) / 反相 (I) / 对比度 (C)</span></div>
        </div>
      </div>

      <!-- 4. 编辑历史与界面布局 -->
      <div class="help-section">
        <div class="help-section-title">⌨️ 编辑历史与界面布局</div>
        <div class="help-grid">
          <div class="help-row"><span class="help-key">Ctrl+Z</span><span class="help-desc">撤销单步操作 (Undo)</span></div>
          <div class="help-row"><span class="help-key">Ctrl+Y</span><span class="help-desc">重做单步操作 (Redo)</span></div>
          <div class="help-row"><span class="help-key">Delete</span><span class="help-desc">删除当前选中的控制点或属种分列</span></div>
          <div class="help-row"><span class="help-key">Ctrl+[</span><span class="help-desc">展开 / 折叠左侧属种分列列表</span></div>
          <div class="help-row"><span class="help-key">Ctrl+]</span><span class="help-desc">展开 / 折叠右侧属性检查器</span></div>
          <div class="help-row"><span class="help-key">F1</span><span class="help-desc">呼出 / 关闭本交互系统与快捷键速查中心</span></div>
        </div>
      </div>
    </div>
  `;
  canvasWrapper.appendChild(helpPanel);

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
    <span id="hud-text">就绪：A 加点 | S 微调 (方向键 1px 精调) | D 删点 | 右键/中键拖拽平移 | 滚轮缩放 | F1 帮助</span>
  `;
  canvasWrapper.appendChild(hud);

  let hudTimer: number | null = null;
  const defaultHudText = '就绪：A 加点 | S 微调 (方向键 1px 精调) | D 删点 | 右键/中键拖拽平移 | 滚轮缩放 | F1 帮助';

  function setHudNotice(text: string, duration: number = 3000) {
    const hudTextEl = document.getElementById('hud-text');
    if (!hudTextEl) return;
    hudTextEl.textContent = text;

    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = window.setTimeout(() => {
      hudTextEl.textContent = defaultHudText;
      hudTimer = null;
    }, duration);
  }

  // 5. 底部状态栏 (28px 恒定，竖线视觉分区，重要参数加粗)
  const footer = document.createElement('footer');
  footer.className = 'app-footer';
  footer.innerHTML = `
    <div class="footer-left" style="display: flex; align-items: center; gap: 8px;">
      <div class="footer-item" id="footer-dimensions">图像: <code>${initialData.imageWidth}×${initialData.imageHeight}</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-zoom">缩放: <code>100%</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-cursor">光标: <code>--</code></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-depth">深度: <strong style="font-size: 11.5px; color: var(--text-primary);">--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-pollen">丰度: <strong style="font-size: 11.5px; color: #38bdf8;">--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-tool-mode">模式: <strong>选择 (V)</strong></div>
    </div>
    <div class="footer-right" style="display: flex; align-items: center; gap: 8px;">
      <div class="footer-item" id="footer-active-taxa">当前属种: <strong>--</strong></div>
      <span style="color: var(--border-color); opacity: 0.8;">│</span>
      <div class="footer-item" id="footer-anchors">锚点: <code>--</code></div>
    </div>
  `;

  // 6. 实例化画布组件
  const canvasComponent = new GeologyCanvas(canvasWrapper, initialData, history, {
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
    onHoverInfo: (info) => {
      const cursorEl = document.getElementById('footer-cursor');
      const depthEl = document.getElementById('footer-depth');
      const pollenEl = document.getElementById('footer-pollen');

      if (info) {
        if (cursorEl) cursorEl.innerHTML = `坐标: <code>X:${info.worldX} Y:${info.worldY}</code>`;
        if (depthEl) {
          const unit = canvasComponent.data.calibration.unit;
          if (info.horizonDepth !== undefined && info.horizonDepth !== null) {
            depthEl.innerHTML = `深度: <code>${info.depth !== undefined ? info.depth + ' ' + unit : '--'}</code> <strong style="color: #38bdf8; margin-left: 6px;">[层位: ${info.horizonDepth} ${unit}]</strong>`;
          } else {
            depthEl.innerHTML = `深度: <code>${info.depth !== undefined ? info.depth + ' ' + unit : '--'}</code>`;
          }
        }
        if (pollenEl) {
          pollenEl.innerHTML = `丰度: <code>${info.percent !== undefined ? info.percent + '%' : '--'}</code>`;
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
        footerModeEl.innerHTML = `模式: <strong>${desc.name} (${desc.shortcut})</strong>`;
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
  });

  // 6.2 显式分步推进状态机 (Step-by-Step Workflow State Machine)
  let currentStage: WorkflowStage = canvasComponent.data.columns.length > 0 ? 3 : 1;
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
      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
        <span style="background: ${tokens.color.column.activeBadge}; color: #fff; font-weight: 700; font-size: 10px; padding: 2px 7px; border-radius: 9999px; flex-shrink: 0;">S${currentStage}</span>
        <strong style="color: var(--accent-blue); flex-shrink: 0;">${meta.stepName}</strong>
        <span style="color: var(--text-secondary); font-size: 11px; max-width: 320px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${meta.guideText}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        ${currentStage > 1 ? `<button id="btn-wf-prev" class="tool-btn" style="padding: 3px 8px; font-size: 10px;">↺ 上一步</button>` : ''}
        ${meta.primaryActionLabel ? `<button id="btn-wf-next" class="btn btn-primary" style="padding: 4px 10px; font-size: 10.5px; font-weight: 600; white-space: nowrap;">${meta.primaryActionLabel}</button>` : ''}
      </div>
    `;

    workflowActionBar.querySelector('#btn-wf-prev')?.addEventListener('click', () => {
      if (currentStage > 1) {
        currentStage = (currentStage - 1) as WorkflowStage;
        updateWorkflowBar();
      }
    });

    workflowActionBar.querySelector('#btn-wf-next')?.addEventListener('click', async () => {
      if (currentStage === 0) {
        // S0 -> S1
        (document.getElementById('file-input-image') as HTMLInputElement)?.click();
      } else if (currentStage === 1) {
        // S1 -> S2: 图谱就绪，进入数据有效区 (ROI) 框选阶段
        currentStage = 2;
        canvasComponent.setToolMode('roi');
        updateWorkflowBar();
        canvasComponent.requestRender();
        setHudNotice('👉 已进入 S2 数据有效区 (ROI) 框选阶段！请拖拽画布上的 8 个十字手柄框选数据区。', 4500);
      } else if (currentStage === 2) {
        // S2 -> S3: 确认有效区，开始推导各花粉属种垂直基线并分列
        setHudNotice('正在基于纯数据有效区推导各花粉属种垂直基线...', 5000);
        const cal = canvasComponent.data.calibration;
        let cols: Awaited<ReturnType<typeof rpcClient.detectColumnsInRoi>>;
        try {
          cols = await rpcClient.detectColumnsInRoi({
            x0: cal.dataXMin,
            x1: cal.dataXMax,
            y0: cal.dataYMin,
            y1: cal.dataYMax,
          });
        } catch (err) {
          // 分列失败必须停在 S2：绝不能带着"等分切割"这类替代结果推进到 S3
          reportBackendFailure('分列识别', err);
          setHudNotice('❌ 分列识别失败，已停留在 S2。请检查后端后重试。', 6000);
          return;
        }
        currentStage = 3;
        canvasComponent.setToolMode('select');
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        updateWorkflowBar();
        updateFooter();
        canvasComponent.requestRender();
        setHudNotice(`✅ 成功切分 ${cols.length} 个属种列 (已生成 col01 ~ col${String(cols.length).padStart(2, '0')})！建议点击顶部【🔍 OCR】自动匹配属种名。`, 5000);
      } else if (currentStage === 3) {
        // S3 -> S4: 推进至标尺标定
        currentStage = 4;
        updateWorkflowBar();
        setHudNotice('👉 请在右侧属性检查器核查或微调两点式深度标尺与各列物理刻度齿。', 4000);
      } else if (currentStage === 4) {
        // S4 -> S5: 标尺确认，开始全列拐点数字化提取
        setHudNotice('正在提取各列花粉多边形轮廓与显著控制手柄...', 8000);
        const cols = canvasComponent.data.columns;
        try {
          for (const col of cols) {
            const pts = await rpcClient.digitizeColumn(col.id);
            if (pts.length > 0) col.controlPoints = pts;
          }
        } catch (err) {
          // 数字化失败必须停在 S4：任何替代曲线都是伪造的科学数据
          reportBackendFailure('拐点数字化提取', err);
          setHudNotice('❌ 拐点提取失败，已停留在 S4。请检查后端后重试。', 6000);
          return;
        }
        currentStage = 5;
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        updateWorkflowBar();
        updateFooter();
        setHudNotice('✅ 数字化完成！绿色半透明逆向对比层已开启，可直接在画布拖拽控制点微调。', 4500);
      } else if (currentStage === 5) {
        // S5 -> S6: 进入地学校验与自检
        currentStage = 6;
        updateWorkflowBar();
        propertyPanel.openExportModal();
        setHudNotice('🔍 已进入地学校验阶段：正在核验 100% 丰度总和自检门禁。', 4000);
      } else if (currentStage === 6) {
        // S6 -> S7: 进入导出交付
        currentStage = 7;
        updateWorkflowBar();
        propertyPanel.openExportModal();
      } else if (currentStage === 7) {
        propertyPanel.openExportModal();
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
    onBatchImportTaxa: (taxaNames) => {
      canvasComponent.batchUpdateTaxa(taxaNames);
      sidebar?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      updateFooter();
      scheduleAutosave();
      setHudNotice(`✅ 成功批量导入 ${taxaNames.length} 个属种名单并完成自动拓展对齐！`, 3500);
    },
    onSwapTaxaNames: (idx1, idx2) => {
      const cols = canvasComponent.data.columns;
      if (idx1 >= 0 && idx1 < cols.length && idx2 >= 0 && idx2 < cols.length) {
        const tmpName = cols[idx1].name;
        cols[idx1].name = cols[idx2].name;
        cols[idx2].name = tmpName;
        history.push(`Swap Taxa Names (${cols[idx1].name} <-> ${cols[idx2].name})`, cols, canvasComponent.data.activeTaxaId);
        sidebar?.updateData(canvasComponent.data);
        inspector?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        updateFooter();
        scheduleAutosave();
        setHudNotice(`🔀 已对调属种顺位: ${cols[idx1].name} 与 ${cols[idx2].name}`);
      }
    },
    onToggleCollapse: (collapsed) => {
      setSidebarCollapsed(collapsed);
    },
    onInsertGapColumn: (afterTaxaId) => {
      const cols = canvasComponent.data.columns;
      const curIdx = cols.findIndex((c) => c.id === afterTaxaId);
      const insertAt = curIdx !== -1 ? curIdx + 1 : cols.length;
      const refCol = curIdx !== -1 ? cols[curIdx] : cols[cols.length - 1];
      const startX = refCol ? refCol.endX : canvasComponent.data.calibration.dataXMin;
      const width = refCol ? (refCol.endX - refCol.startX) : 60;

      const newCol = {
        id: `col_${Date.now()}_gap`,
        name: `Gap_Col_${insertAt + 1}`,
        color: '#94a3b8',
        startX: startX,
        endX: startX + width,
        maxPercent: 20,
        tickEndX: startX + width,
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
      setHudNotice(`➕ 已插入空缺占位列 [Gap_Col_${insertAt + 1}]，后续属种名字已顺延后推！`, 4000);
    },
  });

  // 8.0 论文元数据半自动提取与审核弹窗 (DOI / PDF / LiPD / FAIR)
  const metadataModal = new MetadataModal(
    document.body,
    rpcClient,
    (_meta) => {
      setHudNotice(`✅ 论文元数据已保存更新！已同步至 XLSX / LiPD 导出引擎。`, 3500);
    }
  );

  // 8.1 年代-深度模型解译与视觉检查弹窗
  const ageDepthModal = new AgeDepthModal(
    document.body,
    canvasComponent.data,
    rpcClient,
    (ageModel) => {
      setHudNotice(`✅ 成功关联年代模型 [${ageModel.metadata.curve_type || "Median"}]！导出时将自动注入日历年代与 95% 置信区间。`, 4000);
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
      setHudNotice('✅ 已将审核确认的属种名称与拉丁学名一键应用至当前图谱各列！', 4000);
    }
  );

  // 8. 标定与弹窗交互面板
  const propertyPanel = new PropertyPanel(
    document.body,
    canvasComponent.data,
    rpcClient,
    (newCal: DiagramCalibration) => {
      canvasComponent.data.calibration = newCal;
      history.push('Update Calibration', canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      updateFooter();
    },
    (projectData: DiagramData) => {
      canvasComponent.loadNewDiagram(projectData);
      history.reset(projectData.columns, projectData.activeTaxaId);
      currentStage = 3;
      updateWorkflowBar();
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      toolbar?.updateScale(canvasComponent.viewport.scale);
      updateFooter();
      setHudNotice('✅ 成功载入 Straditize 科学项目包 (.tar)！已 100% 还原全部属种、刻度钉与控制点。', 4500);
    }
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
          setHudNotice(`⚡ 属种 ${activeCol.name} 轮廓已根据图像算法完成重识别！`);
        }
      } catch (err) {
        reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onOpenDataViewer: () => {
      propertyPanel.openExportModal();
    },
    onToggleLayerVisibility: (layer, visible) => {
      if (layer === 'ghost') {
        canvasComponent.viewport.showGhosting = visible;
        canvasComponent.requestRender();
        setHudNotice(visible ? '🟢 绿色原位半透明对比层已开启' : '绿色对比层已关闭');
      }
    },
    onChangeDegridStrength: (strength) => {
      canvasComponent.setDegridStrength(strength);
      setHudNotice(`去网格横线灵敏度设为: ${strength.toUpperCase()} (按 B 键透视查看红色切除预览)`);
    },
  });

  // 9. 处理自定义图片或项目包打开与加载逻辑
  async function handleOpenFile(file: File) {
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.tar') || lowerName.endsWith('.json') || lowerName.endsWith('.tar.gz')) {
      propertyPanel.openProjectFile(file);
      return;
    }

    if (!file.type.startsWith('image/')) {
      setHudNotice('请选择或拖入有效的图片文件或项目文件 (.tar / .json)');
      return;
    }

    if (history.canUndo()) {
      if (!window.confirm('当前项目有未保存修改，重新加载图片将清空当前工作区。是否继续？')) {
        return;
      }
    }

    setHudNotice(`正在载入地质图谱: ${file.name}...`, 8000);

    const reader = new FileReader();
    reader.onload = async (e) => {
      let dataUrl = e.target?.result as string;
      if (!dataUrl) return;

      const img = new Image();
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
          setHudNotice('❌ 图谱载入失败：后端未确认接收该图像，未进入工作流。', 6000);
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

        setHudNotice(`✅ 成功载入图谱 [${file.name}] (${w}×${h})！请在画布上调整数据有效区 (Step 1)，随后点击下方推进。`, 5000);

        // 异步执行微小倾斜检测提示 (Deskew Helper)
        rpcClient.detectDeskew().then((skewRes) => {
          if (skewRes && skewRes.has_skew && Math.abs(skewRes.suggested_rotation_angle) >= 0.3) {
            const ang = skewRes.suggested_rotation_angle;
            const banner = document.createElement('div');
            banner.className = 'deskew-notice-banner';
            banner.style.cssText = 'position: fixed; top: 52px; right: 20px; z-index: 9999;';
            banner.innerHTML = `
              <div class="app-toast-badge" style="border: 1px solid #f59e0b;">
                <span>📐 <strong>图谱微斜提示</strong>: 检测到主轴倾斜约 <strong>${ang > 0 ? '+' : ''}${ang}°</strong>，是否自动水平矫正？</span>
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
                  setHudNotice(`✅ 已水平矫正图谱！有效区已重置。`, 3500);
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
    setHudNotice(`✅ 已载入范例: ${nameMap[sampleKey] || sampleKey}，已自动居中重置！`, 3500);
  }

  // 11. 实例化顶部工具栏
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
        canvasComponent.data.columns = prev.columns;
        canvasComponent.data.activeTaxaId = prev.activeTaxaId;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
      }
    },
    onRedo: () => {
      const next = history.redo();
      if (next) {
        canvasComponent.data.columns = next.columns;
        canvasComponent.data.activeTaxaId = next.activeTaxaId;
        canvasComponent.requestRender();
        sidebar?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
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
      // 导出是产出正式数据的关键路径：后端失败或处于演示模式时，必须明确拒绝，
      // 绝不能交给用户一份前端自算的 CSV。
      try {
        const exportContent = await rpcClient.exportData(format);
        propertyPanel.openExportModal(exportContent, format);
      } catch (err) {
        reportBackendFailure('数据导出', err);
      }
    },
    onSaveProject: () => {
      propertyPanel.saveProjectFile();
      setHudNotice('💾 数字化项目已打包导出为标准归档包 (.tar)！', 3500);
    },
    onOpenProjectFile: (file) => {
      propertyPanel.openProjectFile(file);
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
      toolbar?.setDegridStrength('off');
      updateFooter();
      setHudNotice('♻️ 已一键归零：本图全部分列、控制点与标尺已清空，请从 S1 重新框选数据有效区。', 5000);
    },
    onOpenCalibrationModal: () => {
      propertyPanel.openCalibrationModal();
    },
    onOpenMetadataModal: () => {
      metadataModal.open();
    },
    onOpenOcrReviewModal: () => {
      if (canvasComponent.data.columns.length === 0) {
        setHudNotice('⚠️ 当前图谱尚未切分属种列。请先框选 ROI 并点击【确认有效区，开始分列】，系统将自动生成 col01, col02... 编号列后再进行 OCR。', 4500);
        return;
      }
      ocrReviewModal.open();
    },
    onOpenAgeDepthModal: () => {
      ageDepthModal.open();
    },
    onToggleRpcConfig: () => {
      propertyPanel.openRpcConfigModal(() => {
        toolbar.updateStatus(rpcClient.getStatus());
      });
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
      setHudNotice(active ? '透视遮罩: 墨迹高亮模式 [开启] (青蓝=保留花粉，红=切除横线，快捷键 B)' : '透视遮罩: [关闭]');
    },
    onChangeDegridStrength: (strength) => {
      canvasComponent.setDegridStrength(strength);
      setHudNotice(`去网格横线灵敏度设为: ${strength.toUpperCase()} (按 B 键透视查看红色切除预览)`);
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
      currentStage = step as WorkflowStage;
      if (currentStage === 2) {
        canvasComponent.setToolMode('roi');
      } else if (currentStage === 3) {
        canvasComponent.setToolMode('select');
      }
      updateWorkflowBar();
      canvasComponent.requestRender();
      const meta = WORKFLOW_STAGES[currentStage];
      setHudNotice(`切换至步骤 ${step}: ${meta.stepName} - ${meta.title}`);
    },
  });

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
      dimEl.innerHTML = `图像: <code>${canvasComponent.data.imageWidth}×${canvasComponent.data.imageHeight}</code>`;
    }
    if (zoomEl) {
      zoomEl.innerHTML = `缩放: <code>${Math.round(canvasComponent.viewport.scale * 100)}%</code>`;
    }
    // 无激活列（含一键重置后的空状态）时必须回落占位符，避免残留上一张图的属种与锚点数
    if (activeEl) {
      activeEl.innerHTML = col
        ? `当前属种: <span style="color: ${col.color};">●</span> <strong>${col.name}</strong>`
        : '当前属种: <strong>--</strong>';
    }
    if (anchorsEl) {
      if (col) {
        const manual = col.controlPoints.filter((p) => p.isManual).length;
        anchorsEl.innerHTML = `锚点数: <code>${manual} 手动 / ${col.controlPoints.length} 总计</code>`;
      } else {
        anchorsEl.innerHTML = '锚点数: <code>--</code>';
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
            <span>📋 发现上次未保存的草稿 (${draftTime}, 含 ${draft.data.columns.length} 个属种列)</span>
            <div style="display: flex; gap: 6px;">
              <button id="btn-restore-draft" class="btn btn-primary" style="padding: 2px 8px; font-size: 10px;">恢复草稿</button>
              <button id="btn-discard-draft" class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;">忽略</button>
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
          setHudNotice('✅ 成功恢复上次自动暂存的项目草稿！', 3500);
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

  console.log('Straditize Modern Frontend Initialized Successfully');
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to bootstrap Straditize frontend:', err);
  });
});
