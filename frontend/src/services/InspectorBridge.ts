import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { Toolbar } from '../components/Toolbar';
import { ExportModal } from '../components/ExportModal';
import { OcrReviewModal } from '../components/OcrReviewModal';
import { CleanupManager } from './CleanupManager';
import { WorkflowController } from './WorkflowController';
import { DataRoi, Point2D } from '../types/pollen';
import { WorkflowStage } from '../types/workflow';

export interface InspectorBridgeCallbacks {
  setHudNotice: (text: string, duration?: number) => void;
  reportBackendFailure: (action: string, error: unknown) => void;
  updateFooter: () => void;
  scheduleAutosave: () => void;
  applyDepthCalibration: (marks: Point2D[], values: number[], unit: string) => Promise<void>;
  startYCalibration: () => void;
  setInspectorCollapsed?: (collapsed: boolean) => void;
}

export function createInspectorCallbacks(
  rpcClient: RpcClient,
  canvasComponent: GeologyCanvas,
  getSidebar: () => Sidebar | undefined,
  getToolbar: () => Toolbar | undefined,
  getInspector: () => Inspector | undefined,
  getExportModal: () => ExportModal | undefined,
  getOcrReviewModal: () => OcrReviewModal | undefined,
  cleanupManager: CleanupManager,
  workflowController: WorkflowController,
  callbacks: InspectorBridgeCallbacks
) {
  return {
    onToggleCollapse: (collapsed: boolean) => {
      callbacks.setInspectorCollapsed?.(collapsed);
    },
    onDigitizeActiveColumn: async () => {
      const activeCol = canvasComponent.getActiveColumn();
      if (!activeCol) return;
      try {
        const points = await rpcClient.digitizeColumn(activeCol.id);
        if (points.length > 0) {
          activeCol.controlPoints = points;
          canvasComponent.history.push(
            `Re-digitize ${activeCol.name}`,
            canvasComponent.data.columns,
            canvasComponent.data.activeTaxaId
          );
          canvasComponent.requestRender();
          getSidebar()?.updateData(canvasComponent.data);
          getInspector()?.updateData(canvasComponent.data);
          callbacks.setHudNotice(`属种 ${activeCol.name} 轮廓已根据图像算法完成重识别！`);
        }
      } catch (err) {
        callbacks.reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onDataChange: () => {
      canvasComponent.requestRender();
      getSidebar()?.updateData(canvasComponent.data);
      getToolbar()?.updateHistoryState();
      callbacks.updateFooter();
    },
    onSelectTaxa: (taxaId: string) => {
      canvasComponent.setActiveTaxa(taxaId);
      callbacks.updateFooter();
    },
    onRedigitizeColumn: async () => {
      const activeCol = canvasComponent.getActiveColumn();
      if (!activeCol) return;
      try {
        const points = await rpcClient.digitizeColumn(activeCol.id);
        if (points.length > 0) {
          activeCol.controlPoints = points;
          canvasComponent.history.push(`Re-digitize ${activeCol.name}`, canvasComponent.data.columns, canvasComponent.data.activeTaxaId);
          canvasComponent.requestRender();
          getSidebar()?.updateData(canvasComponent.data);
          getInspector()?.updateData(canvasComponent.data);
          callbacks.setHudNotice(`属种 ${activeCol.name} 轮廓已根据图像算法完成重识别！`);
        }
      } catch (err) {
        callbacks.reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onOpenDataViewer: () => {
      const modal = getExportModal();
      if (modal) {
        modal.updateData(canvasComponent.data);
        modal.open();
      }
    },
    onOpenOcrReviewModal: () => {
      void getOcrReviewModal()?.open(canvasComponent.data);
    },
    onToggleLayerVisibility: (layer: string, visible: boolean) => {
      if (layer === 'ghost') {
        canvasComponent.viewport.showGhosting = visible;
        canvasComponent.requestRender();
        callbacks.setHudNotice(visible ? '绿色原位半透明对比层已开启' : '绿色对比层已关闭');
      }
    },
    onStartLineFix: (mode: 'erase' | 'restore') => {
      if (!canvasComponent.isToolAllowed('linefix')) {
        callbacks.setHudNotice('线掩膜修正从步骤 4 (清理) 起可用。', 4000);
        return;
      }
      canvasComponent.viewport.showBinaryOverlay = true;
      canvasComponent.setLineFixMode(mode);
      canvasComponent.setToolMode('linefix');
      getToolbar()?.updateFilterState(canvasComponent.viewport.imageMode, true);
      callbacks.setHudNotice(
        mode === 'erase'
          ? '擦除笔：按住左键涂抹被误标成线的数据区，松手即重算。'
          : '补线笔：按住左键涂抹算法漏掉的线，松手即重算。',
        6000
      );
    },
    onClearLineFix: () => {
      void cleanupManager.clearLineFixStrokes();
    },
    onStartYCalibration: () => {
      callbacks.startYCalibration();
    },
    onAdvanceWorkflowStage: (targetStage: number) => {
      void workflowController.advanceToWorkflowStage(targetStage as WorkflowStage);
    },
    onSelectRoi: async (roiId: string) => {
      try {
        await rpcClient.call('roi.setActive', { roi_id: roiId });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        getSidebar()?.updateData(canvasComponent.data);
        getInspector()?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
      } catch (err) {
        callbacks.reportBackendFailure('切换有效区', err);
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
          getSidebar()?.updateData(canvasComponent.data);
          getInspector()?.updateData(canvasComponent.data);
          canvasComponent.requestRender();
          callbacks.setHudNotice(`已新建并选中有效区: ${res.roi.name}`);
        }
      } catch (err) {
        callbacks.reportBackendFailure('新建有效区', err);
      }
    },
    onSetPrimaryRoi: async (roiId: string) => {
      try {
        await rpcClient.call('roi.setPrimary', { roi_id: roiId });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        getInspector()?.updateData(canvasComponent.data);
        callbacks.setHudNotice(`已将 ${roiId} 设为主有效区 (对应导出 data.csv)`);
      } catch (err) {
        callbacks.reportBackendFailure('设置主有效区', err);
      }
    },
    onDeleteRoi: async (roiId: string) => {
      try {
        await rpcClient.call('roi.remove', { roi_id: roiId });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        getSidebar()?.updateData(canvasComponent.data);
        getInspector()?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
        callbacks.setHudNotice(`已删除有效区: ${roiId}`);
      } catch (err) {
        callbacks.reportBackendFailure('删除有效区', err);
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
        getSidebar()?.updateData(canvasComponent.data);
        getInspector()?.updateData(canvasComponent.data);
        callbacks.setHudNotice(`有效区已更名为: ${newName}`);
      } catch (err) {
        callbacks.reportBackendFailure('重命名有效区', err);
      }
    },
    onUpdateRoiComposition: async (composition: boolean) => {
      const activeId = canvasComponent.data.active_roi_id || canvasComponent.data.rois?.[0]?.id;
      if (!activeId) return;
      try {
        await rpcClient.call('roi.update', { roi_id: activeId, composition });
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        getInspector()?.updateData(canvasComponent.data);
      } catch (err) {
        callbacks.reportBackendFailure('更新有效区组分属性', err);
      }
    },
    onDetectLineCandidates: async () => {
      await cleanupManager.runCleanupAction('检测候选线', async () => {
        const res = await rpcClient.call<any, any>('algorithm.detectLineCandidates', {
          roi_id: cleanupManager.activeCleanupRoiId(),
        });
        const composed = await rpcClient.refreshCleanup(cleanupManager.activeCleanupRoiId());
        canvasComponent.setSelectedGeometryId(null);
        const count = res?.candidates?.length ?? composed.candidates?.length ?? 0;
        callbacks.setHudNotice(
          `已检测 ${count} 条候选干扰线（橙色=待确认）。在图上点选/拖动修正，确认后才会真正去除。`,
          5000
        );
        return composed;
      });
    },
    onAddLineGeometry: async (axis: 'h' | 'v') => {
      canvasComponent.setSelectedGeometryId(null);
      canvasComponent.setToolMode(axis === 'h' ? 'drawLineH' : 'drawLineV');
      callbacks.setHudNotice(
        axis === 'h'
          ? '请在图上按住左键，横向拖出一段作为干扰线（拖出的厚度即线宽）。'
          : '请在图上按住左键，竖向拖出一段作为干扰线（拖出的宽度即线宽）。',
        6000
      );
    },
    onEditLineGeometry: async (candidateId: string) => {
      const cand = canvasComponent.data.line_candidates?.find((item) => item.id === candidateId);
      if (!cand) return;
      canvasComponent.setSelectedGeometryId(candidateId);
      callbacks.setHudNotice(
        `已选中 ${cand.axis === 'h' ? '横向' : '竖向'}几何：拖动整体移动，拖端点手柄改范围，Delete 删除。`,
        6000
      );
    },
    onAddExclusionRect: async () => {
      const activeRoi = canvasComponent.data.active_roi_id || canvasComponent.data.rois?.[0]?.id || 'pollen';
      const roi = canvasComponent.data.roi;
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
      getToolbar()?.updateFilterState(canvasComponent.viewport.imageMode, true);

      try {
        const maskRes = await rpcClient.call<any, any>('algorithm.applyLineRemoval', {
          roi_id: activeRoi,
          selected_ids: canvasComponent.data.selected_candidate_ids || [],
          exclusion_regions: canvasComponent.data.exclusion_regions,
        });
        if (maskRes?.overlay_png) {
          canvasComponent.setLineOverlay(maskRes.overlay_png);
        }
        getInspector()?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
        callbacks.setHudNotice(`⛶ 已划定排除区 [X: ${exX0}~${exX1}]！该区域所有墨迹在数字化时将被绝对剔除。`, 4500);
      } catch (err) {
        callbacks.reportBackendFailure('添加排除区', err);
      }
    },
    onToggleCandidateSelection: async (candId: string, selected: boolean) => {
      await cleanupManager.runCleanupAction('更新候选线选择', () =>
        rpcClient.setGeometryStatus(candId, selected ? 'removed' : 'candidate')
      );
      callbacks.setHudNotice(selected ? '已确认该几何：数字化将剔除这块像素。' : '已撤回为待确认：不再剔除。');
    },
    onGeometryCommit: cleanupManager.handleGeometryCommit,
    onGeometryDelete: cleanupManager.handleGeometryDelete,
    onClearCleanupEdits: async () => {
      await cleanupManager.runCleanupAction('清空清理编辑', async () => {
        const roiId = cleanupManager.activeCleanupRoiId();
        const res = await rpcClient.clearCleanupEdits(roiId);
        canvasComponent.setSelectedGeometryId(null);
        canvasComponent.data.line_strokes = [];
        canvasComponent.data.exclusion_regions = (
          canvasComponent.data.exclusion_regions || []
        ).filter((e) => e.roi_id != null && e.roi_id !== roiId);
        callbacks.setHudNotice('已清空本步的全部几何、排除区与笔迹。');
        return res;
      });
    },
    onSetLineThickness: async (thickness: number, candidateId?: string) => {
      await cleanupManager.runCleanupAction('统一几何厚度', () =>
        rpcClient.setLineThickness(thickness, candidateId, cleanupManager.activeCleanupRoiId())
      );
      callbacks.setHudNotice(
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
          callbacks.setHudNotice(`已成功提取 ${res.per_column.length} 列刻度线齿`);
        }
      } catch (err) {
        callbacks.reportBackendFailure('自动提取刻度', err);
      }
    },
    onCalibrateXTicks: async (colIndex: number, val1Raw: string, val2Raw: string) => {
      const col = canvasComponent.data.columns.find((c) => c.col_index === colIndex);
      if (!col) {
        callbacks.reportBackendFailure('标定列 X 刻度', new Error(`载荷里找不到列 ${colIndex}`));
        return;
      }
      const val1 = Number.parseFloat(val1Raw);
      const val2 = Number.parseFloat(val2Raw);
      if (!Number.isFinite(val1) || !Number.isFinite(val2)) {
        callbacks.reportBackendFailure(
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
        col.x_ticks = res.x_ticks;
        canvasComponent.history.push(
          `Calibrate X-Ticks ${col.name}`,
          canvasComponent.data.columns,
          canvasComponent.data.activeTaxaId
        );
        canvasComponent.requestRender();
        getInspector()?.updateData(canvasComponent.data);
        getSidebar()?.updateData(canvasComponent.data);
        getToolbar()?.updateHistoryState();
        callbacks.updateFooter();
        callbacks.scheduleAutosave();
        callbacks.setHudNotice(
          `列 ${col.name} 已标定：X=${res.x_ticks[0].px}px → ${res.x_ticks[0].value}${unit}，` +
            `X=${res.x_ticks[1].px}px → ${res.x_ticks[1].value}${unit}`
        );
      } catch (err) {
        callbacks.reportBackendFailure('标定列 X 刻度', err);
      }
    },
    onClearXTicks: async (colIndex: number) => {
      const col = canvasComponent.data.columns.find((c) => c.col_index === colIndex);
      if (!col) {
        callbacks.reportBackendFailure('清空列 X 刻度', new Error(`载荷里找不到列 ${colIndex}`));
        return;
      }
      try {
        const res = await rpcClient.clearColumnXTicks(colIndex);
        col.x_ticks = null;
        if (res.cleared) {
          canvasComponent.history.push(
            `Clear X-Ticks ${col.name}`,
            canvasComponent.data.columns,
            canvasComponent.data.activeTaxaId
          );
          callbacks.setHudNotice(`列 ${col.name} 的 X 标度已清空（回到未标定）`);
        }
        canvasComponent.requestRender();
        getInspector()?.updateData(canvasComponent.data);
        getSidebar()?.updateData(canvasComponent.data);
        getToolbar()?.updateHistoryState();
        callbacks.updateFooter();
        callbacks.scheduleAutosave();
      } catch (err) {
        callbacks.reportBackendFailure('清空列 X 刻度', err);
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
          getInspector()?.updateData(canvasComponent.data);
          canvasComponent.requestRender();
          callbacks.setHudNotice(`成功提取 ${res.samples.length} 个跨属种拐点共识采样层位！`, 4000);
        }
      } catch (err) {
        callbacks.reportBackendFailure('提取采样层位', err);
      }
    },
    onClearHorizons: async () => {
      try {
        await rpcClient.call('samples.clear', {});
        canvasComponent.data.samples = [];
        getInspector()?.updateData(canvasComponent.data);
        canvasComponent.requestRender();
        callbacks.setHudNotice('已清空全部采样层位');
      } catch (err) {
        callbacks.reportBackendFailure('清空层位', err);
      }
    },
    onPreviewYCalibrationPx: (topPx: number | null, bottomPx: number | null) => {
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
    onSubmitYCalibration: (topPx: number, topValue: number, bottomPx: number, bottomValue: number, unit: string) => {
      const existingMarks = canvasComponent.getYCalibMarks();
      const railX = Math.max(20, canvasComponent.data.roi.xMin - 24);
      void callbacks.applyDepthCalibration(
        [
          { x: existingMarks[0]?.x ?? railX, y: topPx },
          { x: existingMarks[1]?.x ?? railX, y: bottomPx },
        ],
        [topValue, bottomValue],
        unit
      );
    },
    onRoiCommitted: (roi: DataRoi) => {
      void cleanupManager.commitRoi(roi);
    },
    rpcClient,
  };
}
