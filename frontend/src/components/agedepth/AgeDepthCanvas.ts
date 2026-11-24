import { Viewport } from '../../core/Viewport';
import { panDeltaFromArrowKey } from '../canvas/keyBindings';
import { AgeDepthHistory } from './AgeDepthHistory';
import {
  AgeDepthHistorySnapshot,
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
  private editTarget: 'curve' | 'lower' | 'upper' | 'min' | 'max' = 'curve';
  private controlPoints: ControlPoint[] = [];
  private selectedControlPointIndex: number | null = null;
  private draggingControlPoint: number | null = null;

  // 历史撤销重做状态
  private history: AgeDepthHistory = new AgeDepthHistory(50);
  private dragStartSnapshot: AgeDepthHistorySnapshot | null = null;
  private arrowKeyStartSnapshot: AgeDepthHistorySnapshot | null = null;
  private arrowKeyHistoryTimer: number | null = null;
  private hudNoticeTimer: number | null = null;

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

    this.history.onChange = (canUndo, canRedo) => this.updateHistoryUI(canUndo, canRedo);
    this.bindInteractions();
    this.bindPaneSplitter();
  }

  /**
   * Lets the user drag the divider to re-balance the image pane against the control column.
   *
   * The control column used to be a fixed 330px, which on a 1920px display left the image
   * pane narrower than half the screen -- the figure being digitised is the thing that needs
   * room, and its aspect ratio is not knowable in advance, so a fixed split is always wrong
   * for somebody. The chosen width is persisted per browser so it survives reopening the
   * dialog, and double-clicking the divider restores the default.
   */
  private bindPaneSplitter(): void {
    const splitter = this.container.querySelector('#ad-pane-splitter') as HTMLElement | null;
    const pane = this.container.querySelector('.ad-control-pane') as HTMLElement | null;
    const shell = this.container.querySelector('.agedepth-dialog') as HTMLElement | null;
    if (!splitter || !pane || !shell) return;

    const STORAGE_KEY = 'straditize.agedepth.paneWidth';
    const DEFAULT_PX = 330;
    const MIN_PANE = 260;
    // Never let the control column eat the image pane: cap it at 60% of the dialog.
    const maxPane = () => Math.max(MIN_PANE, shell.clientWidth * 0.6);

    const apply = (px: number) => {
      const clamped = Math.round(Math.min(maxPane(), Math.max(MIN_PANE, px)));
      pane.style.setProperty('--ad-pane-width', `${clamped}px`);
      return clamped;
    };

    const stored = Number(window.localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored >= MIN_PANE) apply(stored);

    let dragging = false;
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      // Width is measured from the dialog's right edge, since the pane is the last column.
      const rect = shell.getBoundingClientRect();
      apply(rect.right - e.clientX);
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      splitter.classList.remove('is-dragging');
      document.body.classList.remove('ad-pane-resizing');
      const current = Number.parseFloat(
        pane.style.getPropertyValue('--ad-pane-width') || ''
      );
      if (Number.isFinite(current)) {
        window.localStorage.setItem(STORAGE_KEY, String(Math.round(current)));
      }
      // The canvas backing store follows the container size, so re-measure after the drag.
      this.renderCanvas();
    };

    splitter.addEventListener('mousedown', (e) => {
      dragging = true;
      splitter.classList.add('is-dragging');
      document.body.classList.add('ad-pane-resizing');
      e.preventDefault();
    });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    splitter.addEventListener('dblclick', () => {
      window.localStorage.removeItem(STORAGE_KEY);
      apply(DEFAULT_PX);
      this.renderCanvas();
    });

    // Keyboard access: 8px of pointer target is not the only way in.
    splitter.addEventListener('keydown', (e) => {
      const current = Number.parseFloat(
        pane.style.getPropertyValue('--ad-pane-width') || ''
      ) || DEFAULT_PX;
      if (e.key === 'ArrowLeft') {
        apply(current + 24);
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        apply(current - 24);
        e.preventDefault();
      } else if (e.key === 'Home') {
        apply(DEFAULT_PX);
        e.preventDefault();
      }
    });

    // Shrinking the dialog must not leave the control column holding 60% of it: the stored
    // absolute width has to be re-clamped against the new cap.
    const onResize = () => {
      const current = Number.parseFloat(
        pane.style.getPropertyValue('--ad-pane-width') || ''
      );
      if (Number.isFinite(current)) apply(current);
      this.renderCanvas();
    };
    window.addEventListener('resize', onResize);
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
    // Control points are the user's manual edits. Rebuilding them from ``px_points`` on
    // every assignment silently discards a drag: the refit callback round-trips through the
    // dating table, which re-assigns this same payload, so each drag point was snapped back
    // to the traced curve it was being edited away from.
    //
    // Rebuild only when the payload is genuinely a different model. A fresh extraction
    // carries a new object identity; a round-trip of the model under edit carries the same
    // reference we already hold.
    const isNewModel = data !== this.inspectionData;
    this.inspectionData = data;
    if (isNewModel) {
      if (data?.px_points?.x_curve) {
        this.initControlPointsFromPx(data.px_points);
      } else {
        this.controlPoints = [];
      }
      this.history.clear();
    }
  }

  public getMappedSamples(): MappedSamplesData | null {
    return this.mappedSamples;
  }

  public setMappedSamples(samples: MappedSamplesData | null): void {
    this.mappedSamples = samples;
    this.syncMappedSamplesPx();
  }

  public syncMappedSamplesPx(): void {
    if (!this.mappedSamples || this.calibMarkers.length < 4) return;
    const depths = this.mappedSamples.depths;
    const ages = this.mappedSamples.age_est;
    const px_y: number[] = [];
    const px_x_curve: number[] = [];
    for (let i = 0; i < depths.length; i++) {
      const pt = this.ageDepthToPx(ages[i] ?? 0, depths[i]);
      if (pt) {
        px_y.push(pt.y);
        px_x_curve.push(pt.x);
      }
    }
    this.mappedSamples.px_y = px_y;
    this.mappedSamples.px_x_curve = px_x_curve;
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

  public getEditTarget(): 'curve' | 'lower' | 'upper' | 'min' | 'max' {
    return this.editTarget;
  }

  public setEditTarget(target: 'curve' | 'lower' | 'upper' | 'min' | 'max'): void {
    const norm = target === 'min' ? 'lower' : target === 'max' ? 'upper' : target;
    this.editTarget = norm;
    const sel = this.container.querySelector('#ad-sel-edit-target') as HTMLSelectElement | null;
    if (sel && sel.value !== norm) sel.value = norm;
    this.renderCanvas();
  }

  public updateFModeUI(mode: 'adjust' | 'add' | 'delete' | 'pickDate'): void {
    this.container.querySelectorAll('.ad-fmode-btn').forEach((btn) => {
      const m = btn.getAttribute('data-fmode');
      btn.classList.toggle('active', m === mode);
    });
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

  // --- History & Snapshots ---

  public captureState(description: string = ''): AgeDepthHistorySnapshot {
    return AgeDepthHistory.cloneSnapshot(description, {
      controlPoints: this.controlPoints,
      selectedControlPointIndex: this.selectedControlPointIndex,
      editTarget: this.editTarget,
      calibMarkers: this.calibMarkers,
      excludeBoxes: this.excludeBoxes,
      datingPoints: this.datingPoints,
    });
  }

  public applySnapshot(snap: AgeDepthHistorySnapshot): void {
    this.controlPoints = snap.controlPoints.map((cp) => ({ ...cp }));
    this.selectedControlPointIndex = snap.selectedControlPointIndex;
    this.editTarget = snap.editTarget;
    if (snap.calibMarkers) {
      this.calibMarkers = snap.calibMarkers.map((m) => ({ ...m }));
      this.updateCalibChecklist();
      this.updateCalibReadout();
    }
    if (snap.excludeBoxes) {
      this.excludeBoxes = snap.excludeBoxes.map((b) => [...b]);
      this.updateExcludeCount();
    }
    if (snap.datingPoints) {
      this.datingPoints = snap.datingPoints.map((d) => ({ ...d }));
    }
    this.updateFModeUI(this.activeFMode);
    const sel = this.container.querySelector('#ad-sel-edit-target') as HTMLSelectElement | null;
    if (sel && sel.value !== this.editTarget) sel.value = this.editTarget;
    this.refitCurveFromControlPoints(true);
    this.renderCanvas();
  }

  public undo(): boolean {
    if (this.arrowKeyHistoryTimer && this.arrowKeyStartSnapshot) {
      clearTimeout(this.arrowKeyHistoryTimer);
      this.history.pushSnapshot(this.arrowKeyStartSnapshot);
      this.arrowKeyStartSnapshot = null;
      this.arrowKeyHistoryTimer = null;
    }
    const prev = this.history.undo(this.captureState());
    if (!prev) return false;
    this.applySnapshot(prev);
    this.showHudNotice(`已撤销: ${prev.description || '操作'} (Ctrl+Z)`);
    return true;
  }

  public redo(): boolean {
    const next = this.history.redo(this.captureState());
    if (!next) return false;
    this.applySnapshot(next);
    this.showHudNotice(`已重做: ${next.description || '操作'} (Ctrl+Y)`);
    return true;
  }

  public canUndo(): boolean {
    return this.history.canUndo();
  }

  public canRedo(): boolean {
    return this.history.canRedo();
  }

  public showHudNotice(msg: string): void {
    const hud = this.container.querySelector('#ad-canvas-hud');
    if (!hud) return;
    hud.innerHTML = `<span style="color:var(--accent-blue); font-weight:600;">${msg}</span>`;
    if (this.hudNoticeTimer) {
      clearTimeout(this.hudNoticeTimer);
    }
    this.hudNoticeTimer = window.setTimeout(() => {
      this.hudNoticeTimer = null;
      const h = this.container.querySelector('#ad-canvas-hud');
      if (h) {
        h.textContent = '悬停查验: 移动光标在年代曲线上即可实时测读深度与对应年代';
      }
    }, 2500);
  }

  public updateHistoryUI(canUndo: boolean, canRedo: boolean): void {
    const btnUndo = this.container.querySelector('#ad-btn-undo') as HTMLButtonElement | null;
    const btnRedo = this.container.querySelector('#ad-btn-redo') as HTMLButtonElement | null;
    if (btnUndo) {
      btnUndo.disabled = !canUndo;
      btnUndo.style.opacity = canUndo ? '1' : '0.45';
      btnUndo.style.cursor = canUndo ? 'pointer' : 'not-allowed';
    }
    if (btnRedo) {
      btnRedo.disabled = !canRedo;
      btnRedo.style.opacity = canRedo ? '1' : '0.45';
      btnRedo.style.cursor = canRedo ? 'pointer' : 'not-allowed';
    }
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
    this.renderCanvas();
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

  private getCalibValues(): { aL: number; aR: number; dT: number; dB: number } | null {
    const parse = (id: string) => {
      const el = this.container.querySelector(`#${id}`) as HTMLInputElement | null;
      if (!el || !el.value.trim()) return null;
      const v = parseFloat(el.value);
      return Number.isFinite(v) ? v : null;
    };
    const aL = parse('ad-inp-age-left');
    const aR = parse('ad-inp-age-right');
    const dT = parse('ad-inp-depth-top');
    const dB = parse('ad-inp-depth-bottom');
    if (aL === null || aR === null || dT === null || dB === null) return null;
    return { aL, aR, dT, dB };
  }

  public ageDepthToPx(age: number, depth: number): { x: number; y: number } | null {
    if (this.calibMarkers.length < 4) return null;
    const calib = this.getCalibValues();
    if (!calib) return null;
    const { aL, aR, dT, dB } = calib;
    const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;

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
    const calib = this.getCalibValues();
    if (!calib) return null;
    const { aL, aR, dT, dB } = calib;
    const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;

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
    const mi = this.inspectionData.age_lower || this.inspectionData.age_min || a;
    const ma = this.inspectionData.age_upper || this.inspectionData.age_max || a;

    const ys: number[] = [];
    const xsCurve: number[] = [];
    const xsLower: number[] = [];
    const xsUpper: number[] = [];

    for (let i = 0; i < d.length; i++) {
      const ptMean = this.ageDepthToPx(a[i], d[i]);
      const ptLower = this.ageDepthToPx(mi[i], d[i]);
      const ptUpper = this.ageDepthToPx(ma[i], d[i]);
      if (ptMean) {
        ys.push(ptMean.y);
        xsCurve.push(ptMean.x);
        xsLower.push(ptLower ? ptLower.x : ptMean.x);
        xsUpper.push(ptUpper ? ptUpper.x : ptMean.x);
      }
    }

    if (ys.length > 0) {
      this.inspectionData.px_points = {
        y: ys,
        x_curve: xsCurve,
        x_lower: xsLower,
        x_upper: xsUpper,
        x_min: xsLower,
        x_max: xsUpper,
      };
      // 双向绑定：表格驱动画布控制点同步更新
      this.initControlPointsFromPx(this.inspectionData.px_points);
    }
  }

  // --- Control Points & Calibration Logic ---

  public initControlPointsFromPx(px: {
    y: number[];
    x_curve: number[];
    x_lower?: number[];
    x_upper?: number[];
    x_min?: number[];
    x_max?: number[];
  }): void {
    const stepSize = Math.max(1, Math.floor(px.y.length / 18));
    this.controlPoints = [];

    // 1. 均值代表线控制点 (kind: 'curve')
    for (let i = 0; i < px.y.length; i += stepSize) {
      this.controlPoints.push({
        id: `cp_curve_${i}`,
        x: px.x_curve[i],
        y: px.y[i],
        kind: 'curve',
      });
    }
    if ((px.y.length - 1) % stepSize !== 0) {
      const lastIdx = px.y.length - 1;
      this.controlPoints.push({
        id: `cp_curve_${lastIdx}`,
        x: px.x_curve[lastIdx],
        y: px.y[lastIdx],
        kind: 'curve',
      });
    }

    // 2. 置信区间下界 (kind: 'lower')
    const lowerXs = px.x_lower || px.x_min;
    if (lowerXs && lowerXs.length === px.y.length) {
      const minStep = Math.max(1, Math.floor(px.y.length / 12));
      for (let i = 0; i < px.y.length; i += minStep) {
        this.controlPoints.push({
          id: `cp_lower_${i}`,
          x: lowerXs[i],
          y: px.y[i],
          kind: 'lower',
        });
      }
      if ((px.y.length - 1) % minStep !== 0) {
        const lastIdx = px.y.length - 1;
        this.controlPoints.push({
          id: `cp_lower_${lastIdx}`,
          x: lowerXs[lastIdx],
          y: px.y[lastIdx],
          kind: 'lower',
        });
      }
    }

    // 3. 置信区间上界 (kind: 'upper')
    const upperXs = px.x_upper || px.x_max;
    if (upperXs && upperXs.length === px.y.length) {
      const maxStep = Math.max(1, Math.floor(px.y.length / 12));
      for (let i = 0; i < px.y.length; i += maxStep) {
        this.controlPoints.push({
          id: `cp_upper_${i}`,
          x: upperXs[i],
          y: px.y[i],
          kind: 'upper',
        });
      }
      if ((px.y.length - 1) % maxStep !== 0) {
        const lastIdx = px.y.length - 1;
        this.controlPoints.push({
          id: `cp_upper_${lastIdx}`,
          x: upperXs[lastIdx],
          y: px.y[lastIdx],
          kind: 'upper',
        });
      }
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

  /**
   * 单线在控制点跨度内的线性插值。
   */
  private fitLineFromPoints(
    cps: ControlPoint[],
    ys: number[],
    targetXs: number[]
  ): void {
    if (cps.length === 0 || ys.length === 0) return;
    if (cps.length === 1) {
      targetXs.fill(cps[0].x);
      return;
    }
    const sorted = [...cps].sort((a, b) => a.y - b.y);
    const n = sorted.length;
    const y0 = sorted[0].y;
    const yLast = sorted[n - 1].y;

    for (let i = 0; i < ys.length; i++) {
      const cy = ys[i];
      if (cy <= y0) {
        targetXs[i] = sorted[0].x;
      } else if (cy >= yLast) {
        targetXs[i] = sorted[n - 1].x;
      } else {
        let j = 0;
        while (j < n - 1 && sorted[j + 1].y < cy) j++;
        const dy = Math.max(1e-6, sorted[j + 1].y - sorted[j].y);
        const frac = (cy - sorted[j].y) / dy;
        targetXs[i] = sorted[j].x + frac * (sorted[j + 1].x - sorted[j].x);
      }
    }
  }

  public refitCurveFromControlPoints(notify: boolean = true): void {
    if (!this.inspectionData?.px_points || this.controlPoints.length < 2) return;
    const px = this.inspectionData.px_points;

    const curveCps = this.controlPoints.filter((p) => p.kind === 'curve').sort((a, b) => a.y - b.y);
    const lowerCps = this.controlPoints.filter((p) => p.kind === 'lower' || p.kind === 'min').sort((a, b) => a.y - b.y);
    const upperCps = this.controlPoints.filter((p) => p.kind === 'upper' || p.kind === 'max').sort((a, b) => a.y - b.y);

    if (curveCps.length < 2) return;

    // 动态重算控制点 Y 范围：加点自适应延伸，删点立即收回（严禁脱离控制点的强制外推）
    let minY = Infinity;
    let maxY = -Infinity;
    for (const cp of this.controlPoints) {
      if (cp.y < minY) minY = cp.y;
      if (cp.y > maxY) maxY = cp.y;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY >= maxY) return;

    const startY = Math.round(minY);
    const endY = Math.round(maxY);
    const newYs: number[] = [];
    for (let y = startY; y <= endY; y++) {
      newYs.push(y);
    }
    px.y = newYs;
    px.x_curve = new Array(newYs.length).fill(0);
    if (lowerCps.length >= 2) {
      px.x_lower = new Array(newYs.length).fill(0);
      px.x_min = px.x_lower;
    } else {
      delete px.x_lower;
      delete px.x_min;
    }
    if (upperCps.length >= 2) {
      px.x_upper = new Array(newYs.length).fill(0);
      px.x_max = px.x_upper;
    } else {
      delete px.x_upper;
      delete px.x_max;
    }

    this.inspectionData.depths = new Array(newYs.length).fill(0);
    this.inspectionData.ages = new Array(newYs.length).fill(0);
    if (px.x_lower) {
      this.inspectionData.age_lower = new Array(newYs.length).fill(0);
      this.inspectionData.age_min = this.inspectionData.age_lower;
    } else {
      delete (this.inspectionData as any).age_lower;
      delete (this.inspectionData as any).age_min;
    }
    if (px.x_upper) {
      this.inspectionData.age_upper = new Array(newYs.length).fill(0);
      this.inspectionData.age_max = this.inspectionData.age_upper;
    } else {
      delete (this.inspectionData as any).age_upper;
      delete (this.inspectionData as any).age_max;
    }

    // 拟合均值代表线
    this.fitLineFromPoints(curveCps, px.y, px.x_curve);
    for (let i = 0; i < px.y.length; i++) {
      const ad = this.pxToAgeDepth(px.x_curve[i], px.y[i]);
      if (ad) {
        this.inspectionData.depths[i] = ad.depth;
        this.inspectionData.ages[i] = ad.age;
      }
    }

    // 拟合 95% 置信区间下界
    if (lowerCps.length >= 2 && px.x_lower) {
      this.fitLineFromPoints(lowerCps, px.y, px.x_lower);
      for (let i = 0; i < px.y.length; i++) {
        const ad = this.pxToAgeDepth(px.x_lower[i], px.y[i]);
        if (ad && this.inspectionData.age_lower) {
          this.inspectionData.age_lower[i] = ad.age;
        }
      }
    }

    // 拟合 95% 置信区间上界
    if (upperCps.length >= 2 && px.x_upper) {
      this.fitLineFromPoints(upperCps, px.y, px.x_upper);
      for (let i = 0; i < px.y.length; i++) {
        const ad = this.pxToAgeDepth(px.x_upper[i], px.y[i]);
        if (ad && this.inspectionData.age_upper) {
          this.inspectionData.age_upper[i] = ad.age;
        }
      }
    }

    this.inspectionData.sed_rate = undefined;
    this.inspectionData.sed_rate_se = undefined;
    this.inspectionData.sed_window_depth = undefined;
    if (notify) {
      this.callbacks.onModelRefitted?.();
    }
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
      startBtn.textContent = this.calibMarkers.length >= 4 ? '重新点击标定点' : '在图上点击 4 个标定点';
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
      // Raw span and raw scale. `toFixed(0)` on the span turned a 0.062..1.482 calibration
      // into "= 1", and the rounded scale then disagreed with the two numbers beside it.
      parts.push(
        `年龄: ${agePxSpan} px = ${Math.abs(ageVals[1] - ageVals[0])} → ${perPx}/px`,
      );
    }
    if (depthVals[0] !== null && depthVals[1] !== null && depthPxSpan > 1e-6) {
      const perPx = Math.abs(depthVals[1] - depthVals[0]) / depthPxSpan;
      parts.push(
        `深度: ${depthPxSpan} px = ${Math.abs(depthVals[1] - depthVals[0])} → ${perPx}/px`,
      );
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

      // 这里曾用 `rgba(56,189,248,.75)` + setLineDash([8,5]) 画一个虚线矩形，表示"四点标定
      // 的外包框"。已删除：全仓没有任何文档解释它，界面上也没有文案，用户唯一能读到的含义
      // 是"这是个选择框"——而它既不能选也不能拖，还容易被误当成提取范围（真正的搜索窗来自
      // 坐标轴框线，与标定点无关，见 TestSearchRegionIndependentOfCalibration）。
      // 下面这组淡十字线保留：它们穿过四个标定点，拖点时有位置参照，本身不围成方块。

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

    const curveCps = this.controlPoints.filter((p) => p.kind === 'curve');
    const lowerCps = this.controlPoints.filter((p) => p.kind === 'lower' || p.kind === 'min');
    const upperCps = this.controlPoints.filter((p) => p.kind === 'upper' || p.kind === 'max');

    const lowerXs = px.x_lower || px.x_min;
    const upperXs = px.x_upper || px.x_max;

    // 1. 置信区间包络带 (只在 lower 与 upper 均有控制点覆盖的 Y 范围内填充与描边)
    if (this.showEnvelope && px.y && lowerXs && upperXs && lowerCps.length >= 2 && upperCps.length >= 2) {
      const minLowerY = Math.min(...lowerCps.map((p) => p.y));
      const maxLowerY = Math.max(...lowerCps.map((p) => p.y));
      const minUpperY = Math.min(...upperCps.map((p) => p.y));
      const maxUpperY = Math.max(...upperCps.map((p) => p.y));

      const envTop = Math.max(minLowerY, minUpperY);
      const envBot = Math.min(maxLowerY, maxUpperY);
      const envIdxs: number[] = [];
      for (let i = 0; i < px.y.length; i++) {
        if (px.y[i] >= envTop && px.y[i] <= envBot) envIdxs.push(i);
      }

      if (envIdxs.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(lowerXs[envIdxs[0]], px.y[envIdxs[0]]);
        for (let k = 1; k < envIdxs.length; k++) {
          const idx = envIdxs[k];
          ctx.lineTo(lowerXs[idx], px.y[idx]);
        }
        for (let k = envIdxs.length - 1; k >= 0; k--) {
          const idx = envIdxs[k];
          ctx.lineTo(upperXs[idx], px.y[idx]);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(245, 158, 11, 0.32)';
        ctx.fill();
      }

      // 下界线 (仅在 lower 控制点有效范围内)
      const lowerIdxs: number[] = [];
      for (let i = 0; i < px.y.length; i++) {
        if (px.y[i] >= minLowerY && px.y[i] <= maxLowerY) lowerIdxs.push(i);
      }
      if (lowerIdxs.length >= 2) {
        strokeWithHalo(ctx, () => {
          ctx.moveTo(lowerXs[lowerIdxs[0]], px.y[lowerIdxs[0]]);
          for (let k = 1; k < lowerIdxs.length; k++) {
            ctx.lineTo(lowerXs[lowerIdxs[k]], px.y[lowerIdxs[k]]);
          }
        }, CURVE_COLORS.lower, 1.5 * inv);
      }

      // 上界线 (仅在 upper 控制点有效范围内)
      const upperIdxs: number[] = [];
      for (let i = 0; i < px.y.length; i++) {
        if (px.y[i] >= minUpperY && px.y[i] <= maxUpperY) upperIdxs.push(i);
      }
      if (upperIdxs.length >= 2) {
        strokeWithHalo(ctx, () => {
          ctx.moveTo(upperXs[upperIdxs[0]], px.y[upperIdxs[0]]);
          for (let k = 1; k < upperIdxs.length; k++) {
            ctx.lineTo(upperXs[upperIdxs[k]], px.y[upperIdxs[k]]);
          }
        }, CURVE_COLORS.upper, 1.5 * inv);
      }
    }

    // 2. 均值代表线 (仅在 curve 控制点有效范围内绘制)
    if (this.showCurve && px.y && px.x_curve && curveCps.length >= 2) {
      const minCurveY = Math.min(...curveCps.map((p) => p.y));
      const maxCurveY = Math.max(...curveCps.map((p) => p.y));
      const cIdxs: number[] = [];
      for (let i = 0; i < px.y.length; i++) {
        if (px.y[i] >= minCurveY && px.y[i] <= maxCurveY) cIdxs.push(i);
      }
      if (cIdxs.length >= 2) {
        strokeWithHalo(ctx, () => {
          ctx.moveTo(px.x_curve[cIdxs[0]], px.y[cIdxs[0]]);
          for (let k = 1; k < cIdxs.length; k++) {
            ctx.lineTo(px.x_curve[cIdxs[k]], px.y[cIdxs[k]]);
          }
        }, CURVE_COLORS.mean, 2.5 * inv);
      }
    }

    if (this.showCurve && this.controlPoints.length > 0) {
      for (let i = 0; i < this.controlPoints.length; i++) {
        const cp = this.controlPoints[i];
        const isSelected = i === this.selectedControlPointIndex;
        const color = (cp.kind === 'lower' || cp.kind === 'min')
          ? '#10b981'
          : (cp.kind === 'upper' || cp.kind === 'max')
          ? '#ef4444'
          : '#0284c7';
        const r = (cp.kind === 'curve' ? 4.2 : 3.6) * inv;

        // 选中高亮光环 (金黄醒目外环)
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, r + 4.5 * inv, 0, Math.PI * 2);
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.4 * inv;
          ctx.stroke();
        }

        ctx.beginPath();
        if (cp.kind === 'curve') {
          ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2);
        } else {
          // min 与 max 使用菱形标记区分
          ctx.moveTo(cp.x, cp.y - r * 1.2);
          ctx.lineTo(cp.x + r * 1.2, cp.y);
          ctx.lineTo(cp.x, cp.y + r * 1.2);
          ctx.lineTo(cp.x - r * 1.2, cp.y);
          ctx.closePath();
        }
        ctx.fillStyle = isSelected ? '#fef3c7' : '#ffffff';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.8 * inv;
        ctx.stroke();
      }
    }

    if (this.datingPoints.length > 0 && this.calibMarkers.length >= 4) {
      const calib = this.getCalibValues();
      if (calib) {
        const { aL, aR, dT, dB } = calib;
        const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;

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
    const pt = this.canvasToImage(e.clientX, e.clientY);
    const px = this.inspectionData.px_points;
    const hud = this.container.querySelector('#ad-canvas-hud');
    if (!hud || !px.y || px.y.length === 0) return;

    let bestIdx = 0;
    let minDiff = 99999;
    for (let i = 0; i < px.y.length; i++) {
      const diff = Math.abs(px.y[i] - pt.y);
      if (diff < minDiff) {
        minDiff = diff;
        bestIdx = i;
      }
    }

    const d = this.inspectionData.depths[bestIdx];
    const a = this.inspectionData.ages[bestIdx];
    const lowerVal = this.inspectionData.age_lower
      ? this.inspectionData.age_lower[bestIdx]
      : this.inspectionData.age_min
      ? this.inspectionData.age_min[bestIdx]
      : a - 100;
    const upperVal = this.inspectionData.age_upper
      ? this.inspectionData.age_upper[bestIdx]
      : this.inspectionData.age_max
      ? this.inspectionData.age_max[bestIdx]
      : a + 100;

    const dUnit = (this.container.querySelector('#ad-inp-depth-unit') as HTMLInputElement | null)?.value?.trim() || 'cm';
    const aUnit = (this.container.querySelector('#ad-inp-age-unit') as HTMLInputElement | null)?.value?.trim() || 'cal yrBP';

    const cursorAd = this.pxToAgeDepth(pt.x, pt.y);
    const hudNum = (v: number): string => (Number.isFinite(v) ? v.toFixed(3) : '—');

    let cursorInfo = '';
    if (cursorAd) {
      cursorInfo = `光标物理坐标: <strong style="color:var(--text-heading);">${hudNum(cursorAd.depth)} ${dUnit}</strong> | <strong style="color:var(--text-heading);">${hudNum(cursorAd.age)} ${aUnit}</strong> ➔ `;
    }

    hud.innerHTML = `${cursorInfo}最近层位: <strong style="color:var(--accent-blue);">${hudNum(d)} ${dUnit}</strong> ➔ 均值年代: <strong style="color:var(--text-heading);">${hudNum(a)} ${aUnit}</strong> (95% CI: <span style="color:var(--accent-amber);">${hudNum(lowerVal)} ~ ${hudNum(upperVal)}</span>)`;
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
        const calib = this.getCalibValues();
        let pickedDepth = 0;
        let pickedAge = 0;
        if (calib && this.calibMarkers.length >= 4) {
          const { aL, aR, dT, dB } = calib;
          const orientStd = (this.container.querySelector('#ad-orient-std') as HTMLInputElement)?.checked ?? true;
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
        this.history.push('拾取测年点', this.captureState());
        const newPoint: DatingPoint = {
          id: `14C_${this.datingPoints.length + 1}`,
          depth: Math.max(0, pickedDepth),
          age: pickedAge,
          error: 30,
          thickness: 1,
          cc: 1,
        };
        this.datingPoints.push(newPoint);
        this.callbacks.onDatingPointPicked?.(newPoint);
        this.showHudNotice(`已拾取测年点: ${newPoint.depth} cm ➔ ${newPoint.age} cal yrBP (可按 Ctrl+Z 撤销)`);
        this.renderCanvas();
        return;
      }

      if (this.activeFMode === 'add') {
        this.history.push('添加控制点', this.captureState());
        const newCp: ControlPoint = {
          id: `cp_${this.editTarget}_${Date.now()}`,
          x: pt.x,
          y: pt.y,
          kind: this.editTarget,
        };
        this.controlPoints.push(newCp);
        this.controlPoints.sort((a, b) => a.y - b.y);
        this.selectedControlPointIndex = this.controlPoints.indexOf(newCp);
        this.refitCurveFromControlPoints();
        this.renderCanvas();
        this.showHudNotice(`已在${this.editTarget === 'curve' ? '均值线' : this.editTarget === 'lower' ? '下界线' : '上界线'}添加控制点 (可按 Ctrl+Z 撤销)`);
        return;
      }

      if (this.activeFMode === 'delete') {
        const cpIdx = this.findControlPointAt(pt);
        if (cpIdx >= 0) {
          this.history.push('删除控制点', this.captureState());
          this.controlPoints.splice(cpIdx, 1);
          this.selectedControlPointIndex = null;
          this.refitCurveFromControlPoints();
          this.renderCanvas();
          this.showHudNotice('已删除控制点 (可按 Ctrl+Z 撤销)');
          return;
        }
      }

      if (this.activeFMode === 'adjust') {
        const cpIdx = this.findControlPointAt(pt);
        if (cpIdx >= 0) {
          this.selectedControlPointIndex = cpIdx;
          const cp = this.controlPoints[cpIdx];
          this.setEditTarget(cp.kind);
          this.draggingControlPoint = cpIdx;
          this.dragStartSnapshot = this.captureState('移动控制点');
          e.preventDefault();
          this.renderCanvas();
          return;
        } else {
          this.selectedControlPointIndex = null;
          this.renderCanvas();
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
        this.refitCurveFromControlPoints(false);
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
        const cpIdx = this.draggingControlPoint;
        this.draggingControlPoint = null;
        if (this.dragStartSnapshot && this.controlPoints[cpIdx]) {
          const origCp = this.dragStartSnapshot.controlPoints[cpIdx];
          const currCp = this.controlPoints[cpIdx];
          if (!origCp || Math.hypot(currCp.x - origCp.x, currCp.y - origCp.y) > 0.5) {
            this.history.pushSnapshot(this.dragStartSnapshot);
            this.showHudNotice('已微调控制点位置 (可按 Ctrl+Z 撤销)');
          }
        }
        this.dragStartSnapshot = null;
        this.callbacks.onModelRefitted?.();
        return;
      }
      if (this.panning) {
        this.panning = null;
        return;
      }
      if (this.excludeArmed && this.excludePreview) {
        const [x0, y0, x1, y1] = this.excludePreview;
        if (Math.abs(x1 - x0) > 4 && Math.abs(y1 - y0) > 4) {
          this.history.push('添加排除区', this.captureState());
          this.excludeBoxes.push([
            Math.round(x0),
            Math.round(y0),
            Math.round(x1),
            Math.round(y1),
          ]);
          this.showHudNotice('已添加排除区 (可按 Ctrl+Z 撤销)');
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
    window.addEventListener('mouseup', endDrag);
    canvas.addEventListener('mouseleave', () => {
      if (this.draggingControlPoint !== null) {
        endDrag();
      }
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

    // 绑定撤销/重做按钮
    const btnUndo = this.container.querySelector('#ad-btn-undo');
    const btnRedo = this.container.querySelector('#ad-btn-redo');
    if (btnUndo) {
      const handleUndoClick = () => this.undo();
      btnUndo.addEventListener('click', handleUndoClick);
      this.disposers.push(() => btnUndo.removeEventListener('click', handleUndoClick));
    }
    if (btnRedo) {
      const handleRedoClick = () => this.redo();
      btnRedo.addEventListener('click', handleRedoClick);
      this.disposers.push(() => btnRedo.removeEventListener('click', handleRedoClick));
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !this.isSpaceDown) {
        this.isSpaceDown = true;
        canvas.style.cursor = 'grab';
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // 撤销快捷键 (Ctrl+Z / Cmd+Z，排除 Shift)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')) {
        e.preventDefault();
        e.stopPropagation();
        this.undo();
        return;
      }

      // 重做快捷键 (Ctrl+Y / Cmd+Y 或 Ctrl+Shift+Z / Cmd+Shift+Z)
      if (
        (e.ctrlKey || e.metaKey) &&
        ((e.key === 'y' || e.key === 'Y' || e.code === 'KeyY') ||
          (e.shiftKey && (e.key === 'z' || e.key === 'Z' || e.code === 'KeyZ')))
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.redo();
        return;
      }

      // 视口快捷键对齐主画布
      // 适屏 (F / f)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'f' || e.key === 'F' || e.code === 'KeyF')) {
        e.preventDefault();
        this.fitViewport();
        this.showHudNotice('视图: 适应屏幕居中 (F)');
        return;
      }

      // 1:1 原始比例 (Ctrl+1 / Cmd+1)
      if ((e.ctrlKey || e.metaKey) && (e.key === '1' || e.code === 'Digit1')) {
        e.preventDefault();
        this.reset100();
        this.showHudNotice('视图: 1:1 原始尺寸 (Ctrl+1)');
        return;
      }

      // 视图放大 (+ / =)
      if (!e.altKey && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        this.zoomAtCentre(true, e.ctrlKey || e.metaKey);
        this.showHudNotice(`视图放大: ${Math.round(this.viewport.scale * 100)}%`);
        return;
      }

      // 视图缩小 (- / _)
      if (!e.altKey && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        this.zoomAtCentre(false, e.ctrlKey || e.metaKey);
        this.showHudNotice(`视图缩小: ${Math.round(this.viewport.scale * 100)}%`);
        return;
      }

      // 快捷键模式切换对齐主画布：S=微调, A=加点, D=删点, P=拾取测年点
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') {
          this.setActiveFMode('adjust');
          this.updateFModeUI('adjust');
          e.preventDefault();
          return;
        }
        if (k === 'a') {
          this.setActiveFMode('add');
          this.updateFModeUI('add');
          e.preventDefault();
          return;
        }
        if (k === 'd') {
          this.setActiveFMode('delete');
          this.updateFModeUI('delete');
          e.preventDefault();
          return;
        }
        if (k === 'p') {
          this.setActiveFMode('pickDate');
          this.updateFModeUI('pickDate');
          e.preventDefault();
          return;
        }
      }

      // 控制点物理删除 (Delete / Backspace)
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedControlPointIndex !== null && this.controlPoints[this.selectedControlPointIndex]) {
          this.history.push('删除控制点', this.captureState());
          this.controlPoints.splice(this.selectedControlPointIndex, 1);
          this.selectedControlPointIndex = null;
          this.refitCurveFromControlPoints();
          this.renderCanvas();
          this.showHudNotice('已删除控制点 (可按 Ctrl+Z 撤销)');
          e.preventDefault();
          return;
        }
      }

      // 控制点键盘微调 (Arrow keys: 1px, 按住 Shift 为 10px)
      if (!e.altKey && this.selectedControlPointIndex !== null && this.controlPoints[this.selectedControlPointIndex]) {
        const step = e.shiftKey ? 10 : 1;
        const cp = this.controlPoints[this.selectedControlPointIndex];
        let moved = false;
        if (e.key === 'ArrowLeft') {
          cp.x -= step;
          moved = true;
        } else if (e.key === 'ArrowRight') {
          cp.x += step;
          moved = true;
        } else if (e.key === 'ArrowUp') {
          cp.y -= step;
          moved = true;
        } else if (e.key === 'ArrowDown') {
          cp.y += step;
          moved = true;
        }
        if (moved) {
          if (!this.arrowKeyStartSnapshot) {
            this.arrowKeyStartSnapshot = this.captureState('微调控制点');
          }
          if (this.arrowKeyHistoryTimer) {
            clearTimeout(this.arrowKeyHistoryTimer);
          }
          this.arrowKeyHistoryTimer = window.setTimeout(() => {
            if (this.arrowKeyStartSnapshot) {
              this.history.pushSnapshot(this.arrowKeyStartSnapshot);
              this.arrowKeyStartSnapshot = null;
            }
            this.arrowKeyHistoryTimer = null;
          }, 500);

          this.refitCurveFromControlPoints(false);
          this.renderCanvas();
          e.preventDefault();
          return;
        }
      }

      // Alt+方向键平移（issue #106）
      const pan = panDeltaFromArrowKey(e);
      if (pan) {
        e.preventDefault();
        this.viewport.panBy(pan.dx, pan.dy);
        this.renderCanvas();
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
    if (this.arrowKeyHistoryTimer) {
      clearTimeout(this.arrowKeyHistoryTimer);
      this.arrowKeyHistoryTimer = null;
    }
    if (this.hudNoticeTimer) {
      clearTimeout(this.hudNoticeTimer);
      this.hudNoticeTimer = null;
    }
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
