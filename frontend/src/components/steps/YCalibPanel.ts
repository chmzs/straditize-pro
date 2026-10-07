import { DiagramData } from '../../types/pollen';
import { CoordinateSystem } from '../../core/CoordinateSystem';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notifyError } from '../../ui/feedback';

export const step = 3;
export const title = '3. Y 轴物理标定';

export function render(data: DiagramData): string {
  const cal = data.calibration;
  const bounds = CoordinateSystem.calibrationBounds(cal);
  const isCalibrated = Boolean(bounds);

  const topPx = bounds ? bounds.topPx : (cal.top_px ?? '');
  const topVal = bounds ? bounds.topValue : (cal.top_cm ?? '');
  const botPx = bounds ? bounds.bottomPx : (cal.bottom_px ?? '');
  const botVal = bounds ? bounds.bottomValue : (cal.bottom_cm ?? '');
  const unit = cal.unit || 'cm';

  let ratioStr = '--';
  if (bounds && Math.abs(bounds.bottomPx - bounds.topPx) > 0) {
    const ratio = Math.abs((bounds.bottomValue - bounds.topValue) / (bounds.bottomPx - bounds.topPx));
    ratioStr = `${ratio.toFixed(4)} ${unit}/px`;
  }

  return `
    <div class="step-panel" data-step="3">
      <div class="step-title">${t('step3.title')}</div>
      <div class="step-desc">
        ${t('step3.desc')}
      </div>

      <!-- 标定状态指示条 -->
      <div class="info-callout ${isCalibrated ? 'success' : 'warning'}" style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
        <span style="font-size: 11px; font-weight: 700;">
          ${isCalibrated ? t('step3.active') : t('step3.inactive')}
        </span>
        <button id="btn-repick-ycalib" class="tool-btn btn-subaction" style="font-size: 10.5px; padding: 3px 8px;">${t('step3.pickPoints')}</button>
      </div>

      <!-- 常驻两点标定输入表单 (100% 常驻侧栏，彻底告别弹窗) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 8px;">${t('step3.params')}</div>

        <!-- 参考点 1 (Y1) -->
        <div style="background: var(--bg-tertiary); padding: 8px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(245, 158, 11, 0.35);">
          <div style="font-size: 10.5px; font-weight: 700; margin-bottom: 4px; color: #f59e0b; display: flex; justify-content: space-between;">
            <span>${t('step3.ref1')}</span>
            <span style="font-family: monospace;">${topPx !== '' ? `Y1=${topPx}px` : '--'}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">Y1 (px):</label>
              <input type="number" id="ycal-inp-top-px" value="${topPx}" placeholder="556" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">${t('step3.unit')}:</label>
              <input type="number" id="ycal-inp-top-val" value="${topVal}" step="any" placeholder="0" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
        </div>

        <!-- 参考点 2 (Y2) -->
        <div style="background: var(--bg-tertiary); padding: 8px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(16, 185, 129, 0.35);">
          <div style="font-size: 10.5px; font-weight: 700; margin-bottom: 4px; color: #10b981; display: flex; justify-content: space-between;">
            <span>${t('step3.ref2')}</span>
            <span style="font-family: monospace;">${botPx !== '' ? `Y2=${botPx}px` : '--'}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">Y2 (px):</label>
              <input type="number" id="ycal-inp-bot-px" value="${botPx}" placeholder="1320" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">${t('step3.unit')}:</label>
              <input type="number" id="ycal-inp-bot-val" value="${botVal}" step="any" placeholder="1500" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
        </div>

        <!-- 单位与比例 -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 2px; font-size: 10.5px;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <label style="color: var(--text-muted);">${t('step3.unit')}:</label>
            <input type="text" id="ycal-inp-unit" value="${unit}" style="width: 50px; font-size: 11px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
          </div>
          <div style="color: var(--text-muted);">
            Ratio: <strong id="lbl-ycal-ratio" style="color: var(--accent-green, #10b981); font-family: monospace;">${ratioStr}</strong>
          </div>
        </div>

        <button id="btn-apply-ycalib" class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 5px; margin-top: 6px;">
          ${t('step3.apply')}
        </button>
      </div>

      <!-- 推进到 Step 4 -->
      <button id="btn-apply-ycalib-next" class="btn btn-primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step3.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  const commitCalibration = () => {
    const topPx = parseFloat((root.querySelector('#ycal-inp-top-px') as HTMLInputElement)?.value || '');
    const topVal = parseFloat((root.querySelector('#ycal-inp-top-val') as HTMLInputElement)?.value || '');
    const botPx = parseFloat((root.querySelector('#ycal-inp-bot-px') as HTMLInputElement)?.value || '');
    const botVal = parseFloat((root.querySelector('#ycal-inp-bot-val') as HTMLInputElement)?.value || '');
    const unit = (root.querySelector('#ycal-inp-unit') as HTMLInputElement)?.value.trim() || 'cm';

    // 即使真实数值尚未填齐，也实时同步 Y1/Y2 像素位置到画布预览
    if (ctx.onPreviewYCalibrationPx) {
      ctx.onPreviewYCalibrationPx(
        isNaN(topPx) ? null : topPx,
        isNaN(botPx) ? null : botPx
      );
    }

    if (isNaN(topPx) || isNaN(topVal) || isNaN(botPx) || isNaN(botVal)) {
      return;
    }
    if (topPx === botPx) {
      notifyError('两点标定错误：两个参考点的像素 Y 坐标不能相同！');
      return;
    }

    if (ctx.onSubmitYCalibration) {
      ctx.onSubmitYCalibration(topPx, topVal, botPx, botVal, unit);
    }
  };

  // 输入或失去焦点时即时同步画布锚点与标定
  root.querySelectorAll('#ycal-inp-top-px, #ycal-inp-bot-px').forEach((inp) => {
    inp.addEventListener('input', () => {
      const topPx = parseFloat((root.querySelector('#ycal-inp-top-px') as HTMLInputElement)?.value || '');
      const botPx = parseFloat((root.querySelector('#ycal-inp-bot-px') as HTMLInputElement)?.value || '');
      ctx.onPreviewYCalibrationPx?.(isNaN(topPx) ? null : topPx, isNaN(botPx) ? null : botPx);
    });
  });

  root.querySelectorAll('#ycal-inp-top-px, #ycal-inp-top-val, #ycal-inp-bot-px, #ycal-inp-bot-val, #ycal-inp-unit').forEach((inp) => {
    inp.addEventListener('change', commitCalibration);
  });

  // 手动点击应用
  root.querySelector('#btn-apply-ycalib')?.addEventListener('click', commitCalibration);

  // 重新图上选点
  root.querySelector('#btn-repick-ycalib')?.addEventListener('click', () => {
    ctx.onStartYCalibration?.();
  });

  // 推进到步骤 4
  root.querySelector('#btn-apply-ycalib-next')?.addEventListener('click', () => {
    commitCalibration();
    ctx.onAdvanceWorkflowStage?.(4);
  });
}
