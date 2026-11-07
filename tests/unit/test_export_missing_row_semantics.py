# -*- coding: utf-8 -*-
"""导出在「某行没有数字化点」时必须是 `0`（无墨迹），**不许插值**。

## 为什么这条判据非写不可

`digitize` 的读取器遍历列窗口的**每一行**（`_read_column_profile` 的
`for row_y in range(y0, y1 + 1)`），只有该行真的有墨迹才产出点。所以：

- 窗口内缺行 ⇔ **这一行没有墨迹** ⇔ 丰度真值就是 0；
- 导出据此填 `0 点`（`px_to_value(baseline)`）换算成 0，是**正确**的。

看上去"稀疏数据应该插值"很自然，但那会给"曲线真的归零"的层位**编造**一个非零读数——
与占位 CSV、伪造 5× 放大是同一类错误。本文件把这个语义钉死：任何把缺行改成插值的
改动都必须先让这条变红，再由作者证明他知道自己在做什么。

## 反向验证

把 `_export_value_columns` 里的 `p_dict.get(r, baseline_px)` 换成按上下行 `np.interp`，
本条立刻红（期望 0，实得 30 左右）。
"""

from __future__ import annotations

import io

import pandas as pd

from straditize_core.session import StraditizeSession


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.columns = [
        {
            "col_index": 0,
            "name": "col01",
            "roi_id": "roi_1",
            # 满量程 100%：px 0 → 0%，px 100 → 100%
            "x_ticks": [
                {"px": 0.0, "value": 0.0},
                {"px": 100.0, "value": 100.0},
            ],
        }
    ]
    session.column_points = {
        0: [
            {"row": 10, "x": 10.0},
            {"row": 20, "x": 50.0},
            {"row": 30, "x": 90.0},
        ]
    }
    # 行 15 在 10 与 20 之间，但**没有**数字化点 = 该行无墨迹。
    session.samples = [
        {"row_px": 10, "depth": 10.0},
        {"row_px": 15, "depth": 15.0},
        {"row_px": 20, "depth": 20.0},
        {"row_px": 30, "depth": 30.0},
    ]
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    return session


def test_missing_row_exports_zero_not_interpolated() -> None:
    df = pd.read_csv(io.StringIO(_session().export_data("csv")["csv"]))

    values = dict(zip(df["depth"], df["col01"]))

    assert values[15.0] == 0.0, (
        f"第 15 行没有墨迹，必须导出 0（无墨迹=零丰度），实得 {values[15.0]}；"
        "插值会在这里编造一个非零读数"
    )
    # 对照：有数字化点的行照常换算（10px → 10%）
    assert values[10.0] == 10.0
    assert values[20.0] == 50.0
