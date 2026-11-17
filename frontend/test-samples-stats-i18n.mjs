// 步骤 7 的层位来源统计必须走 i18n：原先硬编码 `Auto: 207 | Paste: 0 | Manual: 0`，
// 而同一面板其余文案都是中文，形成中英混排。
//
// 判别力（反向验证）：
//   * 把 SamplesPanel 改回硬编码英文 → "面板必须引用该键"一条变红；
//   * 把键里的 `{auto}` 等占位符删掉 → 渲染断言变红（数字缺失）；
//   * 中文键写成英文标签 → "中文界面不得含英文标签"一条变红。
//
// 判据强度说明：本文件直接断言**两份词典的模板串与占位符替换结果**。
// 不 import `src/i18n/index.ts` 是因为它内部用无扩展名的相对导入（`./locales/zh-CN`），
// node 的 type-stripping 解析不了；`t()` 的拼接逻辑只有 3 行，且被 e2e 覆盖，
// 这里替换规则与它逐字一致（`{name}` → 值）。
//
// 运行：node --experimental-strip-types test-samples-stats-i18n.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const { zhCN } = await import('./src/i18n/locales/zh-CN.ts');
const { en } = await import('./src/i18n/locales/en.ts');

const PARAMS = { auto: 207, paste: 0, manual: 3, grid: 41 };

/** 与 `i18n/index.ts::t()` 同一替换规则：`{name}` → 值。 */
function render(template, params) {
  let text = template;
  for (const [name, value] of Object.entries(params)) {
    text = text.split('{' + name + '}').join(String(value));
  }
  return text;
}

const KEY = 'step7.samplesStats';
assert.ok(zhCN[KEY], `中文词典缺少 ${KEY}`);
assert.ok(en[KEY], `英文词典缺少 ${KEY}`);

const zh = render(zhCN[KEY], PARAMS);
assert.equal(zh, '自动 207 | 粘贴 0 | 手动 3 | 网格 41');
assert.ok(!zh.includes('{'), `渲染后不得残留占位符：${zh}`);
// 中文界面里不应再出现英文标签（原缺陷就是这个）
assert.ok(!/Auto|Paste|Manual|Grid/.test(zh), `中文界面混入了英文：${zh}`);

const english = render(en[KEY], PARAMS);
assert.equal(english, 'Auto 207 | Paste 0 | Manual 3 | Grid 41');
assert.ok(!english.includes('{'));

// 存在性判据（弱一档）：只保证面板仍在用这个键，不保证渲染位置
const panel = readFileSync(
  new URL('./src/components/steps/SamplesPanel.ts', import.meta.url),
  'utf8'
);
assert.ok(
  panel.includes(`t('${KEY}'`),
  "SamplesPanel 必须通过 t('step7.samplesStats') 渲染统计行"
);

console.log('OK：层位来源统计走 i18n（中英各一条渲染断言 + 面板引用检查）');
