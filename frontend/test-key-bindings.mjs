/**
 * 键盘绑定表的行为断言（纯函数，无需浏览器）。
 *
 * ## 这份测试要钉住的具体回归
 *
 * `onKeyDown` 曾是 277 行顺序 if 链，`KeyC` 被绑了两次：
 * 前面是「添加属种列」（命中即 return），后面是「高对比度」——后者**永远不可达**，
 * 从加进去那天起就没生效过。顺序链里没有任何机制能发现这种重复。
 *
 * 所以这里既测匹配语义，也测**冲突检测本身**，并用一条静态哨兵盯住产品代码里
 * `'KeyC'` 的出现次数：只要有人再加一条，测试立刻红。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertNoDuplicateBindings, matchesKeyBinding } from './src/components/canvas/keyBindings.ts';

const mk = (over) => ({ label: 'x', run: () => {}, ...over });
const ev = (over) => ({ code: '', key: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

// 1) 唯一表必须通过
assertNoDuplicateBindings([mk({ codes: ['KeyA'] }), mk({ codes: ['KeyB'] })]);

// 2) 重复绑定（同 code + 同修饰）必须抛，且消息里点出两个 label
assert.throws(
  () =>
    assertNoDuplicateBindings([
      mk({ codes: ['KeyC'], plain: true, label: '添加属种列' }),
      mk({ codes: ['KeyC'], plain: true, label: '高对比度' }),
    ]),
  /键盘绑定冲突[\s\S]*添加属种列[\s\S]*高对比度/
);

// 3) 修饰键不同不算冲突（Ctrl+C 与 C 可以共存）
assertNoDuplicateBindings([mk({ codes: ['KeyC'], plain: true }), mk({ codes: ['KeyC'], ctrl: true })]);

// 4) 匹配语义：plain 不接受带修饰，ctrl 不接受裸按，keys 大小写不敏感
const plainA = mk({ codes: ['KeyA'], plain: true });
assert.equal(matchesKeyBinding(plainA, ev({ code: 'KeyA', key: 'a' })), true, '裸按 A 应命中');
assert.equal(matchesKeyBinding(plainA, ev({ code: 'KeyA', key: 'a', ctrlKey: true })), false, '带 Ctrl 不得命中 plain 绑定');

const ctrlZ = mk({ keys: ['z'], ctrl: true });
assert.equal(matchesKeyBinding(ctrlZ, ev({ code: 'KeyZ', key: 'Z', ctrlKey: true })), true, 'Ctrl+Shift+Z 的 key 是大写也要命中');
assert.equal(matchesKeyBinding(ctrlZ, ev({ code: 'KeyZ', key: 'z' })), false, '裸按 z 不得命中 Ctrl+Z');

// 5) 回归哨兵：产品代码里 KeyC 只能绑定一次
const src = readFileSync(new URL('./src/components/GeologyCanvas.ts', import.meta.url), 'utf8');
// 只数真正参与绑定的写法（codes: ['KeyC']），注释里提到不算。
const keycCount = (src.match(/codes:\s*\[\s*'KeyC'\s*\]/g) ?? []).length;
assert.equal(
  keycCount,
  1,
  `KeyC 必须只绑定一次，实测 ${keycCount} 处（曾因 KeyC 双绑定导致「高对比度」快捷键永远不可达）`
);

console.log('✔ 键位绑定 5 组断言全部通过');
