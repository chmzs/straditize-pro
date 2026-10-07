import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { Toolbar } from '../components/Toolbar';
import { reportBackendFailure } from '../main';

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
      if (col) {
        col.plotType = plotType;
        p.canvasComponent.history.push(
          `Change ${col.name} Plot Type to ${plotType}`,
          p.canvasComponent.data.columns,
          p.canvasComponent.data.activeTaxaId
        );
        p.canvasComponent.requestRender();
        p.getInspector()?.updateData(p.canvasComponent.data);
        p.setHudNotice(`已将属种 [${col.name}] 图形形态切换为: ${plotType.toUpperCase()}`);
      }
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
          p.setHudNotice(`🏷️ 属种已更名为: ${newName}`);
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
      p.setHudNotice(`➕ 已插入空白间隔列: ${newCol.name}`);
    },
  };
}
