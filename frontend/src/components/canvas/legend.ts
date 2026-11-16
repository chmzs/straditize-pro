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
    <div class="canvas-legend-row"><span class="legend-sw legend-sw-group" style="background: linear-gradient(90deg, var(--accent-blue) 50%, var(--status-warning) 50%);"></span>组色带：列上方横条 = 所属组（同组同色，每个连续段标一次组名），从 0 点（绿线）起画到列右界</div>
    <!-- 步骤 6 专属：两级轴粗的层级提示。用户分不清「拖绿线改本列」与「改组参数改整组」，
         是这次报障的根源之一；提示必须落在**画布内**（用户拖的时候眼睛在画布上），
         面板里再写一遍不算数。 -->
    <div class="canvas-legend-row legend-hint-zero-drag" data-role="hint-zero-drag">拖<strong>绿线</strong> = 改<strong>本列</strong> 0 点（轴粗）；在「列组」里填轴粗 = <strong>整组</strong>一起改</div>
  `;
  container.appendChild(legend);
  return legend;
}
