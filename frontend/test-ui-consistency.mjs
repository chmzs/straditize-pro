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

if (failures.length > 0) {
  console.error(`✘ UI 一致性门禁失败（${failures.length} 项）:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log('✔ UI design tokens、语义控件、状态反馈与文案门禁通过');
