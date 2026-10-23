/**
 * AUDIT SCRATCH — 用户可见症状取证：图 A 上做完第 4 步 → 直接上传图 B
 * 期望：图 B 是干净的（第 4 步没有任何几何）
 * 实测：图 A 的候选/已确认几何原样出现在图 B 上
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE = 'http://127.0.0.1:23050';
const PNG_A = process.env.PNG_A;
const PNG_B = process.env.PNG_B;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const dialogs = [], notices = [];
  page.on('dialog', async (d) => { dialogs.push(`[${d.type()}] ${d.message().slice(0, 200)}`); await d.dismiss(); });
  await page.exposeFunction('__n', (t) => { const s = String(t || '').trim(); if (s) notices.push(s); });
  await page.addInitScript(() => {
    const SEL = '.ui-toast, #rpc-error-modal, #ui-detail-modal'; let seen = new WeakSet();
    const rec = (e) => { const x = (e.textContent || '').trim(); if (x && window.__n) window.__n(x); };
    const once = (e) => { if (seen.has(e)) return; seen.add(e); rec(e); };
    const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches && n.matches(SEL)) once(n); if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(once); };
    const st = () => { scan(document.documentElement); new MutationObserver((rs) => { seen = new WeakSet(); for (const r of rs) r.addedNodes.forEach(scan); }).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.documentElement) st(); else document.addEventListener('DOMContentLoaded', st, { once: true });
  });

  const geom = () => page.evaluate(async () => {
    const r = await fetch('http://127.0.0.1:23050/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'straditize.getDiagramData', params: {} }) });
    const b = await r.json(); const d = b.result || {};
    return {
      img: { w: d.imageWidth, h: d.imageHeight },
      cand: (d.line_candidates || []).length,
      removed: (d.line_candidates || []).filter((c) => c.status === 'removed').length,
      excl: (d.exclusion_regions || []).length,
      stats: d.cleanup && d.cleanup.stats,
    };
  });
  const colorPixels = (rgb, tol = 24) => page.evaluate(([r, g, b, t]) => {
    const c = document.querySelector('#geology-canvas'); const x = c.getContext('2d');
    const d = x.getImageData(0, 0, c.width, c.height).data; let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (Math.abs(d[i] - r) <= t && Math.abs(d[i + 1] - g) <= t && Math.abs(d[i + 2] - b) <= t) n++;
    }
    return n;
  }, [rgb[0], rgb[1], rgb[2], tol]);

  const R = {};
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await fetch('http://127.0.0.1:23050/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'audit.resetZero', params: {} }) }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
  await page.waitForTimeout(1200);

  // 上传图 A，走到步骤 4，让自动检测生成候选几何
  await page.setInputFiles('#file-input-image', PNG_A);
  await page.waitForTimeout(7000);
  const clickNext = async () => { await page.evaluate(() => document.querySelector('#rpc-error-modal')?.remove()); await page.click('#btn-wf-next'); };
  for (let i = 0; i < 3; i++) { await clickNext(); await page.waitForTimeout(4500); }
  await page.waitForTimeout(4000);
  R['1_图A_步骤4'] = { geom: await geom(), amberPx: await colorPixels([245, 158, 11]), redPx: await colorPixels([239, 68, 68]) };

  // 直接上传图 B（前端会 confirm 是否清空工作区）
  page.once('dialog', async (d) => { await d.accept(); });
  await page.setInputFiles('#file-input-image', PNG_B);
  await page.waitForTimeout(9000);
  R['2_上传图B后_未点重置'] = { geom: await geom(), amberPx: await colorPixels([245, 158, 11]), redPx: await colorPixels([239, 68, 68]) };

  // 走到步骤 4 看画布
  for (let i = 0; i < 3; i++) { await clickNext(); await page.waitForTimeout(4500); }
  await page.waitForTimeout(5000);
  R['3_图B_步骤4'] = { geom: await geom(), amberPx: await colorPixels([245, 158, 11]), redPx: await colorPixels([239, 68, 68]) };

  R.dialogs = dialogs; R.notices = notices.slice(-6);
  console.log(JSON.stringify(R, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });