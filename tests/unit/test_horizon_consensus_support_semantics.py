"""#82 回归：`min_taxa_support` 必须数**去重后的列数**，不是簇内拐点个数。

两个反例互为对照，缺任何一个判据都没有判别力：

* `test_single_column_adjacent_peaks_are_not_support` —— 单列 3 个相邻峰、
  无其他列。修正前 `len(cl)==3` 会被当成「3 个属种共振」保留，修正后
  `len({col})==1` 必须被过滤掉。**反向验证**：把过滤条件退化为
  `len(cl) >= min_taxa_support`，本测试立刻变红（层位数从 0 变 1）。
* `test_three_columns_one_peak_each_are_supported` —— 三列各 1 个峰、行号相同。
  修正后 `len({col})==3` 必须保留；若把去重写成 `len(cl)` 之外的东西
  （例如只数 peaks 不数 valleys、或漏掉列号）这里会变红。

第三个测试锁定 #83 的诊断量口径（`support_columns` / `cluster_span_px` /
`member_count` 与 `pixel_y` 的对齐关系）。
"""

import numpy as np

from straditize_core.session import StraditizeSession


def _peak_rows(
    centers: tuple[float, ...], sigma: float = 2.5, amp: float = 20.0
) -> list[dict]:
    """构造一条只有若干高斯峰的曲线，返回 `column_points` 需要的形式。"""
    pts: list[dict] = []
    for row in np.arange(0, 300):
        value = 10.0
        for center in centers:
            value += amp * float(np.exp(-(((row - center) / sigma) ** 2)))
        pts.append({"row": int(row), "x": value})
    return pts


def _session(column_points: dict[int, list[dict]]) -> StraditizeSession:
    sess = StraditizeSession()
    # `columns` 只需长度够，避免 extract_horizon_consensus 触发 digitize（无图像可选）。
    sess.columns = [
        {
            "id": f"col_{idx}",
            "col_index": idx,
            "start": 10.0,
            "end": 100.0,
            "name": f"Taxa_{idx}",
        }
        for idx in sorted(column_points)
    ]
    sess.column_points = dict(column_points)
    return sess


def test_single_column_adjacent_peaks_are_not_support():
    """单列 3 个相邻峰（同一容差窗口内）→ support_columns == 1 → support=3 必须过滤。"""
    sess = _session({0: _peak_rows((100.0, 106.0, 112.0))})

    kept = sess.extract_horizon_consensus(
        tolerance_px=8.0, min_taxa_support=1, mode="mixed", adaptive_window=False
    )
    assert kept["horizons_count"] == 1, kept["pixel_y"]
    assert kept["horizons"][0]["support_columns"] == 1, kept["horizons"][0]
    # 拐点成员数确实 ≥3（这正是修正前被误判为「3 列支持」的来源）
    assert kept["horizons"][0]["member_count"] >= 3, kept["horizons"][0]

    filtered = sess.extract_horizon_consensus(
        tolerance_px=8.0, min_taxa_support=3, mode="mixed", adaptive_window=False
    )
    assert filtered["horizons_count"] == 0, filtered["pixel_y"]
    assert filtered["pixel_y"] == []
    assert filtered["horizons"] == []


def test_three_columns_one_peak_each_are_supported():
    """三列各 1 个峰、行号相同 → support_columns == 3 → support=3 必须保留。"""
    pts = _peak_rows((150.0,), sigma=6.0)
    sess = _session({0: list(pts), 1: list(pts), 2: list(pts)})

    res = sess.extract_horizon_consensus(tolerance_px=2.5, min_taxa_support=3)
    assert res["horizons_count"] == 1, res["pixel_y"]
    assert res["pixel_y"] == [150], res["pixel_y"]

    horizon = res["horizons"][0]
    assert horizon["support_columns"] == 3, horizon
    assert horizon["member_count"] == 3, horizon
    assert horizon["cluster_span_px"] == 0, horizon


def test_diagnostics_align_with_pixel_y():
    """#83：`horizons` 逐层诊断量与 `pixel_y` 一一对齐，且支持列数不超过总列数。"""
    pts = _peak_rows((150.0,), sigma=6.0)
    sess = _session({0: list(pts), 1: list(pts), 2: list(pts)})

    res = sess.extract_horizon_consensus(tolerance_px=2.5, min_taxa_support=1)

    assert [h["row_px"] for h in res["horizons"]] == res["pixel_y"]
    for horizon in res["horizons"]:
        assert set(horizon) == {
            "row_px",
            "support_columns",
            "cluster_span_px",
            "member_count",
            "polarity",
        }
        assert 1 <= horizon["support_columns"] <= len(sess.columns)
        assert 0 <= horizon["cluster_span_px"] <= horizon["member_count"]
        assert horizon["member_count"] >= horizon["support_columns"]
    # 旧的 `depths` 口径未变：未标定必须是空列表，不得填 0
    assert res["depths"] == []


def test_consensus_samples_carry_support_diagnostics():
    """#83：诊断量必须一路落到 `samples`，否则画布拿不到 `support_columns`。"""
    pts = _peak_rows((150.0,), sigma=6.0)
    sess = _session({0: list(pts), 1: list(pts), 2: list(pts)})

    res = sess.samples_extract_consensus(tolerance_px=2.5, min_taxa_support=3)

    assert res["count"] == 1, res["samples"]
    sample = res["samples"][0]
    assert sample["source"] == "auto"
    assert sample["depth"] is None  # 未标定不得填 0
    assert sample["support_columns"] == 3, sample
    assert sample["member_count"] == 3, sample
    assert sample["cluster_span_px"] == 0, sample


def test_non_consensus_samples_have_no_diagnostics():
    """粘贴 / 手工 / 网格层位没有共识度，不得写入编造的诊断量。"""
    sess = StraditizeSession()
    res = sess.samples_set(
        [{"row_px": 10, "depth": None, "source": "grid"}], source="grid"
    )

    sample = res["samples"][0]
    assert sample["source"] == "grid"
    assert "support_columns" not in sample
    assert "member_count" not in sample
    assert "cluster_span_px" not in sample
