import { DiagramData } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';

export const step = 2;
export const title = '2. 数据有效区 (ROI)';

let cachedRoiData: DiagramData | null = null;

export function render(data: DiagramData): string {
  cachedRoiData = data;
  const rois = data.rois && data.rois.length > 0
    ? data.rois
    : [{ id: 'roi_1', name: 'pollen', name_source: 'default', composition: true, visible: true, xlim: [data.roi.xMin, data.roi.xMax], ylim: [data.roi.yMin, data.roi.yMax], columns_stale: false, form_defaults: null }];

  const activeId = data.active_roi_id || (data as any).activeRoiId || rois[0]?.id || 'roi_1';
  const activeRoi = rois.find((r) => r.id === activeId) || rois[0];
  const primaryId = data.primary_roi_id || (data as any).primaryRoiId || rois[0]?.id;

  const currentColumns = (data.columns || []).filter((c) => c.roi_id === activeRoi.id);

  // 零面积 = 用户还没框选（产品决策 ③：新建 ROI 是空区域）。
  //
  // 面板必须把"下一步要画什么"写出来：新建后画布上只剩一个点，不提示的话用户
  // 不知道该抓哪里、也不知道为什么后面分列会报"区域太小"。
  const roiW = Math.abs((activeRoi.xlim?.[1] ?? 0) - (activeRoi.xlim?.[0] ?? 0));
  const roiH = Math.abs((activeRoi.ylim?.[1] ?? 0) - (activeRoi.ylim?.[0] ?? 0));
  const isEmptyRoi = roiW === 0 || roiH === 0;

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
          <button id="btn-create-roi" class="ui-btn ui-btn--quiet ui-btn--xs btn-subaction" style="font-size: 10px; padding: 2px 7px;">+ ${t('step2.newRoi')}</button>
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
                    ${!isPrim ? `<button class="icon-btn btn-set-primary" data-roi-id="${r.id}" title="${t('step2.setPrimaryTitle')}" style="font-size: 10px;">${t('step2.setPrimary')}</button>` : `<span style="font-size: 9px; color: var(--status-success); font-weight: 700;">${t('step2.primary')}</span>`}
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
        ${isEmptyRoi
          ? `
        <div class="roi-empty-hint" data-roi-empty-hint style="margin: 6px 0 8px; padding: 8px; border-radius: 6px; border: 1px dashed var(--accent-blue); background: rgba(56, 189, 248, 0.10); font-size: 10.5px; line-height: 1.55;">
          <div style="font-weight: 700; margin-bottom: 2px;">${t('step2.emptyRoiTitle')}</div>
          <div>${t('step2.emptyRoiHint')}</div>
        </div>`
          : ''}
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
          <div style="margin-top: 6px; padding: 6px 8px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 4px;">
            <div style="font-size: 10px; font-weight: 700; color: var(--accent-blue); margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
              <span>快速聚焦微调</span>
              <span style="font-size: 8.5px; color: var(--text-muted); font-weight: 400;">(快捷键: 1 / 2 / F)</span>
            </div>
            <div style="display: flex; gap: 4px;">
              <button type="button" id="btn-focus-roi-tl" class="ui-btn ui-btn--quiet ui-btn--xs" style="flex: 1; font-size: 9.5px; padding: 3px 2px;" title="放大并居中对齐到 ROI 左上角 (快捷键: 1)，方便精准对齐顶部边缘与首列">
                左上角
              </button>
              <button type="button" id="btn-focus-roi-br" class="ui-btn ui-btn--quiet ui-btn--xs" style="flex: 1; font-size: 9.5px; padding: 3px 2px;" title="放大并居中对齐到 ROI 右下角 (快捷键: 2)，方便精准对齐底部边缘与末列">
                右下角
              </button>
              <button type="button" id="btn-focus-roi-fit" class="ui-btn ui-btn--quiet ui-btn--xs" style="font-size: 9.5px; padding: 3px 6px;" title="适应整屏视野居中 (快捷键: F)">
                全图
              </button>
            </div>
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

  // 快速聚焦角点微调
  const getActiveCoords = () => {
    const d = cachedRoiData;
    if (!d) return { rx0: 0, ry0: 0, rx1: 1000, ry1: 800 };
    const rois = d.rois && d.rois.length > 0 ? d.rois : [{ id: 'roi_1', xlim: [d.roi.xMin, d.roi.xMax], ylim: [d.roi.yMin, d.roi.yMax] }];
    const activeId = d.active_roi_id || (d as any).activeRoiId || rois[0]?.id;
    const active = rois.find((r) => r.id === activeId) || rois[0];
    const rx0 = active.xlim ? active.xlim[0] : d.roi.xMin;
    const rx1 = active.xlim ? active.xlim[1] : d.roi.xMax;
    const ry0 = active.ylim ? active.ylim[0] : d.roi.yMin;
    const ry1 = active.ylim ? active.ylim[1] : d.roi.yMax;
    return { rx0, ry0, rx1, ry1 };
  };

  root.querySelector('#btn-focus-roi-tl')?.addEventListener('click', () => {
    const { rx0, ry0 } = getActiveCoords();
    ctx.onFocusWorldPoint?.({ x: rx0, y: ry0 }, 2.0);
  });
  root.querySelector('#btn-focus-roi-br')?.addEventListener('click', () => {
    const { rx1, ry1 } = getActiveCoords();
    ctx.onFocusWorldPoint?.({ x: rx1, y: ry1 }, 2.0);
  });
  root.querySelector('#btn-focus-roi-fit')?.addEventListener('click', () => {
    ctx.onFitToScreen?.();
  });

  // 下一步
  root.querySelector('#btn-apply-roi-next')?.addEventListener('click', () => {
    ctx.onAdvanceWorkflowStage?.(3);
  });
}
