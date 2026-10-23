// 真实模块测试：直接 import src/components/ocr/OcrMatchNotice.ts 的纯函数。
//
// 为什么这条判据放在这里而不是 Playwright 里：
// 「配对成功时不得出现提示」这个反向对照，在真实后端上**找不到样本**——实测两张
// 内置图都是 matched=false（fig3 22 列/22 标签、hoya 28 列/30 标签）。在后端没有
// 成功样本的情况下，唯一诚实的做法是：拿**构造的载荷**去喂真实渲染函数，断言
// matched=true → 空串、matched=false → 有内容。两者都跑同一个函数，所以"空串"
// 不可能是因为函数压根不渲染。
//
// 运行：node --experimental-strip-types test-ocr-match-notice.mjs
import assert from 'node:assert';

const { computeOcrMatchNotice, renderOcrMatchNotice } = await import(
  './src/components/ocr/OcrMatchNotice.ts'
);

console.log('--- 运行 OCR 配对提示 真实模块测试 ---');

const labels = [{ id: 'label_001' }, { id: 'label_002' }];

// ---- 1. 配对成功 → 不提示（反向对照）--------------------------------------
const success = computeOcrMatchNotice(
  { matched: true, ambiguous: [], assigned: { label_001: 'roi_1_col01' } },
  labels,
  0
);
assert.equal(success.visible, false, 'matched=true 时不得显示提示');
assert.equal(renderOcrMatchNotice(success), '', 'matched=true 时必须渲染空串');

// ---- 2. 配对失败 → 必须提示，且文案说清三件事 -------------------------------
const failed = computeOcrMatchNotice(
  { matched: false, ambiguous: ['a', 'b', 'c'], assigned: {} },
  labels,
  2
);
assert.equal(failed.visible, true, 'matched=false 时必须有提示');
const html = renderOcrMatchNotice(failed);
assert.ok(html.includes('未能全部自动对应到列'), '文案必须说明没自动对上');
assert.ok(html.includes('识别到 <strong>2</strong> 个标签'), '文案必须报出识别到的标签数');
assert.ok(html.includes('3 个标签落在列边界上'), '文案必须报出歧义标签数');
assert.ok(html.includes('<strong>2</strong> 列完全没有识别到标签'), '文案必须报出无标签列数');
assert.ok(html.includes('输入'), '文案必须给出手工填写这条路径');
assert.ok(html.includes('采纳'), '文案必须说明勾选框会自动启用');
assert.ok(html.includes('data-ocr-match="failed"'), '必须带可断言的判定属性');

// ---- 3. 没有识别到任何标签 → 不提示（那是另一条错误路径，不该被冒充）--------
const empty = computeOcrMatchNotice({ matched: false, ambiguous: [], assigned: {} }, [], 0);
assert.equal(empty.visible, false, '零标签时不得显示本提示');
assert.equal(renderOcrMatchNotice(empty), '', '零标签时必须渲染空串');

// ---- 4. reconciliation 缺失 → 视为未配对，仍要提示 -------------------------
const noRecon = computeOcrMatchNotice(undefined, labels, 1);
assert.equal(noRecon.visible, true, '后端没给 reconciliation 时也应提示（不能静默）');

// ---- 5. 状态色只用语义 token，不得出现裸 hex / emoji ------------------------
assert.ok(html.includes('--status-warning'), '必须使用语义状态色 --status-warning');
assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(html), `提示里不得出现裸 hex 颜色: ${html}`);
// 覆盖性 emoji 检测（BMP + 常见符号区）
assert.ok(
  !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html),
  '提示里不得用 emoji 充当语义'
);

console.log('✔ OCR 配对提示 5 组断言全部通过');
