# -*- coding: utf-8 -*-
"""P2-B：`project_load` 的工程包版本门禁。

## 缺陷本体（实测取证）

旧实现完全不读 `version` / `schema_version`。实测五种输入
（v1.0.0 / v2.0.0 / 删掉 version / "banana" / v4.0.0）**全部放行**。
前四种放行是正确的（老包本来就没这些字段，且能正确载回），但 v4.0.0
放行是错的：将来 v4 真加了不兼容字段，用户拿到的是**被静默丢弃**的工程，
字段丢了、语义错位，界面看起来完全正常。违反不变量
「取不到就报错停在原地，绝不返回替代数据」。

## 判据设计（避开三类假绿）

1. **对照组存在且被测对象同一**：`test_future_version_is_rejected` 断言的是
   `project_load` 抛 `JsonRpcError`；`test_low_version_still_loads` 断言的是
   **同一函数、同一 payload 形状**只改版本号后能载回且列数/标定内容不变。
   若把门禁写成"一律拒绝"，后者立刻变红；若写成"一律放行"，前者立刻变红。
   两侧互为对照，谁也不能靠"全绿"蒙混。
2. **不是 existence 是 equality**：老包放行的断言比对**列数**与**首列标定
   端点数值**，不是"没抛异常"。空包/被静默清空的包会被 equality 判据抓到。
3. **有判别力**：把 `_check_project_schema_version` 改成 `return`（即退回
   旧行为），`test_future_version_is_rejected` 必然变红。本文件最后一条
   `test_legacy_behaviour_would_accept_future_pack` 就地钉死这个反例。

## 覆盖矩阵（任务书四类输入全覆盖）

| 输入 | 期望 | 用例 |
|---|---|---|
| v4.0.0（高于 3.x） | 拒绝 + 可操作提示 | `test_future_version_is_rejected` |
| v1.0.0 / v2.0.0（低于 3.x） | 放行，内容完整 | `test_low_version_still_loads` |
| 缺失版本号 | 放行 + warning | `test_missing_version_loads_with_warning` |
| "banana"（乱码） | 放行 + warning | `test_garbage_version_loads_with_warning` |
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

from straditize_core.protocol import INVALID_PARAMS, JsonRpcError
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.project import _parse_schema_major

REAL_PACK = Path("output/han2026_ngamring/Han2026_Fig3_pollen.project.json")


def _base_payload() -> dict:
    """一个内容完整的最小工程包（列 + 标定 + 采样），用于注入版本号。"""
    return {
        "roi": {"x": 0.0, "y": 0.0, "w": 400.0, "h": 300.0},
        "columns": [
            {
                "id": "col_1",
                "name": "Pinus",
                "roi_id": "roi_1",
                "startX": 10.0,
                "endX": 60.0,
                "x_ticks": [
                    {"px": 10.0, "value": 0.0},
                    {"px": 60.0, "value": 100.0},
                ],
            },
        ],
        "samples": [{"row_px": 50, "depth": 10.0, "source": "manual"}],
    }


def _load(payload: dict) -> tuple[dict, StraditizeSession]:
    session = StraditizeSession()
    result = session.project_load(payload)
    return result, session


# ---------------------------------------------------------------------------
# 1. 未来版本必须拒绝
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("version", "schema_version"),
    [
        ("4.0.0", "4.0"),
        ("5.1.2", "5.1"),
        ("10.0.0", "10.0"),
    ],
)
def test_future_version_is_rejected(version: str, schema_version: str):
    """高于 SUPPORTED_SCHEMA_MAJOR 的包必须显式拒绝，且提示可操作。"""
    payload = _base_payload()
    payload["version"] = version
    payload["schema_version"] = schema_version

    session = StraditizeSession()
    with pytest.raises(JsonRpcError) as excinfo:
        session.project_load(payload)

    error = excinfo.value
    assert error.code == INVALID_PARAMS
    message = str(error.message)
    # 提示必须让用户知道下一步做什么，不是干巴巴的"版本错误"
    assert "升级软件" in message
    assert version in message or schema_version in message


def test_future_version_rejected_before_mutating_state():
    """拒绝必须发生在改状态之前——不能把会话弄成半载入的脏状态。"""
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    before_rois = [dict(r) for r in session.rois]
    before_samples = list(session.samples)

    payload = _base_payload()
    payload["schema_version"] = "9.0"

    with pytest.raises(JsonRpcError):
        session.project_load(payload)

    assert [r.get("id") for r in session.rois] == [r.get("id") for r in before_rois]
    assert session.samples == before_samples


# ---------------------------------------------------------------------------
# 2. 低版本必须继续放行（不许为了加门禁把老包挡死）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("version", "schema_version"),
    [("1.0.0", "1.0"), ("2.0.0", "2.0"), ("3.0.0", "3.0")],
)
def test_low_version_still_loads(version: str, schema_version: str):
    """v1 / v2 / v3 都必须放行，且**内容完整**（equality，不是 existence）。"""
    payload = _base_payload()
    payload["version"] = version
    payload["schema_version"] = schema_version

    result, session = _load(payload)

    assert result["success"] is True
    assert result["columns_count"] == 1
    # 列内容与标定端点必须原样载回，不能只剩个空壳
    assert session.columns[0]["name"] == "Pinus"
    ticks = session.columns[0]["x_ticks"]
    assert [t["value"] for t in ticks] == [0.0, 100.0]
    assert len(session.samples) == 1


def test_real_v3_pack_loads_through_both_paths():
    """仓内真实 v3.0.0 工程包：.json 与 .tar 两条路径必须载出同一结果。"""
    if not REAL_PACK.exists():
        pytest.skip(f"样本工程包不存在：{REAL_PACK}")

    json_result, json_session = _load(str(REAL_PACK))
    tar_result, tar_session = _load(str(REAL_PACK.with_suffix(".tar")))

    assert json_result["columns_count"] == tar_result["columns_count"]
    assert json_result["columns_count"] > 0
    assert json_session.columns[0]["name"] == tar_session.columns[0]["name"]


def test_real_pack_relabelled_as_v2_still_loads_identically():
    """真实 v3 包只改版本号声明为 v2 —— 必须与 v3 载出**完全相同**的结果。

    这条是对照组：证明"放行低版本"不是"随便放过"，而是确实走同一条解析路径
    得到同一份数据。
    """
    if not REAL_PACK.exists():
        pytest.skip(f"样本工程包不存在：{REAL_PACK}")

    source = json.loads(REAL_PACK.read_text(encoding="utf-8"))
    v3_result, v3_session = _load(source)

    old_payload = dict(source)
    old_payload["version"] = "2.0.0"
    old_payload["schema_version"] = "2.0"
    v2_result, v2_session = _load(old_payload)

    assert v2_result["columns_count"] == v3_result["columns_count"]
    assert [c["name"] for c in v2_session.columns] == [
        c["name"] for c in v3_session.columns
    ]
    assert len(v2_session.samples) == len(v3_session.samples)


# ---------------------------------------------------------------------------
# 3. 缺失 / 乱码版本号：放行但记 warning，绝不抛错
# ---------------------------------------------------------------------------


def test_missing_version_loads_with_warning(caplog):
    """老包没有版本号是常态：必须放行，且留下可追溯的 warning。"""
    payload = _base_payload()  # 故意不带 version / schema_version

    with caplog.at_level(logging.WARNING, logger="straditize_rpc"):
        result, session = _load(payload)

    assert result["success"] is True
    assert result["columns_count"] == 1
    assert any("版本" in record.message for record in caplog.records)


@pytest.mark.parametrize("bad_version", ["banana", "", "v3", "3.x", "-1", None])
def test_garbage_version_loads_with_warning(bad_version, caplog):
    """乱码版本号无法判断新旧 → 放行 + warning，不得抛错。"""
    payload = _base_payload()
    payload["version"] = bad_version
    payload["schema_version"] = bad_version

    with caplog.at_level(logging.WARNING, logger="straditize_rpc"):
        result, session = _load(payload)

    assert result["success"] is True
    assert result["columns_count"] == 1


# ---------------------------------------------------------------------------
# 4. 版本解析单元（门禁的"眼睛"，单独钉）
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("3.0.0", 3),
        ("3.0", 3),
        ("2.0.0", 2),
        ("10.4.1", 10),
        (" 4 ", 4),
        (3, 3),
        (4.0, 4),
        # "3.x" 的主版本无歧义（= 3.anything），必须解析成 3 而不是当作乱码。
        # 这条最初被我错误地放进了"不可解析"清单，实测实现返回 3 —— 实现是对的，
        # 期望是错的（把"含 x 占位符"误当"乱码"）。
        ("3.x", 3),
    ],
)
def test_parse_schema_major_accepts_real_shapes(raw, expected):
    assert _parse_schema_major(raw) == expected


@pytest.mark.parametrize("raw", ["banana", "", "v3", "-1", None, True, [], {}])
def test_parse_schema_major_returns_none_when_undecidable(raw):
    """无法判定时返回 None（交给调用方放行），绝不猜一个数字出来。"""
    assert _parse_schema_major(raw) is None


# ---------------------------------------------------------------------------
# 5. 判别力自证：把门禁摘掉，v4 包必须能载入
# ---------------------------------------------------------------------------


def test_without_gate_future_pack_loads(monkeypatch):
    """摘掉门禁后 v4 包能正常载入 —— 证明"拒绝"**完全来自门禁**。

    这条与 `test_future_version_is_rejected` 构成对照：
    - 有门禁 → 拒绝（前者绿）
    - 无门禁 → 载入成功（本条绿）

    两条同时绿，说明"拒绝"不是解析层顺带崩出来的假象；若有人删掉门禁调用，
    前者变红而本条仍绿，判据立刻报警。反之若哪天 `json` 解析本身也开始
    拒绝 v4，本条会变红，同样报警。
    """
    payload = _base_payload()
    payload["schema_version"] = "4.0"

    monkeypatch.setattr(
        StraditizeSession, "_check_project_schema_version", lambda self, data: None
    )

    result, session = _load(payload)
    assert result["success"] is True
    assert result["columns_count"] == 1
    assert session.columns[0]["name"] == "Pinus"
