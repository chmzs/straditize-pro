/**
 * AUDIT SCRATCH — 真实 DOM 按钮驱动的从零旅程（不用 gotoStage 测试钩子）。
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:23050';
const PNG = process.env.AUDIT_PNG;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();

  const consoleErrors = [], pageErrors = [], rpcErrors = [], dialogs = [], notices = [], rpcLog = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', async (d) => { dialogs.push(`[${d.type()}] ${d.message()}`); await d.dismiss(); });
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/rpc')) {
      try { rpcLog.push(JSON.parse(r.postData() || '{}').method); } catch {}
    }
  });
  page.on('response', async (res) => {
    if (!res.url().includes('/rpc')) return;
    try {
      const b = await res.json();
      if (b && b.error) {
        let m = '?'; try { m = JSON.parse(res.request().postData() || '{}').method || '?'; } catch {}
        rpcErrors.push(`${m} [${b.error.code}] ${b.error.message}`);
      }
    } catch {}
  });
  await page.exposeFunction('__auditNotice', (t) => { const s = String(t || '').trim(); if (s) notices.push(s); });
  await page.addInitScript(() => {
    const SEL = '.ui-toast, #rpc-error-modal, #ui-detail-modal';
    let seen = new WeakSet();
    const rec = (el) => { const x = (el.textContent || '').trim(); if (x && window.__auditNotice) window.__auditNotice(x); };
    const once = (el) => { if (seen.has(el)) return; seen.add(el); rec(el); };
    const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches && n.matches(SEL)) once(n); if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(once); };
    const start = () => { scan(document.documentElement); new MutationObserver((rs) => { seen = new WeakSet(); for (const r of rs) r.addedNodes.forEach(scan); }).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  });

  const out = { stages: [], all: {} };
  const mark = (label) => ({ label, c: consoleErrors.length, p: pageErrors.length, r: rpcErrors.length, d: dialogs.length, n: notices.length, rpcs: rpcLog.length });
  const snap = async (label, m) => {
    const st = await page.evaluate(() => {
      const a = window.__straditize; if (!a) return { handle: false };
      const s = a.getState();
      return { handle: true, stage: s.stage, imageSrc: s.imageSrc, rois: (s.rois || []).length, columns: (s.columns || []).length, activeTaxaId: s.activeTaxaId, isCalibrated: s.calibration && s.calibration.isCalibrated };
    });
    out.stages.push({
      label, state: st,
      newRpc: rpcLog.slice(m.rpcs),
      newConsoleErrors: consoleErrors.slice(m.c),
      newPageErrors: pageErrors.slice(m.p),
      newRpcErrors: rpcErrors.slice(m.r),
      newDialogs: dialogs.slice(m.d),
      newNotices: notices.slice(m.n),
    });
  };
  const backend = (mm, pp) => page.evaluate(async ([m, p]) => {
    const r = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p || {} }) });
    const b = await r.json(); if (b.error) throw new Error(`${m} [${b.error.code}] ${b.error.message}`); return b.result;
  }, [mm, pp]);

  // 复位到零态
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'audit.resetZero', params: {} }) }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
  await page.waitForTimeout(1500);

  let m = mark('boot');
  await snap('01_boot_zero', m);

  // 真实 UI 上传
  m = mark('upload');
  await page.setInputFiles('#file-input-image', PNG);
  await page.waitForTimeout(7000);
  await snap('02_after_real_upload', m);

  // 逐步点真实 #btn-wf-next
  for (let i = 0; i < 7; i++) {
    m = mark(`next${i}`);
    const label = await page.evaluate(() => {
      const b = document.querySelector('#btn-wf-next');
      return b ? b.textContent.trim() : null;
    });
    if (!label) { out.stages.push({ label: `next${i}_NO_BUTTON`, note: '找不到 #btn-wf-next' }); break; }
    await page.click('#btn-wf-next', { timeout: 15000 }).catch(async (e) => {
      out.stages.push({ label: `next${i}_CLICK_THREW`, error: String(e.message).slice(0, 300) });
    });
    await page.waitForTimeout(4500);
    await snap(`03_click_next_${i + 1}_[${label}]`, m);
  }

  m = mark('final');
  const d = await backend('straditize.getDiagramData');
  out.all = {
    backendColumns: (d.columns || []).length,
    backendRois: (d.rois || []).length,
    col0: d.columns?.[0] ? { id: d.columns[0].id, startX: d.columns[0].startX, endX: d.columns[0].endX, x_ticks: d.columns[0].x_ticks } : null,
    consoleErrors, pageErrors, rpcErrors, dialogs, notices,
    fullRpcLog: rpcLog,
  };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
