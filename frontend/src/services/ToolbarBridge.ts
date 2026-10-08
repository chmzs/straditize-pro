import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Toolbar } from '../components/Toolbar';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { PropertyPanel } from '../components/PropertyPanel';
import { ExportModal } from '../components/ExportModal';
import { ProjectManager } from '../core/ProjectManager';
import { AgeDepthModal } from '../components/AgeDepthModal';
import { MetadataModal } from '../components/MetadataModal';
import { OcrReviewModal } from '../components/OcrReviewModal';
import { SettingsModal } from '../components/SettingsModal';
import { CleanupManager } from './CleanupManager';
import { WorkflowController } from './WorkflowController';
import { FileLoaderService } from './FileLoaderService';
import { ImageDisplayMode } from '../core/Viewport';
import { WorkflowStage, WORKFLOW_STAGES } from '../types/workflow';
import { getLocale } from '../i18n';

export interface ToolbarBridgeParams {
  rpcClient: RpcClient;
  canvasComponent: GeologyCanvas;
  getSidebar: () => Sidebar | undefined;
  getInspector: () => Inspector | undefined;
  getToolbar: () => Toolbar | undefined;
  propertyPanel: PropertyPanel;
  exportModal: ExportModal;
  projectManager: ProjectManager;
  ageDepthModal: AgeDepthModal;
  metadataModal: MetadataModal;
  ocrReviewModal: OcrReviewModal;
  settingsModal: SettingsModal;
  cleanupManager: CleanupManager;
  workflowController: WorkflowController;
  fileLoader: FileLoaderService;
  setHudNotice: (text: string, duration?: number) => void;
  reportBackendFailure: (action: string, error: unknown) => void;
  updateFooter: () => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  openOcrReviewModal: () => void;
  clearAutosaveTimer: () => void;
  autosaveKey: string;
}

export function createToolbarCallbacks(p: ToolbarBridgeParams) {
  return {
    onFit: () => {
      p.canvasComponent.fitToScreen();
      p.getToolbar()?.updateScale(p.canvasComponent.viewport.scale);
    },
    onReset100: () => {
      p.canvasComponent.resetZoom100();
      p.getToolbar()?.updateScale(p.canvasComponent.viewport.scale);
    },
    onZoomIn: () => {
      const rect = p.canvasComponent.canvas.getBoundingClientRect();
      p.canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 1.25);
      p.canvasComponent.requestRender();
      p.getToolbar()?.updateScale(p.canvasComponent.viewport.scale);
    },
    onZoomOut: () => {
      const rect = p.canvasComponent.canvas.getBoundingClientRect();
      p.canvasComponent.viewport.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, 0.8);
      p.canvasComponent.requestRender();
      p.getToolbar()?.updateScale(p.canvasComponent.viewport.scale);
    },
    onUndo: () => {
      const prev = p.canvasComponent.history.undo();
      if (prev) {
        p.cleanupManager.applyHistorySnapshot(prev);
      }
    },
    onRedo: () => {
      const next = p.canvasComponent.history.redo();
      if (next) {
        p.cleanupManager.applyHistorySnapshot(next);
      }
    },
    onDigitize: async () => {
      const activeCol = p.canvasComponent.getActiveColumn();
      if (!activeCol) return;
      try {
        const points = await p.rpcClient.digitizeColumn(activeCol.id);
        if (points.length > 0) {
          activeCol.controlPoints = points;
          p.canvasComponent.history.push(
            `Re-digitize ${activeCol.name}`,
            p.canvasComponent.data.columns,
            p.canvasComponent.data.activeTaxaId
          );
          p.canvasComponent.requestRender();
          p.getSidebar()?.updateData(p.canvasComponent.data);
        }
      } catch (err) {
        p.reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onExport: async (format: 'csv' | 'json') => {
      p.exportModal.updateData(p.canvasComponent.data);
      const cols = p.canvasComponent.data.columns || [];
      const hasPoints = cols.some((c) => c.controlPoints && c.controlPoints.length > 0);

      if (cols.length === 0 || !hasPoints) {
        p.setHudNotice(
          getLocale() === 'en'
            ? 'Notice: Please complete Step 5 columns & extraction before exporting. Opening readiness checklist.'
            : '提示：当前图谱尚未切分属种列或提取数据，已为您打开导出就绪清单。请先完成 Step 5 分列与提取再导出。',
          5000
        );
        p.exportModal.open('', format);
        return;
      }

      try {
        const exportContent = await p.rpcClient.exportData(format);
        p.exportModal.open(exportContent, format);
      } catch (err) {
        p.reportBackendFailure('数据导出', err);
      }
    },
    onSaveProject: () => {
      void p.projectManager.saveProjectFile();
      p.setHudNotice('数字化项目已打包导出为标准归档包 (.tar)！', 3500);
    },
    onOpenProjectFile: (file: File) => {
      p.projectManager.openProjectFile(file);
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

      p.canvasComponent.resetAllOperations();
      void p.rpcClient.resetProjectState();

      p.clearAutosaveTimer();
      try {
        localStorage.removeItem(p.autosaveKey);
      } catch {
        // ignore
      }

      p.workflowController.setCurrentStage(1);
      p.workflowController.updateWorkflowBar();
      p.getSidebar()?.updateData(p.canvasComponent.data);
      p.getInspector()?.updateData(p.canvasComponent.data);
      p.getToolbar()?.updateHistoryState();
      p.getToolbar()?.updateScale(p.canvasComponent.viewport.scale);
      p.getToolbar()?.updateFilterState(
        p.canvasComponent.viewport.imageMode,
        p.canvasComponent.viewport.showBinaryOverlay
      );
      p.updateFooter();
      if (p.canvasComponent.data.imageSrc) {
        void p.cleanupManager.recomposeCleanupState('归零后重算清理掩膜');
      }
      p.setHudNotice('已重置：本图全部分列、控制点与标尺已清空，请从步骤 1 重新框选数据有效区。', 5000);
    },
    onOpenCalibrationModal: () => {
      p.propertyPanel.openCalibrationModal();
    },
    onOpenMetadataModal: () => {
      p.metadataModal.open();
    },
    onOpenOcrReviewModal: p.openOcrReviewModal,
    onOpenAgeDepthModal: () => {
      p.ageDepthModal.open();
    },
    onOpenSettings: () => {
      p.settingsModal.open();
    },
    onToggleRpcConfig: () => {
      p.settingsModal.open();
    },
    onOpenFile: (file: File) => {
      void p.fileLoader.handleOpenFile(file);
    },
    onLoadSample: (sampleKey: string) => {
      void p.fileLoader.handleLoadSample(sampleKey);
    },
    onChangeImageMode: (mode: ImageDisplayMode) => {
      p.canvasComponent.viewport.imageMode = mode;
      p.canvasComponent.requestRender();
      p.getToolbar()?.updateFilterState(mode, p.canvasComponent.viewport.showBinaryOverlay);
      p.setHudNotice(`底图滤镜模式切换为: ${mode}`);
    },
    onToggleBinaryOverlay: () => {
      const active = p.canvasComponent.viewport.toggleBinaryOverlay();
      p.canvasComponent.requestRender();
      p.getToolbar()?.updateFilterState(p.canvasComponent.viewport.imageMode, active);
      p.setHudNotice(
        active
          ? '透视遮罩: 去线复核模式 [开启] (白=保留墨迹，红=实际剔除像素，快捷键 B)'
          : '透视遮罩: [关闭]'
      );
    },
    onSelectToolMode: (mode: any) => {
      p.canvasComponent.setToolMode(mode);
      p.getToolbar()?.setToolMode(mode);
      const desc = p.canvasComponent.toolModeManager.getToolDescription(mode);
      const footerModeEl = document.getElementById('footer-tool-mode');
      if (footerModeEl) {
        footerModeEl.innerHTML = `模式: <strong>${desc.name} (${desc.shortcut})</strong>`;
      }
      p.setHudNotice(`工具模式切换: ${desc.name} (${desc.shortcut}) - ${desc.hint}`);
    },
    onToggleSidebar: () => {
      p.toggleSidebar();
    },
    onToggleInspector: () => {
      p.toggleInspector();
    },
    onStepClick: (step: number) => {
      void p.workflowController.advanceToWorkflowStage(step as WorkflowStage);
      const meta = WORKFLOW_STAGES[p.workflowController.getCurrentStage()];
      p.setHudNotice(`切换至步骤 ${step}: ${meta.stepName} - ${meta.title}`);
    },
    onShutdown: () => {
      void p.rpcClient.requestShutdown();
    },
  };
}
