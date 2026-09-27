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
import { tokens } from '../styles/tokens';
import { getAllOverlays } from './canvas/_registry';
import {
  AddPointCommand,
  DeletePointCommand,
} from '../core/Commands';
import { t, onLocaleChange } from '../i18n';

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

  // 拖拽前状态备份（用于松手时提交单条不可逆原子 Command）
  private dragInitialPointPos: Point2D | null = null;
  private dragInitialColumn: { startX: number; endX: number; tickEndX: number } | null = null;
  /** ROI 拖拽起点快照。只保存 ROI —— 取数区域与深度标定互不相关。 */
  private dragInitialRoi: DataRoi | null = null;

  // 拖动与悬停状态
  private hoveredAnchor: { taxaId: string; pointId: string } | null = null;
  private draggingAnchor: { taxaId: string; pointId: string } | null = null;
  private hoveredBoundary: { taxaId: string; type: 'start' | 'tick' | 'end'; x: number } | null = null;
  private draggingBoundary: { taxaId: string; type: 'start' | 'tick' | 'end' } | null = null;
  private hoveredRoiHandle: string | null = null; // 'tl','tr','bl','br','t','b','l','r'
  private draggingRoiHandle: string | null = null;
  private hoveredDepthHorizon: number | null = null;
  private isHoveringDepthRulerBadge: boolean = false;

  // Y 轴两点标定：用户在图上点选的参考点（最多两个）
  private yCalibMarks: Point2D[] = [];
  private hoverWorldPt: Point2D | null = null;
  // 线掩膜人工修正：当前笔刷模式与正在绘制的笔迹
  public lineFixMode: 'erase' | 'restore' = 'erase';
  private lineFixPoints: Point2D[] | null = null;

  // 点击添加锚点防误抖标识
  private hasDraggedAnchor: boolean = false;
  private renderPending: boolean = false;

  // 屏幕恒定像素常量
  private readonly ANCHOR_HIT_RADIUS_SCREEN = 8.0;
  private readonly BOUNDARY_HIT_WIDTH_SCREEN = 6.0;
  private readonly ROI_HANDLE_SIZE_SCREEN = 8.0;
  private readonly YCALIB_MARKER_RADIUS_SCREEN = 7.0;
  private readonly LINEFIX_BRUSH_RADIUS_SCREEN = 7.0;

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
    this.toolModeManager.setMode(mode);
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
    const isEmpty = !this.data.imageSrc || this.workflowStage === 0;
    this.emptyStateOverlay.style.display = isEmpty ? 'flex' : 'none';
  }

  public loadNewDiagram(newData: DiagramData): void {
    this.data = newData;
    this.loadImage(newData.imageSrc);
    if (this.callbacks.onDataChange) {
      this.callbacks.onDataChange();
    }
    if (this.callbacks.onTaxaChange) {
      this.callbacks.onTaxaChange(newData.activeTaxaId);
    }
  }

  public loadImage(src: string): void {
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
    };

    this.diagramImage.onerror = () => {
      console.warn('Failed to load image from', src, 'using procedural canvas');
      this.isImageLoaded = true;
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

        // 自动扩展取数区域以容纳新列；只动 ROI，绝不改深度标定
        if (newEndX > this.data.roi.xMax) {
          this.data.roi.xMax = newEndX + 30;
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
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverWorldPt = null;
      if (this.toolModeManager.getMode() === 'ycalib') {
        this.requestRender();
      }
    });
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
      if (this.data.selectedEntity) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let dx = 0;
        let dy = 0;
        if (e.code === 'ArrowLeft') dx = -step;
        if (e.code === 'ArrowRight') dx = step;
        if (e.code === 'ArrowUp') dy = -step;
        if (e.code === 'ArrowDown') dy = step;
        this.nudgeSelectedEntity(dx, dy);
        return;
      }
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
      // D: 删除控制点模式 (Delete Point)
      if (e.code === 'KeyD') {
        e.preventDefault();
        if (!this.guardTool('eraser')) return;
        this.setToolMode('eraser');
        this.notifyNotice('切换工具: 删除控制点 (D) - 点击左键删除锚点或列');
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

  private onMouseDown(e: MouseEvent): void {
    const screenPt = this.getCanvasPoint(e);
    this.lastMouseScreen = screenPt;
    this.isMouseDown = true;
    this.hasDraggedAnchor = false;

    const mode = this.toolModeManager.getMode();

    // 鼠标右键 (2)、鼠标中键 (1)、空格键按住、或处于 pan 抓手模式：一律进入视口平移
    if (e.button === 2 || e.button === 1 || (e.button === 0 && (this.isSpaceDown || mode === 'pan'))) {
      this.isPanning = true;
      this.updateCursor();
      return;
    }

    if (e.button === 0) {
      const worldPt = this.viewport.screenToWorld(screenPt);
      const cal = this.data.calibration;

      // ================= 1. 橡皮擦删除模式 (Eraser) =================
      if (mode === 'eraser') {
        const hitAnchor = this.findHitAnchor(screenPt);
        if (hitAnchor) {
          const col = this.data.columns.find((c) => c.id === hitAnchor.taxaId);
          if (col) {
            const pt = col.controlPoints.find((p) => p.id === hitAnchor.pointId);
            if (pt) {
              const cmd = new DeletePointCommand(col.id, pt, col.name);
              this.history.push(`Delete Anchor from ${col.name}`, this.data.columns, this.data.activeTaxaId);
              cmd.execute(this.data);
              this.hoveredAnchor = null;
              this.notifyNotice(`已删除 ${col.name} 在深度层位 Y:${pt.y} 处的拐点`);
              this.requestRender();
              this.callbacks.onDataChange?.();
            }
          }
          return;
        }

        const hitBoundary = this.findHitBoundary(screenPt);
        if (hitBoundary) {
          const colIdx = this.data.columns.findIndex((c) => c.id === hitBoundary.taxaId);
          if (colIdx !== -1 && this.data.columns.length > 1) {
            const deleted = this.data.columns.splice(colIdx, 1)[0];
            this.history.push(`Delete Column ${deleted.name}`, this.data.columns, this.data.activeTaxaId);
            this.notifyNotice(`已删除属种列: ${deleted.name}`);
            this.hoveredBoundary = null;
            this.requestRender();
            this.callbacks.onDataChange?.();
          }
          return;
        }
        return;
      }

      // ================= 2. 添加分列线模式 (Add Column) =================
      if (mode === 'addCol') {
        const newX = Math.round(worldPt.x);
        const colWidth = 80;
        const colNum = String(this.data.columns.length + 1).padStart(2, '0');
        const newCol: TaxaColumn = {
          id: `taxa_${Date.now()}`,
          name: `col${colNum}`,
          species: `col${colNum}`,
          color: '#38bdf8',
          startX: newX,
          endX: newX + colWidth,
          tickEndX: newX + colWidth,
          maxPercent: 50,
          unit: '%',
          curveType: 'linear',
          visible: true,
          isLocked: true,
          controlPoints: [
            { id: `pt_${Date.now()}_top`, x: newX + 5, y: this.data.roi.yMin, type: 'manual', createdAt: Date.now() },
            { id: `pt_${Date.now()}_bot`, x: newX + 5, y: this.data.roi.yMax, type: 'manual', createdAt: Date.now() + 1 },
          ],
        };

        this.data.columns.push(newCol);
        this.data.columns.sort((a, b) => a.startX - b.startX);
        this.data.activeTaxaId = newCol.id;
        this.history.push(`Add Column ${newCol.name}`, this.data.columns, this.data.activeTaxaId);
        this.notifyNotice(`已在 X:${newX}px 处插入新属种分列！`);
        this.setToolMode('select'); // 自动切回选择模式便于立即微调
        this.requestRender();
        this.callbacks.onDataChange?.();
        this.callbacks.onTaxaChange?.(newCol.id);
        return;
      }

      // ================= 2.5 Y 轴两点标定 (Calibrate) =================
      // 在 Step 3 或 ycalib 模式下，左键点击画布直接拾取 Y1 / Y2 标定点并绘制圆点标记
      if (mode === 'ycalib' || this.workflowStage === 3) {
        const markY = Math.round(worldPt.y);
        // 若已选满 2 个点，第 3 次点击自动重置并作为新的第 1 个点 Y1
        if (this.yCalibMarks.length >= 2) {
          this.yCalibMarks = [];
        }
        if (this.yCalibMarks.some((m) => m.y === markY)) {
          this.notifyNotice('两点标定需要两个不同的像素行，请再点另一行。');
          return;
        }
        this.yCalibMarks.push({ x: Math.round(worldPt.x), y: markY });
        this.requestRender();
        if (this.yCalibMarks.length === 2) {
          const picked = [...this.yCalibMarks].sort((a, b) => a.y - b.y);
          this.yCalibMarks = picked;
          this.callbacks.onYCalibPicked?.(picked);
        } else {
          this.callbacks.onYCalibPicked?.([...this.yCalibMarks]);
          this.notifyNotice(
            `🎯 已记录第 1 个标定点 Y1 = ${markY}px。请在 Y 轴上再点第 2 个已知刻度的位置 (Y2)。`
          );
        }
        return;
      }

      // ================= 2.6 线掩膜人工修正笔刷 (Line Fix) =================
      // 画布上直接涂抹：擦掉误标红线 / 补回漏标的线。笔迹落库为折线 + 半径，
      // 由后端栅格化后与自动掩膜合成，所以改档位或改 ROI 后修正依然有效。
      if (mode === 'linefix') {
        this.lineFixPoints = [{ x: worldPt.x, y: worldPt.y }];
        this.requestRender();
        return;
      }

      // ================= 3. ROI 区域手柄拖动模式 =================
      const hitRoi = this.findHitRoiHandle(screenPt);
      if (hitRoi || mode === 'roi') {
        if (hitRoi) {
          this.draggingRoiHandle = hitRoi;
          this.dragInitialRoi = { ...this.data.roi };
          this.updateCursor();
          return;
        }
      }

      // ================= 4. 选择与微调模式 (Select / Default) =================
      // A. 优先检查是否直接点击了某个属种列的几何范围（列内部或顶部标签区域）
      const hitCol = this.findHitColumn(worldPt);

      // B. 检查是否命中控制锚点
      const hitAnchor = this.findHitAnchor(screenPt);
      if (hitAnchor) {
        this.draggingAnchor = hitAnchor;
        this.data.activeTaxaId = hitAnchor.taxaId;
        this.data.selectedEntity = { type: 'point', colId: hitAnchor.taxaId, pointId: hitAnchor.pointId };
        const col = this.data.columns.find((c) => c.id === hitAnchor.taxaId);
        const pt = col?.controlPoints.find((p) => p.id === hitAnchor.pointId);
        if (pt) {
          this.dragInitialPointPos = { x: pt.x, y: pt.y };
        }
        if (this.callbacks.onTaxaChange) {
          this.callbacks.onTaxaChange(hitAnchor.taxaId);
        }
        this.updateCursor();
        this.requestRender();
        return;
      }

      // C. 检查是否命中垂直分列标线 (基线/刻度终点/隔离界)
      const hitBoundary = this.findHitBoundary(screenPt);
      if (hitBoundary) {
        this.draggingBoundary = {
          taxaId: hitBoundary.taxaId,
          type: hitBoundary.type,
        };
        this.data.activeTaxaId = hitBoundary.taxaId;
        this.data.selectedEntity = { type: 'column', id: hitBoundary.taxaId, part: hitBoundary.type };
        const col = this.data.columns.find((c) => c.id === hitBoundary.taxaId);
        if (col) {
          this.dragInitialColumn = { startX: col.startX, endX: col.endX, tickEndX: col.tickEndX ?? col.endX };
        }
        if (this.callbacks.onTaxaChange) {
          this.callbacks.onTaxaChange(hitBoundary.taxaId);
        }
        this.updateCursor();
        return;
      }

      // D. 如果点击了某列的区域，且当前激活列不是它，则直接在图上选中该列！
      if (hitCol && hitCol.id !== this.data.activeTaxaId) {
        this.data.activeTaxaId = hitCol.id;
        this.data.selectedEntity = { type: 'column', id: hitCol.id };
        this.notifyNotice(`已选中属种列: ${hitCol.name} (可直接在图上拉点修改)`);
        if (this.callbacks.onTaxaChange) {
          this.callbacks.onTaxaChange(hitCol.id);
        }
        this.requestRender();
        return;
      }

      // ================= 5. 添加拐点模式 (Add Point) 或在已激活属种列内点击拉伸 =================
      // 关键门禁：select 模式下点击画布会隐式加锚点，必须与 A 键走同一套阶段表，
      // 否则 S3/S4 的"禁止编辑控制点"门禁可被鼠标点击直接绕过。
      if (this.isToolAllowed('addPoint') && (mode === 'addPoint' || (mode === 'select' && this.isWithinDiagramBounds(worldPt)))) {
        const activeCol = this.getActiveColumn();
        if (activeCol && this.isWithinDiagramBounds(worldPt)) {
          let targetY = Math.round(worldPt.y);

          // 磁力吸附到标准层位高度（仅在已完成 Y 轴标定时才有层位可言）
          const calib = CoordinateSystem.calibrationBounds(cal);
          if (this.hoveredDepthHorizon !== null && calib) {
            const depthFraction =
              (this.hoveredDepthHorizon - calib.topValue) /
              (calib.bottomValue - calib.topValue || 1);
            const horizonY = Math.round(calib.topPx + depthFraction * (calib.bottomPx - calib.topPx));
            if (Math.abs(worldPt.y - horizonY) <= 10 / this.viewport.scale) {
              targetY = horizonY;
            }
          }

          const newPoint: ControlPoint = {
            id: `pt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            x: Math.round(worldPt.x),
            y: targetY,
            type: 'manual',
            isManual: true,
            createdAt: Date.now(),
          };

          const cmd = new AddPointCommand(activeCol.id, newPoint, activeCol.name);
          this.history.push(`Add Anchor to ${activeCol.name}`, this.data.columns, this.data.activeTaxaId);
          cmd.execute(this.data);

          this.dragInitialPointPos = { x: newPoint.x, y: newPoint.y };
          this.draggingAnchor = {
            taxaId: activeCol.id,
            pointId: newPoint.id,
          };
          this.data.selectedEntity = { type: 'point', colId: activeCol.id, pointId: newPoint.id };

          this.requestRender();
          this.callbacks.onDataChange?.();
          return;
        }
      }

      // 点击空白处：取消当前选择
      this.hoveredAnchor = null;
      this.hoveredBoundary = null;
      this.hoveredRoiHandle = null;
      this.data.selectedEntity = null;
      this.updateCursor();
      this.requestRender();
      this.callbacks.onDataChange?.();
    }
  }

  private onMouseMove(e: MouseEvent): void {
    const screenPt = this.getCanvasPoint(e);
    const deltaX = screenPt.x - this.lastMouseScreen.x;
    const deltaY = screenPt.y - this.lastMouseScreen.y;
    this.lastMouseScreen = screenPt;

    const worldPt = this.viewport.screenToWorld(screenPt);
    this.hoverWorldPt = { x: worldPt.x, y: worldPt.y };
    if (this.toolModeManager.getMode() === 'ycalib') {
      this.requestRender();
    }
    const cal = this.data.calibration;
    const roi = this.data.roi;
    // 深度只在已完成两点标定时才存在；未标定就是 undefined，绝不拿 ROI 边界顶替。
    const calib = CoordinateSystem.calibrationBounds(cal);
    const interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;

    // 探测当前是否悬停在特定标准地层层位附近
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

    // 0a. 正在涂抹线掩膜修正笔迹
    if (this.lineFixPoints) {
      this.lineFixPoints.push({ x: worldPt.x, y: worldPt.y });
      this.requestRender();
      return;
    }

    // 0. 正在拖动 ROI 8 手柄微调取数区域（只影响取数范围，与深度标定无关）
    if (this.draggingRoiHandle) {
      const h = this.draggingRoiHandle;
      const x = Math.round(worldPt.x);
      const y = Math.round(worldPt.y);

      if (h.includes('l')) roi.xMin = Math.min(x, roi.xMax - 20);
      if (h.includes('r')) roi.xMax = Math.max(x, roi.xMin + 20);
      if (h.includes('t')) roi.yMin = Math.min(y, roi.yMax - 20);
      if (h.includes('b')) roi.yMax = Math.max(y, roi.yMin + 20);

      this.requestRender();
      return;
    }

    // 1. 正在平移画布
    if (this.isPanning) {
      this.viewport.panBy(deltaX, deltaY);
      this.requestRender();
      return;
    }

    // 2. 正在拖动锚点
    if (this.draggingAnchor) {
      this.hasDraggedAnchor = true;
      const col = this.data.columns.find((c) => c.id === this.draggingAnchor!.taxaId);
      if (col) {
        const pt = col.controlPoints.find((p) => p.id === this.draggingAnchor!.pointId);
        if (pt) {
          pt.x = Math.round(worldPt.x);
          pt.y = Math.round(worldPt.y);
          pt.isManual = true;
          col.controlPoints.sort((a, b) => a.y - b.y);
          this.requestRender();
        }
      }
      return;
    }

    // 3. 正在拖动垂直分列标线或两点式刻度钉
    if (this.draggingBoundary) {
      const { taxaId, type } = this.draggingBoundary;
      const colIndex = this.data.columns.findIndex((c) => c.id === taxaId);
      if (colIndex !== -1) {
        const targetCol = this.data.columns[colIndex];
        const newX = Math.round(worldPt.x);

        if (type === 'start') {
          targetCol.startX = newX;
          if (targetCol.scaleCalib) {
            targetCol.scaleCalib.originX = newX;
          }
          if (colIndex > 0) {
            this.data.columns[colIndex - 1].endX = newX;
          }
        } else if (type === 'tick') {
          // 拖拽物理刻度齿手柄
          targetCol.tickEndX = newX;
          if (targetCol.scaleCalib) {
            targetCol.scaleCalib.calibX = newX;
          }
        } else {
          targetCol.endX = newX;
          if (colIndex < this.data.columns.length - 1) {
            const nextCol = this.data.columns[colIndex + 1];
            if (nextCol) {
              nextCol.startX = newX;
              if (nextCol.scaleCalib) {
                nextCol.scaleCalib.originX = newX;
              }
            }
          }
        }
        this.requestRender();
      }
      return;
    }

    // 4. 普通悬停探测
    const prevHoverAnchor = this.hoveredAnchor;
    const prevHoverBoundary = this.hoveredBoundary;

    this.hoveredAnchor = this.findHitAnchor(screenPt);
    this.hoveredBoundary = !this.hoveredAnchor ? this.findHitBoundary(screenPt) : null;

    if (
      prevHoverAnchor?.pointId !== this.hoveredAnchor?.pointId ||
      prevHoverBoundary?.taxaId !== this.hoveredBoundary?.taxaId ||
      prevHoverBoundary?.type !== this.hoveredBoundary?.type
    ) {
      this.updateCursor();
      this.requestRender();
    }
  }

  private onMouseUp(_e: MouseEvent): void {
    if (this.lineFixPoints && this.lineFixPoints.length > 0) {
      const stroke: LineMaskStroke = {
        id: `stroke_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        mode: this.lineFixMode,
        // 笔刷半径按屏幕恒定语义落库为图像像素，缩放时手感一致。
        radius: Math.max(2, Math.round(this.LINEFIX_BRUSH_RADIUS_SCREEN / this.viewport.scale)),
        points: this.lineFixPoints.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
      };
      this.lineFixPoints = null;
      this.callbacks.onLineFixStroke?.(stroke);
      this.requestRender();
    } else if (this.draggingRoiHandle && this.dragInitialRoi) {
      const roi = this.data.roi;
      this.history.push(
        'Resize Data ROI',
        this.data.columns,
        this.data.activeTaxaId,
        this.data.calibration,
        roi
      );
      this.notifyNotice(
        `数据有效区已调整为: X [${roi.xMin}, ${roi.xMax}] × Y [${roi.yMin}, ${roi.yMax}] px（深度标定不受影响）`
      );
      // 去线掩膜在 ROI 内计算，范围变了必须让后端重算。
      this.callbacks.onRoiCommitted?.({ ...roi });
      this.callbacks.onDataChange?.();
    } else if (this.draggingAnchor && this.hasDraggedAnchor && this.dragInitialPointPos) {
      const col = this.data.columns.find((c) => c.id === this.draggingAnchor!.taxaId);
      const pt = col?.controlPoints.find((p) => p.id === this.draggingAnchor!.pointId);
      if (col && pt) {
        this.history.push(`Move Anchor in ${col.name}`, this.data.columns, this.data.activeTaxaId);
        this.callbacks.onDataChange?.();
      }
    } else if (this.draggingBoundary && this.dragInitialColumn) {
      const col = this.data.columns.find((c) => c.id === this.draggingBoundary!.taxaId);
      if (col) {
        this.history.push(`Adjust Column Boundary ${col.name}`, this.data.columns, this.data.activeTaxaId);
        this.callbacks.onDataChange?.();
      }
    }

    this.isMouseDown = false;
    this.isPanning = false;
    this.draggingAnchor = null;
    this.draggingBoundary = null;
    this.draggingRoiHandle = null;
    this.dragInitialPointPos = null;
    this.dragInitialColumn = null;
    this.dragInitialRoi = null;
    this.lineFixPoints = null;
    this.hasDraggedAnchor = false;
    this.updateCursor();
    this.requestRender();
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
    } else if (this.draggingRoiHandle || this.hoveredRoiHandle) {
      const h = this.draggingRoiHandle || this.hoveredRoiHandle;
      if (h === 'tl' || h === 'br') this.canvas.style.cursor = 'nwse-resize';
      else if (h === 'tr' || h === 'bl') this.canvas.style.cursor = 'nesw-resize';
      else if (h === 't' || h === 'b') this.canvas.style.cursor = 'ns-resize';
      else if (h === 'l' || h === 'r') this.canvas.style.cursor = 'ew-resize';
    } else if (this.draggingAnchor || this.hoveredAnchor) {
      this.canvas.style.cursor = 'move';
    } else if (this.draggingBoundary || this.hoveredBoundary) {
      this.canvas.style.cursor = 'col-resize';
    } else {
      const mode = this.toolModeManager.getMode();
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

  private findHitRoiHandle(screenPt: Point2D): string | null {
    if (this.workflowStage < 2) return null;
    const roi = this.data.roi;
    const tlScreen = this.viewport.worldToScreen({ x: roi.xMin, y: roi.yMin });
    const brScreen = this.viewport.worldToScreen({ x: roi.xMax, y: roi.yMax });
    const midX = (tlScreen.x + brScreen.x) / 2;
    const midY = (tlScreen.y + brScreen.y) / 2;

    const handles: Record<string, Point2D> = {
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
    for (const [key, pt] of Object.entries(handles)) {
      if (Math.hypot(screenPt.x - pt.x, screenPt.y - pt.y) <= hitDist) {
        return key;
      }
    }
    return null;
  }

  // ===================== 核心高保真渲染管线 =====================

  public render(): void {
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

    // 2. 地层深度标尺网格系统 (S4 标尺标定及之后阶段呈现；未标定则不画)
    if (this.workflowStage >= 4) {
      this.drawDepthGrid(ctx, isLight);
    }

    // 3. 取数区域矩形与控制手柄 (ROI) (严格从 S2 ROI 阶段起呈现，S0/S1 绝不呈现)
    if (this.workflowStage >= 2) {
      this.drawRoiOverlay(ctx, isLight);
    }

    // 3.1 Y 轴两点标定记号与标定跨度指示 (S4 起呈现)
    if (this.workflowStage >= 4) {
      this.drawYAxisCalibration(ctx);
    }

    // 3.2 线掩膜人工修正笔迹预览 (涂抹中显示)
    if (this.lineFixPoints && this.lineFixPoints.length > 0) {
      this.drawLineFixStroke(ctx);
    }

    // 4. 各属种垂直分界标线与两点式物理刻度钉 (严格从 S3 分列阶段起才开始呈现，S1/S2 绝不呈现)
    if (this.workflowStage >= 3 && this.data.columns.length > 0) {
      this.drawColumnBoundaries(ctx, isLight);
    }

    // 5. 花粉轮廓面积图与曲线 (严格从 S5 拐点提取与数字化阶段起呈现，S1~S4 绝不呈现)
    if (this.workflowStage >= 5 && this.data.columns.length > 0) {
      this.drawPollenCurves(ctx);
      // 6. 控制锚点渲染
      this.drawAnchors(ctx);
      // 7. 原位半透明逆向重绘绿色质检比对层 (Visual Ghosting Layer)
      this.drawGhostingOverlay(ctx);
    }

    // 7.1 自动收集并调用注册叠加层 (W3 叠加层扩展点)
    try {
      const overlays = getAllOverlays();
      for (const ov of overlays) {
        ov.draw(ctx, this.data, this.viewport);
      }
    } catch {
      // 容错防止叠加层中断主渲染
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
    if (this.diagramImage && this.isImageLoaded) {
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
    } else {
      ctx.save();
      ctx.fillStyle = isLight ? '#f8fafc' : '#1e293b';
      ctx.fillRect(0, 0, this.data.imageWidth || 1600, this.data.imageHeight || 1000);
      ctx.fillStyle = isLight ? '#64748b' : '#94a3b8';
      ctx.font = '24px sans-serif';
      ctx.fillText('正在载入地质图谱...', 400, 400);
      ctx.restore();
    }
  }

  /**
   * 绘制地层深度标尺网格系统 (Depth Grid Ruler)。
   *
   * 未完成两点标定时整段不画：没有标定就没有"深度"这回事，画一组 0/50/100
   * 的假刻度会让人以为深度轴已经生效（旧实现正是拿 ROI 边界冒充刻度）。
   */
  private drawDepthGrid(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    const cal = this.data.calibration;
    const roi = this.data.roi;
    const bounds = CoordinateSystem.calibrationBounds(cal);
    if (!bounds || cal.depthGridEnabled === false) return;

    // 网格线仅在 Step 7（采样层位）或 Step 3（物理标定）等需要时显示，
    // Step 4 (干扰清理) 和 Step 5 (自动分列) 默认不绘制网格线，彻底消除抹黑图谱的灾难
    if (this.workflowStage === 4 || this.workflowStage === 5) {
      return;
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
    if (depths.length === 0) return;

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
    for (const [key, pt] of Object.entries(handles)) {
      const isHovered = this.hoveredRoiHandle === key || this.draggingRoiHandle === key;
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

  /**
   * 绘制 Y 轴两点标定：清晰呈现 Y1 / Y2 两个标定锚点、左侧刻度引线与实时选点准星预览。
   * 严格限制在左侧 Y 轴刻度区域，绝不生成横穿全图数据区的遮罩或干扰线。
   */
  private drawYAxisCalibration(ctx: CanvasRenderingContext2D): void {
    const cal = this.data.calibration;
    const roi = this.data.roi;
    const scale = this.viewport.scale;
    const marks = this.yCalibMarks;
    const isYCalibMode = this.toolModeManager.getMode() === 'ycalib';

    const defaultRailX = Math.max(20 / scale, roi.xMin - 24 / scale);

    // 汇总当前已选或已填入的 Y1、Y2 点位（无论来自画布点击还是侧边栏输入）
    interface CalibPointItem {
      tag: 'Y1' | 'Y2';
      x: number;
      y: number;
      val: number | null | undefined;
      color: string;
    }
    const items: CalibPointItem[] = [];

    const y1Px = marks[0]?.y ?? (cal.top_px !== null && cal.top_px !== undefined ? Number(cal.top_px) : null);
    const y1X = marks[0]?.x ?? defaultRailX;
    if (y1Px !== null && !Number.isNaN(y1Px)) {
      items.push({
        tag: 'Y1',
        x: y1X,
        y: y1Px,
        val: cal.top_cm,
        color: '#f59e0b', // 醒目琥珀橙
      });
    }

    const y2Px = marks[1]?.y ?? (cal.bottom_px !== null && cal.bottom_px !== undefined ? Number(cal.bottom_px) : null);
    const y2X = marks[1]?.x ?? defaultRailX;
    if (y2Px !== null && !Number.isNaN(y2Px)) {
      items.push({
        tag: 'Y2',
        x: y2X,
        y: y2Px,
        val: cal.bottom_cm,
        color: '#10b981', // 醒目翠绿
      });
    }

    if (items.length === 0 && (!isYCalibMode || !this.hoverWorldPt)) return;

    ctx.save();

    const fontPx = Math.max(10, 11.5 / scale);
    ctx.font = `bold ${fontPx}px 'JetBrains Mono', monospace`;

    const drawPill = (
      text: string,
      anchorX: number,
      centerY: number,
      borderColor: string,
      textColor: string,
      alignLeft: boolean = true
    ) => {
      const padX = 6 / scale;
      const padY = 3.5 / scale;
      const textW = ctx.measureText(text).width;
      const boxW = textW + padX * 2;
      const boxH = fontPx + padY * 2;
      const boxX = alignLeft ? anchorX : anchorX - boxW;
      const boxY = centerY - boxH / 2;
      const radius = 4 / scale;

      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, radius);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fill();
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = borderColor;
      ctx.stroke();

      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, boxX + padX, centerY);
    };

    // 1. 绘制鼠标悬停时的实时选点准星预览（仅在 ycalib 模式下）
    if (isYCalibMode && this.hoverWorldPt) {
      const hy = Math.round(this.hoverWorldPt.y);
      const hx = Math.round(this.hoverWorldPt.x);
      const nextTag = items.length === 1 ? 'Y2' : 'Y1';
      const previewColor = nextTag === 'Y1' ? '#f59e0b' : '#10b981';

      // 左侧轨道准星短线（限制在点击点与 roi.xMin 之间，不侵入右侧数据列）
      const lineLeft = Math.min(hx, Math.max(0, roi.xMin - 45 / scale));
      const lineRight = Math.min(Math.max(hx, roi.xMin), roi.xMin);

      ctx.save();
      ctx.setLineDash([4 / scale, 3 / scale]);
      ctx.strokeStyle = previewColor;
      ctx.lineWidth = 1.5 / scale;
      ctx.beginPath();
      ctx.moveTo(lineLeft, hy);
      ctx.lineTo(lineRight, hy);
      ctx.stroke();
      ctx.restore();

      // 准星小圆圈
      const hr = 5 / scale;
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.strokeStyle = previewColor;
      ctx.lineWidth = 1.8 / scale;
      ctx.stroke();

      drawPill(
        `🎯 点击定 ${nextTag}: ${hy}px`,
        hx + 10 / scale,
        hy,
        previewColor,
        '#f8fafc',
        true
      );
    }

    // 2. 绘制已选定的 Y1 / Y2 靶心锚点、刻度短针与胶囊铭牌
    for (const item of items) {
      const { tag, x, y, val, color } = item;
      const railLeft = Math.min(x, Math.max(0, roi.xMin - 40 / scale));
      const railRight = roi.xMin;

      // (a) 水平刻度指示针（带深色衬底光晕，仅在左侧 Y 轴轨道内延伸至 roi.xMin）
      ctx.beginPath();
      ctx.moveTo(railLeft, y);
      ctx.lineTo(railRight, y);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.lineWidth = 4.0 / scale;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(railLeft, y);
      ctx.lineTo(railRight, y);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2 / scale;
      ctx.stroke();

      // (b) 高对比度双环靶心圆点
      const rOuter = (this.YCALIB_MARKER_RADIUS_SCREEN + 1.5) / scale;
      const rInner = (this.YCALIB_MARKER_RADIUS_SCREEN - 0.5) / scale;
      const rDot = 2.2 / scale;

      ctx.beginPath();
      ctx.arc(x, y, rOuter, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, rInner, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, rDot, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // (c) 胶囊文字标签（显示 Y1/Y2 像素行及已绑定的物理深度/年代值）
      const hasVal = val !== null && val !== undefined && !Number.isNaN(Number(val));
      const labelText = hasVal
        ? `${tag}: ${Math.round(y)}px → ${val} ${cal.unit || 'cm'}`
        : `${tag}: ${Math.round(y)}px`;

      // 若点击点靠左边缘太近，则胶囊向右展开，否则向左或向右避让数据区
      const badgeX = x + rOuter + 6 / scale;
      drawPill(labelText, badgeX, y, color, '#ffffff', true);
    }

    ctx.restore();
  }

  /** 涂抹中的线掩膜修正笔迹预览（青=擦除误标，红=补回漏标）。 */
  private drawLineFixStroke(ctx: CanvasRenderingContext2D): void {
    const pts = this.lineFixPoints;
    if (!pts || pts.length === 0) return;

    const scale = this.viewport.scale;
    const radius = Math.max(2, this.LINEFIX_BRUSH_RADIUS_SCREEN / scale);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.lineFixMode === 'erase' ? 'rgba(56, 189, 248, 0.85)' : 'rgba(239, 68, 68, 0.85)';
    ctx.lineWidth = radius * 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) {
      ctx.lineTo(p.x, p.y);
    }
    if (pts.length === 1) {
      ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  private drawColumnBoundaries(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    const roi = this.data.roi;
    const topY = roi.yMin - 40;
    const bottomY = roi.yMax + 30;
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

      const isOriginHovered =
        (this.hoveredBoundary?.taxaId === col.id && this.hoveredBoundary.type === 'start') ||
        (this.draggingBoundary?.taxaId === col.id && this.draggingBoundary.type === 'start');

      const isCalibHovered =
        (this.hoveredBoundary?.taxaId === col.id && this.hoveredBoundary.type === 'tick') ||
        (this.draggingBoundary?.taxaId === col.id && this.draggingBoundary.type === 'tick');

      const isEndHovered =
        (this.hoveredBoundary?.taxaId === col.id && this.hoveredBoundary.type === 'end') ||
        (this.draggingBoundary?.taxaId === col.id && this.draggingBoundary.type === 'end');

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

    activeCol.controlPoints.forEach((pt) => {
      const isHovered = this.hoveredAnchor?.pointId === pt.id;
      const isDragging = this.draggingAnchor?.pointId === pt.id;

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
    this.workflowStage = stage;
    this.updateEmptyStateVisibility();
    this.updateFloatingToolbarForStage(stage);
    // 切换步骤时自动激活该步骤对应的默认主画布工具
    if (stage === 1) {
      this.toolModeManager.setMode('pan');
    } else if (stage === 2) {
      this.toolModeManager.setMode('roi');
    } else if (stage === 3) {
      this.toolModeManager.setMode('ycalib');
    } else if (!this.isToolAllowed(this.toolModeManager.getMode(), stage)) {
      const allowed = this.getAllowedTools(stage);
      this.toolModeManager.setMode(allowed[0] || 'pan');
    }
    this.updateCursor();
    this.requestRender();
  }

  /**
   * 一键归零 (Reset All)：清空当前图谱上的全部操作 —— 分列、控制点、刻度钉、
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
    this.data.lineCorrections = [];

    // 3. 复位所有悬停 / 拖拽 / 平移交互状态，防止残留手势锁死
    this.hoveredAnchor = null;
    this.draggingAnchor = null;
    this.hoveredBoundary = null;
    this.draggingBoundary = null;
    this.hoveredRoiHandle = null;
    this.draggingRoiHandle = null;
    this.hoveredDepthHorizon = null;
    this.isHoveringDepthRulerBadge = false;
    this.isPanning = false;
    this.isMouseDown = false;
    this.hasDraggedAnchor = false;
    this.dragInitialPointPos = null;
    this.dragInitialColumn = null;
    this.dragInitialRoi = null;
    this.yCalibMarks = [];
    this.lineFixPoints = null;

    // 4. 视图滤镜回归原图，工具模式回归微调 (S)
    this.viewport.imageMode = 'normal';
    this.viewport.showBinaryOverlay = false;
    this.viewport.degridStrength = 'off';
    this.setLineOverlay(null);
    this.setToolMode('select');

    // 5. 清空撤销历史栈（基线同步记录 ROI 与空标定），回到 S1 并重新居中
    this.history.reset([], '', this.data.calibration, this.data.roi);
    this.workflowStage = 1;
    this.updateEmptyStateVisibility();
    this.updateFloatingToolbarForStage(1);
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
   *   Step 4    清理：线掩膜修正 + 平移
   *   Step 5    分列：加列、删列、选择、平移
   *   Step 6    标定列：选择、加列、删列、平移
   *   Step 7-8  拐点与采样/校验：开放全部编辑能力（加点等）
   */
  public getAllowedTools(stage: number = this.workflowStage): ToolMode[] {
    if (stage <= 1) return ['pan'];
    if (stage === 2) return ['roi', 'pan'];
    if (stage === 3) return ['ycalib', 'pan'];
    if (stage === 4) return ['linefix', 'pan'];
    if (stage === 5) return ['addCol', 'eraser', 'select', 'pan'];
    if (stage === 6) return ['select', 'addCol', 'eraser', 'pan'];
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

  /**
   * 记录去线档位。
   *
   * 掩膜本身由后端计算并下发（见 `setLineOverlay`）：前端不再自行判定"哪条是线"，
   * 否则用户按 B 看到的红标就与数字化实际剔除的像素不是同一批。
   */
  public setDegridStrength(strength: 'off' | 'weak' | 'medium' | 'strong'): void {
    this.viewport.degridStrength = strength;
    if (strength === 'off') {
      this.setLineOverlay(null);
    }
    this.render();
  }

  /** 修正笔刷模式：erase = 擦掉误标，restore = 补回漏标。 */
  public setLineFixMode(mode: 'erase' | 'restore'): void {
    this.lineFixMode = mode;
    this.requestRender();
  }
}
