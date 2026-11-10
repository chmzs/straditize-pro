# -*- coding: utf-8 -*-
"""P0-B：清理劳动（排除区 / 笔迹）必须进工程包。

## 缺陷本体

`project_save` 的顶层载荷只有 `line_candidates` / `selected_candidate_ids` /
`line_removal{strength, remove_vertical, corrections}`，**没有**
`exclusion_regions` 与 `line_strokes`；`_restore_aux_fields` 也不读它们。

于是用户手工划的排除区、抹的笔迹在重开后全部消失：
掩膜变了 ⇒ 整列读数变了，而界面上的"排除区 (N 个)"归零，看起来像"我本来就没划"。

## 为什么这两条判据必须写成"与原值逐项/逐值相等"

"非零"是不够的：掩膜只要形状不同（少一个区、笔迹半径不同）也会非零，但交付的
数据已经变了。这里钉的是**逐项相等**（载荷层）与**逐值相等**（重算后的面积统计），
数值取自 `_recompose` 的真实掩膜，不是占位。

## 反向测试的方向

`tests/unit/test_project_load_cleanup_state.py` 原本把"载入后为空"钉成期望
（`exclusion_regions == []` / `exclusion_area_pixels == 0`），等于门禁在保护 bug。
那一处已在本单（2026-11-10）改为"与载荷一致"，见该文件 docstring 的「判据方向的更正」。
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

ROI_XLIM = [315, 1946]
ROI_YLIM = [511, 1311]

EXCLUSION = {
    "kind": "rect",
    "points": [[120, 620], [420, 620], [420, 700], [120, 700]],
}
STROKES = [
    {"mode": "erase", "radius": 6, "points": [[200, 640], [230, 660]]},
    {"mode": "restore", "radius": 4, "points": [[300, 700], [330, 720]]},
]
STAT_KEYS = ("exclusion_area_pixels", "exclusion_pixels", "manual_erase_pixels", "manual_restore_pixels")


def _rpc(dispatcher, method: str, **params) -> dict:
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _ok(response: dict, what: str) -> dict:
    assert "error" not in response, f"{what} 失败：{response.get('error')}"
    return response["result"]


def _read_members(path: Path) -> dict[str, bytes]:
    members: dict[str, bytes] = {}
    with tarfile.open(path, "r") as tf:
        for member in tf.getmembers():
            if not member.isfile():
                continue
            stream = tf.extractfile(member)
            if stream is not None:
                members[member.name] = stream.read()
    return members


def _rewrite_payload(path: Path, mutate) -> Path:
    """改写包里的 `straditize.json`（模拟"这两个键出现之前的旧包"）。"""
    members = _read_members(path)
    payload = json.loads(members["straditize.json"])
    mutate(payload)
    out = path.parent / f"{path.stem}-old.tar"
    with tarfile.open(out, "w") as tf:
        for name, data in members.items():
            if name == "straditize.json":
                data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return out


def _session_with_cleanup() -> tuple[StraditizeSession, object]:
    """1 条已确认几何 + 1 个排除区 + 2 条笔迹（都走真实写入入口）。"""
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns(data_xlim=list(ROI_XLIM), data_ylim=list(ROI_YLIM))
    dispatcher = create_rpc_dispatcher(session)
    roi_id = session.rois[0]["id"]

    _ok(
        _rpc(
            dispatcher,
            "algorithm.upsertLineGeometry",
            axis="h",
            geometry={"x0": 400, "y0": 600, "x1": 1900, "y1": 604},
            selected=True,
        ),
        "落一条已确认几何",
    )
    _ok(
        _rpc(
            dispatcher,
            "algorithm.applyLineRemoval",
            roi_id=roi_id,
            strokes=[dict(s) for s in STROKES],
            exclusion_regions=[{**EXCLUSION, "roi_id": roi_id}],
        ),
        "写排除区与笔迹",
    )
    assert session.exclusion_regions, "前置：排除区必须已写入会话"
    assert len(session.line_strokes) == len(STROKES), "前置：笔迹必须已写入会话"
    return session, dispatcher


def _recompose_stats(session: StraditizeSession, dispatcher) -> dict:
    """用当前输入重算掩膜（`applyLineRemoval` 全 None = 只重算不改输入）。"""
    result = _ok(_rpc(dispatcher, "algorithm.applyLineRemoval"), "重算清理掩膜")
    return result["stats"]


def _save(dispatcher, path: Path) -> None:
    _ok(_rpc(dispatcher, "project.save", output_path=str(path)), "保存工程包")


def _load(dispatcher, path: Path) -> None:
    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(path)), "载入工程包")


# ---------------------------------------------------------------------------


def test_exclusion_regions_and_strokes_survive_roundtrip(tmp_path: Path) -> None:
    """载荷逐项相等 + 重算面积逐值相等（承重）。"""
    session, dispatcher = _session_with_cleanup()
    before_regions = [dict(e) for e in session.exclusion_regions]
    before_strokes = [dict(s) for s in session.line_strokes]
    before_stats = _recompose_stats(session, dispatcher)

    pack = tmp_path / "cleanup.tar"
    _save(dispatcher, pack)
    _load(dispatcher, pack)

    assert session.exclusion_regions == before_regions, (
        "重开后排除区必须逐项相等；变少/变空 = 用户手工划的劳动丢了"
        f"（保存前 {len(before_regions)} 项，重开后 {len(session.exclusion_regions)} 项）"
    )
    assert session.line_strokes == before_strokes, (
        "重开后笔迹必须逐项相等；变了 = 掩膜形状变了"
        f"（保存前 {len(before_strokes)} 条，重开后 {len(session.line_strokes)} 条）"
    )

    after_stats = _recompose_stats(session, dispatcher)
    for key in STAT_KEYS:
        assert after_stats[key] == before_stats[key], (
            f"重算后的 {key} 必须与保存前逐值相等（不是「非零」就够）："
            f"保存前 {before_stats[key]}，重开后 {after_stats[key]}"
        )
    assert before_stats["exclusion_area_pixels"] > 0, "前置：夹具必须真的产生排除面积"
    assert before_stats["manual_erase_pixels"] > 0, "前置：夹具必须真的产生擦除笔迹"


def test_payload_carries_both_keys(tmp_path: Path) -> None:
    """包本身必须带这两个顶层键（否则下游无从恢复）。"""
    session, dispatcher = _session_with_cleanup()
    pack = tmp_path / "cleanup_keys.tar"
    _save(dispatcher, pack)

    payload = json.loads(_read_members(pack)["straditize.json"])
    assert payload.get("exclusion_regions") == session.exclusion_regions, (
        f"包内 exclusion_regions 必须与活状态相等，实际 {payload.get('exclusion_regions')!r}"
    )
    assert payload.get("line_strokes") == session.line_strokes, (
        f"包内 line_strokes 必须与活状态相等，实际 {payload.get('line_strokes')!r}"
    )


def test_old_package_without_cleanup_keys_stays_empty(tmp_path: Path) -> None:
    """老包无这两个键 ⇒ 两者为空、面积为 0（向后兼容，且不继承上一份工程）。"""
    session, dispatcher = _session_with_cleanup()
    pack_a = tmp_path / "with_cleanup.tar"
    _save(dispatcher, pack_a)
    pack_b = _rewrite_payload(
        pack_a,
        lambda p: (p.pop("exclusion_regions", None), p.pop("line_strokes", None)),
    )

    _load(dispatcher, pack_a)
    assert session.exclusion_regions, "前置：A 包必须带排除区"

    _ok(_rpc(dispatcher, "project.new"), "清空项目（不复位，验证不串值）")
    _ok(_rpc(dispatcher, "project.load", project_data=str(pack_b)), "载入无清理劳动的老包")

    assert session.exclusion_regions == [], (
        f"老包没有排除区，载入后必须为空，实际 {session.exclusion_regions!r}"
    )
    assert session.line_strokes == [], (
        f"老包没有笔迹，载入后必须为空，实际 {session.line_strokes!r}"
    )
    stats = _recompose_stats(session, dispatcher)
    assert stats["exclusion_area_pixels"] == 0
    assert stats["manual_erase_pixels"] == 0
    assert stats["manual_restore_pixels"] == 0
