export interface AgeDepthModelInspectionData {
  depths: number[];
  ages: number[];
  age_min: number[];
  age_max: number[];
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
