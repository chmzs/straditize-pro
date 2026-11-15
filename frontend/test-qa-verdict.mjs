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

/**
 * 分区夹具。
 *
 * `columnCount` 是面板展示用的字段，`aggregateQaScope` / `aggregateHeadline`
 * 一行都不读（聚合只看 `summary.*` 与 `roiName`）。填 1 只是让对象满足
 * `QaScopePart` 的形状，不影响任何被断言的量。
 *
 * 参数类型是**完整的** `QaScopeSummary`，不是 `Partial`，出口处也不再需要类型断言：
 * `violations_over` 与 `sum.max` 是 `qa.summarize` **恒返回**的字段
 * （`straditize_core/qa.py:47,49` 的空集提前返回、`:149,151` 的正常返回都给了它们），
 * 所以夹具照契约给全，不会伪造任何被断言的量——空 ROI 的 `sum.max` 后端就是 `0.0`。
 *
 * "缺字段会怎样"不靠宽松夹具来代表，另有专门用例（第 9/10 条）钉住"必须抛错"。
 *
 * @param {string} name
 * @param {import('./src/core/qaVerdict.ts').QaScopeSummary} summary
 * @returns {import('./src/core/qaVerdict.ts').QaScopePart}
 */
function part(name, summary) {
  return { roiId: name, roiName: name, columnCount: 1, summary };
}

let n = 0;
/**
 * @param {string} label
 * @param {() => void} fn
 */
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
        empty_horizons: [],
        per_column_max: [],
        sum: { max: 103.2 },
        n_uncalibrated: 0,
      }),
      part('clean', {
        n_horizons: 6,
        n_horizons_with_data: 6,
        n_horizons_empty: 0,
        violations_over: [],
        empty_horizons: [],
        per_column_max: [],
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
        empty_horizons: [],
        per_column_max: [],
        sum: { max: 96 },
        n_uncalibrated: 0,
      }),
      part('b', {
        n_horizons: 6,
        n_horizons_with_data: 6,
        n_horizons_empty: 0,
        violations_over: [],
        empty_horizons: [],
        per_column_max: [],
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
      part('a', {
        n_horizons: 3,
        n_horizons_with_data: 0,
        n_horizons_empty: 3,
        violations_over: [],
        empty_horizons: [],
        per_column_max: [],
        sum: { max: 0 },
      }),
      part('b', {
        n_horizons: 3,
        n_horizons_with_data: 0,
        n_horizons_empty: 3,
        violations_over: [],
        empty_horizons: [],
        per_column_max: [],
        sum: { max: 0 },
      }),
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
  const agg = aggregateQaScope(
    [],
    [
      part('empty', {
        n_horizons: 0,
        n_horizons_with_data: 0,
        empty_horizons: [],
        per_column_max: [],
        violations_over: [],
        sum: { max: 0 },
      }),
    ],
    TOL
  );
  const headline = aggregateHeadline(agg);
  assert.doesNotMatch(headline, /已校验 \d+ 个分区/);
  assert.match(headline, /没有可校验的分区|跳过 1 个无列分区/);
});

/*
 * ---- 9/10. 契约：`violations_over` / `sum.max` 缺失必须**报错**，不得静默按 0 ----
 *
 * 为什么这两条必须存在：`aggregateQaScope` 收的是 `qa.summarize` 的返回值，而它
 * 从 HTTP 响应体解析而来，tsc 从未校验过。若实现对这些字段用 `?.`（缺失按 0 / null），
 * 一份缺 `violations_over` 的 payload 会得到 `nOverHorizons = 0`、缺 `sum` 会得到
 * `maxSum = null`，两条越限分支都被跳过 ⇒ 一路走到 **green「门禁通过」**。
 * 这正是本模块要防的"全绿陷阱"，只不过入口从"空集/哨兵"换成了"契约破损"。
 *
 * 造坏 payload 走 `JSON.parse` 是**故意**的，不是绕过类型检查的技巧：
 * 生产路径上的这份数据结构就是 JSON，tsc 不参与；要测的就是"运行时拿到坏 payload"。
 */

/**
 * @param {string} name
 * @param {string} rawSummaryJson 该分区 `summary` 的 JSON 文本（可以是坏契约）
 */
function partFromJson(name, rawSummaryJson) {
  return JSON.parse(
    `{"roiId":${JSON.stringify(name)},"roiName":${JSON.stringify(name)},` +
      `"columnCount":1,"summary":${rawSummaryJson}}`
  );
}

check('缺 summary.sum 必须抛错（不得被当成 maxSum = null 静默放行）', () => {
  const broken = partFromJson(
    'a',
    '{"n_horizons":6,"n_horizons_with_data":6,"violations_over":[],' +
      '"empty_horizons":[],"per_column_max":[]}'
  );
  assert.throws(
    () => aggregateQaScope([broken], [], TOL),
    /sum\.max/,
    '缺 summary.sum.max 时报错信息必须点名该字段'
  );
});

check('缺 summary.violations_over 必须抛错（不得被当成 0 个超标而判绿）', () => {
  const broken = partFromJson(
    'a',
    '{"n_horizons":6,"n_horizons_with_data":6,"sum":{"max":96},' +
      '"empty_horizons":[],"per_column_max":[]}'
  );
  assert.throws(
    () => aggregateQaScope([broken], [], TOL),
    /violations_over/,
    '缺 summary.violations_over 时报错信息必须点名该字段'
  );
});

/*
 * ---- 11/12. 契约：`per_column_max` / `empty_horizons` 恒返回，缺失必须报错 ----
 *
 * `straditize_core/qa.py::compute_qa_summary` 有两条 return 路径，这两个字段在
 * **两条都给了**：
 * - 空集提前返回 `qa.py:39-52`：`empty_horizons` :46、`per_column_max` :51。
 * - 正常返回 `qa.py:141-156`：`empty_horizons` :148、`per_column_max` :153。
 *
 * 因此前端把它们声明为**可选**（`?`）属于契约倒退：它让"后端没给"变成一种合法输入，
 * 而消费端遇到这种情况只能按空数组兜——`empty_horizons` 缺 ⇒ 面板说「未发现空层位」，
 * `per_column_max` 缺 ⇒ 面板说「暂无列刻度信息」，把"后端没给"报成"确实没有"。
 *
 * 与 #14 同一口径：只有**空集路径真的不给**的 `n_uncalibrated` /
 * `uncalibrated_columns`（仅 `qa.py:154-155`）才允许可选 + `?.`。
 */

check('缺 summary.per_column_max 必须抛错（不得渲染成「暂无列刻度信息」）', () => {
  const broken = partFromJson(
    'a',
    '{"n_horizons":6,"n_horizons_with_data":6,"n_horizons_empty":0,' +
      '"empty_horizons":[],"violations_over":[],"sum":{"max":96}}'
  );
  assert.throws(
    () => aggregateQaScope([broken], [], TOL),
    /summary\.per_column_max（违反契约）/,
    '缺 summary.per_column_max 时报错信息必须点名该字段'
  );
});

check('缺 summary.empty_horizons 必须抛错（不得渲染成「0 个空层位」）', () => {
  const broken = partFromJson(
    'a',
    '{"n_horizons":6,"n_horizons_with_data":6,"n_horizons_empty":0,' +
      '"per_column_max":[],"violations_over":[],"sum":{"max":96}}'
  );
  assert.throws(
    () => aggregateQaScope([broken], [], TOL),
    /summary\.empty_horizons（违反契约）/,
    '缺 summary.empty_horizons 时报错信息必须点名该字段'
  );
});

console.log(`\nqa-verdict: ${n} checks passed`);
