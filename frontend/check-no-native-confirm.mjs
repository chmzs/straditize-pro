import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walkTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      results.push(...walkTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

const violations = [];
for (const file of walkTsFiles('./src')) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//')) return;
    if (/\bwindow\.confirm\s*\(/.test(line)) {
      violations.push(`${file}:${idx + 1}: ${trimmed}`);
    }
  });
}

assert.equal(
  violations.length,
  0,
  `frontend/src 中禁止再调用原生 window.confirm（请改用 ui/confirm.ts 的 showConfirmDialog）：\n${violations.join('\n')}`
);
console.log('✔ 原生 window.confirm 清零门禁通过：frontend/src 0 处调用');
