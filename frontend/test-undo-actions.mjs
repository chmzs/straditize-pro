/**
 * U2/U3 判据：撤销动作**构造器**的语义（node --experimental-strip-types 直接跑 TS 源）。
 *
 * 守的是旧实现的两个病根：
 * 1. 撤销时发的**不是**这个动作的写通道（撤销标定发 `roi.update`，撤销改名发 `applyLineRemoval`）；
 * 2. 撤销"看起来成功"但后端没变（没有 verify，或 verify 读的是前端镜像）。
 *
 * 这里用假的 apply/read，断言"调用的参数"与"复核的口径"，不碰真实 RPC。
 */
import assert from 'node:assert/strict';
import {
  makeCalibrationUndo,
  makeControlPointsUndo,
  makeRenameUndo,
  NON_UNDOABLE,
} from './src/core/undoActions.ts';

let n = 0;
/** @type {Promise<void>} */
let chain = Promise.resolve();
/**
 * @param {string} label
 * @param {() => void | Promise<void>} fn
 */
function check(label, fn) {
  chain = chain.then(async () => {
    await fn();
    n += 1;
    console.log(`ok ${n} - ${label}`);
  });
}

/**
 * 标定快照夹具。`primaryAxis: 'depth'` 在 `DepthCalibrationPatch` 上是
 * `'depth' | 'age'` 联合，字面量需要上下文类型才不会被放宽成 `string`。
 * @type {import('./src/core/undoActions.ts').CalibrationSnapshot}
 */
const PREV = {
  isCalibrated: true,
  topPx: 806,
  topValue: 250,
  bottomPx: 1235,
  bottomValue: 350,
  unit: 'cm',
  primaryAxis: 'depth',
};
/** @type {import('./src/core/undoActions.ts').CalibrationSnapshot} */
const NEXT = {
  isCalibrated: true,
  topPx: 700,
  topValue: 0,
  bottomPx: 1100,
  bottomValue: 50,
  unit: 'cm',
  primaryAxis: 'depth',
};

// 1. 撤销标定：必须用"改前的值"调 apply（且只调一次）
check('标定撤销用改前的五点调用 apply，只调一次', async () => {
  /** @type {import('./src/core/undoActions.ts').DepthCalibrationPatch[]} */
  const calls = [];
  const op = makeCalibrationUndo(
    PREV,
    NEXT,
    async (p) => {
      calls.push(p);
    },
    async () => PREV
  );
  await op.inverse();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], PREV, '必须原样传回改前的标定参数');
});

// 2. 重做标定：用改后的值
check('标定重做用改后的五点调用 apply', async () => {
  /** @type {import('./src/core/undoActions.ts').DepthCalibrationPatch[]} */
  const calls = [];
  const op = makeCalibrationUndo(
    PREV,
    NEXT,
    async (p) => {
      calls.push(p);
    },
    async () => NEXT
  );
  // `UndoableOp.forward` / `.verify` 在类型上是可选键（删除类动作两者都没有），
  // 而这两个构造器**总是**给出它们。收窄一次，运行期只是取出同一个函数引用。
  const forward = /** @type {NonNullable<typeof op.forward>} */ (op.forward);
  await forward();
  assert.deepEqual(calls[0], NEXT);
});

// 3. verify 读后端：后端仍是新值 ⇒ 撤销不算成功
check('verify 以后端为准：后端仍是新值时返回 false（不得当撤销成功）', async () => {
  const op = makeCalibrationUndo(
    PREV,
    NEXT,
    async () => {},
    async () => NEXT
  );
  // `verify` 的 direction 参数被 `makeCalibrationUndo` 忽略（它只比对 read() 与 prev），
  // 这里传 'inverse' 是为了满足签名，不影响断言口径。
  const verify = /** @type {NonNullable<typeof op.verify>} */ (op.verify);
  assert.equal(await verify('inverse'), false);
});

// 4. verify 后端回到旧值 ⇒ true
check('verify 后端回到旧值时返回 true', async () => {
  const op = makeCalibrationUndo(
    PREV,
    NEXT,
    async () => {},
    async () => PREV
  );
  const verify = /** @type {NonNullable<typeof op.verify>} */ (op.verify);
  assert.equal(await verify('inverse'), true);
});

// 5. 撤名：inverse 用旧名、forward 用新名
check('改名撤销/重做分别用旧名与新名', async () => {
  /** @type {string[]} */
  const names = [];
  const op = makeRenameUndo(
    'column',
    'roi_1_col01',
    'Pinus',
    'Pinus2',
    async (name) => {
      names.push(name);
    },
    async () => names.at(-1) ?? 'Pinus2'
  );
  await op.inverse();
  const forward = /** @type {NonNullable<typeof op.forward>} */ (op.forward);
  await forward();
  assert.deepEqual(names, ['Pinus', 'Pinus2']);
  assert.match(op.label, /Pinus → Pinus2/);
});

// 6. 改名 verify：后端仍是新名 ⇒ 撤销返回 false；重做 verify('forward') 时后端回到新名 ⇒ true
check('改名 verify 按方向校验（inverse 认旧名，forward 认新名）', async () => {
  const op = makeRenameUndo(
    'roi',
    'roi_1',
    'pollen',
    '湖泊A',
    async () => {},
    async () => '湖泊A'
  );
  const verify = /** @type {NonNullable<typeof op.verify>} */ (op.verify);
  assert.equal(await verify('inverse'), false);
  assert.equal(await verify('forward'), true);

  const opCal = makeCalibrationUndo(
    PREV,
    NEXT,
    async () => {},
    async () => NEXT
  );
  const verifyCal = /** @type {NonNullable<typeof opCal.verify>} */ (opCal.verify);
  assert.equal(await verifyCal('inverse'), false);
  assert.equal(await verifyCal('forward'), true);
});

// 7. 控制点撤销/重做：inverse 用 prev，forward 用 next
check('控制点撤销/重做分别写回改前与改后快照', async () => {
  /** @type {Array<{ wb: Array<{ row: number; x: number }>; uiCount: number }>} */
  const calls = [];
  const prevWb = [{ row: 10, x: 100 }];
  const nextWb = [
    { row: 10, x: 100 },
    { row: 20, x: 120 },
  ];
  const prevUi = [{ id: 'p1', x: 100, y: 10 }];
  const nextUi = [
    { id: 'p1', x: 100, y: 10 },
    { id: 'p2', x: 120, y: 20 },
  ];
  const op = makeControlPointsUndo(
    'Pinus',
    prevWb,
    nextWb,
    prevUi,
    nextUi,
    async (wb, ui) => {
      calls.push({ wb, uiCount: ui.length });
    },
    async () => nextWb
  );
  await op.inverse();
  const forward = /** @type {NonNullable<typeof op.forward>} */ (op.forward);
  await forward();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { wb: prevWb, uiCount: 1 });
  assert.deepEqual(calls[1], { wb: nextWb, uiCount: 2 });
});

// 9. 控制点撤销的 verify：读后端行号签名，不一致必须 false（#143 的门禁）
check('控制点 verify 读后端签名：撤销要等于 prev、重做要等于 next', async () => {
  const prevWb = [{ row: 10, x: 100 }];
  const nextWb = [
    { row: 10, x: 100 },
    { row: 20, x: 120 },
  ];
  let backend = nextWb;
  const op = makeControlPointsUndo(
    'Pinus',
    prevWb,
    nextWb,
    [{ id: 'p1' }],
    [{ id: 'p1' }, { id: 'p2' }],
    async () => {},
    async () => backend
  );
  const verify = /** @type {NonNullable<typeof op.verify>} */ (op.verify);
  assert.equal(await verify('inverse'), false, '后端仍是 next 时撤销不得算成功');
  assert.equal(await verify('forward'), true);

  backend = prevWb;
  assert.equal(await verify('inverse'), true);
  assert.equal(await verify('forward'), false);

  // 行号相同、x 有浮点漂移时不得假红（签名只用点数+行号）
  backend = [{ row: 10, x: 99.7 }];
  assert.equal(await verify('inverse'), true, 'x 漂移不应让合法实现变红');
});

// 8. 删除类没有构造器：NON_UNDOABLE 必须非空（防止有人给删除编一个假逆操作）
check('删除类动作在 NON_UNDOABLE 中登记（不得入栈）', () => {
  assert.ok(NON_UNDOABLE.length >= 2);
  assert.ok(NON_UNDOABLE.some((x) => x.startsWith('roi.remove')));
  assert.ok(NON_UNDOABLE.some((x) => x.startsWith('column.remove')));
});

await chain;
console.log(`\nundo-actions: ${n} checks passed`);
