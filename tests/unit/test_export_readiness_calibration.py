# -*- coding: utf-8 -*-
"""导出就绪清单必须尊重列标定（B-12），且不能矫枉过正。

## 缺陷本体

`get_export_readiness()` 原本只查两件事——ROI 是否被用户命名、该 ROI 有没有列。
它**从不看列有没有标定**，于是对着全部列未标定的会话报 `ready=True`。那是用户
导出前最后一道门，却对"所有读数都是程序默认值"毫无反应。

## 修法与取向

判据统一用 `resolve_column_scale(...).calibrated`（与导出、网格采样、QA 同一个
解析入口，不另造第二套）。`ready` 的三个条件变成：
**ROI 已命名 ∧ 该 ROI 有列 ∧ 所有列都已标定**。

不拒绝导出，但把"哪些列是默认值、来源是什么"如实报告出来（
`uncalibrated_columns` / `calibrated_count` / `provenance`）。理由：用户可能确实
想导原始读数；且一个布尔无法表达"28 列标了 1 列"。

## 三条判据必须同时成立

1. 零标定 → 不 ready（B12a，本缺陷）；
2. **全部标定 → 必须 ready**（B12b，防矫枉过正的哨兵——改成恒假会在这里红）；
3. 部分标定 → 不 ready，且能精确说出缺哪几列（B12c）。

`scripts/prod_gate/b12_provenance_probe.py` 的 B12a/b/c 是同一组判据的外部版本。
"""
from __future__ import annotations

from straditize_core.session import StraditizeSession

HOYA_X, HOYA_Y = [315, 1946], [511, 1311]


def _session_with_columns() -> StraditizeSession:
    """hoya 会话：已命名 ROI + 已分列，**一列都没标定**。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=session.rois[0]["id"])
    assert session.rois[0].get("name_source") != "default", (
        "前置：ROI 必须是用户命名的，否则会被 readiness_missing 挡住，"
        "测不到标定这条规则"
    )
    return session


def _calibrate_column(session: StraditizeSession, index: int) -> None:
    column = session.columns[index]
    start, end = float(column["start"]), float(column["end"])
    session.calibrate_column_xticks(
        index,
        ticks=[
            {"px": start + 20, "value": 0.0},
            {"px": end - 20, "value": 40.0},
        ],
        unit="%",
    )


class TestZeroCalibrationIsNotReady:
    """B12a：零标定不得放行。"""

    def test_uncalibrated_session_is_not_ready(self) -> None:
        session = _session_with_columns()

        readiness = session.get_export_readiness()

        assert readiness["ready"] is False, (
            f"零标定却 ready=True（calibrated "
            f"{readiness.get('calibrated_count')}/{readiness.get('column_count')}）"
            " —— 就绪清单没检查标定（B-12）"
        )
        assert readiness["calibrated_count"] == 0
        assert readiness["column_count"] == len(session.columns)
        assert readiness["provenance"]["all_calibrated"] is False

    def test_uncalibrated_columns_name_every_column(self) -> None:
        session = _session_with_columns()

        readiness = session.get_export_readiness()

        listed = [entry["col_index"] for entry in readiness["uncalibrated_columns"]]
        assert listed == list(range(len(session.columns))), (
            "未标定列清单没有覆盖全部列 —— 用户无法知道到底缺哪些"
        )
        assert all(entry["name"] for entry in readiness["uncalibrated_columns"])
        assert all(entry["source"] for entry in readiness["uncalibrated_columns"])

    def test_hardcoded_legacy_fields_do_not_count_as_calibrated(self) -> None:
        """关键判据形状：不能靠 `startValue`/`tickValue` 是否存在来判定。

        `detect_columns` 给每列硬编码 `startValue=0.0` / `tickValue=20.0`，
        两个字段**一直都在**。若判据是"字段是否存在"，此处会误判成已标定。
        """
        session = _session_with_columns()
        first = session.columns[0]
        assert first.get("startValue") is not None, "前置：硬编码字段确实存在"
        assert first.get("tickValue") is not None
        assert first.get("x_ticks") is None, "前置：但没有真实刻度"

        readiness = session.get_export_readiness()

        assert readiness["calibrated_count"] == 0, (
            "把硬编码的 startValue/tickValue 当成了标定依据 —— "
            "那两个值是程序默认值，不是用户读数"
        )


class TestFullyCalibratedStaysReady:
    """B12b：反向哨兵——改成恒假会在这里红。"""

    def test_all_columns_calibrated_is_ready(self) -> None:
        session = _session_with_columns()
        for index in range(len(session.columns)):
            _calibrate_column(session, index)

        readiness = session.get_export_readiness()

        assert readiness["ready"] is True, (
            "全部列已标定却 ready=False —— 矫枉过正了"
        )
        assert readiness["calibrated_count"] == len(session.columns)
        assert readiness["uncalibrated_columns"] == []
        assert readiness["provenance"]["all_calibrated"] is True


class TestPartialCalibrationIsDecidable:
    """B12c：部分标定必须可判——光有布尔 ready 不够。"""

    def test_partially_calibrated_reports_the_gap(self) -> None:
        session = _session_with_columns()
        _calibrate_column(session, 0)

        readiness = session.get_export_readiness()

        assert readiness["ready"] is False
        assert readiness["calibrated_count"] == 1
        assert readiness["column_count"] == len(session.columns)
        listed = [entry["col_index"] for entry in readiness["uncalibrated_columns"]]
        assert 0 not in listed, "已标定的第 0 列不应出现在未标定清单里"
        assert listed == list(range(1, len(session.columns))), (
            "未标定清单必须精确列出缺哪几列，一个布尔无法表达这个信息"
        )
        assert readiness["provenance"] == {
            "all_calibrated": False,
            "calibrated_count": 1,
            "column_count": len(session.columns),
            "sources": readiness["provenance"]["sources"],
        }


class TestExistingContractFieldsArePreserved:
    """既有 6 个字段语义不动（前端 export.spec.ts 断言了它们）。"""

    def test_six_legacy_fields_present_with_same_meaning(self) -> None:
        session = _session_with_columns()

        readiness = session.get_export_readiness()

        for field in (
            "sheets",
            "primary_roi",
            "primary_roi_id",
            "readiness_missing",
            "total_rois",
            "ready",
        ):
            assert field in readiness, f"既有字段 {field} 丢了"

        assert readiness["sheets"] == [roi.get("name", roi["id"]) for roi in session.rois]
        assert readiness["primary_roi_id"] == session.primary_roi_id
        assert readiness["total_rois"] == len(session.rois)
        assert readiness["readiness_missing"] == [], (
            "ROI 已命名且有列时，readiness_missing 仍应为空——"
            "'有未标定列'不能算进 ROI 级缺项，否则同一个 ROI 名重复出现"
        )

    def test_default_named_roi_still_blocks_readiness(self) -> None:
        """既有规则二仍生效：默认命名的 ROI 必须被拦住。"""
        session = StraditizeSession()
        session._init_cleanup()
        session.load_image(sample_key="hoya")
        session._init_rois()
        created = session.roi_create(x0=315, x1=1946, y0=511, y1=1311)["roi"]

        readiness = session.get_export_readiness()

        assert created["name"] in readiness["readiness_missing"]
        assert readiness["ready"] is False


class TestReadinessIsHonestAboutSources:
    """来源分布必须真实反映每列的情况，不能只在全标定/全未标定两端对。"""

    def test_sources_shift_from_legacy_to_x_ticks(self) -> None:
        session = _session_with_columns()
        before = session.get_export_readiness()["provenance"]["sources"]
        assert before.get("x_ticks", 0) == 0, "前置：尚未有列走 x_ticks 路径"
        assert sum(before.values()) == len(session.columns)

        _calibrate_column(session, 0)

        after = session.get_export_readiness()["provenance"]["sources"]
        assert after.get("x_ticks", 0) == 1, (
            "标定一列后来源分布没变 —— provenance 没有真的按列统计"
        )
        assert sum(after.values()) == len(session.columns)
