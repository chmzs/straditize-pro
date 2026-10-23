// 探针 F-1 对照组：证明单次 roi.update 不会被"后台定时器"回滚（6 轮）。
// 用途：排除"是某个定时刷新把 ROI 改回去"的假设，从而把责任定位到步骤 5 的重分列动作。
// 做法：boot 一个真实标签页 → 走 UI 到步骤 6 做一次标定 → 连做 6 次 roi.update，每次 400ms 后回读后端。
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(REPO, 'frontend')] }));
const PORT = Number(process.env.STRADITIZE_ZERO_PORT || 22940);
const BASE = `http://127.0.0.1:${PORT}`;
async function rpc(request, method, params = {}) {
  const res = await request.post(`${BASE}/rpc`, { data: { jsonrpc: '2.0', id: 1, method, params } });
  const b = await res.json();
  if (b.error) throw new Error(`${method} [${b.error.code}] ${b.error.message}`);
  return b.result;
}
const xlim = async (req) => (await rpc(req, 'straditize.getDiagramData')).rois.map((r) => r.xlim);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const req = ctx.request;

  await rpc(req, 'e2e.reset');
  await rpc(req, 'core.loadImage', { sample_key: 'hoya' });
  await rpc(req, 'core.detectColumns', { data_xlim: [315, 1946], data_ylim: [511, 1311] });
  // ui7 的关键区别：先 reload 再 boot
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 90000 });
  await page.waitForTimeout(1000);
  console.log('boot 后后端 xlim =', JSON.stringify(await xlim(req)));
  console.log('boot 后前端 rois =', JSON.stringify(await page.evaluate(() => window.__straditize.getState().rois.map(r=>r.xlim))));

  await page.evaluate(() => window.__straditize.gotoStage(6));
  await page.waitForTimeout(1200);
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').fill('0');
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').fill('40');
  await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').click();
  await page.waitForTimeout(1500);
  console.log('标定后后端 xlim =', JSON.stringify(await xlim(req)));

  // 关键：ui7 用的是 rpcSafe(page, ...) —— 而 driver.cjs 的 rpc() 走 page.request（HTTP 直打）
  let reverted = 0;
  for (let i = 1; i <= 6; i += 1) {
    const lo = 300 + i * 10, hi = 2000 - i * 10;
    const r = await rpc(req, 'roi.update', { roi_id: 'roi_1', x0: lo, x1: hi });
    await page.waitForTimeout(400);
    const after = await xlim(req);
    const ok = JSON.stringify(after[0]) === JSON.stringify([lo, hi]);
    if (!ok) reverted += 1;
    console.log(`  第${i}轮 set=[${lo},${hi}] 返回=${JSON.stringify(r.roi.xlim)} 400ms后=${JSON.stringify(after[0])} ${ok ? 'OK' : 'REVERTED'}`);
  }
  console.log('>>> 回滚轮数 =', reverted, '/6');
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
