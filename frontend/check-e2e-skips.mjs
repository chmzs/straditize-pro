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
 *
 * ## 第二条门禁：e2e 不得自带 `QaSummary`
 *
 * `qa.summarize` 的返回形状只有一份定义：`src/types/pollen.ts::QaSummary`。
 * `qa.spec.ts` 与 `qa-scope-multi-roi.spec.ts` 曾各自声明一份同名的本地接口，
 * 而 `tsc` 两边都能过（两份各自自洽），于是契约漂移**没有任何一层会红**：
 * 后端加字段、真实契约收紧，e2e 那份仍旧宽/仍旧缺字段，测试继续"通过"。
 * 这与 issue #16/#17 清掉的 `src` 内分叉同形，只是位置在 `e2e/`，因此需要一条
 * 独立门禁——`tsconfig.json` 的 `include` 只有 `src`，构建门禁根本看不到这几个文件。
 *
 * 确需"只填一部分字段"的本地变体时，**改名**（如 `QaSummaryStub`）并在注释里
 * 写清它与真实契约的关系：名字不同，就不会被误当成同一个契约的两份副本。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('./e2e/', import.meta.url).pathname.replace(/^\//, '');
const UNCONDITIONAL = /test\.(?:fixme|skip)\(\s*true\b/g;
const ANY_SKIP = /test\.skip\(/g;
/** e2e 内任何 `interface QaSummary` / `type QaSummary` 声明（`QaSummaryStub` 不匹配）。 */
const LOCAL_QA_SUMMARY = /^[ \t]*(?:export[ \t]+)?(?:interface|type)[ \t]+QaSummary\b/gm;

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

const localQaSummary = [];
for (const rel of readdirSync(DIR, { recursive: true, encoding: 'utf8' })) {
  const relPath = rel.replace(/\\/g, '/');
  if (!relPath.endsWith('.ts')) continue;
  const src = readFileSync(join(DIR, relPath), 'utf8');
  LOCAL_QA_SUMMARY.lastIndex = 0;
  let hit;
  while ((hit = LOCAL_QA_SUMMARY.exec(src))) {
    localQaSummary.push(relPath + ':' + src.slice(0, hit.index).split('\n').length);
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

if (localQaSummary.length > 0) {
  console.error('✘ e2e 目录不得声明名为 QaSummary 的本地接口：');
  for (const o of localQaSummary) console.error('   ' + o);
  console.error('');
  console.error(
    '请 import type { QaSummary } from \'../src/types/pollen\'；确需部分字段的变体请改名（如 QaSummaryStub）并在注释里写明与真实契约的关系。'
  );
  process.exit(1);
}

console.log('✔ E2E 下线门禁通过：无无条件 skip/fixme');
console.log('✔ E2E 契约门禁通过：无本地 QaSummary 声明');
