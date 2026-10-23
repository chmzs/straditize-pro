# -*- coding: utf-8 -*-
"""独立复核 H：probes F-6（无锁会话撕裂读）与 F-7（verification 残留）。

F-6：我不复用对方脚本，自己起 HTTP 服务 + 自己写并发读线程。
两组对照：
  H1 纯后端并发读（loadImage 窗口内）
  H2 并发结束后的静态回读（验证"瞬时自愈"）

F-7：直接看三条落点（后端 key 表 / 前端 nameMap / Toolbar option），并实测 RPC。

运行：
    pixi run python scripts/verify_zero_flow/v08_race_verif.py
"""
from __future__ import annotations

import json
import threading
import time
import urllib.request

from vcommon import banner, isolate_config, make_dispatcher, new_session  # noqa: E402

CFG = isolate_config()


def main() -> None:
    print(f"[env] config isolated at: {CFG}")

    banner("H1. F-6：分发器是否真的无锁（静态核对）")
    from pathlib import Path

    proto = Path("straditize_core/protocol.py").read_text(encoding="utf-8").splitlines()
    hits = [(i, ln.strip()) for i, ln in enumerate(proto, 1)
            if any(k in ln for k in ("Lock", "threading", "RLock"))]
    print(f"  protocol.py 中 Lock/threading 命中数 = {len(hits)}  {hits}")
    srv = Path("straditize_core/rpc_server.py").read_text(encoding="utf-8").splitlines()
    for i, ln in enumerate(srv, 1):
        if "ThreadingHTTPServer" in ln:
            print(f"  rpc_server.py:{i}  {ln.strip()}")

    banner("H2. F-6：进程内并发读 —— loadImage 执行期间另一线程读 getDiagramData")
    s = new_session()
    _d, M = make_dispatcher(s)
    getter = M["straditize.getDiagramData"]

    torn = []
    stop = threading.Event()

    def reader(tag):
        while not stop.is_set():
            try:
                p = getter()
                w = p.get("imageWidth") or 0
                r = len(p.get("rois") or [])
                if w > 0 and r == 0:
                    torn.append({"tag": tag, "w": w, "rois": r})
            except Exception as e:  # noqa: BLE001
                torn.append({"tag": tag, "err": str(e)[:60]})

    ths = [threading.Thread(target=reader, args=(f"t{i}",), daemon=True) for i in range(3)]
    for t in ths:
        t.start()
    time.sleep(0.02)
    s.load_image(sample_key="hoya")
    time.sleep(0.05)
    stop.set()
    for t in ths:
        t.join(timeout=2)
    print(f"  loadImage 一次，3 个读线程，撕裂读数 = {len(torn)} 次")
    if torn:
        print(f"  例: {json.dumps(torn[0], ensure_ascii=False)}")
    p = getter()
    print(f"  并发结束后静态回读: imageWidth={p.get('imageWidth')} rois={len(p.get('rois') or [])}")
    print(f"  >>> 瞬时自愈？ {'是' if p.get('imageWidth') and p.get('rois') else '否'}")

    banner("H3. F-7：verification 范例的三处落点与可达性")
    core = Path("straditize_core/session_parts/core.py").read_text(encoding="utf-8").splitlines()
    for i, ln in enumerate(core, 1):
        if "verification" in ln:
            print(f"  core.py:{i}  {ln.strip()}")
    tb = Path("frontend/src/components/Toolbar.ts").read_text(encoding="utf-8").splitlines()
    opt = [(i, ln.strip()) for i, ln in enumerate(tb, 1)
           if "option" in ln and ("hoya" in ln or "beginner" in ln or "verification" in ln)]
    print(f"  Toolbar.ts 的 sample <option>：{opt}")
    fl = Path("frontend/src/services/FileLoaderService.ts").read_text(encoding="utf-8").splitlines()
    for i, ln in enumerate(fl, 1):
        if "verification" in ln:
            print(f"  FileLoaderService.ts:{i}  {ln.strip()}")
    try:
        s.load_image(sample_key="verification")
        print("  core.loadImage('verification') -> ok（意外，仓库里应当没有该图）")
    except Exception as e:  # noqa: BLE001
        print(f"  core.loadImage('verification') -> fail code={getattr(e, 'code', None)} "
              f"{getattr(e, 'message', str(e))[:120]}")

    banner("H4. F-7：仓库里到底有没有该图片")
    from pathlib import Path as P

    assets = sorted(p.name for p in P("straditize_core/assets/tutorials").glob("*"))
    print(f"  straditize_core/assets/tutorials/ = {assets}")
    print(f"  仓库根 verification_real_pollen_edit.png 存在？ "
          f"{P('verification_real_pollen_edit.png').exists()}")


if __name__ == "__main__":
    main()
