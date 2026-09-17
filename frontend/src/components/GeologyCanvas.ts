import { Point2D, ControlPoint, TaxaColumn, DiagramData, DiagramCalibration, ToolMode } from '../types/pollen';
import { Viewport, ImageDisplayMode } from '../core/Viewport';
import { SplineInterpolator } from '../core/SplineInterpolator';
import { HistoryManager } from '../core/HistoryManager';
import { ToolModeManager } from '../core/ToolModeManager';
import { CoordinateSystem } from '../core/CoordinateSystem';
import { tokens } from '../styles/tokens';
import { Minimap } from './Minimap';
import {
  AddPointCommand,
  DeletePointCommand,
} from '../core/Commands';

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
}

export class GeologyCanvas {
  public canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;
  private dropOverlay: HTMLElement | null = null;
  private emptyStateOverlay: HTMLElement | null = null;
  private minimap: Minimap | null = null;
  private floatingToolbar: HTMLElement | null = null;

  public viewport: Viewport;
  public history: HistoryManager;
  public data: DiagramData;
  public toolModeManager: ToolModeManager;
  private callbacks: CanvasEventCallbacks;

  // 图像缓存与离屏二值化遮罩
  private diagramImage: HTMLImageElement | null = null;
  private isImageLoaded: boolean = false;
  private binaryMonoCanvas: HTMLCanvasElement | null = null;
  private binaryMaskCanvas: HTMLCanvasElement | null = null;

  // 交互状态追踪
  private isSpaceDown: boolean = false;
  private isMouseDown: boolean = false;
  private isPanning: boolean = false;
  private lastMouseScreen: Point2D = { x: 0, y: 0 };

  // 拖拽前状态备份（用于松手时提交单条不可逆原子 Command）
  private dragInitialPointPos: Point2D | null = null;
  private dragInitialColumn: { startX: number; endX: number; tickEndX: number } | null = null;
  private dragInitialCalibration: DiagramCalibration | null = null;

  // 拖动与悬停状态
  private hoveredAnchor: { taxaId: string; pointId: string } | null = null;
  private draggingAnchor: { taxaId: string; pointId: string } | null = null;
  private hoveredBoundary: { taxaId: string; type: 'start' | 'tick' | 'end'; x: number } | null = null;
  private draggingBoundary: { taxaId: string; type: 'start' | 'tick' | 'end' } | null = null;
  private hoveredRoiHandle: string | null = null; // 'tl','tr','bl','br','t','b','l','r'
  private draggingRoiHandle: string | null = null;
  private hoveredDepthHorizon: number | null = null;
  private isHoveringDepthRulerBadge: boolean = false;

  // 点击添加锚点防误抖标识
  private hasDraggedAnchor: boolean = false;
  private renderPending: boolean = false;

  // 屏幕恒定像素常量
  private readonly ANCHOR_HIT_RADIUS_SCREEN = 8.0;
  private readonly BOUNDARY_HIT_WIDTH_SCREEN = 6.0;
  private readonly ROI_HANDLE_SIZE_SCREEN = 8.0;

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

    this.minimap = new Minimap(this.container, {
      onNavigate: (worldX, worldY) => {
        const rect = this.canvas.getBoundingClientRect();
        this.viewport.panX = rect.width / 2 - worldX * this.viewport.scale;
        this.viewport.panY = rect.height / 2 - worldY * this.viewport.scale;
        this.requestRender();
      },
    });

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
    const palette = document.createElement('div');
    palette.className = 'floating-tool-palette';
    palette.innerHTML = `
      <button class="floating-tool-btn active-mode" data-fmode="select" title="选择与微调模式 (快捷键: V)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m3 3 7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
        </svg>
        <span>选择</span>
      </button>
      <button class="floating-tool-btn" data-fmode="pan" title="平移抓手模式 (快捷键: H 或按住空格/中键拖动)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
        <span>平移</span>
      </button>
      <button class="floating-tool-btn" data-fmode="roi" title="ROI 矩形数据区模式 (快捷键: R)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <rect width="18" height="18" x="3" y="3" rx="2" stroke-dasharray="3 3"/>
        </svg>
        <span>ROI</span>
      </button>
      <button class="floating-tool-btn" data-fmode="addCol" title="添加属种列分界线 (快捷键: A)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="2" x2="12" y2="22" stroke-dasharray="3 3"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>+列</span>
      </button>
      <button class="floating-tool-btn" data-fmode="addPoint" title="添加控制拐点 (快捷键: P)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="4" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
        </svg>
        <span>+点</span>
      </button>
      <button class="floating-tool-btn" data-fmode="eraser" title="橡皮擦删除工具 (快捷键: E)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>
        </svg>
        <span>橡皮</span>
      </button>
    `;
    this.container.appendChild(palette);
    this.floatingToolbar = palette;

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

      // 生成高保真二值化离屏缓存
      this.generateBinaryCache();

      this.minimap?.setImage(this.diagramImage, this.data.imageWidth, this.data.imageHeight);
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
   * 离屏生成纯黑白二值化图与荧光透视墨迹层
   */
  private generateBinaryCache(): void {
    if (!this.diagramImage || !this.isImageLoaded) return;

    try {
      const w = this.diagramImage.naturalWidth;
      const h = this.diagramImage.naturalHeight;
      if (w <= 0 || h <= 0) return;

      // 1. 针对超大图谱（如 20000x30000 像素），将离屏缓存限制在最高 4096 像素，避免 2.4GB+ 内存溢出
      const maxDim = 4096;
      let targetW = w;
      let targetH = h;
      if (w > maxDim || h > maxDim) {
        const ratio = maxDim / Math.max(w, h);
        targetW = Math.max(1, Math.round(w * ratio));
        targetH = Math.max(1, Math.round(h * ratio));
      }

      // 创建提取像素的临时离屏 Canvas
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = targetW;
      tempCanvas.height = targetH;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;

      tempCtx.drawImage(this.diagramImage, 0, 0, targetW, targetH);
      const imgData = tempCtx.getImageData(0, 0, targetW, targetH);
      const d = imgData.data;

      // 2. 初始化目标 Canvas (尺寸等于 targetW, targetH)
      this.binaryMonoCanvas = document.createElement('canvas');
      this.binaryMonoCanvas.width = targetW;
      this.binaryMonoCanvas.height = targetH;
      const monoCtx = this.binaryMonoCanvas.getContext('2d');

      this.binaryMaskCanvas = document.createElement('canvas');
      this.binaryMaskCanvas.width = targetW;
      this.binaryMaskCanvas.height = targetH;
      const maskCtx = this.binaryMaskCanvas.getContext('2d');

      if (!monoCtx || !maskCtx) return;

      const monoImgData = monoCtx.createImageData(targetW, targetH);
      const monoData = monoImgData.data;

      const maskImgData = maskCtx.createImageData(targetW, targetH);
      const maskData = maskImgData.data;

      const threshold = this.viewport.binaryThreshold; // 默认 138

      // 初步识别墨迹布尔矩阵
      const inkGrid = new Uint8Array(targetW * targetH);
      for (let y = 0; y < targetH; y++) {
        const rowOffset = y * targetW;
        for (let x = 0; x < targetW; x++) {
          const idx = (rowOffset + x) * 4;
          const r = d[idx];
          const g = d[idx + 1];
          const b = d[idx + 2];
          const alpha = d[idx + 3];
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          if (alpha > 40 && gray < threshold) {
            inkGrid[rowOffset + x] = 1;
          }
        }
      }

      // 根据去网格横线灵敏度 (Degrid Sensitivity) 检测水平贯穿线
      const lineGrid = new Uint8Array(targetW * targetH);
      if (this.viewport.degridStrength !== 'off') {
        const minLineLen = this.viewport.degridStrength === 'weak' ? 55 : (this.viewport.degridStrength === 'strong' ? 20 : 35);
        for (let y = 0; y < targetH; y++) {
          const rowOffset = y * targetW;
          let runStart = -1;
          for (let x = 0; x < targetW; x++) {
            if (inkGrid[rowOffset + x] === 1) {
              if (runStart === -1) runStart = x;
            } else {
              if (runStart !== -1) {
                const runLen = x - runStart;
                if (runLen >= minLineLen) {
                  for (let lx = runStart; lx < x; lx++) {
                    lineGrid[rowOffset + lx] = 1;
                  }
                }
                runStart = -1;
              }
            }
          }
          if (runStart !== -1 && (targetW - runStart) >= minLineLen) {
            for (let lx = runStart; lx < targetW; lx++) {
              lineGrid[rowOffset + lx] = 1;
            }
          }
        }
      }

      for (let y = 0; y < targetH; y++) {
        const rowOffset = y * targetW;
        for (let x = 0; x < targetW; x++) {
          const pIdx = rowOffset + x;
          const i = pIdx * 4;
          const isInk = inkGrid[pIdx] === 1;
          const isGridLine = lineGrid[pIdx] === 1;

          if (isGridLine) {
            // 被去横线切除的像素: 黑白二值化抹平为背景暗色; 透视遮罩下呈现亮红高亮 (#ef4444) 供用户肉眼复核
            monoData[i] = 9;
            monoData[i + 1] = 15;
            monoData[i + 2] = 25;
            monoData[i + 3] = 255;

            maskData[i] = 239;
            maskData[i + 1] = 68;
            maskData[i + 2] = 68;
            maskData[i + 3] = 235;
          } else if (isInk) {
            // 正常花粉墨迹: 纯白亮色; 透视遮罩呈现醒目青蓝 (#38bdf8)
            monoData[i] = 255;
            monoData[i + 1] = 255;
            monoData[i + 2] = 255;
            monoData[i + 3] = 255;

            maskData[i] = 56;
            maskData[i + 1] = 189;
            maskData[i + 2] = 248;
            maskData[i + 3] = 235;
          } else {
            // 背景暗底，透视透明
            monoData[i] = 9;
            monoData[i + 1] = 15;
            monoData[i + 2] = 25;
            monoData[i + 3] = 255;

            maskData[i] = 0;
            maskData[i + 1] = 0;
            maskData[i + 2] = 0;
            maskData[i + 3] = 0;
          }
        }
      }

      monoCtx.putImageData(monoImgData, 0, 0);
      maskCtx.putImageData(maskImgData, 0, 0);
    } catch (err) {
      console.warn('Canvas pixel extraction failed (CORS or memory limitation):', err);
    }
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
      let curStartX = lastCol ? lastCol.endX : this.data.calibration.dataXMin;

      const palette = [
        '#38bdf8', '#34d399', '#fbbf24', '#a78bfa',
        '#f472b6', '#fb7185', '#2dd4bf', '#818cf8',
        '#e879f9', '#38ef7d', '#11998e', '#f5af19'
      ];

      const cal = this.data.calibration;
      const yMin = cal.dataYMin;
      const yMax = cal.dataYMax;
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

        if (newEndX > this.data.calibration.dataXMax) {
          this.data.calibration.dataXMax = newEndX + 30;
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

    // 1. 模式快捷键切换 (V, H, R, C, P, E)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.code === 'KeyV') {
        e.preventDefault();
        this.setToolMode('select');
        this.notifyNotice('切换工具: 选择与微调模式 (V)');
        return;
      }
      if (e.code === 'KeyH') {
        e.preventDefault();
        this.setToolMode('pan');
        this.notifyNotice('切换工具: 抓手平移模式 (H)');
        return;
      }
      if (e.code === 'KeyR') {
        e.preventDefault();
        this.setToolMode('roi');
        this.notifyNotice('切换工具: 数据有效区 ROI 模式 (R)');
        return;
      }
      if (e.code === 'KeyC') {
        e.preventDefault();
        this.setToolMode('addCol');
        this.notifyNotice('切换工具: 添加分列线 (C) - 点击图表插入垂直基线');
        return;
      }
      if (e.code === 'KeyP') {
        e.preventDefault();
        this.setToolMode('addPoint');
        this.notifyNotice('切换工具: 添加控制拐点 (P) - 点击向当前属种插入锚点');
        return;
      }
      if (e.code === 'KeyE') {
        e.preventDefault();
        this.setToolMode('eraser');
        this.notifyNotice('切换工具: 橡皮擦删除工具 (E) - 点击锚点或分列线删除');
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

    // Ctrl+Y 或 Ctrl+Shift+Z 重做
    if (
      ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
    ) {
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
    const screenPt = this.getCanvasPoint(e);
    const zoomIn = e.deltaY < 0;
    this.viewport.zoomStepAt(screenPt, zoomIn, e.ctrlKey || e.metaKey);
    this.requestRender();
  }

  private onMouseDown(e: MouseEvent): void {
    const screenPt = this.getCanvasPoint(e);
    this.lastMouseScreen = screenPt;
    this.isMouseDown = true;
    this.hasDraggedAnchor = false;

    const mode = this.toolModeManager.getMode();

    // 中键、空格键按住、或显式处于 pan 抓手模式：进入视口拖动平移
    if (e.button === 1 || (e.button === 0 && (this.isSpaceDown || mode === 'pan'))) {
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
        const newCol: TaxaColumn = {
          id: `taxa_${Date.now()}`,
          name: `Taxa ${this.data.columns.length + 1}`,
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
            { id: `pt_${Date.now()}_top`, x: newX + 5, y: cal.dataYMin, type: 'manual', createdAt: Date.now() },
            { id: `pt_${Date.now()}_bot`, x: newX + 5, y: cal.dataYMax, type: 'manual', createdAt: Date.now() + 1 },
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

      // ================= 3. ROI 区域手柄拖动模式 =================
      const hitRoi = this.findHitRoiHandle(screenPt);
      if (hitRoi || mode === 'roi') {
        if (hitRoi) {
          this.draggingRoiHandle = hitRoi;
          this.dragInitialCalibration = { ...this.data.calibration };
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
      if (mode === 'addPoint' || (mode === 'select' && this.isWithinDiagramBounds(worldPt))) {
        const activeCol = this.getActiveColumn();
        if (activeCol && this.isWithinDiagramBounds(worldPt)) {
          let targetY = Math.round(worldPt.y);

          // 磁力吸附到标准层位高度
          if (this.hoveredDepthHorizon !== null) {
            const depthFraction =
              (this.hoveredDepthHorizon - cal.depthTopValue) /
              (cal.depthBottomValue - cal.depthTopValue || 1);
            const horizonY = Math.round(cal.dataYMin + depthFraction * (cal.dataYMax - cal.dataYMin));
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
    const cal = this.data.calibration;
    const totalY = cal.dataYMax - cal.dataYMin;
    const interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;

    // 探测当前是否悬停在特定标准地层层位附近
    let depth: number | undefined;
    if (totalY > 0) {
      depth = cal.depthTopValue + ((worldPt.y - cal.dataYMin) / totalY) * (cal.depthBottomValue - cal.depthTopValue);

      if (worldPt.y >= cal.dataYMin - 15 && worldPt.y <= cal.dataYMax + 15) {
        const nearestHorizon = Math.round(depth / interval) * interval;
        const nearestHorizonY =
          cal.dataYMin +
          ((nearestHorizon - cal.depthTopValue) / (cal.depthBottomValue - cal.depthTopValue || 1)) *
            totalY;
        if (Math.abs(worldPt.y - nearestHorizonY) <= 8 / this.viewport.scale) {
          this.hoveredDepthHorizon = Number(nearestHorizon.toFixed(2));
        } else {
          this.hoveredDepthHorizon = null;
        }
      } else {
        this.hoveredDepthHorizon = null;
      }
    }

    // 探测是否悬停在左侧标尺顶部设定按钮
    const gridStartX = Math.max(0, cal.dataXMin - 50);
    const wasHoveringBadge = this.isHoveringDepthRulerBadge;
    this.isHoveringDepthRulerBadge =
      worldPt.x <= gridStartX &&
      worldPt.x >= gridStartX - 160 &&
      worldPt.y >= cal.dataYMin - 35 &&
      worldPt.y <= cal.dataYMin + 5;

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

    // 0. 正在拖动 ROI 8 手柄微调地质数据有效区
    if (this.draggingRoiHandle) {
      const h = this.draggingRoiHandle;
      const cal = this.data.calibration;
      const x = Math.round(worldPt.x);
      const y = Math.round(worldPt.y);

      if (h.includes('l')) cal.dataXMin = Math.min(x, cal.dataXMax - 20);
      if (h.includes('r')) cal.dataXMax = Math.max(x, cal.dataXMin + 20);
      if (h.includes('t')) cal.dataYMin = Math.min(y, cal.dataYMax - 20);
      if (h.includes('b')) cal.dataYMax = Math.max(y, cal.dataYMin + 20);

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
    if (this.draggingRoiHandle && this.dragInitialCalibration) {
      const cal = this.data.calibration;
      this.history.push('Resize Data ROI', this.data.columns, this.data.activeTaxaId, this.data.calibration);
      this.notifyNotice(`地质数据区已调整为: [${cal.dataXMin}, ${cal.dataXMax}] x [${cal.dataYMin}, ${cal.dataYMax}]`);
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
    this.dragInitialCalibration = null;
    this.hasDraggedAnchor = false;
    this.updateCursor();
    this.requestRender();
  }

  private onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    const screenPt = this.getCanvasPoint(e);
    const hitAnchor = this.findHitAnchor(screenPt);

    if (hitAnchor) {
      const col = this.data.columns.find((c) => c.id === hitAnchor.taxaId);
      if (col) {
        const beforeCount = col.controlPoints.length;
        col.controlPoints = col.controlPoints.filter((p) => p.id !== hitAnchor.pointId);

        if (col.controlPoints.length < beforeCount) {
          this.history.push(`Remove Anchor from ${col.name}`, this.data.columns, this.data.activeTaxaId);
          this.hoveredAnchor = null;
          this.updateCursor();
          this.requestRender();
        }
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
    const cal = this.data.calibration;
    // 允许在图表有效深度范围以及上方标签区域点击选中该列
    if (worldPt.y < cal.dataYMin - 60 || worldPt.y > cal.dataYMax + 40) {
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
    const cal = this.data.calibration;
    return worldPt.y >= cal.dataYMin - 50 && worldPt.y <= cal.dataYMax + 50;
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
    const cal = this.data.calibration;
    const tlScreen = this.viewport.worldToScreen({ x: cal.dataXMin, y: cal.dataYMin });
    const brScreen = this.viewport.worldToScreen({ x: cal.dataXMax, y: cal.dataYMax });
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

    // 视口底层画板底色：日间模式使用清爽明亮的洁净底 (#f8fafc)，夜间模式使用深蓝黑 (#0b0f19)
    ctx.fillStyle = isLight ? '#f8fafc' : '#0b0f19';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // 绘制微网格
    this.drawGrid(ctx, rect.width, rect.height, isLight);

    // 应用世界视口矩阵变换
    this.viewport.applyTransform(ctx);

    // 1. 底层扫描地质图谱（支持原图、反相、高对比、纯二值化与透视遮罩）
    this.drawBackgroundDiagram(ctx, isLight);

    // 2. 地层深度标尺网格系统 (Depth Grid Ruler - 水平淡蓝色层位标线贯穿所有属种列)
    this.drawDepthGrid(ctx, isLight);

    // 3. 沉积剖面有效范围指示与刻度 (ROI)
    this.drawCalibrationOverlay(ctx, isLight);

    // 4. 各属种垂直分界标线与两点式物理刻度钉 (Step 2 开始呈现)
    if (this.workflowStage >= 2 && this.data.columns.length > 0) {
      this.drawColumnBoundaries(ctx, isLight);
    }

    // 5. 花粉轮廓面积图与曲线 (Step 3 数字化后呈现)
    if (this.workflowStage >= 3 && this.data.columns.length > 0) {
      this.drawPollenCurves(ctx);
      // 6. 控制锚点渲染
      this.drawAnchors(ctx);
      // 7. 原位半透明逆向重绘绿色质检比对层 (Visual Ghosting Layer)
      this.drawGhostingOverlay(ctx);
    }

    ctx.restore();

    // 8. 同步更新右下角 Minimap 视口框
    if (this.minimap) {
      this.minimap.updateViewport(this.viewport, rect.width, rect.height);
    }
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

      // 纯二值化模式
      if (mode === 'binary' && this.binaryMonoCanvas) {
        ctx.drawImage(this.binaryMonoCanvas, 0, 0, w, h);
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

      // B 键二值化墨迹透视遮罩叠加层
      if (this.viewport.showBinaryOverlay && this.binaryMaskCanvas) {
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.drawImage(this.binaryMaskCanvas, 0, 0, w, h);
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
   * 绘制地层深度标尺网格系统 (Depth Grid Ruler)
   * 在画布上高保真显示水平淡蓝色层位标线（贯穿所有属种列）以及左侧深度标尺
   */
  private drawDepthGrid(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    const cal = this.data.calibration;
    if (cal.depthGridEnabled === false) return;

    const interval = cal.depthInterval && cal.depthInterval > 0 ? cal.depthInterval : 2;
    const { depths, yPositions } = SplineInterpolator.getStandardDepthHorizons(cal);
    if (depths.length === 0) return;

    const scale = this.viewport.scale;
    const totalCols = this.data.columns;
    const gridStartX = Math.max(0, cal.dataXMin - 50);
    const gridEndX = totalCols.length > 0
      ? Math.max(cal.dataXMax, totalCols[totalCols.length - 1].endX + 30)
      : cal.dataXMax + 60;

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
        ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.45)' : 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1.3 / scale;
        ctx.setLineDash([5 / scale, 4 / scale]);
      } else {
        ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.25)' : 'rgba(125, 211, 252, 0.22)';
        ctx.lineWidth = 0.85 / scale;
        ctx.setLineDash([2.5 / scale, 3.5 / scale]);
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

    // 3. 绘制左侧垂直深度标尺主轴
    ctx.beginPath();
    ctx.moveTo(gridStartX - 4, cal.dataYMin);
    ctx.lineTo(gridStartX - 4, cal.dataYMax);
    ctx.strokeStyle = isLight ? 'rgba(2, 132, 199, 0.7)' : 'rgba(56, 189, 248, 0.6)';
    ctx.lineWidth = 1.5 / scale;
    ctx.setLineDash([]);
    ctx.stroke();

    // 4. 绘制深度标尺顶部单位与层位间隔 Badge
    const badgeX = gridStartX - 8;
    const badgeY = cal.dataYMin - 16;
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

  private drawCalibrationOverlay(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    const cal = this.data.calibration;
    const scale = this.viewport.scale;
    const isRoiMode = this.toolModeManager.getMode() === 'roi';

    ctx.save();

    // 1. 半透明数据区遮罩框
    const boxW = cal.dataXMax - cal.dataXMin;
    const boxH = cal.dataYMax - cal.dataYMin;

    ctx.fillStyle = isLight
      ? (isRoiMode ? 'rgba(2, 132, 199, 0.08)' : 'rgba(2, 132, 199, 0.03)')
      : (isRoiMode ? 'rgba(56, 189, 248, 0.08)' : 'rgba(56, 189, 248, 0.03)');
    ctx.fillRect(cal.dataXMin, cal.dataYMin, boxW, boxH);

    // 2. 数据有效区外边框 (ROI Bounding Box)
    ctx.strokeStyle = isLight
      ? (isRoiMode ? '#0284c7' : 'rgba(2, 132, 199, 0.7)')
      : (isRoiMode ? '#38bdf8' : 'rgba(56, 189, 248, 0.7)');
    ctx.lineWidth = (isRoiMode ? 2.2 : 1.5) / scale;
    ctx.setLineDash(isRoiMode ? [] : [6 / scale, 4 / scale]);
    ctx.strokeRect(cal.dataXMin, cal.dataYMin, boxW, boxH);

    // 3. 绘制 8 个屏幕像素恒定的手柄 (Square Handles)
    const handleScreenSize = this.ROI_HANDLE_SIZE_SCREEN;
    const handleImgSize = handleScreenSize / scale;
    const midX = (cal.dataXMin + cal.dataXMax) / 2;
    const midY = (cal.dataYMin + cal.dataYMax) / 2;

    const handles: Record<string, Point2D> = {
      tl: { x: cal.dataXMin, y: cal.dataYMin },
      tr: { x: cal.dataXMax, y: cal.dataYMin },
      bl: { x: cal.dataXMin, y: cal.dataYMax },
      br: { x: cal.dataXMax, y: cal.dataYMax },
      t: { x: midX, y: cal.dataYMin },
      b: { x: midX, y: cal.dataYMax },
      l: { x: cal.dataXMin, y: midY },
      r: { x: cal.dataXMax, y: midY },
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

    // 4. 标注顶部和底部深度提示文字 (位于 ROI 左边缘外侧，杜绝侵入属种数据区造成文字遮挡重叠)
    ctx.fillStyle = isLight ? '#0284c7' : '#7dd3fc';
    ctx.font = `bold ${Math.max(10, 11 / scale)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(
      `Top: ${cal.depthTopValue} ${cal.unit} ─┐`,
      cal.dataXMin - 8 / scale,
      cal.dataYMin + 4 / scale
    );
    ctx.fillText(
      `Bottom: ${cal.depthBottomValue} ${cal.unit} ─┘`,
      cal.dataXMin - 8 / scale,
      cal.dataYMax + 4 / scale
    );

    ctx.restore();
  }

  private drawColumnBoundaries(ctx: CanvasRenderingContext2D, isLight: boolean): void {
    const cal = this.data.calibration;
    const topY = cal.dataYMin - 40;
    const bottomY = cal.dataYMax + 30;
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
        ctx.font = `600 ${Math.max(8.5, 9.5 / scale)}px sans-serif`;
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
        ctx.font = `500 ${fontSize}px sans-serif`;
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
          const areaPath = SplineInterpolator.buildAreaPath(sortedPoints, col.startX, col.curveType);
          ctx.fillStyle = isActive ? `${col.color}44` : `${col.color}1a`;
          ctx.fill(areaPath);
        }

        const curvePath = SplineInterpolator.buildPath(sortedPoints, col.curveType);
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
    this.requestRender();
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

  public setDegridStrength(strength: 'off' | 'weak' | 'medium' | 'strong'): void {
    this.viewport.degridStrength = strength;
    this.generateBinaryCache();
    this.render();
  }
}
