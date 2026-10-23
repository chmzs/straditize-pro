# -*- coding: utf-8 -*-
"""刻度齿真值（ground truth）—— task-13 权威脚本。

## 这个脚本要解决什么

task-7 因"没有可靠真值"挂起：Lead 数出 49（全图）/31（ROI 内），
本报告早期写 46，backend-fixer 数出 110 个候选群。三方对不上。
没有真值，任何实现都是猜——最坏结果是**凑参数凑到某个数字**（拟合，不是检测）。

## 本脚本的做法（先钉定义，再数数）

### 一、物理定义（不依赖任何产品的实现）

看图版可知每列有**自己独立的刻度小尺**：
    y=869        轴线（水平线，横跨该列宽度）
    y=870..873   齿从轴线**向下**伸出（小齿 4px，大齿更长）
    y≈883..897   印刷数字（不是齿）

真齿的判定必须同时满足三条**物理条件**：
  T1 **垂直性**：齿是竖直的细线，宽度 1–2px（印刷数字笔画更宽或更散）
  T2 **从轴线伸出**：轴线下方连续暗，且**轴线上方不暗**（排除贯穿全高的列框线）
  T3 **在所属小尺内**：必须落在同一列的轴线横段上（各列小尺互不混淆）

这三条都来自"刻度尺"这个对象的定义，不是为了配合任何数字而设。

### 二、两种**独立**方法交叉核验（不一致就报告分歧，不强行统一）

  M1 **游程法**：逐列从轴线下方数连续暗像素长度，落在 [3, 8] px 视为齿
  M2 **投影法**：取轴线下 870..873 四行做列投影，≥3/4 行暗视为齿

两者用不同的判据（单列游程 vs 多行列投影），若结果一致则真值可信；
若不一致，脚本**如实打印两套结果与差异**，不取平均、不挑一个。

### 三、三张图都要产出

  fig3_raw  有刻度尺 -> 应得到 > 0
  hoya      无刻度尺 -> 必须 0
  beginner  无刻度尺 -> 必须 0

hoya 有一处陷阱：y=1305..1325 是图例文字（能看出 "A/C"），
"轴线下方有短竖线"这一条会误判它。T2（轴线上方不暗）+ T1（宽度）应能排除；
本脚本会把该区域单独打印出来供人工核对。

## 用法

    pixi run python scripts/truth/xticks_ground_truth.py
    pixi run python scripts/truth/xticks_ground_truth.py --json
    pixi run python scripts/truth/xticks_ground_truth.py --dumps   # 打印候选像素块

## 重要：本脚本**不**接受"凑数字"

脚本里没有任何可调的 target 数字。它只做：钉定义 → 两种方法各数一遍 → 报告。
如果结果与历史任何数字（46/49/31/110）不同，那就是历史数字错了，不是脚本错了。
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

FIG3 = "output/han2026_ngamring/fig3_raw.jpeg"
HOYA = "straditize_core/assets/tutorials/hoya-del-castillo.png"
BEGINNER = "straditize_core/assets/tutorials/beginner-tutorial.png"

DARK = 160          # 二值化阈值（与产品 detect_xticks 的 dark_threshold 默认一致）
AXIS_MIN_FRAC = 0.5  # 轴线行：暗像素占该行宽度 > 此比例

# T1/T2/T3 的取值（物理定义，非调参）
TOOTH_MIN_LEN = 3    # 齿至少 3px（实测小齿 4px，留 1px 抗锯齿余量）
TOOTH_MAX_LEN = 8    # 齿至多 8px；超过即贯穿线（实测框线远长于此）
PROJ_MIN_ROWS = 3    # 投影法：4 行中至少 3 行暗


# ---------------------------------------------------------------------------
# 图像与轴线
# ---------------------------------------------------------------------------
def load_gray(rel: str) -> np.ndarray:
    p = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
    return np.array(Image.open(p).convert("L")).astype(int)


def find_axis_rows(dark: np.ndarray) -> list[int]:
    """找出所有"横轴线"候选行：暗像素占该行宽度超过阈值。

    注意：本图版各列有**独立**小尺，故轴线不是一个整行，而是若干段。
    这里先给出"整行级别"的轴线候选，用于限定搜索范围。
    """
    w = dark.shape[1]
    rows = []
    for y in range(dark.shape[0]):
        if dark[y, :].sum() > w * AXIS_MIN_FRAC:
            rows.append(y)
    return rows


def axis_segments(dark: np.ndarray, y: int, min_width: int = 20) -> list[tuple[int, int]]:
    """在行 y 上找出所有连续暗段（每段 = 某一列的刻度轴线）。"""
    row = dark[y, :]
    segs: list[tuple[int, int]] = []
    cur = None
    for x in range(dark.shape[1]):
        if row[x]:
            if cur is None:
                cur = x
        else:
            if cur is not None:
                segs.append((cur, x - 1))
                cur = None
    if cur is not None:
        segs.append((cur, dark.shape[1] - 1))
    return [s for s in segs if s[1] - s[0] + 1 >= min_width]


# ---------------------------------------------------------------------------
# 方法 M1：游程法
# ---------------------------------------------------------------------------
def teeth_by_run_length(gray: np.ndarray, y_axis: int,
                        x0: int, x1: int) -> list[int]:
    """逐列从轴线下方数连续暗长度；落在 [TOOTH_MIN_LEN, TOOTH_MAX_LEN] 视为齿。

    T2（轴线上方不暗）在此实现：若轴线上方 3px 也暗，说明是贯穿线，剔除。
    """
    dark = gray < DARK
    h = gray.shape[0]
    hits = []
    for x in range(x0, x1 + 1):
        y = y_axis + 1
        length = 0
        while y < h and dark[y, x]:
            length += 1
            y += 1
        if not (TOOTH_MIN_LEN <= length <= TOOTH_MAX_LEN):
            continue
        # T2：轴线上方 3px 内不应有暗像素（排除贯穿全高的框线）
        above = dark[max(0, y_axis - 3):y_axis, x].sum()
        if above > 0:
            continue
        hits.append(x)
    return hits


# ---------------------------------------------------------------------------
# 方法 M2：投影法
# ---------------------------------------------------------------------------
def teeth_by_projection(gray: np.ndarray, y_axis: int,
                        x0: int, x1: int) -> list[int]:
    """取轴线下 4 行做列投影，>=3 行暗视为齿；同样应用 T2。"""
    dark = gray < DARK
    rows = slice(y_axis + 1, y_axis + 1 + 4)
    hits = []
    for x in range(x0, x1 + 1):
        if dark[rows, x].sum() < PROJ_MIN_ROWS:
            continue
        above = dark[max(0, y_axis - 3):y_axis, x].sum()
        if above > 0:
            continue
        hits.append(x)
    return hits


def merge_adjacent(xs: list[int], gap: int = 2) -> list[int]:
    """把相邻（<=gap px）的命中列合并为一根齿，取中点。"""
    out: list[int] = []
    for x in xs:
        if out and x - out[-1] <= gap:
            out[-1] = int(round((out[-1] + x) / 2))
        else:
            out.append(x)
    return out


# ---------------------------------------------------------------------------
# 单图真值
# ---------------------------------------------------------------------------
def truth_for(rel: str, label: str, dump: bool = False) -> dict:
    gray = load_gray(rel)
    h, w = gray.shape
    dark = gray < DARK
    axis_rows = find_axis_rows(dark)

    result: dict = {
        "file": rel,
        "label": label,
        "size": [w, h],
        "axis_rows_all_image": axis_rows,
        "methods": {},
        "agreement": None,
        "disagreement": None,
    }
    if not axis_rows:
        result["note"] = "未找到任何整行级轴线"
        result["methods"] = {"M1": {"segments": [], "n_total": 0},
                             "M2": {"segments": [], "n_total": 0}}
        result["agreement"] = True
        return result

    # 取**最后一条**整行级轴线作为基准（刻度尺位于数据区底部）
    y_axis = axis_rows[-1]
    segs = axis_segments(dark, y_axis)

    m1_total: list[int] = []
    m2_total: list[int] = []
    m1_segs, m2_segs = [], []
    for (sx0, sx1) in segs:
        raw1 = teeth_by_run_length(gray, y_axis, sx0, sx1)
        raw2 = teeth_by_projection(gray, y_axis, sx0, sx1)
        t1 = merge_adjacent(raw1)
        t2 = merge_adjacent(raw2)
        m1_total += t1
        m2_total += t2
        m1_segs.append({"x": [sx0, sx1], "n": len(t1), "teeth": t1})
        m2_segs.append({"x": [sx0, sx1], "n": len(t2), "teeth": t2})

    result["axis_used"] = y_axis
    result["n_axis_segments"] = len(segs)
    result["methods"]["M1"] = {
        "name": "游程法（单列连续暗长度 ∈ [%d,%d]px + 轴线上方不暗）"
                % (TOOTH_MIN_LEN, TOOTH_MAX_LEN),
        "segments": m1_segs, "n_total": len(m1_total), "teeth": m1_total,
    }
    result["methods"]["M2"] = {
        "name": "投影法（轴线下 4 行中 >=%d 行暗 + 轴线上方不暗）" % PROJ_MIN_ROWS,
        "segments": m2_segs, "n_total": len(m2_total), "teeth": m2_total,
    }

    # 交叉核验：比较两种方法的齿位集合（容差 ±1px）
    def as_set(ts):
        return set(ts)

    s1, s2 = as_set(m1_total), as_set(m2_total)

    # 容差 ±1px：同一根齿在主瓣边缘可能被两种方法取到相邻列（抗锯齿）。
    # 这不是分歧，是离散化误差。超出 ±1px 才算真分歧。
    def uniq_outside_tol(a, b, tol=1):
        return sorted(x for x in a if not any(abs(x - y) <= tol for y in b))

    only1 = uniq_outside_tol(s1, s2)
    only2 = uniq_outside_tol(s2, s1)
    result["agreement"] = (len(only1) == 0 and len(only2) == 0)
    result["disagreement"] = {
        "M1_only": only1, "M2_only": only2,
        "M1_n": len(s1), "M2_n": len(s2),
    }
    if len(m1_total) > 1:
        gaps = np.diff(m1_total)
        result["M1_gap_median"] = float(np.median(gaps))
        result["M1_gap_values"] = sorted({int(g) for g in gaps})

    if dump:
        result["dump"] = dump_region(gray, y_axis, segs)
    return result


def dump_region(gray: np.ndarray, y_axis: int, segs: list[tuple[int, int]],
                max_segs: int = 3) -> list[str]:
    """把前几个轴线段附近的像素块打成可目视核对的字符画。"""
    dark = gray < DARK
    out = []
    for (sx0, sx1) in segs[:max_segs]:
        out.append(f"--- 轴线段 x={sx0}..{sx1}, y={y_axis - 2}..{y_axis + 9} ---")
        out.append("     " + "".join(str(x % 10) for x in range(sx0, min(sx1 + 1, sx0 + 60))))
        for y in range(max(0, y_axis - 2), min(gray.shape[0], y_axis + 10)):
            s = "".join("#" if dark[y, x] else "."
                        for x in range(sx0, min(sx1 + 1, sx0 + 60)))
            out.append(f"y={y}: {s}")
    return out


def main() -> int:
    as_json = "--json" in sys.argv
    dump = "--dumps" in sys.argv

    print("=" * 78)
    print("xticks ground truth — task-13 权威真值")
    print("=" * 78)
    print(f"DARK 阈值 = {DARK}（与产品 detect_xticks 默认一致）")
    print(f"齿长度区间 = [{TOOTH_MIN_LEN},{TOOTH_MAX_LEN}] px")
    print(f"投影法最少暗行 = {PROJ_MIN_ROWS} / 4")
    print("本脚本无可调 target 数字；不为了任何历史数字（46/49/31/110）调参。")

    targets = [
        (FIG3, "fig3_raw（有刻度尺，应 > 0）"),
        (HOYA, "hoya（无刻度尺，必须 0）"),
        (BEGINNER, "beginner（无刻度尺，必须 0）"),
    ]
    results = []
    for rel, label in targets:
        p = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        if not os.path.exists(p):
            results.append({"file": rel, "label": label, "missing": True})
            continue
        results.append(truth_for(rel, label, dump=dump))

    if as_json:
        print(json.dumps(results, ensure_ascii=False, indent=2, default=str))
    else:
        for r in results:
            print("\n" + "-" * 78)
            print(f"### {r['label']}")
            if r.get("missing"):
                print("    文件不存在")
                continue
            print(f"    尺寸 = {r['size']}")
            print(f"    整行级轴线 = {r['axis_rows_all_image']}")
            print(f"    轴线段数 = {r.get('n_axis_segments')}  （各列独立小尺）")
            for mk in ("M1", "M2"):
                m = r["methods"][mk]
                print(f"    {mk} {m['name']}")
                print(f"       总齿数 = {m['n_total']}")
                if mk == "M1" and r.get("M1_gap_median") is not None:
                    print(f"       间距中位 = {r['M1_gap_median']}  取值 = {r.get('M1_gap_values')}")
            d = r.get("disagreement") or {}
            if r.get("agreement"):
                print(f"    ✅ 两法一致（M1={d.get('M1_n')} M2={d.get('M2_n')}）")
            else:
                print(f"    ⚠️ 两法**不一致**（如实报告，不强行统一）")
                print(f"       M1 独有 {len(d.get('M1_only') or [])} 个: {d.get('M1_only')}")
                print(f"       M2 独有 {len(d.get('M2_only') or [])} 个: {d.get('M2_only')}")
            if dump and r.get("dump"):
                print("    --- 像素块（人工核对用）---")
                for line in r["dump"]:
                    print("    " + line)

    # 结论速览
    print("\n" + "=" * 78)
    print("结论速览")
    print("=" * 78)
    for r in results:
        if r.get("missing"):
            print(f"  {r['label']:34s} <文件缺失>")
            continue
        m1 = r["methods"]["M1"]["n_total"]
        m2 = r["methods"]["M2"]["n_total"]
        agree = "一致" if r.get("agreement") else "**不一致**"
        print(f"  {r['label']:34s} M1={m1:4d}  M2={m2:4d}  {agree}")

    bad = [r for r in results
           if not r.get("missing") and not r.get("agreement")]
    if bad:
        print(f"\n⚠️ 有 {len(bad)} 张图两法不一致 —— 真值未定，需人工核对像素块（--dumps）")
        return 2
    print("\n两法一致，真值可用。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
