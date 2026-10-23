/** 诊断：步骤 6 手动保存为何不落库。抓完整 RPC 请求/响应与面板状态。 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '..', '..', 'frontend', 'package.json'));
const { chromium } = require('playwright');
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22915);
const BASE = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const log = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
const page = await ctx.newPage();
page.on('request', (r) => { if (r.method()==='POST' && r.url().endsWith('/rpc')) { try { const b=r.postDataJSON(); if(/XTicks|calibrate/i.test(b?.method||'')) log.push({dir:'req', m:b.method, p:b.params}); } catch {} } });
page.on('response', async (r) => { if (!r.url().includes('/rpc')) return; try { const b=await r.json(); const m=r.request().postDataJSON?.()?.method; if(/XTicks|calibrate/i.test(m||'')) log.push({dir:'res', m, err:b.error?.message, res:b.result}); } catch {} });
const rpc = (m,p={}) => page.evaluate(async ([mm,pp]) => { const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:mm,params:pp})}); const b=await r.json(); return b.error?{__err:b.error}:b.result; }, [m,p]);

try {
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout:30000 });
  const [ch] = await Promise.all([ page.waitForEvent('filechooser',{timeout:15000}), page.locator('#btn-open-file').click() ]);
  await ch.setFiles(IMAGE); await page.waitForTimeout(3000);
  const NEXT='#btn-wf-next';
  let stage = await page.evaluate(()=>window.__straditize?.getState?.()?.stage);
  for (let i=0;i<8 && stage<6;i++){ await page.locator(NEXT).click().catch(()=>{}); await page.waitForTimeout(2200); stage = await page.evaluate(()=>window.__straditize?.getState?.()?.stage); }
  await page.waitForTimeout(3000);
  console.log("stage =", stage);
  const panelExists = await page.locator('.step-panel[data-step="6"]').count();
  const v1 = await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').count();
  const v2 = await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').count();
  const saveBtn = await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').count();
  console.log("面板出现次数:", panelExists, "| val1:", v1, "| val2:", v2, "| 保存按钮:", saveBtn);
  const panelState = await page.evaluate(() => {
    const st=(window).__straditize?.getState?.()??{};
    const cols=st.columns??[]; const c=cols.find((x)=>x.id===st.activeTaxaId)??cols[0];
    return { activeTaxaId: st.activeTaxaId, col: c?{id:c.id,col_index:c.col_index,startX:c.startX,endX:c.endX,tickEndX:c.tickEndX,x_ticks:c.x_ticks}:null, ncols: cols.length };
  });
  console.log("面板视角:", JSON.stringify(panelState));
  log.length = 0;
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').fill('0');
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').fill('40');
  console.log("填入值:", await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').inputValue(), await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').inputValue());
  await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').click();
  await page.waitForTimeout(3000);
  console.log("保存后 RPC:", JSON.stringify(log, null, 1).slice(0,1800));
  const after = await rpc('straditize.getDiagramData');
  const c2 = (after.columns||[]).filter((c)=>Array.isArray(c.x_ticks)&&c.x_ticks.length===2);
  console.log("后端已标定列数 =", c2.length, JSON.stringify(c2.slice(0,2).map(c=>({col:c.col_index,x:c.x_ticks}))));
} finally { await ctx.close(); await browser.close(); }
