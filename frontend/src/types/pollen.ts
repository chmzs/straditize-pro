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
  tick_layout: Array<{ rel: number }>;
  /** 组参考标尺物理跨度 (px)，例如 38.5px 对应 20% */
  ref_span_px?: number;
  /**
   * 轴线粗（px，组级**初值**）。决定 0 点绿线的位置：`0 点 = 列左缘 + 轴线粗`。
   * 分列时由 `measure_axis_stroke` 实测中位数写入（覆盖率 <50% 不写，保持缺省 5）；
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
  value_per_px?: number;
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
   * 生效顺序：列值 > 组值 > 缺省 5（后端 `xscale.resolve_axis_stroke` 同语义）。
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

  /** 算法在列底端检测到的物理刻度齿像素 X 坐标列表，供磁吸与可视化使用 */
  detected_ticks?: number[];

  /** 后端权威列序号：前端寻址列级 RPC 用它（不要用数组下标——列增删后不等价）。 */
  col_index?: number;

  /** 逐列具体值（不是继承） */
  plot_type?: 'area' | 'bar' | 'line' | 'symbol';
  scale_type?: 'linear' | 'log';
  unit: string;
  exaggeration_mult?: number | null; // null = 无局部放大
  mult_source?: 'user' | 'inferred' | null; // null 当 exaggeration_mult 为 null

  control_points?: Point[];

  // 严格保持向后兼容过渡别名（确保现有渲染组件与算法不挂）
  controlPoints: Point[];
  species?: string;
  isLocked?: boolean;
  maxPercent?: number;
  tickEndX?: number;
  curveType?: 'linear' | 'bezier';
  plotType?: 'area' | 'bar' | 'line' | 'symbol';
  startValue?: number;
  tickValue?: number;
  hasExaggeration?: boolean;
  exaggerationMult?: number;
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
  points?: Point[];
  symbolType?: 'continuous' | 'presence_absence' | 'count';
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
  unit: string;
  /**
   * What the Y axis MEASURES. Declared by the user, never inferred from `unit`:
   * "cm"/"m" imply depth and "cal BP"/"ka" imply age only for the conventional
   * spellings, and a wrong guess moves every sample to a plausible-but-wrong position.
   * `"age"` means sample depths are recovered by inverting the age-depth model.
   */
  primaryAxis?: 'depth' | 'age';
  depthInterval?: number;
  depthGridEnabled?: boolean;
  customDepths?: number[]; // 用户从 Excel 粘贴的真实非等距深度层位序列
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
export interface CleanupResult {
  roi_id: string;
  stats: Record<string, number>;
  candidates: LineCandidate[];
  selected_ids: string[];
  overlay_png: string;
  overlay_legend: Record<string, string>;
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
  source: 'auto' | 'paste' | 'manual'; // 必须存活到导出元数据
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

  /** 采样层位扁平列表 */
  samples: SampleHorizon[];

  activeTaxaId: string;
  isDesktopMode?: boolean; // 桌面模式显示右上角 [退出] 按钮，服务器模式隐藏
  selectedEntity:
    | { type: 'roi'; handle?: string }
    | { type: 'column'; id: string; part?: 'start' | 'tick' | 'end' }
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
  calibration?: DepthCalibration;
  rois?: DataRoi[];
  primary_roi_id?: string;
  active_roi_id?: string;
  roi?: DataRoi;
}

export interface DepthHorizon {
  depth: number;
  unit: string;
  y: number;
  values: Record<string, number>;
}

export interface QaSummary {
  roi_id: string;
  roi_name: string;
  composition: boolean;
  n_horizons: number;
  n_horizons_with_data: number;
  n_horizons_empty: number;
  empty_horizons: { depth: number | null; reason: string }[];
  sum: { min: number; p50: number; max: number; mean: number };
}

export type ControlPoint = Point;
export type TaxaColumn = Column;
export type DiagramCalibration = DepthCalibration;


/**
 * legacy 满量程缺省（0–100%）。
 *
 * **这不是读数**：`startValue` / `tickValue` 是分列期写入的占位契约，真正的标度一律经
 * 后端 `resolve_column_scale`（未标定列在后端直接不给数，见 ARCHITECTURE 不变量 15）。
 *
 * 放在 types 层而不是某个 service 里，是因为 `ProjectManager` 与 `RpcClient` 都要用，
 * 而这两者互相 import——常量放任一侧都会造出循环依赖。
 */
export const LEGACY_FULL_SCALE = 100;

