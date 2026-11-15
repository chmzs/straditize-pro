# -*- coding: utf-8 -*-
"""步骤 7 探索实验：亚像素边缘（B1）与最优 L-infinity 分段（B2）。

只做测量，不改核心实现。运行：

    python support/explore_step7_bench.py

输出：逐 (图, reader, 列) 的一行 CSV 到 stdout，可直接拼成对照表。
"""
from __future__ import annotations

import sys
import time

import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

from straditize_core.curve import rdp_vertical  # noqa: E402
from straditize_core.session import StraditizeSession  # noqa: E402
from straditize_core.session_parts.xscale import resolve_axis_stroke  # noqa: E402

EPS = 2.0
READERS = ("area", "line", "bar")
INK_THRESHOLD = 160.0
EDGE_WINDOW = 2

IMAGES = [
    ("type1_filled_silhouette", "tests/data/figures/benchmark_types/type1_filled_silhouette_aber.png", None, None),
    ("type2_exaggeration_bell", "tests/data/figures/benchmark_types/type2_exaggeration_bell.png", None, None),
    ("type3_discrete_bars", "tests/data/figures/benchmark_types/type3_discrete_bars_bell.png", None, None),
    ("type4_pure_line", "tests/data/figures/benchmark_types/type4_pure_line_proxy.png", None, None),
    ("type5_presence_symbols", "tests/data/figures/benchmark_types/type5_presence_symbols.png", None, None),
    ("type6_composite_zonation", "tests/data/figures/benchmark_types/type6_composite_zonation_cluster.png", None, None),
    ("diatom_rioja", "tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png", None, None),
    ("pollen_rioja", "tests/data/figures/benchmark_types/Pollen_riojaPlotTestData.png", None, None),
    ("pollen_barstyle", "tests/data/figures/benchmark_types/Pollen_BarStyle_riojaPlotTestData.png", None, None),
    ("pollen_curvestyle", "tests/data/figures/benchmark_types/Pollen_CruveStyle_riojaPlotTestData.png", None, None),
    ("scan01_hlines", "tests/data/corpus/raw/01_chinese_scanned_hlines.png", None, None),
    ("scan02_multicolor", "tests/data/corpus/raw/02_muricuo_multicolor_dual_y.jpg", None, None),
    ("scan03_vertical_strip", "tests/data/corpus/raw/03_lough_inchiquin_vertical_strip.jpg", None, None),
    ("scan04_two_tier", "tests/data/corpus/raw/04_elsevier_two_tier_coniss.jpg", None, None),
    ("scan05_hatched", "tests/data/corpus/raw/05_scanned_hatched_lithology.jpg", None, None),
    ("fig3_raw", "tests/data/figures/real_plates/fig3_raw.jpeg", [330, 1330], [233, 869]),
    ("tutorial_beginner", "straditize_core/assets/tutorials/beginner-tutorial.png", None, None),
    ("tutorial_hoya", "straditize_core/assets/tutorials/hoya-del-castillo.png", None, None),
]


# ---------- B2: 最优 L-infinity 分段（Imai-Iri 1988, 最少顶点） ----------
def imai_iri(rows: np.ndarray, values: np.ndarray, epsilon: float) -> list[int]:
    """区间 DP：给出 max|线性重构 - 原值| <= epsilon 的最少顶点分段。

    对每个起点 i，用斜率走廊向右扩到失效，得到全部可行终点 [i, reach[i]]，
    再在可行区间上做最短路 DP。走廊随 j 单调收紧，因此 reach 只需扫一遍。
    """
    n = len(rows)
    if n <= 2:
        return list(range(n))
    reach = np.zeros(n, dtype=int)
    for i in range(n - 1):
        lo, hi = -np.inf, np.inf
        best = i + 1
        for j in range(i + 1, n):
            dx = rows[j] - rows[i]
            slope = (values[j] - values[i]) / dx
            lo2 = max(lo, slope - epsilon / dx)
            hi2 = min(hi, slope + epsilon / dx)
            if lo2 > hi2:
                break
            lo, hi = lo2, hi2
            # 可行还要求**弦本身的斜率**落在走廊内（否则弦会超出 epsilon）
            if not (lo - 1e-12 <= slope <= hi + 1e-12):
                break
            best = j
        reach[i] = best

    inf = n + 1
    cost = np.full(n, inf)
    prev = np.full(n, -1)
    cost[0] = 0
    for j in range(1, n):
        for i in range(j):
            if reach[i] >= j and cost[i] + 1 < cost[j]:
                cost[j] = cost[i] + 1
                prev[j] = i
    keep = [n - 1]
    while keep[-1] != 0:
        nxt = prev[keep[-1]]
        if nxt < 0:
            return list(range(n))
        keep.append(int(nxt))
    return sorted(keep)


# ---------- B1: 亚像素边缘 ----------
def subpixel_profile(gray: np.ndarray, c_start: int, c_end: int, y0: int, y1: int):
    """逐行右缘的亚像素位置（梯度加权一阶矩），返回 (widths, flags)。"""
    sub = gray[y0:y1 + 1, c_start:c_end].astype(np.float64)
    gy, gx = np.gradient(sub)
    ink = sub < INK_THRESHOLD
    widths = np.full(sub.shape[0], np.nan)
    flags = np.zeros(sub.shape[0], dtype=int)  # 0 ok, 1 无墨, 2 断点/多段, 3 梯度太弱
    for r in range(sub.shape[0]):
        idx = np.where(ink[r])[0]
        if not len(idx):
            widths[r] = 0.0
            flags[r] = 1
            continue
        last = int(idx[-1])
        # 断点：墨迹分成两段且间隔 > 4px（符号/虚线/网格线）
        gaps = np.diff(idx)
        if len(gaps) and int(gaps.max()) > 4:
            flags[r] = 2
        lo = max(0, last - EDGE_WINDOW)
        hi = min(sub.shape[1] - 1, last + EDGE_WINDOW + 1)
        weight = np.abs(gx[r, lo:hi + 1])
        total = float(weight.sum())
        if total < 1e-6:
            widths[r] = float(last + 1)
            flags[r] = 3
            continue
        xs = np.arange(lo, hi + 1, dtype=np.float64) + 0.5
        widths[r] = float((weight * xs).sum() / total)
    return widths, flags


def ev(profile: np.ndarray, keep: list[int]) -> tuple[int, float, float]:
    rows = np.arange(len(profile), dtype=float)
    rec = np.interp(rows, rows[keep], profile[keep])
    err = np.abs(rec - profile)
    return len(keep), float(np.percentile(err, 95)), float(err.max())


def jitter(profile: np.ndarray) -> tuple[float, float]:
    d = np.diff(profile[np.isfinite(profile)])
    if not len(d):
        return 0.0, 0.0
    return float(np.abs(d).mean()), float(d.std())


def run() -> None:
    print("image,reader,col,c_start,c_end,nrows,col_span,mean_dw,std_dw,"
          "cur_n,cur_p95,cur_max,"
          "vrdp_n,vrdp_p95,vrdp_max,vrdp_ms,"
          "dp_n,dp_p95,dp_max,dp_ms,"
          "sub_mean_dw,sub_std_dw,sub_vrdp2_n,sub_vrdp2_p95,sub_vrdp2_max,"
          "sub_vrdp1_n,sub_vrdp1_p95,sub_fail_rows,sub_fail_kind")
    for name, path, xlim, ylim in IMAGES:
        try:
            session = StraditizeSession()
            session._init_cleanup()
            session.load_image(image_path=path)
            if xlim:
                session.detect_columns(data_xlim=xlim, data_ylim=ylim)
            else:
                session.detect_columns()
        except Exception as exc:  # noqa: BLE001
            print(f"# {name}: detect_columns FAILED {type(exc).__name__}: {exc}", file=sys.stderr)
            continue
        spans = [round(c.get("end")) - round(c.get("start")) for c in session.columns]
        if not spans:
            continue
        order = sorted(range(len(spans)), key=lambda i: spans[i])
        picks = sorted({order[0], order[len(order) // 2], order[-1]})
        gray = np.asarray(session.image.convert("L"))
        hlines = set(getattr(session, "hline_rows", []) or [])
        for col_index in picks:
            for reader in READERS:
                try:
                    res = session.digitize(col_index, reader_type=reader)
                except Exception as exc:  # noqa: BLE001
                    print(f"# {name}/{reader}/col{col_index}: digitize FAILED "
                          f"{type(exc).__name__}: {exc}", file=sys.stderr)
                    continue
                pts = res["points"]
                if not pts:
                    continue
                col = session.columns[col_index]
                c_start = round(col.get("start"))
                c_end = round(col.get("end"))
                zero = float(resolve_axis_stroke(col, None))
                rows = np.asarray([p["row"] for p in pts], dtype=float)
                raw = np.asarray([p["x"] for p in pts], dtype=float) - c_start
                prof = np.clip(raw, zero, None)
                mean_dw, std_dw = jitter(prof)

                ctrl = session.control_points[col_index]
                crows = np.asarray(sorted(ctrl), dtype=float)
                cvals = np.asarray([ctrl[r] for r in sorted(ctrl)], dtype=float) - c_start
                rec = np.interp(rows, crows, cvals)
                err = np.abs(rec - prof)
                cur = (len(ctrl), float(np.percentile(err, 95)), float(err.max()))

                t0 = time.perf_counter()
                k_v = rdp_vertical(rows, prof, EPS)
                t_v = (time.perf_counter() - t0) * 1000
                vrdp = ev(prof, list(k_v))

                t0 = time.perf_counter()
                k_dp = imai_iri(rows, prof, EPS)
                t_dp = (time.perf_counter() - t0) * 1000
                dp = ev(prof, list(k_dp))

                y0 = int(rows[0])
                y1 = int(rows[-1])
                w_sub, flags = subpixel_profile(gray, c_start, c_end, y0, y1)
                fail_rows = int(np.sum((flags != 0) | np.array([1 if int(r) in hlines else 0 for r in rows], dtype=bool)))
                kinds = sorted({int(f) for f in flags if int(f) != 0})
                sub_prof = np.where(np.isfinite(w_sub), np.maximum(w_sub - 1.0, zero), prof)
                sub_mean_dw, sub_std_dw = jitter(sub_prof)
                k_s2 = rdp_vertical(rows, sub_prof, EPS)
                s2 = ev(sub_prof, list(k_s2))
                k_s1 = rdp_vertical(rows, sub_prof, 1.0)
                s1 = ev(sub_prof, list(k_s1))
                print(f"{name},{reader},{col_index},{c_start},{c_end},{len(rows)},{c_end - c_start},"
                      f"{mean_dw:.3f},{std_dw:.3f},"
                      f"{cur[0]},{cur[1]:.2f},{cur[2]:.2f},"
                      f"{vrdp[0]},{vrdp[1]:.2f},{vrdp[2]:.2f},{t_v:.0f},"
                      f"{dp[0]},{dp[1]:.2f},{dp[2]:.2f},{t_dp:.0f},"
                      f"{sub_mean_dw:.3f},{sub_std_dw:.3f},"
                      f"{s2[0]},{s2[1]:.2f},{s2[2]:.2f},"
                      f"{s1[0]},{s1[1]:.2f},"
                      f"{fail_rows},{"+".join(str(k) for k in kinds) if kinds else 'none'}")


if __name__ == "__main__":
    run()
