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

export interface DepthCalibration {
  dataXMin: number;
  dataXMax: number;
  dataYMin: number;
  dataYMax: number;
  depthTopValue: number;
  depthBottomValue: number;
  unit: string;
  isCalibrated: boolean;
  depthInterval?: number;
  depthGridEnabled?: boolean;
  customDepths?: number[]; // 用户从 Excel 粘贴的真实非等距深度层位序列

  // v2.0 属性
  top_px?: number;     // 沉积物顶界 y 像素
  bottom_px?: number;  // 沉积物底界 y 像素
  top_cm?: number;     // 顶部地层物理深度 (如 0 cm)
  bottom_cm?: number;  // 底部地层物理深度 (如 150 cm)
  depth_interval?: number;
  depth_grid_enabled?: boolean;
  is_calibrated?: boolean;
  custom_depths?: number[];
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
  roi: { x: number; y: number; w: number; h: number };
  columns: Column[];
  activeTaxaId?: string;
}

export type ToolMode =
  | 'select'   // 选择/微调模式 (V)
  | 'pan'      // 抓手平移 (H / Space)
  | 'roi'      // 数据有效区框选 (R)
  | 'addCol'   // 加列工具 (C)
  | 'addPoint' // 加控制点工具 (P)
  | 'eraser';  // 橡皮擦删除工具 (E)

export interface DiagramPanel {
  id: string;
  name: string;            // 面板名称，如 "Pollen (花粉区)", "Charcoal (炭屑区)", "Spores (菌孢区)"
  roi: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
  };
  calibration: DepthCalibration;
  columns: Column[];
  activeTaxaId: string;
}

export interface DiagramData {
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
  calibration: DepthCalibration;
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
