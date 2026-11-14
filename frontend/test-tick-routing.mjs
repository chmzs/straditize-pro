/**
 * 步骤 6「点一个刻度齿」的**按列路由**判据。
 *
 * 旧实现恒用 `activeColumn()`：多列图上无论点哪一列的齿，改的都是当前活动列（通常
 * 就是第一列），用户看到「只有第一列有用」。本文件钉住 `columnAtX` 的判据：
 * 带内落到那一列、带外 null、隐藏列不参与、列级轴粗参与 0 点计算。
 */
import assert from 'node:assert';

const { columnAtX, zeroXOfColumn, resolveColumnAtX } = await import('./src/core/tickRouting.ts');

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

// ---- 多 ROI：列区间整段重叠时，必须按**当前活动有效区**过滤后解析 ----
//
// 实测（hoya 双 ROI，`step6-multi-roi-tick-routing.spec.ts` 造同一形态）：
// 先建的 tree 列 x 315–1946、后建的 herb 列 x 161–1899 整段重叠。按 `columns`
// 数组顺序取「第一个包含该 x 的列」，herb 活动区里点 herb 自己的齿，永远命中
// tree 的列 —— 那条齿不在 tree 的刻线表里，界面报「此处没有检测到刻度齿」。
const multiRoiData = {
  rois: [
    { id: 'roi_tree', name: 'tree', x_groups: [{ id: 'gt', axis_stroke_px: 5 }] },
    { id: 'roi_herb', name: 'herb', x_groups: [{ id: 'gh', axis_stroke_px: 5 }] },
  ],
  active_roi_id: 'roi_herb',
};
// 数组顺序刻意把 tree 排在前面（先建的分区），复现真实故障形态。
const overlapping = [
  { id: 'tree_c1', roi_id: 'roi_tree', startX: 315, endX: 1946, x_group_id: 'gt' },
  { id: 'herb_c1', roi_id: 'roi_herb', startX: 161, endX: 1899, x_group_id: 'gh' },
];

const herbHit = resolveColumnAtX(overlapping, multiRoiData, 1500);
assert.ok(herbHit, 'herb 活动区里点 herb 的齿必须解析出列，不能返回 null');
assert.strictEqual(
  herbHit.col.id,
  'herb_c1',
  '归属必须是 herb 自己的列 —— 按数组顺序取第一个命中会落到 tree_c1（先建、整段重叠）'
);
assert.strictEqual(herbHit.roiId, 'roi_herb', '命中列必须报出它所属的有效区');
assert.strictEqual(herbHit.inActiveRoi, true, '活动区内的命中必须标成 inActiveRoi');

// 活动区没命中、只在别的分区命中：必须**报出那个分区**，让界面给明确文案，
// 而不是退回「此处没有检测到刻度齿」这种把有齿说成没齿的谎话。
const otherOnly = resolveColumnAtX(overlapping, multiRoiData, 1934);
assert.ok(otherOnly, '只落在 tree 的列带内时也要解析出列（供界面指名分区）');
assert.strictEqual(otherOnly.col.id, 'tree_c1');
assert.strictEqual(otherOnly.inActiveRoi, false, '别的分区的命中必须标成 inActiveRoi=false');
assert.strictEqual(otherOnly.roiId, 'roi_tree');

// 全部带外：仍返回 null，由调用方报「不在任何一列的取数带内」。
assert.strictEqual(resolveColumnAtX(overlapping, multiRoiData, 10), null);

// 单 ROI 数据（列上没有 roi_id）必须与旧行为一致：属于活动区。
assert.strictEqual(resolveColumnAtX(columns, data, 250)?.col.id, 'c2');
assert.strictEqual(resolveColumnAtX(columns, data, 250)?.inActiveRoi, true);

console.log('✔ 多 ROI 重叠：按活动区分组解析，活动区优先、别区命中如实指名');
