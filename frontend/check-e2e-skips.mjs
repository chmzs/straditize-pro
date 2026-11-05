/**
 * E2E 下线门禁：禁止**无条件**跳过用例（test.fixme(true) / test.skip(true)）。
 *
 * ## 为什么要机械拦
 *
 * step6-xticks.spec.ts 曾整文件 6 条全部 test.fixme(true)：它们断言的是已删除的
 * 「单列两点标定」控件。结果是死代码从此隐形——面板里 7 处绑到不存在元素上的
 * handler 活了两轮无人发现，最后靠元素 id 门禁才抓出来。
 *
 * 正确处置只有两种：功能删了就删测试；判据还成立就按新契约重写。
 * 「待重写 + fixme」不是中间态，是遗忘。
 *
 * 条件性 skip（test.skip(cond, reason)）允许：它表达的是当前环境缺前置，
 * 而不是「这条不打算跑」；但仍要求带 reason 字符串（允许跨行书写）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('./e2e/', import.meta.url).pathname.replace(/^\//, '');
const UNCONDITIONAL = /test\.(?:fixme|skip)\(\s*true\b/g;
const ANY_SKIP = /test\.skip\(/g;

const offenders = [];
const reasonless = [];

for (const name of readdirSync(DIR)) {
  if (!name.endsWith('.spec.ts')) continue;
  const src = readFileSync(join(DIR, name), 'utf8');
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;

  UNCONDITIONAL.lastIndex = 0;
  let m;
  while ((m = UNCONDITIONAL.exec(src))) {
    offenders.push(name + ':' + lineOf(m.index) + '  ' + m[0]);
  }

  // 条件性 skip 必须带 reason 字符串：取其后的片段（允许跨行）检查引号
  ANY_SKIP.lastIndex = 0;
  while ((m = ANY_SKIP.exec(src))) {
    const snippet = src.slice(m.index, m.index + 400);
    if (UNCONDITIONAL.test(snippet)) { UNCONDITIONAL.lastIndex = 0; continue; }
    UNCONDITIONAL.lastIndex = 0;
    const callEnd = snippet.indexOf('\n  );');
    const call = callEnd > 0 ? snippet.slice(0, callEnd) : snippet;
    if (!/['"]/.test(call)) reasonless.push(name + ':' + lineOf(m.index));
  }
}

if (offenders.length > 0) {
  console.error('✘ 存在无条件下线的用例（test.fixme(true) / test.skip(true)）：');
  for (const o of offenders) console.error('   ' + o);
  console.error('');
  console.error('功能删了就删测试；判据还成立就按新契约重写。禁止长期挂在 fixme 上。');
  process.exit(1);
}
if (reasonless.length > 0) {
  console.error('✘ 条件性 skip 必须带 reason 字符串：');
  for (const o of reasonless) console.error('   ' + o);
  process.exit(1);
}

console.log('✔ E2E 下线门禁通过：无无条件 skip/fixme');
