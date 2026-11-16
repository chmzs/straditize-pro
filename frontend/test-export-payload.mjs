// 导出下载契约：拿不到 base64 必须抛错（不许静默跳过）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requireExportBase64 } from './src/core/exportPayload.ts';

// 1) 正常：拿到 base64 原样返回
assert.equal(requireExportBase64({ base64: 'UEsDBA==' }, '导出 LiPD'), 'UEsDBA==');

// 2) 缺陷场景：后端只回 lipd 字典（旧 export_multi_lipd 的返回）→ 必须抛错
let threw = null;
try {
  requireExportBase64({ success: true, lipd: { x: 1 } }, '导出 LiPD');
} catch (error) {
  threw = error;
}
assert.ok(threw, '缺 base64 时必须抛错，不许静默返回');
assert.match(threw.message, /导出 LiPD/, '错误消息要带标签');
assert.match(threw.message, /lipd/, '错误消息要带后端实际返回的键名');

// 3) 写盘模式：base64 为 null → 同样抛错，并提示写盘路径
threw = null;
try {
  requireExportBase64({ base64: null, output_path: '/tmp/x.lpd' }, '导出 LiPD');
} catch (error) {
  threw = error;
}
assert.ok(threw);
assert.match(threw.message, /\/tmp\/x\.lpd/, '写盘模式要提示路径');

// 4) 空串也要抛（atob("") 会得到空 Blob，下载一个 0 字节文件同样是静默失败）
assert.throws(() => requireExportBase64({ base64: '' }, '导出 XLSX'));

// 5) 源码级：ExportModal 里不得再有静默的 if (res && res.base64)
const source = readFileSync('./src/components/ExportModal.ts', 'utf8');
assert.ok(!/res\s*&&\s*res\.base64/.test(source), 'ExportModal 仍有静默的 base64 判断');
assert.ok(source.includes('requireExportBase64(res, '), '两个下载按钮都必须走会抛错的入口');

console.log('ALL PASS export-payload');
