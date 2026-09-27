# -*- coding: utf-8 -*-
"""pytest 全局配置。

两件事，都在收集阶段完成，测试文件本身不再各写一遍：

1. 把仓库根注入 ``sys.path``，替代原先散落在 14 个测试文件里的
   ``if str(REPO_ROOT) not in sys.path: sys.path.insert(...)`` 样板。
2. 载入 ``tests/quarantine.txt``，把已知失败用例标成 **strict xfail**。

关于隔离区为什么用 strict xfail 而不是 ``--deselect``：

    --deselect 会连跑都不跑，失败修好了也没人知道该把它移回来，
    隔离区只会无限膨胀。strict xfail 仍然执行用例——一旦它开始通过，
    pytest 记 XPASS(strict) 并让门禁变红，强制把条目从隔离区删掉。
    也就是说隔离区是自清理的：条目只减不增，且新增必须有人签字。
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

QUARANTINE_FILE = Path(__file__).with_name("quarantine.txt")

# 隔离区条目与用例的归一化形态一致：只保留文件名 + "::" 之后的节点名，
# 与 tests/ 下的子目录结构无关，因此分层移动测试文件不会打断匹配。


def _normalise(nodeid: str) -> str:
    """``tests/unit/test_x.py::C::test_y`` -> ``test_x.py::C::test_y``。"""
    path, sep, tail = nodeid.replace("\\", "/").partition("::")
    return path.rsplit("/", 1)[-1] + sep + tail


def _load_quarantine() -> list[str]:
    if not QUARANTINE_FILE.exists():
        return []
    entries: list[str] = []
    for line in QUARANTINE_FILE.read_text(encoding="utf-8").splitlines():
        entry = line.split("#", 1)[0].strip()
        if entry:
            entries.append(_normalise(entry))
    return entries


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    entries = _load_quarantine()
    if not entries:
        return
    for item in items:
        nodeid = _normalise(item.nodeid)
        for entry in entries:
            # 支持两种粒度：整条节点 id，或只写文件名（隔离该文件全部用例）
            if "::" in entry:
                hit = nodeid == entry
            else:
                hit = nodeid == entry or nodeid.startswith(entry + "::")
            if hit:
                item.add_marker(
                    pytest.mark.xfail(
                        reason=f"quarantined in tests/quarantine.txt: {entry}",
                        strict=True,
                    )
                )
                break
