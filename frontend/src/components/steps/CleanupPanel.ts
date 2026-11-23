import { DiagramData, LineCandidate } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';
import { axisWarningHeadline, axisWarningNote } from '../../core/axisWarnings';
import { renderResetButton } from '../../ui/resetButton';
import {
  countByOrientation,
  getDetectOrientation,
  orientationNotice,
  setDetectOrientation,
  toDetectPayload,
} from '../../core/detectOrientation';

export const step = 5;
export const title = '5. 干扰清理';

function statsLine(data: DiagramData): string {
  const s = data.cleanup_stats;
  if (!s) return '尚未计算。点"重新检测"或调整几何后自动更新。';
  const removed = s.removed_count ?? 0;
  const total = s.geometries_count ?? 0;
  const px = s.final_removed_pixels ?? 0;
  const exclPx = s.exclusion_pixels ?? 0;
  const brush = (s.manual_erase_pixels ?? 0) + (s.manual_restore_pixels ?? 0);
  const parts = [
    `几何 ${total} 条（已确认 ${removed}）`,
    `实际剔除 ${px} px`,
    `排除区 ${exclPx} px`,
  ];
  if (brush > 0) parts.push(`笔迹修正 ${brush} px`);
  return parts.join(' · ');
}

export function render(data: DiagramData): string {
  const activeRoi = data.rois.find((r) => r.id === data.active_roi_id) || data.rois[0];
  const roiName = activeRoi ? activeRoi.name : 'pollen';
  const cands = data.line_candidates || [];
  const selectedCount = data.selected_candidate_ids ? data.selected_candidate_ids.length : 0;
  const exclusionCount = data.exclusion_regions ? data.exclusion_regions.length : 0;
  const strokeCount = data.line_strokes ? data.line_strokes.length : 0;
  const selectedId = data.cleanup_selected_id ?? null;
  const axisWarnings = data.cleanup_warnings || [];
  const orientation = getDetectOrientation();
  const orientationCounts = countByOrientation(cands);
  const orientationHint = orientationNotice(orientationCounts, orientation);

  const suggestedThickness = (() => {
    const sel = cands.find((c) => c.id === selectedId);
    if (sel) return sel.width;
    if (cands.length === 0) return 1;
    const tally = new Map<number, number>();
    for (const c of cands) tally.set(c.width, (tally.get(c.width) || 0) + 1);
    let best = cands[0].width;
    let bestN = 0;
    for (const [w, n] of tally) {
      if (n > bestN) {
        best = w;
        bestN = n;
      }
    }
    return best;
  })();

  const rowOf = (c: LineCandidate): string => {
    const isRemoved = c.status === 'removed';
    const isSelected = c.id === selectedId;
    const g = c.geometry;
    const range =
      c.axis === 'h'
        ? `y=${Math.min(g.y0, g.y1)}–${Math.max(g.y0, g.y1)} · x=${Math.min(g.x0, g.x1)}–${Math.max(g.x0, g.x1)}`
        : `x=${Math.min(g.x0, g.x1)}–${Math.max(g.x0, g.x1)} · y=${Math.min(g.y0, g.y1)}–${Math.max(g.y0, g.y1)}`;
    const badge = isRemoved
      ? '<span style="color:var(--accent-red);font-weight:700;">已剔除</span>'
      : '<span style="color:var(--text-muted);font-weight:600;">已保留</span>';
    const src = c.source === 'manual' ? '手动' : '自动';
    return `
      <div class="cleanup-row" data-cand-id="${c.id}" data-cand-kind="${c.kind}"
           style="display:flex;align-items:center;gap:5px;padding:3px 4px;border-radius:3px;margin-bottom:2px;
                  background:${isSelected ? 'rgba(56,189,248,0.18)' : 'transparent'};
                  border:1px solid ${isSelected ? 'var(--accent-blue)' : 'transparent'};">
        <span title="在图上选中并拖动编辑" class="btn-select-geometry" data-cand-id="${c.id}"
              style="cursor:pointer;font-family:monospace;color:var(--text-muted);flex:1;font-size:9.5px;">
          ${c.axis === 'h' ? '[横]' : '[竖]'} ${range} <span style="opacity:.7;">(${c.width}px, ${src})</span>
        </span>
        ${badge}
        <button class="btn-toggle-geometry ui-btn ui-btn--xs ${isRemoved ? 'ui-btn--quiet' : 'ui-btn--primary'}" data-cand-id="${c.id}" data-next="${isRemoved ? 'candidate' : 'removed'}"
                style="font-size:9px;padding:1px 5px;">${isRemoved ? '保留' : '剔除'}</button>
        <button class="btn-delete-geometry ui-btn ui-btn--xs ui-btn--quiet" data-cand-id="${c.id}"
                style="font-size:9px;padding:1px 4px;color:var(--accent-red);">删除</button>
      </div>`;
  };

  return `
    <div class="step-panel" data-step="5" data-selected-cand-id="${selectedId ?? ''}"
         data-horizontal-candidates="${orientationCounts.horizontal}"
         data-vertical-candidates="${orientationCounts.vertical}">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
        <div>
          <div class="step-title" style="margin-bottom:2px;">${t('step5.title')}</div>
          <div class="step-desc" style="margin-bottom:0;">
            ${t('step5.forRoi')}<strong style="color: var(--accent-blue);">${roiName}</strong>
          </div>
        </div>
      </div>

      ${
        axisWarnings.length === 0
          ? ''
          : `<div id="cleanup-axis-warnings" class="inspector-section"
               style="padding:8px;border-radius:6px;margin-bottom:10px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.55);border-left:4px solid var(--status-warning);">
              <div style="font-size:11px;font-weight:700;color:var(--status-warning);margin-bottom:4px;">
                警告：本步编辑抹掉了 ${axisWarnings.length} 列的轴线（0 点）：取数会整列偏移，且不会报错
              </div>
              ${axisWarnings
                .map(
                  (w) => `<div class="cleanup-axis-warning" data-warning-kind="${w.kind}"
                     data-column-name="${w.column_name}" data-column-start-x="${w.column_start_x}"
                     style="font-size:10px;line-height:1.5;color:var(--text-primary);margin-bottom:4px;">
                    <div style="font-weight:600;">${axisWarningHeadline(w)}</div>
                    <div style="color:var(--text-secondary);">${axisWarningNote(w)}</div>
                  </div>`
                )
                .join('')}
            </div>`
      }

      <!-- 1. 检测与候选几何卡片 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-color);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-primary);">① 干扰线识别与清单</div>
          <span style="font-size: 10px; color: var(--text-muted);">共 ${cands.length} 条 · <strong style="color:var(--accent-red);">${selectedCount} 条剔除</strong></span>
        </div>

        <div style="display: flex; justify-content:space-between; align-items: center; margin-bottom: 6px;">
          <div style="display: flex; gap: 10px; align-items: center;">
            <label for="chk-detect-horizontal" title="贯穿 ROI 的横向坐标线（Kind A）" style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-secondary); cursor: pointer;">
              <input id="chk-detect-horizontal" type="checkbox" ${orientation.horizontal ? 'checked' : ''} style="margin: 0; cursor: pointer;" />
              横线
            </label>
            <label for="chk-detect-vertical" title="竖线含贯穿网格线与列内短竖线（Kind B / Kind C）" style="display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--text-secondary); cursor: pointer;">
              <input id="chk-detect-vertical" type="checkbox" ${orientation.vertical ? 'checked' : ''} style="margin: 0; cursor: pointer;" />
              竖线
            </label>
          </div>
          <button id="btn-detect-candidates" class="ui-btn ui-btn--secondary ui-btn--xs" style="font-size: 10px; padding: 2px 8px;">
            ${t('step5.rescan')}
          </button>
        </div>

        <div id="cleanup-orientation-hint" class="cleanup-orientation-hint" style="font-size: 10px; color: var(--status-warning); line-height: 1.4; margin-bottom: 6px; display: ${orientationHint ? 'block' : 'none'};">${orientationHint}</div>

        <!-- 批量剔除/保留工具条 -->
        <div style="display: flex; gap: 4px; margin-bottom: 6px;">
          <button id="btn-confirm-all-candidates" class="ui-btn ui-btn--xs" style="flex: 1; font-size: 10px; padding: 3px 6px; background: rgba(239,68,68,0.12); color: var(--accent-red); border: 1px solid rgba(239,68,68,0.35);" title="将清单中的全部干扰线设为实际剔除">
            全部设为剔除
          </button>
          <button id="btn-revert-all-candidates" class="ui-btn ui-btn--xs ui-btn--secondary" style="flex: 1; font-size: 10px; padding: 3px 6px;" title="全部保留（不作为干扰线剔除）">
            全部保留
          </button>
        </div>

        <!-- 候选列表 -->
        <div id="cleanup-candidates-list" style="max-height: 120px; overflow-y: auto; font-size: 10px; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card); margin-bottom: 6px;">
          ${
            cands.length === 0
              ? `<div style="color: var(--text-muted); text-align: center; padding: 8px;">${t('step5.noCandidates')}</div>`
              : cands.map(rowOf).join('')
          }
        </div>

        <!-- 手动画线与厚度微调 -->
        <div style="display:flex; gap:4px; margin-bottom:4px;">
          <button id="btn-add-horizontal-geometry" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex:1; font-size:9.5px; padding:3px;" title="在画布上按住左键拖出横向清理矩形（默认直接剔除）">＋横向(拖出)</button>
          <button id="btn-add-vertical-geometry" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex:1; font-size:9.5px; padding:3px;" title="在画布上按住左键拖出竖向清理矩形（默认直接剔除）">＋竖向(拖出)</button>
        </div>

        <div style="display:flex; gap:4px; align-items:center;">
          <span style="font-size:9.5px;color:var(--text-secondary);white-space:nowrap;">统一厚度</span>
          <input id="cleanup-thickness-input" type="number" min="1" max="500" step="1" value="${suggestedThickness}"
                 style="width:42px;font-size:10px;padding:2px 3px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;" />
          <span style="font-size:9.5px;color:var(--text-muted);">px</span>
          <button id="btn-apply-thickness-selected" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex:1;font-size:9.5px;padding:2px 4px;" ${selectedId ? '' : 'disabled'}>改选中</button>
          <button id="btn-apply-thickness-all" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex:1;font-size:9.5px;padding:2px 4px;">改全部</button>
        </div>
      </div>

      <!-- 2. 局部修正与排除区卡片 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-color);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="font-size: 11px; font-weight: 700; color: var(--text-primary);">② 排除区与人工修正</div>
          <span style="font-size: 10px; color: var(--text-muted);">${exclusionCount} 排除区 · ${strokeCount} 笔迹</span>
        </div>

        <div style="display: flex; gap: 4px; margin-bottom: 6px;">
          <button id="btn-add-exclusion-rect" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex: 1; font-size: 10px; padding: 4px;" title="框定绝对不取数的干扰遮挡区">
            ⬚ ${t('step5.addExclusion')}
          </button>
          <button id="btn-trigger-linefix" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex: 1; font-size: 10px; padding: 4px;" title="按住左键涂抹，把被误标成线的数据擦回来">
            擦掉误标
          </button>
          <button id="btn-linefix-restore" class="ui-btn ui-btn--secondary ui-btn--xs" style="flex: 1; font-size: 10px; padding: 4px;" title="按住左键涂抹，手工补上算法漏掉的线">
            补回漏标
          </button>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:9.5px; color:var(--text-muted);">
            按 <strong>B</strong> 键切换二值遮罩预览（红=剔除，白=保留）
          </span>
          <button id="btn-linefix-clear" class="ui-btn ui-btn--quiet ui-btn--xs"
                  style="font-size: 9.5px; padding: 1px 5px; ${strokeCount ? '' : 'opacity: 0.45; pointer-events: none;'}"
                  ${strokeCount ? '' : 'disabled'}>
            清空笔迹
          </button>
        </div>
      </div>

      <!-- 3. 清理统计卡片 -->
      <div class="inspector-section" style="padding: 7px 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-color);">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 3px;">③ 本步清理统计</div>
        <div id="cleanup-stats" style="font-size: 10px; color: var(--text-secondary); line-height: 1.4;">
          ${statsLine(data)}
        </div>
      </div>

      <!-- 4. 推进到下一步 -->
      <button id="btn-apply-cleanup-next" class="ui-btn ui-btn--primary" style="width: 100%; padding: 8px 12px; font-size: 12px; font-weight: 600;">
        ${t('step5.next')}
      </button>

      <!-- 重设本步 (图2规范：底部居中浅红重设按钮) -->
      <div style="display: flex; justify-content: center; margin-top: 8px;">
        ${renderResetButton({
          id: 'btn-clear-cleanup-edits',
          title: '清空本步全部清理编辑（几何、排除区与笔迹）',
          label: '重设干扰清理',
        })}
      </div>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  const panel = root.querySelector('.step-panel') as HTMLElement | null;
  const hintBox = root.querySelector('#cleanup-orientation-hint') as HTMLElement | null;

  const refreshHint = (): void => {
    if (!hintBox || !panel) return;
    const text = orientationNotice(
      {
        horizontal: Number(panel.dataset.horizontalCandidates || '0'),
        vertical: Number(panel.dataset.verticalCandidates || '0'),
      },
      getDetectOrientation()
    );
    hintBox.textContent = text;
    hintBox.style.display = text ? 'block' : 'none';
  };

  root.querySelector('#chk-detect-horizontal')?.addEventListener('change', (event) => {
    setDetectOrientation({ horizontal: (event.target as HTMLInputElement).checked });
    refreshHint();
  });
  root.querySelector('#chk-detect-vertical')?.addEventListener('change', (event) => {
    setDetectOrientation({ vertical: (event.target as HTMLInputElement).checked });
    refreshHint();
  });

  // 检测（单一入口）
  root.querySelector('#btn-detect-candidates')?.addEventListener('click', () => {
    ctx.onDetectLineCandidates?.(toDetectPayload(getDetectOrientation()));
  });

  // 批量确认 / 撤回
  root.querySelector('#btn-confirm-all-candidates')?.addEventListener('click', () => {
    ctx.onConfirmAllCandidates?.();
  });
  root.querySelector('#btn-revert-all-candidates')?.addEventListener('click', () => {
    ctx.onRevertAllCandidates?.();
  });

  // 手动添加：进入画布拖拽模式
  root.querySelector('#btn-add-horizontal-geometry')?.addEventListener('click', () => {
    ctx.onAddLineGeometry?.('h');
  });
  root.querySelector('#btn-add-vertical-geometry')?.addEventListener('click', () => {
    ctx.onAddLineGeometry?.('v');
  });

  // 选中：点击清单项或坐标文本时，在画布高亮并平移缩放聚焦到该几何线段
  root.querySelectorAll('.btn-select-geometry, .cleanup-row').forEach((el) => {
    el.addEventListener('click', (e) => {
      // 避免点击确认/撤回或删除按钮时触发平移
      if ((e.target as HTMLElement).closest('.btn-toggle-geometry, .btn-delete-geometry')) return;
      const id = (el as HTMLElement).dataset.candId;
      if (id) ctx.onEditLineGeometry?.(id);
    });
  });

  // 单条确认 / 撤回
  root.querySelectorAll('.btn-toggle-geometry').forEach((button) => {
    button.addEventListener('click', () => {
      const el = button as HTMLElement;
      const id = el.dataset.candId;
      const next = el.dataset.next as 'candidate' | 'removed' | undefined;
      if (id && next) ctx.onToggleCandidateSelection?.(id, next === 'removed');
    });
  });

  // 删除
  root.querySelectorAll('.btn-delete-geometry').forEach((button) => {
    button.addEventListener('click', () => {
      const id = (button as HTMLElement).dataset.candId;
      if (id) ctx.onGeometryDelete?.(id);
    });
  });

  // 排除区
  root.querySelector('#btn-add-exclusion-rect')?.addEventListener('click', () => {
    ctx.onAddExclusionRect?.();
  });

  // 局部修正笔刷
  root.querySelector('#btn-trigger-linefix')?.addEventListener('click', () => {
    ctx.onStartLineFix?.('erase');
  });
  root.querySelector('#btn-linefix-restore')?.addEventListener('click', () => {
    ctx.onStartLineFix?.('restore');
  });
  root.querySelector('#btn-linefix-clear')?.addEventListener('click', () => {
    ctx.onClearLineFix?.();
  });

  // 统一厚度
  const thicknessInput = root.querySelector('#cleanup-thickness-input') as HTMLInputElement | null;
  const selectedCandId =
    root.querySelector('.step-panel')?.getAttribute('data-selected-cand-id') || undefined;
  const applyThickness = (candidateId?: string) => {
    const raw = Number(thicknessInput?.value);
    if (!Number.isFinite(raw) || raw < 1 || raw > 500) {
      if (thicknessInput) {
        thicknessInput.style.setProperty('border-color', '#ef4444', 'important');
      }
      return;
    }
    if (thicknessInput) thicknessInput.style.removeProperty('border-color');
    ctx.onSetLineThickness?.(Math.round(raw), candidateId);
  };
  root.querySelector('#btn-apply-thickness-selected')?.addEventListener('click', () => {
    applyThickness(selectedCandId);
  });
  root.querySelector('#btn-apply-thickness-all')?.addEventListener('click', () => {
    applyThickness(undefined);
  });

  // 清空本步编辑 / 重设本步
  root.querySelector('#btn-clear-cleanup-edits')?.addEventListener('click', () => {
    ctx.onClearCleanupEdits?.();
  });

  // 推进到下一步（严格尊重用户对候选线的剔除/保留配置，不搞暗箱全选）
  const applyBtn = root.querySelector('#btn-apply-cleanup-next') as HTMLButtonElement | null;
  applyBtn?.addEventListener('click', async () => {
    if (applyBtn.disabled) return;
    const originalText = applyBtn.innerHTML;
    applyBtn.disabled = true;
    applyBtn.style.opacity = '0.75';
    applyBtn.style.cursor = 'wait';
    applyBtn.innerHTML = '正在推进工作流...';
    try {
      // 推进到步骤 6（刻度标定；属种轮廓与拐点提取集中交由步骤 7）
      await ctx.onAdvanceWorkflowStage?.(6);
    } finally {
      applyBtn.disabled = false;
      applyBtn.style.opacity = '1';
      applyBtn.style.cursor = 'pointer';
      applyBtn.innerHTML = originalText;
    }
  });
}
