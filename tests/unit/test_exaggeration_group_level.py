# -*- coding: utf-8 -*-
"""组级放大倍数：解析优先级（组 > 列 > 历史键）与载入迁移。

## 为什么组优先

论文里的夸大曲线是按**类群组**给的（"某些类群 ×5、另一些 ×3、其余不放大"），软件里的
对应做法是"把放大过的列编成一组"。所以倍率的真相源是组；列级字段只是历史遗留的单列
覆盖手段。两者并存时若都算数，同一个物理量在库里有俩答案，而 `px_to_value` 会真除它。

## 四条判据（每条都覆盖 `x_ticks` 与 `group_slope` 两种换算路径）

1. 组=5、列=null → 解析出 5，`px_to_value` 除 5；
2. 组=5、列=3 → 解析出**组**的 5（列级不影响结果）；
3. 组=null、列=3 → 解析出 3（迁移前的老工程仍生效）；
4. 载入迁移：列=5/组=null → 组=5、列=null；同组 5 与 3 → 组取 5、另一列保留 3 且 warning。

反向验证：把 `_resolve_exaggeration` 的组级分支挪到列级之后，判据 2 必须变红
（实测记录见 PR 描述；`test_group_wins_over_column_on_both_paths` 就是那条会红的用例）。
"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale

ROI_ID = "roi_1"
GRP_ID = "roi_1_grp1"
#: 组斜率路径的斜率（%/px）。取值要能被 5 整除得好读：0.5 %/px。
GROUP_SLOPE = 0.5
#: 两条路径共同的"图上满量程"参照点：x_ticks 路径的第二个齿 / 组斜率路径的 1px 之后。
TICK_PX = 200.0
TICK_VAL = 100.0


# ---------------------------------------------------------------------------
# 合成会话：[两列一组]，组参数随用例指定
# ---------------------------------------------------------------------------


def _group(exaggeration_mult: float | None, value_per_px: float | None = None) -> dict[str, Any]:
    group: dict[str, Any] = {
        "id": GRP_ID,
        "name": "木本组",
        "unit": "%",
        "plot_type": "area",
        "scale_type": "linear",
        "exaggeration_mult": exaggeration_mult,
        "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
    }
    if value_per_px is not None:
        group["value_per_px"] = value_per_px
    return group


def _session(group: dict[str, Any]) -> StraditizeSession:
    """最小会话：一个 ROI、一个组、两列（列只挂在组上，几何手工给）。"""
    session = StraditizeSession()
    session.rois = [
        {
            "id": ROI_ID,
            "name": "pollen",
            "x": 0.0,
            "y": 0.0,
            "w": 400.0,
            "h": 400.0,
            "x_groups": [group],
            "default_group_id": GRP_ID,
        }
    ]
    session.primary_roi_id = ROI_ID
    session.active_roi_id = ROI_ID
    session.columns = []
    return session


def _column(
    name: str,
    *,
    start: float,
    exaggeration_mult: float | None,
    path: str,
) -> dict[str, Any]:
    """一列。`path` 决定走哪条换算分支：`x_ticks` 还是 `group_slope`（组上有斜率）。"""
    col: dict[str, Any] = {
        "col_index": 0,
        "id": f"{ROI_ID}_col_{name}",
        "name": name,
        "species": name,
        "roi_id": ROI_ID,
        "x_group_id": GRP_ID,
        "start": start,
        "startX": start,
        "end": start + 100.0,
        "endX": start + 100.0,
        "scale_type": "linear",
        "plot_type": "area",
        "unit": "%",
        "exaggeration_mult": exaggeration_mult,
        "axis_stroke_px": None,
    }
    if path == "x_ticks":
        col["x_ticks"] = [
            {"px": start, "value": 0.0},
            {"px": TICK_PX, "value": TICK_VAL},
        ]
    else:
        col["x_ticks"] = None
    return col


def _read_at_full_scale(session: StraditizeSession, col: dict[str, Any]) -> float:
    """读"图上满刻度"那一点：`px_to_value` 的唯一出口，含 ÷倍率。"""
    scale = resolve_column_scale(session, col)
    return scale.px_to_value(TICK_PX, baseline_px=scale.abs_px0, require_calibrated=True)


PATHS = ("x_ticks", "group_slope")


def _scale_of(path: str) -> float | None:
    return GROUP_SLOPE if path == "group_slope" else None


# ---------------------------------------------------------------------------
# 判据 1：组=5、列=null → 5，且 px_to_value 除 5
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("path", PATHS)
def test_group_mult_resolves_and_divides(path: str) -> None:
    """组上 5×、列上没值：解析出 5，读数是未放大时的 1/5。

    两条路径都要测：`_scale_from_group_slope` 曾经直接读组的原值、绕过解析结果，
    于是同一个倍率在组斜率路径上丢掉而 x_ticks 路径保留 —— 只测一条会看漏。
    """
    session = _session(_group(5.0, _scale_of(path)))
    col = _column("Pinus", start=100.0, exaggeration_mult=None, path=path)

    scale = resolve_column_scale(session, col)
    assert scale.exaggeration_mult == 5.0

    total = TICK_VAL if path == "x_ticks" else GROUP_SLOPE * (TICK_PX - scale.abs_px0)
    expected = round(total / 5.0, 4)
    assert _read_at_full_scale(session, col) == pytest.approx(expected, abs=1e-9)
    # 判别力自证：把倍率当 1 算，读数必须不同（否则这条判据测不到除法）
    assert _read_at_full_scale(session, col) != pytest.approx(round(total, 4)) or total == 0


# ---------------------------------------------------------------------------
# 判据 2：组=5、列=3（冲突）→ 取组
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("path", PATHS)
def test_group_wins_over_column_on_both_paths(path: str) -> None:
    """冲突时取组：解析出 5 而不是 3，读数是 ÷5 而不是 ÷3。

    这条是**反向验证的靶子**：把 `_resolve_exaggeration` 的组级分支挪回列级之后，
    它会立刻红（3 != 5，读数也变成 ÷3）。
    """
    session = _session(_group(5.0, _scale_of(path)))
    col = _column("Pinus", start=100.0, exaggeration_mult=3.0, path=path)

    scale = resolve_column_scale(session, col)
    assert scale.exaggeration_mult == 5.0, (
        f"组={scale.exaggeration_mult!r}：应为组级 5（列级 3 必须被忽略）"
    )

    total = TICK_VAL if path == "x_ticks" else GROUP_SLOPE * (TICK_PX - scale.abs_px0)
    assert _read_at_full_scale(session, col) == pytest.approx(round(total / 5.0, 4), abs=1e-9)


# ---------------------------------------------------------------------------
# 判据 3：组=null、列=3 → 取 3（迁移前的老工程）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("path", PATHS)
def test_column_mult_still_applies_when_group_is_empty(path: str) -> None:
    """组为空时列级仍然生效 —— 这是"还没跑迁移"的老工程的唯一活路。"""
    session = _session(_group(None, _scale_of(path)))
    col = _column("Pinus", start=100.0, exaggeration_mult=3.0, path=path)

    scale = resolve_column_scale(session, col)
    assert scale.exaggeration_mult == 3.0

    total = TICK_VAL if path == "x_ticks" else GROUP_SLOPE * (TICK_PX - scale.abs_px0)
    assert _read_at_full_scale(session, col) == pytest.approx(round(total / 3.0, 4), abs=1e-9)


@pytest.mark.parametrize("raw", [None, 0, 1, 1.0, "abc", float("nan")])
def test_exaggeration_at_or_below_one_counts_as_none(raw: Any) -> None:
    """<=1 / 非数值 = 未放大（组与列两个来源都这样），且不影响读数。"""
    session = _session(_group(raw))
    col = _column("Pinus", start=100.0, exaggeration_mult=raw, path="x_ticks")
    scale = resolve_column_scale(session, col)
    assert scale.exaggeration_mult is None
    assert scale.px_to_value(TICK_PX, baseline_px=scale.abs_px0) == pytest.approx(100.0)


# ---------------------------------------------------------------------------
# 判据 4：载入迁移
# ---------------------------------------------------------------------------


def _payload(
    column_mults: list[float | None],
    *,
    group_mult: float | None = None,
    same_group: bool = True,
) -> dict[str, Any]:
    """老工程包的最小载荷：倍率只在列上，组上是 null。"""
    groups = [_group(group_mult)]
    columns = []
    for idx, mult in enumerate(column_mults):
        name = f"col{idx}"
        groups_for_col = GRP_ID
        if not same_group and idx > 0:
            # 每列自成一个组：用来验证"按组去重"，而不是把整张图的倍率合并成一个
            groups_for_col = f"{ROI_ID}_grp{idx + 1}"
            groups.append(
                {
                    "id": groups_for_col,
                    "name": f"组 {idx + 1}",
                    "unit": "%",
                    "plot_type": "area",
                    "scale_type": "linear",
                    "exaggeration_mult": group_mult,
                    "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                }
            )
        columns.append(
            {
                "id": f"{ROI_ID}_col_{name}",
                "species": name,
                "roi_id": ROI_ID,
                "x_group_id": groups_for_col,
                "startX": 100.0 + idx * 100,
                "endX": 200.0 + idx * 100,
                "x_ticks": [
                    {"px": 100.0 + idx * 100, "value": 0.0},
                    {"px": 200.0 + idx * 100, "value": 100.0},
                ],
                "unit": "%",
                "plot_type": "area",
                "scale_type": "linear",
                "exaggeration_mult": mult,
            }
        )
    return {
        "width": 400,
        "height": 400,
        "rois": [
            {
                "id": ROI_ID,
                "name": "pollen",
                "x": 0.0,
                "y": 0.0,
                "w": 400.0,
                "h": 400.0,
                "x_groups": groups,
                "default_group_id": GRP_ID,
            }
        ],
        "primary_roi_id": ROI_ID,
        "active_roi_id": ROI_ID,
        "columns": columns,
        "roi": {"x": 0.0, "y": 0.0, "w": 400.0, "h": 400.0},
        "calibration": {},
    }


def _load(payload: dict[str, Any]) -> StraditizeSession:
    session = StraditizeSession()
    session.project_load(payload)
    return session


def test_load_migrates_column_mult_to_group() -> None:
    """老包：列=5、组=null → 载入后组=5、列=null（搬完只剩一个真源）。"""
    session = _load(_payload([5.0]))
    group = session.rois[0]["x_groups"][0]
    assert group["exaggeration_mult"] == 5.0
    assert session.columns[0].get("exaggeration_mult") is None, (
        "列级倍率必须被清空，否则组被清空后它会静默复活"
    )
    # 行为不变：读数仍按 ÷5
    assert resolve_column_scale(session, session.columns[0]).exaggeration_mult == 5.0


def test_load_keeps_group_value_when_group_already_has_one() -> None:
    """组上已有倍率 → 不搬（组是真源；列级值原样留着，不生效）。"""
    session = _load(_payload([3.0], group_mult=5.0))
    assert session.rois[0]["x_groups"][0]["exaggeration_mult"] == 5.0
    assert session.columns[0]["exaggeration_mult"] == 3.0
    assert resolve_column_scale(session, session.columns[0]).exaggeration_mult == 5.0


def test_load_conflict_takes_mode_and_keeps_other_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """同组两列 5 与 3 → 组取 5，另一列保留 3，并记一条 warning（不许静默）。"""
    caplog.set_level(logging.WARNING, logger="straditize_rpc")
    session = _load(_payload([5.0, 3.0]))

    group = session.rois[0]["x_groups"][0]
    assert group["exaggeration_mult"] == 5.0
    assert session.columns[0].get("exaggeration_mult") is None, "被采纳的那列要清空"
    assert session.columns[1]["exaggeration_mult"] == 3.0, "未采纳的列级值必须保留（不静默丢弃）"

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and GRP_ID in r.getMessage()]
    assert warnings, "冲突必须留下 warning，否则用户永远不知道自己的 3 不生效"
    assert "3" in warnings[0].getMessage()


def test_load_clears_column_copy_when_group_already_matches() -> None:
    """老包没有 x_group_id → `_restore_columns` 自动建组时把列值抄到组上。

    抄完两处相等，迁移要把列上那份副本清掉：同一个数的两个副本就是两个事实源，
    一旦组被清空，列上的旧值会静默复活。
    """
    payload = _payload([5.0])
    payload["rois"][0]["x_groups"] = []  # 逼 `_restore_columns` 自动建组
    payload["rois"][0].pop("default_group_id", None)
    payload["columns"][0].pop("x_group_id", None)

    session = _load(payload)
    gid = session.columns[0]["x_group_id"]
    group = next(g for g in session.rois[0]["x_groups"] if g["id"] == gid)
    assert group["exaggeration_mult"] == 5.0
    assert session.columns[0].get("exaggeration_mult") is None
    assert resolve_column_scale(session, session.columns[0]).exaggeration_mult == 5.0


def test_load_does_not_migrate_across_groups() -> None:
    """不同组各搬各的：迁移按组去重，不把 A 组的倍率写到 B 组。"""
    session = _load(_payload([5.0, 4.0], same_group=False))
    groups = session.rois[0]["x_groups"]
    assert groups[0]["exaggeration_mult"] == 5.0
    assert groups[1]["exaggeration_mult"] == 4.0
    assert all(c.get("exaggeration_mult") is None for c in session.columns)
