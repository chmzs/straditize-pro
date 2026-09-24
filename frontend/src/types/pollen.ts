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

export interface Column {
  id: string;
  name: string; // 同一 ROI 内唯一
  roi_id?: string;
  startX: number;
  endX: number;
  visible: boolean;
  color: string;

  /** 标度的唯一事实源：两个真实刻度端点（像素 + 读数）。null = 未标定。 */
  x_ticks?: [Tick, Tick] | null;

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
  depthInterval?: number;
  depthGridEnabled?: boolean;
  customDepths?: number[]; // 用户从 Excel 粘贴的真实非等距深度层位序列
}

export interface LineCandidate {
  id: string;
  kind: 'A' | 'B' | 'C'; // A 贯穿横 / B 贯穿竖 / C 列内竖
  axis: 'h' | 'v';
  at: number; // axis='h' 时是行号；'v' 时是列号
  span: [number, number];
  width: number; // 实测线宽，px
  roi_id: string;
  column_index: number | null; // 仅 kind C 非空
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
  | 'select' // 选择/微调模式 (V)
  | 'pan' // 抓手平移 (H / Space)
  | 'roi' // 数据有效区框选 (R)
  | 'addCol' // 加列工具 (C)
  | 'addPoint' // 加控制点工具 (P)
  | 'eraser' // 橡皮擦删除工具 (E)
  | 'ycalib' // Y 轴两点标定 (Y)
  | 'linefix'; // 线掩膜人工修正笔刷 (K)

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
  lineCorrections: LineMaskStroke[];
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
