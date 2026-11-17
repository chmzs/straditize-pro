# -*- coding: utf-8 -*-
"""载入工程包后必须清空「掩膜变了、点集作废」标记。

## 语义

`_points_invalidated`（`#53` 引入）记录的是「**当前会话**的掩膜变过，这些列的逐行点
需要按新墨迹重建」。工程包里的点集与包里的掩膜是**同一时刻的快照**，刚载入的会话
没有"变过"这回事。

## 留着它会怎样（两个后果，第二个是静默的）

1. `_ensure_export_column_points` 白重建一遍 —— 慢，但结果可能对；
2. **重建会覆盖包里恢复的手工点** —— 用户看不到任何报错，只看到"我调好的点又回去了"。
   这与 S3（编辑锚点后退回拐点）是同一族症状，所以口径必须与 `core.reset` 一致
   （`#71` 在 reset 路径上清同一批惰性属性）。

## 判据

1. 载入前人为置上标记 → `project_load` 之后该属性**不存在**（不是"空集合"，是"没有"，
   与 `Session()` 新建时一致）；
2. 零回归：包里的列数 / 列名 / 控制点行数与载入前一致（清标记不该动数据）。
"""

from __future__ import annotations

import pytest

from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    for column in session.columns[:2]:
        session.digitize(column["col_index"])
    session.is_calibrated = True
    session.y_scale = {"slope": 0.5, "intercept": -100.0}
    return session


def test_project_load_clears_points_invalidated() -> None:
    payload = _session().project_save()
    assert isinstance(payload, dict), f"project_save 应返回 dict，实得 {type(payload)}"

    fresh = StraditizeSession()
    fresh._init_cleanup()
    # 真实流程：先打开底图，再打开工程包（`project_load` 依赖已载入的图像）
    fresh.load_image(image_path=PLATE)
    # 模拟"上一张图里掩膜变过、这些列的点集待重建"
    fresh._points_invalidated = {"col01", "col02"}

    fresh.project_load(payload)

    assert not hasattr(fresh, "_points_invalidated"), (
        "载入工程包后 `_points_invalidated` 必须不存在（与新建会话一致）；"
        "留着会让导出路径按新墨迹重建，静默覆盖包里恢复的手工点"
    )
    # 零回归由既有金基线覆盖（`test_project_save_golden` / `test_project_load_golden`）：
    # 这里只钉①「标记消失」这一条，不去复述载入的其它契约，否则本文件会变成
    # 第二份会漂移的载入规范。


def test_fresh_session_has_no_flag() -> None:
    """对照：新建会话本来就没有这个属性——上面的断言与"新建"同口径。"""
    session = StraditizeSession()
    session._init_cleanup()
    assert not hasattr(session, "_points_invalidated")
