"""导出不得用"等距采样"的替代数据充数。

缺陷背景：`_ensure_export_column_points` 曾有三条回落，最后一条在"既没有手工控制点、
也没有可数字化图像"时，按 `data_ylim` 等距造点，且 x 一律取**列左缘**——于是导出的
整列是一条水平直线，看起来完全合法，实际上不来自图像任何像素。这条路径不打任何标记，
`export_data` 照常返回成功。

项目第一不变量：面向用户的数据只能来自后端对用户输入的真实计算，取不到就报错并停在原地。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession


def _session_with_columns_but_no_points() -> StraditizeSession:
    session = StraditizeSession()
    session.columns = [
        {"name": "A", "col_index": 0, "start": 100, "end": 200},
        {"name": "B", "col_index": 1, "start": 200, "end": 300},
    ]
    session.control_points = {}
    session.column_points = {}
    return session


def test_export_raises_instead_of_inventing_points() -> None:
    session = _session_with_columns_but_no_points()
    with pytest.raises(JsonRpcError) as excinfo:
        session.export_data("csv")
    message = str(excinfo.value)
    assert "没有任何可取数的列" in message, message
    assert "替代数据" in message, message
    assert not session.column_points, session.column_points


def test_no_flat_line_fabricated_from_data_ylim() -> None:
    """即使给了 data_ylim，也不许把列左缘当读数造一条直线。"""
    session = _session_with_columns_but_no_points()
    session.data_ylim = [100, 400]
    with pytest.raises(JsonRpcError):
        session.export_data("csv")
    assert not session.column_points


def test_source_has_no_synthetic_fallback_pattern() -> None:
    """源码级防回归：不许再出现"把列左缘当读数"的造点写法或吞异常的 pass。

    这是举一反三的那一步——删掉缺陷代码不够，要让它**不可能被写回来**。
    """
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[2] / "straditize_core" / "session_parts" / "export.py"
    ).read_text(encoding="utf-8")
    executable = [ln for ln in source.splitlines() if not ln.lstrip().startswith("#")]

    fabricated = [ln for ln in executable if '"x": c_start' in ln and '"row": r' in ln]
    assert not fabricated, f"出现造替代数据的写法：{fabricated}"

    # `_ensure_export_column_points` 里不许有"吞掉 digitize 失败后继续"的空 pass
    start = source.index("def _ensure_export_column_points")
    end = source.index("def _export_rows_and_depths")
    segment = source[start:end]
    assert "except (ValueError, KeyError, RuntimeError, JsonRpcError):\n                        pass" not in segment, (
        "数字化失败又被静默吞掉了"
    )
