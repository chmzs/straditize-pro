# -*- coding: utf-8 -*-
"""导出默认行集必须是**共识层位（samples）**，且缺行一律 NA——不许给 0。

## 现场（2026-11-15 用户实测，工程 straditize_project_1794746567262）

该工程 samples 35 条（步骤 7 的共识层位），4 列控制点合计 129 个不同 y。
导出面板默认数据集是 union_points，于是：

1. 下载到的 CSV 是 **129 行**（各列拐点 y 的并集），不是用户看到的 35 个层位；
2. 某一列有拐点、其它列没有的行，缺值被写成 **0**：`_ensure_export_column_points`
   给没有控制点的行编了一个「0 点」像素，换算出来就是 0 丰度。

第 2 条比第 1 条更严重：用户会把 0 当成「这一层该属种确实为 0」拿去做百分比与对数变换。

## 判据（本文件钉死的四条）

1. 默认导出行数 == samples 条数，且 != 拐点 y 并集条数；
2. 缺值一律 NA（CSV 里是字面量 NA），不存在由缺失造成的 0 填充；
3. 两列、仅第一列某深度有拐点：该行第二列必须 NA，行数仍等于 samples 数；
4. turning_points 保留但必须显式区分数据集名，默认导出不走它。

## 反向验证

把 `_ensure_export_column_points` 恢复成「缺控制点的行填 c_start」→ 判据 2、3 变红；
把 `_dataset_frame(None)` 改回按控制点并集出行 → 判据 1 变红。
"""

from __future__ import annotations

import io

import pandas as pd

from straditize_core.session import StraditizeSession

#: 拐点 y 的并集：129 个不同行（与现场工程同量级）。
_UNION_ROWS = list(range(100, 229))


def _column(c_idx: int) -> dict:
    return {
        "col_index": c_idx,
        "name": f"col{c_idx + 1:02d}",
        "roi_id": "roi_1",
        # 满量程 100%：px 0 → 0%，px 100 → 100%
        "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
    }


def _session(
    samples_rows: list[int],
    control_points: dict[int, dict[int, float]],
    n_columns: int | None = None,
) -> StraditizeSession:
    session = StraditizeSession()
    session._init_export()
    session.columns = [_column(i) for i in range(n_columns or len(control_points))]
    session.column_points = {}
    session.control_points = control_points
    session.samples = [{"row_px": r, "depth": float(r)} for r in samples_rows]
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    return session


def _csv(session: StraditizeSession, **kwargs) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(session.export_data("csv", **kwargs)["csv"]))


def test_default_export_rows_equal_samples_not_turning_point_union() -> None:
    """判据 1：默认导出行数 = samples 条数，不是各列拐点 y 的并集。"""
    # 四列把 129 个拐点行分摊掉，并集仍是 129 行（与现场工程一致）。
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
        "行序与深度必须与 samples 一一对应"
    )


def test_missing_values_are_na_not_zero() -> None:
    """判据 2：缺行一律 NA，CSV 里不许出现由缺失造成的 0。"""
    # col01 只在 100 / 200 两行有拐点；col02 只在 150 行有。
    control_points = {
        0: {100: 10.0, 200: 90.0},
        1: {150: 50.0},
    }
    session = _session([100, 150, 200], control_points)

    result = session.export_data("csv")
    df = pd.read_csv(io.StringIO(result["csv"]))

    assert "NA" in result["csv"], (
        "CSV 里的缺测必须写成语义无歧义的 NA（空单元格会被下游读成 0 或缺失）"
    )

    by_row = df.set_index("depth")
    # 100 行：col01 有实测点（10px → 10%），col02 没有拐点 → 必须 NA
    assert by_row.loc[100.0, "col01"] == 10.0
    assert pd.isna(by_row.loc[100.0, "col02"]), (
        "第 100 行 col02 没有拐点，必须是 NA，实得 " + str(by_row.loc[100.0, "col02"])
    )
    # 150 行：反过来
    assert pd.isna(by_row.loc[150.0, "col01"])
    assert by_row.loc[150.0, "col02"] == 50.0
    # 200 行：col01 有、col02 没有
    assert by_row.loc[200.0, "col01"] == 90.0
    assert pd.isna(by_row.loc[200.0, "col02"])

    # 全表：任何 0.0 都必须是真读数换算出来的，不能是缺失填充。
    # 本构造里所有实测 x 都 >= 10px（>= 10%），所以数据列出现 0.0 即为填充。
    data_cells = df.drop(columns=["depth"]).to_numpy(dtype=float)
    zeros = int((data_cells == 0.0).sum())
    assert zeros == 0, f"数据列出现 {zeros} 个 0 值：缺失被填成了 0"


def test_two_columns_only_first_has_turning_point() -> None:
    """判据 3：两列、仅第一列某深度有拐点 → 该行第二列 NA，行数仍 = samples 数。"""
    control_points = {
        0: {300: 20.0, 400: 60.0},
        1: {400: 30.0},
    }
    samples_rows = [300, 350, 400]
    session = _session(samples_rows, control_points, n_columns=2)

    df = _csv(session)
    by_row = df.set_index("depth")

    assert len(df) == len(samples_rows), (
        f"行数必须等于 samples 数（{len(samples_rows)}），实得 {len(df)}"
    )
    assert by_row.loc[300.0, "col01"] == 20.0
    assert pd.isna(by_row.loc[300.0, "col02"]), (
        "第 300 行 col02 没有拐点，必须是 NA，实得 " + str(by_row.loc[300.0, "col02"])
    )
    # 350 行两列都没拐点 → 都是 NA，不是 0
    assert pd.isna(by_row.loc[350.0, "col01"]) and pd.isna(by_row.loc[350.0, "col02"])


def test_turning_points_dataset_is_separate_and_not_default() -> None:
    """判据 4：turning_points 保留但显式区分，默认导出不走它。"""
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

    # 默认 == 显式 samples（同一件东西，两个入口不许分叉）
    assert default_df.shape == samples_df.shape
    assert default_df.equals(samples_df), "默认导出行集必须与 dataset=samples 完全一致"

    # turning_points 是长表，形状与语义都不同
    assert {"taxon", "type", "depth", "value", "x", "y"} <= set(turning_df.columns)
    assert len(turning_df) == 3, "拐点清单每个控制点一行（本构造共 3 个控制点）"
    assert "taxon" not in default_df.columns, "默认导出不许是拐点长表"

