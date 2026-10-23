# -*- coding: utf-8 -*-
"""零状态后端启动器（bug-prober 私有探针用，只读产品源码）。

与 `support/serve_e2e_backend.py` 的差别只有一个：**不预载任何图、不预跑 detect_columns**。
`e2e.reset` 复位后会话真的回到 `image is None` 的零状态。

用法（必须经 pixi 的 python）：
    pixi run python scripts/zero_flow_probes/zero_backend.py --port 22940

只注册 `e2e.health` / `e2e.reset` 两个测试专用方法，与正式产品方法集合无交集。
配置隔离到临时目录，绝不碰 ~/.straditize/config.json。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from straditize_core.rpc_server import (  # noqa: E402
    StraditizeRpcHttpServer,
    create_rpc_dispatcher,
)
from straditize_core.session import StraditizeSession  # noqa: E402


def _isolate_config() -> str:
    cfg_dir = os.environ.get("STRADITIZE_PROBE_CONFIG_DIR") or tempfile.mkdtemp(
        prefix="straditize_probe_cfg_"
    )
    cfg_path = os.path.join(cfg_dir, "config.json")
    if not os.path.exists(cfg_path):
        with open(cfg_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "remote_access_enabled": False,
                    "allowed_hosts": ["127.0.0.1", "localhost"],
                    "locale": "zh-CN",
                    "theme": "light",
                },
                f,
                indent=2,
            )
    os.environ["STRADITIZE_CONFIG_PATH"] = cfg_path
    return cfg_path


def _reset(session: StraditizeSession) -> dict:
    """零状态复位：只清会话，不载图。"""
    # 顺序敏感：`project_new` 自己会读 `self.line_candidates` 之外的字段，但
    # `_init_cleanup()` 是唯一会**创建** `line_candidates` / `exclusion_regions` /
    # `line_strokes` 三个属性的入口（`StraditizeSession.__init__` 不创建它们，
    # 见 session.py:60-190 的字段清单），故必须先建后清。
    session._init_cleanup()
    session.project_new(clear_image=True)
    session._init_cleanup()  # project_new 不清这三项，这里补一次
    session.is_desktop_mode = True
    # 复位后断言真的空了；不空就 fail-fast（否则探针结论会被上一条用例的残留污染）
    problems = []
    if session.image is not None:
        problems.append("image")
    if len(session.columns or []) != 0:
        problems.append(f"columns={len(session.columns or [])}")
    if len(session.line_candidates or []) != 0:
        problems.append(f"line_candidates={len(session.line_candidates or [])}")
    if len(getattr(session, "exclusion_regions", []) or []) != 0:
        problems.append(f"exclusion_regions={len(session.exclusion_regions or [])}")
    if len(getattr(session, "line_strokes", []) or []) != 0:
        problems.append(f"line_strokes={len(session.line_strokes or [])}")
    if problems:
        raise RuntimeError(f"zero reset 非空：{problems}")
    return {"ok": True, "zero": True}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("STRADITIZE_ZERO_PORT", "22940")))
    args = ap.parse_args()

    cfg = _isolate_config()

    session = StraditizeSession()
    session.is_desktop_mode = True
    dispatcher = create_rpc_dispatcher(session)
    dispatcher.register_method("e2e.health", lambda: {"ok": True, "zero": True})
    dispatcher.register_method("e2e.reset", lambda: _reset(session))

    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=args.port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()
    print(
        f"[zero] backend ready on http://127.0.0.1:{args.port}/ (config={cfg})",
        flush=True,
    )
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()


if __name__ == "__main__":
    main()
