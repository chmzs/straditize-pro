# -*- coding: utf-8 -*-
"""AUDIT SCRATCH — 只读审计用，不属于产品代码。放在 /tmp 下，绝不进仓库。

与 support/serve_e2e_backend.py 的唯一区别：**不做任何基线装载**，
会话真的是零状态（`session.image is None`），复现"从零开始"的真实用户旅程。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

REPO = Path(r"E:/software_dev/straditize")
sys.path.insert(0, str(REPO))

from straditize_core.rpc_server import (  # noqa: E402
    StraditizeRpcHttpServer,
    create_rpc_dispatcher,
)
from straditize_core.session import StraditizeSession  # noqa: E402

DEFAULT_PORT = 23050


def _isolate_config() -> None:
    cfg_dir = os.environ.get("STRADITIZE_AUDIT_CONFIG_DIR") or tempfile.mkdtemp(
        prefix="straditize_audit_cfg_"
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


def main() -> None:
    port = int(os.environ.get("STRADITIZE_AUDIT_PORT", str(DEFAULT_PORT)))
    _isolate_config()

    session = StraditizeSession()  # 零状态：没有图、没有列、没有 ROI
    dispatcher = create_rpc_dispatcher(session)
    dispatcher.register_method("audit.health", lambda: {"ok": True})

    def _zero_reset() -> dict:
        session.project_new(clear_image=True)
        session._init_cleanup()
        return {"ok": True, "image_is_none": session.image is None}

    dispatcher.register_method("audit.resetZero", _zero_reset)

    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()
    print(f"[audit] zero-state backend ready on http://127.0.0.1:{port}/", flush=True)

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()


if __name__ == "__main__":
    main()
