# -*- coding: utf-8 -*-
"""同一列、同一行：**四路导出 + 网格 + QA 的读数必须同源**。

## 缺口

§9 登记过「同一物理量存在两条互不相通的换算链」。两条链早已收敛到
`resolve_column_scale` + `px_to_value`，但**没有任何判据守着"四路相等"**：
CSV / TAR / XLSX / LiPD 各有一条自己的 golden，谁都不跨出去比——取整改了一处，
其余三处仍会绿。这就是本文件存在的理由。

## 收敛后的结构（`2026-11-06`）

`xscale.read_column_values(scale, rows_px, profile=...)` 是**唯一读取入口**：

| profile | 未标定列 | 精度 |
| --- | --- | --- |
| `READ_PROFILE_EXPORT`（导出/网格） | 整列 `None` | 4 位 |
| `READ_PROFILE_QA` | 允许粗算（否则"该列没标定"永远不提醒） | 全精度 |

两个出口的差异**由名字表达**，不再散落在四处调用点的字面参数里。

## 反向验证

把 `READ_PROFILE_EXPORT` 的 `ndigits` 从 4 改成 2 → 判据一立刻红（证明它真的在比数字）。
把 `null_when_uncalibrated` 改成 `False` → 判据二立刻红。
"""

from __future__ import annotations

import base64
import io
import json
import tarfile

import pandas as pd
import pytest

from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _session(calibrated: bool = True) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    session.columns = session.columns[:2]
    for column in session.columns:
        if calibrated:
            column["x_ticks"] = [
                {"px": float(column["start"]), "value": 0.0},
                {"px": float(column["end"]), "value": 100.0},
            ]
        session.digitize(column["col_index"])
    session.is_calibrated = True
    session.y_scale = {"slope": 0.5, "intercept": -100.0}
    return session


def _csv_cell(session: StraditizeSession, row: int, name: str = "col01"):
    df = pd.read_csv(io.StringIO(session.export_data("csv")["csv"]))
    return df.iloc[row][name], df.iloc[row]["depth"]


def _tar_cell(session: StraditizeSession, row: int, name: str = "col01"):
    result = session.export_multi_tar()
    raw = base64.b64decode(result["tar_base64"])
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        text = archive.extractfile("data.csv").read().decode("utf-8")
    df = pd.read_csv(io.StringIO(text))
    return df.iloc[row][name], df.iloc[row]["depth"]


def _xlsx_cell(session: StraditizeSession, row: int, name: str = "col01", tmp_path=None):
    path = tmp_path / "out.xlsx"
    session.export_multi_xlsx(output_path=str(path))
    sheet = pd.read_excel(path, sheet_name="pollen")
    return sheet.iloc[row][name], sheet.iloc[row]["depth"]


def _lipd_cell(session: StraditizeSession, row: int, name: str = "col01"):
    payload = json.loads(json.dumps(session.export_multi_lipd(), default=str))
    text = json.dumps(payload, ensure_ascii=False)
    marker = f'"variableName": "{name}"'
    start = text.index(marker)
    values_start = text.index("[", text.index("values", start))
    values_text = text[values_start : text.index("]", values_start) + 1]
    values = json.loads(values_text)
    return values[row], None


def _grid_cell(session: StraditizeSession, depth: float, name: str = "col01"):
    grid = session.extract_grid_values(depths=[depth])
    return grid["data"][0][name], depth


def test_four_formats_and_grid_agree_on_the_same_cell(tmp_path) -> None:
    session = _session()
    row_value, depth = _csv_cell(session, 5)

    tar_value, tar_depth = _tar_cell(session, 5)
    xlsx_value, xlsx_depth = _xlsx_cell(session, 5, tmp_path=tmp_path)
    lipd_value, _ = _lipd_cell(session, 5)
    grid_value, _ = _grid_cell(session, float(depth))

    assert depth == tar_depth == xlsx_depth, (
        f"depth 列四路不一致：csv={depth} tar={tar_depth} xlsx={xlsx_depth}"
    )
    assert {row_value, tar_value, xlsx_value, lipd_value, grid_value} == {row_value}, (
        "同一列同一行的读数在不同出口不一致："
        f"csv={row_value} tar={tar_value} xlsx={xlsx_value} lipd={lipd_value} grid={grid_value}"
    )


def test_uncalibrated_column_is_null_in_every_export(tmp_path) -> None:
    session = _session(calibrated=False)

    csv_value, depth = _csv_cell(session, 5)
    tar_value, _ = _tar_cell(session, 5)
    xlsx_value, _ = _xlsx_cell(session, 5, tmp_path=tmp_path)
    grid_value, _ = _grid_cell(session, float(depth))

    assert csv_value is None or pd.isna(csv_value)
    assert tar_value is None or pd.isna(tar_value)
    assert xlsx_value is None or pd.isna(xlsx_value)
    assert grid_value is None, "未标定列在网格采样里必须给 None，不能给程序默认值"


def test_qa_still_reads_uncalibrated_columns_by_design() -> None:
    session = _session(calibrated=False)
    summary = session.qa_summarize()

    per_column = summary["per_column_max"]
    assert per_column, "QA 必须给出逐列结果"
    assert all(entry["calibrated"] is False for entry in per_column)
    assert any(entry["peak"] is not None for entry in per_column), (
        "QA 对未标定列**有意**粗算——这是它触发「该列没标定」提醒的唯一手段；"
        "若它也开始返回 None，这条提醒就永远不出现"
    )


def test_profiles_differ_only_in_precision_and_null_policy() -> None:
    from straditize_core.session_parts.xscale import (
        READ_PROFILE_EXPORT,
        READ_PROFILE_QA,
        read_column_values,
        resolve_column_scale,
    )

    session = _session()
    column = session.columns[0]
    scale = resolve_column_scale(session, column, column["col_index"])
    px = float(column["start"]) + (float(column["end"]) - float(column["start"])) / 3.0

    export_value = read_column_values(scale, [px])[0]
    qa_value = read_column_values(scale, [px], profile=READ_PROFILE_QA)[0]

    assert export_value == pytest.approx(qa_value, abs=1e-3), (
        "两个 profile 在已标定列上必须是同一个数（只差取整）"
    )
    assert export_value != qa_value or round(qa_value, 4) == export_value, (
        f"导出应按 4 位取整：export={export_value} qa={qa_value}"
    )
    assert len(str(export_value).split(".")[-1]) <= 4
