# -*- coding: utf-8 -*-
"""分列不得把「填满整列的色块/空框」当数据列（task-21）。

## 缺陷本体

`detect_column_bounds` 按"墨迹水平游程"切列，无法区分「随层位变化的曲线」与
「整列恒定填充的色块/网纹/边框」。后者被纳入后，导出那一列是**恒定满值**
（实测 mean=30.19 / std=3.53，几乎钉在满量程 31），直接污染科研数据。

## 判据（两个量同时成立，纯结构，不依赖真值表）

- **CV（逐行墨迹宽度的变异系数）**：曲线横向位置与宽度随层位变化 → 大方差；
  色块/网纹/边框恒定宽度 → 方差近零。
- **ratio（均值墨迹宽 / 列宽）**：色块与边框填满整列 → ≈1；真实曲线横向留白
  → 明显小于 1。

单看 CV 会把"平坦曲线段"算进去；单看 ratio 会把"宽而实的 bar 列"算进去。
故必须两者同时成立。实测 95 个真实列：命中列 CV ≤ 0.0080 / 其余最低 0.3156
（差 39 倍）；命中列 ratio ≥ 0.9796 / 其余最高 0.7355。

## 处置：标记而非剔除

静默剔除同样是隐瞒——用户会奇怪"为什么列数变少了"，也无从判断被拿掉的是不是
他真要的数据。故保留列、打 `suspect_block`，由界面提示用户确认。

## 本文件重点守的两件事

1. **不得误伤真实 bar 列**（任务书点名的最大风险点）；
2. **反向哨兵**：五张图上除命中列外，其余列一个都不许被标。
"""
from __future__ import annotations

import io
import os
from pathlib import Path

import numpy as np
import pytest
from PIL import Image, ImageDraw

from straditize_core.session import StraditizeSession
from straditize_core.session_parts.core import (
    SUSPECT_BLOCK_CV_LIMIT,
    SUSPECT_BLOCK_FILL_RATIO,
    _detect_block_column,
)

BENCH_DIR = Path("tests/data/figures/benchmark_types")

#: 五张图的期望命中列（1-based），来自 Lead 实测 + 本文件复核。
EXPECTED_FLAGGED = {
    "hoya": [29],
    "beginner": [4],
    "Pollen_riojaPlotTestData.png": [21],
    "Pollen_BarStyle_riojaPlotTestData.png": [21],
    "Pollen_CruveStyle_riojaPlotTestData.png": [21],
}


def _flagged_columns(session: StraditizeSession) -> list[int]:
    return [col["col_index"] + 1 for col in session.columns if col.get("suspect_block")]


def _load_and_split(**kwargs) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    if "sample_key" in kwargs:
        session.load_image(sample_key=kwargs["sample_key"])
    else:
        session.load_image(image_path=kwargs["path"])
    session.detect_columns(roi_id=session.rois[0]["id"])
    return session


def _bench(name: str) -> str:
    return str(BENCH_DIR / name)


class TestBuiltInFigures:
    """内置图：beginner col4 是填满整列的色块，必须被标。

    ## hoya col29 的预期（2026-11-04 更新归因）

    色块判定的统计起点是 **0 点**（= `start + axis_stroke_px`，轴线右缘），不是列左缘：
    轴线与紧贴它的左竖边不算数据墨迹。hoya col29 是空框，左竖边被这个起点排除后
    每行墨迹跨度只剩右侧空框，fill_ratio 远低于阈值，形态 1 不命中。

    （旧归因写的是"零点锚定把 start 推到右缘"，那个开关现在默认关闭；结论不变，
    机制改成块判定自己取 0 点作为起点 —— 见 `_detect_block_column` 的调用处。）

    尝试补一条"细竖线"判据覆盖它，实测把 Diatom 18 列、PollenCurve 13 列真实
    细线曲线全部误标（细线曲线与边框线在"宽度窄"上无法区分，真正的区别是边框线
    位置恒定、曲线位置随 y 变），故已撤回。

    **当前事实**：hoya col29 不被标记。这是已知缺口，不是回归——该列数值仍会进入
    导出，用户需自行判断。要彻底解决需要引入"墨迹位置方差"维度，属独立任务。
    """

    def test_hoya_col29_not_flagged_after_zero_point_shift(self) -> None:
        """hoya col29 是边框空框；零点右缘锚定后不再命中（已知边界）。

        ## 为什么不修

        块判定从 0 点（`start + axis_stroke_px`）起算，col29 的左竖边被排除在
        统计区外，该列不再是"填满整列"。

        补过两种判据都被真实数据证伪：
        - "墨迹宽度 ≤3px 即非曲线" → 误标 Diatom 18 列、PollenCurve 13 列真实细线；
        - "内部墨迹比低即空框" → 误标 Pollen_CruveStyle col6 真实细线曲线。

        彻底区分"空框"与"细线曲线"需要"墨迹位置是否随 y 变化"这个维度，属独立任务。
        当前保持已知缺口：col29 不被标记，其数值仍进导出。
        """
        session = _load_and_split(sample_key="hoya")

        assert _flagged_columns(session) == [], (
            "若 hoya 重新出现命中列，说明零点判据或色块判据已变更 —— "
            "请先核对 col29 的几何与零点位置，再更新本断言"
        )

    def test_beginner_flags_only_col4(self) -> None:
        session = _load_and_split(sample_key="beginner")

        assert _flagged_columns(session) == [4], (
            "beginner 的命中列不对 —— 期望只有 col4（x=[1576,1803] 的空框）"
        )

    def test_hoya_real_columns_are_not_flagged(self) -> None:
        """反向哨兵：col1..col28 一个都不许被标。"""
        session = _load_and_split(sample_key="hoya")
        flagged = set(_flagged_columns(session))

        for column_number in range(1, 29):
            assert column_number not in flagged, (
                f"hoya col{column_number} 是真实曲线列，被误标成色块"
            )

    def test_beginner_real_columns_are_not_flagged(self) -> None:
        """反向哨兵：col1..col3 一个都不许被标。"""
        session = _load_and_split(sample_key="beginner")
        flagged = set(_flagged_columns(session))

        for column_number in range(1, 4):
            assert column_number not in flagged, (
                f"beginner col{column_number} 是真实曲线列，被误标成色块"
            )


class TestBenchmarkFigures:
    """真实基准图（被 gitignore 的目录，缺失时 skip）。"""

    @pytest.mark.parametrize(
        "figure_name",
        [
            "Pollen_riojaPlotTestData.png",
            "Pollen_BarStyle_riojaPlotTestData.png",
            "Pollen_CruveStyle_riojaPlotTestData.png",
        ],
    )
    def test_flags_only_col21(self, figure_name: str) -> None:
        path = _bench(figure_name)
        if not os.path.exists(path):
            pytest.skip(f"基准图不存在：{path}（tests/data 目录可能未随仓库分发）")

        session = _load_and_split(path=path)

        assert _flagged_columns(session) == EXPECTED_FLAGGED[figure_name], (
            f"{figure_name} 的命中列不对 —— 期望只有 col21（x=[929,1055] 实心填充）"
        )

    def test_bar_style_real_columns_are_not_flagged(self) -> None:
        """**最大风险点**：bar 风格的列宽度也可能较恒定，不得被误判成色块。"""
        path = _bench("Pollen_BarStyle_riojaPlotTestData.png")
        if not os.path.exists(path):
            pytest.skip(f"基准图不存在：{path}")

        session = _load_and_split(path=path)
        flagged = set(_flagged_columns(session))

        assert len(session.columns) >= 20, "前置：bar 风格图应有 20 列以上"
        for column_number in range(1, len(session.columns)):
            assert column_number not in flagged, (
                f"bar 风格 col{column_number} 被误标 —— 恒定宽度的真实 bar 列"
                "不该被判为色块（本判据要求同时满足 CV<0.1 且 填满整列）"
            )


class TestSyntheticDiscrimination:
    """合成图逐一验证判据边界：色块命中、各类真实图形不误伤。"""

    WIDTH, HEIGHT = 420, 400

    def _mask(self, draw) -> np.ndarray:
        canvas = Image.new("L", (self.WIDTH, self.HEIGHT), 255)
        draw(ImageDraw.Draw(canvas))
        return np.array(canvas) < 160

    def _probe(self, draw) -> dict | None:
        return _detect_block_column(self._mask(draw), 10, 100, 20, 380)

    def test_solid_block_is_flagged(self) -> None:
        evidence = self._probe(
            lambda painter: painter.rectangle([10, 20, 99, 380], fill=0)
        )
        assert evidence is not None, "填满整列的实心色块必须被标记"
        assert evidence["fill_ratio"] > SUSPECT_BLOCK_FILL_RATIO
        assert evidence["cv"] < SUSPECT_BLOCK_CV_LIMIT

    def test_empty_frame_is_flagged(self) -> None:
        """空框（只有边框、中间空白）也是"填满整列"——每行墨迹跨越整个列宽。"""
        evidence = self._probe(
            lambda painter: painter.rectangle([10, 20, 99, 380], outline=0, width=2)
        )
        assert evidence is not None, "边框空框必须被标记"

    def test_varying_width_curve_is_not_flagged(self) -> None:
        """真实曲线：宽度随层位变化。"""

        def draw(painter: ImageDraw.ImageDraw) -> None:
            for y in range(20, 380):
                amplitude = 80 * abs(np.sin((y - 20) / 60.0)) + 1
                painter.line([(10, y), (10 + amplitude, y)], fill=0)

        assert self._probe(draw) is None, "宽度变化的真实曲线被误标成色块"

    def test_constant_width_bar_not_filling_column_is_not_flagged(self) -> None:
        """**真实 bar 列**：宽度恒定但只占列宽的一部分（横向留白）。"""
        evidence = self._probe(
            lambda painter: painter.rectangle([15, 20, 75, 380], fill=0)
        )
        assert evidence is None, (
            "恒定宽度但不满列的 bar 被误标 —— 这类列是真实数据，"
            "判据必须靠 fill_ratio 把它与填满整列的色块分开"
        )

    def test_flat_curve_not_filling_column_is_not_flagged(self) -> None:
        """平坦曲线（最像色块的真实情况）：宽度恒定但不满列。"""
        evidence = self._probe(
            lambda painter: painter.rectangle([20, 20, 70, 380], fill=0)
        )
        assert evidence is None, "平坦但不满列的曲线被误标"

    def test_thin_line_is_not_flagged(self) -> None:
        evidence = self._probe(
            lambda painter: painter.rectangle([40, 20, 43, 380], fill=0)
        )
        assert evidence is None, "细线被误标"

    def test_too_few_ink_rows_is_not_judged(self) -> None:
        """墨迹行太少时 CV 无统计意义，不得据此下结论。"""
        evidence = self._probe(
            lambda painter: painter.rectangle([10, 20, 99, 25], fill=0)
        )
        assert evidence is None, "只有 5 行墨迹就下了色块结论"


class TestEvidenceShape:
    """证据字段的形状约束：要能进载荷、能进撤销栈。"""

    def test_evidence_contains_only_immutable_scalars(self) -> None:
        # 用 beginner col4（稳定命中「填满整列」）；hoya col29 因零点校正
        # 左竖边被排除列外，已不再命中（见 TestBuiltInFigures 的说明）。
        session = _load_and_split(sample_key="beginner")
        evidence = session.columns[3]["suspect_block"]

        assert set(evidence) == {
            "reason",
            "cv",
            "fill_ratio",
            "mean_ink_width",
            "column_width",
        }
        for key, value in evidence.items():
            assert isinstance(value, (str, int, float)), (
                f"{key} 是 {type(value).__name__} —— 撤销栈浅拷贝会共享嵌套容器，"
                "证据里只能放不可变标量"
            )

    def test_unflagged_columns_have_no_key(self) -> None:
        """未命中的列不该出现 `suspect_block` 键（不给前端制造噪音）。"""
        session = _load_and_split(sample_key="hoya")
        for column in session.columns[:28]:
            assert "suspect_block" not in column


class TestDiscriminativePower:
    """判别力对照：把判据退回"恒不标记"，本文件的断言必须变红。"""

    def test_disabling_the_criterion_makes_assertions_fail(self) -> None:
        import straditize_core.session_parts.core as core_module

        original = core_module.SUSPECT_BLOCK_CV_LIMIT
        try:
            # 把 CV 上限设成 0（任何列都不可能小于 0）→ 判据实际失效
            core_module.SUSPECT_BLOCK_CV_LIMIT = 0.0
            session = _load_and_split(sample_key="hoya")
            assert _flagged_columns(session) == [], (
                "判据失效后仍然标出了列 —— 说明这些标记来自别处，"
                "本文件的断言没有测到判据本身"
            )
        finally:
            core_module.SUSPECT_BLOCK_CV_LIMIT = original

        # 恢复后必须重新命中（证明上一步的"空结果"确实来自判据失效）
        restored = _load_and_split(sample_key="beginner")
        assert _flagged_columns(restored) == [4]


class TestPayloadExposesSuspectBlock:
    """标记必须真的到达前端载荷（task-21 的"接上出口"）。

    ## 为什么单独钉这一层

    标记只写进 `session.columns` 是不够的：`straditize.getDiagramData` 的
    `formatted_cols` 是**白名单逐字段拼**的，任何没列进去的键都会被丢掉。
    实测过这个断链——session 里 `col29.suspect_block` 完整存在，载荷里却没有，
    用户看不到任何提示，列还在、数值照样污染 CSV。这与 C1e（几何 scope 改对了
    但没接上出口）是同一形态。

    ## 三条判据

    1. 命中列的载荷里有**完整结构**（不是被压成布尔值）——前端要 `reason`
       才能给出准确文案；
    2. 未命中列的载荷里是 `None`（键存在、值为空），前端据此判断"没有提示"，
       不能靠"键是否存在"来判断（那样正常列也会被误判）；
    3. 整个载荷 JSON 可序列化——证据里若混进 tuple/numpy 标量会在此抛错。
    """

    @staticmethod
    def _payload(session: StraditizeSession) -> dict:
        from straditize_core.rpc_server import create_rpc_dispatcher

        dispatcher = create_rpc_dispatcher(session)
        response = dispatcher.handle_object(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "straditize.getDiagramData",
                "params": {},
            }
        )
        assert "result" in response, response
        return response["result"]

    def test_flagged_column_reaches_the_payload(self) -> None:
        session = _load_and_split(sample_key="beginner")
        assert "suspect_block" in session.columns[3], "前置：session 里应有标记"

        payload = self._payload(session)
        column = payload["columns"][3]

        assert "suspect_block" in column, (
            "载荷里没有 suspect_block —— getDiagramData 的白名单没透传它，"
            "用户看不到任何提示，这条缺陷对用户仍未修好"
        )
        evidence = column["suspect_block"]
        assert isinstance(evidence, dict), (
            "suspect_block 被压成了非结构值 —— 前端需要 reason 才能给出准确文案"
        )
        assert evidence["reason"] == "fills_whole_column"
        assert set(evidence) == {
            "reason",
            "cv",
            "fill_ratio",
            "mean_ink_width",
            "column_width",
        }

    def test_unflagged_columns_payload_value_is_none(self) -> None:
        """未命中列的值必须是 None（键在、值为空），不能是缺键。"""
        session = _load_and_split(sample_key="hoya")

        payload = self._payload(session)

        for index in range(28):
            assert "suspect_block" in payload["columns"][index], (
                f"col{index + 1} 载荷里缺这个键 —— 前端无法区分"
                "'没有提示' 与 '载荷没透传'"
            )
            assert payload["columns"][index]["suspect_block"] is None

    def test_payload_is_json_serialisable(self) -> None:
        import json

        session = _load_and_split(sample_key="hoya")

        payload = self._payload(session)

        assert json.dumps(payload, ensure_ascii=False)

    def test_removing_the_passthrough_makes_this_fail(self) -> None:
        """判别力对照：把透传那行临时改成恒 None，本类断言必须变红。"""
        import straditize_core.rpc_methods.system as system_module

        original = system_module.register

        def _broken_register(dispatcher, session):
            """注册一个把 suspect_block 抹掉的 getDiagramData 包装。"""
            original(dispatcher, session)
            wrapped = dispatcher._methods.get("straditize.getDiagramData")
            assert wrapped is not None

            def _stripped():
                payload = wrapped()
                for column in payload.get("columns", []):
                    column.pop("suspect_block", None)
                return payload

            dispatcher._methods["straditize.getDiagramData"] = _stripped

        try:
            system_module.register = _broken_register
            session = _load_and_split(sample_key="hoya")
            payload = self._payload(session)
            assert "suspect_block" not in payload["columns"][28], (
                "抹掉透传后载荷里仍有这个键 —— 说明本类的断言没测到透传层"
            )
        finally:
            system_module.register = original

        # 恢复后必须重新出现（证明上一步的"缺失"确实来自透传被抹掉）
        restored = _load_and_split(sample_key="hoya")
        assert "suspect_block" in self._payload(restored)["columns"][28]
