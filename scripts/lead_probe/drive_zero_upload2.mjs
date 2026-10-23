import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22910);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const rpcMethods = [], rpcErrors = [], consoleErrors = [], dialogs = [], notices = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
const page = await context.newPage();
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
// 关键：显式接管 dialog，记录文本后再 dismiss（默认自动 dismiss 会掩盖"被 confirm 拦下"）
page.on('dialog', async d => { dialogs.push(`${d.type()}: ${d.message()}`); await d.dismiss(); });
page.on('request', req => {
  if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
  try { const b = req.postDataJSON(); if (b?.method) rpcMethods.push(b.method); } catch {}
});
page.on('response', async res => {
  if (!res.url().includes('/rpc')) return;
  try { const b = await res.json(); if (b?.error) rpcErrors.push(`${b.error.code} ${b.error.message}`); } catch {}
});
await page.exposeFunction('__probeNotice', t => { if (t && t.trim()) notices.push(t.trim()); });
await page.addInitScript(() => {
  const SEL = '.ui-toast, #rpc-error-modal, #ui-detail-modal';
  const rec = el => { const t = (el.textContent ?? '').trim(); if (t) window.__probeNotice?.(t); };
  let seen = new WeakSet();
  const scan = n => { if (n.nodeType !== 1) return; if (n.matches?.(SEL)) { if(!seen.has(n)){seen.add(n);rec(n);} } n.querySelectorAll?.(SEL).forEach(e => { if(!seen.has(e)){seen.add(e);rec(e);} }); };
  const start = () => { scan(document.documentElement); new MutationObserver(rs => { seen = new WeakSet(); rs.forEach(r => r.addedNodes.forEach(scan)); }).observe(document.documentElement, { childList: true, subtree: true }); };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
});

const diagram = () => page.evaluate(async () => {
  const res = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'straditize.getDiagramData', params: {} }) });
  const b = await res.json(); if (b.error) throw new Error(`${b.error.code} ${b.error.message}`); return b.result;
});

const out = {};
try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 30_000 });
  const z = await diagram();
  out.zero = { w: z.imageWidth, h: z.imageHeight, rois: (z.rois??[]).length };
  const historyBefore = await page.evaluate(() => window.__straditize?.getState?.() ?? null);
  out.historyBeforeUpload = { hasHistoryKeys: Object.keys(historyBefore ?? {}).filter(k => /undo|redo|history/i.test(k)) };

  const methodsBefore = rpcMethods.length;
  const [chooser] = await Promise.all([ page.waitForEvent('filechooser', { timeout: 15_000 }), page.locator('#btn-open-file').click() ]);
  await chooser.setFiles(IMAGE);
  out.filechooserOpened = true;

  // 真正的 Node 侧轮询：给上传链路 20s
  let final = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const d = await diagram();
    if (d.imageWidth > 0) { final = d; break; }
  }
  out.rpcAfterUpload = rpcMethods.slice(methodsBefore);
  out.after = final ? { w: final.imageWidth, h: final.imageHeight, rois: (final.rois??[]).length, cols: (final.columns??[]).length }
                     : { w: 0, h: 0, rois: 0, cols: 0, note: '20s 内后端宽度始终为 0' };
  out.dialogs = dialogs; out.notices = notices; out.rpcErrors = rpcErrors; out.consoleErrors = consoleErrors;
  console.log(JSON.stringify(out, null, 2));
} catch (e) {
  out.fatal = String(e?.message ?? e); out.dialogs = dialogs; out.notices = notices;
  out.rpcErrors = rpcErrors; out.consoleErrors = consoleErrors;
  console.log(JSON.stringify(out, null, 2)); process.exitCode = 1;
} finally { await context.close(); await browser.close(); }
