/**
 * 年代-深度控制点命中优先度与编辑目标 (findControlPointAt & editTarget) 单元测试
 * node --experimental-strip-types 纯原生验证
 */
import assert from 'node:assert/strict';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    body: { classList: { add: () => {}, remove: () => {} } },
  };
}

import { AgeDepthCanvas } from './src/components/agedepth/AgeDepthCanvas.ts';

let n = 0;
function check(label, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${label}`);
}

console.log('--- 运行 年代-深度控制点拾取优先级与编辑目标 单元测试 ---');

// Mock 最小 DOM 容器
function createMockCanvasContext() {
  const container = {
    querySelector: (sel) => {
      if (sel === '#ad-sel-edit-target') {
        return { value: 'curve', addEventListener: () => {}, removeEventListener: () => {} };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const canvas = {
    getContext: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  return { container, canvas };
}

check('当均值线与下界线重叠在同一坐标时，选择 lower 目标必须精准命中 lower 控制点', () => {
  const { container, canvas } = createMockCanvasContext();
  const adCanvas = new AgeDepthCanvas(container, canvas);

  // 构造数组：curve 在前，lower 在后，两者物理像素完全重叠
  adCanvas.setControlPoints([
    { id: 'cp_curve_0', x: 100, y: 100, kind: 'curve' },
    { id: 'cp_lower_0', x: 100, y: 100, kind: 'lower' },
    { id: 'cp_upper_0', x: 120, y: 100, kind: 'upper' },
  ]);

  // 当 editTarget 为 lower 时，拾取坐标 (100, 100)
  adCanvas.setEditTarget('lower');
  const hitIdx = adCanvas.findControlPointAt({ x: 100, y: 100 });
  assert.equal(hitIdx, 1, '应命中 index=1 的 lower 控制点，绝不能被数组前部的 curve 遮蔽');
});

check('当均值线与下界线近邻时，用户意图为 lower 时必须优先命中 lower，即使 curve 距离鼠标稍近', () => {
  const { container, canvas } = createMockCanvasContext();
  const adCanvas = new AgeDepthCanvas(container, canvas);

  // 假设鼠标位于 (100, 100)
  // curve 在 (101, 100) [距离 1px]
  // lower 在 (105, 100) [距离 5px，但在 10px 容差内]
  adCanvas.setControlPoints([
    { id: 'cp_curve_0', x: 101, y: 100, kind: 'curve' },
    { id: 'cp_lower_0', x: 105, y: 100, kind: 'lower' },
  ]);

  adCanvas.setEditTarget('lower');
  const hitIdx = adCanvas.findControlPointAt({ x: 100, y: 100 });
  assert.equal(hitIdx, 1, '在容差范围内必须优先遵循当前激活的 editTarget (lower)');
});

check('当容差范围内完全不存在当前目标控制点时，算法平滑降级匹配距离最近的其它控制点', () => {
  const { container, canvas } = createMockCanvasContext();
  const adCanvas = new AgeDepthCanvas(container, canvas);

  // 只有 curve 控制点
  adCanvas.setControlPoints([
    { id: 'cp_curve_0', x: 100, y: 100, kind: 'curve' },
  ]);

  // 用户目标是 lower，但在该位置只有 curve
  adCanvas.setEditTarget('lower');
  const hitIdx = adCanvas.findControlPointAt({ x: 100, y: 100 });
  assert.equal(hitIdx, 0, '当无目标控制点时降级命中最近的控制点');
});

check('setEditTarget 能正确兼容并归一化 min/max 为 lower/upper', () => {
  const { container, canvas } = createMockCanvasContext();
  const adCanvas = new AgeDepthCanvas(container, canvas);

  adCanvas.setEditTarget('min');
  assert.equal(adCanvas.getEditTarget(), 'lower');

  adCanvas.setEditTarget('max');
  assert.equal(adCanvas.getEditTarget(), 'upper');
});

console.log('🎉 全部年代-深度控制点命中优先度与编辑目标单元测试顺利通过！');
