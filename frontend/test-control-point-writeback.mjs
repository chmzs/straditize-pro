// 控制点写回：x 必须钳到**当前** 0 点（resolveColumnScale(col).px0）。
//
// 缺陷背景：前端镜像里的 x 来自上一次标定；用户改标定后 0 点右移，旧 x 落在新 0 点
// 左侧，后端拒绝（-32602 读数不能为负）→ 整列写回失败，导出停在旧值。
// e2e 实测现场：「该列 0 点在 x=324，你给的点（row 511, x=319）在它左侧」。
//
// 判别力（反向验证）：
//   - 把 clampToZeroPoint 改成恒等函数 → 第 1 组变红；
//   - 把 controlPointsForWriteback 的行号取整改回原值 → 第 4 组变红。
//
// 运行：node --experimental-strip-types test-control-point-writeback.mjs
import assert from 'node:assert';

const { clampToZeroPoint, controlPointsForWriteback } = await import(
  './src/core/controlPointWriteback.ts'
);

console.log('--- 控制点写回 0 点钳制测试 ---');

const ZERO = 324;

// 1. 陈旧值（标定前的 x）必须抬到 0 点
assert.equal(clampToZeroPoint(319, ZERO), 324, '319 在 0 点左侧，必须抬到 324');
// 2. 恰在 0 点：允许（丰度 0 是合法读数）
assert.equal(clampToZeroPoint(324, ZERO), 324);
// 3. 用户点/拖的位置（≥ 0 点）原样返回，不被悄悄挪动
assert.equal(clampToZeroPoint(400, ZERO), 400);
assert.equal(clampToZeroPoint(324.5, ZERO), 324.5);
// 4. 整列载荷：行取整、x 钳制、manual 缺省 true
const payload = controlPointsForWriteback(
  [
    { x: 319, y: 511.4 },
    { x: 400, y: 520.6, isManual: false },
  ],
  ZERO
);
assert.deepEqual(payload, [
  { row: 511, x: 324, manual: true },
  { row: 521, x: 400, manual: false },
]);
// 5. 非有限值不参与钳制（避免 NaN 传成 NaN 之外的东西）
assert.ok(Number.isNaN(clampToZeroPoint(Number.NaN, ZERO)));

console.log('OK：写回载荷已按当前 0 点钳制');
