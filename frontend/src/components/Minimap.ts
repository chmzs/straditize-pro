import { Viewport } from '../core/Viewport';

export interface MinimapCallbacks {
  onNavigate: (worldX: number, worldY: number) => void;
}

export class Minimap {
  private element: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: MinimapCallbacks;
  private isCollapsed: boolean = false;
  private isDragging: boolean = false;

  private image: HTMLImageElement | null = null;
  private imageWidth: number = 1000;
  private imageHeight: number = 1000;
  private currentScale: number = 1;
  private currentPanX: number = 0;
  private currentPanY: number = 0;
  private canvasWidth: number = 800;
  private canvasHeight: number = 600;

  constructor(container: HTMLElement, callbacks: MinimapCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('div');
    this.element.className = 'minimap-widget';
    this.element.innerHTML = `
      <div class="minimap-header">
        <span class="minimap-title">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
          </svg>
          雷达鸟瞰
        </span>
        <button id="btn-toggle-minimap" class="minimap-btn" title="折叠/展开雷达图">—</button>
      </div>
      <div class="minimap-body" id="minimap-body">
        <canvas id="minimap-canvas" width="160" height="120"></canvas>
      </div>
    `;

    container.appendChild(this.element);

    const cvs = this.element.querySelector('#minimap-canvas') as HTMLCanvasElement;
    if (!cvs) throw new Error('Minimap canvas not found');
    this.canvas = cvs;
    const context = cvs.getContext('2d');
    if (!context) throw new Error('Cannot get 2d context for minimap');
    this.ctx = context;

    this.bindEvents();
  }

  public setImage(img: HTMLImageElement | null, w: number, h: number): void {
    this.image = img;
    this.imageWidth = Math.max(1, w);
    this.imageHeight = Math.max(1, h);
    this.render();
  }

  public updateViewport(viewport: Viewport, containerW: number, containerH: number): void {
    this.currentScale = viewport.scale;
    this.currentPanX = viewport.panX;
    this.currentPanY = viewport.panY;
    this.canvasWidth = Math.max(1, containerW);
    this.canvasHeight = Math.max(1, containerH);
    this.render();
  }

  public render(): void {
    if (this.isCollapsed) return;
    const ctx = this.ctx;
    const w = 160;
    const h = 120;

    ctx.clearRect(0, 0, w, h);

    // 绘制背景深色网格
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    if (!this.image || this.imageWidth <= 0 || this.imageHeight <= 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('无图谱图像', w / 2, h / 2);
      return;
    }

    // 计算等比居中缩放
    const scale = Math.min(w / this.imageWidth, h / this.imageHeight);
    const drawW = this.imageWidth * scale;
    const drawH = this.imageHeight * scale;
    const offsetX = (w - drawW) / 2;
    const offsetY = (h - drawH) / 2;

    try {
      ctx.drawImage(this.image, offsetX, offsetY, drawW, drawH);
    } catch {
      // 容错处理
    }

    // 计算当前视口在原图上的可见区域 [worldLeft, worldTop, worldRight, worldBottom]
    const worldLeft = -this.currentPanX / this.currentScale;
    const worldTop = -this.currentPanY / this.currentScale;
    const worldRight = (-this.currentPanX + this.canvasWidth) / this.currentScale;
    const worldBottom = (-this.currentPanY + this.canvasHeight) / this.currentScale;

    // 映射到 Minimap 内部坐标
    const boxX = offsetX + Math.max(0, worldLeft) * scale;
    const boxY = offsetY + Math.max(0, worldTop) * scale;
    const boxW = Math.max(4, Math.min(this.imageWidth, worldRight - worldLeft) * scale);
    const boxH = Math.max(4, Math.min(this.imageHeight, worldBottom - worldTop) * scale);

    // 视口半透明反色遮罩
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    // 四角亮白小十字指示
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(boxX - 1.5, boxY - 1.5, 3, 3);
    ctx.fillRect(boxX + boxW - 1.5, boxY - 1.5, 3, 3);
    ctx.fillRect(boxX - 1.5, boxY + boxH - 1.5, 3, 3);
    ctx.fillRect(boxX + boxW - 1.5, boxY + boxH - 1.5, 3, 3);
  }

  private bindEvents(): void {
    const toggleBtn = this.element.querySelector('#btn-toggle-minimap') as HTMLButtonElement;
    const bodyEl = this.element.querySelector('#minimap-body') as HTMLElement;

    toggleBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.isCollapsed = !this.isCollapsed;
      if (this.isCollapsed) {
        bodyEl.style.display = 'none';
        toggleBtn.textContent = '□';
        toggleBtn.title = '展开雷达图';
      } else {
        bodyEl.style.display = 'block';
        toggleBtn.textContent = '—';
        toggleBtn.title = '折叠雷达图';
        this.render();
      }
    });

    const handlePointerNav = (e: MouseEvent) => {
      if (!this.image || this.imageWidth <= 0 || this.imageHeight <= 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const w = 160;
      const h = 120;
      const scale = Math.min(w / this.imageWidth, h / this.imageHeight);
      const drawW = this.imageWidth * scale;
      const drawH = this.imageHeight * scale;
      const offsetX = (w - drawW) / 2;
      const offsetY = (h - drawH) / 2;

      const normX = (clickX - offsetX) / scale;
      const normY = (clickY - offsetY) / scale;

      const targetWorldX = Math.max(0, Math.min(this.imageWidth, normX));
      const targetWorldY = Math.max(0, Math.min(this.imageHeight, normY));

      this.callbacks.onNavigate(targetWorldX, targetWorldY);
    };

    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      handlePointerNav(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        handlePointerNav(e);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });
  }
}
