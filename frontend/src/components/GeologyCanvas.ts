import {
  Point2D,
  ControlPoint,
  TaxaColumn,
  DiagramData,
  DataRoi,
  LineMaskStroke,
  ToolMode,
} from '../types/pollen';
import { Viewport, ImageDisplayMode } from '../core/Viewport';
import { SplineInterpolator } from '../core/SplineInterpolator';
import { HistoryManager } from '../core/HistoryManager';
import { ToolModeManager } from '../core/ToolModeManager';
import { CoordinateSystem } from '../core/CoordinateSystem';
import {
  STAGE,
  canHitRoiHandle,
  showsColumnBoundaries,
  showsDepthGrid,
  showsPollenCurves,
  showsRoiOverlay,
  showsYCalibMarks,
} from '../core/WorkflowStage';
import { tokens } from '../styles/tokens';
import { getAllOverlays } from './canvas/_registry';
import {
  createToolStrategies,
  ToolStrategy,
  ToolContext,
  YCalibToolStrategy,
  LineFixToolStrategy,
  DrawLineToolStrategy,
  MeasureToolStrategy,
  RoiToolStrategy,
  SelectToolStrategy,
  AddPointToolStrategy,
  RoiHandle,
} from '../core/tools';
import { t, onLocaleChange } from '../i18n';

import { bandOf } from './canvas/CleanupOverlay';
export interface CanvasEventCallbacks {
  onTaxaChange?: (taxaId: string) => void;
  onDataChange?: () => void;
  onHoverInfo?: (info: { worldX: number; worldY: number; depth?: number; percent?: number; horizonDepth?: number | null } | null) => void;
  onFilterChange?: (mode: ImageDisplayMode, binaryOverlay: boolean) => void;
  onDropFile?: (file: File) => void;
  onStatusNotice?: (text: string) => void;
  onOpenCalibration?: () => void;
  onToolModeChange?: (mode: ToolMode) => void;
  onOpenFileDialog?: () => void;
  onToggleHelp?: () => void;
  /** ROI 拖拽结束：调用方负责把新范围推给后端（去线掩膜必须在 ROI 内计算）。 */
  onRoiCommitted?: (roi: DataRoi) => void;
  /** Y 轴两点标定选点完成（按像素 Y 升序），调用方负责弹窗收真实值。 */
  onYCalibPicked?: (marks: Point2D[]) => void;
  /** 线掩膜人工修正笔迹结束，调用方负责提交后端并回灌新叠加层。 */
  onLineFixStroke?: (stroke: LineMaskStroke) => void;
  /** Step 4：一条 geometry 被拖动/缩放/新建完成，调用方提交后端。 */
  onGeometryCommit?: (
    id: string | null,
    axis: 'h' | 'v',
    rect: { x0: number; y0: number; x1: number; y1: number }
  ) => void | Promise<void>;
  /** Step 4：geometry 选中态变化（面板同步高亮）。 */
  onGeometrySelected?: (id: string | null) => void;
  /** Step 4：删除一条 geometry。 */
  onGeometryDelete?: (id: string) => void;
  /** 叠加层渲染失败：必须上报，禁止静默吞掉（否则表现为"什么都没画"）。 */
  onOverlayError?: (overlayId: string, error: unknown) => void;
  /**
   * 底图加载完成。
   *
   * `loadImage` 会重置后端下发的线掩膜叠加层（它随旧底图失效），而
   * `loadNewDiagram` 有十几处调用点。集中在这里通知一次，调用方重新向后端
   * 取一次清理叠加层，避免"刷新一次几何就看不见了"。
   */
  onDiagramReloaded?: () => void;
}

export class GeologyCanvas {
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private dropOverlay: HTMLElement | null = null;
  private emptyStateOverlay: HTMLElement | null = null;
  private floatingToolbar: HTMLElement | null = null;

  public viewport: Viewport;
  public history: HistoryManager;
  public data: DiagramData;
  public toolModeManager: ToolModeManager;
  private callbacks: CanvasEventCallbacks;

  // 图像缓存与后端下发的去线 QC 叠加层
  private diagramImage: HTMLImageElement | null = null;
  private isImageLoaded: boolean = false;
  /** 后端 algorithm.degrid 返回的 RGBA 掩膜：白=保留墨迹，红=实际剔除的线像素。 */
  private lineOverlayImage: HTMLImageElement | null = null;
  private lineOverlayUrl: string | null = null;

  // 交互状态追踪
  private isSpaceDown: boolean = false;
  private isMouseDown: boolean = false;
  private isPanning: boolean = false;
  private lastMouseScreen: Point2D = { x: 0, y: 0 };

  // 策略化工具注册表
  private toolStrategies: Map<ToolMode, ToolStrategy>;

  // 悬停状态
  private hoveredAnchor: { taxaId: string; pointId: string } | null = null;
  private hoveredBoundary: { taxaId: string; type: 'start' | 'tick' | 'end'; x: number } | null = null;
  private hoveredRoiHandle: RoiHandle | null = null; // 'tl','tr','bl','br','t','b','l','r'
  private hoveredDepthHorizon: number | null = null;
  private isHoveringDepthRulerBadge: boolean = false;

  // Y 轴两点标定：用户在图上点选的参考点（最多两个）
  private yCalibMarks: Point2D[] = [];
  private hoverWorldPt: Point2D | null = null;
  // 线掩膜人工修正：当前笔刷模式
  public lineFixMode: 'erase' | 'restore' = 'erase';

  // Step 4 geometry 编辑：选中项
  private selectedGeometryId: string | null = null;

  private renderPending: boolean = false;
  private lastRenderedLayers: Set<string> = new Set();
  /** 上一次渲染中失败的叠加层：暴露出来供验收句柄与状态栏读取。 */
  private overlayErrors: Map<string, unknown> = new Map();

  // 屏幕恒定像素常量
  private readonly ANCHOR_HIT_RADIUS_SCREEN = 8.0;
  private readonly BOUNDARY_HIT_WIDTH_SCREEN = 6.0;
  private readonly ROI_HANDLE_SIZE_SCREEN = 8.0;
  /** geometry 命中带最小半宽（屏幕像素），保证 2px 的线也点得中。 */
  private readonly GEOMETRY_HIT_PAD_SCREEN = 6.0;
  private readonly GEOMETRY_HANDLE_SIZE_SCREEN = 9.0;

  // 显式 4 步推进工作流状态 (1: ROI界定, 2: 列切分与形态, 3: 数字化与微调, 4: 导出)
  public workflowStage: number = 3;

  constructor(
    container: HTMLElement,
    initialData: DiagramData,
    history: HistoryManager,
    callbacks: CanvasEventCallbacks = {}
  ) {
    this.container = container;
    this.data = initialData;
    this.history = history;
    this.callbacks = callbacks;
    this.toolModeManager = new ToolModeManager('select');
    this.toolStrategies = createToolStrategies();

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'geology-canvas';
    this.canvas.className = 'geology-main-canvas';
    this.container.appendChild(this.canvas);

    this.createDropOverlay();
    this.initEmptyState();
    this.createFloatingToolbar();

    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Cannot get 2D context from canvas');
    this.ctx = context;

    this.viewport = new Viewport();

    this.initEventListeners();
    this.handleResize();
    this.loadImage(this.data.imageSrc);

    // 历史记录回调联动
    this.history.onChange = () => {
      this.requestRender();
      if (this.callbacks.onDataChange) {
        this.callbacks.onDataChange();
      }
    };

    onLocaleChange(() => {
      this.createFloatingToolbar();
    });
  }

  public setToolMode(mode: ToolMode): void {
    const prevMode = this.toolModeManager.getMode();
    if (prevMode !== mode) {
      this.toolStrategies.get(prevMode)?.onDeactivate?.(this.getToolContext());
    }
    this.toolModeManager.setMode(mode);
    this.syncToolModeUi(mode);
    this.toolStrategies.get(mode)?.onActivate?.(this.getToolContext());
  }

  /**
   * 把工具模式同步到界面（浮动条高亮 + 页脚「模式:」）。幂等，可重复调用。
   *
   * 与 `setToolMode` 拆开，是因为「当前用哪个工具」和「界面有没有如实显示它」
   * 是两件事：浮动条的初始 HTML 把 `active-mode` 写死在 select 上、页脚把
   * 「选择 (V)」写死在初始 HTML 里，而各步的真实默认工具未必是 select。只切
   * 模式而不强制刷展示时，初始状态恰好已等于默认工具的场景就会两者同时说谎。
   */
  private syncToolModeUi(mode: ToolMode): void {
    this.updateCursor();
    if (this.floatingToolbar) {
      this.floatingToolbar.querySelectorAll('[data-fmode]').forEach((el) => {
        if (el.getAttribute('data-fmode') === mode) {
          el.classList.add('active-mode');
        } else {
          el.classList.remove('active-mode');
        }
      });
    }
    if (this.callbacks.onToolModeChange) {
      this.callbacks.onToolModeChange(mode);
    }
  }

  private createFloatingToolbar(): void {
    if (this.floatingToolbar) {
      this.floatingToolbar.remove();
      this.floatingToolbar = null;
    }
    const palette = document.createElement('div');
    palette.className = 'floating-tool-palette';
    palette.innerHTML = `
      <button class="floating-tool-btn help-btn-item" id="btn-palette-help" title="${t('tool.helpTitle')}">
        <span style="font-size: 14px; font-weight: 700; line-height: 1;">?</span>
        <span>${t('tool.help')}</span>
      </button>
      <div class="palette-divider" style="width: 1px; height: 24px; background: var(--border-color); opacity: 0.7; margin: 0 1px;"></div>
      <button class="floating-tool-btn active-mode" data-fmode="select" title="${t('tool.selectHint')}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
        </svg>
        <span>${t('tool.select')}</span>
      </button>
      <button class="floating-tool-btn" data-fmode="addPoint" title="${t('tool.addPointHint')}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
        </svg>
        <span>${t('tool.addPoint')}</span>
      </button>
      <button class="floating-tool-btn" data-fmode="eraser" title="${t('tool.eraserHint')}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>
        </svg>
        <span>${t('tool.eraser')}</span>
      </button>
      <button class="floating-tool-btn" data-fmode="addCol" title="${t('tool.addColHint')}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="3 3"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>${t('tool.addCol')}</span>
      </button>
      <button class="floating-tool-btn" data-fmode="pan" title="${t('tool.panHint')}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
        <span>${t('tool.pan')}</span>
      </button>
      <button class="floating-tool-btn" data-fmode="measure" title="${t('tool.measureHint')}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 17 17 3l4 4L7 21z"/><path d="m8 12 2 2M11 9l2 2M14 6l2 2"/>
        </svg>
        <span>${t('tool.measure')}</span>
      </button>
      <button class="floating-tool-btn" data-fmode="linefix" title="${t('tool.linefixHint')}">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m14 4 6 6-9.5 9.5a2 2 0 0 1-2.83 0L4 15.83a2 2 0 0 1 0-2.83L14 4z"/><line x1="12" y1="6" x2="18" y2="12"/>
        </svg>
        <span>${t('tool.linefix')}</span>
      </button>
    `;
    this.container.appendChild(palette);
    this.floatingToolbar = palette;
    this.updateFloatingToolbarForStage(this.workflowStage);

    palette.querySelector('#btn-palette-help')?.addEventListener('click', () => {
      this.callbacks.onToggleHelp?.();
    });

    palette.querySelectorAll('[data-fmode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-fmode') as ToolMode;
        if (mode) {
          this.setToolMode(mode);
        }
      });
    });
  }

  private createDropOverlay(): void {
    const overlay = document.createElement('div');
    overlay.className = 'canvas-drop-overlay';
    overlay.innerHTML = `
      <div class="drop-modal-box">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
          <path d="M12 12v9"/>
          <path d="m8 16 4-4 4 4"/>
        </svg>
        <h3>松开鼠标以载入地质图谱</h3>
        <p>支持 PNG / JPG / WebP / SVG 地学花粉与沉积剖面图像</p>
      </div>
    `;
    this.container.appendChild(overlay);
    this.dropOverlay = overlay;
  }

  private initEmptyState(): void {
    const emptyBox = document.createElement('div');
    emptyBox.className = 'empty-canvas-container';
    emptyBox.innerHTML = `
      <div class="empty-state-card">
        <div class="empty-icon-wrap">
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
          </svg>
        </div>
        <button id="btn-empty-load-img" class="btn btn-primary" style="padding: 8px 24px; font-size: 13px; font-weight: 600; margin-bottom: 8px; cursor: pointer;">
          📁 加载图片
        </button>
        <p style="font-size: 12px; color: var(--text-secondary); margin: 0 0 16px 0;">或将图片拖拽到此处</p>
        <div class="empty-specs-badge">
          <span>支持格式：PNG / JPG / TIFF / WebP</span>
          <span>建议尺寸：A4 600 DPI 以内</span>
          <span>最大支持：8000×12000 px</span>
        </div>
      </div>
    `;
    this.container.appendChild(emptyBox);
    this.emptyStateOverlay = emptyBox;

    emptyBox.querySelector('#btn-empty-load-img')?.addEventListener('click', () => {
      this.callbacks.onOpenFileDialog?.();
    });

    this.updateEmptyStateVisibility();
  }

  public updateEmptyStateVisibility(): void {
    if (!this.emptyStateOverlay) return;
    const isEmpty = !this.data.imageSrc || this.workflowStage === STAGE.EMPTY;
    this.emptyStateOverlay.style.display = isEmpty ? 'flex' : 'none';
  }

  public loadNewDiagram(newData: DiagramData): void {
    // 方向键微调是「本地即时改 + 500ms 防抖提交」。数据刷新会整块替换 this.data，
    // 所以必须**先**把待提交的改动落库，否则防抖窗口内的最后一次微调会被这次刷新
    // 无声吃掉（本地改动被覆盖、闭包又还没发出去）。
    void this.flushPendingGeometryEdits();
    this.data = newData;
    // 选中态是画布 UI 状态：数据刷新后若该 geometry 已不存在就必须清掉，
    // 否则 CleanupOverlay 会为一个悬空 id 画手柄。
    if (
      this.selectedGeometryId &&
      !(newData.line_candidates || []).some((c) => c.id === this.selectedGeometryId)
    ) {
      this.selectedGeometryId = null;
    }
    this.data.cleanup_selected_id = this.selectedGeometryId;
    this.loadImage(newData.imageSrc);
    if (this.callbacks.onDataChange) {
      this.callbacks.onDataChange();
    }
    if (this.callbacks.onTaxaChange) {
      this.callbacks.onTaxaChange(newData.activeTaxaId);
    }
  }

  public loadImage(src: string): void {
    if (!src) {
      this.isImageLoaded = false;
      this.diagramImage = null;
      this.setLineOverlay(null);
      this.updateEmptyStateVisibility();
      this.requestRender();
      return;
    }

    this.isImageLoaded = false;
    this.diagramImage = new Image();
    this.diagramImage.crossOrigin = 'anonymous';
    this.diagramImage.src = src;

    this.diagramImage.onload = () => {
      this.isImageLoaded = true;
      if (this.diagramImage) {
        this.data.imageWidth = this.diagramImage.naturalWidth;
        this.data.imageHeight = this.diagramImage.naturalHeight;
      }

      // 后端下发的去线掩膜随底图一起失效：新图尚未在 S2 重新检测
      this.setLineOverlay(null);
      this.updateEmptyStateVisibility();
      this.fitToScreen();
      this.requestRender();
      // 通知调用方重新向后端取一次清理叠加层（几何/排除区仍存在于 data 中）。
      this.callbacks.onDiagramReloaded?.();
    };

    this.diagramImage.onerror = () => {
      // 图片没加载成功就不能算"已加载"：置 true 会让下面的 drawBackgroundDiagram
      // 对处于 broken 状态的元素调用 drawImage，抛 InvalidStateError 并把整条
      // render() 管线中断掉——ROI 矩形、深度网格、分列标线全都不会被画出来。
      // （原注释声称会 "using procedural canvas"，但那个兜底并不存在。）
      console.warn('Failed to load image from', src, '- background will be skipped');
      this.isImageLoaded = false;
      this.updateEmptyStateVisibility();
      this.requestRender();
    };
  }

  /**
   * 装载后端下发的去线 QC 叠加层（白=保留墨迹，红=实际剔除的线像素）。
   *
   * 前端不再自行实现一套"看起来像去线"的显示逻辑：历史实现是每行连续墨迹
   * run 超阈值就整段标红，实测在 Hoya 图上把 Pinus 列 99% 的实心轮廓抹掉，
   * 而那张图 ROI 内根本没有横向网格线。现在所见即后端数字化实际所用。
   */
  public setLineOverlay(dataUrl: string | null): void {
    this.lineOverlayUrl = dataUrl;
    if (!dataUrl) {
      this.lineOverlayImage = null;
      this.requestRender();
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.lineOverlayImage = img;
      this.requestRender();
    };
    img.onerror = () => {
      // 叠加层载入失败只影响透视，不影响提取；如实记录而不是静默假装成功。
      console.warn('[canvas] 去线叠加层解码失败，B 键透视本次不可用');
      this.lineOverlayImage = null;
    };
    img.src = dataUrl;
  }

  public getLineOverlayUrl(): string | null {
    return this.lineOverlayUrl;
  }

  public fitToScreen(): void {
    const rect = this.container.getBoundingClientRect();
    const w = this.data.imageWidth || 1600;
    const h = this.data.imageHeight || 1000;
    this.viewport.fitToScreen(rect.width, rect.height, w, h, 60);
    this.requestRender();
  }

  public resetZoom100(): void {
    const rect = this.container.getBoundingClientRect();
    const w = this.data.imageWidth || 1600;
    const h = this.data.imageHeight || 1000;
    this.viewport.reset100(rect.width, rect.height, w, h);
    this.requestRender();
  }

  public handleResize(): void {
    const rect = this.container.getBoundingClientRect();
    this.viewport.updateDpr();
    const dpr = this.viewport.dpr;

    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;

    this.requestRender();
  }

  public requestRender(): void {
    if (!this.renderPending) {
      this.renderPending = true;
      requestAnimationFrame(() => {
        this.renderPending = false;
        this.render();
      });
    }
  }

  public setActiveTaxa(taxaId: string): void {
    this.data.activeTaxaId = taxaId;
    this.requestRender();
    if (this.callbacks.onTaxaChange) {
      this.callbacks.onTaxaChange(taxaId);
    }
  }

  public getActiveColumn(): TaxaColumn | undefined {
    return this.data.columns.find((c) => c.id === this.data.activeTaxaId);
  }

  /**
   * 批量导入并重命名属种列（若属种数超出当前列数，则自动根据列间距拓展分列）
   */
  public batchUpdateTaxa(taxaNames: string[]): void {
    if (!taxaNames || taxaNames.length === 0) return;

    // 1. 按从左到右 (startX 升序) 排序现有列
    const sortedCols = [...this.data.columns].sort((a, b) => a.startX - b.startX);
    const existingCount = sortedCols.length;
    const inputCount = taxaNames.length;

    // 2. 依次按顺序重命名当前全部已有 Taxa 列
    const renameLimit = Math.min(existingCount, inputCount);
    for (let i = 0; i < renameLimit; i++) {
      sortedCols[i].name = taxaNames[i];
    }

    // 3. 如果输入的属种数量大于当前列数，自动根据列间距拓展分列
    if (inputCount > existingCount) {
      let colWidth = 100;
      if (existingCount >= 2) {
        const span = sortedCols[existingCount - 1].startX - sortedCols[0].startX;
        const avgStep = span / (existingCount - 1);
        colWidth = Math.max(40, Math.round(avgStep));
      } else if (existingCount === 1) {
        colWidth = Math.max(40, sortedCols[0].endX - sortedCols[0].startX);
      }

      const lastCol = sortedCols[existingCount - 1];
      let curStartX = lastCol ? lastCol.endX : this.data.roi.xMin;

      const palette = [
        '#38bdf8', '#34d399', '#fbbf24', '#a78bfa',
        '#f472b6', '#fb7185', '#2dd4bf', '#818cf8',
        '#e879f9', '#38ef7d', '#11998e', '#f5af19'
      ];

      const roi = this.data.roi;
      const yMin = roi.yMin;
      const yMax = roi.yMax;
      const stepY = (yMax - yMin) / 12;

      for (let i = existingCount; i < inputCount; i++) {
        const newStartX = curStartX;
        const newEndX = newStartX + colWidth;
        const name = taxaNames[i];
        const color = palette[i % palette.length];

        const points: ControlPoint[] = [];
        for (let s = 0; s <= 12; s++) {
          const y = Math.round(yMin + s * stepY);
          const x = Math.round(newStartX + colWidth * 0.12);
          points.push({
            id: `pt_${Date.now()}_${i}_${s}`,
            x,
            y,
            type: s % 4 === 0 ? 'manual' : 'transition',
            isManual: s % 4 === 0,
            createdAt: Date.now() + s,
          });
        }

        const newCol: TaxaColumn = {
          id: `taxa_paste_${Date.now()}_${i}`,
          name,
          color,
          startX: newStartX,
          endX: newEndX,
          tickEndX: newEndX,
          maxPercent: 40,
          unit: '%',
          curveType: 'linear',
          visible: true,
          isLocked: false,
          controlPoints: points,
        };

        sortedCols.push(newCol);
        curStartX = newEndX;

        // 自动扩展取数区域以容纳新列；严格钳位在图谱物理宽度内
        const maxW = this.data.imageWidth || 8000;
        if (newEndX > this.data.roi.xMax) {
          this.data.roi.xMax = Math.min(maxW, newEndX + 30);
        }
      }
    }

    this.data.columns = sortedCols;
    if (!sortedCols.some((c) => c.id === this.data.activeTaxaId) && sortedCols[0]) {
      this.data.activeTaxaId = sortedCols[0].id;
    }

    // 记录撤销重做历史快照
    this.history.push(
      `批量导入属种名单 (${taxaNames.length} 属种)`,
      this.data.columns,
      this.data.activeTaxaId,
      this.data.calibration
    );

    this.notifyNotice(`已成功批量导入 ${taxaNames.length} 个属种并更新分列！`);
    this.requestRender();

    if (this.callbacks.onDataChange) {
      this.callbacks.onDataChange();
    }
  }

  // ===================== 事件监听与交互 =====================

  private initEventListeners(): void {
    window.addEventListener('resize', () => this.handleResize());

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));

    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    this.canvas.addEventListener('mouseleave', (e) => this.onMouseLeave(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));

    // 拖拽文件到画布直接打开
    this.initDragDrop();

    // 监听剪贴板粘贴直接打开图片
    this.initClipboardPaste();
  }

  private initDragDrop(): void {
    const wrapper = this.container;

    wrapper.addEventListener('dragenter', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dropOverlay) {
        this.dropOverlay.classList.add('visible');
      }
    });

    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dropOverlay) {
        this.dropOverlay.classList.add('visible');
      }
    });

    wrapper.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target === this.dropOverlay && this.dropOverlay) {
        this.dropOverlay.classList.remove('visible');
      }
    });

    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.dropOverlay) {
        this.dropOverlay.classList.remove('visible');
      }

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('image/')) {
          this.callbacks.onDropFile?.(file);
        } else {
          this.notifyNotice('请拖入有效的地学图谱图片文件 (PNG/JPG/WebP)');
        }
      }
    });
  }

  private initClipboardPaste(): void {
    window.addEventListener('paste', (e: ClipboardEvent) => {
      // 避免在输入框输入时误拦截
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) {
            this.callbacks.onDropFile?.(file);
            this.notifyNotice('已从剪贴板粘贴载入地质图谱图片');
            break;
          }
        }
      }
    });
  }

  private notifyNotice(text: string): void {
    if (this.callbacks.onStatusNotice) {
      this.callbacks.onStatusNotice(text);
    }
  }

  private getCanvasPoint(e: MouseEvent): Point2D {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private onKeyDown(e: KeyboardEvent): void {
    const targetTag = (e.target as HTMLElement)?.tagName;
    if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') {
      return;
    }

    // 1. 方向键微调选中项 (Arrow Keys Nudge: 1px / Shift: 10px)
    if (
      e.code === 'ArrowUp' ||
      e.code === 'ArrowDown' ||
      e.code === 'ArrowLeft' ||
      e.code === 'ArrowRight'
    ) {
      // 步骤 4 的 geometry 选中也要能用方向键精调 —— tooltip 早就承诺了
      // "方向键 1px 精调"，但入口此前只认 selectedEntity（控制点/列），几何被挡在外面。
      const geoNudge =
        this.workflowStage === STAGE.CLEANUP && !!this.selectedGeometryId && !this.data.selectedEntity;
      if (this.data.selectedEntity || geoNudge) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.code === 'ArrowLeft') dx = -step;
        if (e.code === 'ArrowRight') dx = step;
        if (e.code === 'ArrowUp') dy = -step;
        if (e.code === 'ArrowDown') dy = step;
        if (geoNudge) {
          this.nudgeSelectedGeometry(dx, dy);
        } else {
          this.nudgeSelectedEntity(dx, dy);
        }
        return;
      }
    }

    // 1b. 删除选中的 Step 4 geometry（Delete / Backspace）
    if ((e.code === 'Delete' || e.code === 'Backspace') && this.selectedGeometryId) {
      e.preventDefault();
      void this.deleteSelectedGeometry();
      return;
    }

    // 2. 模式快捷键切换 (A: 加点, S: 微调, D: 删点, C: 加列, H: 平移, R: ROI)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      // S / V: 微调与选择模式 (Adjust Point)
      if (e.code === 'KeyS' || e.code === 'KeyV') {
        e.preventDefault();
        this.setToolMode('select');
        this.notifyNotice('切换工具: 微调与选择 (S) - 拖动锚点或方向键精调');
        return;
      }
      // A: 添加控制点模式 (Add Point)
      if (e.code === 'KeyA') {
        e.preventDefault();
        if (!this.guardTool('addPoint')) return;
        this.setToolMode('addPoint');
        this.notifyNotice('切换工具: 添加控制点 (A) - 点击左键插入锚点');
        return;
      }
      // D: 步骤 4 已选中几何时 = 删除该几何（与 Delete 键等价）；
      //    其余情况仍是"删除控制点"工具（步骤 5 起可用）。
      //    步骤 4 没有"删点"工具，所以 D 在这里不该被 eraser 门禁吞掉。
      if (e.code === 'KeyD') {
        e.preventDefault();
        if (!this.guardTool('eraser')) return;
        this.setToolMode('eraser');
        this.notifyNotice('切换工具: 删除控制点 (D) - 点击左键删除锚点或列');
        return;
      }
      // M: 像素测量尺 —— 量干扰线实际有多粗，再把数字填进侧栏"统一厚度"
      if (e.code === 'KeyM') {
        e.preventDefault();
        if (!this.guardTool('measure')) return;
        if (this.toolModeManager.getMode() === 'measure') {
          this.setToolMode('select');
          this.notifyNotice('已退出测量尺');
          return;
        }
        this.setToolMode('measure');
        this.notifyNotice('测量尺 (M): 在图上按住左键拖一条线，读出 Δx / Δy / 距离 (px)');
        return;
      }
      // C: 添加属种列 (Column)
      if (e.code === 'KeyC') {
        e.preventDefault();
        if (!this.guardTool('addCol')) return;
        this.setToolMode('addCol');
        this.notifyNotice('切换工具: 添加属种列 (C) - 点击图表插入垂直基线');
        return;
      }
      // H: 抓手平移模式 (Pan)
      if (e.code === 'KeyH') {
        e.preventDefault();
        this.setToolMode('pan');
        this.notifyNotice('切换工具: 抓手平移模式 (H) [提示: 右键直接拖拽也可平移]');
        return;
      }
      // R: ROI 矩形数据区
      if (e.code === 'KeyR') {
        e.preventDefault();
        if (!this.guardTool('roi')) return;
        this.setToolMode('roi');
        this.notifyNotice('切换工具: 数据取数区 ROI 模式 (R)');
        return;
      }
      // K: 线掩膜人工修正笔刷
      if (e.code === 'KeyK') {
        e.preventDefault();
        if (!this.guardTool('linefix')) return;
        // 修正时必须能看见掩膜，否则等于闭眼涂改
        this.viewport.showBinaryOverlay = true;
        this.setToolMode('linefix');
        this.notifyNotice(
          `切换工具: 线掩膜修正 (K) —— 当前为${this.lineFixMode === 'erase' ? '擦除误标' : '补回漏标'}笔，按 B 可切换叠加层显隐`
        );
        return;
      }
      // Y: Y 轴两点标定
      if (e.code === 'KeyY') {
        e.preventDefault();
        if (!this.guardTool('ycalib')) return;
        this.clearYCalibMarks();
        this.setToolMode('ycalib');
        this.notifyNotice('切换工具: Y 轴两点标定 (Y) —— 依次点击 Y 轴上两个已知刻度所在的行');
        return;
      }
      if (e.code === 'Escape') {
        e.preventDefault();
        if (this.toolModeManager.getMode() !== 'select') {
          this.setToolMode('select');
          this.notifyNotice('已返回微调与选择模式 (S)');
        } else if (this.data.selectedEntity) {
          this.data.selectedEntity = null;
          this.requestRender();
          this.notifyNotice('已取消选中');
        }
        return;
      }
      if (e.code === 'KeyF') {
        e.preventDefault();
        this.fitToScreen();
        this.notifyNotice('视图: 适应屏幕居中 (F)');
        return;
      }
      // Delete: 唯一的规范删除键（F1 帮助由全局统一处理，此处不再重复绑定）
      if (e.code === 'Delete') {
        if (this.data.selectedEntity) {
          e.preventDefault();
          if (!this.guardTool('eraser')) return;
          this.deleteSelectedEntity();
          return;
        }
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        this.viewport.zoomStepAt({ x: rect.width / 2, y: rect.height / 2 }, true);
        this.requestRender();
        this.notifyNotice(`视图放大: ${Math.round(this.viewport.scale * 100)}%`);
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        this.viewport.zoomStepAt({ x: rect.width / 2, y: rect.height / 2 }, false);
        this.requestRender();
        this.notifyNotice(`视图缩小: ${Math.round(this.viewport.scale * 100)}%`);
        return;
      }
    }

    // 2. 空格键平移视口
    if (e.code === 'Space' && !this.isSpaceDown) {
      this.isSpaceDown = true;
      this.updateCursor();
      e.preventDefault();
      return;
    }

    // 3. 按 B 键：即时透视二值化前景色/背景遮罩
    if (e.code === 'KeyB') {
      e.preventDefault();
      const isActive = this.viewport.toggleBinaryOverlay();
      this.notifyNotice(
        isActive
          ? '透视遮罩: 二值化墨迹高亮模式 [已开启] (按 B 键关闭)'
          : '透视遮罩: 二值化墨迹高亮模式 [已关闭] (按 B 键开启)'
      );
      this.callbacks.onFilterChange?.(this.viewport.imageMode, this.viewport.showBinaryOverlay);
      this.requestRender();
      return;
    }

    // 4. 按 I 键：切换底图反相 (Invert) 模式
    if (e.code === 'KeyI' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.viewport.imageMode = this.viewport.imageMode === 'invert' ? 'normal' : 'invert';
      this.notifyNotice(`底图滤镜: ${this.viewport.imageMode === 'invert' ? '反相负片 (Invert)' : '原图 (Normal)'}`);
      this.callbacks.onFilterChange?.(this.viewport.imageMode, this.viewport.showBinaryOverlay);
      this.requestRender();
      return;
    }

    // 5. 按 C 键：切换高对比度 (High Contrast) 模式
    if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.viewport.imageMode = this.viewport.imageMode === 'contrast' ? 'normal' : 'contrast';
      this.notifyNotice(`底图滤镜: ${this.viewport.imageMode === 'contrast' ? '高对比度 (Contrast)' : '原图 (Normal)'}`);
      this.callbacks.onFilterChange?.(this.viewport.imageMode, this.viewport.showBinaryOverlay);
      this.requestRender();
      return;
    }

    // Ctrl+1 原始尺寸 100%
    if ((e.ctrlKey || e.metaKey) && e.code === 'Digit1') {
      e.preventDefault();
      this.resetZoom100();
      this.notifyNotice('视图: 1:1 原始尺寸 (Ctrl+1)');
      return;
    }

    // Ctrl + + / = 放大
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.viewport.zoomStepAt({ x: rect.width / 2, y: rect.height / 2 }, true, true);
      this.requestRender();
      this.notifyNotice(`视图放大: ${Math.round(this.viewport.scale * 100)}%`);
      return;
    }

    // Ctrl + - / _ 缩小
    if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.viewport.zoomStepAt({ x: rect.width / 2, y: rect.height / 2 }, false, true);
      this.requestRender();
      this.notifyNotice(`视图缩小: ${Math.round(this.viewport.scale * 100)}%`);
      return;
    }

    // Ctrl+Z 撤销
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      const prev = this.history.undo();
      if (prev) {
        this.data.columns = prev.columns;
        this.data.activeTaxaId = prev.activeTaxaId;
        this.requestRender();
      }
    }

    // Ctrl+Y 重做（唯一的重做规范键）
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      const next = this.history.redo();
      if (next) {
        this.data.columns = next.columns;
        this.data.activeTaxaId = next.activeTaxaId;
        this.requestRender();
      }
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (e.code === 'Space') {
      this.isSpaceDown = false;
      this.isPanning = false;
      this.updateCursor();
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();

    // 1. Shift + 滚轮：水平平移视口
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
      this.viewport.panBy(-e.deltaY, 0);
      this.requestRender();
      return;
    }

    // 2. Alt + 滚轮：垂直平移视口
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      this.viewport.panBy(0, -e.deltaY);
      this.requestRender();
      return;
    }

    // 3. 默认 / Ctrl+滚轮：以鼠标所指处为锚点进行平滑缩放
    const screenPt = this.getCanvasPoint(e);
    const zoomIn = e.deltaY < 0;
    this.viewport.zoomStepAt(screenPt, zoomIn, e.ctrlKey || e.metaKey);
    this.requestRender();
  }

  private onDoubleClick(e: MouseEvent): void {
    if (e.button !== 0) return;
    const screenPt = this.getCanvasPoint(e);
    const hitAnchor = this.findHitAnchor(screenPt);

    if (hitAnchor) {
      const col = this.data.columns.find((c) => c.id === hitAnchor.taxaId);
      const pt = col?.controlPoints.find((p) => p.id === hitAnchor.pointId);
      if (col && pt) {
        this.notifyNotice(`已聚焦锚点: ${col.name} [X:${pt.x}, Y:${pt.y}]`);
      }
      return;
    }

    // 双击空白处：自适应居中适应屏幕 (Fit to Screen)
    this.fitToScreen();
    this.notifyNotice('双击快速适应屏幕居中 (Fit to Screen)');
  }

  private getToolContext(): ToolContext {
    return {
      data: this.data,
      viewport: this.viewport,
      workflowStage: this.workflowStage,
      history: this.history,
      requestRender: () => this.requestRender(),
      notifyNotice: (msg) => this.notifyNotice(msg),
      updateCursor: () => this.updateCursor(),
      setToolMode: (mode) => this.setToolMode(mode),
      getActiveColumn: () => this.getActiveColumn() ?? null,
      callbacks: this.callbacks,
      isToolAllowed: (mode) => this.isToolAllowed(mode),
      isWithinDiagramBounds: (worldPt) => this.isWithinDiagramBounds(worldPt),
      findHitAnchor: (screenPt) => this.findHitAnchor(screenPt),
      findHitBoundary: (screenPt) => this.findHitBoundary(screenPt),
      findHitRoiHandle: (screenPt) => this.findHitRoiHandle(screenPt),
      findHitColumn: (worldPt) => this.findHitColumn(worldPt),
      findHitGeometry: (worldPt) => this.findHitGeometry(worldPt),
      getSelectedGeometryId: () => this.selectedGeometryId,
      setSelectedGeometryId: (id) => this.setSelectedGeometryId(id),
      commitGeometry: (id, axis, r) => this.commitGeometry(id, axis, r),
      hoveredDepthHorizon: this.hoveredDepthHorizon,
      hoverWorldPt: this.hoverWorldPt,
      lineFixMode: this.lineFixMode,
      yCalibMarks: this.yCalibMarks,
      setYCalibMarks: (marks) => this.setYCalibMarks(marks),
      clearYCalibMarks: () => this.clearYCalibMarks(),
    };
  }

  private onMouseDown(e: MouseEvent): void {
    const screenPt = this.getCanvasPoint(e);
    this.lastMouseScreen = screenPt;
    this.isMouseDown = true;

    const mode = this.toolModeManager.getMode();

    // 鼠标右键 (2)、鼠标中键 (1)、空格键按住、或处于 pan 抓手模式：一律进入视口平移
    if (e.button === 2 || e.button === 1 || (e.button === 0 && (this.isSpaceDown || mode === 'pan'))) {
      this.isPanning = true;
      this.updateCursor();
      return;
    }

    if (e.button === 0) {
      const worldPt = this.viewport.screenToWorld(screenPt);
      const strategy = this.toolStrategies.get(mode);
      if (strategy?.onMouseDown) {
        const handled = strategy.onMouseDown(e, screenPt, worldPt, this.getToolContext());
        if (handled) return;
      }
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const screenPt = this.getCanvasPoint(e);
    const deltaX = screenPt.x - this.lastMouseScreen.x;
    const deltaY = screenPt.y - this.lastMouseScreen.y;
    this.lastMouseScreen = screenPt;

    const worldPt = this.viewport.screenToWorld(screenPt);
    this.hoverWorldPt = { x: worldPt.x, y: worldPt.y };

    if (this.isPanning) {
      this.viewport.panBy(deltaX, deltaY);
      this.requestRender();
      return;
    }

    const mode = this.toolModeManager.getMode();
    const strategy = this.toolStrategies.get(mode);
    if (strategy?.onMouseMove) {
      const handled = strategy.onMouseMove(e, screenPt, worldPt, { x: deltaX, y: deltaY }, this.getToolContext());
      if (handled) return;
    }

    // 探测当前是否悬停在特定标准地层层位附近
    const cal = this.data.calibration;
    const roi = this.data.roi;
    const calib = CoordinateSystem.calibrationBounds(cal);
    const interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;

    let depth: number | undefined;
    if (calib) {
      const totalPx = calib.bottomPx - calib.topPx;
      depth =
        calib.topValue +
        ((worldPt.y - calib.topPx) / totalPx) * (calib.bottomValue - calib.topValue);

      if (worldPt.y >= calib.topPx - 15 && worldPt.y <= calib.bottomPx + 15) {
        const nearestHorizon = Math.round(depth / interval) * interval;
        const nearestHorizonY =
          calib.topPx +
          ((nearestHorizon - calib.topValue) / (calib.bottomValue - calib.topValue || 1)) *
            totalPx;
        if (Math.abs(worldPt.y - nearestHorizonY) <= 8 / this.viewport.scale) {
          this.hoveredDepthHorizon = Number(nearestHorizon.toFixed(2));
        } else {
          this.hoveredDepthHorizon = null;
        }
      } else {
        this.hoveredDepthHorizon = null;
      }
    } else {
      this.hoveredDepthHorizon = null;
    }

    // 探测是否悬停在左侧标尺顶部设定按钮
    const gridStartX = Math.max(0, roi.xMin - 50);
    const wasHoveringBadge = this.isHoveringDepthRulerBadge;
    this.isHoveringDepthRulerBadge =
      worldPt.x <= gridStartX &&
      worldPt.x >= gridStartX - 160 &&
      worldPt.y >= roi.yMin - 35 &&
      worldPt.y <= roi.yMin + 5;

    if (wasHoveringBadge !== this.isHoveringDepthRulerBadge) {
      this.updateCursor();
      this.requestRender();
    }

    // 悬停信息回调
    if (this.callbacks.onHoverInfo) {
      const activeCol = this.getActiveColumn();
      let percent: number | undefined;

      if (activeCol) {
        percent = CoordinateSystem.imageXToPercent(worldPt.x, activeCol);
      }

      this.callbacks.onHoverInfo({
        worldX: Math.round(worldPt.x),
        worldY: Math.round(worldPt.y),
        depth: depth ? Number(depth.toFixed(2)) : undefined,
        percent: percent ? Number(Math.max(0, percent).toFixed(1)) : undefined,
        horizonDepth: this.hoveredDepthHorizon,
      });
    }

    // 普通悬停探测
    const prevHoverAnchor = this.hoveredAnchor;
    const prevHoverBoundary = this.hoveredBoundary;
    const prevHoverRoi = this.hoveredRoiHandle;

    this.hoveredRoiHandle = canHitRoiHandle(this.workflowStage) ? this.findHitRoiHandle(screenPt) : null;
    this.hoveredAnchor = this.findHitAnchor(screenPt);
    this.hoveredBoundary = !this.hoveredAnchor ? this.findHitBoundary(screenPt) : null;

    if (
      prevHoverAnchor?.pointId !== this.hoveredAnchor?.pointId ||
      prevHoverBoundary?.taxaId !== this.hoveredBoundary?.taxaId ||
      prevHoverBoundary?.type !== this.hoveredBoundary?.type ||
      prevHoverRoi !== this.hoveredRoiHandle
    ) {
      this.updateCursor();
      this.requestRender();
    }
  }

  private onMouseUp(e: MouseEvent): void {
    if (this.isPanning) {
      this.isPanning = false;
      this.isMouseDown = false;
      this.updateCursor();
      this.requestRender();
      return;
    }

    const screenPt = this.getCanvasPoint(e);
    const worldPt = this.viewport.screenToWorld(screenPt);
    const mode = this.toolModeManager.getMode();
    const strategy = this.toolStrategies.get(mode);
    if (strategy?.onMouseUp) {
      strategy.onMouseUp(e, screenPt, worldPt, this.getToolContext());
    }

    this.isMouseDown = false;
    this.updateCursor();
    this.requestRender();
  }

  private onMouseLeave(e: MouseEvent): void {
    this.isMouseDown = false;
    this.isPanning = false;
    const mode = this.toolModeManager.getMode();
    this.toolStrategies.get(mode)?.onMouseLeave?.(e, this.getToolContext());
    this.updateCursor();
  }

  /** Y 轴两点标定：清空已点选但尚未提交的参考点。 */
  public clearYCalibMarks(): void {
    this.yCalibMarks = [];
    this.requestRender();
  }

  /** 供外部（弹出真值对话框被取消时）回退已点选的参考点。 */
  public setYCalibMarks(marks: Point2D[]): void {
    this.yCalibMarks = marks.slice(0, 2);
    this.requestRender();
  }

  public getYCalibMarks(): Point2D[] {
    return [...this.yCalibMarks];
  }

  /** 返回最近一次完整渲染实际调用过的图层，供只读验收句柄使用。 */
  public getLastRenderedLayers(): string[] {
    return [...this.lastRenderedLayers];
  }

  /** 返回最近一次渲染中失败的叠加层 id → 错误，供验收与状态栏读取。 */
  public getOverlayErrors(): Array<{ id: string; error: unknown }> {
    return [...this.overlayErrors.entries()].map(([id, error]) => ({ id, error }));
  }

  private nudgeTimer: number | null = null;

  public nudgeSelectedEntity(dx: number, dy: number): void {
    if (!this.data.selectedEntity) return;

    if (this.data.selectedEntity.type === 'point') {
      const { colId, pointId } = this.data.selectedEntity;
      const col = this.data.columns.find((c) => c.id === colId);
      if (col) {
        const pt = col.controlPoints.find((p) => p.id === pointId);
        if (pt) {
          pt.x += dx;
          pt.y += dy;
          pt.isManual = true;
          col.controlPoints.sort((a, b) => a.y - b.y);
          this.requestRender();
          this.callbacks.onDataChange?.();
          this.notifyNotice(`微调控制点: ${col.name} [X:${pt.x}, Y:${pt.y}] (${dx !== 0 ? (dx > 0 ? `+${dx}px` : `${dx}px`) : ''} ${dy !== 0 ? (dy > 0 ? `+${dy}px` : `${dy}px`) : ''})`);

          // 连续微调 500ms 后提交撤销历史记录
          if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
          this.nudgeTimer = window.setTimeout(() => {
            this.history.push(`Nudge Anchor in ${col.name}`, this.data.columns, this.data.activeTaxaId);
            this.nudgeTimer = null;
          }, 500);
        }
      }
    } else if (this.data.selectedEntity.type === 'column') {
      const colId = this.data.selectedEntity.id;
      const part = this.data.selectedEntity.part;
      const col = this.data.columns.find((c) => c.id === colId);
      if (col && dx !== 0) {
        if (part === 'start') {
          col.startX += dx;
          if (col.scaleCalib) col.scaleCalib.originX = col.startX;
        } else if (part === 'tick') {
          col.tickEndX = (col.tickEndX ?? col.endX) + dx;
          if (col.scaleCalib) col.scaleCalib.calibX = col.tickEndX;
        } else {
          col.endX += dx;
        }
        this.requestRender();
        this.callbacks.onDataChange?.();
        this.notifyNotice(`微调分列线: ${col.name} (${dx > 0 ? `+${dx}px` : `${dx}px`})`);

        if (this.nudgeTimer) clearTimeout(this.nudgeTimer);
        this.nudgeTimer = window.setTimeout(() => {
          this.history.push(`Nudge Column ${col.name}`, this.data.columns, this.data.activeTaxaId);
          this.nudgeTimer = null;
        }, 500);
      }
    }
  }

  private geometryNudgeTimer: number | null = null;
  /** 防抖窗口内待提交的微调；与回调闭包解耦，flush 时按此载荷提交。 */
  private pendingGeometryNudge: {
    id: string;
    axis: 'h' | 'v';
    rect: { x0: number; y0: number; x1: number; y1: number };
  } | null = null;

  /**
   * 立刻把待提交的方向键微调落库（无待提交时为空操作）。**必须 await**。
   *
   * 防抖是为了不把 RPC 打爆，但防抖窗口内的改动不能是「薛定谔的改动」：只要
   * 后面还有别的几何写操作（删除 / 改厚度 / 重扫 / 清空），就必须先让它落地。
   *
   * 为什么必须是 async 而不是"发出去就算"：`onGeometryCommit` 内部要走一次 RPC。
   * 若只同步发起，微调的 upsert 与随后的 delete 会同时在途、顺序无保证 —— 实测
   * 复现过 delete 先到、延迟的 upsert 后到，于是被删掉的几何**原地复活**。
   *
   * 先把 `pendingGeometryNudge` 清空再回调，故回调内部再次调用本函数会立即返回，
   * 不会无限递归（runCleanupAction 内部也会 flush 一次）。
   */
  public async flushPendingGeometryEdits(): Promise<void> {
    if (this.geometryNudgeTimer) {
      clearTimeout(this.geometryNudgeTimer);
      this.geometryNudgeTimer = null;
    }
    const pending = this.pendingGeometryNudge;
    if (!pending) return;
    this.pendingGeometryNudge = null;
    await this.callbacks.onGeometryCommit?.(pending.id, pending.axis, pending.rect);
  }

  /**
   * 方向键微调选中的 geometry（步骤 4）。
   *
   * 与 `nudgeSelectedEntity` 同构：先本地即时改（跟手、不卡），连按停止 500ms 后
   * 才提交后端——否则按住方向键会把 RPC 打爆。
   */
  public nudgeSelectedGeometry(dx: number, dy: number): void {
    const id = this.selectedGeometryId;
    if (!id) return;
    const cand = (this.data.line_candidates || []).find((c) => c.id === id);
    const g = cand?.geometry;
    if (!cand || !g) return;

    const next = {
      type: 'rect' as const,
      x0: g.x0 + dx,
      y0: g.y0 + dy,
      x1: g.x1 + dx,
      y1: g.y1 + dy,
    };
    cand.geometry = next;
    // 同步派生显示字段，面板读数不滞后。
    if (cand.axis === 'h') cand.at = Math.round((next.y0 + next.y1) / 2);
    else cand.at = Math.round((next.x0 + next.x1) / 2);
    this.requestRender();
    const d = [
      dx !== 0 ? `${dx > 0 ? '+' : ''}${dx}px` : '',
      dy !== 0 ? `${dy > 0 ? '+' : ''}${dy}px` : '',
    ]
      .filter(Boolean)
      .join(' ');
    this.notifyNotice(`微调几何: ${d}`);

    // 载荷存在字段里，而不是靠回调闭包捕获 next：数据刷新会先 flush（见
    // loadNewDiagram），随后 this.data 被整块替换，闭包里的 next 就不再是权威值。
    this.pendingGeometryNudge = {
      id,
      axis: cand.axis,
      rect: { x0: next.x0, y0: next.y0, x1: next.x1, y1: next.y1 },
    };
    if (this.geometryNudgeTimer) clearTimeout(this.geometryNudgeTimer);
    this.geometryNudgeTimer = window.setTimeout(() => {
      // 走同一个 flush，保证"防抖到期提交"与"被别的操作逼着提交"两条路径行为一致。
      void this.flushPendingGeometryEdits();
    }, 500);
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();

    // 右键原地点击（非拖动平移）：退出当前模式或取消选中
    if (this.toolModeManager.getMode() !== 'select') {
      this.setToolMode('select');
      this.notifyNotice('右键已退出当前工具，返回微调与选择模式 (S)');
      return;
    }

    if (this.data.selectedEntity) {
      this.data.selectedEntity = null;
      this.requestRender();
      this.callbacks.onDataChange?.();
      this.notifyNotice('已取消选中');
      return;
    }
  }

  public deleteSelectedEntity(): void {
    if (!this.data.selectedEntity) return;

    if (this.data.selectedEntity.type === 'point') {
      const { colId, pointId } = this.data.selectedEntity;
      const col = this.data.columns.find((c) => c.id === colId);
      if (col) {
        const pt = col.controlPoints.find((p) => p.id === pointId);
        col.controlPoints = col.controlPoints.filter((p) => p.id !== pointId);
        this.history.push(`Delete Anchor from ${col.name}`, this.data.columns, this.data.activeTaxaId);
        this.data.selectedEntity = null;
        this.hoveredAnchor = null;
        this.updateCursor();
        this.requestRender();
        this.callbacks.onDataChange?.();
        this.notifyNotice(`已删除 ${col.name} 的锚点 [Y:${pt ? pt.y : '--'}]`);
      }
    } else if (this.data.selectedEntity.type === 'column') {
      const colId = this.data.selectedEntity.id;
      const colIdx = this.data.columns.findIndex((c) => c.id === colId);
      if (colIdx !== -1 && this.data.columns.length > 1) {
        const deleted = this.data.columns.splice(colIdx, 1)[0];
        this.data.selectedEntity = null;
        this.data.activeTaxaId = this.data.columns[Math.max(0, colIdx - 1)].id;
        this.history.push(`Delete Column ${deleted.name}`, this.data.columns, this.data.activeTaxaId);
        this.hoveredBoundary = null;
        this.updateCursor();
        this.requestRender();
        this.callbacks.onDataChange?.();
        this.callbacks.onTaxaChange?.(this.data.activeTaxaId);
        this.notifyNotice(`已删除属种列: ${deleted.name}`);
      }
    }
  }

  private updateCursor(): void {
    if (this.isPanning || this.isSpaceDown || this.toolModeManager.getMode() === 'pan') {
      this.canvas.style.cursor = this.isMouseDown ? 'grabbing' : 'grab';
      return;
    }
    const mode = this.toolModeManager.getMode();
    const strategy = this.toolStrategies.get(mode);
    const customCursor = strategy?.getCursor?.(this.getToolContext());

    const roiStrat = strategy instanceof RoiToolStrategy ? strategy : undefined;
    const activeRoiHandle = roiStrat?.getDraggingHandle() || this.hoveredRoiHandle;

    if (activeRoiHandle) {
      const h = activeRoiHandle;
      if (h === 'tl' || h === 'br') this.canvas.style.cursor = 'nwse-resize';
      else if (h === 'tr' || h === 'bl') this.canvas.style.cursor = 'nesw-resize';
      else if (h === 't' || h === 'b') this.canvas.style.cursor = 'ns-resize';
      else if (h === 'l' || h === 'r') this.canvas.style.cursor = 'ew-resize';
    } else if (this.hoveredAnchor || customCursor === 'move') {
      this.canvas.style.cursor = 'move';
    } else if (this.hoveredBoundary || customCursor === 'col-resize') {
      this.canvas.style.cursor = 'col-resize';
    } else if (customCursor) {
      this.canvas.style.cursor = customCursor;
    } else {
      this.canvas.style.cursor = this.toolModeManager.getToolDescription(mode).cursor;
    }
  }

  private findHitColumn(worldPt: Point2D): TaxaColumn | null {
    const roi = this.data.roi;
    // 允许在数据区深度范围以及上方标签区域点击选中该列
    if (worldPt.y < roi.yMin - 60 || worldPt.y > roi.yMax + 40) {
      return null;
    }

    for (const col of this.data.columns) {
      if (!col.visible) continue;
      // 在本列基线 startX 与隔离右界 endX 范围内判定
      if (worldPt.x >= col.startX - 3 && worldPt.x <= col.endX + 3) {
        return col;
      }
    }
    return null;
  }

  // ===================== 几何命中判定 (严格屏幕像素恒定) =====================

  private isWithinDiagramBounds(worldPt: Point2D): boolean {
    const roi = this.data.roi;
    return worldPt.y >= roi.yMin - 50 && worldPt.y <= roi.yMax + 50;
  }

  private findHitAnchor(screenPt: Point2D): { taxaId: string; pointId: string } | null {
    const hitRadius = this.ANCHOR_HIT_RADIUS_SCREEN;
    const activeCol = this.getActiveColumn();
    if (activeCol && activeCol.visible) {
      for (const pt of activeCol.controlPoints) {
        const ptScreen = this.viewport.worldToScreen(pt);
        const dist = Math.hypot(ptScreen.x - screenPt.x, ptScreen.y - screenPt.y);
        if (dist <= hitRadius) {
          return { taxaId: activeCol.id, pointId: pt.id };
        }
      }
    }

    for (const col of this.data.columns) {
      if (col.id === this.data.activeTaxaId || !col.visible) continue;
      for (const pt of col.controlPoints) {
        const ptScreen = this.viewport.worldToScreen(pt);
        const dist = Math.hypot(ptScreen.x - screenPt.x, ptScreen.y - screenPt.y);
        if (dist <= hitRadius) {
          return { taxaId: col.id, pointId: pt.id };
        }
      }
    }

    return null;
  }

  private findHitBoundary(
    screenPt: Point2D
  ): { taxaId: string; type: 'start' | 'tick' | 'end'; x: number } | null {
    const hitWidth = this.BOUNDARY_HIT_WIDTH_SCREEN;
    for (const col of this.data.columns) {
      if (!col.visible) continue;

      // 1. 基线 (0%)
      const startScreenX = this.viewport.worldToScreen({ x: col.startX, y: 0 }).x;
      if (Math.abs(screenPt.x - startScreenX) <= hitWidth) {
        return { taxaId: col.id, type: 'start', x: col.startX };
      }

      // 2. 刻度终点 (N%)
      const actualTickX = col.tickEndX && col.tickEndX > col.startX ? col.tickEndX : col.endX;
      const tickScreenX = this.viewport.worldToScreen({ x: actualTickX, y: 0 }).x;
      if (Math.abs(screenPt.x - tickScreenX) <= hitWidth) {
        return { taxaId: col.id, type: 'tick', x: actualTickX };
      }

      // 3. 列间隔离右界 / 相邻两列公共分界线
      if (col.endX > actualTickX + 2) {
        const endScreenX = this.viewport.worldToScreen({ x: col.endX, y: 0 }).x;
        if (Math.abs(screenPt.x - endScreenX) <= hitWidth) {
          return { taxaId: col.id, type: 'end', x: col.endX };
        }
      }
    }
    return null;
  }

  private findHitRoiHandle(screenPt: Point2D): RoiHandle | null {
    if (!canHitRoiHandle(this.workflowStage)) return null;
    const roi = this.data.roi;
    const tlScreen = this.viewport.worldToScreen({ x: roi.xMin, y: roi.yMin });
    const brScreen = this.viewport.worldToScreen({ x: roi.xMax, y: roi.yMax });
    const midX = (tlScreen.x + brScreen.x) / 2;
    const midY = (tlScreen.y + brScreen.y) / 2;

    const handles: Record<RoiHandle, Point2D> = {
      tl: { x: tlScreen.x, y: tlScreen.y },
      tr: { x: brScreen.x, y: tlScreen.y },
      bl: { x: tlScreen.x, y: brScreen.y },
      br: { x: brScreen.x, y: brScreen.y },
      t: { x: midX, y: tlScreen.y },
      b: { x: midX, y: brScreen.y },
      l: { x: tlScreen.x, y: midY },
      r: { x: brScreen.x, y: midY },
    };

    const hitDist = this.ROI_HANDLE_SIZE_SCREEN + 2.0;
    for (const [key, pt] of Object.entries(handles) as [RoiHandle, Point2D][]) {
      if (Math.hypot(screenPt.x - pt.x, screenPt.y - pt.y) <= hitDist) {
        return key;
      }
    }
    return null;
  }

  // ===================== 核心高保真渲染管线 =====================

  public render(): void {
    this.lastRenderedLayers.clear();
    this.overlayErrors.clear();
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.viewport.dpr;
    const isLight = document.body.classList.contains('theme-light');

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 视口底层画板底色：日间模式使用纯白清爽画板 (#ffffff)，夜间模式使用深蓝黑 (#0b0f19)
    ctx.fillStyle = isLight ? '#ffffff' : '#0b0f19';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // 绘制微网格
    this.drawGrid(ctx, rect.width, rect.height, isLight);

    // 应用世界视口矩阵变换
    this.viewport.applyTransform(ctx);

    // 1. 底层扫描地质图谱（支持原图、反相、高对比、纯二值化与透视遮罩）
    this.drawBackgroundDiagram(ctx, isLight);
    this.lastRenderedLayers.add('background');

    // 2. 地层深度标尺网格系统（阶段语义集中在 core/WorkflowStage.ts）
    if (showsDepthGrid(this.workflowStage) && this.drawDepthGrid(ctx, isLight)) {
      this.lastRenderedLayers.add('depthGrid');
    }

    // 3. 取数区域矩形与控制手柄 (ROI)
    if (showsRoiOverlay(this.workflowStage)) {
      this.drawRoiOverlay(ctx, isLight);
      this.lastRenderedLayers.add('roi');
    }

    // 3.1 Y 轴两点标定记号与标定跨度指示
    // 与 canPickYCalibMark 成对：绘制与拾取任一侧落后一步都会让点击毫无反馈。
    if (showsYCalibMarks(this.workflowStage)) {
      const ystrat = this.toolStrategies.get('ycalib') as YCalibToolStrategy | undefined;
      if (ystrat && ystrat.hasMarksOrHover(this.getToolContext())) {
        ystrat.renderOverlay(ctx, this.getToolContext());
        this.lastRenderedLayers.add('yCalibMarks');
      }
    }

    // 3.2 线掩膜人工修正笔迹预览 (涂抹中显示)
    const lineFixStrat = this.toolStrategies.get('linefix') as LineFixToolStrategy | undefined;
    if (lineFixStrat?.hasStrokePreview()) {
      lineFixStrat.renderOverlay(ctx, this.getToolContext());
      this.lastRenderedLayers.add('lineFix');
    }

    // 4. 各属种垂直分界标线与两点式物理刻度钉
    if (showsColumnBoundaries(this.workflowStage, this.data.columns.length)) {
      this.drawColumnBoundaries(ctx, isLight);
      this.lastRenderedLayers.add('columnBoundaries');
    }

    // 5. 花粉轮廓面积图与曲线 + 控制锚点 + 质检比对层
    if (showsPollenCurves(this.workflowStage, this.data.columns.length)) {
      this.drawPollenCurves(ctx);
      this.lastRenderedLayers.add('pollenCurves');
      // 6. 控制锚点渲染
      this.drawAnchors(ctx);
      this.lastRenderedLayers.add('anchors');
      // 7. 原位半透明逆向重绘绿色质检比对层 (Visual Ghosting Layer)
      this.drawGhostingOverlay(ctx);
      this.lastRenderedLayers.add('ghosting');
    }

    // 7.1 拖拽新建 geometry 的实时预览
    const drawH = this.toolStrategies.get('drawLineH') as DrawLineToolStrategy | undefined;
    const drawV = this.toolStrategies.get('drawLineV') as DrawLineToolStrategy | undefined;
    if (drawH?.getGeometryCreate()) {
      drawH.renderOverlay(ctx, this.getToolContext());
      this.lastRenderedLayers.add('geometryCreatePreview');
    } else if (drawV?.getGeometryCreate()) {
      drawV.renderOverlay(ctx, this.getToolContext());
      this.lastRenderedLayers.add('geometryCreatePreview');
    }

    // 7.1b 测量尺（M）
    const measureStrat = this.toolStrategies.get('measure') as MeasureToolStrategy | undefined;
    if (measureStrat?.hasActiveRuler()) {
      measureStrat.renderOverlay(ctx, this.getToolContext());
      this.lastRenderedLayers.add('measureRuler');
    }

    // 7.2 自动收集并调用注册叠加层 (W3 叠加层扩展点)
    // 叠加层在世界坐标下绘制（见 `canvas/_registry.ts` 的坐标契约）。
    // 逐个 try/catch 而不是整体包一层：一个叠加层出错不能再连累其他叠加层，
    // 也不能静默 —— 静默吞异常会表现成"画布上什么都没有"，极难排查。
    const overlays = getAllOverlays();
    for (const ov of overlays) {
      try {
        ov.draw(ctx, this.data, this.viewport);
        this.lastRenderedLayers.add(ov.id);
      } catch (error) {
        this.overlayErrors.set(ov.id, error);
        this.callbacks.onOverlayError?.(ov.id, error);
      }
    }

    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, isLight: boolean): void {
    ctx.save();
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    ctx.beginPath();
    for (let x = 0; x < width; x += gridSize) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawBackgroundDiagram(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    // naturalWidth === 0 表示图片 broken（加载失败/未完成）；此时 drawImage 会抛
    // InvalidStateError。isImageLoaded 只是第一道闸，这里必须再兜一次。
    if (this.diagramImage && this.isImageLoaded && this.diagramImage.naturalWidth > 0) {
      const mode = this.viewport.imageMode;
      const w = this.diagramImage.naturalWidth;
      const h = this.diagramImage.naturalHeight;

      // 日间模式下给图谱底纸增加柔和投影立体感
      if (isLight) {
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
        ctx.shadowBlur = 16 / this.viewport.scale;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4 / this.viewport.scale;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // 纯二值化模式：直接用后端掩膜层（白=保留墨迹）铺在深色画板上
      if (mode === 'binary' && this.lineOverlayImage) {
        ctx.fillStyle = '#090f19';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(this.lineOverlayImage, 0, 0, w, h);
      } else {
        // CSS Canvas 滤镜
        if (mode === 'invert') {
          ctx.filter = 'invert(1) hue-rotate(180deg) brightness(105%) contrast(120%)';
        } else if (mode === 'contrast') {
          ctx.filter = 'contrast(240%) brightness(105%)';
        }

        // 视口裁剪渲染：针对超大图谱仅光栅化可见视口切片，极大幅度降低 GPU 显存与重绘负荷
        const rect = this.canvas.getBoundingClientRect();
        const minW = this.viewport.screenToWorld({ x: 0, y: 0 });
        const maxW = this.viewport.screenToWorld({ x: rect.width, y: rect.height });

        const sx = Math.max(0, Math.floor(minW.x));
        const sy = Math.max(0, Math.floor(minW.y));
        const sw = Math.min(w - sx, Math.ceil(maxW.x - minW.x) + 2);
        const sh = Math.min(h - sy, Math.ceil(maxW.y - minW.y) + 2);

        if (sw > 0 && sh > 0 && sx < w && sy < h) {
          ctx.drawImage(this.diagramImage, sx, sy, sw, sh, sx, sy, sw, sh);
        } else {
          ctx.drawImage(this.diagramImage, 0, 0);
        }
        ctx.filter = 'none';
      }
      ctx.restore();

      // B 键去线透视遮罩：画的就是后端掩膜（白=保留墨迹，红=实际剔除像素）。
      // 所见即数字化实际所用，前后端不可能再各画一套而互相矛盾。
      if (this.viewport.showBinaryOverlay && this.lineOverlayImage) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(this.lineOverlayImage, 0, 0, w, h);
        ctx.restore();
      }
    } else if (this.data.imageSrc) {
      // 仅在已声明图谱路径但尚未完成解码的短暂瞬间展示加载占位；
      // 未载入任何图片时（S0/S1 空态）绝不画任何假框或'正在载入'文字，由 emptyStateOverlay 接管引导。
      ctx.save();
      ctx.fillStyle = isLight ? '#f8fafc' : '#1e293b';
      ctx.fillRect(0, 0, this.data.imageWidth || 1600, this.data.imageHeight || 1000);
      ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
      ctx.font = '16px sans-serif';
      ctx.fillText('正在解码地质图谱...', 40, 60);
      ctx.restore();
    }
  }

  /**
   * 绘制地层深度标尺网格系统 (Depth Grid Ruler)。
   *
   * 未完成两点标定时整段不画：没有标定就没有"深度"这回事，画一组 0/50/100
   * 的假刻度会让人以为深度轴已经生效（旧实现正是拿 ROI 边界冒充刻度）。
   */
  private drawDepthGrid(ctx: CanvasRenderingContext2D, isLight: boolean): boolean {
    const cal = this.data.calibration;
    const roi = this.data.roi;
    const bounds = CoordinateSystem.calibrationBounds(cal);
    if (!bounds || cal.depthGridEnabled === false) return false;

    // 网格线仅在 Step 7（采样层位）或 Step 3（物理标定）等需要时显示，
    // Step 4 (干扰清理) 和 Step 5 (自动分列) 默认不绘制网格线，彻底消除抹黑图谱的灾难
    if (this.workflowStage === STAGE.CLEANUP || this.workflowStage === STAGE.SPLIT) {
      return false;
    }

    const totalSpan = Math.abs(bounds.bottomValue - bounds.topValue);
    let interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;
    if (cal.depthInterval === undefined || (cal.depthInterval === 2 && totalSpan > 200)) {
      if (totalSpan > 5000) interval = 500;
      else if (totalSpan > 2000) interval = 200;
      else if (totalSpan > 1000) interval = 100;
      else if (totalSpan > 500) interval = 50;
      else if (totalSpan > 200) interval = 20;
    }
    const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(cal, roi);
    if (depths.length === 0) return false;

    const scale = this.viewport.scale;
    const totalCols = this.data.columns;
    const gridStartX = Math.max(0, roi.xMin - 50);
    const gridEndX = totalCols.length > 0
      ? Math.max(roi.xMax, totalCols[totalCols.length - 1].endX + 30)
      : roi.xMax + 60;

    ctx.save();

    // 步进标签显示频率计算，防止过度拥挤
    const labelStep = depths.length > 60 ? Math.ceil(depths.length / 30) : 1;

    for (let i = 0; i < depths.length; i++) {
      const d = depths[i];
      const y = yPositions[i];
      const isMajor = i % 5 === 0;
      const isHovered =
        this.hoveredDepthHorizon !== null &&
        Math.abs(this.hoveredDepthHorizon - d) <= interval * 0.45;

      // 1. 贯穿所有属种列的水平层位标线 (Depth Grid Line)
      ctx.beginPath();
      ctx.moveTo(gridStartX, y);
      ctx.lineTo(gridEndX, y);

      if (isHovered) {
        ctx.strokeStyle = isLight ? '#0284c7' : '#38bdf8';
        ctx.lineWidth = 2.2 / scale;
        ctx.setLineDash([]);
      } else if (isMajor) {
        ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.65)' : 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.3 / scale;
        ctx.setLineDash([5 / scale, 4 / scale]);
      } else {
        ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.35)' : 'rgba(125, 211, 252, 0.22)';
        ctx.lineWidth = 0.95 / scale;
        ctx.setLineDash([3 / scale, 3.5 / scale]);
      }
      ctx.stroke();

      // 2. 左侧标尺深度数值
      if (i % labelStep === 0 || isHovered) {
        ctx.fillStyle = isHovered
          ? (isLight ? '#0284c7' : '#38bdf8')
          : isMajor
          ? (isLight ? '#0369a1' : '#7dd3fc')
          : (isLight ? '#64748b' : 'rgba(125, 211, 252, 0.7)');
        ctx.font = `${isMajor || isHovered ? 'bold ' : ''}${Math.max(9, 11 / scale)}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${d}`, gridStartX - 8, y);
      }
    }

    // 3. 绘制左侧垂直深度标尺主轴：贯穿整个数据有效区
    ctx.beginPath();
    ctx.moveTo(gridStartX - 4, roi.yMin);
    ctx.lineTo(gridStartX - 4, roi.yMax);
    ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.7)' : 'rgba(56, 189, 248, 0.6)';
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([]);
    ctx.stroke();

    // 4. 绘制深度标尺顶部单位与层位间隔 Badge
    const badgeX = gridStartX - 8;
    const badgeY = bounds.topPx - 16;
    ctx.font = `bold ${Math.max(10, 11.5 / scale)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (this.isHoveringDepthRulerBadge) {
      ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
      ctx.fillText(`⚙ 标尺: ${interval}${cal.unit} [点击修改]`, badgeX, badgeY);
    } else {
      ctx.fillStyle = isLight ? 'rgba(2, 132, 199, 0.9)' : 'rgba(56, 189, 248, 0.85)';
      ctx.fillText(`Depth (${cal.unit}) [Δ=${interval}]`, badgeX, badgeY);
    }

    ctx.restore();
    return true;
  }

  /**
   * 绘制取数区域 (ROI) 矩形与 8 个手柄。
   *
   * 标签只报像素范围 —— 这个框不代表任何深度值。深度轴由 S4 的两点标定决定，
   * 由 drawYAxisCalibration 单独呈现。
   */
  private drawRoiOverlay(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    const roi = this.data.roi;
    const scale = this.viewport.scale;
    const isRoiMode = this.toolModeManager.getMode() === 'roi';

    ctx.save();

    // 1. 半透明取数区遮罩框
    const boxW = roi.xMax - roi.xMin;
    const boxH = roi.yMax - roi.yMin;

    ctx.fillStyle = isLight
      ? (isRoiMode ? 'rgba(2, 132, 199, 0.08)' : 'rgba(2, 132, 199, 0.03)')
      : (isRoiMode ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.03)');
    ctx.fillRect(roi.xMin, roi.yMin, boxW, boxH);

    // 2. 数据有效区外边框 (ROI Bounding Box)
    ctx.strokeStyle = isLight
      ? (isRoiMode ? '#0284c7' : 'rgba(2, 132, 199, 0.7)')
      : (isRoiMode ? '#38bdf8' : 'rgba(56, 189, 248, 0.7)');
    ctx.lineWidth = (isRoiMode ? 2.2 : 1.5) / scale;
    ctx.setLineDash(isRoiMode ? [] : [6 / scale, 4 / scale]);
    ctx.strokeRect(roi.xMin, roi.yMin, boxW, boxH);

    // 3. 绘制 8 个屏幕像素恒定的手柄 (Square Handles)
    const handleImgSize = this.ROI_HANDLE_SIZE_SCREEN / scale;
    const midX = (roi.xMin + roi.xMax) / 2;
    const midY = (roi.yMin + roi.yMax) / 2;

    const handles: Record<string, Point2D> = {
      tl: { x: roi.xMin, y: roi.yMin },
      tr: { x: roi.xMax, y: roi.yMin },
      bl: { x: roi.xMin, y: roi.yMax },
      br: { x: roi.xMax, y: roi.yMax },
      t: { x: midX, y: roi.yMin },
      b: { x: midX, y: roi.yMax },
      l: { x: roi.xMin, y: midY },
      r: { x: roi.xMax, y: midY },
    };

    ctx.setLineDash([]);
    const draggingRoi = (this.toolStrategies.get('roi') as RoiToolStrategy | undefined)?.getDraggingHandle();
    for (const [key, pt] of Object.entries(handles)) {
      const isHovered = this.hoveredRoiHandle === key || draggingRoi === key;
      const hSize = isHovered ? handleImgSize * 1.3 : handleImgSize;

      ctx.fillStyle = isHovered ? '#f97316' : '#ffffff';
      ctx.strokeStyle = isLight ? '#0f172a' : '#0b0f19';
      ctx.lineWidth = 1.5 / scale;

      ctx.fillRect(pt.x - hSize / 2, pt.y - hSize / 2, hSize, hSize);
      ctx.strokeRect(pt.x - hSize / 2, pt.y - hSize / 2, hSize, hSize);
    }

    // 4. 标签只报像素范围（ROI 不是刻度）
    ctx.fillStyle = isLight ? '#0284c7' : '#7dd3fc';
    ctx.font = `bold ${Math.max(10, 11 / scale)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(`ROI Y: ${Math.round(roi.yMin)}px`, roi.xMin - 8 / scale, roi.yMin + 4 / scale);
    ctx.fillText(`ROI Y: ${Math.round(roi.yMax)}px`, roi.xMin - 8 / scale, roi.yMax + 4 / scale);

    ctx.restore();
  }

  private drawColumnBoundaries(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    const roi = this.data.roi;
    const maxH = this.data.imageHeight || 12000;
    const topY = Math.max(0, roi.yMin - 40);
    const bottomY = Math.min(maxH, roi.yMax + 30);
    const scale = this.viewport.scale;

    ctx.save();

    this.data.columns.forEach((col) => {
      if (!col.visible) return;

      const isActive = col.id === this.data.activeTaxaId;
      const sc = col.scaleCalib || {
        originX: col.startX,
        originVal: 0,
        calibX: (col.tickEndX && col.tickEndX > col.startX) ? col.tickEndX : col.endX,
        calibVal: col.maxPercent ?? 20,
        unit: col.unit || '%',
      };

      const dragBoundary = (this.toolStrategies.get('select') as SelectToolStrategy | undefined)?.getDraggingBoundary();
      const isOriginHovered =
        (this.hoveredBoundary?.taxaId === col.id && this.hoveredBoundary.type === 'start') ||
        (dragBoundary?.taxaId === col.id && dragBoundary.type === 'start');

      const isCalibHovered =
        (this.hoveredBoundary?.taxaId === col.id && this.hoveredBoundary.type === 'tick') ||
        (dragBoundary?.taxaId === col.id && dragBoundary.type === 'tick');

      const isEndHovered =
        (this.hoveredBoundary?.taxaId === col.id && this.hoveredBoundary.type === 'end') ||
        (dragBoundary?.taxaId === col.id && dragBoundary.type === 'end');

      // 1. 端点 1 垂直基准线 (sc.originX - 对应数值 sc.originVal)
      ctx.beginPath();
      ctx.moveTo(sc.originX, topY);
      ctx.lineTo(sc.originX, bottomY);

      if (isOriginHovered) {
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 3 / scale;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.9)' : 'rgba(56, 189, 248, 0.85)';
        ctx.lineWidth = (isActive ? 2.0 : 1.5) / scale;
        ctx.setLineDash([]);
      }
      ctx.stroke();

      // 2. 端点 2 真实物理刻度齿垂直线 (sc.calibX - 对应数值 sc.calibVal)
      ctx.beginPath();
      ctx.moveTo(sc.calibX, topY);
      ctx.lineTo(sc.calibX, bottomY);

      if (isCalibHovered) {
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = 3 / scale;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = isLight ? 'rgba(220, 38, 38, 0.85)' : 'rgba(239, 68, 68, 0.8)';
        ctx.lineWidth = 1.6 / scale;
        ctx.setLineDash([5 / scale, 3 / scale]);
      }
      ctx.stroke();

      // 3. 列间空白隔离边界线 (endX - 仅当 endX 明显大于刻度齿时显示淡色隔离虚线)
      if (col.endX > sc.calibX + 4) {
        ctx.beginPath();
        ctx.moveTo(col.endX, topY);
        ctx.lineTo(col.endX, bottomY);

        if (isEndHovered) {
          ctx.strokeStyle = '#f97316';
          ctx.lineWidth = 2.5 / scale;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.5)' : 'rgba(148, 163, 184, 0.35)';
          ctx.lineWidth = 1.0 / scale;
          ctx.setLineDash([2 / scale, 4 / scale]);
        }
        ctx.stroke();
      }

      // 4. 绘制两点式物理刻度手柄 (Tick Pins) — 激活列显式绘制顶部定位把手
      if (isActive) {
        const pinSize = 6 / scale;
        // 原点齿 Pin (天青蓝方块)
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(sc.originX - pinSize / 2, topY - pinSize / 2, pinSize, pinSize);

        // 刻度齿 Pin (橙红色实心菱形，可拖拽微调刻度齿位置)
        ctx.fillStyle = isCalibHovered ? '#fbbf24' : '#f97316';
        ctx.beginPath();
        ctx.moveTo(sc.calibX, topY - pinSize);
        ctx.lineTo(sc.calibX + pinSize, topY);
        ctx.lineTo(sc.calibX, topY + pinSize);
        ctx.lineTo(sc.calibX - pinSize, topY);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 / scale;
        ctx.stroke();
      }

      // 5. 属种名称与端点数值标签
      const width = col.endX - col.startX;
      const centerX = col.startX + width / 2;

      // 属种名称与刻度防重叠渲染
      const colWidth = col.endX - col.startX;
      if (isActive) {
        ctx.save();
        const fontSize = Math.max(10, 12 / scale);
        ctx.font = `bold ${fontSize}px sans-serif`;
        const textMetrics = ctx.measureText(col.name);
        const badgeW = textMetrics.width + 16 / scale;
        const badgeH = 20 / scale;
        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        const bx = centerX - badgeW / 2;
        const by = topY - 26 / scale;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(bx, by, badgeW, badgeH, 4 / scale);
        } else {
          ctx.rect(bx, by, badgeW, badgeH);
        }
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(col.name, centerX, topY - 16 / scale);
        ctx.restore();

        // 仅在当前选中的激活列显示清晰端点刻度，防止几十列文字相互横向打架
        ctx.font = `600 ${Math.max(8.5, 9.5 / scale)}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        ctx.textAlign = 'left';
        ctx.fillText(`${sc.originVal}${sc.unit || '%'}`, sc.originX + 2 / scale, topY - 2 / scale);

        ctx.fillStyle = isLight ? '#dc2626' : '#f87171';
        ctx.textAlign = 'right';
        ctx.fillText(`${sc.calibVal}${sc.unit || '%'}`, sc.calibX - 2 / scale, topY - 2 / scale);
      } else {
        // 未激活列：若列较窄（< 40px），名称以 45 度优雅斜角呈现，杜绝多列名称横向重叠！
        ctx.save();
        ctx.fillStyle = isLight ? '#475569' : 'rgba(255, 255, 255, 0.75)';
        const fontSize = Math.max(9, 10.5 / scale);
        ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
        if (colWidth < 42 && scale < 1.0) {
          ctx.translate(centerX, topY - 6 / scale);
          ctx.rotate(-Math.PI / 4); // 逆时针 45 度斜排
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          const shortName = col.name.length > 12 ? col.name.substring(0, 10) + '…' : col.name;
          ctx.fillText(shortName, 0, 0);
        } else {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          const displayName = col.name.length > 12 ? col.name.substring(0, 10) + '…' : col.name;
          ctx.fillText(displayName, centerX, topY - 4 / scale);
        }
        ctx.restore();
      }
    });

    ctx.restore();
  }

  private drawPollenCurves(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    const scale = this.viewport.scale;

    this.data.columns.forEach((col) => {
      if (!col.visible || col.controlPoints.length === 0) return;

      const isActive = col.id === this.data.activeTaxaId;
      const sortedPoints = [...col.controlPoints].sort((a, b) => a.y - b.y);
      const pType = col.plotType || 'area';

      if (pType === 'bar') {
        // 柱状图 (Bars): 从 startX 向右延伸水平柱条
        ctx.fillStyle = col.color;
        ctx.strokeStyle = col.color;
        const barThickness = Math.max(1.5, 3.0 / scale);

        sortedPoints.forEach((pt) => {
          const barWidth = Math.max(0, pt.x - col.startX);
          ctx.fillRect(col.startX, pt.y - barThickness / 2, barWidth, barThickness);
        });
      } else if (pType === 'symbol') {
        // 散点符号标记图 (Presence / Symbols)
        ctx.strokeStyle = col.color;
        ctx.lineWidth = 1.5 / scale;
        const symR = 4 / scale;
        sortedPoints.forEach((pt) => {
          if (pt.x > col.startX + 0.5) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, symR, 0, Math.PI * 2);
            ctx.fillStyle = isActive ? col.color : `${col.color}88`;
            ctx.fill();
            ctx.stroke();
          }
        });
      } else {
        // 面积图 (Area) 或 纯折线图 (Line)
        if (pType === 'area') {
          const areaPath = SplineInterpolator.buildAreaPath(sortedPoints, col.startX);
          ctx.fillStyle = isActive ? `${col.color}44` : `${col.color}1a`;
          ctx.fill(areaPath);
        }

        const curvePath = SplineInterpolator.buildPath(sortedPoints);
        ctx.strokeStyle = col.color;
        ctx.lineWidth = (isActive ? 2.5 : 1.4) / scale;
        ctx.setLineDash([]);
        ctx.stroke(curvePath);
      }
    });

    ctx.restore();
  }

  private drawAnchors(ctx: CanvasRenderingContext2D): void {
    const scale = this.viewport.scale;
    const activeCol = this.getActiveColumn();
    if (!activeCol || !activeCol.visible) return;

    ctx.save();

    const dragAnchor =
      (this.toolStrategies.get('select') as SelectToolStrategy | undefined)?.getDraggingAnchor() ||
      (this.toolStrategies.get('addPoint') as AddPointToolStrategy | undefined)?.getDraggingAnchor();

    activeCol.controlPoints.forEach((pt) => {
      const isHovered = this.hoveredAnchor?.pointId === pt.id;
      const isDragging = dragAnchor?.pointId === pt.id;

      // 手柄半径屏幕恒定
      const baseRadius = pt.type === 'peak' || pt.type === 'trough' ? 6.0 : pt.type === 'manual' || pt.isManual ? 5.5 : 4.0;
      const radius = (isDragging ? baseRadius * 1.35 : isHovered ? baseRadius * 1.25 : baseRadius) / scale;

      // 悬停/拖动时光晕
      if (isHovered || isDragging) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius + 3.5 / scale, 0, Math.PI * 2);
        ctx.fillStyle = isDragging
          ? 'rgba(249, 115, 22, 0.4)'
          : 'rgba(56, 189, 248, 0.35)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);

      if (pt.type === 'peak') {
        // 一级物理极大值（峰顶）：实心金黄色
        ctx.fillStyle = isDragging ? '#f97316' : '#fbbf24';
        ctx.fill();
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.8 / scale;
        ctx.stroke();
      } else if (pt.type === 'trough') {
        // 一级物理极小值（谷底/基线）：实心琥珀色
        ctx.fillStyle = isDragging ? '#f97316' : '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = '#111827';
        ctx.lineWidth = 1.8 / scale;
        ctx.stroke();
      } else if (pt.type === 'manual' || pt.isManual) {
        // 手工强控制锚点：实心亮青色
        ctx.fillStyle = isDragging ? '#f97316' : '#38bdf8';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8 / scale;
        ctx.stroke();
      } else {
        // 二级平缓过渡点：空心白圈
        ctx.fillStyle = 'rgba(17, 24, 39, 0.75)';
        ctx.fill();
        ctx.strokeStyle = activeCol.color || '#ffffff';
        ctx.lineWidth = 1.6 / scale;
        ctx.stroke();
      }
    });

    ctx.restore();
  }

  public setWorkflowStage(stage: number): void {
    // 换步之前先把待提交的微调落库（切步后 this.data 会被刷新覆盖）。
    if (this.workflowStage !== stage) void this.flushPendingGeometryEdits();
    const stageChanged = this.workflowStage !== stage;
    this.workflowStage = stage;
    this.updateEmptyStateVisibility();
    this.updateFloatingToolbarForStage(stage);
    // 进入某一步时激活该步的默认主画布工具（`getAllowedTools` 的首位，
    // 与旧的 LOAD→pan / ROI→roi / Y_CALIB→ycalib 三个特例逐一对应）。
    //
    // 两个约束，缺一个就会退回历史投诉的样子：
    // ① 必须走 `setToolMode()`，不能直接 `toolModeManager.setMode()`——后者只改内部
    //    状态，跳过 active-mode 高亮与页脚「模式:」的同步，于是工具条高亮/页脚卡在
    //    上一个工具上（"工具条缺了微调(S)"、"模式不对"的真身之一）。
    // ② 只在**真的换了步**时才重置。`updateWorkflowBar()` 会被数据刷新反复调用，
    //    无条件重置会在用户干活时把工具抢走。
    const allowed = this.getAllowedTools(stage);
    if (stageChanged || !allowed.includes(this.toolModeManager.getMode())) {
      this.setToolMode(allowed[0] || 'pan');
    } else {
      // 模式不用切，但展示仍要重刷：浮动条与页脚的初值都是写死的 HTML，
      // 冷启动时当前工具恰好等于该步默认工具，就会「高亮在 A、页脚写 B」。
      this.syncToolModeUi(this.toolModeManager.getMode());
    }
    this.updateCursor();
    this.requestRender();
  }

  /**
   * 重置全部 (Reset All)：清空当前图谱上的全部操作 —— 分列、控制点、刻度钉、
   * 取数区域、Y 轴标定与线掩膜修正，仅保留底图本身，使用户可从 S1 重新开始。
   * 注意：本方法只复位"数据内容"，不卸载底图，可被「重置」按钮与新建项目流程复用。
   */
  public resetAllOperations(): void {
    const w = this.data.imageWidth || 1600;
    const h = this.data.imageHeight || 1000;

    // 1. 清空全部属种列、控制点与选中态
    this.data.columns = [];
    this.data.activeTaxaId = '';
    this.data.selectedEntity = null;

    // 2. 取数区域回到几何建议值；Y 轴标定如实清空为"未标定"。
    //    旧实现顺手写死 depthTopValue=0/depthBottomValue=100 并置 isCalibrated=true，
    //    等于凭空声明了一把并不存在的深度尺。
    this.data.roi = {
      xMin: Math.round(w * 0.12),
      xMax: Math.round(w * 0.94),
      yMin: Math.round(h * 0.18),
      yMax: Math.round(h * 0.88),
    };
    this.data.calibration = {
      isCalibrated: false,
      top_px: null,
      top_cm: null,
      bottom_px: null,
      bottom_cm: null,
      unit: 'cm',
      depthInterval: 2,
      depthGridEnabled: true,
    };
    this.data.line_strokes = [];

    // 3. 复位所有悬停 / 拖拽 / 平移交互状态，防止残留手势锁死
    this.hoveredAnchor = null;
    this.hoveredBoundary = null;
    this.hoveredRoiHandle = null;
    this.hoveredDepthHorizon = null;
    this.isHoveringDepthRulerBadge = false;
    this.isPanning = false;
    this.isMouseDown = false;
    this.yCalibMarks = [];

    // 4. 视图滤镜回归原图，工具模式回归微调 (S)
    this.viewport.imageMode = 'normal';
    this.viewport.showBinaryOverlay = false;
    this.setLineOverlay(null);
    this.setToolMode('select');

    // 5. 清空撤销历史栈（基线同步记录 ROI 与空标定），回到 S1 并重新居中
    this.history.reset([], '', this.data.calibration, this.data.roi);
    this.workflowStage = STAGE.LOAD;
    this.updateEmptyStateVisibility();
    this.updateFloatingToolbarForStage(STAGE.LOAD);
    this.updateCursor();
    this.fitToScreen();
    this.requestRender();

    this.callbacks.onFilterChange?.(this.viewport.imageMode, this.viewport.showBinaryOverlay);
    this.callbacks.onTaxaChange?.('');
    this.callbacks.onDataChange?.();
  }

  /**
   * 工作流阶段 → 允许激活的工具集（唯一事实源 / Single Source of Truth）。
   * 浮动工具条置灰、键盘模式切换守卫、鼠标编辑路径三处必须全部走本表，禁止各写一份。
   *
   *   S0–S1 加载   ：仅平移（截图与检查图谱形态）
   *   S2    ROI    ：框选数据有效区 + 线掩膜人工修正
   *   S3–S4 分列/标尺：可重新调整 ROI、加列、删列、选择、平移、线掩膜修正；S4 起可做 Y 轴标定
   *   S5–S7 拐点及以后：开放全部编辑能力（含加点）
   */
  /**
   * 8 步工作流阶段门禁：
   *   Step 1    载入：仅平移
   *   Step 2    ROI ：框选数据有效区 + 平移
   *   Step 3    Y标定：Y轴两点标定 + 平移
   *   Step 4    清理：选择/微调候选几何 + 线掩膜修正 + 平移
   *   Step 5    分列：加列、删列、选择、平移
   *   Step 6    标定列：选择、加列、删列、平移
   *   Step 7-8  拐点与采样/校验：开放全部编辑能力（加点等）
   */
  public getAllowedTools(stage: number = this.workflowStage): ToolMode[] {
    if (stage <= STAGE.LOAD) return ['pan'];
    if (stage === STAGE.ROI) return ['roi', 'pan'];
    if (stage === STAGE.Y_CALIB) return ['ycalib', 'pan'];
    // 步骤 4 必须同时给出「微调/选择 (S)」：候选几何要在画布上点选、整体拖动、
    // 拖端点改范围，全靠 select 模式；只给 linefix 会表现为「工具栏缺了微调(S)」。
    // select 放首位 = 进入步骤 4 的默认工具；画笔(修线 K)是局部修补的备用工具，
    // 不该抢默认。新建几何走 drawLineH/drawLineV，由侧栏按钮触发，不占按钮位。
    if (stage === STAGE.CLEANUP) return ['select', 'measure', 'linefix', 'pan'];
    if (stage === STAGE.SPLIT) return ['addCol', 'eraser', 'select', 'pan'];
    if (stage === STAGE.CALIBRATE_COLUMNS) return ['select', 'addCol', 'eraser', 'pan'];
    return ['select', 'addPoint', 'eraser', 'pan'];
  }

  /** 当前阶段是否允许该工具 */
  public isToolAllowed(mode: ToolMode, stage: number = this.workflowStage): boolean {
    return this.getAllowedTools(stage).includes(mode);
  }

  /** 各工具被阶段门禁拦下时的提示文案 */
  private static readonly TOOL_STAGE_HINT: Partial<Record<ToolMode, string>> = {
    roi: '提示: ROI 框选在步骤 2 (ROI) 启用',
    addCol: '提示: 添加属种列在步骤 5 (分列) 启用',
    addPoint: '提示: 控制点编辑在步骤 7 (拐点与采样) 启用',
    eraser: '提示: 删除操作在步骤 5 起启用',
    ycalib: '提示: Y 轴两点标定在步骤 3 (Y标定) 启用',
    linefix: '提示: 线掩膜人工修正在步骤 4 (清理) 启用',
  };

  /** 统一门禁：不允许时给出阶段提示并返回 false，允许时返回 true */
  private guardTool(mode: ToolMode): boolean {
    if (this.isToolAllowed(mode)) return true;
    const hint = GeologyCanvas.TOOL_STAGE_HINT[mode];
    if (hint) this.notifyNotice(hint);
    return false;
  }

  private updateFloatingToolbarForStage(stage: number): void {
    if (!this.floatingToolbar) return;
    const allowed = this.getAllowedTools(stage);
    this.floatingToolbar.querySelectorAll('[data-fmode]').forEach((btn) => {
      const mode = btn.getAttribute('data-fmode') as ToolMode;
      const btnEl = btn as HTMLButtonElement;
      const isAllowed = allowed.includes(mode);
      // 严格遵循设计稿 §7：浮动工具条只显示当前步骤可用的工具，不把无关按钮长期置灰
      btnEl.style.display = isAllowed ? '' : 'none';
      btnEl.style.opacity = '1';
      btnEl.style.pointerEvents = 'auto';
    });
  }

  private drawGhostingOverlay(ctx: CanvasRenderingContext2D): void {
    if (!this.viewport.showGhosting) return;
    const scale = this.viewport.scale;
    ctx.save();

    this.data.columns.forEach((col) => {
      if (!col.visible || col.controlPoints.length === 0) return;
      const sorted = [...col.controlPoints].sort((a, b) => a.y - b.y);
      const pType = col.plotType || 'area';

      if (pType === 'area') {
        const areaPath = SplineInterpolator.buildAreaPath(sorted, col.startX, col.curveType);
        ctx.fillStyle = tokens.color.ghost.overlayFill;
        ctx.fill(areaPath);

        const curvePath = SplineInterpolator.buildPath(sorted, col.curveType);
        ctx.strokeStyle = tokens.color.ghost.overlayStroke;
        ctx.lineWidth = 1.6 / scale;
        ctx.setLineDash([4 / scale, 3 / scale]);
        ctx.stroke(curvePath);
      }
    });

    ctx.restore();
  }

  /** 修正笔刷模式：erase = 擦掉误标，restore = 补回漏标。 */
  public setLineFixMode(mode: 'erase' | 'restore'): void {
    this.lineFixMode = mode;
    this.requestRender();
  }

  // ===================== Step 4：geometry 画布编辑 =====================

  /** 当前选中的 geometry id（未选中为 null）。 */
  public getSelectedGeometryId(): string | null {
    return this.selectedGeometryId;
  }

  /** 选中/取消选中一条 geometry；选中态由叠加层画成白色描边 + 端点手柄。 */
  public setSelectedGeometryId(id: string | null): void {
    if (this.selectedGeometryId === id) return;
    this.selectedGeometryId = id;
    // 叠加层通过 data 读取选中态（纯前端交互状态，不属于后端契约）。
    this.data.cleanup_selected_id = id;
    this.requestRender();
    this.callbacks.onGeometrySelected?.(id);
  }

  /**
   * 删除当前选中的 Step 4 geometry（Delete/Backspace 与步骤 4 的 D 键共用）。
   *
   * 顺序很关键：先 `setSelectedGeometryId(null)` 再回调删除。前者会立刻通知
   * 侧栏重绘取消高亮，后者异步刷新清单把那一行移除；反过来的话，删完几何后
   * 侧栏那一行还会亮着（选中 id 指向一个已不存在的几何）。
   */
  private async deleteSelectedGeometry(): Promise<void> {
    const id = this.selectedGeometryId;
    if (!id) return;
    // 必须先 await 微调落库再删：同步发起的话两个 RPC 同时在途，删除可能先落地，
    // 随后到达的 upsert 会把这条几何重新写回来。
    await this.flushPendingGeometryEdits();
    this.setSelectedGeometryId(null);
    this.callbacks.onGeometryDelete?.(id);
    this.requestRender();
  }

  /** 当前是否处于"拖拽新建 geometry"模式。 */
  public getGeometryCreateAxis(): 'h' | 'v' | null {
    const mode = this.toolModeManager.getMode();
    if (mode === 'drawLineH') return 'h';
    if (mode === 'drawLineV') return 'v';
    return null;
  }

  /** 命中测试：返回鼠标下的 geometry id 与抓取的手柄。 */
  private findHitGeometry(
    worldPt: Point2D
  ): { id: string; handle: 'move' | 'start' | 'end' | 'thick0' | 'thick1' } | null {
    const inv = 1 / (this.viewport.scale || 1);
    const pad = this.GEOMETRY_HIT_PAD_SCREEN * inv;
    const handleR = (this.GEOMETRY_HANDLE_SIZE_SCREEN * inv) / 2 + 2 * inv;
    const cands = this.data.line_candidates || [];

    // 从后往前：后加入的 geometry 视觉上在上层，应优先命中。
    for (let i = cands.length - 1; i >= 0; i--) {
      const c = cands[i];
      const g = c.geometry;
      if (!g) continue;
      const x0 = Math.min(g.x0, g.x1);
      const x1 = Math.max(g.x0, g.x1);
      const y0 = Math.min(g.y0, g.y1);
      const y1 = Math.max(g.y0, g.y1);
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;

      // 已选中的 geometry 先判手柄，否则细线端点永远抓不住。
      if (c.id === this.selectedGeometryId) {
        // 手柄必须落在 CleanupOverlay 实际画出来的位置：薄线真实只有 2px、
        // 显示被撑到 8px，若按真实矩形做命中就会"看着抓到、实际抓空"。
        const band = bandOf(g, inv);
        const bMidX = band.x + band.w / 2;
        const bMidY = band.y + band.h / 2;
        const handles: Array<['start' | 'end' | 'thick0' | 'thick1', Point2D]> =
          c.axis === 'h'
            ? [
                // 端点：改长度
                ['start', { x: x0, y: midY }],
                ['end', { x: x1, y: midY }],
                // 长边中点：改厚度
                ['thick0', { x: bMidX, y: band.y }],
                ['thick1', { x: bMidX, y: band.y + band.h }],
              ]
            : [
                ['start', { x: midX, y: y0 }],
                ['end', { x: midX, y: y1 }],
                ['thick0', { x: band.x, y: bMidY }],
                ['thick1', { x: band.x + band.w, y: bMidY }],
              ];
        for (const [key, pt] of handles) {
          if (Math.hypot(worldPt.x - pt.x, worldPt.y - pt.y) <= handleR) {
            return { id: c.id, handle: key };
          }
        }
      }

      if (
        worldPt.x >= x0 - pad &&
        worldPt.x <= x1 + pad &&
        worldPt.y >= y0 - pad &&
        worldPt.y <= y1 + pad
      ) {
        return { id: c.id, handle: 'move' };
      }
    }
    return null;
  }

  /** 拖拽新建 geometry 时的实时预览（世界坐标，跟随鼠标）。 */
  /** 提交一条 geometry 变更给后端（松手时调用，避免拖拽期间刷屏 RPC）。 */
  private commitGeometry(
    id: string | null,
    axis: 'h' | 'v',
    rect: { x0: number; y0: number; x1: number; y1: number }
  ): void {
    this.callbacks.onGeometryCommit?.(id, axis, rect);
  }
}
