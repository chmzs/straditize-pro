/**
 * bug-prober 私有探针运行时（CommonJS，直接 require `playwright`）。
 *
 * ## 为什么不用 `@playwright/test`
 * 实测两次失败（原样记录，避免后来者重踩）：
 *   1. 放在 `scripts/zero_flow_probes/specs/*.spec.ts` → Playwright 以 **CJS** 加载，
 *      文件里 `import.meta.url` 直接 `SyntaxError: Cannot use 'import.meta' outside a module`；
 *      把 `import` 换成 `require` 也没用，因为 TS 文件在装载阶段就报这个错。
 *   2. `import … from '@playwright/test'` → `Cannot find module`：本目录与 `frontend/`
 *      不在同一 package 边界（`frontend/package.json` 是 ESM、且 node_modules 在它下面）。
 *      给本目录加 `{"type":"module"}` 会反过来让解析跑出 frontend 的 node_modules。
 *
 * 结论：用 `playwright` 的库 API（`chromium.launch({channel:'msedge'})`）自己驱动，
 * 断言用 node:assert。这也顺带满足任务要求"探针不依赖产品门禁，如实记录"。
 *
 * 运行：
 *   cd frontend && node ../scripts/zero_flow_probes/driver.cjs ui1_reset
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// `playwright` 装在 `frontend/node_modules`。本文件位于仓库根的 scripts/ 下，
// 不在同一个包边界里，裸 require 会 MODULE_NOT_FOUND（实测），故显式按路径解析。
const { chromium } = require(
  require.resolve('playwright', { paths: [path.join(REPO_ROOT, 'frontend')] })
);

const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22941);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const HOYA = path.join(
  REPO_ROOT,
  'straditize_core',
  'assets',
  'tutorials',
  'hoya-del-castillo.png'
);

// ---------------------------------------------------------------------------
// 遥测：如实记录，不做豁免过滤
// ---------------------------------------------------------------------------
function attachTelemetry(page) {
  const t = { consoleErrors: [], rpcErrors: [], notices: [], dialogs: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') t.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => t.consoleErrors.push(`pageerror: ${e.message}`));
  page.on('dialog', async (d) => {
    t.dialogs.push(`${d.type()}: ${d.message()}`);
    try {
      await d.accept();
    } catch {
      /* 已失效的对话框 */
    }
  });
  page.on('response', (res) => {
    if (!res.url().includes('/rpc')) return;
    res
      .json()
      .then((body) => {
        const err = body && body.error;
        if (!err) return;
        let method = '?';
        try {
          method = (res.request().postDataJSON() || {}).method || '?';
        } catch {
          /* 非 JSON 请求体 */
        }
        t.rpcErrors.push(`${method} [${err.code}] ${err.message}`);
      })
      .catch(() => undefined);
  });
  return t;
}

/** 应用内通知（toast / 后端失败弹窗 / 详情弹窗）——用 MutationObserver 采集。 */
async function installNoticeObserver(page) {
  await page.exposeFunction('__probeNotice', () => undefined);
  await page.addInitScript(() => {
    const SELECTOR = '.ui-toast, #rpc-error-modal, #ui-detail-modal';
    window.__probeNotices = [];
    const seen = new WeakSet();
    const record = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const text = (el.textContent || '').trim();
      if (text) window.__probeNotices.push(text);
    };
    const scan = (node) => {
      if (!node || node.nodeType !== 1) return;
      if (node.matches(SELECTOR)) record(node);
      node.querySelectorAll(SELECTOR).forEach(record);
    };
    const start = () => {
      scan(document.documentElement);
      new MutationObserver((recs) => {
        for (const r of recs) r.addedNodes.forEach(scan);
      }).observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
}

async function readNotices(page) {
  return page.evaluate(() => window.__probeNotices || []);
}

// ---------------------------------------------------------------------------
// 后端 RPC（HTTP 直打，不依赖应用是否加载）
// ---------------------------------------------------------------------------
async function rpc(page, method, params = {}) {
  const res = await page.request.post(`${BASE_URL}/rpc`, {
    data: { jsonrpc: '2.0', id: 1, method, params },
  });
  const body = await res.json();
  if (body.error) {
    const e = new Error(`${method} [${body.error.code}] ${body.error.message}`);
    e.code = body.error.code;
    throw e;
  }
  return body.result;
}

async function rpcSafe(page, method, params = {}) {
  try {
    return { ok: true, result: await rpc(page, method, params) };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
}

async function diagram(page) {
  return rpc(page, 'straditize.getDiagramData');
}

async function frontState(page) {
  return page.evaluate(() => window.__straditize.getState());
}

async function openApp(page) {
  await page.goto(`${BASE_URL}/`);
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, {
    timeout: 60_000,
  });
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 20_000 });
}

async function uploadHoya(page, filePath = HOYA) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 20_000 }),
    page.locator('#btn-open-file').click(),
  ]);
  await chooser.setFiles(filePath);
  await page.waitForFunction(
    () => Boolean(window.__straditize.getState().image?.src),
    undefined,
    { timeout: 120_000 }
  );
}

const log = (tag, ...args) => console.log(`[${tag}]`, ...args);
// 紧凑 JSON：探针日志要能直接贴进报告，所以不展开成 20 行。
const j = (v) => JSON.stringify(v);
/** ROI 只打印身份字段，避免把整棵 x_groups 树刷满终端。 */
const roiBrief = (rois) =>
  (rois || []).map((r) => ({ id: r.id, name: r.name, xlim: r.xlim }));

// ---------------------------------------------------------------------------
// 探针集合
// ---------------------------------------------------------------------------
const PROBES = {};

PROBES.ui1_reset = async (page, tel) => {
  log('ui1', '=== A. 零状态点【重置全部操作】 ===');
  await rpc(page, 'e2e.reset');
  await openApp(page);
  const zero = await diagram(page);
  log('ui1', '零状态后端: imageSrc =', zero.imageSrc, '| rois =', j(roiBrief(zero.rois)));

  await page.locator('#btn-reset-all').click();
  await page.waitForTimeout(3000);
  const afterZeroReset = await diagram(page);
  log('ui1', '零状态重置后后端 rois =', j(roiBrief(afterZeroReset.rois)), '| active =', afterZeroReset.activeRoiId);
  log('ui1', '零状态重置 rpcErrors =', j(tel.rpcErrors));
  log('ui1', '零状态重置 dialogs    =', j(tel.dialogs));
  log('ui1', '零状态重置 notices    =', j(await readNotices(page)));

  log('ui1', '=== B. 上传真图后点【重置全部操作】 ===');
  tel.rpcErrors.length = 0;
  tel.dialogs.length = 0;
  tel.consoleErrors.length = 0;
  await rpc(page, 'e2e.reset');
  await installNoticeObserver(page).catch(() => undefined);
  await openApp(page);
  await uploadHoya(page);
  const loaded = await diagram(page);
  const stLoaded = await frontState(page);
  log('ui1', '上传后后端 rois =', j(roiBrief(loaded.rois)), '| active =', loaded.activeRoiId);
  log('ui1', '上传后前端镜像 rois =', j(roiBrief(stLoaded.rois)), '| active_roi_id =', stLoaded.activeRoiId);

  await page.evaluate(() => {
    window.__probeNotices = [];
  });
  tel.rpcErrors.length = 0;
  tel.dialogs.length = 0;
  tel.consoleErrors.length = 0;

  await page.locator('#btn-reset-all').click();
  await page.waitForTimeout(3500);

  const afterReset = await diagram(page);
  const stAfter = await frontState(page);
  log('ui1', '重置后后端 rois =', j(roiBrief(afterReset.rois)), '| active =', afterReset.activeRoiId, '| imageSrc =', String(afterReset.imageSrc).slice(0, 30));
  log('ui1', '重置后前端镜像 rois =', j(roiBrief(stAfter.rois)), '| active_roi_id =', stAfter.activeRoiId, '| roi.id =', stAfter.legacyRoi && stAfter.legacyRoi.xMin);
  log('ui1', '重置后 rpcErrors =', j(tel.rpcErrors));
  log('ui1', '重置后 dialogs   =', j(tel.dialogs));
  log('ui1', '重置后 notices   =', j(await readNotices(page)));

  // --- 用户按提示"从步骤 1 重新开始"，继续在步骤 2 提交 ROI ---
  tel.rpcErrors.length = 0;
  await page.evaluate(() => window.__straditize.gotoStage(2));
  await page.waitForTimeout(1200);
  const upd = await rpcSafe(page, 'roi.update', {
    roi_id: stAfter.activeRoiId || 'roi_1',
    x0: 300,
    x1: 1900,
    y0: 500,
    y1: 1300,
  });
  log('ui1', 'roi.update(前端镜像 active_roi_id) ->', j(upd));
  log('ui1', 'gotoStage(2) 后 rpcErrors =', j(tel.rpcErrors));
};

PROBES.ui2_xticks = async (page, tel) => {
  log('ui2', '=== 步骤 6 标定 X 刻度 → 回到步骤 5 重新分列，x_ticks 是否被抹 ===');
  await rpc(page, 'e2e.reset');
  await openApp(page);
  await uploadHoya(page);
  const d0 = await diagram(page);
  log('ui2', '上传后 rois =', j(d0.rois), '| columns =', d0.columns.length);

  // 步骤 2→5 推进（真实点"下一步"按钮，不用 gotoStage 跳过业务动作）
  const nextBtn = page.locator('#btn-wf-next');
  for (let step = 2; step <= 5; step += 1) {
    const before = await frontState(page);
    if (before.stage === step) {
      await page.waitForTimeout(300);
      continue;
    }
    await nextBtn.click();
    await page.waitForFunction((s) => window.__straditize.getState().stage >= s, step, {
      timeout: 60_000,
    });
    await page.waitForTimeout(600);
  }
  const d5 = await diagram(page);
  log('ui2', '到步骤 5 后后端 columns =', d5.columns.length, '| 第一列 =', j(d5.columns[0]));

  // 回到步骤 2 用后端权威边界重提交 ROI，然后回步骤 5 触发重分列（真实用户改 ROI 再分列）
  const c0 = d5.columns[0];
  await page.evaluate(() => window.__straditize.gotoStage(6));
  await page.waitForTimeout(800);
  const px1 = c0.startX;
  const px2 = c0.tickEndX && c0.tickEndX > px1 ? c0.tickEndX : px1 + 80;
  const cal = await rpcSafe(page, 'column.calibrateXTicks', {
    col_index: 0,
    ticks: [
      { px: px1, value: 0 },
      { px: px2, value: 40 },
    ],
  });
  log('ui2', `标定 col0 px=(${px1},${px2}) value=(0,40) ->`, j(cal));
  const dCal = await diagram(page);
  log('ui2', '标定后后端 col0.x_ticks =', j(dCal.columns[0].x_ticks));

  // 用户在步骤 5 再点一次「下一步」（触发 core.detectColumns）
  await page.evaluate(() => window.__straditize.gotoStage(4));
  await page.waitForTimeout(800);
  await nextBtn.click();
  await page.waitForTimeout(4000);
  const dRe = await diagram(page);
  log('ui2', '重新分列后后端 col0.x_ticks =', j(dRe.columns[0].x_ticks));
  log('ui2', '重新分列后后端 col0.startX/endX =', dRe.columns[0].startX, dRe.columns[0].endX);
  log('ui2', 'rpcErrors =', j(tel.rpcErrors));
  log('ui2', 'notices   =', j(await readNotices(page)));
};

PROBES.ui3_sample = async (page, tel) => {
  log('ui3', '=== 范例下拉 → handleLoadSample 与上传路径的 history.reset 不对称 ===');
  await rpc(page, 'e2e.reset');
  await openApp(page);
  const opts = await page.locator('#select-sample-diagram option').evaluateAll((els) =>
    els.map((e) => ({ value: e.value, text: e.textContent.trim() }))
  );
  log('ui3', '范例下拉选项 =', j(opts));

  // verification：FileLoaderService 仍保留该名字映射，但工具栏已删掉 option
  const ver = await rpcSafe(page, 'core.loadImage', { sample_key: 'verification' });
  log('ui3', '直调 core.loadImage(sample_key=verification) ->', j(ver));

  // 走 UI 选 hoya
  await page.selectOption('#select-sample-diagram', 'hoya');
  await page.waitForFunction(() => Boolean(window.__straditize.getState().image?.src), undefined, {
    timeout: 120_000,
  });
  await page.waitForTimeout(1500);
  const st = await frontState(page);
  log('ui3', '选 hoya 后前端 columns 数 =', st.columns.length, '| activeTaxaId =', st.activeTaxaId);
  const canUndo = await page.evaluate(() =>
    Boolean(window.__straditize.getState().canUndo ?? null)
  );
  log('ui3', 'canUndo 字段 =', canUndo);
  log('ui3', 'rpcErrors =', j(tel.rpcErrors));
  log('ui3', 'notices   =', j(await readNotices(page)));
};

PROBES.ui4_zero_reset_leak = async (page, tel) => {
  log('ui4', '=== 零状态 → 画线几何 → 【重置】→ 几何是否残留在后端 ===');
  await rpc(page, 'e2e.reset');
  await openApp(page);
  await uploadHoya(page);

  // 步骤 4 是清理步骤；先分列（真实用户会先确认 ROI → 分列）
  await page.evaluate(() => window.__straditize.gotoStage(5));
  await page.waitForFunction(() => window.__straditize.getState().stage >= 5, undefined, {
    timeout: 90_000,
  });
  await page.evaluate(() => window.__straditize.gotoStage(4));
  await page.waitForTimeout(4000);
  const withCands = await diagram(page);
  log('ui4', '步骤 4 后端 line_candidates =', (withCands.line_candidates || []).length,
      '| exclusion_regions =', (withCands.exclusion_regions || []).length,
      '| line_strokes =', (withCands.line_strokes || []).length);

  // 手工加一条几何（相当于用户点「加线」），确保有非自动产生的几何
  const roiId = withCands.activeRoiId;
  const up = await rpcSafe(page, 'algorithm.upsertLineGeometry', {
    roi_id: roiId,
    axis: 'h',
    at: 800,
    span: [400, 1200],
    width: 3,
    status: 'removed',
  });
  log('ui4', 'upsertLineGeometry ->', up.ok ? `ok candidates=${(up.result.candidates || []).length}` : up.error);

  const beforeReset = await diagram(page);
  log('ui4', '重置前 line_candidates =', (beforeReset.line_candidates || []).length);

  await page.locator('#btn-reset-all').click();
  await page.waitForTimeout(3500);
  const afterReset = await diagram(page);
  log('ui4', '重置后 line_candidates =', (afterReset.line_candidates || []).length,
      '| exclusion_regions =', (afterReset.exclusion_regions || []).length,
      '| line_strokes =', (afterReset.line_strokes || []).length);
  log('ui4', '重置后 cleanup.stats =', j(afterReset.cleanup && afterReset.cleanup.stats));
  log('ui4', 'rpcErrors =', j(tel.rpcErrors));
  log('ui4', 'notices   =', j(await readNotices(page)));
};


PROBES.ui5_two_tabs = async (page, tel) => {
  log('ui5', '=== 两个标签页：A 页上传样本，B 页同时轮询 getDiagramData → 撕裂读 ===');
  const ctx = page.context();
  const pageB = await ctx.newPage();
  const telB = attachTelemetry(pageB);

  const ROUNDS = 6;
  // 读得多、读得快：撕裂窗口只有 loadImage 内部 _init_rois()→roi_create() 之间的几十毫秒，
  // 只读 8 次的轮次会整轮落在窗口之外（第一版实测 0/48，属于探针密度不足而非"无缺陷"）。
  const READ_PER_ROUND = 60;
  const results = [];

  for (let rd = 1; rd <= ROUNDS; rd += 1) {
    await rpc(page, 'e2e.reset');
    await page.reload();
    await pageB.reload();
    await openApp(page);
    await openApp(pageB);

    // B 页狂读后端真值（用页面内 RPC，等价 B 页切回前台时的数据刷新）
    const reader = pageB.evaluate(async (n) => {
      const out = [];
      const api = window.__straditize;
      for (let i = 0; i < n; i += 1) {
        try {
          const d = await api.rpc('straditize.getDiagramData');
          out.push({
            imageWidth: d.imageWidth,
            rois: (d.rois || []).length,
            primaryRoiId: d.primaryRoiId,
            activeRoiId: d.activeRoiId,
          });
        } catch (e) {
          out.push({ error: String(e).slice(0, 120) });
        }
      }
      return out;
    }, READ_PER_ROUND);

    // 同时 A 页真实切换到内置范例（同样走 core.loadImage，与上传同一变更路径）
    const switched = await page
      .selectOption('#select-sample-diagram', 'hoya')
      .then(() => true)
      .catch(() => false);
    const reads = await reader;

    const torn = reads.filter(
      (r) => r.imageWidth && (r.rois === 0 || r.primaryRoiId === null)
    );
    results.push({
      round: rd,
      switched,
      reads: reads.length,
      torn: torn.length,
      example: torn[0] || null,
    });
    log(
      'ui5',
      `第 ${rd} 轮（切换成功=${switched}）：${reads.length} 次读，撕裂 ${torn.length} 次` +
        (torn[0] ? `；例 ${JSON.stringify(torn[0])}` : '')
    );
  }

  const totalTorn = results.reduce((a, b) => a + b.torn, 0);
  log('ui5', `>>> 两个标签页合计撕裂 ${totalTorn} 次 / ${results.length} 轮`);
  const finalB = await pageB.evaluate(async () => {
    const d = await window.__straditize.rpc('straditize.getDiagramData');
    return { rois: (d.rois || []).length, primaryRoiId: d.primaryRoiId };
  });
  log('ui5', '>>> 收尾静态读（自愈确认）=', JSON.stringify(finalB));
  log('ui5', 'B 页 consoleErrors =', JSON.stringify(telB.consoleErrors).slice(0, 300));
  await pageB.close();
};


PROBES.ui7_xticks_ui = async (page, tel) => {
  log('ui7', '=== UI 路径：步骤 6 标定 X 刻度 → 步骤 2 缩小 ROI → 步骤 5 重分列 ===');
  await rpc(page, 'e2e.reset');
  await rpc(page, 'core.loadImage', { sample_key: 'hoya' });
  await rpc(page, 'core.detectColumns', { data_xlim: [315, 1946], data_ylim: [511, 1311] });
  await page.reload();
  await openApp(page);

  const d0 = await diagram(page);
  const c0 = d0.columns[0];
  const px1 = c0.startX;
  const px2 = c0.tickEndX > px1 ? c0.tickEndX : px1 + 60;
  log('ui7', `col0 几何 startX=${px1} endX=${c0.endX} tickEndX=${c0.tickEndX}`);

  // 步骤 6：真实 UI 输入两个读数 + 点【保存】
  await page.evaluate(() => window.__straditize.gotoStage(6));
  await page.waitForTimeout(1200);
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val1').fill('0');
  await page.locator('.step-panel[data-step="6"] #inp-manual-tick-val2').fill('40');
  await page.locator('.step-panel[data-step="6"] #btn-save-manual-ticks').click();
  await page.waitForTimeout(1500);
  const dCal = await diagram(page);
  log('ui7', 'UI 标定后后端 col0.x_ticks =', j(dCal.columns[0].x_ticks));

  // 步骤 2：把 ROI 左右各缩 20px（用户真实会做的"微调取数区"）
  const roi0 = (dCal.rois || [])[0];
  const xl = roi0.xlim;
  const origCall = rpcSafe;
  const upd = await (async () => {
    console.log('[ui7] SEND roi.update', JSON.stringify({ roi_id: dCal.activeRoiId, x0: xl[0] + 40, x1: xl[1] - 40 }));
    return origCall(page, 'roi.update', {
      roi_id: dCal.activeRoiId,
      x0: xl[0] + 40,
      x1: xl[1] - 40,
    });
  })();
  log('ui7', 'roi.update(左右各缩 60px) ->', upd.ok ? 'ok' : upd.error);

  // 步骤 5：真实点「下一步」触发 core.detectColumns
  await page.evaluate(() => window.__straditize.gotoStage(4));
  await page.waitForTimeout(1000);
  await page.locator('#btn-wf-next').click();
  await page.waitForTimeout(5000);

  // 立刻回读，看 ROI 改动是否被保留
  await page.waitForTimeout(300);
  // 关键：此时前端镜像的 roi 是什么？若 UI 在步骤 6 把 roi 重置回建议值并
  // 在之后某次 commitRoi 里把旧 bounds 写回后端，这里能看到。
  const stDbg = await frontState(page);
  log('ui7', '[dbg] 前端 legacyRoi =', j(stDbg.legacyRoi), '| 前端 rois =', j(roiBrief(stDbg.rois)), '| stage =', stDbg.stage);
  const dNow = await diagram(page);
  log('ui7', 'roi.update 后立刻回读 xlim =', j((dNow.rois || []).map((x) => x.xlim)));
  const stNow = await frontState(page);
  log('ui7', 'roi.update 后前端 roi =', j(stNow.legacyRoi), '| 前端 rois =', j(roiBrief(stNow.rois)));
  await page.waitForTimeout(2000);
  const dLater = await diagram(page);
  log('ui7', '再等 2s 后回读 xlim =', j((dLater.rois || []).map((x) => x.xlim)));
  const dPre = await diagram(page);
  log('ui7', '点下一步前：后端 rois xlim =', j((dPre.rois || []).map((x) => x.xlim)),
      '| rois =', JSON.stringify(roiBrief(dPre.rois)), '| columns =', dPre.columns.length);
  const dAfter = await diagram(page);
  log('ui7', '重分列后后端 col0.startX =', dAfter.columns[0].startX);
  log('ui7', '重分列后后端 col0.x_ticks =', j(dAfter.columns[0].x_ticks));
  log('ui7', 'rpcErrors =', j(tel.rpcErrors));
  log('ui7', 'notices   =', j(await readNotices(page)));

  // 污染程度：导出/QA 此时怎么算 col0 的标度
  const rd = await rpcSafe(page, 'export.getReadiness');
  log('ui7', 'export.getReadiness.ready =', rd.ok ? rd.result.ready : rd.error);
  const qa = await rpcSafe(page, 'qa.summarize');
  if (qa.ok) {
    log('ui7', 'qa.uncalibrated_columns =', j(qa.result.uncalibrated_columns));
    log('ui7', 'qa.n_uncalibrated =', qa.result.n_uncalibrated);
  }
  const csv = await rpcSafe(page, 'export.csv', {});
  if (csv.ok) {
    const lines = String(csv.result).split(String.fromCharCode(10));
    log('ui7', 'export.csv 表头前 3 列 =', lines[0].split(',').slice(0, 3).join(','));
    log('ui7', 'export.csv 数据第 1 行前 3 值 =', lines[1].split(',').slice(0, 3).join(','));
  } else {
    log('ui7', 'export.csv ->', csv.error);
  }
};

PROBES.ui6_two_tab_write = async (page) => {
  const mod = require('./ui6-two-tab-write.cjs');
  await mod({
    rpc, rpcSafe, diagram, frontState, openApp, log, j,
    page, ctx: page.context(),
  });
};

// ---------------------------------------------------------------------------
async function main() {
  const which = process.argv[2];
  if (!which || !PROBES[which]) {
    console.error('用法: node driver.cjs <' + Object.keys(PROBES).join('|') + '>');
    process.exit(2);
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    locale: 'zh-CN',
    baseURL: BASE_URL,
  });
  const page = await context.newPage();
  const tel = attachTelemetry(page);
  try {
    await PROBES[which](page, tel);
  } finally {
    await context.close();
    await browser.close();
  }
  log('done', which, 'consoleErrors =', j(tel.consoleErrors));
}

main().catch((err) => {
  console.error('PROBE FAILED:', err);
  process.exit(1);
});
