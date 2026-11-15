// 0 点（绿线）一致性：画布换算与组归属条都必须从 startX + 轴粗 起算。
//
// 缺陷背景（用户视觉抓到、实测定位）：0 点 = 列左缘 + 轴粗（ARCHITECTURE 6.4），
// 但前端有两处拿列左缘冒充 0 点，导致每列读数系统性偏大 轴粗x斜率
// （本仓实测 6px x 0.16667 = +1.0%），用户看到的就是「多了轴线粗」「超过 102%」。
//
// 本文件守三件事：
//   1. resolveColumnScale 的 px0 必须是后端下发的 scaleCalib.originX（= abs_px0），
//      用它算出的百分比与「从列左缘算」相差恰好 轴粗x斜率；
//   2. 缺 scaleCalib 时 resolveColumnScale 必须判未标定（不许拿 startX 冒充）；
//   3. 组归属条必须从 0 点起画（x = startX + 轴粗），宽度到 endX 为止。
//
// 判别力（反向验证）：
//   - 把 resolveColumnScale 的 px0 改回 col.startX -> 第 1 组变红；
//   - 把 getGroupBandRect 的 x 改回 col.startX -> 第 3 组变红。
//
// 运行：node --experimental-strip-types test-zero-point.mjs
import assert from 'node:assert';

const { CoordinateSystem } = await import('./src/core/CoordinateSystem.ts');
const { groupBandRect } = await import('./src/components/canvas/groupBandRect.ts');

console.log('--- 0 点一致性测试 ---');

const START_X = 1576;
const STROKE = 6;
const SLOPE = 0.16666666666666666;
const END_X = 1808;
const ABS_PX0 = START_X + STROKE;

function column(originX) {
  return {
    id: 'roi_1_col04',
    startX: START_X,
    endX: END_X,
    scale_type: 'linear',
    unit: '%',
    scale_provenance: { calibrated: true, source: 'group_slope' },
    scaleCalib:
      originX == null
        ? undefined
        : { originX, originVal: 0, calibX: originX + 1, calibVal: SLOPE, unit: '%' },
  };
}

function percentAt(col, x) {
  const sc = CoordinateSystem.resolveColumnScale(col);
  assert.equal(sc.calibrated, true, '这一列必须是已标定形态，断言才有意义');
  return ((x - sc.px0) * (sc.val1 - sc.val0)) / (sc.px1 - sc.px0);
}

const xPix = 1675;
const fromZero = percentAt(column(ABS_PX0), xPix);
const fromLeftEdge = percentAt(column(START_X), xPix);
const expectZero = (xPix - ABS_PX0) * SLOPE;

assert.ok(
  Math.abs(fromZero - expectZero) < 1e-9,
  '从 0 点算应为 ' + expectZero.toFixed(2) + '%，实得 ' + fromZero.toFixed(2) + '%'
);
assert.ok(
  Math.abs(fromZero - 15.5) < 0.1,
  '该行导出口径是 15.5%（工程包 data.csv），画布应同值，实得 ' + fromZero.toFixed(2) + '%'
);
assert.ok(
  Math.abs(fromLeftEdge - fromZero - STROKE * SLOPE) < 1e-9,
  '从列左缘算必须整体偏大 轴粗x斜率 = ' +
    (STROKE * SLOPE).toFixed(3) +
    '%，实测差 ' +
    (fromLeftEdge - fromZero).toFixed(3) +
    '%'
);

assert.equal(
  CoordinateSystem.resolveColumnScale(column(null)).calibrated,
  false,
  '没有 scaleCalib 时必须判未标定，不能拿列左缘冒充 0 点'
);

const band = groupBandRect(START_X, END_X, STROKE);
assert.equal(band.x, ABS_PX0, '组归属条左端必须是 ' + ABS_PX0 + '（0 点），实得 ' + band.x);
assert.notEqual(band.x, START_X, '组归属条左端不得等于列左缘（红线）');
assert.equal(band.width, END_X - ABS_PX0, '组归属条宽度必须到列右界为止');

console.log('OK：0 点换算与组归属条一致');
