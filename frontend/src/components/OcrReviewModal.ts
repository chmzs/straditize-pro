import { RpcClient } from '../services/RpcClient';
import { DiagramData } from '../types/pollen';

export interface OcrLabelEntry {
  id: string;
  ocr_text: string;
  suggested_name: string;
  suggested_zh: string;
  group: string;
  cls?: string;
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

  // 1. 上栏框选画布视口缩放与平移状态
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

  // 2. 左侧旋转扶正预览视口缩放与平移状态 (与主视图同一套规范: 滚轮缩放 + 右键 / 中键 / 空格+左键 平移)
  private rotScale: number = 1.0;
  private rotPanX: number = 0;
  private rotPanY: number = 0;
  private isRotPanning: boolean = false;
  private rotDragStartX: number = 0;
  private rotDragStartY: number = 0;
  private rotStartPanX: number = 0;
  private rotStartPanY: number = 0;

  // 全局空格平移辅助
  private isSpaceDown: boolean = false;

  // 弹窗尺寸动态调整观察器 (支持用户右下角拖拽自由调节弹窗大小并自适应重绘)
  private resizeObserver: ResizeObserver | null = null;

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

    const roi = this.diagramData.roi;
    this.cropX0 = Math.round(roi.xMin);
    this.cropX1 = Math.round(roi.xMax);
    this.cropY0 = Math.max(0, Math.round(roi.yMin - 335));
    this.cropY1 = Math.round(roi.yMin + 10);
    this.currentAngleDeg = 45.0;

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large ocr-review-dialog">
        <div class="modal-header" style="padding: 10px 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🔍</span>
            <h3 style="font-size: 13.5px; font-weight: 700;">花粉属种名 OCR 识别与审核汇总表 (Taxa OCR & Review)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #059669, #10b981); font-size: 10px; padding: 2px 6px;" id="ocr-dict-badge">PP-OCRv4 + 内置词典</span>
            <button class="tool-btn" id="btn-ocr-taxa-dict" title="查看/导入自定义属种词汇表（补充内置词典未收录的微体古生物与地方特有种）" style="font-size: 10.5px; padding: 2px 8px; color: #7c3aed; border-color: rgba(124, 58, 237, 0.4);">
              📚 词汇表
            </button>
          </div>
          <button class="close-btn" id="ocr-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: hidden;">
          <!-- 1. 全宽交互式框选视口 (贯穿整个面板横向空间，支持 8 向手柄自由调整边框与滚轮缩放/右键 / 中键 / 空格+左键 平移) -->
          <div class="ocr-crop-card">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: var(--accent-blue, #0284c7); font-weight: 700;">1. 🖱️ 鼠标框选标签范围 (全宽交互画布):</strong>
                <span id="ocr-crop-coords-label" style="font-family: var(--font-mono); color: var(--text-primary); font-size: 11px; font-weight: 600;">
                  [X: ${this.cropX0}~${this.cropX1}, Y: ${this.cropY0}~${this.cropY1}]
                </span>
                <button class="tool-btn" id="btn-ocr-reset-crop" style="font-size: 10px; padding: 2px 8px;">重置选框</button>
                <button class="tool-btn" id="btn-ocr-fit-crop" style="font-size: 10px; padding: 2px 8px;">自适应视口</button>
              </div>
              <div style="font-size: 10.5px; color: var(--text-muted);">
                💡 拖拽 8 点手柄精修边框 | 滚轮缩放 | <b>右键 / 中键拖拽（或空格+左键）平移</b> | 双击复位
              </div>
            </div>

            <!-- 全宽高清框选画布容器 -->
            <div id="ocr-cropper-container" class="ocr-canvas-wrapper">
              <canvas id="ocr-canvas-crop" style="position: absolute; inset: 0; width: 100%; height: 100%;"></canvas>
            </div>
          </div>

          <!-- 下方主区域: 左侧垂直旋转扶正控制与预览栏 + 右侧集中式审核汇总表 -->
          <div style="flex: 1; min-height: 250px; display: flex; gap: 12px; overflow: hidden;">
            <!-- 左侧: 旋转扶正控制器与垂直条带预览栏 (全功能支持滚轮缩放与 右键 / 中键 / 空格+左键 平移) -->
            <div class="ocr-rot-card">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <strong style="font-size: 11px; color: var(--accent-orange, #ea580c);">2. 🔄 旋转校正与执行:</strong>
                <span id="ocr-val-angle" style="font-family: var(--font-mono); color: var(--accent-blue, #0284c7); font-weight: 700; font-size: 11px;">45°</span>
              </div>

              <!-- 快捷角度胶囊 -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
                <button class="tool-btn ocr-angle-btn active" data-angle="45" style="padding: 3px; font-size: 10px;">45° (标准斜角)</button>
                <button class="tool-btn ocr-angle-btn" data-angle="0" style="padding: 3px; font-size: 10px;">0° (水平)</button>
                <button class="tool-btn ocr-angle-btn" data-angle="60" style="padding: 3px; font-size: 10px;">60° (陡峭)</button>
                <button class="tool-btn ocr-angle-btn" data-angle="30" style="padding: 3px; font-size: 10px;">30° (平缓)</button>
              </div>

              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 10px; color: var(--text-muted);">-90°</span>
                <input type="range" id="ocr-rng-angle" min="-90" max="90" step="1" value="45" style="flex: 1;" />
                <span style="font-size: 10px; color: var(--text-muted);">+90°</span>
              </div>

              <!-- 执行按钮 -->
              <button id="btn-ocr-run" class="btn btn-primary" style="width: 100%; padding: 6px; font-size: 11.5px; font-weight: 700; background: linear-gradient(135deg, #0284c7, #38bdf8);">
                🚀 执行 OCR 识别
              </button>

              <!-- 垂直方向扶正预览视口 (交互式 Canvas 视口) -->
              <div class="ocr-rot-preview-wrapper">
                <div id="ocr-rot-canvas-box" class="ocr-rot-canvas-box">
                  <canvas id="ocr-canvas-rotated" style="position: absolute; inset: 0; width: 100%; height: 100%; display: block;"></canvas>
                </div>
                <div class="ocr-rot-status-bar">
                  <span style="font-weight: 600;">✓ 扶正水平效果预览</span>
                  <span style="font-size: 9.5px; color: var(--text-muted);">滚轮缩放 | 右键 / 中键拖拽（或空格+左键）平移 | 双击居中</span>
                </div>
              </div>
            </div>

            <!-- 右侧: 集中式审核汇总表 (按图谱分列顺序排列) -->
            <div class="ocr-table-card">
              <!-- 统计摘要与批量操作 -->
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 12px; font-size: 11px; align-items: center;">
                  <strong style="color: var(--text-primary);">3. 📋 属种审核与分列对齐:</strong>
                  <span>列数: <strong id="ocr-stat-total" style="color: var(--text-primary);">--</strong></span>
                  <span style="color: var(--accent-green, #059669);">✅ 自动准确: <strong id="ocr-stat-auto">--</strong></span>
                  <span style="color: var(--accent-amber, #d97706);">⚠️ 待确认: <strong id="ocr-stat-confirm">--</strong></span>
                  <span style="color: var(--accent-red, #dc2626);">❌ 未识别: <strong id="ocr-stat-unrec">--</strong></span>
                </div>

                <div style="display: flex; gap: 6px;">
                  <button id="btn-ocr-accept-all" class="tool-btn" style="font-size: 10.5px; padding: 3px 8px; color: var(--accent-green, #059669); border-color: rgba(5,150,105,0.3);">✓ 全部接受</button>
                  <button id="btn-ocr-skip-all" class="tool-btn" style="font-size: 10.5px; padding: 3px 8px; color: var(--text-muted);">✗ 全部跳过</button>
                </div>
              </div>

              <!-- 表格区 -->
              <div class="ocr-review-table-wrap">
                <table class="ocr-review-table">
                  <thead>
                    <tr>
                      <th style="width: 50px; text-align: center;">状态</th>
                      <th style="width: 145px; text-align: left;">对应图谱分列 (Column)</th>
                      <th style="width: 135px; text-align: left;">OCR 原始读数</th>
                      <th style="width: 195px; text-align: left;">建议属种名称 (拉丁学名 / 纠错)</th>
                      <th style="width: 125px; text-align: left;">生态与科属分组</th>
                      <th style="width: 65px; text-align: center;">采纳</th>
                    </tr>
                  </thead>
                  <tbody id="ocr-summary-tbody">
                    <tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 24px;">点击左侧“🚀 执行 OCR 识别”即可获取属种名单</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 18px;">
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

    // 重置默认框（OCR 标签带位于取数区顶界之上，用 ROI 而非深度标定）
    modal.querySelector('#btn-ocr-reset-crop')?.addEventListener('click', () => {
      const roi = this.diagramData.roi;
      this.cropX0 = Math.round(roi.xMin);
      this.cropX1 = Math.round(roi.xMax);
      this.cropY0 = Math.max(0, Math.round(roi.yMin - 335));
      this.cropY1 = Math.round(roi.yMin + 10);
      this.updateCropCoordsLabel();
      this.renderCropCanvas();
      this.resetRotView();
    });

    modal.querySelector('#btn-ocr-fit-crop')?.addEventListener('click', () => {
      this.fitCropToView();
    });

    // 词汇表查看 / 导入
    modal.querySelector('#btn-ocr-taxa-dict')?.addEventListener('click', () => {
      void this.openTaxaDictModal();
    });

    // 角度控制
    modal.querySelectorAll('.ocr-angle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.ocr-angle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const ang = parseFloat(btn.getAttribute('data-angle') || '45');
        this.currentAngleDeg = ang;
        const rng = modal.querySelector('#ocr-rng-angle') as HTMLInputElement;
        const valEl = modal.querySelector('#ocr-val-angle');
        if (rng) rng.value = String(ang);
        if (valEl) valEl.textContent = `${ang}°`;
        this.resetRotView();
      });
    });

    const rngAngle = modal.querySelector('#ocr-rng-angle') as HTMLInputElement;
    rngAngle?.addEventListener('input', () => {
      const ang = parseFloat(rngAngle.value);
      this.currentAngleDeg = ang;
      const valEl = modal.querySelector('#ocr-val-angle');
      if (valEl) valEl.textContent = `${ang}°`;
      modal.querySelectorAll('.ocr-angle-btn').forEach((b) => {
        const a = parseFloat(b.getAttribute('data-angle') || '999');
        b.classList.toggle('active', a === ang);
      });
      this.resetRotView();
    });

    // 绑定空格键全局平移辅助
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    // 绑定上栏画布与左侧预览画布的平移缩放交互
    this.bindCropCanvasEvents();
    this.bindRotPreviewEvents();

    // 监听弹窗自由缩放拉伸，自适应重绘画布视口
    const dialogEl = modal.querySelector('.ocr-review-dialog');
    if (dialogEl && window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.renderCropCanvas();
        this.renderRotatedPreview();
      });
      this.resizeObserver.observe(dialogEl);
    }

    // 载入大图并初始渲染
    this.loadRawDiagramImage();

    // 初始渲染已切分的各列表格
    this.renderSummaryTable();
    this.updateStats();
    if (this.diagramData.columns.length === 0) {
      const runBtn = modal.querySelector('#btn-ocr-run') as HTMLButtonElement;
      if (runBtn) {
        runBtn.disabled = true;
        runBtn.title = '当前图谱尚未切分属种列，请先完成 S3 分列后再执行 OCR';
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';
      }
    }

    // 刷新词汇表统计徽标
    void this.refreshDictBadge();
  }

  /** 读取后端词汇表统计并刷新标题徽标 */
  private async refreshDictBadge(): Promise<void> {
    const badge = this.modalEl?.querySelector('#ocr-dict-badge');
    if (!badge) return;
    try {
      const summary = await this.rpcClient.getTaxaDict();
      badge.textContent = `内置 ${summary.builtin_pollen_count} 花粉 + ${summary.builtin_npp_count} 微体指标 · 自定义 ${summary.custom_count}`;
      badge.setAttribute(
        'title',
        `内置花粉 ${summary.builtin_pollen_count} 条 / 内置微体古生物(NPP) ${summary.builtin_npp_count} 条 / 用户自定义 ${summary.custom_count} 条\n词汇表文件: ${summary.path}`
      );
    } catch (err: any) {
      badge.textContent = 'PP-OCRv4 + 内置词典';
      console.warn('getTaxaDict failed:', err?.message || err);
    }
  }

  /**
   * 词汇表管理弹窗：查看内置统计、列出用户自定义条目、导入/粘贴补充词汇。
   *
   * 格式：每行 `中文名,拉丁名[,分组]`，也支持制表符分隔与 `#` 注释。
   * 自定义词汇与内置词典并存（冗余保留），同名时以用户输入为准。
   */
  private async openTaxaDictModal(): Promise<void> {
    let summary;
    try {
      summary = await this.rpcClient.getTaxaDict();
    } catch (err: any) {
      alert(`无法读取词汇表: ${err?.message || err}`);
      return;
    }

    const dictModal = document.createElement('div');
    dictModal.className = 'modal-backdrop';
    dictModal.style.zIndex = '10000';
    dictModal.innerHTML = `
      <div class="modal-dialog" style="width: min(760px, 94vw); max-height: 88vh; display: flex; flex-direction: column;">
        <div class="modal-header" style="padding: 10px 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">📚</span>
            <h3 style="font-size: 13.5px; font-weight: 700;">属种词汇表 (Taxa Vocabulary)</h3>
          </div>
          <button class="close-btn" id="dict-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="padding: 12px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px;">
          <div class="tip-card" style="margin: 0; padding: 8px 10px; border-left: 3px solid #7c3aed; background: rgba(124, 58, 237, 0.06);">
            <p style="font-size: 11px; line-height: 1.6; color: var(--text-primary); margin: 0;">
              <strong>内置词典:</strong>
              花粉与孢子 <strong>${summary.builtin_pollen_count}</strong> 条 +
              微体古生物 / NPP（绿藻、硅藻、摇蚊、介形虫、粪生真菌孢子等）<strong>${summary.builtin_npp_count}</strong> 条。<br>
              <strong>自定义词汇:</strong> <strong>${summary.custom_count}</strong> 条。
              自定义条目与内置词典<strong>并存冗余保留</strong>，不会被内置词典覆盖。
            </p>
          </div>

          <div>
            <label style="font-size: 11px; font-weight: 600; display: block; margin-bottom: 4px;">
              导入补充词汇（<strong>可直接粘贴期刊图版说明</strong>，或每行一条 <code>中文名,拉丁名[,分组]</code>）
            </label>
            <textarea id="dict-import-input" rows="7" style="width: 100%; font-family: var(--font-mono); font-size: 11px; padding: 6px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); box-sizing: border-box;" placeholder="示例 1（直接粘贴论文图版说明，支持硬换行与 a), b) 多键前缀）：&#10;图版Ⅱ。a), b) Pediastrum boryanum var. boryanum; c) Pediastrum boryanum var. longicorne type 1; f) Pediastrum cf. argentinense; k), l) Pediastrum asymmetricum&#10;&#10;示例 2（每行一条）：&#10;水绵属,Spirogyra,绿藻类&#10;新疆落叶松,Larix sibirica,地方特有种"></textarea>
            <div style="display: flex; align-items: center; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
              <button class="tool-btn" id="dict-upload-file" style="font-size: 10.5px; padding: 3px 8px;">📄 从 CSV / TXT 文件导入</button>
              <input type="file" id="dict-file-input" accept=".csv,.txt,.tsv" style="display: none;" />
              <label style="font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="dict-replace-mode" />
                <span>清空已有自定义条目后写入（默认追加）</span>
              </label>
              <span id="dict-import-hint" style="font-size: 10.5px; color: var(--text-muted);"></span>
            </div>
            <div id="dict-import-preview" style="margin-top: 6px; font-size: 10.5px; color: var(--text-secondary); line-height: 1.7; max-height: 96px; overflow-y: auto;"></div>
          </div>

          <div>
            <strong style="font-size: 11px; display: block; margin-bottom: 4px;">当前自定义条目 (${summary.custom_count})</strong>
            <div id="dict-custom-list" style="max-height: 140px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 4px; padding: 6px; font-size: 10.5px; color: var(--text-secondary); line-height: 1.7;">
              ${summary.custom.length === 0
                ? '<em style="color: var(--text-muted);">暂无自定义条目</em>'
                : summary.custom.map((it) => `<div><code>${it.zh}</code> → <strong>${it.latin}</strong> <span style="color:var(--text-muted);">[${it.group}]</span></div>`).join('')}
            </div>
            <div style="font-size: 10px; color: var(--text-muted); margin-top: 4px; word-break: break-all;">
              词汇表文件: <code>${summary.path}</code>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: flex-end; gap: 8px; padding: 10px 16px;">
          <button class="btn btn-secondary" id="dict-cancel-btn">关闭</button>
          <button class="btn btn-primary" id="dict-save-btn" style="background: linear-gradient(135deg, #7c3aed, #a855f7);">💾 保存并应用</button>
        </div>
      </div>
    `;

    document.body.appendChild(dictModal);
    const closeDict = () => dictModal.remove();
    dictModal.querySelector('#dict-close-btn')?.addEventListener('click', closeDict);
    dictModal.querySelector('#dict-cancel-btn')?.addEventListener('click', closeDict);

    const fileInput = dictModal.querySelector('#dict-file-input') as HTMLInputElement;
    const textarea = dictModal.querySelector('#dict-import-input') as HTMLTextAreaElement;
    const hint = dictModal.querySelector('#dict-import-hint') as HTMLElement;
    const preview = dictModal.querySelector('#dict-import-preview') as HTMLElement;

    // 解析统一走后端：图版说明 / 名单两种形态在前端不重复实现，避免两套解析漂移。
    let previewTimer: number | null = null;
    const refreshPreview = () => {
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = window.setTimeout(async () => {
        const text = textarea.value.trim();
        if (!text) {
          preview.innerHTML = '';
          hint.textContent = '';
          return;
        }
        preview.innerHTML = '<em style="color: var(--text-muted);">解析中…</em>';
        try {
          const res = await this.rpcClient.parseTaxaText(text);
          if (res.count === 0) {
            preview.innerHTML = '<span style="color: var(--accent-amber, #d97706);">未解析出任何词汇，请检查格式</span>';
            return;
          }
          const kind = res.format === 'figure_caption' ? '📑 识别为期刊图版说明' : '📋 识别为名单';
          hint.textContent = `${kind} · 解析出 ${res.count} 条`;
          preview.innerHTML =
            `<strong>${kind}</strong>，将写入 ${res.count} 条：` +
            res.entries
              .map((e) => `<code style="color: var(--accent-blue, #0284c7);">${e.latin_name}</code>`)
              .join('、');
        } catch (err: any) {
          preview.innerHTML = `<span style="color: var(--accent-red, #dc2626);">解析失败: ${err?.message || err}</span>`;
        }
      }, 220);
    };
    textarea?.addEventListener('input', refreshPreview);

    dictModal.querySelector('#dict-upload-file')?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        textarea.value = textarea.value.trim() ? `${textarea.value.trim()}\n${text}` : text;
        hint.textContent = `已载入 ${file.name}`;
        refreshPreview();
      } catch (err: any) {
        hint.textContent = `读取失败: ${err?.message || err}`;
      }
      fileInput.value = '';
    });

    dictModal.querySelector('#dict-save-btn')?.addEventListener('click', async () => {
      const rawText = textarea.value.trim();
      const replaceMode = (dictModal.querySelector('#dict-replace-mode') as HTMLInputElement)?.checked ?? false;
      if (!rawText && !replaceMode) {
        hint.textContent = '请输入至少一条词汇';
        return;
      }
      const saveBtn = dictModal.querySelector('#dict-save-btn') as HTMLButtonElement;
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';
      try {
        const res = await this.rpcClient.saveCustomTaxa(
          { rawText },
          { mode: replaceMode ? 'replace' : 'append' }
        );
        hint.textContent = `✅ 已写入 ${res.added} 条，共 ${res.custom_count} 条自定义词汇`;
        await this.refreshDictBadge();
        closeDict();
      } catch (err: any) {
        hint.textContent = `❌ 保存失败: ${err?.message || err}`;
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 保存并应用';
      }
    });
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !this.isSpaceDown) {
      this.isSpaceDown = true;
      if (this.cropCanvas) this.cropCanvas.style.cursor = 'grab';
      const rotBox = this.modalEl?.querySelector('#ocr-rot-canvas-box') as HTMLElement;
      if (rotBox) rotBox.style.cursor = 'grab';
    }
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.isSpaceDown = false;
      if (this.cropCanvas && !this.isCropPanning) this.cropCanvas.style.cursor = 'crosshair';
      const rotBox = this.modalEl?.querySelector('#ocr-rot-canvas-box') as HTMLElement;
      if (rotBox && !this.isRotPanning) rotBox.style.cursor = 'grab';
    }
  };

  public close(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
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
      this.fitCropToView();
      this.resetRotView();
    };
    img.src = `/image/current?t=${Date.now()}`;
  }

  private fitCropToView(): void {
    if (!this.rawDiagramImg || !this.modalEl) return;
    const w = this.rawDiagramImg.naturalWidth || 1000;
    const container = this.modalEl.querySelector('#ocr-cropper-container') as HTMLElement;
    const containerW = container ? container.clientWidth : 1000;
    const containerH = container ? container.clientHeight : 175;

    // 自动以舒适比例聚焦到图谱顶部区域
    this.cropScale = Math.min(containerW / (w * 0.96), containerH / 380);
    this.cropPanX = (containerW - w * this.cropScale) / 2;
    this.cropPanY = - (this.cropY0 - 20) * this.cropScale;

    this.renderCropCanvas();
  }

  private resetRotView(): void {
    if (!this.modalEl) return;
    const rotBox = this.modalEl.querySelector('#ocr-rot-canvas-box') as HTMLElement;
    const boxW = rotBox ? rotBox.clientWidth : 320;
    const boxH = rotBox ? rotBox.clientHeight : 200;

    const bw = Math.max(10, Math.round(this.cropX1 - this.cropX0));
    const bh = Math.max(10, Math.round(this.cropY1 - this.cropY0));
    const rad = (this.currentAngleDeg * Math.PI) / 180.0;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rotW = Math.round(bw * cos + bh * sin);
    const rotH = Math.round(bw * sin + bh * cos);

    // 默认自适应垂直条带居中显示 (略留 8px 内边距)
    this.rotScale = Math.min((boxW - 16) / Math.max(1, rotW), (boxH - 16) / Math.max(1, rotH), 1.6);
    this.rotPanX = (boxW - rotW * this.rotScale) / 2;
    this.rotPanY = (boxH - rotH * this.rotScale) / 2;

    this.renderRotatedPreview();
  }

  private updateCropCoordsLabel(): void {
    const el = this.modalEl?.querySelector('#ocr-crop-coords-label');
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

    // 屏幕像素容差映射到图像坐标系 (约为 12 个屏幕像素)
    const tol = 12 / this.cropScale;

    // 1. 优先判定 4 个角手柄
    if (Math.abs(imgX - minX) <= tol && Math.abs(imgY - minY) <= tol) return 'nw';
    if (Math.abs(imgX - maxX) <= tol && Math.abs(imgY - minY) <= tol) return 'ne';
    if (Math.abs(imgX - maxX) <= tol && Math.abs(imgY - maxY) <= tol) return 'se';
    if (Math.abs(imgX - minX) <= tol && Math.abs(imgY - maxY) <= tol) return 'sw';

    // 2. 判定 4 条边框与边缘中点
    if (Math.abs(imgY - minY) <= tol && imgX >= minX - tol && imgX <= maxX + tol) return 'n';
    if (Math.abs(imgY - maxY) <= tol && imgX >= minX - tol && imgX <= maxX + tol) return 's';
    if (Math.abs(imgX - minX) <= tol && imgY >= minY - tol && imgY <= maxY + tol) return 'w';
    if (Math.abs(imgX - maxX) <= tol && imgY >= minY - tol && imgY <= maxY + tol) return 'e';

    // 3. 选框内部平移
    if (imgX > minX && imgX < maxX && imgY > minY && imgY < maxY) return 'move';

    // 4. 外部新建
    return 'create';
  }

  // ===================== 1. 上栏画布交互 (与主视图同一套规范: 滚轮缩放 + 右键 / 中键 / 空格+左键 平移 + 8向手柄调整) =====================
  private bindCropCanvasEvents(): void {
    if (!this.cropCanvas) return;
    const canvas = this.cropCanvas;

    // 滚轮缩放以鼠标所指处为锚点
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

    // 鼠标移动更新光标
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

    // 双击复位居中
    canvas.addEventListener('dblclick', () => {
      this.fitCropToView();
    });

    // 鼠标按下：与主视图同一套规范，右键 / 中键 / 空格+左键 三者等价
    canvas.addEventListener('mousedown', (e) => {
      const rect = canvas.getBoundingClientRect();
      const clickScreenX = e.clientX - rect.left;
      const clickScreenY = e.clientY - rect.top;

      // 统一交互：右键(2) 或 中键(1) 或 空格键+左键(0)
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

    // 屏蔽原生右键菜单
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.cropCanvas || !this.rawDiagramImg) return;

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
    });

    window.addEventListener('mouseup', () => {
      if (this.isCropPanning) {
        this.isCropPanning = false;
        if (this.cropCanvas) this.cropCanvas.style.cursor = this.isSpaceDown ? 'grab' : 'crosshair';
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
      }
    });
  }

  // ===================== 2. 左侧旋转扶正预览画布交互 (与主视图同一套规范: 滚轮缩放 + 右键 / 中键 / 空格+左键 平移) =====================
  private bindRotPreviewEvents(): void {
    if (!this.rotPreviewCanvas) return;
    const canvas = this.rotPreviewCanvas;
    const box = this.modalEl?.querySelector('#ocr-rot-canvas-box') as HTMLElement;

    // 滚轮缩放扶正视口
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

    // 双击复位居中
    canvas.addEventListener('dblclick', () => {
      this.resetRotView();
    });

    // 鼠标按下平移 (统一交互: 右键(2) 或 中键(1) 或 空格键+左键(0))
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

    window.addEventListener('mousemove', (e) => {
      if (!this.isRotPanning || !this.rotPreviewCanvas) return;
      this.rotPanX = this.rotStartPanX + (e.clientX - this.rotDragStartX);
      this.rotPanY = this.rotStartPanY + (e.clientY - this.rotDragStartY);
      this.renderRotatedPreview();
    });

    window.addEventListener('mouseup', () => {
      if (this.isRotPanning) {
        this.isRotPanning = false;
        if (box) box.classList.remove('is-panning');
      }
    });
  }

  // ===================== 画布渲染方法 (全面完美适配日间浅色模式与夜间深色模式) =====================
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
    const isLight = document.body.classList.contains('theme-light');

    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.cropPanX, this.cropPanY);
    ctx.scale(this.cropScale, this.cropScale);

    // 1. 绘制底图
    ctx.drawImage(img, 0, 0);

    // 2. 半透明遮罩 (日间洁净柔和浅色雾感，夜间科技深色)
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

    // 6. 绘制 8 个发光控制角手柄与边缘中点手柄 (支持 8 向交互微调)
    const hs = 9 / this.cropScale;
    const lw = 2 / this.cropScale;

    // 4 个角手柄：正方形 (白底、主题蓝描边)
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

    // 4 个边中点手柄：圆形点 (白底、主题蓝描边)
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

  private renderRotatedPreview(): void {
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
    // 视口平移与缩放矩阵变换
    ctx.translate(this.rotPanX, this.rotPanY);
    ctx.scale(this.rotScale, this.rotScale);

    // 在旋转目标区域后绘制卡片白底与精细边框
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

    // 绘制旋转视口外轮廓细线
    ctx.strokeStyle = isLight ? '#cbd5e1' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, rotW, rotH);

    ctx.restore();
  }

  private async runOcrRecognition(): Promise<void> {
    if (!this.modalEl) return;
    const tbody = this.modalEl.querySelector('#ocr-summary-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--accent-blue, #0284c7); padding: 24px;">⏳ 正在以 ${this.currentAngleDeg}° 旋转扶正并执行 PP-OCRv4 识别与 500+ 植物学词典匹配...</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--accent-red, #dc2626); padding: 24px;">❌ 识别失败: ${err.message || err}</td></tr>`;
      }
    }
  }

  private renderSummaryTable(): void {
    if (!this.modalEl) return;
    const tbody = this.modalEl.querySelector('#ocr-summary-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const cols = this.diagramData.columns;
    if (!cols || cols.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--accent-amber, #d97706); padding: 28px; line-height: 1.6;">
            ⚠️ <strong>当前图谱尚未切分属种列</strong><br>
            <span style="font-size: 11px; color: var(--text-muted);">
              列是在完成数据有效区 (ROI) 确认后分列产生的。<br>
              请先在主界面 S3 阶段完成分列（自动生成 col01, col02... 编号列），随后再使用 OCR 自动匹配列名。
            </span>
          </td>
        </tr>
      `;
      return;
    }

    const labels = this.ocrResult ? this.ocrResult.labels : [];

    cols.forEach((col, cIdx) => {
      const colId = col.id || `taxa_${cIdx}`;
      const matchedLabel = labels.find((l) => l.associated_column_id === colId || l.associated_column_index === cIdx);

      const tr = document.createElement('tr');
      tr.id = `table-row-col-${colId}`;

      const rawText = matchedLabel ? matchedLabel.ocr_text : '--';
      const suggName = matchedLabel ? (matchedLabel.user_override_name || matchedLabel.suggested_name) : col.name;
      const groupText = matchedLabel ? matchedLabel.group : (this.ocrResult ? '未分类' : '待匹配');
      const status = matchedLabel ? matchedLabel.status : (this.ocrResult ? 'unrecognized' : 'pending');
      const isAccepted = matchedLabel ? matchedLabel.accepted : false;

      let statusBadge = '<span style="color:var(--text-muted);font-weight:600;">⚪ 待识别</span>';
      if (status === 'auto') {
        statusBadge = '<span style="color:var(--accent-green, #059669);font-weight:600;">✅ 自动</span>';
      } else if (status === 'confirm') {
        statusBadge = '<span style="color:var(--accent-amber, #d97706);font-weight:600;">⚠️ 待确认</span>';
      } else if (status === 'unrecognized') {
        statusBadge = '<span style="color:var(--text-muted);font-weight:600;">⚪ 手动</span>';
      }

      tr.innerHTML = `
        <td style="text-align: center;">${statusBadge}</td>
        <td style="font-size: 11px;">
          <strong style="color: var(--accent-blue, #0284c7);">Col ${cIdx + 1} (${col.name})</strong>
          <span style="color: var(--text-muted); font-size: 9.5px; margin-left: 4px;">X:${Math.round(col.startX)}</span>
        </td>
        <td style="font-family: var(--font-mono); color: var(--text-primary); font-size: 11px;">${rawText}</td>
        <td>
          <input type="text" class="ocr-edit-input" data-col-id="${colId}" value="${suggName}" placeholder="${col.name}" />
        </td>
        <td style="color: var(--text-muted); font-size: 10.5px;">${groupText}</td>
        <td style="text-align: center;">
          <label style="display: inline-flex; align-items: center; gap: 4px; font-size: 11px; cursor: pointer;">
            <input type="checkbox" class="ocr-accept-chk" data-col-id="${colId}" ${isAccepted || (matchedLabel && isAccepted) ? 'checked' : ''} ${!matchedLabel ? 'disabled' : ''} />
            <span style="color: ${isAccepted ? 'var(--accent-green, #059669)' : 'var(--text-muted)'}; font-weight:600;">采纳</span>
          </label>
        </td>
      `;

      const input = tr.querySelector('.ocr-edit-input') as HTMLInputElement;
      input?.addEventListener('input', () => {
        if (matchedLabel) {
          matchedLabel.user_override_name = input.value;
        }
      });

      const chk = tr.querySelector('.ocr-accept-chk') as HTMLInputElement;
      chk?.addEventListener('change', () => {
        if (matchedLabel) {
          matchedLabel.accepted = chk.checked;
        }
        const span = chk.parentElement?.querySelector('span');
        if (span) span.style.color = chk.checked ? 'var(--accent-green, #059669)' : 'var(--text-muted)';
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
      if (span) span.style.color = accept ? 'var(--accent-green, #059669)' : 'var(--text-muted)';
    });
  }

  private updateStats(): void {
    if (!this.modalEl) return;
    const setVal = (id: string, val: string | number) => {
      const el = this.modalEl?.querySelector(id);
      if (el) el.textContent = String(val);
    };
    if (this.ocrResult) {
      const s = this.ocrResult.summary;
      setVal('#ocr-stat-total', s.total);
      setVal('#ocr-stat-auto', s.auto);
      setVal('#ocr-stat-confirm', s.confirm);
      setVal('#ocr-stat-unrec', s.unrecognized);
    } else {
      setVal('#ocr-stat-total', this.diagramData.columns.length);
      setVal('#ocr-stat-auto', 0);
      setVal('#ocr-stat-confirm', 0);
      setVal('#ocr-stat-unrec', this.diagramData.columns.length);
    }
  }

  private async applyToDiagramColumns(): Promise<void> {
    if (!this.modalEl) return;

    const confirmed: Array<{ associated_column_id: string; suggested_name: string; ocr_text: string }> = [];

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

        alert(`✅ 成功将 ${res.applied_count} 个经审核属种名赋予图谱各列（已更新默认 colxx 编号）！`);
        this.onApplySuccess();
        this.close();
      }
    } catch (err: any) {
      alert(`应用属种名称失败: ${err.message || err}`);
    }
  }
}
