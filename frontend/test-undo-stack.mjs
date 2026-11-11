/**
 * U1 判据：撤销/重做**动作栈**的纯逻辑（node --experimental-strip-types 直接跑 TS 源）。
 *
 * 这些判据守的是旧实现已证实的失效形态（见 docs/findings/undo-redesign-2026-11-11.md）：
 * - "按钮可点但什么也没发生" ⇒ 这里钉住"没有逆操作就不该出现在栈里"（UI 由栈驱动 disabled）；
 * - "重放的是别的动作" ⇒ 这里钉住 undo 只调用该 op 自己的 inverse，且顺序严格后进先出；
 * - "失败了还当成功" ⇒ inverse 抛错 / verify 返回 false 时，**该操作必须留在栈里**。
 */
import assert from 'node:assert/strict';
import { UndoStack } from './src/core/UndoStack.ts';

let n = 0;
// 串行执行（含 async 用例）：每条都 await 完再跑下一条，失败即中断并抛错。
let chain = Promise.resolve();
function check(label, fn) {
  chain = chain.then(async () => {
    await fn();
    n += 1;
    console.log(`ok ${n} - ${label}`);
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// 1. 空栈：不可撤销、不可重做
check('空栈时 canUndo/canRedo 都为 false（按钮应 disabled）', () => {
  const s = new UndoStack();
  assert.deepEqual(
    { u: s.state.canUndo, r: s.state.canRedo, d: s.state.depth },
    { u: false, r: false, d: 0 }
  );
});

// 2. push 后可撤销，且带 label
check('push 后可撤销且暴露 label', () => {
  const s = new UndoStack();
  s.push({ label: '改名 A → B', inverse: async () => {} });
  assert.equal(s.state.canUndo, true);
  assert.equal(s.state.undoLabel, '改名 A → B');
  assert.equal(s.state.depth, 1);
});

// 3. undo 调该 op 的 inverse，且按后进先出
check('undo 只调自己的 inverse，且后进先出', async () => {
  const calls = [];
  const s = new UndoStack();
  s.push({ label: 'a', inverse: async () => calls.push('a') });
  s.push({ label: 'b', inverse: async () => calls.push('b') });
  await s.undo();
  assert.deepEqual(calls, ['b']);
  assert.equal(s.state.undoLabel, 'a');
});

// 4. inverse 抛错：操作留在栈里，异常上抛
check('inverse 抛错时该操作留在栈里（可重试），异常不被吞', async () => {
  const s = new UndoStack();
  s.push({
    label: 'boom',
    inverse: async () => {
      throw new Error('backend down');
    },
  });
  await assert.rejects(() => s.undo(), /backend down/);
  assert.equal(s.state.canUndo, true, '失败后不得静默出栈');
});

// 5. verify 返回 false：同样不出栈
check('verify 复核不通过时不出栈，返回 false', async () => {
  let undone = 0;
  const s = new UndoStack();
  s.push({
    label: 'calib',
    inverse: async () => {
      undone += 1;
    },
    verify: async () => false,
  });
  assert.equal(await s.undo(), false);
  assert.equal(undone, 1);
  assert.equal(s.state.canUndo, true, '后端没确认就不能当撤销成功');
});

// 6. 只有提供 forward 的操作才可重做
check('没有 forward 的操作撤销后不可重做；有 forward 的可重做并调用它', async () => {
  const s1 = new UndoStack();
  s1.push({ label: 'no-forward', inverse: async () => {} });
  await s1.undo();
  assert.equal(s1.state.canRedo, false);

  const calls = [];
  const s2 = new UndoStack();
  s2.push({
    label: 'with-forward',
    inverse: async () => calls.push('inv'),
    forward: async () => calls.push('fwd'),
  });
  await s2.undo();
  assert.equal(s2.state.canRedo, true);
  assert.equal(await s2.redo(), true);
  assert.deepEqual(calls, ['inv', 'fwd']);
  assert.equal(s2.state.canUndo, true);
});

// 7. 新动作清空重做栈
check('push 新动作后重做栈被清空', async () => {
  const s = new UndoStack();
  s.push({ label: 'a', inverse: async () => {}, forward: async () => {} });
  await s.undo();
  assert.equal(s.state.canRedo, true);
  s.push({ label: 'b', inverse: async () => {}, forward: async () => {} });
  assert.equal(s.state.canRedo, false, '新动作后不得还能重做旧分支');
});

// 8. 容量上限丢最旧
check('超过 limit 时丢最旧的一条', () => {
  const s = new UndoStack(3);
  for (const l of ['1', '2', '3', '4']) s.push({ label: l, inverse: async () => {} });
  assert.equal(s.state.depth, 3);
  assert.equal(s.state.undoLabel, '4');
});

// 9. clear（换图/新建/载入工程包时）
check('clear 清空两侧，按钮回到 disabled', () => {
  const s = new UndoStack();
  s.push({ label: 'a', inverse: async () => {}, forward: async () => {} });
  s.clear();
  assert.equal(s.state.canUndo, false);
  assert.equal(s.state.canRedo, false);
});

// 10. busy 期间不接受重入
check('撤销进行中时再次 undo 返回 false（防连点重复回退）', async () => {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const s = new UndoStack();
  s.push({
    label: 'slow',
    inverse: async () => {
      await gate;
    },
  });
  const first = s.undo();
  assert.equal(await s.undo(), false, '重入必须被拒绝');
  release();
  assert.equal(await first, true);
});

// 11. 订阅：push/undo 都会通知，且首帧立即回调一次
check('subscribe 立即回调一次并随后续状态变化通知', async () => {
  const seen = [];
  const s = new UndoStack();
  const off = s.subscribe((st) => seen.push(st.canUndo));
  s.push({ label: 'a', inverse: async () => {} });
  await s.undo();
  off();
  s.push({ label: 'b', inverse: async () => {} });
  assert.deepEqual(seen, [false, true, false], '首次立即回调 + 两次变化，退订后不再收到');
});

await chain;
console.log(`\nundo-stack: ${n} checks passed`);
