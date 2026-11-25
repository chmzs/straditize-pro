import { DiagramData } from '../../types/pollen';
import { SAMPLE_SOURCE_ORDER, sampleSourceColor } from '../canvas/SampleOverlay';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { calUnitLabel } from '../../core/calUnit';
import { notify, notifyError } from '../../ui/feedback';
import { showConfirmDialog } from '../../ui/confirm';
import { renderResetButton } from '../../ui/resetButton';

export const step = 7;
export const title = '7. 拐点与采样层位';

let cachedSamplesData: DiagramData | null = null;

/**
 * 「等距网格层位」折叠区是否展开。
 *
 * 面板每次重渲染都重建 DOM，`<details>` 的展开态存进 DOM 就会被重置：用户点开 →
 * 生成 → 面板刷新 → 折叠区又合上，刚生成的结果直接看不见（issue #103）。
 */
let gridFoldOpen = false;

/** 自动共识提取参数状态缓存（默认按地学用户实测黄金组合：仅波峰 + 强共振(≥2列) + 自适应密度） */
let consensusMode: 'dual' | 'peaks' = 'peaks';
let consensusAdaptive: boolean = true;
let consensusTolerancePx: number = 2.5;
let consensusMinSupport: number = 2;

export function render(data: DiagramData): string {
  cachedSamplesData = data;
  const samples = data.samples || [];
  const autoCount = samples.filter((s) => s.source === 'auto').length;
  const pasteCount = samples.filter((s) => s.source === 'paste').length;
  const manualCount = samples.filter((s) => s.source === 'manual').length;
  const gridCount = samples.filter((s) => s.source === 'grid').length;

  // 统计行同时也是**色标**（issue #85）：画布四种来源的颜色由
  // `canvas/SampleOverlay.ts::SAMPLE_SOURCE_COLORS` 单点定义，这里按同一顺序取色，
  // 保证面板色块与画布线条一一对应。文案仍全部来自 i18n 模板，按 `|` 切段，
  // 不新增键、不硬编码任何语言的字面量；切段数不符（模板被改）时退回整行纯文本。
  const statsText = t('step7.samplesStats', {
    auto: autoCount,
    paste: pasteCount,
    manual: manualCount,
    grid: gridCount,
  });
  const statsSegments = statsText.split('|').map((segment) => segment.trim());
  const legendHtml =
    statsSegments.length === SAMPLE_SOURCE_ORDER.length
      ? SAMPLE_SOURCE_ORDER.map((source, idx) => {
          const swatch = `<span aria-hidden="true" style="display: inline-block; width: 9px; height: 9px; border-radius: 2px; background: ${sampleSourceColor(source)}; border: 1px solid rgba(0, 0, 0, 0.18);"></span>`;
          return `<span style="display: inline-flex; align-items: center; gap: 4px;">${swatch}${statsSegments[idx]}</span>`;
        }).join('')
      : null;

  // 深度分辨率：1 像素对应多少深度。粘贴的深度最终只能落到**整数行**上，
  // 所以这个数就是「导入精度」的量化说明——必须显示出来，否则用户会以为深度是精确对齐的。
  const cal = data.calibration;
  // 单位文案走**唯一入口** `core/calUnit`：缺单位一律显示"单位未定"，与页脚、属性面板、
  // 画布徽标、步骤 3 面板说同一句话，不回落成 `cm`。本项目用户的轴可以是
  // `ka` / `cal yrBP` / `cm`，显示错单位会让"间隔 0.5"被读成 0.5 cm。
  const unitLabel = calUnitLabel(cal);
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
      ? `${(spanValue / spanPx).toFixed(3)} ${unitLabel}/px`
      : t('step7.resolutionUnknown');

  // 默认步长：把标定区间切成约 200 层，取 3 位小数（用户可改）。
  const defaultGridStep =
    spanValue > 0 ? Number((spanValue / 200).toFixed(3)) : 0.05;

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

        <!-- 模式选择药丸 (双轨 / 仅波峰) -->
        <div style="margin-bottom: 8px;">
          <div style="font-size: 10px; font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">${t('step7.modeLabel')}</div>
          <div style="display: flex; gap: 4px;">
            <button type="button" class="ui-btn ui-btn--sm ${consensusMode === 'dual' ? 'ui-btn--primary' : 'ui-btn--quiet'} btn-consensus-mode" data-mode="dual" style="flex: 1; font-size: 10px; padding: 3px 4px;" title="${t('step7.modeDualDesc')}">
              ${t('step7.modeDual')}
            </button>
            <button type="button" class="ui-btn ui-btn--sm ${consensusMode === 'peaks' ? 'ui-btn--primary' : 'ui-btn--quiet'} btn-consensus-mode" data-mode="peaks" style="flex: 1; font-size: 10px; padding: 3px 4px;" title="${t('step7.modePeaksDesc')}">
              ${t('step7.modePeaks')}
            </button>
          </div>
        </div>

        <!-- 自适应密度容差与固定容差微调 -->
        <div style="margin-bottom: 8px; display: flex; flex-direction: column; gap: 4px;">
          <label style="display: flex; align-items: center; gap: 6px; font-size: 10px; cursor: pointer;">
            <input type="checkbox" id="chk-consensus-adaptive" ${consensusAdaptive ? 'checked' : ''} style="cursor: pointer;" />
            <span>${t('step7.adaptiveLabel')}</span>
          </label>
          <div id="row-fixed-tol" style="display: ${consensusAdaptive ? 'none' : 'flex'}; align-items: center; gap: 6px; margin-left: 18px;">
            <span style="font-size: 9.5px; color: var(--text-muted);">${t('step7.fixedTolLabel')}:</span>
            <input id="input-consensus-tol" type="number" min="0.5" max="20" step="0.5" value="${consensusTolerancePx}"
                   style="width: 55px; padding: 2px 4px; font-size: 10px; font-family: var(--font-mono); background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;" />
          </div>
        </div>

        <!-- 共振门槛 (支持列数) -->
        <div style="margin-bottom: 8px;">
          <div style="font-size: 10px; font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">${t('step7.minSupportLabel')}</div>
          <div style="display: flex; gap: 4px;">
            <button type="button" class="ui-btn ui-btn--sm ${consensusMinSupport === 1 ? 'ui-btn--primary' : 'ui-btn--quiet'} btn-consensus-support" data-support="1" style="flex: 1; font-size: 10px; padding: 3px 4px;">
              ${t('step7.minSupport1')}
            </button>
            <button type="button" class="ui-btn ui-btn--sm ${consensusMinSupport === 2 ? 'ui-btn--primary' : 'ui-btn--quiet'} btn-consensus-support" data-support="2" style="flex: 1; font-size: 10px; padding: 3px 4px;">
              ${t('step7.minSupport2')}
            </button>
          </div>
        </div>

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
        <div style="font-size: 10px; color: var(--text-muted); margin-bottom: 6px;${legendHtml ? ' display: flex; flex-wrap: wrap; gap: 10px;' : ''}">
          ${legendHtml ?? statsText}
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

      <!-- 等距网格层位：sample_grid 四个来源里唯一「用户已知取样间隔」的入口。
           默认**折叠**（issue #103）：它是备选路径而非主干，无条件铺开等于替用户
           宣称"等距取样是标准做法"。文案只描述它做什么，不评价钻孔怎么采样。 -->
      <details id="fold-grid-samples" class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);" ${gridFoldOpen ? 'open' : ''}>
        <summary style="font-size: 11px; font-weight: 700; cursor: pointer;" title="${t('step7.gridDesc')}">${t('step7.gridTitle')}</summary>
        <p id="grid-step-hint" style="font-size: 10px; color: var(--text-muted); margin: 6px 0; line-height: 1.4;">${t('step7.gridDesc')}</p>
        <div style="display: flex; align-items: center; gap: 6px;">
          <input id="input-grid-step" type="number" min="0" step="any" value="${defaultGridStep}"
                 style="width: 84px; padding: 4px 6px; font-size: 11px; font-family: var(--font-mono); background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;" />
          <span style="font-size: 9.5px; color: var(--text-muted);">${unitLabel} / ${t('step7.gridStepSuffix')}</span>
          <button id="btn-grid-samples" class="ui-btn ui-btn--secondary" style="flex: 1; font-size: 11px; padding: 5px;">
            ${t('step7.gridBtn')}
          </button>
        </div>
        <!-- 替换后果写死在按钮下方：samples.fromDepthGrid 是**静默替换**，用户点之前
             必须知道会丢掉现有的哪一批层位（含共识层位、粘贴的深度）。N=0 时不提"替换"，
             免得凭空吓一次。 -->
        <p id="grid-replace-hint" style="font-size: 10px; color: var(--status-warning); margin: 6px 0 0 0; line-height: 1.4;">
          ${samples.length > 0 ? t('step7.gridReplaceHint', { count: samples.length }) : t('step7.gridReplaceHintEmpty')}
        </p>
      </details>
        <div id="horizons-list-container" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); font-size: 10px; font-family: monospace;">
          ${
            samples.length === 0
              ? '<div style="color: var(--text-muted); text-align: center; padding: 12px; font-family: sans-serif;">-- 暂无层位 --</div>'
              : samples
                  .map(
                    (s, idx) => {
                      const polarityBadge = s.polarity
                        ? `<span style="font-size: 8.5px; padding: 0 3px; border-radius: 2px; ${
                            s.polarity === 'peak'
                              ? 'background: color-mix(in srgb, var(--status-success) 15%, transparent); color: var(--status-success);'
                              : s.polarity === 'valley'
                              ? 'background: color-mix(in srgb, var(--accent-blue) 15%, transparent); color: var(--accent-blue);'
                              : 'background: color-mix(in srgb, var(--accent-violet) 15%, transparent); color: var(--accent-violet);'
                          }">${s.polarity === 'peak' ? t('step7.polarityPeak') : s.polarity === 'valley' ? t('step7.polarityValley') : t('step7.polarityMixed')}</span>`
                        : '';
                      const supportText =
                        s.support_columns && s.support_columns > 1
                          ? `<span style="font-size: 8.5px; color: var(--text-muted);">${s.support_columns}列</span>`
                          : '';
                      const ageBadge =
                        (s.age_est !== undefined || s.age !== undefined)
                          ? `<span style="font-size: 8.5px; color: var(--accent-amber); background: rgba(245, 158, 11, 0.1); padding: 0 3px; border-radius: 2px;" title="95% CI: ${s.age_lower ?? s.age_min ?? '--'} ~ ${s.age_upper ?? s.age_max ?? '--'} cal yrBP">≈ ${Math.round(s.age_est ?? s.age ?? 0)} cal yrBP</span>`
                          : '';
                      const hid = s.horizon_id || ('H' + String(idx + 1).padStart(4, '0'));
                      return `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 3px 6px; border-bottom: 1px solid rgba(0,0,0,0.04);">
                          <div style="display: flex; align-items: center; gap: 4px;">
                            <span><strong style="color: var(--accent-blue);">${hid}</strong> Y=${s.row_px}px</span>
                            ${polarityBadge}
                            ${supportText}
                            ${ageBadge}
                          </div>
                          <div style="display: flex; align-items: center; gap: 4px;">
                            <span>${s.depth !== null ? `<strong>${s.depth}</strong> ${unitLabel}` : '[--]'}</span>
                            <button class="icon-btn btn-toggle-lock-sample" data-sample-idx="${idx}" title="${s.locked ? '已锁定：重跑共识保留' : '未锁定：点击锁定保护'}" style="color: ${s.locked ? 'var(--status-warning)' : 'var(--text-muted)'}; display: inline-flex; align-items: center; padding: 0 2px; background: none; border: none; cursor: pointer;">
                              ${
                                s.locked
                                  ? `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`
                                  : `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>`
                              }
                            </button>
                            <button class="icon-btn btn-delete-sample" data-sample-idx="${idx}" title="删除该层位" style="color: var(--accent-red); font-size: 12px; padding: 0 4px; background: none; border: none; cursor: pointer;">&times;</button>
                          </div>
                        </div>
                      `;
                    }
                  )
                  .join('')
          }
        </div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-samples-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px; font-weight: 600;">
        ${t('step7.next')}
      </button>

      <!-- 重设操作区 (图2样式) -->
      <div style="display: flex; justify-content: center; margin-top: 8px;">
        ${renderResetButton({
          id: 'btn-reset-step7-samples',
          title: '清空已提取或导入的全部采样层位',
          label: '重设采样层位',
        })}
      </div>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  // 模式切换药丸
  root.querySelectorAll('.btn-consensus-mode').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode') as 'dual' | 'peaks';
      if (mode) {
        consensusMode = mode;
        ctx.onDataChange?.();
      }
    });
  });

  // 自适应容差勾选框
  const chkAdaptive = root.querySelector('#chk-consensus-adaptive') as HTMLInputElement | null;
  chkAdaptive?.addEventListener('change', () => {
    consensusAdaptive = chkAdaptive.checked;
    const rowFixed = root.querySelector('#row-fixed-tol') as HTMLElement | null;
    if (rowFixed) rowFixed.style.display = consensusAdaptive ? 'none' : 'flex';
  });

  // 固定容差输入
  const inputTol = root.querySelector('#input-consensus-tol') as HTMLInputElement | null;
  inputTol?.addEventListener('change', () => {
    const val = Number(inputTol.value);
    if (Number.isFinite(val) && val > 0) consensusTolerancePx = val;
  });

  // 共振门槛切换
  root.querySelectorAll('.btn-consensus-support').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sup = Number(btn.getAttribute('data-support'));
      if (sup === 1 || sup === 2) {
        consensusMinSupport = sup;
        ctx.onDataChange?.();
      }
    });
  });

  root.querySelector('#btn-extract-consensus')?.addEventListener('click', () => {
    ctx.onExtractConsensusHorizons?.({
      mode: consensusMode,
      adaptive_window: consensusAdaptive,
      tolerance_px: consensusTolerancePx,
      min_taxa_support: consensusMinSupport,
    });
  });

  root.querySelector('#btn-clear-horizons')?.addEventListener('click', () => {
    ctx.onClearHorizons?.();
  });

  // 导入自定义深度（步骤 7 的职责：决定「在哪些深度出数」）
  root.querySelector('#btn-paste-depths')?.addEventListener('click', () => {
    openPasteDepthsModal(ctx);
  });

  // 等距网格层位（samples.fromDepthGrid）：与共识层位并列的另一种行集。
  // 后端默认 `replace=True` —— 生成即**替换**现有全部层位（共识层位、粘贴的深度都算），
  // 所以这里先给一次明确确认，再调后端；旧实现是静默替换（issue #103）。
  const gridFold = root.querySelector<HTMLDetailsElement>('#fold-grid-samples');
  gridFold?.addEventListener('toggle', () => {
    gridFoldOpen = gridFold.open;
  });

  root.querySelector('#btn-grid-samples')?.addEventListener('click', async () => {
    const input = root.querySelector('#input-grid-step') as HTMLInputElement | null;
    const raw = input ? Number(input.value) : NaN;
    if (!Number.isFinite(raw) || raw <= 0) {
      notifyError(t('step7.gridInvalid'));
      return;
    }
    if (!ctx.rpcClient) return;
    const replacing = (cachedSamplesData?.samples ?? []).length;
    if (replacing > 0) {
      const ok = await showConfirmDialog(
        t('step7.gridConfirmTitle'),
        t('step7.gridConfirmBody', { count: replacing }),
        { destructive: true, confirmText: t('step7.gridConfirmOk') },
      );
      if (!ok) return;
    }
    try {
      const res = (await ctx.rpcClient.call('samples.fromDepthGrid', { step: raw })) as {
        count?: number;
        row_step_px?: number;
      };
      notify(
        t('step7.gridDone', {
          count: String(res?.count ?? '?'),
          px: String(res?.row_step_px ?? '?'),
        }),
        'info',
      );
      ctx.onDataChange?.();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : String(err));
    }
  });

  // 单行层位锁定/解锁切换 (issue #86)
  root.querySelectorAll('.btn-toggle-lock-sample').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-sample-idx') || '-1', 10);
      if (idx >= 0 && cachedSamplesData && cachedSamplesData.samples && cachedSamplesData.samples[idx]) {
        const item = cachedSamplesData.samples[idx];
        item.locked = !item.locked;
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

  root.querySelector('#btn-reset-step7-samples')?.addEventListener('click', async () => {
    if (!window.confirm('确定清空当前已提取或导入的全部采样层位吗？')) return;
    await ctx.onClearHorizons?.();
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
