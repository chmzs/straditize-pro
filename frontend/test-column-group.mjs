/**
 * 列 → 组 的**唯一解析入口**（core/columnGroup.ts），以及它对绿线（0 点）的影响。
 *
 * ## 缺陷本体（用户实测）
 *
 * 「轴线修改粗细只在组1的col1生效，组2和组3的col28均不生效」。
 * 后端两条链路都是对的（写 → 保存 → 重载，三组都能保持 1）；问题在**前端显示**：
 * 输入框的 value 有一个跨组的全局兜底（state.axisStrokeOverride），给 grp2 填 1
 * 之后切到 grp1/grp3，那两个框也显示 1 —— 用户读作「已经接过值了」就不再设，
 * 后端仍是 None、绿线回落缺省 5。用户原话：「其他两组的线粗框自动就显示 1 了，
 * 我以为它直接接过值了」。
 *
 * ## 第二个独立隐患（本文件下半段）
 *
 * columnBoundaries.ts 里画组色带用「列 id → 默认组 → 第一个组」，画绿线却只做
 * 精确匹配（无 default_group_id 回退）。列上没有 x_group_id 的工程里，
 * 组轴粗被静默忽略、绿线恒回落 5。两处现在都走 resolveColumnGroup。
 *
 * ## 反向验证
 *
 * 把 resolveColumnGroup 的 default_group_id 那一档删掉，用例 C 立刻红（绿线跑到 startX+5）。
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// 源码里的相对 import 不带扩展名（Vite 能解析、node 不能）。
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('.') || specifier.startsWith('/');
      const hasExt = /\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && !hasExt) return nextResolve(specifier + '.ts', context);
      throw err;
    }
  },
});

const { resolveColumnGroup } = await import('./src/core/columnGroup.ts');
const { drawColumnBoundariesOverlay } = await import('./src/components/canvas/columnBoundaries.ts');

const GROUPS = [
  { id: 'roi_1_grp1', name: '默认组', unit: '%', plot_type: 'area', axis_stroke_px: 3 },
  { id: 'roi_1_grp2', name: '组 2', unit: '粒/g', plot_type: 'line', axis_stroke_px: 1 },
  { id: 'roi_1_grp3', name: '组 3', unit: '粒/g', plot_type: 'line', axis_stroke_px: 1 },
];
const ROI = {
  id: 'roi_1', xMin: 300, xMax: 2000, yMin: 500, yMax: 1300,
  x_groups: GROUPS, default_group_id: 'roi_1_grp1',
};

// ---- A. 解析规则：列 id → ROI 默认组 → 第一个组 ----
assert.equal(resolveColumnGroup({ x_group_id: 'roi_1_grp2' }, ROI)?.id, 'roi_1_grp2', '显式 id 优先');
assert.equal(
  resolveColumnGroup({}, ROI)?.id,
  'roi_1_grp1',
  '列上没有 x_group_id 时必须回落到 ROI 的默认组'
);
assert.equal(
  resolveColumnGroup({ x_group_id: 'no_such_group' }, ROI)?.id,
  'roi_1_grp1',
  '组 id 失效时同样回落到默认组，而不是 undefined'
);
assert.equal(
  resolveColumnGroup({}, { x_groups: GROUPS })?.id,
  'roi_1_grp1',
  '没有 default_group_id 时回落第一个组'
);
assert.equal(resolveColumnGroup({}, { x_groups: [] }), undefined, '没有组时返回 undefined');
assert.equal(resolveColumnGroup(null, null), undefined, '空 ROI 不炸');

// ---- 画布绘制：绿线 = startX + 生效轴粗 ----
function fakeCtx() {
  const c = {
    path: [], strokes: [], texts: [],
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    save() {},
    restore() {},
    beginPath() { c.path = []; },
    moveTo(x, y) { c.path.push(['M', x, y]); },
    lineTo(x, y) { c.path.push(['L', x, y]); },
    closePath() { c.path.push(['Z']); },
    setLineDash() {},
    rect() {},
    roundRect() {},
    translate() {},
    rotate() {},
    fillRect() {},
    fill() {},
    fillText(text) { c.texts.push(text); },
    measureText(text) { return { width: String(text).length * 6 }; },
    stroke() { c.strokes.push({ style: c.strokeStyle, path: c.path.slice() }); },
  };
  return c;
}

function column(overrides = {}) {
  return {
    id: 'taxa_27', name: 'col28', color: '#38bdf8', visible: true,
    startX: 1774, endX: 1947, x_group_id: 'roi_1_grp3',
    controlPoints: [], x_ticks: null, maxPercent: 100,
    ...overrides,
  };
}

function greenZeroX(col, roi) {
  const ctx = fakeCtx();
  drawColumnBoundariesOverlay({
    ctx, isLight: true, columns: [col], roi, imageHeight: 1200, scale: 1,
    activeTaxaId: null, hovered: null, dragging: null,
  });
  const green = ctx.strokes.find((s) => s.style === '#22c55e');
  assert.ok(green, '画布上必须有一条绿线（0 点）');
  const move = green.path.find((op) => op[0] === 'M');
  assert.ok(move, '绿线路径必须有 moveTo');
  return move[1];
}

// A. 组有值：grp3 = 1 → 1775
assert.equal(greenZeroX(column(), ROI), 1775, 'grp3 轴粗 1 → 0 点 = startX + 1');

// B. 组值清空：回落兜底 DEFAULT_AXIS_STROKE_PX = 2 → 1776（2026-11-19 由 5 改 2）
const roiNoStroke = {
  ...ROI,
  x_groups: GROUPS.map((g) => (g.id === 'roi_1_grp3' ? { ...g, axis_stroke_px: null } : g)),
};
assert.equal(greenZeroX(column(), roiNoStroke), 1776, '组值清空 → 回落兜底 2px');

// C. **列上没有 x_group_id**：必须用默认组的轴粗（3），而不是缺省 5。
const colNoGroup = column({ id: 'taxa_0', name: 'col02', startX: 497, endX: 728, x_group_id: undefined });
assert.equal(
  greenZeroX(colNoGroup, ROI),
  500,
  '列没有 x_group_id 时绿线必须用默认组轴粗（497 + 3 = 500）；回落 5（=502）说明回退丢了'
);

// D. 列级覆盖优先于组
assert.equal(greenZeroX(column({ axis_stroke_px: 7 }), ROI), 1781, '列级 axis_stroke_px 优先于组值');


// ---- E. 组内多列逐列断言（用户实测：「组内改轴线粗细已经能生效，绿线随之更新」）----
// 用与用户工程同构的 28 列：col01 → grp2，col02..col27 → grp1，col28 → grp3。
// 三组给**不同**的轴粗，任何一列被解析到错误的组都会立刻对不上。
const PROJECT_GROUPS = [
  { id: 'roi_1_grp1', name: '默认组', unit: '%', plot_type: 'area', axis_stroke_px: 3 },
  { id: 'roi_1_grp2', name: '组 2', unit: '粒/g', plot_type: 'line', axis_stroke_px: 1 },
  { id: 'roi_1_grp3', name: '组 3', unit: '粒/g', plot_type: 'line', axis_stroke_px: 7 },
];
const PROJECT_ROI = {
  id: 'roi_1', xMin: 300, xMax: 2000, yMin: 500, yMax: 1300,
  x_groups: PROJECT_GROUPS, default_group_id: 'roi_1_grp1',
};
const START = 319;
const STEP = Math.round((1774 - 497) / 25);
const projectCols = [];
for (let i = 0; i < 28; i++) {
  const name = 'col' + String(i + 1).padStart(2, '0');
  const gid = i === 0 ? 'roi_1_grp2' : i === 27 ? 'roi_1_grp3' : 'roi_1_grp1';
  const startX = i === 0 ? 319 : i === 27 ? 1774 : 497 + (i - 1) * STEP;
  projectCols.push(column({ id: 'taxa_' + i, name, startX, endX: startX + 60, x_group_id: gid }));
}
const expectedStroke = { roi_1_grp1: 3, roi_1_grp2: 1, roi_1_grp3: 7 };
let checked = 0;
for (const col of projectCols) {
  const want = col.startX + expectedStroke[col.x_group_id];
  assert.equal(
    greenZeroX(col, PROJECT_ROI),
    want,
    col.name + '（' + col.x_group_id + '）绿线应为 startX ' + col.startX + ' + ' + expectedStroke[col.x_group_id]
  );
  checked += 1;
}
assert.equal(checked, 28, '28 列必须逐列断言过');

// 对照组：补了 default 回退之后，**有 x_group_id 的列解析结果一个字不变**。
for (const col of projectCols) {
  assert.equal(resolveColumnGroup(col, PROJECT_ROI)?.id, col.x_group_id, col.name + ' 的组不得被回退改写');
}

console.log('test-column-group: OK（含 28 列逐列绿线断言）');
