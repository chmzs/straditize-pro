# -*- coding: utf-8 -*-
"""Lead 的一次性零状态后端探针（仅供 Lead 自查，不属于交付物）。

与 `support/serve_e2e_backend.py` 的关键区别：**不预载任何图、不预跑分列**。
目的只有一个：验证"真正的零状态"下应用能否 boot、能否走真实上传。

用法：
    STRADITIZE_ZERO_PORT=22910 pixi run python scripts/lead_probe/serve_zero.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from straditize_core.rpc_server import (  # noqa: E402
    StraditizeRpcHttpServer,
    create_rpc_dispatcher,
)
from straditize_core.session import StraditizeSession  # noqa: E402


def _isolate_config() -> None:
    cfg_dir = tempfile.mkdtemp(prefix="lead_probe_cfg_")
    cfg_path = os.path.join(cfg_dir, "config.json")
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
    port = int(os.environ.get("STRADITIZE_ZERO_PORT", "22910"))
    _isolate_config()

    session = StraditizeSession()  # 真正的零状态：image is None
    assert session.image is None, "零状态探针不应预载图像"

    dispatcher = create_rpc_dispatcher(session)
    dispatcher.register_method("e2e.health", lambda: {"ok": True})

    def _reset() -> dict:
        session.project_new(clear_image=True)
        for attr, val in (
            ("line_candidates", []),
            ("exclusion_regions", []),
            ("line_strokes", []),
            ("selected_candidate_ids", set()),
        ):
            if hasattr(session, attr):
                setattr(session, attr, val)
        session.samples_clear()
        return {"ok": True, "image": session.image}

    dispatcher.register_method("e2e.reset", _reset)

    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()
    print(f"[lead-probe] ZERO-STATE backend ready on http://127.0.0.1:{port}/", flush=True)

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()


if __name__ == "__main__":
    main()
