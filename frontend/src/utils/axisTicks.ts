/**
 * 通用自适应坐标轴整洁刻度生成器 (Nice Numbers Algorithm)。
 * 严禁硬编码分段区间，根据数据量级与像素跨度自动生成专业学术出图刻度。
 */

export interface AxisTicksResult {
  majorStep: number;
  minorStep: number;
  majorTicks: number[];
  minorTicks: number[];
  decimals: number; // 自动推断保留小数位数，消除浮点精度尾巴
}

export function generateAxisTicks(
  min: number,
  max: number,
  plotLengthPx: number,
  minGapPx = 100
): AxisTicksResult {
  const span = max - min;
  if (!Number.isFinite(span) || span <= 0) {
    return { majorStep: 1, minorStep: 0.2, majorTicks: [min], minorTicks: [], decimals: 0 };
  }

  // 1. 根据像素宽度动态计算理想主刻度数量 (至少 3 个)
  const targetCount = Math.max(3, Math.round(plotLengthPx / Math.max(20, minGapPx)));
  const rawStep = span / targetCount;

  // 2. 数量级归一化，吸附到 [1, 2, 2.5, 5, 10] 通用整洁序列
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  let niceNorm = 10;
  let subdivisions = 5;
  if (norm <= 1) {
    niceNorm = 1;
    subdivisions = 5;
  } else if (norm <= 2) {
    niceNorm = 2;
    subdivisions = 4;
  } else if (norm <= 2.5) {
    niceNorm = 2.5;
    subdivisions = 5;
  } else if (norm <= 5) {
    niceNorm = 5;
    subdivisions = 5;
  }

  const majorStep = niceNorm * mag;
  const minorStep = majorStep / subdivisions;
  // 推断小数位数（消除 0.02 * 3 = 0.060000000000000005 类似浮点尾巴）
  const decimals = Math.max(0, Math.ceil(-Math.log10(minorStep) - 1e-9));

  // 3. 对齐步长整数倍生成主/次刻度（保持坐标轴数据边界不留多余白边）
  const eps = minorStep * 1e-4;
  const startMinor = Math.ceil((min - eps) / minorStep) * minorStep;
  const majorTicks: number[] = [];
  const minorTicks: number[] = [];

  for (let v = startMinor; v <= max + eps; v += minorStep) {
    const rounded = Number(v.toFixed(decimals));
    const rem = Math.abs(rounded / majorStep - Math.round(rounded / majorStep));
    if (rem < 1e-3) {
      majorTicks.push(rounded);
    } else {
      minorTicks.push(rounded);
    }
  }

  return { majorStep, minorStep, majorTicks, minorTicks, decimals };
}
