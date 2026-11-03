import { DiagramData, ColumnGroup } from '../../types/pollen';
import type { RulerGeometry } from '../../types/ruler';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notify, notifyError, describeError } from '../../ui/feedback';
import { columnPick, beginColumnPick, resetColumnPick } from './columnPick';
import {
  detectedSpans,
  describeRulerDetection,
  maxDetectedSpan,
} from './rulerSpan';
import {
  callStepCallback,
  renderActiveColumnLostNotice,
  renderOtherLostColumnsSummary,
  syncXTicksDroppedFromBackend,
} from './XTicksDroppedNotice';
import { renderOtherSuspectColumnsSummary } from './SuspectBlockNotice';

export const step = 6;
export const title = '6. 标定列与 X 刻度';

let cachedData: DiagramData | null = null;
let selectedGroupId: string | null = null;

/** 标定态下画布点选的齿：像素 + 它距该列 0 点的距离。null = 尚未选。 */
let pendingTick: { px: number; dist: number } | null = null;

/** 画布点选刻度齿的回调（main.ts 注册）。判定"距 0 点多少"在这里做，
 *  因为 0 点依赖当前列的几何，画布不该知道这些。 */
let onTickPickedExternal: ((pt: { x: number; y: number }) => void) | null = null;
export function setTickPickedHandler(
  fn: ((pt: { x: number; y: number }) => void) | null
): void {
  onTickPickedExternal = fn;
}

/** 画布点选刻度齿时由 main.ts 调用。 */
export function handleTickPicked(pt: { x: number; y: number }): void {
  onTickPickedExternal?.(pt);
}
let isBatchAssignOpen = false;

/**
 * 最近一次 `algorithm.measureRuler` 的结果。
 *
 * 缓存键 `rulerGeoKey` 由「ROI + 图片 + 列几何」组成：数据变了（重新分列、换图、
 * 换 ROI）就必须重测，否则面板会拿着上一张图的刻距当默认值 —— 那正是"默认值
 * 与真实刻距无关"这类缺陷最容易复发的地方。同一张图上重复渲染（切组、改名）
 * 键不变，直接复用，不会每次都打后端。
 */
let rulerGeo: RulerGeometry | null = null;
let rulerGeoError: string | null = null;
let rulerGeoKey: string | null = null;
let rulerGeoPending = false;
/** `render` 算出的逐列检测跨度，供按钮应用时复用（同一帧内有效）。 */
/**
 * 「末齿读数」输入草稿（按组 id）。
 *
 * 面板会被后台刷新重渲染（几何检测回包、自动存档、画布交互都会走 `onDataChange`），
 * 输入值只活 DOM 里就会被清空——用户填了数、界面自己擦掉，是最难察觉的一类数据丢失。

const manualTickDrafts = new Map<string, { v1: string; v2: string }>();


/**
 * 用户显式给的轴线粗细（px，图级）。`null` = 让后端自动估。
 *
 * 为什么需要这个覆盖：后端自动估计取「每行从轴线起连续暗 run 的最小值」，
 * 在「整列每层都有花粉」的列上必然高估（最薄行仍带基部填充），而它把结果夹在
 * 1–6px，高 DPI 图的粗轴会被截断（600 dpi 的 1 pt 线 ≈ 8px）。
 * 实测 beginner 同一张图四列就估出 4/6/6/6 两种值。
 */
let axisStrokeOverride: number | null = null;


/**
 * 几何检测的缓存键：ROI + 图片 + 本 ROI 内每列的像素范围。
 *
 * 任何一项变了都必须重测。列几何用整数像素，避免浮点抖动造成假失效。
 */
function rulerGeoKeyFor(data: DiagramData, roiId: string | null): string {
  const cols = (data.columns || []).filter((c) => !roiId || !c.roi_id || c.roi_id === roiId);
  const geom = cols
    .map((c) => `${c.col_index ?? '?'}:${Math.round(c.startX)}:${Math.round(c.endX)}`)
    .join('|');
  return `${roiId ?? ''}#${data.imageWidth}x${data.imageHeight}#${(data.imageSrc || '').length}#${geom}#stroke${axisStrokeOverride ?? ''}`;
}

/**
 * 拉取本 ROI 的刻线几何（`algorithm.measureRuler`，只读）。
 *
 * 三条纪律：
 * 1. **失败必须冒泡**：`notifyError` + 面板显示错误原文，绝不把"检测失败"演成
 *    "检测到 0 条刻线"；ΔX 退回占位值时文案也明说"必须手工校准"。
 * 2. **结果按数据签名缓存**：同一张图重复渲染不重复打后端；换图/重分列/换 ROI
 *    即失效重测（否则会拿着上一张图的刻距当默认值）。
 * 3. **失败也缓存**，避免"错误 → onDataChange → 再请求 → 再错误"的死循环；
 *    用户在错误框里点【重新检测】才清缓存重试。
 */
/**
 * 把检测结果**就地**写进已渲染的两行，而不是整块重渲染。
 *
 * 为什么：`ensureRulerGeometry` 是异步的，用户在它返回前可能已经开始填写
 * 「每根齿单位数」或单列刻度；整块重渲染会把 `innerHTML` 换掉，未提交的输入当场消失
 * （step3 的同类问题已记录在 `docs/testing-strategy.md` §9）。实测后果：
 * `step6-xticks T7` 偶发红——填完值、检测返回、输入被冲掉，保存写的是旧值。
 */
function patchRulerDom(root: HTMLElement): void {
  const geo = rulerGeo;
  const line = root.querySelector('[data-role="ruler-detect"]') as HTMLElement | null;
  const spanEl = root.querySelector('[data-role="ruler-span"]') as HTMLElement | null;

  const spans = detectedSpans(cachedData?.columns ?? [], geo);
  const rigidSpan = maxDetectedSpan(spans);

  if (line) {
    line.textContent = describeRulerDetection(geo, rulerGeoError, rulerGeoPending);
    line.setAttribute('data-detected-columns', String((geo?.per_column ?? []).length));
    line.setAttribute(
      'data-spacing',
      geo?.median_spacing_px != null ? String(geo.median_spacing_px) : ''
    );
    line.setAttribute(
      'data-regular',
      geo?.all_regular === null || geo?.all_regular === undefined
        ? ''
        : String(geo.all_regular)
    );
    line.setAttribute('data-span', rigidSpan == null ? '' : String(rigidSpan));
    line.style.color = rulerGeoError ? 'var(--accent-red)' : 'var(--text-secondary)';
  }
  if (spanEl) {
    spanEl.textContent =
      rigidSpan == null
        ? '刻距 —（需先检测到刻度尺）'
        : `刻距 ${geo?.median_spacing_px ?? '—'}px（自动检测）`;
    spanEl.setAttribute('data-span', rigidSpan == null ? '' : String(rigidSpan));
  }
}

async function ensureRulerGeometry(ctx: StepContext, root: HTMLElement): Promise<void> {
  const data = cachedData;
  if (!data) return;
  const roiId = data.active_roi_id || data.rois?.[0]?.id || null;
  const key = rulerGeoKeyFor(data, roiId);
  if (rulerGeoPending) return;
  if (rulerGeoKey === key && (rulerGeo != null || rulerGeoError != null)) return;

  const client = ctx.rpcClient as
    | {
        measureRuler?: (
          roiId?: string,
          axisStroke?: number | null
        ) => Promise<RulerGeometry>;
      }
    | undefined;
  if (!client?.measureRuler) {
    rulerGeo = null;
    rulerGeoError = '前端 RpcClient 缺少 measureRuler：前后端契约不一致';
    rulerGeoKey = key;
    notifyError(`刻度几何检测失败：${rulerGeoError}`);
    patchRulerDom(root);
    return;
  }

  rulerGeoPending = true;
  try {
    rulerGeo = await client.measureRuler(roiId ?? undefined, axisStrokeOverride);
    rulerGeoError = null;
  } catch (err) {
    rulerGeo = null;
    rulerGeoError = describeError(err);
    notifyError(`刻度几何检测失败：${rulerGeoError}`);
  } finally {
    rulerGeoPending = false;
    rulerGeoKey = key;
  }
  patchRulerDom(root);
}

export function render(data: DiagramData): string {
  cachedData = data;
  const cols = data.columns || [];
  if (cols.length === 0) {
    return `
      <div class="step-panel" data-step="6">
        <div class="step-title">${t('step6.title')}</div>
        <div class="inspector-section" style="padding: 24px 16px; background: var(--bg-tertiary); border-radius: 8px; text-align: center; border: 1px solid var(--border-color); margin-top: 12px;">
          <div style="font-size: 13px; font-weight: 700; color: var(--text-heading); margin-bottom: 6px;">${t('step6.noColsTitle')}</div>
          <p style="font-size: 11px; line-height: 1.6; color: var(--text-secondary); margin: 0 0 16px 0;">
            ${t('step6.noColsDesc')}
          </p>
          <button id="btn-goto-step5-split" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
            ${t('step6.gotoStep5')}
          </button>
        </div>
      </div>
    `;
  }

  const activeCol = cols.find((c) => c.id === data.activeTaxaId) || cols[0];

  const totalCols = cols.length;
  const calibratedCols = cols.filter((c) => c.x_ticks && c.x_ticks.length === 2).length;
  const pct = Math.round((calibratedCols / totalCols) * 100);

  // 解析当前 ROI 与分组结构
  const activeRoi =
    data.rois?.find((r) => r.id === (activeCol?.roi_id || data.active_roi_id || data.rois[0]?.id)) ||
    data.rois?.[0];

  // 保证至少有一个默认组
  const defGrpId = activeRoi?.default_group_id || `${activeRoi?.id || 'roi_1'}_grp1`;
  if (activeRoi && (!activeRoi.x_groups || activeRoi.x_groups.length === 0)) {
    activeRoi.x_groups = [
      {
        id: defGrpId,
        name: '默认组 (花粉%)',
        unit: '%',
        plot_type: 'area',
        scale_type: 'linear',
        exaggeration_mult: null,
        tick_layout: [{ rel: 0.0 }, { rel: 1.0 }],
        // 故意**不**预置 ref_span_px：这里曾写死 40.0，于是"组默认模数"永远压过
        // 真实检测值，面板显示 40px 而图上刻距是 124.5px。留空才能让检测值生效。
        // 同理不预置 ref_val_start/end（旧值是 0/20）：读数只能由用户从图上读出。
      },
    ];
    activeRoi.default_group_id = defGrpId;
  }
  const groups: ColumnGroup[] = activeRoi?.x_groups || [];

  // 当前选中的组 Tab (优先使用用户显式切换的组，否则用活动列的组)
  const currentGroupId =
    selectedGroupId && groups.some((g) => g.id === selectedGroupId)
      ? selectedGroupId
      : activeCol?.x_group_id || activeRoi?.default_group_id || groups[0]?.id;
  selectedGroupId = currentGroupId;

  const currentGroup = groups.find((g) => g.id === currentGroupId) || groups[0];

  // 统计各组包含的列
  const groupCols = cols.filter((c) => (c.x_group_id || activeRoi?.default_group_id) === currentGroupId);

  // 刻线几何：只对**本 ROI** 的列测（后端按 roi_id 过滤，这里必须同口径，否则错位）。
  const roiCols = cols.filter((c) => !activeRoi?.id || !c.roi_id || c.roi_id === activeRoi.id);
  const geoKey = rulerGeoKeyFor(data, activeRoi?.id ?? null);
  const geo = rulerGeoKey === geoKey ? rulerGeo : null;
  const geoError = rulerGeoKey === geoKey ? rulerGeoError : null;
  const geoPending = rulerGeoPending || (!geo && !geoError);
  const spans = detectedSpans(roiCols, geo);
  const rigidSpan = maxDetectedSpan(spans);
  const groupUnit = currentGroup?.unit || '%';
  const rulerLine = describeRulerDetection(geo, geoError, geoPending);
  // 0 点是**实测轴线右缘**，不是列切分给的 startX：后者实测可偏离轴线 6–20px。
  // 面板显示的像素必须与实际标定用的是同一个数，否则用户照着它校正会自造偏差。

  const activeLostNotice = activeCol ? renderActiveColumnLostNotice(activeCol) : '';
  const otherLostSummary = renderOtherLostColumnsSummary(cols, activeCol?.id);
  const otherSuspectSummary = renderOtherSuspectColumnsSummary(cols, activeCol?.id);

  return `
    <div class="step-panel" data-step="6">
      <div class="step-title">${t('step6.title')}</div>

      ${activeLostNotice}
      ${otherSuspectSummary}
      ${otherLostSummary}

      <!-- 全局标定进度指示 -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px; font-size: 11px;">
        <span style="color: var(--text-secondary); font-weight: 500;">${t('step6.progress')}</span>
        <span style="font-weight: 700; color: ${calibratedCols === totalCols ? 'var(--status-success)' : 'var(--accent-blue)'};">
          ${calibratedCols} / ${totalCols} 列 (${pct}%)
        </span>
      </div>

      <!-- 模块 1：列组看板与多指标管理 (X-Groups) -->
      <div class="inspector-section" style="padding: 10px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 11.5px; font-weight: 700; color: var(--text-heading);">列组看板 (按单位/量程分治)</span>
          <div style="display: flex; gap: 4px;">
            <button id="btn-create-new-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 1px 6px; color: var(--accent-blue);" title="新建一个列组：点它之后在图上点选属于该组的属种列（Shift 连选），其余列自动留在默认组">+ 分组</button>
            ${groups.length > 1 && currentGroupId !== activeRoi?.default_group_id ? `<button id="btn-delete-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 1px 6px; color: var(--accent-red);" title="删除当前列组：组内列自动回到默认组">删除本组</button>` : ''}
            ${groups.length > 1 ? `<button id="btn-merge-groups" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 1px 6px;" title="合并形态标度完全一致的组">合并同类组</button>` : ''}
          </div>
        </div>

        <!-- 组 Tab 选择器 -->
        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
          ${groups
            .map((g) => {
              const isSelected = g.id === currentGroupId;
              const gCols = cols.filter((c) => (c.x_group_id || activeRoi?.default_group_id) === g.id);
              const gCalibrated = gCols.filter((c) => c.x_ticks && c.x_ticks.length === 2).length;
              const isFullCalib = gCols.length > 0 && gCalibrated === gCols.length;
              return `
                <button
                  type="button"
                  class="btn-switch-group-tab ui-btn ${isSelected ? 'ui-btn--primary' : 'ui-btn--quiet'}"
                  data-group-id="${g.id}"
                  style="font-size: 10.5px; padding: 3px 8px; border-radius: 4px; display: flex; align-items: center; gap: 4px; border: 1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-color)'};"
                >
                  <span>${g.name}</span>
                  <span style="font-size: 9.5px; opacity: 0.85; background: rgba(0,0,0,0.15); padding: 0 4px; border-radius: 3px;">${gCols.length}列</span>
                  <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${isFullCalib ? 'var(--status-success)' : 'var(--status-warning)'};" title="${isFullCalib ? '组内所有列已定标' : '待定标或部分定标'}"></span>
                </button>
              `;
            })
            .join('')}
        </div>

        <!-- 当前选中组属性与操作卡片 -->
        <div style="background: var(--bg-card); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 11px;">
            <div style="color: var(--text-primary); font-weight: 600;">
              当前组: <span style="color: var(--accent-blue);">${currentGroup?.name}</span>
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">
              单位: <strong>${groupUnit}</strong>
            </div>
          </div>

          <!-- 组级参数：图形形态与尺度类型都是**组**的属性（同一组的列共用），
               所以编辑入口只在这里，列属性面板不再重复。 -->
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 6px; font-size: 10px;">
            <span style="color: var(--text-muted);">形态:</span>
            ${(['area', 'bar', 'line', 'symbol'] as const)
              .map(
                (t) =>
                  `<button class="ui-btn ui-btn--quiet ui-btn--xs grp-plottype-btn ${
                    currentGroup?.plot_type === t ? 'active-mode' : ''
                  }" data-plottype="${t}" style="padding: 1px 7px; font-size: 9.5px;">${
                    t === 'area' ? '面积' : t === 'bar' ? '柱状' : t === 'line' ? '折线' : '符号'
                  }</button>`
              )
              .join('')}
            <span style="color: var(--text-muted); margin-left: 6px;">尺度:</span>
            ${(['linear', 'log'] as const)
              .map(
                (t) =>
                  `<button class="ui-btn ui-btn--quiet ui-btn--xs grp-scaletype-btn ${
                    currentGroup?.scale_type === t ? 'active-mode' : ''
                  }" data-scaletype="${t}" style="padding: 1px 7px; font-size: 9.5px;">${
                    t === 'linear' ? '线性' : '对数'
                  }</button>`
              )
              .join('')}
          </div>

          <!-- 组内属种与批量划组管理 -->
          ${
            columnPick.active
              ? `
          <div id="column-pick-bar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; margin-bottom: 6px; border: 1px solid var(--accent-blue); border-radius: 4px; background: var(--bg-tertiary);">
            <span style="flex: 1 1 100%; font-size: 10px; color: var(--accent-blue); font-weight: 600;">在图上点击属种列（Shift 连选）</span>
            <span style="font-size: 10px; color: var(--text-secondary);">已选 ${columnPick.ids.length} 列</span>
            <button type="button" id="btn-confirm-column-pick" class="ui-btn ui-btn--primary ui-btn--xs" style="font-size: 10px; padding: 2px 10px; margin-left: auto;" ${columnPick.ids.length === 0 ? 'disabled' : ''}>确认成组</button>
            <button type="button" id="btn-cancel-column-pick" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 2px 10px;">取消</button>
          </div>`
              : ''
          }
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px;">
            <span style="font-size: 10px; color: var(--text-secondary);">包含 ${groupCols.length} 个属种列:</span>
            <button id="btn-toggle-batch-assign" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 9.5px; padding: 1px 6px;">
              ${isBatchAssignOpen ? '收起归组列表 ▲' : '批量调整属种归组 ▼'}
            </button>
          </div>

          <!-- 批量归组抽屉面板 -->
          ${
            isBatchAssignOpen
              ? `
            <div id="drawer-batch-assign" style="background: var(--bg-tertiary); border: 1px dashed var(--border-color); border-radius: 4px; padding: 6px 8px; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 5px;">
                <span style="font-size: 9.5px; color: var(--text-muted);">勾选属种，Shift+点击可连选：</span>
                <button type="button" id="btn-group-select-all" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 9px; padding: 0 5px; margin-left: auto;">全选</button>
                <button type="button" id="btn-group-select-none" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 9px; padding: 0 5px;">全不选</button>
              </div>
              <div id="group-col-checklist" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 3px; background: var(--bg-card);">
                ${cols
                  .map((c, i) => {
                    const gid = c.x_group_id || activeRoi?.default_group_id;
                    const inThis = gid === currentGroupId;
                    const gname = (groups.find((g) => g.id === gid)?.name) || '默认组';
                    return `
                      <label class="group-col-row" style="display: flex; align-items: center; gap: 5px; padding: 2px 5px; font-size: 10px; cursor: pointer; border-bottom: 1px solid var(--border-color);">
                        <input type="checkbox" class="group-col-check" data-col-id="${c.id}" data-idx="${i}" ${inThis ? 'checked' : ''} style="margin: 0;" />
                        <span style="flex: 1; color: var(--text-primary);">${c.name}</span>
                        <span style="font-size: 9px; color: ${inThis ? 'var(--status-success)' : 'var(--text-muted)'};">${gname}</span>
                      </label>
                    `;
                  })
                  .join('')}
              </div>
              <div style="display: flex; gap: 5px; margin-top: 5px;">
                <button type="button" id="btn-assign-selected-to-group" class="ui-btn ui-btn--primary ui-btn--xs" style="flex: 1; font-size: 10px; padding: 4px;">划入【${currentGroup?.name}】</button>
                <button type="button" id="btn-remove-selected-from-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="flex: 1; font-size: 10px; padding: 4px;">移回默认组</button>
              </div>
            </div>
          `
              : ''
          }
        </div>

        <!-- 参考标尺：一行检测结果 + 一个读数 + 一个按钮 -->
        <div style="background: var(--bg-card); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--accent-blue); margin-bottom: 6px;">
          <div data-role="ruler-detect" data-detected-columns="${(geo?.per_column ?? []).length}"
               data-spacing="${geo?.median_spacing_px ?? ''}"
               data-regular="${geo?.all_regular === null || geo?.all_regular === undefined ? '' : String(geo?.all_regular)}"
               data-span="${rigidSpan ?? ''}"
               style="font-size: 10.5px; line-height: 1.5; margin-bottom: 6px; color: ${geoError ? 'var(--accent-red)' : 'var(--text-secondary)'};">
            ${rulerLine}
          </div>

          <div data-role="units-per-cell-hint" style="font-size: 9.5px; line-height: 1.4; color: var(--text-muted); margin-bottom: 4px;">
            这个数只能从图上读：<strong>相邻两个数字标签之差</strong>（如标签 10 / 30 → 填 20）。
            标签隔一根齿才标数字时，取差值的一半。软件不替你猜——填错会让全组读数按同一比例偏掉。
          </div>
          <!-- 轴线粗：只影响「0 点 = 左缘 + 轴线粗」这条绿线的位置，与刻度无关 -->
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            <label for="inp-axis-stroke" style="font-size: 10.5px; color: var(--text-muted);">轴线粗细:</label>
            <input type="number" id="inp-axis-stroke" value="${currentGroup && Number(currentGroup.axis_stroke_px) > 0 ? String(Number(currentGroup.axis_stroke_px)) : ''}" placeholder="5" min="1" max="20" step="1"
                   title="Y 轴轴线的描边宽度（像素）。0 点 = 左缘 + 它。填了就不再从像素里猜。"
                   style="width: 66px; font-size: 11px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
            <span style="font-size: 9.5px; color: var(--text-muted);">px（0 点 = 左缘 + 它）</span>
          </div>

          <!-- ── X 轴标定（组级）────────────────────────────────────────
               一次动作定整组：点一个刻度齿 + 填它旁边的数字
               → 斜率 = 数字 / 距0点px。组内所有列共用斜率，每列 0 点各自算。
               不依赖"检测到几个齿"，所以漏齿、齿数不一致都不影响。 -->
          <div data-role="tick-calib" style="border-top: 1px dashed var(--border-color); margin-top: 8px; padding-top: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px;">
              <span style="font-size: 10.5px; font-weight: 600; color: var(--text-secondary);">X 轴标定（本组共用）</span>
              ${
                currentGroup?.value_per_px != null && Number(currentGroup.value_per_px) !== 0
                  ? `<span data-role="slope-readout" style="font-size: 9.5px; color: var(--status-success);">已标定 · ${Number(currentGroup.value_per_px).toFixed(4)} ${groupUnit}/px</span>`
                  : '<span style="font-size: 9.5px; color: var(--status-warning);">未标定</span>'
              }
            </div>
            ${
              pendingTick
                ? `
            <div data-role="pending-tick" style="font-size: 10.5px; line-height: 1.6; margin-bottom: 6px; padding: 6px 8px; background: var(--bg-tertiary); border-radius: 4px;">
              已选齿：<code style="color: var(--accent-blue);">x = ${pendingTick.px}px</code>
              · 距 0 点 <strong>${pendingTick.dist.toFixed(0)}px</strong>
              ${
                pendingTick.dist < 20
                  ? '<div style="color: var(--status-warning); margin-top: 3px;">⚠ 离 0 点太近，±1px 就会让斜率偏几个百分点，建议点更远的齿。</div>'
                  : ''
              }
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <label for="inp-tick-value" style="font-size: 10.5px; color: var(--text-muted);">这个齿的数字:</label>
              <input type="number" id="inp-tick-value" placeholder="如 10"
                     style="width: 72px; font-size: 11px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: 10px; color: var(--text-muted);">${groupUnit}</span>
            </div>
            <div style="display: flex; gap: 6px;">
              <button id="btn-apply-tick-calib" class="ui-btn ui-btn--primary" style="flex: 1; font-size: 11px; padding: 5px 6px;">应用</button>
              <button id="btn-cancel-tick-calib" class="ui-btn ui-btn--quiet" style="font-size: 10px; padding: 5px 8px;">取消</button>
            </div>`
                : `
            <button id="btn-pick-tick" class="ui-btn ui-btn--primary" style="width: 100%; font-size: 11px; padding: 6px;">
              点一个刻度齿
            </button>
            <div style="font-size: 9.5px; line-height: 1.45; color: var(--text-muted); margin-top: 4px;">
              点<strong>离绿线（0 点）最远</strong>的那个带标签的齿更准；点完输入它旁边的数字即可。
            </div>`
            }
          </div>
        </div>
      </div>

      ${
        activeCol?.zero_point_measurable === false
          ? `
      <div class="inspector-section" data-role="zero-point-warning"
           style="padding: 8px 10px; background: rgba(245, 158, 11, 0.12); border: 1px solid var(--status-warning); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; color: var(--status-warning); margin-bottom: 3px;">
          ⚠ 该列 0 点不可自动测量
        </div>
        <div style="font-size: 10px; line-height: 1.45; color: var(--text-secondary);">
          这一列左缘没有贯穿整列的竖轴（可能不是真正的面板，或轴太淡）。
          <strong>0 点 = 左缘 + 轴线粗</strong> 这个公式在这里不成立，所以本列
          <strong>不给数</strong>（导出记 NA）—— 请在下方手动填入 0 点像素，或确认该列是否应删除。
        </div>
      </div>`
          : ''
      }


      <!-- 阶段提交按钮 -->
      <button id="btn-apply-xticks-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step6.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  const activeColumn = () =>
    cachedData?.columns.find((c) => c.id === cachedData?.activeTaxaId) || cachedData?.columns[0];
  const columnIndex = (col: NonNullable<ReturnType<typeof activeColumn>>) =>
    col.col_index ?? cachedData?.columns.indexOf(col) ?? 0;

  const activeRoi = () => {
    const col = activeColumn();
    return (
      cachedData?.rois?.find((r) => r.id === (col?.roi_id || cachedData?.active_roi_id || cachedData?.rois[0]?.id)) ||
      cachedData?.rois?.[0]
    );
  };

  // 组级写入的唯一通路：形态 / 尺度 / 单位刻度长度 / 轴线粗 都是组的属性。
  // **放在所有使用点之前** —— 之前它在 axis-stroke 的 handler 之后，直接引用会撞 TDZ。
  const patchGroup = (field: Record<string, unknown>) => {
    const gid = selectedGroupId;
    const roiId = activeRoi()?.id;
    const client = ctx.rpcClient as
      | { roiGroupUpdate?: (r: string, g: string, p: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    if (!gid || !roiId || !client?.roiGroupUpdate) return;
    void client.roiGroupUpdate(roiId, gid, field).then(() => ctx.onDataChange?.());
  };

  // 画布点选齿 → 记录"距本列 0 点多少"。判定在面板侧，画布只报坐标。
  setTickPickedHandler((pt) => {
    const col = activeColumn();
    if (!col) return;
    const roi = cachedData?.rois?.find((r) => r.id === (col.roi_id ?? cachedData?.active_roi_id));
    const g = roi?.x_groups?.find((x) => x.id === col.x_group_id) ?? roi?.x_groups?.[0];
    const stroke = Number(g?.axis_stroke_px) > 0 ? Number(g?.axis_stroke_px) : 5;
    const start = Number(
      (col as unknown as Record<string, number>).startX ??
        (col as unknown as Record<string, number>).start ??
        0
    );
    const zero = start + stroke;

    // **必须吸附到检测到的刻度齿**：否则用户可以点任意位置，等于绕过了
    // "图上没有刻度尺就不许标定"这条约束（旧「对齐本组」靠"取不到跨度就拒绝"
    // 守的就是它）。吸附容差 6px —— 齿宽 1–2px，6px 足够容人手抖而不误吸邻齿。
    const idx = col.col_index ?? cachedData?.columns.indexOf(col) ?? 0;
    const colGeo = rulerGeo?.per_column?.find((c) => c.col_index === idx);
    const ticks = (colGeo?.ticks ?? []) as number[];
    const SNAP_TOL = 6;
    let nearest: number | null = null;
    for (const t of ticks) {
      if (nearest === null || Math.abs(t - pt.x) < Math.abs(nearest - pt.x)) nearest = t;
    }
    if (nearest === null || Math.abs(nearest - pt.x) > SNAP_TOL) {
      notifyError(
        '此处没有检测到刻度齿。请点在齿上（放大后更准）；若整张图都没有刻度尺，说明该图无法用刻度标定。'
      );
      return;
    }
    pendingTick = { px: Math.round(nearest), dist: nearest - zero };
    ctx.onDataChange?.();
  });

  root.querySelector('#btn-goto-step5-split')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(5);
  });

  root.querySelector('#btn-detect-xticks')?.addEventListener('click', () => {
    ctx.onDetectXTicks?.();
  });

  // 轴线粗细覆盖：用户量一次、全图共用。填了就让后端用「左缘 + 粗细 − 1」定 0 点，
  // 不再从像素里猜（也不受自动估计那套 1–6px 夹取上限的限制）。
  root.querySelector('#inp-axis-stroke')?.addEventListener('change', (e) => {
    const raw = (e.target as HTMLInputElement).value.trim();
    const parsed = raw === '' ? null : Number.parseFloat(raw);
    axisStrokeOverride =
      parsed != null && Number.isFinite(parsed) && parsed > 0
        ? Math.min(parsed, 20)
        : null;
    // 同时落库：绿线「0 点 = 左缘 + 轴线粗」靠它，而 `axisStrokeOverride` 只是前端内存。
    patchGroup({ axis_stroke_px: axisStrokeOverride });
    // 缓存键里含粗细；清空这三项才会真的重测。
    rulerGeo = null;
    rulerGeoError = null;
    rulerGeoKey = null;
    // 重测完成后必须整块重渲染：0 点像素是**渲染时**写进模板的（`px1`），
    // `patchRulerDom` 只就地更新检测那两行，不会更新「像素位置」。
    void ensureRulerGeometry(ctx, root).then(() => {
      ctx.onDataChange?.();
    });
  });

  // 单位刻度长度（cell_px）：标定的几何锚点。刻度位置 = 0 点 + k × 它。
  root.querySelector('#inp-cell-px')?.addEventListener('change', (e) => {
    const raw = (e.target as HTMLInputElement).value.trim();
    const px = raw === '' ? null : Number.parseFloat(raw);
    if (px != null && (!Number.isFinite(px) || px <= 0)) return;
    patchGroup({ ref_span_px: px });
  });
  root.querySelector('#btn-use-detected-span')?.addEventListener('click', () => {
    const px = Number(rulerGeo?.median_spacing_px);
    if (!Number.isFinite(px) || px <= 0) {
      notifyError('还没有检测到刻距，无法填入：请确认图版下方有刻度尺后重试。');
      return;
    }
    patchGroup({ ref_span_px: px });
  });

  // ── X 轴标定（组级）──────────────────────────────────────────────
  // 一次动作定整组：点一个刻度齿 + 填它旁边的数字 → 斜率 = 数字 / 距0点px。
  root.querySelector('#btn-pick-tick')?.addEventListener('click', () => {
    pendingTick = null;
    ctx.onSetToolMode?.('pickTick');
    notify('请在画布上点一个刻度齿（离绿线越远越准）', 'info');
  });
  root.querySelector('#btn-cancel-tick-calib')?.addEventListener('click', () => {
    pendingTick = null;
    ctx.onDataChange?.();
  });
  root.querySelector('#btn-apply-tick-calib')?.addEventListener('click', () => {
    const raw = (root.querySelector('#inp-tick-value') as HTMLInputElement | null)?.value ?? '';
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) {
      notifyError('请填写这个齿代表的数字（图上标签，如 10）。');
      return;
    }
    if (!pendingTick || pendingTick.dist <= 0) {
      notifyError('请先在画布上点一个位于 0 点右侧的刻度齿。');
      return;
    }
    // 斜率 = 值 / 距 0 点像素。0 点 = 左缘 + 轴线粗（见 ARCHITECTURE §6.4）。
    const pickedDist = pendingTick.dist;
    const slope = value / pickedDist;
    patchGroup({ value_per_px: slope });
    pendingTick = null;
    notify(`已按「${value} 对应 ${pickedDist.toFixed(0)}px」标定本组：斜率 ${slope.toFixed(4)}`, 'info');
  });

  root.querySelectorAll('.grp-plottype-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-plottype');
      if (t) patchGroup({ plot_type: t });
    });
  });
  root.querySelectorAll('.grp-scaletype-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.getAttribute('data-scaletype');
      if (t) patchGroup({ scale_type: t });
    });
  });

  // 0. 刻线几何检测：进入本步（以及数据变化后）自动拉一次，只读、不写任何标定。
  void ensureRulerGeometry(ctx, root);



  // 1. 组 Tab 切换
  root.querySelectorAll('.btn-switch-group-tab').forEach((el) => {
    el.addEventListener('click', () => {
      const gId = (el as HTMLElement).dataset.groupId;
      if (gId) {
        selectedGroupId = gId;
        ctx.onDataChange?.();
      }
    });
  });

  // 2. 展开/收起批量归组抽屉
  root.querySelector('#btn-toggle-batch-assign')?.addEventListener('click', () => {
    isBatchAssignOpen = !isBatchAssignOpen;
    ctx.onDataChange?.();
  });

  // 3. 批量归组：勾选（Shift 连选）+ 一次性划入/移出
  //
  // 旧实现是「点一个 chip 就立刻转移一个」，22 列要点 22 次，且转移方向是隐式的
  //（在组内→移出到默认组，不在→移入），用户看不出结果。改为先勾选再执行：
  // 一次操作覆盖任意多列，目标明确写在按钮上。
  const checks = Array.from(
    root.querySelectorAll<HTMLInputElement>('.group-col-check')
  );
  let lastCheckedIdx: number | null = null;
  checks.forEach((el) => {
    el.addEventListener('click', (ev) => {
      const idx = Number(el.dataset.idx);
      const shift = (ev as MouseEvent).shiftKey;
      if (shift && lastCheckedIdx != null) {
        const lo = Math.min(lastCheckedIdx, idx);
        const hi = Math.max(lastCheckedIdx, idx);
        const wanted = el.checked;
        for (let k = lo; k <= hi; k++) {
          if (checks[k]) checks[k].checked = wanted;
        }
      }
      lastCheckedIdx = idx;
    });
  });
  root.querySelector('#btn-group-select-all')?.addEventListener('click', () => {
    checks.forEach((el) => {
      el.checked = true;
    });
  });
  root.querySelector('#btn-group-select-none')?.addEventListener('click', () => {
    checks.forEach((el) => {
      el.checked = false;
    });
  });

  const moveCheckedTo = async (destinationGroupId: string | null): Promise<void> => {
    const roi = activeRoi();
    if (!roi || !ctx.rpcClient) return;
    const picked = checks
      .filter((el) => el.checked)
      .map((el) => el.dataset.colId)
      .filter((v): v is string => Boolean(v));
    if (picked.length === 0) {
      notify('请先勾选要调整的属种列。', 'info');
      return;
    }
    const dest = destinationGroupId || roi.default_group_id;
    const failures: string[] = [];
    let moved = 0;
    for (const colId of picked) {
      const col = cachedData?.columns.find((c) => c.id === colId);
      if (!col) continue;
      if ((col.x_group_id || roi.default_group_id) === dest) continue; // 已经在该组，跳过
      try {
        await ctx.rpcClient.updateColumn(columnIndex(col), { x_group_id: dest } as any);
        col.x_group_id = dest;
        moved++;
      } catch (err) {
        failures.push(`${col.name}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures.length > 0) {
      notifyError(`${failures.length} 列未调整成功：${failures.join('；')}`);
    }
    if (moved > 0) {
      notify(`已把 ${moved} 个属种列调整到目标组。`, 'success');
      ctx.onDataChange?.();
    } else if (failures.length === 0) {
      notify('所选属种都已在目标组，无需调整。', 'info');
    }
  };

  root.querySelector('#btn-assign-selected-to-group')?.addEventListener('click', () => {
    if (!selectedGroupId) return;
    void moveCheckedTo(selectedGroupId);
  });
  root.querySelector('#btn-remove-selected-from-group')?.addEventListener('click', () => {
    void moveCheckedTo(null);
  });

  // 4. 活动列所属组单列快速切换
  root.querySelector('#sel-col-group-quick')?.addEventListener('change', async (e) => {
    const activeCol = activeColumn();
    const newGrpId = (e.target as HTMLSelectElement).value;
    if (activeCol && newGrpId && ctx.rpcClient) {
      try {
        await ctx.rpcClient.updateColumn(columnIndex(activeCol), { x_group_id: newGrpId } as any);
        activeCol.x_group_id = newGrpId;
        selectedGroupId = newGrpId;
        ctx.onDataChange?.();
      } catch (err) {
        notifyError(err instanceof Error ? err.message : String(err));
      }
    }
  });

  // 5. 新建组
  // 选列集变化 → 面板重渲染（「已选 N 列」与确认按钮的可用性都依赖它）
  columnPick.onChanged = () => ctx.onDataChange?.();

  // 「+ 分组」：不再弹原生 prompt。先让用户在**图上**选出属于新组的列，
  // 再建组并划入；没选中的列自动留在默认组，不需要显式移出。
  root.querySelector('#btn-create-new-group')?.addEventListener('click', () => {
    beginColumnPick();
  });

  root.querySelector('#btn-cancel-column-pick')?.addEventListener('click', () => {
    resetColumnPick();
  });

  root.querySelector('#btn-confirm-column-pick')?.addEventListener('click', async () => {
    const roi = activeRoi();
    if (!roi || !ctx.rpcClient) return;
    const picked = [...columnPick.ids];
    if (picked.length === 0) return;
    const activeCol = activeColumn();
    const name = `组 ${(roi.x_groups?.length || 0) + 1}`;
    try {
      // 先建组：组名可在组 Tab 上再改，不在这一步卡住用户。
      const res = await ctx.rpcClient.roiGroupCreate(roi.id, {
        name,
        unit: activeCol?.unit || '%',
        plot_type: activeCol?.plot_type || activeCol?.plotType || 'area',
        scale_type: activeCol?.scale_type || 'linear',
      });
      roi.x_groups = roi.x_groups || [];
      roi.x_groups.push(res.group);
      let moved = 0;
      for (const colId of picked) {
        const col = cachedData?.columns.find((c) => c.id === colId);
        if (!col) continue;
        await ctx.rpcClient.updateColumn(columnIndex(col), {
          x_group_id: res.group.id,
        } as any);
        col.x_group_id = res.group.id;
        moved++;
      }
      selectedGroupId = res.group.id;
      resetColumnPick();
      notify(
        `已新建【${res.group.name}】并划入 ${moved} 列；其余列留在默认组。`,
        'success'
      );
      ctx.onDataChange?.();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : String(err));
    }
  });

  // 删除当前组：组内列自动回默认组（后端 roi_group_remove 负责 fallback）。
  root.querySelector('#btn-delete-group')?.addEventListener('click', async () => {
    const roi = activeRoi();
    if (!roi || !ctx.rpcClient || !selectedGroupId) return;
    if (selectedGroupId === roi.default_group_id) {
      notifyError('默认组不能删除：其余列都归它。');
      return;
    }
    try {
      await ctx.rpcClient.roiGroupRemove(roi.id, selectedGroupId);
      roi.x_groups = (roi.x_groups || []).filter((g) => g.id !== selectedGroupId);
      selectedGroupId = roi.default_group_id ?? null;
      notify('已删除该列组，组内列已回到默认组。', 'success');
      ctx.onDataChange?.();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : String(err));
    }
  });



  // 9. 单列清空
  root.querySelector('#btn-clear-col-ticks')?.addEventListener('click', () => {
    const activeCol = activeColumn();
    if (!activeCol) return;
    void (async () => {
      await callStepCallback(() => ctx.onClearXTicks?.(columnIndex(activeCol)));
      await syncXTicksDroppedFromBackend(cachedData, ctx);
    })();
  });

  // 10. 合并同类组
  root.querySelector('#btn-merge-groups')?.addEventListener('click', async () => {
    const roi = activeRoi();
    if (!roi || !roi.x_groups || roi.x_groups.length <= 1 || !ctx.rpcClient) {
      notify('当前 ROI 仅有 1 个或没有组，无需合并。', 'info');
      return;
    }
    const keyMap = new Map<string, ColumnGroup[]>();
    for (const g of roi.x_groups) {
      const key = `${g.unit}|${g.plot_type}|${g.scale_type}|${g.exaggeration_mult ?? 'none'}`;
      if (!keyMap.has(key)) keyMap.set(key, []);
      keyMap.get(key)!.push(g);
    }

    let mergedCount = 0;
    try {
      for (const [, grps] of keyMap.entries()) {
        if (grps.length > 1) {
          const keepGroup = grps[0];
          for (let i = 1; i < grps.length; i++) {
            const dupGroup = grps[i];
            const cols = (cachedData?.columns || []).filter(
              (c) => c.roi_id === roi.id && c.x_group_id === dupGroup.id
            );
            for (const c of cols) {
              await ctx.rpcClient.updateColumn(columnIndex(c), { x_group_id: keepGroup.id } as any);
              c.x_group_id = keepGroup.id;
            }
            await ctx.rpcClient.roiGroupRemove(roi.id, dupGroup.id);
            roi.x_groups = roi.x_groups.filter((g) => g.id !== dupGroup.id);
            mergedCount++;
          }
        }
      }
      if (mergedCount > 0) {
        selectedGroupId = roi.x_groups[0].id;
        notify(`已成功合并 ${mergedCount} 个标度相同的列组！`, 'success');
        ctx.onDataChange?.();
      } else {
        notify('当前 ROI 内所有列组形态或标度各不相同，未发现可合并的同类组。', 'info');
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : String(err));
    }
  });

  // 回车保存单列
  const val1Inp = root.querySelector('#inp-manual-tick-val1') as HTMLInputElement | null;
  const val2Inp = root.querySelector('#inp-manual-tick-val2') as HTMLInputElement | null;
  const handleEnterKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (root.querySelector('#btn-save-manual-ticks') as HTMLButtonElement | null)?.click();
    }
  };
  val1Inp?.addEventListener('keydown', handleEnterKey);
  val2Inp?.addEventListener('keydown', handleEnterKey);

  root.querySelector('#btn-apply-xticks-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(7);
  });
}
