/**
 * 画布图例（DOM，不是 canvas 绘制）。
 *
 * 用 DOM 的原因：图例不参与任何像素计算，画在 canvas 里会污染 e2e 的墨迹差值断言；
 * 放在容器里则完全不影响渲染结果。
 *
 * 色块类名必须与 `GeologyCanvas.drawColumnBoundaries` 的 `strokeStyle` 字面量一致，
 * 由 `e2e/legend-and-axis-stroke.spec.ts` 的 L1/L3 双向核对（改一边就红）。
 */
export function ensureCanvasLegend(container: HTMLElement): HTMLElement {
  const existing = container.querySelector('.canvas-legend') as HTMLElement | null;
  if (existing) return existing;

  const legend = document.createElement('div');
  legend.className = 'canvas-legend';
  legend.innerHTML = `
    <div class="canvas-legend-row"><span class="legend-sw legend-sw-column"></span>红：列切分线（轴线左缘）</div>
    <div class="canvas-legend-row"><span class="legend-sw legend-sw-zero"></span>绿：0 点（红线 + 轴线粗）</div>
    <div class="canvas-legend-row"><span class="legend-sw legend-sw-tick"></span>蓝：单位刻度（按像素长度等距外推）</div>
  `;
  container.appendChild(legend);
  return legend;
}
