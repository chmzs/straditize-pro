import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { Toolbar } from '../components/Toolbar';
// 直接取定义处，别从 `../main` 借道：那会让 main ↔ SidebarBridge 形成循环依赖
// （main 装配它、它又反过来 import main 的 re-export），运行时顺序一变就抛
// "Cannot access before initialization"。定义在 ProvenanceGate，main 只是转发。
import { reportBackendFailure } from './ProvenanceGate';
import { undoStack, refreshUndoButtons } from '../core/undoRuntime';
import { makeRenameUndo } from '../core/undoActions';
import { compensationNote, addCompensation } from '../core/compensationNote';

export interface SidebarBridgeParams {
  rpcClient: RpcClient;
  canvasComponent: GeologyCanvas;
  getSidebar: () => Sidebar | undefined;
  getInspector: () => Inspector | undefined;
  getToolbar: () => Toolbar | undefined;
  updateFooter: () => void;
  scheduleAutosave: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setHudNotice: (text: string, duration?: number) => void;
}

export function createSidebarCallbacks(p: SidebarBridgeParams) {
  return {
    onSelectTaxa: (taxaId: string) => {
      p.canvasComponent.setActiveTaxa(taxaId);
      p.updateFooter();
    },
    onToggleVisible: (taxaId: string) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.visible = !col.visible;
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
      }
    },
    onUpdateTaxaColor: (taxaId: string, color: string) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (col) {
        col.color = color;
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
      }
    },
    onChangePlotType: (taxaId: string, plotType: any) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (!col) return;
      // 必须落库。旧实现只改本地镜像 `col.plotType`，下一次 `getDiagramData`
      // 回填就把它抹掉（用户看到的正是「点了形态又变回去」）。
      // `null` = 清除列级覆盖、回到组级形态（组是单一事实源）。
      const colIndex = col.col_index ?? p.canvasComponent.data.columns.indexOf(col);
      void (async () => {
        try {
          await p.rpcClient.updateColumn(colIndex, { plot_type: plotType });
        } catch (err) {
          reportBackendFailure('保存属种形态', err);
          p.getSidebar()?.updateData(p.canvasComponent.data);
          return;
        }
        col.plot_type = plotType;
        col.plotType = plotType ?? undefined;
        p.canvasComponent.history.push(
          plotType
            ? `Change ${col.name} Plot Type to ${plotType}`
            : `Reset ${col.name} Plot Type to group`,
          p.canvasComponent.data.columns,
          p.canvasComponent.data.activeTaxaId
        );
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
        p.getInspector()?.updateData(p.canvasComponent.data);
        p.setHudNotice(
          plotType
            ? `已将属种 [${col.name}] 图形形态切换为: ${String(plotType).toUpperCase()}`
            : `属种 [${col.name}] 已改为跟随组形态`
        );
      })();
    },
    onRenameTaxa: (taxaId: string, newName: string) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (!col) return;
      const prevName = col.name ?? '';
      col.name = newName;
      col.species = newName;
      p.canvasComponent.requestRender();
      p.getInspector()?.updateData(p.canvasComponent.data);
      p.getToolbar()?.updateHistoryState();
      p.updateFooter();
      p.scheduleAutosave();
      void (async () => {
        try {
          await p.rpcClient.renameColumn(taxaId, newName);
          p.canvasComponent.history.push(
            `Rename Taxa ${prevName} to ${newName}`,
            p.canvasComponent.data.columns,
            p.canvasComponent.data.activeTaxaId
          );
          p.getToolbar()?.updateHistoryState();
          // U3：把改名登记为**可撤销动作**（逆操作 = 用同一个 renameColumn 写回旧名）。
          // 只有后端确认写入成功后才 push；逆操作自己刷后端状态，verify 也读后端。
          if (prevName && prevName !== newName) {
            const refreshFromBackend = async () => {
              const fresh = (await p.rpcClient.getDiagramData()) as any;
              p.canvasComponent.loadNewDiagram(fresh);
              p.getSidebar()?.updateData(p.canvasComponent.data);
              p.getInspector()?.updateData(p.canvasComponent.data);
              p.updateFooter();
            };
            undoStack.push(
              makeRenameUndo(
                'column',
                taxaId,
                prevName,
                newName,
                async (name) => {
                  await p.rpcClient.renameColumn(taxaId, name);
                  await refreshFromBackend();
                },
                async () => {
                  const fresh = (await p.rpcClient.getDiagramData()) as any;
                  const col = (fresh.columns || []).find((c: any) => c.id === taxaId);
                  return (col?.name ?? '') as string;
                }
              )
            );
          }
          refreshUndoButtons({
            canUndo: p.canvasComponent.history.canUndo(),
            canRedo: false,
          });
          p.setHudNotice(`属种已更名为: ${newName}`);
        } catch (err) {
          col.name = prevName;
          col.species = prevName;
          (document.activeElement as HTMLElement | null)?.blur?.();
          p.canvasComponent.requestRender();
          p.getSidebar()?.updateData(p.canvasComponent.data);
          p.getInspector()?.updateData(p.canvasComponent.data);
          reportBackendFailure('属种改名', err);
        }
      })();
    },
    onToggleCollapse: (collapsed: boolean) => {
      p.setSidebarCollapsed(collapsed);
    },
    onInsertGapColumn: (afterTaxaId: string) => {
      const cols = p.canvasComponent.data.columns;
      const maxW = p.canvasComponent.data.imageWidth || 8000;
      const curIdx = cols.findIndex((c) => c.id === afterTaxaId);
      const insertAt = curIdx !== -1 ? curIdx + 1 : cols.length;
      const refCol = curIdx !== -1 ? cols[curIdx] : cols[cols.length - 1];
      const rawStartX = refCol ? refCol.endX : p.canvasComponent.data.roi.xMin;
      const width = Math.min(60, Math.max(20, refCol ? refCol.endX - refCol.startX : 60));
      const startX = Math.min(rawStartX, maxW - width);
      const endX = Math.min(startX + width, maxW);

      const newCol = {
        id: `col_${Date.now()}_gap`,
        name: `Gap_Col_${insertAt + 1}`,
        color: '#94a3b8',
        startX: startX,
        endX: endX,
        maxPercent: 20,
        unit: '%',
        curveType: 'linear' as const,
        visible: true,
        isLocked: false,
        controlPoints: [],
      };
      cols.splice(insertAt, 0, newCol);
      p.canvasComponent.history.push(
        `Insert Gap Column ${newCol.name}`,
        p.canvasComponent.data.columns,
        newCol.id
      );
      p.canvasComponent.setActiveTaxa(newCol.id);
      p.canvasComponent.requestRender();
      p.getSidebar()?.updateData(p.canvasComponent.data);
      p.getInspector()?.updateData(p.canvasComponent.data);
      p.getToolbar()?.updateHistoryState();
      p.updateFooter();
      p.setHudNotice(`已插入空白间隔列: ${newCol.name}`);
    },
    onDigitizeColumn: async (taxaId: string) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (!col) return;
      try {
        const { points, curvePoints, brokenRows, ambiguousRows } = await p.rpcClient.digitizeColumnWithStats(col.id);
        if (points.length > 0) {
          col.controlPoints = points;
          if (curvePoints && curvePoints.length > 0) {
            col.curvePoints = curvePoints;
          }
          p.canvasComponent.history.push(
            `Re-digitize ${col.name}`,
            p.canvasComponent.data.columns,
            p.canvasComponent.data.activeTaxaId
          );
          p.canvasComponent.requestRender();
          p.getSidebar()?.updateData(p.canvasComponent.data);
          p.getInspector()?.updateData(p.canvasComponent.data);
          p.setHudNotice(
            `属种 [${col.name}] 轮廓与拐点已重新识别。`
            + compensationNote({ brokenRows, ambiguousRows }),
            compensationNote({ brokenRows, ambiguousRows }) ? 6000 : 3000
          );
        }
      } catch (err) {
        reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onRedigitizeColumn: async (taxaId: string) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (!col) return;
      try {
        const { points, curvePoints, brokenRows, ambiguousRows } = await p.rpcClient.digitizeColumnWithStats(col.id);
        if (points.length > 0) {
          col.controlPoints = points;
          if (curvePoints && curvePoints.length > 0) {
            col.curvePoints = curvePoints;
          }
          p.canvasComponent.history.push(
            `Re-digitize ${col.name}`,
            p.canvasComponent.data.columns,
            p.canvasComponent.data.activeTaxaId
          );
          p.canvasComponent.requestRender();
          p.getSidebar()?.updateData(p.canvasComponent.data);
          p.getInspector()?.updateData(p.canvasComponent.data);
          p.setHudNotice(
            `属种 [${col.name}] 轮廓与拐点已重新识别。`
            + compensationNote({ brokenRows, ambiguousRows }),
            compensationNote({ brokenRows, ambiguousRows }) ? 6000 : 3000
          );
        }
      } catch (err) {
        reportBackendFailure('属种轮廓重识别', err);
      }
    },
    onExtractTurningPoints: async (taxaId: string) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (!col) return;
      const colIndex = col.col_index ?? p.canvasComponent.data.columns.indexOf(col);
      try {
        const res = await p.rpcClient.call<
          { col_index?: number },
          { success?: boolean; columns_updated?: number[]; message?: string }
        >('algorithm.extractTurningPoints', { col_index: colIndex });
        if (res?.success !== true) {
          throw new Error(res?.message || 'algorithm.extractTurningPoints 未返回 success=true');
        }
        const fresh = await p.rpcClient.getDiagramData();
        const freshCol = fresh.columns?.find((c: any) => c.id === col.id);
        if (freshCol && freshCol.controlPoints) {
          col.controlPoints = freshCol.controlPoints;
        }
        p.canvasComponent.history.push(
          `Extract turning points for ${col.name}`,
          p.canvasComponent.data.columns,
          p.canvasComponent.data.activeTaxaId
        );
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
        p.getInspector()?.updateData(p.canvasComponent.data);
        p.setHudNotice(`已为属种 [${col.name}] 自动提取峰谷控制点（手工点保留）。`);
      } catch (err) {
        reportBackendFailure('自动提取峰谷', err);
      }
    },
    onRedigitizeAllColumns: async (resetManual: boolean = false) => {
      try {
        const res = await p.rpcClient.redigitizeAllColumns(resetManual);
        if (res && res.success) {
          const freshData = await p.rpcClient.getDiagramData();
          p.canvasComponent.loadNewDiagram(freshData);
          p.getSidebar()?.updateData(p.canvasComponent.data);
          p.getInspector()?.updateData(p.canvasComponent.data);
          p.canvasComponent.requestRender();
          p.setHudNotice(`已重设全部 ${res.columns_count} 列的轮廓线与拐点。`, 4000);
        }
      } catch (err) {
        reportBackendFailure('重设所有列轮廓与拐点', err);
      }
    },
    onDeleteColumn: async (taxaId: string) => {
      const col = p.canvasComponent.data.columns.find((c) => c.id === taxaId);
      if (!col || p.canvasComponent.data.columns.length <= 1) return;
      const colIndex = col.col_index ?? p.canvasComponent.data.columns.indexOf(col);
      try {
        await p.rpcClient.removeColumn(colIndex);
      } catch (err) {
        reportBackendFailure('删除列', err);
        return;
      }
      const idx = p.canvasComponent.data.columns.findIndex((c) => c.id === col.id);
      if (idx !== -1) {
        p.canvasComponent.data.columns.splice(idx, 1);
        p.canvasComponent.data.columns.forEach((c, i) => {
          c.col_index = i;
        });
        p.canvasComponent.data.activeTaxaId = p.canvasComponent.data.columns[0]?.id || '';
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
        p.getInspector()?.updateData(p.canvasComponent.data);
        p.updateFooter();
        p.setHudNotice(`已删除属种列 [${col.name}]。`);
      }
    },
    onBatchChangePlotType: async (taxaIds: string[], plotType: any) => {
      if (!taxaIds || taxaIds.length === 0) return;
      try {
        for (const tid of taxaIds) {
          const col = p.canvasComponent.data.columns.find((c) => c.id === tid);
          if (!col) continue;
          const colIndex = col.col_index ?? p.canvasComponent.data.columns.indexOf(col);
          await p.rpcClient.updateColumn(colIndex, { plot_type: plotType });
          col.plot_type = plotType;
          col.plotType = plotType ?? undefined;
        }
        p.canvasComponent.history.push(
          `Batch change plot type to ${plotType} for ${taxaIds.length} columns`,
          p.canvasComponent.data.columns,
          p.canvasComponent.data.activeTaxaId
        );
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
        p.getInspector()?.updateData(p.canvasComponent.data);
        const typeName = plotType ? String(plotType).toUpperCase() : '跟随组';
        p.setHudNotice(`已将所选 ${taxaIds.length} 列形态批量切换为: ${typeName}`, 3000);
      } catch (err) {
        reportBackendFailure('批量切换形态', err);
      }
    },
    onBatchDigitizeColumns: async (taxaIds: string[]) => {
      if (!taxaIds || taxaIds.length === 0) return;
      let totalComp = { brokenRows: 0, ambiguousRows: 0 };
      let successCount = 0;
      try {
        for (const tid of taxaIds) {
          const col = p.canvasComponent.data.columns.find((c) => c.id === tid);
          if (!col) continue;
          const { points, curvePoints, brokenRows, ambiguousRows } = await p.rpcClient.digitizeColumnWithStats(col.id);
          col.controlPoints = points;
          if (curvePoints && curvePoints.length > 0) {
            col.curvePoints = curvePoints;
          }
          totalComp = addCompensation(totalComp, { brokenRows, ambiguousRows });
          successCount++;
        }
        p.canvasComponent.history.push(
          `Batch re-digitize ${successCount} columns`,
          p.canvasComponent.data.columns,
          p.canvasComponent.data.activeTaxaId
        );
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
        p.getInspector()?.updateData(p.canvasComponent.data);
        p.setHudNotice(
          `已完成 ${successCount} 列批量数字化取数。` + compensationNote(totalComp),
          compensationNote(totalComp) ? 6000 : 3500
        );
      } catch (err) {
        reportBackendFailure('批量取数', err);
      }
    },
    onBatchRedigitizeColumns: async (taxaIds: string[]) => {
      if (!taxaIds || taxaIds.length === 0) return;
      const allCols = p.canvasComponent.data.columns;
      if (taxaIds.length === allCols.length && taxaIds.length > 2) {
        try {
          const res = await p.rpcClient.redigitizeAllColumns(false);
          if (res && res.success) {
            const freshData = await p.rpcClient.getDiagramData();
            p.canvasComponent.loadNewDiagram(freshData);
            p.getSidebar()?.updateData(p.canvasComponent.data);
            p.getInspector()?.updateData(p.canvasComponent.data);
            p.canvasComponent.requestRender();
            p.setHudNotice(`已为全部 ${allCols.length} 列批量重新识别轮廓与拐点。`, 3500);
            return;
          }
        } catch {
          // fallback
        }
      }

      let totalComp = { brokenRows: 0, ambiguousRows: 0 };
      let successCount = 0;
      try {
        for (const tid of taxaIds) {
          const col = p.canvasComponent.data.columns.find((c) => c.id === tid);
          if (!col) continue;
          const { points, curvePoints, brokenRows, ambiguousRows } = await p.rpcClient.digitizeColumnWithStats(col.id);
          col.controlPoints = points;
          if (curvePoints && curvePoints.length > 0) {
            col.curvePoints = curvePoints;
          }
          totalComp = addCompensation(totalComp, { brokenRows, ambiguousRows });
          successCount++;
        }
        p.canvasComponent.history.push(
          `Batch re-digitize ${successCount} columns`,
          p.canvasComponent.data.columns,
          p.canvasComponent.data.activeTaxaId
        );
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
        p.getInspector()?.updateData(p.canvasComponent.data);
        p.setHudNotice(
          `已为所选 ${successCount} 列批量重新识别轮廓与拐点。` + compensationNote(totalComp),
          compensationNote(totalComp) ? 6000 : 3500
        );
      } catch (err) {
        reportBackendFailure('批量重新识别轮廓与拐点', err);
      }
    },
    onBatchExtractTurningPoints: async (taxaIds: string[]) => {
      if (!taxaIds || taxaIds.length === 0) return;
      let successCount = 0;
      try {
        for (const tid of taxaIds) {
          const col = p.canvasComponent.data.columns.find((c) => c.id === tid);
          if (!col) continue;
          const colIndex = col.col_index ?? p.canvasComponent.data.columns.indexOf(col);
          const res = await p.rpcClient.call<
            { col_index?: number },
            { success?: boolean; columns_updated?: number[]; message?: string }
          >('algorithm.extractTurningPoints', { col_index: colIndex });
          if (res?.success === true) successCount++;
        }
        const fresh = await p.rpcClient.getDiagramData();
        for (const tid of taxaIds) {
          const col = p.canvasComponent.data.columns.find((c) => c.id === tid);
          const freshCol = fresh.columns?.find((c: any) => c.id === tid);
          if (col && freshCol && freshCol.controlPoints) {
            col.controlPoints = freshCol.controlPoints;
          }
        }
        p.canvasComponent.history.push(
          `Batch extract turning points for ${successCount} columns`,
          p.canvasComponent.data.columns,
          p.canvasComponent.data.activeTaxaId
        );
        p.canvasComponent.requestRender();
        p.getSidebar()?.updateData(p.canvasComponent.data);
        p.getInspector()?.updateData(p.canvasComponent.data);
        p.setHudNotice(`已为所选 ${successCount} 列批量自动提取峰谷控制点（手工点保留）。`, 3500);
      } catch (err) {
        reportBackendFailure('批量提取峰谷', err);
      }
    },
  };
}
