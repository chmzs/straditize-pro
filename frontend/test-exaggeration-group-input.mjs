/**
 * 组级放大倍数：输入的归一、列级被组覆盖的判定、图上/真实量程换算（判据 5–7）。
 *
 * 被测对象是 `src/components/steps/exaggerationGroupInput.ts` 里的纯函数 —— UI 用的是
 * 同一份，不是副本；提示文案取自**上线的那份字典**（zh-CN + en 同时校验存在）。
 *
 * 反向验证：
 *  - 把 `isColumnExagDisabled` 改成恒 `false`（= 列级仍可编辑）→ 判据 6 红；
 *  - 把 `exaggerationRange` 里的 `onFigure / factor` 改成 `* factor` → 判据 7 红。
 */
import assert from 'node:assert/strict';

import {
  COLUMN_EXAG_OVERRIDDEN_KEY,
  MAX_GROUP_EXAGGERATION,
  columnExagNotice,
  exaggerationRange,
  isColumnExagDisabled,
  isGroupExaggerated,
  normalizeGroupExaggeration,
} from './src/components/steps/exaggerationGroupInput.ts';
import { zhCN } from './src/i18n/locales/zh-CN.ts';
import { en } from './src/i18n/locales/en.ts';

/** 用**真实字典**实现的 translate：测的就是上线那段文案。 */
const translateWith = (dict) => (key, params) => {
  const template = dict[key];
  assert.ok(typeof template === 'string' && template.length > 0, '字典缺 key: ' + key);
  let text = template;
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.split('{' + name + '}').join(String(value));
  }
  return text;
};

// ---------------------------------------------------------------------------
// 判据 5：输入 → 写库值（空/0/1 = 未放大 → null；5 → 5）
// ---------------------------------------------------------------------------

const normalizationCases = [
  [null, null, 'null（清除）'],
  [undefined, null, 'undefined'],
  ['', null, '空串（清空输入框）'],
  ['   ', null, '纯空白'],
  [0, null, '0（未放大）'],
  [1, null, '1（未放大）'],
  ['1', null, '字符串 "1"'],
  ['0.5', null, '0.5（小于 1 不是放大）'],
  [NaN, null, 'NaN'],
  ['abc', null, '非数字文本'],
  [MAX_GROUP_EXAGGERATION + 1, null, '超出上限（非法，由 UI 拦截提示）'],
  [5, 5, '5'],
  ['5', 5, '字符串 "5"'],
  [3, 3, '3'],
  [10, 10, '10'],
  [2.5, 2.5, '2.5（非整数倍率合法）'],
];

for (const [input, expected, label] of normalizationCases) {
  assert.equal(
    normalizeGroupExaggeration(input),
    expected,
    '判据5 · ' + label + ' 应为 ' + String(expected) + '，实际 ' + String(normalizeGroupExaggeration(input))
  );
}

// 写库语义：只有 >1 才真的要写一个数；其余一律发 null（清除）。
assert.equal(normalizeGroupExaggeration(1), null, '判据5 · 1 必须发 null，不能写 1 让后端以为设过了');
assert.equal(normalizeGroupExaggeration(5), 5, '判据5 · 5 必须原样发出');

// ---------------------------------------------------------------------------
// 判据 6：组倍率 >1 → 列级输入置灰，提示含组级倍数
// ---------------------------------------------------------------------------

assert.equal(isColumnExagDisabled(5), true, '判据6 · 组 5× 时列级输入必须置灰');
assert.equal(isColumnExagDisabled(3), true, '判据6 · 组 3× 同理');
assert.equal(isColumnExagDisabled(null), false, '判据6 · 组未放大时列级仍可编辑');
assert.equal(isColumnExagDisabled(undefined), false, '判据6 · 组字段缺失时列级仍可编辑');
assert.equal(isColumnExagDisabled(1), false, '判据6 · 组 1× 等于未放大，列级仍可编辑');
assert.equal(isGroupExaggerated(5), true, 'isGroupExaggerated(5)');
assert.equal(isGroupExaggerated(1), false, 'isGroupExaggerated(1)');

const zhNotice = columnExagNotice(5, translateWith(zhCN));
assert.ok(zhNotice.includes('5'), '判据6 · 中文提示必须写明组级倍数，实际：' + zhNotice);
assert.ok(zhNotice.includes('组级'), '判据6 · 中文提示必须点明"组级为准"，实际：' + zhNotice);
assert.ok(zhNotice.includes('列级'), '判据6 · 中文提示必须点明"列级已忽略"，实际：' + zhNotice);

const enNotice = columnExagNotice(5, translateWith(en));
assert.ok(enNotice.includes('5'), '判据6 · 英文提示必须写明组级倍数，实际：' + enNotice);
assert.ok(/group/i.test(enNotice), '判据6 · 英文提示必须点明 group，实际：' + enNotice);

// 组未放大时不出提示（否则每列都挂一句无意义的警告）。
assert.equal(columnExagNotice(null, translateWith(zhCN)), '', '判据6 · 组未放大时不出提示');

// key 中英双语都在（en.ts 的 `satisfies Record<MessageKey, string>` 已经在 tsc 层拦，
// 这条是运行期的第二道保险）。
assert.ok(zhCN[COLUMN_EXAG_OVERRIDDEN_KEY], '判据6 · 中文缺 ' + COLUMN_EXAG_OVERRIDDEN_KEY);
assert.ok(en[COLUMN_EXAG_OVERRIDDEN_KEY], '判据6 · 英文缺 ' + COLUMN_EXAG_OVERRIDDEN_KEY);

// ---------------------------------------------------------------------------
// 判据 7：图上满刻度 = 真实量程 × 倍率
//   斜率 0.2381 %/px、列宽 60px、倍率 5 → 图上 14.286 / 真实 2.857
// ---------------------------------------------------------------------------

const range = exaggerationRange(0.2381, 60, 5);
assert.ok(range, '判据7 · 倍率 5 且有斜率/列宽时必须给出换算');
assert.ok(
  Math.abs(range.onFigure - 14.286) < 1e-3,
  '判据7 · 图上满刻度应为 14.286，实际 ' + range.onFigure
);
assert.ok(
  Math.abs(range.real - 2.857) < 1e-3,
  '判据7 · 真实量程应为 2.857，实际 ' + range.real
);
// 结构性关系（比取整更硬）：真实 = 图上 ÷ 倍率，图上 = 斜率 × 列宽。
assert.equal(range.real, range.onFigure / 5, '判据7 · 真实量程必须等于图上 ÷ 倍率');
assert.equal(range.onFigure, 0.2381 * 60, '判据7 · 图上满刻度必须等于斜率 × 列宽');
// 倍率是除数不是乘数：×5 会把量程放大到 71.43，那是双重折算的典型错法。
assert.ok(range.real < range.onFigure, '判据7 · 真实量程必须小于图上量程（放大过的列画得更高）');

// 没有可用输入时不编数：倍率未放大 / 斜率缺失 / 列宽非正 一律 null。
assert.equal(exaggerationRange(0.2381, 60, null), null, '判据7 · 组未放大时不显示该行');
assert.equal(exaggerationRange(0.2381, 60, 1), null, '判据7 · 倍率 1 不显示该行');
assert.equal(exaggerationRange(null, 60, 5), null, '判据7 · 未标定（无斜率）时不显示该行');
assert.equal(exaggerationRange(0.2381, 0, 5), null, '判据7 · 列宽为 0 时不显示该行');

console.log(
  'test-exaggeration-group-input: OK（判据5：' +
    normalizationCases.length +
    ' 例归一 + 判据6：置灰/提示 + 判据7：图上14.286 → 真实2.857）'
);
