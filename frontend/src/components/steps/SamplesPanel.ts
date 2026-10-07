import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notifyError } from '../../ui/feedback';

export const step = 7;
export const title = '7. 拐点与采样层位';

let cachedSamplesData: DiagramData | null = null;

export function render(data: DiagramData): string {
  cachedSamplesData = data;
  const samples = data.samples || [];
  const autoCount = samples.filter((s) => s.source === 'auto').length;
  const pasteCount = samples.filter((s) => s.source === 'paste').length;
  const manualCount = samples.filter((s) => s.source === 'manual').length;

  return `
    <div class="step-panel" data-step="7">
      <div class="step-title">${t('step7.title')}</div>
      <div class="step-desc">
        ${t('step7.desc')}
      </div>

      <!-- 自动采样共识发现 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">${t('step7.consensusTitle')}</div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
          ${t('step7.consensusDesc')}
        </p>
        <button id="btn-extract-consensus" class="ui-btn ui-btn--secondary" style="width: 100%; font-size: 11px; padding: 5px;">
          ${t('step7.consensusBtn')}
        </button>
      </div>

      <!-- 层位统计与快捷操作 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">${t('step7.listTitle', { count: samples.length })}</span>
          <button id="btn-clear-horizons" class="icon-btn btn-subaction" style="font-size: 10px; padding: 1px 4px;" title="${t('step7.clearTitle')}">${t('step7.clear')}</button>
        </div>
        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 6px;">
          Auto: ${autoCount} | Paste: ${pasteCount} | Manual: ${manualCount}
        </div>
        <div id="horizons-list-container" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); font-size: 10px; font-family: monospace;">
          ${
            samples.length === 0
              ? '<div style="color: var(--text-muted); text-align: center; padding: 12px; font-family: sans-serif;">-- 暂无层位 --</div>'
              : samples
                  .map(
                    (s, idx) => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; border-bottom: 1px solid rgba(0,0,0,0.04);">
                  <span>#${idx + 1} Y=${s.row_px}px</span>
                  <span>${s.depth !== null ? `<strong>${s.depth}</strong> ${data.calibration?.unit || 'cm'}` : '[--]'}</span>
                  <button class="icon-btn btn-delete-sample" data-sample-idx="${idx}" title="删除该层位" style="color: #ef4444; font-size: 12px; padding: 0 4px; background: none; border: none; cursor: pointer;">&times;</button>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-samples-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step7.next')}
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

  // 单行层位删除 (同步后端 samples.set)
  root.querySelectorAll('.btn-delete-sample').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-sample-idx') || '-1', 10);
      if (idx >= 0 && cachedSamplesData && cachedSamplesData.samples && cachedSamplesData.samples[idx]) {
        cachedSamplesData.samples.splice(idx, 1);
        if (ctx.rpcClient) {
          try {
            await ctx.rpcClient.call('samples.set', { samples: cachedSamplesData.samples });
          } catch (err) {
            notifyError(err instanceof Error ? err.message : String(err));
            return;
          }
        }
        ctx.onDataChange?.();
      }
    });
  });

  root.querySelector('#btn-apply-samples-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(8);
  });
}
