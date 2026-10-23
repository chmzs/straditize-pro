# -*- coding: utf-8 -*-
"""A2d 决定版：后端**真的**不发 startValue/tickValue 时，用户看到什么。

## 为什么前面几版都不算数（如实记录，这是方法论问题）

A2a：靠抓页面上的 "%" 文本 —— **代理指标**。页面上满是无关百分比
     （缩放提示 10%~1000%、"100% 原始物理分辨率"），无法判定列量程。
A2b/A2c：用 fetch 钩子剥字段 —— 两个坑：
  ① 钩子记录的是**剥离前**的内容，日志显示 "hasTick=True" 是假象；
  ② 即使剥成功，前端可能用**更早缓存**的列对象渲染，钩子改不到。
  两版都得出"剥了也还是 0/20"，但这个结论不可信——无法区分
  "兜底值真的是 20" 与 "我的钩子根本没生效到渲染路径"。

## 本版做法（干净、可判别）

不改源码、不改 dist，在**后端**装一个 shim：
`rpc_methods.register_all()` 之后重新注册 `core.detectColumns`，
把返回的每个列字典里的 startValue / tickValue 删掉，再交给真实 session。
这样"后端真的不发这两个字段"是**网络层可见的事实**，而不是我猜的。

判据：
  若 UI 显示 0/100 → RpcClient.ts:838 的 `|| 100` 生效（Lead 的担心成立）
  若 UI 显示 0/20  → 另有兜底救了它，需要继续查是谁
  若 UI 报错/空     → 前端不依赖这两个字段
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
PORT = 23094

SERVER = r'''
import sys, os
sys.path.insert(0, ".")

STRIP = os.environ.get("STRIP_FIELDS", "")
strip_set = {s for s in STRIP.split(",") if s}

from straditize_core.rpc_server import main as server_main
from straditize_core import rpc_methods
from straditize_core.session import StraditizeSession

# 在 server_main 之前替换 register_all，好在注册完成后覆盖 core.detectColumns
_orig_register_all = rpc_methods.register_all

def patched_register_all(dispatcher, session):
    names = _orig_register_all(dispatcher, session)
    if strip_set:
        def detect_columns_stripped(*args, **kwargs):
            res = session.detect_columns(*args, **kwargs)
            out = []
            for c in res:
                d = dict(c)
                for f in strip_set:
                    d.pop(f, None)
                out.append(d)
            return out
        dispatcher.register_method("core.detectColumns", detect_columns_stripped)
        # straditize.getDiagramData 也要剥（前端组装列的真正来源）
        _orig_gdd = None
        try:
            _orig_gdd = dispatcher._methods.get("straditize.getDiagramData")
        except Exception:
            _orig_gdd = None
        if _orig_gdd is not None:
            def gdd_stripped(*a, **k):
                r = _orig_gdd(*a, **k)
                if isinstance(r, dict) and isinstance(r.get("columns"), list):
                    cols = []
                    for c in r["columns"]:
                        d = dict(c)
                        for f in strip_set:
                            d.pop(f, None)
                        cols.append(d)
                    r = dict(r); r["columns"] = cols
                return r
            dispatcher.register_method("straditize.getDiagramData", gdd_stripped)
    return names

rpc_methods.register_all = patched_register_all
sys.argv = ["rpc_server", "--port", os.environ["PORT"]]
server_main()
'''

DRIVER = r"""
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const base = process.argv[2];
  const outPath = process.argv[3];

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1700, height: 1050 } });
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e)));

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // 真实后端路径建立"已分列"
  const boot = await page.evaluate(async () => {
    const call = async (method, params) => {
      const r = await fetch('/rpc', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      return await r.json();
    };
    const gcols = []; const gtxt = '';
    const a = await call('core.loadImage', { sample_key: 'hoya' });
    const roi = (a.result?.rois || [])[0];
    const b = await call('core.detectColumns', {
      data_xlim: [315, 1946], data_ylim: [511, 1311], roi_id: roi?.id,
    });
    const arr = Array.isArray(b.result) ? b.result : (b.result?.columns || []);
    const raw = JSON.stringify(b);
    return {
      nCols: arr.length,
      networkHasStartValue: raw.includes('"startValue"'),
      networkHasTickValue: raw.includes('"tickValue"'),
      gddNCols: gcols.length,
      gddHasStartValue: gtxt.includes('"startValue"'),
      gddHasTickValue: gtxt.includes('"tickValue"'),
      gddFirstCol: gcols[0] ? { startValue: gcols[0].startValue, tickValue: gcols[0].tickValue } : null,
      firstCol: arr[0] ? {
        startValue: arr[0].startValue, tickValue: arr[0].tickValue,
        tickEndX: arr[0].tickEndX, start: arr[0].start, end: arr[0].end,
      } : null,
    };
  });

  // 真实 UI 推进到步骤 6
  const trail = [];
  for (let i = 0; i < 9; i++) {
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
    await page.waitForTimeout(1800);
  }

  // 步骤 6 之后再探 getDiagramData（此刻列才真正存在）
  const gdd = await page.evaluate(async () => {
    const r = await fetch('/rpc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 77, method: 'straditize.getDiagramData', params: {} }),
    });
    const j = await r.json();
    const cols = (j.result && j.result.columns) || [];
    const txt = JSON.stringify(j);
    return {
      nCols: cols.length,
      hasStartValue: txt.includes('"startValue"'),
      hasTickValue: txt.includes('"tickValue"'),
      firstCol: cols[0] ? {
        startValue: cols[0].startValue, tickValue: cols[0].tickValue,
        startX: cols[0].startX, endX: cols[0].endX,
        maxPercent: cols[0].maxPercent, tickEndX: cols[0].tickEndX,
        x_ticks: cols[0].x_ticks,
      } : null,
    };
  });

  const out = await page.evaluate(() => {
    const g = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
    const stageEl = document.querySelector('.workflow-action-bar__step');
    return {
      stage: stageEl ? stageEl.textContent.trim() : null,
      val1: g('inp-manual-tick-val1'),
      val2: g('inp-manual-tick-val2'),
      // 同时抓画布上可见的量程文字
      canvasText: (() => {
        try {
          const cv = document.querySelector('canvas');
          return cv ? { w: cv.width, h: cv.height } : null;
        } catch (e) { return null; }
      })(),
    };
  });

  fs.writeFileSync(outPath, JSON.stringify({ boot, trail, gdd, out, logs: logs.slice(-25) }, null, 2));
  await browser.close();
})().catch((e) => {
  require('fs').writeFileSync(process.argv[3], JSON.stringify({ fatal: String(e) }, null, 2));
  process.exit(1);
});
"""


def wait_backend(base: str, tries: int = 80) -> bool:
    for _ in range(tries):
        try:
            urllib.request.urlopen(base + "/", timeout=1)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def run_case(name: str, strip: str, tmp: str) -> dict:
    port = PORT if not strip else PORT + 1
    env = dict(os.environ)
    env["PORT"] = str(port)
    env["STRIP_FIELDS"] = strip
    log = os.path.join(U.ROOT, OUT_DIR, f"backend_{name}.log")
    proc = subprocess.Popen(
        [sys.executable, os.path.join(tmp, "shim_server.py")],
        cwd=U.ROOT, env=env, stdout=open(log, "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}"
    try:
        if not wait_backend(base):
            print(f"    后端未就绪，日志尾部：")
            print(open(log, encoding="utf-8", errors="replace").read()[-1500:])
            return {"fatal": "backend not ready"}
        outc = os.path.join(U.ROOT, OUT_DIR, f"a2d_{name}.json")
        r = subprocess.run(
            ["node", os.path.join(tmp, "driver_d.cjs"), base, outc],
            cwd=os.path.join(U.ROOT, "frontend"),
            capture_output=True, text=True, timeout=220,
        )
        if r.returncode != 0:
            print(f"    node exit={r.returncode} stderr={r.stderr[-500:]}")
        if os.path.exists(outc):
            return json.loads(open(outc, encoding="utf-8").read())
        return {"fatal": r.stderr[-400:]}
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()


def main() -> int:
    U.hash_banner("A2d 后端真不发 startValue/tickValue 时用户看到什么")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    tmp = os.path.join(U.ROOT, "frontend", ".prod_gate_tmp")
    os.makedirs(tmp, exist_ok=True)
    open(os.path.join(tmp, "shim_server.py"), "w", encoding="utf-8").write(SERVER)
    open(os.path.join(tmp, "driver_d.cjs"), "w", encoding="utf-8").write(DRIVER)

    for name, strip in (
        ("control", ""),
        ("stripped", "startValue,tickValue"),
    ):
        print(f"\n=== case: {name}  STRIP_FIELDS={strip!r} ===")
        d = run_case(name, strip, tmp)
        if d.get("fatal"):
            print(f"    FATAL: {d['fatal']}")
            continue
        boot = d.get("boot") or {}
        print(f"    列数={boot.get('nCols')}")
        print(f"    网络响应里含 startValue = {boot.get('networkHasStartValue')}")
        print(f"    网络响应里含 tickValue  = {boot.get('networkHasTickValue')}")
        print(f"    getDiagramData: nCols={boot.get('gddNCols')} "
              f"含startValue={boot.get('gddHasStartValue')} 含tickValue={boot.get('gddHasTickValue')}")
        print(f"    getDiagramData 首列 = {json.dumps(boot.get('gddFirstCol'), ensure_ascii=False)}")
        print(f"    网络首列 = {json.dumps(boot.get('firstCol'), ensure_ascii=False)}")
        g = d.get("gdd") or {}
        print(f"    步骤6后 getDiagramData: nCols={g.get('nCols')} "
              f"含startValue={g.get('hasStartValue')} 含tickValue={g.get('hasTickValue')}")
        print(f"      首列 = {json.dumps(g.get('firstCol'), ensure_ascii=False)}")
        o = d.get("out") or {}
        print(f"    UI stage={o.get('stage')}  "
              f"val1={o.get('val1')!r}  val2={o.get('val2')!r}")
        for lg in (d.get("logs") or [])[-5:]:
            print(f"      log: {lg[:130]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
