/**
 * 「本列原有的 X 刻度标定被后端清空」的用户可见提示。
 *
 * ## 这条提示治的是哪个缺陷
 *
 * B-02：用户标好某列的 X 轴刻度后，去挪 ROI 边界再重新分列。列边界一变，原来
 * 两个刻度像素就可能落在新列带之外——后端 `detect_columns` 的 preserve_state 分支
 * 有一条 `lo/hi = min/max(start,end) ∓ 10` 的区间守卫，越界就把 `x_ticks` 丢掉。
 * 丢弃本身是合理的（旧像素确实不再属于这一列），**静默**才是缺陷：用户看不到任何
 * 变化，只会在若干步之后发现读数没了，而且无从判断是自己没填还是被系统清掉。
 *
 * 现在后端在「被丢弃标定的列」上多下发一个可选键（契约见 `types/pollen.ts` 的
 * `XTicksDropped`），本模块只负责一件事：把它变成界面上读得懂的提示。
 *
 * ## 文案口径：必须区分「检测到齿位」与「已标定」
 *
 * 这是既有原则（见 `services/InspectorBridge.ts` 的 `onDetectXTicks`）：自动提取
 * 只给**几何齿位**，标定必须由用户填入**真实读数**。所以本提示里一处都不许出现
 * "自动标定成功""已替你恢复"这类说法——丢了标定就是丢了，只能请用户重新填。
 * 同理 `detectXTicks` 之后如果某列仍缺读数，本提示应当继续存在（齿位不是标定），
 * `isXTicksLost` 的判据因此只看 `x_ticks`，不看齿位。
 *
 * ## 判据为什么是「有 x_ticks_dropped 且当前没有 x_ticks」
 *
 * 后端会在三种情况下清掉这个键：该列重新标定成功、该列 `clearXTicks`、下一次
 * 分列该列未被丢弃。前端镜像（`canvasComponent.data.columns`）在标定成功后是由
 * `InspectorBridge` 就地写 `col.x_ticks = res.x_ticks` 的，不会立刻重取后端载荷，
 * 所以**只靠键消失会让提示比事实晚一拍**。把 `x_ticks` 也纳入判据后，任何一次
 * 成功标定都会让提示当次重渲染就消失，不需要等任何缓存刷新。
 *
 * 反过来，用户主动【清空本列标度】时后端会清键，而前端镜像里那个旧键还在——
 * 若不同步，下一次渲染会把用户自己的清空误报成"因取数区变动被清空"。所以标定/
 * 清空之后调用 `syncXTicksDroppedFromBackend()`，把镜像对齐成后端事实。
 *
 * ## 文案为什么不走 i18n 词条
 *
 * 本模块所在目录（`components/steps/`）的既有面板把说明性中文直接写在模板里
 * （`XTicksPanel` 的"当前列刻度标尺""交互提示"、`NamingPanel` 的对账清单都是），
 * 而词条文件 `i18n/locales/*.ts` 不在本次任务的写作用域内。用 `t()` 加一个不存在
 * 的 key 只会渲染出 key 本身，比硬编码更糟，所以这里与同目录面板保持一致。
 */
import type { Column, DiagramData, XTicksDropped } from '../../types/pollen';
import type { StepContext } from './_registry';
import { notifyError } from '../../ui/feedback';

/**
 * 读取后端下发的 `x_ticks_dropped`。
 *
 * 后端可能用 tuple 也可能用 list，JSON 过桥后都是数组，统一按 `number[]` 读。
 * 形状不符（键存在但内容不是对象）时返回 `null`——**不猜**：说不清就不要编一段
 * 提示出来。
 */
export function getXTicksDropped(col: Column | undefined | null): XTicksDropped | null {
  const raw = col?.x_ticks_dropped;
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

/** 该列当前是否存在「已标定」的两个端点。与 `XTicksPanel` 的 hasTicks 同义。 */
export function hasXTicks(col: Column | undefined | null): boolean {
  return Boolean(col && Array.isArray(col.x_ticks) && col.x_ticks.length === 2);
}

/**
 * 该列是否处于「标定被清空且尚未重新标定」。
 *
 * 两个条件缺一不可：有丢弃记录（`x_ticks_dropped`）＋ 当前确实没有端点
 * （`x_ticks`）。只看前者会把"已重新标定、但键还没被后端清掉"的中间态误报成丢标定。
 */
export function isXTicksLost(col: Column | undefined | null): boolean {
  return Boolean(getXTicksDropped(col)) && !hasXTicks(col);
}

/** 当前载荷里所有「标定被清空」的列，保持后端列序。 */
export function columnsWithLostXTicks(cols: Column[] | undefined | null): Column[] {
  return (cols ?? []).filter((c) => isXTicksLost(c));
}

/** 像素值展示：整数直出，非整数保留一位（后端下发的是 float，如 339.0）。 */
function fmtPx(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * 把 `px` / `band` 规整成有限数数组。
 *
 * 非数值一律丢弃，**绝不补 0**：编一个像素坐标出来比不显示更坏。
 */
function finiteNumbers(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** 原刻度像素的展示文本；后端没给就如实说没给。 */
export function formatOriginalPx(dropped: XTicksDropped): string {
  const px = finiteNumbers(dropped.px);
  if (px.length === 0) return '后端未提供原刻度像素';
  return px.map((p) => `X = ${fmtPx(p)} px`).join('、');
}

/** 新列带的展示文本。 */
export function formatNewBand(dropped: XTicksDropped): string {
  const band = finiteNumbers(dropped.band);
  if (band.length !== 2) return '后端未提供';
  const lo = Math.min(band[0], band[1]);
  const hi = Math.max(band[0], band[1]);
  return `X = ${fmtPx(lo)} ~ ${fmtPx(hi)} px`;
}

/**
 * 该列**当前真实存在的**像素列带，直接取列几何。
 *
 * 为什么不复用 `x_ticks_dropped.band`：后端已确认两者语义不同（见
 * `types/pollen.ts` 的 `XTicksDropped.band` 注释）——`out_of_band` 下 band 是含
 * ±10 外扩的**守卫区间**，比列本身宽；只有 `column_layout_changed` 下它才是列边界。
 * 用户问"我这列现在到底在哪"时，答案是列几何（`startX`/`endX`），不是守卫区间。
 */
export function formatColumnBand(col: Column): string {
  const start = col.startX;
  const end = col.endX;
  if (typeof start !== 'number' || typeof end !== 'number') return '列几何未提供';
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return `X = ${fmtPx(lo)} ~ ${fmtPx(hi)} px`;
}

/**
 * `band` 这个字段在提示里该被叫作什么。
 *
 * `out_of_band` 下它是守卫区间（`[start-10, end+10]`），说成"列带"会让用户以为
 * 列就这么宽、进而怀疑列几何算错了；`column_layout_changed` 下它确实是列边界。
 */
function bandLabel(dropped: XTicksDropped): string {
  return dropped.reason === 'column_layout_changed'
    ? '当前列带'
    : '当时允许刻度的区间（列边界左右各放宽 10 px）';
}

/**
 * 一句话短语：「列「col03」的 X 刻度标定已因取数区/列边界变动被清空（…）」。
 *
 * 步骤 5 的对账清单与步骤 6 的多列汇总共用它，避免两处各写一句措辞。
 * 里面报的"列现在在哪"一律取**列几何**（`formatColumnBand`），不用
 * `x_ticks_dropped.band`——后者在 `out_of_band` 下是含 ±10 外扩的守卫区间，
 * 汇总行里没空间再解释这个差别，用了就会让用户以为列变宽了。
 */
export function describeLostColumn(col: Column): string {
  const dropped = getXTicksDropped(col);
  if (!dropped) return `列「${col.name}」的 X 刻度标定不可用`;
  const cause =
    dropped.reason === 'column_layout_changed'
      ? '列布局已变动（列数变了，该索引不再是原来那一列）'
      : '取数区/列边界变动';
  return (
    `列「${col.name}」的 X 刻度标定已因${cause}被清空` +
    `（原刻度像素 ${formatOriginalPx(dropped)}；该列现在 ${formatColumnBand(col)}）`
  );
}

/** 两个原刻度端点是否确实都落在新列带之外（只在证据齐全时给这句加强说明）。 */
function allEndpointsOutsideBand(dropped: XTicksDropped): boolean {
  const px = finiteNumbers(dropped.px);
  const band = finiteNumbers(dropped.band);
  if (px.length === 0 || band.length !== 2) return false;
  const lo = Math.min(band[0], band[1]);
  const hi = Math.max(band[0], band[1]);
  return px.every((p) => p < lo || p > hi);
}

/**
 * 两种丢弃原因的用户叙述。
 *
 * 后端确实产生两种（实测 2026-10-23，见 `session_parts/core.py` 的两个分支），
 * 而且**用户要做的动作不同**，所以不能合并成一句话：
 *
 * - `out_of_band`：还是同一列，只是原刻度像素落到了守卫区间
 *   `[start-10, end+10]` 之外（列数没变）。用户只需重填读数。
 * - `column_layout_changed`：列数变了（hoya 实测 28→27），这个索引上的物理列
 *   已经不是原来那一列。用户必须先确认这块列带还是不是他要的那一列，再决定
 *   重标还是接受新切分。
 *
 * 注意 `band` 在两种原因下**语义不同**（后端已确认）：前者是含 ±10 外扩的守卫
 * 区间，后者才是新列的真实边界。所以本模块给"列现在在哪"一律取列几何
 * （`formatColumnBand`），`band` 只在带限定语的情况下另行展示。
 *
 * 未知原因（后端将来新增）一律走中性的第三种叙述：如实说出后端给的原因字串，
 * 不猜、也不隐藏。
 */
function describeCause(dropped: XTicksDropped): { headline: string; body: string } {
  switch (dropped.reason) {
    case 'out_of_band':
      return {
        headline: '本列原有的 X 刻度标定已被清空',
        body:
          '取数区或列边界变动后重新分列，本列原有的刻度端点已不在新列带内，' +
          '后端已清空该列的标定读数（当前状态：未标定）。',
      };
    case 'column_layout_changed':
      return {
        headline: '本列原有的 X 刻度标定已被清空（列布局已变动）',
        body:
          '取数区变动导致重新分列的列数与上次不同，这一列对应的已经不是原来那块列带，' +
          '后端因此清空了原标定读数（当前状态：未标定）。',
      };
    default:
      return {
        headline: '本列原有的 X 刻度标定已被清空',
        body: `后端标记该列标定已被丢弃（原因：${dropped.reason ?? '未提供'}），当前状态：未标定。`,
      };
  }
}

/**
 * 步骤 6 主面板：当前列丢了标定时的完整提示。
 *
 * 三件事必须都在，缺一条用户就得自己推：① 标定已被清空（不是你没填）；
 * ② 原来的刻度像素在哪、新的列带在哪；③ 需要重新标定以及怎么做。
 */
export function renderActiveColumnLostNotice(col: Column): string {
  const dropped = getXTicksDropped(col);
  if (!dropped) return '';
  const cause = describeCause(dropped);
  // 「列现在在哪」用列几何（权威、且两种 reason 下语义一致）；
  // 「当时允许的范围」才用后端给的 band，两者并列但不混称"列带"。
  const columnBand = formatColumnBand(col);
  const sortedBand = finiteNumbers(dropped.band);
  const showGuardBand =
    sortedBand.length === 2 &&
    JSON.stringify(sortedBand) !==
      JSON.stringify([Math.min(col.startX, col.endX), Math.max(col.startX, col.endX)]);
  return `
      <!-- 标定被清空的用户可见记录（B-02）。纯函数渲染，不做任何缓存。 -->
      <!-- 默认折叠成一行：常驻展开的三段长文会把下方标度输入框与属种表格挤出
           视口（用户实测反馈"红色框出的部分太占地方""表格浏览留着这么小的空间"）。
           一行摘要已足以说明"标定丢了、需要重标"，细节按需展开。 -->
      <details class="x-ticks-lost-notice" role="alert"
           data-panel="step6" data-col-id="${col.id}" data-reason="${dropped.reason ?? ''}"
           style="margin-bottom: 6px; background: color-mix(in srgb, var(--status-warning) 8%, transparent); border: 1px solid var(--status-warning); border-left: 3px solid var(--status-warning); border-radius: 4px; padding: 3px 8px;">
        <summary style="font-size: 10px; font-weight: 600; color: var(--status-warning); cursor: pointer; list-style: none; display: flex; align-items: center; gap: 4px;">
          <span style="flex-shrink: 0;">${cause.headline}</span>
          <span style="color: var(--text-secondary); font-weight: 400;">（需重新标定）</span>
        </summary>
        <div style="font-size: 9.5px; line-height: 1.45; color: var(--text-secondary); padding: 4px 0 2px 0;">
          <div><strong>①</strong> ${cause.body}</div>
          <div style="margin-top: 2px;"><strong>②</strong> 原刻度像素：<code>${formatOriginalPx(dropped)}</code>；该列现在范围：<code>${columnBand}</code>${allEndpointsOutsideBand(dropped) ? '（两端点都在允许区间外）' : ''}。</div>
          ${
            showGuardBand
              ? `<div style="margin-top: 2px; color: var(--text-muted);">${bandLabel(dropped)}：<code>${formatNewBand(dropped)}</code>。</div>`
              : ''
          }
          <div style="margin-top: 2px;"><strong>③</strong> 填两个端点的真实读数并点【保存标度】，或先在图上拖拽绿色刻度齿对齐。重标成功后本提示自动消失。</div>
          <div style="margin-top: 3px; color: var(--text-muted);">刻度齿只是几何位置；【自动提取】只给齿位，读数必须由你填，系统不会替你填。</div>
        </div>
      </details>
    `;
}

/**
 * 步骤 6：其它同样丢了标定的列（避免用户只盯着当前列，把其余列漏掉）。
 *
 * 只列名字与原因短语，不重复三件套长文；在侧栏点名即可切到那一列看详情。
 */
export function renderOtherLostColumnsSummary(
  cols: Column[],
  activeId: string | undefined
): string {
  const others = columnsWithLostXTicks(cols).filter((c) => c.id !== activeId);
  if (others.length === 0) return '';
  const names = others.map((c) => c.name).join('、');
  // 折叠成一行：常驻展开会挤占侧栏，把标度输入框与表格推下去。
  return `
      <details class="x-ticks-lost-summary" role="status"
           style="margin-bottom: 6px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-left: 3px solid var(--status-warning); border-radius: 4px; padding: 3px 8px;">
        <summary style="font-size: 10px; font-weight: 600; color: var(--status-warning); cursor: pointer; list-style: none; display: flex; align-items: center; gap: 4px;">
          <span style="flex-shrink: 0;">另有 ${others.length} 列同样丢了标定：</span>
          <span style="color: var(--text-secondary); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${names}</span>
        </summary>
        <div style="font-size: 9.5px; line-height: 1.45; color: var(--text-secondary); padding: 4px 0 2px 0;">
          ${others.map((c) => describeLostColumn(c)).join('<br>')}
        </div>
      </details>
    `;
}

/**
 * 步骤 5：分列刚跑完——用户正是在这一步挪 ROI 的，所以丢标定必须在这一步就报出来。
 *
 * 没有丢弃列时返回空串：正常流程不该出现任何提示（e2e 的 notices 门禁也据此守）。
 */
export function renderSplitLostXTicksNotice(cols: Column[]): string {
  const lost = columnsWithLostXTicks(cols);
  if (lost.length === 0) return '';
  const head =
    lost.length === 1
      ? '本次重新分列后，有 1 列的 X 刻度标定被清空'
      : `本次重新分列后，有 ${lost.length} 列的 X 刻度标定被清空`;
  return `
      <!-- 重新分列导致的标定丢失（B-02）：必须在分列这一步就报出来，不能等用户走到步骤 6 才发现。 -->
      <div class="inspector-section x-ticks-lost-notice" role="alert"
           data-panel="step5" data-lost-count="${lost.length}"
           style="padding: 9px 10px; background: color-mix(in srgb, var(--status-warning) 8%, transparent); border: 1px solid var(--status-warning); border-left: 3px solid var(--status-warning); border-radius: 6px; margin-bottom: 12px;">
        <div style="font-size: 11.5px; font-weight: 700; color: var(--status-warning); margin-bottom: 6px;">
          ${head}
        </div>
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          ${lost.map((c) => describeLostColumn(c)).join('<br>')}
          <div style="margin-top: 5px;">
            这些列现在处于「未标定」状态：原来填入的刻度读数已随列边界变动失效，需要你在步骤 6 重新填入真实读数。齿位检测不等于标定，系统不会替你填数。
          </div>
        </div>
      </div>
    `;
}

/**
 * `StepContext` 把回调声明为 `() => void`，而 `InspectorBridge` 的实现是 async。
 * 想「等这次标定/清空真正结束后再回读权威状态」，就必须拿到那个真实的 Promise。
 */
export async function callStepCallback(run: (() => void) | undefined): Promise<void> {
  if (!run) return;
  const ret = (run as unknown as () => unknown)();
  if (ret && typeof (ret as Promise<void>).then === 'function') {
    await (ret as Promise<void>);
  }
}

/**
 * 把前端镜像上的 `x_ticks_dropped` 对齐成后端当前事实。
 *
 * 为什么不能只靠本地改：后端在「重新标定成功 / clearXTicks」时清键，而前端镜像
 * 是就地改 `x_ticks` 的，那个键不会自己消失。留着一个过期键，用户主动【清空本列
 * 标度】之后就会看到「标定因取数区变动被清空」——而事实是他自己清的，等于又一次
 * 误导。
 *
 * **只同步 `x_ticks_dropped` 这一个字段**，绝不碰 `x_ticks` / 几何 / 名字：
 * `x_ticks` 的写入方是 `InspectorBridge`（它拿到的是 `column.calibrateXTicks` 的
 * 返回值），面板再去覆盖它就是在两个写者之间打架。提示是否显示本来也不需要改
 * `x_ticks`——`isXTicksLost` 已经要求"有丢弃键且当前没有端点"，标定成功的当次
 * `hasXTicks` 就为真，提示自己就消失了。
 *
 * 读失败必须冒泡给用户（不静默吞掉）。
 */
export async function syncXTicksDroppedFromBackend(
  data: DiagramData | null | undefined,
  ctx: StepContext
): Promise<void> {
  const rpc = ctx.rpcClient;
  if (!data || typeof rpc?.getDiagramData !== 'function') return;
  let fresh: DiagramData;
  try {
    fresh = await rpc.getDiagramData();
  } catch (err) {
    notifyError(
      `刷新「标定是否被后端清空」的状态失败：${err instanceof Error ? err.message : String(err)}`
    );
    return;
  }
  const byId = new Map<string, XTicksDropped | null>();
  for (const c of fresh?.columns ?? []) {
    byId.set(c.id, getXTicksDropped(c));
  }
  let changed = false;
  for (const col of data.columns ?? []) {
    // 后端这次没返回该列（列被删/重分列换了 id）：不动它，等下一次载荷再说。
    if (!byId.has(col.id)) continue;
    const next = byId.get(col.id) ?? null;
    const prev = getXTicksDropped(col);
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    if (next) col.x_ticks_dropped = next;
    else delete col.x_ticks_dropped;
    changed = true;
  }
  if (changed) ctx.onDataChange?.();
}
