import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./src/style.css');
const toolbar = read('./src/components/Toolbar.ts');
const exportModal = read('./src/components/ExportModal.ts');
const metadataModal = read('./src/components/MetadataModal.ts');
const settingsModal = read('./src/components/SettingsModal.ts');
const ageDepthTemplate = read('./src/components/agedepth/AgeDepthTemplate.ts');
const feedback = read('./src/ui/feedback.ts');
const zh = read('./src/i18n/locales/zh-CN.ts');
const en = read('./src/i18n/locales/en.ts');

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

// ---- 1. 设计 token ----------------------------------------------------------
for (const token of [
  '--space-1',
  '--control-h-md',
  '--radius-md',
  '--shadow-modal',
  '--shadow-panel',
  '--font-size-md',
  '--focus-ring',
]) {
  check(css.includes(token), `缺少 UI token: ${token}`);
}

// ---- 2. 语义控件 primitive --------------------------------------------------
for (const primitive of [
  '.ui-btn',
  '.ui-btn--primary',
  '.ui-btn--secondary',
  '.ui-btn--quiet',
  '.ui-btn--danger',
  '.ui-icon-btn',
  '.ui-field',
  '.ui-modal__header',
  '.ui-modal__body',
  '.ui-modal__footer',
  '.ui-modal__title',
  '.ui-status',
  '.ui-status--danger',
  '.ui-help',
]) {
  check(css.includes(primitive), `缺少 UI primitive: ${primitive}`);
}

// ---- 3. 统一状态反馈通道 ----------------------------------------------------
check(css.includes('.ui-toast'), '缺少统一状态反馈浮层样式 .ui-toast');
check(css.includes('.ui-toast--danger'), '缺少错误级浮层样式 .ui-toast--danger');
check(css.includes('.ui-detail-backdrop'), '缺少详情弹窗样式 .ui-detail-backdrop');
for (const api of ['export function notify', 'export function notifyError', 'export function showDetailModal', 'export function describeError']) {
  check(feedback.includes(api), `feedback 模块缺少 ${api}`);
}

// ---- 4. 禁止原生 alert：全量扫描 src 下的 .ts -------------------------------
const srcRoot = fileURLToPath(new URL('./src', import.meta.url));
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
};
for (const file of walk(srcRoot)) {
  if (file.endsWith(join('ui', 'feedback.ts'))) continue;
  const source = readFileSync(file, 'utf8');
  check(
    !/(?<![\w.])window\.alert\s*\(/.test(source),
    `禁止原生 window.alert（改用 ui/feedback 的 notify/notifyError）: ${relative(srcRoot, file)}`,
  );
  check(
    !/(?<![\w.])alert\s*\(/.test(source),
    `禁止原生 alert（改用 ui/feedback 的 notify/notifyError）: ${relative(srcRoot, file)}`,
  );
}

// ---- 5. 文案门禁：禁用夸张/歧义措辞 ----------------------------------------
for (const banned of ['急救', '零脑补', '零推测', '发表级', '一键', '确认无误']) {
  check(!feedback.includes(banned), `反馈模块文案不得包含「${banned}」`);
}
for (const [name, source] of [
  ['style.css', css],
  ['Toolbar.ts', toolbar],
  ['ExportModal.ts', exportModal],
  ['MetadataModal.ts', metadataModal],
  ['SettingsModal.ts', settingsModal],
  ['AgeDepthTemplate.ts', ageDepthTemplate],
]) {
  for (const banned of ['急救', '零脑补', '零推测', '发表级', '一键', '确认无误']) {
    check(!source.includes(banned), `${name} 不得使用「${banned}」`);
  }
}

// ---- 6. 顶栏与模态框的语义化结构 -------------------------------------------
check(toolbar.includes('aria-current="step"'), '当前工作流步骤必须暴露 aria-current');
check(toolbar.includes('class="ui-btn ui-btn--primary'), '顶栏必须使用语义主按钮');
check(ageDepthTemplate.includes('role="tab"'), '年代模型标签页必须暴露 role="tab"');
check(ageDepthTemplate.includes('aria-selected'), '年代模型标签页必须暴露 aria-selected');
check(exportModal.includes('class="modal-dialog') && exportModal.includes('ui-modal'), '导出弹窗必须使用统一模态框结构');
check(exportModal.includes('ui-modal__footer'), '导出弹窗页脚必须使用统一模态框结构');
check(css.includes('.export-format-actions'), '缺少导出格式按钮组的布局样式');
check(metadataModal.includes('ui-modal__header'), '元数据弹窗页头必须使用统一模态框结构');
check(settingsModal.includes('ui-modal__body'), '设置弹窗主体必须使用统一模态框结构');

// ---- 7. 顶栏文案不得依赖 emoji ---------------------------------------------
check(!/toolbar\.(?:ocr|ageDepth|export)'\s*:\s*'[🔍⏳💾]/u.test(zh), '中文顶栏文案不得依赖 emoji');
check(!/toolbar\.(?:ocr|ageDepth|export)'\s*:\s*'[🔍⏳💾]/u.test(en), '英文顶栏文案不得依赖 emoji');

// ---- 8. 全局：源码与端到端用例不得用 emoji 充当界面语义 ---------------------
// 允许的排版记号（连接符 / 折叠与运行指示，属排版而非 emoji 语义）：↔ ▲ ▶ ▼ ◀
const ALLOWED_GLYPHS = new Set(['\u2194', '\u25B2', '\u25B6', '\u25BC', '\u25C0']);
const PICTOGRAPH = /[\p{Extended_Pictographic}\u{FE0F}\u{20E3}]/gu;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const walkSources = (dir, filePattern, callback) => {
  const walk = (abs) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const child = join(abs, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (filePattern.test(entry.name)) callback(child);
    }
  };
  walk(join(ROOT, dir));
};
const pictographHits = [];
for (const dir of ['src', 'e2e']) {
  walkSources(dir, /\.(ts|css|html)$/, (file) => {
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        if ((line.match(PICTOGRAPH) ?? []).some((glyph) => !ALLOWED_GLYPHS.has(glyph))) {
          pictographHits.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      });
  });
}
check(
  pictographHits.length === 0,
  `源码与用例不得以 emoji 充当界面语义：${pictographHits.slice(0, 4).join('、')}${pictographHits.length > 4 ? ` 等 ${pictographHits.length} 处` : ''}`,
);

// ---- 9. 标题不得中英重复 ----------------------------------------------------
const BILINGUAL_TITLE = /(?:<h[1-6][^>]*>|help-section-title">)([^<]{2,90}?)<\//g;
const bilingualTitles = [];
walkSources('src', /\.ts$/, (file) => {
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      for (const match of line.matchAll(BILINGUAL_TITLE)) {
        // 动态标题（模板表达式）无法静态判定，跳过
        if (match[1].includes('${')) continue;
        if (/\([A-Za-z][A-Za-z -]{2,40}\)/.test(match[1])) {
          bilingualTitles.push(`${relative(ROOT, file)}:${index + 1}`);
        }
      }
    });
});
check(
  bilingualTitles.length === 0,
  `标题不得中英重复（如「属种词汇表 (Taxa Vocabulary)」）：${bilingualTitles.slice(0, 4).join('、')}`,
);

// ---- 10. 中文词条内禁止英文译文括注（只保留领域缩写 / 键位 / 后端字段名）----
// 例：`3. Y 轴物理标定 (Calibration)` 属重复翻译；`(ROI)` `(Ctrl+Z)` `(x_ticks)` 属有效信息。
const GLOSS_BAN = [
  '(Adjust)', '(Pan)', '(Column)', '(Add Point)', '(Delete Point)', '(Calibrate)',
  '(Line Fix)', '(Measure)', '(Calibration)', '(Columns & Naming)', '(Horizons)',
  '(Verification & QA)', '(Remote Protected)', '(Allowed Hosts & IPs)', '(PIN / Password)', '(T00-b)',
];
{
  const lines = read('./src/i18n/locales/zh-CN.ts').split(String.fromCharCode(10));
  lines.forEach((line, index) => {
    const gloss = GLOSS_BAN.find((g) => line.includes(g));
    if (gloss) {
      failures.push(`src/i18n/locales/zh-CN.ts:${index + 1} 中文词条不得携带英文译文括注 ${gloss}：${line.trim()}`);
    }
  });
}

// ---- 11. 按钮规范：旧基类 .btn 已退役，必须使用 .ui-btn 语义变体 ----
{
  const offenders = [];
  const stack = ['./src'];
  while (stack.length > 0) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = dir + '/' + name;
      if (statSync(full).isDirectory()) { if (name !== 'node_modules') stack.push(full); continue; }
      if (!name.endsWith('.ts') && !name.endsWith('.html')) continue;
      const lines = readFileSync(full,
        'utf8').split(String.fromCharCode(10));
      lines.forEach((line, index) => {
        if (line.includes('class="btn btn-') || line.includes('class="btn ')) offenders.push(full + ':' + (index + 1));
      });
    }
  }
  check(offenders.length === 0, '按钮必须用 .ui-btn 语义变体，旧基类 .btn 已退役：' + offenders.slice(0, 4).join('、'));
  const cssSrc = read('./src/style.css');
  check(!cssSrc.includes('.btn-primary') && !cssSrc.includes('.btn-secondary') && !cssSrc.includes(String.fromCharCode(10) + '.btn {'), 'style.css 不得再定义已退役的 .btn / .btn-primary / .btn-secondary');
}

// ---- 12. 内联样式不得写死设计 token 的颜色值 / 硬编码渐变 ----
// 内联色值不随 body.theme-light 切换，是黑名单里「日间隐形或低对比」的成因；
// 只有与 token 等值的写法才可机械替换（外观不变，仅让主题切换生效）。
{
  const tokenHexes = new Map();
  for (const line of css.split(String.fromCharCode(10))) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('--')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const value = trimmed.slice(colon + 1).split(';')[0].trim();
    if (value.startsWith('#') && !tokenHexes.has(value.toLowerCase())) {
      tokenHexes.set(value.toLowerCase(), trimmed.slice(0, colon).trim());
    }
  }
  const HEX_CHARS = '0123456789abcdefABCDEF';
  const inlineColorOffenders = [];
  const scanInlineStyles = (label, text) => {
    for (const quote of ['style="', "style='"]) {
      let cursor = 0;
      while ((cursor = text.indexOf(quote, cursor)) !== -1) {
        const end = text.indexOf(quote.slice(-1), cursor + quote.length);
        const value = text.slice(cursor + quote.length, end === -1 ? text.length : end);
        const lineNo = text.slice(0, cursor).split(String.fromCharCode(10)).length;
        let i = 0;
        while (i < value.length) {
          if (value[i] !== '#') { i++; continue; }
          let j = i + 1;
          while (j < value.length && HEX_CHARS.indexOf(value[j]) !== -1) j++;
          const size = j - i - 1;
          if (size === 3 || size === 4 || size === 6 || size === 8) {
            const hex = value.slice(i, j).toLowerCase();
            const token = tokenHexes.get(hex);
            if (token) inlineColorOffenders.push(label + ':' + lineNo + ' 写死 ' + hex + '，请改用 var(' + token + ')');
          }
          i = j;
        }
        const hasGradient = value.includes('gradient(') && value.includes('#');
        if (hasGradient) inlineColorOffenders.push(label + ':' + lineNo + ' 内联硬编码渐变，请改为 token（如 var(--brand-gradient)）');
        cursor += quote.length;
      }
    }
  };
  const dirStack = ['./src'];
  while (dirStack.length > 0) {
    const dir = dirStack.pop();
    for (const name of readdirSync(dir)) {
      const full = dir + '/' + name;
      if (statSync(full).isDirectory()) { if (name !== 'node_modules') dirStack.push(full); continue; }
      if (!name.endsWith('.ts') && !name.endsWith('.html')) continue;
      scanInlineStyles(relative(ROOT, full), readFileSync(full, 'utf8'));
    }
  }
  scanInlineStyles('index.html', read('./index.html'));
  check(
    inlineColorOffenders.length === 0,
    '内联样式不得写死设计 token 的颜色值或硬编码渐变：' + inlineColorOffenders.slice(0, 4).join('、'),
  );
}
// ---- 13. var() 不得用自身兜底（等值替换后的退化写法）----
// `var(--accent-red, #ef4444)` 若被机械替换为 `var(--accent-red, var(--accent-red))` 毫无意义：
// token 缺失时整条声明照样失效。要兜底就必须换一个不同的值，否则删掉兜底。
{
  const selfFallback = [];
  const scanSelfFallback = (label, text) => {
    let i = 0;
    while (true) {
      const k = text.indexOf('var(--', i);
      if (k === -1) return;
      let j = k + 6;
      while (j < text.length && text[j] !== ',' && text[j] !== ')') j++;
      const name = text.slice(k + 6, j);
      if (name.length > 0 && text.startsWith(', var(--' + name + '))', j)) {
        const lineNo = text.slice(0, k).split(String.fromCharCode(10)).length;
        selfFallback.push(label + ':' + lineNo + ' var(--' + name + ', var(--' + name + ')) 应简化为 var(--' + name + ')');
      }
      i = j;
    }
  };
  const selfStack = ['./src'];
  while (selfStack.length > 0) {
    const dir = selfStack.pop();
    for (const name of readdirSync(dir)) {
      const full = dir + '/' + name;
      if (statSync(full).isDirectory()) { if (name !== 'node_modules') selfStack.push(full); continue; }
      if (!name.endsWith('.ts') && !name.endsWith('.html')) continue;
      scanSelfFallback(relative(ROOT, full), readFileSync(full, 'utf8'));
    }
  }
  scanSelfFallback('index.html', read('./index.html'));
  check(selfFallback.length === 0, 'var() 不得用自身兜底：' + selfFallback.slice(0, 4).join('、'));
}
// ---- 14. 内联 style 一律不得出现裸 hex 色值 -------------------------------
// 第 12 组只拦「与 token 等值」的写法；本组把它推到终局：内联样式里任何裸色值都不允许——
// 内联色值不参与 body.theme-light 切换，浅色主题下必然失真。
// 例外只能是 token 自身（var(--x)）或透明色（rgba()），不接受按文件白名单。
{
  const bareHex = [];
  const HEXCHARS = '0123456789abcdefABCDEF';
  const scanBareHex = (label, text) => {
    for (const quote of ['style="', "style='"]) {
      let cursor = 0;
      while ((cursor = text.indexOf(quote, cursor)) !== -1) {
        const end = text.indexOf(quote.slice(-1), cursor + quote.length);
        const value = text.slice(cursor + quote.length, end === -1 ? text.length : end);
        const lineNo = text.slice(0, cursor).split(String.fromCharCode(10)).length;
        let i = 0;
        while (i < value.length) {
          if (value[i] !== '#') { i++; continue; }
          let j = i + 1;
          while (j < value.length && HEXCHARS.indexOf(value[j]) !== -1) j++;
          const size = j - i - 1;
          if (size === 3 || size === 4 || size === 6 || size === 8) {
            bareHex.push(label + ':' + lineNo + ' 内联裸色值 ' + value.slice(i, j) + ', 请改用语义 token（var(--token)）');
          }
          i = j;
        }
        cursor += quote.length;
      }
    }
  };
  const bareStack = ['./src'];
  while (bareStack.length > 0) {
    const dir = bareStack.pop();
    for (const name of readdirSync(dir)) {
      const full = dir + '/' + name;
      if (statSync(full).isDirectory()) { if (name !== 'node_modules') bareStack.push(full); continue; }
      if (!name.endsWith('.ts') && !name.endsWith('.html')) continue;
      scanBareHex(relative(ROOT, full), readFileSync(full, 'utf8'));
    }
  }
  scanBareHex('index.html', read('./index.html'));
  check(bareHex.length === 0, '内联 style 不得出现裸 hex 色值（不随主题切换，浅色主题必然失真）：' + bareHex.slice(0, 4).join('、'));
}

// 15. 模态框原语唯一化：同一元素不得同时挂 legacy 与 ui-modal 两套类名，上下文选择器必须指向原语
// 注：本组只守卫 header/footer。`modal-body` 暂不在守卫范围——`.ui-modal__body` 目前不提供
// display:flex/flex-direction/gap（堆叠契约），6 处 ui-modal__body 元素仍靠 legacy `.modal-body`
// 提供 flex + gap:14px；而 `.wpd-modal-body`(2317) 自带 gap:16px 且位置在 `.ui-modal__body` 之前，
// 若把堆叠契约直接加到 `.ui-modal__body` 会把 16px 覆盖成 14px。迁移 body 必须先重排规则顺序。
{
  const LEGACY_MODAL = new Set(['modal-header', 'modal-footer']);
  const mixed = [];
  const LFCH = String.fromCharCode(10);
  const files = [];
  const stack = ['./src'];
  while (stack.length) {
    const cur = stack.pop();
    let st;
    try {
      st = statSync(cur);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const e of readdirSync(cur)) {
        if (e === 'node_modules') continue;
        stack.push(join(cur, e));
      }
      continue;
    }
    if (cur.endsWith('.ts') || cur.endsWith('.html')) files.push(cur);
  }
  files.push('./index.html');
  for (const file of files) {
    const text = read(file);
    const label = relative('.', file);
    let cursor = 0;
    while (true) {
      const at = text.indexOf('class="', cursor);
      if (at < 0) break;
      const start = at + 7;
      const endq = text.indexOf('"', start);
      if (endq < 0) break;
      const tokens = text.slice(start, endq).split(' ').filter((t) => t !== '');
      const hasUi = tokens.some((t) => t.startsWith('ui-modal__'));
      const legacy = tokens.filter((t) => LEGACY_MODAL.has(t));
      if (hasUi && legacy.length) {
        const lineNo = text.slice(0, at).split(LFCH).length;
        mixed.push(label + ':' + lineNo + '（' + legacy.join('/') + '）');
      }
      cursor = endq + 1;
    }
  }
  check(mixed.length === 0, '同一元素不得混用两套模态框类名（legacy modal-header/footer 与 ui-modal__*）：' + mixed.slice(0, 4).join('、'));

  const RETARGETED = [
    'body.theme-light .ocr-review-dialog .ui-modal__header',
    'body.theme-light .ocr-review-dialog .ui-modal__footer',
    '.agedepth-dialog .ui-modal__body',
  ];
  const STALE = [
    'body.theme-light .ocr-review-dialog .modal-header',
    'body.theme-light .ocr-review-dialog .modal-footer',
    '.agedepth-dialog .modal-body',
  ];
  const missRetarget = RETARGETED.filter((sel) => !css.includes(sel));
  const staleHits = STALE.filter((sel) => css.includes(sel));
  check(missRetarget.length === 0, '上下文选择器必须指向模态框原语，缺失：' + missRetarget.join('、'));
  check(staleHits.length === 0, '上下文选择器仍指向 legacy 类名（浅色主题会静默失效）：' + staleHits.join('、'));
  check(!css.includes('primary-btn'), '已退役的 .primary-btn 不得回填（31 行、全仓库零消费者、含 2 处硬编码渐变）');
}

// ---- 16. 动作填充与填充文字必须成对达标（WCAG AA ≥4.5:1）--------------------
// 填充色和它上面的文字颜色是一对契约，不能各自独立取值：饱和填充（品牌蓝/绿/红）
// 配白字在深色主题只有 2.2~3.8:1，浅色主题的 --accent-blue 配白字也只有 4.1:1，
// 这正是「按钮看不清」的量化成因。本组在本机复算 WCAG 相对亮度，不依赖浏览器；
// 契约值、主题重定义与「原语必须引用成对 token」三项一起被守。
{
  const relLum = (hex) => {
    if (typeof hex !== 'string') return null;
    const h = hex.replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const ch = [0, 2, 4]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [relLum(a), relLum(b)].sort((m, n) => n - m);
    return (hi + 0.05) / (lo + 0.05);
  };
  // 取选择器后面的第一个平铺声明块（token 块都是平铺的，无嵌套）
  const blocksOf = (selector) => {
    const out = [];
    let at = css.indexOf(selector);
    while (at >= 0) {
      const open = css.indexOf('{', at);
      const close = css.indexOf('}', open);
      if (open < 0 || close < 0) break;
      out.push(css.slice(open + 1, close));
      at = css.indexOf(selector, close);
    }
    return out;
  };
  const decls = (block) => {
    const map = new Map();
    for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/gi)) map.set(m[1], m[2].trim());
    return map;
  };
  // 解析 var() 引用链，只接受最终落到 #rrggbb 的值
  const resolve = (map, value, depth = 0) => {
    if (depth > 5) return null;
    const t = String(value ?? '').trim();
    if (/^#[0-9a-f]{6}$/i.test(t)) return t;
    const m = t.match(/^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^()]+?)\s*)?\)$/i);
    if (!m) return null;
    if (map.has(m[1])) return resolve(map, map.get(m[1]), depth + 1);
    return m[2] ? resolve(map, m[2], depth + 1) : null;
  };
  const themeTokens = (label, selector, marker) => {
    const block = blocksOf(selector).find((b) => b.includes(marker));
    check(Boolean(block), `对比度契约：找不到${label}主题 token 块（${selector} 内含 ${marker}）`);
    return block ? decls(block) : new Map();
  };
  const dark = themeTokens('深色', ':root', '--text-on-status');
  const light = themeTokens('浅色', 'body.theme-light', '--action-primary-bg');
  for (const [label, map] of [['深色', dark], ['浅色', light]]) {
    for (const kind of ['primary', 'success', 'danger']) {
      const bg = resolve(map, map.get(`--action-${kind}-bg`));
      const fg = resolve(map, map.get(`--action-${kind}-text`));
      check(Boolean(bg && fg), `对比度契约：${label}主题缺少可解析的 --action-${kind}-bg / -text`);
      if (!bg || !fg) continue;
      const r = contrast(bg, fg);
      check(r >= 4.5, `对比度契约：${label}主题 --action-${kind}-bg ${bg} 上的文字 ${fg} 只有 ${r.toFixed(2)}:1（要求 ≥4.5:1）`);
      if (label === '浅色') {
        const darkBg = resolve(dark, dark.get(`--action-${kind}-bg`));
        check(darkBg !== bg, `对比度契约：浅色主题 --action-${kind}-bg 未按主题重定义（与深色同为 ${bg}）`);
      }
    }
    // 状态填充沿用同一契约：填充偏亮配深墨字、偏暗配白字
    for (const kind of ['warning', 'success']) {
      const bg = resolve(map, map.get(`--status-${kind}`));
      const fg = resolve(map, map.get('--text-on-status'));
      if (!bg || !fg) {
        check(false, `对比度契约：${label}主题缺少可解析的 --status-${kind} / --text-on-status`);
        continue;
      }
      const r = contrast(bg, fg);
      check(r >= 4.5, `对比度契约：${label}主题 --status-${kind} ${bg} 上的 --text-on-status ${fg} 只有 ${r.toFixed(2)}:1（要求 ≥4.5:1）`);
    }
  }
  // 原语必须引用成对 token，而不是裸白字或装饰性 --accent-*
  for (const [selector, token] of [
    ['.ui-btn--primary', '--action-primary-bg'],
    ['.ui-btn--danger', '--action-danger-bg'],
    ['.workflow-action-bar__step', '--action-primary-bg'],
  ]) {
    const body = blocksOf(selector)[0] ?? '';
    check(body.includes(`var(${token})`), `对比度契约：${selector} 未使用成对 token var(${token})`);
    check(!/(^|[^-\w])color:\s*#fff/i.test(body), `对比度契约：${selector} 又直接写死白字（填充色一变就会掉出 AA）`);
  }
  // 浅色主题通用 .tool-btn:hover:not(:disabled) 权重 (0,4,1)，会盖掉动作填充并把文字改回
  // --accent-blue：主操作按钮必须同级后置显式覆盖，否则 hover 时身份与对比度一起丢失。
  for (const selector of ['body.theme-light .tool-btn.action:hover', 'body.theme-light .tool-btn.export:hover']) {
    check(css.includes(selector), `对比度契约：缺少 ${selector}（通用 .tool-btn:hover 会覆盖动作填充）`);
  }
  // 深色主题没有主题前缀，通用 .tool-btn:hover:not(:disabled) 是 (0,3,1)，照样压过 (0,2,1) 的动作填充：
  // 基础 hover 规则必须自带 :not(:disabled) 把权重提到同级后置取胜（e2e/contrast.spec.ts 抓到过这条）。
  for (const selector of ['.tool-btn.action:hover', '.tool-btn.export:hover']) {
    check(
      css.includes(`${selector}:not(:disabled)`),
      `对比度契约：${selector} 缺少 :not(:disabled)，权重低于通用 .tool-btn:hover:not(:disabled)，深色主题下动作填充会被覆盖`,
    );
    const block = blocksOf(selector).find((b) => b.includes('var(--action-')) ?? '';
    check(block !== '', `对比度契约：${selector} 未显式恢复成对 token（hover 会把文字改回装饰色）`);
  }
  // 半透明叠加底上的白字：叠加后是小面积浅底，两种主题下都读不出来
  check(
    !/\.segmented-btn:hover\s*\{[^}]*color:\s*#fff/i.test(css),
    '对比度契约：.segmented-btn:hover 又改回白字（底色是 25% 黑叠加，浅色主题下必然不可读）',
  );
  check(
    !/\.open-file-btn:hover\s*\{[^}]*color:\s*#ffffff/i.test(css),
    '对比度契约：.open-file-btn:hover 又改回白字（底色是 25% 蓝色半透明叠加）',
  );
}

if (failures.length > 0) {
  console.error(`✘ UI 一致性门禁失败（${failures.length} 项）:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('✔ UI design tokens、语义控件、状态反馈与文案门禁通过');
