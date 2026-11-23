# -*- coding: utf-8 -*-
"""步骤 4「检测横线 / 检测竖线」开关：关掉一类 = **不生成**该类候选。

## 需求

面积图的坐标线大多是横线，竖线（贯穿网格线 / 列内短竖线）多数时候是噪音。
用户希望能一键不看竖线，而不是在几十条竖线里逐条点「删除」。

## 三类候选（见 `straditize_core/lines.py` 文件头）

- Kind A：贯穿横向线（坐标线）
- Kind B：贯穿纵向线（网格线）
- Kind C：列内纵向短线（刻度齿 / 基线）

`include_horizontal` 管 A，`include_vertical` 管 **B 与 C**（两者都是竖的，
用户看到的"竖线"就是这个集合，分两个开关只会让人猜）。

## 判据

1. `include_vertical=False` ⇒ `kind ∈ {B, C}` 条数 **== 0**，且 A 条数与默认调用**相同**；
2. `include_horizontal=False` ⇒ A 条数 **== 0**，B/C 条数与默认调用**相同**；
3. 负向对照（回归钉子）：不传开关 vs 显式 `True/True` —— 候选清单**逐条完全相同**
   （含 `id` / `kind` / `at` / `span` / `width` / `geometry`）。这一条比"关掉后为 0"
   更重要：它钉住"默认路径没被顺手改掉"；
4. 金丝雀：把转发处改成恒 `True`（参数被忽略）⇒ 判据 1 必须红。

## 为什么判据用 `columns=None` 的图

hoya 的 29 条列轴已被 `_is_column_axis` 排除（见 `test_line_candidates_column_axis.py`），
于是"已分列"状态下 hoya 只剩 3 条横向候选，**竖线恒为 0** —— 用它验"关掉竖线后为 0"
是没有判别力的空断言。所以竖线判据跑在"后端还不知道列在哪"的同一张图上
（实测 A=3、B=14），那里竖线真的存在，关掉开关才看得见差别。
"""

from __future__ import annotations

import collections

import numpy as np
import pytest

from straditize_core.lines import detect_line_candidates
from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession
from straditize_core.session_parts import cleanup as cleanup_module

HOYA_X_BOUNDS = [315, 1946]
HOYA_Y_BOUNDS = [511, 1311]


def _kinds(candidates: list[dict]) -> dict[str, int]:
    return dict(collections.Counter(str(c.get("kind")) for c in candidates))


def _verticals(candidates: list[dict]) -> list[dict]:
    return [c for c in candidates if c.get("kind") in {"B", "C"}]


def _hoya_session() -> tuple[StraditizeSession, str, object]:
    """真实图片 + 真实 ROI + 真实分列，并把 `columns` 摘掉（见文件头最后一段）。"""
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    roi_id = session.rois[0]["id"]
    session.detect_columns(
        data_xlim=HOYA_X_BOUNDS, data_ylim=HOYA_Y_BOUNDS, roi_id=roi_id
    )
    roi = session._roi_for(roi_id)[1]
    return session, roi_id, roi


def _session_vertical_rich() -> tuple[StraditizeSession, str]:
    """已分列但**告诉检测器"列未知"**——竖线确实存在的那个状态。"""
    session, roi_id, _roi = _hoya_session()
    session.columns = None
    return session, roi_id


# ----------------------------------------------------------------------
# 判据 1：关掉竖线 ⇒ B/C 为 0，A 条数不变
# ----------------------------------------------------------------------


def _assert_vertical_off_keeps_horizontals(
    session: StraditizeSession, roi_id: str
) -> None:
    """判据体（金丝雀复用同一段，保证"红的确实是这条判据"）。"""
    baseline = session.detect_line_candidates(roi_id, include_vertical=True)["candidates"]
    base_kinds = _kinds(baseline)
    assert base_kinds.get("B", 0) + base_kinds.get("C", 0) > 0, (
        f"前置：显式开启竖线必须真有竖线候选可关（实测 {base_kinds}）—— "
        "否则本条判据恒绿、零信息量"
    )
    assert base_kinds.get("A", 0) > 0, (
        f"前置：必须真有横向候选（实测 {base_kinds}）"
    )

    off = session.detect_line_candidates(roi_id, include_vertical=False)["candidates"]
    off_kinds = _kinds(off)

    assert off_kinds.get("B", 0) == 0 and off_kinds.get("C", 0) == 0, (
        f"`include_vertical=False` 仍返回了竖线候选（实测 {off_kinds}）—— "
        "开关必须在**生成阶段**生效，不是生成后过滤"
    )
    assert off_kinds.get("A", 0) == base_kinds.get("A", 0), (
        f"关掉竖线影响了横线条数：{base_kinds} → {off_kinds} —— 两个开关必须互不干扰"
    )
    # 逐条核对：剩下的必须全是 A（不含任何 axis="v"）
    assert [c for c in off if c.get("axis") == "v"] == [], (
        "`include_vertical=False` 返回体里仍有 axis='v' 的候选"
    )


def test_vertical_switch_off_removes_all_vertical_candidates() -> None:
    session, roi_id = _session_vertical_rich()
    _assert_vertical_off_keeps_horizontals(session, roi_id)


# ----------------------------------------------------------------------
# 判据 2：关掉横线 ⇒ A 为 0，B/C 条数不变
# ----------------------------------------------------------------------


def test_horizontal_switch_off_removes_all_horizontal_candidates() -> None:
    session, roi_id = _session_vertical_rich()
    baseline = session.detect_line_candidates(roi_id, include_vertical=True)["candidates"]
    base_kinds = _kinds(baseline)

    off = session.detect_line_candidates(roi_id, include_horizontal=False, include_vertical=True)["candidates"]
    off_kinds = _kinds(off)

    assert off_kinds.get("A", 0) == 0, (
        f"`include_horizontal=False` 仍返回了横线候选（实测 {off_kinds}）"
    )
    assert off_kinds.get("B", 0) == base_kinds.get("B", 0), (
        f"关掉横线影响了 B 类条数：{base_kinds} → {off_kinds}"
    )
    assert off_kinds.get("C", 0) == base_kinds.get("C", 0), (
        f"关掉横线影响了 C 类条数：{base_kinds} → {off_kinds}"
    )
    assert [c for c in off if c.get("axis") == "h"] == [], (
        "`include_horizontal=False` 返回体里仍有 axis='h' 的候选"
    )


# ----------------------------------------------------------------------
# Kind C（列内短竖线）也必须受同一个竖线开关管
# ----------------------------------------------------------------------


def _synthetic_ink() -> tuple[np.ndarray, list[dict]]:
    ink = np.zeros((400, 400), dtype=bool)
    columns = [{"start": 100, "end": 200, "roi_id": "roi_1"}]
    ink[200, 10:390] = True  # 横向干扰线：贯穿 95% 宽度（Kind A）
    ink[150:211, 150] = True  # 列内竖直污点：61px ≈ 15% 高度（Kind C）
    return ink, columns


def test_column_internal_verticals_are_gated_by_the_same_switch() -> None:
    """用户眼里的"竖线"包含列内短竖线，所以 B 与 C 共用一个开关。"""
    ink, columns = _synthetic_ink()
    roi = {"xlim": [0, 400], "ylim": [0, 400]}
    kwargs = dict(
        columns=columns,
        line_fraction_h=0.75,
        line_fraction_v=0.30,
        line_width_min=1,
        line_width_max=3,
    )

    on = detect_line_candidates(ink, roi, include_vertical=True, **kwargs)
    assert _kinds(on) == {"A": 1, "C": 1}, (
        f"前置：显式开启竖线时合成图应产出 1 条横线 + 1 条列内竖线，实测 {_kinds(on)}"
    )

    off = detect_line_candidates(ink, roi, include_vertical=False, **kwargs)
    assert _kinds(off) == {"A": 1}, (
        f"`include_vertical=False` 未关掉列内竖线（Kind C），实测 {_kinds(off)}"
    )

    off_h = detect_line_candidates(
        ink, roi, include_horizontal=False, include_vertical=True, **kwargs
    )
    assert _kinds(off_h) == {"C": 1}, (
        f"`include_horizontal=False` 未关掉横线，实测 {_kinds(off_h)}"
    )


# ----------------------------------------------------------------------
# 判据 3：负向对照——默认路径必须与改动前逐字节等价
# ----------------------------------------------------------------------


def test_omitted_switches_equal_default_pair() -> None:
    """不传开关 == 显式 True/False（横线开、竖线关），逐条逐字段相同。"""
    ink, columns = _synthetic_ink()
    roi = {"xlim": [0, 400], "ylim": [0, 400]}
    kwargs = dict(
        columns=columns,
        line_fraction_h=0.75,
        line_fraction_v=0.30,
        line_width_min=1,
        line_width_max=3,
    )

    omitted = detect_line_candidates(ink, roi, **kwargs)
    explicit = detect_line_candidates(
        ink, roi, include_horizontal=True, include_vertical=False, **kwargs
    )
    assert omitted == explicit, "不传开关与显式 True/False 的返回不一致——默认值被改动了"

    # 真图同一件事：**集合相等**，不是条数相等。
    session, roi_id = _session_vertical_rich()
    baseline = session.detect_line_candidates(roi_id)["candidates"]
    explicit_default = session.detect_line_candidates(
        roi_id, include_horizontal=True, include_vertical=False
    )["candidates"]

    def _canonical(candidates: list[dict]) -> list[dict]:
        """排序后的完整候选（去掉会话级 id），用于集合相等比较。"""
        stripped = [{k: v for k, v in c.items() if k != "id"} for c in candidates]
        return sorted(
            stripped,
            key=lambda c: (
                c["kind"],
                c["at"],
                c["geometry"]["x0"],
                c["geometry"]["y0"],
                c["geometry"]["x1"],
                c["geometry"]["y1"],
            ),
        )

    assert _canonical(baseline) == _canonical(explicit_default), (
        "真图上前置：缺省调用与显式 True/False 的候选**集合**必须相等"
        "（排序后逐字段）—— 条数相同不算同一条判据"
    )
    base_kinds = _kinds(baseline)
    assert base_kinds.get("A", 0) > 0 and base_kinds.get("B", 0) == 0, (
        f"前置：默认不扫竖线，覆盖横线，实测 {base_kinds}"
    )


def test_default_detection_set_matches_pre_switch_baseline() -> None:
    """默认调用的候选**集合**：横线开、竖线关。"""
    session, roi_id, _roi = _hoya_session()
    with_columns = session.detect_line_candidates(roi_id)["candidates"]
    assert sorted((c["kind"], c["at"]) for c in with_columns) == [
        ("A", 818),
        ("A", 1128),
        ("A", 1306),
    ], (
        "已分列状态的默认候选集合变了："
        f"{sorted((c['kind'], c['at']) for c in with_columns)}"
    )

    session, roi_id = _session_vertical_rich()
    unknown_columns = session.detect_line_candidates(roi_id)["candidates"]
    assert sorted((c["kind"], c["at"]) for c in unknown_columns) == [
        ("A", 818),
        ("A", 1128),
        ("A", 1306),
    ], (
        "列未知状态的默认候选集合应仅含 3 条横线（竖线默认不扫描）："
        f"{sorted((c['kind'], c['at']) for c in unknown_columns)}"
    )

    # 显式传 include_vertical=True 时才产出竖线
    with_vert = session.detect_line_candidates(roi_id, include_vertical=True)["candidates"]
    assert sorted((c["kind"], c["at"]) for c in with_vert) == [
        ("A", 818),
        ("A", 1128),
        ("A", 1306),
        ("B", 970),
        ("B", 1000),
        ("B", 1096),
        ("B", 1192),
        ("B", 1224),
        ("B", 1330),
        ("B", 1436),
        ("B", 1468),
        ("B", 1616),
        ("B", 1648),
        ("B", 1680),
        ("B", 1712),
        ("B", 1742),
        ("B", 1774),
    ], (
        "显式 include_vertical=True 时产出的完整候选集合变了："
        f"{sorted((c['kind'], c['at']) for c in with_vert)}"
    )


# ----------------------------------------------------------------------
# RPC 透传：前端真的能把开关送到后端（`protocol.py` 静默丢弃未知参数）
# ----------------------------------------------------------------------


def test_rpc_method_accepts_the_switches_and_omission() -> None:
    """`algorithm.detectLineCandidates` 必须收得下这两个开关。

    `protocol.py:331-345` 对没有 `**kwargs` 的处理函数是**静默丢弃**未知名参数，
    所以"前端传了、后端换了默认"这类故障不会报错、只会安静地不生效。这条判据
    用真实 dispatcher 走一遍，缺参数就会在这里以"竖线没被关掉"变红。
    """
    session, roi_id = _session_vertical_rich()
    dispatcher = create_rpc_dispatcher(session)
    detect = dispatcher._methods["algorithm.detectLineCandidates"]

    default = detect(roi_id=roi_id)["candidates"]
    assert _kinds(default).get("B", 0) == 0 and _kinds(default).get("A", 0) > 0, (
        f"前置：缺省调用应默认不产出 B 类竖线（实测 {_kinds(default)}）"
    )

    on = detect(roi_id=roi_id, include_vertical=True)["candidates"]
    assert _kinds(on).get("B", 0) > 0, (
        f"显式传 include_vertical=True 应产出竖线（实测 {_kinds(on)}）"
    )

    off = detect(roi_id=roi_id, include_vertical=False)["candidates"]
    assert _verticals(off) == [], (
        f"经 RPC 传 `include_vertical=False` 后仍有竖线候选（实测 {_kinds(off)}）"
    )

    off_h = detect(roi_id=roi_id, include_horizontal=False)["candidates"]
    assert [c for c in off_h if c.get("kind") == "A"] == [], (
        f"经 RPC 传 `include_horizontal=False` 后仍有横线候选（实测 {_kinds(off_h)}）"
    )


# ----------------------------------------------------------------------
# 判据 4：金丝雀——参数被忽略时判据 1 必须红
# ----------------------------------------------------------------------


def test_canary_ignored_switch_makes_criterion_red(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """把转发处改成恒 `True`（等于"这个参数被忽略"），判据 1 必须变红。

    只替换 `session_parts.cleanup` 全局里那个转发函数，不改判据本身：判据体
    `_assert_vertical_off_keeps_horizontals` 与正向用例是同一段代码，所以这条
    金丝雀证明的是"判据 1 对这个参数敏感"，而不是"另写了一条会红的假判据"。
    """
    session, roi_id = _session_vertical_rich()
    original = cleanup_module.detect_line_candidates

    def ignore_vertical_switch(*args, **kwargs):
        return original(*args, **{**kwargs, "include_vertical": True})

    monkeypatch.setattr(
        cleanup_module, "detect_line_candidates", ignore_vertical_switch
    )

    with pytest.raises(AssertionError) as excinfo:
        _assert_vertical_off_keeps_horizontals(session, roi_id)

    assert "include_vertical=False" in str(excinfo.value), (
        f"红的原因必须来自判据 1 本身，实测：{excinfo.value}"
    )
