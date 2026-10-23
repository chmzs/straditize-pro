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
import { AboutModal } from '../components/AboutModal';
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
  aboutModal: AboutModal;
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
    /**
     * 【重置全部操作】归零前端与后端。
     *
     * ## 为什么必须先 `await` 后端再动清理掩膜（B-07）
     *
     * 旧实现三步各自为政：`resetAllOperations()`（同步改前端）→
     * `void resetProjectState()`（**未 await**，`project.new` 还在飞）→
     * `void recomposeCleanupState(...)`（立刻用旧 roi id 去算掩膜）。
     *
     * `project.new` 会把后端 `rois` 清空（`session_parts/project.py:139`
     * 之前调 `_init_rois()`），此时再拿 `roi_1` 调
     * `algorithm.applyLineRemoval` 必定 `-32001 前置状态缺失：未找到 ROI 'roi_1'`
     * ——已实测，是**必然**失败而非偶发竞态。红框里的因果关系完全是错位的：
     * 用户以为重置失败，实际重置成功、错的是这条重建掩膜的调用。
     *
     * 修法不是 try/catch 吞掉（`docs/ARCHITECTURE.md` §2 禁止静默兜底），而是：
     *
     * 1. 后端归零**先**做并 await —— 失败即冒泡，绝不假装重置成功；
     * 2. 归零后后端本就**没有 ROI**，此时不存在"该重算的清理掩膜"
     *    （`project.new` 已清空 candidates / strokes / regions），
     *    所以整条 `recomposeCleanupState` 调用**删掉**，而不是加守卫；
     * 3. 前端画布的建议框写回后端（`roi.update` 在无 ROI 时会创建 pollen），
     *    再用后端权威数据重建镜像 —— 否则 `data.rois` 会残留归零前的旧列表，
     *    画布上照样画出已不存在的 ROI。
     */
    onResetAll: async () => {
      const confirmed = window.confirm(
        '确定要重置当前图谱的全部操作吗？\n\n' +
          '· 将清空：全部分列、控制点、刻度钉、深度标尺与 ROI 边界\n' +
          '· 撤销历史将一并清空，且本操作不可撤销\n' +
          '· 底图图片本身会完整保留\n\n' +
          '重置后可从 S1（框选数据有效区）重新开始。'
      );
      if (!confirmed) return;

      // 1. 后端归零：这一步失败就没有"已重置"可言，冒泡并停住。
      try {
        await p.rpcClient.resetProjectState();
      } catch (err) {
        p.reportBackendFailure('重置全部操作', err);
        return;
      }

      // 2. 前端画布复位（纯本地状态；此时后端已确认归零）
      p.canvasComponent.resetAllOperations();

      p.clearAutosaveTimer();
      try {
        localStorage.removeItem(p.autosaveKey);
      } catch {
        // ignore
      }

      // 3. 把画布的建议框写回后端，并按后端权威状态重建镜像。
      //    归零后 `getDiagramData` 的 `rois` 为空，若只改前端就会留下
      //    "前端有 ROI、后端没有" 的分裂态（后续任何 roi_id 都会 -32001）。
      if (p.canvasComponent.data.imageSrc) {
        const box = p.canvasComponent.data.roi;
        try {
          await p.rpcClient.roiUpdate({
            x0: box.xMin,
            x1: box.xMax,
            y0: box.yMin,
            y1: box.yMax,
          });
          const fresh = await p.rpcClient.getDiagramData();
          p.canvasComponent.loadNewDiagram(fresh);
        } catch (err) {
          p.reportBackendFailure('重建数据有效区', err);
          return;
        }
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
      // 上面的 `loadNewDiagram` 会经 `onDataChange` 重新排一次自动存档，
      // 刚清掉的草稿会在 1 秒后以"空草稿"回来 —— 再清一次定时器把它按住。
      p.clearAutosaveTimer();
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
    onOpenAbout: () => {
      p.aboutModal.open();
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
