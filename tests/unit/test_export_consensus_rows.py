# -*- coding: utf-8 -*-
"""导出默认行集 = 共识层位（samples）；缺值口径：已标定列插值、未标定列 NA。

## 现场（2026-11-15 用户实测，工程 straditize_project_1794746567262）

该工程 samples 35 条（步骤 7 的共识层位），4 列控制点合计 129 个不同 y。
旧行为：导出面板默认数据集是 union_points（拐点 y 并集）→ 129 行；且控制点合成列里
「没有拐点的行」被编了一个 0 点像素 → 缺值写成 0 丰度，用户会把 0 当真实读数。

## 现行口径（2026-11-15 定稿，覆盖上一版「缺行一律 NA」）

1. 行集 = samples：行数必须等于 samples 条数（不因插值/填充新增行）；
2. **已标定列**在某共识层位没有拐点 → 该格给**该列曲线自己的线性插值**（端点 clamp）；
3. **未标定列** → 一律 NA（「未标定列不给数」不变量不动）；
4. 不加 flag 列标记插值：CSV 里给不了颜色，加列会让矩阵变宽且与 XLSX 不一致；
5. turning_points / union_points / depth_grid 三条数据集语义不变，默认不走它们。

## 反向验证（实测过）

把 `_interpolate_missing_px` 改成返回 `[None] * len(rows)`（缺行 → NA），或改成直填 0，
`test_calibrated_gap_is_linear_interpolation_not_zero_or_na` 立刻变红（期望 50.0，
实得 NaN 或 0.0）。
"""

from __future__ import annotations

import io

import pandas as pd

from straditize_core.session import StraditizeSession

#: 拐点 y 的并集：129 个不同行（与现场工程同量级）。
_UNION_ROWS = list(range(100, 229))


def _column(c_idx: int, calibrated: bool = True) -> dict:
    col = {
        "col_index": c_idx,
        "name": f"col{c_idx + 1:02d}",
        "roi_id": "roi_1",
    }
    if calibrated:
        # 满量程 100%：px 0 → 0%，px 100 → 100%
        col["x_ticks"] = [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}]
    return col


def _session(
    samples_rows: list[int],
    control_points: dict[int, dict[int, float]],
    n_columns: int | None = None,
    uncalibrated: set[int] | None = None,
) -> StraditizeSession:
    uncalibrated = uncalibrated or set()
    session = StraditizeSession()
    session._init_export()
    session.columns = [
        _column(i, calibrated=i not in uncalibrated)
        for i in range(n_columns or len(control_points))
    ]
    session.column_points = {}
    session.control_points = control_points
    session.samples = [{"row_px": r, "depth": float(r)} for r in samples_rows]
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    return session


def _csv(session: StraditizeSession, **kwargs) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(session.export_data("csv", **kwargs)["csv"]))


def _raw_cells(session: StraditizeSession) -> dict[float, list[str]]:
    """原文 CSV 单元格（pd.read_csv 会把 NA 读成 NaN，看不出字面量）。"""
    text = session.export_data("csv")["csv"]
    rows = [line.split(",") for line in text.strip().splitlines()]
    header, body = rows[0], rows[1:]
    return {float(row[0]): row[1:] for row in body}


def test_default_export_rows_equal_samples_not_turning_point_union() -> None:
    """判据 1：默认导出行数 = samples 条数，不是各列拐点 y 的并集。"""
    control_points = {
        c_idx: {row: 10.0 + 10.0 * c_idx for row in _UNION_ROWS[c_idx::4]}
        for c_idx in range(4)
    }
    union_rows = {row for pts in control_points.values() for row in pts}
    assert len(union_rows) == len(_UNION_ROWS), "构造前提：拐点并集应为 129 行"

    samples_rows = sorted({row for row in union_rows if row % 4 == 0})[:35]
    session = _session(samples_rows, control_points)

    df = _csv(session)

    assert len(df) == len(samples_rows), (
        f"默认导出必须是共识层位（{len(samples_rows)} 行），实得 {len(df)} 行"
        f"（拐点并集是 {len(union_rows)} 行）"
    )
    assert len(df) != len(union_rows), "默认导出不能是拐点 y 的并集"
    assert df["depth"].tolist() == [float(r) for r in samples_rows], (
        "行序与深度必须与 samples 一一对应；插值不得引入新行"
    )


def test_calibrated_gap_is_linear_interpolation_not_zero_or_na() -> None:
    """判据 2 + 3：已标定列缺行 → 该列线性插值；未标定列 → NA。

    构造（三列、samples = 100 / 150 / 200）：
    - col01 已标定，三个层位都有锚点 → 读数 90；
    - col02 已标定，锚点只有 (100→10px, 200→90px)，150 层位没有拐点 → 插值 (10+90)/2 = 50px = 50%；
    - col03 未标定，锚点同 col02 → 即便插得出像素也必须整列 NA。
    """
    session = _session(
        [100, 150, 200],
        {
            0: {100: 90.0, 150: 90.0, 200: 90.0},
            1: {100: 10.0, 200: 90.0},
            2: {100: 10.0, 200: 90.0},
        },
        n_columns=3,
        uncalibrated={2},
    )

    df = _csv(session)
    by_row = df.set_index("depth")
    raw = _raw_cells(session)

    assert len(df) == 3, f"行数必须等于 samples 数（3），实得 {len(df)}"
    assert by_row.loc[150.0, "col01"] == 90.0, "有锚点的层位必须是锚点读数"
    assert abs(by_row.loc[150.0, "col02"] - 50.0) < 1e-6, (
        "已标定列缺行必须是该列两侧锚点的线性插值（(10+90)/2 = 50），"
        f"实得 {by_row.loc[150.0, 'col02']}；给 0 或 NA 都不符合口径"
    )
    assert raw[150.0][2] == "NA", (
        f"未标定列必须整列 NA（缺测），实得 {raw[150.0][2]!r}"
    )


def test_interpolation_does_not_fabricate_a_zero() -> None:
    """反向钉：已标定列缺行的插值既不能退化成 0，也不能退化成 NA。"""
    session = _session(
        [100, 150, 200],
        {0: {100: 20.0, 200: 80.0}},
        n_columns=1,
    )

    value = _csv(session).set_index("depth").loc[150.0, "col01"]

    assert abs(value - 50.0) < 1e-6, f"插值应为 50.0，实得 {value}"
    assert value != 0.0, "缺行不得填 0（那是在声称这一层测到了零丰度）"


def test_turning_points_dataset_is_separate_and_not_default() -> None:
    """判据 5：turning_points 保留但显式区分，默认导出不走它。"""
    from straditize_core.session_parts.export import ExportMixin

    assert "turning_points" in ExportMixin.EXPORT_DATASETS
    assert "samples" in ExportMixin.EXPORT_DATASETS, (
        "面板必须能显式选到「共识层位」这一行集（默认值就是它）"
    )

    control_points = {0: {100: 10.0, 200: 90.0}, 1: {150: 50.0}}
    session = _session([100, 150, 200], control_points)

    default_df = _csv(session)
    samples_df = _csv(session, dataset="samples")
    turning_df = _csv(session, dataset="turning_points")

    assert default_df.shape == samples_df.shape
    assert default_df.equals(samples_df), "默认导出行集必须与 dataset=samples 完全一致"

    assert {"taxon", "type", "depth", "value", "x", "y"} <= set(turning_df.columns)
    assert len(turning_df) == 3, "拐点清单每个控制点一行（本构造共 3 个控制点）"
    assert "taxon" not in default_df.columns, "默认导出不许是拐点长表"


def test_uncalibrated_columns_stay_na_on_every_consensus_row() -> None:
    """未标定列在**所有**共识层位上都是 NA，插值不得绕过这条不变量。"""
    session = _session(
        [100, 150, 200],
        {0: {100: 10.0, 200: 90.0}, 1: {100: 10.0, 150: 50.0, 200: 90.0}},
        n_columns=2,
        uncalibrated={1},
    )

    raw = _raw_cells(session)

    for depth, cells in raw.items():
        assert cells[1] == "NA", f"未标定列在第 {depth} 层必须是 NA，实得 {cells[1]!r}"
    assert raw[150.0][0] != "NA", "已标定列照常出数（对照，防「整表都 NA」也算过）"

