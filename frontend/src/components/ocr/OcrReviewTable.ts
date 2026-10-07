import { DiagramData } from '../../types/pollen';
import { OcrRecognitionResult } from './types';

export class OcrReviewTable {
  private container: HTMLElement;
  private diagramData: DiagramData;
  private ocrResult: OcrRecognitionResult | null = null;

  constructor(container: HTMLElement, diagramData: DiagramData) {
    this.container = container;
    this.diagramData = diagramData;
  }

  public setDiagramData(data: DiagramData): void {
    this.diagramData = data;
    this.renderSummaryTable();
    this.updateStats();
  }

  public setOcrResult(res: OcrRecognitionResult | null): void {
    this.ocrResult = res;
    this.renderSummaryTable();
    this.updateStats();
  }

  public getOcrResult(): OcrRecognitionResult | null {
    return this.ocrResult;
  }

  public renderSummaryTable(): void {
    const tbody = this.container.querySelector('#ocr-summary-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const cols = this.diagramData.columns;
    if (!cols || cols.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; color: var(--accent-amber); padding: 28px; line-height: 1.6;">
            <strong>当前图谱尚未切分属种列</strong><br>
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
      const matchedLabel =
        labels.find((l) => l.associated_column_id === colId || l.associated_column_index === cIdx) ||
        labels.find((l) => l.anchor_x >= col.startX && l.anchor_x < col.endX);
      if (matchedLabel && !matchedLabel.associated_column_id) {
        matchedLabel.associated_column_id = colId;
        matchedLabel.associated_column_index = cIdx;
      }

      const tr = document.createElement('tr');
      tr.id = `table-row-col-${colId}`;

      const rawText = matchedLabel ? matchedLabel.ocr_text : '--';
      const suggName = matchedLabel ? (matchedLabel.user_override_name || matchedLabel.suggested_name) : col.name;
      const groupText = matchedLabel ? matchedLabel.group : (this.ocrResult ? '未分类' : '待匹配');
      const status = matchedLabel ? matchedLabel.status : (this.ocrResult ? 'unrecognized' : 'pending');
      const isAccepted = matchedLabel ? matchedLabel.accepted : false;

      let statusBadge = '<span style="color:var(--text-muted);font-weight:600;">待识别</span>';
      if (status === 'auto') {
        statusBadge = '<span style="color:var(--accent-green);font-weight:600;">自动</span>';
      } else if (status === 'confirm') {
        statusBadge = '<span style="color:var(--accent-amber);font-weight:600;">待确认</span>';
      } else if (status === 'unrecognized') {
        statusBadge = '<span style="color:var(--text-muted);font-weight:600;">手动</span>';
      }

      tr.innerHTML = `
        <td style="text-align: center;">${statusBadge}</td>
        <td style="font-size: 11px;">
          <strong style="color: var(--accent-blue);">Col ${cIdx + 1} (${col.name})</strong>
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
            <span style="color: ${isAccepted ? 'var(--accent-green)' : 'var(--text-muted)'}; font-weight:600;">采纳</span>
          </label>
        </td>
      `;

      const input = tr.querySelector('.ocr-edit-input') as HTMLInputElement | null;
      const chk = tr.querySelector('.ocr-accept-chk') as HTMLInputElement | null;

      input?.addEventListener('input', () => {
        if (matchedLabel) {
          matchedLabel.user_override_name = input.value;
        }
        if (chk && input.value.trim()) {
          chk.disabled = false;
          chk.checked = true;
          const span = chk.parentElement?.querySelector('span');
          if (span) span.style.color = 'var(--accent-green, #059669)';
        }
      });

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

  public handleBatchAccept(accept: boolean): void {
    if (!this.ocrResult) return;
    this.ocrResult.labels.forEach((l) => {
      l.accepted = accept;
    });
    this.container.querySelectorAll('.ocr-accept-chk').forEach((el) => {
      (el as HTMLInputElement).checked = accept;
      const span = el.parentElement?.querySelector('span');
      if (span) span.style.color = accept ? 'var(--accent-green, #059669)' : 'var(--text-muted)';
    });
  }

  public updateStats(): void {
    const setVal = (id: string, val: string | number) => {
      const el = this.container.querySelector(id);
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

  public getConfirmedLabels(): Array<{ associated_column_id: string; suggested_name: string; ocr_text: string }> {
    const confirmed: Array<{ associated_column_id: string; suggested_name: string; ocr_text: string }> = [];

    this.container.querySelectorAll('#ocr-summary-tbody tr').forEach((tr) => {
      const chk = tr.querySelector('.ocr-accept-chk') as HTMLInputElement | null;
      const inp = tr.querySelector('.ocr-edit-input') as HTMLInputElement | null;
      if (chk && chk.checked && inp && inp.value.trim()) {
        const colId = inp.getAttribute('data-col-id') || '';
        confirmed.push({
          associated_column_id: colId,
          suggested_name: inp.value.trim(),
          ocr_text: inp.value.trim(),
        });
      }
    });

    return confirmed;
  }
}
