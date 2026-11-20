import { DiagramData, ColumnGroup } from '../../types/pollen';
import { countCalibratedColumns } from '../../core/calibProgress';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notify, notifyError } from '../../ui/feedback';
import { columnPick, beginColumnPick, resetColumnPick } from './columnPick';
import {
  renderActiveColumnLostNotice,
  renderOtherLostColumnsSummary,
} from './XTicksDroppedNotice';
import { renderOtherSuspectColumnsSummary } from './SuspectBlockNotice';
import { DEFAULT_AXIS_STROKE_PX, resolveAxisStroke } from '../../core/axisStroke';
import { resolveColumnGroup } from '../../core/columnGroup';
import { resolveColumnAtX } from '../../core/tickRouting';
import { setGroupCalibMark } from '../canvas/groupCalibMarks';
// 组色的唯一取色点：画布「组归属条」也 import 这个函数，两处逐字节同色（issue #108）。
import { groupColorAt } from '../canvas/groupColor';
import {
  exaggerationRange,
  isGroupExaggerated,
  normalizeGroupExaggeration,
} from './exaggerationGroupInput';

/** 步骤 6 面板的全部可变状态。 */
interface XTicksPanelState {
  cachedData: DiagramData | null;
  selectedGroupId: string | null;
  pendingTick: { px: number; dist: number } | null;
  onTickPickedExternal: ((pt: { x: number; y: number }) => void) | null;
  isBatchAssignOpen: boolean;
  /** 「列组」折叠区是否展开。必须存进 state：面板每次重渲染都会重建 DOM。 */
  groupsFoldOpen: boolean;
  /**
   * 用户点过 `×1` 的组 id。`×1` 在模型里等价于 `null`（未放大），但这个选择必须
   * 在输入框里**显示成字面 1**，否则每次重渲染都回到空白（issue #107）。
   */
  explicitOneGroupIds: string[];
}

const INITIAL_XTICKS_STATE: XTicksPanelState = {
  cachedData: null,
  selectedGroupId: null,
  pendingTick: null,
  onTickPickedExternal: null,
  isBatchAssignOpen: false,
  // 列组**默认展开**（用户偏好：分组与单位是量纲工作的入口，不该先藏一层）。
  // 折叠行为不变：点一次即收起，状态存进 state 以便本次会话内保持（面板每次重渲染会重建 DOM）。
  groupsFoldOpen: true,
  explicitOneGroupIds: [],
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



export function render(data: DiagramData): string {
  state.cachedData = data;
  const cols = data.columns || [];
  if (cols.length === 0) {
    return `
      <div class="step-panel" data-step="6">
        <div class="step-title">${t('step6.title')}</div>
        <div class="inspector-section" style="padding: 24px 16px; background: var(--bg-tertiary); border-radius: 8px; text-align: center; border: 1px solid var(--border-color); margin-top: 12px;">
          <div style="font-size: var(--font-size-lg); font-weight: 700; color: var(--text-heading); margin-bottom: 6px;">${t('step6.noColsTitle')}</div>
          <p style="font-size: var(--font-size-sm); line-height: 1.6; color: var(--text-secondary); margin: 0 0 16px 0;">
            ${t('step6.noColsDesc')}
          </p>
          <button id="btn-goto-step5-split" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: var(--font-size-md);">
            ${t('step6.gotoStep5')}
          </button>
        </div>
      </div>
    `;
  }

  const activeCol = cols.find((c) => c.id === data.activeTaxaId) || cols[0];

  const totalCols = cols.length;
  const calibratedCols = countCalibratedColumns(cols);
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
  // 「删除本组」恒常渲染，但默认组 / 只有一个组时不可用：位置固定，禁用态即状态。
  const canDeleteGroup = groups.length > 1 && currentGroupId !== activeRoi?.default_group_id;

  // 轴线粗的生效值：**列级覆盖 > 组级初值 > 兜底 `DEFAULT_AXIS_STROKE_PX`**（ARCHITECTURE §6.4）。
  // 组上的正数来自分列实测（`measure_axis_stroke`）或用户手填；列上的正数只可能是
  // 用户显式覆盖。两者都必须让用户看得见——静默用一个猜的值会让绿线（0 点）偏掉几像素。
  const axisStrokeColOverride =
    activeCol?.axis_stroke_px != null && Number(activeCol.axis_stroke_px) >= 0
      ? Number(activeCol.axis_stroke_px)
      : null;
  const axisStrokePx = resolveAxisStroke(activeCol, currentGroup);
  const axisStrokeMeasured =
    (currentGroup?.axis_stroke_px != null && Number(currentGroup.axis_stroke_px) >= 0) ||
    axisStrokeColOverride != null;

  const groupUnit = currentGroup?.unit || '%';

  // 组级放大倍数：**组是真源**（后端解析顺序：组级 > 列级 > 历史键）。这里的输入框
  // 写的是本组所有列的倍率；列级那个输入（Inspector）在组 >1 时置灰。
  const groupExagMult = isGroupExaggerated(currentGroup?.exaggeration_mult)
    ? normalizeGroupExaggeration(currentGroup?.exaggeration_mult)
    : null;
  // `×1` 是一个**显式**的"未放大"选择（issue #107）：模型里它等价于 null ——
  // 后端 `store_exaggeration` 把 1 归一成 None —— 但输入框必须显示用户点的那个 `1`。
  // 否则点完 ×1、面板一重渲染，格子又变回空白，用户读成"这个组没设过"。
  // state 记的是"用户点过 ×1"，不是第二份数据：真值仍是组上的 exaggeration_mult。
  const exagShownAsOne = state.explicitOneGroupIds.includes(currentGroupId ?? '');
  const groupExagInputValue =
    groupExagMult !== null ? String(groupExagMult) : exagShownAsOne ? '1' : '';
  // 换算用的列宽：本组各列取数带宽度的均值（缺几何的列不参与，避免被 0 拉低）。
  const groupWidths = groupCols
    .map((c) => Number(c.endX ?? 0) - Number(c.startX ?? 0))
    .filter((w) => Number.isFinite(w) && w > 0);
  const groupAvgWidth = groupWidths.length
    ? groupWidths.reduce((sum, w) => sum + w, 0) / groupWidths.length
    : 0;
  // 图上满刻度 = 斜率 × 列宽；真实 = 图上 ÷ 倍率。数值全部由现有数据算，不写死。
  const exagRange = exaggerationRange(currentGroup?.value_per_px, groupAvgWidth, groupExagMult);
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
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px; font-size: var(--font-size-sm);">
        <span style="color: var(--text-secondary); font-weight: 500;">${t('step6.progress')}</span>
        <span style="font-weight: 700; color: ${calibratedCols === totalCols ? 'var(--status-success)' : 'var(--accent-blue)'};">
          ${calibratedCols} / ${totalCols} 列 (${pct}%)
        </span>
      </div>

      <!--
        组管理放在折叠区，但**默认展开**：分组与单位是量纲工作的入口（炭屑/浓度与百分比列
        分属不同组），先藏一层等于让用户去猜它在哪。用户点 summary 即可收起，收起状态
        由 state.groupsFoldOpen 在本次会话内保持。
        summary 里不放按钮——点了会连带折叠/展开。
      -->
      <details class="inspector-section" data-role="groups-fold" ${state.groupsFoldOpen ? 'open' : ''} style="padding: 8px 10px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <summary style="font-size: var(--font-size-sm); font-weight: 700; color: var(--text-heading); cursor: pointer;" title="同单位、同量程的列共用一个标度。分组只影响标定，不改列几何">
          列组 · ${groups.length} 组${currentGroup ? ` · 当前 ${currentGroup.name}` : ''}
        </summary>
        <!-- **不限高、不内滚**：曾经限高 132px + 内部滚动，结果「单位 / 形态 / 尺度」被从半行
             切断，外面一条滚动条、里面的勾选清单又有一条（它自带 max-height），参数卡片根本看不全。
             首屏高度改由两件事保证：① .inspector-body 是唯一滚动容器（整页滚）；
             ② 主动作被 Inspector 提到滚动容器之外的 .inspector-footer，内容再高也始终可见。 -->
        <div data-role="groups-fold-body">
        <!-- 组管理动作：**恒定可见、固定顺序**。
             旧实现按条件渲染（默认组时不画「删除本组」、只有 1 个组时不画「合并」），
             于是切组时这一行忽长忽短，右侧按钮整排左右跳（实测位移 60px+），
             用户还会以为「这个组的删除功能没了」。现在三个按钮永远在，不可用时
             disabled：位置不动，可用性靠原生禁用态表达。 -->
        <div data-role="group-actions" style="display: flex; align-items: center; gap: 4px; margin: 8px 0; min-height: var(--control-h-sm);">
            <button id="btn-create-new-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="padding: 1px 6px; color: var(--accent-blue);" title="新建一个列组：点它之后在图上点选属于该组的属种列（Shift 连选），其余列自动留在默认组">+ 分组</button>
          <button id="btn-delete-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="padding: 1px 6px; color: var(--accent-red);" title="删除当前列组：组内列自动回到默认组" ${canDeleteGroup ? '' : 'disabled'}>删除本组</button>
          <button id="btn-merge-groups" class="ui-btn ui-btn--quiet ui-btn--xs" style="padding: 1px 6px;" title="合并形态标度完全一致的组" ${groups.length > 1 ? '' : 'disabled'}>合并同类组</button>
        </div>

        <!-- 组 Tab 选择器 -->
        <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
          ${groups
            .map((g, gIdx) => {
              const isSelected = g.id === currentGroupId;
              const gCols = cols.filter((c) => (c.x_group_id || activeRoi?.default_group_id) === g.id);
              const gCalibrated = gCols.filter((c) => c.x_ticks && c.x_ticks.length === 2).length;
              const isFullCalib = gCols.length > 0 && gCalibrated === gCols.length;
              // 组色与画布「组归属条」同源（`canvas/groupColor.ts` 是唯一取色点，
              // issue #108）：同一个组，按钮上的色块/描边与画布那条横带逐字节相同，
              // 用户才可能把"第几个按钮"对上"画布上哪一段"。
              const groupColor = groupColorAt(gIdx);
              return `
                <button
                  type="button"
                  class="btn-switch-group-tab ui-btn ${isSelected ? 'ui-btn--primary' : 'ui-btn--quiet'}"
                  data-group-id="${g.id}"
                  style="font-size: var(--font-size-sm); padding: 3px 8px; border-radius: 4px; display: flex; align-items: center; gap: 4px; border: 1px solid ${groupColor}; border-left: 3px solid ${groupColor}; ${isSelected ? `box-shadow: 0 0 0 1px ${groupColor};` : ''}"
                >
                  <span aria-hidden="true" style="display: inline-block; width: 9px; height: 9px; border-radius: 2px; background: ${groupColor}; border: 1px solid rgba(0, 0, 0, 0.18);" title="本组在画布上的组色带颜色"></span>
                  <span>${g.name}</span>
                  <span style="font-size: var(--font-size-xs); opacity: 0.85; background: rgba(0,0,0,0.15); padding: 0 4px; border-radius: 3px;">${gCols.length}列</span>
                  <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${isFullCalib ? 'var(--status-success)' : 'var(--status-warning)'};" title="${isFullCalib ? '组内所有列已定标' : '待定标或部分定标'}"></span>
                </button>
              `;
            })
            .join('')}
        </div>

        <!-- 当前选中组属性与操作卡片 -->
        <div style="background: var(--bg-card); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); margin-bottom: 8px;">
          <div style="color: var(--text-primary); font-weight: 600; font-size: var(--font-size-sm); margin-bottom: 6px;">
            当前组: <span style="color: var(--accent-blue);">${currentGroup?.name}</span>
          </div>

          <!-- 单位 / 形态 / 尺度 是同一组参数，按网格对齐：label 一列、控件一列。
               旧实现把单位做成 68px 裸输入框塞在标题行右侧（高 16px、与下面两行不同列、
               不同高），三件事看起来互不相干；现在三行左边界与控件高度都统一。
               单位是「组」属性，也是下游判量纲的唯一依据：列载荷 unit、LiPD units、
               随包 plot_strat.R 的 scale.percent 都读它。 -->
          <div data-role="group-param-grid" style="display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: start; gap: 6px 8px;">
            <label for="grp-unit-inp" style="font-size: var(--font-size-xs); color: var(--text-muted); padding-top: 5px;" title="本组量纲标签（默认 %）。% 的组按 rioja 惯例画（每列按本列最大值归一、画满宽）；非 % 的组按自身量程（min..max）画。">单位</label>
            <div style="display: flex; flex-direction: column; gap: 5px;">
              <input id="grp-unit-inp" type="text" value="${String(groupUnit).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}" placeholder="输入或点击下方预设" style="height: var(--control-h-sm); width: 100%; box-sizing: border-box; font-size: var(--font-size-xs); padding: 0 6px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;" />
              <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                ${(['%', '‰', 'counts', '粒/g', '粒/cm³'] as const)
                  .map(
                    (u) =>
                      `<button type="button" class="ui-btn ui-btn--quiet ui-btn--xs grp-unit-pill ${
                        groupUnit === u ? 'active-mode' : ''
                      }" data-unit="${u}" style="padding: 1px 7px; font-size: var(--font-size-xs);">${u}</button>`
                  )
                  .join('')}
              </div>
            </div>

            <span style="font-size: var(--font-size-xs); color: var(--text-muted);">形态</span>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${(['area', 'bar', 'line', 'symbol'] as const)
                .map(
                  (t) =>
                    `<button class="ui-btn ui-btn--quiet ui-btn--xs grp-plottype-btn ${
                      currentGroup?.plot_type === t ? 'active-mode' : ''
                    }" data-plottype="${t}" style="padding: 1px 7px; font-size: var(--font-size-xs);">${
                      t === 'area' ? '面积' : t === 'bar' ? '柱状' : t === 'line' ? '折线' : '符号'
                    }</button>`
                )
                .join('')}
            </div>

            <span style="font-size: var(--font-size-xs); color: var(--text-muted);">尺度</span>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${(['linear', 'log'] as const)
                .map(
                  (t) =>
                    `<button class="ui-btn ui-btn--quiet ui-btn--xs grp-scaletype-btn ${
                      currentGroup?.scale_type === t ? 'active-mode' : ''
                    }" data-scaletype="${t}" style="padding: 1px 7px; font-size: var(--font-size-xs);">${
                      t === 'linear' ? '线性' : '对数'
                    }</button>`
                )
                .join('')}
            </div>

            <!-- 组级放大倍数：论文里"某些类群 ×5、另一些 ×3"就是一组一个倍率。
                 列级那个输入（Inspector）保留但会在本组 >1 时置灰——组才是真相源。 -->
            <label for="grp-exag-inp" style="font-size: var(--font-size-xs); color: var(--text-muted);" title="${t('step6.groupExagTitle')}">${t('step6.groupExagLabel')}</label>
            <div style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">
              <input id="grp-exag-inp" type="number" min="1" max="100" step="0.5" value="${groupExagInputValue}" placeholder="1"
                     title="${t('step6.groupExagTitle')}"
                     style="height: var(--control-h-sm); width: 72px; box-sizing: border-box; font-size: var(--font-size-xs); padding: 0 6px; background: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px; text-align: right;" />
              <span style="font-size: var(--font-size-xs); color: var(--text-muted);">×</span>
              <!-- ×1 = 明确的"未放大"（issue #107）。「留空」是隐性写法，用户看不出它等
                   于取消放大；给一个显式入口，点它把输入框填成字面 1（不是清空）。
                   后端把 1 归一成 null（store_exaggeration），所以写 1 与写空在库里
                   等价——差别只在用户看见的是"1"还是"一个空格子"。 -->
              <button class="ui-btn ui-btn--quiet ui-btn--xs" id="btn-group-exag-one" style="padding: 1px 7px; font-size: var(--font-size-xs);" title="${t('step6.groupExagOneTitle')}">×1</button>
              ${([3, 5, 10] as const)
                .map(
                  (v) =>
                    `<button class="ui-btn ui-btn--quiet ui-btn--xs grp-exag-btn" data-exag="${v}" style="padding: 1px 7px; font-size: var(--font-size-xs);" title="${t('step6.groupExagTitle')}">${v}×</button>`
                )
                .join('')}
              ${groupExagMult === null ? '' : `<span data-role="exag-active-badge" style="font-size: var(--font-size-xs); color: var(--accent-violet); font-weight: 600;">${groupExagMult}× 启用</span>`}
            </div>
            <div data-role="exag-hint" style="grid-column: 1 / -1; font-size: var(--font-size-xs); line-height: 1.45; color: var(--text-muted); margin-top: -2px;">
              ${t('step6.groupExagHint')}
            </div>
          </div>

          <!-- 组内属种与批量划组管理 -->
          ${
            columnPick.active
              ? `
          <div id="column-pick-bar" style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 8px; margin-bottom: 6px; border: 1px solid var(--accent-blue); border-radius: 4px; background: var(--bg-tertiary);">
            <span style="flex: 1 1 100%; font-size: var(--font-size-xs); color: var(--accent-blue); font-weight: 600;">在图上点击属种列（Shift 连选）</span>
            <span style="font-size: var(--font-size-xs); color: var(--text-secondary);">已选 ${columnPick.ids.length} 列</span>
            <button type="button" id="btn-confirm-column-pick" class="ui-btn ui-btn--primary ui-btn--xs" style="font-size: var(--font-size-xs); padding: 2px 10px; margin-left: auto;" ${columnPick.ids.length === 0 ? 'disabled' : ''}>确认成组</button>
            <button type="button" id="btn-cancel-column-pick" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: var(--font-size-xs); padding: 2px 10px;">取消</button>
          </div>`
              : ''
          }
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 6px;">
            <span style="font-size: var(--font-size-xs); color: var(--text-secondary);">包含 ${groupCols.length} 个属种列:</span>
            <button id="btn-toggle-batch-assign" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: var(--font-size-xs); padding: 1px 6px;">
              ${state.isBatchAssignOpen ? '收起归组列表 ▲' : '批量调整属种归组 ▼'}
            </button>
          </div>

          <!-- 批量归组抽屉面板 -->
          ${
            state.isBatchAssignOpen
              ? `
            <div id="drawer-batch-assign" style="background: var(--bg-tertiary); border: 1px dashed var(--border-color); border-radius: 4px; padding: 6px 8px; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 5px;">
                <span style="font-size: var(--font-size-xs); color: var(--text-muted);">勾选属种，Shift+点击可连选：</span>
                <button type="button" id="btn-group-select-all" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: var(--font-size-xs); padding: 0 5px; margin-left: auto;">全选</button>
                <button type="button" id="btn-group-select-none" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: var(--font-size-xs); padding: 0 5px;">全不选</button>
              </div>
              <div id="group-col-checklist" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 3px; background: var(--bg-card);">
                ${cols
                  .map((c, i) => {
                    const gid = c.x_group_id || activeRoi?.default_group_id;
                    const inThis = gid === currentGroupId;
                    const gname = (groups.find((g) => g.id === gid)?.name) || '默认组';
                    return `
                      <label class="group-col-row" style="display: flex; align-items: center; gap: 5px; padding: 2px 5px; font-size: var(--font-size-xs); cursor: pointer; border-bottom: 1px solid var(--border-color);">
                        <input type="checkbox" class="group-col-check" data-col-id="${c.id}" data-idx="${i}" ${inThis ? 'checked' : ''} style="margin: 0;" />
                        <span style="flex: 1; color: var(--text-primary);">${c.name}</span>
                        <span style="font-size: var(--font-size-xs); color: ${inThis ? 'var(--status-success)' : 'var(--text-muted)'};">${gname}</span>
                      </label>
                    `;
                  })
                  .join('')}
              </div>
              <div style="display: flex; gap: 5px; margin-top: 5px;">
                <button type="button" id="btn-assign-selected-to-group" class="ui-btn ui-btn--primary ui-btn--xs" style="flex: 1; font-size: var(--font-size-xs); padding: 4px;">划入【${currentGroup?.name}】</button>
                <button type="button" id="btn-remove-selected-from-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="flex: 1; font-size: var(--font-size-xs); padding: 4px;">移回默认组</button>
              </div>
            </div>
          `
              : ''
          }
        </div>
        </div><!-- /groups-fold-body -->
      </details>

      <!-- 标定：检测结果 + 轴线粗 + 点齿（首屏主体） -->
      <div class="inspector-section" style="padding: 10px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">


          <div data-role="units-per-cell-hint" style="font-size: var(--font-size-xs); line-height: 1.4; color: var(--text-muted); margin-bottom: 4px;">
            <strong>相邻两个数字标签之差</strong>（标签 10 / 30 → 填 20）。
            <details class="ui-help"><summary>取值规则</summary>
              标签隔一根齿才标数字时取差值的一半。软件不替你猜：填错会让全组读数按同一比例偏掉。
            </details>
          </div>
          <!-- 轴线粗：决定绿线「0 点 = 左缘 + 轴粗」的位置，同时给刻度检测定轴右缘。 -->
          <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px;">
            <label for="inp-axis-stroke" style="font-size: var(--font-size-sm); color: var(--text-muted);">轴线粗细:</label>
            <!-- 显示值**只认当前组自己的** axis_stroke_px。
                 曾经这里还有一个 state.axisStrokeOverride 兜底（全局变量、「全图共用」），
                 于是给 grp2 填 1 之后切到 grp1/grp3，那两个输入框会显示 1 —— 用户读作
                 「已经接过值了」就不再手动设，后端其实仍是 None、绿线回落兜底值
                 （用户原话：「其他两组的线粗框自动就显示 1 了，我以为它直接接过值了」）。
                 本组没值就**显示空**，兜底值只出现在 placeholder 里。 -->
            <input type="number" id="inp-axis-stroke" value="${currentGroup?.axis_stroke_px != null && Number(currentGroup.axis_stroke_px) >= 0 ? String(Number(currentGroup.axis_stroke_px)) : ''}" placeholder="${DEFAULT_AXIS_STROKE_PX}（兜底）" min="0" max="20" step="1"
                   title="Y 轴轴线的描边宽度（像素）。0 点 = 左缘 + 它。填了就不再从像素里猜。目视估读即可（0–20px）。"
                   style="width: 66px; font-size: var(--font-size-sm); padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
            <span style="font-size: var(--font-size-xs); color: var(--text-muted);">px</span>
           <!-- 单列覆盖：组值是初值，逐列差异真实存在（实测 beginner 3/5/5/5），
                只调某列时不该把整组一起改。留空 = 跟随组。 -->
           <div style="display: flex; align-items: center; gap: 6px; width: 100%; margin-bottom: 6px;">
             <label for="inp-col-axis-stroke" style="font-size: var(--font-size-sm); color: var(--text-muted);">仅本列:</label>
             <input type="number" id="inp-col-axis-stroke" value="${axisStrokeColOverride != null ? String(axisStrokeColOverride) : ''}" placeholder="${currentGroup?.axis_stroke_px != null && Number(currentGroup.axis_stroke_px) >= 0 ? String(Number(currentGroup.axis_stroke_px)) : '5'}" min="0" max="20" step="1"
                    title="只改当前这一列的 0 点位置。留空 = 跟随组值。"
                    style="width: 66px; font-size: var(--font-size-sm); padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
             <span style="font-size: var(--font-size-xs); color: var(--text-muted);">px（留空 = 跟随组）</span>
             <!-- 「留空」是隐性操作：用户看不出它等于清除覆盖。给一个显式入口。 -->
             ${axisStrokeColOverride != null
               ? `<button type="button" id="btn-clear-col-axis-stroke" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: var(--font-size-xs); padding: 1px 6px;" title="清除本列的轴粗覆盖，回到组值（发 axis_stroke_px: null）">回到组值</button>`
               : ''}
           </div>
          </div>
          <!-- 轴线粗的来源必须明示（用户原话：「y 轴轴线粗细不需要我提供，就自动给出绿色线吗？」）：
               分列时按灰度层次实测（columns.measure_axis_stroke），测得出就直接用；
               测不出就说清楚是估算，不要静默拿 5px 冒充实测值。 -->
          <div data-role="axis-stroke-source" data-measured="${axisStrokeMeasured ? '1' : '0'}"
               style="font-size: var(--font-size-xs); line-height: 1.45; margin: -2px 0 6px 0; color: ${axisStrokeMeasured ? 'var(--text-muted)' : 'var(--status-warning)'};">
            ${
              axisStrokeColOverride != null
                ? `本列覆盖 <strong>${axisStrokeColOverride}px</strong>（组值 ${currentGroup?.axis_stroke_px != null && Number(currentGroup.axis_stroke_px) >= 0 ? `${Number(currentGroup.axis_stroke_px)}px` : `兜底 ${DEFAULT_AXIS_STROKE_PX}px`}）· 绿线 = 列左缘 + ${axisStrokePx}`
                : currentGroup?.axis_stroke_px != null && Number(currentGroup.axis_stroke_px) >= 0
                  ? `轴线粗实测 <strong>${axisStrokePx}px</strong> · 绿线 = 列左缘 + ${axisStrokePx}`
                  : `轴线粗<strong>无法自动测量</strong>（这几列的左边不是灰度均匀的竖轴），当前按 <strong>${DEFAULT_AXIS_STROKE_PX}px</strong> 估算（兜底值，未实测） —— 绿线可能偏。<strong>目视估读即可</strong>：把你在图上看到的轴宽（0–20px，0 表示 0 点就在列左缘）填进上面的「轴线粗细」，改完绿线立刻按「左缘 + 轴粗」重画，不必精确到亚像素`
            }
          </div>

          <!-- ── X 轴标定（组级）────────────────────────────────────────
               一次动作定整组：点一个刻度齿 + 填它旁边的数字
               → 斜率 = 数字 / 距0点px。组内所有列共用斜率，每列 0 点各自算。
               不依赖"检测到几个齿"，所以漏齿、齿数不一致都不影响。 -->
          <div data-role="tick-calib" style="border-top: 1px dashed var(--border-color); margin-top: 8px; padding-top: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px;">
              <span style="font-size: var(--font-size-sm); font-weight: 600; color: var(--text-secondary);">X 轴标定（本组共用）</span>
              ${
                currentGroup?.value_per_px != null && Number(currentGroup.value_per_px) !== 0
                  ? `<span data-role="slope-readout" style="font-size: var(--font-size-xs); color: var(--status-success);">已标定 · ${Number(currentGroup.value_per_px).toFixed(4)} ${groupUnit}/px</span>`
                  : '<span style="font-size: var(--font-size-xs); color: var(--status-warning);">未标定</span>'
              }
            </div>
            <!-- 防双重折算：这组列画的是放大后的高度，图上满刻度 = 真实量程 × 倍率。
                 只写一句"注意别重复乘"没用，必须给出换算后的真实量程——两个数都由
                 组斜率、本组平均列宽、组倍率现算。 -->
            ${exagRange === null ? '' : `
            <div data-role="exag-range-hint" style="font-size: var(--font-size-xs); line-height: 1.5; margin-bottom: 5px; padding: 4px 6px; border-radius: 4px; background: rgba(139,92,246,0.10); border: 1px dashed rgba(139,92,246,0.45); color: var(--text-secondary);">
              <strong style="color: var(--accent-violet);">${t('step6.groupExagRangeTitle')}</strong>
              <div>${t('step6.groupExagRangeValues', {
                figure: exagRange.onFigure.toFixed(3),
                real: exagRange.real.toFixed(3),
                unit: groupUnit,
                slope: Number(currentGroup?.value_per_px).toFixed(4),
                width: groupAvgWidth.toFixed(0),
              })}</div>
            </div>`}
            ${
              state.pendingTick
                ? `
            <div data-role="pending-tick" style="font-size: var(--font-size-sm); line-height: 1.6; margin-bottom: 6px; padding: 6px 8px; background: var(--bg-tertiary); border-radius: 4px;">
              已选齿：<code style="color: var(--accent-blue);">x = ${state.pendingTick.px}px</code>
              · 距 0 点 <strong>${state.pendingTick.dist.toFixed(0)}px</strong>
              ${
                state.pendingTick.dist < 20
                  ? '<div style="color: var(--status-warning); margin-top: 3px;"><strong>注意：</strong>离 0 点太近，±1px 就会让斜率偏几个百分点，建议点更远的齿。</div>'
                  : ''
              }
            </div>
            <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
              <label for="inp-tick-value" style="font-size: var(--font-size-sm); color: var(--text-muted);">这个齿的数字:</label>
              <input type="number" id="inp-tick-value" placeholder="如 10"
                     style="width: 72px; font-size: var(--font-size-sm); padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: var(--font-size-xs); color: var(--text-muted);">${groupUnit}</span>
            </div>
            <div style="display: flex; gap: 6px;">
              <button id="btn-apply-tick-calib" class="ui-btn ui-btn--primary" style="flex: 1; font-size: var(--font-size-sm); padding: 5px 6px;">应用</button>
              <button id="btn-cancel-tick-calib" class="ui-btn ui-btn--quiet" style="font-size: var(--font-size-xs); padding: 5px 8px;">取消</button>
            </div>`
                : `
            <button id="btn-pick-tick" class="ui-btn ui-btn--primary" style="width: 100%; font-size: var(--font-size-sm); padding: 6px;">
              点一个刻度齿
            </button>
            <div style="font-size: var(--font-size-xs); line-height: 1.45; color: var(--text-muted); margin-top: 4px;">
              点<strong>离绿线（0 点）最远</strong>的那个带标签的齿更准；点完输入它旁边的数字即可。
            </div>`
            }
          </div>
        </div>

      ${
        activeCol?.zero_point_measurable === false
          ? `
      <div class="inspector-section" data-role="zero-point-warning"
           style="padding: 8px 10px; background: rgba(245, 158, 11, 0.12); border: 1px solid var(--status-warning); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: var(--font-size-sm); font-weight: 700; color: var(--status-warning); margin-bottom: 3px;">
          注意：该列 0 点不可自动测量
        </div>
        <div style="font-size: var(--font-size-xs); line-height: 1.45; color: var(--text-secondary);">
          这一列左缘没有贯穿整列的竖轴（可能不是真正的面板，或轴太淡）。
          <strong>0 点 = 左缘 + 轴线粗</strong> 这个公式在这里不成立，所以本列
          <strong>不给数</strong>（导出记 NA）—— 请在下方手动填入 0 点像素，或确认该列是否应删除。
        </div>
      </div>`
          : ''
      }


      <!-- 阶段提交按钮：由 Inspector 在挂载后提到滚动容器之外（data-role="step-primary-action"）。
           贴在滚动区里的 sticky 按钮必然盖住它下方的内容：1280×720 实测与分组按钮的矩形相交，
           用户既看不见也点不着。挪进 .inspector-footer 后既恒定可见，又与任何控件不相交。 -->
      <button id="btn-apply-xticks-next" data-role="step-primary-action" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: var(--font-size-md);">
        ${t('step6.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  // 折叠状态存进 state 并在这里回写：面板每次 onDataChange 都整块重渲染，DOM 一换
  // <details> 就回到默认闭合——用户在折叠区里点一下按钮、区块自己合上，等于把操作对象藏起来。
  const groupsFold = root.querySelector<HTMLDetailsElement>('details[data-role="groups-fold"]');
  groupsFold?.addEventListener('toggle', () => {
    state.groupsFoldOpen = groupsFold.open;
  });
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

  /**
   * 真正生效的组 id。
   *
   * `selectedGroupId` 只在用户点过组 Tab 之后才有值；首屏（含默认组）它是 null。
   * 旧写法直接拿它去写，于是「没切过 Tab 就点形态/单位」是**静默无操作** —— 按钮
   * 看着能点，点了什么都不发生。回退规则必须与 `render()` 解析 currentGroup 的那套一致。
   */
  const effectiveGroupId = (): string | undefined => {
    const roi = activeRoi();
    return state.selectedGroupId || roi?.default_group_id || roi?.x_groups?.[0]?.id;
  };

  /** 生效组当前的单位（空串/缺省一律按 % 显示，与后端默认一致）。 */
  const effectiveGroupUnit = (): string => {
    const roi = activeRoi();
    const gid = effectiveGroupId();
    return roi?.x_groups?.find((g) => g.id === gid)?.unit || '%';
  };

  // 组级写入的唯一通路：形态 / 尺度 / 单位 / 单位刻度长度 / 轴线粗 都是组的属性。
  // **放在所有使用点之前** —— 之前它在 axis-stroke 的 handler 之后，直接引用会撞 TDZ。
  // #37 把这里改成 async + notifyError（失败必须冒泡）；本分支补上生效组回退。
  // 两者必须同时存在：只取 #37 版会让首屏点形态/单位继续静默无操作，
  // 只取本分支版会把 #37 的失败冒泡丢掉。
  const patchGroup = async (field: Record<string, unknown>): Promise<boolean> => {
    const gid = effectiveGroupId();
    const roiId = activeRoi()?.id;
    const client = ctx.rpcClient as
      | { roiGroupUpdate?: (r: string, g: string, p: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    if (!gid || !roiId || !client?.roiGroupUpdate) return false;
    try {
      await client.roiGroupUpdate(roiId, gid, field);
    } catch (err) {
      // 失败必须冒泡：旧实现是 `void client.roiGroupUpdate(...).then(...)`，没有
      // `.catch` —— 后端拒绝时用户看到的是"点了没反应"，连一条提示都没有。
      notifyError(`保存列组属性失败：${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    ctx.onDataChange?.();
    return true;
  };

  // 画布点选齿 → 记录"距本列 0 点多少"。判定在面板侧，画布只报坐标。
  setTickPickedHandler((pt) => {
    const data = state.cachedData;
    const columns = (data?.columns ?? []) as NonNullable<DiagramData['columns']>;
    // 点哪一列的齿就标哪一列（见 `resolveColumnAtX` 的注释）：旧实现恒用
    // `activeColumn()`，多列图上只有第一列（活动列）能标，其余列点了等于在改别处。
    //
    // 归属必须**先按活动有效区过滤**：多 ROI 图上两个分区的列区间可以整段重叠
    // （实测 tree 315–1946 与 herb 161–1899），按数组顺序取第一个命中会在 herb
    // 活动区里把点击解析回 tree 的列，于是 herb 自己的齿被判「没有检测到刻度齿」。
    const hit = resolveColumnAtX(columns, data, pt.x);
    if (!hit) {
      notifyError('点选位置不在任何一列的取数带内。请点在某一列的刻度齿上。');
      return;
    }
    if (!hit.inActiveRoi) {
      // 只在别的分区命中：必须指名那个分区，不能退回「此处没有检测到刻度齿」
      // ——那等于把"有齿但属于别的分区"说成"没齿"。
      const otherName =
        data?.rois?.find((r) => r.id === hit.roiId)?.name || hit.roiId || '另一个有效区';
      const activeName =
        data?.rois?.find((r) => r.id === data?.active_roi_id)?.name ||
        data?.active_roi_id ||
        '当前有效区';
      notifyError(
        `这条齿属于有效区「${otherName}」的列，当前活动区是「${activeName}」。` +
          `请先把「${otherName}」设为活动区再来点它的齿。`
      );
      return;
    }
    const col = hit.col;
    const roi = data?.rois?.find((r) => r.id === (col.roi_id ?? data?.active_roi_id));
    const g = resolveColumnGroup(col, roi);
    // 0 点 = 列左缘 + 轴线粗（与画布绿线同源，见 ARCHITECTURE §6.4）。
    // `start` 是轴线左缘（列切分线），轴粗取组参数，兜底 `DEFAULT_AXIS_STROKE_PX`。
    const stroke = resolveAxisStroke(col, g);
    const start = Number(
      (col as unknown as Record<string, number>).startX ??
        (col as unknown as Record<string, number>).start ??
        0
    );
    const zero = start + stroke;

    // 位置完全由用户决定：不吸附任何检测结果。点错了照样记下来，再点一次即覆盖
    // （用户制度：手动标定；ARCHITECTURE §6.4:254 明确不拿检测齿当锚点）。
    // 唯一拒绝的情况是落在 0 点或左侧 —— 对斜率没有意义（v(x) = (x − 0 点) × 斜率）。
    if (pt.x <= zero) {
      notifyError('请点在绿线（0 点）右侧的刻度上；0 点及其左侧无法确定斜率。');
      return;
    }
    state.pendingTick = { px: Math.round(pt.x), dist: pt.x - zero };
    // 只在**吸附成功**后切换选中列：点在空处不该改选中，否则用户以为点中了。
    if (col.id !== data?.activeTaxaId) ctx.onSelectTaxa?.(col.id);
    ctx.onDataChange?.();
  });

  root.querySelector('#btn-goto-step5-split')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(5);
  });


  // 标尺输入：轴线粗（组/列）、单位刻度长度、检测刻距
  const wireRulerInputs = (): void => {
    // 轴线粗细：**组级参数**，写当前生效的那一组（`effectiveGroupId`）。
    // 它决定绿线「0 点 = 左缘 + 轴粗」的位置，同时作为刻度检测时 `_find_axis_x` 的右缘判据。
    //
    // 显示与写入都以**本组自己的** `axis_stroke_px` 为准，不再有跨组的全局兜底：
    // 乐观显示走「把这一个组对象上的值先改掉，再整块重渲染」——组是镜像里的真实对象，
    // 写失败就回滚它。这样 grp2 填 1 不会让 grp1/grp3 的输入框跟着显示 1。
    root.querySelector('#inp-axis-stroke')?.addEventListener('change', (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const parsed = raw === '' ? null : Number.parseFloat(raw);
      const next =
        parsed != null && Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 20) : null;
      const group = activeRoi()?.x_groups?.find((g) => g.id === effectiveGroupId());
      if (!group) return;
      const previous = group.axis_stroke_px ?? null;
      group.axis_stroke_px = next ?? undefined;
      ctx.onDataChange?.();
      void patchGroup({ axis_stroke_px: next }).then((ok) => {
        // 写失败必须把本组的值撤回原样：继续显示 1 等于骗用户「已经设上了」。
        // （`patchGroup` 自己已经 `notifyError` 冒泡过失败原因。）
        if (!ok) {
          group.axis_stroke_px = previous ?? undefined;
          ctx.onDataChange?.();
        }
      });
    });

    // 单列覆盖：只改当前列的 0 点位置（组值仍是初值）。留空 = 清掉覆盖、回到组值。
    // 列级字段分列时不会写，所以这里写的值跨会话保留；改完必须整块重渲染——
    // 0 点像素是渲染时写进模板的（与上面组输入框同理）。
    root.querySelector('#inp-col-axis-stroke')?.addEventListener('change', (e) => {
      const raw = (e.target as HTMLInputElement).value.trim();
      const parsed = raw === '' ? null : Number.parseFloat(raw);
      if (parsed != null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 20)) {
        notifyError('单列轴线粗必须是 0–20 之间的数值；要清除覆盖请留空。');
        return;
      }
      const col = activeColumn();
      if (!col) return;
      void ctx.rpcClient
        .updateColumn(columnIndex(col), { axis_stroke_px: parsed })
        .then(() => ctx.onDataChange?.());
    });

    // 清除本列覆盖：显式入口（`null` = 回到组值）。
    // 不写 0：后端 `column.update` 会当场拒绝 0/负数（那会把绿线压到红线上，
    // 整列读数系统性偏小一个轴粗），见 tests/unit/test_edit_and_export_api.py。
    root.querySelector('#btn-clear-col-axis-stroke')?.addEventListener('click', () => {
      const col = activeColumn();
      if (!col) return;
      void ctx.rpcClient
        .updateColumn(columnIndex(col), { axis_stroke_px: null })
        .then(() => ctx.onDataChange?.())
        .catch((err: unknown) =>
          notifyError(
            `清除本列轴粗覆盖失败：${err instanceof Error ? err.message : String(err)}`
          )
        );
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
      setGroupCalibMark(state.selectedGroupId, { px: state.pendingTick.px, reading: value });
      patchGroup({ value_per_px: slope });
      state.pendingTick = null;
      notify(`已按「${value} 对应 ${pickedDist.toFixed(0)}px」标定本组：斜率 ${slope.toFixed(3)}`, 'info');
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

    // 组级放大倍数：输入框（留空 = 清除）+ 3×/5×/10× 快捷键。
    // 写的是**组**上的 `exaggeration_mult`（组是真源），走 `patchGroup` 这唯一通路
    // —— 它负责 `roi.groupUpdate(roi_id, group_id, {...})`、失败冒泡与 onDataChange。
    const exagInput = root.querySelector<HTMLInputElement>('#grp-exag-inp');
    const currentGroupExag = (): number | null => {
      const roi = activeRoi();
      const gid = effectiveGroupId();
      const group = roi?.x_groups?.find((g) => g.id === gid);
      return isGroupExaggerated(group?.exaggeration_mult)
        ? normalizeGroupExaggeration(group?.exaggeration_mult)
        : null;
    };
    // 「×1 显示成字面 1」的标记：按组记，任何非 ×1 的写入都把它清掉。
    const markExplicitOne = (gid: string | undefined, on: boolean): void => {
      if (!gid) return;
      state.explicitOneGroupIds = on
        ? Array.from(new Set([...state.explicitOneGroupIds, gid]))
        : state.explicitOneGroupIds.filter((id) => id !== gid);
    };
    const writeGroupExag = (value: number | null, opts: { keepOne?: boolean } = {}): void => {
      const gid = effectiveGroupId();
      const showOne = opts.keepOne === true && value === null;
      markExplicitOne(gid, showOne);
      void patchGroup({ exaggeration_mult: value }).then((ok) => {
        // 写失败就不能继续显示用户刚点的 1：面板会按组上的真值重渲染。
        if (!ok && showOne) markExplicitOne(gid, false);
      });
    };
    root.querySelectorAll('.grp-exag-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const value = normalizeGroupExaggeration(btn.getAttribute('data-exag'));
        if (value !== null) writeGroupExag(value);
      });
    });
    // ×1：把输入框填成字面 1 并取消放大。写 null 而不是写 1——后端把 1 归一成 None，
    // 两者在库里等价，但只有 null 能保证不留下一个会被 `px_to_value` 真除的因子。
    root.querySelector('#btn-group-exag-one')?.addEventListener('click', () => {
      writeGroupExag(null, { keepOne: true });
    });
    if (exagInput) {
      exagInput.addEventListener('keydown', (ev) => {
        if ((ev as KeyboardEvent).key === 'Enter') exagInput.blur();
      });
      exagInput.addEventListener('change', () => {
        const raw = exagInput.value.trim();
        // 清空 = 取消放大（发 null）。留空仍是合法状态，既有工程不受影响（issue #107）。
        if (raw === '') {
          writeGroupExag(null);
          return;
        }
        const parsed = normalizeGroupExaggeration(raw);
        if (parsed === null) {
          // 手敲 `1`（以及任何 ≤1，**含 0 与负数**）必须和点 ×1 等价（issue #107）：
          // 倍率 ≤1 物理上就等于"不放大"——×1 是恒等变换、×0 把整列刻度压成一条线、
          // 负数在丰度/计数上没有含义；后端 `store_exaggeration` 也一律落成"未放大"。
          // 旧实现把手敲的 1 当非法输入弹错，于是"按钮说 1 合法、手输 1 报错"。
          const numeric = Number(raw);
          if (Number.isFinite(numeric) && numeric <= 1) {
            writeGroupExag(null, { keepOne: true });
            return;
          }
          // 就地回填旧值，不重建 DOM：重建会让用户看不到自己刚才填了什么。
          const previous = currentGroupExag();
          exagInput.value = previous === null ? '' : String(previous);
          notifyError(t('step6.groupExagInvalid'));
          return;
        }
        writeGroupExag(parsed);
      });
    }

    // 组单位：回车即提交（不等 blur），空串就地回填并提示（后端也会拒）。
    const unitInput = root.querySelector<HTMLInputElement>('#grp-unit-inp');
    if (!unitInput) return;
    unitInput.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') unitInput.blur();
    });
    unitInput.addEventListener('change', () => {
      const raw = (unitInput.value || '').trim();
      const current = effectiveGroupUnit();
      if (!raw) {
        unitInput.value = current;
        notifyError('单位不能为空：它决定导出与随包 R 脚本按不按百分比画。');
        return;
      }
      if (raw === current) return;
      patchGroup({ unit: raw });
    });

    // 预设单位药丸点击：点击即写组单位
    root.querySelectorAll<HTMLButtonElement>('.grp-unit-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        const u = btn.getAttribute('data-unit');
        if (!u) return;
        const current = effectiveGroupUnit();
        if (u === current) return;
        unitInput.value = u;
        patchGroup({ unit: u });
      });
    });
  };
  wireGroupAttributes();






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
          notify(`已合并 ${mergedCount} 个标度相同的列组。`, 'success');
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
