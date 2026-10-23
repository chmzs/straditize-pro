# -*- coding: utf-8 -*-
"""为「从零开始」旅程测试启动**零状态**后端（`frontend/playwright.zero.config.ts` 的 webServer 入口）。

## 为什么不能复用 `support/serve_e2e_backend.py`

那个启动器是现有 70 项 e2e 的基线：它在启动时 `session.load_image(sample_key="hoya")`
**预载范例图**，再 `session.detect_columns(...)` **预跑分列**。也就是说：

* 用户"打开文件"这一步（真实文件选择器 → 解码 → `core.loadImage`）在这些用例里**从没被执行过**；
* "首次运行" 的语义（空会话）在这条基线上根本不存在。

本启动器只做一件事：**把会话留在零状态**。不预载图、不预跑分列、不建 ROI。
`straditize_core/rpc_methods/system.py:64` 的 `get_diagram_data` 在 `session.image is None`
时显式返回 `imageSrc: null` / `rois: []`（不回落范例），所以零状态是**被支持的**状态，
不是在试探未定义行为。

## 与基线的对比（一眼看出差在哪）

| | `serve_e2e_backend.py` | 本文件 |
| --- | --- | --- |
| 启动时载图 | hoya 范例 | **不载** |
| 启动时分列 | `detect_columns([315,1946],[511,1311])` | **不分** |
| `e2e.reset` 的结果 | 回到 hoya 基线 | 回到**空会话** |
| 端口环境变量 | `STRADITIZE_E2E_PORT`（默认 8799） | `STRADITIZE_ZERO_PORT`（默认 22920） |
| 产物目录 | `frontend/test-results-<port>/` | 同名规则，端口取 22920-22930 段故不冲突 |

## 只注册两个方法

`e2e.health`（webServer.url 等待就绪）与 `e2e.reset`（用例间隔离）。**不注册任何
"种图 / 种状态"的旁路**——本旅程的全部状态都必须由 UI 动作产生，这是测试的全部意义。
生产代码不含这两个方法（见 `straditize_core/rpc_methods/`）。

## reset 必须真的清干净，且清不干净就 fail-fast

`project_new(clear_image=True)` 会重置 `columns` / `roi` / `depth_calib` 等，但
**不重置** `line_candidates` / `exclusion_regions` / `line_strokes`（"新建项目后旧几何残留"
这个已知缺口，见 `straditize_core/session_parts/project.py`）。所以这里照旧显式调
`_init_cleanup()`，并在复位后**断言**残留为零、且 `session.image is None`；任何一条不成立
就抛错，而不是让上一个用例的残渣漏进下一个（那样只会得到一条与代码无关的随机红）。

## 为什么放在 `support/`

`support/consistency_check.py` 的检查 D 要求 `tests/` 下每个 `.py` 都能被 pytest 收集。
本文件是启动器不是测试，放在 `support/` 可以让检查 D 保持零豁免（与 `serve_e2e_backend.py` 同理）。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

# 支持 `pixi run python support/serve_zero_backend.py` 直接运行
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from straditize_core.rpc_server import StraditizeRpcHttpServer, create_rpc_dispatcher  # noqa: E402
from straditize_core.session import StraditizeSession  # noqa: E402

DEFAULT_PORT = 22920


def _reset(session: StraditizeSession) -> dict:
    """把会话复位到**零状态**：没有图、没有列、没有 ROI、没有清理残渣。"""
    session.project_new(clear_image=True)
    # `project_new` 不清第 4 步的三样东西（已知缺口），显式清空。
    session._init_cleanup()
    session.samples_clear()
    session.age_depth_model = None
    session.age_depth_image = None
    session.age_depth_image_path = None
    session.ensemble_tables = {}
    session.chron_events = []
    session.is_desktop_mode = True

    # 复位后必须成立的不变量：任何一条不成立就立刻抛错。
    residual = {
        "line_candidates": len(session.line_candidates or []),
        "exclusion_regions": len(session.exclusion_regions or []),
        "line_strokes": len(session.line_strokes or []),
        "samples": len(session.samples or []),
        "columns": len(session.columns or []),
        "rois": len(getattr(session, "rois", []) or []),
    }
    dirty = {k: v for k, v in residual.items() if v}
    if dirty:
        raise RuntimeError(f"e2e.reset 未能把会话清回零状态，仍有残留：{dirty}")
    if session.image is not None:
        raise RuntimeError("e2e.reset 之后会话里仍有图像，零状态未建立")
    return {"ok": True, "state": "zero"}


def _isolate_config() -> None:
    """把配置指到临时目录，绝不污染用户的 ~/.straditize/config.json。

    与基线启动器的差别只有一处：临时目录前缀不同，便于并发时分辨是谁的。
    """
    cfg_dir = os.environ.get("STRADITIZE_ZERO_CONFIG_DIR") or tempfile.mkdtemp(
        prefix="straditize_zero_cfg_"
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
    port = int(os.environ.get("STRADITIZE_ZERO_PORT", str(DEFAULT_PORT)))
    _isolate_config()

    # 关键差异：**不** load_image、**不** detect_columns。
    session = StraditizeSession()
    session.is_desktop_mode = True

    if session.image is not None:
        raise RuntimeError(
            "零状态启动器拿到的会话里已经有图像了：本启动器不能预载任何图，"
            "请检查 StraditizeSession 的构造函数是否新增了默认载图行为。"
        )

    dispatcher = create_rpc_dispatcher(session)
    dispatcher.register_method("e2e.health", lambda: {"ok": True, "state": "zero"})
    dispatcher.register_method("e2e.reset", lambda: _reset(session))

    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()
    print(f"[zero] backend ready on http://127.0.0.1:{port}/ (zero state, no image)", flush=True)

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()


if __name__ == "__main__":
    main()
