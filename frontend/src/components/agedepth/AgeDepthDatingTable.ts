import { notify, notifyError } from '../../ui/feedback';
import {
  AgeDepthModelInspectionData,
  DatingPoint,
  MappedSamplesData,
} from './types';

export interface AgeDepthDatingTableCallbacks {
  onModelModified?: () => void;
  onDatingPointsChanged?: (points: DatingPoint[]) => void;
  onRequestSyncModel?: () => Promise<void>;
  onSwitchTab?: (tab: 'visual' | 'table' | 'modeling') => void;
}

/**
 * Renders a number. By default **exactly as computed** (full precision): every fixed
 * rounding scheme here has burned a user at some point (`Math.round(age)` collapsed a
 * smooth curve onto ~10 columns; `toFixed(1)` printed a real 0.04 ka/cm rate as
 * "0.0 yr/cm", which reads as "no deposition").
 *
 * But full precision is unreadable in a status line or a 17-digit CI, so the table now
 * exposes a display-precision control (the Format button). It is DISPLAY-ONLY: the
 * underlying values, the sync to the backend and the exports keep full precision; only
 * the rendered text is rounded. `null` means "raw value" (the default).
 */
let displayDecimals: number | null = null;

export function getDisplayDecimals(): number | null {
  return displayDecimals;
}

export function setDisplayDecimals(n: number | null): void {
  displayDecimals = n;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (displayDecimals === null) return String(value);
  return value.toFixed(displayDecimals);
}

export class AgeDepthDatingTable {
  private container: HTMLElement;
  private callbacks: AgeDepthDatingTableCallbacks;

  private tableMode: 'model' | 'samples' = 'model';
  private inspectionData: AgeDepthModelInspectionData | null = null;
  private mappedSamples: MappedSamplesData | null = null;
  private datingPoints: DatingPoint[] = [];
  /** Column currently driving the header sort; null = source order. */
  private sortKey: 'depth' | 'age' | 'min' | 'max' | null = null;
  private sortAsc = true;

  constructor(container: HTMLElement, callbacks: AgeDepthDatingTableCallbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.bindTableControls();
  }

  // --- Getters & Setters ---

  public getTableMode(): 'model' | 'samples' {
    return this.tableMode;
  }

  public setTableMode(mode: 'model' | 'samples'): void {
    this.tableMode = mode;
    this.renderFullDataTable();
    this.updateMappingTable();
  }

  public setInspectionData(data: AgeDepthModelInspectionData | null): void {
    this.inspectionData = data;
    this.renderFullDataTable();
    this.updateMappingTable();
    this.updateQualityAuditCard();
  }

  public setMappedSamples(samples: MappedSamplesData | null): void {
    this.mappedSamples = samples;
    this.renderFullDataTable();
    this.updateMappingTable();
  }

  public setDatingPoints(points: DatingPoint[]): void {
    this.datingPoints = points;
    this.renderDatingTable();
  }

  public getDatingPoints(): DatingPoint[] {
    return this.getDatingTableData();
  }

  // --- Geological Parameters & Event Bounds ---

  public getSelectedThickness(): number {
    const activeBtn = this.container.querySelector('.ad-btn-thick.active');
    return activeBtn ? parseFloat(activeBtn.getAttribute('data-thick') || '5') : 5.0;
  }

  public getHiatusDepths(): number[] | undefined {
    const chk = this.container.querySelector('#ad-chk-hiatus') as HTMLInputElement | null;
    if (chk && chk.checked) {
      const val = (this.container.querySelector('#ad-inp-hiatus-depth') as HTMLInputElement | null)?.value.trim();
      if (val) {
        const d = parseFloat(val);
        if (!isNaN(d)) return [d];
      }
    }
    return undefined;
  }

  public getDeltaR(): number | undefined {
    const chk = this.container.querySelector('#ad-chk-dr') as HTMLInputElement | null;
    if (chk && chk.checked) {
      const val = (this.container.querySelector('#ad-inp-dr-val') as HTMLInputElement | null)?.value;
      if (val) return parseFloat(val);
    }
    return undefined;
  }

  public getDeltaRStd(): number | undefined {
    const chk = this.container.querySelector('#ad-chk-dr') as HTMLInputElement | null;
    if (chk && chk.checked) {
      const val = (this.container.querySelector('#ad-inp-dr-std') as HTMLInputElement | null)?.value;
      if (val) return parseFloat(val);
    }
    return undefined;
  }

  public getDatingTableData(): DatingPoint[] {
    const rows = this.container.querySelectorAll('#ad-dating-tbody tr');
    if (!rows || rows.length === 0) return this.datingPoints;

    const list: DatingPoint[] = [];
    rows.forEach((tr, idx) => {
      const inps = tr.querySelectorAll('input');
      const sel = tr.querySelector('select');
      if (inps.length >= 5) {
        list.push({
          id: inps[0].value.trim() || `14C_${idx + 1}`,
          depth: parseFloat(inps[1].value) || 0,
          age: parseFloat(inps[2].value) || 0,
          error: parseFloat(inps[3].value) || 30,
          thickness: parseFloat(inps[4].value) || 1,
          cc: sel ? parseInt(sel.value, 10) : 1,
        });
      }
    });
    this.datingPoints = list;
    return list;
  }

  // --- Rendering Tab 3: Dating Table ---

  public renderDatingTable(): void {
    const tbody = this.container.querySelector('#ad-dating-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    this.datingPoints.forEach((p, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" class="ad-date-id" value="${p.id}" style="width:100%;font-size:10px;" /></td>
        <td><input type="number" class="ad-date-depth" value="${p.depth}" style="width:100%;font-size:10px;" /></td>
        <td><input type="number" class="ad-date-age" value="${p.age}" style="width:100%;font-size:10px;" /></td>
        <td><input type="number" class="ad-date-error" value="${p.error}" style="width:100%;font-size:10px;" /></td>
        <td><input type="number" class="ad-date-thick" value="${p.thickness}" style="width:100%;font-size:10px;" /></td>
        <td>
          <select class="ad-date-cc" style="width:100%;font-size:9.5px;">
            <option value="1" ${p.cc === 1 ? 'selected' : ''}>IntCal20</option>
            <option value="2" ${p.cc === 2 ? 'selected' : ''}>Marine20</option>
            <option value="3" ${p.cc === 3 ? 'selected' : ''}>SHCal20</option>
            <option value="0" ${p.cc === 0 ? 'selected' : ''}>Non-14C</option>
          </select>
        </td>
        <td style="text-align: center;">
          <button class="icon-btn btn-del-date-row" data-idx="${idx}" style="color: var(--accent-red); font-size: 13px; cursor: pointer; background: none; border: none; padding: 0 4px;">&times;</button>
        </td>
      `;
      tr.querySelector('.ad-date-id')?.addEventListener('change', (e) => {
        p.id = (e.target as HTMLInputElement).value.trim() || p.id;
        this.callbacks.onDatingPointsChanged?.(this.datingPoints);
      });
      tr.querySelector('.ad-date-depth')?.addEventListener('change', (e) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          p.depth = v;
          this.callbacks.onDatingPointsChanged?.(this.datingPoints);
        }
      });
      tr.querySelector('.ad-date-age')?.addEventListener('change', (e) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          p.age = v;
          this.callbacks.onDatingPointsChanged?.(this.datingPoints);
        }
      });
      tr.querySelector('.ad-date-error')?.addEventListener('change', (e) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          p.error = v;
          this.callbacks.onDatingPointsChanged?.(this.datingPoints);
        }
      });
      tr.querySelector('.ad-date-thick')?.addEventListener('change', (e) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          p.thickness = v;
          this.callbacks.onDatingPointsChanged?.(this.datingPoints);
        }
      });
      tr.querySelector('.ad-date-cc')?.addEventListener('change', (e) => {
        p.cc = parseInt((e.target as HTMLSelectElement).value, 10) || 0;
        this.callbacks.onDatingPointsChanged?.(this.datingPoints);
      });
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll('.btn-del-date-row').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rowIdx = parseInt((btn as HTMLElement).getAttribute('data-idx') || '-1', 10);
        if (rowIdx >= 0 && rowIdx < this.datingPoints.length) {
          this.datingPoints.splice(rowIdx, 1);
          this.renderDatingTable();
          this.callbacks.onDatingPointsChanged?.(this.datingPoints);
        }
      });
    });
  }

  public addDateRow(): void {
    const nextNum = this.datingPoints.length + 1;
    const lastDepth = this.datingPoints.length > 0 ? this.datingPoints[this.datingPoints.length - 1].depth + 20 : 10;
    const lastAge = this.datingPoints.length > 0 ? this.datingPoints[this.datingPoints.length - 1].age + 500 : 500;
    this.datingPoints.push({
      id: `14C_${nextNum}`,
      depth: lastDepth,
      age: lastAge,
      error: 30,
      thickness: 1,
      cc: 1,
    });
    this.renderDatingTable();
    this.callbacks.onDatingPointsChanged?.(this.datingPoints);
  }

  // --- Rendering Side Mapping Table ---

  public updateMappingTable(): void {
    const tbody = this.container.querySelector('#ad-mapping-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!this.inspectionData) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 12px;">尚未执行识别提取</td></tr>`;
      return;
    }

    const rates = this.mappedSamples?.rate;
    const unitsEl = this.container.querySelector('#ad-rate-units');
    if (unitsEl) {
      unitsEl.textContent = rates?.units?.acc_rate ? `${rates.units.acc_rate}` : '';
    }
    const accMid = rates?.acc_rate_yr_per_depth;
    const accLo = rates?.acc_rate_yr_per_depth_min;
    const accHi = rates?.acc_rate_yr_per_depth_max;
    // Significant digits, not fixed decimals: rates run from 0.008 to 1200 on real figures,
    // so `toFixed(2)` printed "0.01" and "1200.00" for values that are precise to six digits.
    const fmt = (v: number | null | undefined): string =>
      v === null || v === undefined || !Number.isFinite(v) ? '—' : formatNumber(v);
    const rateCell = (i: number): string => {
      const mid = accMid?.[i];
      if (mid === undefined) {
        return '<td style="color:var(--text-muted); font-size:9px;">—</td>';
      }
      if (mid === null) {
        return '<td style="color:var(--accent-amber); font-size:9px;" title="瞬时沉积层：该段历时为 0，速率无定义">∞</td>';
      }
      return (
        `<td style="color:var(--text-secondary); font-size:9.5px;">${fmt(mid)}` +
        `<br><span style="color:var(--text-muted); font-size:8.5px;">${fmt(accLo?.[i])}–${fmt(accHi?.[i])}</span></td>`
      );
    };

    if (this.tableMode === 'samples' && this.mappedSamples?.depths && this.mappedSamples.depths.length > 0) {
      const ms = this.mappedSamples;
      for (let i = 0; i < ms.depths.length; i++) {
        const tr = document.createElement('tr');
        const minVal = ms.age_min ? ms.age_min[i] : Math.max(0, ms.age_est[i] - 100);
        const maxVal = ms.age_max ? ms.age_max[i] : ms.age_est[i] + 100;
        tr.innerHTML = `
          <td style="font-weight: 600; color: var(--accent-blue); padding: 1px 2px;">${ms.depths[i]} cm</td>
          <td style="padding: 1px 2px;">
            <input type="number" step="any" class="ad-tbl-input ad-input-side-sample-age" data-idx="${i}" value="${formatNumber(ms.age_est[i])}" style="font-size: 10px; font-weight: 600;" />
          </td>
          <td style="padding: 1px 2px;">
            <div style="display: flex; gap: 2px; align-items: center;">
              <input type="number" step="any" class="ad-tbl-input ad-input-side-sample-min" data-idx="${i}" value="${formatNumber(minVal)}" style="font-size: 9px;" />
              <span style="color: var(--text-muted); font-size: 9px;">~</span>
              <input type="number" step="any" class="ad-tbl-input ad-input-side-sample-max" data-idx="${i}" value="${formatNumber(maxVal)}" style="font-size: 9px;" />
            </div>
          </td>
          ${rateCell(i)}
        `;
        tbody.appendChild(tr);
      }

      tbody.querySelectorAll('.ad-input-side-sample-age').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && this.mappedSamples) {
            this.mappedSamples.age_est[idx] = v;
            this.renderFullDataTable();
          }
        });
      });
      tbody.querySelectorAll('.ad-input-side-sample-min').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && this.mappedSamples) {
            if (!this.mappedSamples.age_min) this.mappedSamples.age_min = [...this.mappedSamples.age_est];
            this.mappedSamples.age_min[idx] = v;
            this.renderFullDataTable();
          }
        });
      });
      tbody.querySelectorAll('.ad-input-side-sample-max').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && this.mappedSamples) {
            if (!this.mappedSamples.age_max) this.mappedSamples.age_max = [...this.mappedSamples.age_est];
            this.mappedSamples.age_max[idx] = v;
            this.renderFullDataTable();
          }
        });
      });

      this.updateQualityAuditCard();
      return;
    }

    const d = this.inspectionData.depths;
    const a = this.inspectionData.ages;
    const mi = this.inspectionData.age_min || a;
    const ma = this.inspectionData.age_max || a;

    for (let i = 0; i < d.length; i++) {
      const tr = document.createElement('tr');
      const isInverted = i > 0 && a[i] < a[i - 1];
      if (isInverted) tr.classList.add('ad-row-inversion');

      let rateStr = '—';
      if (i > 0 && d[i] !== d[i - 1]) {
        const da = Math.abs(a[i] - a[i - 1]);
        const dd = Math.abs(d[i] - d[i - 1]);
        // Significant digits, not toFixed(1): a 0.04 ka/cm rate printed as "0.0".
        rateStr = formatNumber(da / Math.max(1e-12, dd));
      }

      tr.innerHTML = `
        <td style="font-weight: 600; color: var(--accent-blue); padding: 1px 2px;">
          <input type="number" step="any" class="ad-tbl-input ad-input-side-depth" data-idx="${i}" value="${d[i]}" style="font-size: 10px;" />
        </td>
        <td style="padding: 1px 2px;">
          <input type="number" step="any" class="ad-tbl-input ad-input-side-age" data-idx="${i}" value="${formatNumber(a[i])}" style="font-size: 10px; font-weight: 600;" />
        </td>
        <td style="padding: 1px 2px;">
          <div style="display: flex; gap: 2px; align-items: center;">
            <input type="number" step="any" class="ad-tbl-input ad-input-side-min" data-idx="${i}" value="${formatNumber(mi[i])}" style="font-size: 9px;" />
            <span style="color: var(--text-muted); font-size: 9px;">~</span>
            <input type="number" step="any" class="ad-tbl-input ad-input-side-max" data-idx="${i}" value="${formatNumber(ma[i])}" style="font-size: 9px;" />
          </div>
        </td>
        <td style="color: var(--text-secondary); font-size: 9px;">${rateStr}</td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('.ad-input-side-depth').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) this.onModelPointEdited(idx, 'depth', v);
      });
    });
    tbody.querySelectorAll('.ad-input-side-age').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) this.onModelPointEdited(idx, 'age', v);
      });
    });
    tbody.querySelectorAll('.ad-input-side-min').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) this.onModelPointEdited(idx, 'min', v);
      });
    });
    tbody.querySelectorAll('.ad-input-side-max').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) this.onModelPointEdited(idx, 'max', v);
      });
    });

    this.updateQualityAuditCard();
  }

  // --- Rendering Tab 2: Full Data Table ---

  public renderFullDataTable(): void {
    const tbody = this.container.querySelector('#ad-full-table-tbody');
    const badge = this.container.querySelector('#ad-table-summary-badge');
    if (!tbody) return;

    if (!this.inspectionData || this.inspectionData.depths.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">尚未执行识别提取或载入年代模型</td></tr>`;
      if (badge) badge.textContent = '共 0 个层位';
      return;
    }

    tbody.innerHTML = '';

    if (this.tableMode === 'samples' && this.mappedSamples?.depths?.length) {
      const ms = this.mappedSamples;
      if (badge) badge.textContent = `花粉样品层位: 共 ${ms.depths.length} 个样品`;
      const sed = ms.sedimentation;
      for (let i = 0; i < ms.depths.length; i++) {
        const tr = document.createElement('tr');
        const d = ms.depths[i];
        const a = ms.age_est[i];
        const mi = ms.age_min ? ms.age_min[i] : Math.max(0, a - 100);
        const ma = ms.age_max ? ms.age_max[i] : a + 100;
        const width = Math.abs(ma - mi);
        // Windowed rate (cm/yr) + its standard error in separate cells, mirroring the
        // model table. The pointwise finite-difference fallback below is yr/cm, so its
        // unit label is stated inline to keep the two apart.
        let rateHtml = '—';
        let seHtml = '—';
        if (sed && Array.isArray(sed.sed_rate) && i < sed.sed_rate.length) {
          const mid = sed.sed_rate[i];
          if (mid === null || mid === undefined || !Number.isFinite(mid)) {
            const why = sed.status?.[i] || '';
            rateHtml = `<span style="color:var(--status-warning);" title="该层位速率未定义（${why}）">—</span>`;
          } else {
            rateHtml = `${formatNumber(mid)} <span style="color:var(--text-muted);font-size:9px;">cm/yr</span>`;
            const se = sed.sed_rate_se?.[i];
            seHtml = se !== null && se !== undefined && Number.isFinite(se)
              ? `± ${formatNumber(se)}`
              : '—';
          }
        } else if (i > 0 && d !== ms.depths[i - 1]) {
          const acc = Math.abs(a - ms.age_est[i - 1]) / Math.abs(d - ms.depths[i - 1]);
          rateHtml = `${formatNumber(acc)} <span style="color:var(--text-muted);font-size:9px;">yr/cm</span>`;
        }
        const isInverted = i > 0 && a < ms.age_est[i - 1];
        if (isInverted) tr.classList.add('ad-row-inversion');

        tr.innerHTML = `
          <td style="text-align: center; color: var(--text-muted);">${i + 1}</td>
          <td style="font-weight: 600; color: var(--accent-blue);">${formatNumber(d)} cm</td>
          <td><input type="number" step="any" class="ad-tbl-input ad-input-full-sample-age" data-idx="${i}" value="${formatNumber(a)}" /></td>
          <td><input type="number" step="any" class="ad-tbl-input ad-input-full-sample-min" data-idx="${i}" value="${formatNumber(mi)}" /></td>
          <td><input type="number" step="any" class="ad-tbl-input ad-input-full-sample-max" data-idx="${i}" value="${formatNumber(ma)}" /></td>
          <td style="color: var(--text-muted); font-size: 10px;">${formatNumber(width)}</td>
          <td style="color: var(--text-secondary); font-size: 10px;">${rateHtml}</td>
          <td style="color: var(--text-muted); font-size: 9.5px;">${seHtml}</td>
          <td style="text-align: center; color: var(--text-muted); font-size: 9px;">样品层位</td>
        `;
        tbody.appendChild(tr);
      }

      tbody.querySelectorAll('.ad-input-full-sample-age').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && this.mappedSamples) {
            this.mappedSamples.age_est[idx] = v;
            this.updateMappingTable();
          }
        });
      });
      tbody.querySelectorAll('.ad-input-full-sample-min').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && this.mappedSamples) {
            if (!this.mappedSamples.age_min) this.mappedSamples.age_min = [...this.mappedSamples.age_est];
            this.mappedSamples.age_min[idx] = v;
            this.updateMappingTable();
          }
        });
      });
      tbody.querySelectorAll('.ad-input-full-sample-max').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v) && this.mappedSamples) {
            if (!this.mappedSamples.age_max) this.mappedSamples.age_max = [...this.mappedSamples.age_est];
            this.mappedSamples.age_max[idx] = v;
            this.updateMappingTable();
          }
        });
      });
      return;
    }

    const d = this.inspectionData.depths;
    const a = this.inspectionData.ages;
    const mi = this.inspectionData.age_min || a;
    const ma = this.inspectionData.age_max || a;
    // Row-aligned windowed rates from the backend (already decimated to THESE rows).
    // Length guard: add/delete rows invalidate the alignment; edits clear the arrays in
    // onModelPointEdited. When absent, the rate cells fall back to a neighbour difference
    // and the SE cells stay empty -- never a misaligned number from another horizon.
    const hasAlignedRates =
      Array.isArray(this.inspectionData.sed_rate) &&
      this.inspectionData.sed_rate.length === d.length;
    const sedRate = hasAlignedRates ? this.inspectionData!.sed_rate! : null;
    const sedSe = hasAlignedRates ? this.inspectionData!.sed_rate_se || null : null;

    if (badge) {
      badge.textContent = `共 ${d.length} 个层位 ｜ 深度 ${formatNumber(d[0]) || 0} ~ ${formatNumber(d[d.length - 1]) || 0} cm ｜ 年代 ${formatNumber(a[0]) || 0} ~ ${formatNumber(a[a.length - 1]) || 0} cal BP`;
    }

    // Header sort is a DISPLAY permutation only: the model arrays stay in their original
    // order, data-idx keeps pointing at the original row, and sync/export never see the
    // sort. (The toolbar's 按深度升序 button remains a genuine data-normalising action.)
    const order = this.displayOrder(d, a, mi, ma);

    for (let pos = 0; pos < order.length; pos++) {
      const i = order[pos];
      const tr = document.createElement('tr');
      const depth = d[i];
      const age = a[i];
      const minVal = mi[i] !== undefined ? mi[i] : Math.max(0, age - 100);
      const maxVal = ma[i] !== undefined ? ma[i] : age + 100;
      const width = Math.abs(maxVal - minVal);
      // Inversion is a property of the chronology (deeper = older), so it is evaluated
      // against the original-order neighbour, never the display neighbour.
      const isInverted = i > 0 && age < a[i - 1];
      if (isInverted) tr.classList.add('ad-row-inversion');

      let rateHtml: string;
      let seHtml: string;
      if (sedRate) {
        const mid = sedRate[i];
        if (mid === null || mid === undefined || !Number.isFinite(mid)) {
          rateHtml = '<span style="color:var(--status-warning);" title="该层位速率未定义（窗口内年代不倒进）">—</span>';
          seHtml = '—';
        } else {
          rateHtml = formatNumber(mid);
          const se = sedSe ? sedSe[i] : null;
          seHtml = se !== null && se !== undefined && Number.isFinite(se)
            ? `± ${formatNumber(se)}`
            : '—';
        }
      } else if (i > 0 && depth !== d[i - 1]) {
        // Fallback finite difference against the ORIGINAL-order neighbour (not display).
        const acc = Math.abs(age - a[i - 1]) / Math.abs(depth - d[i - 1]);
        rateHtml = `${formatNumber(acc)} <span style="color:var(--text-muted);font-size:9px;">yr/cm</span>`;
        seHtml = '—';
      } else {
        rateHtml = '—';
        seHtml = '—';
      }

      tr.innerHTML = `
        <td style="text-align: center; color: var(--text-muted);">${pos + 1}</td>
        <td><input type="number" step="any" class="ad-tbl-input ad-input-full-depth" data-idx="${i}" value="${formatNumber(depth)}" /></td>
        <td><input type="number" step="any" class="ad-tbl-input ad-input-full-age" data-idx="${i}" value="${formatNumber(age)}" /></td>
        <td><input type="number" step="any" class="ad-tbl-input ad-input-full-min" data-idx="${i}" value="${formatNumber(minVal)}" /></td>
        <td><input type="number" step="any" class="ad-tbl-input ad-input-full-max" data-idx="${i}" value="${formatNumber(maxVal)}" /></td>
        <td style="color: var(--text-muted); font-size: 10px;">${formatNumber(width)}</td>
        <td style="color: var(--text-secondary); font-size: 10px;">${rateHtml}</td>
        <td style="color: var(--text-muted); font-size: 9.5px;">${seHtml}</td>
        <td style="text-align: center;">
          <button class="ui-btn ui-btn--quiet ui-btn--xs ad-btn-del-full-row" data-idx="${i}" title="删除此行" style="padding: 1px 6px; font-size: 9.5px; color: var(--accent-red);">✕</button>
        </td>
      `;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('.ad-input-full-depth').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          this.onModelPointEdited(idx, 'depth', v);
          this.updateMappingTable();
        }
      });
    });
    tbody.querySelectorAll('.ad-input-full-age').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          this.onModelPointEdited(idx, 'age', v);
          this.updateMappingTable();
        }
      });
    });
    tbody.querySelectorAll('.ad-input-full-min').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          this.onModelPointEdited(idx, 'min', v);
          this.updateMappingTable();
        }
      });
    });
    tbody.querySelectorAll('.ad-input-full-max').forEach((inp) => {
      inp.addEventListener('change', (e) => {
        const idx = parseInt((e.target as HTMLElement).getAttribute('data-idx') || '0', 10);
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) {
          this.onModelPointEdited(idx, 'max', v);
          this.updateMappingTable();
        }
      });
    });
    tbody.querySelectorAll('.ad-btn-del-full-row').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).getAttribute('data-idx') || '0', 10);
        this.deleteTableRow(idx);
      });
    });
  }

  /**
   * Display permutation for the model table. The arrays themselves are never reordered
   * by a header click -- `data-idx`, the canvas overlay and the synced model all keep
   * working in original order; only the row sequence changes. Null sort key = source order.
   */
  private displayOrder(
    d: number[],
    a: number[],
    mi: number[],
    ma: number[]
  ): number[] {
    const idx = d.map((_, i) => i);
    if (this.sortKey === null) return idx;
    const col =
      this.sortKey === 'depth' ? d :
      this.sortKey === 'age' ? a :
      this.sortKey === 'min' ? mi : ma;
    const dir = this.sortAsc ? 1 : -1;
    idx.sort((x, y) => {
      const vx = col[x];
      const vy = col[y];
      // Non-finite (null rates serialise to null, never for depths, but be safe) sinks.
      const fx = Number.isFinite(vx) ? vx : Infinity;
      const fy = Number.isFinite(vy) ? vy : Infinity;
      return fx === fy ? x - y : (fx < fy ? -1 : 1) * dir;
    });
    return idx;
  }

  /** Header click: toggle direction on the same column, or switch columns ascending. */
  public sortByColumn(key: 'depth' | 'age' | 'min' | 'max'): void {
    if (this.sortKey === key) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortKey = key;
      this.sortAsc = true;
    }
    this.renderFullDataTable();
    this.updateSortIndicators();
  }

  private updateSortIndicators(): void {
    this.container.querySelectorAll<HTMLElement>('.ad-th-sortable').forEach((th) => {
      const ind = th.querySelector('.ad-sort-ind');
      if (!ind) return;
      const key = th.getAttribute('data-sort');
      ind.textContent =
        key && key === this.sortKey ? (this.sortAsc ? '▲' : '▼') : '';
    });
  }

  /**
   * Display precision for every number in this dialog (Format button). Display-only:
   * the underlying arrays, the sync to the backend, and exports keep the raw values.
   * Empty selection = raw values (default).
   */
  public applyDisplayPrecision(raw: string): void {
    if (raw === '') {
      setDisplayDecimals(null);
    } else {
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0 || n > 12) {
        notifyError('格式位数须为 0–12 的整数。');
        return;
      }
      setDisplayDecimals(n);
    }
    this.renderFullDataTable();
    this.updateMappingTable();
  }

  // --- Quality Audit Card ---
  public updateQualityAuditCard(): void {
    const card = this.container.querySelector('#ad-quality-card') as HTMLElement | null;
    const badge = this.container.querySelector('#ad-qc-badge') as HTMLElement | null;
    const details = this.container.querySelector('#ad-qc-details') as HTMLElement | null;
    if (!card || !badge || !details) return;

    if (!this.inspectionData) {
      card.style.display = 'none';
      return;
    }

    const d = this.inspectionData.depths || [];
    const a = this.inspectionData.ages || [];
    const mi = this.inspectionData.age_min || [];
    const ma = this.inspectionData.age_max || [];

    if (d.length === 0 || a.length === 0) {
      card.style.display = 'none';
      return;
    }

    let inversions = 0;
    for (let i = 1; i < a.length; i++) {
      if (a[i] < a[i - 1]) {
        inversions++;
      }
    }

    let totalSpan = 0;
    let validSpanCount = 0;
    for (let i = 0; i < d.length; i++) {
      if (ma[i] !== undefined && mi[i] !== undefined) {
        totalSpan += Math.abs(ma[i] - mi[i]);
        validSpanCount++;
      }
    }
    const avgSpan =
      validSpanCount > 0 ? formatNumber(totalSpan / validSpanCount) : '—';
    const depthSpan = formatNumber(Math.abs(d[d.length - 1] - d[0]));

    card.style.display = 'block';

    if (inversions === 0) {
      badge.textContent = '质量优良 (单调)';
      // 用状态 token，不写死 hex。裸 `#10b981` 是深色主题的绿，浅色主题下
      // 官方值是 `#047857`（5.48:1），硬编码的绿在浅色底上对比度不足，看起来"不协调"。
      badge.style.background = 'color-mix(in srgb, var(--status-success) 15%, transparent)';
      badge.style.color = 'var(--status-success)';
      badge.style.border = '1px solid color-mix(in srgb, var(--status-success) 40%, transparent)';
    } else {
      badge.textContent = `发现 ${inversions} 处年代倒置`;
      badge.style.background = 'color-mix(in srgb, var(--accent-red) 15%, transparent)';
      badge.style.color = 'var(--accent-red)';
      badge.style.border = '1px solid color-mix(in srgb, var(--accent-red) 40%, transparent)';
    }

    details.innerHTML = `
      <div>• 深度跨度: <b>${formatNumber(d[0])} ~ ${formatNumber(d[d.length - 1])} cm</b> (跨 ${depthSpan} cm, ${d.length} 个点位)</div>
      <div>• 年代跨度: <b>${formatNumber(a[0])} ~ ${formatNumber(a[a.length - 1])} cal BP</b> (平均 95% CI 宽度: ±${avgSpan} yr)</div>
      ${inversions > 0 ? '<div style="color:var(--accent-red);">• 提示: 存在年代倒置，建议在倒置深度处修改表格数值、使用【微调 (V)】或拖框排除杂斑。</div>' : '<div style="color:var(--status-success);">• 年代单调递增，无层位倒置，拟合曲线连续平滑。</div>'}
    `;
  }

  // --- Row Manipulation & Import/Export ---

  public onModelPointEdited(
    idx: number,
    field: 'depth' | 'age' | 'min' | 'max',
    value: number
  ): void {
    if (!this.inspectionData) return;
    if (field === 'depth') {
      this.inspectionData.depths[idx] = value;
    } else if (field === 'age') {
      this.inspectionData.ages[idx] = value;
    } else if (field === 'min') {
      if (!this.inspectionData.age_min) this.inspectionData.age_min = [...this.inspectionData.ages];
      this.inspectionData.age_min[idx] = value;
    } else if (field === 'max') {
      if (!this.inspectionData.age_max) this.inspectionData.age_max = [...this.inspectionData.ages];
      this.inspectionData.age_max[idx] = value;
    }
    // Any edited row makes the attached windowed rates stale (they were fitted to the
    // pre-edit curve). Drop them; the table falls back to a finite difference recomputed
    // from the CURRENT values, which cannot display a stale number as a live one.
    this.invalidateWindowedRates();

    this.updateQualityAuditCard();
    this.callbacks.onModelModified?.();
  }

  /** Drop the attached windowed rates; see onModelPointEdited for why. */
  private invalidateWindowedRates(): void {
    if (!this.inspectionData) return;
    this.inspectionData.sed_rate = undefined;
    this.inspectionData.sed_rate_se = undefined;
    this.inspectionData.sed_window_depth = undefined;
  }

  public addTableRow(): void {
    if (!this.inspectionData) {
      notifyError('请先运行提取或载入年代模型！');
      return;
    }
    // The samples view renders mappedSamples (depths inherited from the pollen diagram's
    // columns); this button appends to the MODEL arrays, so in that view it genuinely did
    // nothing the user could see -- a silent no-op, one of the reported symptoms. Say so
    // and switch to the view where the new row actually appears.
    if (this.tableMode === 'samples') {
      this.tableMode = 'model';
      this.container.querySelector('#ad-tbl-view-model')?.classList.add('active');
      this.container.querySelector('#ad-tbl-view-samples')?.classList.remove('active');
      const sideBtn = this.container.querySelector('#ad-btn-toggle-side-table') as HTMLElement | null;
      if (sideBtn) sideBtn.textContent = '全量模型';
      notify('已切换到「提取全量模型层位」视图：添加层位作用于模型数组，样品视图只显示花粉采样层位。', 'info');
    }
    const d = this.inspectionData.depths;
    const a = this.inspectionData.ages;
    const mi = this.inspectionData.age_min || [...a];
    const ma = this.inspectionData.age_max || [...a];

    let newDepth = 0;
    let newAge = 0;
    if (d.length > 0) {
      const lastD = d[d.length - 1];
      const lastA = a[a.length - 1];
      const prevD = d.length > 1 ? d[d.length - 2] : lastD - 5;
      const prevA = d.length > 1 ? a[a.length - 2] : lastA - 100;
      const stepD = Math.max(1, lastD - prevD);
      const stepA = Math.max(1, lastA - prevA);
      newDepth = Math.round((lastD + stepD) * 10) / 10;
      newAge = Math.round(lastA + stepA);
    }
    const newMin = Math.max(0, newAge - 100);
    const newMax = newAge + 100;

    d.push(newDepth);
    a.push(newAge);
    mi.push(newMin);
    ma.push(newMax);
    this.inspectionData.age_min = mi;
    this.inspectionData.age_max = ma;
    // Row count changed: attached rates are misaligned even though the length guard in
    // the renderer would also catch it (add+delete restores the length with shifted
    // content, which a length check cannot see).
    this.invalidateWindowedRates();

    this.renderFullDataTable();
    this.updateMappingTable();
    this.updateQualityAuditCard();
    this.callbacks.onModelModified?.();
  }

  public deleteTableRow(idx: number): void {
    if (!this.inspectionData || this.inspectionData.depths.length <= 2) {
      notifyError('年代模型至少需要保留 2 个层位！');
      return;
    }
    this.inspectionData.depths.splice(idx, 1);
    this.inspectionData.ages.splice(idx, 1);
    if (this.inspectionData.age_min) this.inspectionData.age_min.splice(idx, 1);
    if (this.inspectionData.age_max) this.inspectionData.age_max.splice(idx, 1);
    this.invalidateWindowedRates();

    this.updateQualityAuditCard();
    this.renderFullDataTable();
    this.updateMappingTable();
    this.callbacks.onModelModified?.();
  }

  public sortTableByDepth(): void {
    if (!this.inspectionData || this.inspectionData.depths.length < 2) return;
    const indices = this.inspectionData.depths.map((_, i) => i);
    indices.sort((a, b) => this.inspectionData!.depths[a] - this.inspectionData!.depths[b]);

    this.inspectionData.depths = indices.map((i) => this.inspectionData!.depths[i]);
    this.inspectionData.ages = indices.map((i) => this.inspectionData!.ages[i]);
    if (this.inspectionData.age_min) {
      this.inspectionData.age_min = indices.map((i) => this.inspectionData!.age_min[i]);
    }
    if (this.inspectionData.age_max) {
      this.inspectionData.age_max = indices.map((i) => this.inspectionData!.age_max[i]);
    }
    // This sort permutes the arrays themselves, so the attached windowed rates must be
    // permuted identically or they would describe the wrong horizons. (They are also
    // refitted against a depth-sorted curve on the next sync, which is why this stays
    // valid rather than merely cosmetically aligned.)
    if (this.inspectionData.sed_rate) {
      this.inspectionData.sed_rate = indices.map((i) => this.inspectionData!.sed_rate![i]);
    }
    if (this.inspectionData.sed_rate_se) {
      this.inspectionData.sed_rate_se = indices.map((i) => this.inspectionData!.sed_rate_se![i]);
    }

    this.updateQualityAuditCard();
    this.renderFullDataTable();
    this.updateMappingTable();
    this.callbacks.onModelModified?.();
  }

  public async copyTableTsv(): Promise<void> {
    if (!this.inspectionData || this.inspectionData.depths.length === 0) {
      notify('当前尚无年代-深度数据可复制！', 'info');
      return;
    }
    const d = this.inspectionData.depths;
    const a = this.inspectionData.ages;
    const mi = this.inspectionData.age_min || a;
    const ma = this.inspectionData.age_max || a;

    const sedRate = this.inspectionData.sed_rate || null;
    const sedSe = this.inspectionData.sed_rate_se || null;
    const hasRates = Boolean(sedRate && sedRate.length === d.length);
    // Header names carry the units; TSV pasted into a spreadsheet must stay interpretable.
    let tsv = hasRates
      ? 'Depth_cm\tAge_calBP\tAge_Min_calBP\tAge_Max_calBP\tSed_rate_cm_per_yr\tSed_rate_se_cm_per_yr\n'
      : 'Depth_cm\tAge_calBP\tAge_Min_calBP\tAge_Max_calBP\n';
    for (let i = 0; i < d.length; i++) {
      tsv += hasRates
        ? `${d[i]}\t${a[i]}\t${mi[i]}\t${ma[i]}\t${sedRate![i] ?? ''}\t${sedSe?.[i] ?? ''}\n`
        : `${d[i]}\t${a[i]}\t${mi[i]}\t${ma[i]}\n`;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(tsv);
      } else {
        const ta = document.createElement('textarea');
        ta.value = tsv;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const statusEl = this.container.querySelector('#ad-table-sync-status');
      if (statusEl) {
        statusEl.textContent = `已成功复制 ${d.length} 行数据至剪贴板（TSV 格式）！`;
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
      }
    } catch {
      notifyError('复制失败，请检查剪贴板权限。');
    }
  }

  public openPasteDataModal(): void {
    const pasteModal = this.container.querySelector('#ad-paste-data-modal') as HTMLElement | null;
    if (pasteModal) {
      pasteModal.style.display = 'flex';
      const ta = pasteModal.querySelector('#ad-paste-data-textarea') as HTMLTextAreaElement | null;
      if (ta) {
        ta.value = '';
        ta.focus();
      }
    }
  }

  public processPastedTsv(text: string, replace: boolean): void {
    const lines = text.trim().split(/\r?\n/);
    const newDepths: number[] = [];
    const newAges: number[] = [];
    const newMin: number[] = [];
    const newMax: number[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^[a-zA-Z#_]/.test(line)) continue;

      const tokens = line.split(/[\t,; ]+/).map((t) => parseFloat(t)).filter((n) => Number.isFinite(n));
      if (tokens.length >= 2) {
        const d = tokens[0];
        const a = tokens[1];
        const mi = tokens.length >= 3 ? tokens[2] : Math.max(0, a - 100);
        const ma = tokens.length >= 4 ? tokens[3] : a + 100;
        newDepths.push(d);
        newAges.push(a);
        newMin.push(mi);
        newMax.push(ma);
      }
    }

    if (newDepths.length < 2) {
      notifyError('未能解析出有效的年代-深度数据，请确认至少包含两列数值（深度与年代）且至少两行。');
      return;
    }

    if (!this.inspectionData || replace) {
      this.inspectionData = {
        depths: newDepths,
        ages: newAges,
        age_min: newMin,
        age_max: newMax,
        metadata: this.inspectionData?.metadata || {
          curve_type: 'median',
          envelope_type: '95_hpd',
          depth_unit: 'cm',
          age_unit: 'cal BP',
          calibration_curve: 'IntCal20',
        },
      };
    } else {
      this.inspectionData.depths.push(...newDepths);
      this.inspectionData.ages.push(...newAges);
      if (!this.inspectionData.age_min) this.inspectionData.age_min = [...this.inspectionData.ages];
      if (!this.inspectionData.age_max) this.inspectionData.age_max = [...this.inspectionData.ages];
      this.inspectionData.age_min.push(...newMin);
      this.inspectionData.age_max.push(...newMax);
      // Appended rows have no fitted rate; drop the stale attached arrays wholesale
      // rather than rely on the renderer's length guard alone.
      this.invalidateWindowedRates();
    }

    this.sortTableByDepth();
  }

  // --- Controls & Event Binding ---

  private bindTableControls(): void {
    // 展开大表
    this.container.querySelector('#ad-btn-expand-full-table')?.addEventListener('click', () => {
      this.callbacks.onSwitchTab?.('table');
    });

    // 侧边栏表格切换全量模型 vs 花粉样品
    this.container.querySelector('#ad-btn-toggle-side-table')?.addEventListener('click', () => {
      this.tableMode = this.tableMode === 'model' ? 'samples' : 'model';
      const btn = this.container.querySelector('#ad-btn-toggle-side-table') as HTMLElement | null;
      if (btn) btn.textContent = this.tableMode === 'model' ? '全量模型' : '花粉样品';
      this.updateMappingTable();
    });

    // Tab 2 大表控制工具栏
    this.container.querySelector('#ad-tbl-view-model')?.addEventListener('click', () => {
      this.tableMode = 'model';
      this.container.querySelector('#ad-tbl-view-model')?.classList.add('active');
      this.container.querySelector('#ad-tbl-view-samples')?.classList.remove('active');
      const sideBtn = this.container.querySelector('#ad-btn-toggle-side-table') as HTMLElement | null;
      if (sideBtn) sideBtn.textContent = '全量模型';
      this.renderFullDataTable();
      this.updateMappingTable();
    });

    this.container.querySelector('#ad-tbl-view-samples')?.addEventListener('click', () => {
      this.tableMode = 'samples';
      this.container.querySelector('#ad-tbl-view-samples')?.classList.add('active');
      this.container.querySelector('#ad-tbl-view-model')?.classList.remove('active');
      const sideBtn = this.container.querySelector('#ad-btn-toggle-side-table') as HTMLElement | null;
      if (sideBtn) sideBtn.textContent = '花粉样品';
      this.renderFullDataTable();
      this.updateMappingTable();
    });

    this.container.querySelector('#ad-tbl-btn-add')?.addEventListener('click', () => this.addTableRow());
    this.container.querySelector('#ad-tbl-btn-sort')?.addEventListener('click', () => this.sortTableByDepth());
    this.container.querySelector('#ad-tbl-btn-copy')?.addEventListener('click', () => this.copyTableTsv());
    this.container.querySelector('#ad-tbl-btn-paste')?.addEventListener('click', () => this.openPasteDataModal());
    this.container.querySelector('#ad-tbl-btn-sync')?.addEventListener('click', () => {
      void this.callbacks.onRequestSyncModel?.();
    });

    // 表头点击排序：these <th> live in the static template (only tbody is rebuilt by
    // renderFullDataTable), so binding once in the constructor is correct.
    this.container.querySelectorAll<HTMLElement>('.ad-th-sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort') as 'depth' | 'age' | 'min' | 'max' | null;
        if (key) this.sortByColumn(key);
      });
    });

    // 格式：显示位数下拉。Display-only; the data and any sync keep the raw values.
    this.container.querySelector('#ad-tbl-fmt-digits')?.addEventListener('change', (e) => {
      this.applyDisplayPrecision((e.target as HTMLSelectElement).value);
    });

    // 粘贴导入弹窗控制
    const pasteModal = this.container.querySelector('#ad-paste-data-modal') as HTMLElement | null;
    const closePaste = () => { if (pasteModal) pasteModal.style.display = 'none'; };
    this.container.querySelector('#ad-paste-cancel-btn')?.addEventListener('click', closePaste);
    this.container.querySelector('#ad-paste-cancel-x')?.addEventListener('click', closePaste);
    this.container.querySelector('#ad-paste-confirm-btn')?.addEventListener('click', () => {
      const ta = this.container.querySelector('#ad-paste-data-textarea') as HTMLTextAreaElement | null;
      const replace = (this.container.querySelector('#ad-paste-replace-mode') as HTMLInputElement | null)?.checked ?? true;
      if (ta) {
        this.processPastedTsv(ta.value, replace);
        closePaste();
      }
    });

    // 地质事件勾选联动
    const chkHiatus = this.container.querySelector('#ad-chk-hiatus') as HTMLInputElement | null;
    const boxHiatus = this.container.querySelector('#ad-hiatus-box') as HTMLElement | null;
    chkHiatus?.addEventListener('change', () => {
      if (boxHiatus) boxHiatus.style.display = chkHiatus.checked ? 'block' : 'none';
    });

    const chkSlump = this.container.querySelector('#ad-chk-slump') as HTMLInputElement | null;
    const boxSlump = this.container.querySelector('#ad-slump-box') as HTMLElement | null;
    chkSlump?.addEventListener('change', () => {
      if (boxSlump) boxSlump.style.display = chkSlump.checked ? 'block' : 'none';
    });

    const chkDr = this.container.querySelector('#ad-chk-dr') as HTMLInputElement | null;
    const boxDr = this.container.querySelector('#ad-dr-box') as HTMLElement | null;
    chkDr?.addEventListener('change', () => {
      if (boxDr) boxDr.style.display = chkDr.checked ? 'block' : 'none';
    });

    // 分段厚度胶囊点击
    this.container.querySelectorAll('.ad-btn-thick').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.container.querySelectorAll('.ad-btn-thick').forEach((b) => {
          b.classList.remove('active');
          (b as HTMLElement).style.borderColor = '';
        });
        btn.classList.add('active');
        (btn as HTMLElement).style.borderColor = 'var(--accent-blue)';
        const th = btn.getAttribute('data-thick') || '5';
        const valEl = this.container.querySelector('#ad-val-thick');
        if (valEl) valEl.textContent = `${th} cm`;
      });
    });

    // 测年表加行按钮
    this.container.querySelector('#btn-ad-add-date-row')?.addEventListener('click', () => {
      this.addDateRow();
    });

    // 从 Excel 粘贴测年序列按钮
    this.container.querySelector('#btn-ad-paste-dates')?.addEventListener('click', async () => {
      try {
        if (!navigator?.clipboard?.readText) {
          notifyError('请直接在网页上使用快捷键 Ctrl+V，或手动在测年数据表中填入数据。');
          return;
        }
        const text = await navigator.clipboard.readText();
        this.processPastedDates(text);
      } catch {
        notifyError('无法访问剪贴板，请检查权限。');
      }
    });
  }

  private processPastedDates(text: string): void {
    const lines = text.trim().split(/\r?\n/);
    const newDates: DatingPoint[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || /^[a-zA-Z#_]/.test(line)) continue;
      const tokens = line.split(/[\t,; ]+/);
      if (tokens.length >= 3) {
        const d = parseFloat(tokens[0]);
        const a = parseFloat(tokens[1]);
        const err = parseFloat(tokens[2]);
        const thick = tokens.length >= 4 ? parseFloat(tokens[3]) : 1;
        const cc = tokens.length >= 5 ? parseInt(tokens[4], 10) : 1;
        if (Number.isFinite(d) && Number.isFinite(a)) {
          newDates.push({
            id: `14C_${this.datingPoints.length + newDates.length + 1}`,
            depth: d,
            age: a,
            error: Number.isFinite(err) ? err : 30,
            thickness: Number.isFinite(thick) ? thick : 1,
            cc: Number.isFinite(cc) ? cc : 1,
          });
        }
      }
    }
    if (newDates.length > 0) {
      this.datingPoints.push(...newDates);
      this.renderDatingTable();
      this.callbacks.onDatingPointsChanged?.(this.datingPoints);
    }
  }
}
