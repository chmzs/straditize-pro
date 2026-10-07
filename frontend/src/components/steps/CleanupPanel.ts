import { DiagramData, LineCandidate } from '../../types/pollen';
import { StepContext } from './_registry';
import { t } from '../../i18n';

export const step = 4;
export const title = '4. 干扰清理';

/**
 * 把后端统计翻译成一句人话。
 *
 * 数字全部来自后端返回的 `cleanup_stats`，前端不估算、不四舍五入成整数糊弄。
 */
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

  // 统一厚度输入框的默认值：优先取选中几何的实际宽度，否则取出现次数最多的宽度。
  // 这样用户点一条线再看侧栏，输入框里就是那条线的真实厚度。
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
      ? '<span style="color:#ef4444;font-weight:700;">已确认</span>'
      : '<span style="color:#f59e0b;font-weight:700;">待确认</span>';
    const src = c.source === 'manual' ? '手动' : '自动';
    return `
      <div class="cleanup-row" data-cand-id="${c.id}"
           style="display:flex;align-items:center;gap:5px;padding:3px 4px;border-radius:3px;margin-bottom:2px;
                  background:${isSelected ? 'rgba(56,189,248,0.18)' : 'transparent'};
                  border:1px solid ${isSelected ? '#38bdf8' : 'transparent'};">
        <span title="在水印图上选中并拖动编辑" class="btn-select-geometry" data-cand-id="${c.id}"
              style="cursor:pointer;font-family:monospace;color:var(--text-muted);flex:1;font-size:9.5px;">
          ${c.axis === 'h' ? '↔' : ''} ${range} <span style="opacity:.7;">(${c.width}px, ${src})</span>
        </span>
        ${badge}
        <button class="btn-toggle-geometry" data-cand-id="${c.id}" data-next="${isRemoved ? 'candidate' : 'removed'}"
                style="font-size:9px;padding:1px 5px;">${isRemoved ? '撤回' : '确认去除'}</button>
        <button class="btn-delete-geometry" data-cand-id="${c.id}"
                style="font-size:9px;padding:1px 4px;">删除</button>
      </div>`;
  };

  return `
    <div class="step-panel" data-step="4" data-selected-cand-id="${selectedId ?? ''}">
      <div class="step-title">${t('step4.title')}</div>
      <div class="step-desc">
        ${t('step4.forRoi')}<strong style="color: var(--accent-blue);">${roiName}</strong>
      </div>

      <!-- 1. 检测：唯一条目（无"灵敏度"旋钮，档位模型已下线） -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px; color: var(--text-primary);">① 检测干扰线</div>
        <button id="btn-detect-candidates" class="btn btn-secondary" style="width: 100%; font-size: 11px; padding: 5px;">
          ${t('step4.rescan')}
        </button>
        <div style="font-size: 10px; color: var(--text-muted); line-height: 1.45; margin-top: 6px;">
          检测出的几何一律为<strong style="color:#f59e0b;">待确认</strong>：不点"确认去除"就不会动任何一个像素。
        </div>
      </div>

      <!-- 2. 几何清单：确认 / 撤回 / 选中编辑 / 删除 -->
      <div class="inspector-section" style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">② ${t('step4.candidates', { count: cands.length })}</span>
          <span style="font-size: 10px; color: var(--text-muted);">已确认 ${selectedCount}</span>
        </div>
        <div id="cleanup-candidates-list" style="max-height: 132px; overflow-y: auto; font-size: 10px; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card);">
          ${
            cands.length === 0
              ? `<div style="color: var(--text-muted); text-align: center; padding: 8px;">${t('step4.noCandidates')}</div>`
              : cands.map(rowOf).join('')
          }
        </div>

        <!-- 3. 手动添加：在图上拖拽，不再输入四至值 -->
        <div style="display:flex; gap:6px; margin-top:6px;">
          <button id="btn-add-horizontal-geometry" class="btn btn-secondary" style="flex:1; font-size:10px; padding:4px;">＋横向（图上拖出）</button>
          <button id="btn-add-vertical-geometry" class="btn btn-secondary" style="flex:1; font-size:10px; padding:4px;">＋竖向（图上拖出）</button>
        </div>
        <div style="font-size:9.5px;color:var(--text-muted);line-height:1.45;margin-top:5px;">
          点按钮后在图上<strong>按住左键拖出一段</strong>即可。选中几何后可整体拖动、
          拖<strong>白色方块</strong>改长度、拖<strong>青色圆点</strong>改厚度、方向键 1px 精调、按 Delete 删除。
        </div>

        <!-- 4. 统一厚度：先用测量 (M) 量出真实粗细，填进来统一 -->
        <div style="display:flex; gap:6px; margin-top:8px; align-items:center;">
          <label for="cleanup-thickness-input" style="font-size:10px;color:var(--text-secondary);white-space:nowrap;">统一厚度</label>
          <input id="cleanup-thickness-input" type="number" min="1" max="500" step="1" value="${suggestedThickness}"
                 style="width:52px;font-size:10px;padding:3px 4px;background:var(--bg-card);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;" />
          <span style="font-size:10px;color:var(--text-muted);">px</span>
          <button id="btn-apply-thickness-selected" class="btn btn-secondary" style="flex:1;font-size:10px;padding:4px;" ${selectedId ? '' : 'disabled'}>应用到选中</button>
          <button id="btn-apply-thickness-all" class="btn btn-secondary" style="flex:1;font-size:10px;padding:4px;">应用到全部</button>
        </div>
        <div style="font-size:9.5px;color:var(--text-muted);line-height:1.45;margin-top:4px;">
          用工具栏<strong>测量 (M)</strong>在图上量出干扰线的实际粗细，填进来即可统一改成该值（中心行不动）。
        </div>
      </div>

      <!-- 4. 颜色图例：与后端 overlay_legend 一致 -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; font-size: 10px; margin-bottom: 10px;">
        <span><i style="display:inline-block;width:9px;height:9px;background:#f59e0b;border-radius:2px;margin-right:4px;"></i>待确认（不剔除）</span>
        <span><i style="display:inline-block;width:9px;height:9px;background:#ef4444;border-radius:2px;margin-right:4px;"></i>已确认（实际剔除）</span>
        <span><i style="display:inline-block;width:9px;height:9px;background:#9ca3af;border-radius:2px;margin-right:4px;"></i>排除区（绝对剔除）</span>
        <span><i style="display:inline-block;width:9px;height:9px;background:#fff;border:1px solid #aaa;border-radius:2px;margin-right:4px;"></i>保留墨迹</span>
      </div>

      <!-- 5. 局部修正与排除区 -->
      <div class="inspector-section" style="margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">③ ${t('step4.exclusions', { count: exclusionCount })}</div>
        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
          <button id="btn-add-exclusion-rect" class="btn btn-secondary" style="flex: 1; font-size: 10.5px; padding: 5px;">
            ⬚ ${t('step4.addExclusion')}
          </button>
        </div>
        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
          <button id="btn-trigger-linefix" class="btn btn-secondary" style="flex: 1; font-size: 10.5px; padding: 5px;"
                  title="按住左键涂抹，把被误标成线的数据擦回来">
            擦掉误标
          </button>
          <button id="btn-linefix-restore" class="btn btn-secondary" style="flex: 1; font-size: 10.5px; padding: 5px;"
                  title="按住左键涂抹，手工补上算法漏掉的线">
            补回漏标
          </button>
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 6px;">
          <span style="font-size: 10px; color: var(--text-secondary);">
            人工修正笔迹: <strong>${strokeCount}</strong> 条
          </span>
          <button id="btn-linefix-clear" class="btn btn-secondary"
                  style="font-size: 9.5px; padding: 2px 6px; ${strokeCount ? '' : 'opacity: 0.45; pointer-events: none;'}"
                  ${strokeCount ? '' : 'disabled'}>
            清空笔迹
          </button>
        </div>
        <div style="font-size:10px;color:var(--text-muted);line-height:1.45;">
          几何用于整条横/竖线；画笔只修补几何漏标或误标的<strong>局部像元</strong>，不替代几何。
          按键盘 <strong>B</strong> 叠加查看掩膜（<span style="color:#f87171;">红色</span>=实际剔除的像素，<span style="color:#e8e8f0;">白色</span>=保留的墨迹）。
        </div>
      </div>

      <!-- 6. 统计（后端真实数字） -->
      <div class="inspector-section" style="padding: 7px 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px; border: 1px solid var(--border-color);">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 4px;">④ 本次清理统计</div>
        <div id="cleanup-stats" style="font-size: 10px; color: var(--text-secondary); line-height: 1.5;">
          ${statsLine(data)}
        </div>
        <button id="btn-clear-cleanup-edits" class="btn btn-secondary" style="width:100%; margin-top:6px; font-size:10px; padding:4px;">
          清空本步全部几何 / 排除区 / 笔迹
        </button>
      </div>

      <!-- 7. 推进到下一步 -->
      <button id="btn-apply-cleanup-next" class="btn btn-primary" style="width: 100%; padding: 8px 12px; font-size: 12px;">
        ${t('step4.next')}
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  // 检测（单一入口）
  root.querySelector('#btn-detect-candidates')?.addEventListener('click', () => {
    ctx.onDetectLineCandidates?.();
  });

  // 手动添加：进入画布拖拽模式
  root.querySelector('#btn-add-horizontal-geometry')?.addEventListener('click', () => {
    ctx.onAddLineGeometry?.('h');
  });
  root.querySelector('#btn-add-vertical-geometry')?.addEventListener('click', () => {
    ctx.onAddLineGeometry?.('v');
  });

  // 选中（在图上高亮并可拖动）
  root.querySelectorAll('.btn-select-geometry').forEach((button) => {
    button.addEventListener('click', () => {
      const id = (button as HTMLElement).dataset.candId;
      if (id) ctx.onEditLineGeometry?.(id);
    });
  });

  // 确认 / 撤回
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

  // 局部像元修正画笔：擦掉误标 / 补回漏标 两种笔，外加只清笔迹
  // （与下方「清空本步全部几何/排除区/笔迹」区分开——那个会连几何一起清）。
  root.querySelector('#btn-trigger-linefix')?.addEventListener('click', () => {
    ctx.onStartLineFix?.('erase');
  });
  root.querySelector('#btn-linefix-restore')?.addEventListener('click', () => {
    ctx.onStartLineFix?.('restore');
  });
  root.querySelector('#btn-linefix-clear')?.addEventListener('click', () => {
    ctx.onClearLineFix?.();
  });

  // 统一厚度（P4）：中心行不动，只改带宽
  const thicknessInput = root.querySelector('#cleanup-thickness-input') as HTMLInputElement | null;
  const selectedCandId =
    root.querySelector('.step-panel')?.getAttribute('data-selected-cand-id') || undefined;
  const applyThickness = (candidateId?: string) => {
    const raw = Number(thicknessInput?.value);
    if (!Number.isFinite(raw) || raw < 1 || raw > 500) {
      // 越界不静默：把输入框标红，用户一眼知道是输入的问题。
      //
      // 必须带 `!important`。日间模式有一条"强兜底安全网"
      // （`style.css`：`body.theme-light input[type="number"] { border-color: … !important }`），
      // 普通内联样式会被它压掉 —— 标红写了但**用户看不到**。内联的 `!important`
      // 优先级高于作者样式表的 `!important`，这是唯一能穿透那条安全网的写法。
      if (thicknessInput) {
        thicknessInput.style.setProperty('border-color', '#ef4444', 'important');
      }
      return;
    }
    // 复位用 removeProperty：连 `!important` 优先级一起清掉，
    // 让样式表（含主题兜底）重新接管，而不是留一个普通内联值。
    if (thicknessInput) thicknessInput.style.removeProperty('border-color');
    ctx.onSetLineThickness?.(Math.round(raw), candidateId);
  };
  root.querySelector('#btn-apply-thickness-selected')?.addEventListener('click', () => {
    applyThickness(selectedCandId);
  });
  root.querySelector('#btn-apply-thickness-all')?.addEventListener('click', () => {
    applyThickness(undefined);
  });

  // 清空本步编辑
  root.querySelector('#btn-clear-cleanup-edits')?.addEventListener('click', () => {
    ctx.onClearCleanupEdits?.();
  });

  const applyBtn = root.querySelector('#btn-apply-cleanup-next') as HTMLButtonElement | null;
  applyBtn?.addEventListener('click', async () => {
    if (applyBtn.disabled) return;
    const originalText = applyBtn.innerHTML;
    applyBtn.disabled = true;
    applyBtn.style.opacity = '0.75';
    applyBtn.style.cursor = 'wait';
    applyBtn.innerHTML = '正在切分属种基线，请稍候...';
    try {
      await ctx.onAdvanceWorkflowStage?.(5);
    } finally {
      applyBtn.disabled = false;
      applyBtn.style.opacity = '1';
      applyBtn.style.cursor = 'pointer';
      applyBtn.innerHTML = originalText;
    }
  });
}
