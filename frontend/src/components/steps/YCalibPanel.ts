import { DiagramData } from '../../types/pollen';
import { CoordinateSystem } from '../../core/CoordinateSystem';
import { StepContext } from './_registry';

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
      <div class="step-title">3. Y 轴物理标定 (Calibration)</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5;">
        两点标定物理深度/年代轴。在左侧标尺上点选两个已知刻度线所在像素行，填入真实值。
      </div>

      <!-- 标定状态指示条 -->
      <div class="inspector-section" style="padding: 8px; background: ${isCalibrated ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)'}; border: 1px solid ${isCalibrated ? '#10b981' : '#f59e0b'}; border-radius: 6px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; font-weight: 700; color: ${isCalibrated ? '#059669' : '#d97706'};">
            ${isCalibrated ? '✓ Y 轴标定生效中' : '⚠️ 尚未完成 Y 轴标定'}
          </span>
          <button id="btn-repick-ycalib" class="tool-btn" style="font-size: 10px; padding: 2px 6px;">🎯 图上选点</button>
        </div>
      </div>

      <!-- 常驻两点标定输入表单 (100% 常驻侧栏，彻底告别弹窗) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 8px;">标定参考点参数</div>

        <!-- 参考点 1 -->
        <div style="background: var(--bg-tertiary); padding: 8px; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-light);">
          <div style="font-size: 10.5px; font-weight: 600; margin-bottom: 4px; color: var(--accent-blue);">① 上方/基准点:</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">像素 Y (px):</label>
              <input type="number" id="ycal-inp-top-px" value="${topPx}" placeholder="如 556" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">真实数值:</label>
              <input type="number" id="ycal-inp-top-val" value="${topVal}" step="any" placeholder="如 0" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
        </div>

        <!-- 参考点 2 -->
        <div style="background: var(--bg-tertiary); padding: 8px; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-light);">
          <div style="font-size: 10.5px; font-weight: 600; margin-bottom: 4px; color: var(--accent-blue);">② 下方/对照点:</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">像素 Y (px):</label>
              <input type="number" id="ycal-inp-bot-px" value="${botPx}" placeholder="如 1320" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 10px; color: var(--text-muted);">真实数值:</label>
              <input type="number" id="ycal-inp-bot-val" value="${botVal}" step="any" placeholder="如 1500" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
        </div>

        <!-- 单位与比例 -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 2px; font-size: 10.5px;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <label style="color: var(--text-muted);">单位:</label>
            <input type="text" id="ycal-inp-unit" value="${unit}" style="width: 50px; font-size: 11px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
          </div>
          <div style="color: var(--text-muted);">
            换算比: <strong id="lbl-ycal-ratio" style="color: var(--accent-green, #10b981);">${ratioStr}</strong>
          </div>
        </div>

        <button id="btn-apply-ycalib" class="tool-btn" style="width: 100%; font-size: 11px; padding: 5px; margin-top: 6px;">
          💾 应用两点标定
        </button>
      </div>

      <!-- 推进到 Step 4 -->
      <button id="btn-apply-ycalib-next" class="primary-btn" style="width: 100%; padding: 6px 12px; font-size: 12px;">
        👉 确认标尺，进入干扰清理 (步骤 4)
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

    if (isNaN(topPx) || isNaN(topVal) || isNaN(botPx) || isNaN(botVal)) {
      return;
    }
    if (topPx === botPx) {
      alert('两点标定错误：两个参考点的像素 Y 坐标不能相同！');
      return;
    }

    if (ctx.onSubmitYCalibration) {
      ctx.onSubmitYCalibration(topPx, topVal, botPx, botVal, unit);
    }
  };

  // 失去焦点时即时同步标定
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
