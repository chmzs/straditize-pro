/**
 * 步骤 6「点一个刻度齿」的**按列路由**判据。
 *
 * 旧实现恒用 `activeColumn()`：多列图上无论点哪一列的齿，改的都是当前活动列（通常
 * 就是第一列），用户看到「只有第一列有用」。本文件钉住 `columnAtX` 的判据：
 * 带内落到那一列、带外 null、隐藏列不参与、列级轴粗参与 0 点计算。
 */
import assert from 'node:assert';

const { columnAtX, zeroXOfColumn } = await import('./src/core/tickRouting.ts');

const data = {
  rois: [{ id: 'roi_1', x_groups: [{ id: 'g1', axis_stroke_px: 5 }] }],
  active_roi_id: 'roi_1',
};

const columns = [
  { id: 'c1', startX: 100, endX: 200, x_group_id: 'g1' },
  { id: 'c2', startX: 200, endX: 300, x_group_id: 'g1' },
  { id: 'c3', startX: 300, endX: 400, x_group_id: 'g1', visible: false },
];

// 0 点 = 列左缘 + 轴粗（组级初值 5）
assert.strictEqual(zeroXOfColumn(columns[0], data), 105);

assert.strictEqual(
  columnAtX(columns, data, 250)?.id,
  'c2',
  '第二列带内的点必须路由到第二列 —— 旧实现恒给活动列（第一列），这就是「只有第一列有用」'
);
assert.strictEqual(columnAtX(columns, data, 150)?.id, 'c1', '第一列带内仍归第一列');
assert.strictEqual(
  columnAtX(columns, data, 50),
  null,
  '带外返回 null，交给调用方报「不在任何一列的取数带内」'
);
assert.strictEqual(columnAtX(columns, data, 350), null, '隐藏列不参与路由');

// 列级轴粗覆盖必须参与 0 点计算（列级 > 组级 > 缺省 5）
const override = [{ id: 'c4', startX: 500, endX: 600, axis_stroke_px: 9, x_group_id: 'g1' }];
assert.strictEqual(zeroXOfColumn(override[0], data), 509);
assert.strictEqual(
  columnAtX(override, data, 503),
  null,
  '列级轴粗 9px 时 0 点在 509，503 落在 0 点之前 → 不属于该列'
);
assert.strictEqual(columnAtX(override, data, 520)?.id, 'c4');

console.log('✔ 点齿按列路由：带内落该列、带外 null、隐藏列跳过、列级轴粗参与 0 点');
