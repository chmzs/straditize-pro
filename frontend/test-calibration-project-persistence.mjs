// 标定持久化与工程加载保真性测试
// 验证：
// 1. 工程加载与草稿往返中，各列标定标记（calib_mark / value_per_px / axis_stroke_px）绝对保真，绝不丢失；
// 2. 彻底杜绝合成候选值（1270, 100, 83684, 150806），严格呈现用户原始标定（10000, 150, 60000, 150000）；
// 3. 避免将 group_slope 派生的 1px 单位向量误读为用户刻度齿。
//
// 运行：node --experimental-strip-types test-calibration-project-persistence.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const RESOLVE_HOOK = String.raw`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function typesStub(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const consts = [...src.matchAll(/^export const (\w+) = (.+);$/gm)].map((m) => ({
    name: m[1],
    decl: 'export const ' + m[1] + ' = ' + m[2] + ';',
  }));
  const constNames = new Set(consts.map((c) => c.name));
  const typeNames = [...src.matchAll(/export (?:interface|type) (\w+)/g)].map((m) => m[1]);
  return [
    ...consts.map((c) => c.decl),
    ...typeNames.filter((n) => !constNames.has(n)).map((n) => 'export const ' + n + ' = undefined;'),
  ].join('\n');
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    if (specifier.split('/').pop() === '_registry') {
      return {
        url: 'data:text/javascript,' + encodeURIComponent(
          'export const StepContext = undefined; export const StepPanel = undefined;'
        ),
        shortCircuit: true,
      };
    }
    const guess = new URL(specifier + '.ts', context.parentURL);
    if (guess.pathname.includes('/src/types/')) {
      return {
        url: 'data:text/javascript,' + encodeURIComponent(typesStub(fileURLToPath(guess))),
        shortCircuit: true,
      };
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith('.')) throw err;
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch (ignored) {
      }
    }
    throw err;
  }
}
`;

register('data:text/javascript,' + encodeURIComponent(RESOLVE_HOOK));

const { normalizeProject, draftToProjectPayload } = await import('./src/core/ProjectManager.ts');
const { getGroupCalibMark, setGroupCalibMark, clearAllGroupCalibMarks } = await import('./src/components/canvas/groupCalibMarks.ts');
const { drawColumnBoundariesOverlay } = await import('./src/components/canvas/columnBoundaries.ts');

console.log('--- 运行标定持久化与工程加载保真测试 ---');

// 构造测试数据：4 列分别具备真实标定
const testCols = [
  {
    id: 'col_0',
    col_index: 0,
    name: 'Picea',
    species: 'Picea',
    startX: 100,
    endX: 185,
    x_group_id: 'grp_0',
    visible: true,
  },
  {
    id: 'col_1',
    col_index: 1,
    name: 'Pinus',
    species: 'Pinus',
    startX: 185,
    endX: 335,
    x_group_id: 'grp_1',
    visible: true,
  },
  {
    id: 'col_2',
    col_index: 2,
    name: 'Betula',
    species: 'Betula',
    startX: 335,
    endX: 498,
    x_group_id: 'grp_2',
    visible: true,
  },
  {
    id: 'col_3',
    col_index: 3,
    name: 'Quercus',
    species: 'Quercus',
    startX: 498,
    endX: 1049,
    x_group_id: 'grp_3',
    visible: true,
  },
];

const testGroups = [
  {
    id: 'grp_0',
    name: 'Picea组',
    value_per_px: 10000 / 670,
    axis_stroke_px: 2,
    calib_mark: { px: 102 + 670, reading: 10000, dist: 670, col_id: 'col_0' },
  },
  {
    id: 'grp_1',
    name: 'Pinus组',
    value_per_px: 150 / 120,
    axis_stroke_px: 2,
    calib_mark: { px: 187 + 120, reading: 150, dist: 120, col_id: 'col_1' },
  },
  {
    id: 'grp_2',
    name: 'Betula组',
    value_per_px: 60000 / 117,
    axis_stroke_px: 2,
    calib_mark: { px: 337 + 117, reading: 60000, dist: 117, col_id: 'col_2' },
  },
  {
    id: 'grp_3',
    name: 'Quercus组',
    value_per_px: 150000 / 548,
    axis_stroke_px: 2,
    calib_mark: { px: 500 + 548, reading: 150000, dist: 548, col_id: 'col_3' },
  },
];

const testRoi = {
  id: 'roi_1',
  name: 'pollen',
  xMin: 100,
  xMax: 1049,
  yMin: 50,
  yMax: 800,
  x_groups: testGroups,
  default_group_id: 'grp_0',
};

// =========================================================================
// 1. draftToProjectPayload 保真性断言
// =========================================================================
const draft = {
  columns: testCols,
  rois: [testRoi],
  roi: testRoi,
  active_roi_id: 'roi_1',
  calibration: { isCalibrated: true, top_px: 50, top_cm: 0, bottom_px: 800, bottom_cm: 100 },
};

const { projectData } = draftToProjectPayload(draft);
assert(projectData.rois && projectData.rois.length > 0, 'payload 必须包含 rois');
const restoredRoi = projectData.rois[0];
assert.equal(restoredRoi.x_groups.length, 4, '4 个列组必须全部保留');

// 校验每个组上的标定参数未被洗白
for (let i = 0; i < 4; i++) {
  const g = restoredRoi.x_groups.find((x) => x.id === `grp_${i}`);
  assert(g, `grp_${i} 必须存在`);
  assert(g.value_per_px != null, `grp_${i} 的 value_per_px 不能为 null`);
  assert(g.calib_mark != null, `grp_${i} 的 calib_mark 不能为 null`);
  assert.equal(g.calib_mark.reading, testGroups[i].calib_mark.reading, `grp_${i} 读数必须精确保真`);
  assert.equal(g.calib_mark.dist, testGroups[i].calib_mark.dist, `grp_${i} 齿距必须精确保真`);
}
console.log('✓ draftToProjectPayload 组标定参数保真验证通过');

// =========================================================================
// 2. normalizeProject 透传断言
// =========================================================================
const parsedJson = {
  columns: testCols.map((c, i) => ({
    ...c,
    startValue: 0,
    tickValue: testGroups[i].calib_mark.reading,
    tickEndX: c.startX + 2 + testGroups[i].calib_mark.dist,
  })),
  rois: [testRoi],
  roi: { x: 100, y: 50, w: 949, h: 750 },
  depth_calibration: { is_calibrated: true, top_px: 50, top_cm: 0, bottom_px: 800, bottom_cm: 100 },
};

const normalized = normalizeProject(parsedJson, null);
assert(normalized, 'normalizeProject 必须返回非空数据');
for (let i = 0; i < 4; i++) {
  const col = normalized.columns[i];
  assert.equal(col.tickValue, testGroups[i].calib_mark.reading, `列 ${i} 的 tickValue 必须透传`);
  assert(col.tickEndX != null && col.tickEndX > col.startX, `列 ${i} 的 tickEndX 必须透传`);
}
console.log('✓ normalizeProject 权威标定端点透传验证通过');

// =========================================================================
// 3. 画布绘制渲染逻辑中严禁伪造数字，且读数 100% 吻合
// =========================================================================
clearAllGroupCalibMarks();

// 模拟 Canvas 2D 上下文记录
const drawnTexts = [];
const mockCtx = {
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  fillRect() {},
  rect() {},
  fill() {},
  arc() {},
  fillText(text, x, y) {
    drawnTexts.push({ text: String(text), x, y });
  },
  measureText(text) {
    return { width: String(text).length * 8 };
  },
  setLineDash() {},
  translate() {},
  rotate() {},
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  textAlign: 'left',
  textBaseline: 'top',
};

// 预装载各组标定
for (const g of testGroups) {
  setGroupCalibMark(g.id, g.calib_mark);
}

drawColumnBoundariesOverlay({
  ctx: mockCtx,
  isLight: true,
  columns: testCols,
  roi: testRoi,
  rois: [testRoi],
  imageHeight: 1000,
  scale: 1,
  activeTaxaId: 'col_0',
  hovered: null,
  dragging: null,
});

// 提取绘制出来的所有数字标签
const labels = drawnTexts.map((t) => t.text);
assert(labels.includes('10000'), '画布必须绘制出 Col 0 的 10000 标定');
assert(labels.includes('150'), '画布必须绘制出 Col 1 的 150 标定');
assert(labels.includes('60000'), '画布必须绘制出 Col 2 的 60000 标定');
assert(labels.includes('150000'), '画布必须绘制出 Col 3 的 150000 标定');

// 严禁出现历史失真数字！
const forbiddenCorruptions = ['1270', '83684', '150806'];
for (const bad of forbiddenCorruptions) {
  assert(!labels.includes(bad), `画布绝对禁止出现虚构失真数字 ${bad}！`);
}
// Col 1 严禁被候选数组缩小为 100
const col1Texts = drawnTexts.filter((t) => t.x >= 185 && t.x <= 335).map((t) => t.text);
assert(!col1Texts.includes('100'), 'Col 1 读数 150 严禁被候选数组篡改为 100！');

console.log('✓ 画布渲染标定标记保真验证通过（杜绝 1270, 100, 83684, 150806 伪造数字）');

// =========================================================================
// 4. 组斜率单位向量（abs_px1 = zeroX + 1.0）防误读验证
// =========================================================================
clearAllGroupCalibMarks();
const slopeVectorCol = {
  id: 'col_unit',
  col_index: 0,
  name: 'TestCol',
  startX: 100,
  endX: 200,
  x_group_id: 'grp_unit',
  visible: true,
  tickValue: 14.925,
  tickEndX: 103.0, // 刚好等于 zeroX(102) + 1.0，且 tickValue 等于 slope
};
const slopeGroup = {
  id: 'grp_unit',
  name: 'TestGrp',
  value_per_px: 14.925,
  axis_stroke_px: 2, // zeroX = 102
  calib_mark: null, // 无 calib_mark
};
const slopeRoi = {
  id: 'roi_unit',
  xMin: 100,
  xMax: 200,
  yMin: 0,
  yMax: 500,
  x_groups: [slopeGroup],
};

drawnTexts.length = 0;
drawColumnBoundariesOverlay({
  ctx: mockCtx,
  isLight: true,
  columns: [slopeVectorCol],
  roi: slopeRoi,
  rois: [slopeRoi],
  imageHeight: 500,
  scale: 1,
  activeTaxaId: 'col_unit',
  hovered: null,
  dragging: null,
});

const unitLabels = drawnTexts.map((t) => t.text);
assert(!unitLabels.includes('14.925'), '单位斜率向量绝不能被当作刻度标记绘制在画布上');
console.log('✓ 组斜率 1px 单位向量防误判测试通过');

console.log('\nALL TESTS PASSED SUCCESSFULLY!');
