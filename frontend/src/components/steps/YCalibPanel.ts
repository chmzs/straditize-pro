import { DiagramData } from '../../types/pollen';
import { CoordinateSystem } from '../../core/CoordinateSystem';
import { calUnitLabel } from '../../core/calUnit';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notifyError } from '../../ui/feedback';
import { renderResetButton } from '../../ui/resetButton';

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
  // 单位只取自后端下发值或用户输入。缺失就是缺失（显示"单位未定"），绝不填一个
  // "看起来合理"的默认值：Y 轴可能就是 ka，猜成 cm 既不会报错，又会把整柱样品
  // 按 cm 解释后写回模型，错得很安静（#111）。
  const unit = (cal.unit ?? '').trim();
  // 文案与"未定"的判定走共享入口（core/calUnit）：页脚、属性面板、画布徽标与本面板
  // 必须说同一句话。本面板只决定排版（占位符、提示行、比值后缀）。
  const unitLabel = calUnitLabel(cal);
  // What the Y axis MEASURES. 默认年代 (age)；四种类型：①age (cal yrBP), ②depth (cm), ③code (#), ④custom (如 elev / m)
  const rawAxis = (cal.primaryAxis ?? 'age').trim().toLowerCase();
  const cleanCustomName = rawAxis.startsWith('custom:') ? rawAxis.slice(7) : rawAxis;
  const isKnown = ['age', 'depth', 'code'].includes(cleanCustomName);
  const primaryAxis = isKnown ? cleanCustomName : (rawAxis.startsWith('custom:') ? rawAxis : `custom:${cleanCustomName}`);
  const axisCategory = isKnown ? cleanCustomName : 'custom';

  let ratioStr = '--';
  if (bounds && Math.abs(bounds.bottomPx - bounds.topPx) > 0) {
    const ratio = Math.abs((bounds.bottomValue - bounds.topValue) / (bounds.bottomPx - bounds.topPx));
    // 单位未知时只报纯比值，不留一个假单位。
    ratioStr = unit === '' ? `${ratio.toFixed(4)}/px` : `${ratio.toFixed(4)} ${unit}/px`;
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
        <button id="btn-repick-ycalib" class="ui-btn ui-btn--quiet ui-btn--xs btn-subaction" style="font-size: 10.5px; padding: 3px 8px;">${t('step3.pickPoints')}</button>
      </div>

      <!-- 常驻两点标定输入表单 (100% 常驻侧栏，彻底告别弹窗) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 8px;">${t('step3.params')}</div>

        <!-- 参考点 1 (Y1) -->
        <div style="background: var(--bg-tertiary); padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(245, 158, 11, 0.35);">
          <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px; color: var(--status-warning); display: flex; justify-content: space-between; align-items: center;">
            <span>${t('step3.ref1')}</span>
            <span style="font-family: var(--font-mono); font-size: 10px;">${topPx !== '' ? `Y1=${topPx}px` : '--'}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 2px;">像素 (px):</label>
              <input type="number" id="ycal-inp-top-px" value="${topPx}" placeholder="556" style="width: 100%; font-size: 11px; padding: 4px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 2px;">${t('step3.value')}:</label>
              <input type="number" id="ycal-inp-top-val" value="${topVal}" step="any" placeholder="0" style="width: 100%; font-size: 11px; padding: 4px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
        </div>

        <!-- 参考点 2 (Y2) -->
        <div style="background: var(--bg-tertiary); padding: 8px 10px; border-radius: 6px; margin-bottom: 8px; border: 1px solid rgba(16, 185, 129, 0.35);">
          <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px; color: var(--status-success); display: flex; justify-content: space-between; align-items: center;">
            <span>${t('step3.ref2')}</span>
            <span style="font-family: var(--font-mono); font-size: 10px;">${botPx !== '' ? `Y2=${botPx}px` : '--'}</span>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <div>
              <label style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 2px;">像素 (px):</label>
              <input type="number" id="ycal-inp-bot-px" value="${botPx}" placeholder="1320" style="width: 100%; font-size: 11px; padding: 4px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 2px;">${t('step3.value')}:</label>
              <input type="number" id="ycal-inp-bot-val" value="${botVal}" step="any" placeholder="1500" style="width: 100%; font-size: 11px; padding: 4px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
        </div>

        <!-- 主轴性质与单位联动 -->
        <div style="margin-bottom: 8px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-secondary); margin-bottom: 6px;">主轴性质:</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-bottom: 6px;">
            <button type="button" class="ui-btn ${axisCategory === 'age' ? 'ui-btn--primary' : 'ui-btn--quiet'} ui-btn--xs btn-ytype-select" data-type="age" style="font-size: 11px; padding: 6px 4px; justify-content: center; font-weight: 500;">
              年代 (age)
            </button>
            <button type="button" class="ui-btn ${axisCategory === 'depth' ? 'ui-btn--primary' : 'ui-btn--quiet'} ui-btn--xs btn-ytype-select" data-type="depth" style="font-size: 11px; padding: 6px 4px; justify-content: center; font-weight: 500;">
              深度 (depth)
            </button>
            <button type="button" class="ui-btn ${axisCategory === 'code' ? 'ui-btn--primary' : 'ui-btn--quiet'} ui-btn--xs btn-ytype-select" data-type="code" style="font-size: 11px; padding: 6px 4px; justify-content: center; font-weight: 500;">
              编号 (code)
            </button>
            <button type="button" class="ui-btn ${axisCategory === 'custom' ? 'ui-btn--primary' : 'ui-btn--quiet'} ui-btn--xs btn-ytype-select" data-type="custom" style="font-size: 11px; padding: 6px 4px; justify-content: center; font-weight: 500;">
              自定义 (custom)
            </button>
          </div>
          <input type="hidden" id="ycal-sel-primary-axis" value="${primaryAxis}" />

          <!-- 自定义轴名称输入框（当且仅当选择自定义时展开） -->
          <div id="ycal-custom-axis-box" style="display: ${axisCategory === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 6px; margin-bottom: 6px; background: var(--bg-card); padding: 5px 8px; border-radius: 4px; border: 1px dashed var(--accent-blue);">
            <label style="font-size: 10px; color: var(--text-muted); white-space: nowrap;">标识名称:</label>
            <input type="text" id="ycal-inp-custom-axis" value="${axisCategory === 'custom' ? cleanCustomName : 'elev'}" placeholder="如 elev" style="flex: 1; font-size: 11px; padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary);" />
          </div>

          <!-- 单位与比例信息卡片（主轴与单位直接联动） -->
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: var(--bg-tertiary); border-radius: 4px; border: 1px solid var(--border-light);">
            <div style="display: flex; align-items: center; gap: 6px;">
              <label style="font-size: 10.5px; color: var(--text-muted); white-space: nowrap;">单位:</label>
              <input
                type="text"
                id="ycal-inp-unit"
                value="${unit}"
                placeholder="${unitLabel}"
                style="width: 58px; font-size: 11px; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); font-weight: 600;"
              />
              <span id="ycal-unit-link-hint" style="font-size: 9.5px; color: var(--text-muted); ${axisCategory === 'custom' ? 'display: none;' : ''}">
                ${axisCategory === 'age' ? 'cal yrBP 联动' : axisCategory === 'depth' ? 'cm 联动' : axisCategory === 'code' ? '无单位' : ''}
              </span>
            </div>
            <div style="font-size: 10.5px; color: var(--text-muted);">
              Ratio: <strong id="lbl-ycal-ratio" style="color: var(--accent-green); font-family: var(--font-mono);">${ratioStr}</strong>
            </div>
          </div>
          ${unit === '' ? `<div style="font-size: 9.5px; color: var(--status-warning); padding: 4px 2px 0;">${unitLabel}</div>` : ''}
        </div>

        <button id="btn-apply-ycalib" class="ui-btn ui-btn--secondary" style="width: 100%; font-size: 11px; padding: 6px; margin-top: 4px;">
          ${t('step3.apply')}
        </button>
      </div>

      <!-- 推进到 Step 4 -->
      <button id="btn-apply-ycalib-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px; font-weight: 600;">
        ${t('step3.next')}
      </button>

      <!-- 重设本步 (图2样式) -->
      <div style="display: flex; justify-content: center; margin-top: 8px;">
        ${renderResetButton({
          id: 'btn-reset-step3-ycalib',
          title: '清空两点像素与标定参数，回到未标定状态',
          label: '重设标定',
        })}
      </div>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  /**
   * 四个必填数值框 + 对用户的中文名字。
   *
   * 顺序即错误文案里的列举顺序。名字必须细到"哪一个框"：只说"参数不完整"
   * 等于没告诉用户该改哪里，而 Y 标定是所有深度读数的唯一来源。
   */
  const REQUIRED: ReadonlyArray<readonly [string, string]> = [
    ['#ycal-inp-top-px', 'Y1 像素行'],
    ['#ycal-inp-top-val', 'Y1 数值'],
    ['#ycal-inp-bot-px', 'Y2 像素行'],
    ['#ycal-inp-bot-val', 'Y2 数值'],
  ];
  const APPLY_ERROR_PREFIX = 'Y 轴标定未提交';

  /**
   * @param reportMissing 是否把"缺项"报给用户。
   *
   * 只有用户**显式点「应用标定」**时才为 true。`change` 触发的自动提交必须保持静默：
   * 用户逐框填写时前三次必然缺项，若每次失焦都弹一条错误，输入过程就变成报警器。
   *
   * 曾经这里是无条件静默 `return`（缺项时零请求、零提示、零变化），而四个框的
   * `placeholder` 是 `556 / 0 / 1320 / 1500` 这组字面量常量，看起来像已填好 ——
   * 用户点完以为标定过了，实际上什么都没发生（T-02）。
   */
  const readInputs = () => {
    const raw = (selector: string): string =>
      (root.querySelector(selector) as HTMLInputElement | null)?.value.trim() ?? '';
    const num = (selector: string): number => Number.parseFloat(raw(selector));
    return {
      topPx: num('#ycal-inp-top-px'),
      topVal: num('#ycal-inp-top-val'),
      botPx: num('#ycal-inp-bot-px'),
      botVal: num('#ycal-inp-bot-val'),
      unit: raw('#ycal-inp-unit'),
      primaryAxis: raw('#ycal-sel-primary-axis') || 'age',
    };
  };

  /** 仅更新画布像素预览与比例尺读数，绝不写入后端（#172）。 */
  const previewCalibration = () => {
    const { topPx, topVal, botPx, botVal, unit } = readInputs();
    if (ctx.onPreviewYCalibrationPx) {
      ctx.onPreviewYCalibrationPx(
        Number.isFinite(topPx) ? topPx : null,
        Number.isFinite(botPx) ? botPx : null
      );
    }
    const boundsRatio =
      Number.isFinite(topPx) &&
      Number.isFinite(botPx) &&
      Math.abs(botPx - topPx) > 0 &&
      Number.isFinite(topVal) &&
      Number.isFinite(botVal)
        ? Math.abs((botVal - topVal) / (botPx - topPx))
        : null;
    const ratioEl = root.querySelector('#lbl-ycal-ratio');
    if (ratioEl && boundsRatio !== null) {
      ratioEl.textContent =
        unit === '' ? `${boundsRatio.toFixed(4)}/px` : `${boundsRatio.toFixed(4)} ${unit}/px`;
    }
  };

  const commitCalibration = (reportMissing: boolean) => {
    const raw = (selector: string): string =>
      (root.querySelector(selector) as HTMLInputElement | null)?.value.trim() ?? '';
    const num = (selector: string): number => Number.parseFloat(raw(selector));
    const { topPx, topVal, botPx, botVal, unit, primaryAxis } = readInputs();
    previewCalibration();

    // 空串与"打了但不是数字"（`-`、`1e`）同属缺有效输入，一起点名。
    const missing = REQUIRED.filter(([selector]) => !Number.isFinite(num(selector)));
    if (missing.length > 0) {
      if (reportMissing) {
        notifyError(
          `${APPLY_ERROR_PREFIX}：请先填 ${missing.map(([, label]) => label).join('、')}（四个数值框都必须有数字）。`
        );
      }
      return;
    }
    if (topPx === botPx) {
      notifyError(
        `两点标定未生效：两个参考点的像素 Y 都是 ${topPx}，同一个像素行算不出斜率；请改填两个不同的像素行后再点【应用标定】。`
      );
      return;
    }

    if (ctx.onSubmitYCalibration) {
      ctx.onSubmitYCalibration(topPx, topVal, botPx, botVal, unit, primaryAxis);
    }
  };

  // 4 种类型切换按钮逻辑：① age, ② depth, ③ code, ④ custom
  root.querySelectorAll<HTMLButtonElement>('.btn-ytype-select').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const type = btn.dataset.type || 'age';
      root.querySelectorAll<HTMLButtonElement>('.btn-ytype-select').forEach((b) => {
        if (b.dataset.type === type) {
          b.classList.remove('ui-btn--quiet');
          b.classList.add('ui-btn--primary');
        } else {
          b.classList.remove('ui-btn--primary');
          b.classList.add('ui-btn--quiet');
        }
      });
      const axisHidden = root.querySelector('#ycal-sel-primary-axis') as HTMLInputElement | null;
      const customBox = root.querySelector('#ycal-custom-axis-box') as HTMLElement | null;
      const customInp = root.querySelector('#ycal-inp-custom-axis') as HTMLInputElement | null;
      const unitInp = root.querySelector('#ycal-inp-unit') as HTMLInputElement | null;
      const linkHint = root.querySelector('#ycal-unit-link-hint') as HTMLElement | null;

      if (type === 'custom') {
        if (customBox) customBox.style.display = 'flex';
        const customVal = customInp?.value.trim().toLowerCase() || 'elev';
        if (axisHidden) axisHidden.value = `custom:${customVal}`;
        if (unitInp) {
          unitInp.readOnly = false;
          unitInp.style.background = 'var(--bg-card)';
          if (!unitInp.value || unitInp.value === 'cal yrBP' || unitInp.value === 'yrBP' || unitInp.value === 'cm') {
            unitInp.value = 'm';
          }
        }
        if (linkHint) linkHint.style.display = 'none';
      } else {
        if (customBox) customBox.style.display = 'none';
        if (axisHidden) axisHidden.value = type;
        if (unitInp) {
          unitInp.readOnly = true;
          unitInp.style.background = 'transparent';
          if (type === 'age') {
            unitInp.value = 'cal yrBP';
          } else if (type === 'depth') {
            unitInp.value = 'cm';
          } else if (type === 'code') {
            unitInp.value = '';
          }
        }
        if (linkHint) {
          linkHint.style.display = '';
          linkHint.textContent = type === 'age' ? 'cal yrBP 联动' : type === 'depth' ? 'cm 联动' : '无单位';
        }
      }
      previewCalibration();
    });
  });

  // 自定义轴名改变
  root.querySelector('#ycal-inp-custom-axis')?.addEventListener('input', (e) => {
    const val = (e.target as HTMLInputElement).value.trim().toLowerCase() || 'elev';
    const axisHidden = root.querySelector('#ycal-sel-primary-axis') as HTMLInputElement | null;
    if (axisHidden) axisHidden.value = `custom:${val}`;
    previewCalibration();
  });

  // 输入或失去焦点时即时同步画布锚点与标定
  root.querySelectorAll('#ycal-inp-top-px, #ycal-inp-bot-px').forEach((inp) => {
    inp.addEventListener('input', () => {
      const topPx = parseFloat((root.querySelector('#ycal-inp-top-px') as HTMLInputElement)?.value || '');
      const botPx = parseFloat((root.querySelector('#ycal-inp-bot-px') as HTMLInputElement)?.value || '');
      ctx.onPreviewYCalibrationPx?.(isNaN(topPx) ? null : topPx, isNaN(botPx) ? null : botPx);
    });
  });

  root.querySelectorAll('#ycal-inp-top-px, #ycal-inp-top-val, #ycal-inp-bot-px, #ycal-inp-bot-val, #ycal-inp-unit, #ycal-sel-primary-axis').forEach((inp) => {
    // 自动提交保持静默：逐框填写时前几次必然缺项（见 commitCalibration 的注释）。
    inp.addEventListener('change', () => previewCalibration());
  });

  // 手动点击应用：这是用户明确表达"我要提交"，缺项必须报出来。
  root.querySelector('#btn-apply-ycalib')?.addEventListener('click', () => commitCalibration(true));

  // 重新图上选点
  root.querySelector('#btn-repick-ycalib')?.addEventListener('click', () => {
    ctx.onStartYCalibration?.();
  });

  // 推进到步骤 4
  root.querySelector('#btn-apply-ycalib-next')?.addEventListener('click', () => {
    commitCalibration(false);
    ctx.onAdvanceWorkflowStage?.(4);
  });

  // 重设本步
  root.querySelector('#btn-reset-step3-ycalib')?.addEventListener('click', () => {
    if (!window.confirm('确定清空当前 Y 轴两点标定吗？')) return;
    const tPx = root.querySelector('#ycal-inp-top-px') as HTMLInputElement | null;
    const tVal = root.querySelector('#ycal-inp-top-val') as HTMLInputElement | null;
    const bPx = root.querySelector('#ycal-inp-bot-px') as HTMLInputElement | null;
    const bVal = root.querySelector('#ycal-inp-bot-val') as HTMLInputElement | null;
    if (tPx) tPx.value = '';
    if (tVal) tVal.value = '';
    if (bPx) bPx.value = '';
    if (bVal) bVal.value = '';
    ctx.onPreviewYCalibrationPx?.(null, null);
    ctx.onClearYCalibration?.();
  });
}
