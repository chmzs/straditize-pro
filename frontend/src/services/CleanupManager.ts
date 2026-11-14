import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { Toolbar } from '../components/Toolbar';
import {
  CleanupAxisWarning,
  DataRoi,
  HistorySnapshot,
  LineCandidate,
  LineMaskStroke,
} from '../types/pollen';
import { undoStack, refreshUndoButtons } from '../core/undoRuntime';
import { axisWarningHeadline } from '../core/axisWarnings';
import { notify } from '../ui/feedback';

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
  /** 上一次已提示过的轴线告警集合签名（去重，见 `applyAxisWarnings`）。 */
  private axisWarningSignature: string = '';

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
    warnings?: CleanupAxisWarning[];
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
    this.applyAxisWarnings(Array.isArray(res.warnings) ? res.warnings : []);
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

  /**
   * 把后端「这一步编辑抹掉了某列轴线」的告警送到界面。
   *
   * 两件事必须同时成立，否则这次修复等于没做：
   *
   * 1. **写进镜像状态**（`data.cleanup_warnings`）→ 步骤 4 面板常驻显示；
   *    toast 会 6 秒后消失，用户回头再看就只剩"这一列为什么全 0"。
   * 2. **弹一条 warning toast** → 用户刚点完按钮、目光还在按钮上时就能看到。
   *
   * 去重只按「本次告警集合是否变化」：`_recompose` 在每次拖动/连点上都会跑，
   * 若按条数弹 toast，拖一次几何就会刷出十几条相同的提示，最后被用户当噪音忽略
   * ——那正是这类告警失效的常见死法。
   */
  private applyAxisWarnings(warnings: CleanupAxisWarning[]): void {
    const data = this.canvasComponent.data;
    data.cleanup_warnings = warnings;

    const signature = warnings
      .map((w) => `${w.kind}|${w.column_id ?? w.column_name}|${w.covered_fraction}`)
      .sort()
      .join(';');
    if (signature === this.axisWarningSignature) return;
    this.axisWarningSignature = signature;

    if (warnings.length === 0) return;
    // 一次编辑常常同时盖住相邻几列的轴线（面板的「添加排除区」就是一条 250px 宽、
    // 纵向贯穿的矩形）。逐条弹 toast 会一次刷出好几条同义提示 —— 那正是"告警被
    // 当噪音忽略"的起点。所以聚合成一条，逐列的细节留在面板里。
    if (warnings.length === 1) {
      notify(`警告：${axisWarningHeadline(warnings[0])}（处理建议见步骤 4 面板）`, 'warning');
      return;
    }
    const names = warnings.map((w) => `「${w.column_name}」`).join('、');
    notify(
      `警告：${warnings.length} 列的轴线被本步编辑盖住（${names}），` +
        '取数会整列偏移且不会报错；逐列处理建议见步骤 4 面板',
      'warning'
    );
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
    // 标定端点 / `isCalibrated` 是**后端权威量**，撤销不得改写（T-04）。
    // 旧实现整体回写 `snapshot.calibration`，而快照可能是在标定**之前**压入的，
    // 于是一次撤销就把镜像的 `isCalibrated` 打回 false，而 `CoordinateSystem
    // .calibrationBounds` 见 false 即返回 null —— 面板/Ratio/深度换算一起否定
    // 后端已确认的标定（后端从未收到任何清除请求，前后端从此分叉）。
    // 这里只恢复前端自有的显示偏好（层位间隔 / 深度网格），它们是这份镜像里
    // 唯一不由后端写入的字段。
    if (snapshot.calibration) {
      this.canvasComponent.data.calibration = {
        ...this.canvasComponent.data.calibration,
        depthInterval: snapshot.calibration.depthInterval,
        depthGridEnabled: snapshot.calibration.depthGridEnabled,
      };
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
      const strokesAfter = [...this.canvasComponent.data.line_strokes];
      const strokesBefore = strokesAfter.slice(0, -1);
      // U5：单笔人工修正可撤销。`setLineStrokes` 是**全量覆盖**语义，所以逆操作 =
      // 把"这一笔之前的那份列表"整体写回去（不需要后端提供"删最后一笔"的接口）。
      undoStack.push({
        label: `人工修正笔迹（${stroke.mode === 'erase' ? '擦除' : '补线'}）`,
        inverse: async () => {
          const res = await this.rpcClient.setLineStrokes(strokesBefore, roiId);
          this.canvasComponent.data.line_strokes = [...strokesBefore];
          this.applyCleanupState(res);
          this.canvasComponent.requestRender();
        },
        forward: async () => {
          const res = await this.rpcClient.setLineStrokes(strokesAfter, roiId);
          this.canvasComponent.data.line_strokes = [...strokesAfter];
          this.applyCleanupState(res);
          this.canvasComponent.requestRender();
        },
        verify: async (dir) => {
          const data = (await this.rpcClient.getDiagramData()) as unknown as {
            line_strokes?: unknown[];
          };
          const expected = dir === 'inverse' ? strokesBefore.length : strokesAfter.length;
          return (data.line_strokes?.length ?? 0) === expected;
        },
      });
      refreshUndoButtons({ canUndo: true, canRedo: false });
      this.callbacks.setHudNotice(
        stroke.mode === 'erase'
          ? `已擦除该处误标（人工修正共 ${total} 条）。`
          : `已补回该处漏标（人工修正共 ${total} 条）。`,
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
    this.callbacks.setHudNotice('已删除该几何。');
  };

  public handleGeometrySelected = (id: string | null): void => {
    this.getInspector()?.updateData(this.canvasComponent.data);
    if (!id) return;
    const row = document.querySelector(`.cleanup-row[data-cand-id="${CSS.escape(id)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  };
}
