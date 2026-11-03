# -*- coding: utf-8 -*-
"""0 点可测性标记：无竖轴的列必须显式标出，不能静默按"轴线粗 = 0"处理。

## 这条守的是什么

`0 点 = 左缘 + 轴线粗` 成立的前提是"左缘处确实有一条贯穿列高的竖轴"。
没有竖轴的列（无轴列 / 假列 / 只有曲线本身）无法测出 0 点。若静默按
"轴线粗 = 0"，整列读数会系统偏 1–5px，而用户看不出来 —— 这正是
ARCHITECTURE §2「取不到就报错，绝不给替代数据」要禁止的那类失效。

## 判据必须用**自适应 mask**，不是硬阈值

实测教训：用 `gray < 128` 判 diatom 的竖轴时，25 列**全部**被判"无轴"——
因为它的轴是浅灰 (224,224,224)，正是 D-09 记的那个坑。换成
`foreground_mask`（分列用的同一个自适应 mask）后 25/25 全部可测。
所以本文件同时钉住"判据与分列同源"这一点。
"""
from __future__ import annotations

from pathlib import Path

from straditize_core.session import StraditizeSession

FIGURES = Path(__file__).resolve().parent.parent / "data/figures/benchmark_types"
DIATOM = FIGURES / "Diatom_riojaPlotTestData.png"


def _flags(name: str | None = None, path: Path | None = None) -> list[bool]:
    session = StraditizeSession()
    if path is not None:
        session.load_image(image_path=str(path))
    else:
        session.load_image(sample_key=name)  # type: ignore[arg-type]
    return [bool(c.get("zero_point_measurable")) for c in session.detect_columns()]


def test_diatom_all_columns_have_measurable_axis() -> None:
    """diatom 的 25 列**每列都有竖轴**（浅灰，但存在）。

    这是"判据必须用自适应 mask"的钉子：用硬阈值会把它们全判成无轴。
    """
    flags = _flags(path=DIATOM)
    assert len(flags) == 25
    assert all(flags), f"diatom 应有 25/25 可测，实际 {sum(flags)}/25 —— 判据退回硬阈值了吗？"


def test_beginner_all_columns_have_measurable_axis() -> None:
    """beginner 的 4 个面板都有左边框。"""
    flags = _flags("beginner")
    assert len(flags) == 4
    assert all(flags), f"beginner 应 4/4 可测，实际 {sum(flags)}/4"


def test_hoya_flags_some_columns_as_unmeasurable() -> None:
    """hoya 的多数"列"其实是曲线自身，没有贯穿竖轴 —— 必须被标出来。

    判据是结构性的（覆盖率 1.0 vs 0.55–0.81），不是调阈值：
    col0 覆盖率 1.00（满轴）、col4 仅 0.81、col6 仅 0.55（都是曲线）。
    """
    flags = _flags("hoya")
    assert len(flags) == 29
    assert not all(flags), "hoya 应有不可测列 —— 若全为 True，判据被放宽到会静默错数"
    assert any(flags), "hoya 也应有可测列 —— 若全为 False，判据过严"
    assert flags[0] is True, "col0 覆盖率 1.0，必须判为可测"
