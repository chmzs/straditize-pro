/**
 * 自动存档草稿的恢复入口（B-05）。
 *
 * ## 为什么恢复必须"落到后端"
 *
 * 旧实现只 `loadNewDiagram(draft.data)` + `history.reset(...)`，**零个 RPC**：
 * 界面显示 28 列而后端 0 列，用户对着一个后端并不存在的状态继续操作，之后任何
 * 列级 RPC 都会打空（违反 ARCHITECTURE §2「禁止静默兜底」）。现在把草稿翻译成
 * 工程包载荷下发 `project.load`，再用后端权威数据重建镜像；失败就冒泡
 * （后端失败 → 红框 + toast），绝不"前端填上就算恢复"。
 *
 * 抽成独立模块是为了让"草稿恢复要碰哪些组件"显式化：它同时改画布、撤销栈、
 * 侧栏、检查器、工具条状态与清理掩膜——这五件事缺一个就会出现"界面与后端不一致"。
 */
import type { ProjectManager } from '../core/ProjectManager';
import type { HistoryManager } from '../core/HistoryManager';
import type { GeologyCanvas } from '../components/GeologyCanvas';
import type { CleanupManager } from '../services/CleanupManager';
import { t } from '../i18n';

export interface DraftRecoveryDeps {
  projectManager: ProjectManager;
  history: HistoryManager;
  getCanvas: () => GeologyCanvas;
  cleanupManager: CleanupManager;
  getSidebar: () => { updateData: (data: unknown) => void } | null;
  getInspector: () => { updateData: (data: unknown) => void } | null;
  getToolbar: () => { updateHistoryState: () => void } | null;
  updateFooter: () => void;
  setHudNotice: (text: string, duration?: number) => void;
  reportBackendFailure: (what: string, err: unknown) => void;
  /** 自动存档在 localStorage 里的键（与写入端同一个常量）。 */
  autosaveKey: string;
}

/** 若存在 7 天内的草稿，挂出恢复横幅；用户点【恢复】才真正下发后端。 */
export function setupDraftRecovery(deps: DraftRecoveryDeps): void {
  const {
    projectManager,
    history,
    getCanvas,
    cleanupManager,
    getSidebar,
    getInspector,
    getToolbar,
    updateFooter,
    setHudNotice,
    reportBackendFailure,
    autosaveKey,
  } = deps;

  try {
    const saved = localStorage.getItem(autosaveKey);
    if (!saved) return;
    const draft = JSON.parse(saved);
    const usable =
      draft &&
      draft.data &&
      Array.isArray(draft.data.columns) &&
      draft.data.columns.length > 0 &&
      Date.now() - draft.timestamp < 7 * 86400 * 1000;
    if (!usable) return;

    const draftTime = new Date(draft.timestamp).toLocaleTimeString();
    const banner = document.createElement('div');
    banner.className = 'draft-recovery-banner';
    banner.style.cssText = 'position: fixed; top: 48px; left: 50%; transform: translateX(-50%); z-index: 9999;';
    banner.innerHTML = `
      <div class="app-toast-badge" style="border: 1px solid var(--accent-blue);">
        <span>${t('draft.found', { time: draftTime, count: draft.data.columns.length })}</span>
        <div style="display: flex; gap: 6px;">
          <button id="btn-restore-draft" class="ui-btn ui-btn--primary" style="padding: 2px 8px; font-size: 10px;">${t('draft.restore')}</button>
          <button id="btn-discard-draft" class="ui-btn ui-btn--secondary" style="padding: 2px 8px; font-size: 10px;">${t('draft.ignore')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    banner.querySelector('#btn-restore-draft')?.addEventListener('click', () => {
      const btn = banner.querySelector('#btn-restore-draft') as HTMLButtonElement | null;
      if (btn) {
        btn.disabled = true;
        btn.textContent = '正在恢复到后端...';
      }
      void projectManager
        .restoreDraft(draft.data)
        .then(({ data, unrestored }) => {
          const canvasComponent = getCanvas();
          // 镜像与撤销基线都按**后端返回的权威数据**重建；草稿只是"请求"。
          canvasComponent.loadNewDiagram(data);
          history.reset(
            data.columns,
            data.activeTaxaId,
            data.calibration,
            data.roi,
            data.rois,
            data.primary_roi_id,
            data.active_roi_id
          );
          // 草稿里存过清理叠层就先按后端重算一次掩膜（此时 ROI 确实存在，
          // 不会再出现 B-07 那种"归零后拿旧 roi_id 重算"的必然失败）。
          if ((data.line_candidates ?? []).length > 0) {
            void cleanupManager.recomposeCleanupState('恢复草稿后重算清理掩膜');
          }
          getSidebar()?.updateData(canvasComponent.data);
          getInspector()?.updateData(canvasComponent.data);
          getToolbar()?.updateHistoryState();
          updateFooter();
          banner.remove();
          if (unrestored.length > 0) {
            // 恢复成功但有部分状态工程包承载不了 —— 必须明说，
            // 否则用户会以为清理笔迹/排除区也回来了。
            setHudNotice(
              `${t('draft.restored')}；未随草稿恢复：${unrestored.join('；')}`,
              9000
            );
          } else {
            setHudNotice(t('draft.restored'), 3500);
          }
        })
        .catch((err: unknown) => {
          if (btn) {
            btn.disabled = false;
            btn.textContent = t('draft.restore');
          }
          reportBackendFailure('恢复自动存档草稿', err);
        });
    });
    banner.querySelector('#btn-discard-draft')?.addEventListener('click', () => {
      localStorage.removeItem(autosaveKey);
      banner.remove();
    });
  } catch {
    // 草稿损坏/无权限：静默跳过恢复入口，不影响正常启动。
  }
}
