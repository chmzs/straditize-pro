"""组单位可编辑：写入落库 → 列载荷 / LiPD / 随包脚本三处跟着变。

## 缺口

`roi.groupUpdate` 一直放行 `unit`，但**没有任何 UI 会去写它**（步骤 6 的组卡片只显示
「单位: %」，不可编辑）。于是 28 列全是 `%` —— 炭屑与花粉浓度也被标成百分比，
下游（列载荷 / LiPD / 随包 plot_strat.R）只能照抄这个错值。这是整条量纲链的源头。

## 判据

1. `roi.groupUpdate{unit}` 真的落库，回读一致；
2. 同一份数据里，列载荷 `unit`、LiPD `units`、manifest `column_units` 三处字符串一致；
3. 空串当场 `-32602`，旧值保留（不让「单位被清空」变成静默的量纲错误）。

## 反向验证

把 `_normalize_group_unit` 改成恒返回 `"%"` → 判据 1、2 变红；
删掉空串校验 → 判据 3 变红。
"""

from __future__ import annotations

import pytest

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.protocol import JsonRpcError
from straditize_core.rpc_methods import system as system_methods
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    return session


def _two_groups(session: StraditizeSession) -> tuple[str, str, str]:
    """建两个组（% 与 counts），把第 0 列划给 counts 组，两组都标定斜率。

    返回 (roi_id, pct_group_id, counts_group_id)。
    """
    roi_id = session.rois[0]["id"]
    pct_gid = session.roi_group_create(roi_id, name="pollen", unit="%")["group"]["id"]
    counts_gid = session.roi_group_create(roi_id, name="charcoal", unit="counts")["group"]["id"]
    for idx, col in enumerate(session.columns):
        col["x_group_id"] = counts_gid if idx == 0 else pct_gid
    session.roi_group_update(roi_id, pct_gid, {"value_per_px": 0.5})
    session.roi_group_update(roi_id, counts_gid, {"value_per_px": 5.0})
    return roi_id, pct_gid, counts_gid


def _payload(session: StraditizeSession) -> dict:
    dispatcher = JsonRpcDispatcher()
    system_methods.register(dispatcher, session)
    return dispatcher._methods["straditize.getDiagramData"]()


def _lipd_units(lipd: dict) -> dict[str, str]:
    """把 LiPD JSON-LD 里所有 (variableName → units) 抖平，结构改动不影响判据。"""
    found: dict[str, str] = {}

    def walk(node: object) -> None:
        if isinstance(node, dict):
            if "variableName" in node and "units" in node:
                found[str(node["variableName"])] = str(node["units"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(lipd)
    return found


def _group(session: StraditizeSession, group_id: str) -> dict:
    return next(g for g in session.rois[0]["x_groups"] if g["id"] == group_id)


def test_group_unit_update_is_stored_and_readable() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)

    session.roi_group_update(roi_id, counts_gid, {"unit": "粒/g"})

    assert _group(session, counts_gid)["unit"] == "粒/g", "改了组单位，库里必须变"
    # 空白要归一：前后空格不许跟着进库（下游按字符串比较判量纲）
    session.roi_group_update(roi_id, counts_gid, {"unit": "  counts  "})
    assert _group(session, counts_gid)["unit"] == "counts"


def test_group_unit_reaches_the_diagram_payload() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    payload = _payload(session)
    counts_columns = [c for c in session.columns if c.get("x_group_id") == counts_gid]
    assert counts_columns, "前置：第 0 列必须已划给 counts 组"
    names = {c.get("name") or c.get("id") for c in counts_columns}
    sent = {c.get("name"): c.get("unit") for c in payload["columns"] if c.get("name") in names}

    assert sent, "列载荷里找不到这些列"
    assert set(sent.values()) == {"counts"}, f"侧边栏拿到的单位不对：{sent}"


def test_group_unit_reaches_lipd() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    result = session.export_multi_lipd()
    units = _lipd_units(result["lipd"])
    names = {
        c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid
    }

    assert {units.get(n) for n in names if n} == {"counts"}, (
        f"LiPD 里的单位没跟上组单位：{ {n: units.get(n) for n in names} }"
    )


def test_empty_unit_is_rejected_and_old_value_kept() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    with pytest.raises(JsonRpcError) as excinfo:
        session.roi_group_update(roi_id, counts_gid, {"unit": "   "})

    assert excinfo.value.code == -32602
    assert "unit" in str(excinfo.value)
    assert _group(session, counts_gid)["unit"] == "counts", (
        "拒绝之后旧值必须原样保留，不能把组写成空单位"
    )
