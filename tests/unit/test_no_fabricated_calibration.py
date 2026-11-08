# -*- coding: utf-8 -*-
"""未标定的列**不得**在工程包往返后变成「已标定」。

## 洞在哪

`project_load` 对没有 `x_group_id` 的列会自动建组；若载荷里同时带 `x_values`，后端
`resolve_column_scale` 的 Case A1（组 tick_layout + 列 x_values）就判
`calibrated=True, source="group"` —— 于是**占位刻度**（0→100 或 0→20）被当成真标度，
导出一整表看似正常的百分比。

前端 `draftToProjectPayload` 原来对未标定列写 `x_values = [startValue, tickValue]`
（legacy 占位），恢复草稿后就会命中这条路。实测：载荷灌进去 → `calibrated=True`，
导出第二行 `233,68.4211,67.5676,…`。

## 修法与责任划分

- **写入端**（前端 `draftToProjectPayload`）：未标定列写 `x_values = null`；判据在
  `frontend/test-roi-calibration.mjs` 第 11 条。
- **后端**：`x_values ⇒ calibrated` 是既有契约（真正的标定靠它承载），不能反过来猜，
  否则会把已标定列判成未标定。所以本文件钉两件事：契约现状 + 占位值不得冒充端点。
"""

from __future__ import annotations

from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _base_payload() -> dict:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    return session.project_save(format="json")["data"]


def _load_with(payload: dict) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.project_load(payload)
    return session


def _with_group(payload: dict, x_values) -> dict:
    payload = dict(payload)
    payload["columns"] = [
        {**c, "x_ticks": None, "x_values": x_values, "x_group_id": "roi_1_grp_1"}
        for c in payload["columns"]
    ]
    rois = [dict(r) for r in payload["rois"]]
    rois[0]["x_groups"] = [
        {
            "id": "roi_1_grp_1",
            "name": "g",
            "unit": "%",
            "plot_type": "area",
            "scale_type": "linear",
            "exaggeration_mult": None,
            "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
        }
    ]
    rois[0]["default_group_id"] = "roi_1_grp_1"
    payload["rois"] = rois
    return payload


def test_x_values_is_the_calibration_contract() -> None:
    """既有契约：组 + x_values ⇒ 已标定。这条**不能**反向放宽，否则真标定会被判成未标定。"""
    session = _load_with(_with_group(_base_payload(), [0.0, 100.0]))

    scale = resolve_column_scale(session, session.columns[0], 0)
    assert scale.calibrated is True
    assert scale.source == "group"


def test_uncalibrated_column_stays_uncalibrated_and_exports_nothing() -> None:
    """未标定列（x_values 为 null + legacy 占位还在）必须保持未标定，导出为空。"""
    session = _load_with(_with_group(_base_payload(), None))

    scale = resolve_column_scale(session, session.columns[0], 0)
    assert scale.calibrated is False, (
        "未标定列被当成已标定 —— 恢复草稿/导入后它会用占位刻度出一整表看起来正常的数"
    )

    rows = session.export_data("csv")["csv"].splitlines()
    assert rows[0].startswith("depth,")
    assert set(rows[1].split(",")[1:]) == {""}, f"未标定列必须整列为空，实得：{rows[1]}"
