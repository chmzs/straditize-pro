/**
 * AUDIT SCRATCH — 从零用户旅程的真实浏览器探针。放在 /tmp 下，不进仓库。
 *
 * 目标：会话零状态（session.image is None）时打开应用 → 走真实 UI 上传 PNG
 *       → 推进 8 步 → 记录每一步的用户可见症状。
 */
const { chromium } = require('I:/software_dev/straditize/frontend/node_modules/playwright-core');

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:23050';
const PNG = process.env.AUDIT_PNG;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    locale: 'zh-CN',
    acceptDownloads: true,
  });
  const page = await ctx.newPage();

  const log = [];
  const consoleErrors = [];
  const pageErrors = [];
  const rpcErrors = [];
  const dialogs = [];
  const notices = [];

  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', async (d) => {
    dialogs.push(`[${d.type()}] ${d.message()}`);
    await d.dismiss();
  });
  page.on('response', async (res) => {
    if (!res.url().includes('/rpc')) return;
    try {
      const b = await res.json();
      if (b && b.error) {
        const req = res.request();
        let method = '?';
        try { method = JSON.parse(req.postData() || '{}').method || '?'; } catch {}
        rpcErrors.push(`${method} [${b.error.code}] ${b.error.message}`);
      }
    } catch {}
  });
  await page.exposeFunction('__auditNotice', (t) => {
    const s = String(t || '').trim();
    if (s) notices.push(s);
  });
  await page.addInitScript(() => {
    const SEL = '.ui-toast, #rpc-error-modal, #ui-detail-modal';
    let seen = new WeakSet();
    const rec = (el) => {
      const txt = (el.textContent || '').trim();
      if (txt && window.__auditNotice) window.__auditNotice(txt);
    };
    const once = (el) => { if (seen.has(el)) return; seen.add(el); rec(el); };
    const scan = (n) => {
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches(SEL)) once(n);
      if (n.querySelectorAll) n.querySelectorAll(SEL).forEach(once);
    };
    const start = () => {
      scan(document.documentElement);
      new MutationObserver((rs) => {
        seen = new WeakSet();
        for (const r of rs) r.addedNodes.forEach(scan);
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });

  const step = async (name, fn) => {
    const before = { c: consoleErrors.length, p: pageErrors.length, r: rpcErrors.length, d: dialogs.length, n: notices.length };
    let out;
    try { out = await fn(); } catch (e) { out = { THREW: String(e && e.message || e) }; }
    log.push({
      step: name,
      result: out,
      newConsoleErrors: consoleErrors.slice(before.c),
      newPageErrors: pageErrors.slice(before.p),
      newRpcErrors: rpcErrors.slice(before.r),
      newDialogs: dialogs.slice(before.d),
      newNotices: notices.slice(before.n),
    });
  };

  const state = () => page.evaluate(() => {
    const a = window.__straditize;
    if (!a) return { handle: false };
    const s = a.getState();
    return {
      handle: true,
      stage: s.stage,
      imageSrc: s.imageSrc,
      imageWidth: s.imageWidth,
      imageHeight: s.imageHeight,
      rois: (s.rois || []).length,
      roi: s.roi,
      columns: (s.columns || []).length,
      activeTaxaId: s.activeTaxaId,
      isCalibrated: s.calibration && s.calibration.isCalibrated,
    };
  });

  const backend = (m, p) => page.evaluate(async ([mm, pp]) => {
    const r = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: mm, params: pp || {} }),
    });
    const b = await r.json();
    if (b.error) throw new Error(`${mm} [${b.error.code}] ${b.error.message}`);
    return b.result;
  }, [m, p]);

  // ── 1. 零状态启动 ──────────────────────────────────────────────
  await step('01_boot_zero_state', async () => {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 45000 })
      .catch((e) => { throw new Error('__straditize 句柄未出现: ' + e.message); });
    await page.waitForTimeout(1500);
    return await state();
  });

  await step('02_backend_zero_confirm', async () => {
    const d = await backend('straditize.getDiagramData');
    return { imageSrc: d.imageSrc, rois: (d.rois || []).length, columns: (d.columns || []).length };
  });

  // ── 2. 真实 UI 文件上传 ─────────────────────────────────────────
  await step('03_upload_via_real_input', async () => {
    await page.setInputFiles('#file-input-image', PNG);
    await page.waitForTimeout(6000);
    return await state();
  });

  await step('04_backend_after_upload', async () => {
    const d = await backend('straditize.getDiagramData');
    return {
      imageSrc: d.imageSrc,
      rois: (d.rois || []).length,
      roisDetail: (d.rois || []).map((r) => ({ id: r.id, name: r.name, xlim: r.xlim, ylim: r.ylim })),
      columns: (d.columns || []).length,
      activeRoiId: d.activeRoiId,
    };
  });

  // ── 3. 逐步推进 ────────────────────────────────────────────────
  for (const target of [2, 3, 4, 5, 6, 7, 8]) {
    await step(`advance_to_step${target}`, async () => {
      await page.evaluate(async (s) => {
        await window.__straditize.gotoStage(s);
      }, target);
      await page.waitForTimeout(3500);
      return await state();
    });
  }

  await step('09_final_backend', async () => {
    const d = await backend('straditize.getDiagramData');
    return {
      rois: (d.rois || []).length,
      columns: (d.columns || []).length,
      col0: d.columns && d.columns[0] ? {
        id: d.columns[0].id, startX: d.columns[0].startX, endX: d.columns[0].endX,
        x_ticks: d.columns[0].x_ticks,
      } : null,
    };
  });

  await step('10_export_csv', async () => {
    const r = await backend('core.exportData', { format: 'csv' });
    return { keys: Object.keys(r || {}), len: (r && r.content && r.content.length) || 0 };
  });

  console.log(JSON.stringify({ log, allConsoleErrors: consoleErrors, allPageErrors: pageErrors, allRpcErrors: rpcErrors, allDialogs: dialogs }, null, 2));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
