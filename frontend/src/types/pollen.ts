export interface Point2D {
  x: number;
  y: number;
}

export type PointKind = 'peak' | 'valley' | 'transition' | 'manual';

export interface Point {
  id: string;
  x: number;          // 图像物理像素 X
  y: number;          // 图像物理像素 Y
  value?: number;      // 对应物理标定值 (线性或对数计算后数值)
  kind?: PointKind;    // 物理极大值(peak), 极小值(valley), 过渡点(transition), 手工点(manual)
  valid_segment?: boolean; // 算法可信区间标记 (供 UI 可视化)
  isManual?: boolean;
  createdAt?: number;
  type?: string;       // 兼容老版本代码
}

export type ScaleType = 'linear' | 'log';

export interface Column {
  id: string;
  name: string;
  color: string;
  startX: number;     // 基线像素 X
  endX: number;       // 隔离界像素 X
  maxPercent: number;
  tickEndX: number;   // 刻度终点像素 X
  unit: string;
  isLocked: boolean;
  visible: boolean;
  controlPoints: Point[];
  curveType?: 'linear' | 'bezier';

  scaleCalib?: {
    originX: number;
    originVal: number;
    calibX: number;
    calibVal: number;
    unit: string;
  };

  // v2.0 属性
  species?: string;    // 属种名称 (例如 Pinus, Charcoal)
  scale_type?: ScaleType; // 用户为每列单独指定: "linear" | "log"
  startValue?: number; // 基线对应值 (linear 默认 0，log 必须 > 0)
  tickValue?: number;  // 刻度终点对应的物理值
  points?: Point[];
  plotType?: 'area' | 'bar' | 'line' | 'symbol';
  hasExaggeration?: boolean;      // 是否存在局部放大曲线 (3x/5x/10x)
  exaggerationMult?: number;       // 用户填写的放大倍数 (默认 5)
  symbolType?: 'continuous' | 'presence_absence' | 'count'; // 符号/散点类型
}

/**
 * 数据有效区 (ROI)：**仅**框定从哪里取数。
 *
 * 存在的唯一目的是把坐标轴、刻度、聚类树、图例等非数据要素挡在提取范围之外。
 * 它不携带任何深度/年代含义 —— 拖动 ROI 绝不能改变像素到数值的换算。
 */
export interface DataRoi {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * 深度/年代轴标定：由用户在画布上点选的两个 Y 轴参考点 + 其真实值确定。
 *
 * 与 ROI 完全独立：ROI 决定"从哪里取数"，本结构决定"某一像素行代表什么数值"。
 * 未标定时 `isCalibrated === false` 且四个端点均为 null —— 前端必须如实显示
 * "未标定"，严禁回落到 ROI 边界凑出一个刻度。
 */
export interface DepthCalibration {
  isCalibrated: boolean;
  top_px: number | null;    // 上方参考点的图像像素 Y
  top_cm: number | null;    // 上方参考点的真实值 (cm / m / cal yr BP ...)
  bottom_px: number | null; // 下方参考点的图像像素 Y
  bottom_cm: number | null; // 下方参考点的真实值
  unit: string;
  depthInterval?: number;
  depthGridEnabled?: boolean;
  customDepths?: number[];  // 用户从 Excel 粘贴的真实非等距深度层位序列
}

/** 线掩膜的人工修正笔迹：mode=erase 擦掉误标，mode=restore 补回漏标。 */
export interface LineMaskStroke {
  id: string;
  mode: 'erase' | 'restore';
  radius: number;
  points: [number, number][];
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
  | 'select'   // 选择/微调模式 (V)
  | 'pan'      // 抓手平移 (H / Space)
  | 'roi'      // 数据有效区框选 (R)
  | 'addCol'   // 加列工具 (C)
  | 'addPoint' // 加控制点工具 (P)
  | 'eraser'   // 橡皮擦删除工具 (E)
  | 'ycalib'   // Y 轴两点标定 (Y)
  | 'linefix'; // 线掩膜人工修正笔刷 (K)

export interface DiagramPanel {
  id: string;
  name: string;            // 面板名称，如 "Pollen (花粉区)", "Charcoal (炭屑区)", "Spores (菌孢区)"
  roi: DataRoi;
  calibration: DepthCalibration;
  columns: Column[];
  activeTaxaId: string;
}

export interface DiagramData {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  /** 取数区域，与深度标定无关 */
  roi: DataRoi;
  /** Y 轴两点标定，与取数区域无关 */
  calibration: DepthCalibration;
  /** 线掩膜人工修正笔迹（擦除误标 / 补回漏标） */
  lineCorrections: LineMaskStroke[];
  columns: Column[];
  activeTaxaId: string;
  isDesktopMode?: boolean; // 桌面模式显示右上角 [退出] 按钮，服务器模式隐藏
  panels?: DiagramPanel[]; // 多面板多ROI架构扩展
  activePanelId?: string;
  selectedEntity:
    | { type: 'roi'; handle?: string }
    | { type: 'column'; id: string; part?: 'start' | 'tick' | 'end' }
    | { type: 'point'; colId: string; pointId: string }
    | null;
}

export interface HistorySnapshot {
  timestamp: number;
  description: string;
  columns: Column[];
  activeTaxaId: string;
  calibration?: DepthCalibration;
  roi?: DataRoi;
}

export interface DepthHorizon {
  depth: number;
  unit: string;
  y: number;
  values: Record<string, number>;
}

export type ControlPoint = Point;
export type TaxaColumn = Column;
export type DiagramCalibration = DepthCalibration;
