import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';

export const step = 7;
export const title = '7. 拐点与采样层位';

export function render(data: DiagramData): string {
  const samples = data.samples || [];
  const autoCount = samples.filter((s) => s.source === 'auto').length;
  const pasteCount = samples.filter((s) => s.source === 'paste').length;
  const manualCount = samples.filter((s) => s.source === 'manual').length;

  return `
    <div class="step-panel" data-step="7">
      <div class="step-title">7. 拐点与采样层位 (Horizons)</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5;">
        管理剖面历史取样层位线（导出数据表的行基准）。
      </div>

      <!-- 自动采样共识发现 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">🧬 跨属种拐点共识自动发现</div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
          反推真实历史取样层位：聚类多属种轮廓拐点，避免主观等距伪插值重采样。
        </p>
        <button id="btn-extract-consensus" class="tool-btn" style="width: 100%; font-size: 11px; padding: 4px;">
          ⚡ 提取采样共识层位
        </button>
      </div>

      <!-- 层位统计与快捷操作 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">层位列表 (${samples.length} 层)</span>
          <button id="btn-clear-horizons" class="icon-btn" style="font-size: 10px; padding: 2px 4px;" title="清空全部层位">清空</button>
        </div>
        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 6px;">
          自动: ${autoCount} | 粘贴: ${pasteCount} | 手工: ${manualCount}
        </div>
        <div id="horizons-list-container" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); font-size: 10px; font-family: monospace;">
          ${
            samples.length === 0
              ? '<div style="color: var(--text-muted); text-align: center; padding: 12px; font-family: sans-serif;">暂无层位线，请点击上方提取或从外部粘贴</div>'
              : samples
                  .map(
                    (s, idx) => `
                <div style="display: flex; justify-content: space-between; padding: 2px 4px; border-bottom: 1px solid rgba(0,0,0,0.04);">
                  <span>#${idx + 1} Y=${s.row_px}px</span>
                  <span>${s.depth !== null ? `${s.depth} ${data.calibration?.unit || 'cm'}` : '[未标定]'}</span>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-samples-next" class="primary-btn" style="width: 100%; padding: 6px 12px; font-size: 12px;">
        👉 确认采样层位，进入全剖面地学校验 (步骤 8)
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-extract-consensus')?.addEventListener('click', () => {
    ctx.onExtractConsensusHorizons?.();
  });

  root.querySelector('#btn-clear-horizons')?.addEventListener('click', () => {
    ctx.onClearHorizons?.();
  });

  root.querySelector('#btn-apply-samples-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(8);
  });
}
