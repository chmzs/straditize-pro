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
  private rpcClient: RpcClient;
  private diagramData: DiagramData;
  private onApplySuccess: () => void;

  private modalEl: HTMLElement | null = null;
  private ocrResult: OcrRecognitionResult | null = null;
  private activeHoverId: string | null = null;

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

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog modal-large ocr-review-dialog" style="width: min(1080px, 95vw); max-height: 92vh; display: flex; flex-direction: column;">
        <div class="modal-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🔍</span>
            <h3>花粉属种名 OCR 识别与审核汇总表 (Taxa OCR & Review)</h3>
            <span class="logo-badge" style="background: linear-gradient(135deg, #059669, #10b981); font-size: 10px; padding: 2px 6px;">PP-OCRv4 + 500种词典</span>
          </div>
          <button class="close-btn" id="ocr-close-btn">&times;</button>
        </div>

        <div class="modal-body" style="flex: 1; display: flex; flex-direction: column; gap: 12px; padding: 14px; overflow: hidden;">
          <!-- 1. 原图标签行矩形截图对照区 (横向滚动，不切碎，保持 45° 原位斜角) -->
          <div style="background: #0f172a; border: 1px solid var(--border-light); border-radius: 6px; padding: 10px; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-muted);">
              <span><strong>图谱顶部标签行原图对照 (Label Strip Screenshot)</strong> - 保持原图 45° 倾角，支持横向滚动</span>
              <span id="ocr-strip-meta">未载入</span>
            </div>

            <div id="ocr-strip-scroll-wrapper" style="width: 100%; height: 130px; overflow-x: auto; overflow-y: hidden; position: relative; border-radius: 4px; background: rgba(0,0,0,0.4); border: 1px dashed rgba(255,255,255,0.15);">
              <div id="ocr-strip-stage" style="position: relative; height: 100%; display: inline-block;">
                <img id="ocr-strip-img" style="height: 100%; object-fit: contain; display: block;" />
                <svg id="ocr-strip-overlay" style="position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none;"></svg>
              </div>
            </div>
          </div>

          <!-- 2. 统计摘要与全局批量操作栏 -->
          <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-tertiary); padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-light);">
            <div style="display: flex; gap: 14px; font-size: 11.5px; align-items: center;">
              <span>总属种: <strong id="ocr-stat-total" style="color: var(--text-primary);">--</strong></span>
              <span style="color: #34d399;">✅ 自动准确: <strong id="ocr-stat-auto">--</strong></span>
              <span style="color: #f59e0b;">⚠️ 待确认: <strong id="ocr-stat-confirm">--</strong></span>
              <span style="color: #ef4444;">❌ 未识别: <strong id="ocr-stat-unrec">--</strong></span>
            </div>

            <div style="display: flex; gap: 6px;">
              <button id="btn-ocr-accept-all" class="tool-btn" style="font-size: 11px; padding: 4px 10px; color: #34d399; border-color: rgba(52,211,153,0.3);">✓ 全部接受</button>
              <button id="btn-ocr-skip-all" class="tool-btn" style="font-size: 11px; padding: 4px 10px; color: #94a3b8;">✗ 全部跳过</button>
              <button id="btn-ocr-rerun" class="btn btn-primary" style="font-size: 11px; padding: 4px 10px; background: linear-gradient(135deg, #0284c7, #38bdf8);">🔄 重新识别</button>
            </div>
          </div>

          <!-- 3. 集中式审核汇总表 (Table Grid) -->
          <div style="flex: 1; min-height: 220px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: 6px; background: rgba(15, 23, 42, 0.6);">
            <table class="wpd-preview-table" style="width: 100%;">
              <thead>
                <tr>
                  <th style="width: 45px; text-align: center;">状态</th>
                  <th style="width: 110px; text-align: left;">OCR 原文</th>
                  <th style="width: 150px; text-align: left;">建议属种名称 (拉丁学名)</th>
                  <th style="width: 110px; text-align: left;">生态分组</th>
                  <th style="width: 120px; text-align: left;">对齐分列 (Column)</th>
                  <th style="width: 90px; text-align: center;">操作</th>
                </tr>
              </thead>
              <tbody id="ocr-summary-tbody">
                <tr><td colspan="6" style="text-align: center; color: #64748b; padding: 24px;">正在执行顶部标签行识别与词典匹配...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="modal-footer" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-top: 1px solid var(--border-color);">
          <div style="font-size: 11px; color: var(--text-muted);">
            💡 鼠标悬停表格任意行，原图对应标签自动发光高亮；确认后将一键更新下方全部花粉列名。
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

    // 绑定关闭
    modal.querySelector('#ocr-close-btn')?.addEventListener('click', () => this.close());
    modal.querySelector('#ocr-btn-cancel')?.addEventListener('click', () => this.close());

    // 批量按钮
    modal.querySelector('#btn-ocr-accept-all')?.addEventListener('click', () => this.handleBatchAccept(true));
    modal.querySelector('#btn-ocr-skip-all')?.addEventListener('click', () => this.handleBatchAccept(false));
    modal.querySelector('#btn-ocr-rerun')?.addEventListener('click', () => this.runOcrRecognition());

    // 确认应用
    modal.querySelector('#ocr-btn-apply')?.addEventListener('click', () => this.applyToDiagramColumns());

    // 触发识别
    await this.runOcrRecognition();
  }

  public close(): void {
    if (this.modalEl) {
      this.modalEl.remove();
      this.modalEl = null;
    }
  }

  private async runOcrRecognition(): Promise<void> {
    if (!this.modalEl) return;
    const tbody = this.modalEl.querySelector('#ocr-summary-tbody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #38bdf8; padding: 24px;">⏳ 正在倾角仿射扶正并执行高精度中拉花粉词典识别...</td></tr>`;
    }

    try {
      const res = await this.rpcClient.call<any, { success: boolean; data: OcrRecognitionResult }>('ocr.recognizeLabels', {
        angle_deg: -45.0,
      });

      if (res && res.success && res.data) {
        this.ocrResult = res.data;
        // 待确认项默认接受 (Section 3.2 规则)
        this.ocrResult.labels.forEach((l) => {
          l.accepted = l.status !== 'unrecognized';
          l.user_override_name = l.suggested_name;
        });

        this.renderStripImage();
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

  private renderStripImage(): void {
    if (!this.modalEl || !this.ocrResult) return;
    const imgEl = this.modalEl.querySelector('#ocr-strip-img') as HTMLImageElement;
    const metaEl = this.modalEl.querySelector('#ocr-strip-meta') as HTMLElement;

    if (imgEl && this.ocrResult.label_row_image) {
      imgEl.src = this.ocrResult.label_row_image;
      imgEl.onload = () => {
        this.renderSvgOverlay();
      };
    }

    if (metaEl) {
      const bb = this.ocrResult.label_row_bbox;
      metaEl.textContent = `范围: [X:${bb[0]}~${bb[2]}, Y:${bb[1]}~${bb[3]}] (${this.ocrResult.labels.length} 个标注)`;
    }
  }

  private renderSvgOverlay(): void {
    if (!this.modalEl || !this.ocrResult) return;
    const overlay = this.modalEl.querySelector('#ocr-strip-overlay') as SVGElement;
    const imgEl = this.modalEl.querySelector('#ocr-strip-img') as HTMLImageElement;
    if (!overlay || !imgEl) return;

    overlay.innerHTML = '';
    const natW = imgEl.naturalWidth || 1;
    const natH = imgEl.naturalHeight || 1;
    overlay.setAttribute('viewBox', `0 0 ${natW} ${natH}`);

    const bb = this.ocrResult.label_row_bbox;
    const globalX0 = bb[0];
    const globalY0 = bb[1];

    this.ocrResult.labels.forEach((label) => {
      const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      // Convert bbox from full diagram coordinates into strip-local coordinates
      const ptsStr = label.bbox
        .map(([gx, gy]) => `${gx - globalX0},${gy - globalY0}`)
        .join(' ');

      poly.setAttribute('points', ptsStr);
      poly.setAttribute('id', `svg-box-${label.id}`);
      poly.setAttribute('fill', label.id === this.activeHoverId ? 'rgba(56, 189, 248, 0.45)' : 'rgba(56, 189, 248, 0.12)');
      poly.setAttribute('stroke', label.id === this.activeHoverId ? '#38bdf8' : 'rgba(56, 189, 248, 0.6)');
      poly.setAttribute('stroke-width', label.id === this.activeHoverId ? '2.5' : '1.2');
      poly.style.pointerEvents = 'all';
      poly.style.cursor = 'pointer';

      // 联动高亮：悬停截图中标签 -> 表格对应行高亮
      poly.addEventListener('mouseenter', () => {
        this.setHoverHighlight(label.id);
      });
      poly.addEventListener('mouseleave', () => {
        this.setHoverHighlight(null);
      });

      overlay.appendChild(poly);
    });
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

      // 状态图标
      let statusBadge = '✅ <span style="color:#34d399;font-size:10.5px;">自动</span>';
      if (label.status === 'confirm') {
        statusBadge = '⚠️ <span style="color:#f59e0b;font-size:10.5px;">待确认</span>';
      } else if (label.status === 'unrecognized') {
        statusBadge = '❌ <span style="color:#ef4444;font-size:10.5px;">未识别</span>';
      }

      // 对齐分列显示
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

      // 联动高亮：悬停表格行 -> 截图中对应标签高亮
      tr.addEventListener('mouseenter', () => {
        this.setHoverHighlight(label.id);
      });
      tr.addEventListener('mouseleave', () => {
        this.setHoverHighlight(null);
      });

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

  private setHoverHighlight(labelId: string | null): void {
    this.activeHoverId = labelId;
    if (!this.modalEl || !this.ocrResult) return;

    // 1. 高亮表格行
    this.modalEl.querySelectorAll('#ocr-summary-tbody tr').forEach((r) => {
      (r as HTMLElement).style.background = '';
    });
    if (labelId) {
      const row = this.modalEl.querySelector(`#table-row-${labelId}`) as HTMLElement;
      if (row) row.style.background = 'rgba(56, 189, 248, 0.12)';
    }

    // 2. 高亮 SVG 框
    this.modalEl.querySelectorAll('#ocr-strip-overlay polygon').forEach((poly) => {
      poly.setAttribute('fill', 'rgba(56, 189, 248, 0.12)');
      poly.setAttribute('stroke', 'rgba(56, 189, 248, 0.6)');
      poly.setAttribute('stroke-width', '1.2');
    });

    if (labelId) {
      const activePoly = this.modalEl.querySelector(`#svg-box-${labelId}`);
      if (activePoly) {
        activePoly.setAttribute('fill', 'rgba(56, 189, 248, 0.55)');
        activePoly.setAttribute('stroke', '#38bdf8');
        activePoly.setAttribute('stroke-width', '2.5');
      }
    }
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
        // 同步更新前端当前图谱的列名
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
