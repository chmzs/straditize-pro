# -*- coding: utf-8 -*-
"""去线强度跨版本兼容：非法值必须在边界被丢掉，而不是带进运行时炸取数。

## 缺陷本体（2026-11-06 实测）

历史工程包把 `line_removal.strength` 存成**数字**（如 `0.6`）。`project_load` 原样写进
`session.degrid_strength`（而该字段注解是 `str | None`），于是任何走取数的路径都会调到
`algorithm_degrid` → `image.normalize_grid_line_strength` → **ValueError**。
更糟的是 `project_save` 的保底逻辑把这条错误吞成一份「每格 0.00」的占位 CSV：
用户以为「我没数字化」，实际是去线强度不合法。

## 修法（两层，各有各的理由）

1. **载入边界**：合法预设 → 规范化；其余 → `None` + `logger.warning`。
   不抛错是因为老包必须能载入（与版本门禁同一取舍）；丢弃是因为无法可靠推断
   `0.6` 对应 weak/medium/strong 中的哪一个，猜一个比不设更危险。
2. **运行时入口**：`_extraction_mask` 再挡一次（只认预设名），保证任何入口
   （工程包、手改 JSON、WebMCP 直通）都炸不到取数。

## 反向验证

把载入侧的 `_validated_degrid_strength` 换回 `line_removal.get("strength")`，
`test_legacy_numeric_strength_is_dropped_with_warning` 与
`test_export_stops_falling_back_to_placeholder` 都会变红。
"""

from __future__ import annotations

import base64
import io
import logging
import tarfile

import pytest

from straditize_core.session import StraditizeSession

from test_project_load_golden import _legacy_payload

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _payload(strength):
    payload = _legacy_payload()
    if strength is None:
        payload.pop("line_removal", None)
    else:
        payload["line_removal"] = {"strength": strength, "remove_vertical": True}
    return payload


def _loaded(strength=None) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.project_load(_payload(strength))
    return session


def test_legacy_numeric_strength_is_dropped_with_warning(caplog) -> None:
    with caplog.at_level(logging.WARNING, logger="straditize_rpc"):
        session = _loaded(0.6)

    assert session.degrid_strength is None, (
        "数字强度被原样带进了运行时——它会一路走到 normalize_grid_line_strength 抛错"
    )
    messages = [record.getMessage() for record in caplog.records]
    assert any("0.6" in message for message in messages), (
        f"丢弃必须留痕，否则用户无从知道自己的去线设置没了：{messages}"
    )


@pytest.mark.parametrize("raw", ["Strong", " weak ", "medium"])
def test_supported_preset_is_kept_and_canonicalised(raw: str) -> None:
    assert _loaded(raw).degrid_strength == raw.strip().lower()


def test_missing_strength_is_silent(caplog) -> None:
    with caplog.at_level(logging.WARNING, logger="straditize_rpc"):
        session = _loaded(None)
    assert session.degrid_strength is None
    assert not [r for r in caplog.records if "line_removal.strength" in r.getMessage()]


def _plate_session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    return session


def test_runtime_guard_skips_unsupported_strength() -> None:
    session = _plate_session()
    session.degrid_strength = 0.6  # 模拟从别的入口塞进来的非法值

    mask = session._extraction_mask()

    assert mask is not None, "非法强度不该让取墨直接失败"
    assert session.grid_line_mask is None, "不该在强度非法时真的去跑一次去线"


def test_export_stops_falling_back_to_placeholder() -> None:
    session = _plate_session()
    session.degrid_strength = 0.6

    result = session.project_save(format="tar")

    assert result["data_csv_placeholder"] is False, (
        f"仍然退化成占位表，原因：{result.get('data_csv_placeholder_reason')}"
    )
    raw = base64.b64decode(result["tar_base64"])
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        names = archive.getnames()
        csv_text = archive.extractfile("data.csv").read().decode("utf-8")
    assert "data.csv.PLACEHOLDER.md" not in names
    assert csv_text.splitlines()[0].startswith("depth,")
    assert "0.00" not in csv_text.splitlines()[1], "对照：真实取数那行不该是占位表"
