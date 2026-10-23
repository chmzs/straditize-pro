import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22913);
const BASE = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');
const rpc = async (page, m, p = {}) => page.evaluate(async ([mm, pp]) => {
  const r = await fetch('/rpc', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ jsonrpc:'2.0', id:1, method:mm, params:pp }) });
  const b = await r.json(); if (b.error) throw new Error(`${b.error.code} ${b.error.message}`); return b.result;
}, [m, p]);

const browser = await chromium.launch({ channel:'msedge', headless:true });
const ctx = await browser.newContext({ viewport:{width:1680,height:1050}, locale:'zh-CN' });
const page = await ctx.newPage();
// 只采集"后端权威载荷里出现 image>0 但 rois=0"的撕裂读数
const torn = []; const mirrorTorn = [];
page.on('response', async res => {
  if (!res.url().includes('/rpc')) return;
  try { const b = await res.json(); const m = res.request().postDataJSON?.()?.method;
    if (m === 'straditize.getDiagramData' && !b.error) {
      const r = b.result ?? {};
      if (r.imageWidth > 0 && (r.rois ?? []).length === 0) torn.push({ w:r.imageWidth, rois:0, primaryRoiId:r.primaryRoiId });
    }
  } catch {}
});
try {
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout:30000 });

  const ROUNDS = 6;
  for (let i = 0; i < ROUNDS; i++) {
    await rpc(page, 'project.new', { clear_image:true });
    await page.reload({ waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout:30000 });
    await page.waitForTimeout(800);

    const [chooser] = await Promise.all([ page.waitForEvent('filechooser',{timeout:15000}), page.locator('#btn-open-file').click() ]);
    await chooser.setFiles(IMAGE);
    await page.waitForTimeout(3500);   // 上传链路落定

    const mirror = await page.evaluate(() => { const s = window.__straditize?.getState?.() ?? {}; return { stage:s.stage, rois:(s.rois??[]).length }; });
    const auth = await rpc(page, 'straditize.getDiagramData');
    if (auth.imageWidth > 0 && (auth.rois??[]).length === 0) mirrorTorn.push({ round:i, mirror, auth:{w:auth.imageWidth, rois:0} });
    console.log(`round ${i}: backend w=${auth.imageWidth} rois=${(auth.rois??[]).length} | mirror stage=${mirror.stage} rois=${mirror.rois}`);
  }
  console.log('\n=== 后端撕裂读数（前端自己发起的 getDiagramData） ===');
  console.log('次数:', torn.length, JSON.stringify(torn.slice(0,5)));
  console.log('=== 前端镜像最终停在被撕裂状态 的次数 ===');
  console.log('次数:', mirrorTorn.length, JSON.stringify(mirrorTorn.slice(0,3)));
} finally { await ctx.close(); await browser.close(); }
