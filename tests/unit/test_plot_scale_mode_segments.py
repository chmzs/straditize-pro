"""分段拼接 × 列量程（`plot_scale_mode`）的三情景口径。

## 背景

分段拼接之前只看「组数 ≥2」，与 `plot_scale_mode`（normalize / fixed）互不知情，
于是用户把某列标成 `fixed` 后，图上仍按百分比归一画 —— **静默失效**。

## 三情景（用户 2026-11-18 拍板）

| 情景 | 输入 | 期望 |
|---|---|---|
| A | 只有 normalize 列（或显式把列标成 normalize） | **不分段**，单块按 percent 归一 |
| B | 混排（部分 fixed） | `% 块`（normalize 列）+ 侧段（fixed 列各自成段） |
| C | 全部 fixed | 没有 `% 块`，所有列都在侧段 |

## 判据说明

渲染被打了桩（`render_strat_diagram` 与 `plot_detect_r`），所以这三条只验**分段口径的
settings**，不需要 R —— 否则 CI 上没有 rioja 包，判据会被 skip 掉，等于没有门禁。

R 侧「无 % 块时如何排布」由 `test_plot_render` 与手工出图覆盖（情景 C 实测 441 779 B 正常出图）。
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from straditize_core import session_parts


@pytest.fixture()
def stubbed(monkeypatch):
    from straditize_core.session import StraditizeSession

    session = StraditizeSession()
    session._init_export()
    # 两个组、三列：col01 属于 grp2，col02/col03 属于 grp1（与真实工程同形）。
    session.columns = [
        {"col_index": 0, "name": "col01", "roi_id": "roi_1", "x_group_id": "grp2"},
        {"col_index": 1, "name": "col02", "roi_id": "roi_1", "x_group_id": "grp1"},
        {"col_index": 2, "name": "col03", "roi_id": "roi_1", "x_group_id": "grp1"},
    ]
    frame = pd.DataFrame(
        {
            "depth": [10.0, 20.0, 30.0],
            "col01": [1.0, 2.0, 3.0],
            "col02": [4.0, 5.0, 6.0],
            "col03": [7.0, 8.0, 9.0],
        }
    )
    session._plot_source_frame = lambda: frame  # type: ignore[method-assign]
    session.plot_detect_r = lambda: {"path": "/stub/Rscript"}  # type: ignore[method-assign]

    def _stub_render(**kwargs):
        # 桩必须真的落一个文件并回 path：plot_render 之后会 read_as_data_url(path)。
        out = Path(str(kwargs["out_path"]))
        out.write_bytes(b"\xff\xd8\xffstub")
        return {
            "path": str(out),
            "engine": "stub",
            "size_bytes": 7,
            "warnings": [],
            "rscript": "/stub/Rscript",
            # plot_render 把 info["settings"] 原样回给调用方 —— 判据正是读它。
            "settings": dict(kwargs.get("settings") or {}),
        }

    monkeypatch.setattr(session_parts.plotting, "render_strat_diagram", _stub_render)
    return session


def _seg_keys(settings: dict) -> list[str]:
    return sorted(
        key
        for key in settings
        if key.startswith("seg_left.") or key.startswith("seg_right.")
    )


def test_scenario_a_normalize_only_does_not_segment(stubbed) -> None:
    result = stubbed.plot_render(
        format="jpeg",
        settings={"plot_scale_mode": {"col01": "normalize", "col02": "normalize"}},
    )

    assert _seg_keys(result["settings"]) == [], "全是 normalize 时不该分段"


def test_scenario_b_mixed_puts_fixed_columns_in_side_segments(stubbed) -> None:
    result = stubbed.plot_render(
        format="jpeg", settings={"plot_scale_mode": {"col01": "fixed"}}
    )

    keys = _seg_keys(result["settings"])
    assert len(keys) == 1, keys
    assert keys[0].endswith(".col01"), f"只有被标 fixed 的列进侧段：{keys}"


def test_scenario_c_all_fixed_puts_every_column_in_side_segments(stubbed) -> None:
    result = stubbed.plot_render(
        format="jpeg",
        settings={
            "plot_scale_mode": {"col01": "fixed", "col02": "fixed", "col03": "fixed"}
        },
    )

    keys = _seg_keys(result["settings"])
    assert len(keys) == 3, f"全部 fixed 时每一列都进侧段：{keys}"
    # 等宽的实现方式：**每列自成一个段**（段宽由我们按 avail/列数 定，单列段铺满）。
    # 若两列共用一个 gid，它们会合成一个段、段内仍按各列 max 分宽 → 不等宽。
    gids = [key.rsplit(".", 1)[0].split(".", 1)[1] for key in keys]
    assert len(set(gids)) == len(keys), f"每列必须独占一个段（gid 唯一）：{gids}"


def test_no_scale_mode_falls_back_to_group_rule(stubbed) -> None:
    result = stubbed.plot_render(format="jpeg", settings={})

    keys = _seg_keys(result["settings"])
    assert keys, "没有 plot_scale_mode 时保留「按组切段」的老口径（grp2 单独成段）"
    assert keys[0].endswith(".col01")
