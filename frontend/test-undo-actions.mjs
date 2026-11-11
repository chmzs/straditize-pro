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
import { makeCalibrationUndo, makeRenameUndo, NON_UNDOABLE } from './src/core/undoActions.ts';

let n = 0;
let chain = Promise.resolve();
function check(label, fn) {
  chain = chain.then(async () => {
    await fn();
    n += 1;
    console.log(`ok ${n} - ${label}`);
  });
}

const PREV = {
  isCalibrated: true,
  topPx: 806,
  topValue: 250,
  bottomPx: 1235,
  bottomValue: 350,
  unit: 'cm',
  primaryAxis: 'depth',
};
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
  const calls = [];
  const op = makeCalibrationUndo(
    PREV,
    NEXT,
    async (p) => {
      calls.push(p);
    },
    async () => NEXT
  );
  await op.forward();
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
  assert.equal(await op.verify(), false);
});

// 4. verify 后端回到旧值 ⇒ true
check('verify 后端回到旧值时返回 true', async () => {
  const op = makeCalibrationUndo(
    PREV,
    NEXT,
    async () => {},
    async () => PREV
  );
  assert.equal(await op.verify(), true);
});

// 5. 撤名：inverse 用旧名、forward 用新名
check('改名撤销/重做分别用旧名与新名', async () => {
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
  await op.forward();
  assert.deepEqual(names, ['Pinus', 'Pinus2']);
  assert.match(op.label, /Pinus → Pinus2/);
});

// 6. 改名 verify：后端仍是新名 ⇒ false
check('改名 verify 以后端为准（仍是新名 ⇒ false）', async () => {
  const op = makeRenameUndo(
    'roi',
    'roi_1',
    'pollen',
    '湖泊A',
    async () => {},
    async () => '湖泊A'
  );
  assert.equal(await op.verify(), false);
});

// 7. 删除类没有构造器：NON_UNDOABLE 必须非空（防止有人给删除编一个假逆操作）
check('删除类动作在 NON_UNDOABLE 中登记（不得入栈）', () => {
  assert.ok(NON_UNDOABLE.length >= 2);
  assert.ok(NON_UNDOABLE.some((x) => x.startsWith('roi.remove')));
  assert.ok(NON_UNDOABLE.some((x) => x.startsWith('column.remove')));
});

await chain;
console.log(`\nundo-actions: ${n} checks passed`);
