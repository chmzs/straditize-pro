/**
 * AUDIT SCRATCH — 三个候选缺陷的浏览器取证：
 *  A) 步骤 6 标定后 → 退回步骤 5 → 再前进步骤 6：x_ticks 是否被静默抹掉
 *  B) 「重置全部操作」后：第 4 步清理几何/笔迹是否残留在后端
 *  C) 删除唯一 ROI 后前进到步骤 5：用户看到什么
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');
const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:23050';
const PNG = process.env.AUDIT_PNG;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const dialogs = [], rpcErrors = [], notices = [], rpcLog = [];
  page.on('dialog', async (d) => { dialogs.push(`[${d.type()}] ${d.message()}`); await d.dismiss(); });
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/rpc')) { try { rpcLog.push(JSON.parse(r.postData() || '{}').method); } catch {} } });
  page.on('response', async (res) => { if (!res.url().includes('/rpc')) return; try { const b = await res.json(); if (b && b.error) rpcErrors.push(`${b.error.code} ${b.error.message}`); } catch {} });
  await page.exposeFunction('__n', (t) => { const s = String(t || '').trim(); if (s) notices.push(s); });
  await page.addInitScript(() => {
    const SEL = '.ui-toast, #rpc-error-modal, #ui-detail-modal'; let seen = new WeakSet();
    const rec = (e) => { const x = (e.textContent || '').trim(); if (x && window.__n) window.__n(x); };
    const once = (e) => { if (seen.has(e)) return; seen.add(e); rec(e); };
    const scan = (n) => { if (n.nodeType !== 1) return; if (n.matches && n.matches(SEL)) once(n); if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(once); };
    const st = () => { scan(document.documentElement); new MutationObserver((rs) => { seen = new WeakSet(); for (const r of rs) r.addedNodes.forEach(scan); }).observe(document.documentElement, { childList: true, subtree: true }); };
    if (document.documentElement) st(); else document.addEventListener('DOMContentLoaded', st, { once: true });
  });

  const backend = (mm, pp) => page.evaluate(async ([m, p]) => {
    const r = await fetch('http://127.0.0.1:23050/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: m, params: p || {} }) });
    const b = await r.json(); if (b.error) throw new Error(`${m} [${b.error.code}] ${b.error.message}`); return b.result;
  }, [mm, pp]);
  const reset = async () => {
    if (!page.url().startsWith(BASE)) {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    }
    await page.evaluate(async () => { await fetch('http://127.0.0.1:23050/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'audit.resetZero', params: {} }) }); });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
    await page.waitForTimeout(1200);
  };
  const ticks = async () => {
    const d = await backend('straditize.getDiagramData');
    return d.columns.map((c) => ({ id: c.id, x_ticks: c.x_ticks }));
  };

  const R = {};

  // ── A) 步骤 6 标定 → 退回 5 → 再进 6 ───────────────────────────
  await reset();
  await page.setInputFiles('#file-input-image', PNG); await page.waitForTimeout(7000);
  for (let i = 0; i < 5; i++) { await page.click('#btn-wf-next'); await page.waitForTimeout(4500); }  // → step6
  const tBefore = await ticks();
  const calibBefore = tBefore.filter((c) => c.x_ticks).length;

  // 真实「上一步」→ 步骤 5（会重新分列）
  await page.click('#btn-wf-prev'); await page.waitForTimeout(6000);
  const stageAfterPrev = await page.evaluate(() => window.__straditize.getState().stage);
  const tAfterPrev = await ticks();
  // 再「下一步」→ 步骤 6
  await page.click('#btn-wf-next'); await page.waitForTimeout(6000);
  const tAfterReenter = await ticks();
  R.A_resplit = {
    stageAfterPrev,
    calibratedBefore: calibBefore,
    calibratedAfterPrev: tAfterPrev.filter((c) => c.x_ticks).length,
    calibratedAfterReenter: tAfterReenter.filter((c) => c.x_ticks).length,
    sampleBefore: tBefore.slice(0, 3),
    sampleAfterReenter: tAfterReenter.slice(0, 3),
    columnsBefore: tBefore.length, columnsAfter: tAfterReenter.length,
  };

  // ── B) 重置全部操作后清理几何是否残留 ──────────────────────────
  await reset();
  await page.setInputFiles('#file-input-image', PNG); await page.waitForTimeout(7000);
  for (let i = 0; i < 3; i++) { await page.click('#btn-wf-next'); await page.waitForTimeout(4500); } // → step4
  await page.waitForTimeout(3000);
  const cleanBefore = await backend('straditize.getDiagramData');
  // 前端镜像里的几何
  const feGeomBefore = await page.evaluate(() => {
    const s = window.__straditize.getState();
    return { line_candidates: (s.line_candidates || []).length, exclusion_regions: (s.exclusion_regions || []).length };
  });
  // 点「重置」
  const resetBtnOk = await page.evaluate(() => {
    const b = document.querySelector('#btn-reset-all');
    return Boolean(b);
  });
  if (resetBtnOk) {
    await page.click('#btn-reset-all');
    await page.waitForTimeout(5000);
  }
  const cleanAfter = await backend('straditize.getDiagramData');
  const feGeomAfter = await page.evaluate(() => {
    const s = window.__straditize.getState();
    return { stage: s.stage, line_candidates: (s.line_candidates || []).length, exclusion_regions: (s.exclusion_regions || []).length };
  });
  R.B_reset = {
    resetBtnOk,
    backendBefore: { cand: (cleanBefore.line_candidates || []).length, excl: (cleanBefore.exclusion_regions || []).length },
    backendAfter: { cand: (cleanAfter.line_candidates || []).length, excl: (cleanAfter.exclusion_regions || []).length },
    frontendBefore: feGeomBefore,
    frontendAfter: feGeomAfter,
    newNotices: notices.slice(-5),
    newDialogs: dialogs.slice(-3),
  };

  // ── C) 删除唯一 ROI 后前进到步骤 5 ─────────────────────────────
  await reset();
  await page.setInputFiles('#file-input-image', PNG); await page.waitForTimeout(7000);
  await page.click('#btn-wf-next'); await page.waitForTimeout(3000);  // → step2
  const roiDeleteUi = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.filter((b) => /删除|移除/.test(b.textContent || '')).map((b) => ({ id: b.id, txt: (b.textContent || '').trim().slice(0, 20) }));
  });
  let delRes = null;
  try { delRes = await backend('roi.remove', { roi_id: 'roi_1' }); } catch (e) { delRes = { err: String(e.message).slice(0, 200) }; }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 });
  await page.waitForTimeout(1500);
  const roisAfterDel = await page.evaluate(() => (window.__straditize.getState().rois || []).length);
  const noticesBeforeC = notices.length;
  let step5ClickErr = null;
  try {
    await page.evaluate(async () => { await window.__straditize.gotoStage(5); });
  } catch (e) { step5ClickErr = String(e.message).slice(0, 300); }
  await page.waitForTimeout(5000);
  R.C_empty_roi = {
    roiDeleteUi, delRes, roisAfterDel, step5ClickErr,
    stage: await page.evaluate(() => window.__straditize.getState().stage),
    newNotices: notices.slice(noticesBeforeC),
    newRpcErrors: rpcErrors.slice(-5),
  };

  R.allDialogs = dialogs;
  console.log(JSON.stringify(R, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });