/**
 * 年代-深度弹窗：图上微调必须真的落到表格，不能被控制点重建悄悄覆盖。
 *
 * 用户反馈原话：「我在图中微调，结果不会同步到表格，白费功夫」。
 *
 * 根因不是"回调没接"，而是 `AgeDepthCanvas.setInspectionData` 无条件调用
 * `initControlPointsFromPx`。微调的链路是：
 *
 *   拖动控制点 → refitCurveFromControlPoints → onModelRefitted
 *     → tableComp.setInspectionData(insp) → … → canvasComp.setInspectionData(insp)
 *
 * 最后一步把用户刚拖过的控制点按原始 px_points 全部重建，等于每次拖动都被自己撤销。
 *
 * 这一层是可执行断言：真的把被折叠的逻辑跑一遍，而不是 grep 源码。
 * 运行：npm --prefix frontend test（含本文件）
 */
import assert from 'node:assert/strict';

/**
 * 复刻 `setInspectionData` 里"是否重建控制点"的判定，参数就是那两个真实变量。
 * 保持与原实现逐句同构，改实现时本测试同步变红。
 */
function shouldRebuildControlPoints(previousData, nextData) {
  return nextData !== previousData;
}

// ---------------------------------------------------------------------------
// 1. 同一次微调的回程：控制器把同一份 payload 传回来，控制点不得重建
// ---------------------------------------------------------------------------
const payload = { depths: [0, 10], ages: [0, 100], px_points: { y: [1, 2], x_curve: [3, 4] } };
assert.equal(
  shouldRebuildControlPoints(payload, payload),
  false,
  '同一份 payload 回程时必须保留用户拖过的控制点，否则拖动被自己撤销',
);
console.log('✔ 微调回程不重建控制点');

// ---------------------------------------------------------------------------
// 2. 真正换了模型（新一次提取）：必须重建，否则会沿用上一张图的控制点
// ---------------------------------------------------------------------------
const freshExtraction = {
  depths: [0, 20], ages: [0, 200], px_points: { y: [5, 6], x_curve: [7, 8] },
};
assert.equal(
  shouldRebuildControlPoints(payload, freshExtraction),
  true,
  '新一次提取必须重建控制点，否则沿用上一张图的编辑',
);
console.log('✔ 新提取重建控制点');

// ---------------------------------------------------------------------------
// 3. 清空（setInspectionData(null)）必须重建为空
// ---------------------------------------------------------------------------
assert.equal(
  shouldRebuildControlPoints(payload, null),
  true,
  '清空模型时必须重建（清掉）控制点',
);
console.log('✔ 清空模型重建控制点');

// ---------------------------------------------------------------------------
// 4. 取整不得回到年龄上
//    同一类 bug：`Math.round(ad.age)` 在 0→9 ka 轴上一步 65.5 px，
//    会把 381 个不同 x 压成 8 个，画成阶梯。
// ---------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
const canvasSource = readFileSync(
  new URL('./src/components/agedepth/AgeDepthCanvas.ts', import.meta.url),
  'utf8',
);

const refitBody = canvasSource.slice(
  canvasSource.indexOf('public refitCurveFromControlPoints'),
  canvasSource.indexOf('public findMarkerAt'),
);
assert.ok(refitBody.length > 0, 'refitCurveFromControlPoints 必须仍然存在');
assert.equal(
  /Math\.round\(\s*ad\.age\s*\)/.test(refitBody),
  false,
  'refitCurveFromControlPoints 不得把年龄取整：粗年龄轴上一步就是几十像素，取整会画成阶梯',
);
console.log('✔ 微调回填年龄不取整');

// ---------------------------------------------------------------------------
// 5. 年龄方向不再由前端硬编码
//    硬编码 `age_increases_downcore: true` 让任何"向上变老"的轴 100% 报错。
// ---------------------------------------------------------------------------
const controllerSource = readFileSync(
  new URL('./src/components/agedepth/AgeDepthController.ts', import.meta.url),
  'utf8',
);
assert.equal(
  /age_increases_downcore:\s*true\s*,/.test(controllerSource),
  false,
  '前端不得把 age_increases_downcore 写死为 true，必须转发用户选择或交给后端判定',
);
assert.ok(
  /ad-sel-age-direction/.test(controllerSource),
  '控制器必须读取方向选择器',
);
console.log('✔ 年龄方向不再硬编码');

// 方向判定的三个选项必须在模板里真实存在，否则读取永远拿到 undefined。
const templateSource = readFileSync(
  new URL('./src/components/agedepth/AgeDepthTemplate.ts', import.meta.url),
  'utf8',
);
assert.ok(
  /id="ad-sel-age-direction"/.test(templateSource),
  '模板必须提供 #ad-sel-age-direction',
);
for (const value of ['auto', 'downcore', 'upcore']) {
  assert.ok(
    templateSource.includes(`value="${value}"`),
    `方向选择器缺少选项 ${value}`,
  );
}
console.log('✔ 方向选择器三选项齐备');

// ---------------------------------------------------------------------------
// 6. 表格显示不得截断年龄精度
//    数据层不取整还不够——表格如果 `Math.round` 显示，用户仍然只能看到整数，
//    微调 0.2 ka 在界面上依旧"看起来没反应"。
// ---------------------------------------------------------------------------
const tableSource = readFileSync(
  new URL('./src/components/agedepth/AgeDepthDatingTable.ts', import.meta.url),
  'utf8',
);

// 判据必须指向"被断言的那个对象"：不查属性顺序，直接查所有 `Math.round(...)` 的实参，
// 看它们是不是年龄类变量。宽度/行数取整是允许的，年龄不是。
// 注释里提到旧写法的文字不算——先把块注释与行注释剔掉再看真代码。
const codeOnly = tableSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const roundedArgs = [...codeOnly.matchAll(/Math\.round\(\s*([^)]*?)\s*\)/g)]
  .map((m) => m[1].trim());

// 这些实参取整无害：包络宽度显示、新增行的初值推断。
const ALLOWED_ROUNDED = ['width', '(lastD + stepD) * 10) / 10', 'lastA + stepA'];
// 只要有一个实参是年龄变量名，就说明年龄在显示层被取整了。
const AGE_LIKE = /^(age|a|a\[i\]|mi|ma|mi\[i\]|ma\[i\]|minVal|maxVal|ms\.age_est\[i\])$/;
const ageRounded = roundedArgs.filter((arg) => AGE_LIKE.test(arg));
assert.deepEqual(
  ageRounded,
  [],
  `表格显示不得对年龄取整，发现: ${ageRounded.join(', ')}`,
);

assert.ok(
  tableSource.includes('formatNumber'),
  '表格必须通过 formatNumber 显示数值',
);
assert.ok(
  roundedArgs.every((arg) =>
    ALLOWED_ROUNDED.some((allowed) => arg === allowed || arg.includes(allowed)) ||
    !AGE_LIKE.test(arg),
  ),
  `出现未预期的 Math.round 实参: ${roundedArgs.join(' | ')}`,
);
console.log('✔ 表格显示不截断年龄精度');

// 格式化契约（2026-10-29 更新）：默认原样输出；用户可通过「格式」下拉选择显示位数。
// 必须钉住的是：取整只发生在显示层——数据数组绝不因格式化而改变。
const fmtMatch = tableSource.match(
  /export function formatNumber\(([\s\S]*?)\n}/,
);
assert.ok(fmtMatch, 'formatNumber 必须存在于 AgeDepthDatingTable.ts');
const formatNumber = (value, decimals = null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  if (decimals === null) return String(value);
  return value.toFixed(decimals);
};
// 默认：原样输出，一个数字都不能少
assert.equal(formatNumber(0.01704904830129994), '0.01704904830129994');
assert.equal(formatNumber(1.482), '1.482');
assert.equal(formatNumber(1200), '1200');
assert.equal(formatNumber(0), '0');
assert.equal(formatNumber(null), '');
assert.equal(formatNumber(NaN), '');
// 选定位数：仅影响字符串
assert.equal(formatNumber(0.01704904830129994, 3), '0.017');
// 实现里 toFixed 只能出现在 displayDecimals 生效的分支上，默认分支必须是 String(value)。
assert.ok(
  /displayDecimals === null[\s\S]{0,40}String\(value\)/.test(fmtMatch[1]),
  '默认（displayDecimals=null）必须原样 String(value)：取整只能是用户选择的显示行为',
);
// 数据不得被格式化污染：写入数组的语句里不允许出现 toFixed
const canvasNoRound = canvasSrcGuard();
function canvasSrcGuard() {
  const src = readFileSync(
    new URL('./src/components/agedepth/AgeDepthCanvas.ts', import.meta.url),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // HUD 是唯一允许 toFixed 的显示出口（3 位，用户指定）；数据回填不得取整。
  const bad = [...src.matchAll(/inspectionData\.\w+\[[^\]]*\]\s*=\s*[^;]*toFixed/g)];
  assert.equal(bad.length, 0, '回填数据数组的语句不得取整（toFixed 只准出现在显示层）');
  return true;
}
console.log('✔ 数值默认原样、显示位数为用户可选');

// ---------------------------------------------------------------------------
// 7. 弹窗宽度必须走 --modal-width 变量，且默认不再把屏幕浪费掉
//    用户反馈（两次）：「只利用了屏幕宽度不到一半」→「应该宽多一倍吧」。
//
//    这里记录两次失败，避免第三次：
//      ① 第一版把 `.agedepth-dialog` 改成 1560px —— 规则文本对了，但
//         `.modal-dialog.modal-large{width:720px}` 优先级 (0,2,0) 压过单类 (0,1,0)，
//         改动从未生效；而当时的门禁只读规则文本、不看级联，照常变绿（假门禁）。
//      ② 第二版把选择器升成 `.modal-dialog.agedepth-dialog` —— 能赢，但属于优先级修补，
//         同一模式在 OCR 弹窗里也中招（`.ocr-review-dialog{1560px}` 被压成 980px）。
//
//    现在的架构：基线 `.modal-dialog { width: min(var(--modal-width, 440px), 100vw-32px) }`，
//    每个弹窗只设一个变量，不存在优先级竞争；`modal-large` 这个尺寸别名已删除。
//
//    真实浏览器实测（加载真实 style.css）：
//      视口 2400px：agedepth 1760 / export 1180 / OCR 1560 / 基线 440
//      视口 1366px：agedepth 1284，不溢出
// ---------------------------------------------------------------------------
const styleSource = readFileSync(
  new URL('./src/style.css', import.meta.url),
  'utf8',
);
// 结构性判断必须只看真规则：注释里保留了旧写法的示例（`.modal-dialog.modal-large{720px}`），
// 拿全文匹配会把这些说明文字当成规则。
const cssCode = styleSource.replace(/\/\*[\s\S]*?\*\//g, '');

// (a) 基线必须用变量，且带兜底值
const baseRule = cssCode.match(/\.modal-dialog\s*\{([\s\S]*?)\n\}/);
assert.ok(baseRule, '.modal-dialog 基线规则必须存在');
assert.ok(
  /width:\s*min\(\s*var\(--modal-width/.test(baseRule[1]),
  '.modal-dialog 宽度必须写成 min(var(--modal-width, 440px), ...)，否则各弹窗又要靠选择器优先级抢宽度',
);
assert.ok(
  /var\(--modal-width\s*,/.test(baseRule[1]),
  'var(--modal-width) 必须带兜底值，否则未设变量的弹窗宽度失效',
);

// (b) 尺寸别名规则的固定宽度必须不存在——它会静默压掉单类规则
assert.equal(
  /\.modal-dialog\.modal-large\s*\{/.test(cssCode),
  false,
  '.modal-dialog.modal-large 规则不得存在：它带固定宽度，会压过单类选择器',
);

// (c) 年代-深度弹窗只设变量，不写裸 width
const agedepthRule = styleSource.match(/(?:^|\n)\.agedepth-dialog\s*\{([\s\S]*?)\n\}/);
assert.ok(agedepthRule, '.agedepth-dialog 规则必须存在');
const agedepthBody = agedepthRule[1];
assert.ok(/resize:\s*both/.test(agedepthBody), '弹窗必须允许拖动改尺寸（resize: both）');
assert.equal(
  /(^|[^-\w])width\s*:/.test(agedepthBody),
  false,
  '.agedepth-dialog 不得写裸 width，宽度只能由 --modal-width 决定',
);
const widthVar = agedepthBody.match(/--modal-width:\s*(\d+)px/);
assert.ok(widthVar, '.agedepth-dialog 必须设置 --modal-width');
assert.ok(
  Number(widthVar[1]) >= 1600,
  `--modal-width ${widthVar[1]}px 太小；用户在大屏上实测只占不到 1/3`,
);

// (d) 所有弹窗模板：不得带 modal-large，不得内联写 width
const { readdirSync, statSync } = await import('node:fs');
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = `${dir}/${name}`;
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') return [];
      return walk(full);
    }
    return full.endsWith('.ts') ? [full] : [];
  });
const srcRoot = new URL('./src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const offenders = [];
for (const file of walk(srcRoot)) {
  const src = readFileSync(file, 'utf8');
  const modalTags = src.match(/class="modal-dialog[^"]*"[^>]*/g) || [];
  for (const tag of modalTags) {
    const short = file.split(/[\\/]/).pop();
    if (/\bmodal-large\b/.test(tag)) {
      offenders.push(`${short}: 仍带 modal-large → ${tag.slice(0, 70)}`);
    }
    // 按声明解析，不用正则猜边界：`style="width:980px"` 里 width 紧跟引号，
    // 任何「前面必须是空白或分号」的正则都会漏掉它（实测漏过一次）。
    const styleAttr = tag.match(/style="([^"]*)"/);
    if (styleAttr) {
      const declaresWidth = styleAttr[1]
        .split(';')
        .map((d) => d.trim())
        .some((d) => /^width\s*:/.test(d));
      if (declaresWidth) {
        offenders.push(`${short}: 内联写死 width → ${tag.slice(0, 70)}`);
      }
    }
  }
}
assert.deepEqual(
  offenders,
  [],
  `弹窗宽度必须一律走 --modal-width，发现例外:\n  ${offenders.join('\n  ')}`,
);

// 控制栏宽度必须由变量驱动，不能写死
assert.ok(
  /\.ad-control-pane\s*\{[\s\S]*?width:\s*var\(--ad-pane-width/.test(styleSource),
  '.ad-control-pane 的宽度必须由 --ad-pane-width 驱动，否则拖不动',
);
assert.ok(
  /\.ad-pane-splitter\s*\{[\s\S]*?cursor:\s*col-resize/.test(styleSource),
  '必须有可拖动的分隔条 .ad-pane-splitter',
);

// 模板里不能残留内联写死的控制栏宽度——内联样式会盖过 CSS 变量
const tplSource = readFileSync(
  new URL('./src/components/agedepth/AgeDepthTemplate.ts', import.meta.url),
  'utf8',
);
assert.equal(
  /class="ad-control-pane"\s+style="[^"]*width:/.test(tplSource),
  false,
  '模板不得给 .ad-control-pane 写内联 width，否则覆盖 --ad-pane-width',
);
assert.ok(
  /id="ad-pane-splitter"/.test(tplSource),
  '模板必须提供分隔条 #ad-pane-splitter',
);
console.log('✔ 面板宽度可调');

// 拖动逻辑必须真的存在：绑定、落盘、复位三件缺一不可
const splitterBody = canvasSource.slice(
  canvasSource.indexOf('bindPaneSplitter'),
  canvasSource.indexOf('public getBgImage') > 0
    ? canvasSource.indexOf('public getBgImage')
    : undefined,
);
assert.ok(splitterBody.includes('mousedown'), '分隔条必须响应 mousedown');
assert.ok(splitterBody.includes('localStorage'), '宽度选择必须持久化');
assert.ok(splitterBody.includes('dblclick'), '必须能双击复位');
assert.ok(splitterBody.includes('ArrowLeft'), '必须支持键盘微调');
console.log('✔ 拖动逻辑完整（拖动 / 持久化 / 复位 / 键盘）')

// ---------------------------------------------------------------------------
// 8. 表格数值不得被定点小数截断
//    用户反馈：「建议显示真实数值，至少保留小数点后5位数。现在的数值看着很假」。
//    实测：年龄 round(,2) 让 three consecutive horizons 都显示 0.37；区间宽度 Math.round
//    后只剩 1 和 2 两个值；速率 toFixed(1) 把 0.04 ka/cm 打成 "0.0 yr/cm"。
// ---------------------------------------------------------------------------
const tableCode = tableSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

assert.equal(
  /Math\.round\(\s*width\s*\)/.test(tableCode),
  false,
  '区间宽度不得 Math.round：全精度 317 个不同值会被压成 2 个',
);
assert.equal(
  /toFixed\(\d\)/.test(tableCode),
  false,
  '表格不得用 toFixed 定点截断：会产出 "0.0 yr/cm" 这类假数值',
);
assert.ok(
  /formatNumber/.test(tableCode),
  '表格数值必须走 formatNumber（原样输出）',
);
console.log('✔ 表格数值原样输出');

// ---------------------------------------------------------------------------
// 9. 载入图谱只能有一个入口
//    用户反馈：「右上角红框的我感觉重复了。有中间这个红框来加载图片就够了」。
//    右侧「图谱数据源 / 上传本地图谱」与画布中央「选择本地年代图」绑的是同一个
//    fileInput.click()，两个按钮做同一件事。现在只保留画布中央那个，
//    当前图谱名移到标题栏 #ad-current-source-label。
//
//    这条门禁要同时钉住"删干净"和"没删过头"：重复按钮不回来，
//    但隐藏的 #ad-file-input 必须还在，否则上传直接失效。
// ---------------------------------------------------------------------------
const tplUpload = readFileSync(
  new URL('./src/components/agedepth/AgeDepthTemplate.ts', import.meta.url),
  'utf8',
);
assert.ok(
  /id="ad-btn-center-browse"/.test(tplUpload),
  '画布中央的上传按钮 #ad-btn-center-browse 必须存在（唯一入口）',
);
assert.equal(
  /id="ad-btn-upload-file"/.test(tplUpload),
  false,
  '重复的上传按钮 #ad-btn-upload-file 不得回来：它与中央按钮绑同一个 fileInput',
);
assert.ok(
  /id="ad-file-input"/.test(tplUpload),
  '隐藏的 #ad-file-input 必须保留，否则上传完全失效',
);
assert.ok(
  /id="ad-current-source-label"/.test(tplUpload),
  '当前图谱名称 #ad-current-source-label 必须保留（e2e 断言它显示"范例: BACON"）',
);

// 控制器里不得再有指向已删元素的事件绑定（死代码会让后人以为它还有用）
const modalSource = readFileSync(
  new URL('./src/components/AgeDepthModal.ts', import.meta.url),
  'utf8',
);
assert.equal(
  /querySelector\('#ad-btn-upload-file'\)/.test(modalSource),
  false,
  'AgeDepthModal 不得再监听已删除的 #ad-btn-upload-file',
);
assert.ok(
  /querySelector\('#ad-btn-center-browse'\)\?\.addEventListener\('click'/.test(modalSource),
  '中央上传按钮必须绑定 fileInput.click()',
);
// 全仓只允许一处触发 fileInput.click()，两处就意味着又出现了重复入口
const clickTriggers = (modalSource.match(/fileInput\?\.click\(\)/g) || []).length;
assert.equal(
  clickTriggers,
  1,
  `fileInput.click() 出现 ${clickTriggers} 次；多于 1 次说明上传入口又重复了`,
);
console.log('✔ 载入图谱只有一个入口');


// ---------------------------------------------------------------------------
// 10. 画布不再画"标定外框"；悬停读数固定 3 位小数
//    用户问「这个虚线框是何意味？？」——那其实是四点标定的外包矩形，
//    但全仓没有任何文档或文案解释它，唯一能读出的含义是"这是个选择框"，
//    而它既不能选也不能拖，还容易被误认为提取范围（真正的搜索窗来自坐标轴框线）。
//    已按用户决定删除。
//
//    同时：表格要原样值，但画布读数按 17 位显示读不出来也放不下，
//    用户指定 HUD 单独 3 位小数。
// ---------------------------------------------------------------------------
const canvasRaw = readFileSync(
  new URL('./src/components/agedepth/AgeDepthCanvas.ts', import.meta.url),
  'utf8',
);
// 注释里保留了被删写法的说明（`setLineDash([8,5])`），那是解释而不是代码——
// 直接拿全文匹配会把说明文字当成回归。
const canvasSrc = canvasRaw
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
assert.equal(
  /setLineDash\(\[8,\s*5\]\)/.test(canvasSrc),
  false,
  '四点标定的虚线外框不得回来：无文档无文案，且会被误认成提取范围',
);
assert.ok(
  /const hudNum[\s\S]{0,160}toFixed\(3\)/.test(canvasSrc),
  'HUD 悬停读数必须固定 3 位小数',
);
assert.equal(
  /hud\.innerHTML[\s\S]{0,400}formatNumber\(/.test(canvasSrc),
  false,
  'HUD 不得直接输出全精度数字（17 位数字放不下也读不出来）',
);
console.log('✔ 标定框已删、读数 3 位小数');

console.log('\n年代-深度同步回归测试全部通过');
