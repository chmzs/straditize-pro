import { Viewport } from '../../core/Viewport';
import {
  AgeDepthModelInspectionData,
  CalibKind,
  CalibMarker,
  CALIB_META,
  CALIB_ORDER,
  ControlPoint,
  CURVE_COLORS,
  DatingPoint,
  EXCLUDE_BOX_COLOR,
  MappedSamplesData,
  MARKER_HIT_RADIUS,
  strokeWithHalo,
} from './types';

export interface AgeDepthCanvasCallbacks {
  onModelRefitted?: () => void;
  onCalibMarkersChanged?: () => void;
  onDatingPointPicked?: (point: DatingPoint) => void;
  onExcludeBoxesChanged?: () => void;
}

export class AgeDepthCanvas {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private callbacks: AgeDepthCanvasCallbacks;

  private viewport: Viewport = new Viewport();
  private isSpaceDown: boolean = false;
  private panning: { lastX: number; lastY: number } | null = null;
  private disposers: Array<() => void> = [];

  private bgImage: HTMLImageElement | null = null;
  private inspectionData: AgeDepthModelInspectionData | null = null;
  private mappedSamples: MappedSamplesData | null = null;

  // 四点标定交互状态
  private calibMarkers: CalibMarker[] = [];
  private calibPicking: boolean = false;
  private draggingMarker: number | null = null;

  // 矩形排除区（橡皮擦）
  private excludeBoxes: number[][] = [];
  private excludeArmed: boolean = false;
  private excludeDragStart: { x: number; y: number } | null = null;
  private excludePreview: number[] | null = null;

  // 测年点列表
  private datingPoints: DatingPoint[] = [];

  // 控制点与模式
  private activeFMode: 'adjust' | 'add' | 'delete' | 'pickDate' = 'adjust';
  private controlPoints: ControlPoint[] = [];
  private draggingControlPoint: number | null = null;

  // 视觉复选选项
  private showCurve: boolean = true;
  private showEnvelope: boolean = true;
  private showPollenHorizons: boolean = true;
  private overlayOpacity: number = 0.65;

  constructor(
    container: HTMLElement,
    canvas: HTMLCanvasElement,
    callbacks: AgeDepthCanvasCallbacks = {}
  ) {
    this.container = container;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.callbacks = callbacks;

    this.bindInteractions();
  }

  // --- Getters & Setters ---

  public getBgImage(): HTMLImageElement | null {
    return this.bgImage;
  }

  public setBgImage(img: HTMLImageElement | null): void {
    this.bgImage = img;
    if (img) {
      this.canvas.width = img.naturalWidth;
      this.canvas.height = img.naturalHeight;
      this.canvas.style.display = 'block';
    } else {
      this.canvas.style.display = 'none';
    }
  }

  public getInspectionData(): AgeDepthModelInspectionData | null {
    return this.inspectionData;
  }

  public setInspectionData(data: AgeDepthModelInspectionData | null): void {
    this.inspectionData = data;
    if (data?.px_points?.x_curve) {
      this.initControlPointsFromPx(data.px_points);
    } else {
      this.controlPoints = [];
    }
  }

  public getMappedSamples(): MappedSamplesData | null {
    return this.mappedSamples;
  }

  public setMappedSamples(samples: MappedSamplesData | null): void {
    this.mappedSamples = samples;
  }

  public getCalibMarkers(): CalibMarker[] {
    return this.calibMarkers;
  }

  public setCalibMarkers(markers: CalibMarker[]): void {
    this.calibMarkers = markers;
  }

  public isCalibPicking(): boolean {
    return this.calibPicking;
  }

  public setCalibPicking(picking: boolean): void {
    this.calibPicking = picking;
  }

  public getExcludeBoxes(): number[][] {
    return this.excludeBoxes;
  }

  public setExcludeBoxes(boxes: number[][]): void {
    this.excludeBoxes = boxes;
  }

  public isExcludeArmed(): boolean {
    return this.excludeArmed;
  }

  public getControlPoints(): ControlPoint[] {
    return this.controlPoints;
  }

  public setControlPoints(points: ControlPoint[]): void {
    this.controlPoints = points;
  }

  public getDatingPoints(): DatingPoint[] {
    return this.datingPoints;
  }

  public setDatingPoints(points: DatingPoint[]): void {
    this.datingPoints = points;
  }

  public getActiveFMode(): 'adjust' | 'add' | 'delete' | 'pickDate' {
    return this.activeFMode;
  }

  public setActiveFMode(mode: 'adjust' | 'add' | 'delete' | 'pickDate'): void {
    this.activeFMode = mode;
  }

  public setDisplayOptions(opts: {
    showCurve?: boolean;
    showEnvelope?: boolean;
    showPollenHorizons?: boolean;
    overlayOpacity?: number;
  }): void {
    if (opts.showCurve !== undefined) this.showCurve = opts.showCurve;
    if (opts.showEnvelope !== undefined) this.showEnvelope = opts.showEnvelope;
    if (opts.showPollenHorizons !== undefined) this.showPollenHorizons = opts.showPollenHorizons;
    if (opts.overlayOpacity !== undefined) this.overlayOpacity = opts.overlayOpacity;
    this.renderCanvas();
  }

  // --- Viewport & Coordinates ---

  public canvasToImage(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return this.viewport.screenToWorld({ x: clientX - rect.left, y: clientY - rect.top });
  }

  public resizeCanvasBackingStore(): boolean {
    const host = this.container.querySelector('#ad-canvas-container') as HTMLElement | null;
    if (!host) return false;
    const cssW = Math.max(1, Math.round(host.clientWidth));
    const cssH = Math.max(1, Math.round(host.clientHeight));
    this.viewport.updateDpr();
    const needW = Math.round(cssW * this.viewport.dpr);
    const needH = Math.round(cssH * this.viewport.dpr);
    if (this.canvas.width !== needW || this.canvas.height !== needH) {
      this.canvas.width = needW;
      this.canvas.height = needH;
    }
    return true;
  }

  public fitViewport(): void {
    if (!this.bgImage) return;
    const host = this.container.querySelector('#ad-canvas-container') as HTMLElement | null;
    if (!host) return;
    const cssW = Math.max(1, Math.round(host.clientWidth));
    const cssH = Math.max(1, Math.round(host.clientHeight));
    this.viewport.fitToScreen(cssW, cssH, this.bgImage.naturalWidth, this.bgImage.naturalHeight, 16);
    this.updateZoomLabel();
  }

  public reset100(): void {
    if (!this.bgImage) return;
    const host = this.container.querySelector('#ad-canvas-container') as HTMLElement | null;
    if (!host) return;
    this.viewport.reset100(
      host.clientWidth,
      host.clientHeight,
      this.bgImage.naturalWidth,
      this.bgImage.naturalHeight
    );
    this.updateZoomLabel();
    this.renderCanvas();
  }

  public zoomAtCentre(zoomIn: boolean, accelerated: boolean = false): void {
    const host = this.container.querySelector('#ad-canvas-container') as HTMLElement | null;
    if (!host) return;
    this.viewport.zoomStepAt(
      { x: host.clientWidth / 2, y: host.clientHeight / 2 },
      zoomIn,
      accelerated
    );
    this.updateZoomLabel();
    this.renderCanvas();
  }

  public updateZoomLabel(): void {
    const el = this.container.querySelector('#ad-zoom-label') as HTMLElement | null;
    if (el) el.textContent = `${Math.round(this.viewport.scale * 100)}%`;
  }

  public ageDepthToPx(age: number, depth: number): { x: number; y: number } | null {
    if (this.calibMarkers.length < 4) return null;
    const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;
    const aL = parseFloat((this.container.querySelector('#ad-inp-age-left') as HTMLInputElement)?.value || '3000');
    const aR = parseFloat((this.container.querySelector('#ad-inp-age-right') as HTMLInputElement)?.value || '0');
    const dT = parseFloat((this.container.querySelector('#ad-inp-depth-top') as HTMLInputElement)?.value || '0');
    const dB = parseFloat((this.container.querySelector('#ad-inp-depth-bottom') as HTMLInputElement)?.value || '150');

    const x0 = this.calibMarkers[0].x;
    const x1 = this.calibMarkers[1].x;
    const y0 = this.calibMarkers[2].y;
    const y1 = this.calibMarkers[3].y;

    if (orientStd) {
      const fx = (age - aL) / Math.max(1e-6, aR - aL);
      const fy = (depth - dT) / Math.max(1e-6, dB - dT);
      return { x: x0 + fx * (x1 - x0), y: y0 + fy * (y1 - y0) };
    } else {
      const fx = (depth - dT) / Math.max(1e-6, dB - dT);
      const fy = (age - aL) / Math.max(1e-6, aR - aL);
      return { x: x0 + fx * (x1 - x0), y: y0 + fy * (y1 - y0) };
    }
  }

  public pxToAgeDepth(x: number, y: number): { age: number; depth: number } | null {
    if (this.calibMarkers.length < 4) return null;
    const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;
    const aL = parseFloat((this.container.querySelector('#ad-inp-age-left') as HTMLInputElement)?.value || '3000');
    const aR = parseFloat((this.container.querySelector('#ad-inp-age-right') as HTMLInputElement)?.value || '0');
    const dT = parseFloat((this.container.querySelector('#ad-inp-depth-top') as HTMLInputElement)?.value || '0');
    const dB = parseFloat((this.container.querySelector('#ad-inp-depth-bottom') as HTMLInputElement)?.value || '150');

    const x0 = this.calibMarkers[0].x;
    const x1 = this.calibMarkers[1].x;
    const y0 = this.calibMarkers[2].y;
    const y1 = this.calibMarkers[3].y;

    const fx = (x - x0) / Math.max(1e-6, x1 - x0);
    const fy = (y - y0) / Math.max(1e-6, y1 - y0);

    if (orientStd) {
      return {
        age: aL + fx * (aR - aL),
        depth: dT + fy * (dB - dT),
      };
    } else {
      return {
        depth: dT + fx * (dB - dT),
        age: aL + fy * (aR - aL),
      };
    }
  }

  public syncPxPointsFromModel(): void {
    if (!this.inspectionData || this.calibMarkers.length < 4) return;
    const d = this.inspectionData.depths;
    const a = this.inspectionData.ages;
    const mi = this.inspectionData.age_min || a;
    const ma = this.inspectionData.age_max || a;

    const ys: number[] = [];
    const xsCurve: number[] = [];
    const xsMin: number[] = [];
    const xsMax: number[] = [];

    for (let i = 0; i < d.length; i++) {
      const ptMedian = this.ageDepthToPx(a[i], d[i]);
      const ptMin = this.ageDepthToPx(mi[i], d[i]);
      const ptMax = this.ageDepthToPx(ma[i], d[i]);
      if (ptMedian) {
        ys.push(ptMedian.y);
        xsCurve.push(ptMedian.x);
        xsMin.push(ptMin ? ptMin.x : ptMedian.x);
        xsMax.push(ptMax ? ptMax.x : ptMedian.x);
      }
    }

    if (ys.length > 0) {
      this.inspectionData.px_points = {
        y: ys,
        x_curve: xsCurve,
        x_min: xsMin,
        x_max: xsMax,
      };
    }
  }

  // --- Control Points & Calibration Logic ---

  public initControlPointsFromPx(px: { y: number[]; x_curve: number[] }): void {
    const stepSize = Math.max(1, Math.floor(px.y.length / 20));
    this.controlPoints = [];
    for (let i = 0; i < px.y.length; i += stepSize) {
      this.controlPoints.push({
        id: `cp_${i}`,
        x: px.x_curve[i],
        y: px.y[i],
        kind: 'curve',
      });
    }
    if ((px.y.length - 1) % stepSize !== 0) {
      const lastIdx = px.y.length - 1;
      this.controlPoints.push({
        id: `cp_${lastIdx}`,
        x: px.x_curve[lastIdx],
        y: px.y[lastIdx],
        kind: 'curve',
      });
    }
  }

  public findControlPointAt(pt: { x: number; y: number }): number {
    const radius = 9.0 / Math.max(this.viewport.scale, 1e-6);
    for (let i = 0; i < this.controlPoints.length; i++) {
      const cp = this.controlPoints[i];
      if (Math.hypot(cp.x - pt.x, cp.y - pt.y) <= radius) return i;
    }
    return -1;
  }

  public refitCurveFromControlPoints(): void {
    if (!this.inspectionData?.px_points || this.controlPoints.length < 2) return;
    const px = this.inspectionData.px_points;
    const sorted = [...this.controlPoints].sort((a, b) => a.y - b.y);
    const sortedY = sorted.map((p) => p.y);
    const sortedX = sorted.map((p) => p.x);
    for (let i = 0; i < px.y.length; i++) {
      const cy = px.y[i];
      if (cy <= sortedY[0]) {
        px.x_curve[i] = sortedX[0];
      } else if (cy >= sortedY[sortedY.length - 1]) {
        px.x_curve[i] = sortedX[sortedX.length - 1];
      } else {
        let j = 0;
        while (j < sortedY.length - 1 && sortedY[j + 1] < cy) j++;
        const frac = (cy - sortedY[j]) / Math.max(1e-6, sortedY[j + 1] - sortedY[j]);
        px.x_curve[i] = sortedX[j] + frac * (sortedX[j + 1] - sortedX[j]);
      }
      const ad = this.pxToAgeDepth(px.x_curve[i], cy);
      if (ad && this.inspectionData.ages[i] !== undefined) {
        this.inspectionData.ages[i] = Math.round(ad.age);
      }
    }
    this.callbacks.onModelRefitted?.();
  }

  public findMarkerAt(pt: { x: number; y: number }): number {
    const radius = MARKER_HIT_RADIUS / Math.max(this.viewport.scale, 1e-6);
    for (let i = 0; i < this.calibMarkers.length; i++) {
      const mk = this.calibMarkers[i];
      if (Math.hypot(mk.x - pt.x, mk.y - pt.y) <= radius) return i;
    }
    return -1;
  }

  public markerMap(): Record<CalibKind, CalibMarker> | null {
    const map = {} as Record<CalibKind, CalibMarker>;
    for (const mk of this.calibMarkers) map[mk.kind] = mk;
    if (!map.ageA || !map.ageB || !map.depthA || !map.depthB) return null;
    return map;
  }

  public seedCalibration(width: number, height: number): void {
    const xLeft = width * 0.13;
    const xRight = width * 0.94;
    const yTop = height * 0.04;
    const yBottom = height * 0.88;
    const padX = width * 0.022;
    const padY = height * 0.022;
    this.calibMarkers = [
      { kind: 'ageA', x: xLeft, y: yBottom + padY },
      { kind: 'ageB', x: xRight, y: yBottom + padY },
      { kind: 'depthA', x: xLeft - padX, y: yTop },
      { kind: 'depthB', x: xLeft - padX, y: yBottom },
    ];
    this.calibPicking = false;
    this.updateCalibChecklist();
    this.updateCalibReadout();
    this.callbacks.onCalibMarkersChanged?.();
  }

  public startCalibration(): void {
    this.calibMarkers = [];
    this.calibPicking = true;
    this.draggingMarker = null;
    this.updateCalibChecklist();
    this.updateCalibReadout();
    this.renderCanvas();
    this.callbacks.onCalibMarkersChanged?.();
  }

  public resetCalibration(): void {
    this.calibMarkers = [];
    this.calibPicking = false;
    this.draggingMarker = null;
    this.updateCalibChecklist();
    this.updateCalibReadout();
    this.renderCanvas();
    this.callbacks.onCalibMarkersChanged?.();
  }

  public addCalibMarker(pt: { x: number; y: number }): void {
    const nextKind = CALIB_ORDER[this.calibMarkers.length];
    if (!nextKind) return;
    this.calibMarkers.push({ kind: nextKind, x: pt.x, y: pt.y });
    if (this.calibMarkers.length >= CALIB_ORDER.length) this.calibPicking = false;
    this.updateCalibChecklist();
    this.updateCalibReadout();
    this.renderCanvas();
    this.callbacks.onCalibMarkersChanged?.();
  }

  public updateCalibChecklist(): void {
    const placed = new Set(this.calibMarkers.map((mk) => mk.kind));

    this.container.querySelectorAll('#ad-calib-checklist li').forEach((node) => {
      const li = node as HTMLElement;
      const kind = li.getAttribute('data-kind') as CalibKind | null;
      const done = kind ? placed.has(kind) : false;
      li.style.color = done ? 'var(--accent-green)' : 'var(--text-muted)';
      li.style.fontWeight = done ? '600' : '400';
      const text = CALIB_META[kind as CalibKind]?.label || '';
      li.textContent = done ? `✓ ${text}` : text;
    });

    const hint = this.container.querySelector('#ad-calib-hint') as HTMLElement | null;
    if (hint) {
      if (this.calibPicking) {
        const next = CALIB_ORDER[this.calibMarkers.length];
        hint.style.color = 'var(--accent-amber)';
        hint.innerHTML = next
          ? `请在图上点击：<strong>${CALIB_META[next].ordinal} ${CALIB_META[next].label}</strong>`
          : '';
      } else if (this.calibMarkers.length >= 4) {
        hint.style.color = 'var(--accent-green)';
        hint.innerHTML = '✓ 四点已落位，可拖动微调，然后填写标定值。';
      } else {
        hint.style.color = 'var(--text-muted)';
        hint.innerHTML = '未标定，无法识别。';
      }
    }

    const startBtn = this.container.querySelector('#ad-btn-calib-start') as HTMLButtonElement | null;
    if (startBtn) {
      startBtn.textContent = this.calibMarkers.length >= 4 ? '🎯 重新点击标定点' : '🎯 在图上点击 4 个标定点';
    }

    const values = this.container.querySelector('#ad-calib-values') as HTMLElement | null;
    if (values) values.style.display = this.calibMarkers.length >= 4 ? 'block' : 'none';
  }

  public updateCalibReadout(): void {
    this.updateCalibChecklist();
    const out = this.container.querySelector('#ad-calib-readout') as HTMLElement | null;
    const m = this.markerMap();
    if (!out || !m) return;

    const readNum = (id: string) => {
      const el = this.container.querySelector(`#${id}`) as HTMLInputElement | null;
      const v = Number(el?.value.trim());
      return Number.isFinite(v) ? v : null;
    };

    const ageVals = [readNum('ad-inp-age-left'), readNum('ad-inp-age-right')];
    const depthVals = [readNum('ad-inp-depth-top'), readNum('ad-inp-depth-bottom')];
    const agePxSpan = Math.abs(m.ageB.x - m.ageA.x);
    const depthPxSpan = Math.abs(m.depthB.y - m.depthA.y);

    const parts: string[] = [];
    if (ageVals[0] !== null && ageVals[1] !== null && agePxSpan > 1e-6) {
      const perPx = Math.abs(ageVals[1] - ageVals[0]) / agePxSpan;
      parts.push(`年龄: ${agePxSpan.toFixed(0)} px = ${Math.abs(ageVals[1] - ageVals[0]).toFixed(0)} → ${perPx.toFixed(3)}/px`);
    }
    if (depthVals[0] !== null && depthVals[1] !== null && depthPxSpan > 1e-6) {
      const perPx = Math.abs(depthVals[1] - depthVals[0]) / depthPxSpan;
      parts.push(`深度: ${depthPxSpan.toFixed(0)} px = ${Math.abs(depthVals[1] - depthVals[0]).toFixed(0)} → ${perPx.toFixed(3)}/px`);
    }
    out.textContent = parts.join(' ｜ ');
  }

  // --- Exclude Boxes ---

  public toggleExcludeArmed(): void {
    this.excludeArmed = !this.excludeArmed;
    this.excludeDragStart = null;
    this.excludePreview = null;
    this.applyExcludeArmedUI();
    this.renderCanvas();
  }

  public applyExcludeArmedUI(): void {
    const btn = this.container.querySelector('#ad-btn-exclude-add') as HTMLElement | null;
    if (btn) {
      btn.style.borderColor = this.excludeArmed ? 'var(--accent-red, #ef4444)' : '';
      btn.style.color = this.excludeArmed ? 'var(--accent-red, #ef4444)' : '';
      btn.textContent = this.excludeArmed ? '✕ 拖框以排除…' : '＋ 拖框添加';
    }
    this.canvas.style.cursor = this.excludeArmed ? 'crosshair' : 'default';
  }

  public updateExcludeCount(): void {
    const el = this.container.querySelector('#ad-exclude-count');
    if (el) el.textContent = `${this.excludeBoxes.length} 个`;
  }

  public clearExcludeBoxes(): void {
    this.excludeBoxes = [];
    this.excludePreview = null;
    this.updateExcludeCount();
    this.renderCanvas();
    this.callbacks.onExcludeBoxesChanged?.();
  }

  // --- Canvas Rendering ---

  public renderCanvas(): void {
    if (!this.ctx || !this.bgImage) return;
    if (!this.resizeCanvasBackingStore()) return;
    const ctx = this.ctx;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    this.viewport.applyTransform(ctx);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.bgImage, 0, 0);

    if (this.inspectionData?.px_points) {
      this.renderModelOverlay(ctx, this.inspectionData.px_points);
    }

    this.renderCalibrationOverlay(ctx);
    ctx.restore();

    this.updateZoomLabel();
  }

  private renderCalibrationOverlay(ctx: CanvasRenderingContext2D): void {
    const boxes = [...this.excludeBoxes];
    if (this.excludePreview) boxes.push(this.excludePreview);
    boxes.forEach((box) => {
      const [x0, y0, x1, y1] = box;
      ctx.save();
      ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
      ctx.strokeStyle = EXCLUDE_BOX_COLOR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.restore();
    });

    const m = this.markerMap();
    if (m) {
      const rx0 = Math.min(m.ageA.x, m.ageB.x);
      const rx1 = Math.max(m.ageA.x, m.ageB.x);
      const ry0 = Math.min(m.depthA.y, m.depthB.y);
      const ry1 = Math.max(m.depthA.y, m.depthB.y);

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(m.ageA.x, ry0);
      ctx.lineTo(m.ageA.x, ry1);
      ctx.moveTo(m.ageB.x, ry0);
      ctx.lineTo(m.ageB.x, ry1);
      ctx.moveTo(rx0, m.depthA.y);
      ctx.lineTo(rx1, m.depthA.y);
      ctx.moveTo(rx0, m.depthB.y);
      ctx.lineTo(rx1, m.depthB.y);
      ctx.stroke();
      ctx.restore();
    }

    const inv = 1 / Math.max(this.viewport.scale, 1e-6);
    const radius = Math.max(6, 7 * inv);

    this.calibMarkers.forEach((mk) => {
      const meta = CALIB_META[mk.kind];
      ctx.save();
      ctx.beginPath();
      ctx.arc(mk.x, mk.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = meta.color;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1.5, 2 * inv);
      ctx.stroke();

      ctx.font = `bold ${Math.max(12, Math.round(14 * inv))}px sans-serif`;
      ctx.fillStyle = meta.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.lineWidth = Math.max(2, 3 * inv);
      const ty = mk.y - radius - 3 * inv;
      ctx.strokeText(meta.ordinal, mk.x - radius * 0.55, ty);
      ctx.fillText(meta.ordinal, mk.x - radius * 0.55, ty);
      ctx.restore();
    });
  }

  private renderModelOverlay(
    ctx: CanvasRenderingContext2D,
    px: NonNullable<AgeDepthModelInspectionData['px_points']>
  ): void {
    ctx.save();
    ctx.globalAlpha = this.overlayOpacity;
    const inv = 1 / Math.max(this.viewport.scale, 1e-6);

    const curvePath = () => {
      ctx.moveTo(px.x_curve[0], px.y[0]);
      for (let i = 1; i < px.y.length; i++) {
        ctx.lineTo(px.x_curve[i], px.y[i]);
      }
    };
    const edgePath = (xs: number[]) => {
      ctx.moveTo(xs[0], px.y[0]);
      for (let i = 1; i < px.y.length; i++) {
        ctx.lineTo(xs[i], px.y[i]);
      }
    };

    if (this.showEnvelope && px.y && px.x_min && px.x_max) {
      ctx.beginPath();
      edgePath(px.x_min);
      for (let i = px.y.length - 1; i >= 0; i--) {
        ctx.lineTo(px.x_max[i], px.y[i]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.32)';
      ctx.fill();

      strokeWithHalo(ctx, () => edgePath(px.x_max), CURVE_COLORS.max, 1.5 * inv);
      strokeWithHalo(ctx, () => edgePath(px.x_min), CURVE_COLORS.min, 1.5 * inv);
    }

    if (this.showCurve && px.y && px.x_curve) {
      strokeWithHalo(ctx, curvePath, CURVE_COLORS.median, 2.5 * inv);
    }

    if (this.showCurve && this.controlPoints.length > 0) {
      for (const cp of this.controlPoints) {
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 4.2 * inv, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1.8 * inv;
        ctx.stroke();
      }
    }

    if (this.datingPoints.length > 0 && this.calibMarkers.length >= 4) {
      const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;
      const aL = parseFloat((this.container.querySelector('#ad-inp-age-left') as HTMLInputElement)?.value || '3000');
      const aR = parseFloat((this.container.querySelector('#ad-inp-age-right') as HTMLInputElement)?.value || '0');
      const dT = parseFloat((this.container.querySelector('#ad-inp-depth-top') as HTMLInputElement)?.value || '0');
      const dB = parseFloat((this.container.querySelector('#ad-inp-depth-bottom') as HTMLInputElement)?.value || '150');

      const x0 = this.calibMarkers[0].x;
      const x1 = this.calibMarkers[1].x;
      const y0 = this.calibMarkers[2].y;
      const y1 = this.calibMarkers[3].y;

      for (const dp of this.datingPoints) {
        let pxX = 0;
        let pxY = 0;
        if (orientStd) {
          const fx = (dp.age - aL) / Math.max(1, aR - aL);
          const fy = (dp.depth - dT) / Math.max(1, dB - dT);
          pxX = x0 + fx * (x1 - x0);
          pxY = y0 + fy * (y1 - y0);
        } else {
          const fx = (dp.depth - dT) / Math.max(1, dB - dT);
          const fy = (dp.age - aL) / Math.max(1, aR - aL);
          pxX = x0 + fx * (x1 - x0);
          pxY = y0 + fy * (y1 - y0);
        }
        ctx.beginPath();
        ctx.arc(pxX, pxY, 6.0 * inv, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(16, 185, 129, 0.35)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pxX, pxY, 3.5 * inv, 0, Math.PI * 2);
        ctx.fillStyle = '#10b981';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2 * inv;
        ctx.stroke();
      }
    }

    if (this.showPollenHorizons && this.mappedSamples?.px_y && this.mappedSamples?.px_x_curve) {
      const ys = this.mappedSamples.px_y;
      const xs = this.mappedSamples.px_x_curve;
      const n = Math.min(ys.length, xs.length);
      ctx.fillStyle = '#34d399';
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1 * inv;
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], 2.6 * inv, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  public handleCanvasHover(e: MouseEvent): void {
    if (!this.inspectionData?.px_points) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleY = this.canvas.height / rect.height;
    const my = (e.clientY - rect.top) * scaleY;

    const px = this.inspectionData.px_points;
    const hud = this.container.querySelector('#ad-canvas-hud');
    if (!hud || !px.y || px.y.length === 0) return;

    let bestIdx = 0;
    let minDiff = 99999;
    for (let i = 0; i < px.y.length; i++) {
      const diff = Math.abs(px.y[i] - my);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }

    const d = this.inspectionData.depths[bestIdx];
    const a = this.inspectionData.ages[bestIdx];
    const mi = this.inspectionData.age_min[bestIdx];
    const ma = this.inspectionData.age_max[bestIdx];

    hud.innerHTML = `深度: <strong style="color:var(--accent-blue);">${d.toFixed(1)} cm</strong> ➔ 年代: <strong style="color:var(--text-heading);">${Math.round(a)} cal BP</strong> (95% CI: <span style="color:var(--accent-amber);">${Math.round(mi)} ~ ${Math.round(ma)}</span>)`;
  }

  // --- Interaction Listeners ---

  private bindInteractions(): void {
    const canvas = this.canvas;

    canvas.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        this.viewport.zoomStepAt(
          { x: e.clientX - rect.left, y: e.clientY - rect.top },
          e.deltaY < 0,
          e.ctrlKey || e.metaKey
        );
        this.updateZoomLabel();
        this.renderCanvas();
      },
      { passive: false }
    );

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const canPan = (e: MouseEvent) =>
      e.button === 2 || e.button === 1 || (e.button === 0 && this.isSpaceDown);

    canvas.addEventListener('mousedown', (e) => {
      const pt = this.canvasToImage(e.clientX, e.clientY);

      if (canPan(e)) {
        e.preventDefault();
        this.panning = { lastX: e.clientX, lastY: e.clientY };
        return;
      }

      if (this.excludeArmed) {
        this.excludeDragStart = pt;
        this.excludePreview = [pt.x, pt.y, pt.x, pt.y];
        e.preventDefault();
        return;
      }

      if (this.activeFMode === 'pickDate') {
        const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;
        const aL = parseFloat((this.container.querySelector('#ad-inp-age-left') as HTMLInputElement)?.value || '3000');
        const aR = parseFloat((this.container.querySelector('#ad-inp-age-right') as HTMLInputElement)?.value || '0');
        const dT = parseFloat((this.container.querySelector('#ad-inp-depth-top') as HTMLInputElement)?.value || '0');
        const dB = parseFloat((this.container.querySelector('#ad-inp-depth-bottom') as HTMLInputElement)?.value || '150');

        let pickedDepth = 0;
        let pickedAge = 0;
        if (this.calibMarkers.length >= 4) {
          const x0 = this.calibMarkers[0].x;
          const x1 = this.calibMarkers[1].x;
          const y0 = this.calibMarkers[2].y;
          const y1 = this.calibMarkers[3].y;
          const fx = (pt.x - x0) / Math.max(1, x1 - x0);
          const fy = (pt.y - y0) / Math.max(1, y1 - y0);
          if (orientStd) {
            pickedAge = Math.round(aL + fx * (aR - aL));
            pickedDepth = Math.round((dT + fy * (dB - dT)) * 10) / 10;
          } else {
            pickedDepth = Math.round((dT + fx * (dB - dT)) * 10) / 10;
            pickedAge = Math.round(aL + fy * (aR - aL));
          }
        }
        const newPoint: DatingPoint = {
          id: `14C_${this.datingPoints.length + 1}`,
          depth: Math.max(0, pickedDepth),
          age: Math.max(0, pickedAge),
          error: 30,
          thickness: 1,
          cc: 1,
        };
        this.datingPoints.push(newPoint);
        this.callbacks.onDatingPointPicked?.(newPoint);
        this.renderCanvas();
        return;
      }

      if (this.activeFMode === 'add') {
        this.controlPoints.push({
          id: `cp_${Date.now()}`,
          x: pt.x,
          y: pt.y,
          kind: 'curve',
        });
        this.controlPoints.sort((a, b) => a.y - b.y);
        this.refitCurveFromControlPoints();
        this.renderCanvas();
        return;
      }

      if (this.activeFMode === 'delete') {
        const cpIdx = this.findControlPointAt(pt);
        if (cpIdx >= 0) {
          this.controlPoints.splice(cpIdx, 1);
          this.refitCurveFromControlPoints();
          this.renderCanvas();
          return;
        }
      }

      if (this.activeFMode === 'adjust') {
        const cpIdx = this.findControlPointAt(pt);
        if (cpIdx >= 0) {
          this.draggingControlPoint = cpIdx;
          e.preventDefault();
          return;
        }
      }

      const hit = this.findMarkerAt(pt);
      if (hit >= 0) {
        this.draggingMarker = hit;
        e.preventDefault();
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const pt = this.canvasToImage(e.clientX, e.clientY);

      if (this.panning) {
        this.viewport.panBy(e.clientX - this.panning.lastX, e.clientY - this.panning.lastY);
        this.panning = { lastX: e.clientX, lastY: e.clientY };
        this.renderCanvas();
        return;
      }

      if (this.draggingControlPoint !== null && this.controlPoints[this.draggingControlPoint]) {
        this.controlPoints[this.draggingControlPoint].x = pt.x;
        this.controlPoints[this.draggingControlPoint].y = pt.y;
        this.refitCurveFromControlPoints();
        this.renderCanvas();
        return;
      }

      if (this.excludeArmed && this.excludeDragStart) {
        this.excludePreview = [
          Math.min(this.excludeDragStart.x, pt.x),
          Math.min(this.excludeDragStart.y, pt.y),
          Math.max(this.excludeDragStart.x, pt.x),
          Math.max(this.excludeDragStart.y, pt.y),
        ];
        this.renderCanvas();
        return;
      }

      if (this.draggingMarker !== null && this.calibMarkers[this.draggingMarker]) {
        this.calibMarkers[this.draggingMarker].x = pt.x;
        this.calibMarkers[this.draggingMarker].y = pt.y;
        this.updateCalibReadout();
        this.renderCanvas();
        return;
      }

      this.handleCanvasHover(e);
    });

    const endDrag = () => {
      if (this.draggingControlPoint !== null) {
        this.draggingControlPoint = null;
        return;
      }
      if (this.panning) {
        this.panning = null;
        return;
      }
      if (this.excludeArmed && this.excludePreview) {
        const [x0, y0, x1, y1] = this.excludePreview;
        if (Math.abs(x1 - x0) > 4 && Math.abs(y1 - y0) > 4) {
          this.excludeBoxes.push([
            Math.round(x0),
            Math.round(y0),
            Math.round(x1),
            Math.round(y1),
          ]);
        }
        this.excludePreview = null;
        this.excludeDragStart = null;
        this.excludeArmed = false;
        this.applyExcludeArmedUI();
        this.updateExcludeCount();
        this.renderCanvas();
        this.callbacks.onExcludeBoxesChanged?.();
        return;
      }
      this.draggingMarker = null;
    };
    canvas.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => {
      this.draggingMarker = null;
      this.panning = null;
      if (this.excludeDragStart) endDrag();
    });

    canvas.addEventListener('click', (e) => {
      if (!this.calibPicking || this.excludeArmed) return;
      const pt = this.canvasToImage(e.clientX, e.clientY);
      if (this.findMarkerAt(pt) >= 0) return;
      this.addCalibMarker(pt);
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !this.isSpaceDown) {
        this.isSpaceDown = true;
        canvas.style.cursor = 'grab';
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        this.isSpaceDown = false;
        canvas.style.cursor = this.excludeArmed ? 'crosshair' : 'default';
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    this.disposers.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    });

    const observedParent = canvas.parentElement;
    if (typeof ResizeObserver !== 'undefined' && observedParent) {
      const ro = new ResizeObserver(() => this.renderCanvas());
      ro.observe(observedParent);
      this.disposers.push(() => ro.disconnect());
    }
  }

  public dispose(): void {
    this.disposers.forEach((fn) => {
      try {
        fn();
      } catch {
        /* teardown must not throw */
      }
    });
    this.disposers = [];
    this.isSpaceDown = false;
    this.panning = null;
  }
}
