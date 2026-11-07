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

  // 深度分辨率：1 像素对应多少深度。粘贴的深度最终只能落到**整数行**上，
  // 所以这个数就是「导入精度」的量化说明——必须显示出来，否则用户会以为深度是精确对齐的。
  const cal = data.calibration;
  const spanPx =
    cal?.top_px !== null && cal?.bottom_px !== null
      ? Math.abs(Number(cal.bottom_px) - Number(cal.top_px))
      : 0;
  const spanValue =
    cal?.top_cm !== null && cal?.bottom_cm !== null
      ? Math.abs(Number(cal.bottom_cm) - Number(cal.top_cm))
      : 0;
  const resolutionText =
    spanPx > 0 && spanValue > 0
      ? `${(spanValue / spanPx).toFixed(3)} ${cal?.unit || 'cm'}/px`
      : t('step7.resolutionUnknown');

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

      <!-- 导入自定义深度：步骤 7 的职责是把「在哪些深度出数」定下来 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="display: flex; align-items: center; gap: 6px;">
          <button id="btn-paste-depths" class="ui-btn ui-btn--secondary" style="flex: 1; font-size: 11px; padding: 5px;">
            ${t('step7.paste')}
          </button>
          <span style="font-size: 9.5px; color: var(--text-muted); line-height: 1.3;">
            ${t('step7.resolution')}: ${resolutionText}
          </span>
        </div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 6px 0 0 0; line-height: 1.4;">${t('step7.pasteDesc')}</p>
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
                  <button class="icon-btn btn-delete-sample" data-sample-idx="${idx}" title="删除该层位" style="color: var(--accent-red); font-size: 12px; padding: 0 4px; background: none; border: none; cursor: pointer;">&times;</button>
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

  // 导入自定义深度（步骤 7 的职责：决定「在哪些深度出数」）
  root.querySelector('#btn-paste-depths')?.addEventListener('click', () => {
    openPasteDepthsModal(ctx);
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

/**
 * 导入自定义深度 —— 走 samples.pasteDepths，这是**唯一**的落库通道。
 *
 * 后端要求 Y 轴已标定（否则返回 -32001 并指路步骤 3），且会把每个深度换算成**整数像素行**
 * （row = (depth - intercept) / slope 后四舍五入）。所以面板上同时显示「深度分辨率 ≈ X cm/px」：
 * 粘贴 12.5 而读数取自 12.48 那一行是正常的，但用户必须能看见这件事。
 */
function openPasteDepthsModal(ctx: StepContext): void {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-dialog" style="--modal-width: 460px;">
      <div class="ui-modal__header">
        <h3 class="ui-modal__title">${t('step7.pasteTitle')}</h3>
        <button class="ui-icon-btn" id="modal-close-paste" aria-label="关闭">&times;</button>
      </div>
      <div class="ui-modal__body" style="padding: 12px;">
        <textarea id="txt-paste-depths" placeholder="示例:\n12.5\n14.0\n18.2\n22.0\n35.5" style="width: 100%; height: 150px; font-family: var(--font-mono); font-size: 11px; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); box-sizing: border-box;"></textarea>
        <div id="paste-depths-feedback" style="font-size: 10.5px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;">
          请输入至少 2 个有效深度（每行一个，或逗号 / 分号分隔）
        </div>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button id="btn-cancel-paste" class="ui-btn ui-btn--quiet ui-btn--sm" style="flex: 1;">取消</button>
          <button id="btn-confirm-paste" class="ui-btn ui-btn--primary ui-btn--sm" style="flex: 1;" disabled>${t('step7.pasteConfirm')}</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const txt = modal.querySelector('#txt-paste-depths') as HTMLTextAreaElement;
  const fb = modal.querySelector('#paste-depths-feedback') as HTMLElement;
  const confirmBtn = modal.querySelector('#btn-confirm-paste') as HTMLButtonElement;

  let parsedDepths: number[] = [];

  const updateFeedback = () => {
    const nums = txt.value
      .split(/[\r\n,;]+/)
      .map((line) => parseFloat(line.trim()))
      .filter((n) => !isNaN(n));
    parsedDepths = Array.from(new Set(nums)).sort((a, b) => a - b);
    if (parsedDepths.length >= 2) {
      fb.style.color = 'var(--status-success)';
      const last = parsedDepths[parsedDepths.length - 1];
      fb.textContent = `已识别 ${parsedDepths.length} 个深度层位（${parsedDepths[0]} ~ ${last}）`;
      confirmBtn.disabled = false;
    } else {
      fb.style.color = 'var(--text-muted)';
      fb.textContent = '请输入至少 2 个有效深度（每行一个，或逗号 / 分号分隔）';
      confirmBtn.disabled = true;
    }
  };

  txt.addEventListener('input', updateFeedback);
  txt.focus();

  const close = () => modal.remove();
  modal.querySelector('#modal-close-paste')?.addEventListener('click', close);
  modal.querySelector('#btn-cancel-paste')?.addEventListener('click', close);

  confirmBtn.addEventListener('click', async () => {
    if (parsedDepths.length < 2) return;
    confirmBtn.disabled = true;
    try {
      const res = await ctx.rpcClient.call('samples.pasteDepths', {
        depths: parsedDepths,
      });
      const count = res?.count ?? res?.sample_count ?? parsedDepths.length;
      fb.style.color = 'var(--status-success)';
      fb.textContent = `已导入 ${count} 个层位；导出的行由这些深度决定`;
      // 数据变了要立刻重挂面板：Paste 计数与层位列表都来自载荷。
      ctx.onDataChange?.();
      setTimeout(close, 400);
    } catch (err) {
      // 未标定等前置缺失由后端给出可执行文案（-32001 指路步骤 3），原样呈现。
      const message = err instanceof Error ? err.message : String(err);
      fb.style.color = 'var(--accent-red)';
      fb.textContent = message;
      notifyError(message);
      confirmBtn.disabled = false;
    }
  });
}
