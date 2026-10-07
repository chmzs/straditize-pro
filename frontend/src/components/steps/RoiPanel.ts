import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';

export const step = 2;
export const title = '2. 数据有效区 (ROI)';

export function render(data: DiagramData): string {
  const rois = data.rois && data.rois.length > 0
    ? data.rois
    : [{ id: 'roi_1', name: 'pollen', name_source: 'default', composition: true, visible: true, xlim: [data.roi.xMin, data.roi.xMax], ylim: [data.roi.yMin, data.roi.yMax], columns_stale: false, form_defaults: null }];

  const activeId = data.active_roi_id || (data as any).activeRoiId || rois[0]?.id || 'roi_1';
  const activeRoi = rois.find((r) => r.id === activeId) || rois[0];
  const primaryId = data.primary_roi_id || (data as any).primaryRoiId || rois[0]?.id;

  const currentColumns = (data.columns || []).filter((c) => c.roi_id === activeRoi.id);

  return `
    <div class="step-panel" data-step="2">
      <div class="step-title">${t('step2.title')}</div>
      <div class="step-desc">
        ${t('step2.desc')}
      </div>

      <!-- ROI 选择与操作区 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 12px; border: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 11px; font-weight: 700;">${t('step2.container', { count: rois.length })}</span>
          <button id="btn-create-roi" class="tool-btn btn-subaction" style="font-size: 10px; padding: 2px 7px;">+ ${t('step2.newRoi')}</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px;">
          ${rois
            .map((r) => {
              const isAct = r.id === activeId;
              const isPrim = r.id === primaryId;
              const colCnt = (data.columns || []).filter((c) => c.roi_id === r.id).length;
              return `
                <div class="roi-item-card" data-roi-id="${r.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; border-radius: 4px; background: ${isAct ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-card)'}; border: 1px solid ${isAct ? 'var(--accent-blue)' : 'var(--border-color)'}; cursor: pointer;">
                  <div style="display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1;">
                    <span style="font-size: 10px; color: ${isAct ? 'var(--accent-blue)' : 'var(--text-muted)'}; font-weight: 700;">${isPrim ? '★' : '○'}</span>
                    <strong style="font-size: 11px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${r.name || r.id}</strong>
                    <span style="font-size: 9.5px; color: var(--text-muted);">(${colCnt}${t('step2.cols')})</span>
                  </div>
                  <div style="display: flex; gap: 4px; align-items: center;">
                    ${!isPrim ? `<button class="icon-btn btn-set-primary" data-roi-id="${r.id}" title="${t('step2.setPrimaryTitle')}" style="font-size: 10px;">${t('step2.setPrimary')}</button>` : `<span style="font-size: 9px; color: #10b981; font-weight: 700;">${t('step2.primary')}</span>`}
                    ${rois.length > 1 ? `<button class="icon-btn btn-delete-roi" data-roi-id="${r.id}" title="${t('step2.deleteRoiTitle')}" style="font-size: 10px; color: var(--accent-red);">&times;</button>` : ''}
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>

      <!-- 当前选中 ROI 属性编辑 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">${t('step2.currentRoi')}: ${activeRoi.name || activeRoi.id}</div>
        <div style="display: flex; flex-direction: column; gap: 6px; font-size: 11px;">
          <div>
            <label style="color: var(--text-muted); font-size: 10px;">${t('step2.roiName')}</label>
            <input type="text" id="inp-roi-name" value="${activeRoi.name || activeRoi.id}" style="width: 100%; font-size: 11px; padding: 3px 6px; box-sizing: border-box; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary);" />
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
            <input type="checkbox" id="chk-roi-composition" ${activeRoi.composition ? 'checked' : ''} />
            <label for="chk-roi-composition" style="font-size: 10.5px; cursor: pointer;">${t('step2.composition')}</label>
          </div>
          <div class="info-kv-box">
            <div>${t('step2.pixelX')} <strong>[${Math.round(activeRoi.xlim ? activeRoi.xlim[0] : data.roi.xMin)} ~ ${Math.round(activeRoi.xlim ? activeRoi.xlim[1] : data.roi.xMax)}]</strong></div>
            <div>${t('step2.pixelY')} <strong>[${Math.round(activeRoi.ylim ? activeRoi.ylim[0] : data.roi.yMin)} ~ ${Math.round(activeRoi.ylim ? activeRoi.ylim[1] : data.roi.yMax)}]</strong></div>
            <div>${t('step2.assignedCols')} <strong>${currentColumns.length}</strong> ${t('step2.cols')}</div>
          </div>
        </div>
      </div>

      <!-- 推进到 Step 3 -->
      <button id="btn-apply-roi-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step2.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  // 点击 ROI 卡片切换当前活动 ROI
  root.querySelectorAll('.roi-item-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.icon-btn')) return;
      const roiId = card.getAttribute('data-roi-id');
      if (roiId && ctx.onSelectRoi) {
        ctx.onSelectRoi(roiId);
      }
    });
  });

  // 创建新 ROI
  root.querySelector('#btn-create-roi')?.addEventListener('click', () => {
    if (ctx.onCreateRoi) {
      ctx.onCreateRoi();
    }
  });

  // 设为主 ROI
  root.querySelectorAll('.btn-set-primary').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roiId = btn.getAttribute('data-roi-id');
      if (roiId && ctx.onSetPrimaryRoi) {
        ctx.onSetPrimaryRoi(roiId);
      }
    });
  });

  // 删除 ROI
  root.querySelectorAll('.btn-delete-roi').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roiId = btn.getAttribute('data-roi-id');
      if (roiId && ctx.onDeleteRoi) {
        ctx.onDeleteRoi(roiId);
      }
    });
  });

  // 修改 ROI 名称（change 与 blur 均触发，防止失焦时未按回车导致重命名丢失）
  const nameInp = root.querySelector('#inp-roi-name') as HTMLInputElement | null;
  const handleRename = () => {
    const val = nameInp?.value.trim();
    if (val && ctx.onRenameActiveRoi) {
      ctx.onRenameActiveRoi(val);
    }
  };
  nameInp?.addEventListener('change', handleRename);
  nameInp?.addEventListener('blur', handleRename);

  // 修改 composition 属性
  const compChk = root.querySelector('#chk-roi-composition') as HTMLInputElement | null;
  compChk?.addEventListener('change', () => {
    if (ctx.onUpdateRoiComposition) {
      ctx.onUpdateRoiComposition(compChk.checked);
    }
  });

  // 下一步
  root.querySelector('#btn-apply-roi-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(3);
  });
}
