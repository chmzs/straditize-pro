import { DiagramData, ColumnGroup } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';

export const step = 6;
export const title = '6. 标定列与 X 刻度';

let cachedData: DiagramData | null = null;

export function render(data: DiagramData): string {
  cachedData = data;
  const activeCol = data.columns.find((c) => c.id === data.activeTaxaId) || data.columns[0];
  const colName = activeCol ? activeCol.name : t('step6.unselected');
  const hasTicks = activeCol && activeCol.x_ticks && activeCol.x_ticks.length === 2;

  // Active ROI and group resolution (Design 2026-09-29 P3)
  const activeRoi =
    data.rois?.find((r) => r.id === (activeCol?.roi_id || data.active_roi_id || data.rois[0]?.id)) ||
    data.rois?.[0];
  const groups: ColumnGroup[] = activeRoi?.x_groups || [];
  const currentGroupId = activeCol?.x_group_id || activeRoi?.default_group_id || groups[0]?.id;
  const activeGroup = groups.find((g) => g.id === currentGroupId) || groups[0];

  return `
    <div class="step-panel" data-step="6">
      <div class="step-title">${t('step6.title')}</div>
      <div class="step-desc">
        ${t('step6.activeCol')}<strong style="color: var(--accent-blue);">${colName}</strong>
      </div>

      <!-- 列所属组与组管理 (Design 2026-09-29 P3) -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">🏷️ 所属组 (X-Group)</span>
          <div style="display: flex; gap: 4px;">
            <button id="btn-create-group" class="icon-btn" style="font-size: 10px; padding: 1px 5px;" title="在当前 ROI 内新建列组">+ 新组</button>
            <button id="btn-merge-groups" class="icon-btn" style="font-size: 10px; padding: 1px 5px;" title="合并同 ROI 内标度相同的组">合并同类组</button>
          </div>
        </div>

        <div style="display: flex; gap: 6px; align-items: center; margin-bottom: 6px;">
          <select id="sel-col-group" style="flex: 1; font-size: 11px; padding: 3px 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);">
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

        ${
          activeGroup
            ? `
          <div style="font-size: 10px; color: var(--text-muted); line-height: 1.4; padding: 4px 6px; background: rgba(0,0,0,0.03); border-radius: 4px;">
            组形态: <strong>${activeGroup.plot_type}</strong> | 单位: <strong>${activeGroup.unit}</strong> | 尺度: <strong>${activeGroup.scale_type}</strong>
            ${activeGroup.exaggeration_mult ? ` | 放大: <strong>${activeGroup.exaggeration_mult}×</strong>` : ''}
          </div>
        `
            : ''
        }
      </div>

      <!-- 自动刻度线几何检测 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">${t('step6.autoTicksTitle')}</div>
        <p style="font-size: 10px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
          ${t('step6.autoTicksDesc')}
        </p>
        <button id="btn-detect-xticks" class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 5px;">
          🔍 ${t('step6.autoTicksBtn')}
        </button>
      </div>

      <!-- 当前列标度参数 (事实源: x_ticks / x_values) -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">${t('step6.ticksSource')}</span>
          ${hasTicks ? `<button id="btn-clear-col-ticks" class="icon-btn btn-subaction" style="font-size: 10px; color: #ef4444; padding: 1px 4px;" title="${t('step6.clearTicks')}">${t('step6.clearTicks')}</button>` : ''}
        </div>
        <div class="info-kv-box">
          <div>状态: <strong style="color: ${hasTicks ? 'var(--accent-green, #10b981)' : 'var(--accent-orange, #f59e0b)'}; font-weight: 700;">${hasTicks ? t('step6.calibrated') : t('step6.uncalibrated')}</strong></div>
          ${
            hasTicks && activeCol?.x_ticks
              ? `
            <div>① X1: <code>X=${activeCol.x_ticks[0].px}px</code> → <strong>${activeCol.x_ticks[0].value} ${activeCol.unit || '%'}</strong></div>
            <div>② X2: <code>X=${activeCol.x_ticks[1].px}px</code> → <strong>${activeCol.x_ticks[1].value} ${activeCol.unit || '%'}</strong></div>
          `
              : `<div style="color: var(--text-muted); font-size: 10px;">${t('step6.uncalibrated')}</div>`
          }
        </div>

        <!-- 重新输入两端点表单 -->
        <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
          <div style="font-size: 10.5px; font-weight: 600; margin-bottom: 4px; color: var(--text-secondary);">${t('step6.reinput')}</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
            <div>
              <label style="font-size: 9.5px; color: var(--text-muted);">值 1 (Origin):</label>
              <input type="number" id="inp-manual-tick-val1" value="${hasTicks ? activeCol.x_ticks![0].value : (activeCol?.startValue ?? 0)}" style="width: 100%; font-size: 10.5px; padding: 2px 4px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
            <div>
              <label style="font-size: 9.5px; color: var(--text-muted);">值 2 (Max):</label>
              <input type="number" id="inp-manual-tick-val2" value="${hasTicks ? activeCol.x_ticks![1].value : (activeCol?.tickValue ?? 20)}" style="width: 100%; font-size: 10.5px; padding: 2px 4px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
            </div>
          </div>
          <button id="btn-save-manual-ticks" class="btn btn-secondary" style="width: 100%; font-size: 10.5px; padding: 4px 6px; margin-top: 6px;">
            💾 ${t('step6.saveTicks')}
          </button>
        </div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-xticks-next" class="btn btn-primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
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

  root.querySelector('#btn-detect-xticks')?.addEventListener('click', () => {
    ctx.onDetectXTicks?.();
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
          alert(err instanceof Error ? err.message : String(err));
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
      alert(err instanceof Error ? err.message : String(err));
    }
  });

  // 合并同类组 (D2 手动收尾工具)
  root.querySelector('#btn-merge-groups')?.addEventListener('click', async () => {
    const roi = activeRoi();
    if (!roi || !roi.x_groups || roi.x_groups.length <= 1 || !ctx.rpcClient) {
      alert('当前 ROI 仅有 1 个或没有组，无需合并。');
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
        alert(`已成功合并 ${mergedCount} 个标度相同的列组！`);
        ctx.onDataChange?.();
      } else {
        alert('当前 ROI 内所有列组的形态或标度各不相同，未发现可合并的同类组。');
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
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

