// 用户可复现场景：同一后端上开两个浏览器标签页（用户真的会这么干），
// 一个在传图，另一个在轮询刷新 —— 两条前端链路天然并发。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22913);
const BASE = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const torn = [];
const browser = await chromium.launch({ channel:'msedge', headless:true });
const ctx = await browser.newContext({ viewport:{width:1280,height:800}, locale:'zh-CN' });
const A = await ctx.newPage();
const B = await ctx.newPage();
for (const p of [A, B]) {
  p.on('response', async res => {
    if (!res.url().includes('/rpc')) return;
    try { const b = await res.json(); const m = res.request().postDataJSON?.()?.method;
      if (m === 'straditize.getDiagramData' && !b.error) {
        const r = b.result ?? {};
        if (r.imageWidth > 0 && (r.rois ?? []).length === 0) torn.push({ w:r.imageWidth, rois:0, tab: p===A?'A':'B' });
      }
    } catch {}
  });
}
const rpc = (p,m,params={}) => p.evaluate(async ([mm,pp]) => {
  const r = await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:mm,params:pp})});
  const b = await r.json(); if (b.error) throw new Error(`${b.error.code} ${b.error.message}`); return b.result;
}, [m,params]);
const boot = async p => { await p.goto(BASE,{waitUntil:'domcontentloaded'}); await p.waitForFunction(()=>Boolean(window.__straditize),undefined,{timeout:30000}); };

try {
  await boot(A); await boot(B);
  for (let i=0;i<6;i++){
    await rpc(A,'project.new',{clear_image:true});
    await A.reload({waitUntil:'domcontentloaded'}); await B.reload({waitUntil:'domcontentloaded'});
    await boot(A); await boot(B);
    await A.waitForTimeout(600);

    // 标签 A 上传；标签 B 同时疯狂轮询（两个前端天然并发打同一后端）
    const poll = (async () => { for (let k=0;k<25;k++) { await rpc(B,'straditize.getDiagramData').catch(()=>null); } })();
    const [chooser] = await Promise.all([ A.waitForEvent('filechooser',{timeout:15000}), A.locator('#btn-open-file').click() ]);
    await chooser.setFiles(IMAGE);
    await poll;
    await A.waitForTimeout(2000);
    const a = await rpc(A,'straditize.getDiagramData');
    console.log(`round ${i}: final w=${a.imageWidth} rois=${(a.rois??[]).length}`);
  }
  console.log('\n=== 两标签页并发下出现撕裂读数的次数 ===');
  console.log('torn:', torn.length, JSON.stringify(torn.slice(0,8)));
} finally { await ctx.close(); await browser.close(); }
