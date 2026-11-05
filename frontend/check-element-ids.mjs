/**
 * 元素 id 门禁：**代码里用到的 id，必须在某处被创建**。
 *
 * ## 为什么不是 e2e
 *
 * 全部 400+ 个 id 里绝大多数在按需弹窗内（年代模型、元数据、导出、OCR、设置……），
 * 页面上根本不存在，直到用户打开那个弹窗。用 e2e 断言「必须可见」会把这些全判红；
 * 逐个打开弹窗又变成几十条脆弱用例。而这类缺陷的本质是**静态**的：
 * 代码 querySelector 一个 id，模板里却没有它——扫描源码就能抓，且覆盖全部 id。
 *
 * ## 它要钉住的真实事故
 *
 * `#select-image-mode`：Toolbar 反复 querySelector 取值、绑 change，模板里从来没有
 * 这个元素。于是「高对比度」既无快捷键（KeyC 那条不可达）也无 UI 入口，
 * 功能等于不存在，而所有测试全绿。
 *
 * ## 豁免怎么加
 *
 * 只允许两种情况写进 ALLOW_MISSING：① id 由动态字符串拼出（模板插值），
 * 正则无法静态识别；② 由第三方/浏览器注入。每条都要写原因。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('./src/', import.meta.url).pathname.replace(/^\//, '');

/** 允许「被引用但静态找不到创建点」的 id，必须写原因。 */
const ALLOW_MISSING = new Map([
  ['app', 'frontend/index.html 的挂载点，不在 src/ 扫描范围内'],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
const referenced = new Map(); // id -> file
const defined = new Set();

const REF_SEL = /querySelector(?:All)?(?:<[^>]*>)?\(\s*['"]#([A-Za-z][\w-]*)/g;
const REF_GET = /getElementById\(\s*['"]([A-Za-z][\w-]*)['"]/g;
const DEF_ID = /\bid\s*=\s*['"]([A-Za-z][\w-]*)['"]/g;

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const re of [REF_SEL, REF_GET]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) referenced.set(m[1], f.replace(/\\/g, '/'));
  }
  DEF_ID.lastIndex = 0;
  let d;
  while ((d = DEF_ID.exec(src))) defined.add(d[1]);
}

const missing = [...referenced.entries()]
  .filter(([id]) => !defined.has(id) && !ALLOW_MISSING.has(id))
  .map(([id, file]) => `${id}  ← ${file}`);

if (missing.length > 0) {
  console.error('✘ 有 id 被代码引用，却找不到任何创建点（模板/createElement 里都没有）：');
  for (const line of missing) console.error('   ' + line);
  console.error('');
  console.error('这类缺陷的表现是「功能点了没反应」，而所有测试仍全绿。');
  console.error('若该 id 由动态字符串拼出，请把原因写进 ALLOW_MISSING。');
  process.exit(1);
}

console.log(`✔ 元素 id 门禁通过：${referenced.size} 个引用 id 均有创建点`);
