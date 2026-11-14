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


// ---- 4. ROI 下边界没盖住印刷轴行时的诊断文案（②，实测形态） ----------------
//
// 实测（hoya，`frontend/e2e/step6-axis-coverage-hint.spec.ts` 造同一形态）：
// herb 的框 (0,0)–(1900,1300)，而 hoya 的印刷轴行在 y≈1306/1313。后端
// `ruler.py:find_axis_row` 只在 `[…, min(h, ylim[1]))` 里搜，于是 29 列里 26 列
// `axis_row` 为 null、每列最多 1 条孤齿，面板此前只报「检测：29 列，未找到刻度尺」。
// 判据：有 26/29 列测不到轴线、且没有任何列测到 2 条齿 ⇒ 必须给出"下移下边界"的可行动作，
// 且数字全部来自传进来的实测值（不是写死）。
const clippedGeo = {
  roi_id: 'roi_2',
  median_spacing_px: null,
  all_regular: null,
  calibration_suggestions: [],
  per_column: [
    // 26 列测不到轴线，3 列各检出 1 条孤齿（真实分布）
    ...Array.from({ length: 3 }, (_, i) => ({ col_index: i, name: `c${i}`, axis_row: 1299, axis_x: null, axis_x_right: null, ticks: [500 + i], n_cells: 0, spacing_px: null, regular: null, column_width: 100 })),
    ...Array.from({ length: 26 }, (_, i) => ({ col_index: 3 + i, name: `c${3 + i}`, axis_row: null, axis_x: null, axis_x_right: null, ticks: [], n_cells: 0, spacing_px: null, regular: null, column_width: 100 })),
  ],
};
const gap = mod.describeAxisCoverageGap(clippedGeo, [0, 1300]);
assert.ok(gap, '26/29 列测不到轴线、0 列测到齿时必须给出诊断，不能只说"未找到刻度尺"');
assert.ok(gap.includes('1300'), `提示必须报出有效区下边界的真实值 1300，实得：${gap}`);
assert.ok(gap.includes('26') && gap.includes('29'), `提示必须报出实测列数 26/29，实得：${gap}`);
assert.ok(/下移|下边界/.test(gap), `提示必须给出可执行动作（把有效区下边界下移），实得：${gap}`);

// 负向对照 1：检测本来正常（有列测到 ≥2 条齿）⇒ 不得出现这条提示。
assert.equal(mod.describeAxisCoverageGap(geo, [0, 1700]), null, '刻度尺正常检测到时不得提示下移边界');
// 负向对照 2：所有列都测到了轴线（只是没齿）⇒ 病因不是下边界，不得误报。
const allAxis = { ...clippedGeo, per_column: clippedGeo.per_column.map((c) => ({ ...c, axis_row: 1299 })) };
assert.equal(mod.describeAxisCoverageGap(allAxis, [0, 1300]), null, '各列都测到轴线时不得把病因归给下边界');
// 边界：没有几何 / 没有 ylim ⇒ 没有实测值就不能说话。
assert.equal(mod.describeAxisCoverageGap(null, [0, 1300]), null);
assert.equal(mod.describeAxisCoverageGap(clippedGeo, null), null);

// ---- 4b. 轴行实测值时，提示必须报出那个 y（②的升级判据） -------------------
//
// 后端 `measureRuler` 的 `per_column[].axis_row_outside_roi` 只在"轴行存在但在
// 有效区之外"时有值（`ruler.py::find_axis_row_below_roi`），`null` 表示窗口内
// **确实找不到**轴行。两种语义必须给出两种文案：有值就报 y，没值就退回不带数字的
// 版本 —— 编一个 y 等于把"没找到"说成"找到了，在别处"。
const withAxisRow = {
  ...clippedGeo,
  per_column: clippedGeo.per_column.map((c) => ({ ...c, axis_row_outside_roi: 1307 })),
};
const measured = mod.describeAxisCoverageGap(withAxisRow, [0, 1300]);
assert.ok(measured, '有实测轴行时仍要给出诊断');
assert.ok(measured.includes('y≈1307'), `必须报出后端实测的轴行 y=1307，实得：${measured}`);
assert.ok(measured.includes('y=1300'), `必须报出有效区下边界 1300，实得：${measured}`);
assert.ok(measured.includes('26/29'), `必须报出实测列数 26/29，实得：${measured}`);
assert.ok(/下移/.test(measured), `必须给出可执行动作，实得：${measured}`);

// 负向对照：全部为 null（后端确实找不到轴行）⇒ **不得**出现"y≈"，退回旧文案。
const nullAxis = {
  ...clippedGeo,
  per_column: clippedGeo.per_column.map((c) => ({ ...c, axis_row_outside_roi: null })),
};
const fallback = mod.describeAxisCoverageGap(nullAxis, [0, 1300]);
assert.ok(fallback, '找不到轴行时仍要给出"下边界可能没盖住轴行"的诊断');
assert.ok(
  !fallback.includes('y≈'),
  `找不到轴行时不得编一个 y（实测 payload 里就是 null），实得：${fallback}`
);

// 众数判据：单列偏差不得改写提示里的 y（印刷轴行是全图版共用的一行）。
const oneOutlier = {
  ...clippedGeo,
  per_column: clippedGeo.per_column.map((c, i) => ({
    ...c,
    axis_row_outside_roi: i === 0 ? 999 : 1307,
  })),
};
assert.ok(
  mod.describeAxisCoverageGap(oneOutlier, [0, 1300]).includes('y≈1307'),
  '28 列说 1307、1 列说 999 时必须取众数 1307，不能被单列偏差带跑'
);

console.log('✓ rulerSpan：5 组判据全部通过');
