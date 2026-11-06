# -*- coding: utf-8 -*-
"""去线强度是**枚举**：{weak, medium, strong} ∪ {None}，三个边界都要守住。

## 缺陷本体（2026-11-06 实测）

`session.degrid_strength` 的注解是 `str | None`，但工程包是用户可手改的文本、
会话状态也可能被别的入口写入。非法值（如 `0.6`）一旦进来，任何走取数的路径都会调到
`algorithm_degrid` → `image.normalize_grid_line_strength` → **ValueError**；
更糟的是 `project_save` 的保底逻辑把这条错误吞成一份「每格 0.00」的占位 CSV：
用户以为「我没数字化」，实际是去线强度不合法。

## 设计：一个合法域，三个边界

| 边界 | 行为 |
| --- | --- |
| 写入（`_build_project_json`） | 非法 → 写 `null`（绝不把非法值写回文件） |
| 读取（`project_load`） | 非法 → `null` + `logger.warning` |
| 运行时（`_extraction_mask`） | 非法 → 跳过去线，不炸取数 |

不做「数字 → 预设」映射：`0.6` 究竟算 weak 还是 medium 没有任何可靠依据，猜一个比不设更危险。
也不对非法值抛错：它是外观设置，不该把整份工程挡在门外——与 `_parse_schema_major`
对乱码版本号的取舍同源。

## 反向验证（三处都做过）

- 拿掉读取侧校验 → `test_load_drops_invalid_strength_with_warning` 与大小写规范化两条红；
- 拿掉写入侧校验 → `test_save_never_writes_invalid_strength` 红（0.6 会被写回文件）；
- 拿掉运行时守卫 → `test_runtime_guard_skips_invalid_strength` 与端到端导出那条红。
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
WARNING_KEY = "去线强度"


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


@pytest.mark.parametrize("bad", [0.6, 1, "banana", True])
def test_load_drops_invalid_strength_with_warning(caplog, bad) -> None:
    with caplog.at_level(logging.WARNING, logger="straditize_rpc"):
        session = _loaded(bad)

    assert session.degrid_strength is None, (
        "非法强度被带进了运行时——它会一路走到 normalize_grid_line_strength 抛错"
    )
    messages = [record.getMessage() for record in caplog.records]
    assert any(WARNING_KEY in message and repr(bad) in message for message in messages), (
        f"丢弃必须留痕（写清丢的是什么），否则用户无从知道自己的去线设置没了：{messages}"
    )


@pytest.mark.parametrize("raw", ["Strong", " weak ", "medium"])
def test_load_keeps_preset_and_canonicalises(raw: str) -> None:
    assert _loaded(raw).degrid_strength == raw.strip().lower()


def test_load_missing_is_silent(caplog) -> None:
    with caplog.at_level(logging.WARNING, logger="straditize_rpc"):
        session = _loaded(None)
    assert session.degrid_strength is None
    assert not [r for r in caplog.records if WARNING_KEY in r.getMessage()]


def test_save_never_writes_invalid_strength() -> None:
    session = _loaded(None)
    session.degrid_strength = 0.6

    payload = session.project_save(format="json")["data"]

    assert payload["line_removal"]["strength"] is None, (
        "非法强度被写回了工程包——下一份文件又把问题带回来"
    )


def test_save_writes_canonical_preset() -> None:
    session = _loaded(None)
    session.degrid_strength = "Strong"

    payload = session.project_save(format="json")["data"]

    assert payload["line_removal"]["strength"] == "strong"


def _plate_session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    return session


def test_runtime_guard_skips_invalid_strength() -> None:
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
