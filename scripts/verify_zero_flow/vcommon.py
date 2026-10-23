# -*- coding: utf-8 -*-
"""verifier 的独立复核公共件（不复用任何队友脚本）。

原则：
1. 只用产品自己的 Python API（`StraditizeSession`），不从队友的 probe 里 import。
2. 每次运行都用独立的临时配置目录，绝不碰 `~/.straditize/config.json`。
3. 输出一律可复制粘贴进 `docs/findings/verification.md`。
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))


def isolate_config() -> str:
    """把配置指到独立临时目录，返回路径（用于在报告里作证）。"""
    d = tempfile.mkdtemp(prefix="verifier_cfg_")
    p = os.path.join(d, "config.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(
            {"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1", "localhost"]},
            f,
        )
    os.environ["STRADITIZE_CONFIG_PATH"] = p
    return p


def new_session():
    """零状态会话。先 `_init_cleanup()`，否则 `project_new` 的残留检查会 AttributeError。

    这不是缺陷判定，只是会话对象的构造顺序：`CleanupMixin._init_cleanup()`
    （`session_parts/cleanup.py:79-91`）才是 `line_candidates` / `exclusion_regions` /
    `line_strokes` 的唯一创建点，而 `StraditizeSession.__init__` 不建它们。
    """
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    return s


def hoya(s, xlim=(315, 1946), ylim=(511, 1311)):
    s.load_image(sample_key="hoya")
    s.detect_columns(list(xlim), list(ylim))
    return s


def pretty(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, default=str)


def cols_snapshot(s):
    """只取复核需要的列字段（避免整列 dict 噪音）。"""
    return [
        {
            "id": c.get("id"),
            "col_index": c.get("col_index"),
            "start": c.get("start"),
            "end": c.get("end"),
            "tickEndX": c.get("tickEndX"),
            "startValue": c.get("startValue"),
            "tickValue": c.get("tickValue"),
            "name": c.get("name"),
            "x_ticks": c.get("x_ticks"),
        }
        for c in s.columns
    ]


def make_dispatcher(s):
    """真实 dispatcher（与 HTTP/stdio 服务同一份注册表），用来取**线上真实 payload**。

    不能直接 `from ...system import get_diagram_data`：它是 `register()` 内部的闭包，
    只有 dispatcher 能把注册表里的可调用对象取出来。走 dispatcher 才能保证读到的
    字段与前端 `straditize.getDiagramData` 完全一致。
    """
    from straditize_core.rpc_server import create_rpc_dispatcher

    d = create_rpc_dispatcher(s)
    return d, d._methods


def rpc_call(methods, name, params=None):
    """按 JSON-RPC 参数绑定语义调用（只放行签名里存在的关键字）。"""
    import inspect

    func = methods[name]
    if params is None:
        return func()
    sig = inspect.signature(func)
    if any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
        return func(**params)
    return func(**{k: v for k, v in params.items() if k in sig.parameters})


def banner(t: str) -> None:
    print("\n" + "=" * 78)
    print(t)
    print("=" * 78)
