#!/usr/bin/env node
/**
 * 静态门禁（#194）：
 * 1. 禁止同一文件/handler 内同时出现 `recordControlPointsBeforeEdit` 与 `history.push`（防双推）；
 * 2. 主画布与桥接层（AgeDepthCanvas.ts / HistoryManager.ts 之外）禁止再调用 `history.push`。
 */
import fs from 'node:fs';
import path from 'node:path';

const srcRoot = path.resolve(import.meta.dirname, 'src');
const violations = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith('.ts')) {
      const rel = path.relative(srcRoot, full).replace(/\\/g, '/');
      if (rel === 'core/HistoryManager.ts' || rel === 'components/agedepth/AgeDepthCanvas.ts') {
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      const hasRecord = /\brecordControlPointsBeforeEdit\b/.test(text);
      const hasHistoryPush = /\bhistory\.push\s*\(/.test(text);
      if (hasRecord && hasHistoryPush) {
        violations.push(`${rel}: 同时出现 recordControlPointsBeforeEdit 与 history.push（双推违禁）`);
      } else if (hasHistoryPush) {
        violations.push(`${rel}: 存在遗留 history.push 调用（主画布应统一走 undoStack）`);
      }
    }
  }
}

walk(srcRoot);

if (violations.length > 0) {
  console.error('✘ 撤销单栈门禁失败：\n  - ' + violations.join('\n  - '));
  process.exit(1);
}
console.log('✔ 撤销单栈门禁通过：无双推与主画布 history.push 残留');
