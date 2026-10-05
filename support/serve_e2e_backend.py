# -*- coding: utf-8 -*-
"""为 `@playwright/test` 启动隔离后端（`frontend/playwright.config.ts` 的 webServer 入口）。

与旧 `tests/e2e/conftest.py` 的会话夹具**基线完全等价**（hoya 样本 + 列切分 +
桌面模式），区别只在于跑在独立进程里：真正的 Playwright 可以复用一个后端、
一个浏览器上下文跑完整个套件，而不是每个测试重开一次 Edge。

额外注册两个**只存在于本测试进程**的方法：

    e2e.health  存活探针（供 webServer.url 等待就绪）
    e2e.reset   把会话复位到上述基线，解决测试间状态污染

生产代码不含这两个方法——它们只在这里注册，不进 `straditize_core/rpc_methods/`。

## 为什么放在 `support/` 而不是 `tests/e2e/`

`support/consistency_check.py` 的检查 D 规定：`tests/` 下的每个 `.py` 都必须匹配
pytest 的 `python_files`，否则就是"声明了却永远收集不到"的漂移
（历史上 `test-e2e` 只跑了 10 条里的 1 条）。本文件是**启动器不是测试**，
与其给检查 D 开豁免口子，不如让它待在 `support/` —— 检查 D 保持零豁免。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from pathlib import Path

# 支持 `pixi run python support/serve_e2e_backend.py` 直接运行
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from straditize_core.rpc_server import StraditizeRpcHttpServer, create_rpc_dispatcher  # noqa: E402
from straditize_core.session import StraditizeSession  # noqa: E402

# 与旧 conftest 一字不差：列切分用的 X/Y 边界
HOYA_X_BOUNDS = [315, 1946]
HOYA_Y_BOUNDS = [511, 1311]

DEFAULT_PORT = 8799


def _load_baseline(session: StraditizeSession) -> None:
    """把会话带到基线：hoya 样本 + 列切分 + 桌面模式。"""
    session.load_image(sample_key="hoya")
    session.detect_columns(HOYA_X_BOUNDS, HOYA_Y_BOUNDS)
    session.is_desktop_mode = True


def _reset(session: StraditizeSession) -> dict:
    """复位到基线，供测试的 beforeEach 使用。

    `project_new` 会重置各种 mask 与 `line_corrections`，但**不重置**
    `line_candidates` / `exclusion_regions` / `line_strokes`
    （见 `session.py:1738-1760` 的实际字段清单）。少了这一步，上一个测试扫出的
    候选会漏进下一个测试：全量跑时 `workflow-panels` 里"复位后不应残留候选几何"
    就是这样失败的（单跑该文件却通过——典型的顺序依赖）。
    故显式清空第 4 步状态；`_init_cleanup()` 正是"cleanup 状态归零"的规范入口。
    """
    session.project_new(clear_image=True)
    _load_baseline(session)
    session._init_cleanup()
    session.samples_clear()
    session.age_depth_model = None
    session.age_depth_image = None
    session.age_depth_image_path = None
    session.ensemble_tables = {}
    session.chron_events = []

    # 复位后必须成立的不变量：任何一条不成立就**立刻抛错**，而不是让测试带着
    # 上个测试的残留继续跑（那会表现为"某条断言莫名失败"，极难定位）。
    residual = {
        "line_candidates": len(session.line_candidates or []),
        "exclusion_regions": len(session.exclusion_regions or []),
        "line_strokes": len(session.line_strokes or []),
        "samples": len(session.samples or []),
    }
    dirty = {k: v for k, v in residual.items() if v}
    if dirty:
        raise RuntimeError(f"e2e.reset 未能清空会话状态，仍有残留：{dirty}")
    if session.image is None:
        raise RuntimeError("e2e.reset 之后会话里没有图像，基线未建立")
    return {"ok": True}


def _isolate_config() -> None:
    """把配置指到临时目录，绝不污染用户的 ~/.straditize/config.json。"""
    cfg_dir = os.environ.get("STRADITIZE_E2E_CONFIG_DIR") or tempfile.mkdtemp(
        prefix="straditize_e2e_cfg_"
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
    port = int(os.environ.get("STRADITIZE_E2E_PORT", str(DEFAULT_PORT)))
    _isolate_config()

    session = StraditizeSession()
    _load_baseline(session)

    dispatcher = create_rpc_dispatcher(session)
    dispatcher.register_method("e2e.health", lambda: {"ok": True})
    dispatcher.register_method("e2e.reset", lambda: _reset(session))

    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()
    print(f"[e2e] backend ready on http://127.0.0.1:{port}/", flush=True)

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass
    finally:
        server.stop()


if __name__ == "__main__":
    main()
