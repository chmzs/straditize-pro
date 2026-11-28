import assert from 'node:assert/strict';
import { probeHover } from './src/components/canvas/hoverProbe.ts';

const baseCal = {
  topY: 100,
  bottomY: 500,
  topDepth: 0,
  bottomDepth: 100,
  depthInterval: 10,
  unit: 'cm',
};

const roi = { xMin: 100, xMax: 500, yMin: 100, yMax: 500 };

const colPicea = {
  id: 'c0',
  colIndex: 0,
  name: 'Picea',
  startX: 100,
  endX: 200,
  visible: true,
  scale_provenance: { calibrated: true, source: 'x_ticks' },
  scaleCalib: {
    originX: 110,
    originVal: 0,
    calibX: 210,
    calibVal: 100,
  },
  x_ticks: [
    { px: 110, value: 0 },
    { px: 210, value: 100 },
  ],
};

const colAmaranthaceae = {
  id: 'c1',
  colIndex: 1,
  name: 'Amaranthaceae',
  startX: 250,
  endX: 400,
  visible: true,
  scale_provenance: { calibrated: true, source: 'x_ticks' },
  scaleCalib: {
    originX: 250,
    originVal: 0,
    calibX: 350,
    calibVal: 50,
  },
  x_ticks: [
    { px: 250, value: 0 },
    { px: 350, value: 50 },
  ],
};

const columns = [colPicea, colAmaranthaceae];

// 1. 光标在当前选中列 Picea 内：读 Picea 标度
{
  const res = probeHover({
    worldPt: { x: 160, y: 200 },
    calibration: baseCal,
    roi,
    scale: 1,
    activeColumn: colPicea,
    columns,
  });
  assert.equal(res.info.percent, 50.0);
}

// 2. 光标移到 Amaranthaceae 列内（虽然 activeColumn 仍是 Picea）：
// 必须切换到光标所在列 Amaranthaceae 的标度，不得用 Picea 外推到 240%
{
  const res = probeHover({
    worldPt: { x: 350, y: 200 },
    calibration: baseCal,
    roi,
    scale: 1,
    activeColumn: colPicea,
    columns,
  });
  assert.equal(res.info.percent, 50.0);
}

// 3. 光标落在 ROI 外（左侧或图像外、或 Y 越界）：必须返回 undefined（页脚显示 --）
for (const pt of [
  { x: 50, y: 200 },
  { x: -120, y: 200 },
  { x: 520, y: 200 },
  { x: 150, y: 50 },
  { x: 150, y: 550 },
]) {
  const res = probeHover({
    worldPt: pt,
    calibration: baseCal,
    roi,
    scale: 1,
    activeColumn: colPicea,
    columns,
  });
  assert.equal(res.info.percent, undefined, `ROI 外 (${pt.x},${pt.y}) 必须为 undefined`);
}

// 4. 光标在两列间隙中（ROI 内但不在任何列 [startX, endX]）：必须返回 undefined
{
  const res = probeHover({
    worldPt: { x: 225, y: 200 },
    calibration: baseCal,
    roi,
    scale: 1,
    activeColumn: colPicea,
    columns,
  });
  assert.equal(res.info.percent, undefined);
}

// 5. 光标在列内但处于 0 点左侧（如 axis_stroke_px 左缘处）：不得钳成 0%，必须暴露真实负值
{
  const res = probeHover({
    worldPt: { x: 100, y: 200 },
    calibration: baseCal,
    roi,
    scale: 1,
    activeColumn: colPicea,
    columns,
  });
  assert.equal(res.info.percent, -10.0);
}

console.log('✓ test-hover-probe.mjs passed');
