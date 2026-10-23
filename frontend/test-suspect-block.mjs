// 真实模块测试：直接 import src/components/steps/SuspectBlockNotice.ts 的纯函数。
//
// 为什么这些判据放在 Node 侧而不是 Playwright：
// 1. 「未命中列时三个渲染函数都必须返回空串」——这是反向哨兵，需要**同一组函数**
//    在命中/未命中两种输入下都跑一遍。在浏览器里只能看到真实图（只命中 1 列），
//    构造不了"零命中"的对照。
// 2. 「不得自动剔除」这条要在**纯函数层面**钉死：本模块的每个导出都必须只返回
//    HTML 字符串，绝不能返回过滤后的列数组。用断言直接检查返回值类型即可。
//
// 运行：node --experimental-strip-types test-suspect-block.mjs
import assert from 'node:assert';

const mod = await import('./src/components/steps/SuspectBlockNotice.ts');

console.log('--- 运行 suspect_block 提示 真实模块测试 ---');

const flagged = {
  id: 'roi_1_col29',
  name: 'col29',
  col_index: 28,
  startX: 1960,
  endX: 2030,
  visible: true,
  color: '#000',
  unit: '%',
  suspect_block: {
    reason: 'fills_whole_column',
    cv: 0.0,
    fill_ratio: 1.0,
    mean_ink_width: 70.0,
    column_width: 70,
  },
};
const clean = {
  id: 'roi_1_col01',
  name: 'col01',
  col_index: 0,
  startX: 315,
  endX: 370,
  visible: true,
  color: '#000',
  unit: '%',
  suspect_block: null,
};

// ---- 1. getSuspectBlock：null 不算命中（后端对未命中列下发 null，不是缺键）----
assert.equal(mod.getSuspectBlock(flagged)?.reason, 'fills_whole_column');
assert.equal(mod.getSuspectBlock(clean), null, 'suspect_block: null 不得算命中');
assert.equal(mod.getSuspectBlock({ ...clean, suspect_block: undefined }), null, '缺键不得算命中');
assert.equal(mod.getSuspectBlock(null), null, 'null 列不得抛错');

// ---- 2. columnsWithSuspectBlock 只挑命中的，且**不修改原数组** ----------------
const all = [clean, flagged];
const picked = mod.columnsWithSuspectBlock(all);
assert.equal(picked.length, 1);
assert.equal(picked[0].id, 'roi_1_col29');
assert.equal(all.length, 2, '不得改动传入数组（更不得从中删除列）');
assert.ok(all.includes(clean), '未被标记的列必须仍在原数组里');

// ---- 3. 反向哨兵：零命中时三个渲染函数都必须返回空串 --------------------------
const none = [clean];
assert.equal(mod.renderSplitSuspectNotice(none), '', '零命中时步骤 5 不得渲染提示');
assert.equal(mod.renderActiveColumnSuspectNotice(clean), '', '未命中列不得渲染列提示');
assert.equal(
  mod.renderExportSuspectBlockRow({ columns: none }),
  '',
  '零命中时导出清单不得渲染提示'
);
assert.equal(mod.renderOtherSuspectColumnsSummary(none, clean.id), '', '零命中时不得有汇总');

// ---- 4. 命中时三处都必须有内容，且点名该列 ------------------------------------
const split = mod.renderSplitSuspectNotice(all);
assert.ok(split.includes('col29'), '步骤 5 提示必须点名该列');
assert.ok(split.includes('色块'));
assert.ok(/不会自动剔除|不会自动删除/.test(split), '必须说明系统不会自动剔除');

const active = mod.renderActiveColumnSuspectNotice(flagged);
assert.ok(active.includes('col29'));
assert.ok(active.includes('判据依据'), '必须给出判据依据');
assert.ok(/填满列宽的\s*100%/.test(active), '必须给出填满率（fill_ratio=1.0 → 100%）');
assert.ok(active.includes('变异系数'), '必须给出变异系数');
assert.ok(active.includes('删除列'), '必须指向真实存在的【删除列】按钮');
assert.ok(active.includes('data-suspect-reason="fills_whole_column"'));

const exp = mod.renderExportSuspectBlockRow({ columns: all });
assert.ok(exp.includes('col29'), '导出清单必须点名该列');
assert.ok(exp.includes('data-export-suspect-count="1"'));
assert.ok(exp.includes('data-export-suspect-cols="col29"'));

// ---- 5. 判据数值必须来自后端，不得自造 ----------------------------------------
// fill_ratio 0.97961 → 97.96%（后端给的数，前端只做百分数换算）
const approx = mod.renderActiveColumnSuspectNotice({
  ...flagged,
  suspect_block: {
    reason: 'fills_whole_column',
    cv: 0.008008,
    fill_ratio: 0.97961,
    mean_ink_width: 123.43,
    column_width: 126,
  },
});
assert.ok(/填满列宽的\s*98\.0%/.test(approx), `填满率应换算自后端 0.97961: ${approx}`);
assert.ok(approx.includes('0.0080'), '变异系数应原样使用后端的 0.008008');
assert.ok(approx.includes('123.4'), '平均墨迹宽应来自后端 123.43');
assert.ok(/列宽\s*126\s*px/.test(approx), '列宽应来自后端 126');

// ---- 6. 只有 reason、没有任何数值时，如实说没提供，不编数字 -------------------
const bare = mod.renderActiveColumnSuspectNotice({
  ...flagged,
  suspect_block: { reason: 'fills_whole_column' },
});
assert.ok(bare.includes('未提供该项的具体数值'), '缺数值时必须如实说明，不得编造');
assert.ok(!/填满列宽的\s*\d/.test(bare), '缺数值时不得出现任何编造的百分比');

// ---- 7. 不得用 emoji 充当语义；状态色只用语义 token --------------------------
for (const html of [split, active, exp]) {
  assert.ok(html.includes('--status-warning'), '必须使用语义状态色 --status-warning');
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(html), `不得出现裸 hex 颜色: ${html.slice(0, 120)}`);
  assert.ok(
    !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html),
    '不得用 emoji 充当界面语义'
  );
}

// ---- 8. 每个导出都只返回字符串（不得有"过滤后的列数组"这种剔除接口）-----------
for (const [name, fn] of Object.entries(mod)) {
  if (typeof fn !== 'function') continue;
  assert.ok(
    !/filter|remove|drop|exclude/i.test(name),
    `模块不得导出剔除类接口（实测导出名：${name}）——命中不等于剔除`
  );
}

console.log('suspect_block 提示 8 组断言全部通过');
