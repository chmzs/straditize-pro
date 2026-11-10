import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { RpcClient } from '../../services/RpcClient';
import {
  aggregateHeadline,
  aggregateQaScope,
  type QaAggregate,
  type QaScopePart,
  type QaScopeSkip,
} from '../../core/qaVerdict';

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

// 缓存最近一次的 QA 诊断结果（**聚合**：所有有列分区）
let latestAggregate: QaAggregate | null = null;
/**
 * 上一次**已完成**聚合的指纹（容差 + 各分区 id/列数 + 层位数）。
 * 相同 ⇒ 不重复请求后端：这既打断重挂循环，也修掉"进一次步骤 8 连发 3 条
 * 完全相同的 `qa.summarize`"（实测 id 24/25/26）。
 */
let latestAggregateKey: string | null = null;
let currentTolerance = 2.0;
/**
 * 正在飞行中的指纹。**必须同步写入**（在第一个 `await` 之前）：
 * 步骤 8 进入时 `mount()` 会被调用不止一次（`gotoStage` 一次 + Inspector 重渲染一次），
 * 两次都在 `latestAggregateKey` 还是旧值时通过"缓存未命中"判断，于是同一份状态
 * 被完整请求两遍——实测 2 个有列分区 → 4 条 `qa.summarize`。
 * 这是并发竞态，不是"进入次数过多"，所以修法是把指纹提前占位，而不是 debounce。
 */
let inflightKey: string | null = null;
let cachedData: DiagramData | null = null;

/** 红色 banner 的内联样式。正常路径与「后端失败」路径共用，避免两处各写一份。 */
const BANNER_RED_STYLE =
  'background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #dc2626;';

/**
 * 横幅样式只按**共享判定**给出的 level 取色。
 * 判定本身（含范围声明）由 `core/qaVerdict.ts::aggregateQaScope` 产出，
 * 面板这里不再自己写阈值——曾经面板与导出模态各有一套，同屏出现一红一绿。
 */
function bannerColorFor(level: string): string {
  if (level === 'red') return BANNER_RED_STYLE;
  if (level === 'yellow') {
    return 'background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #d97706;';
  }
  return 'background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #059669;';
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
    <div style="display: flex; justify-content: space-between; padding: 2px 4px; border-bottom: 1px solid rgba(0,0,0,0.04); ${col.over ? 'color: var(--status-warning); font-weight: 700;' : ''}">
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

/**
 * 把"每个有列分区各自的汇总"摊平成一个视图，供四宫格/列表渲染。
 *
 * 判定与范围**不在这里**：那是 `core/qaVerdict.ts::aggregateQaScope` 的职责，
 * 横幅文案由 `aggregateHeadline()` 给出。这里只做展示层的合并。
 */
function mergedView(agg: QaAggregate): QaSummary {
  const parts = agg.parts;
  return {
    roi_id: parts.map((p) => p.roiId).join('+') || 'none',
    roi_name: parts.map((p) => p.roiName).join(', '),
    composition: true,
    n_horizons: agg.nHorizons,
    n_horizons_with_data: agg.nChecked,
    n_horizons_empty: agg.nHorizonsEmpty,
    empty_horizons: parts.flatMap((p) => p.summary.empty_horizons ?? []),
    sum: { min: 0.0, p50: 0.0, max: agg.maxSum ?? 0.0, mean: 0.0 },
    tolerance: currentTolerance,
    violations_over: parts.flatMap((p) => p.summary.violations_over as QaHorizonSummary[]),
    shortfall: { min: 0.0, max: 0.0, mean: agg.shortfallMean ?? 0.0 },
    per_column_max: parts.flatMap((p) => p.summary.per_column_max ?? []),
    n_uncalibrated: agg.nUncalibrated,
    uncalibrated_columns: [],
  };
}

export function render(data: DiagramData): string {
  cachedData = data;
  const agg = latestAggregate;
  const summary: QaSummary = agg
    ? mergedView(agg)
    : {
        roi_id: 'none',
        roi_name: '',
        composition: true,
        n_horizons: 0,
        n_horizons_with_data: 0,
        n_horizons_empty: 0,
        empty_horizons: [],
        sum: { min: 0.0, p50: 0.0, max: 0.0, mean: 0.0 },
        tolerance: currentTolerance,
        violations_over: [],
        shortfall: { min: 0.0, max: 0.0, mean: 0.0 },
        per_column_max: [],
      };

  const bannerLevel = agg?.level ?? 'yellow';
  const bannerText = agg ? aggregateHeadline(agg) : '正在聚合各分区的校验结果…';
  const bannerColor = bannerColorFor(bannerLevel);

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
        <button id="btn-run-qa" class="ui-btn ui-btn--quiet ui-btn--xs" style="width: 100%; font-size: 11px; padding: 4px;">
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
  const updateDomWithAggregate = (agg: QaAggregate) => {
    latestAggregate = agg;
    const summary = mergedView(agg);
    const bannerLevel = agg.level;
    const bannerText = aggregateHeadline(agg);
    const bannerColor = bannerColorFor(bannerLevel);

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
      // **所有"有列"的分区都要算**，不是只有 active 那个。
      // 实测缺陷：active=roi_2（干净）时横幅判"通过"，而 roi_1 的 788 个超标
      // 层位一颗没算；把 active 换成 roi_1 又变成 808 层——门禁结论取决于当前选中谁。
      const rois = cachedData?.rois ?? [];
      const columns = cachedData?.columns ?? [];
      const scored = rois.map((r) => {
        const roiId = String(r.id ?? '');
        return { roiId, roiName: r.name || roiId, columnCount: columns.filter((c) => c.roi_id === roiId).length };
      });
      const checked = scored.filter((s) => s.columnCount > 0);
      const skipped: QaScopeSkip[] = scored
        .filter((s) => s.columnCount === 0)
        .map((s) => ({ roiId: s.roiId, roiName: s.roiName }));

      const key = JSON.stringify({
        tol,
        scope: checked.map((s) => [s.roiId, s.columnCount]),
        samples: cachedData?.samples?.length ?? 0,
      });
      if (key === latestAggregateKey && latestAggregate) {
        // 同一份状态：只重绘，不再打后端（修掉"进一次步骤 8 连发 3 条相同请求"）。
        updateDomWithAggregate(latestAggregate);
        return;
      }
      if (key === inflightKey) {
        // 同一份状态的另一次挂载已经在请求中：让它去完成并触发重绘，这里不再发一轮。
        return;
      }
      inflightKey = key;

      const parts: QaScopePart[] = [];
      for (const { roiId, roiName, columnCount } of checked) {
        const params = { tolerance: tol, roi_id: roiId };
        // 走共享客户端的唯一通路。曾经这里自己拼 JSON-RPC 信封 + 裸 fetch，并写成
        // `if (response.ok) { if (json.result) ... }` —— 本后端的应用级错误是
        // `HTTP 200 + body.error`，于是 `response.ok` 为真、`json.result` 为空，
        // 每一个后端错误都被静默吞掉（连 console.warn 都没有）。
        const summary = await rpc.call<typeof params, QaSummary>('qa.summarize', params);
        if (!summary || typeof summary !== 'object') {
          // 不补默认值、不假装成功：缺字段就是契约不符。
          throw new Error(`qa.summarize 未返回汇总对象（违反契约）：分区 ${roiId}`);
        }
        parts.push({ roiId, roiName, columnCount, summary });
      }

      const agg = aggregateQaScope(parts, skipped, tol);
      latestAggregateKey = key;
      updateDomWithAggregate(agg);
      // 这里**不能**每次无条件 `ctx.onDataChange?.()`：它会 `Inspector.render()`
      // 整块重写 innerHTML → 本面板重新 mount → 再 summarize → 再 onDataChange ……
      // 形成无限重挂循环（实测：步骤 8 的按钮每 16ms 被换掉，永远点不中）。
      // 指纹已在上文更新，重挂时走缓存分支，循环自然终止。
      ctx.onDataChange?.();
    } catch (err) {
      reportFailure(err);
    } finally {
      inflightKey = null;
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
