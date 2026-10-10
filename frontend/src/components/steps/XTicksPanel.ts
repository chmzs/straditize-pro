import { DiagramData, ColumnGroup } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { notify, notifyError } from '../../ui/feedback';

export const step = 6;
export const title = '6. 标定列与 X 刻度';

let cachedData: DiagramData | null = null;

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

  // Active ROI and group resolution (Design 2026-09-29 P3)
  const activeRoi =
    data.rois?.find((r) => r.id === (activeCol?.roi_id || data.active_roi_id || data.rois[0]?.id)) ||
    data.rois?.[0];
  const groups: ColumnGroup[] = activeRoi?.x_groups || [];
  const currentGroupId = activeCol?.x_group_id || activeRoi?.default_group_id || groups[0]?.id;
  const activeGroup = groups.find((g) => g.id === currentGroupId) || groups[0];

  const px1 = activeCol?.startX ?? 0;
  const px2 = getColCalibX(activeCol);

  return `
    <div class="step-panel" data-step="6">
      <div class="step-title">${t('step6.title')}</div>

      <!-- 全局标定进度指示 -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 6px 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px; font-size: 11px;">
        <span style="color: var(--text-secondary); font-weight: 500;">${t('step6.progress')}</span>
        <span style="font-weight: 700; color: ${calibratedCols === totalCols ? 'var(--status-success)' : 'var(--accent-blue)'};">
          ${calibratedCols} / ${totalCols} 列 (${pct}%)
        </span>
      </div>

      <div class="step-desc" style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px;">
        <div>
          ${t('step6.activeCol')}<strong style="color: var(--accent-blue);">${colName}</strong>
        </div>
        <span style="font-size: 10.5px; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${hasTicks ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${hasTicks ? 'var(--status-success)' : 'var(--status-warning)'};">
          ${hasTicks ? t('step6.calibrated') : t('step6.uncalibrated')}
        </span>
      </div>

      <!-- 主区域：当前列 X 刻度标尺两点定标 -->
      <div class="inspector-section" style="padding: 10px; background: var(--bg-tertiary); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 11.5px; font-weight: 700; color: var(--text-heading);">当前列刻度标尺</span>
          ${hasTicks ? `<button id="btn-clear-col-ticks" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; color: var(--accent-red); padding: 1px 6px;" title="${t('step6.clearTicks')}">${t('step6.clearTicks')}</button>` : ''}
        </div>

        <!-- 刻度端点输入卡片 -->
        <div style="display: flex; flex-direction: column; gap: 6px; background: var(--bg-card); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); margin-bottom: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <label for="inp-manual-tick-val1" style="font-size: 11px; color: var(--text-secondary); font-weight: 500; display: flex; align-items: center; gap: 5px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent-blue);"></span>
              <span>左基线原点 (X1):</span>
            </label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" id="inp-manual-tick-val1" value="${hasTicks ? activeCol.x_ticks![0].value : (activeCol?.startValue ?? 0)}" style="width: 64px; font-size: 11px; padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: 10.5px; color: var(--text-muted); min-width: 16px;">${activeCol?.unit || '%'}</span>
            </div>
          </div>
          <div style="font-size: 9.5px; color: var(--text-muted); padding-left: 13px;">
            像素位置: <code>X = ${Math.round(px1)}px</code> (列左边界)
          </div>

          <div style="height: 1px; background: var(--border-color); opacity: 0.5; margin: 2px 0;"></div>

          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <label for="inp-manual-tick-val2" style="font-size: 11px; color: var(--text-secondary); font-weight: 500; display: flex; align-items: center; gap: 5px;">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--status-success);"></span>
              <span>右刻度齿值 (X2):</span>
            </label>
            <div style="display: flex; align-items: center; gap: 4px;">
              <input type="number" id="inp-manual-tick-val2" value="${hasTicks ? activeCol.x_ticks![1].value : (activeCol?.tickValue ?? 20)}" style="width: 64px; font-size: 11px; padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); text-align: right;" />
              <span style="font-size: 10.5px; color: var(--text-muted); min-width: 16px;">${activeCol?.unit || '%'}</span>
            </div>
          </div>
          <div style="font-size: 9.5px; color: var(--text-muted); padding-left: 13px;">
            像素位置: <code>X = ${Math.round(px2)}px</code> (刻度齿位置，可在图上拖拽)
          </div>
        </div>

        <div style="font-size: 10px; color: var(--text-secondary); line-height: 1.45; margin-bottom: 8px; background: rgba(56, 189, 248, 0.06); padding: 5px 8px; border-radius: 4px; border-left: 2px solid var(--accent-blue);">
          <strong>交互提示</strong>：画布底端已标注<strong>蓝色原点</strong>与<strong>绿色刻度齿</strong>圆点，可直接在图上左右拖拽对齐扫描件上的刻度齿；输入框按 <code>Enter</code> 可直接保存。
        </div>

        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
          <button id="btn-save-manual-ticks" class="ui-btn ui-btn--primary" style="flex: 1; font-size: 11px; padding: 6px 8px;">
            ${t('step6.saveTicks')}
          </button>
          <button id="btn-detect-xticks" class="ui-btn ui-btn--secondary" style="font-size: 11px; padding: 6px 10px;" title="基于图像分析自动识别全区刻度齿位置">
            自动提取
          </button>
        </div>

        <button id="btn-apply-ticks-to-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="width: 100%; font-size: 10.5px; padding: 4px 6px; border: 1px dashed var(--border-color);" title="将当前输入的刻度值快速批量应用到同组所有属种">
          ${t('step6.applyToGroup')}
        </button>
      </div>

      <!-- 次区域：属种绘图形态与多指标分组 (收敛为优雅折叠卡片) -->
      <details class="inspector-section" style="padding: 8px 10px; background: var(--bg-card); border-radius: 8px; margin-bottom: 12px; border: 1px solid var(--border-color);">
        <summary style="font-size: 11px; font-weight: 700; color: var(--text-heading); cursor: pointer; user-select: none;">
          ▾ 属种属性与分组模板 (X-Group)
        </summary>

        <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 8px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
            <label for="sel-col-group" style="font-size: 10.5px; color: var(--text-secondary); white-space: nowrap;">所属列组:</label>
            <select id="sel-col-group" style="flex: 1; font-size: 10.5px; padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); max-width: 180px;">
              ${
                groups.length > 0
                  ? groups
                      .map(
                        (g) =>
                          `<option value="${g.id}" ${g.id === currentGroupId ? 'selected' : ''}>${g.name} (${g.unit} · ${g.plot_type})</option>`
                      )
                      .join('')
                  : '<option value="">默认组</option>'
              }
            </select>
          </div>

          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            <button id="btn-create-group" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 2px 6px;">+ 新建组</button>
            <button id="btn-merge-groups" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 10px; padding: 2px 6px;">合并同类组</button>
          </div>

          ${
            activeGroup
              ? `
            <div style="font-size: 10px; color: var(--text-muted); line-height: 1.4; padding: 4px 6px; background: var(--bg-tertiary); border-radius: 4px;">
              组形态: <strong>${activeGroup.plot_type}</strong> | 单位: <strong>${activeGroup.unit}</strong> | 尺度: <strong>${activeGroup.scale_type}</strong>
              ${activeGroup.exaggeration_mult ? ` | 放大: <strong>${activeGroup.exaggeration_mult}×</strong>` : ''}
            </div>
          `
              : ''
          }
        </div>
      </details>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-xticks-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step6.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  // 列寻址统一用后端给的 col_index；只有当载荷没带它时才退回数组下标
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

  // 空状态前往步骤 5
  root.querySelector('#btn-goto-step5-split')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(5);
  });

  root.querySelector('#btn-detect-xticks')?.addEventListener('click', () => {
    ctx.onDetectXTicks?.();
  });

  // 回车快捷键直接触发保存
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

  // 批量应用刻度至同组全部列
  root.querySelector('#btn-apply-ticks-to-group')?.addEventListener('click', async () => {
    const activeCol = activeColumn();
    if (!activeCol || !cachedData || !ctx.rpcClient) return;

    const val1Raw = (root.querySelector('#inp-manual-tick-val1') as HTMLInputElement)?.value ?? '';
    const val2Raw = (root.querySelector('#inp-manual-tick-val2') as HTMLInputElement)?.value ?? '';
    const val1 = Number.parseFloat(val1Raw);
    const val2 = Number.parseFloat(val2Raw);
    if (!Number.isFinite(val1) || !Number.isFinite(val2)) {
      notifyError('两个端点读数都必须填有效数字。');
      return;
    }

    const roi = activeRoi();
    const targetGroupId = activeCol.x_group_id || roi?.default_group_id;
    const targetRoiId = activeCol.roi_id || roi?.id;

    const sameGroupCols = (cachedData.columns || []).filter((c) => {
      const cGrp = c.x_group_id || roi?.default_group_id;
      const cRoi = c.roi_id || roi?.id;
      return cGrp === targetGroupId && cRoi === targetRoiId;
    });

    if (sameGroupCols.length === 0) {
      notify(t('step6.applyToGroupEmpty'), 'info');
      return;
    }

    let successCount = 0;
    const unit = activeCol.unit || '%';
    for (const col of sameGroupCols) {
      const colIdx = columnIndex(col);
      const p1 = col.startX;
      const p2 = col.tickEndX ?? col.endX;
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
        col.maxPercent = val2;
        successCount++;
      } catch (err) {
        console.warn(`[XTicksPanel] 批量标定列 ${col.name} 失败:`, err);
      }
    }

    if (successCount > 0) {
      notify(
        t('step6.applyToGroupSuccess', {
          val1: String(val1),
          val2: String(val2),
          unit,
          count: String(successCount),
        }),
        'success'
      );
      ctx.onDataChange?.();
    }
  });

  // 组归属变更
  root.querySelector('#sel-col-group')?.addEventListener('change', async (e) => {
    const activeCol = activeColumn();
    const newGrpId = (e.target as HTMLSelectElement).value;
    if (activeCol && newGrpId) {
      if (ctx.rpcClient) {
        try {
          await ctx.rpcClient.updateColumn(columnIndex(activeCol), { x_group_id: newGrpId } as any);
        } catch (err) {
          notifyError(err instanceof Error ? err.message : String(err));
          return;
        }
      }
      activeCol.x_group_id = newGrpId;
      ctx.onDataChange?.();
    }
  });

  // 新建组
  root.querySelector('#btn-create-group')?.addEventListener('click', async () => {
    const roi = activeRoi();
    const activeCol = activeColumn();
    if (!roi || !ctx.rpcClient) return;

    const grpName = prompt('请输入新列组名称：', `组 ${(roi.x_groups?.length || 0) + 1}`);
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
      if (activeCol) {
        await ctx.rpcClient.updateColumn(columnIndex(activeCol), { x_group_id: res.group.id } as any);
        activeCol.x_group_id = res.group.id;
      }
      ctx.onDataChange?.();
    } catch (err) {
      notifyError(err instanceof Error ? err.message : String(err));
    }
  });

  // 合并同类组 (D2 手动收尾工具)
  root.querySelector('#btn-merge-groups')?.addEventListener('click', async () => {
    const roi = activeRoi();
    if (!roi || !roi.x_groups || roi.x_groups.length <= 1 || !ctx.rpcClient) {
      notify('当前 ROI 仅有 1 个或没有组，无需合并。', 'info');
      return;
    }

    // 按 key = (unit, plot_type, scale_type, exaggeration_mult) 聚集组
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
            // 把归属于 dupGroup 的列重新指定给 keepGroup
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
        notify(`已成功合并 ${mergedCount} 个标度相同的列组！`, 'success');
        ctx.onDataChange?.();
      } else {
        notify('当前 ROI 内所有列组的形态或标度各不相同，未发现可合并的同类组。', 'info');
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : String(err));
    }
  });

  // 清空本列标度
  root.querySelector('#btn-clear-col-ticks')?.addEventListener('click', () => {
    const activeCol = activeColumn();
    if (activeCol) ctx.onClearXTicks?.(columnIndex(activeCol));
  });

  // 保存手动输入的两端点物理标度
  root.querySelector('#btn-save-manual-ticks')?.addEventListener('click', () => {
    const activeCol = activeColumn();
    if (!activeCol) return;
    const val1Raw = (root.querySelector('#inp-manual-tick-val1') as HTMLInputElement)?.value ?? '';
    const val2Raw = (root.querySelector('#inp-manual-tick-val2') as HTMLInputElement)?.value ?? '';
    ctx.onCalibrateXTicks?.(columnIndex(activeCol), val1Raw, val2Raw);
  });

  root.querySelector('#btn-apply-xticks-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(7);
  });
}

