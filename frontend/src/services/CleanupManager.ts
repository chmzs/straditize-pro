import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { Toolbar } from '../components/Toolbar';
import { DataRoi, HistorySnapshot, LineCandidate, LineMaskStroke } from '../types/pollen';

export interface CleanupManagerCallbacks {
  setHudNotice: (text: string, duration?: number) => void;
  reportBackendFailure: (action: string, error: unknown) => void;
  updateFooter: () => void;
}

export class CleanupManager {
  private rpcClient: RpcClient;
  private canvasComponent: GeologyCanvas;
  private getSidebar: () => Sidebar | undefined;
  private getInspector: () => Inspector | undefined;
  private getToolbar: () => Toolbar | undefined;
  private callbacks: CleanupManagerCallbacks;

  private roiCommitPromise: Promise<void> = Promise.resolve();
  private cleanupRecomposePromise: Promise<void> = Promise.resolve();
  private cleanupRecomposeVersion: number = 0;

  constructor(
    rpcClient: RpcClient,
    canvasComponent: GeologyCanvas,
    getSidebar: () => Sidebar | undefined,
    getInspector: () => Inspector | undefined,
    getToolbar: () => Toolbar | undefined,
    callbacks: CleanupManagerCallbacks
  ) {
    this.rpcClient = rpcClient;
    this.canvasComponent = canvasComponent;
    this.getSidebar = getSidebar;
    this.getInspector = getInspector;
    this.getToolbar = getToolbar;
    this.callbacks = callbacks;
  }

  public getRoiCommitPromise(): Promise<void> {
    return this.roiCommitPromise;
  }

  public activeCleanupRoiId(): string {
    return (
      this.canvasComponent.data.active_roi_id ||
      this.canvasComponent.data.rois?.[0]?.id ||
      this.canvasComponent.data.roi?.id ||
      'pollen'
    );
  }

  public applyCleanupState(res: {
    candidates?: LineCandidate[];
    selected_ids?: string[];
    stats?: Record<string, number>;
    overlay_png?: string;
  }): void {
    const data = this.canvasComponent.data;
    if (Array.isArray(res.candidates)) {
      data.line_candidates = res.candidates;
    }
    if (Array.isArray(res.selected_ids)) {
      data.selected_candidate_ids = res.selected_ids;
    }
    if (res.stats) {
      data.cleanup_stats = res.stats;
    }
    if (res.overlay_png) {
      this.canvasComponent.setLineOverlay(res.overlay_png);
      this.canvasComponent.viewport.showBinaryOverlay = true;
      this.getToolbar()?.updateFilterState(this.canvasComponent.viewport.imageMode, true);
    } else {
      this.canvasComponent.setLineOverlay(null);
    }
    this.getInspector()?.updateData(data);
    this.getSidebar()?.updateData(data);
    this.canvasComponent.requestRender();
  }

  public recomposeCleanupState(label = '重算清理掩膜'): Promise<void> {
    const requestVersion = ++this.cleanupRecomposeVersion;
    const task = this.cleanupRecomposePromise.then(async () => {
      try {
        const roiId = this.activeCleanupRoiId();
        const res = await this.rpcClient.refreshCleanup(roiId);
        if (requestVersion !== this.cleanupRecomposeVersion) return;
        this.applyCleanupState(res);
      } catch (err) {
        this.callbacks.reportBackendFailure(label, err);
      }
    });
    this.cleanupRecomposePromise = task.catch(() => undefined);
    return task;
  }

  public clearLineFixStrokes(): Promise<void> {
    const requestVersion = ++this.cleanupRecomposeVersion;
    const task = this.cleanupRecomposePromise.then(async () => {
      try {
        const res = await this.rpcClient.setLineStrokes([], this.activeCleanupRoiId());
        if (requestVersion !== this.cleanupRecomposeVersion) return;
        this.canvasComponent.data.line_strokes = [];
        this.applyCleanupState(res);
        this.canvasComponent.requestRender();
        this.callbacks.setHudNotice('已清空全部人工修正笔迹，掩膜回到算法结果。');
      } catch (err) {
        this.callbacks.reportBackendFailure('清空人工修正笔迹', err);
      }
    });
    this.cleanupRecomposePromise = task.catch(() => undefined);
    return task;
  }

  public async runCleanupAction(
    label: string,
    action: () => Promise<{
      candidates?: LineCandidate[];
      selected_ids?: string[];
      stats?: Record<string, number>;
      overlay_png?: string;
    }>
  ): Promise<void> {
    try {
      await this.canvasComponent.flushPendingGeometryEdits();
      const res = await action();
      this.applyCleanupState(res);
    } catch (err) {
      this.callbacks.reportBackendFailure(label, err);
    }
  }

  public enqueueRoiCommit(roi: DataRoi): Promise<void> {
    const task = this.roiCommitPromise.then(() => this.commitRoi(roi));
    this.roiCommitPromise = task.catch(() => undefined);
    return task;
  }

  public async commitRoi(roi: DataRoi): Promise<void> {
    try {
      await this.rpcClient.updateRoi(roi);
    } catch (err) {
      this.callbacks.reportBackendFailure('同步取数区到后端', err);
      return;
    }
    this.syncActiveRoiBounds(roi);
    this.getSidebar()?.updateData(this.canvasComponent.data);
    this.getInspector()?.updateData(this.canvasComponent.data);
    await this.recomposeCleanupState('ROI 变更后重算清理掩膜');
  }

  public syncActiveRoiBounds(roi: DataRoi): void {
    const list = this.canvasComponent.data.rois ?? [];
    if (list.length === 0) return;
    const activeId = this.canvasComponent.data.active_roi_id || list[0]?.id;
    const idx = list.findIndex((r) => r.id === activeId);
    if (idx < 0) return;
    const x0 = Math.round(roi.xMin);
    const x1 = Math.round(roi.xMax);
    const y0 = Math.round(roi.yMin);
    const y1 = Math.round(roi.yMax);
    list[idx] = {
      ...list[idx],
      xMin: x0,
      xMax: x1,
      yMin: y0,
      yMax: y1,
      xlim: [x0, x1],
      ylim: [y0, y1],
    };
  }

  public applyHistorySnapshot(snapshot: HistorySnapshot): void {
    this.canvasComponent.data.columns = snapshot.columns;
    this.canvasComponent.data.activeTaxaId = snapshot.activeTaxaId;
    if (snapshot.calibration) {
      this.canvasComponent.data.calibration = { ...snapshot.calibration };
    }
    if (snapshot.roi) {
      this.canvasComponent.data.roi = { ...snapshot.roi };
    }
    this.canvasComponent.clearYCalibMarks();
    this.canvasComponent.requestRender();
    this.getSidebar()?.updateData(this.canvasComponent.data);
    this.getInspector()?.updateData(this.canvasComponent.data);
    this.getToolbar()?.updateHistoryState();
    this.callbacks.updateFooter();
    if (snapshot.roi) {
      void this.commitRoi(this.canvasComponent.data.roi);
    }
  }

  public async appendLineFixStroke(stroke: LineMaskStroke): Promise<void> {
    this.canvasComponent.data.line_strokes.push(stroke);
    const roiId = this.activeCleanupRoiId();
    try {
      const res = await this.rpcClient.setLineStrokes(this.canvasComponent.data.line_strokes, roiId);
      this.applyCleanupState(res);
      const total = this.canvasComponent.data.line_strokes.length;
      this.callbacks.setHudNotice(
        stroke.mode === 'erase'
          ? `🧽 已擦除该处误标（人工修正共 ${total} 条）。`
          : `🖌 已补回该处漏标（人工修正共 ${total} 条）。`,
        3500
      );
    } catch (err) {
      this.canvasComponent.data.line_strokes.pop();
      this.canvasComponent.requestRender();
      this.callbacks.reportBackendFailure('提交人工修正笔迹', err);
    }
  }

  public handleGeometryCommit = async (
    id: string | null,
    axis: 'h' | 'v',
    rect: { x0: number; y0: number; x1: number; y1: number }
  ): Promise<void> => {
    await this.runCleanupAction(id ? '移动几何' : '新建几何', async () => {
      const res = await this.rpcClient.upsertLineGeometry({
        roi_id: this.activeCleanupRoiId(),
        axis,
        candidate_id: id,
        geometry: rect,
        status: 'candidate',
      });
      if (!id && res.candidates?.length) {
        const created = res.candidates[res.candidates.length - 1];
        this.canvasComponent.setSelectedGeometryId(created.id);
      }
      return res;
    });
  };

  public handleGeometryDelete = async (id: string): Promise<void> => {
    await this.runCleanupAction('删除几何', () => this.rpcClient.deleteLineGeometry(id));
    this.callbacks.setHudNotice('🗑️ 已删除该几何。');
  };

  public handleGeometrySelected = (id: string | null): void => {
    this.getInspector()?.updateData(this.canvasComponent.data);
    if (!id) return;
    const row = document.querySelector(`.cleanup-row[data-cand-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  };
}
