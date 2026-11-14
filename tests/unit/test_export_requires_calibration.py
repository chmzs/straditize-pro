# -*- coding: utf-8 -*-
"""未完成 Y 轴标定时，**所有导出出口**必须明确拒绝（不能拿像素行号冒充深度）。

## 为什么要有这条

旧实现允许"未标定也导出"：深度列直接写像素行号。那让导出有两套输出形态，
且下游无法区分"这是深度"与"这是行号"——正是 `ARCHITECTURE §2` 禁止的编造读数。
现在改为统一守卫：`export_data` 是所有出口（CSV / Parquet / 三种 dataset /
`export_csv` / 工程包的 data.csv）的唯一入口，守卫放在那一层。

## 判据

1. 未标定：`export_data('csv')`、`export_csv()`、以及三种 `dataset` 全部抛
   `CALIBRATION_ERROR`，文案含「步骤 3」；
2. 标定后：同一调用成功且 `rows_count > 0`（守卫只挡未标定，不挡正常路径）。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import CALIBRATION_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _session(calibrated: bool) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    for column in session.columns[:3]:
        session.digitize(column["col_index"])
    if calibrated:
        session.is_calibrated = True
        session.y_scale = {"slope": 0.5, "intercept": -100.0}
        # `depth_grid` 这条行集需要 `depth_calib` 才能切格（`_uniform_depth_list`）。
        session.depth_calib = {
            "top_px": 233.0,
            "top_cm": 0.0,
            "bottom_px": 869.0,
            "bottom_cm": 318.0,
            "unit": "cm",
        }
        # 面板三张表还要求 **至少一列** 有 X 刻度（`_assert_export_column_scale`）：
        # 全列未标定时它们只能交出一张整表空白，那种表不许当成成功导出（见
        # `test_export_requires_column_scale.py`）。这里给第一列真实的刻度端点，
        # 让"标定后必须真的出数"这条判据仍然测的是**守卫不误伤正常路径**。
        col = session.columns[0]
        px0 = float(col.get("startX", col.get("start", 0.0))) + 5.0
        session.calibrate_column_xticks(
            col["col_index"],
            [{"px": px0, "value": 0.0}, {"px": px0 + 40.0, "value": 100.0}],
        )
    return session


UNGUARDED_CALLS = [
    ("export_data(csv)", lambda s: s.export_data("csv")),
    ("export_data(csv, union_points)", lambda s: s.export_data("csv", dataset="union_points")),
    ("export_data(csv, depth_grid)", lambda s: s.export_data("csv", dataset="depth_grid")),
    ("export_data(csv, turning_points)", lambda s: s.export_data("csv", dataset="turning_points")),
    ("export_csv()", lambda s: s.export_csv()),
]


@pytest.mark.parametrize("label,call", UNGUARDED_CALLS)
def test_uncalibrated_export_is_rejected(label: str, call) -> None:
    session = _session(calibrated=False)
    with pytest.raises(JsonRpcError) as excinfo:
        call(session)
    assert excinfo.value.code == CALIBRATION_ERROR, f"{label} 必须抛 CALIBRATION_ERROR"
    message = str(excinfo.value.message)
    assert "步骤 3" in message, f"{label} 的文案必须指明步骤 3，实际：{message}"


@pytest.mark.parametrize("label,call", UNGUARDED_CALLS)
def test_calibrated_export_still_works(label: str, call) -> None:
    session = _session(calibrated=True)
    result = call(session)
    if isinstance(result, str):  # export_csv 返回文本
        assert result.strip(), f"{label} 标定后必须返回非空 CSV"
        return
    assert result["rows_count"] > 0, f"{label} 标定后必须真的出数"
