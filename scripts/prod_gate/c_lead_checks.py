# -*- coding: utf-8 -*-
"""C 项：Lead 要求补的两个测点。

C1  switchPdfPage 换页后 image_path 退化成 upload://diagram.png
    —— 这个退化是否影响**工程包保存**？（Lead 问：只影响会话内 scope，还是污染别处）
    project_save 的 image.path 写死 "image/original.png"，所以要么它无关，
    要么它有别的泄漏面。必须实测，不能推断。

C2  export.exportXlsx **传了 output_path** 时是否还会因 json.dumps 断连？
    这决定修复是"改返回编码一处"还是"两处都改"。
"""
from __future__ import annotations

import json
import os
import sys
import tarfile
import urllib.request

import _util as U  # noqa: E402

U.ensure_import_path()

PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
OUT_DIR = "output/prod_gate/c_lead_checks"
PORT = 23086


# ---------------------------------------------------------------------------
# C1: image_path 退化
# ---------------------------------------------------------------------------
def c1_image_path() -> None:
    print("\n" + "#" * 78)
    print("# C1  switchPdfPage 后 image_path 退化，及其对工程包保存的影响")
    print("#" * 78)
    from straditize_core.session import StraditizeSession

    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    s = StraditizeSession()
    s._init_cleanup()

    def snap(tag: str) -> dict:
        return {
            "tag": tag,
            "image_path": getattr(s, "image_path", None),
            "cached_pdf_path": getattr(s, "cached_pdf_path", None),
            "format": getattr(s, "format", None),
            "size": (getattr(s, "width", None), getattr(s, "height", None)),
            "pdf_info": getattr(s, "pdf_info", None),
            "geometry_scope": s._geometry_scope() if hasattr(s, "_geometry_scope") else None,
        }

    print("\n  --- image_path 逐页演化 ---")
    s.load_image(os.path.abspath(PDF), page_number=1)
    print(f"    page 1 (首次 load_image 传路径): {json.dumps(snap('p1'), ensure_ascii=False)}")
    s.switch_pdf_page(2)
    print(f"    page 2 (switch_pdf_page):        {json.dumps(snap('p2'), ensure_ascii=False)}")
    s.switch_pdf_page(5)
    print(f"    page 5 (switch_pdf_page):        {json.dumps(snap('p5'), ensure_ascii=False)}")

    # 关键：退化是否影响 project_save？
    print("\n  --- 在退化状态下建状态并保存工程包 ---")
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(name="p5", x0=330, x1=1330, y0=233, y1=861, composition=True)["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    s.detect_columns(roi_id=rid)
    s.calibrate_axes(
        y_marks=[{"pixel": 232.0, "val": 0.0}, {"pixel": 862.0, "val": 787.0}], unit="cm"
    )
    s.samples_paste_depths([0.0, 10.0, 20.0])

    json_path = os.path.join(U.ROOT, OUT_DIR, "c1_degraded.project.json")
    tar_path = os.path.join(U.ROOT, OUT_DIR, "c1_degraded.project.tar")
    s.project_save(output_path=json_path, format="json")
    s.project_save(output_path=tar_path, format="tar")

    pj = json.loads(open(json_path, encoding="utf-8").read())
    print(f"    工程包 image 字段 = {json.dumps(pj.get('image'), ensure_ascii=False)}")
    print(f"    工程包顶层是否有 image_path / pdf_info / page_number 之类的溯源字段: "
          f"{[k for k in pj if 'image' in k.lower() or 'pdf' in k.lower() or 'page' in k.lower()]}")
    print(f"    （会话内 image_path = {getattr(s, 'image_path', None)!r}）")
    print(f"    >>> 看：退化值有没有被写进工程包？")

    with tarfile.open(tar_path) as tf:
        names = [m.name for m in tf.getmembers()]
    print(f"    tar 成员 = {names}")
    img_members = [n for n in names if n.lower().endswith((".png", ".jpg", ".jpeg"))]
    print(f"    tar 内位图成员 = {img_members}")
    for m in img_members:
        with tarfile.open(tar_path) as tf:
            data = tf.extractfile(m).read()
        print(f"      {m}: {len(data)} B")

    # 退化状态下，有没有别的地方用到 image_path？
    print("\n  --- 退化状态下逐项探测：哪些接口会读到 image_path ---")
    probes = [
        ("get_export_readiness", lambda: s.get_export_readiness()),
        ("project_save(json)", lambda: s.project_save(format="json")),
    ]
    for name, fn in probes:
        try:
            r = fn()
            blob = json.dumps(r, default=str, ensure_ascii=False)
            has = "upload://diagram.png" in blob
            print(f"    {name:22s} -> OK   返回值中含 'upload://diagram.png': {has}")
            if has:
                # 找出是哪个键
                def find(o, path=""):
                    hits = []
                    if isinstance(o, dict):
                        for k, v in o.items():
                            hits += find(v, f"{path}.{k}" if path else k)
                    elif isinstance(o, list):
                        for i, v in enumerate(o[:5]):
                            hits += find(v, f"{path}[{i}]")
                    elif isinstance(o, str) and "upload://diagram.png" in o:
                        hits.append(path)
                    return hits
                print(f"         出现位置: {find(r)[:6]}")
        except Exception as exc:
            print(f"    {name:22s} -> {type(exc).__name__}: {exc}")

    # 往返：退化状态保存的工程包能否载回
    print("\n  --- 往返验证：退化状态下保存的工程包能否载回 ---")
    s2 = StraditizeSession()
    s2._init_cleanup()
    try:
        r = s2.project_load(json_path)
        print(f"    project_load -> OK columns={r.get('columns_count')} "
              f"is_calibrated={r.get('is_calibrated')}")
        print(f"    载回后 image_path = {getattr(s2, 'image_path', None)!r}")
        print(f"    载回后 size = {getattr(s2, 'width', None)}x{getattr(s2, 'height', None)}")
        print(f"    载回后 samples = {len(getattr(s2, 'samples', []) or [])}")
        print(f"    载回后 y_scale = {getattr(s2, 'y_scale', None)}")
    except Exception as exc:
        print(f"    project_load -> {type(exc).__name__}: {exc}")


# ---------------------------------------------------------------------------
# C2: exportXlsx 传 output_path 时是否还崩
# ---------------------------------------------------------------------------
def c2_xlsx_output_path() -> None:
    print("\n" + "#" * 78)
    print(f"# C2  export.exportXlsx 传 output_path 时是否仍断连（HTTP {PORT}）")
    print("#" * 78)
    import subprocess
    import time

    log = os.path.join(U.ROOT, OUT_DIR, "backend_c2.log")
    proc = subprocess.Popen(
        [sys.executable, "-c",
         ("import sys; sys.path.insert(0,'.');"
          "from straditize_core.rpc_server import main;"
          f"sys.argv=['rpc_server','--port','{PORT}'];main()")],
        cwd=U.ROOT, stdout=open(log, "w"), stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{PORT}"
    try:
        ok = False
        for _ in range(60):
            try:
                urllib.request.urlopen(base + "/", timeout=1)
                ok = True
                break
            except Exception:
                time.sleep(0.5)
        print(f"  后端就绪 = {ok}")
        if not ok:
            print(open(log, encoding="utf-8", errors="replace").read()[-1000:])
            return

        def rpc(method, params):
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                               "params": params}).encode()
            req = urllib.request.Request(base + "/rpc", data=body,
                                         headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.loads(resp.read().decode())

        print("\n  准备会话 ...")
        r0 = rpc("core.loadImage", {"sample_key": "hoya"})
        print(f"    loadImage -> {(r0.get('result') or {}).get('width')}x"
              f"{(r0.get('result') or {}).get('height')}")
        roi = ((r0.get("result") or {}).get("rois") or [{}])[0]
        rpc("core.detectColumns", {"data_xlim": [315, 1946], "data_ylim": [511, 1311],
                                   "roi_id": roi.get("id")})

        out_no = os.path.join(U.ROOT, OUT_DIR, "c2_no_path.xlsx")
        out_with = os.path.join(U.ROOT, OUT_DIR, "c2_with_path.xlsx")
        for tag, params in (
            ("不传 output_path", {"include_age_depth": True, "include_ensemble_names": [],
                                 "include_readme": True}),
            ("传 output_path", {"include_age_depth": True, "include_ensemble_names": [],
                               "include_readme": True, "output_path": out_with}),
        ):
            print(f"\n  >>> export.exportXlsx  {tag}")
            try:
                r = rpc("export.exportXlsx", params)
                if "error" in r:
                    print(f"      RPC error = {r['error']}")
                    continue
                res = r.get("result") or {}
                print(f"      返回键 = {sorted(res.keys())}")
                print(f"      data 类型 = {type(res.get('data')).__name__}")
                print(f"      base64 存在 = {'base64' in res}")
                print(f"      未断连")
            except Exception as exc:
                print(f"      断连/失败: {type(exc).__name__}: {exc}")

        print("\n  --- 后端日志里的 TypeError 次数 ---")
        txt = open(log, encoding="utf-8", errors="replace").read()
        print(f"    'Object of type bytes is not JSON serializable' 出现 "
              f"{txt.count('Object of type bytes is not JSON serializable')} 次")
        print(f"    传 output_path 那次同时写出文件了吗: "
              f"{os.path.exists(out_with)}  "
              f"({os.path.getsize(out_with) if os.path.exists(out_with) else 0} B)")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()


def main() -> int:
    U.hash_banner("C 项：image_path 退化 + xlsx output_path 边界")
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "c1"):
        c1_image_path()
    if which in ("all", "c2"):
        c2_xlsx_output_path()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
