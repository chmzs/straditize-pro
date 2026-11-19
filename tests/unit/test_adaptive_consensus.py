"""#124 单元测试：双轨极性分离（防峰谷混同）与局部密度自适应容差（防固定窗口过度合并）。"""

from __future__ import annotations

import numpy as np

from straditize_core.session import StraditizeSession


def _session_with_curves(
    col_pts: dict[int, list[dict]],
) -> StraditizeSession:
    sess = StraditizeSession()
    sess.columns = [
        {
            "id": f"col_{idx}",
            "col_index": idx,
            "start": 10.0 + idx * 50.0,
            "end": 50.0 + idx * 50.0,
            "name": f"Taxa_{idx}",
        }
        for idx in sorted(col_pts)
    ]
    sess.column_points = dict(col_pts)
    return sess


def test_polarity_separation_prevents_peak_valley_confusion():
    """峰谷混同 vs 双轨极性分离：

    - Taxa 0 在 row=100 爆发成峰；
    - Taxa 1 在 row=103 下探成深谷。
    - 混聚模式（mixed）会把相差 3px 的峰与谷拉扯成 row=101.5，产生削峰填谷的虚假共振；
    - 双轨模式（dual）峰归峰 (100, peak)、谷归谷 (103, valley)，独立记录真实生态事件；
    - 仅波峰模式（peaks）只检出 row=100 的花粉爆发面。
    """
    rows = np.arange(0, 200)
    # Taxa 0: row=100 高斯正峰
    xs_0 = 10.0 + 30.0 * np.exp(-(((rows - 100.0) / 4.0) ** 2))
    # Taxa 1: row=103 高斯反向深谷（基线 40，下探 30）
    xs_1 = 40.0 - 30.0 * np.exp(-(((rows - 103.0) / 4.0) ** 2))

    pts_0 = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs_0, strict=True)]
    pts_1 = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs_1, strict=True)]

    sess = _session_with_curves({0: pts_0, 1: pts_1})

    # 1. 双轨模式：峰与谷独立检出
    res_dual = sess.extract_horizon_consensus(
        tolerance_px=4.0, min_taxa_support=1, mode="dual", adaptive_window=False
    )
    assert res_dual["horizons_count"] == 2, res_dual["pixel_y"]
    assert res_dual["pixel_y"] == [100, 103]
    h_peak = next(h for h in res_dual["horizons"] if h["row_px"] == 100)
    h_valley = next(h for h in res_dual["horizons"] if h["row_px"] == 103)
    assert h_peak["polarity"] == "peak"
    assert h_valley["polarity"] == "valley"

    # 2. 仅波峰模式：只提取 row=100
    res_peaks = sess.extract_horizon_consensus(
        tolerance_px=4.0, min_taxa_support=1, mode="peaks", adaptive_window=False
    )
    assert res_peaks["horizons_count"] == 1
    assert res_peaks["pixel_y"] == [100]
    assert res_peaks["horizons"][0]["polarity"] == "peak"

    # 3. 混合兼容模式：两者被容差 4.0px 强制拉扯合并为单个层位
    res_mixed = sess.extract_horizon_consensus(
        tolerance_px=4.0, min_taxa_support=1, mode="mixed", adaptive_window=False
    )
    assert res_mixed["horizons_count"] == 1
    assert res_mixed["pixel_y"] == [101] or res_mixed["pixel_y"] == [102]
    assert res_mixed["horizons"][0]["support_columns"] == 2
    assert res_mixed["horizons"][0]["polarity"] == "mixed"


def test_adaptive_density_window_prevents_over_merging():
    """局部密度自适应容差：

    在密集波动区（点间距 2~3px），固定容差 4.0px 会把两个独立层位误合并；
    而 adaptive_window 自适应缩小容差（~1.2px），能精准分离开相邻真实层位。
    """
    rows = np.arange(0, 300)
    # 构造一条在 100 与 103 处有两个明显独立高斯峰的曲线
    # 两峰之间有 101.5 处的鞍部
    xs = (
        10.0
        + 25.0 * np.exp(-(((rows - 100.0) / 1.5) ** 2))
        + 25.0 * np.exp(-(((rows - 103.5) / 1.5) ** 2))
    )
    pts = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs, strict=True)]

    sess = _session_with_curves({0: pts})

    # 固定 4.0px 容差：把 100 和 103.5 两个峰吃成一个（过度平滑）
    res_fixed = sess.extract_horizon_consensus(
        tolerance_px=4.0, min_taxa_support=1, mode="peaks", adaptive_window=False
    )
    assert res_fixed["horizons_count"] == 1

    # 自适应容差：识别到高密度局部，将 100 和 104（四舍五入）分离成两个独立层位
    res_adaptive = sess.extract_horizon_consensus(
        tolerance_px=4.0, min_taxa_support=1, mode="peaks", adaptive_window=True
    )
    assert res_adaptive["horizons_count"] == 2
    assert 100 in res_adaptive["pixel_y"]
    assert 103 in res_adaptive["pixel_y"] or 104 in res_adaptive["pixel_y"]


def test_dual_mode_micro_overlap_fusion():
    """双轨模式下，若峰与谷极近（<=1px 微抖动），融合为 mixed 节点。"""
    rows = np.arange(0, 150)
    # Taxa 0 在 50.0 处峰，Taxa 1 在 50.8 处谷（相距 0.8px）
    xs_0 = 10.0 + 30.0 * np.exp(-(((rows - 50.0) / 3.0) ** 2))
    xs_1 = 40.0 - 30.0 * np.exp(-(((rows - 50.8) / 3.0) ** 2))

    pts_0 = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs_0, strict=True)]
    pts_1 = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs_1, strict=True)]

    sess = _session_with_curves({0: pts_0, 1: pts_1})

    res = sess.extract_horizon_consensus(
        tolerance_px=2.5, min_taxa_support=1, mode="dual", adaptive_window=False
    )
    # 融合成 1 个层位
    assert res["horizons_count"] == 1
    assert res["pixel_y"] == [50]
    horizon = res["horizons"][0]
    assert horizon["polarity"] == "mixed"
    assert horizon["support_columns"] == 2


def test_samples_extract_consensus_carries_polarity_diagnostic():
    """`samples_extract_consensus` 必须将 `polarity` 原样带入 `samples` 列表。"""
    rows = np.arange(0, 200)
    xs = 10.0 + 30.0 * np.exp(-(((rows - 80.0) / 4.0) ** 2))
    pts = [{"row": int(r), "x": float(x)} for r, x in zip(rows, xs, strict=True)]

    sess = _session_with_curves({0: pts})

    res = sess.samples_extract_consensus(
        tolerance_px=2.5, min_taxa_support=1, mode="peaks", adaptive_window=False
    )
    assert res["count"] >= 1
    sample = res["samples"][0]
    assert sample["source"] == "auto"
    assert sample["polarity"] == "peak"
    assert sample["support_columns"] == 1
