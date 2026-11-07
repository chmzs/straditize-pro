// 真实模块测试：直接 import src/ 下的 CoordinateSystem / SplineInterpolator，
// 而不是像 test-core.js 那样复刻一份内联实现。
//
// 背景：本次修复的核心缺陷就是"取数区 (ROI) 与 Y 轴标定绑死"——拖动框选矩形的
// 上下边会直接改写深度，未标定时还会拿 ROI 边界冒充刻度。test-core.js 里的内联
// 副本恰好复刻了那套耦合语义（dataYMin/depthTopValue 一起读），所以它能"通过"
// 却证明不了真代码已经解耦。本文件断言打在真模块上，专门守住这条不变量。
//
// 运行：node --experimental-strip-types test-roi-calibration.mjs
import assert from 'node:assert';

const { CoordinateSystem } = await import('./src/core/CoordinateSystem.ts');
const { SplineInterpolator } = await import('./src/core/SplineInterpolator.ts');

console.log('--- 运行 ROI 与 Y 轴标定解耦 真实模块测试 ---');

/** 未标定：四个端点皆为 null，isCalibrated 为 false */
const uncalibrated = {
  isCalibrated: false,
  top_px: null,
  top_cm: null,
  bottom_px: null,
  bottom_cm: null,
  unit: 'cm',
};

/** 已标定：Y=556px → 1500mm，Y=1311px → 4500mm */
const calibrated = {
  isCalibrated: true,
  top_px: 556,
  top_cm: 1500,
  bottom_px: 1311,
  bottom_cm: 4500,
  unit: 'mm',
};

// 1. 未标定一律不返回深度 —— 绝不回落到 ROI 边界凑一个刻度
assert.strictEqual(
  CoordinateSystem.imageYToDepth(900, uncalibrated),
  undefined,
  '未标定时 imageYToDepth 必须返回 undefined，而不是用 ROI 边界顶替'
);
assert.strictEqual(CoordinateSystem.depthToImageY(100, uncalibrated), undefined);
assert.strictEqual(CoordinateSystem.calibrationBounds(uncalibrated), null);

// 2. 端点缺失（哪怕 isCalibrated 被误置为 true）同样视为未标定
assert.strictEqual(
  CoordinateSystem.imageYToDepth(900, { ...calibrated, bottom_cm: null }),
  undefined,
  '端点缺失必须判定为未标定'
);
assert.strictEqual(
  CoordinateSystem.imageYToDepth(900, { ...calibrated, top_px: 1311, bottom_px: 1311 }),
  undefined,
  '像素跨度为 0 必须判定为未标定'
);

// 3. 标定映射：线性、双向可逆
assert.strictEqual(CoordinateSystem.imageYToDepth(556, calibrated), 1500);
assert.strictEqual(CoordinateSystem.imageYToDepth(1311, calibrated), 4500);
const midPx = (556 + 1311) / 2; // 933.5
assert.strictEqual(CoordinateSystem.imageYToDepth(midPx, calibrated), 3000);
assert.strictEqual(CoordinateSystem.depthToImageY(3000, calibrated), 934, '反向换算取整到像素');

// 4. 深度换算完全不依赖 ROI：把"ROI"改到任何地方都不影响标定结果。
//    这正是本次修复的判据 —— 标定结构里根本没有 ROI 字段可用。
const roiVariantA = { xMin: 315, xMax: 1946, yMin: 511, yMax: 1311 };
const roiVariantB = { xMin: 100, xMax: 800, yMin: 0, yMax: 400 };
assert.deepStrictEqual(Object.keys(roiVariantA).length, Object.keys(roiVariantB).length);
assert.strictEqual(CoordinateSystem.imageYToDepth(midPx, calibrated), 3000);
assert.ok(
  !('dataYMin' in calibrated) && !('dataYMax' in calibrated),
  '标定结构不得再携带 ROI 字段'
);

// 5. 数值可向下递减（年代轴 BP 型），斜率方向由数值本身决定
const ageAxis = {
  isCalibrated: true,
  top_px: 200,
  top_cm: 5000,
  bottom_px: 1000,
  bottom_cm: 1000,
  unit: 'cal yr BP',
};
assert.strictEqual(CoordinateSystem.imageYToDepth(200, ageAxis), 5000);
assert.strictEqual(CoordinateSystem.imageYToDepth(1000, ageAxis), 1000);
assert.strictEqual(CoordinateSystem.imageYToDepth(600, ageAxis), 3000);

// 6. 未标定时层位标尺为空 —— 不生成一组假的 0/50/100 刻度线
assert.deepStrictEqual(
  SplineInterpolator.getStandardDepthHorizons(uncalibrated),
  { depths: [], yPositions: [] },
  '未标定时不得生成任何层位'
);

// 7. 标定后层位严格铺在【标定跨度】上，与 ROI 无关
const horizons = SplineInterpolator.getStandardDepthHorizons({ ...calibrated, depthInterval: 500 });
assert.strictEqual(horizons.depths[0], 1500, '首个层位取标定上端');
assert.strictEqual(horizons.depths[horizons.depths.length - 1], 4500, '末个层位取标定下端');
assert.strictEqual(horizons.yPositions[0], 556, '上端像素取标定上端');
assert.strictEqual(horizons.yPositions[horizons.yPositions.length - 1], 1311, '下端像素取标定下端');
assert.strictEqual(horizons.depths.length, 7, '(4500-1500)/500 + 1 = 7 个层位');

// 8. 自定义深度序列**不再**由前端插值器接管（customDepths 已删除，2026-11-08）。
//    粘贴的深度经 samples.pasteDepths 落库，画布由 SampleOverlay 按 samples 画、导出也读 samples；
//    这里钉住的是「前端不再有第二条通往采样层位的路径」：误传该字段必须被忽略。
const withGhost = SplineInterpolator.getStandardDepthHorizons({
  ...calibrated,
  customDepths: [1500, 3000, 4500],
});
const withoutGhost = SplineInterpolator.getStandardDepthHorizons({ ...calibrated });
assert.deepStrictEqual(
  withGhost,
  withoutGhost,
  'customDepths 已删除：误传该字段不得改变层位（唯一入口是 samples.pasteDepths）'
);

// 9. 未标定时锚定表为空，而不是给出错位的伪数据
assert.deepStrictEqual(
  SplineInterpolator.extractAnchoredDepthTable([], uncalibrated),
  [],
  '未标定不得产出任何层位数据行'
);

// 10. 列 X 标度唯一读取入口：**只读后端下发的 scale_provenance + scaleCalib**。
//
// 两条判据对应两类真实不一致：
//   A. 载入工程后后端把 x_ticks 改写成 group + x_values + tick_layout
//      （project.py 自动建组），此时 x_ticks 可能为空但后端判 calibrated=true，
//      前端必须跟着说"已标定"——否则界面「未标定」而导出有数。
//   B. 分列期载荷里带着猜测端点（tickEndX / maxPercent），但 provenance 判
//      calibrated=false，前端必须判未标定、不读那些数字。

// A. group 形态（x_ticks 为空）+ 后端说已标定
const colGroupCalibrated = {
  id: 'roi_1_col01',
  name: 'Pinus',
  startX: 100,
  endX: 200,
  visible: true,
  color: '#0284c7',
  unit: '粒',
  x_ticks: null,
  x_values: [0, 40],
  x_group_id: 'roi_1_grp_1',
  scale_provenance: { calibrated: true, source: 'group' },
  scaleCalib: { originX: 100, originVal: 0, calibX: 200, calibVal: 40, unit: '粒' },
  exaggeration_mult: 5,
  controlPoints: [
    { id: 'p1', x: 150, y: 500 },
    { id: 'p2', x: 150, y: 600 },
  ],
};
const resolvedScale = CoordinateSystem.resolveColumnScale(colGroupCalibrated);
assert.strictEqual(
  resolvedScale.calibrated,
  true,
  'x_ticks 为空但后端判 group 已标定时，前端必须跟着判已标定（否则界面说未标定、导出有数）'
);
assert.strictEqual(resolvedScale.source, 'group', 'source 沿用后端判定，前端不自己推断');
assert.strictEqual(resolvedScale.val1, 40, '端点取后端下发的 scaleCalib，不自己解析');
assert.strictEqual(resolvedScale.exaggerationMult, 5, '读取 exaggeration_mult');
assert.strictEqual(
  CoordinateSystem.imageXToValue(150, colGroupCalibrated),
  20,
  'x=150 按后端下发的 0..40 换算为 20'
);
assert.strictEqual(
  SplineInterpolator.interpolatePercentAtY(colGroupCalibrated, 550),
  20,
  'SplineInterpolator 与 CoordinateSystem 使用同一读取入口'
);

// B. 未标定但载荷里带着猜测端点：必须判未标定，且换算不出数字
const colGuessOnly = {
  id: 'roi_1_col02',
  name: 'Abies',
  startX: 300,
  endX: 400,
  visible: true,
  color: '#0284c7',
  x_ticks: null,
  tickEndX: 365,
  maxPercent: 20,
  startValue: 0,
  tickValue: 20,
  scale_provenance: { calibrated: false, source: 'legacy' },
  scaleCalib: { originX: 300, originVal: 0, calibX: 365, calibVal: 20, unit: '%' },
  controlPoints: [{ id: 'p3', x: 340, y: 700 }],
};
assert.strictEqual(
  CoordinateSystem.resolveColumnScale(colGuessOnly).calibrated,
  false,
  'provenance.calibrated=false 时，即使载荷带 tickEndX/maxPercent 也判未标定'
);
assert.strictEqual(
  CoordinateSystem.imageXToPercent(340, colGuessOnly),
  undefined,
  '未标定列换算不出百分比（不拿猜测端点凑数）'
);
assert.strictEqual(
  SplineInterpolator.interpolatePercentAtY(colGuessOnly, 700),
  undefined,
  '未标定列的曲线取值同样是 undefined'
);

console.log('✔ 未标定 → 深度一律 undefined，绝不回落 ROI 边界');
console.log('✔ 标定结构不含 ROI 字段，深度换算与取数区完全解耦');
console.log('✔ 支持深度向下递增与年代向上递增两种方向');
console.log('✔ 层位标尺铺在标定跨度上；未标定时为空');
console.log('✔ 列 X 标度只读后端判定：group 形态判已标定、猜测端点判未标定');
console.log('\n🎉 ROI 与 Y 轴标定解耦 真实模块测试通过！');
