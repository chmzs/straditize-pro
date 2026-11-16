# -*- coding: utf-8 -*-
"""组形态是**单一事实源**：改写组 `plot_type` 必须清掉组内各列的旧快照。

## 缺陷本体（用户实测 + 代码定位一致）

用户的 hoya 工程里 `grp1 area / grp2 line / grp3 line`，但 28 列各自带着
分列期抄下来的 `plot_type`（col02=area、col01=line）。前端画布只读列字段，
于是「这个分组我想切换为折线」——后端组值改了、画布照旧画面积。

## 修法

`roi_group_update` 写 `plot_type` 时清掉组内各列的 `plot_type` / `plotType`，
语义与同函数里 `value_per_px` 清 `x_ticks` 完全一致：组级写入即整组重设，
列的旧值作废。列级**显式覆盖**仍可用（`column.update` 的 `plot_type`），
但必须由用户重新设。

## 反向验证

把 `roi.py` 里那段 `if "plot_type" in updates` 的清除块注掉，第 1 条立刻红。
"""

from __future__ import annotations

from straditize_core.session import StraditizeSession


def _group(group_id: str, plot_type: str) -> dict:
    return {
        "id": group_id,
        "name": group_id,
        "unit": "%",
        "plot_type": plot_type,
        "scale_type": "linear",
        "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
    }


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session.rois = [
        {
            "id": "roi_1",
            "name": "pollen",
            "default_group_id": "grp1",
            "x_groups": [_group("grp1", "area"), _group("grp2", "line")],
        }
    ]
    session.columns = [
        {"name": "col01", "x_group_id": "grp1", "plot_type": "area"},
        {"name": "col02", "x_group_id": "grp1", "plot_type": "area"},
        {"name": "col03", "x_group_id": "grp2", "plot_type": "line"},
    ]
    return session


def test_group_plot_type_write_clears_column_snapshots() -> None:
    """写组形态 → 组内各列的旧快照消失，组外的列一根汗毛都不动。"""
    session = _session()

    result = session.roi_group_update("roi_1", "grp1", {"plot_type": "line"})

    assert result["group"]["plot_type"] == "line"
    for col in session.columns[:2]:
        assert col.get("plot_type") is None, (
            f"组形态改写后 {col['name']} 的旧快照必须清掉，实际 {col.get('plot_type')!r}；"
            "留着它前端就会继续按 area 画（用户看到的「切折线不生效」）"
        )
    # 负向对照：别的组不受影响，否则这条清除逻辑越界了。
    assert session.columns[2].get("plot_type") == "line", (
        "清除只作用于本组；grp2 的列必须原样保留"
    )


def test_group_write_without_plot_type_keeps_column_snapshots() -> None:
    """只改单位时不得顺手清形态：清除必须由"这次真的写了 plot_type"触发。"""
    session = _session()

    session.roi_group_update("roi_1", "grp1", {"unit": "grains/g"})

    assert session.columns[0].get("plot_type") == "area", (
        "没写 plot_type 的组更新不得改动列上的形态快照"
    )
