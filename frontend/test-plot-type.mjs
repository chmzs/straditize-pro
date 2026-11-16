/**
 * 图形形态：解析顺序（`core/plotType.ts`）+ **画布真的走了哪个分支**。
 *
 * 用户原话：「这个分组我想切换为折线不成功」。
 *
 * 旧实现只读 `col.plotType || 'area'`：**组级完全不参与**。列上那份 `plot_type`
 * 是分列/载入期从组值抄来的快照，于是组改成折线、画布照旧画面积。
 *
 * 本文件断言的是**绘制调用**（`fill` / `fillRect` / `stroke` 的实参），不是
 * "解析函数返回了 line"：返回对了但分支没走，用户看到的仍是面积图，那不算修好。
 *
 * 三件事正交，这里同时钉住：
 * - 0 点（`zeroSpanOfColumn`，#31）决定填充**从哪起**；
 * - 稠密曲线（#33）决定**画到哪**——所以本文件的列必须带 `curvePoints`，
 *   没有稠密点的列走的是「本列无法取数」分支，不参与形态断言；
 * - `resolvePlotType`（组级参数）决定**走哪条分支**。
 *
 * 反向验证（金丝雀）：把 `resolvePlotType` 改回"只读列级"，用例 1 立刻红；
 * 把路径缓存键里的 `plotType` 改回 `col.plotType`，用例 6 立刻红。
 */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// 源码里个别相对 import 不带扩展名（Vite 能解析、node 不能）。补一条兜底。
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith('.') || specifier.startsWith('/');
      const hasExt = /\.[cm]?[jt]sx?$/.test(specifier);
      if (relative && !hasExt) return nextResolve(`${specifier}.ts`, context);
      throw err;
    }
  },
});

// node 没有 Path2D：最小替身（本用例不看路径内容，只看走没走那条分支）。
class FakePath2D {
  constructor() {
    this.ops = [];
  }
  moveTo(x, y) {
    this.ops.push(['M', x, y]);
  }
  lineTo(x, y) {
    this.ops.push(['L', x, y]);
  }
  closePath() {
    this.ops.push(['Z']);
  }
  arc() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
}
globalThis.Path2D = FakePath2D;

const { resolvePlotType } = await import('./src/core/plotType.ts');
const { drawPollenCurvesOverlay } = await import('./src/components/canvas/pollenCurves.ts');

/** 记录绘制调用的假 ctx（与 test-dense-curve.mjs 同形）。 */
function fakeCtx(height = 1000) {
  return {
    canvas: { height },
    fills: [],
    fillRects: [],
    strokes: [],
    texts: [],
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    setLineDash() {},
    fill(path) {
      this.fills.push(path);
    },
    fillRect(...args) {
      this.fillRects.push(args);
    },
    stroke(path) {
      this.strokes.push(path);
    },
    fillText(text) {
      this.texts.push(text);
    },
    getTransform() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    },
  };
}

const ROWS = [400, 420, 440, 460, 480];

/** 一列：带稠密点（#33 之后唯一的曲线来源）。`plot_type` 缺省 = 没有列级覆盖。 */
function column(overrides = {}) {
  return {
    id: 'taxa_0',
    name: 'col01',
    color: '#3b82f6',
    visible: true,
    startX: 100,
    endX: 400,
    x_group_id: 'grp1',
    controlPoints: ROWS.map((y, i) => ({ id: 'p' + i, x: 120 + i * 10, y })),
    curvePoints: ROWS.map((y, i) => ({ y, x: 120 + i * 10 })),
    curveError: null,
    ...overrides,
  };
}

/** 画一列。组经 `groupOfColumn` 传入——画布的**唯一**组访问器（0 点与形态同源）。 */
function draw(col, group) {
  const ctx = fakeCtx();
  drawPollenCurvesOverlay({
    ctx,
    scale: 1,
    columns: [col],
    activeTaxaId: null,
    groupOfColumn: () => group,
  });
  return ctx;
}

// ---- 0. 判别力自检：旧规则（只读列级）在"组 line、列无覆盖"上给出 area ----
{
  const col = column();
  const legacyType = col.plotType || 'area';
  assert.equal(legacyType, 'area', '旧规则必须在本数据上给出 area，否则下面的断言没有判别力');
  // 把旧规则的结果当列级覆盖喂进去，等价于旧实现：必须真的画出面积。
  const ctx = draw(column({ plot_type: legacyType }), { plot_type: 'line' });
  assert.ok(ctx.fills.length >= 1, '旧规则下这块数据必须真的画面积，断言才有判别力');
}

// ---- 1. 组 line + 列无覆盖 → 不许画面积 ----
{
  const ctx = draw(column(), { plot_type: 'line' });
  assert.equal(ctx.fills.length, 0, '组是折线时不得出现面积填充 fill(areaPath)');
  assert.equal(ctx.strokes.length, 1, '折线必须描边一次（每列一条稠密路径）');
  assert.equal(ctx.fillRects.length, 0, '折线不得走柱状分支');
  assert.equal(ctx.texts.length, 0, '有稠密点时不得写"无法取数"提示');
}

// ---- 2. 组 area + 列无覆盖 → 画面积 ----
{
  const ctx = draw(column(), { plot_type: 'area' });
  assert.equal(ctx.fills.length, 1, '组是面积时必须填一次面积路径');
  assert.equal(ctx.strokes.length, 1, '面积图同时要描边');
}

// ---- 3. 列级显式覆盖优先于组 ----
{
  const ctx = draw(column({ plot_type: 'bar' }), { plot_type: 'line' });
  assert.ok(ctx.fillRects.length > 0, '列级显式覆盖 bar 必须赢过组级 line');
  assert.equal(ctx.fills.length, 0, '柱状图不画面积');
}

// ---- 4. 解析顺序：列级覆盖 → 组级 → 'area' ----
assert.equal(resolvePlotType(null, null), 'area', '两级都缺省时回落 area');
assert.equal(resolvePlotType({}, undefined), 'area', '空对象同样回落 area');
assert.equal(resolvePlotType({ plot_type: null }, { plot_type: 'symbol' }), 'symbol', 'null 视为未设置，让组级生效');
assert.equal(resolvePlotType({ plot_type: 'bar' }, { plot_type: 'symbol' }), 'bar', '列级显式覆盖优先');
assert.equal(resolvePlotType({ plotType: 'line' }, { plot_type: 'area' }), 'line', '兼容旧别名 plotType');
assert.equal(resolvePlotType({ plot_type: 'LINE' }, { plot_type: 'area' }), 'area', '拼错的字面量不得当覆盖');
assert.equal(resolvePlotType({}, { plot_type: 'LINE' }), 'area', '组级拼错同样回落 area');
assert.equal(resolvePlotType({ plot_type: 'line' }, undefined), 'line', '没有组时列级覆盖仍然有效');

// ---- 5. 列不属于任何组时仍要画得出来 ----
{
  const ctx = draw(column({ id: 'taxa_nogroup' }), undefined);
  assert.equal(ctx.fills.length, 1, '找不到组时回落 area，不能画空');
}

// ---- 6. 路径缓存键必须含**解析后**的形态 ----
// 同一列、同一批稠密点，只把组从 area 切成 line：列字段一个字没变。
// 缓存键若还用 col.plotType，就会复用那条已经建好的 area 路径 —— 用户看到的就是
// 「切了折线，图没变」。
{
  const col = column({ id: 'taxa_cache' });
  const first = draw(col, { plot_type: 'area' });
  assert.equal(first.fills.length, 1, '前置：第一次（面积）必须填充');
  const second = draw(col, { plot_type: 'line' });
  assert.equal(second.fills.length, 0, '组切成折线后必须重建路径，不得复用缓存的面积路径');
  assert.equal(second.strokes.length, 1, '折线仍然要画');
}

console.log('test-plot-type: OK');
