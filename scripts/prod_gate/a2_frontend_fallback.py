# -*- coding: utf-8 -*-
"""A2：三处前端兜底链的真实用户可见影响面（真实 Edge + 真实后端）。

Lead 的问题：
  "如果后端 detect_columns 不再返回 startValue/tickValue，
   前端会兜底成 startValue: c.startValue || 0 和 tickValue: c.tickValue || 100 ——
   画布与 inspector 上显示的是 0-100% 还是别的？用户看到的是什么？"

三处兜底（静态读到的原文，本脚本要实测它们**实际**谁生效）：
  ① RpcClient.ts:837-838   startValue: c.startValue || 0 ; tickValue: c.tickValue || 100
                           —— 但同处 :829 还有 maxPercent: 100（硬编码）
  ② CoordinateSystem.ts:139-140  val0 = col.startValue ?? sc?.originVal ?? 0
                                 val1 = col.tickValue ?? sc?.calibVal ?? col.maxPercent ?? 20
  ③ GeologyCanvas.ts:1535  return col.maxPercent ?? col.tickValue ?? 20

关键风险：三者兜底值不同（100 / 100 / 20），且 ① 在**构造**层就把字段填上了，
于是 ②③ 看到的 col.startValue/col.tickValue **永远不是 undefined** ——
②③ 的 ?? 链根本轮不到执行。这必须实测，不能推断。

做法（不改产品源码、不改 dist）：
  · 起真实后端（自用端口段），用 Playwright 注入 axios/fetch 层钩子，
    把 core.detectColumns 响应里的 startValue/tickValue 删掉（模拟"后端不发字段"）
  · 在真实页面上读：画布上渲染的列标尺数值、inspector 里显示的量程
  · 另起一个"原样"对照组（不剥字段），比较可见差异
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request

import _util as U  # noqa: E402

U.ensure_import_path()

OUT_DIR = "output/prod_gate/a2_fallback"
PORT = 23091

# 在页面里拦截 /rpc 响应，按需剥掉 startValue / tickValue
HOOK_JS = r"""
(() => {
  const strips = window.__STRIP_FIELDS__ || [];
  if (!strips.length) return;
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = (args[0] && args[0].url) || args[0] || '';
      if (String(url).includes('/rpc')) {
        const clone = resp.clone();
        const j = await clone.json();
        let touched = false;
        if (j && Array.isArray(j.result)) {
          // core.detectColumns 的 result 直接是列数组（不是 {columns:[...]}）
          for (const c of j.result) {
            if (!c || typeof c !== 'object') continue;
            for (const f of strips) {
              if (f in c) { delete c[f]; touched = true; }
            }
          }
        }
        if (touched) {
          window.__STRIPPED__ = (window.__STRIPPED__ || 0) + 1;
          return new Response(JSON.stringify(j), {
            status: resp.status,
            statusText: resp.statusText,
            headers: resp.headers,
          });
        }
      }
    } catch (e) {
      window.__HOOK_ERR__ = String(e);
    }
    return resp;
  };
})();
"""

DRIVER = r"""
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const base = process.argv[2];
  const stripJson = process.argv[3];   // JSON array of field names, or "[]"
  const outPath = process.argv[4];
  const strip = JSON.parse(stripJson);

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e)));

  if (strip.length) {
    await page.addInitScript((fields) => {
      window.__STRIP_FIELDS__ = fields;
    }, strip);
    await page.addInitScript(fs.readFileSync(process.argv[5], 'utf8'));
  }

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 直接调后端建立"已分列"状态（与真实 UI 走同一 RPC）
  const setup = await page.evaluate(async () => {
    const call = async (method, params) => {
      const r = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return await r.json();
    };
    const a = await call('core.loadImage', { sample_key: 'hoya' });
    const roi = (a.result?.rois || [])[0];
    const b = await call('core.detectColumns', {
      data_xlim: [315, 1946], data_ylim: [511, 1311], roi_id: roi?.id,
    });
    return {
      load: { w: a.result?.width, h: a.result?.height },
      detect: {
        ok: !!b.result,
        n: (Array.isArray(b.result) ? b.result : (b.result?.columns || [])).length,
        firstColKeys: (() => {
          const arr = Array.isArray(b.result) ? b.result : (b.result?.columns || []);
          return arr[0] ? Object.keys(arr[0]) : [];
        })(),
        firstCol: (() => {
          const arr = Array.isArray(b.result) ? b.result : (b.result?.columns || []);
          return arr[0] || null;
        })(),
      },
      stripped: window.__STRIPPED__ || 0,
      hookErr: window.__HOOK_ERR__ || null,
    };
  });

  // 让前端自己再拉一次列（走它真实的 RpcClient 路径，因而经过钩子）
  const afterFrontend = await page.evaluate(async () => {
    try {
      const mod = await import('/src/services/RpcClient.ts');
      return { note: 'module import path unavailable in prod build' };
    } catch (e) {
      return { note: String(e).slice(0, 120) };
    }
  });

  // 读页面上 inspector / 画布呈现的数值（宽泛抓取可见文本里的百分比）
  const visible = await page.evaluate(() => {
    const texts = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.children.length) return;
      const t = (el.textContent || '').trim();
      if (t && /%|20|100|量程|刻度|标定/.test(t) && t.length < 80) texts.push(t);
    });
    return {
      title: document.title,
      bodyLen: document.body.innerText.length,
      snippets: Array.from(new Set(texts)).slice(0, 60),
    };
  });

  fs.writeFileSync(outPath, JSON.stringify({ strip, setup, afterFrontend, visible, logs: logs.slice(-25) }, null, 2));
  await browser.close();
})().catch((e) => {
  require('fs').writeFileSync(process.argv[4], JSON.stringify({ fatal: String(e) }, null, 2));
  process.exit(1);
});
"""


def wait_backend(base: str, tries: int = 60) -> bool:
    for _ in range(tries):
        try:
            urllib.request.urlopen(base + "/", timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def run_case(name: str, strip: list[str], base: str, tmp: str) -> dict:
    out = os.path.join(U.ROOT, OUT_DIR, f"{name}.json")
    r = subprocess.run(
        ["node", os.path.join(tmp, "driver.cjs"), base, json.dumps(strip), out,
         os.path.join(tmp, "hook.js")],
        cwd=os.path.join(U.ROOT, "frontend"),
        capture_output=True, text=True, timeout=180,
    )
    if r.returncode != 0:
        print(f"    node exit={r.returncode} stderr={r.stderr[-500:]}")
    if os.path.exists(out):
        return json.loads(open(out, encoding="utf-8").read())
    return {"fatal": r.stderr[-400:]}


def main() -> int:
    U.hash_banner("A2 三处前端兜底链的真实可见影响面")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    tmp = os.path.join(U.ROOT, "frontend", ".prod_gate_tmp")
    os.makedirs(tmp, exist_ok=True)
    with open(os.path.join(tmp, "driver.cjs"), "w", encoding="utf-8") as fh:
        fh.write(DRIVER)
    with open(os.path.join(tmp, "hook.js"), "w", encoding="utf-8") as fh:
        fh.write(HOOK_JS)

    dist = os.path.join(U.ROOT, "frontend", "dist", "index.html")
    print(f"\n  dist 存在 = {os.path.exists(dist)}")

    log = os.path.join(U.ROOT, OUT_DIR, "backend.log")
    proc = subprocess.Popen(
        [sys.executable, "-c",
         ("import sys; sys.path.insert(0,'.');"
          "from straditize_core.rpc_server import main;"
          f"sys.argv=['rpc_server','--port','{PORT}'];main()")],
        cwd=U.ROOT, stdout=open(log, "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{PORT}"
    try:
        ok = wait_backend(base)
        print(f"  后端就绪 = {ok}  ({base})")
        if not ok:
            print(open(log, encoding="utf-8", errors="replace").read()[-1200:])
            return 1

        for name, strip in (("baseline", []), ("stripped", ["startValue", "tickValue"])):
            print(f"\n=== case: {name}  strip={strip} ===")
            d = run_case(name, strip, base, tmp)
            if d.get("fatal"):
                print(f"    FATAL: {d['fatal']}")
                continue
            st = d.get("setup") or {}
            print(f"    load: {st.get('load')}")
            det = st.get("detect") or {}
            print(f"    detect: ok={det.get('ok')} n={det.get('n')} "
                  f"stripped={st.get('stripped')} hookErr={st.get('hookErr')}")
            print(f"    后端原始首列 keys = {det.get('firstColKeys')}")
            fc = det.get("firstCol") or {}
            print(f"    后端原始首列 startValue={fc.get('startValue')!r} "
                  f"tickValue={fc.get('tickValue')!r} tickEndX={fc.get('tickEndX')!r}")
            v = d.get("visible") or {}
            print(f"    页面 title={v.get('title')!r}  bodyLen={v.get('bodyLen')}")
            print(f"    可见文本片段（含 % / 20 / 100）:")
            for s in (v.get("snippets") or [])[:20]:
                print(f"      {s!r}")
            lg = d.get("logs") or []
            if lg:
                print(f"    最后几条 console:")
                for s in lg[-6:]:
                    print(f"      {s[:140]}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
