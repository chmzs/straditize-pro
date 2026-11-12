/**
 * 「标定进度」计数口径的判据（node --experimental-strip-types 直接跑 TS 源）。
 *
 * 守的是一次真实矛盾：同一面板上「进度 0/4 列 (0%)」与「已标定 · 0.1613 %/px」
 * 同时出现。根因是进度条只认 `x_ticks.length === 2`，而通过**分组斜率**
 * （`x_groups[].value_per_px`）标定的列根本没有 `x_ticks`。
 *
 * 判据：计数必须与列徽标同源（`CoordinateSystem.resolveColumnScale`），
 * 三类列各一条：
 * 1. 双刻度钉标定 → 已标定；
 * 2. 只有分组斜率 → **也必须算已标定**（这条在旧实现下必红）；
 * 3. 什么都没 → 未标定。
 */
import assert from 'node:assert/strict';
import { countCalibratedColumns, isColumnCalibrated } from './src/core/calibProgress.ts';

let n = 0;
let chain = Promise.resolve();
function check(label, fn) {
  chain = chain.then(async () => {
    await fn();
    n += 1;
    console.log(`ok ${n} - ${label}`);
  });
}

const base = {
  id: 'c1',
  name: 'Pinus',
  color: '#888',
  startX: 300,
  endX: 420,
  visible: true,
  plotType: 'area',
  // resolveColumnScale 的 calibrated 分支要求端点齐备（scaleCalib），否则退回未标定
  scaleCalib: { originX: 300, originVal: 0, calibX: 420, calibVal: 100, unit: '%' },
};

check('双刻度钉标定的列算已标定', () => {
  const col = { ...base, x_ticks: [{ px: 300, value: 0 }, { px: 420, value: 100 }] };
  assert.equal(isColumnCalibrated(col), true);
});

check('只有分组斜率（无 x_ticks）的列也必须算已标定', () => {
  const col = { ...base, scale_provenance: { calibrated: true, source: 'group' } };
  assert.equal(isColumnCalibrated(col), true);
});

check('无任何标定信息的列算未标定', () => {
  const col = { ...base };
  assert.equal(isColumnCalibrated(col), false);
});

check('计数覆盖三类混合，且分母是全部列', () => {
  const cols = [
    { ...base, id: 'a', x_ticks: [{ px: 300, value: 0 }, { px: 420, value: 100 }] },
    { ...base, id: 'b', scale_provenance: { calibrated: true, source: 'group' } },
    { ...base, id: 'c' },
  ];
  assert.equal(countCalibratedColumns(cols), 2, '两条已标定 + 一条未标定 = 2');
});

await chain;
console.log(`\ncalib-progress: ${n} checks passed`);
