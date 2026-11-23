import { DiagramData, SampleHorizon } from '../../types/pollen';
import { Viewport } from '../../core/Viewport';
import { showsSampleHorizons } from '../../core/WorkflowStage';

export const id = 'sample-horizons-overlay';
export const z = 30;

/**
 * 层位来源 → 颜色。**四类 source 必须互异**（issue #85：`grid` 原先掉进 `manual`
 * 分支，面板统计是四类而画布只有三色）。
 *
 * 本文件是本常量的唯一定义点，`SamplesPanel` 的色标直接复用，避免两处各写一份
 * 颜色而再次漂移。
 *
 * 注意：`frontend/src/styles/tokens.ts` 规定"禁止在组件内硬编码颜色"，本文件的
 * rgba 硬编码属于既有写法（改动前就有）；把调色板搬进 tokens 需要新增设计资产，
 * 超出 #85 范围，故沿用原写法并把颜色收敛到这一个常量。
 */
export const SAMPLE_SOURCE_COLORS = {
  auto: { rgb: [16, 185, 129], alpha: 0.75 }, // 绿：跨属种拐点共识（auto）
  paste: { rgb: [56, 189, 248], alpha: 0.8 }, // 蓝：外部粘贴的深度
  manual: { rgb: [245, 158, 11], alpha: 0.85 }, // 橙：手工添加
  grid: { rgb: [139, 92, 246], alpha: 0.85 }, // 紫：等距网格
} as const;

/** 四种来源的显示顺序，`SamplesPanel` 色标与统计文本都按这个顺序排列。 */
export const SAMPLE_SOURCE_ORDER: readonly SampleHorizon['source'][] = [
  'auto',
  'paste',
  'manual',
  'grid',
];

/**
 * 取某来源的绘制颜色。
 *
 * `alphaScale` 供 #83 的支持度编码缩放不透明度。未知来源按 `manual` 处理——
 * 与后端 `samples_set` 把未知 source 兜底成 `manual` 的口径一致。
 */
export function sampleSourceColor(source: SampleHorizon['source'], alphaScale = 1): string {
  const entry = SAMPLE_SOURCE_COLORS[source] ?? SAMPLE_SOURCE_COLORS.manual;
  // 取两位小数，避免 `0.75 * 0.4` 这类浮点尾巴进入 `rgba()` 字符串。
  const alpha = Math.round(Math.min(1, Math.max(0.15, entry.alpha * alphaScale)) * 100) / 100;
  const [r, g, b] = entry.rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 支持度归一化到 0..1（issue #83）：1 列 → 0（孤峰），≥8 列 → 1（强共振）。
 *
 * 返回 `null` 表示这个层位没有共识度信息（粘贴 / 手工 / 网格层位的正常状态），
 * 此时调用方必须保持原有线宽与不透明度，不得编造一个中间值。
 */
export function supportWeight(supportColumns: number | null | undefined): number | null {
  if (
    typeof supportColumns !== 'number' ||
    !Number.isFinite(supportColumns) ||
    supportColumns < 1
  ) {
    return null;
  }
  return Math.min(1, (supportColumns - 1) / 7);
}

/**
 * 采样层位横线。
 *
 * 世界坐标绘制（见 `_registry.ts` 的坐标契约）。
 *
 * 线宽与不透明度随 `support_columns`（该层位去重后的支持列数）变化：
 * 1 列支持的孤峰画得细而淡，8 列以上的共振画得粗而实（#83）。
 * 没有 `support_columns` 的层位（粘贴 / 手工 / 网格）保持 1px 与本色不变。
 */
export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport, stage?: number): void {
  const samples = data.samples || [];
  if (samples.length === 0) return;

  // 约束：只在步骤 7 和步骤 8（STAGE.SPEARS_AND_SAMPLES / STAGE.QA）呈现，且用户未手动关闭；其他步骤不呈现，防止干扰视觉。
  if (stage !== undefined && !showsSampleHorizons(stage)) return;
  if (vp.showSamples === false) return;

  const inv = 1 / (vp.scale || 1);
  const roi = data.rois?.find((r) => r.id === data.active_roi_id) || data.rois?.[0];
  const rx0 = roi?.xlim?.[0] ?? roi?.xMin ?? 0;
  const rx1 = roi?.xlim?.[1] ?? roi?.xMax ?? data.imageWidth ?? 1000;

  ctx.save();
  ctx.lineWidth = 1 * inv;
  ctx.setLineDash([2 * inv, 4 * inv]);
  ctx.font = `${10 * inv}px monospace`;

  for (const s of samples) {
    const weight = supportWeight(s.support_columns);
    if (weight === null) {
      ctx.lineWidth = 1 * inv;
      ctx.strokeStyle = sampleSourceColor(s.source);
    } else {
      ctx.lineWidth = (1 + 2 * weight) * inv; // 1px → 3px
      ctx.strokeStyle = sampleSourceColor(s.source, 0.4 + 0.8 * weight); // 淡 → 实
    }

    ctx.beginPath();
    ctx.moveTo(rx0, s.row_px);
    ctx.lineTo(rx1, s.row_px);
    ctx.stroke();

    if (s.depth !== null && s.depth !== undefined) {
      ctx.fillStyle = ctx.strokeStyle as string;
      ctx.fillText(`${s.depth}`, rx0 - 30 * inv, s.row_px + 3 * inv);
    }
  }

  ctx.restore();
}
