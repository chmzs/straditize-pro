/**
 * 刻度齿间距来源（`canvas/tickGeometry.ts`）的纯函数判据。
 *
 * 为什么不在 e2e 里像素验证齿的可见性：写了三版都没有判别力——把间距强制成 null
 * （等于完全不画齿）时判据仍然绿，因为底图自带水平虚线阴影，任意两条竖线的均值差
 * 都可能超过阈值。按 `docs/testing-strategy.md` 的规矩撤掉那种判据，改在这里钉**来源**：
 * 用户确认值 > 实测值 > null，且非法值必须被忽略。
 */
import assert from 'node:assert';

const { resolveTickSpacingPx, setMeasuredTickSpacing } = await import(
  './src/components/canvas/tickGeometry.ts'
);

// 1. 什么都没测到时不许画齿（否则画的是编出来的刻度）
setMeasuredTickSpacing(null);
assert.strictEqual(resolveTickSpacingPx(null), null, '未测到刻距时不得画齿');
assert.strictEqual(resolveTickSpacingPx(undefined), null, '未测到刻距时不得画齿');

// 2. 实测值可用：这是「用户还没点齿标定也能看见齿」的唯一来源
setMeasuredTickSpacing(124.5);
assert.strictEqual(resolveTickSpacingPx(null), 124.5, '实测刻距必须被采用');
assert.strictEqual(resolveTickSpacingPx(undefined), 124.5, '实测刻距必须被采用');

// 3. 用户确认值优先（组级 ref_span_px 是标定锚点，不能被测量值覆盖）
assert.strictEqual(resolveTickSpacingPx(40), 40, '用户确认值必须压过实测值');

// 4. 非法值一律忽略，不许把 NaN/0/1 当成间距画出一条假齿
for (const bad of [Number.NaN, 0, 1, -5, null]) {
  setMeasuredTickSpacing(bad);
  assert.strictEqual(resolveTickSpacingPx(null), null, `非法刻距 ${String(bad)} 必须被忽略`);
}

console.log('✔ 齿间距来源：确认值 > 实测值 > 不画；非法值忽略');
