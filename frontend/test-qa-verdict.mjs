/**
 * QA 判定与多分区聚合的**单元判据**（node --experimental-strip-types 直接跑 TS 源）。
 *
 * 为什么要有这一层：`computeQaVerdict` / `aggregateQaScope` 是纯函数，而它们守的是
 * "全绿陷阱"这一类**结论层错误**——产物、UI、后端都对，只有结论撒谎。E2E 里搭建
 * "真·空集"现场很贵（要清会话状态、控制点、层位），而判定本身的边界（空集 / 缺值 /
 * 未标定 / 超标优先级）用纯函数测更稳、更快、且不依赖任何场景构造。
 *
 * 判据清单（每条都对应过一次真实缺陷）：
 * 1. 空集（nChecked = 0）**不得**判通过 —— 曾经守卫被金丝雀注掉后 `if (false && …)`，
 *    `999999 >= 85 && 0 <= 115` 恒真，0 层位质检也报「门禁通过」。
 * 2. `maxSum === null` 表示"不知道"，不得当成 0 参与判定。
 * 3. 超标（nOverHorizons > 0）必须优先于"未标定"报红。
 * 4. 有未标定列时至多是黄，不得绿。
 * 5. 聚合必须覆盖**所有**有列分区：任一分区超标 ⇒ 红；范围文案必须点名分区。
 */
import assert from 'node:assert/strict';
import {
  aggregateHeadline,
  aggregateQaScope,
  computeQaVerdict,
} from './src/core/qaVerdict.ts';

const TOL = 2.0;

function part(name, summary) {
  return { roiId: name, roiName: name, summary };
}

let n = 0;
function check(label, fn) {
  fn();
  n += 1;
  console.log(`ok ${n} - ${label}`);
}

// ---- 1. 空集：无任何被检层位 ⇒ 黄，且文案必须说"无可校验层位" ----
check('空集不得判通过（nChecked = 0 ⇒ yellow）', () => {
  const v = computeQaVerdict({
    nOverHorizons: 0,
    maxSum: null,
    tolerance: TOL,
    nUncalibrated: 0,
    nChecked: 0,
  });
  assert.equal(v.level, 'yellow');
  assert.match(v.headline, /无可校验层位/);
});

// ---- 2. maxSum = null 是"不知道"，不是 0 ----
check('maxSum 为 null 时不得据此判绿（nChecked>0 且无越限才可能绿）', () => {
  const yellow = computeQaVerdict({
    nOverHorizons: 0,
    maxSum: null,
    tolerance: TOL,
    nUncalibrated: 1,
    nChecked: 6,
  });
  assert.equal(yellow.level, 'yellow');
});

// ---- 3. 超标优先于未标定 ----
check('超标必须优先报红（不被"未标定"掩盖）', () => {
  const v = computeQaVerdict({
    nOverHorizons: 6,
    maxSum: 103.2,
    tolerance: TOL,
    nUncalibrated: 3,
    nChecked: 6,
  });
  assert.equal(v.level, 'red');
  assert.match(v.headline, /超标/);
});

// ---- 4. 未标定 ⇒ 黄，不得绿 ----
check('存在未标定列时不得判绿', () => {
  const v = computeQaVerdict({
    nOverHorizons: 0,
    maxSum: 96,
    tolerance: TOL,
    nUncalibrated: 4,
    nChecked: 6,
  });
  assert.equal(v.level, 'yellow');
});

// ---- 5. 聚合：任一分区超标 ⇒ 红；范围文案点名分区 ----
check('聚合覆盖所有有列分区：脏分区的超标必须被计入并判红', () => {
  const agg = aggregateQaScope(
    [
      part('dirty', {
        n_horizons: 6,
        n_horizons_with_data: 6,
        n_horizons_empty: 0,
        violations_over: [1, 2, 3, 4, 5, 6],
        sum: { max: 103.2 },
        n_uncalibrated: 0,
      }),
      part('clean', {
        n_horizons: 6,
        n_horizons_with_data: 6,
        n_horizons_empty: 0,
        violations_over: [],
        sum: { max: 96 },
        n_uncalibrated: 0,
      }),
    ],
    [],
    TOL
  );
  assert.equal(agg.level, 'red');
  assert.equal(agg.nOverHorizons, 6);
  assert.equal(agg.nChecked, 12);
  const headline = aggregateHeadline(agg);
  assert.match(headline, /已校验 2 个分区/);
  assert.match(headline, /dirty/);
  assert.match(headline, /clean/);
});

// ---- 6. 聚合：所有分区都合格 ⇒ 绿（防"永远红"） ----
check('聚合：所有分区都合格时才判绿', () => {
  const agg = aggregateQaScope(
    [
      part('a', {
        n_horizons: 6,
        n_horizons_with_data: 6,
        n_horizons_empty: 0,
        violations_over: [],
        sum: { max: 96 },
        n_uncalibrated: 0,
      }),
      part('b', {
        n_horizons: 6,
        n_horizons_with_data: 6,
        n_horizons_empty: 0,
        violations_over: [],
        sum: { max: 97 },
        n_uncalibrated: 0,
      }),
    ],
    [],
    TOL
  );
  assert.equal(agg.level, 'green');
});

// ---- 7. 聚合：所有分区都是空集 ⇒ 黄（不是绿） ----
check('聚合：所有分区 0 层位 ⇒ 黄「无可校验层位」', () => {
  const agg = aggregateQaScope(
    [
      part('a', { n_horizons: 3, n_horizons_with_data: 0, n_horizons_empty: 3 }),
      part('b', { n_horizons: 3, n_horizons_with_data: 0, n_horizons_empty: 3 }),
    ],
    [],
    TOL
  );
  assert.equal(agg.nChecked, 0);
  assert.equal(agg.level, 'yellow');
  assert.match(aggregateHeadline(agg), /无可校验层位/);
});

// ---- 8. 没有有列分区 ⇒ 文案不得宣称"已校验 N 个分区" ----
check('没有可校验分区时，范围文案必须说清（不得伪造已校验）', () => {
  const agg = aggregateQaScope([], [part('empty', {})], TOL);
  const headline = aggregateHeadline(agg);
  assert.doesNotMatch(headline, /已校验 \d+ 个分区/);
  assert.match(headline, /没有可校验的分区|跳过 1 个无列分区/);
});

console.log(`\nqa-verdict: ${n} checks passed`);
