# -*- coding: utf-8 -*-
"""刻度尺测量必须尊重 ROI 的 y 范围 —— 真图回归钉子。

## 缺陷本体

`measure_ruler_geometry()` 对「ROI 之外还有全宽暗行」的图版永远检出 0 个刻度齿。

内置样本 `hoya-del-castillo.png`：28 列全都有齿（col02 21 个 @10px、
col01/col28 各 7 个 @26px），但实测 `>=2齿的列 = 0`、`median_spacing_px = None`。

链路：
1. `find_axis_row` 在底部 30% 内取覆盖率达标行的**最下面一行** → 取到 y=1375，
   那是**整幅图的外框下边**，而 ROI 的 y1 只有 1311；
2. 齿搜索带随之变成 1376..1383（纯白）→ 0 齿；
3. `_find_axis_x` 从 1375 反推采样区间（top=206, bottom=1371），图上没有任何 x
   能在 85% 的行上保持暗 → `axis_x = None`。

`beginner-tutorial.png` 能用纯属巧合：它的下轴恰好是底部 30% 内最靠下的全宽暗行。

## 判据

* hoya：`median_spacing_px == 11.0`，`>=2 齿的列 == 28`（28 列全命中）；
* beginner：`median_spacing_px == 124.5`，`>=2 齿的列 == 4`（零回归钉子）。

hoya 的 `all_regular` **必须为 False**：各列满量程不同、刻距 10 与 26 并存 ——
这是该图的真实属性，不是缺陷，故**不**断言它为 True。
"""

from __future__ import annotations

import pytest

from straditize_core.session import StraditizeSession

#: hoya-del-castillo.png 的取数区（图版数据区，**不含**整幅外框下边 y=1375）。
HOYA_X, HOYA_Y = [315, 1946], [511, 1311]


def _hoya_session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    roi_id = session.rois[0]["id"]
    session.detect_columns(HOYA_X, HOYA_Y, roi_id=roi_id)
    return session


def _beginner_session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="beginner")
    roi_id = session.rois[0]["id"]
    session.detect_columns(roi_id=roi_id)
    return session


def _usable(per_column: list[dict]) -> list[dict]:
    return [c for c in per_column if len(c["ticks"]) >= 2]


class TestHoyaWithFullWidthDarkRowsBelowRoi:
    """hoya：ROI 的 y1=1311 之外还有全宽暗行（外框下边 1375），不得被当成轴线。"""

    def test_every_column_has_ticks(self) -> None:
        result = _hoya_session().measure_ruler_geometry()
        usable = _usable(result["per_column"])

        assert len(usable) == 28, (
            f">=2 齿的列只有 {len(usable)}/28 —— 轴线被外框下边（y=1375）抢走，"
            f"齿搜索带落进纯白区。实测 axis_row = "
            f"{sorted({c['axis_row'] for c in result['per_column']})}，"
            f"ROI 的 y1 = {HOYA_Y[1]}"
        )

    def test_median_spacing_is_11px(self) -> None:
        result = _hoya_session().measure_ruler_geometry()

        assert result["median_spacing_px"] == pytest.approx(11.0, abs=0.01), (
            f"中位刻距 {result['median_spacing_px']!r} != 11.0 —— "
            "真值：col02 刻距 10px（21 齿），col01/col28 刻距 26px（7 齿），中位 11.0"
        )

    def test_column_spacings_match_truth(self) -> None:
        """逐列钉住两个满量程档（10px 与 26px），防止"有齿但齿不对"。"""
        result = _hoya_session().measure_ruler_geometry()
        by_name = {c["name"]: c for c in result["per_column"]}

        assert len(by_name["col01"]["ticks"]) == 7
        assert by_name["col01"]["spacing_px"] == pytest.approx(26.0, abs=0.01)
        assert len(by_name["col02"]["ticks"]) == 21
        assert by_name["col02"]["spacing_px"] == pytest.approx(10.0, abs=0.01)
        assert len(by_name["col28"]["ticks"]) == 7
        assert by_name["col28"]["spacing_px"] == pytest.approx(26.0, abs=0.01)

    def test_axis_x_not_lost(self) -> None:
        """`_find_axis_x` 的采样区间也必须夹到 ROI 顶部。

        只夹 `find_axis_row` 时 axis_row 已经对（1306/1307），但采样区间仍从
        y=206 起跨到图框，85% 判据必然落空 → `axis_x` 全为 None。
        col02 的列左缘 497 就是它的轴线（0 点画在 axis 上）。
        """
        result = _hoya_session().measure_ruler_geometry()
        by_name = {c["name"]: c for c in result["per_column"]}

        assert by_name["col02"]["axis_x"] == pytest.approx(497.0, abs=0.01), (
            f"col02 的 axis_x = {by_name['col02']['axis_x']!r}，应为列左缘 497"
        )


class TestHoyaNarrowColumnsAreDashed:
    """hoya 的 15 个窄列：轴线是点划线，`axis_x` 不得丢。

    ## 缺陷本体

    `_find_axis_x` 的判据是「贯穿 ≥ `min_frac`(0.85) 采样行」。hoya 上 15 个窄列
    的竖轴是 **4px 实 / 4px 虚**的点划线（col09 x=1097 贯穿率 0.44、col05 x=939
    为 0.81），永远达不到 0.85，于是 `axis_x = None`。

    ## 已经排除的两个替罪羊

    * **不是阈值**：该图只有 11 个灰度级、柱内像素非 0 即 255，阈值 170/190/210
      三档、采样 132/264 行四组组合下通过列数恒为 13/28，恢复 0 列；
    * **不是步骤 4 的清理**：`measure_ruler_geometry` 的灰度来自 `self.image`
      （原图），而清理只写旁路 mask（`cleanup.py`），全新会话未做任何清理时实测
      就是 13/28。

    ## 判据

    15 个窄列的 `axis_x` 必须等于各自的列左缘（`start`）—— 与已经命中的 13 列
    同理：面积图的 0 点画在轴线/列边界上。
    """

    #: 修前 `axis_x is None` 的列（实测），其值必须等于列左缘。
    NARROW = {
        "col05": 939.0,
        "col06": 971.0,
        "col07": 1001.0,
        "col09": 1065.0,
        "col10": 1097.0,
        "col13": 1193.0,
        "col14": 1225.0,
        "col16": 1330.0,
        "col18": 1436.0,
        "col19": 1468.0,
        "col23": 1616.0,
        "col24": 1648.0,
        "col25": 1680.0,
        "col26": 1711.0,
        "col27": 1743.0,
    }

    def test_narrow_columns_recover_their_axis(self) -> None:
        result = _hoya_session().measure_ruler_geometry()
        by_name = {c["name"]: c for c in result["per_column"]}

        for name, expected in self.NARROW.items():
            assert by_name[name]["axis_x"] == pytest.approx(expected, abs=0.01), (
                f"{name} 的 axis_x = {by_name[name]['axis_x']!r}，应为列左缘 {expected} "
                "—— 该列轴线是 4 实 4 虚的点划线，85% 贯穿率判据对它恒不成立"
            )

    def test_every_column_has_an_axis(self) -> None:
        result = _hoya_session().measure_ruler_geometry()
        missing = [c["name"] for c in result["per_column"] if c["axis_x"] is None]

        assert not missing, f"这 {len(missing)} 列仍测不出轴线：{missing}"

    def test_wide_columns_do_not_move(self) -> None:
        """零回归：修前已命中的列，值一个都不许变。"""
        result = _hoya_session().measure_ruler_geometry()
        by_name = {c["name"]: c for c in result["per_column"]}

        # col01 是"start 偏右"的真实案例：轴线在 309，start 在 319。
        assert by_name["col01"]["axis_x"] == pytest.approx(309.0, abs=0.01)
        for name, expected in (
            ("col02", 497.0),
            ("col03", 728.0),
            ("col04", 864.0),
            ("col08", 1033.0),
            ("col11", 1129.0),
            ("col12", 1161.0),
            ("col15", 1255.0),
            ("col17", 1362.0),
            ("col20", 1500.0),
            ("col21", 1552.0),
            ("col22", 1584.0),
            ("col28", 1774.0),
        ):
            assert by_name[name]["axis_x"] == pytest.approx(expected, abs=0.01), (
                f"{name} 的 axis_x 从 {expected} 变成了 {by_name[name]['axis_x']!r}"
            )


class TestBeginnerNoRegression:
    """beginner：ROI 默认覆盖全图，下轴本来就是最靠下的全宽暗行 —— 必须不变。"""

    def test_median_unchanged(self) -> None:
        result = _beginner_session().measure_ruler_geometry()

        assert result["median_spacing_px"] == pytest.approx(124.5, abs=0.01), (
            f"beginner 中位刻距 {result['median_spacing_px']!r} != 124.5（回归）"
        )

    def test_usable_columns_unchanged(self) -> None:
        result = _beginner_session().measure_ruler_geometry()
        usable = _usable(result["per_column"])

        assert len(usable) == 4, (
            f"beginner >=2 齿的列变成 {len(usable)}（原 4）—— "
            "ROI 全域时 clamp 不得改变行为"
        )
        assert result["all_regular"] is True
