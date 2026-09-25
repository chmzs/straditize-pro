import './style.css';
import { RpcClient } from './services/RpcClient';
import { HistoryManager } from './core/HistoryManager';
import { GeologyCanvas } from './components/GeologyCanvas';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { PropertyPanel } from './components/PropertyPanel';
import { Inspector } from './components/Inspector';
import { ResizeRoiCommand } from './core/Commands';
import { AgeDepthModal } from './components/AgeDepthModal';
import { MetadataModal } from './components/MetadataModal';
import { OcrReviewModal } from './components/OcrReviewModal';
import { SettingsModal } from './components/SettingsModal';
import { DataRoi, DiagramCalibration, DiagramData, HistorySnapshot, LineMaskStroke, Point2D } from './types/pollen';
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

  // 0.1 恢复上次选择的主题外观 (默认日间模式)
  const savedTheme = localStorage.getItem('straditize-theme');
  if (savedTheme === 'dark') {
    document.body.classList.remove('theme-light');
  } else {
    document.body.classList.add('theme-light');
  }

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
          <div class="help-row"><span class="help-key">R</span><span class="help-desc">ROI 矩形取数区模式（只框定取数范围，与深度无关）</span></div>
          <div class="help-row"><span class="help-key">K</span><span class="help-desc">线掩膜人工修正笔刷（涂抹擦掉误标 / 补回漏标）</span></div>
          <div class="help-row"><span class="help-key">Y</span><span class="help-desc">Y 轴两点标定（点两个已知刻度所在的行，再填真实值）</span></div>
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
          <div class="help-row"><span class="help-key">Ctrl+,</span><span class="help-desc">呼出全局偏好与系统设置 (Settings)</span></div>
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
    // ROI 拖拽结束：后端的分列/去线都以 ROI 为范围，必须同步过去，
    // 否则画布上框选的是新范围、后端算的还是旧范围。
    onRoiCommitted: (roi) => {
      void commitRoi(roi);
    },
    // Y 轴两点选完：填入 Step 3 侧边栏常驻输入框，绝不弹窗
    onYCalibPicked: (marks) => {
      const topPx = marks[0].y;
      const botPx = marks[1].y;
      canvasComponent.data.calibration.top_px = topPx;
      canvasComponent.data.calibration.bottom_px = botPx;
      inspector?.updateData(canvasComponent.data);
      setHudNotice(`🎯 已拾取两点像素行 (①Y=${Math.round(topPx)}px, ②Y=${Math.round(botPx)}px)！请在右侧侧栏输入对应真实数值并应用标定。`, 5000);
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
  let currentStage: WorkflowStage = 1;
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

  async function advanceToWorkflowStage(targetStage: WorkflowStage) {
    if (targetStage === 1 && !canvasComponent.data.imageSrc) {
      (document.getElementById('file-input-image') as HTMLInputElement)?.click();
    } else if (targetStage === 2) {
      currentStage = 2;
      canvasComponent.setToolMode('roi');
      updateWorkflowBar();
      canvasComponent.requestRender();
      setHudNotice('👉 已进入 Step 2 数据有效区 (ROI) 划分！请拖拽手柄界定数据区或在侧栏新建多 ROI。', 4500);
    } else if (targetStage === 3) {
      currentStage = 3;
      canvasComponent.setToolMode('ycalib');
      updateWorkflowBar();
      canvasComponent.requestRender();
      setHudNotice('👉 已进入 Step 3 Y 轴标定！请在图上点选两点，或在右侧侧栏直接填入已知刻度与真实深度值。', 5000);
    } else if (targetStage === 4) {
      currentStage = 4;
      canvasComponent.setToolMode('select');
      updateWorkflowBar();
      canvasComponent.requestRender();
      void refreshLineMask();
      setHudNotice('👉 已进入 Step 4 干扰清理！请在右侧侧栏选择去线强度、划定排除区或使用 K 键笔刷微调。', 4500);
    } else if (targetStage === 5) {
      setHudNotice('正在基于数据有效区与清理后墨迹切分属种垂直基线...', 5000);
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
        reportBackendFailure('分列识别', err);
        setHudNotice('❌ 分列识别失败，已停留在 Step 4。请检查有效区后重试。', 6000);
        return;
      }
      currentStage = 5;
      canvasComponent.setToolMode('select');
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      updateWorkflowBar();
      updateFooter();
      canvasComponent.requestRender();
      setHudNotice(`✅ 成功切分 ${canvasComponent.data.columns.length} 个属种列！可点击 OCR 识别或在左栏输入各列名称。`, 5000);
    } else if (targetStage === 6) {
      currentStage = 6;
      updateWorkflowBar();
      inspector?.updateData(canvasComponent.data);
      setHudNotice('👉 已进入 Step 6 列标定！在侧边栏点击自动提取刻度齿，或双击端点手动标定。', 4500);
    } else if (targetStage === 7) {
      currentStage = 7;
      updateWorkflowBar();
      inspector?.updateData(canvasComponent.data);
      setHudNotice('👉 已进入 Step 7 采样层位！点击侧栏【提取采样共识】或从外部粘贴真实层位。', 4500);
    } else if (targetStage === 8) {
      currentStage = 8;
      updateWorkflowBar();
      inspector?.updateData(canvasComponent.data);
      setHudNotice('🔍 已进入 Step 8 地学校验！正在核验组分总和 ≤100% 门禁与空层位排查。', 4000);
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
      <div style="display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0;">
        <span style="background: ${tokens.color.column.activeBadge}; color: #fff; font-weight: 700; font-size: 10px; padding: 2px 7px; border-radius: 9999px; flex-shrink: 0;">S${currentStage}</span>
        <strong style="color: var(--accent-blue); flex-shrink: 0;">${meta.stepName}</strong>
        <span style="color: var(--text-secondary); font-size: 11px; flex: 1 1 auto; min-width: 0; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${meta.guideText}</span>
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
      if (currentStage === 8) {
        propertyPanel.updateData(canvasComponent.data);
        propertyPanel.openExportModal();
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
      if (col) {
        history.push(`Rename Taxa ${col.name} to ${newName}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
        canvasComponent.requestRender();
        inspector?.updateData(canvasComponent.data);
        toolbar?.updateHistoryState();
        updateFooter();
        scheduleAutosave();
        setHudNotice(`🏷️ 属种已更名为: ${newName}`);
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
      const startX = refCol ? refCol.endX : canvasComponent.data.roi.xMin;
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

  // 8.3 全局偏好与系统设置弹窗 (语言/外观/远程访问网关/WebMCP)
  const settingsModal = new SettingsModal(
    document.body,
    rpcClient,
    () => {
      setHudNotice(t('settings.saved'), 3500);
      toolbar?.updateStatus(rpcClient.getStatus());
    }
  );

  // 8. 标定与弹窗交互面板
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
    (projectData: DiagramData) => {
      canvasComponent.loadNewDiagram(projectData);
      history.reset(projectData.columns, projectData.activeTaxaId, projectData.calibration, projectData.roi);
      currentStage = 3;
      updateWorkflowBar();
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      toolbar?.updateScale(canvasComponent.viewport.scale);
      updateFooter();
      void refreshLineMask();
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
      propertyPanel.updateData(canvasComponent.data);
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
      setHudNotice(`去线灵敏度设为: ${strength.toUpperCase()}（按 B 键复核红色标记）`);
      void refreshLineMask();
    },
    onToggleVerticalLineRemoval: (enabled) => {
      verticalLineRemoval = enabled;
      setHudNotice(enabled ? '去线：竖线（坐标轴脊线/列基线）一并剔除' : '去线：仅处理横线');
      void refreshLineMask();
    },
    onStartLineFix: (mode) => {
      if (!canvasComponent.isToolAllowed('linefix')) {
        setHudNotice('线掩膜修正从 S2 起可用。', 4000);
        return;
      }
      // 修正时必须看得见掩膜，否则等于闭眼涂改。B 键叠加层自动打开。
      canvasComponent.viewport.showBinaryOverlay = true;
      canvasComponent.setLineFixMode(mode);
      canvasComponent.setToolMode('linefix');
      toolbar?.updateFilterState(canvasComponent.viewport.imageMode, true);
      setHudNotice(
        mode === 'erase'
          ? '🧽 擦除笔：按住左键涂抹被误标成线的数据区，松手即重算。'
          : '🖌 补线笔：按住左键涂抹算法漏掉的线，松手即重算。',
        6000
      );
    },
    onClearLineFix: () => {
      canvasComponent.data.lineCorrections = [];
      history.push('Clear Line-mask Corrections', canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
      canvasComponent.requestRender();
      void refreshLineMask();
      setHudNotice('已清空全部人工修正笔迹，掩膜回到算法结果。');
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
          setHudNotice(`✅ 已新建并选中有效区: ${res.roi.name}`);
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
        setHudNotice(`⭐ 已将 ${roiId} 设为主有效区 (对应导出 data.csv)`);
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
        setHudNotice(`🗑️ 已删除有效区: ${roiId}`);
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
        setHudNotice(`🏷️ 有效区已更名为: ${newName}`);
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
      try {
        const activeRoi = canvasComponent.data.active_roi_id || canvasComponent.data.rois?.[0]?.id;
        const res = await rpcClient.call<any, any>('algorithm.detectLineCandidates', { roi_id: activeRoi });
        if (res?.candidates) {
          canvasComponent.data.line_candidates = res.candidates;
          canvasComponent.data.selected_candidate_ids = res.candidates.map((c: any) => c.id);
          inspector?.updateData(canvasComponent.data);
          canvasComponent.requestRender();
          setHudNotice(`🔍 已检测出 ${res.candidates.length} 条候选干扰线`);
        }
      } catch (err) {
        reportBackendFailure('检测候选线', err);
      }
    },
    onDetectXTicks: async () => {
      try {
        const activeRoi = canvasComponent.data.active_roi_id || canvasComponent.data.rois?.[0]?.id;
        const res = await rpcClient.call<any, any>('algorithm.detectXTicks', { roi_id: activeRoi });
        if (res?.per_column) {
          setHudNotice(`📐 已成功提取 ${res.per_column.length} 列刻度线齿`);
        }
      } catch (err) {
        reportBackendFailure('自动提取刻度', err);
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
          setHudNotice(`🧬 成功提取 ${res.samples.length} 个跨属种拐点共识采样层位！`, 4000);
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
    onSubmitYCalibration: (topPx, topValue, bottomPx, bottomValue, unit) => {
      void applyDepthCalibration(
        [
          { x: 0, y: topPx },
          { x: 0, y: bottomPx },
        ],
        [topValue, bottomValue],
        unit
      );
    },
    onRoiCommitted: (roi) => {
      void commitRoi(roi);
    },
  });

  /** 去线是否同时剔除竖线（坐标轴脊线、列基线）。 */
  let verticalLineRemoval = true;

  /**
   * 让后端按「当前 ROI + 当前档位 + 当前人工修正」重算线掩膜，并把 QC 叠加层回灌画布。
   *
   * 掩膜只在后端生成：前端历史上另有一套"每行连续墨迹 run 超阈值即整段标红"的
   * 显示逻辑，实测在 Hoya 图上把 Pinus 列 99% 的实心轮廓标成"可删除"，而那张图
   * ROI 内根本没有横向网格线。现在 B 键看到的就是数字化实际剔除的像素。
   */
  async function refreshLineMask(): Promise<void> {
    const strength = canvasComponent.viewport.degridStrength;
    const data = canvasComponent.data;
    if (strength === 'off') {
      // 关闭也要通知后端：它会主动清掉会话里的旧掩膜。只隐藏叠加层是不够的，
      // 否则关闭后数字化仍在减掉那批像素。
      try {
        await rpcClient.applyLineRemoval('off', data.lineCorrections, verticalLineRemoval);
      } catch (err) {
        reportBackendFailure('关闭去线', err);
      }
      canvasComponent.setLineOverlay(null);
      return;
    }
    try {
      const res = await rpcClient.applyLineRemoval(strength, data.lineCorrections, verticalLineRemoval);
      if (!res || !res.overlay_png) {
        canvasComponent.setLineOverlay(null);
        return;
      }
      canvasComponent.setLineOverlay(res.overlay_png);
      inspector?.updateData(data);
      const manual = res.manual_erase_pixels + res.manual_restore_pixels;
      setHudNotice(
        `🧹 去线(${strength}): 剔除 ${res.removed_pixels} px（横线 ${res.horizontal_rows.length} 行 / 竖线 ${res.vertical_cols.length} 列` +
          `${manual > 0 ? `；含人工修正 ${manual} px` : ''}）。按 B 键复核红色标记。`,
        5000
      );
    } catch (err) {
      reportBackendFailure('去线掩膜计算', err);
    }
  }

  /** 把取数区推给后端，并重算依赖 ROI 的线掩膜。 */
  async function commitRoi(roi: DataRoi): Promise<void> {
    try {
      await rpcClient.updateRoi(roi);
    } catch (err) {
      reportBackendFailure('同步取数区到后端', err);
      return;
    }
    await refreshLineMask();
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

  /** 追加一条线掩膜人工修正笔迹并重算叠加层。 */
  async function appendLineFixStroke(stroke: LineMaskStroke): Promise<void> {
    if (canvasComponent.viewport.degridStrength === 'off') {
      setHudNotice('当前去线为「关闭」，修正笔迹已记录但不会生效。请先把去线档位调为弱/中/强。', 6000);
    }
    canvasComponent.data.lineCorrections.push(stroke);
    history.push(
      stroke.mode === 'erase' ? 'Erase Line-mask Mark' : 'Restore Line-mask Mark',
      canvasComponent.data.columns,
      canvasComponent.data.activeTaxaId
    );
    await refreshLineMask();
  }

  /** 进入 Y 轴两点标定：由画布收集两个像素行，实时落格到 Step 3 侧栏。 */
  function startYCalibration(): void {
    currentStage = 3;
    updateWorkflowBar();
    canvasComponent.clearYCalibMarks();
    canvasComponent.setToolMode('ycalib');
    setHudNotice('🎯 请在图上依次点击 Y 轴上两个已知刻度所在的行，数值将实时填入侧栏。', 7000);
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
      canvasComponent.clearYCalibMarks();
      canvasComponent.setToolMode('select');
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      updateFooter();
      setHudNotice(
        `✅ Y 轴已标定: Y=${res.canvas.top_px}px → ${res.canvas.top_cm} ${unit}，` +
          `Y=${res.canvas.bottom_px}px → ${res.canvas.bottom_cm} ${unit}`,
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

        setHudNotice(`✅ 成功载入 PDF [${file.name}] 第 ${pageNum} 页图谱 (${newDiagramData.imageWidth}×${newDiagramData.imageHeight})！请在画布上调整数据有效区 (Step 1)。`, 5000);
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
      // 导出是产出正式数据的关键路径：后端失败或处于演示模式时，必须明确拒绝，
      // 绝不能交给用户一份前端自算的 CSV。
      try {
        const exportContent = await rpcClient.exportData(format);
        propertyPanel.updateData(canvasComponent.data);
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
      // 归零同时要让后端丢掉旧掩膜，否则重新开始时数字化仍在用上一轮的线
      void refreshLineMask();
      setHudNotice('♻️ 已一键归零：本图全部分列、控制点与标尺已清空，请从 S1 重新框选数据取数区。', 5000);
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
    onChangeDegridStrength: (strength) => {
      canvasComponent.setDegridStrength(strength);
      setHudNotice(`去线灵敏度设为: ${strength.toUpperCase()}（按 B 键复核红色标记）`);
      void refreshLineMask();
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
    setHudNotice(`🤖 WebMCP 已执行: ${actionName}（支持 Ctrl+Z 撤销）`, 3500);
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

  console.log('Straditize Modern Frontend Initialized Successfully');
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to bootstrap Straditize frontend:', err);
  });
});
