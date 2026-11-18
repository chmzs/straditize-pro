/**
 * 列组 → 颜色。**唯一定义点**（issue #108）。
 *
 * 画布上的「组归属条」与步骤 6 的组按钮都从这里取色，同一组在两处是同一个字符串——
 * 旧实现里画布按 `GROUP_BAND_PALETTE[idx % 6]` 取色、面板却全部用 `--accent-blue`，
 * 于是"画布上看得出是第 2 组"和"面板上是第几个按钮"在视觉上没有任何对应关系。
 *
 * ## 为什么放在绘制侧而不是 `styles/tokens.ts`
 *
 * 这是一份**数据身份**色表（认出"这是第几组"），不是语义 token（红=错误 / 绿=通过）。
 * 与本目录 `SampleOverlay.ts::SAMPLE_SOURCE_COLORS` + `sampleSourceColor()` 同一做法，
 * 那里已经证明可行：面板直接 import 该常量渲染色块，画布也用同一份。
 * 混进语义 token 表会让"红"在一处表示组、在另一处表示错误。
 *
 * ## 回退化规则（可判定）
 *
 * 旧实现取模，第 7 组与第 1 组同色——画布上「真同组」与「配色表回绕」不可区分：
 *
 *   index < 6   → GROUP_COLOR_PALETTE[index]
 *   index >= 6  → hsl((index × 137.5 + 15) mod 360, 72%, 72%)
 *
 * 两条各自可验的判据：
 *   ① 扩展区内部不重复：137.5° 是黄金角，相邻索引色相间隔最大；色相要 144 步才回到
 *      同值（137.5 × 144 = 19800 = 55 × 360），所以 145 组以内两两不同。
 *   ② 扩展区不与表内色混淆：表内六色的 HSL 明度最高是 `#a855f7` 的 65.1%，扩展区固定
 *      72%，明度带整体上移——不是"色相可能撞但硬说不会"。
 *
 * 已知边界（不粉饰）：扩展区的**色相**仍可能靠近某个表内色（如第 8 组 35° 与第 1 组
 * 38°）。区分靠的是明度带 + 色相不同，不是"保证色觉上无歧义"。组数超过 6 时，
 * 组按钮上的「N 列」标签仍是唯一无歧义的身份依据。
 */

/** 组配色表。顺序 = 组在 `roi.x_groups` 里的顺序，改顺序会让既有工程换色。 */
export const GROUP_COLOR_PALETTE = [
  '#0ea5e9',
  '#f59e0b',
  '#a855f7',
  '#10b981',
  '#ef4444',
  '#64748b',
] as const;

/** 超出配色表后的色相步长（度）与扩展带的 S/L（见文件头判据 ②：明度必须高于表内最高值）。 */
const GOLDEN_ANGLE_DEG = 137.5;
const EXTENDED_SATURATION = '72%';
const EXTENDED_LIGHTNESS = '72%';

/**
 * 取第 `index` 个组的颜色。
 *
 * `index` 是该组在 `roi.x_groups` 里的下标。非数值 / 负值按 0 处理：与画布旧行为
 * （`Math.max(0, groups.findIndex(...))`）一致，即"列没有组归属"落到第一个组的颜色。
 */
export function groupColorAt(index: number): string {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0;
  if (i < GROUP_COLOR_PALETTE.length) return GROUP_COLOR_PALETTE[i];
  const hue = Math.round((i * GOLDEN_ANGLE_DEG + 15) % 360);
  return `hsl(${hue} ${EXTENDED_SATURATION} ${EXTENDED_LIGHTNESS})`;
}
