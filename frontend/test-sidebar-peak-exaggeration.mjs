// 侧栏"峰值（实测最大）"必须与导出表同口径：**除以 exaggeration_mult**。
//
// 缺陷现场（.recon_20261117，Picea 列 5× 夸大）：
//   导出 data.csv 里该列最大值 = 2.714%
//   侧栏徽标显示           = 13.6%      ← 没除倍率
// 原因是侧栏自己用 scale.val0/val1 线性外推，忘了同一个对象里已经带出来的
// `exaggerationMult`（`CoordinateSystem.resolveColumnScale` 给得出，`px_to_value` 也用得上）。
//
// 判别力（反向验证）：把 `peakValueFromScale` 里的 `/ exaggerationOf(scale)` 去掉
// → 第 1 组从 2.62 变 13.09，断言变红。
//
// 运行：node --experimental-strip-types test-sidebar-peak-exaggeration.mjs
import assert from 'node:assert';

const { peakValueFromScale, fullScaleValueFromScale, fullScaleAtColumnEdge, exaggerationOf } =
  await import('./src/core/scaleDisplay.ts');

console.log('--- 侧栏峰值：放大倍数换算 ---');

// 组斜率模型：0 点 940、每像素 0.2381（= 14.2857 / 60px），列右缘在 940+55
const slopeScale = {
  px0: 940,
  val0: 0,
  px1: 941,
  val1: 0.2381,
  exaggerationMult: 5,
};
const slopeScaleNoExag = { ...slopeScale, exaggerationMult: null };

// 1. 5× 夸大：峰值必须除回去（55px × 0.2381 = 13.09 → 2.62）
const rawPeak = (995 - 940) * 0.2381; // 13.0955：55px × 每像素 0.2381
assert.ok(
  Math.abs(peakValueFromScale(slopeScale, 995) - rawPeak / 5) < 1e-9,
  `5× 列峰值应为 ${rawPeak / 5}，实际 ${peakValueFromScale(slopeScale, 995)}`
);
// 2. 未设倍率：原样返回（零回归）
assert.ok(Math.abs(peakValueFromScale(slopeScaleNoExag, 995) - rawPeak) < 1e-9);
// 3. 倍率 <= 1 视为未放大（历史包里写 1 或 0.5 的脏数据不许把值放大）
assert.ok(Math.abs(peakValueFromScale({ ...slopeScale, exaggerationMult: 1 }, 995) - rawPeak) < 1e-9);
assert.ok(Math.abs(peakValueFromScale({ ...slopeScale, exaggerationMult: 0.5 }, 995) - rawPeak) < 1e-9);
// 4. 越过 0 点左侧：钳到 0，不显示负丰度
assert.equal(peakValueFromScale(slopeScale, 930), 0);
// 5. 两点刻度模型（x_ticks）：0 点在 1125 值 0，末齿在 1186 值 13.8，倍率 3
const ticksScale = { px0: 1125, val0: 0, px1: 1186, val1: 13.8, exaggerationMult: 3 };
assert.ok(Math.abs(peakValueFromScale(ticksScale, 1186) - 13.8 / 3) < 1e-9);
// 6. 满刻度（列右缘）提示：5× 列的"实际量程"是 14.2857/5 = 2.857
const fullScale = { px0: 940, val0: 0, px1: 940 + 60, val1: 60 * 0.2381, exaggerationMult: 5 };
assert.ok(Math.abs(fullScaleValueFromScale(fullScale) - (60 * 0.2381) / 5) < 1e-9);
// 7. exaggerationOf 的边界
assert.equal(exaggerationOf(null), 1);
assert.equal(exaggerationOf({ ...slopeScale, exaggerationMult: undefined }), 1);
assert.equal(exaggerationOf(slopeScale), 5);

console.log('OK：峰值/满刻度都按 exaggeration_mult 换算，未放大与脏值不改变读数');

// 8. 组斜率模型下"满刻度"必须按**列右缘**算，不能把 val1（每像素斜率）当刻度显示。
//    现场缺陷：列宽 60px、斜率 0.2381%/px → 侧栏 compact 徽章显示「0.2%」（那是斜率，
//    不是刻度）；正确值是 (995-940)*0.2381 = 13.0955，5× 列再除 5 → 2.6191。
assert.ok(
  Math.abs(fullScaleAtColumnEdge(slopeScale, 995) - rawPeak / 5) < 1e-9,
  `列右缘满刻度应为 ${rawPeak / 5}，实际 ${fullScaleAtColumnEdge(slopeScale, 995)}`
);
// 9. 未设倍率时列右缘满刻度就是图上刻度（零回归）
assert.ok(Math.abs(fullScaleAtColumnEdge(slopeScaleNoExag, 995) - rawPeak) < 1e-9);
// 10. 列宽为 0 的退化输入不许抛，也不许返回负值
assert.equal(fullScaleAtColumnEdge({ ...slopeScale, px1: 940 }, 940), 0);

console.log('OK：列右缘满刻度按 (endX−0点)×斜率÷倍率 计算');
