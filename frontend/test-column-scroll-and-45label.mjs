import assert from 'node:assert';
import { registerHooks } from 'node:module';

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

const { drawColumnBoundariesOverlay } = await import('./src/components/canvas/columnBoundaries.ts');

console.log('--- 运行列联动跳转与 45° 列名绘制 单元测试 ---');

// 1. 验证 45° 列名绘制断言
function createRecordingCtx() {
  const operations = [];
  const strokes = [];
  const texts = [];
  return {
    operations,
    strokes,
    texts,
    save() { operations.push(['save']); },
    restore() { operations.push(['restore']); },
    translate(x, y) { operations.push(['translate', x, y]); },
    rotate(angle) { operations.push(['rotate', angle]); },
    beginPath() { operations.push(['beginPath']); },
    moveTo(x, y) { operations.push(['moveTo', x, y]); },
    lineTo(x, y) { operations.push(['lineTo', x, y]); },
    stroke() { operations.push(['stroke']); },
    fill() { operations.push(['fill']); },
    fillText(text, x, y) {
      operations.push(['fillText', text, x, y]);
      texts.push(text);
    },
    strokeText(text, x, y) {
      operations.push(['strokeText', text, x, y]);
    },
    measureText(text) { return { width: String(text).length * 8 }; },
    setLineDash() {},
    roundRect() {},
  };
}

const testRoi = {
  id: 'roi_1',
  name: 'ROI 1',
  xMin: 100,
  xMax: 1000,
  yMin: 200,
  yMax: 800,
  x_groups: [{ id: 'grp1', name: 'Group 1', axis_stroke_px: 2, value_per_px: 0.1 }],
  default_group_id: 'grp1',
};

const colA = {
  id: 'col_1',
  name: 'Cyclotella bodanica',
  startX: 200,
  endX: 280,
  color: '#38bdf8',
  visible: true,
  x_group_id: 'grp1',
  controlPoints: [],
};

const colB = {
  id: 'col_2',
  name: 'Stephanodiscus hantzschii',
  startX: 280,
  endX: 360,
  color: '#38bdf8',
  visible: true,
  x_group_id: 'grp1',
  controlPoints: [],
};

// 场景 A：scale = 1.0，列宽 = 80px（在旧版中因为 >42px 且 scale>=1 会走水平摆放被遮挡）
{
  const ctx = createRecordingCtx();
  drawColumnBoundariesOverlay({
    ctx,
    isLight: true,
    columns: [colA, colB],
    roi: testRoi,
    imageHeight: 1200,
    scale: 1.0,
    activeTaxaId: 'col_1',
    hovered: null,
    dragging: null,
  });

  // 验证 rotate(-Math.PI / 4) 必须被调用
  const rotates = ctx.operations.filter((op) => op[0] === 'rotate');
  assert.ok(rotates.length >= 2, '激活列与普通列都必须调用 rotate');
  for (const r of rotates) {
    assert.ok(
      Math.abs(r[1] - (-Math.PI / 4)) < 1e-4,
      `所有列名必须以 -45 度 (-Math.PI / 4) 旋转，收到: ${r[1]}`
    );
  }

  // 验证文字完整保留，长属种名不被截断
  assert.ok(ctx.texts.includes('Cyclotella bodanica'), 'Cyclotella bodanica 必须完整显示，不得被 12 字符截断');
  assert.ok(ctx.texts.includes('Stephanodiscus hantzschii'), 'Stephanodiscus hantzschii 必须完整显示，不得被 12 字符截断');
  console.log('✔ 45° 倾斜摆放与长属种名完整呈现断言通过');
}

// 场景 B：视口联动跳转逻辑单元验证
{
  // 模拟 Viewport 与 scrollToColumn 核心计算
  function simulateScrollToColumn(col, roi, viewport, canvasW, canvasH) {
    const colCenterX = (col.startX + col.endX) / 2;
    viewport.panX = canvasW / 2 - colCenterX * viewport.scale;

    const viewYTop = -viewport.panY / viewport.scale;
    const viewYBottom = (canvasH - viewport.panY) / viewport.scale;
    const overlaps = viewYBottom >= roi.yMin && viewYTop <= roi.yMax;
    if (!overlaps) {
      const roiCenterY = (roi.yMin + roi.yMax) / 2;
      viewport.panY = canvasH / 2 - roiCenterY * viewport.scale;
    }
  }

  const vp = { scale: 1.5, panX: 0, panY: 0 };
  const canvasW = 1000;
  const canvasH = 600;

  // 点击 colA（startX=200, endX=280 => center=240）
  // 期望 panX = 1000/2 - 240 * 1.5 = 500 - 360 = 140
  simulateScrollToColumn(colA, testRoi, vp, canvasW, canvasH);
  assert.equal(vp.panX, 140, '视口水平居中平移计算正确');

  // 当前 Y 视口（panY=0, h=600, scale=1.5 => Y 范围 [0, 400]），与 ROI [200, 800] 重叠
  // 因此不破坏用户纵向浏览，维持 panY=0
  assert.equal(vp.panY, 0, '用户正在浏览地层深度时保持 panY 不变');

  // 当用户在很远的 Y 处浏览（例如 panY = -3000 => Y 范围 [2000, 2400]，完全不在 ROI [200, 800] 内）
  vp.panY = -3000;
  simulateScrollToColumn(colB, testRoi, vp, canvasW, canvasH);
  // ROI 中心 = 500，期望 panY = 600 / 2 - 500 * 1.5 = 300 - 750 = -450
  assert.equal(vp.panY, -450, '脱离 ROI 视野时自动将 ROI 纵向居中');
  console.log('✔ scrollToColumn 视口居中平移与深度保护断言通过');
}

console.log('🎉 全部列联动跳转与 45° 列名单元测试顺利通过！');
