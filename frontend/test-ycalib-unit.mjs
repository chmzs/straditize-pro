// #111：单位缺失时不得用 `cm` 兜底（显示、提交、镜像归一化、导出表头各守一条）。
//
// 事故链条：`cal.unit || 'cm'` 曾出现在四个环节，任一处命中就把 cm 种进模型或交付物；
// 图上若是 ka 年代轴，此后导出列名、样品深度网格提示、年龄模型换算全按 cm 解释 ——
// **不报任何错，只产出看起来正常的错结果**。
//
//   1. `YCalibPanel` 显示层 —— 输入框预填 cm，用户以为单位就是 cm
//   2. `YCalibPanel` 提交层 —— 空单位送 cm，写回后端
//   3. `main.ts` 图上选点自动复标 —— 直接把 cm 送进 `core.calibrateAxes`
//   4. `ProjectManager.normalizeProject` —— 缺 unit 的载荷一进前端镜像就变 cm（源头）
//   5. `ProjectManager.generateStandardCsv` —— 导出表头自称 `Depth_cm`
//
// 正确表示：提交侧送空串（后端 `if unit:` 保留既有 depth_unit），镜像侧保留 undefined，
// 表头侧写 `Depth_?`。
//
// 判别力（每条都能变红，已实测反向验证）：
//   - 提交层改回 `|| 'cm'` → 组 2 红（单位收到 'cm'）；
//   - 显示层改回 `cal.unit || 'cm'` → 组 1 红（渲染出 value="cm" / cm/px）；
//   - `normalizeProject` 改回 `|| 'cm'` → 组 5 红（镜像单位变 'cm'）；
//   - `generateStandardCsv` 改回 `|| 'cm'` → 组 6 红（表头 Depth_cm）；
//   - `main.ts` 改回 `cal.unit || 'cm'` → 组 7 红；
//   - 谁把提交改成恒送空串 → 组 3 对照组红；
//   - `calUnitLabel` 自己兜底 cm → 组 8/9 红（文案变 cm）；
//   - 任一显示点改回裸插 `${cal.unit}` → 组 9 红（打出 undefined）/ 组 10 红（文本锁）。
//
// 组 7 与组 10 是**文本级**锁（main.ts / Inspector.ts / PropertyPanel.ts /
// YCalibToolStrategy.ts 依赖 DOM 或整棵应用，node 起不来），只防回退、不证明运行期
// 排版；运行期证据在组 2（面板实参）、组 8（helper 返回值）、组 9（真跑
// drawDepthGridOverlay 抓 ctx.fillText 的文案）。
//
// 为何要注册 resolve hook：仓库里全是无扩展名的相对导入，且 `types/*.ts`、
// `steps/_registry.ts` 是**值式**的类型导入（`import { DiagramData } from ...` 而非
// `import type`），node 的 type-stripping 是纯文本剥离，留着这条 import 必然解析失败。
// 这里把纯类型模块换成空壳（类型名 → undefined，真常量原样抄过来），再补 `.ts`
// 与 `/index.ts` 解析。同类取舍在 test-samples-stats-i18n.mjs 有先例（那边退化为断言词典）。
//
// 运行：cd frontend && node --experimental-strip-types test-ycalib-unit.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const RESOLVE_HOOK = String.raw`
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 纯类型模块的替身：真常量原样抄过来，类型名一律 undefined（运行期没有实体）。 */
function typesStub(absPath) {
  const src = readFileSync(absPath, 'utf8');
  const consts = [...src.matchAll(/^export const (\w+) = (.+);$/gm)].map((m) => ({
    name: m[1],
    decl: 'export const ' + m[1] + ' = ' + m[2] + ';',
  }));
  const constNames = new Set(consts.map((c) => c.name));
  const typeNames = [...src.matchAll(/export (?:interface|type) (\w+)/g)].map((m) => m[1]);
  return [
    ...consts.map((c) => c.decl),
    ...typeNames.filter((n) => !constNames.has(n)).map((n) => 'export const ' + n + ' = undefined;'),
  ].join('\n');
}

export async function resolve(specifier, context, nextResolve) {
  // 先判纯类型模块：node 24 已能把无扩展名的 ../../types/pollen 解析到真文件，
  // 但那份文件里的类型导出在运行期不存在，必须换成空壳（否则 import 时抛
  // "does not provide an export named ..."）。
  if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    if (specifier.split('/').pop() === '_registry') {
      return {
        url: 'data:text/javascript,' + encodeURIComponent(
          'export const StepContext = undefined; export const StepPanel = undefined;'
        ),
        shortCircuit: true,
      };
    }
    const guess = new URL(specifier + '.ts', context.parentURL);
    if (guess.pathname.includes('/src/types/')) {
      return {
        url: 'data:text/javascript,' + encodeURIComponent(typesStub(fileURLToPath(guess))),
        shortCircuit: true,
      };
    }
  }
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (!specifier.startsWith('.')) throw err;
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch (ignored) {
        // 试下一个后缀
      }
    }
    throw err;
  }
}
`;

register('data:text/javascript,' + encodeURIComponent(RESOLVE_HOOK));

const panel = await import('./src/components/steps/YCalibPanel.ts');
const { normalizeProject, ProjectManager } = await import('./src/core/ProjectManager.ts');
const { setLocale } = await import('./src/i18n/index.ts');
const zhCN = (await import('./src/i18n/locales/zh-CN.ts')).zhCN;
const en = (await import('./src/i18n/locales/en.ts')).en;

// 无论运行环境默认语言为何（如 CI 上的 en-US），显示层断言针对中文词典，必须显式设为 zh-CN
setLocale('zh-CN');

// 后端下发载荷：端点齐全、`unit` 缺失（老工程或草稿丢字段时的真实形态）。
const CAL_WITHOUT_UNIT = {
  isCalibrated: true,
  top_px: 611,
  top_cm: 7.5,
  bottom_px: 1198,
  bottom_cm: 42.5,
};
const CAL_WITH_KA = { ...CAL_WITHOUT_UNIT, unit: 'ka' };

console.log('--- 1. 显示层：缺单位时显示「单位未定」，不显示 cm ---');
// 断言必须落在**控件**上（placeholder / 提示节点），不能只查子串：模板注释里也含这四个字。
const UNIT_UNSET = zhCN['step3.unitUnset'];
const missingUnitUi = {
  placeholder: `placeholder="${UNIT_UNSET}"`,
  hint: `>${UNIT_UNSET}</div>`,
};
const htmlMissing = panel.render({ calibration: CAL_WITHOUT_UNIT });
assert.ok(!/value="cm"/.test(htmlMissing), '单位输入框不得预填 cm（预填值会随提交写回后端）');
assert.ok(!htmlMissing.includes('cm/px'), '比值行不得带 cm 单位（单位未知时只报纯比值）');
assert.ok(htmlMissing.includes(missingUnitUi.placeholder), '缺单位时输入框必须以「单位未定」占位');
assert.ok(htmlMissing.includes(missingUnitUi.hint), '缺单位时面板必须挂出「单位未定」提示节点');

const htmlKa = panel.render({ calibration: CAL_WITH_KA });
assert.ok(htmlKa.includes('value="ka"'), '已知单位必须原样回填');
assert.ok(htmlKa.includes('ka/px'), '比值行必须用真实单位');
assert.ok(!htmlKa.includes(missingUnitUi.placeholder), '已知单位时不得再出现「单位未定」占位');
assert.ok(!htmlKa.includes(missingUnitUi.hint), '已知单位时不得再挂出「单位未定」提示');

// 极简 DOM 桩：mount() 只用到 querySelector / querySelectorAll / addEventListener / value。
function makeRoot(overrides = {}) {
  const fields = {
    '#ycal-inp-top-px': '611',
    '#ycal-inp-top-val': '7.5',
    '#ycal-inp-bot-px': '1198',
    '#ycal-inp-bot-val': '42.5',
    '#ycal-inp-unit': '',
    '#ycal-sel-primary-axis': 'depth',
    '#btn-apply-ycalib': '',
    '#btn-repick-ycalib': '',
    '#btn-apply-ycalib-next': '',
    ...overrides,
  };
  const els = new Map();
  for (const [selector, value] of Object.entries(fields)) {
    els.set(selector, {
      value,
      handlers: {},
      addEventListener(type, fn) {
        this.handlers[type] = fn;
      },
    });
  }
  return {
    els,
    querySelector: (selector) => els.get(selector) ?? null,
    querySelectorAll: (selector) =>
      selector
        .split(',')
        .map((part) => part.trim())
        .map((part) => els.get(part))
        .filter(Boolean),
  };
}

/** 点【应用标定】，返回 onSubmitYCalibration 的实参列表（每项一次调用）。 */
function submitViaApplyButton(overrides) {
  const root = makeRoot(overrides);
  const submitted = [];
  panel.mount(root, {
    onSubmitYCalibration: (...args) => submitted.push(args),
    onPreviewYCalibrationPx: () => {},
    onStartYCalibration: () => {},
    onAdvanceWorkflowStage: () => {},
  });
  root.els.get('#btn-apply-ycalib').handlers.click();
  return submitted;
}

console.log('--- 2. 提交层：单位缺失时送空串（后端保留原值），不送 cm ---');
const missingUnit = submitViaApplyButton({ '#ycal-inp-unit': '' });
assert.equal(missingUnit.length, 1, '四个数值框填齐后应提交一次标定');
assert.equal(
  missingUnit[0][4],
  '',
  `单位缺失时必须以空串提交（后端据此保留原单位），实际送了 ${JSON.stringify(missingUnit[0][4])}`
);

console.log('--- 3. 对照组：用户真填了单位，必须原样送达 ---');
const kaUnit = submitViaApplyButton({ '#ycal-inp-unit': 'ka' });
assert.equal(kaUnit.length, 1);
assert.equal(kaUnit[0][4], 'ka', '用户填的 ka 必须原样送达');
const paddedUnit = submitViaApplyButton({ '#ycal-inp-unit': '  cm  ' });
assert.equal(paddedUnit[0][4], 'cm', '用户填的 cm 去掉首尾空白后必须原样送达（证明不是恒送空串）');

console.log('--- 4. i18n：文案键两份词典齐备，且不含被禁的 cm ---');
for (const [label, dict] of [
  ['zh-CN', zhCN],
  ['en', en],
]) {
  const text = dict['step3.unitUnset'];
  assert.equal(typeof text, 'string', `${label} 缺少 step3.unitUnset`);
  assert.ok(text.trim() !== '', `${label} 的 step3.unitUnset 不得为空`);
  assert.ok(!/\bcm\b/.test(text), `${label} 的 step3.unitUnset 不得含 cm：${text}`);
}

console.log('--- 5. 镜像归一化：normalizeProject 缺 unit 时保留 undefined，不归一化成 cm ---');
const normalizedWithoutUnit = normalizeProject(
  {
    depth_calibration: { ...CAL_WITHOUT_UNIT, is_calibrated: true },
    columns: [],
    roi: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
  },
  null
);
assert.ok(normalizedWithoutUnit, '载荷齐全时 normalizeProject 必须返回数据（否则本组没有判别力）');
assert.equal(
  normalizedWithoutUnit.calibration.unit,
  undefined,
  `缺 unit 的前端镜像必须保留 undefined（下游自行判断），实际是 ${JSON.stringify(
    normalizedWithoutUnit.calibration.unit
  )}`
);

const normalizedKa = normalizeProject(
  {
    depth_calibration: { ...CAL_WITH_KA, is_calibrated: true },
    columns: [],
    roi: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
  },
  null
);
assert.equal(normalizedKa.calibration.unit, 'ka', '已知单位必须原样透传');

const normalizedEmptyString = normalizeProject(
  {
    depth_calibration: { ...CAL_WITHOUT_UNIT, unit: '', is_calibrated: true },
    columns: [],
    roi: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
  },
  null
);
assert.equal(normalizedEmptyString.calibration.unit, undefined, '空字符串单位等同未定，不得原样留在镜像里');

console.log('--- 6. 导出表头：缺单位写 Depth_?，不写 Depth_cm ---');
const csvFor = (calibration) => {
  // 一列未数字化的属种（controlPoints 为空 → 数据行写 NA），只为看表头。
  const manager = new ProjectManager(
    { calibration, columns: [{ visible: true, name: 'Pinus', controlPoints: [] }] },
    null
  );
  return manager.generateStandardCsv();
};
const headerOf = (csv) => csv.split('\n')[0];

assert.equal(
  headerOf(csvFor(CAL_WITHOUT_UNIT)),
  'Depth_?,"Pinus"',
  '缺单位时表头必须让人看出单位未定（Depth_?），不得自称 Depth_cm'
);
assert.equal(headerOf(csvFor(CAL_WITH_KA)), 'Depth_ka,"Pinus"', '已知单位时表头带真实单位');
assert.equal(
  headerOf(csvFor({ ...CAL_WITHOUT_UNIT, unit: 'cm' })),
  'Depth_cm,"Pinus"',
  'cm 只有用户真填了才写'
);

console.log('--- 7. main.ts 自动复标：单位缺失送空串（文本级锁） ---');
// 说明判据强度：`main.ts` 依赖整棵应用（DOM / canvas / RPC），node 起不来，只能锁源码形态。
// 这条仍能防回退（改回 `|| 'cm'` 立刻红），但不证明运行期实参 —— 运行期证据在组 2 与
// 后端 `calibrate_axes` 的复核脚本里（见交付说明）。
const mainSource = readFileSync(new URL('./src/main.ts', import.meta.url), 'utf8');
assert.ok(
  mainSource.includes(
    "applyDepthCalibration(marks, [Number(cal.top_cm), Number(cal.bottom_cm)], cal.unit ?? '')"
  ),
  'main.ts 自动复标必须把 cal.unit 原样透传（缺单位送空串）'
);
assert.ok(!/cal\.unit\s*\|\|\s*'cm'/.test(mainSource), 'main.ts 不得再用 cal.unit || \'cm\' 兜底');

console.log('--- 8. 共享 helper：单位文案的唯一实现 ---');
// "单位未定"只允许有一个 i18n 来源：同一个物理状态不允许两个面板说两种话。
// （曾经 `step7.unitUnknown`＝「单位未定（Y 轴未标定）」与 `step3.unitUnset` 并存，
//   而括注"Y 轴未标定"在"标定完成但缺 unit"时是错的——那正是 #111 产出的状态。）
{
  const carrierKeys = Object.entries(zhCN)
    .filter(([, text]) => typeof text === 'string' && text.includes('单位未定'))
    .map(([key]) => key);
  assert.deepEqual(carrierKeys, ['step3.unitUnset'], `「单位未定」文案只允许一个 i18n 键，实际: ${carrierKeys.join('、')}`);
  assert.ok(!('step7.unitUnknown' in zhCN), 'step7.unitUnknown 已并入 step3.unitUnset，不得回流');
  const enCarrierKeys = Object.entries(en)
    .filter(([, text]) => typeof text === 'string' && text.includes('unit unset'))
    .map(([key]) => key);
  assert.deepEqual(enCarrierKeys, ['step3.unitUnset'], `英文同理，实际: ${enCarrierKeys.join('、')}`);
}
const { calUnitLabel } = await import('./src/core/calUnit.ts');
assert.equal(calUnitLabel(CAL_WITHOUT_UNIT), UNIT_UNSET, '缺单位 → i18n 的「单位未定」');
assert.equal(calUnitLabel(CAL_WITH_KA), 'ka', '有真单位 → 原样返回');
assert.equal(calUnitLabel({ ...CAL_WITHOUT_UNIT, unit: '  cm  ' }), 'cm', '首尾空白不去猜、只去空白');
assert.equal(calUnitLabel({ unit: '' }), UNIT_UNSET, '空字符串等同未定');
assert.equal(calUnitLabel(null), UNIT_UNSET, 'null 不得抛异常，也不得回落成 cm');
assert.equal(calUnitLabel(undefined), UNIT_UNSET, 'undefined 同上');

console.log('--- 9. 画布深度徽标：缺单位时显示「单位未定」，不显示 undefined / cm ---');
const { drawDepthGridOverlay } = await import('./src/components/canvas/depthGrid.ts');
const drawBadge = (calibration, hoveringRulerBadge) => {
  const texts = [];
  const ctx = {
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setLineDash() {},
    arc() {},
    fill() {},
    fillText(text) {
      texts.push(text);
    },
    measureText: () => ({ width: 0 }),
  };
  drawDepthGridOverlay({
    ctx,
    isLight: true,
    calibration,
    roi: { xMin: 60, xMax: 400, yMin: 0, yMax: 900 },
    columns: [],
    scale: 1,
    hoveredDepthHorizon: null,
    hoveringRulerBadge,
  });
  return texts;
};
const badgeCal = (unit) => ({
  ...CAL_WITHOUT_UNIT,
  depthGridEnabled: true,
  depthInterval: 2,
  ...(unit === null ? {} : { unit }),
});

const badgeNoUnit = drawBadge(badgeCal(null), false);
const badgeLine = badgeNoUnit.find((text) => text.startsWith('Depth ('));
assert.ok(badgeLine, '未悬停时应画出 Depth (...) 徽标');
assert.ok(/单位未定/.test(badgeLine), `徽标必须显示「单位未定」，实际: ${badgeLine}`);
assert.ok(!badgeNoUnit.some((text) => text.includes('undefined')), '徽标不得出现 undefined');
assert.ok(!badgeNoUnit.some((text) => /\bcm\b/.test(text)), '徽标不得凭空出现 cm');

const rulerNoUnit = drawBadge(badgeCal(null), true);
const rulerLine = rulerNoUnit.find((text) => text.startsWith('标尺:'));
assert.ok(rulerLine && /单位未定/.test(rulerLine), `悬停徽标必须显示「单位未定」，实际: ${rulerLine}`);

const badgeKa = drawBadge(badgeCal('ka'), false);
const kaLine = badgeKa.find((text) => text.startsWith('Depth ('));
assert.ok(/Depth \(ka\)/.test(kaLine), `有真单位时必须用它，实际: ${kaLine}`);
assert.ok(!badgeKa.some((text) => text.includes('单位未定')), '有真单位时不得出现「单位未定」');

console.log('--- 10. 其余五处显示点：必须走 helper，不得裸插 ${cal.unit}（文本级锁） ---');
// 判据强度：`main.ts` / `Inspector.ts` / `PropertyPanel.ts` / `YCalibToolStrategy.ts` /
// `SamplesPanel.ts` 都依赖 DOM 或整棵应用，node 起不来。这里锁"调用 helper + 无裸插值"
// 的源码形态，判别力足够（改回 `${cal.unit}` 立刻红），但不证明运行期排版；
// 运行期证据在组 2（面板实参）、组 8（helper 返回值）、组 9（真跑 drawDepthGridOverlay）。
const BARE_UNIT_INTERP = /\$\{(?:this\.data\.calibration|cal)\.unit\}/;
for (const [label, file] of [
  ['main.ts（页脚）', './src/main.ts'],
  ['Inspector.ts（属性面板）', './src/components/Inspector.ts'],
  ['PropertyPanel.ts（标定弹窗）', './src/components/PropertyPanel.ts'],
  ['YCalibToolStrategy.ts（画布药丸）', './src/core/tools/YCalibToolStrategy.ts'],
  ['SamplesPanel.ts（步骤 7 面板）', './src/components/steps/SamplesPanel.ts'],
]) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.ok(source.includes('calUnitLabel('), `${label} 必须通过 calUnitLabel 取单位文案`);
  assert.ok(!BARE_UNIT_INTERP.test(source), `${label} 不得再裸插 \${cal.unit}（缺单位会打出 undefined）`);
}
assert.ok(
  readFileSync(new URL('./src/main.ts', import.meta.url), 'utf8').includes(
    'const unit = calUnitLabel(canvasComponent.data.calibration);'
  ),
  '页脚必须用 helper 得到的单位标签'
);

console.log('✔ 单位不再兜底为 cm：显示 / 提交 / 镜像 / 导出表头 / 自动复标 / 五处界面');
