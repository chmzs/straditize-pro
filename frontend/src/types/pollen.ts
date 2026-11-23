export interface Point2D {
  x: number;
  y: number;
}

export type PointKind = 'peak' | 'valley' | 'transition' | 'manual';

export interface Point {
  id: string;
  x: number; // 图像物理像素 X
  y: number; // 图像物理像素 Y
  value?: number; // 对应物理标定值 (线性或对数计算后数值)
  kind?: PointKind; // 物理极大值(peak), 极小值(valley), 过渡点(transition), 手工点(manual)
  valid_segment?: boolean; // 算法可信区间标记 (供 UI 可视化)
  isManual?: boolean;
  createdAt?: number;
  type?: string; // 兼容老版本代码
  source?: string; // 点来源：如 'exagg_5x', 'main_1x', 'read'
}

export type ScaleType = 'linear' | 'log';

export interface Tick {
  px: number;
  value: number;
}

/**
 * 「本列的 X 刻度标定被后端丢弃」的显式记录（缺陷 B-02）。
 *
 * 后端 `core.detectColumns` / `straditize.getDiagramData` 的列对象上**只有被丢弃
 * 标定的列**才带这个可选键。语义：该列原有的 `x_ticks` 两个刻度像素落在了新列带
 * （`band`）之外，后端已把标定清空——用户必须知道这件事，否则他无从判断读数是
 * 自己没填还是被系统清掉了（ARCHITECTURE §2：禁止静默）。
 *
 * 后端会在三种情况下清掉该键，前端因此**不得缓存**它：
 *   1. 该列重新标定成功；
 *   2. 该列 `clearXTicks`；
 *   3. 下一次分列该列未被丢弃。
 *
 * 字段一律按 `number[]` 读：JSON 里 tuple 与 list 过桥后都是数组，前端不该假定长度
 * （`px` 理论上恰好两个端点，`band` 恰好两个边界，但后端若只给一个也照实显示，
 * 绝不补 0）。
 */
export interface XTicksDropped {
  /**
   * 丢弃原因。后端目前产生两种（2026-10-23 实测）：
   *
   * - `out_of_band`：列数没变，同一逻辑列还在原地，只是原刻度像素落到了
   *   `[start-10, end+10]` 这个**守卫区间**之外。
   * - `column_layout_changed`：列数变了（hoya 实测 28→27），索引 k 对应的物理列
   *   未必还是原来那一列。
   *
   * 保留 string 以容纳将来新增的原因；未知原因走中性文案。
   */
  reason?: string;
  /** 原标定的刻度像素 X 坐标，如 `[339.0, 477.0]`。 */
  px?: number[];
  /**
   * 与丢弃判定相关的像素区间，**两种 reason 下语义不同**（后端已确认）：
   *
   * - `out_of_band` → 含 ±10 外扩的**守卫区间** `[start-10, end+10]`，即当时允许
   *   刻度像素存在的范围；
   * - `column_layout_changed` → 新列自己的**物理边界** `[start, end]`，不带外扩。
   *
   * 所以渲染端**不得**把它一律叫作"列带"：前者是"守卫允许范围"，后者才是
   * "列范围"。列的真实边界另有权威来源（列自身的 `startX`/`endX`），
   * 想给用户看"列到底在哪"应当用列几何，而不是这个字段。
   */
  band?: number[];
}

/**
 * 后端判定「这一列不是曲线，而是填满整列的色块」时给出的证据。
 *
 * 两个结构量**同时**成立才命中（实测口径见 `docs/JSON_RPC_SPECIFICATION.md` §4.3）：
 * - `cv`：逐行墨迹宽度的变异系数。真实曲线随层位变化（实测 ≥0.32），色块恒定
 *   （实测 ≤0.008），两者相差约 39 倍。
 * - `fill_ratio`：均值墨迹宽 / 列宽。色块填满整列（实测 ≥0.98），曲线有留白
 *   （实测 ≤0.74）。
 *
 * 这两个数是**后端算好的证据**，前端只负责展示，不得自己重算或另立阈值——
 * 那会变成两套口径，且前端拿不到灰度像素。
 */
export interface SuspectBlock {
  /** 命中原因。目前只有 `fills_whole_column`；保留 string 以容纳将来新增。 */
  reason?: string;
  /** 逐行墨迹宽度的变异系数（越小越像色块）。 */
  cv?: number;
  /** 均值墨迹宽 / 列宽（越接近 1 越像填满整列）。 */
  fill_ratio?: number;
  /** 逐行墨迹宽度的均值，单位像素。 */
  mean_ink_width?: number;
  /** 该列宽度，单位像素。用于让用户看懂 `mean_ink_width` 的相对大小。 */
  column_width?: number;
}

export interface ColumnGroup {
  id: string;
  name: string;
  unit: string;
  plot_type: 'area' | 'bar' | 'line' | 'symbol';
  scale_type: 'linear' | 'log';
  exaggeration_mult?: number | null;
  exagg_style?: 'line' | 'area';
  tick_layout: Array<{ rel: number }>;
  /** 组参考标尺物理跨度 (px)，例如 38.5px 对应 20% */
  ref_span_px?: number;
  /**
   * 轴线粗（px，组级**初值**）。决定 0 点绿线的位置：`0 点 = 列左缘 + 轴线粗`。
   * 分列时由 `measure_axis_stroke` 实测中位数写入（覆盖率 <50% 不写，保持兜底
   * `DEFAULT_AXIS_STROKE_PX` = 2px）；
   * 单列可覆盖，见 `TaxaColumn.axis_stroke_px`。与 `ref_span_px`（一个刻度的长度）不同量。
   */
  axis_stroke_px?: number;
  /**
   * 组级斜率（值/px）——**点齿标定**的结果（ARCHITECTURE §6.4）。
   *
   * 用户点一个刻度齿 + 填它旁边的数字 → `slope = 数字 / 距0点px`。
   * 组内所有列共用它，每列的 0 点各自算。写入时后端会清掉组内各列的
   * `x_ticks`，保证单一事实源。`resolve_column_scale` 的 source 记为 `group_slope`。
   */
  value_per_px?: number | null;
  /**
   * 用户填的「每根齿单位数」——**输入量**，不是派生量。
   *
   * 单独存它而不是从 `ref_val_end / 格数` 反算：格数来自检测，换检测结果就会失真。
   * 存进组里是为了刷新页面后不丢（此前只活在内存 `refDrafts`）。
   */
  ref_units_per_cell?: number;
  /** 组参考标尺起始读数 (例如 0) */
  ref_val_start?: number;
  /** 组参考标尺终止读数 (例如 20) */
  ref_val_end?: number;
  /** 组级手动标定齿标记（0 点 + 用户点选的那条齿） */
  calib_mark?: { px: number; reading: number; dist?: number; col_id?: string } | null;
}

export interface Column {
  id: string;
  name: string; // 同一 ROI 内唯一
  roi_id?: string;
  x_group_id?: string;
  x_values?: [number, number];
  startX: number;
  endX: number;
  visible: boolean;
  color: string;

  /** 标度的唯一事实源：两个真实刻度端点（像素 + 读数）。null = 未标定。 */
  x_ticks?: [Tick, Tick] | null;

  /**
   * 该列左缘处是否存在**贯穿列高的竖轴**。false ⇒ 0 点无法自动测量
   * （无轴列 / 假列 / 只有曲线本身）。
   *
   * 这类列**不得**按"轴线粗 = 0"静默处理：那会让整列读数系统偏 1–5px 且用户
   * 看不出来。后端下发 false 时，界面必须提示用户手动指定 0 点，导出记 NA。
   */
  zero_point_measurable?: boolean;

  /**
   * 本列**用户显式覆盖**的轴线粗（px）。null/缺省 = 跟随组值（ARCHITECTURE §6.4）。
   * 分列不写它，所以它一旦存在就是人填的值；重新分列不会冲掉。
   * 生效顺序：列值 > 组值 > 兜底 `DEFAULT_AXIS_STROKE_PX`（后端
   * `xscale.resolve_axis_stroke` 同语义，两边常量同名）。
   */
  axis_stroke_px?: number | null;

  /**
   * 本列的标定刚刚被后端丢弃（B-02）。可选键，只有被丢弃标定的列才有。
   *
   * 后端对**正常列**下发的是 `null`（键存在、值为空），不是缺键——判据必须写成
   * "非空对象才算有丢弃记录"，不能写成 `'x_ticks_dropped' in col`。
   *
   * 存在时必须向用户显示提示（见 `components/steps/XTicksDroppedNotice.ts`）。
   * 后端会在「重新标定成功 / clearXTicks / 下次分列未被丢弃」时清掉它，
   * 所以渲染端绝不能把它缓存进历史快照或自动存档后一直显示。
   */
  x_ticks_dropped?: XTicksDropped | null;

  /**
   * 后端判定「这一列不是曲线，而是填满整列的色块」时给出的证据（P1 suspect_block）。
   *
   * 与 `x_ticks_dropped` 一样：**未命中的列后端下发 `null`**（键存在、值为空），
   * 所以判据必须写成"非空对象才算命中"，不能写成 `'suspect_block' in col`。
   *
   * 命中**不等于**该列已被剔除：后端按"绝不返回替代数据"原则照原样返回它的读数，
   * 前端同样**不得**静默删除或隐藏该列——用户有权保留（有些色块本身就是他要的信息）。
   * 前端唯一的职责是把这件事显示出来，让用户在导出前自己决定。
   *
   * 渲染见 `components/steps/SuspectBlockNotice.ts`。
   */
  suspect_block?: SuspectBlock | null;


  /** 后端权威列序号：前端寻址列级 RPC 用它（不要用数组下标——列增删后不等价）。 */
  col_index?: number;

  /**
   * 列级**显式覆盖**（`null` / 缺省 = 跟随组）。
   *
   * `plot_type` 按 ARCHITECTURE §6.4 是**组级参数**；列上这个字段只允许放用户
   * 显式覆盖（`column.update` 的 `plot_type`，`None` = 清除覆盖回到组值）。
   * 解析顺序见 `core/plotType.ts` 的 `resolvePlotType`。
   */
  plot_type?: 'area' | 'bar' | 'line' | 'symbol' | null;
  scale_type?: 'linear' | 'log';
  unit: string;
  exaggeration_mult?: number | null; // 唯一的放大倍数（null = 无局部放大）

  controlPoints: Point[];
  /**
   * 稠密逐行读数（后端 column_points：逐行墨迹，或按锚点重建的折线）。
   * 主渲染用它；缺失时回退 controlPoints 折线并在画布标「控制点近似」。
   * 与导出 CSV 同源：同一个后端字段，前端不再自己插值造第二条曲线。
   */
  curvePoints?: Array<{ y: number; x: number }> | null;
  /**
   * 取不到稠密读数时的原因（null = 正常）。画布据此写「本列无法取数：<原因>」，
   * **不画替代折线** —— 取不到就报错停在原地。
   */
  curveError?: string | null;
  species?: string;
  isLocked?: boolean;

  scaleCalib?: {
    originX: number;
    originVal: number;
    calibX: number;
    calibVal: number;
    unit: string;
  };
  /**
   * 后端 `resolve_column_scale` 给出的判定：这一列的标度是哪来的、算不算已标定。
   * 前端不得自己重新推导（x_ticks / x_values+tick_layout / x_scales 的优先级
   * 只存在于后端一处），否则载入工程后会出现"后端已标定、前端未标定"。
   */
  scale_provenance?: { calibrated: boolean; source: string } | null;
}

export interface XScaleForm {
  plotType: 'area' | 'bar' | 'line' | 'symbol';
  startValue: number;
  step: number; // 刻度区间值（几何路径用）
  unit: string;
  scaleType: 'linear' | 'log';
  exaggerationMult: number | null;
}

/**
 * 数据有效区 (ROI)：框定从哪里取数，并作为列组容器与导出表名。
 */
export interface DataRoi {
  id?: string; // "roi_1"，创建后不变
  name?: string; // 唯一；^[\w\u4e00-\u9fa5-]{1,31}$
  name_source?: 'default' | 'user'; // 默认名 vs 用户命名（导出就绪清单据此判断"是否已命名"）
  composition?: boolean; // true = 各层位总和应 ≤ 100%
  visible?: boolean;
  xlim?: [number, number];
  ylim?: [number, number];
  columns_stale?: boolean; // per-ROI：本 ROI 的掩膜变过，分列可能已失效
  form_defaults?: XScaleForm | null; // 仅表单记忆，不参与任何计算
  x_groups?: ColumnGroup[];
  default_group_id?: string;

  // 坐标别名兼容只读/过渡
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * 深度/年代轴标定：由用户在画布上点选的两个 Y 轴参考点 + 其真实值确定。
 */
export interface DepthCalibration {
  isCalibrated: boolean;
  top_px: number | null; // 上方参考点的图像像素 Y
  top_cm: number | null; // 上方参考点的真实值 (cm / m / cal yr BP ...)
  bottom_px: number | null; // 下方参考点的图像像素 Y
  bottom_cm: number | null; // 下方参考点的真实值
  unit?: string;
  /**
   * What the Y axis MEASURES. Declared by the user, never inferred from `unit`:
   * "cm"/"m" imply depth and "cal BP"/"ka" imply age only for the conventional
   * spellings, and a wrong guess moves every sample to a plausible-but-wrong position.
   * `"age"` means sample depths are recovered by inverting the age-depth model.
   */
  primaryAxis?: 'depth' | 'age' | 'code' | (string & {});
  depthInterval?: number;
  depthGridEnabled?: boolean;
  marks?: Array<{ pixel: number; val: number }>;
}

export interface LineCandidate {
  id: string;
  kind: 'A' | 'B' | 'C'; // A 贯穿横 / B 贯穿竖 / C 列内竖
  axis: 'h' | 'v';
  at: number; // axis='h' 时是行号；'v' 时是列号（由 geometry 派生）
  span: [number, number];
  width: number; // 实测线宽，px（由 geometry 派生）
  /**
   * 可编辑的 ROI 内矩形几何 —— **唯一几何真相**。
   * `at` / `span` / `width` 是后端按它派生的显示字段，不要反向写回。
   */
  geometry: {
    type: 'rect';
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  /** 'candidate' 待确认（琥珀，未删除）；'removed' 已确认（红色，实际剔除）。 */
  status: 'candidate' | 'removed';
  source: 'auto' | 'manual';
  confidence: number | null;
  roi_id: string;
  column_index: number | null; // 仅 kind C 非空
}

/** 后端 `algorithm.*LineGeometry` 统一返回的清理状态与预览。 */
/**
 * 步骤 4 的编辑把某一列的**轴线**（0 点）抹掉时，后端下发的告警。
 *
 * 为什么必须到界面：轴线被抹掉之后画布上没有任何变化，`digitize()` 照常返回
 * 整列读数，只是每行都退化成列左缘 —— 与"这一列真是 0"无法区分。用户唯一的
 * 线索就是这条告警，所以它不能只留在 RPC 响应里。
 *
 * 字段名与后端 `cleanup._axis_erasure_warnings()` 的返回一致，不在前端重算。
 */
export interface CleanupAxisWarning {
  kind: 'exclusion_covers_column_axis' | 'confirmed_line_covers_column_axis';
  col_index: number | null;
  column_id: string | null;
  column_name: string;
  /** 列左缘（轴线）的像素 x。 */
  column_start_x: number;
  /** 轴线带被删除 mask 覆盖的比例（0..1，后端已 round 到 3 位）。 */
  covered_fraction: number;
  geometry_hit: boolean;
  /** 后端给的处理建议（原文，含"让开 2px 以上"这类可操作信息）。 */
  note: string;
}

export interface CleanupResult {
  roi_id: string;
  stats: Record<string, number>;
  candidates: LineCandidate[];
  selected_ids: string[];
  overlay_png: string;
  overlay_legend: Record<string, string>;
  /** 轴线被这次编辑抹掉的列（见 {@link CleanupAxisWarning}）。 */
  warnings?: CleanupAxisWarning[];
}

/** 线掩膜的人工修正笔迹：mode=erase 擦掉误标，mode=restore 补回漏标。 */
export interface LineMaskStroke {
  id: string;
  mode: 'erase' | 'restore';
  radius: number;
  points: [number, number][];
}

export interface ExclusionRegion {
  id: string;
  roi_id: string;
  kind: 'rect' | 'poly';
  points: [number, number][]; // rect 恰好 4 点，顺序 tl,tr,br,bl
}

export interface SampleHorizon {
  row_px: number;
  depth: number | null; // 未标定必须是 null，不得填 0
  // `grid` = samples.fromDepthGrid 生成的等距网格层位（与拐点共识 / 粘贴 / 手工并列）。
  source: 'auto' | 'paste' | 'manual' | 'grid'; // 必须存活到导出元数据
  /**
   * 拐点共识的诊断量（issue #83），只有 `source === 'auto'` 的层位带这些字段：
   * 后端 `extract_horizon_consensus` 逐层回传，用于区分「8 列共振」与「1 列孤峰」。
   *
   * 缺失（`undefined` / `null`）是**正常状态**——粘贴、手工、网格层位没有共识度，
   * 渲染必须按"无信息"处理，不得编造一个中间值。
   */
  support_columns?: number | null; // 该簇去重后的列数
  cluster_span_px?: number | null; // 簇内行号 max − min
  member_count?: number | null; // 簇内拐点总数
  polarity?: 'peak' | 'valley' | 'mixed' | null; // 双轨极性：峰 / 谷 / 融合 (#124)
}

export interface ImageMeta {
  path?: string;
  width: number;
  height: number;
  hash?: string;
  src?: string;
}

export interface Project {
  version: string;
  image: ImageMeta;
  depth_calibration: DepthCalibration;
  roi: DataRoi;
  columns: Column[];
  activeTaxaId?: string;
}

export type ToolMode =
  | 'select' // 选择/微调模式 (S)
  | 'pan' // 抓手平移 (H / Space)
  | 'roi' // 数据有效区框选 (R)
  | 'addCol' // 加列工具 (C)
  | 'addPoint' // 加控制点工具 (A)
  | 'eraser' // 橡皮擦删除工具 (D，步骤 5 起)
  | 'ycalib' // Y 轴两点标定 (Y)
  | 'linefix' // 线掩膜人工修正笔刷 (K)
  | 'measure' // 像素测量尺 (M)，步骤 4
  | 'pickTick' // 点选 X 轴刻度齿（步骤 6 组级标定）
  | 'drawLineH' // 拖拽新建横向干扰线 geometry
  | 'drawLineV'; // 拖拽新建竖向干扰线 geometry

export interface DiagramData {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  project_name?: string;
  image_name?: string;

  /** 多 ROI 列表与指针（严格冻结契约 v1.3 §2.6） */
  rois: DataRoi[];
  primary_roi_id: string;
  active_roi_id: string;

  /** 全局扁平列列表 */
  columns: Column[];

  /** Y 轴两点标定，全局唯一，多 ROI 共享 */
  calibration: DepthCalibration;

  /** 线掩膜与排除区扁平列表 */
  line_candidates: LineCandidate[];
  selected_candidate_ids: string[];
  line_strokes: LineMaskStroke[];
  exclusion_regions: ExclusionRegion[];
  /**
   * 画布上当前选中的 geometry id —— 纯前端交互态（不属于后端契约），
   * `GeologyCanvas` 每帧写入，供 `CleanupOverlay` 画手柄。
   */
  cleanup_selected_id?: string | null;
  /** 后端下发的清理统计，面板必须显示真实数字。 */
  cleanup_stats?: Record<string, number>;
  /**
   * 最近一次步骤 4 编辑**抹掉了谁家轴线**（后端 `warnings` 原文）。
   *
   * 由 `CleanupManager.applyCleanupState()` 从 cleanup 类 RPC 的响应里灌入，
   * 每次编辑整体替换（不是累积）：清空编辑时后端不再返回它，面板上的告警
   * 必须跟着消失，否则"已经修好了"和"还在坏着"看起来一模一样。
   */
  cleanup_warnings?: CleanupAxisWarning[];
  /**
   * 清理统计与图例（后端 `cleanup_payload()` 下发，零状态也发）。
   *
   * 此前类型里根本没有这个键，唯一消费点是 `RpcClient.ts` 的
   * `if (data.cleanup?.stats) data.cleanup_stats = data.cleanup.stats`——
   * 没有声明就意味着：后端把 `stats` 改名，编译期零提示，面板数字静默停在旧值。
   *
   * 声明为**可选**是因为 `loadImage` 之后前端会先构造一份不含它的乐观载荷
   * （`RpcClient.applyLoadedImage`），不是"后端可能不发"。
   */
  cleanup?: {
    roi_id: string | null;
    stats: Record<string, number>;
    legend: Record<string, string>;
  };

  /** 采样层位扁平列表 */
  samples: SampleHorizon[];

  activeTaxaId: string;
  isDesktopMode?: boolean; // 桌面模式显示右上角 [退出] 按钮，服务器模式隐藏
  selectedEntity:
    | { type: 'roi'; handle?: string }
    | { type: 'column'; id: string; part?: 'start' | 'end' }
    | { type: 'point'; colId: string; pointId: string }
    | null;

  // 兼容过渡属性
  roi: DataRoi;
}

export interface HistorySnapshot {
  timestamp: number;
  description: string;
  columns: Column[];
  activeTaxaId: string;
  /**
   * 快照时刻的标定镜像。
   *
   * 注意：只有**前端自有**字段（`depthInterval` / `depthGridEnabled`）允许被撤销回放；
   * 端点 / `isCalibrated` / `unit` / `primaryAxis` 属后端权威量，撤销时一律保留
   * 当前镜像（= 后端最近一次成功响应），见 `CleanupManager.applyHistorySnapshot`
   * 与 T-04。整块回写会让面板否定后端已确认的标定。
   */
  calibration?: DepthCalibration;
  rois?: DataRoi[];
  primary_roi_id?: string;
  active_roi_id?: string;
  roi?: DataRoi;
}

/**
 * QA 异常清单里的一条：`empty_horizons` 与 `violations_over` 共用本结构。
 *
 * 两个字段各自只在一边出现——`reason` 只由空层位给（`qa.py:65-70`，值恒为
 * `"no ink read"`），`sum` 只由超标层位给（`qa.py:93-99`）。故各为可选。
 */
export interface QaHorizonSummary {
  depth: number | null;
  reason?: string;
  sum?: number;
}

/** 单列峰值与声明刻度的对照（`per_column_max` 的一条，见 `qa.py:131-140`）。 */
export interface QaColumnMax {
  name: string;
  peak: number;
  declared_max: number;
  over: boolean;
  calibrated?: boolean;
}

/**
 * 逐行诊断旗标名（`straditize_core/qa.py::FLAG_NAMES`，issue #91/#92）。
 *
 * 后端只在 `qa.py` 一处定名，这里镜像；`FLAG_SUM_ERR`（百分比总和门）尚未作为逐行
 * 旗标输出——它现在由 `violations_over` / `shortfall` 表达，故不在本联合里。
 */
export type QaFlagName =
  | 'FLAG_AXIS_BLIND'
  | 'FLAG_TRUNCATED'
  | 'FLAG_COLLISION'
  | 'FLAG_EXAGG_RATIO';

/** 一条逐行旗标。字段随旗标而异（`ratio` 只有 `FLAG_EXAGG_RATIO` 有）。 */
export interface QaFlagRow {
  flag?: QaFlagName;
  column: string;
  row_px: number;
  /** 原始跨度 = x − 0 点（px）。`FLAG_AXIS_BLIND` / `FLAG_TRUNCATED` / `FLAG_COLLISION` 用。 */
  span_px?: number;
  axis_px?: number;
  full_span_px?: number;
  /** 上下相邻行（行号差 1）的 |Δx|；缺行时该侧不出现。 */
  neighbour_delta_px?: number[];
  plot_type?: string;
  zero_step_fraction?: number;
  ratio?: number;
  inner_span_px?: number;
  outer_span_px?: number;
}

/** 整列没参与判定时的原因（插值合成列、缺几何、轴宽未填…）。 */
export interface QaFlagSkippedColumn {
  column: string;
  reason: string;
}

/** 触边降级（#92）的审计明细：这一列凭什么算/不算"满量程柱状"。 */
export interface QaFlagStructure {
  column: string;
  plot_type: string;
  zero_step_fraction: number;
  bar_structure: boolean;
  anchor_edited: boolean;
  full_span_px: number;
}

/**
 * 一块旗标。**四块旗标字段完全相同**（`straditize_core/qa.py::_flag_block`），
 * 消费端不需要按块分支；`status` 表达"判了没有"，`skipped_columns` 表达"哪些列
 * 判不了、为什么"，`count` / `by_column` 是完整计数（`rows` 只带前 50 条明细）。
 */
export interface QaFlagBlock {
  flag: QaFlagName;
  status: 'computed' | 'skipped';
  criterion: string;
  count: number;
  by_column: Record<string, number>;
  rows: QaFlagRow[];
  rows_omitted: number;
  skipped_columns: QaFlagSkippedColumn[];
  structure: QaFlagStructure[];
  downgraded_low_priority: number;
  columns_evaluated: number;
  reason: string;
  missing: string[];
}

/** 四块旗标，键集恒定。 */
export type QaFlags = Record<QaFlagName, QaFlagBlock>;

/**
 * `qa.summarize` 单个分区的返回（Frozen Contract v1.3 §2.7）。
 *
 * **全仓唯一一份定义**：`core/qaVerdict.ts` 的聚合、`components/steps/QaPanel.ts`
 * 的渲染、`components/ExportModal.ts` 的自检都从这里 import。曾经
 * `steps/QaPanel.ts` 自带一份同名宽定义、这里留一份窄定义（缺 `violations_over` /
 * `per_column_max` / `tolerance` / `shortfall`），两个消费者各信一份，改哪份都不同步，
 * 而 tsc 两边都能过（issue #16）。
 *
 * ## 必填 vs 可选的分界线是后端的两条 return 路径
 *
 * `straditize_core/qa.py::compute_qa_summary` 有两条出口：
 *
 * - 空集提前返回（`:38-52`）：`n_horizons` :43、`n_horizons_with_data` :44、
 *   `n_horizons_empty` :45、`empty_horizons` :46、`sum` :47、`tolerance` :48、
 *   `violations_over` :49、`shortfall` :50、`per_column_max` :51 —— **全部都给**。
 * - 正常返回（`:141-156`）：上述字段全部再给一遍（`:145`–`:153`），**并额外**
 *   给 `n_uncalibrated` :154 与 `uncalibrated_columns` :155。
 *
 * 所以只有 `n_uncalibrated` / `uncalibrated_columns` 是"空集路径确实不给"⇒ 可选，
 * 消费端用 `?.` 是对的。其余字段一律必填：消费端不得用 `?.` / `?? ` 把
 * "后端没给"兜成 0——那是契约破损，必须报错（#14、#16）。
 *
 * 唯一的第二个例外是 `flags`（#91/#92），它不是"后端可能不给"，而是
 * `QaPanel.ts::mergedView` 的聚合视图不携带逐行明细；单个分区返回里它恒在。
 */
export interface QaSummary {
  roi_id: string;
  roi_name: string;
  composition: boolean;
  n_horizons: number;
  n_horizons_with_data: number;
  n_horizons_empty: number;
  empty_horizons: QaHorizonSummary[];
  sum: { min: number; p50: number; max: number; mean: number };
  tolerance: number;
  violations_over: QaHorizonSummary[];
  shortfall: { min: number; max: number; mean: number };
  per_column_max: QaColumnMax[];
  /** 逐行诊断旗标（#91/#92）。后端两条出口都给；可选性的来由见上方类注释。 */
  flags?: QaFlags;
  n_uncalibrated?: number;
  uncalibrated_columns?: string[];
}

export type ControlPoint = Point;
export type TaxaColumn = Column;
export type DiagramCalibration = DepthCalibration;


