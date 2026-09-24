import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';

export const step = 6;
export const title = '6. 标定列与 X 刻度';

export function render(data: DiagramData): string {
  const activeCol = data.columns.find((c) => c.id === data.activeTaxaId) || data.columns[0];
  const colName = activeCol ? activeCol.name : '未选列';
  const hasTicks = activeCol && activeCol.x_ticks && activeCol.x_ticks.length === 2;

  return `
    <div class="step-panel" data-step="6">
      <div class="step-title">6. 标定列与 X 轴刻度</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5;">
        当前编辑列：<strong style="color: var(--accent-blue);">${colName}</strong>
      </div>

      <!-- 自动刻度线几何检测 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">📐 几何刻度齿自动提取 (T00-b)</div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
          基于 1-D 竖向绝对游程自动搜索各列刻度标尺齿，无需逐列手动拉点。
        </p>
        <button id="btn-detect-xticks" class="tool-btn" style="width: 100%; font-size: 11px; padding: 4px;">
          ⚡ 自动提取本区所有列刻度
        </button>
      </div>

      <!-- 当前列标度参数 (事实源: x_ticks) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">标度事实源 (x_ticks)</div>
        <div style="font-size: 10.5px; line-height: 1.6;">
          <div>状态: <strong style="color: ${hasTicks ? 'var(--accent-green, #10b981)' : 'var(--accent-orange, #f59e0b)'};">${hasTicks ? '已标定 [✓]' : '未标定 [--]'}</strong></div>
          ${
            hasTicks && activeCol?.x_ticks
              ? `
            <div>① 端点 1: <code>X=${activeCol.x_ticks[0].px}px</code> → <strong>${activeCol.x_ticks[0].value} ${activeCol.unit || '%'}</strong></div>
            <div>② 端点 2: <code>X=${activeCol.x_ticks[1].px}px</code> → <strong>${activeCol.x_ticks[1].value} ${activeCol.unit || '%'}</strong></div>
          `
              : '<div style="color: var(--text-muted);">尚未标定，双击画布端点或点击上方自动提取</div>'
          }
        </div>
      </div>

      <!-- 提示信息 -->
      <div style="font-size: 10px; color: var(--text-muted); line-height: 1.4; margin-bottom: 12px; padding: 6px; background: rgba(0,0,0,0.03); border-radius: 4px;">
        ℹ️ 提示：各列可以合法使用不同刻度区间（例如 10% vs 20%），比例离群不代表切错。
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-xticks-next" class="primary-btn" style="width: 100%; padding: 6px 12px; font-size: 12px;">
        👉 确认列标度，提取拐点与采样 (步骤 7)
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-detect-xticks')?.addEventListener('click', () => {
    ctx.onDetectXTicks?.();
  });

  root.querySelector('#btn-apply-xticks-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(7);
  });
}
