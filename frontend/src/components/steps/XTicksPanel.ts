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
  renderActiveColumnLostNotice,
  renderOtherLostColumnsSummary,
} from './XTicksDroppedNotice';
import { renderOtherSuspectColumnsSummary } from './SuspectBlockNotice';
import { resolveAxisStroke } from '../../core/axisStroke';
import { columnAtX, zeroXOfColumn } from '../../core/tickRouting';

/** 步骤 6 面板的全部可变状态。 */
interface XTicksPanelState {
  cachedData: DiagramData | null;
  selectedGroupId: string | null;
  pendingTick: { px: number; dist: number } | null;
  onTickPickedExternal: ((pt: { x: number; y: number }) => void) | null;
  isBatchAssignOpen: boolean;
  rulerGeo: RulerGeometry | null;
  rulerGeoError: string | null;
  rulerGeoKey: string | null;
  rulerGeoPending: boolean;
  axisStrokeOverride: number | null;
}

const INITIAL_XTICKS_STATE: XTicksPanelState = {
  cachedData: null,
  selectedGroupId: null,
  pendingTick: null,
  onTickPickedExternal: null,
  isBatchAssignOpen: false,
  rulerGeo: null,
  rulerGeoError: null,
  rulerGeoKey: null,
  rulerGeoPending: false,
  axisStrokeOverride: null,
};

/** 步骤 6 面板的可变状态。
 *
 * 失效策略：**不**在 mount 里无条件复位——mount 每次重渲染都调用，清掉 rulerGeo
 * 或 onTickPickedExternal（外部接线）会让面板重测、甚至让画布点齿彻底没反应。
 * 缓存失效由 rulerGeoKeyFor 的键（ROI + 图像 + 列几何 + 轴粗）负责，那是按需失效。
 */
const state: XTicksPanelState = { ...INITIAL_XTICKS_STATE };

export const step = 6;
export const title = '6. 标定列与 X 刻度';


/** 标定态下画布点选的齿：像素 + 它距该列 0 点的距离。null = 尚未选。 */

/** 画布点选刻度齿的回调（main.ts 注册）。判定"距 0 点多少"在这里做，
 *  因为 0 点依赖当前列的几何，画布不该知道这些。 */
export function setTickPickedHandler(
  fn: ((pt: { x: number; y: number }) => void) | null
): void {
  state.onTickPickedExternal = fn;
}

/** 画布点选刻度齿时由 main.ts 调用。 */
export function handleTickPicked(pt: { x: number; y: number }): void {
  state.onTickPickedExternal?.(pt);
}

/**
 * 最近一次 `algorithm.measureRuler` 的结果。
 *
 * 缓存键 `state.rulerGeoKey` 由「ROI + 图片 + 列几何」组成：数据变了（重新分列、换图、
 * 换 ROI）就必须重测，否则面板会拿着上一张图的刻距当默认值 —— 那正是"默认值
 * 与真实刻距无关"这类缺陷最容易复发的地方。同一张图上重复渲染（切组、改名）
 * 键不变，直接复用，不会每次都打后端。
 */
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
  return `${roiId ?? ''}#${data.imageWidth}x${data.imageHeight}#${(data.imageSrc || '').length}#${geom}#stroke${state.axisStrokeOverride ?? ''}`;
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
  const geo = state.rulerGeo;
  const line = root.querySelector('[data-role="ruler-detect"]') as HTMLElement | null;
  const spanEl = root.querySelector('[data-role="ruler-span"]') as HTMLElement | null;

  const spans = detectedSpans(state.cachedData?.columns ?? [], geo, (c) => zeroXOfColumn(c, state.cachedData));
  const rigidSpan = maxDetectedSpan(spans);

  if (line) {
    line.textContent = describeRulerDetection(geo, state.rulerGeoError, state.rulerGeoPending);
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
    line.style.color = state.rulerGeoError ? 'var(--accent-red)' : 'var(--text-secondary)';
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
  const data = state.cachedData;
  if (!data) return;
  const roiId = data.active_roi_id || data.rois?.[0]?.id || null;
  const key = rulerGeoKeyFor(data, roiId);
  if (state.rulerGeoPending) return;
  if (state.rulerGeoKey === key && (state.rulerGeo != null || state.rulerGeoError != null)) return;

  const client = ctx.rpcClient as
    | {
        measureRuler?: (
          roiId?: string,
          axisStroke?: number | null
        ) => Promise<RulerGeometry>;
      }
    | undefined;
  if (!client?.measureRuler) {
    state.rulerGeo = null;
    state.rulerGeoError = '前端 RpcClient 缺少 measureRuler：前后端契约不一致';
    state.rulerGeoKey = key;
    notifyError(`刻度几何检测失败：${state.rulerGeoError}`);
    patchRulerDom(root);
    return;
  }

  state.rulerGeoPending = true;
  try {
    state.rulerGeo = await client.measureRuler(roiId ?? undefined, state.axisStrokeOverride);
    state.rulerGeoError = null;
  } catch (err) {
    state.rulerGeo = null;
    state.rulerGeoError = describeError(err);
    notifyError(`刻度几何检测失败：${state.rulerGeoError}`);
  } finally {
    state.rulerGeoPending = false;
    state.rulerGeoKey = key;
  }
  patchRulerDom(root);
}

export function render(data: DiagramData): string {
  state.cachedData = data;
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
    state.selectedGroupId && groups.some((g) => g.id === state.selectedGroupId)
      ? state.selectedGroupId
      : activeCol?.x_group_id || activeRoi?.default_group_id || groups[0]?.id;
  state.selectedGroupId = currentGroupId;

  const currentGroup = groups.find((g) => g.id === currentGroupId) || groups[0];

  // 统计各组包含的列
  const groupCols = cols.filter((c) => (c.x_group_id || activeRoi?.default_group_id) === currentGroupId);

  // 轴线粗的生效值：**列级覆盖 > 组级初值 > 缺省 5**（ARCHITECTURE §6.4）。
  // 组上的正数来自分列实测（`measure_axis_stroke`）或用户手填；列上的正数只可能是
  // 用户显式覆盖。两者都必须让用户看得见——静默用一个猜的值会让绿线（0 点）偏掉几像素。
  const axisStrokeColOverride =
    Number(activeCol?.axis_stroke_px) > 0 ? Number(activeCol?.axis_stroke_px) : null;
  const axisStrokePx = resolveAxisStroke(activeCol, currentGroup);
  const axisStrokeMeasured =
    Number(currentGroup?.axis_stroke_px) > 0 || axisStrokeColOverride != null;

  // 刻线几何：只对**本 ROI** 的列测（后端按 roi_id 过滤，这里必须同口径，否则错位）。
  const roiCols = cols.filter((c) => !activeRoi?.id || !c.roi_id || c.roi_id === activeRoi.id);
  const geoKey = rulerGeoKeyFor(data, activeRoi?.id ?? null);
  const geo = state.rulerGeoKey === geoKey ? state.rulerGeo : null;
  const geoError = state.rulerGeoKey === geoKey ? state.rulerGeoError : null;
  const geoPending = state.rulerGeoPending || (!geo && !geoError);
  const spans = detectedSpans(roiCols, geo, (c) => zeroXOfColumn(c, data));
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
              ${state.isBatchAssignOpen ? '收起归组列表 ▲' : '批量调整属种归组 ▼'}
            </button>
          </div>

          <!-- 批量归组抽屉面板 -->
          ${
            state.isBatchAssignOpen
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
            <strong>相邻两个数字标签之差</strong>（标签 10 / 30 → 填 20）。
            <details class="ui-help"><summary>取值规则</summary>
              标签隔一根齿才标数字时取差值的一半。软件不替你猜：填错会让全组读数按同一比例偏掉。
            </details>
          </div>
          <!-- 轴线粗：决定绿线「0 点 = 左缘 + 轴粗」的位置，同时给刻度检测定轴右缘。 -->
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px;">
            <label for="inp-axis-stroke" style="font-size: 10.5px; color: var(--text-muted);">轴线粗细:</label>
            <input type="number" id="inp-axis-stroke" value="${currentGroup && Number(currentGroup.axis_stroke_px) > 0 ? String(Number(currentGroup.axis_stroke_px)) : ''}" placeholder="5" min="1" max="20" step="1"
                   title="Y 轴轴线的描边宽度（像素）。0 点 = 左缘 + 它。填了就不再从像素里猜。"
                   style="width: 66px; font-size: 11px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
            <span style="font-size: 9.5px; color: var(--text-muted);">px</span>
           <!-- 单列覆盖：组值是初值，逐列差异真实存在（实测 beginner 3/5/5/5），
                只调某列时不该把整组一起改。留空 = 跟随组。 -->
           <div style="display: flex; align-items: center; gap: 6px; width: 100%; margin-bottom: 6px;">
             <label for="inp-col-axis-stroke" style="font-size: 10.5px; color: var(--text-muted);">仅本列:</label>
             <input type="number" id="inp-col-axis-stroke" value="${axisStrokeColOverride != null ? String(axisStrokeColOverride) : ''}" placeholder="${Number(currentGroup?.axis_stroke_px) > 0 ? String(Number(currentGroup?.axis_stroke_px)) : '5'}" min="1" max="20" step="1"
                    title="只改当前这一列的 0 点位置。留空 = 跟随组值。"
                    style="width: 66px; font-size: 11px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
             <span style="font-size: 9.5px; color: var(--text-muted);">px（留空 = 跟随组）</span>
           </div>
          </div>
          <!-- 轴线粗的来源必须明示（用户原话：「y 轴轴线粗细不需要我提供，就自动给出绿色线吗？」）：
               分列时按灰度层次实测（columns.measure_axis_stroke），测得出就直接用；
               测不出就说清楚是估算，不要静默拿 5px 冒充实测值。 -->
          <div data-role="axis-stroke-source" data-measured="${axisStrokeMeasured ? '1' : '0'}"
               style="font-size: 9.5px; line-height: 1.45; margin: -2px 0 6px 0; color: ${axisStrokeMeasured ? 'var(--text-muted)' : 'var(--status-warning)'};">
            ${
              axisStrokeColOverride != null
                ? `本列覆盖 <strong>${axisStrokeColOverride}px</strong>（组值 ${Number(currentGroup?.axis_stroke_px) > 0 ? `${Number(currentGroup?.axis_stroke_px)}px` : "缺省 5px"}）· 绿线 = 列左缘 + ${axisStrokePx}`
                : Number(currentGroup?.axis_stroke_px) > 0
                  ? `轴线粗实测 <strong>${axisStrokePx}px</strong> · 绿线 = 列左缘 + ${axisStrokePx}`
                  : '轴线粗<strong>无法自动测量</strong>（这几列的左边不是灰度均匀的竖轴），当前按 <strong>5px</strong> 估算 —— 绿线可能偏，请量一下实际粗细后填入上面的输入框'
            }
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
              state.pendingTick
                ? `
            <div data-role="pending-tick" style="font-size: 10.5px; line-height: 1.6; margin-bottom: 6px; padding: 6px 8px; background: var(--bg-tertiary); border-radius: 4px;">
              已选齿：<code style="color: var(--accent-blue);">x = ${state.pendingTick.px}px</code>
              · 距 0 点 <strong>${state.pendingTick.dist.toFixed(0)}px</strong>
              ${
                state.pendingTick.dist < 20
                  ? '<div style="color: var(--status-warning); margin-top: 3px;"><strong>注意：</strong>离 0 点太近，±1px 就会让斜率偏几个百分点，建议点更远的齿。</div>'
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
          注意：该列 0 点不可自动测量
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
    state.cachedData?.columns.find((c) => c.id === state.cachedData?.activeTaxaId) || state.cachedData?.columns[0];
  const columnIndex = (col: NonNullable<ReturnType<typeof activeColumn>>) =>
    col.col_index ?? state.cachedData?.columns.indexOf(col) ?? 0;

  /**
   * 点选位置落在**哪一列**：列的取数带 = [0 点, endX]。
   *
   * 为什么必须按位置解析：旧实现恒用 `activeColumn()`，多列图上无论点哪一列的齿都去改
   * 「当前活动列」（通常就是第一列）——用户看到的是「只有第一列有用，其他列点了没反应」。
   * 齿在列内、列带互不重叠（相邻列的 endX 就是下一列 startX），取第一个命中的即可。
   */

  const activeRoi = () => {
    const col = activeColumn();
    return (
      state.cachedData?.rois?.find((r) => r.id === (col?.roi_id || state.cachedData?.active_roi_id || state.cachedData?.rois[0]?.id)) ||
      state.cachedData?.rois?.[0]
    );
  };

  // 组级写入的唯一通路：形态 / 尺度 / 单位刻度长度 / 轴线粗 都是组的属性。
  // **放在所有使用点之前** —— 之前它在 axis-stroke 的 handler 之后，直接引用会撞 TDZ。
  const patchGroup = (field: Record<string, unknown>) => {
    const gid = state.selectedGroupId;
    const roiId = activeRoi()?.id;
    const client = ctx.rpcClient as
      | { roiGroupUpdate?: (r: string, g: string, p: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    if (!gid || !roiId || !client?.roiGroupUpdate) return;
    void client.roiGroupUpdate(roiId, gid, field).then(() => ctx.onDataChange?.());
  };

  // 画布点选齿 → 记录"距本列 0 点多少"。判定在面板侧，画布只报坐标。
  setTickPickedHandler((pt) => {
    const data = state.cachedData;
    const columns = (data?.columns ?? []) as NonNullable<DiagramData['columns']>;
    // 点哪一列的齿就标哪一列（见 `columnAtX` 的注释）：旧实现恒用 `activeColumn()`，
    // 多列图上只有第一列（活动列）能标，其余列点了等于在改别处。
    const col = columnAtX(columns, data, pt.x);
    if (!col) {
      notifyError('点选位置不在任何一列的取数带内。请点在某一列的刻度齿上。');
      return;
    }
    const roi = data?.rois?.find((r) => r.id === (col.roi_id ?? data?.active_roi_id));
    const g = roi?.x_groups?.find((x) => x.id === col.x_group_id) ?? roi?.x_groups?.[0];
    // 0 点 = 列左缘 + 轴线粗（与画布绿线同源，见 ARCHITECTURE §6.4）。
    // `start` 是轴线左缘（列切分线），轴粗取组参数，缺省 5。
    const stroke = resolveAxisStroke(col, g);
    const start = Number(
      (col as unknown as Record<string, number>).startX ??
        (col as unknown as Record<string, number>).start ??
        0
    );
    const zero = start + stroke;

    // **必须吸附到检测到的刻度齿**：否则用户可以点任意位置，等于绕过了
    // "图上没有刻度尺就不许标定"这条约束（旧「对齐本组」靠"取不到跨度就拒绝"
    // 守的就是它）。吸附容差 6px —— 齿宽 1–2px，6px 足够容人手抖而不误吸邻齿。
    const idx = col.col_index ?? state.cachedData?.columns.indexOf(col) ?? 0;
    const colGeo = state.rulerGeo?.per_column?.find((c) => c.col_index === idx);
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
    state.pendingTick = { px: Math.round(nearest), dist: nearest - zero };
    // 只在**吸附成功**后切换选中列：点在空处不该改选中，否则用户以为点中了。
    if (col.id !== data?.activeTaxaId) ctx.onSelectTaxa?.(col.id);
    ctx.onDataChange?.();
  });

  root.querySelector('#btn-goto-step5-split')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(5);
  });


  // 标尺输入：轴线粗（组/列）、单位刻度长度、检测刻距
  const wireRulerInputs = (): void => {
    // 轴线粗细覆盖：用户量一次、全图共用。它决定绿线「0 点 = 左缘 + 轴粗」的位置，
    // 同时作为刻度检测时 `_find_axis_x` 的右缘判据。
    root.querySelector('#inp-axis-stroke')?.addEventListener('change', (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const parsed = raw === '' ? null : Number.parseFloat(raw);
      state.axisStrokeOverride =
        parsed != null && Number.isFinite(parsed) && parsed > 0
          ? Math.min(parsed, 20)
          : null;
      // 同时落库：绿线「0 点 = 左缘 + 轴线粗」靠它，而 `state.axisStrokeOverride` 只是前端内存。
      patchGroup({ axis_stroke_px: state.axisStrokeOverride });
      // 缓存键里含粗细；清空这三项才会真的重测。
      state.rulerGeo = null;
      state.rulerGeoError = null;
      state.rulerGeoKey = null;
      // 重测完成后必须整块重渲染：0 点像素是**渲染时**写进模板的（`px1`），
      // `patchRulerDom` 只就地更新检测那两行，不会更新「像素位置」。
      void ensureRulerGeometry(ctx, root).then(() => {
        ctx.onDataChange?.();
      });
    });

    // 单列覆盖：只改当前列的 0 点位置（组值仍是初值）。留空 = 清掉覆盖、回到组值。
    // 列级字段分列时不会写，所以这里写的值跨会话保留；改完必须整块重渲染——
    // 0 点像素是渲染时写进模板的（与上面组输入框同理）。
    root.querySelector('#inp-col-axis-stroke')?.addEventListener('change', (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const parsed = raw === '' ? null : Number.parseFloat(raw);
      if (parsed != null && (!Number.isFinite(parsed) || parsed <= 0 || parsed > 20)) {
        notifyError('单列轴线粗必须是 1–20 之间的正数；要清除覆盖请留空。');
        return;
      }
      const col = activeColumn();
      if (!col) return;
      void ctx.rpcClient
        .updateColumn(columnIndex(col), { axis_stroke_px: parsed })
        .then(() => ctx.onDataChange?.());
    });

    // 单位刻度长度（cell_px）：标定的几何锚点。刻度位置 = 0 点 + k × 它。
  };
  wireRulerInputs();


  // X 轴标定（点齿 + 填数字）
  const wireTickCalibration = (): void => {
    // ── X 轴标定（组级）──────────────────────────────────────────────
    // 一次动作定整组：点一个刻度齿 + 填它旁边的数字 → 斜率 = 数字 / 距0点px。
    root.querySelector('#btn-pick-tick')?.addEventListener('click', () => {
      state.pendingTick = null;
      ctx.onSetToolMode?.('pickTick');
      notify('请在画布上点一个刻度齿（离绿线越远越准）', 'info');
    });
    root.querySelector('#btn-cancel-tick-calib')?.addEventListener('click', () => {
      state.pendingTick = null;
      ctx.onDataChange?.();
    });
    root.querySelector('#btn-apply-tick-calib')?.addEventListener('click', () => {
      const raw = (root.querySelector('#inp-tick-value') as HTMLInputElement | null)?.value ?? '';
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) {
        notifyError('请填写这个齿代表的数字（图上标签，如 10）。');
        return;
      }
      if (!state.pendingTick || state.pendingTick.dist <= 0) {
        notifyError('请先在画布上点一个位于 0 点右侧的刻度齿。');
        return;
      }
      // 斜率 = 值 / 距 0 点像素。0 点 = 左缘 + 轴线粗（见 ARCHITECTURE §6.4）。
      const pickedDist = state.pendingTick.dist;
      const slope = value / pickedDist;
      patchGroup({ value_per_px: slope });
      state.pendingTick = null;
      notify(`已按「${value} 对应 ${pickedDist.toFixed(0)}px」标定本组：斜率 ${slope.toFixed(4)}`, 'info');
    });
  };
  wireTickCalibration();


  // 组属性：形态 / 尺度
  const wireGroupAttributes = (): void => {
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
  };
  wireGroupAttributes();


  // 0. 刻线几何检测：进入本步（以及数据变化后）自动拉一次，只读、不写任何标定。
  void ensureRulerGeometry(ctx, root);



  // 1. 组 Tab 切换
  // 组 Tab 切换
  const wireGroupTabs = (): void => {
    root.querySelectorAll('.btn-switch-group-tab').forEach((el) => {
      el.addEventListener('click', () => {
        const gId = (el as HTMLElement).dataset.groupId;
        if (gId) {
          state.selectedGroupId = gId;
          ctx.onDataChange?.();
        }
      });
    });
  };
  wireGroupTabs();


  // 批量归组 + 单列清空
  const wireBatchGrouping = (): void => {
    // 2. 展开/收起批量归组抽屉
    root.querySelector('#btn-toggle-batch-assign')?.addEventListener('click', () => {
      state.isBatchAssignOpen = !state.isBatchAssignOpen;
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
        const col = state.cachedData?.columns.find((c) => c.id === colId);
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
      if (!state.selectedGroupId) return;
      void moveCheckedTo(state.selectedGroupId);
    });
    root.querySelector('#btn-remove-selected-from-group')?.addEventListener('click', () => {
      void moveCheckedTo(null);
    });

    // 4. 活动列所属组单列快速切换

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
          const col = state.cachedData?.columns.find((c) => c.id === colId);
          if (!col) continue;
          await ctx.rpcClient.updateColumn(columnIndex(col), {
            x_group_id: res.group.id,
          } as any);
          col.x_group_id = res.group.id;
          moved++;
        }
        state.selectedGroupId = res.group.id;
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
      if (!roi || !ctx.rpcClient || !state.selectedGroupId) return;
      if (state.selectedGroupId === roi.default_group_id) {
        notifyError('默认组不能删除：其余列都归它。');
        return;
      }
      try {
        await ctx.rpcClient.roiGroupRemove(roi.id, state.selectedGroupId);
        roi.x_groups = (roi.x_groups || []).filter((g) => g.id !== state.selectedGroupId);
        state.selectedGroupId = roi.default_group_id ?? null;
        notify('已删除该列组，组内列已回到默认组。', 'success');
        ctx.onDataChange?.();
      } catch (err) {
        notifyError(err instanceof Error ? err.message : String(err));
      }
    });



    // 9. 单列清空
  };
  wireBatchGrouping();


  // 合并同类组（同 unit/plot/scale/exag）
  const wireMergeGroups = (): void => {
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
              const cols = (state.cachedData?.columns || []).filter(
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
          state.selectedGroupId = roi.x_groups[0].id;
          notify(`已成功合并 ${mergedCount} 个标度相同的列组！`, 'success');
          ctx.onDataChange?.();
        } else {
          notify('当前 ROI 内所有列组形态或标度各不相同，未发现可合并的同类组。', 'info');
        }
      } catch (err) {
        notifyError(err instanceof Error ? err.message : String(err));
      }
    });
  };
  wireMergeGroups();




  root.querySelector('#btn-apply-xticks-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(7);
  });
}
