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
  private cropY0: number = 190;
  private cropX1: number = 1946;
  private cropY1: number = 515;
  private currentAngleDeg: number = 45.0;

  private cropCanvas: HTMLCanvasElement | null = null;
  private cropCtx: CanvasRenderingContext2D | null = null;
  private rotPreviewCanvas: HTMLCanvasElement | null = null;
  private rotPreviewCtx: CanvasRenderingContext2D | null = null;

  private isDraggingCrop: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;

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
    this.cropY0 = Math.max(0, Math.round(cal.dataYMin - 330));
    this.cropY1 = Math.round(cal.dataYMin + 10);
    this.currentAngleDeg = 45.0;

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large ocr-review-dialog" style="width: min(1200px, 96vw); max-height: 94vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🔍</span>
            <h3>花粉属种名 OCR 识别与审核汇总表 (Taxa OCR & Review)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #059669, #10b981); font-size: 10px; padding: 2px 6px;">PP-OCRv4 + 500+植物词典</span>
          </div>
          <button class="close-btn" id="ocr-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: hidden;">
          <!-- 阶段 1: 鼠标交互框选 + 实时旋转校正视口 -->
          <div style="background: var(--bg-tertiary); border: 1px solid var(--border-light); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 10px; font-size: 11px;">
                <span style="color: #38bdf8; font-weight: 700;">1. 🖱️ 鼠标框选标签范围 (Mouse Drag to Crop):</span>
                <span id="ocr-crop-coords-label" style="font-family: var(--font-mono); color: #f8fafc; font-size: 10.5px;">
                  [X: ${this.cropX0}~${this.cropX1}, Y: ${this.cropY0}~${this.cropY1}]
                </span>
                <button class="tool-btn" id="btn-ocr-reset-crop" style="font-size: 10px; padding: 1px 6px;">重置默认框</button>
              </div>

              <!-- 旋转校正微调控件 -->
              <div style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
                <span style="color: #f59e0b; font-weight: 700;">2. 🔄 旋转校正 (Rotation):</span>
                <div style="display: flex; gap: 4px;">
                  <button class="tool-btn ocr-angle-btn active" data-angle="45" style="padding: 2px 6px; font-size: 10px; color: #38bdf8; border-color: #38bdf8;">45° (标准斜角)</button>
                  <button class="tool-btn ocr-angle-btn" data-angle="0" style="padding: 2px 6px; font-size: 10px;">0° (水平)</button>
                  <button class="tool-btn ocr-angle-btn" data-angle="60" style="padding: 2px 6px; font-size: 10px;">60° (陡峭)</button>
                  <button class="tool-btn ocr-angle-btn" data-angle="30" style="padding: 2px 6px; font-size: 10px;">30° (平缓)</button>
                </div>
                <input type="range" id="ocr-rng-angle" min="-90" max="90" step="1" value="45" style="width: 75px;" />
                <span id="ocr-val-angle" style="font-family: var(--font-mono); color: #f8fafc; min-width: 28px;">45°</span>

                <button id="btn-ocr-run" class="btn btn-primary" style="padding: 4px 14px; font-size: 11px; font-weight: 700; background: linear-gradient(135deg, #0284c7, #38bdf8);">
                  🚀 执行 OCR 识别
                </button>
              </div>
            </div>

            <!-- 双视口对比: 左侧框选交互画布 / 右侧旋转扶正水平预览 -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; height: 135px;">
              <!-- 框选交互画布 -->
              <div style="position: relative; height: 100%; border-radius: 4px; overflow: hidden; background: #0f172a; border: 1px solid rgba(255,255,255,0.1);">
                <canvas id="ocr-canvas-crop" style="width: 100%; height: 100%; object-fit: contain; cursor: crosshair;"></canvas>
                <div style="position: absolute; bottom: 4px; left: 6px; font-size: 9.5px; color: #94a3b8; background: rgba(0,0,0,0.6); padding: 1px 4px; border-radius: 2px; pointer-events: none;">
                  提示: 鼠标在此区域拖拽即可直接框选属种标签条带
                </div>
              </div>

              <!-- 旋转扶正水平预览 -->
              <div style="position: relative; height: 100%; border-radius: 4px; overflow: hidden; background: #0f172a; border: 1px solid rgba(255,255,255,0.1); display: flex; flex-direction: column;">
                <canvas id="ocr-canvas-rotated" style="width: 100%; height: 100%; object-fit: contain;"></canvas>
                <div style="position: absolute; bottom: 4px; left: 6px; font-size: 9.5px; color: #34d399; background: rgba(0,0,0,0.6); padding: 1px 4px; border-radius: 2px; pointer-events: none;">
                  扶正水平效果预览 (文字正立水平时识别率最高)
                </div>
              </div>
            </div>
          </div>

          <!-- 阶段 2: 审核汇总表与原图发光对照 (Table Grid) -->
          <div style="flex: 1; min-height: 220px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border-light); border-radius: 6px; background: rgba(15, 23, 42, 0.6); padding: 10px;">
            <!-- 统计摘要与批量操作 -->
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; gap: 12px; font-size: 11px; align-items: center;">
                <span>已识别属种: <strong id="ocr-stat-total" style="color: var(--text-primary);">--</strong></span>
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
                    <th style="width: 130px; text-align: left;">OCR 原文</th>
                    <th style="width: 180px; text-align: left;">建议属种名称 (拉丁学名)</th>
                    <th style="width: 120px; text-align: left;">生态分组</th>
                    <th style="width: 130px; text-align: left;">对齐分列 (Column)</th>
                    <th style="width: 80px; text-align: center;">操作</th>
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
      this.cropY0 = Math.max(0, Math.round(cal.dataYMin - 330));
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

    // 绑定鼠标交互框选事件
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
      this.renderCropCanvas();
      this.renderRotatedPreview();
      // 自动触发初始识别
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

    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const mx = (e.clientX - rect.left) * scaleX;
      const my = (e.clientY - rect.top) * scaleY;

      this.isDraggingCrop = true;
      this.dragStartX = mx;
      this.dragStartY = my;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDraggingCrop || !this.cropCanvas || !this.rawDiagramImg) return;
      const rect = this.cropCanvas.getBoundingClientRect();
      const scaleX = this.cropCanvas.width / rect.width;
      const scaleY = this.cropCanvas.height / rect.height;
      const curX = Math.max(0, Math.min(this.rawDiagramImg.naturalWidth, (e.clientX - rect.left) * scaleX));
      const curY = Math.max(0, Math.min(this.rawDiagramImg.naturalHeight, (e.clientY - rect.top) * scaleY));

      this.cropX0 = Math.min(this.dragStartX, curX);
      this.cropX1 = Math.max(this.dragStartX, curX);
      this.cropY0 = Math.min(this.dragStartY, curY);
      this.cropY1 = Math.max(this.dragStartY, curY);

      this.updateCropCoordsLabel();
      this.renderCropCanvas();
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingCrop) {
        this.isDraggingCrop = false;
        // Ensure minimal crop size
        if (this.cropX1 - this.cropX0 < 20) this.cropX1 = this.cropX0 + 50;
        if (this.cropY1 - this.cropY0 < 20) this.cropY1 = this.cropY0 + 50;
        this.renderCropCanvas();
        this.renderRotatedPreview();
      }
    });
  }

  private renderCropCanvas(): void {
    if (!this.cropCanvas || !this.cropCtx || !this.rawDiagramImg) return;
    const ctx = this.cropCtx;
    const img = this.rawDiagramImg;
    const w = img.naturalWidth || 1000;
    const h = img.naturalHeight || 800;

    this.cropCanvas.width = w;
    this.cropCanvas.height = h;

    // 绘制底图
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    // 暗化遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, w, h);

    // 高亮框选区域
    const bx = this.cropX0;
    const by = this.cropY0;
    const bw = this.cropX1 - this.cropX0;
    const bh = this.cropY1 - this.cropY0;

    ctx.clearRect(bx, by, bw, bh);
    ctx.drawImage(img, bx, by, bw, bh, bx, by, bw, bh);

    // 边框与发光效果
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.fillRect(bx, by, bw, bh);
  }

  private renderRotatedPreview(): void {
    if (!this.rotPreviewCanvas || !this.rotPreviewCtx || !this.rawDiagramImg) return;
    const ctx = this.rotPreviewCtx;
    const img = this.rawDiagramImg;

    const bx = Math.round(this.cropX0);
    const by = Math.round(this.cropY0);
    const bw = Math.max(1, Math.round(this.cropX1 - this.cropX0));
    const bh = Math.max(1, Math.round(this.cropY1 - this.cropY0));

    // Offscreen crop
    const offCanvas = document.createElement('canvas');
    offCanvas.width = bw;
    offCanvas.height = bh;
    const offCtx = offCanvas.getContext('2d');
    if (!offCtx) return;
    offCtx.drawImage(img, bx, by, bw, bh, 0, 0, bw, bh);

    // Rotate clockwise by -currentAngleDeg in standard canvas coords
    const rad = (this.currentAngleDeg * Math.PI) / 180.0;
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

    this.ocrResult.labels.forEach((label) => {
      const tr = document.createElement('tr');
      tr.id = `table-row-${label.id}`;
      tr.style.cursor = 'pointer';

      let statusBadge = '✅ <span style="color:#34d399;font-size:10.5px;">自动</span>';
      if (label.status === 'confirm') {
        statusBadge = '⚠️ <span style="color:#f59e0b;font-size:10.5px;">待确认</span>';
      } else if (label.status === 'unrecognized') {
        statusBadge = '❌ <span style="color:#ef4444;font-size:10.5px;">未识别</span>';
      }

      const colText = label.associated_column_name
        ? `<strong style="color:#38bdf8;">${label.associated_column_name}</strong> (X:${Math.round(label.anchor_x)})`
        : `<span style="color:#64748b;">未吸附</span>`;

      tr.innerHTML = `
        <td style="text-align: center;">${statusBadge}</td>
        <td style="font-family: var(--font-mono); color: #f1f5f9;">${label.ocr_text || '--'}</td>
        <td>
          <input type="text" class="ocr-edit-input" data-id="${label.id}" value="${label.user_override_name || label.suggested_name || ''}" style="width: 100%; font-size: 11px; padding: 2px 5px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-light); color: #f8fafc; border-radius: 3px;" />
        </td>
        <td style="color: var(--text-muted); font-size: 10.5px;">${label.group}</td>
        <td style="font-size: 10.5px;">${colText}</td>
        <td style="text-align: center;">
          <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer;">
            <input type="checkbox" class="ocr-accept-chk" data-id="${label.id}" ${label.accepted ? 'checked' : ''} />
            <span style="color: ${label.accepted ? '#34d399' : '#94a3b8'};">采纳</span>
          </label>
        </td>
      `;

      // 监听就地编辑
      const input = tr.querySelector('.ocr-edit-input') as HTMLInputElement;
      input?.addEventListener('input', () => {
        label.user_override_name = input.value;
      });

      // 监听复选框
      const chk = tr.querySelector('.ocr-accept-chk') as HTMLInputElement;
      chk?.addEventListener('change', () => {
        label.accepted = chk.checked;
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
    if (!this.ocrResult) return;

    const confirmed = this.ocrResult.labels
      .filter((l) => l.accepted && (l.user_override_name || l.suggested_name))
      .map((l) => ({
        associated_column_id: l.associated_column_id,
        suggested_name: l.user_override_name || l.suggested_name,
        ocr_text: l.ocr_text,
      }));

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
          const col = this.diagramData.columns.find((c) => c.id === item.associated_column_id);
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
