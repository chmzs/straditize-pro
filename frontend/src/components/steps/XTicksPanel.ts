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
  type DetectedSpan,
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
let lastSpans: DetectedSpan[] = [];
/**
 * 「末齿读数」输入草稿（按组 id）。
 *
 * 面板会被后台刷新重渲染（几何检测回包、自动存档、画布交互都会走 `onDataChange`），
 * 输入值只活 DOM 里就会被清空——用户填了数、界面自己擦掉，是最难察觉的一类数据丢失。
 */
const refDrafts = new Map<string, string>();

/**
 * 两个手动读数输入框的草稿（按列 id）。
 *
 * 与 `refDrafts` 同一个坑：面板会被后台刷新重渲染（几何检测回包、自动存档、
 * 画布交互都会走 `onDataChange`），而 Playwright/真实用户的 click 会先
 * scroll/hover 触发这些刷新 —— 实测「填完 VAL2=40、toHaveValue 通过、点保存」
 * 三步之间值就被冲成空，后端收到「0」「」并拒绝（issue #5）。
 *
 * 标定成功后 `x_ticks` 优先于草稿，所以不必手动清理，残留只会被忽略。
 */
const manualTickDrafts = new Map<string, { v1: string; v2: string }>();

function draftFor(colId: string | undefined): { v1: string; v2: string } | undefined {
  return colId ? manualTickDrafts.get(colId) : undefined;
}

/**
 * 用户显式给的轴线粗细（px，图级）。`null` = 让后端自动估。
 *
 * 为什么需要这个覆盖：后端自动估计取「每行从轴线起连续暗 run 的最小值」，
 * 在「整列每层都有花粉」的列上必然高估（最薄行仍带基部填充），而它把结果夹在
 * 1–6px，高 DPI 图的粗轴会被截断（600 dpi 的 1 pt 线 ≈ 8px）。
 * 实测 beginner 同一张图四列就估出 4/6/6/6 两种值。
 */
let axisStrokeOverride: number | null = null;

function getColCalibX(col: any): number | null {
  // **只有用户确认过的两点标定（x_ticks）才算刻度。**
  // `tickEndX` / `scaleCalib.calibX` 在分列时会由后端写入
  // `startX + max(20, min(0.65×列宽, 80))` 这个**猜测值**（beginner 实测四列全是
  // startX+80），把它当刻度显示等于把假数据画成"已标定"。宁可不显示，也不显示猜的。
  if (col?.x_ticks && col.x_ticks.length >= 2 && col.x_ticks[1].px > col.startX) {
    return col.x_ticks[1].px;
  }
  return null;
}

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
  lastSpans = spans;
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
  const colName = activeCol ? activeCol.name : t('step6.unselected');
  const hasTicks = Boolean(activeCol && activeCol.x_ticks && activeCol.x_ticks.length === 2);

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
  lastSpans = spans;
  const rigidSpan = maxDetectedSpan(spans);
  const groupUnit = currentGroup?.unit || '%';
  const unitsPerCellText =
    refDrafts.get(currentGroupId) ??
    (currentGroup?.ref_units_per_cell != null
      ? String(currentGroup.ref_units_per_cell)
      : '');
  const rulerLine = describeRulerDetection(geo, geoError, geoPending);
  // 刻距只说明"一格多少像素"，用户真正要填的是"一格多少单位"——那个数只在图上。
  // 所以填完立刻把换算结果回显给他核对：px/单位 若与肉眼估计差一个数量级，就是填错了。
  const unitsPerCellNum = Number.parseFloat(unitsPerCellText);
  const perUnitText =
    Number.isFinite(unitsPerCellNum) && unitsPerCellNum > 0 && geo?.median_spacing_px
      ? ` → ${(geo.median_spacing_px / unitsPerCellNum).toFixed(2)} px/${groupUnit}`
      : '';
  const spanText =
    rigidSpan == null
      ? '刻距 —（需先检测到刻度尺）'
      : `刻距 ${geo?.median_spacing_px ?? '—'}px（自动检测）${perUnitText}`;

  const spanForActive = lastSpans.find(
    (s) => s.colIndex === (activeCol?.col_index ?? -1)
  );
  // 0 点是**实测轴线右缘**，不是列切分给的 startX：后者实测可偏离轴线 6–20px。
  // 面板显示的像素必须与实际标定用的是同一个数，否则用户照着它校正会自造偏差。
  const px1Measured = spanForActive?.axisX != null;
  const px1 = spanForActive?.axisX ?? activeCol?.startX ?? 0;
  const px2 = getColCalibX(activeCol);

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
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
            <button id="btn-measure-spacing" class="ui-btn ui-btn--secondary"
                    style="font-size: 10px; padding: 2px 8px;"
                    title="切到画布测距工具：点两个相邻刻度齿，画布上会显示 Δx 与像素距离。用它核对上面的自动检测刻距，量到的值与自动值不一致时以你量的为准。">
              量刻距（测距 S）
            </button>
            <span style="font-size: 9.5px; color: var(--text-muted);">点两个相邻刻度齿，看 Δx</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            <label for="inp-ref-units-per-cell" style="font-size: 10.5px; color: var(--text-muted);">每根齿单位数:</label>
            <input type="number" id="inp-ref-units-per-cell" value="${unitsPerCellText}" placeholder="如 20"
                   title="相邻两条刻线之间代表多少单位：通常就是图上相邻两个数字标签之差（例如 20）；若标签隔一根齿才标数字，取该差值的一半。这是组的属性，全组共用这一个数。"
                   style="width: 66px; font-size: 11px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
            <span style="font-size: 10px; color: var(--text-muted);">${groupUnit}</span>
            <span data-role="ruler-span" data-span="${rigidSpan ?? ''}" style="font-size: 9.5px; color: var(--text-muted); margin-left: auto;">${spanText}</span>
          </div>

          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            <label for="inp-axis-stroke" style="font-size: 10.5px; color: var(--text-muted);">轴线粗细:</label>
            <input type="number" id="inp-axis-stroke" value="${axisStrokeOverride ?? ''}" placeholder="自动" min="1" max="20" step="1"
                   title="Y 轴轴线（spine）的描边宽度，单位像素。填了它，0 点 = 轴线左缘 + 粗细 − 1，程序不再从像素里猜；留空则自动估计（夹在 1–6px，高 DPI 图的粗轴会被截断）。"
                   style="width: 66px; font-size: 11px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
            <span style="font-size: 9.5px; color: var(--text-muted);">px（留空 = 自动估计）</span>
          </div>

          <button id="btn-apply-group-scale" class="ui-btn ui-btn--primary" style="width: 100%; font-size: 11px; padding: 5px 6px;"
                  title="以各列基线为 0 点、用同一个自动检测到的跨度对齐全组（斜率一致）">
            对齐本组 (${groupCols.length}列)
          </button>
        </div>
      </div>

      <!-- 模块 2：当前点选列详情与微调 (Active Column Details) -->
      <div class="inspector-section" style="padding: 10px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div>
            ${t('step6.activeCol')}<strong style="color: var(--accent-blue);">${colName}</strong>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${hasTicks ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${hasTicks ? 'var(--status-success)' : 'var(--status-warning)'};">
              ${hasTicks ? t('step6.calibrated') : t('step6.uncalibrated')}
            </span>
            ${hasTicks ? `<button id="btn-clear-col-ticks" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; color: var(--accent-red); padding: 1px 6px;" title="${t('step6.clearTicks')}">${t('step6.clearTicks')}</button>` : ''}
          </div>
        </div>

        <!-- 所属组快速切换 -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px; background: var(--bg-card); padding: 5px 8px; border-radius: 4px; border: 1px solid var(--border-color);">
          <label for="sel-col-group-quick" style="font-size: 10.5px; color: var(--text-secondary);">所属列组:</label>
          <select id="sel-col-group-quick" style="flex: 1; max-width: 170px; font-size: 10.5px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary);">
            ${groups
              .map(
                (g) =>
                  `<option value="${g.id}" ${(activeCol?.x_group_id || activeRoi?.default_group_id) === g.id ? 'selected' : ''}>${g.name} (${g.unit})</option>`
              )
              .join('')}
          </select>
        </div>

        <!-- 端点数值卡片 -->
        <div style="display: flex; flex-direction: column; gap: 6px; background: var(--bg-card); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); margin-bottom: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <label for="inp-manual-tick-val1" style="font-size: 11px; color: var(--text-secondary); font-weight: 500; display: flex; align-items: center; gap: 5px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent-blue);"></span>
              <span>左基线原点 (X1):</span>
            </label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" id="inp-manual-tick-val1" value="${hasTicks ? activeCol.x_ticks![0].value : (draftFor(activeCol?.id)?.v1 ?? activeCol?.startValue ?? 0)}" style="width: 60px; font-size: 11px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: 10.5px; color: var(--text-muted); min-width: 16px;">${activeCol?.unit || groupUnit}</span>
            </div>
          </div>
          <div style="font-size: 9.5px; color: var(--text-muted); padding-left: 13px;">
            像素位置: <code>X = ${Math.round(px1)}px</code> (${px1Measured ? '轴线右缘 = 0 点' : '轴线未识别，退回列边界'})
          </div>

          <div style="height: 1px; background: var(--border-color); opacity: 0.5; margin: 1px 0;"></div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <label for="inp-manual-tick-val2" style="font-size: 11px; color: var(--text-secondary); font-weight: 500; display: flex; align-items: center; gap: 5px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--status-success);"></span>
              <span>右刻度齿点 (X2):</span>
            </label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" id="inp-manual-tick-val2" value="${hasTicks ? activeCol.x_ticks![1].value : (draftFor(activeCol?.id)?.v2 ?? '')}" style="width: 60px; font-size: 11px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: 10.5px; color: var(--text-muted); min-width: 16px;">${activeCol?.unit || groupUnit}</span>
            </div>
          </div>
          <div style="font-size: 9.5px; color: var(--text-muted); padding-left: 13px;">
            ${
              px2 == null
                ? '<span style="color: var(--status-warning);">未标定：图上的刻度参考线不画猜测值。用「对齐本组」，或填入 X2 数值后保存。</span>'
                : `像素位置: <code>X = ${Math.round(px2)}px</code> (跨度 ${(px2 - px1).toFixed(1)}px)`
            }
          </div>
        </div>

        <div style="display: flex; gap: 6px;">
          <button id="btn-save-manual-ticks" class="ui-btn ui-btn--primary" style="flex: 1; font-size: 11px; padding: 5px 8px;">
            ${t('step6.saveTicks')}
          </button>
          <button id="btn-detect-xticks" class="ui-btn ui-btn--secondary" style="font-size: 11px; padding: 5px 8px;" title="基于图像分析自动识别全区刻度齿位置">
            自动提取
          </button>
        </div>
      </div>

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

  // 组级形态 / 尺度：与「每根齿单位数」走同一条写入通路，都是组的属性。
  const patchGroup = (field: Record<string, string>) => {
    const gid = selectedGroupId;
    const roiId = activeRoi()?.id;
    const client = ctx.rpcClient as
      | { roiGroupUpdate?: (r: string, g: string, p: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    (window as unknown as Record<string, unknown>).__patchTrace = {
      gid, roiId, hasClient: Boolean(client?.roiGroupUpdate), field,
    };
    if (!gid || !roiId || !client?.roiGroupUpdate) return;
    void client.roiGroupUpdate(roiId, gid, field).then(() => ctx.onDataChange?.());
  };
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

  // 0b. 「末齿读数」草稿：后台刷新重渲染后用户填的数必须还在。
  root.querySelector('#inp-ref-units-per-cell')?.addEventListener('input', (e) => {
    const gid = selectedGroupId;
    if (gid) refDrafts.set(gid, (e.target as HTMLInputElement).value);
  });

  // 组标度记忆落库：`input` 每键一次太频，用 `change`（失焦/回车）写一次。
  // 「每根齿单位数」是用户输入的一等量，刷新后不该丢——存它本身，不存派生值。
  root.querySelector('#inp-ref-units-per-cell')?.addEventListener('change', (e) => {
    const gid = selectedGroupId;
    const roiId = activeRoi()?.id;
    const raw = (e.target as HTMLInputElement).value.trim();
    const parsed = raw === '' ? null : Number.parseFloat(raw);
    if (!gid || !roiId || parsed == null || !Number.isFinite(parsed) || parsed <= 0) return;
    const client = ctx.rpcClient as
      | {
          roiGroupUpdate?: (
            roiId: string,
            groupId: string,
            updates: Record<string, unknown>
          ) => Promise<unknown>;
        }
      | undefined;
    if (!client?.roiGroupUpdate) return;
    void client.roiGroupUpdate(roiId, gid, { ref_units_per_cell: parsed });
  });

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

  // 6. 对齐本组：跨度自动取自检测（各列实测轴线→末齿），用户只填「每格单位数」。
  root.querySelector('#btn-apply-group-scale')?.addEventListener('click', async () => {
    const roi = activeRoi();
    if (!cachedData || !roi || !ctx.rpcClient) return;

    const spanPx = maxDetectedSpan(lastSpans);
    if (spanPx == null) {
      notifyError('未检测到刻度尺，无法取跨度：请在图上确认图版下方有刻度尺后重试。');
      return;
    }
    const spacing = rulerGeo?.median_spacing_px;
    if (!spacing || spacing <= 0) {
      notifyError('未检测到刻距，无法把「每根齿单位数」换算成像素：请确认图版下方有刻度尺后重试。');
      return;
    }

    // 「每格单位数」是**组**的属性（同组共用同一把刻度尺），不是某列末齿的读数：
    // 后者在多列图上会歧义——各列末齿对应的读数并不相同（20 / 50 / 100 都有）。
    const raw = (root.querySelector('#inp-ref-units-per-cell') as HTMLInputElement | null)?.value ?? '';
    const unitsPerCell = Number.parseFloat(raw);
    if (!Number.isFinite(unitsPerCell) || unitsPerCell <= 0) {
      notifyError('每根齿单位数必须填：看相邻两条刻线之间代表多少单位（通常是相邻两个数字标签之差；标签隔齿标注时取一半）。不会替你预填。');
      return;
    }

    const currentG = (roi.x_groups || []).find((g) => g.id === selectedGroupId) || (roi.x_groups || [])[0];
    const targetGroupId = currentG?.id || roi.default_group_id;
    const targetRoiId = roi.id;
    const targetCols = (cachedData.columns || []).filter((c) => {
      const cGrp = c.x_group_id || roi.default_group_id;
      const cRoi = c.roi_id || roi.id;
      return cGrp === targetGroupId && cRoi === targetRoiId;
    });
    if (targetCols.length === 0) {
      notify(`当前组【${currentG?.name || '默认组'}】内尚无任何属种列，请先添加属种归组。`, 'info');
      return;
    }

    const unit = currentG?.unit || '%';
    // 换算依据仍是「水平距离 ÷ 数值差」这一个比值，只是分子取**检测到的刻距**：
    // 每格 unitsPerCell 个单位 ↔ spacing 像素。同组各列共用它，斜率天然相等。
    const pxPerUnit = spacing / unitsPerCell;
    const failures: string[] = [];
    const skipped: string[] = [];
    let successCount = 0;
    for (const col of targetCols) {
      const idx = columnIndex(col);
      const span = lastSpans.find((s) => s.colIndex === idx);
      if (!span || span.span == null || span.span <= 0) {
        // 没有检测到刻线 = 没有可信的水平距离。绝不拿别列的距离顶替。
        skipped.push(col.name);
        continue;
      }
      // 第二端点就用该列**自己**检测到的末齿：跨度天然落在列内，无需夹取；
      // 读数按同一 px/单位折算，所以四列 px/单位严格相等。
      // 0 点取实测轴线（span.axisX），不是 col.startX —— 后者只是列边界代理。
      const px1 = span.axisX + span.span;
      const v2 = span.span / pxPerUnit;
      try {
        const res = await ctx.rpcClient.calibrateColumnXTicks(
          idx,
          [
            { px: span.axisX, value: 0 },
            { px: px1, value: v2 },
          ],
          unit
        );
        col.x_ticks = res.x_ticks;
        col.tickEndX = px1;
        col.maxPercent = v2;
        successCount++;
      } catch (err) {
        failures.push(`${col.name}：${describeError(err)}`);
      }
    }

    if (skipped.length > 0) {
      notifyError(
        `${skipped.length} 列未检测到刻度尺，已跳过（不拿别列的距离顶替）：${skipped.join('、')}`
      );
    }
    if (failures.length > 0) {
      notifyError(`对齐失败 ${failures.length}/${targetCols.length} 列：${failures.join('；')}`);
    }
    if (successCount > 0) {
      refDrafts.delete(currentG?.id || '');
      const k = Math.round(pxPerUnit * 100) / 100;
      notify(
        `已对齐 ${successCount} 列：每根齿 ${unitsPerCell}${unit}，刻距 ${Math.round(spacing * 10) / 10}px → ${k} px/单位`,
        'success'
      );
      ctx.onDataChange?.();
      await syncXTicksDroppedFromBackend(cachedData, ctx);
    }
  });

  // 8. 单列微调保存
  // 记录两个读数框的编辑内容，供重渲染后回填（见 `manualTickDrafts` 的说明）。
  const rememberDraft = (key: 'v1' | 'v2') => (e: Event) => {
    const col = activeColumn();
    if (!col?.id) return;
    const cur = manualTickDrafts.get(col.id) ?? { v1: '', v2: '' };
    manualTickDrafts.set(col.id, {
      ...cur,
      [key]: (e.target as HTMLInputElement).value,
    });
  };
  root
    .querySelector('#inp-manual-tick-val1')
    ?.addEventListener('input', rememberDraft('v1'));
  root
    .querySelector('#inp-manual-tick-val2')
    ?.addEventListener('input', rememberDraft('v2'));

  // 「量刻距」不是新功能：画布早就有测距工具（Δx / Δy / px），
  // 用户缺的是在步骤 6 里被指出"该量什么、跟什么对照"。点这里直接切过去。
  root.querySelector('#btn-measure-spacing')?.addEventListener('click', () => {
    ctx.onSetToolMode?.('measure');
  });

  root.querySelector('#btn-save-manual-ticks')?.addEventListener('click', () => {
    const activeCol = activeColumn();
    if (!activeCol) return;
    const val1Raw = (root.querySelector('#inp-manual-tick-val1') as HTMLInputElement)?.value ?? '';
    const val2Raw = (root.querySelector('#inp-manual-tick-val2') as HTMLInputElement)?.value ?? '';
    void (async () => {
      await callStepCallback(() =>
        ctx.onCalibrateXTicks?.(columnIndex(activeCol), val1Raw, val2Raw)
      );
      await syncXTicksDroppedFromBackend(cachedData, ctx);
    })();
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
