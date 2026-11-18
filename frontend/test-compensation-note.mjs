/**
 * `compensationNote`（补偿明细一句话）的行为。
 *
 * 门禁点：0 行补偿必须返回空串——否则 HUD 上会常年挂一句"补偿 0 行"，
 * 真出问题时反而没人看；有补偿时必须两条都写清（补回 / 判不准不许混）。
 */
import assert from 'node:assert/strict';
import { compensationNote, addCompensation } from './src/core/compensationNote.ts';

// 1) 0/0 → 空串（不是"补偿 0 行"）
assert.equal(compensationNote({ brokenRows: 0, ambiguousRows: 0 }), '');

// 2) 只有补回
const onlyBroken = compensationNote({ brokenRows: 139, ambiguousRows: 0 });
assert.match(onlyBroken, /139 行外线断开/);
assert.match(onlyBroken, /内线 × 放大倍数/);
assert.doesNotMatch(onlyBroken, /判不准/);

// 3) 只有判不准
const onlyAmbig = compensationNote({ brokenRows: 0, ambiguousRows: 87 });
assert.match(onlyAmbig, /87 行内线过窄判不准/);
assert.match(onlyAmbig, /读数保持原样/);
assert.doesNotMatch(onlyAmbig, /补回/);

// 4) 两者都有：两个数字都在，且"判不准"不许写成"补回"
const both = compensationNote({ brokenRows: 139, ambiguousRows: 87 });
assert.ok(both.includes('139') && both.includes('87'), both);
assert.ok(both.indexOf('139') < both.indexOf('87'), '顺序：先补回、后判不准');

// 5) 累加
assert.deepEqual(
  addCompensation({ brokenRows: 1, ambiguousRows: 2 }, { brokenRows: 3, ambiguousRows: 4 }),
  { brokenRows: 4, ambiguousRows: 6 }
);

console.log('test-compensation-note: 5 项通过');
