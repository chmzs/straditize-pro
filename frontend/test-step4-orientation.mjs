/**
 * 步骤 4「检测横线 / 检测竖线」开关的纯逻辑判据（脱浏览器直跑 TS 源）。
 *
 * ## 判据盯的是什么
 *
 * 1. **默认两项都勾**：与引入开关之前的行为一致（不传参数时检测两类都检）。
 * 2. **勾选状态跨"重渲染"保持**：`render()` 每次数据变化都重跑、`mount()` 每次
 *    都重挂，状态若住在局部就会被打回默认——用户会看到"刚取消勾选又自己勾上"。
 *    这里连续多次读状态，模拟多次 render/mount 之间的边界。
 * 3. **统计按 `kind`**，不按 `axis`：A=横线，B/C=竖线，B 与 C 共用一个开关。
 *    未知 `kind` 必须抛错，不能静默归到某一侧。
 * 4. **取消勾选只提示、不删数据**：提示里必须同时给"条数"与"重新检测"的指路，
 *    否则用户会以为丢了数据或不知道下一步做什么。
 * 5. **两项都勾时不得有提示**（负向对照）：防止提示变成常驻噪音。
 *
 * 真实"点勾选框 → 点检测 → 后端不再返回该类候选"的闭环在
 * `frontend/e2e/step4-orientation-toggle.spec.ts`（那里断言候选的 `kind`）。
 */
import assert from 'node:assert/strict';

const {
  DEFAULT_DETECT_ORIENTATION,
  getDetectOrientation,
  setDetectOrientation,
  resetDetectOrientation,
  countByOrientation,
  orientationNotice,
  toDetectPayload,
} = await import('./src/core/detectOrientation.ts');

let n = 0;
function ok(label) {
  n += 1;
  console.log(`ok ${n} - ${label}`);
}

// ---- 1. 默认两项都勾 ----
resetDetectOrientation();
assert.deepEqual(
  getDetectOrientation(),
  { horizontal: true, vertical: true },
  '默认必须两项都勾（与引入开关之前一致）'
);
assert.deepEqual(DEFAULT_DETECT_ORIENTATION, { horizontal: true, vertical: true });
ok('默认两项都勾');

// ---- 2. 状态跨重渲染保持（多次读取不被重置） ----
setDetectOrientation({ vertical: false });
for (let render = 0; render < 3; render += 1) {
  assert.deepEqual(
    getDetectOrientation(),
    { horizontal: true, vertical: false },
    `第 ${render + 1} 次重渲染后勾选状态被重置了——状态不能住在 render() 的局部`
  );
}
ok('取消勾选竖线后，重渲染不把状态打回默认');

// 返回的是副本：外部改动不得污染模块内部状态（否则每次 render 都可能被改）
const snapshot = getDetectOrientation();
snapshot.vertical = true;
assert.equal(getDetectOrientation().vertical, false, 'getDetectOrientation 必须返回副本');
ok('getDetectOrientation 返回副本，外部改写不污染状态');

// 复位（等价于新开会话）
resetDetectOrientation();
assert.deepEqual(getDetectOrientation(), { horizontal: true, vertical: true });
ok('resetDetectOrientation 回到默认');

// ---- 3. 统计按 kind ----
const mixed = [{ kind: 'A' }, { kind: 'A' }, { kind: 'B' }, { kind: 'C' }, { kind: 'C' }];
assert.deepEqual(
  countByOrientation(mixed),
  { horizontal: 2, vertical: 3 },
  'B 与 C 都必须算竖线（它们共用一个开关）'
);
assert.deepEqual(countByOrientation([]), { horizontal: 0, vertical: 0 });
ok('按 kind 统计：A=横线，B/C=竖线');

// 未知 kind 必须抛错，不许静默归类
assert.throws(
  () => countByOrientation([{ kind: 'D' }]),
  /未知的候选类别 kind=D/,
  '未知 kind 必须抛错，不能静默归到某一侧'
);
ok('未知 kind 抛错（不静默归类）');

// ---- 4. 提示文案：取消勾选后如实报数并指路 ----
const verticalOnlyOff = { horizontal: true, vertical: false };
const verticalNotice = orientationNotice({ horizontal: 3, vertical: 14 }, verticalOnlyOff);
assert.match(verticalNotice, /当前列表仍有 14 条竖线候选/, '必须报出竖线条数');
assert.match(verticalNotice, /如需仅看横线请重新检测/, '必须指路"重新检测"');
assert.doesNotMatch(verticalNotice, /横线候选/, '只提示被取消勾选的那一类');

const horizontalOnlyOff = { horizontal: false, vertical: true };
const horizontalNotice = orientationNotice({ horizontal: 3, vertical: 14 }, horizontalOnlyOff);
assert.match(horizontalNotice, /当前列表仍有 3 条横线候选/);
assert.match(horizontalNotice, /如需仅看竖线请重新检测/);
ok('提示如实报出被取消勾选那一类的条数并指路重新检测');

// ---- 5. 负向对照：两项都勾时不得有提示 ----
assert.equal(
  orientationNotice({ horizontal: 3, vertical: 14 }, { horizontal: true, vertical: true }),
  '',
  '两项都勾时不得出现提示（提示只能是条件性的，不能常驻）'
);
// 取消勾选但列表里本来就没有那一类：也不必提示
assert.equal(
  orientationNotice({ horizontal: 3, vertical: 0 }, { horizontal: true, vertical: false }),
  '',
  '列表里没有竖线时，"仍有 0 条竖线候选"是噪音'
);
ok('两项都勾 / 该类为空时无提示（负向对照）');

// ---- 6. 请求参数映射 ----
assert.deepEqual(
  toDetectPayload({ horizontal: true, vertical: false }),
  { includeHorizontal: true, includeVertical: false },
  '勾选状态必须原样映射成检测参数'
);
ok('toDetectPayload 把勾选状态映射成 includeHorizontal/includeVertical');

console.log(`\n1..${n}`);
