import { RpcClient } from './RpcClient';
import { showConfirmDialog } from '../ui/confirm';
import { undoStack, refreshUndoButtons } from '../core/undoRuntime';
import { makeRenameUndo } from '../core/undoActions';
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
  applyDepthCalibration: (marks: Point2D[], values: number[], unit: string, primaryAxis?: 'depth' | 'age') => Promise<void>;
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
    onSetToolMode: (mode: any) => {
      canvasComponent.setToolMode(mode);
      getToolbar()?.setToolMode(mode);
    },
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
          callbacks.setHudNotice(`属种 ${activeCol.name} 轮廓已重新识别。`);
        }
      } catch (err) {
        callbacks.reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onDataChange: () => {
      canvasComponent.requestRender();
      getSidebar()?.updateData(canvasComponent.data);
      getInspector()?.updateData(canvasComponent.data);
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
          callbacks.setHudNotice(`属种 ${activeCol.name} 轮廓已重新识别。`);
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
        // 产品决策 ③：新建 ROI 是**待用户框选的空区域**，不是当前 ROI 的克隆。
        //
        // 因此这里刻意**不传** x0/x1/y0/y1，也**不传** name：
        // - 不传边界 → 后端按默认值 [0,0]×[0,0] 建一个零面积壳，用户随后在画布上框选；
        //   传当前 ROI 的边界会让新区域与旧区域逐像素重合（用户看不出任何区别）。
        // - 不传 name → 后端自己编号并记 `name_source="default"`；显式传 name 会被
        //   打成 "user"，等于谎称这是用户起的名字，后续重命名语义也会被污染。
        const res = await rpcClient.call<any, any>('roi.create', { composition: true });
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
      // 删除会**级联删掉该 ROI 下的全部列**且不可撤销（`session_parts/roi.py:283-309`）。
      // 后端为此要求显式 `confirm_drop_columns: true`，旧前端永远只发 `{ roi_id }`，
      // 于是这条删除对"有列的 ROI"**永远做不到**：用户只拿到一条 -32002 报错，
      // 界面上没有任何可以"确认"的地方。
      //
      // "有多少列会被连带删掉"**必须问后端**：这是破坏性操作的边界，不能拿前端镜像
      // 里可能缺失/过期的 `col.roi_id` 去数（实测镜像里该字段可能为空，数出 0 就会
      // 直接跳过确认、把 -32002 死路留在原地）。
      let doomed: Array<{ id: string; name?: string }> = [];
      try {
        const fresh = await rpcClient.getDiagramData();
        doomed = ((fresh.columns ?? []) as Array<{ id: string; name?: string; roi_id?: string }>).filter(
          (c) => c.roi_id === roiId
        );
      } catch (err) {
        // 拿不到边界就不许"猜着删"：明确报错并停在原地。
        callbacks.reportBackendFailure('读取待删除列清单', err);
        return;
      }

      if (doomed.length > 0) {
        const roiName = (canvasComponent.data.rois || []).find((r) => r.id === roiId)?.name || roiId;
        const names = doomed.slice(0, 3).map((c) => c.name || c.id).join('、');
        const more = doomed.length > 3 ? ` 等（共 ${doomed.length} 列）` : '';
        const ok = await showConfirmDialog(
          '删除有效区并连带删除列',
          `有效区「${roiName}」下有 ${doomed.length} 列：${names}${more}。删除该有效区会把这些列一并删除，且无法撤销。`,
          { confirmText: `删除 ${doomed.length} 列并删除有效区`, destructive: true }
        );
        // 取消 = **一发请求都不发**（不能"先试着删、失败了再问"）。
        if (!ok) return;
      }
      try {
        await rpcClient.call('roi.remove', {
          roi_id: roiId,
          confirm_drop_columns: doomed.length > 0,
        });
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
          const prevName = (rois.find((r) => r.id === activeId)?.name ?? '') as string;
          await rpcClient.call('roi.update', { roi_id: activeId, name: newName });
          // U3b：ROI 改名同样登记为可撤销动作（逆操作 = 用同一个 roi.update 写回旧名）
          if (prevName && prevName !== newName) {
            undoStack.push(
              makeRenameUndo(
                'roi',
                activeId,
                prevName,
                newName,
                async (name) => {
                  await rpcClient.call('roi.update', { roi_id: activeId, name });
                  const fresh = await rpcClient.getDiagramData();
                  canvasComponent.loadNewDiagram(fresh);
                  getSidebar()?.updateData(canvasComponent.data);
                  getInspector()?.updateData(canvasComponent.data);
                },
                async () => {
                  const fresh = (await rpcClient.getDiagramData()) as any;
                  const roi = (fresh.rois || []).find((r: any) => r.id === activeId);
                  return (roi?.name ?? '') as string;
                }
              )
            );
          }
        }
        const freshData = await rpcClient.getDiagramData();
        canvasComponent.loadNewDiagram(freshData);
        getSidebar()?.updateData(canvasComponent.data);
        getInspector()?.updateData(canvasComponent.data);
        refreshUndoButtons({
          canUndo: undoStack.state.canUndo || canvasComponent.history.canUndo(),
          canRedo: undoStack.state.canRedo,
        });
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
        // 必须走 `applyCleanupState`，不能只塞 overlay：
        // 这个响应里除了掩膜还有 `stats`（排除区像素计入统计）与 `warnings`
        // （排除区盖住某列轴线的告警）。此前只取 `overlay_png`，于是"排除区盖住
        // 整列"这件事在界面上完全不可见 —— 用户只能在下游看到一列恒为 0。
        cleanupManager.applyCleanupState(maskRes);
        callbacks.setHudNotice(`已划定排除区 [X: ${exX0}~${exX1}]：该区间内的墨迹不参与数字化取数。`, 4500);
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
        let detectedCount = 0;
        let calibratedCount = 0;
        let skippedNoReading = 0;
        if (res?.per_column && Array.isArray(res.per_column)) {
          for (const item of res.per_column) {
            const idx = item.column_index;
            const col =
              canvasComponent.data.columns[idx] ||
              canvasComponent.data.columns.find((c) => c.col_index === idx);
            if (col && Array.isArray(item.ticks)) {
              // 检测结果**只**记录齿位，不写标定（`Algorithm` 层是只读的）。
              col.detected_ticks = item.ticks;
              if (item.ticks.length >= 2) {
                detectedCount++;
                // 注意：这里曾经用 `?? 0` / `?? 20` 兜底，等于**替用户编造读数**
                // 再写进后端（违反 ARCHITECTURE §2：数据只能来自用户输入或真实计算）。
                // 现在要求该列已有**真实存在的**读数（用户标定过，或来自列尺度），
                // 否则只更新齿位、不动 x_ticks，并累计"待人工标定"。
                const existingTicks = col.x_ticks;
                const hasRealReading =
                  Array.isArray(existingTicks) &&
                  existingTicks.length === 2 &&
                  Number.isFinite(existingTicks[0]?.value) &&
                  Number.isFinite(existingTicks[1]?.value) &&
                  existingTicks[0].value !== existingTicks[1].value;
                const p2 = item.ticks[item.ticks.length - 1];
                const p1 = col.startX;
                col.tickEndX = p2;
                if (!hasRealReading) {
                  skippedNoReading++;
                  continue; // 不编造读数：交给用户在步骤 6 填
                }
                const val1 = existingTicks![0].value;
                const val2 = existingTicks![1].value;
                const unit = col.unit || '%';
                try {
                  const calibRes = await rpcClient.calibrateColumnXTicks(
                    col.col_index ?? idx,
                    [
                      { px: p1, value: val1 },
                      { px: p2, value: val2 },
                    ],
                    unit
                  );
                  col.x_ticks = calibRes.x_ticks;
                  calibratedCount++;
                } catch (calibErr) {
                  console.warn(`[onDetectXTicks] 标定列 ${col.name} 失败:`, calibErr);
                }
              }
            }
          }
        }
        canvasComponent.requestRender();
        getSidebar()?.updateData(canvasComponent.data);
        getInspector()?.updateData(canvasComponent.data);
        getToolbar()?.updateHistoryState();
        callbacks.updateFooter();
        callbacks.scheduleAutosave();
        if (detectedCount > 0) {
          // 明确区分"检测到齿位"与"已标定"：前者是几何发现，后者需要真实读数。
          callbacks.setHudNotice(
            `已识别 ${detectedCount} 个属种列的刻度齿位置；` +
              (calibratedCount > 0 ? `${calibratedCount} 列按既有读数更新标定。` : '') +
              (skippedNoReading > 0
                ? `另有 ${skippedNoReading} 列缺读数，请在下方填入真实刻度值后保存（不会替你填）。`
                : ''),
            7000
          );
        } else {
          callbacks.setHudNotice('未检测到明显的刻度齿，您可直接在图上拖拽绿色圆点或在右侧输入数值标定。', 5000);
        }
      } catch (err) {
        callbacks.reportBackendFailure('自动提取刻度', err);
      }
    },
    onCalibrateXTicks: async (
      colIndex: number,
      val1Raw: string,
      val2Raw: string
    ) => {
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
      // 端点像素**不传**：由后端自检（轴线右缘 + 检测末齿）。
      // 读数语义在前端、端点几何在后端——各管一段，谁都不替对方编。
      const unit = col.unit || '%';
      try {
        const res = await rpcClient.calibrateColumnXTicks(
          colIndex,
          [{ value: val1 }, { value: val2 }],
          unit
        );
        col.x_ticks = res.x_ticks;
        // 就地同步后端派生字段（取值器只读这两个，见 CoordinateSystem.resolveColumnScale）。
        // 端点用**后端返回值**里的 x_ticks：前端已经没有端点可猜了。
        const [rt0, rt1] = res.x_ticks;
        col.scaleCalib = {
          originX: Number(rt0.px),
          originVal: Number(rt0.value),
          calibX: Number(rt1.px),
          calibVal: Number(rt1.value),
          unit,
        };
        col.scale_provenance = { calibrated: true, source: 'x_ticks' };
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
          callbacks.setHudNotice(`已提取 ${res.samples.length} 个跨属种拐点共识采样层位。`, 4000);
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
    onSubmitYCalibration: (topPx: number, topValue: number, bottomPx: number, bottomValue: number, unit: string, primaryAxis?: 'depth' | 'age') => {
      const existingMarks = canvasComponent.getYCalibMarks();
      const railX = Math.max(20, canvasComponent.data.roi.xMin - 24);
      void callbacks.applyDepthCalibration(
        [
          { x: existingMarks[0]?.x ?? railX, y: topPx },
          { x: existingMarks[1]?.x ?? railX, y: bottomPx },
        ],
        [topValue, bottomValue],
        unit,
        primaryAxis
      );
    },
    onRoiCommitted: (roi: DataRoi) => {
      void cleanupManager.commitRoi(roi);
    },
    rpcClient,
  };
}
