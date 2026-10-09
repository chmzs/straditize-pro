import {
  DiagramData,
  LineMaskStroke,
  Point2D,
  TaxaColumn,
  ToolMode,
} from '../../types/pollen';
import { Viewport } from '../Viewport';
import { HistoryManager } from '../HistoryManager';

export type RoiHandle = 'tl' | 'tr' | 'bl' | 'br' | 't' | 'b' | 'l' | 'r';

export interface GeologyCanvasCallbacks {
  onHoverInfo?: (info: {
    worldX: number;
    worldY: number;
    depth?: number;
    percent?: number;
    horizonDepth?: number | null;
  }) => void;
  onDataChange?: () => void;
  onTaxaChange?: (taxaId: string) => void;
  onToolModeChange?: (mode: ToolMode) => void;
  onToggleHelp?: () => void;
  onZoomChange?: (scale: number) => void;
  onDropImage?: (file: File) => void;
  onYCalibPicked?: (marks: Point2D[]) => void;
  onRoiCommitted?: (roi: { xMin: number; xMax: number; yMin: number; yMax: number }) => void;
  onLineFixStroke?: (stroke: LineMaskStroke) => void;
  onGeometryChanged?: () => void;
  onOverlayError?: (overlayId: string, error: unknown) => void;
}

/**
 * 工具策略执行上下文。
 * 为各工具提供数据访问、视口投影、状态标记与命令触发接口。
 */
export interface ToolContext {
  /** 当前地质与花粉核心数据模型 */
  data: DiagramData;
  /** 视口投影与 DPR 变换器 */
  viewport: Viewport;
  /** 当前工作流步骤 (0~8) */
  workflowStage: number;
  /** 当前工具模式 */
  toolMode: ToolMode;
  /** 撤销/重做历史栈 */
  history: HistoryManager;
  /** 请求画布重绘 */
  requestRender: () => void;
  /** 在状态栏或 HUD 发布提示 */
  notifyNotice: (msg: string) => void;
  /** 触发光标重评估 */
  updateCursor: () => void;
  /** 切换工具模式 */
  setToolMode: (mode: ToolMode) => void;
  /** 获取当前选中的属种列 */
  getActiveColumn: () => TaxaColumn | null;
  /** 画布回调 */
  callbacks: GeologyCanvasCallbacks;
  /** 判断特定工具在当前步骤是否放行 */
  isToolAllowed: (mode: ToolMode) => boolean;
  /** 检查世界坐标点是否在图表高度有效范围内 */
  isWithinDiagramBounds: (worldPt: Point2D) => boolean;

  // --- 命中探测方法 ---
  findHitAnchor: (screenPt: Point2D) => { taxaId: string; pointId: string } | null;
  findHitBoundary: (screenPt: Point2D) => { taxaId: string; type: 'start' | 'end' | 'tick' } | null;
  findHitRoiHandle: (screenPt: Point2D) => RoiHandle | null;
  findHitColumn: (worldPt: Point2D) => TaxaColumn | null;
  findHitGeometry: (worldPt: Point2D) => { id: string; handle: 'move' | 'start' | 'end' | 'thick0' | 'thick1' } | null;

  // --- 几何干扰线候选管理 ---
  getSelectedGeometryId: () => string | null;
  setSelectedGeometryId: (id: string | null) => void;
  commitGeometry: (
    id: string | null,
    axis: 'h' | 'v',
    r: { x0: number; y0: number; x1: number; y1: number }
  ) => void;

  // --- 悬停与标尺状态 ---
  hoveredDepthHorizon: number | null;
  hoverWorldPt: Point2D | null;

  // --- 线掩膜人工修正参数 ---
  lineFixMode: 'erase' | 'restore';

  // --- Y 轴标定临时标记点 ---
  yCalibMarks: Point2D[];
  setYCalibMarks: (marks: Point2D[]) => void;
  clearYCalibMarks: () => void;
}

/**
 * 画布交互工具策略接口。
 */
export interface ToolStrategy {
  readonly mode: ToolMode;

  /** 工具切入激活钩子 */
  onActivate?(ctx: ToolContext): void;

  /** 工具切出停用钩子 */
  onDeactivate?(ctx: ToolContext): void;

  /** 鼠标按下事件处理，返回 true 表示事件已被完全消费 */
  onMouseDown?(
    e: MouseEvent,
    screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean | void;

  /** 鼠标移动事件处理 */
  onMouseMove?(
    e: MouseEvent,
    screenPt: Point2D,
    worldPt: Point2D,
    delta: { x: number; y: number },
    ctx: ToolContext
  ): boolean | void;

  /** 鼠标抬起事件处理 */
  onMouseUp?(
    e: MouseEvent,
    screenPt: Point2D,
    worldPt: Point2D,
    ctx: ToolContext
  ): boolean | void;

  /** 鼠标离开画布事件 */
  onMouseLeave?(e: MouseEvent, ctx: ToolContext): void;

  /** 获取当前工具的光标，返回 null 则由画布根据悬停对象或默认规则处理 */
  getCursor?(ctx: ToolContext): string | null;

  /** 专属叠加层绘制（在 Viewport 世界坐标系变换下调用） */
  renderOverlay?(ctx: CanvasRenderingContext2D, toolCtx: ToolContext): void;
}
