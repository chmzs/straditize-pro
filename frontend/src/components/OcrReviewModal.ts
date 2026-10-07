import { RpcClient } from '../services/RpcClient';
import { DiagramData } from '../types/pollen';
import { setLatestReconciliation } from './steps/NamingPanel';
import {
  OcrLabelEntry,
  OcrRecognitionResult,
  OcrCropperCanvas,
  OcrReviewTable,
  TaxaDictionaryModal,
} from './ocr';

export type { OcrLabelEntry, OcrRecognitionResult };

/**
 * 花粉属种名 OCR 识别与审核汇总表 (OcrReviewModal)
 *
 * 现代化粘合组装容器：
 * - OcrCropperCanvas: 负责带 8 方向控制手柄与视口缩放平移的标签裁切与旋转视口
 * - OcrReviewTable: 负责属种审校大表格渲染、就地编辑、统计指标与批量采纳
 * - TaxaDictionaryModal: 负责用户自定义属种词典管理子弹窗与期刊图版说明解析
 */
export class OcrReviewModal {
  private container: HTMLElement;
  private diagramData: DiagramData;
  private rpcClient: RpcClient;
  private onApplySuccess: () => void;

  private modalEl: HTMLElement | null = null;
  private cropperCanvas: OcrCropperCanvas | null = null;
  private reviewTable: OcrReviewTable | null = null;
  private dictModal: TaxaDictionaryModal | null = null;
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

  public async open(latestData?: DiagramData): Promise<void> {
    this.close();
    if (latestData) {
      this.diagramData = latestData;
    }

    const roi = this.diagramData.roi;
    const initialCropX0 = Math.round(roi.xMin);
    const initialCropX1 = Math.round(roi.xMax);
    const textBandHeight = Math.min(roi.yMin, Math.max(120, Math.round((roi.yMax - roi.yMin) * 0.35)));
    const initialCropY0 = Math.max(0, Math.round(roi.yMin - textBandHeight));
    const initialCropY1 = Math.round(roi.yMin + 15);

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large ocr-review-dialog">
        <div class="modal-header" style="padding: 10px 16px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🔍</span>
            <h3 style="font-size: 13.5px; font-weight: 700;">花粉属种名 OCR 识别与审核汇总表 (Taxa OCR & Review)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #059669, #10b981); font-size: 10px; padding: 2px 6px;" id="ocr-dict-badge">PP-OCRv6 + 内置词典</span>
            <button class="tool-btn" id="btn-ocr-taxa-dict" title="查看/导入自定义属种词汇表（补充内置词典未收录的微体古生物与地方特有种）" style="font-size: 10.5px; padding: 2px 8px; color: #7c3aed; border-color: rgba(124, 58, 237, 0.4);">
              📚 词汇表
            </button>
          </div>
          <button class="close-btn" id="ocr-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: hidden;">
          <!-- 1. 全宽交互式框选视口 (全宽交互画布，支持 8 向手柄自由调整边框与平移缩放) -->
          <div class="ocr-crop-card">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <strong style="color: var(--accent-blue, #0284c7); font-weight: 700;">1. 🖱️ 鼠标框选标签范围 (全宽交互画布):</strong>
                <span id="ocr-crop-coords-label" style="font-family: var(--font-mono); color: var(--text-primary); font-size: 11px; font-weight: 600;">
                  [X: ${initialCropX0}~${initialCropX1}, Y: ${initialCropY0}~${initialCropY1}]
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
            <!-- 左侧: 旋转扶正控制器与垂直条带预览栏 -->
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

    const cropCanvas = modal.querySelector('#ocr-canvas-crop') as HTMLCanvasElement;
    const rotPreviewCanvas = modal.querySelector('#ocr-canvas-rotated') as HTMLCanvasElement;

    // 1. 初始化各子模块
    this.cropperCanvas = new OcrCropperCanvas(
      modal,
      cropCanvas,
      rotPreviewCanvas,
      { x0: initialCropX0, y0: initialCropY0, x1: initialCropX1, y1: initialCropY1 }
    );
    this.cropperCanvas.loadRawDiagramImage();

    this.reviewTable = new OcrReviewTable(modal, this.diagramData);
    this.reviewTable.updateStats();

    this.dictModal = new TaxaDictionaryModal(this.rpcClient, async () => {
      const badge = modal.querySelector('#ocr-dict-badge') as HTMLElement | null;
      await TaxaDictionaryModal.refreshDictBadge(badge, this.rpcClient);
    });

    // 2. 绑定模态框交互事件
    modal.querySelector('#ocr-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#ocr-btn-cancel')?.addEventListener('click', () => this.close());

    modal.querySelector('#btn-ocr-accept-all')?.addEventListener('click', () => {
      this.reviewTable?.handleBatchAccept(true);
    });
    modal.querySelector('#btn-ocr-skip-all')?.addEventListener('click', () => {
      this.reviewTable?.handleBatchAccept(false);
    });

    modal.querySelector('#btn-ocr-run')?.addEventListener('click', () => {
      void this.runOcrRecognition();
    });
    modal.querySelector('#ocr-btn-apply')?.addEventListener('click', () => {
      void this.applyToDiagramColumns();
    });

    modal.querySelector('#btn-ocr-reset-crop')?.addEventListener('click', () => {
      const curRoi = this.diagramData.roi;
      const x0 = Math.round(curRoi.xMin);
      const x1 = Math.round(curRoi.xMax);
      const tbH = Math.min(curRoi.yMin, Math.max(120, Math.round((curRoi.yMax - curRoi.yMin) * 0.35)));
      const y0 = Math.max(0, Math.round(curRoi.yMin - tbH));
      const y1 = Math.round(curRoi.yMin + 15);
      this.cropperCanvas?.setCropBounds(x0, y0, x1, y1);
    });

    modal.querySelector('#btn-ocr-fit-crop')?.addEventListener('click', () => {
      this.cropperCanvas?.fitCropToView();
    });

    modal.querySelector('#btn-ocr-taxa-dict')?.addEventListener('click', () => {
      void this.dictModal?.open();
    });

    // 快捷角度胶囊切换与滑块控制
    const rng = modal.querySelector('#ocr-rng-angle') as HTMLInputElement | null;
    const valEl = modal.querySelector('#ocr-val-angle');
    modal.querySelectorAll('.ocr-angle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.ocr-angle-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const ang = parseFloat(btn.getAttribute('data-angle') || '45');
        this.cropperCanvas?.setAngle(ang);
        if (rng) rng.value = String(ang);
        if (valEl) valEl.textContent = `${ang}°`;
      });
    });

    rng?.addEventListener('input', () => {
      const ang = parseFloat(rng.value);
      this.cropperCanvas?.setAngle(ang);
      if (valEl) valEl.textContent = `${ang}°`;
      modal.querySelectorAll('.ocr-angle-btn').forEach((b) => {
        b.classList.toggle('active', parseFloat(b.getAttribute('data-angle') || '-999') === ang);
      });
    });

    // 3. 监听弹窗尺寸变化以自动重绘双画布
    const dialog = modal.querySelector('.modal-dialog');
    if (typeof ResizeObserver !== 'undefined' && dialog) {
      this.resizeObserver = new ResizeObserver(() => {
        this.cropperCanvas?.renderCropCanvas();
        this.cropperCanvas?.renderRotatedPreview();
      });
      this.resizeObserver.observe(dialog);
    }

    // 4. 初始化词汇表徽标
    const badgeEl = modal.querySelector('#ocr-dict-badge') as HTMLElement | null;
    void TaxaDictionaryModal.refreshDictBadge(badgeEl, this.rpcClient);
  }

  public close(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.cropperCanvas?.dispose();
    this.cropperCanvas = null;
    this.dictModal?.close();
    this.dictModal = null;
    this.reviewTable = null;
    this.modalEl?.remove();
    this.modalEl = null;
  }

  private async runOcrRecognition(): Promise<void> {
    if (!this.modalEl || !this.cropperCanvas || !this.reviewTable) return;
    const tbody = this.modalEl.querySelector('#ocr-summary-tbody');
    const angle = this.cropperCanvas.getAngle();
    const bounds = this.cropperCanvas.getCropBounds();

    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--accent-blue, #0284c7); padding: 24px;">⏳ 正在以 ${angle}° 旋转扶正并执行 PP-OCRv6 识别与 500+ 植物学词典匹配...</td></tr>`;
    }

    try {
      const res = await this.rpcClient.call<any, { success: boolean; data: OcrRecognitionResult }>('ocr.recognizeLabels', {
        label_row_bbox: [bounds.x0, bounds.y0, bounds.x1, bounds.y1],
        angle_deg: angle,
      });

      if (res && res.success && res.data) {
        const ocrResult = res.data;
        if ((res.data as any).reconciliation) {
          setLatestReconciliation((res.data as any).reconciliation);
        } else {
          const assigned: Record<string, string> = {};
          ocrResult.labels.forEach((l) => {
            if (l.associated_column_id) {
              assigned[l.id] = l.associated_column_id;
            } else {
              const matchedCol = (this.diagramData.columns || []).find(
                (c) => l.anchor_x >= c.startX && l.anchor_x < c.endX
              );
              if (matchedCol) {
                assigned[l.id] = matchedCol.id;
                l.associated_column_id = matchedCol.id;
              }
            }
          });
          const colsWithLabel = new Set(Object.values(assigned));
          const colsWithout = (this.diagramData.columns || []).map((c) => c.id).filter((id) => !colsWithLabel.has(id));
          setLatestReconciliation({
            columns_without_label: colsWithout,
            labels_without_column: ocrResult.labels.filter((l) => !assigned[l.id]).map((l) => l.id),
            ambiguous: [],
            matched: colsWithout.length === 0,
            assigned,
          });
        }
        ocrResult.labels.forEach((l) => {
          l.accepted = l.status !== 'unrecognized';
          l.user_override_name = l.suggested_name;
        });

        this.reviewTable.setOcrResult(ocrResult);
      } else {
        throw new Error('未识别到有效标签数据');
      }
    } catch (err: any) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--accent-red, #dc2626); padding: 24px;">❌ 识别失败: ${err.message || err}</td></tr>`;
      }
    }
  }

  private async applyToDiagramColumns(): Promise<void> {
    if (!this.modalEl || !this.reviewTable) return;
    const confirmed = this.reviewTable.getConfirmedLabels();

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

        this.onApplySuccess();
        this.close();
      }
    } catch (err: any) {
      alert(`应用属种名称失败: ${err.message || err}`);
    }
  }
}
