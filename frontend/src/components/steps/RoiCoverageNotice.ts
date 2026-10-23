/**
 * 步骤 2「数据有效区」的覆盖率提示：**建议取数区可能没盖住完整数据区**。
 *
 * ## 这条提示治的是哪个缺陷（P1-C）
 *
 * `core.loadImage` 会自动建议一个 ROI（`suggested_roi`），前端在 `applyLoadedImage`
 * 里直接把它当成当前取数区。用户什么都不做就已经"用上了"这个框。而那个框是后端
 * 历史启发式算出来的，在真实论文图版上会**漏掉底部整片数据**。实测（真实图版
 * `output/han2026_ngamring/fig3_raw.jpeg`，2132×928）：
 *
 * ```
 * 建议 ROI:        xlim=[69,1867]  ylim=[266,744]
 * 真实刻度轴线:     y=869（真齿 y=870-875）
 * → 建议框底部 744，比刻度轴低 125px，整条横轴与它上面的数据被排除在框外
 * ```
 *
 * 用户看不出任何异常：界面正常、有列、能出数。丢的是**底部那一段层位的数据**，
 * 而读数照旧基于残缺区域。这就是"用户不知道自己在丢数据"，比报错的缺陷更危险。
 *
 * ## 为什么这里可以判断，而不必先请后端加字段
 *
 * 任务书要求：前端若无法可靠判断就停下报 Lead，不许自己猜阈值。所以本模块**不猜**
 * ——它直接调用后端已有的 `algorithm.detectXTicks`（G-01a 已实现，按物理结构找
 * "横轴 + 向下短齿"，不是拟合齿数），拿它返回的 `band` 反推轴线所在行，再与当前
 * ROI 的底边做**纯几何比较**：
 *
 * ```
 * 轴线行 > ROI 底边  →  框确实没盖到横轴
 * 轴线行 ≤ ROI 底边  →  盖到了
 * band 为 null      →  图上找不到刻度尺，无从判断（此时**不出**提示）
 * ```
 *
 * 这条判据没有可调阈值：它比的是"轴线在哪一行"与"框底在哪一行"两个真实坐标，
 * 差值多少像素就报多少像素。`band` 是后端从像素结构里算出来的，不是前端编的。
 *
 * 实测判别力（`pixi run python` 探针，同一张图不同框）：
 *
 * | 取数区 | ROI 底 | 轴线 | 判定 |
 * |---|---|---|---|
 * | 建议框 [266,744] | 744 | 869 | 漏（差 125px） |
 * | 手框 [233,869]   | 869 | 869 | 盖住 |
 * | 手框 [233,900]   | 900 | 869 | 盖住 |
 * | hoya（无刻度尺） | 任意 | null | 无从判断，不出提示 |
 * | beginner（同上） | 任意 | null | 无从判断，不出提示 |
 *
 * 反向对照（"盖住"时不得出提示）同样实测过：fig3 的 900/928/880/870 四个底边、
 * hoya 的四个框，全部 `warn=False`。即这不是一个"永远报警"的提示。
 *
 * ## 为什么提示里还要报"排除了多少边缘"
 *
 * 验收要求：让用户能自己判断框得对不对，而不只是被动接受一句警告。所以本模块
 * 同时给出四条边各自排除了多少像素、占图像多少比例——这部分是**纯算术**（图像
 * 尺寸与框坐标都是真实值），不依赖任何后端判定，因此在刻度尺检测失败时仍然可用。
 *
 * ## 与 `algorithm.detectXTicks` 的副作用
 *
 * 该 RPC 会把找到的 `band` 写进 `session.tick_band`（供步骤 6 复用）。这里只是
 * 提前调用它一次，不写任何用户数据；步骤 6 自己还会再算一遍，结果一致。
 */
import type { DiagramData } from '../../types/pollen';
import type { StepContext } from './_registry';
import type { RpcClient } from '../../services/RpcClient';
import { notifyError } from '../../ui/feedback';

/** 后端 `algorithm.detectXTicks` 的返回形状（只取本模块用到的字段）。 */
interface DetectXTicksResult {
  band?: number[] | null;
}

/** 一条边被框排除的像素数与占该方向的比例。 */
interface EdgeCut {
  px: number;
  pct: number;
}

interface CoverageEdges {
  left: EdgeCut;
  right: EdgeCut;
  top: EdgeCut;
  bottom: EdgeCut;
}

const pct = (part: number, whole: number): number =>
  whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;

/**
 * 四条边各自排除了多少像素。`xlim` / `ylim` 是真实框坐标，图像宽高是真实尺寸，
 * 因此这里没有任何估计成分。
 */
export function computeEdgeCuts(
  xlim: [number, number],
  ylim: [number, number],
  width: number,
  height: number
): CoverageEdges {
  const left = Math.max(0, xlim[0]);
  const right = Math.max(0, width - xlim[1]);
  const top = Math.max(0, ylim[0]);
  const bottom = Math.max(0, height - ylim[1]);
  return {
    left: { px: Math.round(left), pct: pct(left, width) },
    right: { px: Math.round(right), pct: pct(right, width) },
    top: { px: Math.round(top), pct: pct(top, height) },
    bottom: { px: Math.round(bottom), pct: pct(bottom, height) },
  };
}

/**
 * 判定结论。
 *
 * - `short-bottom`：刻度轴落在取数区底边**之下** → 框漏了底部数据（P1-C 本尊）。
 * - `covered`：刻度轴在框内 → 不提示。
 * - `unknown`：图上没检测到刻度尺 → 无从判断，不提示（不猜）。
 */
export type CoverageVerdict =
  | { kind: 'short-bottom'; axisRow: number; roiBottom: number; gapPx: number }
  | { kind: 'covered'; axisRow: number; roiBottom: number }
  | { kind: 'unknown' };

/**
 * 由后端 `band` 与 ROI 底边得出判定。
 *
 * `band` 的语义见 `session_parts/xticks.py::_locate_tick_band`：它返回
 * `(轴线行 + 1, 轴线行 + 1 + TICK_DEPTH)`，即**从轴线下方第一行开始**、不含轴线本身。
 * 所以轴线行 = `band[0] - 1`。这一步换算必须写死在这里，否则会拿"齿带第一行"
 * 当"轴线行"，差一行——虽然一行通常不影响结论，但判据要对得上它声称的对象。
 */
export function judgeCoverage(
  band: number[] | null | undefined,
  roiBottom: number
): CoverageVerdict {
  if (!Array.isArray(band) || band.length < 1 || !Number.isFinite(band[0])) {
    return { kind: 'unknown' };
  }
  const axisRow = Math.round(band[0] - 1);
  if (axisRow > roiBottom) {
    return { kind: 'short-bottom', axisRow, roiBottom, gapPx: Math.round(axisRow - roiBottom) };
  }
  return { kind: 'covered', axisRow, roiBottom };
}

/** 活动 ROI 的框坐标；缺失时返回 null（不编一个出来）。 */
function activeBox(data: DiagramData): { xlim: [number, number]; ylim: [number, number] } | null {
  const activeId = data.active_roi_id || data.rois?.[0]?.id;
  const roi = (data.rois || []).find((r) => r.id === activeId) || data.rois?.[0];
  const xlim = roi?.xlim ?? [data.roi?.xMin, data.roi?.xMax];
  const ylim = roi?.ylim ?? [data.roi?.yMin, data.roi?.yMax];
  if (
    !Array.isArray(xlim) ||
    xlim.length !== 2 ||
    !Number.isFinite(xlim[0]) ||
    !Number.isFinite(xlim[1]) ||
    !Array.isArray(ylim) ||
    ylim.length !== 2 ||
    !Number.isFinite(ylim[0]) ||
    !Number.isFinite(ylim[1])
  ) {
    return null;
  }
  return { xlim: [xlim[0], xlim[1]], ylim: [ylim[0], ylim[1]] };
}

/** 边缘排除情况的一行摘要：只报真实数字，四边都为 0 时明说"未排除"。 */
export function describeEdgeCuts(cuts: CoverageEdges): string {
  const parts: string[] = [];
  if (cuts.left.px > 0) parts.push(`左 ${cuts.left.px}px (${cuts.left.pct}%)`);
  if (cuts.right.px > 0) parts.push(`右 ${cuts.right.px}px (${cuts.right.pct}%)`);
  if (cuts.top.px > 0) parts.push(`上 ${cuts.top.px}px (${cuts.top.pct}%)`);
  if (cuts.bottom.px > 0) parts.push(`下 ${cuts.bottom.px}px (${cuts.bottom.pct}%)`);
  return parts.length > 0 ? parts.join('、') : '未排除任何边缘像素';
}

/**
 * 步骤 2 面板里那块提示的静态骨架。
 *
 * 先渲染一个空容器：判定要等 `algorithm.detectXTicks` 回来，而 `render` 是同步纯函数。
 * 容器本身把"边缘排除"这段**纯算术**先写出来——它不依赖后端，任何情况下都成立。
 *
 * 判定所需的三个事实（ROI id / 框底行 / 边缘排除文本）写进 `data-*` 属性而不是
 * 从 `mount` 的参数里拿：`StepPanelModule.mount(root, ctx)` 的契约只有 root 与 ctx，
 * 没有 `DiagramData`。为了一个面板去改所有面板共用的 registry 契约不划算，而这些
 * 值在 render 时本来就已经算好了，落进 DOM 是最短路径。
 */
export function renderRoiCoverageShell(data: DiagramData): string {
  const box = activeBox(data);
  const width = data.imageWidth || 0;
  const height = data.imageHeight || 0;
  if (!box || width <= 0 || height <= 0) return '';
  const cuts = computeEdgeCuts(box.xlim, box.ylim, width, height);
  const roiId = data.active_roi_id || data.rois?.[0]?.id || '';
  return `
      <!-- 取数区覆盖率（P1-C）：先给纯算术的边缘排除量，判定结果由异步探测填入。 -->
      <div id="roi-coverage-notice" class="roi-coverage-notice" role="status"
           data-roi-coverage="pending"
           data-roi-id="${roiId}"
           data-roi-bottom="${box.ylim[1]}"
           style="padding: 8px 9px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          <div><strong>本框排除的图像边缘：</strong><span id="roi-coverage-edges">${describeEdgeCuts(cuts)}</span></div>
          <div id="roi-coverage-verdict" style="margin-top: 4px; color: var(--text-muted);">
            正在核对取数区底边是否覆盖到横轴刻度线…
          </div>
        </div>
      </div>
    `;
}

/**
 * 判定为"漏底部"时的告警块（替换容器内容）。
 *
 * 三件事必须都在：① 框没盖到横轴刻度线（并给出两个真实坐标与差值）；
 * ② 后果是底部那一段层位的数据不会进入读数；③ 怎么修。
 */
function renderShortBottomNotice(
  verdict: Extract<CoverageVerdict, { kind: 'short-bottom' }>,
  edgesText: string
): string {
  return `
      <div id="roi-coverage-notice" class="roi-coverage-notice" role="alert"
           data-roi-coverage="short-bottom"
           data-axis-row="${verdict.axisRow}"
           data-roi-bottom="${verdict.roiBottom}"
           data-gap-px="${verdict.gapPx}"
           style="padding: 9px 10px; background: color-mix(in srgb, var(--status-warning) 8%, transparent); border: 1px solid var(--status-warning); border-left: 3px solid var(--status-warning); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 11.5px; font-weight: 700; color: var(--status-warning); margin-bottom: 6px;">
          当前取数区可能未覆盖完整数据区
        </div>
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          <div><strong>①</strong> 图上检测到的横轴刻度线在第 <code>${verdict.axisRow}</code> 行，而当前取数区底边在 <code>${verdict.roiBottom}</code> 行——底边比刻度线高 <strong>${verdict.gapPx}px</strong>，这段区间被排除在取数区之外。</div>
          <div style="margin-top: 3px;"><strong>②</strong> 被排除的区间里如果还有花粉带，它们的层位不会进入读数；而后续所有列与数值都只基于框内区域计算。</div>
          <div style="margin-top: 3px;"><strong>③</strong> 请在画布上把取数区底边向下拖到横轴刻度线以下（或直接编辑下方像素 Y 上限到 ${verdict.axisRow} 或更大），再重新分列。</div>
          <div style="margin-top: 4px; color: var(--text-muted);">本框排除的图像边缘：${edgesText}</div>
        </div>
      </div>
    `;
}

/** 判定为"盖住"时的中性摘要：仍然把边缘排除量留给用户判断。 */
function renderCoveredNotice(
  verdict: Extract<CoverageVerdict, { kind: 'covered' }>,
  edgesText: string
): string {
  return `
      <div id="roi-coverage-notice" class="roi-coverage-notice" role="status"
           data-roi-coverage="covered"
           data-axis-row="${verdict.axisRow}"
           data-roi-bottom="${verdict.roiBottom}"
           style="padding: 8px 9px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          <div><strong>取数区已覆盖横轴刻度线</strong>（刻度线第 <code>${verdict.axisRow}</code> 行，框底第 <code>${verdict.roiBottom}</code> 行）。</div>
          <div style="margin-top: 3px; color: var(--text-muted);">本框排除的图像边缘：${edgesText}</div>
        </div>
      </div>
    `;
}

/** 无从判断时（图上没有刻度尺）的说明：明说判断不了，而不是假装没事。 */
function renderUnknownNotice(edgesText: string): string {
  return `
      <div id="roi-coverage-notice" class="roi-coverage-notice" role="status"
           data-roi-coverage="unknown"
           style="padding: 8px 9px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          <div><strong>未检测到横轴刻度线</strong>，无法自动核对取数区底边是否完整；请自行确认框的上下边界是否盖住了整段花粉带。</div>
          <div style="margin-top: 3px; color: var(--text-muted);">本框排除的图像边缘：${edgesText}</div>
        </div>
      </div>
    `;
}

/**
 * 挂载异步探测：调后端 `algorithm.detectXTicks` 取真实轴线，填回容器。
 *
 * 探测失败时**不静默**：把失败原因写进容器（用户看得到"核对不了"及其原因），
 * 同时走 `notifyError` 让错误冒泡到统一通道。这里不复用静默兜底——静默正是本缺陷。
 */
export function mountRoiCoverageProbe(root: HTMLElement, ctx: StepContext): void {
  const holder = root.querySelector<HTMLElement>('#roi-coverage-notice');
  if (!holder) return;

  const roiId = holder.dataset.roiId || undefined;
  const roiBottom = Number(holder.dataset.roiBottom);
  if (!Number.isFinite(roiBottom)) return;
  const edgesText =
    holder.querySelector('#roi-coverage-edges')?.textContent?.trim() || '未排除任何边缘像素';

  // `StepContext` 有 `[key: string]: any` 兜底，直接拿 `ctx.rpcClient` 会退化成
  // `any`（tsc 报 TS2347：无类型函数不能带类型实参）。显式声明成 `RpcClient`
  // 才能既拿到泛型返回类型、又保留"这个通道可能不存在"的可选性。
  const rpc = (ctx as { rpcClient?: RpcClient }).rpcClient;
  if (!rpc || typeof rpc.call !== 'function') {
    // 没有 RPC 通道就判断不了——如实说，不留下"正在核对…"这种永不结束的假状态。
    holder.outerHTML = renderUnknownNotice(edgesText);
    return;
  }

  // 防陈旧写回：面板每次重渲染都会换掉整棵 DOM（`Inspector.renderStagePanel` 用
  // innerHTML 重绘），所以"这个容器还在文档里"就是"这次结果仍对应当前界面"的
  // 结构判据。旧写法比对的是同一个被捕获的对象，恒等成立，等于没有守卫——那是
  // 假守卫，必须改成看真实的 DOM 连接状态。
  const isStale = (): boolean => !holder.isConnected;

  void (async () => {
    try {
      const res = await rpc.call<{ roi_id?: string }, DetectXTicksResult>('algorithm.detectXTicks', {
        roi_id: roiId,
      });
      if (isStale()) return;
      const verdict = judgeCoverage(res?.band, roiBottom);
      if (verdict.kind === 'short-bottom') {
        holder.outerHTML = renderShortBottomNotice(verdict, edgesText);
      } else if (verdict.kind === 'covered') {
        holder.outerHTML = renderCoveredNotice(verdict, edgesText);
      } else {
        holder.outerHTML = renderUnknownNotice(edgesText);
      }
    } catch (err: unknown) {
      if (isStale()) return;
      const msg = err instanceof Error ? err.message : String(err);
      holder.outerHTML = `
      <div id="roi-coverage-notice" class="roi-coverage-notice" role="status"
           data-roi-coverage="probe-failed"
           style="padding: 8px 9px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-left: 3px solid var(--status-warning); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          <div><strong>刻度线核对失败</strong>（${msg}）。请手动确认取数区底边是否盖住了整段花粉带。</div>
          <div style="margin-top: 3px; color: var(--text-muted);">本框排除的图像边缘：${edgesText}</div>
        </div>
      </div>
    `;
      notifyError(`核对取数区是否覆盖完整数据区失败：${msg}`);
    }
  })();
}

/**
 * 供测试与调试使用：从列几何之外独立复算判定（不读 DOM）。
 *
 * E2E 需要一条"后端真值 vs 界面显示"的对照，避免只断言提示元素存在。
 */
export function judgeCoverageForTest(band: number[] | null, roiBottom: number): CoverageVerdict {
  return judgeCoverage(band, roiBottom);
}
