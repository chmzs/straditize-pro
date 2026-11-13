"""控制点增删必须有可执行的前置守卫，不许把 None 送进 float()。

实测缺陷：`core.updateControlPoint` 在"列已数字化但点的 x 为 None"时抛
`TypeError: float() argument must be a string or a real number, not 'NoneType'`，
被 handler 包成 `-32603 后端算法执行异常`——用户看到的是"请查看服务器控制台日志"，
既不知道哪里错，也不知道该做什么。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import STATE_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession


def _session_with_bad_points() -> StraditizeSession:
    session = StraditizeSession()
    session.columns = [{"name": "A", "col_index": 0, "start": 100, "end": 200}]
    session.column_points = {0: [{"row": 300, "x": None}, {"row": 400, "x": None}]}
    session.control_points = {}
    session.data_ylim = [233.0, 869.0]
    return session


def test_missing_usable_x_raises_state_error() -> None:
    with pytest.raises(JsonRpcError) as excinfo:
        _session_with_bad_points().update_control_point(col_index=0, row=350, x=120.0)
    assert excinfo.value.code == STATE_ERROR
    assert "缺少可读点" in str(excinfo.value)


def test_missing_data_ylim_raises_state_error() -> None:
    session = _session_with_bad_points()
    session.column_points = {0: [{"row": 300, "x": 110.0}]}
    session.data_ylim = None
    with pytest.raises(JsonRpcError) as excinfo:
        session.update_control_point(col_index=0, row=350, x=120.0)
    assert excinfo.value.code == STATE_ERROR
    assert "data_ylim" in str(excinfo.value)
