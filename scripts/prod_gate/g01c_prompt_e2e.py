# -*- coding: utf-8 -*-
"""G-01(c)：真实浏览器验证 FileLoaderService 的页码 prompt 是否构成静默兜底。

不靠读代码下结论。做法：
  1. 起真实后端（自用端口段）
  2. 用 Playwright（node，仓内已装）驱动真实 Chromium
  3. 用 page.on('dialog') 拦截 window.prompt，依次回答：
        "abc" / "" / "5" / "14" / "0"
  4. 每次记录：后端真实收到的 page_number、最终载入的图尺寸、界面是否有报错
  5. 判据：输入非法时是否**静默**变成第 1 页（而不是报错停在原地）

前置：前端 dist 必须存在（后端托管）。
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

OUT_DIR = "output/prod_gate/g01c"
PORT = 23083
PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"

NODE_SCRIPT = r"""
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const base = process.argv[2];
  const pdfPath = process.argv[3];
  const answers = JSON.parse(process.argv[4]);
  const outPath = process.argv[5];

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();

  const rpcCalls = [];
  page.on('request', (req) => {
    if (req.url().endsWith('/rpc')) {
      try {
        const body = JSON.parse(req.postData() || '{}');
        rpcCalls.push({ method: body.method, params: body.params });
      } catch (e) {}
    }
  });

  const dialogs = [];
  page.on('dialog', async (d) => {
    const answer = answers.length ? answers.shift() : null;
    dialogs.push({ type: d.type(), message: d.message(), default: d.defaultValue(), answer });
    if (answer === null) { await d.dismiss(); }
    else { await d.accept(answer); }
  });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 找到 file input 并上传 PDF（走真实前端 FileLoaderService 路径）
  const inputs = await page.$$('input[type=file]');
  if (!inputs.length) {
    fs.writeFileSync(outPath, JSON.stringify({ fatal: 'no file input found' }, null, 2));
    await browser.close();
    return;
  }
  let used = null;
  for (const inp of inputs) {
    const accept = (await inp.getAttribute('accept')) || '';
    if (accept.includes('pdf') || accept.includes('*') || accept === '') { used = inp; break; }
  }
  if (!used) used = inputs[0];

  await used.setInputFiles(pdfPath);
  await page.waitForTimeout(6000);

  // 读界面上的权威状态（后端 imageWidth/Height 若可见）
  const state = await page.evaluate(async () => {
    try {
      const r = await fetch('/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'core.getState', params: {} }),
      });
      const j = await r.json();
      return j.result || j.error || null;
    } catch (e) { return { evalError: String(e) }; }
  });

  fs.writeFileSync(outPath, JSON.stringify({
    dialogs, rpcCalls, consoleErrors, pageErrors, state,
  }, null, 2));
  await browser.close();
})().catch((e) => {
  require('fs').writeFileSync(process.argv[5], JSON.stringify({ fatal: String(e) }, null, 2));
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


def run_case(name: str, answers: list, base: str) -> dict:
    # playwright 必须从 frontend/node_modules 解析，所以 driver 脚本要放在 frontend/ 下；
    # 但它属于本巡检的产物，故写到 frontend/.prod_gate_tmp/ 并在结束时清掉。
    tmp_dir = os.path.join(U.ROOT, "frontend", ".prod_gate_tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    script_path = os.path.join(tmp_dir, "driver.cjs")
    with open(script_path, "w", encoding="utf-8") as fh:
        fh.write(NODE_SCRIPT)
    out_path = os.path.join(U.ROOT, OUT_DIR, f"case_{name}.json")
    r = subprocess.run(
        ["node", script_path, base, os.path.abspath(PDF), json.dumps(answers), out_path],
        cwd=os.path.join(U.ROOT, "frontend"),
        capture_output=True,
        text=True,
        timeout=180,
    )
    if r.returncode != 0:
        print(f"    node exit={r.returncode} stderr={r.stderr[-600:]}")
    if os.path.exists(out_path):
        return json.loads(open(out_path, encoding="utf-8").read())
    return {"fatal": f"no output; stderr={r.stderr[-400:]}"}


def main() -> int:
    U.hash_banner("G-01(c) frontend page-number prompt")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)

    dist = os.path.join(U.ROOT, "frontend", "dist", "index.html")
    print(f"\n前端 dist 存在 = {os.path.exists(dist)}")
    if not os.path.exists(dist):
        print("    dist 缺失 -> 需先 npm run build，本探针跳过（记为 UNCERTAIN）")
        return 2

    with open(os.path.join(U.ROOT, OUT_DIR, "_driver.cjs"), "w", encoding="utf-8") as fh:
        fh.write(NODE_SCRIPT)

    log = os.path.join(U.ROOT, OUT_DIR, "backend.log")
    proc = subprocess.Popen(
        [
            sys.executable, "-c",
            (
                "import sys; sys.path.insert(0,'.');"
                "from straditize_core.rpc_server import main;"
                f"sys.argv=['rpc_server','--port','{PORT}'];"
                "main()"
            ),
        ],
        cwd=U.ROOT,
        stdout=open(log, "w"),
        stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{PORT}"
    try:
        ok = wait_backend(base)
        print(f"后端就绪 = {ok}  ({base})")
        if not ok:
            print(open(log, encoding="utf-8", errors="replace").read()[-1200:])
            return 1

        cases = {
            "valid_5": ["5"],
            "nonnumeric_abc": ["abc"],
            "empty_string": [""],
            "zero": ["0"],
            "out_of_range_14": ["14"],
            "cancel": [None],
        }
        for name, answers in cases.items():
            print(f"\n=== case: {name}  回答={answers} ===")
            data = run_case(name, answers, base)
            if data.get("fatal"):
                print(f"    FATAL: {data['fatal']}")
                continue
            dl = data.get("dialogs") or []
            print(f"    dialog 次数 = {len(dl)}")
            for d in dl:
                print(f"      type={d.get('type')} default={d.get('default')!r} "
                      f"answer={d.get('answer')!r}")
                print(f"      message={ (d.get('message') or '')[:110]!r}")
            calls = [c for c in (data.get("rpcCalls") or [])
                     if "load" in (c.get("method") or "").lower()]
            print(f"    loadImage 类 RPC 调用数 = {len(calls)}")
            for c in calls:
                p = c.get("params") or {}
                print(f"      {c.get('method')}  page_number={p.get('page_number')} "
                      f"file_name={p.get('file_name')}")
            st = data.get("state") or {}
            if isinstance(st, dict):
                print(f"    最终会话状态: {st.get('width')}x{st.get('height')} "
                      f"pdf_info={st.get('pdf_info')}")
            pe = data.get("pageErrors") or []
            if pe:
                print(f"    pageErrors: {pe[:2]}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
