# -*- coding: utf-8 -*-
"""「百分比总和 ≤ 100%」这道门只累加**百分比列**，不许把浓度/粒数/比值加进去。

## 现场缺陷（真机，`.recon_20261117`）

导出面板顶部的自检横幅写着：

> 组内总和超标警报（发现 207 个层位总和 > 102%）｜最大总和 **87135.2%**

87135 是 `Concentration` 的量级（窗口 1558..86753，单位 粒/g），不是比例。原因是
`compute_qa_summary` 把该 ROI 的**所有列**都加进"百分比总和"，而 `composition` 只是
ROI 级布尔、不看列单位。后果不是显示难看：这条告警从此**恒为假阳性**，用户会永久忽略它，
而它本应是"某层百分比加起来超过 100%"的严肃检查。

## 判据

1. 一个含 2 个 `%` 列 + 1 个 `粒/g` 列的工程：`sum.max` 必须等于**两个 % 列之和**
   （本用例 120），不得出现 1e4 量级；`sum_excluded_columns == ["Concentration"]`。
2. 全 `%` 工程：`sum.*` 与改动前逐值相等（零回归）。
3. 反向验证：把 `include_in_sum` 一律当 True → 判据 1 变红（sum.max 变成 87120）。
"""

from __future__ import annotations

from straditize_core.qa import compute_qa_summary


def _columns_info(units: dict[str, str]) -> list[dict]:
    """按 "列名 → 单位" 造 columns_info，`include_in_sum` 与后端同口径（只有 % 列进总和）。"""

    def is_percent(unit: str) -> bool:
        return unit.strip().lower() in ("%", "％", "percent", "pct")

    return [
        {
            "name": name,
            "declared_max": 100.0,
            "calibrated": True,
            "include_in_sum": is_percent(unit),
        }
        for name, unit in units.items()
    ]


def test_composition_sum_excludes_non_percent_columns() -> None:
    units = {"Picea": "%", "Pinus": "%", "Concentration": "粒/g"}
    info = _columns_info(units)
    # 一行：Picea 80 + Pinus 40 = 120%（已超标），Concentration 87000 不进总和
    horizons = [{"depth": 1.0, "values": [80.0, 40.0, 87000.0]}]

    summary = compute_qa_summary(
        roi_id="roi_1",
        roi_name="pollen",
        composition=True,
        horizons=horizons,
        columns_info=info,
        tolerance=2.0,
    )

    assert summary["sum"]["max"] == 120.0, summary["sum"]
    assert summary["sum_excluded_columns"] == ["Concentration"]
    # 120 > 102 → 这条告警**应该**触发，且只因为两个 % 列
    assert summary["violations_over"] and summary["violations_over"][0]["sum"] == 120.0


def test_all_percent_project_unchanged() -> None:
    """零回归：全 % 工程的总和与"没有掩码"的老实现逐值相等。"""
    units = {"Picea": "%", "Pinus": "%"}
    info = _columns_info(units)
    horizons = [
        {"depth": 1.0, "values": [10.0, 20.0]},
        {"depth": 2.0, "values": [30.0, 40.0]},
    ]
    summary = compute_qa_summary(
        roi_id="roi_1",
        roi_name="pollen",
        composition=True,
        horizons=horizons,
        columns_info=info,
        tolerance=2.0,
    )
    assert summary["sum"]["min"] == 30.0
    assert summary["sum"]["max"] == 70.0
    assert summary["sum_excluded_columns"] == []
    assert summary["violations_over"] == []


def test_missing_key_defaults_to_included() -> None:
    """缺 `include_in_sum` 键（老调用方 / 手工构造）→ 仍按老口径全加，不静默丢列。"""
    info = [{"name": "a", "declared_max": 100.0, "calibrated": True},
            {"name": "b", "declared_max": 100.0, "calibrated": True}]
    summary = compute_qa_summary(
        roi_id="roi_1",
        roi_name="pollen",
        composition=True,
        horizons=[{"depth": 1.0, "values": [10.0, 20.0]}],
        columns_info=info,
        tolerance=2.0,
    )
    assert summary["sum"]["max"] == 30.0
    assert summary["sum_excluded_columns"] == []


# ---------------------------------------------------------------------------
# 端到端：掩码必须由 `_qa_column_values` 按**列单位**填，不能恒 True
# ---------------------------------------------------------------------------

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"
Y_MARKS = [{"pixel": 233.0, "val": 0.0}, {"pixel": 869.0, "val": 100.0}]


def _session_with_count_column():
    """一列 `counts`（非 %）+ 其余 `%`，走真实 `qa_summarize` 链路。"""
    from straditize_core.session import StraditizeSession

    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    session.calibrate_axes(y_marks=[dict(m) for m in Y_MARKS], unit="cm")

    roi_id = session.rois[0]["id"]
    pct_gid = session.roi_group_create(roi_id, name="pollen", unit="%")["group"]["id"]
    cnt_gid = session.roi_group_create(roi_id, name="charcoal", unit="counts")["group"][
        "id"
    ]
    for index, col in enumerate(session.columns):
        col["x_group_id"] = cnt_gid if index == 0 else pct_gid
    session.roi_group_update(roi_id, pct_gid, {"value_per_px": 0.5})
    session.roi_group_update(roi_id, cnt_gid, {"value_per_px": 5000.0})

    session.samples_set(
        [
            {"row_px": 300, "depth": 10.0, "source": "manual"},
            {"row_px": 500, "depth": 50.0, "source": "manual"},
        ]
    )
    return session, session.columns[0].get("name")


def test_qa_summarize_excludes_count_column_from_sum() -> None:
    session, count_name = _session_with_count_column()
    summary = session.qa_summarize()

    assert summary["sum_excluded_columns"] == [count_name], summary[
        "sum_excluded_columns"
    ]
    # 计数列的读数在 1e3 量级；总和必须只含 % 列（< 1e3），不得把它加进去
    assert summary["sum"]["max"] < 1000.0, summary["sum"]
