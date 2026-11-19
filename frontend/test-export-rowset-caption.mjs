// 导出面板标题必须说清「这一行集是什么」，且**只能**从后端 `rowset` 取（issue #113 / #100）。
//
// ## 缺陷本体（2026-11-19 现场）
//
// `straditize_project_1795007270385.tar`：`samples=0`，ROI `ylim=[239, 864)`，19 列数字化后
// 逐行点并集 = **625 行**（行号连续 239..863，首行 depth `-0.058`）。面板原来按 dataset 名
// 写死 `ROWSET_SOURCE.samples = '按共识层位（samples）'`，于是 625 个**像素行**被标成
// 「共识层位」——用户自然读成"625 个样品"。
//
// ## 判据
//
// 1. `samples=0`（`provenance="pixel_rows"`）→ 标题含「像素行」「不是样品层位」，且转警告色；
// 2. `samples` 非空（`provenance="samples"`）→ 标题含「样品层位」，不警告；
// 3. 拿不到身份 → 中性文案（「按当前数据集」），**不得**出现「共识层位 / 样品」这类猜测；
// 4. 质量指标块给出 层位数 / 支持列数中位 / 容差，缺失写 `—` 而不是 0；
// 5. 源码级：`ExportModal.ts` 不再引用 `ROWSET_SOURCE`，且真的调 `export.getReadiness`。
//
// ## 反向验证
//
// * 把 `buildRowSetCaption` 改回 `${dataset} 名 → 固定文案` → 判据 1 变红；
// * 把 `warning` 恒置 false → 判据 1 的 `warning === true` 变红；
// * 把 `NEUTRAL_SOURCE` 换成「按共识层位」→ 判据 3 变红；
// * 在 `ExportModal.ts` 里把 `ROWSET_SOURCE` 加回来 → 判据 5 变红。
//
// 运行（必须在 frontend/ 目录，否则相对导入 `./src` 会 ENOENT）：
//   node --experimental-strip-types test-export-rowset-caption.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const { buildRowSetCaption, buildRowSetQualityHint } = await import(
  './src/components/exportRowSetCaption.ts'
);

/** 现场身份：625 个像素行（samples 为空）。 */
const PIXEL_ROWS = {
  dataset: 'samples',
  provenance: 'pixel_rows',
  is_sample_rows: false,
  rows_count: 625,
  samples_count: 0,
  label: '逐列数字化的像素行并集（625 行，不是样品层位）',
  why: '未设样品层位（samples 为空）：行取自这些列逐行数字化点的像素行并集……',
  quality: {
    rows: 625,
    samples: 0,
    support_columns_median: 19,
    support_columns_min: 1,
    support_columns_max: 19,
    support_columns_n: 625,
    support_columns_source: 'column_points',
    tolerance_px: null,
    default_tolerance_px: 2.5,
    roi_height_px: 625,
    rows_equal_roi_height: true,
  },
};

/** 对照：真样品层位（`.recon_20261117`，203 条，生成于 #83 之前 → 无支持列数）。 */
const SAMPLES = {
  dataset: 'samples',
  provenance: 'samples',
  is_sample_rows: true,
  rows_count: 203,
  samples_count: 203,
  label: '样品层位（samples，203 条）',
  why: '用户设定了 203 个样品层位（步骤 7）……',
  quality: {
    rows: 203,
    samples: 203,
    support_columns_median: null,
    support_columns_min: null,
    support_columns_max: null,
    support_columns_n: 0,
    support_columns_source: null,
    tolerance_px: null,
    default_tolerance_px: 2.5,
    roi_height_px: 1520,
    rows_equal_roi_height: false,
  },
};

// ---- 判据 1：像素行必须被说成像素行 -----------------------------------------
const pixelCaption = buildRowSetCaption(PIXEL_ROWS, 625);
assert.ok(
  pixelCaption.text.includes('像素行'),
  `samples 为空时标题必须出现「像素行」，实得：${pixelCaption.text}`
);
assert.ok(
  pixelCaption.text.includes('不是样品层位'),
  `标题必须说清「不是样品层位」，实得：${pixelCaption.text}`
);
assert.ok(
  !pixelCaption.text.includes('按共识层位'),
  `标题不得出现「按共识层位」（那正是 issue #100 的误标），实得：${pixelCaption.text}`
);
assert.ok(
  pixelCaption.text.includes('当前表 625 行'),
  `标题里的行数必须与表面一致，实得：${pixelCaption.text}`
);
assert.equal(pixelCaption.warning, true, 'samples 为空时必须用警告色');

// ---- 判据 2：真样品层位不警告 ----------------------------------------------
const samplesCaption = buildRowSetCaption(SAMPLES, 203);
assert.ok(
  samplesCaption.text.includes('样品层位'),
  `有层位时标题应含「样品层位」，实得：${samplesCaption.text}`
);
assert.equal(samplesCaption.warning, false, '真样品层位不应报警');

// ---- 判据 3：拿不到身份时保持中性，不猜 ------------------------------
for (const missing of [null, undefined, {}, { label: '' }]) {
  const caption = buildRowSetCaption(missing, 12);
  assert.ok(
    caption.text.includes('按当前数据集'),
    `无身份时必须回落中性文案，实得：${caption.text}`
  );
  assert.ok(!caption.text.includes('共识层位'), `无身份时不得猜「共识层位」：${caption.text}`);
  assert.ok(!caption.text.includes('样品'), `无身份时不得猜「样品」：${caption.text}`);
  assert.equal(caption.warning, false, '无身份时不报警（不误报）');
  assert.ok(caption.text.includes('12 行'), `无身份时仍要报行数：${caption.text}`);
}

// ---- 判据 4：质量指标块 ----------------------------------------------------
const hint = buildRowSetQualityHint(PIXEL_ROWS);
assert.ok(hint.includes('层位 625 行'), hint);
assert.ok(hint.includes('支持列数中位 19'), hint);
assert.ok(hint.includes('1..19'), `应给出支持列数区间，实得：${hint}`);
assert.ok(hint.includes('n=625'), hint);
assert.ok(hint.includes('tolerance_px 未记录'), `容差未知必须写「未记录」：${hint}`);
assert.ok(hint.includes('默认 2.5'), `必须给出"重跑会用多少"：${hint}`);
assert.ok(hint.includes('等于 ROI 高度'), `行数==ROI 高度必须点明：${hint}`);

const samplesHint = buildRowSetQualityHint(SAMPLES);
assert.ok(
  samplesHint.includes('支持列数中位 —'),
  '缺失的支持列数必须写 — 而不是 0：' + samplesHint
);
assert.ok(samplesHint.includes('n=0'), `应报有多少行带该信息：${samplesHint}`);
assert.ok(!samplesHint.includes('等于 ROI 高度'), `203 行不等于 ROI 高度，不应点明：${samplesHint}`);
assert.equal(buildRowSetQualityHint(null), '', '无身份时不显示质量行');
assert.equal(buildRowSetQualityHint({}), '', '无 quality 时不显示质量行');

// ---- 判据 5：面板源码不再自带同义词表，且真的问后端 ----------------------
const modalSource = readFileSync('./src/components/ExportModal.ts', 'utf8');
assert.ok(
  !/const\s+ROWSET_SOURCE/.test(modalSource),
  'ExportModal.ts 不得再声明 ROWSET_SOURCE（按 dataset 名写死来源 = issue #100 的成因）'
);
assert.ok(
  modalSource.includes("'export.getReadiness'"),
  'ExportModal.ts 必须向 export.getReadiness 取 rowset 身份'
);
assert.ok(
  modalSource.includes('buildRowSetCaption'),
  'ExportModal.ts 必须用 buildRowSetCaption 生成标题'
);
assert.ok(
  !/按共识层位（samples）/.test(modalSource),
  'ExportModal.ts 不得残留写死的「按共识层位（samples）」文案'
);

console.log('export row-set caption: 5/5 判据通过');
