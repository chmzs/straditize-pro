# -*- coding: utf-8 -*-
"""prod_gate 巡检共用小工具：把后端返回里的大块 base64/ndarray 摘要掉。

为什么要这个：`apply_line_removal` / `extract_foreground` 的返回值里带
`cleanup_overlay_png`（base64 PNG，几十 KB~几 MB）。直接 print 会把终端冲爆，
看不到真正要看的计数字段。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def brief(obj: Any, _depth: int = 0) -> Any:
    """递归把长字符串/bytes/np 数组替换成摘要。"""
    if isinstance(obj, dict):
        return {k: brief(v, _depth + 1) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        if len(obj) > 12:
            return f"<list len={len(obj)} head={brief(list(obj[:3]))}>"
        return [brief(v, _depth + 1) for v in obj]
    if isinstance(obj, (bytes, bytearray)):
        return f"<bytes len={len(obj)}>"
    if isinstance(obj, str):
        if len(obj) > 120:
            return f"<str len={len(obj)} sha1={hashlib.sha1(obj.encode('utf8', 'ignore')).hexdigest()[:12]}>"
        return obj
    # numpy / pandas 等
    if hasattr(obj, "shape") and hasattr(obj, "dtype"):
        return f"<array shape={tuple(obj.shape)} dtype={obj.dtype}>"
    if hasattr(obj, "tolist"):
        try:
            return brief(obj.tolist(), _depth + 1)
        except Exception:
            return f"<{type(obj).__name__}>"
    return obj


def jprint(obj: Any) -> None:
    print(json.dumps(brief(obj), ensure_ascii=False, indent=2, default=str))


def git_head() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
        ).strip()
    except Exception as exc:  # pragma: no cover
        return f"<git error: {exc}>"


def sha256_file(rel: str) -> str:
    path = os.path.join(ROOT, rel)
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


TRACKED = [
    "straditize_core/session.py",
    "straditize_core/session_parts/project.py",
    "straditize_core/session_parts/core.py",
    "straditize_core/session_parts/xticks.py",
    "straditize_core/session_parts/export.py",
    "straditize_core/session_parts/cleanup.py",
    "straditize_core/session_parts/digitize.py",
    "straditize_core/rpc_methods/xticks.py",
    "straditize_core/rpc_methods/digitize.py",
    "straditize_core/twolayer_detect.py",
    "straditize_core/image.py",
]


def hash_banner(title: str) -> dict[str, str]:
    out = {"_probe": title, "_git_head": git_head()}
    for rel in TRACKED:
        p = os.path.join(ROOT, rel)
        out[rel] = sha256_file(rel) if os.path.exists(p) else "<missing>"
    print("=" * 78)
    print(f"PROBE: {title}")
    print(f"git HEAD: {out['_git_head']}")
    for rel in TRACKED:
        if out[rel] != "<missing>":
            print(f"  {out[rel][:16]}  {rel}")
    print("=" * 78)
    return out


def b64png_len(obj: Any) -> Any:
    """把 base64 PNG 字段换成字节数，避免刷屏。"""
    if isinstance(obj, str) and obj.startswith("data:image"):
        return f"<png data-url {len(obj)} chars>"
    return obj


def ensure_import_path() -> None:
    if ROOT not in sys.path:
        sys.path.insert(0, ROOT)
