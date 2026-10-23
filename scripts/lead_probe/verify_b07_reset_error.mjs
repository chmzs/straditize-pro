/** Lead 独立复核 B-07：点【重置全部操作】是否必然产生一条 -32001 失败。 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', '..', 'frontend', 'package.json'));
const { chromium } = require('playwright');
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22916);
const BASE = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const rpcErrors = [], dialogs = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
const page = await ctx.newPage();
page.on('dialog', async (d) => { dialogs.push(`${d.type()}: ${d.message().slice(0, 60)}`); await d.accept(); });
page.on('response', async (res) => {
  if (!res.url().includes('/rpc')) return;
  try { const b = await res.json();
    if (b?.error) rpcErrors.push(`${res.request().postDataJSON?.()?.method} [${b.error.code}] ${b.error.message.slice(0,90)}`);
  } catch {}
});
const rpc = (m, p = {}) => page.evaluate(async ([mm, pp]) => {
  const r = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: mm, params: pp }) });
  const b = await r.json(); if (b.error) throw new Error(`${b.error.code} ${b.error.message}`); return b.result;
}, [m, p]);

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 30000 });
  const [chooser] = await Promise.all([ page.waitForEvent('filechooser', { timeout: 15000 }), page.locator('#btn-open-file').click() ]);
  await chooser.setFiles(IMAGE);
  await page.waitForTimeout(3000);
  // 造一点清理编辑，确保重置时有东西要重算
  await page.locator('#btn-wf-next').click(); await page.waitForTimeout(1500);  // ->2
  await page.locator('#btn-apply-roi-next').click(); await page.waitForTimeout(1500); // ->3
  await page.locator('#btn-wf-next').click(); await page.waitForTimeout(1500);  // ->4

  rpcErrors.length = 0;
  const before = await rpc('straditize.getDiagramData');
  await page.locator('#btn-reset-all').click();
  await page.waitForTimeout(4000);
  const after = await rpc('straditize.getDiagramData');
  console.log(JSON.stringify({
    重置前列数: (before.columns||[]).length, 重置前列数_rois: (before.rois||[]).length,
    重置后列数: (after.columns||[]).length, 重置后rois: (after.rois||[]).length,
    重置触发的失败RPC: rpcErrors,
    dialogs,
  }, null, 2));
} finally { await ctx.close(); await browser.close(); }
