export interface AgeDepthModelInspectionData {
  depths: number[];
  ages: number[];
  age_min: number[];
  age_max: number[];
  /**
   * Windowed-regression sedimentation rate (depth_unit per year) and its standard error,
   * ALREADY decimated to the same rows as `depths` by the backend. Null = undefined at
   * that horizon (e.g. non-positive slope). Absent on payloads built before the field
   * existed, and after manual table edits that invalidated alignment -- render as "—".
   */
  sed_rate?: (number | null)[];
  sed_rate_se?: (number | null)[];
  /** Window thickness (depth_unit) the rates were regressed over. */
  sed_window_depth?: number | null;
  px_points?: {
    y: number[];
    x_curve: number[];
    x_min: number[];
    x_max: number[];
  };
  metadata: {
    curve_type: string;
    envelope_type: string;
    depth_unit: string;
    age_unit: string;
    calibration_curve: string;
    notes?: string;
    curve_channel?: string;
    curve_channel_reason?: string;
    /** Resolved age direction, deducted from the calibration unless the user forced one. */
    age_increases_downcore?: boolean;
    age_direction_reason?: string;
  };
}

export interface DatingPoint {
  id: string;
  depth: number;
  age: number;
  error: number;
  thickness: number;
  cc: number; // 1 = IntCal20, 2 = Marine20, 3 = SHCal20, 0 = Non-14C
}

/** The four calibration handles, clicked in this order. */
export type CalibKind = 'ageA' | 'ageB' | 'depthA' | 'depthB';

export interface CalibMarker {
  kind: CalibKind;
  /** Position in image pixel coordinates (not CSS pixels). */
  x: number;
  y: number;
}

export interface ControlPoint {
  id: string;
  x: number;
  y: number;
  kind: 'curve' | 'min' | 'max';
}

export interface MappedSamplesData {
  depths: number[];
  age_est: number[];
  age_min: number[];
  age_max: number[];
  px_y?: number[];
  px_x_curve?: number[];
  rate?: {
    acc_rate_yr_per_depth: (number | null)[];
    acc_rate_yr_per_depth_min: (number | null)[];
    acc_rate_yr_per_depth_max: (number | null)[];
    sed_rate_depth_per_yr: (number | null)[];
    units?: { acc_rate: string; sed_rate: string };
  };
  /**
   * Windowed-regression rate with an analytic standard error, from
   * `AgeDepthModel.estimate_sedimentation_rate`. This is the reportable value; `rate` above
   * is the pointwise curve derivative (no error bar, undefined where isotonic pooling
   * flattened the curve).
   */
  sedimentation?: {
    depths: number[];
    sed_rate: (number | null)[];
    sed_rate_se: (number | null)[];
    acc_rate: (number | null)[];
    acc_rate_se: (number | null)[];
    status: string[];
    window_used: number;
    window_per_horizon: number[];
    horizons_available: number;
    age_scale_inferred: string;
    years_per_age_unit: number;
    rate_units: { sed_rate: string; acc_rate: string };
    method: string;
    /** Present only when the estimate was refused outright. */
    error?: string;
  };
}

export const CALIB_ORDER: CalibKind[] = ['ageA', 'ageB', 'depthA', 'depthB'];

export const CALIB_META: Record<CalibKind, { label: string; ordinal: string; color: string }> = {
  ageA: { label: '年龄轴端点 1', ordinal: '①', color: '#facc15' },
  ageB: { label: '年龄轴端点 2', ordinal: '②', color: '#facc15' },
  depthA: { label: '深度轴端点 1', ordinal: '③', color: '#34d399' },
  depthB: { label: '深度轴端点 2', ordinal: '④', color: '#34d399' },
};

export const EXCLUDE_BOX_COLOR = 'rgba(239, 68, 68, 0.75)';
export const MARKER_HIT_RADIUS = 10;

export const CURVE_COLORS = {
  median: '#38bdf8', // blue
  max: '#a78bfa', // violet
  min: '#fb923c', // orange
} as const;

export const HALO_COLOR = 'rgba(15, 23, 42, 0.55)';

/** Draws a stroke twice: a wider dark halo, then the bright line on top. */
export function strokeWithHalo(
  ctx: CanvasRenderingContext2D,
  path: () => void,
  color: string,
  width: number
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  path();
  ctx.strokeStyle = HALO_COLOR;
  ctx.lineWidth = width + 3;
  ctx.stroke();
  ctx.beginPath();
  path();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}
