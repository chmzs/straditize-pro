/**
 * 年代-深度编辑历史栈 (AgeDepthHistory) 单元测试
 * node --experimental-strip-types 纯原生验证
 */
import assert from 'node:assert/strict';
import { AgeDepthHistory } from './src/components/agedepth/AgeDepthHistory.ts';

let n = 0;
function check(label, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${label}`);
}

console.log('--- 运行 年代-深度编辑历史栈 (AgeDepthHistory) 单元测试 ---');

// 1. 初始空栈
check('空栈时 canUndo/canRedo 均为 false', () => {
  const h = new AgeDepthHistory();
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
  assert.equal(h.undo({ controlPoints: [], selectedControlPointIndex: null, editTarget: 'curve' }), null);
  assert.equal(h.redo({ controlPoints: [], selectedControlPointIndex: null, editTarget: 'curve' }), null);
});

// 2. push 产生可撤销历史
check('push 记录快照后可撤销但不可重做', () => {
  const h = new AgeDepthHistory();
  const cp1 = [{ id: 'cp1', x: 10, y: 20, kind: 'curve' }];
  h.push('添加点', {
    controlPoints: cp1,
    selectedControlPointIndex: 0,
    editTarget: 'curve',
  });
  assert.equal(h.canUndo(), true);
  assert.equal(h.canRedo(), false);
});

// 3. 撤销恢复上一状态并将当前状态推入重做栈
check('undo 弹出历史状态并推入 redo 栈', () => {
  const h = new AgeDepthHistory();
  const state0 = {
    controlPoints: [{ id: 'cp0', x: 0, y: 0, kind: 'curve' }],
    selectedControlPointIndex: null,
    editTarget: 'curve',
  };
  h.push('初始点', state0);

  const state1 = {
    controlPoints: [
      { id: 'cp0', x: 0, y: 0, kind: 'curve' },
      { id: 'cp1', x: 10, y: 20, kind: 'curve' },
    ],
    selectedControlPointIndex: 1,
    editTarget: 'curve',
  };

  const restored = h.undo(state1);
  assert.notEqual(restored, null);
  assert.equal(restored.description, '初始点');
  assert.equal(restored.controlPoints.length, 1);
  assert.equal(restored.controlPoints[0].id, 'cp0');
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), true);

  // 4. 重做
  const redone = h.redo(restored);
  assert.notEqual(redone, null);
  assert.equal(redone.controlPoints.length, 2);
  assert.equal(redone.controlPoints[1].id, 'cp1');
  assert.equal(h.canUndo(), true);
  assert.equal(h.canRedo(), false);
});

// 5. 新动作清空 redo 栈
check('新 push 操作清空 redo 栈', () => {
  const h = new AgeDepthHistory();
  h.push('op1', { controlPoints: [], selectedControlPointIndex: null, editTarget: 'curve' });
  const s2 = { controlPoints: [{ id: 'a', x: 1, y: 1, kind: 'curve' }], selectedControlPointIndex: null, editTarget: 'curve' };
  h.undo(s2);
  assert.equal(h.canRedo(), true);

  // 插入新操作
  h.push('op2', { controlPoints: [{ id: 'b', x: 2, y: 2, kind: 'curve' }], selectedControlPointIndex: null, editTarget: 'curve' });
  assert.equal(h.canRedo(), false);
});

// 6. 栈深限制
check('栈深达到上限时自动丢弃最旧历史', () => {
  const h = new AgeDepthHistory(2);
  h.push('snap1', { controlPoints: [{ id: '1', x: 1, y: 1, kind: 'curve' }], selectedControlPointIndex: null, editTarget: 'curve' });
  h.push('snap2', { controlPoints: [{ id: '2', x: 2, y: 2, kind: 'curve' }], selectedControlPointIndex: null, editTarget: 'curve' });
  h.push('snap3', { controlPoints: [{ id: '3', x: 3, y: 3, kind: 'curve' }], selectedControlPointIndex: null, editTarget: 'curve' });

  // 只能连续 undo 2 次
  const s4 = { controlPoints: [{ id: '4', x: 4, y: 4, kind: 'curve' }], selectedControlPointIndex: null, editTarget: 'curve' };
  const u1 = h.undo(s4);
  assert.equal(u1?.description, 'snap3');
  const u2 = h.undo(u1);
  assert.equal(u2?.description, 'snap2');
  assert.equal(h.canUndo(), false);
});

// 7. 深拷贝不变量
check('快照为纯数据深拷贝，后续对原数组的修改不污染历史快照', () => {
  const h = new AgeDepthHistory();
  const cps = [{ id: 'cp0', x: 10, y: 10, kind: 'curve' }];
  h.push('测试深拷贝', { controlPoints: cps, selectedControlPointIndex: 0, editTarget: 'curve' });

  // 修改原对象
  cps[0].x = 999;
  cps.push({ id: 'cp1', x: 20, y: 20, kind: 'curve' });

  const restored = h.undo({ controlPoints: cps, selectedControlPointIndex: 1, editTarget: 'curve' });
  assert.equal(restored?.controlPoints.length, 1);
  assert.equal(restored?.controlPoints[0].x, 10);
});

// 8. clear 清空全部栈
check('clear 清空两侧所有快照', () => {
  const h = new AgeDepthHistory();
  h.push('op', { controlPoints: [], selectedControlPointIndex: null, editTarget: 'curve' });
  h.clear();
  assert.equal(h.canUndo(), false);
  assert.equal(h.canRedo(), false);
});

console.log('🎉 全部 年代-深度编辑历史栈 单元测试顺利通过！');
