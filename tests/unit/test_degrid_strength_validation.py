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
- 拿掉运行时守卫 → `test_runtime_guard_skips_invalid_strength` 与端到端导出那条
  （`test_export_stops_falling_back_to_placeholder`）红。

## 未标定导出的契约变化（本轮）

`export_data` 现在在未标定会话上直接抛 `CALIBRATION_ERROR`，所以「导出」这一条
拆成一对：`test_uncalibrated_export_refuses_instead_of_faking_a_table` 钉拒绝行为，
`test_export_stops_falling_back_to_placeholder` 钉标定后的对照（非法强度不得退化）。
只有前者会全绿也可以，所以后者必须真的产出非空读数。
"""

from __future__ import annotations

import base64
import io
import logging
import tarfile

import pytest

from straditize_core.protocol import CALIBRATION_ERROR, JsonRpcError
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


def _calibrate_y_and_columns(session: StraditizeSession) -> None:
    """把 fig3_raw 会话标定到「能导出真实读数」：Y 两点 + 每列 X 两点。

    全部走真实 RPC（`calibrate_axes` / `calibrate_column_xticks`），不碰
    `is_calibrated` / `y_scale` 字段。列端点的换算沿用本项目这些实测剖面的既有
    口径：整列宽 = 3.80 像素/百分点，故右端取值 = 宽 / 3.80。
    """
    session.calibrate_axes(
        y_marks=[{"pixel": 233.0, "val": 0.0}, {"pixel": 869.0, "val": 100.0}],
        unit="cm",
    )
    for index, column in enumerate(session.columns):
        left, right = float(column["start"]), float(column["end"])
        session.calibrate_column_xticks(
            index,
            [{"px": left, "value": 0.0}, {"px": right, "value": (right - left) / 3.80}],
            unit="%",
        )


def test_uncalibrated_export_refuses_instead_of_faking_a_table() -> None:
    """**未标定就不出数**：必须抛 CALIBRATION_ERROR(-32003)，不得给空表/占位表。

    取代旧的「未标定也该出一张表，只是不许退化」的判据。旧判据把「抛错」误判成
    「退化成占位表」(`assert True is False`)，于是把正确行为记成了缺陷；新契约下
    抛错正是要断言的行为——「没有深度就没有可交付的剖面」。
    """
    session = _plate_session()
    session.degrid_strength = 0.6  # 与旧用例同一起点：非法去线强度

    with pytest.raises(JsonRpcError) as excinfo:
        session.export_data("csv")

    assert excinfo.value.code == CALIBRATION_ERROR, (
        f"未标定导出必须以 CALIBRATION_ERROR(-32003) 拒绝，实得 {excinfo.value.code}"
    )
    assert "深度标定" in str(excinfo.value), (
        f"拒绝文案必须告诉用户问题在哪（深度标定），实得：{excinfo.value}"
    )

    # 工程包这条出口仍然要交付（不能因为拒绝导出就不给整个 tar），但占位表必须
    # 显式写明「原因是未标定」——全 0 的矩阵长得和合法数据一样，靠 README 里那句
    # 「unobserved = 0.0」分辨不出来，所以标记必须落在这里。
    result = session.project_save(format="tar")
    assert result["data_csv_placeholder"] is True
    assert "深度标定" in (result["data_csv_placeholder_reason"] or ""), (
        f"占位表原因必须指向深度标定，实得：{result.get('data_csv_placeholder_reason')}"
    )


def test_export_stops_falling_back_to_placeholder() -> None:
    """对照（反向）：标定之后，非法去线强度**不得**把导出退化成占位表。

    上面那条只证明「未标定会被拒」。若只有它，守卫把一切都拒掉也能全绿。
    这一条把同一会话标定掉再导出：真读数必须出得来、占位说明文件必须不出现。
    非法强度若真的让取数炸掉，这里就会退回占位表（`data.csv_placeholder` 为 True），
    也就是本文件开篇记的那个缺陷：错误被吞成一份「每格 0.00」的假表。
    """
    session = _plate_session()
    session.degrid_strength = 0.6  # 模拟从别的入口塞进来的非法值
    _calibrate_y_and_columns(session)

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
    assert any(
        cell not in ("", "0.0") for cell in csv_text.splitlines()[1].split(",")[1:]
    ), "对照：标定后的首行必须有真实读数（否则上面那条只是被守卫拒掉才绿的）"
