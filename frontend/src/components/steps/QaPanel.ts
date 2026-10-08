import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { RpcClient } from '../../services/RpcClient';

export const step = 8;
export const title = '8. 校验与质量诊断';

export interface QaHorizonSummary {
  depth: number | null;
  reason?: string;
  sum?: number;
}

export interface QaColumnMax {
  name: string;
  peak: number;
  declared_max: number;
  over: boolean;
  calibrated?: boolean;
}

export interface QaSummary {
  roi_id: string;
  roi_name: string;
  composition: boolean;
  n_horizons: number;
  n_horizons_with_data: number;
  n_horizons_empty: number;
  empty_horizons: QaHorizonSummary[];
  sum: { min: number; p50: number; max: number; mean: number };
  tolerance: number;
  violations_over: QaHorizonSummary[];
  shortfall: { min: number; max: number; mean: number };
  per_column_max: QaColumnMax[];
  n_uncalibrated?: number;
  uncalibrated_columns?: string[];
}

// 缓存最近一次的 QA 诊断结果
let latestSummary: QaSummary | null = null;
let currentTolerance = 2.0;
let cachedData: DiagramData | null = null;

/** 红色 banner 的内联样式。正常路径与「后端失败」路径共用，避免两处各写一份。 */
const BANNER_RED_STYLE =
  'background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #dc2626;';

function computeBannerMeta(summary: QaSummary) {
  let bannerLevel = 'green';
  let bannerText = '地学校验门禁通过，数据符合规律';
  if (summary.violations_over && summary.violations_over.length > 0) {
    bannerLevel = 'red';
    bannerText = `组分总和超标报警 (发现 ${summary.violations_over.length} 个层位总和 > 100%+${summary.tolerance}%)`;
  } else if (summary.per_column_max && summary.per_column_max.some((c) => c.over)) {
    bannerLevel = 'yellow';
    const overCount = summary.per_column_max.filter((c) => c.over).length;
    bannerText = `单列峰值超刻度警告 (发现 ${overCount} 列峰值超出声明满刻度)`;
  } else if (summary.uncalibrated_columns && summary.uncalibrated_columns.length > 0) {
    bannerLevel = 'yellow';
    bannerText = `存在未标定列 (发现 ${summary.uncalibrated_columns.length} 列未在步骤 6 标定 X 刻度，当前按列宽百分比估算)`;
  }

  const bannerColor =
    bannerLevel === 'red'
      ? BANNER_RED_STYLE
      : bannerLevel === 'yellow'
      ? 'background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #d97706;'
      : 'background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #059669;';

  return { bannerLevel, bannerText, bannerColor };
}

function renderExceptionsHtml(summary: QaSummary): string {
  if (summary.violations_over.length === 0 && summary.empty_horizons.length === 0) {
    return '<div style="color: var(--text-muted); text-align: center; padding: 8px; font-family: sans-serif;">未发现超标层位与空层位，指标正常</div>';
  }
  return `
    ${summary.violations_over
      .map(
        (v) => `
      <div style="display: flex; justify-content: space-between; padding: 2px 4px; color: var(--accent-red); border-bottom: 1px solid rgba(0,0,0,0.04);">
        <span>超标 深度: ${v.depth !== null ? `${v.depth}` : '[未标定]'}</span>
        <span>Σ = <strong>${v.sum}%</strong></span>
      </div>
    `
      )
      .join('')}
    ${summary.empty_horizons
      .map(
        (e) => `
      <div style="display: flex; justify-content: space-between; padding: 2px 4px; color: var(--status-warning); border-bottom: 1px solid rgba(0,0,0,0.04);">
        <span>空层 深度: ${e.depth !== null ? `${e.depth}` : '[未标定]'}</span>
        <span>${e.reason || 'no ink read'}</span>
      </div>
    `
      )
      .join('')}
  `;
}

function renderColumnPeaksHtml(summary: QaSummary): string {
  if (summary.per_column_max.length === 0) {
    return '<div style="color: var(--text-muted); text-align: center; padding: 8px;">暂无列刻度信息</div>';
  }
  return summary.per_column_max
    .map(
      (col) => `
    <div style="display: flex; justify-content: space-between; padding: 2px 4px; border-bottom: 1px solid rgba(0,0,0,0.04); ${col.over ? 'color: var(--accent-amber); font-weight: 700;' : ''}">
      <span>${col.name}</span>
      <span>峰值: ${col.peak} / 标度: ${col.calibrated === false ? '--' : col.declared_max} ${
        col.calibrated === false
          ? '<span style="color: var(--status-warning);">未标定</span>'
          : col.over
          ? '超刻度'
          : '✓'
      }</span>
    </div>
  `
    )
    .join('');
}

export function render(data: DiagramData): string {
  cachedData = data;
  const summary: QaSummary = latestSummary || {
    roi_id: data.rois?.[0]?.id || 'pollen',
    roi_name: data.rois?.[0]?.name || 'pollen',
    composition: true,
    n_horizons: data.samples?.length || 0,
    n_horizons_with_data: data.samples?.length || 0,
    n_horizons_empty: 0,
    empty_horizons: [],
    sum: { min: 0.0, p50: 0.0, max: 0.0, mean: 0.0 },
    tolerance: currentTolerance,
    violations_over: [],
    shortfall: { min: 0.0, max: 0.0, mean: 0.0 },
    per_column_max: [],
  };

  const { bannerLevel, bannerText, bannerColor } = computeBannerMeta(summary);

  return `
    <div class="step-panel" data-step="8">
      <div class="step-title">${t('step8.title')}</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.4;">
        ${t('step8.desc')}
      </div>

      <!-- 诊断综合状态横幅 -->
      <div id="qa-banner" class="qa-banner banner-${bannerLevel}" data-level="${bannerLevel}"
           style="padding: 8px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 12px; ${bannerColor}">
        ${bannerText}
      </div>

      <!-- 核心指标四宫格卡片 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
          <div style="background: var(--bg-tertiary); padding: 6px 8px; border-radius: 4px;">
            <div style="font-size: 10px; color: var(--text-muted);">总层位数 (N_HORIZONS)</div>
            <div style="font-size: 14px; font-weight: 700;"><span id="qa-n-horizons">${summary.n_horizons}</span></div>
          </div>
          <div style="background: var(--bg-tertiary); padding: 6px 8px; border-radius: 4px;">
            <div style="font-size: 10px; color: var(--text-muted);">空层位数 (N_EMPTY)</div>
            <div style="font-size: 14px; font-weight: 700; color: ${summary.n_horizons_empty > 0 ? 'var(--status-warning)' : 'inherit'};">
              <span id="qa-n-empty">${summary.n_horizons_empty}</span>
            </div>
          </div>
          <div style="background: var(--bg-tertiary); padding: 6px 8px; border-radius: 4px;">
            <div style="font-size: 10px; color: var(--text-muted);">最大总和 (SUM_MAX)</div>
            <div style="font-size: 14px; font-weight: 700; color: ${summary.sum.max > 100 + summary.tolerance ? 'var(--accent-red)' : 'inherit'};">
              <span id="qa-sum-max">${Number(summary.sum.max).toFixed(1)}</span>%
            </div>
          </div>
          <div style="background: var(--bg-tertiary); padding: 6px 8px; border-radius: 4px;">
            <div style="font-size: 10px; color: var(--text-muted);">均值亏缺 (SHORTFALL_MEAN)</div>
            <div style="font-size: 14px; font-weight: 700;">
              <span id="qa-shortfall-mean">${Number(summary.shortfall.mean).toFixed(1)}</span>%
            </div>
          </div>
        </div>
      </div>

      <!-- 诊断参数调整 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">门禁容差 (Tolerance)</span>
          <div style="display: flex; align-items: center; gap: 4px;">
            <input type="number" id="qa-inp-tolerance" value="${summary.tolerance}" step="0.5" min="0" max="10" style="width: 50px; font-size: 11px; padding: 2px 4px;" />
            <span style="font-size: 11px;">%</span>
          </div>
        </div>
        <button id="btn-run-qa" class="tool-btn" style="width: 100%; font-size: 11px; padding: 4px;">
          重新执行 QA 诊断
        </button>
      </div>

      <!-- 超标与空层位异常清单 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">
          异常诊断列表 (${summary.violations_over.length} 超标 / ${summary.empty_horizons.length} 空层)
        </div>
        <div id="qa-exceptions-container" style="max-height: 120px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); font-size: 10px; font-family: monospace;">
          ${renderExceptionsHtml(summary)}
        </div>
      </div>

      <!-- 单列超刻度诊断 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">单列刻度上限诊断</div>
        <div id="qa-column-peaks-container" style="max-height: 100px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); font-size: 10px;">
          ${renderColumnPeaksHtml(summary)}
        </div>
      </div>

      <!-- 终点操作按钮 -->
      <button id="btn-qa-export" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px; font-weight: 700;">
        ${t('step8.directExport')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  const updateDomWithSummary = (summary: QaSummary) => {
    latestSummary = summary;
    const { bannerLevel, bannerText, bannerColor } = computeBannerMeta(summary);

    const banner = root.querySelector('#qa-banner');
    if (banner) {
      banner.setAttribute('data-level', bannerLevel);
      banner.className = `qa-banner banner-${bannerLevel}`;
      banner.textContent = bannerText;
      banner.setAttribute('style', `padding: 8px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 12px; ${bannerColor}`);
    }

    const nHorizons = root.querySelector('#qa-n-horizons');
    if (nHorizons) nHorizons.textContent = String(summary.n_horizons);

    const sumMax = root.querySelector('#qa-sum-max');
    if (sumMax) sumMax.textContent = Number(summary.sum.max).toFixed(1);

    const shortfall = root.querySelector('#qa-shortfall-mean');
    if (shortfall) shortfall.textContent = Number(summary.shortfall.mean).toFixed(1);

    const nEmpty = root.querySelector('#qa-n-empty');
    if (nEmpty) nEmpty.textContent = String(summary.n_horizons_empty);

    const exceptionsEl = root.querySelector('#qa-exceptions-container');
    if (exceptionsEl) exceptionsEl.innerHTML = renderExceptionsHtml(summary);

    const peaksEl = root.querySelector('#qa-column-peaks-container');
    if (peaksEl) peaksEl.innerHTML = renderColumnPeaksHtml(summary);
  };

  /** 失败必须让用户看见：把面板自带的 banner 切成红色错误态，并留一条 console.error 取证。 */
  const reportFailure = (err: unknown) => {
    const message = (err as Error)?.message || String(err);
    const banner = root.querySelector('#qa-banner');
    if (banner) {
      banner.setAttribute('data-level', 'red');
      banner.className = 'qa-banner banner-red';
      banner.textContent = `QA 汇总失败：${message}`;
      banner.setAttribute(
        'style',
        `padding: 8px 10px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-bottom: 12px; ${BANNER_RED_STYLE}`
      );
    }
    console.error('[QA] qa.summarize 失败:', err);
  };

  const triggerSummarize = async () => {
    const inpTol = root.querySelector('#qa-inp-tolerance') as HTMLInputElement | null;
    const tol = inpTol ? parseFloat(inpTol.value) || 2.0 : currentTolerance;
    currentTolerance = tol;

    const rpc = ctx.rpcClient as RpcClient | undefined;
    if (!rpc) {
      reportFailure(new Error('QA 面板拿不到 RPC 通道（ctx.rpcClient 未注入）'));
      return;
    }

    try {
      const activeRoiId = cachedData?.active_roi_id || cachedData?.rois?.[0]?.id;
      const params: { tolerance: number; roi_id?: string } = { tolerance: tol };
      if (activeRoiId && cachedData?.rois?.some((r) => r.id === activeRoiId)) {
        params.roi_id = activeRoiId;
      }

      // 走共享客户端的唯一通路。曾经这里自己拼 JSON-RPC 信封 + 裸 fetch，并写成
      // `if (response.ok) { if (json.result) ... }` —— 本后端的应用级错误是
      // `HTTP 200 + body.error`，于是 `response.ok` 为真、`json.result` 为空，
      // 每一个后端错误都被静默吞掉（连 console.warn 都没有）。
      const summary = await rpc.call<typeof params, QaSummary>('qa.summarize', params);
      if (!summary || typeof summary !== 'object') {
        // 不补默认值、不假装成功：缺字段就是契约不符。
        throw new Error('qa.summarize 未返回汇总对象（违反契约）');
      }
      updateDomWithSummary(summary);
      ctx.onDataChange?.();
    } catch (err) {
      reportFailure(err);
    }
  };

  root.querySelector('#btn-run-qa')?.addEventListener('click', () => {
    triggerSummarize();
  });

  root.querySelector('#qa-inp-tolerance')?.addEventListener('change', () => {
    triggerSummarize();
  });

  root.querySelector('#btn-qa-export')?.addEventListener('click', () => {
    const topbarExportBtn = document.querySelector('#btn-export-csv, #btn-export, [title*="导出"], [title*="Export"]') as HTMLButtonElement | null;
    if (topbarExportBtn) {
      topbarExportBtn.click();
    } else if (ctx.onOpenDataViewer) {
      ctx.onOpenDataViewer();
    }
  });

  // 挂载时触发一次异步拉取更新诊断数据
  triggerSummarize();
}
