// 现实场景：上传期间，前端自己有多个 in-flight 请求（getDiagramData 与 detectDeskew 并发）。
// 这里用"真实 UI 上传 + 在途并发读"来测是否出现撕裂，而不是用 Python 猛打。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22913);
const BASE = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const torn = [];
const browser = await chromium.launch({ channel:'msedge', headless:true });
const ctx = await browser.newContext({ viewport:{width:1680,height:1050}, locale:'zh-CN' });
const page = await ctx.newPage();
page.on('response', async res => {
  if (!res.url().includes('/rpc')) return;
  try { const b = await res.json(); const m = res.request().postDataJSON?.()?.method;
    if (m === 'straditize.getDiagramData' && !b.error) {
      const r = b.result ?? {};
      if (r.imageWidth > 0 && (r.rois ?? []).length === 0) torn.push({ w:r.imageWidth, rois:0 });
    }
  } catch {}
});
const rpc = (m,p={}) => page.evaluate(async ([mm,pp]) => {
  const r = await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:mm,params:pp})});
  const b = await r.json(); if (b.error) throw new Error(`${b.error.code} ${b.error.message}`); return b.result;
}, [m,p]);

try {
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout:30000 });

  // 现实并发：上传瞬间，用页面自身发出若干 getDiagramData（模拟 UI 刷新在途）
  for (let i=0;i<6;i++){
    await rpc('project.new',{clear_image:true});
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => Boolean(window.__straditize), undefined, {timeout:30000});
    await page.waitForTimeout(600);
    const [chooser] = await Promise.all([ page.waitForEvent('filechooser',{timeout:15000}), page.locator('#btn-open-file').click() ]);
    await chooser.setFiles(IMAGE);
    // 上传在途时，前端同时打若干读请求（真实 UI 的刷新节拍）
    await Promise.all([1,2,3,4,5].map(() => rpc('straditize.getDiagramData').catch(()=>null)));
    await page.waitForTimeout(2500);
    const a = await rpc('straditize.getDiagramData');
    console.log(`round ${i}: final w=${a.imageWidth} rois=${(a.rois??[]).length}`);
  }
  console.log('\n=== 上传期间前端在途读请求出现撕裂的次数 ===');
  console.log('torn:', torn.length, JSON.stringify(torn.slice(0,6)));
} finally { await ctx.close(); await browser.close(); }
