// 探针 F-1：点【下一步】重新分列会静默回滚后端已接受的 ROI。
//
// 复刻真实用户路径：boot → 步骤 6 用 UI 标定 X 刻度 → 改 ROI（后端确认接受）
// → 步骤 4 → 点【下一步】触发 core.detectColumns → 回读后端 ROI。
//
// 每一步之后都回读后端 rois[].xlim，所以"哪一步改的"是可判定的。
//
//   cd frontend && STRADITIZE_ZERO_PORT=22940 node ../scripts/zero_flow_probes/probe_f1_roi_rollback.cjs
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const { chromium } = require(
  require.resolve('playwright', { paths: [path.join(REPO, 'frontend')] })
);
const PORT = Number(process.env.STRADITIZE_ZERO_PORT || 22940);
const BASE = `http://127.0.0.1:${PORT}`;

async function rpc(req, method, params = {}) {
  const res = await req.post(`${BASE}/rpc`, { data: { jsonrpc: '2.0', id: 1, method, params } });
  const b = await res.json();
  if (b.error) throw new Error(`${method} [${b.error.code}] ${b.error.message}`);
  return b.result;
}
const xl = async (req) =>
  (await rpc(req, 'straditize.getDiagramData')).rois.map(
    (r) => `${r.id}:${JSON.stringify(r.xlim)}`
  );

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const req = ctx.request;
  const show = async (tag) => console.log(`  ${tag}: 后端 ${JSON.stringify(await xl(req))}`);

  await rpc(req, 'e2e.reset');
  await rpc(req, 'core.loadImage', { sample_key: 'hoya' });
  await rpc(req, 'core.detectColumns', { data_xlim: [315, 1946], data_ylim: [511, 1311] });
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 90_000 });
  await page.waitForTimeout(1000);
  await show('boot');

  await page.evaluate(() => window.__straditize.gotoStage(6));
  await page.waitForTimeout(1200);
  await show('gotoStage(6)');

  // 步骤 6：真实 UI 输入两个读数 → 点【保存】
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').fill('0');
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').fill('40');
  await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').click();
  await page.waitForTimeout(1500);
  await show('UI 标定后');

  // 改 ROI：后端确实接受
  await rpc(req, 'roi.update', { roi_id: 'roi_1', x0: 355, x1: 1906 });
  await page.waitForTimeout(400);
  await show('roi.update 后');

  await page.evaluate(() => window.__straditize.gotoStage(4));
  await page.waitForTimeout(1200);
  await show('gotoStage(4) 后');

  // 关键一步：真实点击【下一步】
  await page.locator('#btn-wf-next').click();
  await page.waitForTimeout(6000);
  await show('点【下一步】(重分列) 后');

  const st = await page.evaluate(() => window.__straditize.getState());
  console.log(
    '  前端 rois =',
    JSON.stringify(st.rois.map((r) => r.xlim)),
    '| legacyRoi =',
    JSON.stringify(st.legacyRoi)
  );
  await browser.close();
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
