// 真实模块测试：直接 import 编译目标 src/ 下的 PollenGlossary，
// 而不是像 test-core.js 那样复刻一份内联实现。
//
// 背景：test-core.js 里所有"词典"相关断言都跑在手工复刻的 TestPollenGlossary 上，
// 因此 setCustomTaxa 的"覆盖模式删不掉旧条目"这一缺陷能长期不被发现——内联副本
// 自然不会包含尚未写进真模块的语义。本文件用 Node 的类型剥离直接加载 .ts 源码，
// 保证断言打在真代码上。
//
// 运行：node --experimental-strip-types test-glossary.mjs
import assert from 'node:assert';

const { PollenGlossary } = await import('./src/core/PollenGlossary.ts');

console.log('--- 运行 PollenGlossary 真实模块测试 ---');

const builtinCount = PollenGlossary.getBuiltinCount();
assert.ok(builtinCount > 400, `内置词典规模异常: ${builtinCount}`);
assert.strictEqual(PollenGlossary.getCustomTaxa().length, 0, '初始不应有自定义词汇');

// 1. 追加模式：自定义词汇生效，内置词典冗余保留
const added = PollenGlossary.setCustomTaxa(['Aulacoseira', '新疆落叶松', 'Tetraedron'], 'append');
assert.ok(added >= 2, `追加应至少写入未内置的条目，实际 ${added}`);
assert.strictEqual(PollenGlossary.correct('新疆落叶松').corrected, '新疆落叶松');
assert.strictEqual(PollenGlossary.correct('Tetraedron').corrected, 'Tetraedron');
// 内置词条不得因追加而丢失
assert.strictEqual(PollenGlossary.correct('Cyclotella').corrected, 'Cyclotella');
assert.strictEqual(PollenGlossary.correct('Pinus').corrected, 'Pinus');
assert.strictEqual(PollenGlossary.correct('Querous').corrected, 'Quercus');

// 2. 覆盖模式：旧自定义条目必须被真正移除（本文件存在的首要原因）
PollenGlossary.setCustomTaxa(['Cyclotella'], 'replace');
assert.strictEqual(
  PollenGlossary.correct('新疆落叶松').corrected, '新疆落叶松',
  '覆盖模式后，未被保留的自定义词不应再被内置词典"认领"为其他名字'
);
assert.ok(
  !PollenGlossary.getCustomTaxa().includes('新疆落叶松'),
  '覆盖模式后自定义列表不应残留旧条目',
);
assert.strictEqual(PollenGlossary.correct('Tetraedron').corrected, 'Tetraedron');

// 覆盖模式不得伤害内置词典
assert.strictEqual(PollenGlossary.correct('Cyclotella').corrected, 'Cyclotella');
assert.strictEqual(PollenGlossary.correct('Pinus').corrected, 'Pinus');
assert.strictEqual(PollenGlossary.correct('Aulacoseira').corrected, 'Aulacoseira');
assert.strictEqual(PollenGlossary.correct('Sporormiella').corrected, 'Sporormiella');
assert.strictEqual(PollenGlossary.correct('Pediastrum tetras').corrected, 'Pediastrum tetras');
assert.strictEqual(PollenGlossary.getBuiltinCount(), builtinCount, '内置条数不得变化');

// 注意：前端词典是【纯拉丁名】表，中文名不在其中——中文->拉丁映射只存在于后端
// DEFAULT_POLLEN_DICT（OCR 匹配走后端）。此处固化该边界，避免误以为前端也认中文。
assert.strictEqual(
  PollenGlossary.correct('盘星藻').corrected, '盘星藻',
  '前端词典不含内置中文名，不应"纠正"为拉丁名（该映射由后端负责）',
);

// 3. clearCustomTaxa：清空扩展后回到纯内置词典
PollenGlossary.setCustomTaxa(['我的自定义种'], 'append');
assert.strictEqual(PollenGlossary.correct('我的自定义种').corrected, '我的自定义种');
PollenGlossary.clearCustomTaxa();
assert.strictEqual(PollenGlossary.getCustomTaxa().length, 0, '清空后不应残留自定义词汇');
assert.strictEqual(PollenGlossary.correct('Cyclotella').corrected, 'Cyclotella');
assert.strictEqual(PollenGlossary.correct('Pinus').corrected, 'Pinus');

// 4. 大小写不同的自定义词覆盖内置键后，清空必须还原内置拼写
PollenGlossary.setCustomTaxa(['cyclotella'], 'append');
assert.strictEqual(PollenGlossary.getCustomTaxa().length, 1);
PollenGlossary.clearCustomTaxa();
assert.strictEqual(
  PollenGlossary.correct('Cyclotella').corrected, 'Cyclotella',
  '清空自定义后，内置键必须还原为内置拼写而不是被删掉',
);

// 5. 图版说明解析仍是前端可用的纯函数
const caption = 'a) Pediastrum simplex var. simplex; b) Pediastrum cf. argentinense';
const parsed = PollenGlossary.parseTaxaList(caption);
assert.strictEqual(parsed.length, 2, `图版说明应解析出 2 条，实际 ${parsed.length}`);
assert.strictEqual(parsed[0].corrected, 'Pediastrum simplex var. simplex');
assert.strictEqual(parsed[1].corrected, 'Pediastrum cf. argentinense');

// 6. 硅藻属与源表异名在前端同样可用
assert.strictEqual(PollenGlossary.correct('Aulacoseira').corrected, 'Aulacoseira');
assert.ok(
  PollenGlossary.correct('Thalasiosira').wasCorrected,
  '源表拼写异名 Thalasiosira 应被纠正',
);

console.log('✔ PollenGlossary 真实模块（追加/覆盖/清空/内置保留）验证通过');
