import { t } from '../../i18n';
import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';

export const step = 1;
// 标题**只**来自 i18n 词条 `step1.title`（官方名以 `workflow.name1` 为准）。
// 这里不再导出 `title`：它没有任何消费方，留着就是第二个事实源，
// 早晚和面板里的那一份分叉（曾经同屏出现「1. 载入图谱」与「1. 载入地质图谱」）。

export function render(data: DiagramData): string {
  const hasImage = Boolean(data.imageSrc);
  return `
    <div class="step-panel" data-step="1">
      <div class="step-title">${t('step1.title')}</div>
      ${hasImage ? `
        <div class="info-callout success">
          <span>当前图谱尺寸：<strong>${data.imageWidth} × ${data.imageHeight} px</strong></span>
        </div>
        <button id="btn-goto-step2" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
          进入多 ROI 划分 (步骤 2)
        </button>
      ` : `
        <div class="info-callout">
          <span>尚未载入剖面图。点顶栏【范例】载入内置示例，或把图片文件拖到中央画布。</span>
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
