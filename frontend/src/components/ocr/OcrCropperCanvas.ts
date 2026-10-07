export interface OcrCropperCanvasCallbacks {
  onCropChange?: (bounds: { x0: number; y0: number; x1: number; y1: number }) => void;
  onAngleChange?: (angleDeg: number) => void;
}

export class OcrCropperCanvas {
  private container: HTMLElement;
  private cropCanvas: HTMLCanvasElement;
  private cropCtx: CanvasRenderingContext2D | null;
  private rotPreviewCanvas: HTMLCanvasElement;
  private rotPreviewCtx: CanvasRenderingContext2D | null;
  private callbacks: OcrCropperCanvasCallbacks;

  private rawDiagramImg: HTMLImageElement | null = null;
  private cropX0: number = 315;
  private cropY0: number = 180;
  private cropX1: number = 1946;
  private cropY1: number = 515;
  private currentAngleDeg: number = 45.0;

  // 上栏框选画布视口缩放与平移状态
  private cropScale: number = 0.5;
  private cropPanX: number = 0;
  private cropPanY: number = 0;
  private isCropPanning: boolean = false;
  private panStartScreenX: number = 0;
  private panStartScreenY: number = 0;
  private panStartPanX: number = 0;
  private panStartPanY: number = 0;

  // 选框调整状态 (8向手柄 + 整体平移 + 外部新建)
  private isDraggingCropBox: boolean = false;
  private dragMode: 'create' | 'move' | 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'se' | 'sw' | null = null;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private initialCropState: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: 0, y1: 0 };

  // 左侧旋转扶正预览视口缩放与平移状态
  private rotScale: number = 1.0;
  private rotPanX: number = 0;
  private rotPanY: number = 0;
  private isRotPanning: boolean = false;
  private rotDragStartX: number = 0;
  private rotDragStartY: number = 0;
  private rotStartPanX: number = 0;
  private rotStartPanY: number = 0;

  private isSpaceDown: boolean = false;
  private disposers: Array<() => void> = [];

  constructor(
    container: HTMLElement,
    cropCanvas: HTMLCanvasElement,
    rotPreviewCanvas: HTMLCanvasElement,
    initialCrop: { x0: number; y0: number; x1: number; y1: number },
    callbacks: OcrCropperCanvasCallbacks = {}
  ) {
    this.container = container;
    this.cropCanvas = cropCanvas;
    this.cropCtx = cropCanvas.getContext('2d');
    this.rotPreviewCanvas = rotPreviewCanvas;
    this.rotPreviewCtx = rotPreviewCanvas.getContext('2d');
    this.cropX0 = initialCrop.x0;
    this.cropY0 = initialCrop.y0;
    this.cropX1 = initialCrop.x1;
    this.cropY1 = initialCrop.y1;
    this.callbacks = callbacks;

    this.bindCropCanvasEvents();
    this.bindRotPreviewEvents();
    this.bindKeyEvents();
    this.updateCropCoordsLabel();
  }

  public getRawImage(): HTMLImageElement | null {
    return this.rawDiagramImg;
  }

  public getCropBounds(): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: Math.round(this.cropX0),
      y0: Math.round(this.cropY0),
      x1: Math.round(this.cropX1),
      y1: Math.round(this.cropY1),
    };
  }

  public setCropBounds(x0: number, y0: number, x1: number, y1: number): void {
    this.cropX0 = x0;
    this.cropY0 = y0;
    this.cropX1 = x1;
    this.cropY1 = y1;
    this.updateCropCoordsLabel();
    this.renderCropCanvas();
    this.resetRotView();
    this.callbacks.onCropChange?.(this.getCropBounds());
  }

  public getAngle(): number {
    return this.currentAngleDeg;
  }

  public setAngle(angleDeg: number): void {
    this.currentAngleDeg = angleDeg;
    this.renderRotatedPreview();
    this.callbacks.onAngleChange?.(angleDeg);
  }

  public loadRawDiagramImage(onLoaded?: () => void): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.rawDiagramImg = img;
      this.fitCropToView();
      this.resetRotView();
      onLoaded?.();
    };
    img.src = `/image/current?t=${Date.now()}`;
  }

  public fitCropToView(): void {
    if (!this.rawDiagramImg) return;
    const w = this.rawDiagramImg.naturalWidth || 1000;
    const container = this.container.querySelector('#ocr-cropper-container') as HTMLElement | null;
    const containerW = container ? container.clientWidth : 1000;
    const containerH = container ? container.clientHeight : 175;

    // 自动以舒适比例聚焦到图谱顶部区域
    this.cropScale = Math.min(containerW / (w * 0.96), containerH / 380);
    this.cropPanX = (containerW - w * this.cropScale) / 2;
    this.cropPanY = -(this.cropY0 - 20) * this.cropScale;

    this.renderCropCanvas();
  }

  public resetRotView(): void {
    const rotBox = this.container.querySelector('#ocr-rot-canvas-box') as HTMLElement | null;
    const boxW = rotBox ? rotBox.clientWidth : 320;
    const boxH = rotBox ? rotBox.clientHeight : 200;

    const bw = Math.max(10, Math.round(this.cropX1 - this.cropX0));
    const bh = Math.max(10, Math.round(this.cropY1 - this.cropY0));
    const rad = (this.currentAngleDeg * Math.PI) / 180.0;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rotW = Math.round(bw * cos + bh * sin);
    const rotH = Math.round(bw * sin + bh * cos);

    this.rotScale = Math.min((boxW - 16) / Math.max(1, rotW), (boxH - 16) / Math.max(1, rotH), 1.6);
    this.rotPanX = (boxW - rotW * this.rotScale) / 2;
    this.rotPanY = (boxH - rotH * this.rotScale) / 2;

    this.renderRotatedPreview();
  }

  public updateCropCoordsLabel(): void {
    const el = this.container.querySelector('#ocr-crop-coords-label');
    if (el) {
      const w = Math.round(Math.abs(this.cropX1 - this.cropX0));
      const h = Math.round(Math.abs(this.cropY1 - this.cropY0));
      el.textContent = `[X: ${Math.round(this.cropX0)}~${Math.round(this.cropX1)}, Y: ${Math.round(this.cropY0)}~${Math.round(this.cropY1)}] (${w}×${h}px)`;
    }
  }

  private getHitHandle(imgX: number, imgY: number): 'n' | 's' | 'w' | 'e' | 'nw' | 'ne' | 'se' | 'sw' | 'move' | 'create' {
    const minX = Math.min(this.cropX0, this.cropX1);
    const maxX = Math.max(this.cropX0, this.cropX1);
    const minY = Math.min(this.cropY0, this.cropY1);
    const maxY = Math.max(this.cropY0, this.cropY1);

    const tol = 12 / this.cropScale;

    if (Math.abs(imgX - minX) <= tol && Math.abs(imgY - minY) <= tol) return 'nw';
    if (Math.abs(imgX - maxX) <= tol && Math.abs(imgY - minY) <= tol) return 'ne';
    if (Math.abs(imgX - maxX) <= tol && Math.abs(imgY - maxY) <= tol) return 'se';
    if (Math.abs(imgX - minX) <= tol && Math.abs(imgY - maxY) <= tol) return 'sw';

    if (Math.abs(imgY - minY) <= tol && imgX >= minX - tol && imgX <= maxX + tol) return 'n';
    if (Math.abs(imgY - maxY) <= tol && imgX >= minX - tol && imgX <= maxX + tol) return 's';
    if (Math.abs(imgX - minX) <= tol && imgY >= minY - tol && imgY <= maxY + tol) return 'w';
    if (Math.abs(imgX - maxX) <= tol && imgY >= minY - tol && imgY <= maxY + tol) return 'e';

    if (imgX > minX && imgX < maxX && imgY > minY && imgY < maxY) return 'move';

    return 'create';
  }

  private bindCropCanvasEvents(): void {
    const canvas = this.cropCanvas;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const newScale = Math.max(0.12, Math.min(4.5, this.cropScale * zoomFactor));

      this.cropPanX = mouseX - (mouseX - this.cropPanX) * (newScale / this.cropScale);
      this.cropPanY = mouseY - (mouseY - this.cropPanY) * (newScale / this.cropScale);
      this.cropScale = newScale;

      this.renderCropCanvas();
    });

    canvas.addEventListener('mousemove', (e) => {
      if (this.isDraggingCropBox || this.isCropPanning) return;
      if (this.isSpaceDown) {
        canvas.style.cursor = 'grab';
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const clickScreenX = e.clientX - rect.left;
      const clickScreenY = e.clientY - rect.top;

      const imgX = (clickScreenX - this.cropPanX) / this.cropScale;
      const imgY = (clickScreenY - this.cropPanY) / this.cropScale;

      const hit = this.getHitHandle(imgX, imgY);
      const cursorMap: Record<string, string> = {
        nw: 'nwse-resize',
        se: 'nwse-resize',
        ne: 'nesw-resize',
        sw: 'nesw-resize',
        n: 'ns-resize',
        s: 'ns-resize',
        w: 'ew-resize',
        e: 'ew-resize',
        move: 'move',
        create: 'crosshair',
      };
      canvas.style.cursor = cursorMap[hit] || 'crosshair';
    });

    canvas.addEventListener('dblclick', () => {
      this.fitCropToView();
    });

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickScreenX = e.clientX - rect.left;
      const clickScreenY = e.clientY - rect.top;

      const shouldPan = e.button === 2 || e.button === 1 || (e.button === 0 && this.isSpaceDown);
      if (shouldPan) {
        e.preventDefault();
        this.isCropPanning = true;
        this.panStartScreenX = e.clientX;
        this.panStartScreenY = e.clientY;
        this.panStartPanX = this.cropPanX;
        this.panStartPanY = this.cropPanY;
        canvas.style.cursor = 'grabbing';
        return;
      }

      if (e.button !== 0) return;

      const imgX = (clickScreenX - this.cropPanX) / this.cropScale;
      const imgY = (clickScreenY - this.cropPanY) / this.cropScale;

      this.dragStartX = imgX;
      this.dragStartY = imgY;

      const minX = Math.min(this.cropX0, this.cropX1);
      const maxX = Math.max(this.cropX0, this.cropX1);
      const minY = Math.min(this.cropY0, this.cropY1);
      const maxY = Math.max(this.cropY0, this.cropY1);
      this.initialCropState = { x0: minX, y0: minY, x1: maxX, y1: maxY };

      const hit = this.getHitHandle(imgX, imgY);
      this.isDraggingCropBox = true;
      this.dragMode = hit;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const onWindowMouseMove = (e: MouseEvent) => {
      if (!this.rawDiagramImg) return;

      if (this.isCropPanning) {
        this.cropPanX = this.panStartPanX + (e.clientX - this.panStartScreenX);
        this.cropPanY = this.panStartPanY + (e.clientY - this.panStartScreenY);
        this.renderCropCanvas();
        return;
      }

      if (!this.isDraggingCropBox || !this.dragMode) return;

      const rect = this.cropCanvas.getBoundingClientRect();
      const curScreenX = e.clientX - rect.left;
      const curScreenY = e.clientY - rect.top;

      const maxW = this.rawDiagramImg.naturalWidth;
      const maxH = this.rawDiagramImg.naturalHeight;
      const curImgX = Math.max(0, Math.min(maxW, (curScreenX - this.cropPanX) / this.cropScale));
      const curImgY = Math.max(0, Math.min(maxH, (curScreenY - this.cropPanY) / this.cropScale));

      const dx = curImgX - this.dragStartX;
      const dy = curImgY - this.dragStartY;
      const init = this.initialCropState;

      if (this.dragMode === 'create') {
        if (Math.hypot(dx, dy) * this.cropScale > 6) {
          this.cropX0 = Math.max(0, Math.min(this.dragStartX, curImgX));
          this.cropX1 = Math.min(maxW, Math.max(this.dragStartX, curImgX));
          this.cropY0 = Math.max(0, Math.min(this.dragStartY, curImgY));
          this.cropY1 = Math.min(maxH, Math.max(this.dragStartY, curImgY));
          this.updateCropCoordsLabel();
          this.renderCropCanvas();
        }
        return;
      }

      if (this.dragMode === 'move') {
        const w = init.x1 - init.x0;
        const h = init.y1 - init.y0;
        const nx0 = Math.max(0, Math.min(maxW - w, init.x0 + dx));
        const ny0 = Math.max(0, Math.min(maxH - h, init.y0 + dy));
        this.cropX0 = nx0;
        this.cropY0 = ny0;
        this.cropX1 = nx0 + w;
        this.cropY1 = ny0 + h;
      } else {
        switch (this.dragMode) {
          case 'n':
            this.cropY0 = Math.max(0, Math.min(init.y1 - 15, init.y0 + dy));
            break;
          case 's':
            this.cropY1 = Math.min(maxH, Math.max(init.y0 + 15, init.y1 + dy));
            break;
          case 'w':
            this.cropX0 = Math.max(0, Math.min(init.x1 - 20, init.x0 + dx));
            break;
          case 'e':
            this.cropX1 = Math.min(maxW, Math.max(init.x0 + 20, init.x1 + dx));
            break;
          case 'nw':
            this.cropX0 = Math.max(0, Math.min(init.x1 - 20, init.x0 + dx));
            this.cropY0 = Math.max(0, Math.min(init.y1 - 15, init.y0 + dy));
            break;
          case 'ne':
            this.cropX1 = Math.min(maxW, Math.max(init.x0 + 20, init.x1 + dx));
            this.cropY0 = Math.max(0, Math.min(init.y1 - 15, init.y0 + dy));
            break;
          case 'se':
            this.cropX1 = Math.min(maxW, Math.max(init.x0 + 20, init.x1 + dx));
            this.cropY1 = Math.min(maxH, Math.max(init.y0 + 15, init.y1 + dy));
            break;
          case 'sw':
            this.cropX0 = Math.max(0, Math.min(init.x1 - 20, init.x0 + dx));
            this.cropY1 = Math.min(maxH, Math.max(init.y0 + 15, init.y1 + dy));
            break;
        }
      }

      this.updateCropCoordsLabel();
      this.renderCropCanvas();
    };

    const onWindowMouseUp = () => {
      if (this.isCropPanning) {
        this.isCropPanning = false;
        this.cropCanvas.style.cursor = this.isSpaceDown ? 'grab' : 'crosshair';
      }

      if (this.isDraggingCropBox) {
        const wasCreating = this.dragMode === 'create';
        this.isDraggingCropBox = false;
        this.dragMode = null;

        if (wasCreating) {
          if (Math.abs(this.cropX1 - this.cropX0) < 20 || Math.abs(this.cropY1 - this.cropY0) < 15) {
            this.cropX0 = this.initialCropState.x0;
            this.cropY0 = this.initialCropState.y0;
            this.cropX1 = this.initialCropState.x1;
            this.cropY1 = this.initialCropState.y1;
          }
        }

        const xMin = Math.min(this.cropX0, this.cropX1);
        const xMax = Math.max(this.cropX0, this.cropX1);
        const yMin = Math.min(this.cropY0, this.cropY1);
        const yMax = Math.max(this.cropY0, this.cropY1);
        this.cropX0 = xMin;
        this.cropX1 = xMax;
        this.cropY0 = yMin;
        this.cropY1 = yMax;

        this.updateCropCoordsLabel();
        this.renderCropCanvas();
        this.resetRotView();
        this.callbacks.onCropChange?.(this.getCropBounds());
      }
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    this.disposers.push(() => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    });
  }

  private bindRotPreviewEvents(): void {
    const canvas = this.rotPreviewCanvas;
    const box = this.container.querySelector('#ocr-rot-canvas-box') as HTMLElement | null;

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomIn = e.deltaY < 0;
      const factor = zoomIn ? 1.15 : 0.85;
      const newScale = Math.max(0.15, Math.min(8.0, this.rotScale * factor));

      this.rotPanX = mouseX - (mouseX - this.rotPanX) * (newScale / this.rotScale);
      this.rotPanY = mouseY - (mouseY - this.rotPanY) * (newScale / this.rotScale);
      this.rotScale = newScale;

      this.renderRotatedPreview();
    });

    canvas.addEventListener('dblclick', () => {
      this.resetRotView();
    });

    canvas.addEventListener('mousedown', (e) => {
      const shouldPan = e.button === 2 || e.button === 1 || (e.button === 0 && this.isSpaceDown);
      if (shouldPan) {
        e.preventDefault();
        this.isRotPanning = true;
        this.rotDragStartX = e.clientX;
        this.rotDragStartY = e.clientY;
        this.rotStartPanX = this.rotPanX;
        this.rotStartPanY = this.rotPanY;
        if (box) box.classList.add('is-panning');
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const onWindowRotMouseMove = (e: MouseEvent) => {
      if (!this.isRotPanning || !this.rotPreviewCanvas) return;
      this.rotPanX = this.rotStartPanX + (e.clientX - this.rotDragStartX);
      this.rotPanY = this.rotStartPanY + (e.clientY - this.rotDragStartY);
      this.renderRotatedPreview();
    };

    const onWindowRotMouseUp = () => {
      if (this.isRotPanning) {
        this.isRotPanning = false;
        if (box) box.classList.remove('is-panning');
      }
    };

    window.addEventListener('mousemove', onWindowRotMouseMove);
    window.addEventListener('mouseup', onWindowRotMouseUp);
    this.disposers.push(() => {
      window.removeEventListener('mousemove', onWindowRotMouseMove);
      window.removeEventListener('mouseup', onWindowRotMouseUp);
    });
  }

  private bindKeyEvents(): void {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !this.isSpaceDown) {
        this.isSpaceDown = true;
        if (this.cropCanvas) this.cropCanvas.style.cursor = 'grab';
        const rotBox = this.container.querySelector('#ocr-rot-canvas-box') as HTMLElement | null;
        if (rotBox) rotBox.style.cursor = 'grab';
      }
    };

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        this.isSpaceDown = false;
        if (this.cropCanvas && !this.isCropPanning) this.cropCanvas.style.cursor = 'crosshair';
        const rotBox = this.container.querySelector('#ocr-rot-canvas-box') as HTMLElement | null;
        if (rotBox && !this.isRotPanning) rotBox.style.cursor = 'grab';
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    this.disposers.push(() => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    });
  }

  public renderCropCanvas(): void {
    if (!this.cropCanvas || !this.cropCtx || !this.rawDiagramImg) return;
    const ctx = this.cropCtx;
    const img = this.rawDiagramImg;
    const canvas = this.cropCanvas;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const w = canvas.width;
    const h = canvas.height;
    const isLight = document.body.classList.contains('theme-light');

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.cropPanX, this.cropPanY);
    ctx.scale(this.cropScale, this.cropScale);

    // 1. 绘制底图
    ctx.drawImage(img, 0, 0);

    // 2. 半透明遮罩
    ctx.fillStyle = isLight ? 'rgba(241, 245, 249, 0.68)' : 'rgba(11, 15, 25, 0.58)';
    ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);

    // 3. 挖空并高亮选框区域
    const bx = Math.min(this.cropX0, this.cropX1);
    const by = Math.min(this.cropY0, this.cropY1);
    const bw = Math.abs(this.cropX1 - this.cropX0);
    const bh = Math.abs(this.cropY1 - this.cropY0);

    ctx.clearRect(bx, by, bw, bh);
    ctx.drawImage(img, bx, by, bw, bh, bx, by, bw, bh);

    // 4. 选框边框与半透明高亮填充
    const strokeColor = isLight ? '#0284c7' : '#38bdf8';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2 / this.cropScale;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = isLight ? 'rgba(2, 132, 199, 0.05)' : 'rgba(56, 189, 248, 0.08)';
    ctx.fillRect(bx, by, bw, bh);

    // 5. 绘制选框尺寸提示胶囊
    const badgeW = 96 / this.cropScale;
    const badgeH = 17 / this.cropScale;
    const badgeY = by > 22 / this.cropScale ? by - badgeH - 3 / this.cropScale : by + 4 / this.cropScale;

    ctx.fillStyle = isLight ? '#ffffff' : 'rgba(15, 23, 42, 0.90)';
    ctx.fillRect(bx, badgeY, badgeW, badgeH);
    ctx.strokeStyle = isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1 / this.cropScale;
    ctx.strokeRect(bx, badgeY, badgeW, badgeH);

    ctx.fillStyle = strokeColor;
    ctx.font = `bold ${Math.round(10.5 / this.cropScale)}px monospace`;
    ctx.fillText(`${Math.round(bw)} × ${Math.round(bh)} px`, bx + 6 / this.cropScale, badgeY + badgeH - 4.5 / this.cropScale);

    // 6. 绘制 8 个发光控制角手柄与边缘中点手柄
    const hs = 9 / this.cropScale;
    const lw = 2 / this.cropScale;

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lw;
    const cornerHandles = [
      [bx, by],
      [bx + bw, by],
      [bx + bw, by + bh],
      [bx, by + bh],
    ];
    cornerHandles.forEach(([hx, hy]) => {
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
      ctx.strokeRect(hx - hs / 2, hy - hs / 2, hs, hs);
    });

    const midHandles = [
      [bx + bw / 2, by],
      [bx + bw, by + bh / 2],
      [bx + bw / 2, by + bh],
      [bx, by + bh / 2],
    ];
    const r = 4.5 / this.cropScale;
    midHandles.forEach(([hx, hy]) => {
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lw;
      ctx.stroke();
    });

    ctx.restore();
  }

  public renderRotatedPreview(): void {
    if (!this.rotPreviewCanvas || !this.rotPreviewCtx || !this.rawDiagramImg) return;
    const ctx = this.rotPreviewCtx;
    const img = this.rawDiagramImg;
    const canvas = this.rotPreviewCanvas;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const w = canvas.width;
    const h = canvas.height;
    const isLight = document.body.classList.contains('theme-light');

    ctx.clearRect(0, 0, w, h);

    // 绘制视口棋盘底色
    ctx.fillStyle = isLight ? '#f8fafc' : '#0b0f19';
    ctx.fillRect(0, 0, w, h);

    const bx = Math.max(0, Math.round(this.cropX0));
    const by = Math.max(0, Math.round(this.cropY0));
    const bw = Math.max(10, Math.round(this.cropX1 - this.cropX0));
    const bh = Math.max(10, Math.round(this.cropY1 - this.cropY0));

    const offCanvas = document.createElement('canvas');
    offCanvas.width = bw;
    offCanvas.height = bh;
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;
    offCtx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);

    const rad = (this.currentAngleDeg * Math.PI) / 180.0;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rotW = Math.round(bw * cos + bh * sin);
    const rotH = Math.round(bw * sin + bh * cos);

    ctx.save();
    ctx.translate(this.rotPanX, this.rotPanY);
    ctx.scale(this.rotScale, this.rotScale);

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 8;
    ctx.fillRect(0, 0, rotW, rotH);
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.translate(rotW / 2, rotH / 2);
    ctx.rotate(rad);
    ctx.drawImage(offCanvas, -bw / 2, -bh / 2);
    ctx.restore();

    ctx.strokeStyle = isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, rotW, rotH);

    ctx.restore();
  }

  public dispose(): void {
    this.disposers.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
    this.disposers = [];
  }
}
