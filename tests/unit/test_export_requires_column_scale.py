# -*- coding: utf-8 -*-
"""面板导出：**全列未标定 X 刻度**时必须拒绝，不能交付一张整表空白。

## 缺陷现场（实测，hoya 教程图）

Y 轴已标定（步骤 3 做完）、28 列都还没标定 X 刻度（步骤 6 没做）时，
`export_data(dataset='depth_grid')` 返回的是「表头 29 列 + 76 行 depth + 28 列全空」：
每一格读数都是 `NA`（未标定列的既有语义，本身没错），但**整张表一个读数都没有**。
前端把它渲染成「来源（N 行）· 预览、复制与 CSV 下载都按此行集导出」的正常表，
用户看不出自己卡在步骤 6，只会以为"这张图没数据"。

`docs/ARCHITECTURE.md` §2：取不到数据就报错并停在原地，绝不返回替代数据。
所以「一列都没标定」这条路径改为抛 `CALIBRATION_ERROR`（-32003），文案指明是
**列刻度 / 步骤 6**（不是步骤 3 的深度标定）。

## 两条判据（② 是 ① 的正对照，防"一律拒绝"也算过）

1. 全列未标定 ⇒ 抛 -32003，消息含「列」与「步骤 6」，且不含「深度标定」；
2. 只标定一列 ⇒ 正常导出：该列整列有真实读数，其余列**整列为空**（NA 语义），
   深度列照常有值。
"""

from __future__ import annotations

import csv
import io

import pytest

from straditize_core.protocol import CALIBRATION_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession

IMAGE = "straditize_core/assets/tutorials/hoya-del-castillo.png"

#: 缺陷原始复现路径：Y 标定 + 分列，**不做**任何 X 刻度标定。
_ROI = {"x0": 315, "x1": 1946, "y0": 511, "y1": 1311}
_YLIM = [511, 1311]
_Y_MARKS = [
    {"pixel": 511.0, "val": 0.0},
    {"pixel": 1311.0, "val": 150.0},
]

#: 第一列的刻度端点：像素取该列 `start=319 / end=497` 之内，数值 0→100。
#: 故意让右端点（400）**短于**列右缘，以证明"读数来自标定"而不是来自列宽归一。
_FIRST_COLUMN_TICKS = [{"px": 320.0, "value": 0.0}, {"px": 400.0, "value": 100.0}]


def _session(calibrate_first_column: bool = False) -> StraditizeSession:
    session = StraditizeSession()
    session.load_image(IMAGE)
    session.roi_update(**_ROI)
    session.detect_columns(data_xlim=[_ROI["x0"], _ROI["x1"]], data_ylim=_YLIM)
    session.calibrate_axes(y_marks=_Y_MARKS, unit="cm")
    if calibrate_first_column:
        session.calibrate_column_xticks(0, _FIRST_COLUMN_TICKS)
    return session


def _matrix(csv_text: str) -> tuple[list[str], list[list[str]]]:
    rows = list(csv.reader(io.StringIO(csv_text)))
    return rows[0], rows[1:]


def test_all_columns_uncalibrated_grid_is_blank() -> None:
    """钉住缺陷的前提：28 个属种列的表头都在，读数一格都没有。

    这条不测导出层（导出层已被下面的守卫挡住），它测的是**取数层**的真实产物，
    好让"为什么要拒绝"有可复核的证据，而不是只留在 commit message 里。
    """
    session = _session()
    # `export_data` 在取数前会先补出逐行点（控制点合成 > 现场数字化 > 等距采样），
    # 这里走**同一个**准备入口，才能看到导出层本来会拿到的那张矩阵。
    session._ensure_export_column_points()
    grid = session.extract_grid_values(depths=[0.0, 10.0, 20.0])
    assert len(grid["taxa"]) == 28, "前置：hoya 教程图分列后应有 28 个属种列"
    assert all(cell is None for row in grid["matrix"] for cell in row), (
        f"未标定列必须整列 NA，实际矩阵：{grid['matrix'][:1]}"
    )


@pytest.mark.parametrize("dataset", ["samples", "turning_points"])
def test_all_columns_uncalibrated_export_is_rejected(dataset: str) -> None:
    session = _session()
    with pytest.raises(JsonRpcError) as excinfo:
        session.export_data(dataset=dataset)

    assert excinfo.value.code == CALIBRATION_ERROR, (
        f"{dataset} 必须抛 CALIBRATION_ERROR"
    )
    message = str(excinfo.value.message)
    assert "列" in message, (
        f"{dataset} 的文案必须点明是列（X 刻度）的问题，实际：{message}"
    )
    assert "步骤 6" in message, f"{dataset} 的文案必须指向步骤 6，实际：{message}"
    assert "深度标定" not in message, (
        f"{dataset} 的文案不得把用户引去步骤 3（深度标定）：{message}"
    )
    # 前端靠 `data.reason` 区分两种 -32003，不能靠模糊的 includes('标定')。
    assert excinfo.value.data["reason"] == "column_scale"
    assert excinfo.value.data["columns"] == 28
    assert excinfo.value.data["calibrated"] == 0


def test_samples_dataset_is_guarded_by_column_scale() -> None:
    """面板「共识层位」也必须过列标度守卫（不是只有 union/depth/turning 三张表）。

    面板默认数据集从 union_points 改成 samples 后，samples 一度直接走
    `_primary_roi_export_frame`（data.csv 语义），绕过 `_assert_export_column_scale`：
    全列未标定时不再抛 -32003，只给一张 28 列全 NA 的表 —— 看起来像「这张图没数据」，
    用户看不出自己卡在步骤 6。这条钉住「面板上的任何数据集都必须过守卫」，
    只有**不传 dataset** 的 data.csv / tar / xlsx 出口例外。
    """
    session = _session()
    with pytest.raises(JsonRpcError) as excinfo:
        session.export_data(dataset="samples")

    assert excinfo.value.code == CALIBRATION_ERROR
    message = str(excinfo.value.message)
    assert "列" in message and "步骤 6" in message, message
    assert "深度标定" not in message, message
    assert excinfo.value.data["reason"] == "column_scale"


@pytest.mark.parametrize("dataset", ["samples"])
def test_one_calibrated_column_exports_real_values_and_blanks_the_rest(
    dataset: str,
) -> None:
    """正对照：只要有一列标定过就照常导出，不得整体拒绝。"""
    session = _session(calibrate_first_column=True)
    result = session.export_data(dataset=dataset)

    headers, rows = _matrix(result["csv"])
    assert headers[0] == "depth", f"第一列必须是 depth，实际 {headers[:1]}"
    assert len(headers) == 29, f"应有 depth + 28 个属种列，实际 {len(headers)}"
    assert len(rows) > 0, f"{dataset} 必须给出行集"

    nonblank = [
        sum(1 for row in rows if row[i].strip() != "") for i in range(len(headers))
    ]
    assert nonblank[0] == len(rows), "深度列必须每行都有值"
    # `columns[0]` = `col01`，即表格第 2 列（表头顺序 = column_points 的键序）。
    assert headers[1] == "col01", f"已标定列必须是 col01，实际 {headers[1]!r}"
    assert nonblank[1] == len(rows), "已标定列必须整列有真实读数"
    # 未标定列必须整列 NA：缺测在 CSV 里写成字面量 NA（na_rep="NA"），
    # 不是空单元格——空单元格在下游读入器里既可能是缺失也可能是 0。
    na_counts = [
        sum(1 for row in rows if row[i].strip() == "NA") for i in range(2, len(headers))
    ]
    assert na_counts == [len(rows)] * (len(headers) - 2), (
        f"未标定列必须整列 NA，实际 NA 数：{na_counts}"
    )

    values = [float(row[1]) for row in rows]
    assert any(v > 0 for v in values), "已标定列的读数不能是全 0 占位"
    assert len(set(values)) > 1, f"已标定列的读数应随层位变化，实际只有 {set(values)}"
