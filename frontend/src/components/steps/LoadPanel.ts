import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';

export const step = 1;
export const title = '1. 载入图谱';

export function render(data: DiagramData): string {
  const hasImage = Boolean(data.imageSrc);
  return `
    <div class="step-panel" data-step="1">
      <div class="step-title">1. 载入地质图谱</div>
      <p style="font-size: 11px; color: var(--text-secondary); line-height: 1.5; margin-bottom: 12px;">
        ${hasImage ? `当前图谱尺寸：${data.imageWidth} × ${data.imageHeight} px` : '尚未载入剖面图，请点击上方按钮或拖拽图片文件到画布。'}
      </p>
      ${hasImage ? `
        <button id="btn-goto-step2" class="primary-btn" style="width: 100%; padding: 6px 12px; font-size: 12px;">
          👉 进入多 ROI 划分 (步骤 2)
        </button>
      ` : ''}
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-goto-step2')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(2);
  });
}
