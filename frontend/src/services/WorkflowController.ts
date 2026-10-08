import { RpcClient } from './RpcClient';
import { GeologyCanvas } from '../components/GeologyCanvas';
import { Toolbar } from '../components/Toolbar';
import { Sidebar } from '../components/Sidebar';
import { Inspector } from '../components/Inspector';
import { ExportModal } from '../components/ExportModal';
import { STAGE } from '../core/WorkflowStage';
import { WORKFLOW_STAGES, WorkflowStage } from '../types/workflow';
import { t } from '../i18n';

export interface WorkflowControllerCallbacks {
  setHudNotice: (text: string, duration?: number) => void;
  reportBackendFailure: (action: string, error: unknown) => void;
  updateFooter: () => void;
  getRoiCommitPromise: () => Promise<void>;
  onStageChange?: (stage: WorkflowStage) => void;
}

export class WorkflowController {
  private rpcClient: RpcClient;
  private canvasComponent: GeologyCanvas;
  private canvasWrapper: HTMLElement;
  private getToolbar: () => Toolbar | undefined;
  private getSidebar: () => Sidebar | undefined;
  private getInspector: () => Inspector | undefined;
  private getExportModal: () => ExportModal | undefined;
  private callbacks: WorkflowControllerCallbacks;

  private currentStage: WorkflowStage = STAGE.LOAD;
  private workflowActionBar: HTMLElement;
  private viewControlsBar: HTMLElement;

  constructor(
    rpcClient: RpcClient,
    canvasComponent: GeologyCanvas,
    canvasWrapper: HTMLElement,
    getToolbar: () => Toolbar | undefined,
    getSidebar: () => Sidebar | undefined,
    getInspector: () => Inspector | undefined,
    getExportModal: () => ExportModal | undefined,
    callbacks: WorkflowControllerCallbacks
  ) {
    this.rpcClient = rpcClient;
    this.canvasComponent = canvasComponent;
    this.canvasWrapper = canvasWrapper;
    this.getToolbar = getToolbar;
    this.getSidebar = getSidebar;
    this.getInspector = getInspector;
    this.getExportModal = getExportModal;
    this.callbacks = callbacks;

    this.workflowActionBar = document.createElement('div');
    this.workflowActionBar.className = 'workflow-action-bar';
    this.workflowActionBar.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 95;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 6px 14px;
      width: 100%;
      box-sizing: border-box;
      font-size: 11px;
      overflow: hidden;
      pointer-events: auto;
    `;
    this.canvasWrapper.appendChild(this.workflowActionBar);

    this.viewControlsBar = document.createElement('div');
    this.viewControlsBar.className = 'canvas-view-bar';
    this.viewControlsBar.id = 'canvas-view-bar';
    this.canvasWrapper.appendChild(this.viewControlsBar);

    this.canvasComponent.setWorkflowStage(this.currentStage);
  }

  public getViewControlsBar(): HTMLElement {
    return this.viewControlsBar;
  }

  public getCurrentStage(): WorkflowStage {
    return this.currentStage;
  }

  public setCurrentStage(stage: WorkflowStage): void {
    this.currentStage = stage;
    this.callbacks.onStageChange?.(this.currentStage);
  }

  public async advanceToWorkflowStage(targetStage: WorkflowStage): Promise<void> {
    if (!Number.isInteger(targetStage) || targetStage < STAGE.LOAD || targetStage > STAGE.QA) {
      throw new RangeError(`Invalid workflow stage: ${String(targetStage)}`);
    }
    if (targetStage >= STAGE.Y_CALIB) {
      await this.callbacks.getRoiCommitPromise();
    }
    if (targetStage === STAGE.LOAD) {
      this.currentStage = STAGE.LOAD;
      this.callbacks.onStageChange?.(this.currentStage);
      this.updateWorkflowBar();
      this.canvasComponent.setToolMode('pan');
      this.canvasComponent.requestRender();
      if (!this.canvasComponent.data.imageSrc) {
        (document.getElementById('file-input-image') as HTMLInputElement | null)?.click();
      }
    } else if (targetStage === STAGE.ROI) {
      this.currentStage = STAGE.ROI;
      this.callbacks.onStageChange?.(this.currentStage);
      this.updateWorkflowBar();
      this.canvasComponent.setToolMode('roi');
      this.canvasComponent.requestRender();
      this.callbacks.setHudNotice(
        '已进入 Step 2 数据有效区 (ROI) 划分！请拖拽手柄界定数据区或在侧栏新建多 ROI。',
        4500
      );
    } else if (targetStage === STAGE.Y_CALIB) {
      this.currentStage = STAGE.Y_CALIB;
      this.callbacks.onStageChange?.(this.currentStage);
      this.updateWorkflowBar();
      this.canvasComponent.setToolMode('ycalib');
      this.canvasComponent.requestRender();
      this.callbacks.setHudNotice(
        '已进入 Step 3 Y 轴标定！请在图上点选两点，或在右侧侧栏直接填入已知刻度与真实深度值。',
        5000
      );
    } else if (targetStage === STAGE.CLEANUP) {
      this.currentStage = STAGE.CLEANUP;
      this.callbacks.onStageChange?.(this.currentStage);
      this.updateWorkflowBar();
      this.canvasComponent.setToolMode('select');
      this.canvasComponent.requestRender();
      queueMicrotask(() => {
        (document.querySelector('#btn-detect-candidates') as HTMLButtonElement | null)?.click();
      });
      this.callbacks.setHudNotice(
        '已进入 Step 4 干扰清理！候选 geometry 正在生成，橙色待确认、红色已去除。',
        4500
      );
    } else if (targetStage === STAGE.SPLIT) {
      const wfNextBtn = document.querySelector('#btn-wf-next') as HTMLButtonElement | null;
      if (wfNextBtn) {
        wfNextBtn.disabled = true;
        wfNextBtn.textContent = '正在切分属种基线...';
      }
      this.callbacks.setHudNotice(
        '正在基于数据有效区与清理后墨迹切分属种垂直基线，请稍候...',
        5000
      );
      try {
        const rois = this.canvasComponent.data.rois || [];
        if (rois.length > 0) {
          for (const r of rois) {
            const xMin = r.xMin ?? r.xlim?.[0] ?? this.canvasComponent.data.roi.xMin;
            const xMax = r.xMax ?? r.xlim?.[1] ?? this.canvasComponent.data.roi.xMax;
            const yMin = r.yMin ?? r.ylim?.[0] ?? this.canvasComponent.data.roi.yMin;
            const yMax = r.yMax ?? r.ylim?.[1] ?? this.canvasComponent.data.roi.yMax;
            await this.rpcClient.detectColumnsInRoi({
              ...r,
              xMin,
              xMax,
              yMin,
              yMax,
            });
          }
        } else {
          await this.rpcClient.detectColumnsInRoi({ ...this.canvasComponent.data.roi });
        }
        const freshData = await this.rpcClient.getDiagramData();
        this.canvasComponent.loadNewDiagram(freshData);
      } catch (err) {
        if (wfNextBtn) {
          wfNextBtn.disabled = false;
        }
        this.callbacks.reportBackendFailure('分列识别', err);
        this.callbacks.setHudNotice('分列识别失败，已停留在 Step 4。请检查有效区后重试。', 6000);
        return;
      }
      this.currentStage = STAGE.SPLIT;
      this.callbacks.onStageChange?.(this.currentStage);
      this.canvasComponent.setToolMode('select');
      this.getSidebar()?.updateData(this.canvasComponent.data);
      this.getInspector()?.updateData(this.canvasComponent.data);
      this.updateWorkflowBar();
      this.callbacks.updateFooter();
      this.canvasComponent.requestRender();
      this.callbacks.setHudNotice(
        `成功切分 ${this.canvasComponent.data.columns.length} 个属种列！可点击 OCR 识别或在左栏输入各列名称。`,
        5000
      );
    } else if (targetStage === STAGE.CALIBRATE_COLUMNS) {
      this.currentStage = STAGE.CALIBRATE_COLUMNS;
      this.callbacks.onStageChange?.(this.currentStage);
      this.updateWorkflowBar();
      this.getInspector()?.updateData(this.canvasComponent.data);
      this.callbacks.setHudNotice('已进入 Step 6 列标定！在侧边栏点击自动提取刻度齿，或双击端点手动标定。', 4500);
    } else if (targetStage === STAGE.SPEARS_AND_SAMPLES) {
      this.currentStage = STAGE.SPEARS_AND_SAMPLES;
      this.callbacks.onStageChange?.(this.currentStage);
      this.updateWorkflowBar();
      this.getInspector()?.updateData(this.canvasComponent.data);
      this.callbacks.setHudNotice('已进入 Step 7 采样层位！点击侧栏【提取采样共识】或从外部粘贴真实层位。', 4500);
    } else if (targetStage === STAGE.QA) {
      this.currentStage = STAGE.QA;
      this.callbacks.onStageChange?.(this.currentStage);
      this.updateWorkflowBar();
      this.getInspector()?.updateData(this.canvasComponent.data);
      this.callbacks.setHudNotice('已进入 Step 8 地学校验！正在核验组分总和 ≤100% 门禁与空层位排查。', 4000);
    }
  }

  public updateWorkflowBar(): void {
    const meta = WORKFLOW_STAGES[this.currentStage];
    this.canvasComponent.setWorkflowStage(this.currentStage);
    this.getToolbar()?.setWorkflowStep(this.currentStage);
    this.getInspector()?.setWorkflowStage(this.currentStage);

    this.workflowActionBar.innerHTML = `
      <div class="workflow-action-bar__context">
        <span class="workflow-action-bar__step">${this.currentStage}</span>
        <strong>${meta.stepName}</strong>
        <span class="workflow-action-bar__guide">${meta.guideText}</span>
      </div>
      <div class="workflow-action-bar__actions">
        ${this.currentStage > 1 ? `<button id="btn-wf-prev" class="ui-btn ui-btn--quiet ui-btn--sm">${t('workflow.prev')}</button>` : ''}
        ${meta.primaryActionLabel ? `<button id="btn-wf-next" class="ui-btn ui-btn--primary ui-btn--sm">${meta.primaryActionLabel}</button>` : ''}
      </div>
    `;

    this.workflowActionBar.querySelector('#btn-wf-prev')?.addEventListener('click', () => {
      if (this.currentStage > 1) {
        void this.advanceToWorkflowStage((this.currentStage - 1) as WorkflowStage);
      }
    });

    this.workflowActionBar.querySelector('#btn-wf-next')?.addEventListener('click', async () => {
      if (this.currentStage === STAGE.QA) {
        const modal = this.getExportModal();
        if (modal) {
          modal.updateData(this.canvasComponent.data);
          modal.open();
        }
      } else {
        await this.advanceToWorkflowStage((this.currentStage + 1) as WorkflowStage);
      }
    });
  }
}
