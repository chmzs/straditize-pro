"""`core.reset` 必须把会话清回「刚打开软件」的状态。

## 缺陷

`core.reset` 的实现是**重新调用 `Session.__init__()`**（`rpc_methods/system.py:94`）。
凡是「惰性创建」的属性 —— 只在首次用到时才赋值 —— `__init__` 里没有它们，
于是 reset 之后它们作为**额外属性**留了下来：

| 属性 | 留着会怎样 |
|---|---|
| `samples` | 换图后导出仍拿上一张图的层位当 depth 列（`export_data` 直接读它） |
| `manual_points` | 按 col_index 存的手点锚点，换图后索引指向别的列 |
| `tick_band` | 上一张图的刻度带像素范围 |
| `_points_invalidated` | 被作废的列名集合，换图后无意义 |

## 判据

1. 标定 + 灌入五个属性 → `core.reset` → 全部回到默认值（`RESIDUE == []`）；
2. 判定方式是对比「新会话的属性集」，不是逐条列举——**新加惰性属性时这条会自己变红**。

反向验证：删掉 `__init__` 里的 `self._init_samples()` → 判据 1 变红（`samples` 残留）。
"""

from __future__ import annotations

from typing import Any

from straditize_core.rpc_methods import system
from straditize_core.session import StraditizeSession


class _Dispatcher:
    def __init__(self) -> None:
        self.methods: dict[str, Any] = {}

    def register_method(self, name: str, func: Any) -> None:
        self.methods[name] = func


def _fresh_with_reset() -> tuple[StraditizeSession, dict[str, Any]]:
    session = StraditizeSession()
    dispatcher = _Dispatcher()
    system.register(dispatcher, session)
    return session, dispatcher.methods


def test_reset_leaves_no_extra_state_behind() -> None:
    session, methods = _fresh_with_reset()

    session.calibrate_axes(
        y_marks=[{"pixel": 100.0, "val": 0.0}, {"pixel": 200.0, "val": 50.0}],
        unit="ka",
        primary_axis="age",
    )
    session.samples = [{"row_px": 1, "depth": 5.0, "source": "auto"}]
    session.depth_grid = [1.0, 2.0]
    session.manual_points = {0: {1: 2.0}}
    session.tick_band = {"top": 1}
    session._points_invalidated = {"Picea"}
    session.taxa_names = ["Picea"]
    session.columns = [{"col_index": 0, "name": "Picea", "roi_id": "roi_1"}]

    methods["core.reset"]()

    reference = StraditizeSession()
    residue = [
        key
        for key, value in vars(session).items()
        if key not in vars(reference)
        or (
            isinstance(value, (list, dict, set, str, int, float, bool, type(None)))
            and value != vars(reference)[key]
        )
    ]

    assert residue == [], f"reset 之后仍有残留状态：{residue}"


def test_reset_clears_depth_calibration_and_axis_semantics() -> None:
    session, methods = _fresh_with_reset()
    session.calibrate_axes(
        y_marks=[{"pixel": 100.0, "val": 0.0}, {"pixel": 200.0, "val": 50.0}],
        unit="ka",
        primary_axis="age",
    )

    assert methods["core.getStatus"]()["is_calibrated"] is True

    methods["core.reset"]()

    assert methods["core.getStatus"]()["is_calibrated"] is False
    assert session.y_scale is None
    assert session.depth_calib is None
    assert session.depth_unit == "cm", "轴标签要回到默认，不能把上一张图的 ka 留着"
    assert session.primary_axis == "depth", "轴语义必须回默认，否则新图会被当年龄轴解读"
