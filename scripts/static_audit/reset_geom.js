/**
 * AUDIT SCRATCH — B) 重置后第 4 步清理几何是否残留（后端 + 画布像素双证据）
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:23050';
const PNG = process.env.AUDIT_PNG;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
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

  // 画布上数某特征色的像素（与 e2e helpers.canvasColorPixels 同一方法）
  const colorPixels = (rgb, tol = 24) => page.evaluate(([r, g, b, t]) => {
    const c = document.querySelector('#geology-canvas');
    const ctx2 = c.getContext('2d');
    const d = ctx2.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (Math.abs(d[i] - r) <= t && Math.abs(d[i + 1] - g) <= t && Math.abs(d[i + 2] - b) <= t) n++;
    }
    return n;
  }, [rgb[0], rgb[1], rgb[2], tol]);

  const backendGeom = () => page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:23050/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'straditize.getDiagramData', params: {} }) });
    const b = await r.json();
    const d = b.result || {};
    return {
      line_candidates: (d.line_candidates || []).length,
      exclusion_regions: (d.exclusion_regions || []).length,
      line_strokes: (d.line_strokes || []).length,
      cleanup_stats: d.cleanup && d.cleanup.stats,
      cleanup_roi: d.cleanup && d.cleanup.roi_id,
      columns: (d.columns || []).length,
      rois: (d.rois || []).length,
    };
  });

  const R = {};

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await fetch('http://127.0.0.1:23050/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'audit.resetZero', params: {} }) }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
  await page.waitForTimeout(1200);

  await page.setInputFiles('#file-input-image', PNG); await page.waitForTimeout(7000);
  for (let i = 0; i < 3; i++) { await page.click('#btn-wf-next'); await page.waitForTimeout(4500); } // → step4
  await page.waitForTimeout(4000);

  R.beforeReset = {
    backend: await backendGeom(),
    amberPx: await colorPixels([245, 158, 11]),   // 候选几何琥珀色
    redPx: await colorPixels([239, 68, 68]),      // 已确认几何红色
    stage: await page.evaluate(() => window.__straditize.getState().stage),
  };

  // 真实点击「重置」
  await page.click('#btn-reset-all');
  await page.waitForTimeout(6000);

  R.afterReset = {
    backend: await backendGeom(),
    amberPx: await colorPixels([245, 158, 11]),
    redPx: await colorPixels([239, 68, 68]),
    stage: await page.evaluate(() => window.__straditize.getState().stage),
    imageSrc: await page.evaluate(() => window.__straditize.getState().image.src),
    columns: await page.evaluate(() => window.__straditize.getState().columns.length),
    rois: await page.evaluate(() => window.__straditize.getState().rois.length),
  };

  // 复位后重新上传同一张图（真实用户会这么做），再看几何是否复现
  await page.setInputFiles('#file-input-image', PNG);
  await page.waitForTimeout(8000);
  R.afterReupload = {
    backend: await backendGeom(),
    amberPx: await colorPixels([245, 158, 11]),
    redPx: await colorPixels([239, 68, 68]),
    stage: await page.evaluate(() => window.__straditize.getState().stage),
    columns: await page.evaluate(() => window.__straditize.getState().columns.length),
  };

  // 进入步骤 4 看是否立刻显示上一轮的候选
  await page.click('#btn-wf-next'); await page.waitForTimeout(2000);
  await page.click('#btn-wf-next'); await page.waitForTimeout(2000);
  await page.click('#btn-wf-next'); await page.waitForTimeout(6000);
  R.step4AfterReupload = {
    backend: await backendGeom(),
    amberPx: await colorPixels([245, 158, 11]),
    stage: await page.evaluate(() => window.__straditize.getState().stage),
  };

  R.notices = notices; R.dialogs = dialogs; R.rpcErrors = rpcErrors;
  console.log(JSON.stringify(R, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });