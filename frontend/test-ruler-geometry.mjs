// 真实模块测试：直接 import src/components/steps/rulerSpan.ts 的纯函数。
//
// 为什么放 Node 侧而不是 Playwright：需要把「端点落在列内/列外」这类几何逐一喂进去，
// 真实图上只有一种形态。
//
// 期望值来自 beginner-tutorial.png 的实测几何：轴线左缘 259/947/1352/1576、右缘
// 262/952/1357/1581（= 数据 0 点），末齿 825/1262/1542/1766。
// 注意 col1 的分列 start（954）在轴线右侧——所以 0 点必须取轴线，不能取 startX。
//
// 运行：node --experimental-strip-types test-ruler-geometry.mjs
import assert from 'node:assert';

const mod = await import('./src/components/steps/rulerSpan.ts');

console.log('--- 运行 rulerSpan 真实模块测试 ---');

const cols = [
  { col_index: 0, startX: 259, endX: 947 },
  { col_index: 1, startX: 954, endX: 1352 },
  { col_index: 2, startX: 1352, endX: 1576 },
  { col_index: 3, startX: 1576, endX: 1803 },
];
const geo = {
  roi_id: 'roi_1',
  median_spacing_px: 124.5,
  all_regular: true,
  calibration_suggestions: [],
  per_column: [
    { col_index: 0, name: 'col01', axis_row: 1664, axis_x: 259, axis_x_right: 262, ticks: [323, 449, 573, 699, 825], n_cells: 4, spacing_px: 126, regular: true, column_width: 688 },
    { col_index: 1, name: 'col02', axis_row: 1664, axis_x: 947, axis_x_right: 952, ticks: [1012, 1138, 1262], n_cells: 2, spacing_px: 125, regular: true, column_width: 398 },
    { col_index: 2, name: 'col03', axis_row: 1664, axis_x: 1352, axis_x_right: 1357, ticks: [1418, 1542], n_cells: 1, spacing_px: 124, regular: true, column_width: 224 },
    { col_index: 3, name: 'col04', axis_row: 1664, axis_x: 1576, axis_x_right: 1581, ticks: [1642, 1766], n_cells: 1, spacing_px: 124, regular: true, column_width: 227 },
  ],
};

// ---- 1. 每列「轴线 → 末齿」跨度 ---------------------------------------------
const spans = mod.detectedSpans(cols, geo);
assert.deepEqual(spans.map((s) => s.span), [563, 310, 185, 185]);
assert.deepEqual(
  spans.map((s) => s.axisX),
  [262, 952, 1357, 1581],
  '0 点必须取实测轴线右缘，不是 col.startX'
);
// 反向对照：轴线与分列 start 确实不同，断言才有判别力
assert.equal(spans[1].axisX, 952);
assert.equal(cols[1].startX, 954);
assert.equal(mod.maxDetectedSpan(spans), 563, '全 ROI 取最长跨度（量化误差最小）');
assert.equal(mod.maxDetectedSpan(mod.detectedSpans(cols, null)), null, '没有检测结果时必须返回 null，不能编一个数');
assert.deepEqual(
  mod.detectedSpans(cols, { ...geo, per_column: [] }).map((s) => s.span),
  [null, null, null, null]
);

// ---- 2. 每格单位数 → px/单位；每列用自身末齿当第二端点 ---------------------
// 用户只填「每格多少单位」（组的属性），换算唯一依据仍是水平距离 ÷ 数值差。
const UNITS_PER_CELL = 20;
const pxPerUnit = geo.median_spacing_px / UNITS_PER_CELL; // 124.5/20 = 6.225
assert.ok(Math.abs(pxPerUnit - 6.225) < 1e-9);

const secondTicks = spans.map((s) => ({ px: s.axisX + s.span, v2: s.span / pxPerUnit }));
// 端点 = 各列实测末齿，逐列钉死
assert.deepEqual(
  secondTicks.map((t) => t.px),
  [825, 1262, 1542, 1766],
  '第二端点必须等于该列自己检测到的末齿'
);
// 独立几何交叉核对：col0 跨度 563px 在 6.225 px/单位下 ≈ 90.4 个单位，
// 与图上最后一条标签 90 吻合。这条不依赖"用户读哪一列的哪个数"。
assert.ok(
  Math.abs(secondTicks[0].v2 - 90.44) < 0.05,
  `col0 折算读数应 ≈90.4（图印 90），实得 ${secondTicks[0].v2.toFixed(2)}`
);
assert.ok(Math.abs(secondTicks[1].v2 - 49.80) < 0.05, `col1 折算读数 ${secondTicks[1].v2.toFixed(2)}`);
for (const [i, t] of secondTicks.entries()) {
  const col = cols[i];
  assert.ok(t.px <= col.endX + 15, `col${i} 端点 ${t.px} 越过后端上限 ${col.endX + 15}`);
  assert.ok(t.px < 1923, `col${i} 端点 ${t.px} 不得越过图幅宽度`);
  assert.ok(
    Math.abs((t.px - spans[i].axisX) / t.v2 - pxPerUnit) < 1e-9,
    `col${i} px/单位必须与基准相等`
  );
}
// 反向对照：轴线与分列 start 确实不同，断言才有判别力
assert.equal(spans[1].axisX, 952);
assert.equal(cols[1].startX, 954);

// ---- 3. 第一行检测文本：成功 / 无刻度尺 / 未就绪 / 失败 ---------------------
assert.equal(mod.describeRulerDetection(geo, null, false), '检测：4 列 · 刻距 124.5px · 规则');
assert.equal(
  mod.describeRulerDetection({ ...geo, all_regular: false }, null, false),
  '检测：4 列 · 刻距 124.5px · 刻距不均'
);
assert.equal(
  mod.describeRulerDetection({ ...geo, per_column: [] }, null, false),
  '检测：0 列，未找到刻度尺（无法自动取跨度）'
);
assert.equal(mod.describeRulerDetection(null, '后端 500', false), '检测失败：后端 500');
assert.equal(mod.describeRulerDetection(null, null, true), '正在检测刻度尺…');

console.log('✓ rulerSpan：3 组判据全部通过');
