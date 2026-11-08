import './style.css';
import { RpcClient } from './services/RpcClient';
import { HistoryManager } from './core/HistoryManager';
import { GeologyCanvas } from './components/GeologyCanvas';
import { handleTickPicked } from './components/steps/XTicksPanel';
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
import { AboutModal } from './components/AboutModal';
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
import { applyTheme, createFooterDom, createHudDom, createWorkspaceDom } from './app/dom';
import { createFooterUpdater } from './app/footer';
import { setupDraftRecovery } from './app/draftRecovery';
import { setupScaleSync } from './app/scaleSync';
import { notifyError } from './ui/feedback';
import { installBeforeUnloadGuard } from './app/lifecycle';
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

  applyTheme();

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

  installBeforeUnloadGuard(history);

  let sidebar: any = null;
  let inspector: any = null;
  let toolbar: any = null;

  const { workspace, canvasWrapper, leftDrawerTab, rightDrawerTab, updateDrawers } =
    createWorkspaceDom();

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

  const hud = createHudDom();
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

  const footer = createFooterDom(initialData);

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
    onAxisStrokeCommit: (colIndex, strokePx, previousStroke) => {
      void (async () => {
        try {
          await rpcClient.updateColumn(colIndex, { axis_stroke_px: strokePx });
        } catch (err) {
          // 后端拒绝（列落在 ROI 外 / 轴粗越界）：把画布回滚到拖之前，
          // 否则界面会停在"拖了但没生效"的假象上。
          const col = canvasComponent.data.columns.find(
            (c) => (c.col_index ?? -1) === colIndex
          );
          if (col) col.axis_stroke_px = previousStroke;
          canvasComponent.render();
          notifyError(
            `调整 0 点（轴线粗）失败：${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }
        history.push(
          `Axis stroke → ${strokePx}px (col ${colIndex})`,
          canvasComponent.data.columns,
          canvasComponent.data.activeTaxaId,
          canvasComponent.data.calibration,
          canvasComponent.data.roi
        );
      })();
    },
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
    // 步骤 6：画布点了刻度齿 → 交给步骤 6 面板判定"距 0 点多少"。
    onTickPicked: (pt) => handleTickPicked(pt),
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
            depthEl.innerHTML = `${t('footer.depth')}: <code>${info.depth !== undefined ? info.depth + ' ' + unit : '--'}</code> <strong style="color: var(--accent-blue); margin-left: 6px;">[${t('footer.horizon')}: ${info.horizonDepth} ${unit}]</strong>`;
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
      setHudNotice(`叠加层 ${overlayId} 渲染失败：${detail}`, 8000);
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
      setHudNotice('成功将年代-深度模型关联至花粉图谱！');
    }
  );

  const metadataModal = new MetadataModal(
    document.body,
    rpcClient,
    () => {
      setHudNotice('图谱元数据已保存更新！');
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
      setHudNotice('成功应用 OCR 识别结果并更新属种列名！');
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

  const aboutModal = new AboutModal(document.body);

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
    setHudNotice('请在图上依次点击 Y 轴上两个已知刻度所在的行，数值将实时填入侧栏。', 7000);
  }

  async function applyDepthCalibration(
    marks: Point2D[],
    values: number[],
    unit: string,
    primaryAxis: 'depth' | 'age' = 'depth'
  ): Promise<void> {
    const cal = canvasComponent.data.calibration;
    try {
      const res = await rpcClient.calibrateDepthAxis(
        [
          { pixel: marks[0].y, value: values[0] },
          { pixel: marks[1].y, value: values[1] },
        ],
        unit,
        primaryAxis
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
        `Y 轴已标定: Y1=${res.canvas.top_px}px → ${res.canvas.top_cm} ${unit}，` +
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
      aboutModal,
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

  // 页脚刷新：实现移到 app/footer.ts（纯读，12 处回调共用）。
  const updateFooter = createFooterUpdater({ getCanvas: () => canvasComponent });

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

  setupDraftRecovery({
    projectManager,
    history,
    getCanvas: () => canvasComponent,
    cleanupManager,
    getSidebar: () => sidebar,
    getInspector: () => inspector,
    getToolbar: () => toolbar,
    updateFooter,
    setHudNotice,
    reportBackendFailure,
    autosaveKey: AUTOSAVE_KEY,
  });

  // 标度变更：**只局部同步标度字段**，不重建整棵数据。
  //
  // 试过整表 `loadNewDiagram(fresh)`：代价是选中列被清空（`activeTaxaId` 重置），
  // 而标定后面板正依赖选中列；批量标定还会在循环中途打断步骤 6 面板的检测缓存
  // （实测 col03/col04 被判"未检测到刻度尺"）。
  // 这里只把后端算好的 `x_ticks` / `scaleCalib` / `scale_provenance` 填回同名列对象，
  // 前端不推导、也不重建。
  setupScaleSync({
    rpcClient,
    getCanvas: () => canvasComponent,
    getSidebar: () => sidebar,
    getInspector: () => inspector,
    updateFooter,
    setHudNotice,
  });

  registerWebMcpAndInspectionHandles({
    rpcClient,
    canvasComponent,
    getSidebar: () => sidebar,
    getInspector: () => inspector,
    getToolbar: () => toolbar,
    workflowController,
    propertyPanel,
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
