import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22913);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const seq = [];
let id = 0;
const dialogs = [], notices = [], consoleErrors = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
const page = await context.newPage();
page.on('console', m => { if (m.type()==='error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(`pageerror: ${e.message}`));
page.on('dialog', async d => { dialogs.push(`${d.type()}: ${d.message()}`); await d.dismiss(); });
page.on('request', req => {
  if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
  try { const b = req.postDataJSON();
    seq.push({ n: ++id, dir:'req', method: b?.method, params: b?.method==='core.loadImage' ? {dataLen:(b.params?.image_data??'').length, w:b.params?.width, h:b.params?.height, name:b.params?.file_name} : b?.params });
  } catch {}
});
page.on('response', async res => {
  if (!res.url().includes('/rpc')) return;
  try { const b = await res.json(); const m = res.request().postDataJSON?.()?.method;
    if (b?.error) { seq.push({ n: ++id, dir:'res', method:m, ERROR:b.error }); return; }
    const r = b?.result ?? {};
    seq.push({ n: ++id, dir:'res', method:m, result: m==='core.loadImage' ? {success:r.success,w:r.width,h:r.height,rois:(r.rois??[]).length,names:(r.rois??[]).map(x=>x.name),primary:r.primary_roi_id}
      : m==='straditize.getDiagramData' ? {w:r.imageWidth,h:r.imageHeight,rois:(r.rois??[]).length,names:(r.rois??[]).map(x=>x.name),primaryRoiId:r.primaryRoiId,activeRoiId:r.activeRoiId}
      : {keys:Object.keys(r)} });
  } catch {}
});

try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const z = await page.evaluate(async () => (await (await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'straditize.getDiagramData',params:{}})})).json()).result);
  seq.push({ n: ++id, dir:'MARK', at:'true-zero', w:z.imageWidth, rois:(z.rois??[]).length });

  const [chooser] = await Promise.all([ page.waitForEvent('filechooser', { timeout: 15_000 }), page.locator('#btn-open-file').click() ]);
  await chooser.setFiles(IMAGE);
  await page.waitForTimeout(12000);   // 给完整上传链路足够时间，不早退

  const after = await page.evaluate(async () => (await (await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'straditize.getDiagramData',params:{}})})).json()).result);
  seq.push({ n: ++id, dir:'MARK', at:'after-upload-settled', w:after.imageWidth, rois:(after.rois??[]).length, names:(after.rois??[]).map(x=>x.name), primaryRoiId:after.primaryRoiId, activeRoiId:after.activeRoiId, cols:(after.columns??[]).length });
  const st = await page.evaluate(() => { const s = window.__straditize?.getState?.() ?? {}; return { stage: s.stage, rois: (s.rois??[]).length, roiNames:(s.rois??[]).map(r=>r.name) }; });
  seq.push({ n: ++id, dir:'FRONTEND-MIRROR', ...st });
  console.log(JSON.stringify({ seq, dialogs, notices, consoleErrors }, null, 2));
} finally { await context.close(); await browser.close(); }
