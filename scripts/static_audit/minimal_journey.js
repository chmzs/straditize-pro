/**
 * AUDIT SCRATCH — 最小用户旅程取证：上传 → 连续点「下一步」7 次 → 导出。
 * 用户全程不标定任何刻度。检查导出的 CSV 是否仍是一份"看起来正常的百分比矩阵"。
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:23050';
const PNG = process.env.AUDIT_PNG;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();
  const dialogs = [], rpcErrors = [], notices = [], rpcLog = [];
  page.on('dialog', async (d) => { dialogs.push(`[${d.type()}] ${d.message()}`); await d.dismiss(); });
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/rpc')) { try { rpcLog.push(JSON.parse(r.postData() || '{}').method); } catch {} } });
  page.on('response', async (res) => { if (!res.url().includes('/rpc')) return; try { const b = await res.json(); if (b && b.error) rpcErrors.push(`${b.error.code} ${b.error.message}`); } catch {} });
  await page.exposeFunction('__n', (t) => { const s = String(t || '').trim(); if (s) notices.push(s); });
  await page.addInitScript(() => {
    const SEL = '.ui-toast, #rpc-error-modal, #ui-detail-modal'; let seen = new WeakSet();
    const rec = (e) => { const x = (e.textContent || '').trim(); if (x && window.__n) window.__n(x); };
    const once = (e) => { if (seen.has(e)) return; seen.add(e); rec(e); };
    const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches && n.matches(SEL)) once(n); if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(once); };
    const st = () => { scan(document.documentElement); new MutationObserver((rs) => { seen = new WeakSet(); for (const r of rs) r.addedNodes.forEach(scan); }).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.documentElement) st(); else document.addEventListener('DOMContentLoaded', st, { once: true });
  });

  const backend = (mm, pp) => page.evaluate(async ([m, p]) => {
    const r = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p || {} }) });
    const b = await r.json(); if (b.error) throw new Error(`${m} [${b.error.code}] ${b.error.message}`); return b.result;
  }, [mm, pp]);

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'audit.resetZero', params: {} }) }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
  await page.waitForTimeout(1200);

  const trace = [];
  await page.setInputFiles('#file-input-image', PNG);
  await page.waitForTimeout(7000);
  trace.push({ at: 'after_upload', stage: await page.evaluate(() => window.__straditize.getState().stage) });

  for (let i = 0; i < 7; i++) {
    const lbl = await page.evaluate(() => document.querySelector('#btn-wf-next')?.textContent.trim());
    await page.click('#btn-wf-next');
    await page.waitForTimeout(4500);
    trace.push({ at: `next_${i + 1}`, btn: lbl, stage: await page.evaluate(() => window.__straditize.getState().stage) });
  }

  // 导出就绪清单：用户此刻看到什么
  const readiness = await page.evaluate(() => {
    const el = document.querySelector('#export-readiness-container');
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
  });
  const calibLabel = await page.evaluate(() => document.querySelector('#lbl-export-calibration-status')?.textContent.trim() ?? null);

  const d = await backend('straditize.getDiagramData');
  const uncal = d.columns.filter((c) => !(Array.isArray(c.x_ticks) && c.x_ticks.length === 2)).length;

  const exp = await backend('core.exportData', { format: 'csv', strict: false });
  const csv = exp.csv_content || exp.csv || '';
  const lines = csv.split('\n');
  const row1 = lines[1] ? lines[1].split(',') : [];
  const vals = row1.slice(1).map(Number).filter(Number.isFinite);

  // strict=true 时后端应拒绝
  let strictResult;
  try { const s = await backend('core.exportData', { format: 'csv', strict: true }); strictResult = { ok: true, rows: s.rows_count }; }
  catch (e) { strictResult = { ok: false, err: String(e.message).slice(0, 200) }; }

  console.log(JSON.stringify({
    trace,
    columns: d.columns.length,
    uncalibratedColumns: uncal,
    calibrationIsCalibrated: d.calibration.isCalibrated,
    readinessText: readiness,
    calibLabel,
    csvHeader: lines[0],
    csvLineCount: lines.length,
    csvRow1Values: vals.slice(0, 10),
    csvRow1Min: Math.min(...vals), csvRow1Max: Math.max(...vals),
    csvRow1NonZero: vals.filter((v) => v !== 0).length,
    strictExport: strictResult,
    notices, dialogs, rpcErrors,
  }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });