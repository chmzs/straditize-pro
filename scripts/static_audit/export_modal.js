/**
 * AUDIT SCRATCH — 导出弹窗在「用户从未标定任何刻度」时的实际呈现。
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:23050';
const PNG = process.env.AUDIT_PNG;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN', acceptDownloads: true });
  const page = await ctx.newPage();
  const dialogs = [], rpcErrors = [];
  page.on('dialog', async (d) => { dialogs.push(`[${d.type()}] ${d.message()}`); await d.dismiss(); });
  page.on('response', async (res) => { if (!res.url().includes('/rpc')) return; try { const b = await res.json(); if (b && b.error) rpcErrors.push(`${b.error.code} ${b.error.message}`); } catch {} });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'audit.resetZero', params: {} }) }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
  await page.waitForTimeout(1200);
  await page.setInputFiles('#file-input-image', PNG);
  await page.waitForTimeout(7000);
  for (let i = 0; i < 7; i++) { await page.click('#btn-wf-next'); await page.waitForTimeout(4500); }

  // 顶栏导出按钮
  const exportBtnSel = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => /导出/.test(x.textContent || ''));
    if (!b) return null;
    if (!b.id) b.id = 'audit-export-btn';
    return b.id;
  });

  const res = { exportBtnSel, dialogs: [], rpcErrors: [] };
  if (exportBtnSel) {
    await page.click('#' + exportBtnSel);
    await page.waitForTimeout(5000);
    res.modalOpen = await page.evaluate(() => Boolean(document.querySelector('.wpd-export-dialog')));
    res.sumBanner = await page.evaluate(() => {
      const el = document.querySelector('#wpd-sum-check-banner');
      return el ? { cls: el.className, text: (el.textContent || '').replace(/\s+/g, ' ').trim() } : null;
    });
    res.readiness = await page.evaluate(() => {
      const el = document.querySelector('#export-readiness-container');
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
    });
    res.status = await page.evaluate(() => document.querySelector('#export-readiness-status')?.textContent.trim() ?? null);
    res.textareaHead = await page.evaluate(() => {
      const t = document.querySelector('.wpd-export-dialog textarea');
      return t ? String(t.value).split('\n').slice(0, 3) : null;
    });
    res.anyWarningAboutCalibration = await page.evaluate(() => {
      const t = (document.querySelector('.wpd-export-dialog')?.textContent || '');
      return {
        mentionsUncalibrated: /未标定/.test(t),
        mentionsEstimate: /估算/.test(t),
        mentionsWidthPercent: /列宽百分比|按列宽/.test(t),
      };
    });
  }
  res.dialogs = dialogs;
  res.rpcErrors = rpcErrors;
  console.log(JSON.stringify(res, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });