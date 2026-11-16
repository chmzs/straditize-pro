// 画布稠密渲染的单测：路径内容、缺失列报错、无回退分支、单帧构建耗时。
//
// 为什么能在 node 里跑：Path2D 由本文件注入 stub（生产代码的 makePath 可注入），
// ctx 用只记录调用的假对象 —— 断言的是"画了什么"，不是"看起来像不像"。
import assert from 'node:assert/strict';

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
}
globalThis.Path2D = FakePath2D;

const { drawPollenCurvesOverlay, hasDenseCurve } = await import(
  './src/components/canvas/pollenCurves.ts'
);
const { SplineInterpolator } = await import('./src/core/SplineInterpolator.ts');

function fakeCtx(height = 1000) {
  return {
    canvas: { height },
    strokes: [],
    fills: [],
    texts: [],
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    fillRect() {},
    setLineDash() {},
    fill(path) {
      this.fills.push(path);
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

function denseColumn(id, startX, rows, xOf) {
  return {
    id,
    name: id,
    startX,
    endX: startX + 600,
    color: '#38bdf8',
    visible: true,
    plotType: 'line',
    controlPoints: [{ id: 'p0', x: xOf(rows[0]), y: rows[0] }],
    curvePoints: rows.map((y) => ({ y, x: xOf(y) })),
    curveError: null,
  };
}

const ROWS = Array.from({ length: 400 }, (_, i) => 400 + i);
const ZERO = 265;

function testPathMatchesDensePoints() {
  const col = denseColumn('c1', 259, ROWS, (y) => ZERO + 40 + ((y - 400) % 7));
  const ctx = fakeCtx();
  const result = drawPollenCurvesOverlay({
    ctx,
    scale: 1,
    columns: [col],
    activeTaxaId: null,
    viewY: { min: 500, max: 540 },
  });
  assert.equal(result.missingColumns.length, 0, '正常列不该被报缺数');
  assert.equal(ctx.strokes.length, 1, '每列只允许一条曲线路径');
  const ops = ctx.strokes[0].ops;
  assert.ok(ops.length > 0, '曲线路径不得为空');
  // 裁剪生效：只保留视口 [500,540] 内的点（两端各留 1 点）
  const ys = ops.filter((op) => op[0] === 'L' || op[0] === 'M').map((op) => op[2]);
  assert.ok(Math.min(...ys) <= 500, '裁剪应保留视口上边界外的 1 点');
  assert.ok(Math.max(...ys) >= 540, '裁剪应保留视口下边界外的 1 点');
  assert.ok(ys.length <= 44, '裁剪没生效：点数应远小于全量 ' + ROWS.length);

  // 路径顶点必须落在稠密点上（不是控制点折线）
  const byY = new Map(col.curvePoints.map((p) => [p.y, p.x]));
  ops.filter((op) => op[0] === 'L').forEach((op) => {
    const expected = byY.get(op[2]);
    assert.ok(expected !== undefined, '路径顶点 ' + op[2] + ' 不在稠密点里');
    assert.ok(Math.abs(op[1] - expected) <= 1e-9, '路径 x 与稠密点不一致');
  });
  console.log('OK  path-matches-dense-points (vertices=' + ys.length + ')');
}

function testMissingDenseIsExplicit() {
  const col = {
    id: 'c2',
    name: 'c2',
    startX: 900,
    endX: 1500,
    color: '#38bdf8',
    visible: true,
    plotType: 'line',
    controlPoints: [
      { id: 'p0', x: 940, y: 400 },
      { id: 'p1', x: 1000, y: 500 },
    ],
    curvePoints: [],
    curveError: '本列没有任何可渲染的读数（未数字化且没有控制点）',
  };
  assert.equal(hasDenseCurve(col), false);
  const ctx = fakeCtx();
  const result = drawPollenCurvesOverlay({
    ctx,
    scale: 1,
    columns: [col],
    activeTaxaId: null,
    viewY: { min: 400, max: 600 },
  });
  assert.equal(result.missingColumns.length, 1, '缺数必须报给调用方');
  assert.equal(ctx.strokes.length, 0, '缺数时不得画任何替代曲线');
  assert.ok(
    ctx.texts.some((t) => t.includes('本列无法取数')),
    '画布必须写明原因：' + JSON.stringify(ctx.texts)
  );
  console.log('OK  missing-dense-is-explicit');
}

function testSymbolStillUsesControlPoints() {
  const col = {
    id: 'c3',
    name: 'c3',
    startX: 259,
    endX: 800,
    color: '#38bdf8',
    visible: true,
    plotType: 'symbol',
    controlPoints: [
      { id: 'p0', x: 300, y: 400 },
      { id: 'p1', x: 320, y: 420 },
    ],
    curvePoints: ROWS.map((y) => ({ y, x: ZERO + 40 })),
    curveError: null,
  };
  const ctx = fakeCtx();
  drawPollenCurvesOverlay({ ctx, scale: 1, columns: [col], activeTaxaId: null });
  assert.equal(ctx.strokes.length, 2, 'symbol 按控制点画 2 个符号');
  console.log('OK  symbol-uses-control-points');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function measureFrame(columns, viewY) {
  const ctx = fakeCtx(4000);
  return () => {
    ctx.strokes.length = 0;
    ctx.fills.length = 0;
    drawPollenCurvesOverlay({ ctx, scale: 1, columns, activeTaxaId: null, viewY });
  };
}

function measureLegacyFrame(columns) {
  const ctx = fakeCtx(4000);
  return () => {
    ctx.strokes.length = 0;
    ctx.fills.length = 0;
    columns.forEach((col) => {
      const sorted = [...col.controlPoints].sort((a, b) => a.y - b.y);
      ctx.stroke(SplineInterpolator.buildPath(sorted));
      ctx.fill(SplineInterpolator.buildAreaPath(sorted, col.startX));
    });
  };
}

function testPerf() {
  const COLUMNS = 28;
  const POINTS = 1249;
  const columns = Array.from({ length: COLUMNS }, (_, c) => {
    const rows = Array.from({ length: POINTS }, (_, i) => 400 + i);
    const startX = 259 + c * 200;
    const col = denseColumn('c' + c, startX, rows, (y) => startX + 6 + 30 + ((y * 7) % 90));
    col.plotType = 'area';
    // 旧渲染的输入：每列 58 个控制点（峰谷 + 手工点）
    col.controlPoints = Array.from({ length: 58 }, (_, i) => {
      const y = 400 + Math.round((i * (POINTS - 1)) / 57);
      return { id: 'p' + i, x: startX + 6 + 30 + ((y * 7) % 90), y };
    });
    return col;
  });

  const scenarios = [
    ['zoom (视口 400 行)', { min: 1000, max: 1400 }],
    ['pan (视口 900 行)', { min: 300, max: 1200 }],
  ];
  const out = {};
  for (const [label, viewY] of scenarios) {
    const dense = measureFrame(columns, viewY);
    const legacy = measureLegacyFrame(columns);
    const denseMs = [];
    const legacyMs = [];
    for (let i = 0; i < 10; i++) {
      let t0 = performance.now();
      dense();
      denseMs.push(performance.now() - t0);
      t0 = performance.now();
      legacy();
      legacyMs.push(performance.now() - t0);
    }
    const d = median(denseMs);
    const l = median(legacyMs);
    out[label] = { dense: d, legacy: l, ratio: d / (l || 1e-9) };
    console.log(
      'PERF ' + label + ': 改前(控制点折线)=' + l.toFixed(3) + 'ms 改后(稠密+裁剪)=' +
        d.toFixed(3) + 'ms 比值=' + (d / (l || 1e-9)).toFixed(2) + 'x'
    );
    // 绝对预算（60fps 的一半，留余量给其余渲染管线）：整画布一次重绘 <= 8ms。
    // 不跟 58 点/列的旧渲染比倍数 —— 点数从 58 涨到 1249，比值没有意义。
    assert.ok(
      d <= 8,
      '单帧构建超出 8ms 预算：' + label + ' ' + d.toFixed(3) + 'ms（旧渲染 ' + l.toFixed(3) + 'ms）'
    );
  }
  console.log('PERF_JSON ' + JSON.stringify(out));
}

function testPathCacheReuse() {
  const col = denseColumn('c9', 259, ROWS, (y) => ZERO + 40 + ((y - 400) % 7));
  const ctx = fakeCtx();
  const env = { ctx, scale: 1, columns: [col], activeTaxaId: null, viewY: { min: 500, max: 540 } };
  drawPollenCurvesOverlay(env);
  const first = ctx.strokes[0];
  drawPollenCurvesOverlay(env);
  const second = ctx.strokes[1];
  assert.equal(first, second, '同一数据 + 同一视口必须复用缓存的 Path2D');
  // 数据变了（中间点）必须换路径
  col.curvePoints[100] = { y: col.curvePoints[100].y, x: col.curvePoints[100].x + 25 };
  drawPollenCurvesOverlay(env);
  assert.notEqual(second, ctx.strokes[2], '数据变化后不得复用陈旧路径');
  console.log('OK  path-cache-reuse-and-invalidation');
}

testPathMatchesDensePoints();
testPathCacheReuse();
testMissingDenseIsExplicit();
testSymbolStillUsesControlPoints();
testPerf();
console.log('ALL PASS');
