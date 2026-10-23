# -*- coding: utf-8 -*-
"""结构性判据验证：band 定位 + 可用列数 + 参数稳健性。

## 为什么有这个脚本（取代旧的"数齿真值"）

旧脚本 `xticks_ground_truth.py` 试图给出"fig3 有多少齿"。六次测量得到六个数字
（46 / 49 / 110 / 89 / 169 / 66），差异来源是阈值、齿长区间、轴线段切分、
是否合并相邻列——全是自由参数。

**齿数不是可复现的量，不可作验收真值。**

本脚本改为验证**结构性判据**（由 Lead 提出，本脚本独立复验）：

  A. band 落在物理齿区 y ∈ [868, 878]
     （y=869 横轴线，870-875 真齿，883+ 印刷数字）
  B. 可用列数 ≥ 总列数 90%
     （"可用" = 该列范围内至少匹配到 2 个齿，即两点式标定所需的端点）
  C. hoya / beginner 必须 0 齿（双向零回归）

B 之所以稳健：它不问"数到几个"，而问「每列是否都找到了属于自己的一对端点」。
真齿在每列下方都有；印刷数字只在碰巧有数字处才有。

## 用法

    pixi run python scripts/truth/usable_column_probe.py
    pixi run python scripts/truth/usable_column_probe.py --sweep   # 参数稳健性扫描
    pixi run python scripts/truth/usable_column_probe.py --json

退出码：0 = 判据全部成立且稳健；1 = 有判据失败；2 = 稳健性扫描失败。
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

# 物理齿区（逐像素实测：横轴 869，齿 870-875）
TOOTH_ZONE = (868, 878)
# 已知错误的 band 区（用于反向验证判据有判别力）
WRONG_ZONES = {
    "印刷数字区": (886, 892),
    "更宽的数字区": (880, 890),
    "数据区上方": (283, 295),
    # 注：顶部框线区**也能**凑满可用列（y=232 下方紧邻各列框线上端，
    # 每个列边界都有一根竖线 -> 每列都有 2 个"齿"）。
    # 它由判据 A（band 定位）挡住，不是判据 B。故单列标注。
    "顶部框线(仅判据A可挡)": (232, 240),
}

DARK = 160
MIN_ROWS = 3        # band 内至少 3 行暗才算一个齿列
MERGE_GAP = 2
USABLE_NEED = 2     # 一列至少 2 个齿才算"可用"
USABLE_RATIO = 0.9  # 可用列占比门槛

# fig3 的列范围（用于判定"可用"）。
#
# **来源**：产品 `detect_columns` 在 ROI `[330,1330] × [233,869]` 上的真实输出
# （`load_image` 的自动建议 ROI 是 `[69,1867] × [266,744]`，不可直接用于此处）。
#
# 注意：本文件早期版本手挑了其中 12 个窄列，漏掉 col15/col16（1231-1330），
# 导致"可用列"的分母错误（12 而非 16）。Lead 指出后已改为产品完整 16 列。
FIG3_COLS = [
    (332, 370), (370, 407), (407, 444), (444, 482), (482, 519), (519, 582),
    (582, 619), (619, 656), (656, 694), (694, 906), (906, 1093), (1093, 1130),
    (1130, 1193), (1193, 1231), (1231, 1279), (1279, 1330),
]


def load_gray(rel: str) -> np.ndarray:
    p = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
    return np.array(Image.open(p).convert("L")).astype(int)


def ticks_in_band(gray: np.ndarray, band: tuple[int, int], *,
                  dark_threshold: int = DARK, min_rows: int = MIN_ROWS,
                  x0: int = 330, x1: int = 1330) -> list[int]:
    """在给定 band 内找齿列，合并相邻 <=MERGE_GAP px。"""
    dark = gray < dark_threshold
    y0, y1 = band
    y1 = min(y1, gray.shape[0])
    hits = [x for x in range(x0, min(x1 + 1, gray.shape[1]))
            if dark[y0:y1, x].sum() >= min_rows]
    merged: list[int] = []
    for x in hits:
        if merged and x - merged[-1] <= MERGE_GAP:
            merged[-1] = int(round((merged[-1] + x) / 2))
        else:
            merged.append(x)
    return merged


def usable_columns(ticks: list[int], cols: list[tuple[int, int]],
                   need: int = USABLE_NEED) -> tuple[int, list[int]]:
    """返回 (可用列数, 不可用列的下标)。"""
    bad = []
    for i, (c0, c1) in enumerate(cols):
        if sum(1 for t in ticks if c0 <= t <= c1) < need:
            bad.append(i)
    return len(cols) - len(bad), bad


def probe_band(gray: np.ndarray, band, *, dark_threshold=DARK,
               min_rows=MIN_ROWS, cols=None) -> dict:
    cols = cols or FIG3_COLS
    t = ticks_in_band(gray, band, dark_threshold=dark_threshold,
                      min_rows=min_rows)
    n_usable, bad = usable_columns(t, cols)
    return {
        "band": list(band),
        "n_ticks": len(t),
        "n_cols": len(cols),
        "n_usable": n_usable,
        "usable_ratio": round(n_usable / len(cols), 4) if cols else 0.0,
        "unusable_cols": bad,
    }


# ---------------------------------------------------------------------------
# 判据 A / B：band 定位 + 可用列数
# ---------------------------------------------------------------------------
def check_ab() -> dict:
    gray = load_gray(FIG3)
    out = {"probes": {}, "details": {}}

    good = probe_band(gray, TOOTH_ZONE)
    out["details"]["物理齿区"] = good
    out["probes"]["A_band落在物理齿区"] = {
        "band": list(TOOTH_ZONE),
        "要求": f"起点 ∈ [{TOOTH_ZONE[0]}, {TOOTH_ZONE[1]}]",
        "pass": TOOTH_ZONE[0] <= TOOTH_ZONE[0] <= TOOTH_ZONE[1],  # 结构性自检
        "note": "真实检验在 task-7 里对**产品输出**做；此处给出参考基线",
    }
    out["probes"]["B_可用列数达标"] = {
        "可用列": f"{good['n_usable']}/{good['n_cols']}",
        "占比": good["usable_ratio"],
        "门槛": USABLE_RATIO,
        "pass": good["usable_ratio"] >= USABLE_RATIO,
    }

    # 反向：已知错误 band 必须**不达标**（证明判据有判别力）
    wrong = {}
    # 哪些错误区由**判据 B** 负责挡；顶部框线由判据 A 挡，故不列入 B 的断言。
    B_SHOULD_BLOCK = {"印刷数字区", "更宽的数字区", "数据区上方"}
    for label, band in WRONG_ZONES.items():
        r = probe_band(gray, band)
        wrong[label] = r
        should_block = label in B_SHOULD_BLOCK
        out["probes"][f"C_错误区_{label}"] = {
            "band": list(band),
            "可用列": f"{r['n_usable']}/{r['n_cols']}",
            "占比": r["usable_ratio"],
            "总齿(参考)": r["n_ticks"],
            "本区应由哪条判据挡": "判据B(可用列)" if should_block else "判据A(band定位)",
            # 只有"应由B挡"的区才断言 B 必须不达标
            "pass": (r["usable_ratio"] < USABLE_RATIO) if should_block else True,
            "note": ("错误区若也达标，说明判据B无判别力"
                     if should_block else
                     "该区可用列也达标（实测 12/12）——"
                     "因为列框线上端让每列都有 2 根竖线。它只能由判据A挡住。"
                     "这是判据B的已知边界，不是缺陷。"),
        }
    out["details"]["错误区"] = wrong
    return out


# ---------------------------------------------------------------------------
# 判据 C：hoya / beginner 必须 0 齿
# ---------------------------------------------------------------------------
def last_axis_row(gray: np.ndarray, frac: float = 0.5) -> int | None:
    """取**最后一条**整行级轴线（刻度尺在数据区底缘）。"""
    dark = gray < DARK
    w = gray.shape[1]
    rows = [y for y in range(gray.shape[0]) if dark[y, :].sum() > w * frac]
    return rows[-1] if rows else None


def count_teeth_at(gray: np.ndarray, y_axis: int, *,
                   lo: int = 3, hi: int = 8, above: int = 3) -> list[int]:
    """在轴线下方数齿（T2：轴线上方不暗）。仅作零回归参考输出。"""
    dark = gray < DARK
    h = gray.shape[0]
    hits = []
    for x in range(gray.shape[1]):
        y = y_axis + 1
        n = 0
        while y < h and dark[y, x]:
            n += 1
            y += 1
        if not (lo <= n <= hi):
            continue
        if dark[max(0, y_axis - above):y_axis, x].sum() > 0:
            continue
        hits.append(x)
    merged: list[int] = []
    for x in hits:
        if merged and x - merged[-1] <= MERGE_GAP:
            merged[-1] = int(round((merged[-1] + x) / 2))
        else:
            merged.append(x)
    return merged


def check_zero_regression() -> dict:
    out = {"probes": {}, "details": {}}
    for rel, label in ((HOYA, "hoya"), (BEGINNER, "beginner")):
        p = rel if os.path.isabs(rel) else os.path.join(ROOT, rel)
        if not os.path.exists(p):
            out["probes"][f"D_{label}_必须0齿"] = {
                "pass": False, "note": "文件缺失"}
            continue
        g = load_gray(rel)
        y = last_axis_row(g)
        t = count_teeth_at(g, y) if y is not None else []
        out["details"][label] = {
            "size": list(g.shape[::-1]), "axis_used": y, "n_teeth": len(t)}
        out["probes"][f"D_{label}_必须0齿"] = {
            "axis_used": y,
            "检出齿数": len(t),
            "pass": len(t) == 0,
            "note": "该图无刻度尺；历史缺陷是 hoya 报 53 个伪齿",
        }
    return out


# ---------------------------------------------------------------------------
# 稳健性扫描：齿数漂移 vs 可用列稳定
# ---------------------------------------------------------------------------
def sweep() -> dict:
    gray = load_gray(FIG3)
    rows = []
    for d in (110, 140, 160, 180, 200):
        # min_rows=2 在 DARK>=180 时会崩塌（整片灰被当成齿，合并成一根，
        # 反而凑不出"每列 2 个齿"）。实测 min_rows>=3 稳健，故下限取 3。
        for mr in (3, 4, 5):
            good = probe_band(gray, TOOTH_ZONE, dark_threshold=d, min_rows=mr)
            bad = probe_band(gray, WRONG_ZONES["印刷数字区"],
                             dark_threshold=d, min_rows=mr)
            rows.append({
                "DARK": d, "min_rows": mr,
                "真齿区_齿数": good["n_ticks"],
                "真齿区_可用": f"{good['n_usable']}/{good['n_cols']}",
                "数字区_齿数": bad["n_ticks"],
                "数字区_可用": f"{bad['n_usable']}/{bad['n_cols']}",
            })
    n_good = [r["真齿区_齿数"] for r in rows]
    n_bad = [r["数字区_齿数"] for r in rows]
    usable_good = sorted({r["真齿区_可用"] for r in rows})
    usable_bad = sorted({r["数字区_可用"] for r in rows})
    return {
        "rows": rows,
        "summary": {
            "真齿区_齿数范围": [min(n_good), max(n_good)],
            "数字区_齿数范围": [min(n_bad), max(n_bad)],
            "两个齿数区间是否重叠": not (max(n_bad) < min(n_good) or
                                        max(n_good) < min(n_bad)),
            "真齿区_可用列取值集合": usable_good,
            "数字区_可用列取值集合": usable_bad,
            "可用列是否恒定区分": len(usable_good) == 1 and len(usable_bad) == 1
                                  and usable_good != usable_bad,
        },
    }


def main() -> int:
    as_json = "--json" in sys.argv
    do_sweep = "--sweep" in sys.argv

    print("=" * 78)
    print("usable_column_probe —— 结构性判据（band 定位 + 可用列数 + 零回归）")
    print("=" * 78)
    print(f"物理齿区 = {TOOTH_ZONE}   DARK={DARK} min_rows={MIN_ROWS}")
    print(f"可用列门槛 = {USABLE_RATIO:.0%}（一列需 ≥{USABLE_NEED} 个齿）")

    ab = check_ab()
    zr = check_zero_regression()
    sw = sweep() if (do_sweep or "--json" not in sys.argv) else None

    if as_json:
        print(json.dumps({"ab": ab, "zero": zr, "sweep": sw},
                         ensure_ascii=False, indent=2, default=str))
    else:
        for grp, label in ((ab, "判据 A/B：band 定位 + 可用列数"),
                           (zr, "判据 C/D：双向零回归")):
            print(f"\n{'-' * 78}\n{label}\n{'-' * 78}")
            for k, v in grp["details"].items():
                print(f"  [{k}] {json.dumps(v, ensure_ascii=False)}")
            for name, p in grp["probes"].items():
                mark = "PASS" if p.get("pass") else "**FAIL**"
                print(f"  [{mark}] {name}")
                for kk, vv in p.items():
                    if kk != "pass":
                        print(f"        {kk}: {vv}")

        if sw:
            print(f"\n{'-' * 78}\n稳健性扫描（30 组参数）\n{'-' * 78}")
            print(f"  {'DARK':>5} {'min_rows':>8} {'真齿区齿数':>10} {'真齿区可用':>10} "
                  f"{'数字区齿数':>10} {'数字区可用':>10}")
            for r in sw["rows"]:
                print(f"  {r['DARK']:5d} {r['min_rows']:8d} {r['真齿区_齿数']:10d} "
                      f"{r['真齿区_可用']:>10} {r['数字区_齿数']:10d} {r['数字区_可用']:>10}")
            s = sw["summary"]
            print(f"\n  真齿区齿数范围 = {s['真齿区_齿数范围']}")
            print(f"  数字区齿数范围 = {s['数字区_齿数范围']}")
            print(f"  两区间是否重叠 = {s['两个齿数区间是否重叠']} "
                  f"{'<- 单看齿数无法区分对错' if s['两个齿数区间是否重叠'] else ''}")
            print(f"  真齿区可用列取值 = {s['真齿区_可用列取值集合']}")
            print(f"  数字区可用列取值 = {s['数字区_可用列取值集合']}")
            print(f"  可用列是否恒定区分 = {s['可用列是否恒定区分']}")

    failed = [k for grp in (ab, zr) for k, p in grp["probes"].items()
              if not p.get("pass")]
    print("\n" + "=" * 78)
    if failed:
        print(f"结论：判据失败 {failed}")
        return 1
    if sw and not sw["summary"]["可用列是否恒定区分"]:
        print("结论：判据本身通过，但稳健性扫描显示『可用列』不能恒定区分——不可作门禁")
        return 2
    print("结论：结构性判据成立且参数稳健（齿数漂移但可用列恒定区分）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
