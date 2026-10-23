/**
 * Lead 的一次性"零状态 → 真实上传"驱动探针（仅供 Lead 自查，不属于交付物）。
 *
 * 目的：验证两件事，而不是证明整个八步旅程能跑：
 *   1. 真正的零状态下应用能否完成 boot（window.__straditize 是否就绪）；
 *   2. 走**真实文件选择器**上传一张真图后，后端权威状态是否真的变成那张图。
 *
 * 判据一律读后端 `straditize.getDiagramData`，不读前端镜像。
 *
 * 用法（先起 scripts/lead_probe/serve_zero.py）：
 *   cd frontend && node ../scripts/lead_probe/drive_zero_upload.mjs
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22910);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const IMAGE = path.join(REPO_ROOT, 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

/** 控制台 / 未捕获异常 / 失败 RPC 全量采集，不做豁免过滤。 */
const consoleErrors = [];
const rpcErrors = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
const page = await context.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('response', (res) => {
  if (!res.url().includes('/rpc')) return;
  void res
    .json()
    .then((body) => {
      const err = body?.error;
      if (err) rpcErrors.push(`${err.code} ${err.message}`);
    })
    .catch(() => {});
});

/** 后端权威状态。 */
const diagram = async () =>
  page.evaluate(async () => {
    const res = await fetch('/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'straditize.getDiagramData',
        params: {},
      }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${body.error.code} ${body.error.message}`);
    return body.result;
  });

const report = { steps: [] };
const note = (name, extra = {}) => {
  report.steps.push({ name, ...extra });
  console.log(`[probe] ${name} ${JSON.stringify(extra)}`);
};

try {
  // ---------- 1. 零状态 boot ----------
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  let bootOk = false;
  try {
    await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 30_000 });
    bootOk = true;
  } catch {
    bootOk = false;
  }
  const canvasVisible = await page.locator('canvas').first().isVisible().catch(() => false);
  const zero = await diagram();
  note('boot_zero_state', {
    handleReady: bootOk,
    canvasVisible,
    imageSrc: zero.imageSrc,
    imageWidth: zero.imageWidth,
    imageHeight: zero.imageHeight,
    rois: (zero.rois ?? []).length,
    columns: (zero.columns ?? []).length,
  });

  // 零状态下面板应显示"尚未载入"，而不是假装有图
  const bodyText = await page.locator('body').innerText().catch(() => '');
  note('zero_state_panel', {
    hasNotLoadedHint: /尚未载入|未载入/.test(bodyText),
  });

  // ---------- 2. 真实文件选择器上传 ----------
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 15_000 }),
    page.locator('#btn-open-file').click(),
  ]);
  note('filechooser_opened', { multiple: chooser.isMultiple() });
  await chooser.setFiles(IMAGE);

  // 等后端权威状态真的变成那张图（hoya 真值 2339x1654）
  await page.waitForFunction(
    async () => {
      const res = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'straditize.getDiagramData',
          params: {},
        }),
      });
      const b = await res.json();
      return b.result?.imageWidth === 2339 && b.result?.imageHeight === 1654;
    },
    undefined,
    { timeout: 30_000 }
  );

  const after = await diagram();
  note('after_upload', {
    imageWidth: after.imageWidth,
    imageHeight: after.imageHeight,
    rois: (after.rois ?? []).map((r) => ({ id: r.id, name: r.name, composition: r.composition })),
    columns: (after.columns ?? []).length,
    isCalibrated: after.calibration?.isCalibrated,
  });

  // ---------- 3. 上传后是否停在步骤 1 ----------
  const stage = await page
    .evaluate(() => window.__straditize?.getState?.()?.stage ?? null)
    .catch(() => null);
  note('stage_after_upload', { stage });

  report.consoleErrors = consoleErrors;
  report.rpcErrors = rpcErrors;
  console.log('\n[probe] ==== RESULT ====');
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  report.fatal = String(err?.message ?? err);
  report.consoleErrors = consoleErrors;
  report.rpcErrors = rpcErrors;
  console.log('\n[probe] ==== FATAL ====');
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
