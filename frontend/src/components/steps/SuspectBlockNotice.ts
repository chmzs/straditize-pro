/**
 * 「这一列可能是色块/填充，不是曲线」的用户可见提示（P1 suspect_block）。
 *
 * ## 这条提示治的是哪个缺陷
 *
 * 后端能从像素结构判断某列**不是曲线而是填满整列的色块**（判据见下），但前端原本
 * 完全不读 `suspect_block` 这个键——用户看不到任何提示。危害是导出后拿到的是
 * **恒定的满量程假数据**：
 *
 * ```
 * col29（色块）  : mean=30.25  std=1.33    几乎恒定 —— 当真实花粉数据用会毁掉结论
 * col15（真曲线）: mean=5.95   std=8.95    有真实变化
 * ```
 *
 * 用户不知道这一列是色块，就会把它当真实数据写进论文。这属于"用户不知道自己在
 * 用什么"，比会报错的缺陷更危险。
 *
 * ## 判据的权威来源是后端，前端一律不重算
 *
 * 命中由后端按两个**纯结构量**同时成立来判定（`docs/JSON_RPC_SPECIFICATION.md` §4.3）：
 * - `cv`：逐行墨迹宽度的变异系数。真实曲线随层位变化（实测 ≥0.32），色块恒定
 *   （实测 ≤0.008），两者相差约 39 倍。
 * - `fill_ratio`：均值墨迹宽 / 列宽。色块填满整列（实测 ≥0.98），曲线有留白（实测 ≤0.74）。
 *
 * 前端拿不到灰度像素，自己算不出这两个量，也**不许**另立一套阈值（那会变成两套
 * 口径）。所以本模块只做两件事：把后端给的数翻译成人话，以及明确"用户该怎么办"。
 *
 * ## 命中不等于已剔除（这条是硬约束）
 *
 * 后端按"绝不返回替代数据"原则**照原样返回**该列的读数，只是附带证据；前端同样
 * **不得**自动删除、隐藏或跳过该列。有些色块本身就是用户要的信息（例如岩性柱、
 * 百分比填充带）。所以本模块只提供提示与"去步骤 6 处理"的入口，绝不返回任何
 * 过滤后的列数组。
 *
 * ## 实测口径（文案必须与之一致，不许夸大成"很多列都有问题"）
 *
 * 五张图各命中且**只命中 1 列**（hoya 第 29、beginner 第 4、Pollen 第 21、
 * Pollen bar 第 21、Pollen crv 第 21）。反向哨兵：hoya 的 col1..col28、
 * beginner 的 col1..col3、bar 的 col1..col20 一个都没被标。所以文案用
 * "有 N 列"并给出具体列名，不写"多列/大量"这种误导性措辞。
 */
import type { Column, DiagramData, SuspectBlock } from '../../types/pollen';

/**
 * 读取后端下发的 `suspect_block`。
 *
 * 后端对未命中的列下发 `null`（键存在、值为空），因此判据是"非空对象才算命中"，
 * 不能写成 `'suspect_block' in col`。形状不符（键存在但内容不是对象）时返回 `null`
 * ——**不猜**：说不清就不编一段提示出来。
 */
export function getSuspectBlock(col: Column | undefined | null): SuspectBlock | null {
  const raw = col?.suspect_block;
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

/** 当前载荷里所有被标记为色块的列，保持后端列序。 */
export function columnsWithSuspectBlock(cols: Column[] | undefined | null): Column[] {
  return (cols ?? []).filter((c) => getSuspectBlock(c) !== null);
}

/** 数字展示：整数直出，非整数保留足够位数（后端给的是 6 位小数的结构量）。 */
function fmtNum(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

/**
 * 列的称呼：优先用用户起的名字，回退到 colNN。
 *
 * 用 `col_index` 而不是数组下标——列增删后两者不等价，而用户看到的是 colNN 编号。
 */
export function columnLabel(col: Column): string {
  const name = (col.name || '').trim();
  if (name) return name;
  if (typeof col.col_index === 'number') {
    return `col${String(col.col_index + 1).padStart(2, '0')}`;
  }
  return col.id || '未知列';
}

/**
 * 把后端的证据翻译成一句人话。
 *
 * 只陈述后端给的事实：填满率、宽度是否恒定。**不**说"系统已确认这是色块"——
 * 后端给的判定是"疑似"（键名就是 suspect），说成确认会让用户以为系统比他更懂图。
 */
export function describeBlockEvidence(block: SuspectBlock): string {
  const parts: string[] = [];
  const fill = block.fill_ratio;
  if (typeof fill === 'number' && Number.isFinite(fill)) {
    parts.push(`该列墨迹平均填满列宽的 ${fmtNum(fill * 100, 1)}%`);
  }
  const cv = block.cv;
  if (typeof cv === 'number' && Number.isFinite(cv)) {
    // cv 是相对量，给百分比更直观；同时给绝对值便于对账后端载荷。
    parts.push(`逐行墨迹宽度的变异系数仅 ${fmtNum(cv, 4)}（${fmtNum(cv * 100, 2)}%，越接近 0 表示宽度越恒定）`);
  }
  const width = block.mean_ink_width;
  const colWidth = block.column_width;
  if (
    typeof width === 'number' &&
    Number.isFinite(width) &&
    typeof colWidth === 'number' &&
    Number.isFinite(colWidth)
  ) {
    parts.push(`平均墨迹宽 ${fmtNum(width, 1)} px / 列宽 ${fmtNum(colWidth, 1)} px`);
  }
  if (parts.length === 0) {
    // 后端只给了 reason、没给任何数值：如实说，不编数字。
    return '后端未提供该项的具体数值（只有判定原因）。';
  }
  return `${parts.join('；')}。`;
}

/** 一句话短语：列「X」的读数可能不是曲线。用于列表式摘要。 */
export function describeSuspectColumn(col: Column): string {
  const block = getSuspectBlock(col);
  const label = columnLabel(col);
  if (!block) return `列「${label}」`;
  return `列「${label}」（${block.reason ?? '未提供原因'}）`;
}

/**
 * 步骤 6（列标定）主面板：当前列被标记为色块时的完整提示。
 *
 * 三件事必须都在，缺一条用户就得自己推：
 * ① 这一列可能是色块/填充，不是曲线；
 * ② 判据依据（后端给的结构量，用人话说）；
 * ③ 该怎么办——在步骤 6 确认或移除该列，**系统不会自动删**。
 */
export function renderActiveColumnSuspectNotice(col: Column): string {
  const block = getSuspectBlock(col);
  if (!block) return '';
  const label = columnLabel(col);
  return `
      <!-- 该列被标记为色块/填充（P1 suspect_block）。纯函数渲染，不做任何缓存。 -->
      <div class="inspector-section suspect-block-notice" role="alert"
           data-panel="step6" data-col-id="${col.id}" data-suspect-reason="${block.reason ?? ''}"
           style="padding: 9px 10px; background: color-mix(in srgb, var(--status-warning) 8%, transparent); border: 1px solid var(--status-warning); border-left: 3px solid var(--status-warning); border-radius: 6px; margin-bottom: 10px;">
        <div style="font-size: 11.5px; font-weight: 700; color: var(--status-warning); margin-bottom: 6px;">
          列「${label}」可能是色块或填充带，不是曲线
        </div>
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          <div><strong>①</strong> 后端从像素结构判断这一列被墨迹填满，宽度几乎不随层位变化——它更像一块色块/填充带，而不是有起伏的曲线。</div>
          <div style="margin-top: 3px;"><strong>②</strong> 判据依据：${describeBlockEvidence(block)}</div>
          <div style="margin-top: 3px;"><strong>③</strong> 请在下方确认该列的真实含义：如果它确实是色块/岩性柱而非属种数据，用本面板底部的【删除列】把它从读数中剔除；如果它本来就是你要的信息，可以保留——系统不会自动删除它，也不会替你改写读数。</div>
        </div>
        <div style="font-size: 10px; color: var(--text-muted); line-height: 1.45; margin-top: 5px;">
          说明：本列的数据按原样保留在导出结果里。提示只是告诉你"它可能不是曲线"，导出前请自行确认。
        </div>
      </div>
    `;
}

/**
 * 步骤 6：其它同样被标记的列（避免用户只盯着当前列，把其余列漏掉）。
 *
 * 只列名字与原因短语，不重复三件套长文；在侧栏点名即可切到那一列看详情。
 */
export function renderOtherSuspectColumnsSummary(
  cols: Column[],
  activeId: string | undefined
): string {
  const others = columnsWithSuspectBlock(cols).filter((c) => c.id !== activeId);
  if (others.length === 0) return '';
  return `
      <div class="inspector-section suspect-block-summary" role="status"
           style="padding: 7px 9px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-left: 3px solid var(--status-warning); border-radius: 6px; margin-bottom: 12px;">
        <div style="font-size: 10.5px; font-weight: 700; color: var(--status-warning); margin-bottom: 4px;">
          另有 ${others.length} 列同样被标记为可能是色块
        </div>
        <div style="font-size: 10px; line-height: 1.5; color: var(--text-secondary);">
          ${others.map((c) => describeSuspectColumn(c)).join('<br>')}
          <div style="margin-top: 4px;">逐列确认后，各列的提示会各自消失（若该列被重新分列后不再命中）。</div>
        </div>
      </div>
    `;
}

/**
 * 步骤 5（分列与命名）的提示：分列刚跑完，标记就在这一步产生。
 *
 * 没有命中列时返回空串：正常流程不该出现任何提示（e2e 的 notices 门禁也据此守）。
 */
export function renderSplitSuspectNotice(cols: Column[]): string {
  const suspect = columnsWithSuspectBlock(cols);
  if (suspect.length === 0) return '';
  const head =
    suspect.length === 1
      ? '本次分列后有 1 列可能是色块/填充带，不是曲线'
      : `本次分列后有 ${suspect.length} 列可能是色块/填充带，不是曲线`;
  return `
      <!-- 分列产出的色块标记（P1 suspect_block）：在分列这一步就报出来。 -->
      <div class="inspector-section suspect-block-notice" role="alert"
           data-panel="step5" data-suspect-count="${suspect.length}"
           style="padding: 9px 10px; background: color-mix(in srgb, var(--status-warning) 8%, transparent); border: 1px solid var(--status-warning); border-left: 3px solid var(--status-warning); border-radius: 6px; margin-bottom: 12px;">
        <div style="font-size: 11.5px; font-weight: 700; color: var(--status-warning); margin-bottom: 6px;">
          ${head}
        </div>
        <div style="font-size: 10.5px; line-height: 1.55; color: var(--text-secondary);">
          ${suspect.map((c) => describeSuspectColumn(c)).join('<br>')}
          <div style="margin-top: 5px;">
            这些列的墨迹填满整列、宽度几乎不随层位变化，更像色块而非曲线。它们的读数会照原样进入导出，系统不会自动剔除；请在步骤 6 逐列确认是否要保留。
          </div>
        </div>
      </div>
    `;
}

/**
 * 导出就绪清单里的那一条（步骤 8 / 导出弹窗）——**这是最后一道拦截**。
 *
 * 为什么必须放在这里：用户最终在就绪清单前决定导不导。若只在步骤 5/6 提示过，
 * 用户走完若干步后早已忘记，导出时正是最需要再提醒一次的时刻。
 *
 * 注意本清单是**前端按 `getDiagramData` 的列载荷自己算的**（`computeExportReadiness`），
 * 不依赖 `export.getReadiness`——后端那个接口不含本字段（实测 keys 只有
 * sheets / primary_roi / readiness_missing / ready / ... ），所以无需后端加字段。
 *
 * 命中时返回一条告警；未命中返回空串（正常流程不该出现噪音）。
 */
export function renderExportSuspectBlockRow(data: DiagramData): string {
  const suspect = columnsWithSuspectBlock(data.columns);
  if (suspect.length === 0) return '';
  const names = suspect.map((c) => columnLabel(c)).join('、');
  return `
      <div class="export-suspect-block-row" role="alert"
           data-export-suspect-count="${suspect.length}"
           data-export-suspect-cols="${suspect.map((c) => columnLabel(c)).join(',')}"
           style="margin-top: 6px; padding: 7px 9px; background: color-mix(in srgb, var(--status-warning) 8%, transparent); border: 1px solid var(--status-warning); border-left: 3px solid var(--status-warning); border-radius: 6px; line-height: 1.5;">
        <div style="font-size: 10.5px; font-weight: 700; color: var(--status-warning); margin-bottom: 3px;">
          有 ${suspect.length} 列可能是色块，不是曲线：${names}
        </div>
        <div style="font-size: 10px; color: var(--text-secondary);">
          这些列的墨迹填满整列、宽度几乎不随层位变化，读数会照原样进入导出。若不是你要的数据，请回到步骤 6 点选该列并点【删除列】后再导出；系统不会自动剔除。
        </div>
      </div>
    `;
}
