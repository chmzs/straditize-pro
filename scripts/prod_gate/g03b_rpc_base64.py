# -*- coding: utf-8 -*-
"""G-03 关键：前端实际发的 export.exportXlsx / export.exportLipd 请求能否拿到 base64。

前端 ExportModal.ts:608 / 644 的写法是：
    const res = await rpcClient.call('export.exportXlsx', {...})   // 注意：不传 output_path
    if (res && res.base64) { ...触发浏览器下载... }
    // 没有 else，也没有报错

所以真正要验的**不是** Python 直调带 output_path 的写盘路径，
而是**不带 output_path** 时返回体里到底有没有 `base64`。
若没有，这个按钮在真实用户手里就是"点了没反应、也不报错"。

本探针同时覆盖：
  E1  不经 HTTP，直接调 session.export_multi_xlsx(output_path=None) 看返回值键
  E2  不经 HTTP，直接调 session.export_multi_lipd(output_path=None) 看返回值键
  E3  起真实后端（端口自用段），走 HTTP JSON-RPC 发同形请求，看真实响应键
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

OUT_DIR = "output/prod_gate/g03"
PORT = 23071


def build_session():
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.extract_foreground()
    s.detect_columns([315, 1946], [511, 1311], roi_id=s.rois[0]["id"])
    c = s.columns[0]
    s.calibrate_column_xticks(
        0, ticks=[{"px": c["start"], "value": 0.0}, {"px": c["tickEndX"], "value": 40.0}], unit="%"
    )
    s.calibrate_axes(
        y_marks=[{"pixel": 511.0, "val": 0.0}, {"pixel": 1311.0, "val": 1300.0}], unit="cm"
    )
    for i in range(len(s.columns)):
        try:
            s.digitize(i)
        except Exception:
            pass
    s.samples_paste_depths([10.0, 50.0, 100.0, 200.0, 400.0, 800.0])
    return s


def e1_e2_direct() -> None:
    print("\n" + "#" * 78)
    print("# E1/E2  直接调 session 方法（output_path=None，与前端同形）")
    print("#" * 78)
    s = build_session()
    for label, fn in (
        ("export_multi_xlsx(output_path=None)", lambda: s.export_multi_xlsx()),
        ("export_multi_lipd(output_path=None)", lambda: s.export_multi_lipd()),
    ):
        try:
            r = fn()
            keys = sorted(r.keys())
            print(f"\n  {label}")
            print(f"    返回键 = {keys}")
            print(f"    含 base64 ? {'base64' in r}")
            print(f"    含 lipd   ? {'lipd' in r}")
            print(f"    含 output_path ? {'output_path' in r}")
            b = r.get("base64")
            print(f"    base64 类型/长度 = {type(b).__name__} / {len(b) if isinstance(b, str) else 'n/a'}")
        except Exception as exc:
            print(f"  {label} -> {type(exc).__name__}: {exc}")


def e3_http() -> None:
    print("\n" + "#" * 78)
    print(f"# E3  真实 HTTP 后端（127.0.0.1:{PORT}）上的同形请求")
    print("#" * 78)
    env = dict(os.environ)
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
        env=env,
        stdout=open(log, "w"),
        stderr=subprocess.STDOUT,
    )
    try:
        base = f"http://127.0.0.1:{PORT}"
        ok = False
        for _ in range(60):
            try:
                urllib.request.urlopen(base + "/", timeout=1)
                ok = True
                break
            except Exception:
                time.sleep(0.5)
        print(f"    后端就绪 = {ok}  (日志 {log})")
        if not ok:
            print(f"    --- 日志尾部 ---")
            print(open(log, encoding="utf-8", errors="replace").read()[-1500:])
            return

        def rpc(method: str, params: dict) -> dict:
            body = json.dumps(
                {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
            ).encode()
            req = urllib.request.Request(
                base + "/rpc", data=body, headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())

        # 建一个能导出的会话
        print("\n    准备会话: core.loadImage(sample_key=hoya) ...")
        r0 = rpc("core.loadImage", {"sample_key": "hoya"})
        res0 = r0.get("result") or {}
        print(f"      loadImage -> {res0.get('width')}x{res0.get('height')}")

        for label, method, params in (
            ("export.exportXlsx", "export.exportXlsx",
             {"include_age_depth": True, "include_ensemble_names": [], "include_readme": True}),
            ("export.exportLipd", "export.exportLipd",
             {"include_age_depth": True, "include_ensemble_names": []}),
        ):
            print(f"\n    >>> {label}  (前端同形：不传 output_path)")
            try:
                r = rpc(method, params)
            except Exception as exc:
                print(f"      HTTP 失败: {type(exc).__name__}: {exc}")
                continue
            if "error" in r:
                print(f"      RPC error = {r['error']}")
                continue
            res = r.get("result") or {}
            keys = sorted(res.keys())
            print(f"      返回键 = {keys}")
            print(f"      含 base64 ? {'base64' in res}   "
                  f"含 lipd ? {'lipd' in res}   含 data ? {'data' in res}")
            b = res.get("base64")
            print(f"      base64 类型/长度 = {type(b).__name__} / "
                  f"{len(b) if isinstance(b, str) else 'n/a'}")
            # 复刻前端的判据
            would_download = bool(res) and bool(res.get("base64"))
            print(f"      前端 `if (res && res.base64)` 是否会进入下载分支 = {would_download}")
            if not would_download:
                print(f"      >>> 结论：按钮点击后不下载、不报错（前端无 else 分支）")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()


def main() -> int:
    U.hash_banner("G-03 export RPC base64 contract")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    e1_e2_direct()
    e3_http()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
