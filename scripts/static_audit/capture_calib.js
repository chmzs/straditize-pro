/**
 * AUDIT SCRATCH — 抓取进入步骤 6 时自动发出的 column.calibrateXTicks 的**真实请求体**。
 * 判据：用户从未输入任何读数，这些请求里的 value 是从哪来的？
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:23050';
const PNG = process.env.AUDIT_PNG;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  const calibBodies = [];
  page.on('request', (r) => {
    if (r.method() !== 'POST' || !r.url().endsWith('/rpc')) return;
    try {
      const b = JSON.parse(r.postData() || '{}');
      if (b.method === 'column.calibrateXTicks') calibBodies.push(b.params);
    } catch {}
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { await fetch('http://127.0.0.1:23050/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'audit.resetZero', params: {} }) }); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
  await page.waitForTimeout(1200);

  await page.setInputFiles('#file-input-image', PNG);
  await page.waitForTimeout(7000);

  // 走到步骤 5（每步先清掉可能出现的错误弹窗，避免遮挡按钮）
  const clickNext = async () => {
    await page.evaluate(() => document.querySelector('#rpc-error-modal')?.remove());
    await page.click('#btn-wf-next');
  };
  for (let i = 0; i < 4; i++) { await clickNext(); await page.waitForTimeout(4500); }
  const before = calibBodies.length;

  // 进入步骤 6（自动提取）
  await clickNext(); await page.waitForTimeout(7000);
  const firstEntry = calibBodies.slice(before);

  // 退回 5 再进 6（第二次自动提取）
  await page.evaluate(() => document.querySelector('#rpc-error-modal')?.remove());
  await page.click('#btn-wf-prev'); await page.waitForTimeout(6000);
  const mid = calibBodies.length;
  await clickNext(); await page.waitForTimeout(7000);
  const secondEntry = calibBodies.slice(mid);

  // 用户主动点「自动提取」按钮
  const thirdBefore = calibBodies.length;
  await page.click('.step-panel[data-step="6"] #btn-detect-xticks').catch(() => {});
  await page.waitForTimeout(7000);
  const manualEntry = calibBodies.slice(thirdBefore);

  console.log(JSON.stringify({
    首次进入步骤6_自动发出的标定请求数: firstEntry.length,
    首次进入步骤6_请求体样本: firstEntry.slice(0, 3),
    第二次进入步骤6_请求数: secondEntry.length,
    用户手动点自动提取_请求数: manualEntry.length,
    全部请求: calibBodies,
  }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });