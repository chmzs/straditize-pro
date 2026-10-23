import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22911);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const trace = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
const page = await context.newPage();
page.on('request', req => {
  if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
  try { const b = req.postDataJSON(); if (b?.method) trace.push({ dir: 'req', method: b.method, params: b.method === 'core.loadImage' ? { hasDataUrl: !!b.params?.image_data, dataUrlLen: (b.params?.image_data ?? '').length, w: b.params?.width, h: b.params?.height, name: b.params?.file_name } : b.params }); } catch {}
});
page.on('response', async res => {
  if (!res.url().includes('/rpc')) return;
  try {
    const b = await res.json();
    const m = res.request().postDataJSON?.()?.method;
    if (b?.error) { trace.push({ dir: 'res', method: m, error: b.error }); return; }
    if (m === 'core.loadImage') trace.push({ dir: 'res', method: m, result: { success: b.result?.success, width: b.result?.width, height: b.result?.height, rois: b.result?.rois?.length, roiNames: (b.result?.rois??[]).map(r=>r.name), primary: b.result?.primary_roi_id, active: b.result?.active_roi_id } });
    else if (m === 'straditize.getDiagramData') trace.push({ dir: 'res', method: m, result: { w: b.result?.imageWidth, h: b.result?.imageHeight, rois: (b.result?.rois??[]).length, roiNames: (b.result?.rois??[]).map(r=>r.name), primaryRoiId: b.result?.primaryRoiId, activeRoiId: b.result?.activeRoiId } });
    else trace.push({ dir: 'res', method: m, keys: Object.keys(b.result ?? {}) });
  } catch {}
});

try {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 30_000 });
  trace.push({ dir: 'mark', at: 'before-upload' });
  const [chooser] = await Promise.all([ page.waitForEvent('filechooser', { timeout: 15_000 }), page.locator('#btn-open-file').click() ]);
  await chooser.setFiles(IMAGE);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    const d = await page.evaluate(async () => {
      const res = await fetch('/rpc', { method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'straditize.getDiagramData', params:{} }) });
      return (await res.json()).result;
    });
    if (d?.imageWidth > 0) { trace.push({ dir: 'final', w: d.imageWidth, h: d.imageHeight, rois: (d.rois??[]).length, names: (d.rois??[]).map(r=>r.name), primaryRoiId: d.primaryRoiId, activeRoiId: d.activeRoiId, columns: (d.columns??[]).length }); break; }
  }
  console.log(JSON.stringify(trace, null, 2));
} finally { await context.close(); await browser.close(); }
