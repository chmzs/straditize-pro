# -*- coding: utf-8 -*-
"""A2c 判别：步骤 6 显示 0/20 但剥字段后仍 0/20 —— 到底用的是哪条数据源？

现象（a2b 实测）：
  baseline  (后端发 startValue=0, tickValue=20)      → UI val1='0'  val2='20'
  stripped  (后端*不发* startValue/tickValue)         → UI val1='0'  val2='20'
  strip_all (连 tickEndX 也不发)                      → UI val1='0'  val2='20'

若 UI 真的消费 detectColumns 的响应，stripped 组应变成
`RpcClient.ts:838` 的 `c.tickValue || 100` = **100**。
可它仍是 20 —— 说明步骤 6 的面板**不是**用那次 detectColumns 的响应构造的。

两个候选解释，本脚本用实验区分：
  H1  列数据来自 `core.getDiagramData`（不是 detectColumns），那条路径没被我剥
  H2  剥字段发生在「前端已经构造好 Column 之后」，后续渲染沿用旧对象

判据：直接读**前端内存里的 data.columns[0]**（若可达），并同时读
getDiagramData 的响应里有没有 startValue/tickValue。
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
PORT = 23093

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

  // 钩子：同时记录 getDiagramData 与 detectColumns 的响应键
  await page.addInitScript((fields) => {
    window.__STRIP_FIELDS__ = fields;
    window.__SEEN__ = {};
  }, strip);
  await page.addInitScript(fs.readFileSync(hookPath, 'utf8'));


  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // 与 a2b 保持一致的前置：先建立"已分列"后端状态
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
    return { img: { w: a.result?.width, h: a.result?.height }, nCols: arr.length };
  });

  // 真实 UI 推进到步骤 6
  const trail = [];
  for (let i = 0; i < 8; i++) {
    const has = await page.evaluate(() => !!document.getElementById('inp-manual-tick-val1'));
    if (has) break;
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('#btn-wf-next');
      if (!b || b.disabled) return false;
      b.click(); return true;
    });
    const stage = await page.evaluate(() => {
      const el = document.querySelector('.workflow-action-bar__step');
      return el ? el.textContent.trim() : null;
    });
    trail.push({ i, clicked, stage });
    await page.waitForTimeout(1700);
  }

  // 关键：分别探两条数据源
  const probe = await page.evaluate(async () => {
    const call = async (method, params) => {
      const r = await fetch('/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 9, method, params }),
      });
      return await r.json();
    };
    const dd = await call('core.getDiagramData', {});
    const res = dd.result || {};
    const cols = res.columns || [];
    const c0 = cols[0] || null;

    // 读 UI 内存里画布数据（若组件暴露）
    let mem = null;
    try {
      const cand = window.__canvasData__ || window.canvasComponent?.data ||
                   window.__diagramData__ || null;
      if (cand && cand.columns) {
        const m = cand.columns[0];
        mem = m ? { tickValue: m.tickValue, startValue: m.startValue,
                    maxPercent: m.maxPercent, tickEndX: m.tickEndX } : null;
      }
    } catch (e) { mem = { err: String(e) }; }

    return {
      diagramData: {
        nCols: cols.length,
        firstColKeys: c0 ? Object.keys(c0) : [],
        c0: c0 ? { startValue: c0.startValue, tickValue: c0.tickValue,
                   maxPercent: c0.maxPercent, tickEndX: c0.tickEndX,
                   start: c0.start, end: c0.end } : null,
      },
      mem,
      stripped: window.__STRIPPED__ || 0,
      seen: window.__SEEN__ || {},
      all: (window.__ALL__ || []).slice(0, 40),
    };
  });

  const inputs = await page.evaluate(() => {
    const g = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : null;
    };
    const stageEl = document.querySelector('.workflow-action-bar__step');
    return { val1: g('inp-manual-tick-val1'), val2: g('inp-manual-tick-val2'),
             stage: stageEl ? stageEl.textContent.trim() : null };
  });

  fs.writeFileSync(outPath, JSON.stringify({ strip, boot, trail, probe, inputs }, null, 2));
  await browser.close();
})().catch((e) => {
  require('fs').writeFileSync(process.argv[4], JSON.stringify({ fatal: String(e) }, null, 2));
  process.exit(1);
});
"""

HOOK = r"""
(() => {
  const strips = window.__STRIP_FIELDS__ || [];
  const seen = window.__SEEN__ || (window.__SEEN__ = {});
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const resp = await origFetch.apply(this, args);
    try {
      const url = (args[0] && args[0].url) || args[0] || '';
      if (!String(url).includes('/rpc')) return resp;
      const clone = resp.clone();
      const j = await clone.json();
      let touched = false;
      // 记录所有方法名与是否含 tickValue（任意深度），用于定位数据源
      try {
        const raw = JSON.stringify(j);
        const methodGuess = (raw.match(/"method"\s*:\s*"([^"]+)"/) || [])[1] || '?';
        const all = window.__ALL__ || (window.__ALL__ = []);
        all.push({ method: methodGuess, len: raw.length, hasTick: raw.includes('"tickValue"') });
      } catch (e) {}

      // 记录两条路径各自是否带 startValue/tickValue
      const note = (label, obj) => {
        if (!obj || typeof obj !== 'object') return;
        seen[label] = {
          hasStartValue: 'startValue' in obj,
          hasTickValue: 'tickValue' in obj,
          tickValue: obj.tickValue,
          startValue: obj.startValue,
        };
      };

      // 递归深剥：任何深度上名为 startValue/tickValue 的键都删掉。
      // 这样才真正等价于"后端从不发送这两个字段"，不依赖响应结构猜测。
      const deepStrip = (node, depth) => {
        if (depth > 12 || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          for (const it of node) deepStrip(it, depth + 1);
          return;
        }
        for (const f of strips) {
          if (f in node) { delete node[f]; touched = true; }
        }
        for (const k of Object.keys(node)) deepStrip(node[k], depth + 1);
      };
      deepStrip(j, 0);

      if (touched) {
        window.__STRIPPED__ = (window.__STRIPPED__ || 0) + 1;
        return new Response(JSON.stringify(j), {
          status: resp.status, statusText: resp.statusText, headers: resp.headers,
        });
      }

      // 本版只观测不改写：返回原 resp，确保前端行为与生产一致
    } catch (e) { window.__HOOK_ERR__ = String(e); }
    return resp;
  };
})();
"""


def wait_backend(base: str, tries: int = 60) -> bool:
    for _ in range(tries):
        try:
            urllib.request.urlopen(base + "/", timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def run_case(name, strip, base, tmp):
    out = os.path.join(U.ROOT, OUT_DIR, f"a2c_{name}.json")
    r = subprocess.run(
        ["node", os.path.join(tmp, "driver_c.cjs"), base, json.dumps(strip), out,
         os.path.join(tmp, "hook_c.js")],
        cwd=os.path.join(U.ROOT, "frontend"),
        capture_output=True, text=True, timeout=200,
    )
    if r.returncode != 0:
        print(f"    node exit={r.returncode} stderr={r.stderr[-500:]}")
    if os.path.exists(out):
        return json.loads(open(out, encoding="utf-8").read())
    return {"fatal": r.stderr[-400:]}


def main() -> int:
    U.hash_banner("A2c 步骤6 的列数据来自哪条路径")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    tmp = os.path.join(U.ROOT, "frontend", ".prod_gate_tmp")
    os.makedirs(tmp, exist_ok=True)
    open(os.path.join(tmp, "driver_c.cjs"), "w", encoding="utf-8").write(DRIVER)
    open(os.path.join(tmp, "hook_c.js"), "w", encoding="utf-8").write(HOOK)

    log = os.path.join(U.ROOT, OUT_DIR, "backend_c.log")
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
        print(f"  后端就绪 = {ok} ({base})")
        if not ok:
            print(open(log, encoding="utf-8", errors="replace").read()[-1200:])
            return 1
        for name, strip in (
            ("baseline", []),
            ("stripped", ["startValue", "tickValue"]),
        ):
            print(f"\n=== {name}  strip={strip} ===")
            d = run_case(name, strip, base, tmp)
            if d.get("fatal"):
                print(f"    FATAL: {d['fatal']}")
                continue
            print(f"    stage trail: {[(t['i'], t['stage']) for t in (d.get('trail') or [])]}")
            pr = d.get("probe") or {}
            dd = pr.get("diagramData") or {}
            print(f"    getDiagramData: nCols={dd.get('nCols')}")
            print(f"      firstColKeys = {dd.get('firstColKeys')}")
            print(f"      c0 = {json.dumps(dd.get('c0'), ensure_ascii=False)}")
            print(f"    钩子观测 seen = {json.dumps(pr.get('seen'), ensure_ascii=False)}")
            print(f"    stripped={pr.get('stripped')}  mem={pr.get('mem')}")
            print("    RPC 方法序列（是否含 tickValue）:")
            for a in (pr.get("all") or []):
                print(f"      {a.get('method'):32s} len={a.get('len'):7d} hasTick={a.get('hasTick')}")
            inp = d.get("inputs") or {}
            print(f"    UI: stage={inp.get('stage')} val1={inp.get('val1')!r} val2={inp.get('val2')!r}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
