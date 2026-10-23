/**
 * AUDIT SCRATCH — 端到端取证：从零 → 上传 → 8 步 → 导出，抓 x_ticks 与 CSV。
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
  page.on('response', async (res) => {
    if (!res.url().includes('/rpc')) return;
    try { const b = await res.json(); if (b && b.error) rpcErrors.push(`${b.error.code} ${b.error.message}`); } catch {}
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

  await page.setInputFiles('#file-input-image', PNG);
  await page.waitForTimeout(7000);

  // 走真实按钮到步骤 5
  for (let i = 0; i < 4; i++) { await page.click('#btn-wf-next'); await page.waitForTimeout(4000); }

  const afterSplit = await backend('straditize.getDiagramData');
  const ticksBeforeStep6 = afterSplit.columns.map((c) => ({ id: c.id, x_ticks: c.x_ticks, tickEndX: c.tickEndX, startX: c.startX, endX: c.endX }));

  // 进入步骤 6（触发自动提取）
  await page.click('#btn-wf-next');
  await page.waitForTimeout(6000);

  const afterStep6 = await backend('straditize.getDiagramData');
  const ticksAfter = afterSplit.columns.map((c, i) => {
    const a = afterStep6.columns[i];
    return { id: a.id, startX: a.startX, endX: a.endX, tickEndX: a.tickEndX, x_ticks: a.x_ticks };
  });

  // 走到步骤 8 并导出
  await page.click('#btn-wf-next'); await page.waitForTimeout(3500);
  await page.click('#btn-wf-next'); await page.waitForTimeout(8000);

  const qa = await backend('qa.summarize', {});
  const exp = await backend('core.exportData', { format: 'csv', strict: false });
  const csv = exp.csv_content || exp.csv || '';
  const csvHead = csv.split('\n').slice(0, 4).join('\n');

  // 面板上用户看到的进度
  const panelText = await page.evaluate(() => {
    const p = document.querySelector('.step-panel[data-step="8"]');
    return p ? (p.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 600) : null;
  });

  console.log(JSON.stringify({
    ticksBeforeStep6, ticksAfter, qa, csvHeader: csv.split('\n')[0], csvHead,
    csvLines: csv.split('\n').length, panelText, dialogs, rpcErrors,
  }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
