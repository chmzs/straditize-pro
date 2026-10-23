# -*- coding: utf-8 -*-
"""A2（重写）：三处前端兜底链的真实用户可见结果 —— 真实 Edge + 真实后端。

## 为什么要重写

第一版靠"抓页面上的百分比文本"，属于**代理指标**：页面上有大量无关的 % 文本
（缩放提示 10%~1000%、分辨率 100% 等），无法从中判定"列量程显示多少"。
这与本团队栽过的坑同类，故改为直接读**用户真正看到的那个 DOM 元素**。

## 真正的测点（用户可见）

`frontend/src/components/steps/XTicksPanel.ts` 的步骤 6 面板，第 115 / 131 行：
    <input id="inp-manual-tick-val1" value="${hasTicks ? x_ticks[0].value : (activeCol?.startValue ?? 0)}">
    <input id="inp-manual-tick-val2" value="${hasTicks ? x_ticks[1].value : (activeCol?.tickValue ?? 20)}">

这是用户在界面上填/看量程的唯一入口。本脚本读这两个 input 的 **value**。

## 三处兜底的静态事实（本脚本要实测谁真正生效）

① RpcClient.ts:837-838   startValue: c.startValue || 0 ; tickValue: c.tickValue || 100
   同处 :829 还硬编码 maxPercent: 100
② CoordinateSystem.ts:139-140  val0 = col.startValue ?? sc?.originVal ?? 0
                               val1 = col.tickValue ?? sc?.calibVal ?? col.maxPercent ?? 20
③ GeologyCanvas.ts:1535  col.maxPercent ?? col.tickValue ?? 20

关键推论（待实测）：① 在**构造** Column 对象时就把字段填上了，
所以 ②③ 看到的 col.startValue / col.tickValue 永远不是 undefined，
它们的 ?? 链根本轮不到执行。若成立，则"移除后端字段"会让用户看到
**0 / 100**（不是 0 / 20），即 Lead 担心的"从 20 变成 100"确有其事。
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
PORT = 23092

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
        // core.detectColumns 的 result 直接是数组
        if (j && Array.isArray(j.result)) {
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
            status: resp.status, statusText: resp.statusText, headers: resp.headers,
          });
        }
      }
    } catch (e) { window.__HOOK_ERR__ = String(e); }
    return resp;
  };
})();
"""

DRIVER = r"""
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const base = process.argv[2];
  const strip = JSON.parse(process.argv[3]);
  const outPath = process.argv[4];
  const hookPath = process.argv[5];

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e)));

  if (strip.length) {
    await page.addInitScript((fields) => { window.__STRIP_FIELDS__ = fields; }, strip);
    await page.addInitScript(fs.readFileSync(hookPath, 'utf8'));
  }

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // ---- 用真实前端路径建立"已分列"状态：调 core.detectColumns（经钩子）----
  const boot = await page.evaluate(async () => {
    const call = async (method, params) => {
      const r = await fetch('/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return await r.json();
    };
    const a = await call('core.loadImage', { sample_key: 'hoya' });
    const roi = (a.result?.rois || [])[0];
    const b = await call('core.detectColumns', {
      data_xlim: [315, 1946], data_ylim: [511, 1311], roi_id: roi?.id,
    });
    const arr = Array.isArray(b.result) ? b.result : (b.result?.columns || []);
    return {
      img: { w: a.result?.width, h: a.result?.height },
      nCols: arr.length,
      backendFirstCol: arr[0] || null,
      stripped: window.__STRIPPED__ || 0,
      hookErr: window.__HOOK_ERR__ || null,
    };
  });

  // ---- 关键：让页面 UI 走到步骤 6，读那两个真实输入框 ----
  // 先尝试点【下一步】推进到步骤 6；若控件不可用，退回按 DOM 直接触发
  const stepInfo = await page.evaluate(() => {
    const ids = [];
    document.querySelectorAll('[id]').forEach((el) => ids.push(el.id));
    return {
      hasVal1: !!document.getElementById('inp-manual-tick-val1'),
      hasVal2: !!document.getElementById('inp-manual-tick-val2'),
      allIds: ids.slice(0, 120),
    };
  });

  // ---- 用真实 UI 推进到步骤 6（点击 #btn-wf-next，真实用户路径）----
  // 先进步骤 2/3 需要真实交互，故走"逐次点击 btn-wf-next 并等待"的方式；
  // 每步记录阶段标签，直到出现 inp-manual-tick-val1 为止。
  const stageTrail = [];
  for (let i = 0; i < 8; i++) {
    const has = await page.evaluate(() => !!document.getElementById('inp-manual-tick-val1'));
    if (has) break;
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('#btn-wf-next');
      if (!b || b.disabled) return false;
      b.click();
      return true;
    });
    const label = await page.evaluate(() => {
      const el = document.querySelector('.workflow-action-bar__step');
      return el ? el.textContent.trim() : null;
    });
    stageTrail.push({ i, clicked, stage: label });
    await page.waitForTimeout(1600);
  }

  const inputs = await page.evaluate(() => {
    const g = (id) => {
      const el = document.getElementById(id);
      return el ? { value: el.value, tag: el.tagName } : null;
    };
    const stageEl = document.querySelector('.workflow-action-bar__step');
    return {
      val1: g('inp-manual-tick-val1'),
      val2: g('inp-manual-tick-val2'),
      stage: stageEl ? stageEl.textContent.trim() : null,
    };
  });

  fs.writeFileSync(outPath, JSON.stringify({
    strip, boot, stepInfo, inputs, stageTrail, logs: logs.slice(-20),
  }, null, 2));
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
        capture_output=True, text=True, timeout=200,
    )
    if r.returncode != 0:
        print(f"    node exit={r.returncode} stderr={r.stderr[-600:]}")
    if os.path.exists(out):
        return json.loads(open(out, encoding="utf-8").read())
    return {"fatal": r.stderr[-400:]}


def main() -> int:
    U.hash_banner("A2 三处前端兜底：用户可见结果")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    tmp = os.path.join(U.ROOT, "frontend", ".prod_gate_tmp")
    os.makedirs(tmp, exist_ok=True)
    open(os.path.join(tmp, "driver.cjs"), "w", encoding="utf-8").write(DRIVER)
    open(os.path.join(tmp, "hook.js"), "w", encoding="utf-8").write(HOOK_JS)

    log = os.path.join(U.ROOT, OUT_DIR, "backend.log")
    proc = subprocess.Popen(
        [sys.executable, "-c",
         ("import sys; sys.path.insert(0,'.');"
          "from straditize_core.rpc_server import main;"
          f"sys.argv=['rpc_server','--port','{PORT}'];main()")],
        cwd=U.ROOT, stdout=open(log, "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{PORT}"
    results = {}
    try:
        ok = wait_backend(base)
        print(f"  后端就绪 = {ok} ({base})")
        if not ok:
            print(open(log, encoding="utf-8", errors="replace").read()[-1200:])
            return 1
        for name, strip in (
            ("baseline", []),
            ("stripped", ["startValue", "tickValue"]),
            ("strip_all", ["startValue", "tickValue", "tickEndX"]),
        ):
            print(f"\n=== case: {name}  strip={strip} ===")
            d = run_case(name, strip, base, tmp)
            results[name] = d
            if d.get("fatal"):
                print(f"    FATAL: {d['fatal']}")
                continue
            boot = d.get("boot") or {}
            print(f"    图像 {boot.get('img')}   列数={boot.get('nCols')}  "
                  f"stripped={boot.get('stripped')}  hookErr={boot.get('hookErr')}")
            fc = boot.get("backendFirstCol") or {}
            print(f"    后端首列: startValue={fc.get('startValue')!r} "
                  f"tickValue={fc.get('tickValue')!r} tickEndX={fc.get('tickEndX')!r}")
            si = d.get("stepInfo") or {}
            print(f"    面板存在? val1={si.get('hasVal1')} val2={si.get('hasVal2')}")
            inp = d.get("inputs") or {}
            print(f"    阶段标签 = {inp.get('stage')!r}")
            print(f"    用户可见输入框: val1={inp.get('val1')}  val2={inp.get('val2')}")
            for t in (d.get("stageTrail") or []):
                print(f"      step{t['i']}: clicked={t['clicked']} stage={t['stage']!r}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()

    # 汇总
    print("\n" + "=" * 70)
    print("汇总：用户可见的列量程（inp-manual-tick-val1 / val2）")
    print("=" * 70)
    for name, d in results.items():
        inp = (d.get("inputs") or {})
        v1 = (inp.get("val1") or {}).get("value")
        v2 = (inp.get("val2") or {}).get("value")
        si = d.get("stepInfo") or {}
        print(f"  {name:10s} 面板={si.get('hasVal1')}  val1={v1!r}  val2={v2!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
