/**
 * Discovery lane —— 状态常量、状态机与「状态 → 合法动作集」表。
 *
 * ## 这一层负责什么
 *
 * 只做三件事，全部是**纯数据与纯函数**，不碰浏览器、不碰 RPC：
 *
 * 1. 状态枚举（`STATES`）与「怎么从后端权威载荷推断出当前状态」（`inferState`）；
 * 2. 动作表（`TRANSITIONS`）：每个动作声明前置状态、允许进入的后继状态、是否危险；
 * 3. `legalActionIds(state)`：给定状态时的候选动作 id 集（不含 UI 可行性，那一层在
 *    `actions.mjs` 的 `ready()` 里判定）。
 *
 * 之所以把「状态」和「动作」拆成两个文件、且本文件零依赖：`run.mjs` 需要能在
 * 启动时把两张表**交叉校验**（表里有而实现里没有 = 配置漂移，必须当场炸），
 * 而循环 import 会让那个校验在最需要它的时候拿不到完整表。
 *
 * ## 状态怎么推断（这是本 lane 唯一的主观决定，写在这里以便被质疑）
 *
 * 主判据一律来自**后端权威载荷**（`straditize.getDiagramData` + `samples.list`），
 * 不看 DOM 外观。只有一个例外：`IMAGE_LOADED` 与 `ROI_READY` 在后端载荷里无法区分
 * ——载图时后端会**原子地**自动建一个 `pollen` 建议 ROI（`session_parts/core.py`
 * 的 `suggest_data_region` → `roi_create`），所以「有图无 ROI」这个后端状态
 * 在真实产品里根本不存在。要区分"用户还没进第 2 步"与"已经在划 ROI"，
 * 只能用前端工作流步骤号（`getState().stage`）这个**界面事实**。
 *
 * 这条例外是刻意的、也是有限的：它只用来把一个状态拆成两个，不参与任何断言。
 * 所有不变量（`invariants.mjs`）只读后端与 DOM，不读 `stage`。
 *
 * ## 单调性
 *
 * 状态按流水线顺序排（`STATE_LIST`），但**不是**单调的：`delete_roi`、`clear_horizons`、
 * `undo` 都会把状态往回推。`inferState` 每次都是无记忆的纯函数重算，所以回退是
 * 自然结果，不需要额外记账。
 */

/** 状态常量。字符串值与文档、`seq.json`、失败报告里的字面量完全一致。 */
export const STATES = Object.freeze({
  EMPTY: 'EMPTY',
  IMAGE_LOADED: 'IMAGE_LOADED',
  ROI_READY: 'ROI_READY',
  Y_CALIBRATED: 'Y_CALIBRATED',
  CLEANED: 'CLEANED',
  COLUMNS_DETECTED: 'COLUMNS_DETECTED',
  X_CALIBRATED: 'X_CALIBRATED',
  SAMPLES_READY: 'SAMPLES_READY',
  EXPORT_READY: 'EXPORT_READY',
});

/** 流水线顺序（仅用于报告与排序，不表示可达性约束）。 */
export const STATE_LIST = Object.freeze([
  STATES.EMPTY,
  STATES.IMAGE_LOADED,
  STATES.ROI_READY,
  STATES.Y_CALIBRATED,
  STATES.CLEANED,
  STATES.COLUMNS_DETECTED,
  STATES.X_CALIBRATED,
  STATES.SAMPLES_READY,
  STATES.EXPORT_READY,
]);

/** 除 `EMPTY` 外的全部状态：多数动作在有图之后都可尝试。 */
const WITH_IMAGE = Object.freeze([
  STATES.IMAGE_LOADED,
  STATES.ROI_READY,
  STATES.Y_CALIBRATED,
  STATES.CLEANED,
  STATES.COLUMNS_DETECTED,
  STATES.X_CALIBRATED,
  STATES.SAMPLES_READY,
  STATES.EXPORT_READY,
]);

/**
 * 动作表。字段含义：
 *
 * - `id`        —— 动作标识，与 `actions.mjs` 的键一一对应（`run.mjs` 启动时强校验）。
 * - `label`     —— 报告里给人看的名字。
 * - `from`      —— **前置状态**：只有当前状态在此列表里，该动作才是候选。
 * - `to`        —— **动作后允许进入的状态**。这是声明式契约，不是断言：
 *                  实际落点不在其中时，`run.mjs` 记 `stateUnexpected`（观测项），
 *                  因为「点了没反应」在随机探索里是常见且合法的（例如对已标定的
 *                  列再点一次保存，状态不变）。
 * - `dangerous` —— 危险动作：返回 / 删除 / 重做 / 保存重开 / 连击。危险动作**不排除**，
 *                  只是被单独统计与标注，便于把失败归因到"破坏性操作"。
 * - `note`      —— 为什么危险 / 有什么副作用。
 */
export const TRANSITIONS = Object.freeze([
  {
    id: 'upload_image',
    label: '上传真实图片（#btn-open-file → filechooser）',
    from: [STATES.EMPTY],
    to: [STATES.IMAGE_LOADED, STATES.ROI_READY],
    dangerous: false,
    note: '走真实文件选择器；零状态下唯一合法动作。',
  },
  {
    id: 'goto_step2',
    label: '第 1 步 → 第 2 步（#btn-goto-step2）',
    from: [STATES.IMAGE_LOADED],
    to: [STATES.ROI_READY],
    dangerous: false,
    note: '载图后界面停在第 1 步，第 2 步面板（ROI 卡片/手柄）此刻并不存在——'
      + '这是「进入了这一步」的唯一入口，漏了它整条探索就只能停在第 1 步。',
  },
  {
    id: 'drag_roi_corner',
    label: '拖 ROI 右下角手柄（真实鼠标）',
    from: WITH_IMAGE,
    to: [STATES.ROI_READY, STATES.Y_CALIBRATED, STATES.CLEANED, STATES.COLUMNS_DETECTED],
    dangerous: false,
    note: '需要第 2 步面板存在；坐标按 fitToScreen 公式反算。',
  },
  {
    id: 'create_roi',
    label: '新建 ROI（#btn-create-roi）',
    from: WITH_IMAGE,
    to: [STATES.ROI_READY],
    dangerous: false,
    note: '多 ROI 是列归属错乱的高危场景，值得反复走到。',
  },
  {
    id: 'select_roi',
    label: '切换活动 ROI（点 .roi-item-card）',
    from: WITH_IMAGE,
    to: [STATES.ROI_READY, STATES.COLUMNS_DETECTED, STATES.CLEANED],
    dangerous: false,
    note: '切换活动 ROI 后，列/清理面板的归属应随之改变。',
  },
  {
    id: 'set_primary_roi',
    label: '设为主 ROI（.btn-set-primary）',
    from: WITH_IMAGE,
    to: [STATES.ROI_READY, STATES.COLUMNS_DETECTED],
    dangerous: false,
    note: '主 ROI 决定 data.csv 的归属不变式。',
  },
  {
    id: 'delete_roi',
    label: '删除 ROI（.btn-delete-roi）',
    from: WITH_IMAGE,
    to: [STATES.IMAGE_LOADED, STATES.ROI_READY],
    dangerous: true,
    note: '删除：不变量 ⑤ 的主要触发路径（删掉的 id 不得在任何状态里复活）。',
  },
  {
    id: 'rename_roi',
    label: '改 ROI 名（#inp-roi-name，真实 input 事件）',
    from: WITH_IMAGE,
    to: [STATES.ROI_READY, STATES.CLEANED, STATES.COLUMNS_DETECTED],
    dangerous: false,
    note: '不变量 ⑥ 拿 ROI 名做跨保存/重开的比对项。',
  },
  {
    id: 'apply_roi_next',
    label: '第 2 步 → 第 3 步（#btn-apply-roi-next）',
    from: [STATES.ROI_READY, STATES.IMAGE_LOADED],
    to: [STATES.Y_CALIBRATED, STATES.ROI_READY],
    dangerous: false,
    note: '真实推进按钮；进入第 4/5 步会触发其副作用（检测候选 / 重分列）。',
  },
  {
    id: 'commit_ycalib',
    label: '提交 Y 轴两点标定（5 个输入框 + #btn-apply-ycalib）',
    from: WITH_IMAGE,
    to: [STATES.Y_CALIBRATED],
    dangerous: false,
    note: '一次性写全五框再点应用，规避 F-3 逐框提交竞态。',
  },
  {
    id: 'apply_ycalib_next',
    label: '第 3 步 → 第 4 步（#btn-apply-ycalib-next）',
    from: [STATES.Y_CALIBRATED],
    to: [STATES.CLEANED, STATES.Y_CALIBRATED],
    dangerous: false,
    note: '进第 4 步会 microtask 触发「检测候选」。',
  },
  {
    id: 'detect_candidates',
    label: '检测候选几何（#btn-detect-candidates）',
    from: WITH_IMAGE,
    to: [STATES.CLEANED, STATES.Y_CALIBRATED],
    dangerous: false,
    note: '检测只产几何、不动像素（ARCHITECTURE §7.1）。',
  },
  {
    id: 'confirm_candidate',
    label: '确认去除一条候选几何（.btn-toggle-geometry）',
    from: [STATES.Y_CALIBRATED, STATES.CLEANED],
    to: [STATES.CLEANED],
    dangerous: false,
    note: '检测只产 candidate；只有"确认"之后 status 才变 removed，'
      + 'CLEANED 这个状态才真正可达（否则它只是表里一个不可达的顶点）。',
  },
  {
    id: 'apply_cleanup_next',
    label: '第 4 步 → 第 5 步（#btn-apply-cleanup-next）',
    from: [STATES.CLEANED, STATES.Y_CALIBRATED],
    to: [STATES.COLUMNS_DETECTED],
    dangerous: false,
    note: '进第 5 步会真的重跑 detect_columns。',
  },
  {
    id: 'rename_column',
    label: '行内改列名（真实键盘，不含 Ctrl+A）',
    from: WITH_IMAGE,
    to: [STATES.COLUMNS_DETECTED, STATES.X_CALIBRATED],
    dangerous: false,
    note: '必须先 fill("") 清空并断言为空，再逐字敲：焦点重渲染会吞掉选区。',
  },
  {
    id: 'apply_naming_next',
    label: '第 5 步 → 第 6 步（#btn-apply-naming-next）',
    from: [STATES.COLUMNS_DETECTED],
    to: [STATES.X_CALIBRATED, STATES.COLUMNS_DETECTED],
    dangerous: false,
    note: '进第 6 步会自动点「自动提取刻度」（不得写入任何 x_ticks）。',
  },
  {
    id: 'save_manual_ticks',
    label: '写入手工刻度并保存（#inp-manual-tick-val1/2 + #btn-save-manual-ticks）',
    from: WITH_IMAGE,
    to: [STATES.X_CALIBRATED, STATES.COLUMNS_DETECTED],
    dangerous: false,
    note: '读数只能来自人给（B-01）；保存后必须恰好有一列获得 x_ticks。',
  },
  {
    id: 'apply_xticks_next',
    label: '第 6 步 → 第 7 步（#btn-apply-xticks-next）',
    from: [STATES.X_CALIBRATED, STATES.COLUMNS_DETECTED],
    to: [STATES.SAMPLES_READY, STATES.COLUMNS_DETECTED],
    dangerous: false,
    note: '',
  },
  {
    id: 'extract_consensus',
    label: '提取共识层位（#btn-extract-consensus）',
    from: WITH_IMAGE,
    to: [STATES.SAMPLES_READY],
    dangerous: false,
    note: '层位深度必须来自用户标定（不变量 ⑥ 的比对项之一）。',
  },
  {
    id: 'clear_horizons',
    label: '清空层位（#btn-clear-horizons）',
    from: [STATES.SAMPLES_READY, STATES.EXPORT_READY],
    to: [STATES.COLUMNS_DETECTED, STATES.X_CALIBRATED, STATES.SAMPLES_READY],
    dangerous: true,
    note: '删除：清空全部层位，状态应回到采样之前。',
  },
  {
    id: 'apply_samples_next',
    label: '第 7 步 → 第 8 步（#btn-apply-samples-next）',
    from: [STATES.SAMPLES_READY],
    to: [STATES.EXPORT_READY, STATES.SAMPLES_READY],
    dangerous: false,
    note: '',
  },
  {
    id: 'run_qa',
    label: '跑 QA 汇总（#btn-run-qa）',
    from: [STATES.SAMPLES_READY, STATES.EXPORT_READY],
    to: [STATES.EXPORT_READY],
    dangerous: false,
    note: '使状态进入 EXPORT_READY（该状态由动作历史标记，见 inferState 注释）。',
  },
  {
    id: 'undo',
    label: '撤销（#btn-undo）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: true,
    note: '返回：撤销栈回退后，前端镜像与后端必须仍一致（不变量 ②③④）。',
  },
  {
    id: 'redo',
    label: '重做（#btn-redo）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: true,
    note: '重做：最容易把"已删除的 id"复活回来，是不变量 ⑤ 的强探针。',
  },
  {
    id: 'fit_view',
    label: '适应屏幕（F 键）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: false,
    waitMode: 'heuristic_wait',
    waitWhy:
      '`F` 幂等且不发 RPC：已经适应屏幕时再按一次，视口三元组一个字节都不动，'
      + '没有"变了"可等。只能等帧边界（rAF×2）保证重绘落定。',
    note: '视口动作，不改业务状态；用作每次拖拽前的确定性起点。',
  },
  {
    id: 'zoom_in',
    label: '放大（#btn-zoom-in）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: false,
    waitMode: 'heuristic_wait',
    waitWhy: '缩放有上下限：已到最大倍率时 scale 不变，"变了"不是恒成立的判据。',
    note: '',
  },
  {
    id: 'zoom_out',
    label: '缩小（#btn-zoom-out）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: false,
    waitMode: 'heuristic_wait',
    waitWhy: '同 zoom_in：下限同样会钳制，scale 可能一格不动。',
    note: '',
  },
  {
    id: 'pan_canvas',
    label: '右键拖拽平移画布',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: false,
    waitMode: 'heuristic_wait',
    waitWhy:
      '平移在图像边缘会被钳制，panX/panY 可能一格不动；纯 canvas 手势也没有 RPC 可等。'
      + '`moved` 作为观测如实上报，不当断言。',
    note: 'ARCHITECTURE §9 要求三种平移手势等价；本动作只走右键这一种。',
  },
  {
    id: 'double_click_canvas',
    label: '画布双击（连击）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: true,
    waitMode: 'heuristic_wait',
    waitWhy:
      '双击语义随工具模式变化（加控制点 / 放大 / 无动作），没有单一后端统计量能证明'
      + '"双击已被处理"。本 lane 里最弱的一次等待，因此单独标出。',
    note: '连击：双击语义（加控制点 / 放大）与单击混叠时最易错。',
  },
  {
    id: 'save_project',
    label: '保存项目（#btn-save-project → 下载 .tar）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: true,
    note: '保存重开：为不变量 ⑥ 提供"保存时刻的关键状态"快照。',
  },
  {
    id: 'reopen_project',
    label: '打开刚保存的项目（#btn-open-project → filechooser）',
    from: WITH_IMAGE,
    to: WITH_IMAGE,
    dangerous: true,
    note: '保存重开：只有先 save_project 成功才合法（ready() 判定）。',
  },
]);

/** 动作 id → 表行，便于 O(1) 查询。 */
export const TRANSITION_BY_ID = Object.freeze(
  TRANSITIONS.reduce((acc, row) => {
    acc[row.id] = row;
    return acc;
  }, {})
);

/**
 * 动作权重（选动作时用）。
 *
 * ## 为什么必须有权重，而不能均匀随机
 *
 * 第一版按"候选中等概率"选，实测 3 个 seed × 10 步里没有任何一条走出过第 2 步：
 * 载图之后 `IMAGE_LOADED` 有 20 多个候选动作，而唯一能推进状态的 `goto_step2`
 * 只占 1/20，10 步里抽不到它属于正常现象——于是"随机探索"退化成"在同一个状态
 * 里随机点视口按钮"，覆盖率为零。
 *
 * 权重只表达一件事：**推进流水线的动作更值得试**。它不改变确定性：
 * 权重是常量表，选择顺序是排序后的 id 序列，随机源是 seed 派生的 mulberry32，
 * 所以「同 seed + 同表 ⇒ 同序列」仍然成立。
 *
 * 数值没有精细调参，只分三档：推进 4-5、状态内操作 1-3、危险动作 1-2。
 */
export const ACTION_WEIGHTS = Object.freeze({
  upload_image: 5,
  goto_step2: 5,
  drag_roi_corner: 3,
  create_roi: 2,
  select_roi: 1,
  set_primary_roi: 1,
  delete_roi: 2,
  rename_roi: 1,
  apply_roi_next: 5,
  commit_ycalib: 3,
  apply_ycalib_next: 5,
  detect_candidates: 2,
  confirm_candidate: 5,
  apply_cleanup_next: 5,
  rename_column: 1,
  apply_naming_next: 5,
  save_manual_ticks: 4,
  apply_xticks_next: 5,
  extract_consensus: 3,
  clear_horizons: 1,
  apply_samples_next: 5,
  run_qa: 2,
  undo: 1,
  redo: 1,
  fit_view: 1,
  zoom_in: 1,
  zoom_out: 1,
  pan_canvas: 1,
  double_click_canvas: 1,
  save_project: 1,
  reopen_project: 1,
});

/** 取动作权重；表里漏写按 1 处理（漏写不改变确定性，只是不给加成）。 */
export function actionWeight(id) {
  return ACTION_WEIGHTS[id] ?? 1;
}

/**
 * 由后端权威载荷推断当前状态（纯函数）。
 *
 * @param {object|null} backend `straditize.getDiagramData` 的 result。
 * @param {{samplesCount?: number, frontStage?: number, qaRan?: boolean}} extra
 *   `samplesCount` 来自 `samples.list`（只读）；`frontStage` 只用于拆分
 *   IMAGE_LOADED / ROI_READY（见文件头）；`qaRan` 是本轮动作历史标记。
 */
export function inferState(backend, extra = {}) {
  if (!backend || !backend.imageSrc) return STATES.EMPTY;

  const samples = Number(extra.samplesCount ?? 0);
  const columns = Array.isArray(backend.columns) ? backend.columns : [];
  const anyCalibrated = columns.some(
    (c) => c && c.scale_provenance && c.scale_provenance.calibrated === true
  );

  // 终态优先：QA 跑过且有层位，才算"可导出"。
  if (extra.qaRan === true && samples > 0) return STATES.EXPORT_READY;
  if (samples > 0) return STATES.SAMPLES_READY;
  if (anyCalibrated) return STATES.X_CALIBRATED;
  if (columns.length > 0) return STATES.COLUMNS_DETECTED;

  const candidates = Array.isArray(backend.line_candidates) ? backend.line_candidates : [];
  const cleanupEvidence =
    candidates.some((c) => (c && c.status ? c.status !== 'candidate' : false)) ||
    (backend.exclusion_regions?.length ?? 0) > 0 ||
    (backend.line_strokes?.length ?? 0) > 0;
  if (cleanupEvidence) return STATES.CLEANED;

  if (backend.calibration?.isCalibrated) return STATES.Y_CALIBRATED;

  // 唯一的界面事实例外，见文件头。
  if ((backend.rois?.length ?? 0) > 1 || Number(extra.frontStage ?? 0) >= 2) {
    return STATES.ROI_READY;
  }
  return STATES.IMAGE_LOADED;
}

/**
 * 给定状态时的候选动作 id（**按 id 排序**，保证随机源相同即选择相同）。
 *
 * 排序是重放确定性的一半：`Object.keys` 的顺序在 JS 里虽然稳定，但依赖它等于
 * 依赖对象字面量的书写顺序，一旦有人调整表顺序，老 seed 的动作序列就变了。
 * 显式排序把这个隐含依赖去掉。
 */
export function legalActionIds(state) {
  return TRANSITIONS.filter((row) => row.from.includes(state))
    .map((row) => row.id)
    .sort();
}
