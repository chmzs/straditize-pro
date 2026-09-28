import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';

export const step = 6;
export const title = '6. 标定列与 X 刻度';

let cachedData: DiagramData | null = null;

export function render(data: DiagramData): string {
  cachedData = data;
  const activeCol = data.columns.find((c) => c.id === data.activeTaxaId) || data.columns[0];
  const colName = activeCol ? activeCol.name : t('step6.unselected');
  const hasTicks = activeCol && activeCol.x_ticks && activeCol.x_ticks.length === 2;

  return `
    <div class="step-panel" data-step="6">
      <div class="step-title">${t('step6.title')}</div>
      <div class="step-desc">
        ${t('step6.activeCol')}<strong style="color: var(--accent-blue);">${colName}</strong>
      </div>

      <!-- 自动刻度线几何检测 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">${t('step6.autoTicksTitle')}</div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
          ${t('step6.autoTicksDesc')}
        </p>
        <button id="btn-detect-xticks" class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 5px;">
          🔍 ${t('step6.autoTicksBtn')}
        </button>
      </div>

      <!-- 当前列标度参数 (事实源: x_ticks) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">${t('step6.ticksSource')}</span>
          ${hasTicks ? `<button id="btn-clear-col-ticks" class="icon-btn btn-subaction" style="font-size: 10px; color: #ef4444; padding: 1px 4px;" title="${t('step6.clearTicks')}">${t('step6.clearTicks')}</button>` : ''}
        </div>
        <div class="info-kv-box">
          <div>状态: <strong style="color: ${hasTicks ? 'var(--accent-green, #10b981)' : 'var(--accent-orange, #f59e0b)'}; font-weight: 700;">${hasTicks ? t('step6.calibrated') : t('step6.uncalibrated')}</strong></div>
          ${
            hasTicks && activeCol?.x_ticks
              ? `
            <div>① X1: <code>X=${activeCol.x_ticks[0].px}px</code> → <strong>${activeCol.x_ticks[0].value} ${activeCol.unit || '%'}</strong></div>
            <div>② X2: <code>X=${activeCol.x_ticks[1].px}px</code> → <strong>${activeCol.x_ticks[1].value} ${activeCol.unit || '%'}</strong></div>
          `
              : `<div style="color: var(--text-muted); font-size: 10px;">${t('step6.uncalibrated')}</div>`
          }
        </div>

        <!-- 重新输入两端点表单 -->
        <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
          <div style="font-size: 10.5px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary);">${t('step6.reinput')}</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div>
              <label style="font-size: 9.5px; color: var(--text-muted);">值 1 (Origin):</label>
              <input type="number" id="inp-manual-tick-val1" value="${hasTicks ? activeCol.x_ticks![0].value : (activeCol?.startValue ?? 0)}" style="width: 100%; font-size: 10.5px; padding: 2px 4px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 9.5px; color: var(--text-muted);">值 2 (Max):</label>
              <input type="number" id="inp-manual-tick-val2" value="${hasTicks ? activeCol.x_ticks![1].value : (activeCol?.tickValue ?? 20)}" style="width: 100%; font-size: 10.5px; padding: 2px 4px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
          <button id="btn-save-manual-ticks" class="btn btn-secondary" style="width: 100%; font-size: 10.5px; padding: 4px 6px; margin-top: 6px;">
            💾 ${t('step6.saveTicks')}
          </button>
        </div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-xticks-next" class="btn btn-primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step6.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-detect-xticks')?.addEventListener('click', () => {
    ctx.onDetectXTicks?.();
  });

  // 清空本列标度
  root.querySelector('#btn-clear-col-ticks')?.addEventListener('click', () => {
    const activeCol = cachedData?.columns.find((c) => c.id === cachedData?.activeTaxaId) || cachedData?.columns[0];
    if (activeCol) {
      activeCol.x_ticks = undefined;
      ctx.onDataChange?.();
    }
  });

  // 保存手动输入的两端点物理标度
  root.querySelector('#btn-save-manual-ticks')?.addEventListener('click', () => {
    const activeCol = cachedData?.columns.find((c) => c.id === cachedData?.activeTaxaId) || cachedData?.columns[0];
    if (activeCol) {
      const val1 = parseFloat((root.querySelector('#inp-manual-tick-val1') as HTMLInputElement)?.value || '0');
      const val2 = parseFloat((root.querySelector('#inp-manual-tick-val2') as HTMLInputElement)?.value || '20');
      const p1 = activeCol.startX;
      const p2 = activeCol.tickEndX || activeCol.endX;
      activeCol.x_ticks = [
        { px: p1, value: val1 },
        { px: p2, value: val2 },
      ];
      activeCol.startValue = val1;
      activeCol.tickValue = val2;
      activeCol.maxPercent = val2;
      ctx.onDataChange?.();
    }
  });

  root.querySelector('#btn-apply-xticks-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(7);
  });
}
