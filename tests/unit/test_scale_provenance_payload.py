# -*- coding: utf-8 -*-
"""`getDiagramData` 必须下发读数来历（`scale_provenance`，B-01 主线）。

## 为什么要下发

`startValue` / `tickValue` / `maxPercent` 都是**算出来的数字**，不携带"这个数是谁
给的"。同一个 `20` 可能来自用户量的刻度，也可能来自 `detect_columns` 里硬编码的
`tickValue: 20.0` —— 前者是科研读数，后者是程序默认值，而在载荷里两者长得一模
一样。用户看到 X2=20，无法判断这是图版印的还是程序编的。

`resolve_column_scale` 早就返回 `calibrated` 与 `source`，只是没下发。本文件钉住
"它到了前端"这件事。

## 为什么保留 startValue/tickValue（而不是删掉）

prod-gate 实测：后端完全不发这两个字段时，步骤 6 的显示**毫无变化**（前端多处
`?? 20` / `|| 100` 会补上同样的数字）。删字段 = 缺陷藏得更深。所以只加信息，
不改既有字段。

## 四类判据（对应任务书 5.(a)-(d)）

(a) 零标定 → `calibrated=False` 且 source 为 `legacy`/`default`
(b) 用 x_ticks 标定 → `calibrated=True`、`source='x_ticks'`
(c) 经 ROI 列组解析 → `source='group'`
(d) 可 JSON 序列化、且不进 `project_save` 的列白名单（诊断字段不该持久化）

外加：**下发值必须随状态变**——在载荷层写死 provenance 会被 D7 那条抓红。
"""
from __future__ import annotations

import json

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]


def _diagram_payload(session: StraditizeSession) -> dict:
    dispatcher = create_rpc_dispatcher(session)
    response = dispatcher.handle_object(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "straditize.getDiagramData",
            "params": {},
        }
    )
    assert "result" in response, response
    return response["result"]


def _columns_only_session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=session.rois[0]["id"])
    return session


class TestProvenanceReachesThePayload:
    def test_every_column_carries_scale_provenance(self) -> None:
        session = _columns_only_session()

        payload = _diagram_payload(session)

        assert payload["columns"], "前置：应已分列"
        for column in payload["columns"]:
            assert "scale_provenance" in column, (
                f"列 {column.get('name')} 没有 scale_provenance —— 用户无法判断"
                "读数是量的还是程序默认值"
            )
            provenance = column["scale_provenance"]
            assert set(provenance) == {"calibrated", "source"}
            assert isinstance(provenance["calibrated"], bool)
            assert isinstance(provenance["source"], str)

    def test_uncalibrated_columns_report_legacy_or_default(self) -> None:
        """(a) 零标定会话：每列都未标定，来源只能是 legacy 或 default。"""
        session = _columns_only_session()
        assert all(c.get("x_ticks") is None for c in session.columns)

        payload = _diagram_payload(session)

        for column in payload["columns"]:
            provenance = column["scale_provenance"]
            assert provenance["calibrated"] is False, (
                "未标定的列报告 calibrated=True —— provenance 是从别处抄的假值"
            )
            assert provenance["source"] in ("legacy", "default"), (
                f"未标定列的来源应说明'数从哪来'，实得 {provenance['source']!r}"
            )

    def test_xticks_calibration_reports_x_ticks(self) -> None:
        """(b) 用真实刻度标定后 → calibrated=True、source='x_ticks'。"""
        session = _columns_only_session()
        first = session.columns[0]
        session.calibrate_column_xticks(
            0,
            ticks=[
                {"px": float(first["start"]) + 20, "value": 0.0},
                {"px": float(first["end"]) - 20, "value": 40.0},
            ],
            unit="%",
        )

        payload = _diagram_payload(session)

        assert payload["columns"][0]["scale_provenance"] == {
            "calibrated": True,
            "source": "x_ticks",
        }
        # 其余列仍未标定
        assert payload["columns"][1]["scale_provenance"]["calibrated"] is False

    def test_group_resolved_scale_reports_group(self) -> None:
        """(c) 经 ROI 列组解析出来的标度 → source='group'。"""
        session = _columns_only_session()
        roi = session.rois[0]
        column = session.columns[0]
        group_id = f"{roi['id']}_grp_custom"
        roi.setdefault("x_groups", []).append(
            {
                "id": group_id,
                "name": "自定义组",
                "unit": "%",
                "plot_type": "area",
                "scale_type": "linear",
                "exaggeration_mult": None,
                "tick_layout": [{"rel": 0.1}, {"rel": 0.9}],
            }
        )
        column["x_group_id"] = group_id
        column["x_values"] = [5.0, 55.0]
        column.pop("x_ticks", None)

        payload = _diagram_payload(session)

        provenance = payload["columns"][0]["scale_provenance"]
        assert provenance["source"] == "group", (
            f"列组解析的标度应报告 source='group'，实得 {provenance['source']!r}"
        )
        assert provenance["calibrated"] is True


class TestProvenanceTracksStateChanges:
    """D7：下发值必须随状态变——写死会被这条抓红。"""

    def test_provenance_changes_after_calibration(self) -> None:
        session = _columns_only_session()
        before = _diagram_payload(session)["columns"][0]["scale_provenance"]
        assert before["calibrated"] is False

        first = session.columns[0]
        session.calibrate_column_xticks(
            0,
            ticks=[
                {"px": float(first["start"]) + 20, "value": 0.0},
                {"px": float(first["end"]) - 20, "value": 40.0},
            ],
            unit="%",
        )

        after = _diagram_payload(session)["columns"][0]["scale_provenance"]
        assert after != before, "标定前后 provenance 完全相同 —— 载荷里写死了"
        assert after["source"] == "x_ticks"

    def test_provenance_reverts_after_clearing(self) -> None:
        session = _columns_only_session()
        first = session.columns[0]
        session.calibrate_column_xticks(
            0,
            ticks=[
                {"px": float(first["start"]) + 20, "value": 0.0},
                {"px": float(first["end"]) - 20, "value": 40.0},
            ],
            unit="%",
        )
        assert _diagram_payload(session)["columns"][0]["scale_provenance"][
            "calibrated"
        ]

        session.clear_column_xticks(0)

        reverted = _diagram_payload(session)["columns"][0]["scale_provenance"]
        assert reverted["calibrated"] is False, "清除标定后 provenance 仍说已标定"


class TestProvenanceIsNotPersisted:
    """(d) 诊断字段不该进工程包（参照 x_ticks_dropped 的处置）。"""

    def test_payload_is_json_serialisable(self) -> None:
        session = _columns_only_session()

        payload = _diagram_payload(session)

        assert json.dumps(payload, ensure_ascii=False)

    def test_project_save_does_not_persist_scale_provenance(self) -> None:
        session = _columns_only_session()
        first = session.columns[0]
        session.calibrate_column_xticks(
            0,
            ticks=[
                {"px": float(first["start"]) + 20, "value": 0.0},
                {"px": float(first["end"]) - 20, "value": 40.0},
            ],
            unit="%",
        )
        # 前置：载荷里确实有这个键，否则这条测试测的是空气
        assert "scale_provenance" in _diagram_payload(session)["columns"][0]

        saved = session.project_save(format="json")["data"]
        persisted = [c for c in saved["columns"] if "scale_provenance" in c]
        assert not persisted, (
            "scale_provenance 进了工程包 —— 它是本次会话的诊断信息，"
            "重新载入时应由当前状态重新算，而不是信一个存下来的旧结论"
        )


class TestLegacyFieldsAreStillShipped:
    """保留兼容字段：删字段会让缺陷藏得更深（见模块 docstring）。"""

    def test_start_value_and_tick_value_still_present(self) -> None:
        session = _columns_only_session()

        payload = _diagram_payload(session)

        for column in payload["columns"]:
            assert "startValue" in column
            assert "tickValue" in column
            assert "maxPercent" in column

    def test_provenance_disagrees_with_the_number_when_uncalibrated(self) -> None:
        """核心表达：数字还在（20），但 provenance 说明它不是量出来的。

        这正是本任务要达成的可读性——不删数字，而是让"这个 20 是谁给的"可见。
        """
        session = _columns_only_session()

        first_column = _diagram_payload(session)["columns"][0]

        assert first_column["tickValue"] == 20.0, (
            "前置：硬编码的 20 仍在载荷里（本任务不删它）"
        )
        assert first_column["scale_provenance"]["calibrated"] is False, (
            "数字是 20、来源却是 legacy —— provenance 必须如实说明这一点"
        )
