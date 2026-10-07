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
import {
  DataRoi,
  DiagramCalibration,
  DiagramData,
  Point2D,
} from './types/pollen';
import { onLocaleChange, applyLocaleToDocument, t } from './i18n';
import { STAGE } from './core/WorkflowStage';
import { WorkflowStage } from './types/workflow';
import { ShortcutService } from './services/ShortcutService';
import { FileLoaderService } from './services/FileLoaderService';
import { WorkflowController } from './services/WorkflowController';
import { CleanupManager } from './services/CleanupManager';
import { createInspectorCallbacks } from './services/InspectorBridge';
import { createToolbarCallbacks } from './services/ToolbarBridge';
import { createSidebarCallbacks } from './services/SidebarBridge';
import { registerWebMcpAndInspectionHandles } from './services/WebMcpBridge';
import {
  showProvenanceGate,
  reportBackendFailure,
  ensureDataProvenance,
  mountProvenanceBanner,
} from './services/ProvenanceGate';
export { reportBackendFailure };

async function bootstrap() {
  const appContainer = document.getElementById('app');
  if (!appContainer) throw new Error('Missing #app container');

  applyLocaleToDocument();

  const savedTheme = localStorage.getItem('straditize-theme');
  if (savedTheme === 'dark') {
    document.body.classList.remove('theme-light');
  } else {
    document.body.classList.add('theme-light');
  }

  const rpcClient = new RpcClient();
  let authModalInstance: AuthModal | null = null;
  rpcClient.onAuthRequired(() => {
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
  if (rpcClient.isAuthNeeded()) return;

  mountProvenanceBanner(rpcClient);

  let initialData: DiagramData;
  try {
    initialData = await rpcClient.getDiagramData();
  } catch (err) {
    console.error('[bootstrap] 初始工程数据获取失败:', err);
    showProvenanceGate((err as Error).message || t('error.unknown')).then(() => window.location.reload());
    return;
  }

  try {
    const synced = await rpcClient.syncCustomTaxaToGlossary();
    if (synced > 0) {
      console.info(`[bootstrap] 已载入 ${synced} 条用户自定义属种词汇`);
    }
  } catch (err) {
    console.warn('[bootstrap] 自定义词汇表同步失败（不影响主流程）:', err);
  }

  const history = new HistoryManager(500);
  history.reset(initialData.columns, initialData.activeTaxaId, initialData.calibration, initialData.roi);

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
        // ignore quota error
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

  const workspace = document.createElement('main');
  workspace.className = 'app-workspace';

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'canvas-wrapper';

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

  const hud = document.createElement('div');
  hud.id = 'canvas-hud';
  hud.className = 'canvas-hud';
  hud.innerHTML = `
    <span class="hud-icon">ℹ️</span>
    <span id="hud-text">${t('hud.default')}</span>
  `;
  canvasWrapper.appendChild(hud);

  let hudTimer: number | null = null;
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

  const cleanupManager = new CleanupManager(
    rpcClient,
    null as any, // 稍后绑入 canvasComponent
    () => sidebar,
    () => inspector,
    () => toolbar,
    {
      setHudNotice,
      reportBackendFailure,
      updateFooter: () => updateFooter(),
    }
  );

  const canvasComponent = new GeologyCanvas(canvasWrapper, initialData, history, {
    onGeometryCommit: cleanupManager.handleGeometryCommit,
    onGeometryDelete: cleanupManager.handleGeometryDelete,
    onGeometrySelected: cleanupManager.handleGeometrySelected,
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
    onDiagramReloaded: () => {
      const data = canvasComponent.data;
      const hasCleanup =
        (data.line_candidates || []).length > 0 || (data.exclusion_regions || []).length > 0;
      if (hasCleanup) {
        void cleanupManager.recomposeCleanupState('重载后重算清理掩膜');
      }
    },
    onRoiCommitted: (roi) => {
      void cleanupManager.enqueueRoiCommit(roi);
    },
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
          setHudNotice(`🎯 已拾取两点像素行 (Y1=${Math.round(topPx)}px, Y2=${Math.round(botPx)}px)！请在右侧侧栏输入对应真实数值并应用标定。`, 5000);
        }
      }
    },
    onLineFixStroke: (stroke) => {
      void cleanupManager.appendLineFixStroke(stroke);
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
      void fileLoader.handleOpenFile(file);
    },
    onStatusNotice: (text) => {
      setHudNotice(text, 2500);
    },
    onOverlayError: (overlayId, error) => {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[overlay] ${overlayId} 渲染失败:`, error);
      setHudNotice(`⚠️ 叠加层 ${overlayId} 渲染失败：${detail}`, 8000);
    },
    onOpenCalibration: () => {
      propertyPanel.openCalibrationModal();
    },
    onOpenFileDialog: () => {
      (document.getElementById('file-input-image') as HTMLInputElement | null)?.click();
    },
    onToggleHelp: () => {
      shortcutService.toggleHelpPanel();
    },
    onToolModeChange: (mode) => {
      const desc = canvasComponent.toolModeManager.getToolDescription(mode);
      const footerModeEl = document.getElementById('footer-tool-mode');
      if (footerModeEl) {
        footerModeEl.innerHTML = `${t('footer.mode')}: <strong>${desc.name} (${desc.shortcut})</strong>`;
      }
    },
  });

  (cleanupManager as any).canvasComponent = canvasComponent;

  const workflowController = new WorkflowController(
    rpcClient,
    canvasComponent,
    canvasWrapper,
    () => toolbar,
    () => sidebar,
    () => inspector,
    () => exportModal,
    {
      setHudNotice,
      reportBackendFailure,
      updateFooter: () => updateFooter(),
      getRoiCommitPromise: () => cleanupManager.getRoiCommitPromise(),
    }
  );

  const shortcutService = new ShortcutService(canvasWrapper, {
    toggleSidebar,
    toggleInspector,
    openSettings: () => settingsModal.open(),
  });

  onLocaleChange(() => {
    applyLocaleToDocument();
    toolbar?.render();
    workflowController.updateWorkflowBar();
    updateFooter();
    updateDrawers();
    shortcutService.renderHelpPanelContent();
    const hudTextEl = document.getElementById('hud-text');
    if (hudTextEl && !hudTimer) {
      hudTextEl.textContent = getDefaultHudText();
    }
  });

  sidebar = new Sidebar(
    canvasComponent.data,
    createSidebarCallbacks({
      rpcClient,
      canvasComponent,
      getSidebar: () => sidebar,
      getInspector: () => inspector,
      getToolbar: () => toolbar,
      updateFooter: () => updateFooter(),
      scheduleAutosave: () => scheduleAutosave(),
      setSidebarCollapsed,
      setHudNotice,
    })
  );

  const ageDepthModal = new AgeDepthModal(
    document.body,
    canvasComponent.data,
    rpcClient,
    (_extractedModel) => {
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      setHudNotice('✅ 成功将年代-深度模型关联至花粉图谱！');
    }
  );

  const metadataModal = new MetadataModal(
    document.body,
    rpcClient,
    () => {
      setHudNotice('✅ 图谱元数据已保存更新！');
    }
  );

  const ocrReviewModal = new OcrReviewModal(
    document.body,
    canvasComponent.data,
    rpcClient,
    () => {
      sidebar?.updateData(canvasComponent.data);
      inspector?.updateData(canvasComponent.data);
      toolbar?.updateHistoryState();
      canvasComponent.requestRender();
      updateFooter();
      scheduleAutosave();
      setHudNotice('✅ 成功应用 OCR 识别结果并更新属种列名！');
    }
  );

  const openOcrReviewModal = (): void => {
    void ocrReviewModal.open(canvasComponent.data);
  };

  const settingsModal = new SettingsModal(
    document.body,
    rpcClient,
    () => {
      setHudNotice(t('settings.saved'), 3500);
      toolbar?.updateStatus(rpcClient.getStatus());
    }
  );

  const onProjectLoad = (projectData: DiagramData) => {
    canvasComponent.loadNewDiagram(projectData);
    history.reset(projectData.columns, projectData.activeTaxaId, projectData.calibration, projectData.roi);
    workflowController.setCurrentStage(STAGE.Y_CALIB);
    workflowController.updateWorkflowBar();
    sidebar?.updateData(canvasComponent.data);
    inspector?.updateData(canvasComponent.data);
    toolbar?.updateHistoryState();
    toolbar?.updateScale(canvasComponent.viewport.scale);
    updateFooter();
    void cleanupManager.recomposeCleanupState('载入项目后重算清理掩膜');
    setHudNotice('✅ 成功载入 Straditize 科学项目包 (.tar)！已 100% 还原全部属种、刻度钉与控制点。', 4500);
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
      canvasComponent.data.calibration = newCal;
      history.push('Update Grid Settings', canvasComponent.data.columns, canvasComponent.data.activeTaxaId, newCal, canvasComponent.data.roi);
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      updateFooter();
    },
    (roi: DataRoi) => {
      new ResizeRoiCommand(canvasComponent.data.roi, roi).execute(canvasComponent.data);
      canvasComponent.requestRender();
      void cleanupManager.commitRoi(roi);
    },
    onProjectLoad
  );

  const fileLoader = new FileLoaderService(
    rpcClient,
    canvasComponent,
    history,
    () => sidebar,
    () => toolbar,
    () => inspector,
    {
      setHudNotice,
      reportBackendFailure,
      updateWorkflowBar: () => workflowController.updateWorkflowBar(),
      updateFooter: () => updateFooter(),
      setCurrentStage: (st) => workflowController.setCurrentStage(st as WorkflowStage),
      openProjectFile: (file) => projectManager.openProjectFile(file),
    }
  );

  function startYCalibration(): void {
    workflowController.setCurrentStage(STAGE.Y_CALIB);
    workflowController.updateWorkflowBar();
    canvasComponent.clearYCalibMarks();
    canvasComponent.setToolMode('ycalib');
    setHudNotice('🎯 请在图上依次点击 Y 轴上两个已知刻度所在的行，数值将实时填入侧栏。', 7000);
  }

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
      if (workflowController.getCurrentStage() === 3) {
        canvasComponent.setToolMode('ycalib');
      } else {
        canvasComponent.setToolMode('select');
      }
      canvasComponent.requestRender();
      inspector?.updateData(canvasComponent.data);
      updateFooter();
      setHudNotice(
        `✅ Y 轴已标定: Y1=${res.canvas.top_px}px → ${res.canvas.top_cm} ${unit}，` +
          `Y2=${res.canvas.bottom_px}px → ${res.canvas.bottom_cm} ${unit}`,
        6000
      );
    } catch (err) {
      reportBackendFailure('Y 轴两点标定', err);
    }
  }

  inspector = new Inspector(
    canvasComponent.data,
    history,
    createInspectorCallbacks(
      rpcClient,
      canvasComponent,
      () => sidebar,
      () => toolbar,
      () => inspector,
      () => exportModal,
      () => ocrReviewModal,
      cleanupManager,
      workflowController,
      {
        setHudNotice,
        reportBackendFailure,
        updateFooter: () => updateFooter(),
        scheduleAutosave: () => scheduleAutosave(),
        applyDepthCalibration,
        startYCalibration,
        setInspectorCollapsed,
      }
    )
  );

  toolbar = new Toolbar(
    history,
    rpcClient.getStatus(),
    createToolbarCallbacks({
      rpcClient,
      canvasComponent,
      getSidebar: () => sidebar,
      getInspector: () => inspector,
      getToolbar: () => toolbar,
      propertyPanel,
      exportModal,
      projectManager,
      ageDepthModal,
      metadataModal,
      ocrReviewModal,
      settingsModal,
      cleanupManager,
      workflowController,
      fileLoader,
      setHudNotice,
      reportBackendFailure,
      updateFooter: () => updateFooter(),
      toggleSidebar,
      toggleInspector,
      openOcrReviewModal,
      clearAutosaveTimer: () => {
        if (autosaveTimer) {
          clearTimeout(autosaveTimer);
          autosaveTimer = null;
        }
      },
      autosaveKey: AUTOSAVE_KEY,
    })
  );

  toolbar.setViewControlsHost(workflowController.getViewControlsBar());

  rpcClient.setStatusCallback((status) => {
    toolbar?.updateStatus(status);
  });

  const clientStatus = rpcClient.getStatus();
  if (clientStatus.isDesktopMode ?? initialData.isDesktopMode) {
    toolbar.setDesktopMode(true);
  }

  workspace.appendChild(sidebar.getElement());
  workspace.appendChild(canvasWrapper);
  workspace.appendChild(inspector.getElement());

  appContainer.appendChild(toolbar.getElement());
  appContainer.appendChild(workspace);
  appContainer.appendChild(footer);

  if (initialSidebarCollapsed) setSidebarCollapsed(true);
  if (initialInspectorCollapsed) setInspectorCollapsed(true);

  workflowController.updateWorkflowBar();

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

  canvasComponent.canvas.addEventListener('wheel', () => {
    toolbar?.updateScale(canvasComponent.viewport.scale);
  });

  window.addEventListener('resize', () => {
    canvasComponent.handleResize();
  });

  requestAnimationFrame(() => {
    canvasComponent.handleResize();
    canvasComponent.fitToScreen();
    toolbar?.updateScale(canvasComponent.viewport.scale);
  });

  updateFooter();
  toolbar?.updateScale(canvasComponent.viewport.scale);
  toolbar?.updateFilterState(canvasComponent.viewport.imageMode, canvasComponent.viewport.showBinaryOverlay);

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
    // ignore
  }

  registerWebMcpAndInspectionHandles({
    rpcClient,
    canvasComponent,
    getSidebar: () => sidebar,
    getInspector: () => inspector,
    getToolbar: () => toolbar,
    workflowController,
    updateFooter: () => updateFooter(),
    scheduleAutosave: () => scheduleAutosave(),
    setHudNotice,
  });

  console.log('Straditize Modern Frontend Initialized Successfully');
}

window.addEventListener('DOMContentLoaded', () => {
  bootstrap().catch((err) => {
    console.error('Failed to bootstrap Straditize frontend:', err);
  });
});
