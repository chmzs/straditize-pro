import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';

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
}

// 缓存最近一次的 QA 诊断结果
let latestSummary: QaSummary | null = null;
let currentTolerance = 2.0;
let cachedData: DiagramData | null = null;

function computeBannerMeta(summary: QaSummary) {
  let bannerLevel = 'green';
  let bannerText = '🟢 地学校验门禁通过，数据符合规律';
  if (summary.violations_over && summary.violations_over.length > 0) {
    bannerLevel = 'red';
    bannerText = `🔴 组分总和超标报警 (发现 ${summary.violations_over.length} 个层位总和 > 100%+${summary.tolerance}%)`;
  } else if (summary.per_column_max && summary.per_column_max.some((c) => c.over)) {
    bannerLevel = 'yellow';
    const overCount = summary.per_column_max.filter((c) => c.over).length;
    bannerText = `🟡 单列峰值超刻度警告 (发现 ${overCount} 列峰值超出声明满刻度)`;
  }

  const bannerColor =
    bannerLevel === 'red'
      ? 'background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; color: #dc2626;'
      : bannerLevel === 'yellow'
      ? 'background: rgba(245, 158, 11, 0.15); border: 1px solid #f59e0b; color: #d97706;'
      : 'background: rgba(16, 185, 129, 0.15); border: 1px solid #10b981; color: #059669;';

  return { bannerLevel, bannerText, bannerColor };
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
      <div class="step-title">8. 地学校验与质量诊断 (QA)</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 10px; line-height: 1.4;">
        执行全剖面组分总和门禁（≤100%）、空层位排查与单列满刻度一致性诊断。
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
            <div style="font-size: 14px; font-weight: 700; color: ${summary.n_horizons_empty > 0 ? '#f59e0b' : 'inherit'};">
              <span id="qa-n-empty">${summary.n_horizons_empty}</span>
            </div>
          </div>
          <div style="background: var(--bg-tertiary); padding: 6px 8px; border-radius: 4px;">
            <div style="font-size: 10px; color: var(--text-muted);">最大总和 (SUM_MAX)</div>
            <div style="font-size: 14px; font-weight: 700; color: ${summary.sum.max > 100 + summary.tolerance ? '#ef4444' : 'inherit'};">
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
          🔄 重新执行 QA 诊断
        </button>
      </div>

      <!-- 超标与空层位异常清单 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">
          异常诊断列表 (${summary.violations_over.length} 超标 / ${summary.empty_horizons.length} 空层)
        </div>
        <div id="qa-exceptions-container" style="max-height: 120px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); font-size: 10px; font-family: monospace;">
          ${
            summary.violations_over.length === 0 && summary.empty_horizons.length === 0
              ? '<div style="color: var(--text-muted); text-align: center; padding: 8px; font-family: sans-serif;">未发现超标层位与空层位，指标正常</div>'
              : `
              ${summary.violations_over
                .map(
                  (v) => `
                <div style="display: flex; justify-content: space-between; padding: 2px 4px; color: #ef4444; border-bottom: 1px solid rgba(0,0,0,0.04);">
                  <span>⚠️ 超标 深度: ${v.depth !== null ? `${v.depth}` : '[未标定]'}</span>
                  <span>Σ = <strong>${v.sum}%</strong></span>
                </div>
              `
                )
                .join('')}
              ${summary.empty_horizons
                .map(
                  (e) => `
                <div style="display: flex; justify-content: space-between; padding: 2px 4px; color: #f59e0b; border-bottom: 1px solid rgba(0,0,0,0.04);">
                  <span>⚪ 空层 深度: ${e.depth !== null ? `${e.depth}` : '[未标定]'}</span>
                  <span>${e.reason || 'no ink read'}</span>
                </div>
              `
                )
                .join('')}
            `
          }
        </div>
      </div>

      <!-- 单列超刻度诊断 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">单列刻度上限诊断</div>
        <div id="qa-column-peaks-container" style="max-height: 100px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); font-size: 10px;">
          ${
            summary.per_column_max.length === 0
              ? '<div style="color: var(--text-muted); text-align: center; padding: 8px;">暂无列刻度信息</div>'
              : summary.per_column_max
                  .map(
                    (col) => `
                <div style="display: flex; justify-content: space-between; padding: 2px 4px; border-bottom: 1px solid rgba(0,0,0,0.04); ${col.over ? 'color: #d97706; font-weight: 700;' : ''}">
                  <span>${col.name}</span>
                  <span>峰值: ${col.peak} / 标度: ${col.declared_max} ${col.over ? '🚨 超刻度' : '✓'}</span>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </div>

      <!-- 终点操作按钮 -->
      <button id="btn-qa-export" class="primary-btn" style="width: 100%; padding: 6px 12px; font-size: 12px;">
        💾 确认校验结果，前往顶栏导出
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
  };

  const triggerSummarize = async () => {
    const inpTol = root.querySelector('#qa-inp-tolerance') as HTMLInputElement | null;
    const tol = inpTol ? parseFloat(inpTol.value) || 2.0 : currentTolerance;
    currentTolerance = tol;

    try {
      const activeRoiId = cachedData?.active_roi_id || cachedData?.rois?.[0]?.id;
      const endpoint = typeof window !== 'undefined' && window.location.origin ? `${window.location.origin}/rpc` : 'http://127.0.0.1:8765/rpc';
      const params: Record<string, any> = { tolerance: tol };
      if (activeRoiId && cachedData?.rois?.some((r) => r.id === activeRoiId)) {
        params.roi_id = activeRoiId;
      }

      const payload = {
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'qa.summarize',
        params,
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const json = await response.json();
        if (json.result) {
          updateDomWithSummary(json.result as QaSummary);
          ctx.onDataChange?.();
        }
      }
    } catch (err) {
      console.warn('[QA] Failed to execute qa.summarize RPC:', err);
    }
  };

  root.querySelector('#btn-run-qa')?.addEventListener('click', () => {
    triggerSummarize();
  });

  root.querySelector('#qa-inp-tolerance')?.addEventListener('change', () => {
    triggerSummarize();
  });

  root.querySelector('#btn-qa-export')?.addEventListener('click', () => {
    const topbarExportBtn = document.querySelector('#btn-export-csv, #btn-export, [title*="导出"]') as HTMLButtonElement | null;
    if (topbarExportBtn) {
      topbarExportBtn.click();
    } else {
      alert('地学校验已确认完成！请点击顶栏【导出】按钮下载数据产物。');
    }
  });

  // 挂载时触发一次异步拉取更新诊断数据
  triggerSummarize();
}
