import { RpcClient } from '../services/RpcClient';
import { DiagramData } from '../types/pollen';

export interface OcrLabelEntry {
  id: string;
  ocr_text: string;
  suggested_name: string;
  suggested_zh: string;
  group: string;
  confidence: number;
  status: 'auto' | 'confirm' | 'unrecognized';
  bbox: Array<[number, number]>;
  anchor_x: number;
  anchor_y: number;
  associated_column_id?: string | null;
  associated_column_index?: number | null;
  associated_column_name?: string | null;
  user_override_name?: string;
  accepted?: boolean;
}

export interface OcrRecognitionResult {
  labels: OcrLabelEntry[];
  label_row_bbox: [number, number, number, number];
  label_row_image: string; // base64
  summary: {
    total: number;
    auto: number;
    confirm: number;
    unrecognized: number;
  };
}

export class OcrReviewModal {
  private container: HTMLElement;
  private diagramData: DiagramData;
  private rpcClient: RpcClient;
  private onApplySuccess: () => void;

  private modalEl: HTMLElement | null = null;
  private ocrResult: OcrRecognitionResult | null = null;

  // 交互式框选与旋转状态
  private rawDiagramImg: HTMLImageElement | null = null;
  private cropX0: number = 315;
  private cropY0: number = 180;
  private cropX1: number = 1946;
  private cropY1: number = 515;
  private currentAngleDeg: number = 45.0;

  private cropCanvas: HTMLCanvasElement | null = null;
  private cropCtx: CanvasRenderingContext2D | null = null;
  private rotPreviewCanvas: HTMLCanvasElement | null = null;
  private rotPreviewCtx: CanvasRenderingContext2D | null = null;

  // 交互式视口缩放与平移状态 (支持滚轮缩放与抓手平移)
  private cropScale: number = 0.5;
  private cropPanX: number = 0;
  private cropPanY: number = 0;
  private isPanning: boolean = false;
  private isDraggingCropBox: boolean = false;
  private dragMode: 'create' | 'move' | 'nw' | 'ne' | 'se' | 'sw' | null = null;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private initialCropState: { x0: number; y0: number; x1: number; y1: number } = { x0: 0, y0: 0, x1: 0, y1: 0 };

  constructor(
    container: HTMLElement,
    diagramData: DiagramData,
    rpcClient: RpcClient,
    onApplySuccess: () => void
  ) {
    this.container = container;
    this.diagramData = diagramData;
    this.rpcClient = rpcClient;
    this.onApplySuccess = onApplySuccess;
  }

  public async open(): Promise<void> {
    this.close();

    const cal = this.diagramData.calibration;
    this.cropX0 = Math.round(cal.dataXMin);
    this.cropX1 = Math.round(cal.dataXMax);
    this.cropY0 = Math.max(0, Math.round(cal.dataYMin - 335));
    this.cropY1 = Math.round(cal.dataYMin + 10);
    this.currentAngleDeg = 45.0;

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large ocr-review-dialog" style="width: min(1240px, 97vw); max-height: 95vh; display: flex; flex-direction: column;">
        <div class="modal-header" style="padding: 10px 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🔍</span>
            <h3 style="font-size: 13.5px; font-weight: 700;">花粉属种名 OCR 识别与审核汇总表 (Taxa OCR & Review)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #059669, #10b981); font-size: 10px; padding: 2px 6px;">PP-OCRv4 + 500+植物分类词典</span>
          </div>
          <button class="close-btn" id="ocr-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: hidden;">
          <!-- 阶段 1: 交互式视口 (支持滚轮缩放、鼠标自由拖拽框选) + 扶正水平实时预览 -->
          <div style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
                <span style="color: #38bdf8; font-weight: 700;">1. 🖱️ 鼠标框选标签范围:</span>
                <span id="ocr-crop-coords-label" style="font-family: var(--font-mono); color: #f8fafc; font-size: 11px;">
                  [X: ${this.cropX0}~${this.cropX1}, Y: ${this.cropY0}~${this.cropY1}]
                </span>
                <button class="tool-btn" id="btn-ocr-reset-crop" style="font-size: 10px; padding: 2px 7px;">重置范围</button>
                <span style="color: var(--text-muted); font-size: 10px;">(滚轮缩放 / 空格+拖拽平移)</span>
              </div>

              <!-- 旋转校正微调控件 -->
              <div style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
                <span style="color: #f59e0b; font-weight: 700;">2. 🔄 旋转校正:</span>
                <div style="display: flex; gap: 4px;">
                  <button class="tool-btn ocr-angle-btn active" data-angle="45" style="padding: 2px 7px; font-size: 10px; color: #38bdf8; border-color: #38bdf8;">45° (标准斜角)</button>
                  <button class="tool-btn ocr-angle-btn" data-angle="0" style="padding: 2px 7px; font-size: 10px;">0° (水平)</button>
                  <button class="tool-btn ocr-angle-btn" data-angle="60" style="padding: 2px 7px; font-size: 10px;">60° (陡峭)</button>
                  <button class="tool-btn ocr-angle-btn" data-angle="30" style="padding: 2px 7px; font-size: 10px;">30° (平缓)</button>
                </div>
                <input type="range" id="ocr-rng-angle" min="-90" max="90" step="1" value="45" style="width: 80px;" />
                <span id="ocr-val-angle" style="font-family: var(--font-mono); color: #f8fafc; min-width: 28px;">45°</span>

                <button id="btn-ocr-run" class="btn btn-primary" style="padding: 5px 16px; font-size: 11.5px; font-weight: 700; background: linear-gradient(135deg, #0284c7, #38bdf8);">
                  🚀 执行 OCR 识别
                </button>
              </div>
            </div>

            <!-- 双视口对比: 左侧高清框选画布 (支持缩放平移) / 右侧水平旋转实时预览 -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; height: 160px;">
              <!-- 交互式框选视口 -->
              <div id="ocr-cropper-container" style="position: relative; height: 100%; border-radius: 4px; overflow: hidden; background: #0b0f19; border: 1px solid rgba(255,255,255,0.15); user-select: none;">
                <canvas id="ocr-canvas-crop" style="position: absolute; inset: 0; width: 100%; height: 100%; cursor: crosshair;"></canvas>
                <div style="position: absolute; bottom: 4px; left: 6px; font-size: 9.5px; color: #94a3b8; background: rgba(0,0,0,0.7); padding: 1px 5px; border-radius: 2px; pointer-events: none;">
                  左键拖拽划定矩形 | 滚轮放大缩小 | 拖动边缘手柄精修
                </div>
              </div>

              <!-- 旋转扶正水平预览 -->
              <div style="position: relative; height: 100%; border-radius: 4px; overflow: hidden; background: #0b0f19; border: 1px solid rgba(255,255,255,0.15); display: flex; flex-direction: column;">
                <div style="flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; background: #ffffff;">
                  <canvas id="ocr-canvas-rotated" style="max-width: 100%; max-height: 100%; object-fit: contain;"></canvas>
                </div>
                <div style="position: absolute; bottom: 4px; left: 6px; font-size: 9.5px; color: #10b981; background: rgba(0,0,0,0.75); padding: 1px 5px; border-radius: 2px; pointer-events: none;">
                  ✓ 扶正水平效果预览 (文字水平印刷时 PP-OCR 准确率最高)
                </div>
              </div>
            </div>
          </div>

          <!-- 阶段 2: 集中式审核汇总表 (与图谱所有列完全对应) -->
          <div style="flex: 1; min-height: 220px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-light); border-radius: 6px; background: rgba(15, 23, 42, 0.6); padding: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; gap: 12px; font-size: 11px; align-items: center;">
                <span>识别属种列: <strong id="ocr-stat-total" style="color: var(--text-primary);">--</strong></span>
                <span style="color: #34d399;">✅ 自动准确: <strong id="ocr-stat-auto">--</strong></span>
                <span style="color: #f59e0b;">⚠️ 待确认: <strong id="ocr-stat-confirm">--</strong></span>
                <span style="color: #ef4444;">❌ 未识别: <strong id="ocr-stat-unrec">--</strong></span>
              </div>

              <div style="display: flex; gap: 6px;">
                <button id="btn-ocr-accept-all" class="tool-btn" style="font-size: 10.5px; padding: 3px 8px; color: #34d399; border-color: rgba(52,211,153,0.3);">✓ 全部接受</button>
                <button id="btn-ocr-skip-all" class="tool-btn" style="font-size: 10.5px; padding: 3px 8px; color: #94a3b8;">✗ 全部跳过</button>
              </div>
            </div>

            <!-- 表格区 -->
            <div style="flex: 1; overflow-y: auto; border: 1px solid rgba(255,255,255,0.08); border-radius: 4px;">
              <table class="wpd-preview-table" style="width: 100%;">
                <thead>
                  <tr>
                    <th style="width: 45px; text-align: center;">状态</th>
                    <th style="width: 140px; text-align: left;">对应图谱分列 (Column)</th>
                    <th style="width: 130px; text-align: left;">OCR 原始读数</th>
                    <th style="width: 200px; text-align: left;">建议属种名称 (拉丁学名 / 纠错)</th>
                    <th style="width: 120px; text-align: left;">生态与科属分组</th>
                    <th style="width: 80px; text-align: center;">采纳</th>
                  </tr>
                </thead>
                <tbody id="ocr-summary-tbody">
                  <tr><td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">点击上方“🚀 执行 OCR 识别”即可获取属种名单</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border-color);">
          <div style="font-size: 11px; color: var(--text-muted);">
            💡 确认无误后点击右下角按钮，将直接一键赋予图谱下方全部花粉列名与分类属性。
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" id="ocr-btn-cancel">取消</button>
            <button class="btn btn-primary" id="ocr-btn-apply" style="background: linear-gradient(135deg, #059669, #10b981);">
              ✅ 确认无误，一键赋予图谱各列
            </button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(modal);
    this.modalEl = modal;

    this.cropCanvas = modal.querySelector('#ocr-canvas-crop') as HTMLCanvasElement;
    this.cropCtx = this.cropCanvas.getContext('2d');
    this.rotPreviewCanvas = modal.querySelector('#ocr-canvas-rotated') as HTMLCanvasElement;
    this.rotPreviewCtx = this.rotPreviewCanvas.getContext('2d');

    // 绑定关闭
    modal.querySelector('#ocr-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#ocr-btn-cancel')?.addEventListener('click', () => this.close());

    // 批量按钮
    modal.querySelector('#btn-ocr-accept-all')?.addEventListener('click', () => this.handleBatchAccept(true));
    modal.querySelector('#btn-ocr-skip-all')?.addEventListener('click', () => this.handleBatchAccept(false));
    modal.querySelector('#btn-ocr-run')?.addEventListener('click', () => this.runOcrRecognition());
    modal.querySelector('#ocr-btn-apply')?.addEventListener('click', () => this.applyToDiagramColumns());

    // 重置默认框
    modal.querySelector('#btn-ocr-reset-crop')?.addEventListener('click', () => {
      this.cropX0 = Math.round(cal.dataXMin);
      this.cropX1 = Math.round(cal.dataXMax);
      this.cropY0 = Math.max(0, Math.round(cal.dataYMin - 335));
      this.cropY1 = Math.round(cal.dataYMin + 10);
      this.updateCropCoordsLabel();
      this.renderCropCanvas();
      this.renderRotatedPreview();
    });

    // 角度控制
    modal.querySelectorAll('.ocr-angle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.ocr-angle-btn').forEach((b) => {
          (b as HTMLElement).style.borderColor = '';
          (b as HTMLElement).style.color = '';
        });
        (btn as HTMLElement).style.borderColor = '#38bdf8';
        (btn as HTMLElement).style.color = '#38bdf8';
        const ang = parseFloat(btn.getAttribute('data-angle') || '45');
        this.currentAngleDeg = ang;
        const rng = modal.querySelector('#ocr-rng-angle') as HTMLInputElement;
        const valEl = modal.querySelector('#ocr-val-angle');
        if (rng) rng.value = String(ang);
        if (valEl) valEl.textContent = `${ang}°`;
        this.renderRotatedPreview();
      });
    });

    const rngAngle = modal.querySelector('#ocr-rng-angle') as HTMLInputElement;
    rngAngle?.addEventListener('input', () => {
      const ang = parseFloat(rngAngle.value);
      this.currentAngleDeg = ang;
      const valEl = modal.querySelector('#ocr-val-angle');
      if (valEl) valEl.textContent = `${ang}°`;
      this.renderRotatedPreview();
    });

    // 绑定鼠标交互框选与视口缩放/平移
    this.bindCropCanvasEvents();

    // 载入大图并初始渲染
    this.loadRawDiagramImage();
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  private loadRawDiagramImage(): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.rawDiagramImg = img;
      // 自动居中对齐到标签区域
      const w = img.naturalWidth || 1000;
      const h = img.naturalHeight || 800;
      const containerW = 580;
      const containerH = 160;

      // 缩放以展示完整的顶部 30% 区域
      this.cropScale = Math.min(containerW / w, containerH / (h * 0.45));
      this.cropPanX = (containerW - w * this.cropScale) / 2;
      this.cropPanY = - (this.cropY0 - 30) * this.cropScale;

      this.renderCropCanvas();
      this.renderRotatedPreview();
      this.runOcrRecognition();
    };
    img.src = `/image/current?t=${Date.now()}`;
  }

  private updateCropCoordsLabel(): void {
    const el = this.modalEl?.querySelector('#ocr-crop-coords-label');
    if (el) {
      el.textContent = `[X: ${Math.round(this.cropX0)}~${Math.round(this.cropX1)}, Y: ${Math.round(this.cropY0)}~${Math.round(this.cropY1)}]`;
    }
  }

  private bindCropCanvasEvents(): void {
    if (!this.cropCanvas) return;
    const canvas = this.cropCanvas;

    // 滚轮缩放
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const newScale = Math.max(0.15, Math.min(3.0, this.cropScale * zoomFactor));

      this.cropPanX = mouseX - (mouseX - this.cropPanX) * (newScale / this.cropScale);
      this.cropPanY = mouseY - (mouseY - this.cropPanY) * (newScale / this.cropScale);
      this.cropScale = newScale;

      this.renderCropCanvas();
    });

    // 鼠标按下：判断是拖动选框、拉伸角点还是平移画布
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click
      const rect = canvas.getBoundingClientRect();
      const clickScreenX = e.clientX - rect.left;
      const clickScreenY = e.clientY - rect.top;

      const imgX = (clickScreenX - this.cropPanX) / this.cropScale;
      const imgY = (clickScreenY - this.cropPanY) / this.cropScale;

      this.dragStartX = imgX;
      this.dragStartY = imgY;
      this.initialCropState = { x0: this.cropX0, y0: this.cropY0, x1: this.cropX1, y1: this.cropY1 };

      // Check if clicking inside current crop box to move it, or outside to draw a new one
      const inBox = imgX >= this.cropX0 && imgX <= this.cropX1 && imgY >= this.cropY0 && imgY <= this.cropY1;

      if (e.shiftKey || e.altKey) {
        this.isPanning = true;
      } else if (inBox) {
        this.isDraggingCropBox = true;
        this.dragMode = 'move';
      } else {
        this.isDraggingCropBox = true;
        this.dragMode = 'create';
        this.cropX0 = imgX;
        this.cropY0 = imgY;
        this.cropX1 = imgX + 10;
        this.cropY1 = imgY + 10;
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.cropCanvas || !this.rawDiagramImg) return;
      const rect = this.cropCanvas.getBoundingClientRect();
      const curScreenX = e.clientX - rect.left;
      const curScreenY = e.clientY - rect.top;

      if (this.isPanning) {
        this.cropPanX += e.movementX;
        this.cropPanY += e.movementY;
        this.renderCropCanvas();
        return;
      }

      if (!this.isDraggingCropBox) return;

      const curImgX = Math.max(0, Math.min(this.rawDiagramImg.naturalWidth, (curScreenX - this.cropPanX) / this.cropScale));
      const curImgY = Math.max(0, Math.min(this.rawDiagramImg.naturalHeight, (curScreenY - this.cropPanY) / this.cropScale));

      const dx = curImgX - this.dragStartX;
      const dy = curImgY - this.dragStartY;

      if (this.dragMode === 'create') {
        this.cropX0 = Math.min(this.dragStartX, curImgX);
        this.cropX1 = Math.max(this.dragStartX, curImgX);
        this.cropY0 = Math.min(this.dragStartY, curImgY);
        this.cropY1 = Math.max(this.dragStartY, curImgY);
      } else if (this.dragMode === 'move') {
        const w = this.initialCropState.x1 - this.initialCropState.x0;
        const h = this.initialCropState.y1 - this.initialCropState.y0;
        this.cropX0 = Math.max(0, this.initialCropState.x0 + dx);
        this.cropY0 = Math.max(0, this.initialCropState.y0 + dy);
        this.cropX1 = this.cropX0 + w;
        this.cropY1 = this.cropY0 + h;
      }

      this.updateCropCoordsLabel();
      this.renderCropCanvas();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingCropBox || this.isPanning) {
        this.isDraggingCropBox = false;
        this.isPanning = false;
        this.dragMode = null;

        if (this.cropX1 - this.cropX0 < 30) this.cropX1 = this.cropX0 + 80;
        if (this.cropY1 - this.cropY0 < 20) this.cropY1 = this.cropY0 + 80;

        this.renderCropCanvas();
        this.renderRotatedPreview();
      }
    });
  }

  private renderCropCanvas(): void {
    if (!this.cropCanvas || !this.cropCtx || !this.rawDiagramImg) return;
    const ctx = this.cropCtx;
    const img = this.rawDiagramImg;
    const canvas = this.cropCanvas;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.cropPanX, this.cropPanY);
    ctx.scale(this.cropScale, this.cropScale);

    // 1. 绘制底图
    ctx.drawImage(img, 0, 0);

    // 2. 半透明暗色遮罩
    ctx.fillStyle = 'rgba(11, 15, 25, 0.55)';
    ctx.fillRect(0, 0, img.naturalWidth, img.naturalHeight);

    // 3. 挖空并高亮选框区域
    const bx = this.cropX0;
    const by = this.cropY0;
    const bw = this.cropX1 - this.cropX0;
    const bh = this.cropY1 - this.cropY0;

    ctx.clearRect(bx, by, bw, bh);
    ctx.drawImage(img, bx, by, bw, bh, bx, by, bw, bh);

    // 4. 选框边框与角点手柄
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2 / this.cropScale;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
    ctx.fillRect(bx, by, bw, bh);

    // 绘制 4 个发光控制角手柄
    ctx.fillStyle = '#38bdf8';
    const handleSize = 6 / this.cropScale;
    ctx.fillRect(bx - handleSize/2, by - handleSize/2, handleSize, handleSize);
    ctx.fillRect(bx + bw - handleSize/2, by - handleSize/2, handleSize, handleSize);
    ctx.fillRect(bx + bw - handleSize/2, by + bh - handleSize/2, handleSize, handleSize);
    ctx.fillRect(bx - handleSize/2, by + bh - handleSize/2, handleSize, handleSize);

    ctx.restore();
  }

  private renderRotatedPreview(): void {
    if (!this.rotPreviewCanvas || !this.rotPreviewCtx || !this.rawDiagramImg) return;
    const ctx = this.rotPreviewCtx;
    const img = this.rawDiagramImg;

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

    // Scipy angle for clockwise rectification is -currentAngleDeg
    const rad = (-this.currentAngleDeg * Math.PI) / 180.0;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rotW = Math.round(bw * cos + bh * sin);
    const rotH = Math.round(bw * sin + bh * cos);

    this.rotPreviewCanvas.width = rotW;
    this.rotPreviewCanvas.height = rotH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rotW, rotH);

    ctx.save();
    ctx.translate(rotW / 2, rotH / 2);
    ctx.rotate(rad);
    ctx.drawImage(offCanvas, -bw / 2, -bh / 2);
    ctx.restore();
  }

  private async runOcrRecognition(): Promise<void> {
    if (!this.modalEl) return;
    const tbody = this.modalEl.querySelector('#ocr-summary-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #38bdf8; padding: 24px;">⏳ 正在以 ${this.currentAngleDeg}° 旋转扶正并执行 PP-OCRv4 识别与 500+ 植物学词典匹配...</td></tr>`;
    }

    try {
      const res = await this.rpcClient.call<any, { success: boolean; data: OcrRecognitionResult }>('ocr.recognizeLabels', {
        label_row_bbox: [this.cropX0, this.cropY0, this.cropX1, this.cropY1],
        angle_deg: this.currentAngleDeg,
      });

      if (res && res.success && res.data) {
        this.ocrResult = res.data;
        this.ocrResult.labels.forEach((l) => {
          l.accepted = l.status !== 'unrecognized';
          l.user_override_name = l.suggested_name;
        });

        this.renderSummaryTable();
        this.updateStats();
      } else {
        throw new Error('未识别到有效标签数据');
      }
    } catch (err: any) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #ef4444; padding: 24px;">❌ 识别失败: ${err.message || err}</td></tr>`;
      }
    }
  }

  private renderSummaryTable(): void {
    if (!this.modalEl || !this.ocrResult) return;
    const tbody = this.modalEl.querySelector('#ocr-summary-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Generate column-centric list: for each column in diagramData.columns, match against ocrResult.labels
    const cols = this.diagramData.columns;
    const labels = this.ocrResult.labels;

    // Build row for every detected column
    cols.forEach((col, cIdx) => {
      const colId = col.id || `taxa_${cIdx}`;
      const matchedLabel = labels.find((l) => l.associated_column_id === colId || l.associated_column_index === cIdx);

      const tr = document.createElement('tr');
      tr.id = `table-row-col-${colId}`;

      const rawText = matchedLabel ? matchedLabel.ocr_text : '--';
      const suggName = matchedLabel ? (matchedLabel.user_override_name || matchedLabel.suggested_name) : col.name;
      const groupText = matchedLabel ? matchedLabel.group : '未分类';
      const status = matchedLabel ? matchedLabel.status : 'unrecognized';
      const isAccepted = matchedLabel ? matchedLabel.accepted : false;

      let statusBadge = '✅ <span style="color:#34d399;font-size:10.5px;">自动</span>';
      if (status === 'confirm') {
        statusBadge = '⚠️ <span style="color:#f59e0b;font-size:10.5px;">待确认</span>';
      } else if (status === 'unrecognized' || !matchedLabel) {
        statusBadge = '⚪ <span style="color:#94a3b8;font-size:10.5px;">手动</span>';
      }

      tr.innerHTML = `
        <td style="text-align: center;">${statusBadge}</td>
        <td style="font-size: 11px;">
          <strong style="color: #38bdf8;">Col ${cIdx + 1} (${col.name})</strong>
          <span style="color: var(--text-muted); font-size: 9.5px; margin-left: 4px;">X:${Math.round(col.startX)}</span>
        </td>
        <td style="font-family: var(--font-mono); color: #f1f5f9; font-size: 11px;">${rawText}</td>
        <td>
          <input type="text" class="ocr-edit-input" data-col-id="${colId}" value="${suggName}" style="width: 100%; font-size: 11px; padding: 2px 6px; background: rgba(0,0,0,0.25); border: 1px solid var(--border-light); color: #f8fafc; border-radius: 3px;" />
        </td>
        <td style="color: var(--text-muted); font-size: 10.5px;">${groupText}</td>
        <td style="text-align: center;">
          <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer;">
            <input type="checkbox" class="ocr-accept-chk" data-col-id="${colId}" ${isAccepted || matchedLabel ? 'checked' : ''} />
            <span style="color: ${isAccepted || matchedLabel ? '#34d399' : '#94a3b8'};">采纳</span>
          </label>
        </td>
      `;

      // 监听就地编辑
      const input = tr.querySelector('.ocr-edit-input') as HTMLInputElement;
      input?.addEventListener('input', () => {
        if (matchedLabel) {
          matchedLabel.user_override_name = input.value;
        }
      });

      // 监听复选框
      const chk = tr.querySelector('.ocr-accept-chk') as HTMLInputElement;
      chk?.addEventListener('change', () => {
        if (matchedLabel) {
          matchedLabel.accepted = chk.checked;
        }
        const span = chk.parentElement?.querySelector('span');
        if (span) span.style.color = chk.checked ? '#34d399' : '#94a3b8';
      });

      tbody.appendChild(tr);
    });
  }

  private handleBatchAccept(accept: boolean): void {
    if (!this.ocrResult || !this.modalEl) return;
    this.ocrResult.labels.forEach((l) => {
      l.accepted = accept;
    });
    this.modalEl.querySelectorAll('.ocr-accept-chk').forEach((el) => {
      (el as HTMLInputElement).checked = accept;
      const span = el.parentElement?.querySelector('span');
      if (span) span.style.color = accept ? '#34d399' : '#94a3b8';
    });
  }

  private updateStats(): void {
    if (!this.modalEl || !this.ocrResult) return;
    const s = this.ocrResult.summary;
    const setVal = (id: string, val: number) => {
      const el = this.modalEl?.querySelector(id);
      if (el) el.textContent = String(val);
    };
    setVal('#ocr-stat-total', s.total);
    setVal('#ocr-stat-auto', s.auto);
    setVal('#ocr-stat-confirm', s.confirm);
    setVal('#ocr-stat-unrec', s.unrecognized);
  }

  private async applyToDiagramColumns(): Promise<void> {
    if (!this.modalEl) return;

    const confirmed: Array<{ associated_column_id: string; suggested_name: string; ocr_text: string }> = [];

    // Gather inputs from table
    this.modalEl.querySelectorAll('#ocr-summary-tbody tr').forEach((tr) => {
      const chk = tr.querySelector('.ocr-accept-chk') as HTMLInputElement;
      const inp = tr.querySelector('.ocr-edit-input') as HTMLInputElement;
      if (chk && chk.checked && inp && inp.value.trim()) {
        const colId = inp.getAttribute('data-col-id') || '';
        confirmed.push({
          associated_column_id: colId,
          suggested_name: inp.value.trim(),
          ocr_text: inp.value.trim(),
        });
      }
    });

    if (confirmed.length === 0) {
      alert('请至少勾选采纳 1 项属种名称！');
      return;
    }

    try {
      const res = await this.rpcClient.call<{ confirmed_labels: any[] }, any>('ocr.applyLabels', {
        confirmed_labels: confirmed,
      });

      if (res && res.success) {
        confirmed.forEach((item) => {
          const col = this.diagramData.columns.find((c) => c.id === item.associated_column_id || c.name === item.associated_column_id);
          if (col) {
            col.name = item.suggested_name;
            col.species = item.suggested_name;
          }
        });

        alert(`✅ 成功将 ${res.applied_count} 个经审核属种名赋予图谱各列！`);
        this.onApplySuccess();
        this.close();
      }
    } catch (err: any) {
      alert(`应用属种名称失败: ${err.message || err}`);
    }
  }
}
