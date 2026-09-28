import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';

export const step = 1;
export const title = '1. 载入图谱';

export function render(data: DiagramData): string {
  const hasImage = Boolean(data.imageSrc);
  return `
    <div class="step-panel" data-step="1">
      <div class="step-title">1. 载入地质图谱</div>
      ${hasImage ? `
        <div class="info-callout success">
          <span>🖼️ 当前图谱尺寸：<strong>${data.imageWidth} × ${data.imageHeight} px</strong></span>
        </div>
        <button id="btn-goto-step2" class="btn btn-primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
          👉 进入多 ROI 划分 (步骤 2)
        </button>
      ` : `
        <div class="info-callout">
          <span>💡 尚未载入剖面图。请点击顶栏【📂 范例】快速体验，或将图片文件拖拽至中央画布。</span>
        </div>
      `}
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-goto-step2')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(2);
  });
}
