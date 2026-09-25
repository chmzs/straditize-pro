import { DiagramData, LineCandidate } from '../../types/pollen';
import { StepContext } from './_registry';

export const step = 4;
export const title = '4. 干扰清理';

export function render(data: DiagramData): string {
  const activeRoi = data.rois.find((r) => r.id === data.active_roi_id) || data.rois[0];
  const roiName = activeRoi ? activeRoi.name : '主图区';
  const cands = data.line_candidates || [];
  const selectedCount = data.selected_candidate_ids ? data.selected_candidate_ids.length : 0;
  const exclusionCount = data.exclusion_regions ? data.exclusion_regions.length : 0;

  return `
    <div class="step-panel" data-step="4">
      <div class="step-title">4. 干扰清理 (去线与排除区)</div>
      <div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.5;">
        当前针对分区：<strong style="color: var(--accent-blue);">${roiName}</strong>
      </div>

      <!-- 参数调节旋钮 -->
      <div class="inspector-section" style="padding: 8px; background: var(--bg-tertiary); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px; color: var(--text-primary);">去线灵敏度控制</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 10.5px;">
          <span>横向跨度比 (A类):</span>
          <span id="lbl-line-frac-h" style="font-weight: 600;">75%</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; font-size: 10.5px;">
          <span>纵向跨度比 (B类):</span>
          <span id="lbl-line-frac-v" style="font-weight: 600;">30%</span>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px;">
          <span>最大线宽上限:</span>
          <span id="lbl-line-width-max" style="font-weight: 600;">2 px</span>
        </div>
        <button id="btn-detect-candidates" class="tool-btn" style="width: 100%; margin-top: 8px; font-size: 11px; padding: 4px;">
          🔍 重新扫描候选线
        </button>
      </div>

      <!-- 候选线清单与操作 -->
      <div class="inspector-section" style="margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <span style="font-size: 11px; font-weight: 700;">候选线 (${cands.length} 条)</span>
          <span style="font-size: 10px; color: var(--text-muted);">已选: ${selectedCount}</span>
        </div>
        <div id="cleanup-candidates-list" style="max-height: 120px; overflow-y: auto; font-size: 10px; border: 1px solid var(--border-color); border-radius: 4px; padding: 4px; background: var(--bg-card);">
          ${
            cands.length === 0
              ? '<div style="color: var(--text-muted); text-align: center; padding: 8px;">无检测到的干扰线</div>'
              : cands
                  .map(
                    (c: LineCandidate) => `
                <div style="display: flex; align-items: center; gap: 6px; padding: 2px 0;">
                  <input type="checkbox" class="chk-candidate" data-cand-id="${c.id}" ${data.selected_candidate_ids?.includes(c.id) ? 'checked' : ''} />
                  <span>${c.kind === 'A' ? '横线 A' : (c.kind === 'B' ? '竖线 B' : '列内 C')}</span>
                  <span style="color: var(--text-muted); font-family: monospace;">at=${c.at} (${c.width}px)</span>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </div>

      <!-- 排除区与人工修正工具 -->
      <div class="inspector-section" style="margin-bottom: 12px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 6px;">排除区与画笔 (排除区绝对优先)</div>
        <div style="display: flex; gap: 6px; margin-bottom: 6px;">
          <button id="btn-add-exclusion-rect" class="tool-btn" style="flex: 1; font-size: 10.5px; padding: 4px;" title="划定矩形排除区 (绝对剔除图版文字、图例)">
            ⛶ 划定排除区
          </button>
          <button id="btn-trigger-linefix" class="tool-btn" style="flex: 1; font-size: 10.5px; padding: 4px;" title="快捷键 K：进入人工修正画笔">
            🖌 K键画笔
          </button>
        </div>
        <div style="font-size: 10px; color: var(--text-muted);">已设定排除区: ${exclusionCount} 处</div>
      </div>

      <!-- 阶段提交按钮 -->
      <button id="btn-apply-cleanup-next" class="primary-btn" style="width: 100%; padding: 6px 12px; font-size: 12px;">
        👉 确认清理并开始自动分列 (步骤 5)
      </button>
    </div>
  `;
}

export function mount(root: HTMLElement, ctx: StepContext): void {
  root.querySelector('#btn-detect-candidates')?.addEventListener('click', () => {
    ctx.onDetectLineCandidates?.();
  });

  // 划定排除区
  root.querySelector('#btn-add-exclusion-rect')?.addEventListener('click', () => {
    if (ctx.onAddExclusionRect) {
      ctx.onAddExclusionRect();
    }
  });

  // K 键画笔 (擦除模式)
  root.querySelector('#btn-trigger-linefix')?.addEventListener('click', () => {
    ctx.onStartLineFix?.('erase');
  });

  // 候选线勾选状态联动
  root.querySelectorAll('.chk-candidate').forEach((chk) => {
    chk.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      const candId = target.getAttribute('data-cand-id');
      if (!candId) return;
      if (ctx.onToggleCandidateSelection) {
        ctx.onToggleCandidateSelection(candId, target.checked);
      }
    });
  });

  const applyBtn = root.querySelector('#btn-apply-cleanup-next') as HTMLButtonElement | null;
  applyBtn?.addEventListener('click', async () => {
    if (applyBtn.disabled) return;
    const originalText = applyBtn.innerHTML;
    applyBtn.disabled = true;
    applyBtn.style.opacity = '0.75';
    applyBtn.style.cursor = 'wait';
    applyBtn.innerHTML = '⏳ 正在切分属种基线，请稍候...';
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
