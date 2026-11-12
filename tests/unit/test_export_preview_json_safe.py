"""导出预览载荷必须是**合法 JSON**（不允许字面量 `NaN`）。

缺陷背景（真实复现）：`export_data` 把 `df.head(50).to_dict(orient="records")` 直接
塞进返回值，pandas 的 NaN 经 `json.dumps`（默认 `allow_nan=True`）写成字面量
`NaN` —— 非合法 JSON。浏览器 `Response.json()` 抛 SyntaxError，前端再把解析失败
报成"与后端的连接已断开"，用户去查网络，真实原因却是某列某层位是 NaN。

判据：
1. 含 NaN / NaT 的 frame 经 `_json_safe_records` 后，`json.dumps(..., allow_nan=False)`
   必须成功（这就是浏览器能否解析的等价条件）；
2. 缺测必须变成 `None`（JSON null），不得变成 0 —— "缺测 ≠ 0"；
3. 源码里不允许再有裸的 `to_dict(orient="records")`（必须走这个唯一入口）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

from straditize_core.session import StraditizeSession

_REPO = Path(__file__).resolve().parents[2]


def test_nan_becomes_null_and_payload_is_valid_json() -> None:
    frame = pd.DataFrame(
        {
            "depth": [1.0, 2.0, 3.0],
            "col01": [0.5, float("nan"), 2.5],
            "col02": [float("inf"), 1.0, float("nan")],
        }
    )
    records = StraditizeSession._json_safe_records(frame)

    # 1) 合法 JSON（allow_nan=False 就是浏览器 JSON.parse 的等价严格度）
    text = json.dumps({"data": records}, allow_nan=False)

    # 2) NaN/inf 变 null，且没有被悄悄变成 0
    assert records[1]["col01"] is None
    assert records[2]["col02"] is None
    assert records[0]["col02"] is None
    assert "NaN" not in text and "Infinity" not in text, text
    assert records[1]["col01"] != 0

    # 3) 正常值原样保留，不能被误伤
    assert records[0]["col01"] == 0.5
    assert records[2]["col01"] == 2.5


def test_export_preview_uses_json_safe_entry_only() -> None:
    src = (_REPO / "straditize_core" / "session_parts" / "export.py").read_text(encoding="utf-8")
    hits = [ln.strip() for ln in src.splitlines() if 'to_dict(orient="records")' in ln]
    # 只允许出现在 _json_safe_records 内部（该方法自身那一行）
    assert len(hits) == 1, hits
    assert src.count("_json_safe_records(") >= 2, "必须有定义 + 至少一处调用"
