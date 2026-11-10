# -*- coding: utf-8 -*-
"""`project.load` 之后清理掩膜必须还能重算（用户每次打开工程包都会看到的报错）。

## 缺陷本体（实测复现，不是推断）

用户在「双击打开软件 → 打开工程包」这条路径上收到：

    载入项目后重算清理掩膜失败 —— 'StraditizeSession' object has no attribute
    'exclusion_regions'

真实调用链（`.scratch/probe_uload.py` 逐行跑出来的，非静态推断）：

1. `StraditizeSession.__init__` **不**初始化清理状态：全新会话上
   `hasattr(line_candidates) / (exclusion_regions) / (line_strokes)` 全为 `False`
   （`CleanupMixin._init_cleanup()` 只在 `detect_line_candidates` /
   `upsert_line_geometry` / `apply_line_removal` 的入口兜底里被调）。
2. `project_load` 全程**不调** `_init_cleanup`：
   `_reset_loaded_state`（project.py:454）只清掩膜与 `cleanup_stats`，
   `_reset_line_removal`（project.py:486）只写 `degrid_*` 与 `line_corrections`，
   **`line_candidates` / `exclusion_regions` / `line_strokes` 一个都没初始化**。
3. 唯一的例外是 `_restore_aux_fields`（project.py:734）：
   `if project_data.get("line_candidates") is not None: self.line_candidates = list(...)`。
   所以载入**之后** `line_candidates` 存在、`exclusion_regions` 与 `line_strokes` 不存在。
4. 前端在 `openProjectFile` 之后调 `algorithm.applyLineRemoval` 重算掩膜，
   实参形状是 `{strokes: [], exclusion_regions: []}`。它入口处的兜底
   （cleanup.py:641）判的是 `line_candidates`——而这一项**恰好已被 payload 建好**，
   兜底因此不触发；下一行 cleanup.py:652
   `others = [e for e in self.exclusion_regions ...]` 直接 AttributeError。
   （即使调用方省略 `exclusion_regions`，`_recompose` 也会在 cleanup.py:363
   的 `_exclusion_mask` 里以同一个异常失败——两条形状都炸。）

**为什么 `project_new` 没事**：它在 project.py:234-237 手写了这四项
（`line_candidates` / `exclusion_regions` / `line_strokes` / `selected_candidate_ids`），
不是调 `_init_cleanup`。所以问题不是"project_load 少调了一个函数"这么简单，
而是"清理状态的初始化有两处手写、一处缺失"。

**为什么 `corrections` 为空也照样走到这里**：`_recompose` 根本不看 corrections——
它无条件重建 geometry / exclusion / brush 三张掩膜，只要被调用就会读 `exclusion_regions`。

## 判据（读后端权威字段，不断言日志文案）

1. `project.load` 与随后的 `algorithm.applyLineRemoval` 经**真 dispatcher** 调用后
   响应里**没有 `error` 键**（dispatcher 把异常映射成 error 对象，所以这条同时覆盖
   "不抛错"与"不产生错误遥测"）；
2. 载入后的会话上 `exclusion_regions` / `line_strokes` 真的存在且是空列表
   （是"初始化过"，不是"恰好有个别的属性"）；
3. payload 里的清理几何**没有被丢掉**：`line_candidates` 仍是那一条、status 仍是 `removed`；
4. 重算出来的 `stats` 是**真算的数字**：`geometries_count == 1`、`removed_count == 1`、
   `exclusion_area_pixels == 0`，且每个统计量都是 `int`（不是 None / 不是占位）。

## 判据方向的更正（2026-11-10，P0-B）

本文件最初有两条断言是**反向的**，把"丢失"钉成了期望：

- `assert session.exclusion_regions == []`（"载入后必须被初始化为空列表"）
- `assert stats["exclusion_area_pixels"] == 0`（"排除区是空的，面积必须为 0"）

这两条在 `project_save` 开始持久化排除区与笔迹（P0-B，同一日期）之后会反过来
判红——也就是说，它们在保护 bug。现已改为**与载荷一致**的方向：

- `session.exclusion_regions == _payload_cleanup_list(pack, "exclusion_regions")`
- `(stats["exclusion_area_pixels"] > 0) == bool(payload_regions)`

本夹具的包里没有这两项，所以期望值仍是空/0，但**理由从"必须是空"变成"必须等于载荷"**。
逐项往返相等与面积逐值相等的承重判据在
`tests/unit/test_project_cleanup_persistence.py`。

## 反向验证（金丝雀）

把 `project_load` 里那行 `self._init_cleanup()` 注掉，本文件必须红——
实测红在第 1 条断言（响应里出现 `error: AttributeError ... exclusion_regions`）。
"""

from __future__ import annotations

import json
import logging
import tarfile
from pathlib import Path

import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

# 清理几何落在图幅中段的一条横带：只要这一带真有墨迹，
# `geometry_removed_pixels` 就该被真正算出来（见下方对统计量的断言）。
RECT = {"x0": 400, "y0": 600, "x1": 1900, "y1": 604}


def _payload_cleanup_list(pack: Path, key: str) -> list:
    """包里**真正携带**的清理劳动（`exclusion_regions` / `line_strokes`）。

    判据要写成"载入后等于包里的值"，基准就必须取自包本身——拿会话当前值当基准
    等于自证。老包没有这两个键时返回 `[]`（= 载入后应为空）。
    """
    with tarfile.open(pack, "r") as tf:
        member = next(m for m in tf.getmembers() if m.name.endswith("straditize.json"))
        stream = tf.extractfile(member)
        assert stream is not None, "工程包里必须有 straditize.json"
        payload = json.loads(stream.read().decode("utf-8"))
    value = payload.get(key)
    return [dict(v) for v in value] if isinstance(value, list) else []


def _rpc(dispatcher, method: str, **params) -> dict:
    """走真 dispatcher（异常 → error 对象这件事只在这里发生）。"""
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


@pytest.fixture()
def project_pack(tmp_path: Path) -> Path:
    """造一个**带清理几何**的工程包：载图 → 落一条已确认几何 → 存 .tar。

    用 `sample_key="hoya"` 而不是外部图片路径：受版本控制、跨机器稳定，
    且 `load_image` 会顺带把 `_init_cleanup` 该有的东西建出来（这一侧本来就正常）。
    """
    source = StraditizeSession()
    source.load_image(sample_key="hoya")
    source.upsert_line_geometry(axis="h", geometry=dict(RECT), selected=True)
    assert len(source.line_candidates) == 1, "前置：源会话必须真的有一条清理几何"

    pack = tmp_path / "project_with_cleanup.tar"
    source.project_save(str(pack))
    assert pack.exists() and pack.stat().st_size > 0, "前置：工程包必须真的落盘"
    return pack


def _fresh_session_with_dispatcher():
    """**全新会话**——用户双击打开软件后立刻开工程包，正是这个起点。

    刻意不调 `_init_cleanup()` / `load_image()`：一旦预先调了，缺陷就被掩盖，
    这正是历史实现"看起来没问题"的原因（测试都从已载图的会话出发）。
    """
    session = StraditizeSession()
    for attr in ("line_candidates", "exclusion_regions", "line_strokes"):
        assert not hasattr(session, attr), (
            f"前置：全新会话不该已有 {attr}；若将来构造函数真的初始化了清理状态，"
            "本用例的起点就不再等价于用户路径，需要重新设计（见模块 docstring）"
        )
    return session, create_rpc_dispatcher(session)


def test_loaded_project_can_recompute_cleanup_mask(project_pack: Path, caplog) -> None:
    """载入带清理几何的工程包后，重算清理掩膜必须成功且给出真实统计量。"""
    session, dispatcher = _fresh_session_with_dispatcher()

    with caplog.at_level(logging.ERROR):
        loaded = _rpc(dispatcher, "project.load", project_data=str(project_pack))
        assert "error" not in loaded, f"project.load 不应该失败：{loaded.get('error')}"

        # 初始化判据：是"真的初始化过"，不是"恰好有个别的属性顶替"。
        #
        # ⚠️ 方向改正（2026-11-10，P0-B）：这两条原本写的是 `== []`，也就是
        # "载入后排除区与笔迹必须是空的"。那等于**把丢失钉成了期望** —— 门禁在
        # 保护 bug：将来真把这两个字段存进包，反而会被这两条判红。正确判据是
        # "载入后与**包里**的值相等"（本夹具的包里没有这两项，所以期望仍是空，
        # 但理由从"必须是空"变成"必须等于载荷"）。
        payload_regions = _payload_cleanup_list(project_pack, "exclusion_regions")
        payload_strokes = _payload_cleanup_list(project_pack, "line_strokes")
        assert session.exclusion_regions == payload_regions, (
            "载入后 exclusion_regions 必须等于包里的值"
            f"（包内 {len(payload_regions)} 项），实际 {session.exclusion_regions!r}"
        )
        assert session.line_strokes == payload_strokes, (
            "载入后 line_strokes 必须等于包里的值"
            f"（包内 {len(payload_strokes)} 项），实际 {session.line_strokes!r}"
        )

        # 载荷里的清理几何不能被初始化顺手抹掉。
        assert len(session.line_candidates) == 1, (
            "载入的清理几何必须保留（初始化清理状态不等于丢弃 payload），"
            f"实际 {session.line_candidates!r}"
        )
        assert session.line_candidates[0]["status"] == "removed", (
            "载入的清理几何 status 必须保持 removed，实际 "
            f"{session.line_candidates[0].get('status')!r}"
        )

        # 前端在 openProjectFile 之后真正发的那一个调用，实参形状照抄。
        recomputed = _rpc(
            dispatcher,
            "algorithm.applyLineRemoval",
            strokes=[],
            exclusion_regions=[],
        )

    assert "error" not in recomputed, (
        "载入项目后重算清理掩膜必须成功——这正是用户看到的报错来源："
        f"{recomputed.get('error')}"
    )

    stats = recomputed["result"]["stats"]
    assert stats["geometries_count"] == 1, (
        f"重算必须把载入的那一条几何算进去，实际 geometries_count={stats['geometries_count']}"
    )
    assert stats["removed_count"] == 1, (
        f"载入的几何 status=removed，重算的 removed_count 必须是 1，"
        f"实际 {stats['removed_count']}"
    )
    # ⚠️ 方向改正（2026-11-10，P0-B）：原来写的是 `== 0`，理由"排除区是空的"。
    # 一旦包里带了排除区，这条会反过来判红。改成**与载荷一致**的方向性判据：
    # 包里有 N 项 ⇔ 重算出的排除面积 > 0。
    assert (stats["exclusion_area_pixels"] > 0) == bool(payload_regions), (
        "排除面积必须与包里的排除区一致："
        f"包内 {len(payload_regions)} 项，exclusion_area_pixels={stats['exclusion_area_pixels']}"
        "（包里有排除区却不产生面积 = 载入时丢了；包里没有却产生面积 = 无中生有）"
    )
    # 逐项必须是 int：None / 缺键会让前端读到 undefined 而静默显示 0。
    for key in (
        "geometry_removed_pixels",
        "exclusion_pixels",
        "exclusion_area_pixels",
        "final_removed_pixels",
        "manual_erase_pixels",
        "manual_restore_pixels",
    ):
        assert isinstance(stats[key], int), (
            f"统计量 {key} 必须是 int，实际 {stats[key]!r}"
        )

    # 真值层：那一条横带跨过图幅中段，确实该剔掉像素。
    # 若这里为 0，说明几何没有真正参与掩膜（那是另一个缺陷，不该被本条绿灯掩盖）。
    assert stats["geometry_removed_pixels"] > 0, (
        "载入的那条几何覆盖图幅中段的一条横带，重算后 geometry_removed_pixels 必须 > 0；"
        f"为 0 说明几何没有真正参与掩膜，实际 stats={stats}"
    )

    assert not [r for r in caplog.records if r.levelno >= logging.ERROR], (
        "正常载入不该产生 ERROR 级日志："
        + "; ".join(
            r.getMessage() for r in caplog.records if r.levelno >= logging.ERROR
        )
    )


def test_loaded_project_recompute_works_without_exclusion_argument(
    project_pack: Path,
) -> None:
    """调用方**省略** `exclusion_regions` 时也必须能重算。

    这是同一个根因的第二条形状：省略实参不会走 cleanup.py:652，
    但 `_recompose` 会在 `_exclusion_mask`（cleanup.py:363）里以同一个
    AttributeError 失败。两条都钉住，避免"只修好其中一条调用形状"。
    """
    session, dispatcher = _fresh_session_with_dispatcher()

    loaded = _rpc(dispatcher, "project.load", project_data=str(project_pack))
    assert "error" not in loaded, f"project.load 不应该失败：{loaded.get('error')}"

    recomputed = _rpc(dispatcher, "algorithm.applyLineRemoval", strokes=[])
    assert "error" not in recomputed, (
        f"省略 exclusion_regions 时重算同样必须成功：{recomputed.get('error')}"
    )
    assert recomputed["result"]["stats"]["geometries_count"] == 1
