import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { Toolbar } from '../components/Toolbar';
import { PropertyPanel } from '../components/PropertyPanel';
import { WorkflowController } from './WorkflowController';
import { WorkflowStage } from '../types/workflow';
import { visibleLayers } from '../core/WorkflowStage';

export interface WebMcpBridgeParams {
  rpcClient: RpcClient;
  canvasComponent: GeologyCanvas;
  getSidebar: () => Sidebar | undefined;
  getInspector: () => Inspector | undefined;
  getToolbar: () => Toolbar | undefined;
  workflowController: WorkflowController;
  propertyPanel: PropertyPanel;
  updateFooter: () => void;
  scheduleAutosave: () => void;
  setHudNotice: (text: string, duration?: number) => void;
}

export function registerWebMcpAndInspectionHandles(p: WebMcpBridgeParams): void {
  let inPageCallInFlight = false;

  const syncWebMcpState = async (actionName: string) => {
    const freshData = await p.rpcClient.getDiagramData();
    p.canvasComponent.loadNewDiagram(freshData);
    p.canvasComponent.history.push(
      `WebMCP: ${actionName}`,
      p.canvasComponent.data.columns,
      p.canvasComponent.data.activeTaxaId,
      p.canvasComponent.data.calibration,
      p.canvasComponent.data.roi
    );
    p.getSidebar()?.updateData(p.canvasComponent.data);
    p.getInspector()?.updateData(p.canvasComponent.data);
    p.getToolbar()?.updateHistoryState();
    p.updateFooter();
    p.scheduleAutosave();
    p.setHudNotice(`WebMCP 已执行: ${actionName}（支持 Ctrl+Z 撤销）`, 3500);
  };

  const webMcpApi = {
    version: '2024-11-05',
    endpoint:
      typeof window !== 'undefined' && window.location.origin
        ? `${window.location.origin}/mcp`
        : 'http://127.0.0.1:8765/mcp',
    listTools: async () => {
      const res = await p.rpcClient.call<any, any>('tools/list', {});
      return res?.tools || [];
    },
    callTool: async (name: string, args: Record<string, any> = {}) => {
      inPageCallInFlight = true;
      try {
        const res = name.startsWith('straditize_')
          ? await p.rpcClient.call<any, any>('tools/call', { name, arguments: args })
          : await p.rpcClient.call<any, any>(name, args);
        await syncWebMcpState(name);
        return res;
      } finally {
        inPageCallInFlight = false;
      }
    },
    setWorkflowStep: (step: WorkflowStage) => {
      p.workflowController.setCurrentStage(step);
      p.workflowController.updateWorkflowBar();
      p.canvasComponent.requestRender();
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

  if (typeof EventSource !== 'undefined') {
    try {
      const es = new EventSource(p.rpcClient.signUrl('/events'));
      es.addEventListener('rpc_call', (ev: MessageEvent) => {
        if (inPageCallInFlight) return;
        try {
          const payload = JSON.parse(ev.data || '{}');
          if (
            (payload.method === 'tools/call' || payload.method === 'webmcp.callTool') &&
            payload.tool
          ) {
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

  (window as unknown as Record<string, unknown>).__straditize = {
    getState: () => {
      p.canvasComponent.render();
      const data = p.canvasComponent.data;
      const cal = data.calibration;
      return {
        stage: p.workflowController.getCurrentStage(),
        image: { src: data.imageSrc || null, width: data.imageWidth, height: data.imageHeight },
        rois: (data.rois ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          xlim: r.xlim,
          ylim: r.ylim,
          name_source: r.name_source,
        })),
        activeRoiId: data.active_roi_id ?? null,
        legacyRoi: {
          xMin: data.roi?.xMin ?? null,
          xMax: data.roi?.xMax ?? null,
          yMin: data.roi?.yMin ?? null,
          yMax: data.roi?.yMax ?? null,
        },
        columns: data.columns.map((c) => ({
          id: c.id,
          name: c.name,
          startX: c.startX,
          endX: c.endX,
          roi_id: c.roi_id,
          col_index: c.col_index ?? null,
          x_ticks: c.x_ticks ?? null,
        })),
        calibration: {
          isCalibrated: !!cal?.isCalibrated,
          top_px: cal?.top_px ?? null,
          bottom_px: cal?.bottom_px ?? null,
          unit: cal?.unit ?? null,
        },
        yCalibMarks: p.canvasComponent.getYCalibMarks().map((m) => ({ x: m.x, y: m.y })),
        eligibleLayers: visibleLayers(p.workflowController.getCurrentStage(), {
          hasImage: !!data.imageSrc,
          columnCount: data.columns.length,
        }),
        renderedLayers: p.canvasComponent.getLastRenderedLayers(),
      };
    },
    gotoStage: (stage: number) =>
      p.workflowController.advanceToWorkflowStage(stage as WorkflowStage),
    rpc: (method: string, params: Record<string, unknown> = {}) =>
      p.rpcClient.call(method, params),
    selectColumn: (colId: string) => {
      p.canvasComponent.data.selectedEntity = { type: 'column', id: colId };
      p.canvasComponent.data.activeTaxaId = colId;
      p.getInspector()?.updateData(p.canvasComponent.data);
      p.getSidebar()?.updateData(p.canvasComponent.data);
    },
    openCalibrationModal: () => p.propertyPanel.openCalibrationModal(),
    openRpcConfigModal: (onRefresh?: () => void) =>
      p.propertyPanel.openRpcConfigModal(onRefresh || (() => {})),
  };
}
