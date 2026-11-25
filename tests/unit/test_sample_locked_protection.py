# -*- coding: utf-8 -*-
"""issue #86：重跑共识对人工微调与已锁定层位实施锁保护（locked / manual）。

## 缺陷本体
重跑「拐点共识」此前为无条件全量覆盖，用户手动添加或调整过的关键事件层位被瞬间抹除。

## 判据
1. 手动添加或标记 `locked=True` 的层位，在执行 `samples_extract_consensus` 后 100% 留存，行号及属性不变；
2. 新生成的共识层位与受保护层位无缝合并；
3. 当算法提取的共识行与受保护层位落在容差（tolerance_px）内时，优先保留受保护层位，杜绝生成双重重叠线。
"""

from __future__ import annotations

from pathlib import Path
from straditize_core.session import StraditizeSession

HOYA_PATH = Path("straditize_core/assets/tutorials/hoya-del-castillo.png")


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session.load_image(str(HOYA_PATH))
    session.detect_columns([315, 1946], [511, 1311])
    for col in session.columns[:5]:
        session.digitize(col["col_index"])
    session.calibrate_axes(
        y_marks=[{"px": 500.0, "val": 0.0}, {"px": 1300.0, "val": 80.0}],
        unit="cm",
    )
    return session


def test_locked_and_manual_samples_survive_reconsensus() -> None:
    """手动添加或锁定的 3 条层位在重跑共识后完整留存，位置不变。"""
    session = _session()

    # 1. 预设 3 条受保护层位：
    #    - H1: row_px=600, source="manual", locked=True
    #    - H2: row_px=750, source="manual", locked=False (手工来源同样受保护)
    #    - H3: row_px=900, source="auto", locked=True (自动识别后被用户锁定)
    initial_samples = [
        {"row_px": 600, "source": "manual", "locked": True},
        {"row_px": 750, "source": "manual"},
        {"row_px": 900, "source": "auto", "locked": True},
    ]
    session.samples_set(initial_samples)
    assert len(session.samples) == 3

    # 2. 重新提取共识
    res = session.samples_extract_consensus(tolerance_px=3.0, min_taxa_support=1)
    samples = res["samples"]

    # 3. 验证 3 条受保护层位完全存活
    rows = {s["row_px"]: s for s in samples}
    assert 600 in rows, "row 600 必须被保留"
    assert rows[600]["locked"] is True
    assert rows[600]["source"] == "manual"

    assert 750 in rows, "row 750 必须被保留"
    assert rows[750]["source"] == "manual"

    assert 900 in rows, "row 900 必须被保留"
    assert rows[900]["locked"] is True

    # 且算法新生成的层位也并入了列表中
    assert len(samples) > 3


def test_conflict_suppression_for_protected_horizons() -> None:
    """若算法提取的共识点与受保护层位落在 tolerance_px 范围内，优先保留保护项，不造重复行。"""
    session = _session()

    # 假设已知算法会在某处提取点，我们在 row_px=650 设一个锁定项
    session.samples_set([{"row_px": 650, "source": "manual", "locked": True}])

    # 跑共识
    res = session.samples_extract_consensus(tolerance_px=5.0, min_taxa_support=1)
    samples = res["samples"]

    # 检查 row_px 在 [645, 655] 区间内仅有且只有 1 个层位，且正是我们的受保护层位
    near_items = [s for s in samples if abs(s["row_px"] - 650) <= 5.0]
    assert len(near_items) == 1, f"冲突区间内不应产生重复层位，实际得到: {near_items}"
    assert near_items[0]["row_px"] == 650
    assert near_items[0]["source"] == "manual"
