import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const entry = fileURLToPath(new URL('./src/core/tools/AddPointToolStrategy.ts', import.meta.url));
const out = await build({
  logLevel: 'silent',
  build: {
    write: false,
    lib: { entry, formats: ['es'] },
  },
});
const chunk = Array.isArray(out) ? out[0].output[0] : out.output[0];
const { AddPointToolStrategy } = await import(
  `data:text/javascript;base64,${Buffer.from(chunk.code, 'utf8').toString('base64')}`
);

function makeBaseContext(overrides = {}) {
  const notices = [];
  return {
    notices,
    ctx: {
      data: {
        columns: [
          {
            id: 'col-1',
            name: 'Pinus',
            startX: 100,
            endX: 200,
            controlPoints: [],
          },
        ],
        calibration: null,
        selectedEntity: null,
      },
      viewport: { scale: 1 },
      workflowStage: 7,
      toolMode: 'addPoint',
      history: {},
      requestRender: () => {},
      notifyNotice: (msg) => notices.push(msg),
      commitControlPoints: () => {},
      isToolAllowed: () => true,
      getActiveColumn: () => null,
      isWithinDiagramBounds: () => true,
      hoveredDepthHorizon: null,
      callbacks: {},
      ...overrides,
    },
  };
}

const strategy = new AddPointToolStrategy();
const leftClick = { button: 0 };

// 1. Clicking without an active column gives explicit feedback instead of silent no-op
{
  const { ctx, notices } = makeBaseContext({ getActiveColumn: () => null });
  const handled = strategy.onMouseDown(leftClick, { x: 150, y: 120 }, { x: 150, y: 120 }, ctx);
  assert.equal(handled, true);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /选中一列/);
}

// 2. Clicking with an active column adds the point and notifies the coordinate
{
  const { ctx, notices } = makeBaseContext();
  ctx.getActiveColumn = () => ctx.data.columns[0];
  const handled = strategy.onMouseDown(leftClick, { x: 150, y: 120.4 }, { x: 150, y: 120.4 }, ctx);
  assert.equal(handled, true);
  assert.equal(ctx.data.columns[0].controlPoints.length, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /已.*Pinus.*添加控制点.*120/);
}

console.log('test-add-point-feedback: all assertions passed');
