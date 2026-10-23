/**
 * Lead 独立复核 F-01（Critical）：进入步骤 6 时前端是否**自己**写入从未有人读过的刻度值。
 * 判据：全程**零用户输入**，抓 column.calibrateXTicks 的真实请求体 + 后端权威 x_ticks。
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 本脚本位于 scripts/lead_probe/，与 frontend/ 不同 package 边界，
// 裸 import 'playwright' 解析不到。显式指向 frontend/node_modules。
const require = createRequire(path.join(__dirname, '..', '..', 'frontend', 'package.json'));
const { chromium } = require('playwright');
const PORT = Number(process.env.STRADITIZE_ZERO_PORT ?? 22915);
const BASE = `http://127.0.0.1:${PORT}`;
const IMAGE = path.resolve(__dirname, '..', '..', 'straditize_core', 'assets', 'tutorials', 'hoya-del-castillo.png');

const calibCalls = [];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, locale: 'zh-CN' });
const page = await ctx.newPage();
page.on('request', (req) => {
  if (req.method() !== 'POST' || !req.url().endsWith('/rpc')) return;
  try {
    const b = req.postDataJSON();
    if (b?.method === 'column.calibrateXTicks') calibCalls.push(b.params);
  } catch {}
});
const rpc = (m, p = {}) => page.evaluate(async ([mm, pp]) => {
  const r = await fetch('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: mm, params: pp }) });
  const b = await r.json(); if (b.error) throw new Error(`${b.error.code} ${b.error.message}`); return b.result;
}, [m, p]);

try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__straditize), undefined, { timeout: 30000 });

  const [chooser] = await Promise.all([ page.waitForEvent('filechooser', { timeout: 15000 }), page.locator('#btn-open-file').click() ]);
  await chooser.setFiles(IMAGE);
  await page.waitForTimeout(3000);

  // 用户真实动作：只点【下一步】推进到步骤 6，绝不填任何标定输入框
  const NEXT = '#btn-wf-next';
  let stage = await page.evaluate(() => window.__straditize?.getState?.()?.stage);
  for (let i = 0; i < 8 && stage < 6; i++) {
    await page.locator(NEXT).click().catch(() => {});
    await page.waitForTimeout(2500);
    stage = await page.evaluate(() => window.__straditize?.getState?.()?.stage);
    console.log(`  advance#${i + 1} -> stage=${stage}`);
  }
  await page.waitForTimeout(5000);   // 等自动 detect 链路落定

  const d = await rpc('straditize.getDiagramData');
  const calibrated = (d.columns || []).filter((c) => c.x_ticks && c.x_ticks.length >= 2);
  console.log(JSON.stringify({
    stage,
    用户填过的标定输入框次数: 0,
    calibrateXTicks_请求数: calibCalls.length,
    请求体前3个: calibCalls.slice(0, 3),
    后端已标定列数: calibrated.length,
    后端总列数: (d.columns || []).length,
    后端x_ticks样例: calibrated.slice(0, 5).map((c) => ({ col: c.col_index, x_ticks: c.x_ticks })),
  }, null, 2));
} finally { await ctx.close(); await browser.close(); }
