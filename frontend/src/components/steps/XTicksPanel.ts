import { DiagramData, ColumnGroup } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notify, notifyError } from '../../ui/feedback';
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

function getColCalibX(col: any): number {
  if (col?.x_ticks && col.x_ticks.length >= 2 && col.x_ticks[1].px > col.startX) {
    return col.x_ticks[1].px;
  }
  if (col?.tickEndX && col.tickEndX > col.startX) {
    return col.tickEndX;
  }
  if (col?.scaleCalib?.calibX && col.scaleCalib.calibX > col.startX) {
    return col.scaleCalib.calibX;
  }
  const span = (col?.endX ?? 100) - (col?.startX ?? 0);
  return (col?.startX ?? 0) + Math.max(20, Math.min(span * 0.65, 80));
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
        ref_span_px: 40.0,
        ref_val_start: 0,
        ref_val_end: 20,
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
  const groupCalibratedCols = groupCols.filter((c) => c.x_ticks && c.x_ticks.length === 2).length;

  // 提取该组的参考标尺跨度
  let refSpan = currentGroup?.ref_span_px;
  if (!refSpan || refSpan <= 0) {
    // 尝试从该组内已有标定列推导
    const firstCal = groupCols.find((c) => c.x_ticks && c.x_ticks.length === 2);
    if (firstCal && firstCal.x_ticks) {
      refSpan = Math.round(Math.abs(firstCal.x_ticks[1].px - firstCal.x_ticks[0].px) * 10) / 10;
    } else {
      refSpan = 40.0;
    }
  }
  const refVal1 = currentGroup?.ref_val_start ?? 0;
  const refVal2 = currentGroup?.ref_val_end ?? 20;
  const groupUnit = currentGroup?.unit || '%';

  const px1 = activeCol?.startX ?? 0;
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
            <button id="btn-create-new-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 1px 6px; color: var(--accent-blue);" title="新建一个独立的列组（如炭屑浓度、优势种单列）">+ 新建组</button>
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
              形态: <strong>${currentGroup?.plot_type}</strong> | 单位: <strong>${groupUnit}</strong>
            </div>
          </div>

          <!-- 组内属种与批量划组管理 -->
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
              <div style="font-size: 9.5px; color: var(--text-muted); margin-bottom: 5px;">点击属种快速加入或移出当前组【${currentGroup?.name}】：</div>
              <div style="display: flex; flex-wrap: wrap; gap: 3px; max-height: 120px; overflow-y: auto;">
                ${cols
                  .map((c) => {
                    const inThis = (c.x_group_id || activeRoi?.default_group_id) === currentGroupId;
                    return `
                      <button
                        type="button"
                        class="btn-toggle-col-group-membership ui-btn ${inThis ? 'ui-btn--primary' : 'ui-btn--quiet'}"
                        data-col-id="${c.id}"
                        style="font-size: 9.5px; padding: 1px 5px; border-radius: 3px; border: 1px solid var(--border-color);"
                        title="${inThis ? '点击移出当前组' : '点击划入当前组'}"
                      >
                        ${inThis ? '[已选] ' : ''}${c.name}
                      </button>
                    `;
                  })
                  .join('')}
              </div>
            </div>
          `
              : ''
          }
        </div>

        <!-- 核心武器：组参考标尺模数设定与应用 -->
        <div style="background: var(--bg-card); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--accent-blue); box-shadow: 0 0 0 1px rgba(56,189,248,0.15); margin-bottom: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="font-size: 11px; font-weight: 700; color: var(--accent-blue); display: flex; align-items: center; gap: 4px;">
              <span>参考标尺模数 (Reference Scale)</span>
            </span>
            <span style="font-size: 9.5px; color: ${groupCalibratedCols === groupCols.length && groupCols.length > 0 ? 'var(--status-success)' : 'var(--text-muted)'}; font-weight: 600;">
              已标定 ${groupCalibratedCols}/${groupCols.length} 列
            </span>
          </div>

          <div style="font-size: 10px; color: var(--text-secondary); line-height: 1.4; margin-bottom: 6px;">
            在图版任意清晰刻度尺上测量两点物理距离，以各列自身左基线为锚点<strong>一键刚体平移</strong>对齐全组，杜绝窄列压缩与全体偏差！
          </div>

          <!-- 物理跨度与刻度读数参数框 -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px;">
            <div style="background: var(--bg-tertiary); padding: 5px 6px; border-radius: 4px; border: 1px solid var(--border-color);">
              <label for="inp-ref-ruler-span" style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 2px;">物理跨度 (ΔX):</label>
              <div style="display: flex; align-items: center; gap: 3px;">
                <input type="number" id="inp-ref-ruler-span" step="0.5" value="${refSpan}" style="width: 100%; font-size: 11px; padding: 2px 4px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); text-align: right;" />
                <span style="font-size: 10px; color: var(--text-muted);">px</span>
              </div>
            </div>

            <div style="background: var(--bg-tertiary); padding: 5px 6px; border-radius: 4px; border: 1px solid var(--border-color);">
              <label for="inp-ref-val2" style="font-size: 10px; color: var(--text-muted); display: block; margin-bottom: 2px;">对应量程数值:</label>
              <div style="display: flex; align-items: center; gap: 2px;">
                <input type="number" id="inp-ref-val1" value="${refVal1}" style="width: 32px; font-size: 11px; padding: 2px 3px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); text-align: right;" title="起点读数 (通常为 0)" />
                <span style="font-size: 9px; color: var(--text-muted);">~</span>
                <input type="number" id="inp-ref-val2" value="${refVal2}" style="width: 44px; font-size: 11px; padding: 2px 3px; border-radius: 3px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); text-align: right;" title="刻度终点读数 (如 20 或 50)" />
                <span style="font-size: 10px; color: var(--text-muted);">${groupUnit}</span>
              </div>
            </div>
          </div>

          <!-- 测距拾取提示浮层 (监听 measure 事件自动更新) -->
          <div id="notice-ruler-measured" style="display: none; font-size: 10px; color: var(--status-success); background: rgba(16,185,129,0.1); border: 1px solid var(--status-success); padding: 4px 6px; border-radius: 4px; margin-bottom: 6px;"></div>

          <!-- 标尺操作按钮群 -->
          <div style="display: flex; gap: 6px;">
            <button id="btn-measure-ruler-on-canvas" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex: 1; font-size: 10.5px; padding: 5px 6px;" title="激活测距工具，在图版底图标尺两端按下拖拽拉线即可自动拾取跨度">
              [拉尺测距] 在底图标尺拉线
            </button>
            <button id="btn-apply-group-scale" class="ui-btn ui-btn--primary ui-btn--xs" style="flex: 1.3; font-size: 10.5px; padding: 5px 6px;" title="将上述标尺跨度作为绝对刚体模数应用到属于本组的所有属种列">
              [对齐标尺] 刚体应用到本组 (${groupCols.length}列)
            </button>
          </div>
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
              <input type="number" id="inp-manual-tick-val1" value="${hasTicks ? activeCol.x_ticks![0].value : (activeCol?.startValue ?? 0)}" style="width: 60px; font-size: 11px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: 10.5px; color: var(--text-muted); min-width: 16px;">${activeCol?.unit || groupUnit}</span>
            </div>
          </div>
          <div style="font-size: 9.5px; color: var(--text-muted); padding-left: 13px;">
            像素位置: <code>X = ${Math.round(px1)}px</code> (基线原点)
          </div>

          <div style="height: 1px; background: var(--border-color); opacity: 0.5; margin: 1px 0;"></div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <label for="inp-manual-tick-val2" style="font-size: 11px; color: var(--text-secondary); font-weight: 500; display: flex; align-items: center; gap: 5px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--status-success);"></span>
              <span>右刻度齿点 (X2):</span>
            </label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" id="inp-manual-tick-val2" value="${hasTicks ? activeCol.x_ticks![1].value : (activeCol?.tickValue ?? refVal2)}" style="width: 60px; font-size: 11px; padding: 2px 4px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: 10.5px; color: var(--text-muted); min-width: 16px;">${activeCol?.unit || groupUnit}</span>
            </div>
          </div>
          <div style="font-size: 9.5px; color: var(--text-muted); padding-left: 13px;">
            像素位置: <code>X = ${Math.round(px2)}px</code> (跨度 ${(px2 - px1).toFixed(1)}px)
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

  // 3. 批量归组中点击属种标签即时转移
  root.querySelectorAll('.btn-toggle-col-group-membership').forEach((el) => {
    el.addEventListener('click', async () => {
      const colId = (el as HTMLElement).dataset.colId;
      const roi = activeRoi();
      const col = cachedData?.columns.find((c) => c.id === colId);
      if (!col || !roi || !selectedGroupId || !ctx.rpcClient) return;

      const currentG = col.x_group_id || roi.default_group_id;
      // 若已在当前组，移回默认组；否则移入当前选中的组
      const newGroupId = currentG === selectedGroupId ? roi.default_group_id : selectedGroupId;

      try {
        await ctx.rpcClient.updateColumn(columnIndex(col), { x_group_id: newGroupId } as any);
        col.x_group_id = newGroupId;
        ctx.onDataChange?.();
      } catch (err) {
        notifyError(err instanceof Error ? err.message : String(err));
      }
    });
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
  root.querySelector('#btn-create-new-group')?.addEventListener('click', async () => {
    const roi = activeRoi();
    const activeCol = activeColumn();
    if (!roi || !ctx.rpcClient) return;

    const grpName = prompt('请输入新列组名称（例如：优势种100%组、炭屑浓度组）：', `组 ${(roi.x_groups?.length || 0) + 1}`);
    if (!grpName || !grpName.trim()) return;

    try {
      const res = await ctx.rpcClient.roiGroupCreate(roi.id, {
        name: grpName.trim(),
        unit: activeCol?.unit || '%',
        plot_type: activeCol?.plot_type || activeCol?.plotType || 'area',
        scale_type: activeCol?.scale_type || 'linear',
      });
      roi.x_groups = roi.x_groups || [];
      roi.x_groups.push(res.group);
      selectedGroupId = res.group.id;
      ctx.onDataChange?.();
      notify(`已创建新列组【${res.group.name}】，可点选属种划入本组。`, 'success');
    } catch (err) {
      notifyError(err instanceof Error ? err.message : String(err));
    }
  });

  // 6. 激活图上拉线测标尺模式
  root.querySelector('#btn-measure-ruler-on-canvas')?.addEventListener('click', () => {
    if (ctx.onSetToolMode) {
      ctx.onSetToolMode('measure');
      notify('已激活标尺测距：请在底图任意清晰的刻度尺两端拖拽拉线，像素距离将自动填入！', 'info');
    } else {
      notify('请直接在画布上使用【测量工具】拉取已知标尺的两端点。', 'info');
    }
  });

  // 监听测距完成事件，自动回填测量像素
  const onRulerMeasured = (e: Event) => {
    const custom = e as CustomEvent<{ dx: number; dy: number; dist: number }>;
    if (!custom.detail || typeof custom.detail.dx !== 'number') return;
    const dx = Math.round(custom.detail.dx * 10) / 10;
    const spanInput = root.querySelector('#inp-ref-ruler-span') as HTMLInputElement | null;
    if (spanInput) {
      spanInput.value = String(dx);
      // 显示直观高亮通知
      const noticeBox = root.querySelector('#notice-ruler-measured') as HTMLElement | null;
      if (noticeBox) {
        noticeBox.style.display = 'block';
        noticeBox.innerHTML = `已从底图标尺拾取物理跨度: <strong>${dx} px</strong>！确认数值后点击下方按钮即可全组对齐。`;
      }
    }
  };
  window.addEventListener('straditize:measure-ruler', onRulerMeasured, { once: true });

  // 7. 一键应用本组参考标尺到所有组内列 (核心刚体平移对齐)
  root.querySelector('#btn-apply-group-scale')?.addEventListener('click', async () => {
    const roi = activeRoi();
    if (!cachedData || !roi || !ctx.rpcClient) return;

    const spanRaw = (root.querySelector('#inp-ref-ruler-span') as HTMLInputElement)?.value ?? '';
    const val1Raw = (root.querySelector('#inp-ref-val1') as HTMLInputElement)?.value ?? '0';
    const val2Raw = (root.querySelector('#inp-ref-val2') as HTMLInputElement)?.value ?? '20';

    const spanPx = Number.parseFloat(spanRaw);
    const val1 = Number.parseFloat(val1Raw);
    const val2 = Number.parseFloat(val2Raw);

    if (!Number.isFinite(spanPx) || spanPx <= 0) {
      notifyError('标尺像素跨度必须是大于 0 的有效数值。');
      return;
    }
    if (!Number.isFinite(val1) || !Number.isFinite(val2) || val1 === val2) {
      notifyError('刻度起始值与终止值必须是有效且不相等的数字。');
      return;
    }

    const currentG = (roi.x_groups || []).find((g) => g.id === selectedGroupId) || (roi.x_groups || [])[0];
    const targetGroupId = currentG?.id || roi.default_group_id;
    const targetRoiId = roi.id;

    // 筛选归属于本组的所有列
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

    // 记录组级标尺模数
    if (currentG) {
      currentG.ref_span_px = spanPx;
      currentG.ref_val_start = val1;
      currentG.ref_val_end = val2;
    }

    let successCount = 0;
    for (const col of targetCols) {
      const colIdx = columnIndex(col);
      // 刚体对齐：以该列自身左基线 startX 为零点，严格加上物理跨度 spanPx！
      const p1 = col.startX;
      const p2 = col.startX + spanPx;

      try {
        const res = await ctx.rpcClient.calibrateColumnXTicks(
          colIdx,
          [
            { px: p1, value: val1 },
            { px: p2, value: val2 },
          ],
          unit
        );
        col.x_ticks = res.x_ticks;
        col.tickEndX = p2;
        col.maxPercent = val2;
        successCount++;
      } catch (err) {
        console.warn(`[XTicksPanel] 标定列 ${col.name} 失败:`, err);
      }
    }

    if (successCount > 0) {
      notify(
        `成功将标尺模数 (${spanPx}px = ${val1}~${val2}${unit}) 严格刚体对齐应用到【${currentG?.name || '默认组'}】全部 ${successCount} 个属种！`,
        'success'
      );
      ctx.onDataChange?.();
      await syncXTicksDroppedFromBackend(cachedData, ctx);
    }
  });

  // 8. 单列微调保存
  root.querySelector('#btn-save-manual-ticks')?.addEventListener('click', () => {
    const activeCol = activeColumn();
    if (!activeCol) return;
    const val1Raw = (root.querySelector('#inp-manual-tick-val1') as HTMLInputElement)?.value ?? '';
    const val2Raw = (root.querySelector('#inp-manual-tick-val2') as HTMLInputElement)?.value ?? '';
    void (async () => {
      await callStepCallback(() => ctx.onCalibrateXTicks?.(columnIndex(activeCol), val1Raw, val2Raw));
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
