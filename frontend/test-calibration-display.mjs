// 真实模块测试：什么算「这一列真的标定过」。
//
// 判据已收口到 `CoordinateSystem.resolveColumnScale`：它只读后端下发的
// `scale_provenance` + `scaleCalib`，不再自己解析 x_ticks / x_values / x_scales。
// 本文件守四件事：
//
//   1. 分列期只带猜测端点（tickEndX / maxPercent）→ 未标定
//   2. x_ticks 残缺（只有一个端点）→ 未标定
//   3. 后端判 group 已标定（x_ticks 为空、标度来自 x_values + tick_layout）
//      → 已标定，端点取 scaleCalib（这条防「界面说未标定、导出有数」）
//   4. 无 provenance 的离线对象（有 x_ticks + scaleCalib）→ 已标定（本地兜底）
//
// 判别力：
//   - 把 resolveColumnScale 改回"只看 x_ticks" → 第 3 组变红；
//   - 改成恒 true → 第 1/2 组变红。
//
// 运行：node --experimental-strip-types test-calibration-display.mjs
import assert from 'node:assert';

const { CoordinateSystem } = await import('./src/core/CoordinateSystem.ts');

console.log('--- 运行 hasRealCalibration 判据测试 ---');

// 1. 刚分列完：只有猜测端点，后端判未标定
assert.equal(
  CoordinateSystem.hasRealCalibration({
    startX: 954,
    endX: 1352,
    tickEndX: 1034,
    maxPercent: 20,
    scale_provenance: { calibrated: false, source: 'legacy' },
    scaleCalib: { originX: 954, originVal: 0, calibX: 1034, calibVal: 20, unit: '%' },
  }),
  false,
  'provenance 判未标定时，即使载荷带 tickEndX / maxPercent 也必须判未标定'
);

// 2. x_ticks 只有一个端点（残缺写入）→ 仍未标定
assert.equal(
  CoordinateSystem.hasRealCalibration({
    startX: 954,
    endX: 1352,
    x_ticks: [{ px: 952, value: 0 }],
  }),
  false,
  '只有一个刻度端点不算标定'
);

// 3. 载入工程后的 group 形态：x_ticks 为空，但后端把标度记在 x_values + tick_layout 上
const groupForm = {
  startX: 954,
  endX: 1352,
  x_ticks: null,
  x_values: [0, 90],
  x_group_id: 'roi_1_grp_1',
  scale_provenance: { calibrated: true, source: 'group' },
  scaleCalib: { originX: 952, originVal: 0, calibX: 1577, calibVal: 90, unit: '%' },
};
assert.equal(
  CoordinateSystem.hasRealCalibration(groupForm),
  true,
  '后端判 group 已标定时必须判已标定（否则界面「未标定」而导出有数）'
);
const groupScale = CoordinateSystem.resolveColumnScale(groupForm);
assert.equal(groupScale.source, 'group', 'source 沿用后端判定');
assert.equal(groupScale.val1, 90, '端点取后端下发的 scaleCalib');

// 4. 离线对象（没有 provenance）：有 x_ticks + scaleCalib 则算已标定
assert.equal(
  CoordinateSystem.hasRealCalibration({
    startX: 954,
    endX: 1352,
    x_ticks: [
      { px: 952, value: 0 },
      { px: 1577, value: 90 },
    ],
    scaleCalib: { originX: 952, originVal: 0, calibX: 1577, calibVal: 90, unit: '%' },
  }),
  true,
  '两个刻度端点 + 下发端点 = 已标定'
);

console.log('✔ hasRealCalibration 4 组判据全部通过');
