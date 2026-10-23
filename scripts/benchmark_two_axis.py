# -*- coding: utf-8 -*-
"""双轴分层的**量化基准扫描** —— 改进前先钉死靶子。

## 为什么需要它

`layer-fixer` 报告里说"我的实现 10/16"，Lead 的固定阈值 8/16。
但那是**人工枚举的 16 张图**，且判定只有 PASS/FAIL 两态，
看不出"错在哪个方向、错多少"。

本模块给出**可复现的扫描矩阵**：
  · 维度一：纸白（白纸 / 米色扫描纸 / 偏灰纸）
  · 维度二：实心明度（黑 0 / 深 60 / 中 120 / 中灰 182 / 浅 215）
  · 维度三：阴影相对实心的落差（+15 / +30 / +45 / +60 / +80）
  · 维度四：配色（纯灰阶 / 暖彩 / 冷彩）

每个组合都输出两个数：
  · `solid_recall` —— 实心层被正确提取的比例（**低 = 少读，墨迹丢失**）
  · `shadow_leak` —— 阴影层被误当实心的比例（**高 = 多读，读数被放大**）

**两个方向的危害不等价**：`shadow_leak` 是 `docs/ARCHITECTURE.md` §2 禁止的
"返回替代数据"形态，且用户无法察觉；`solid_recall` 低则曲线消失，肉眼可见。
所以扫描结果按"多读优先"排序。

用法：
    pixi run python scripts/benchmark_two_axis.py
    pixi run python scripts/benchmark_two_axis.py --json   # 机器可读
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np  # noqa: E402

from straditize_core.image import split_by_colour_and_luminance  # noqa: E402

SIZE = 40
SOLID_BOX = (5, 30, 4, 20)   # y0, y1, x0, x1
SHADOW_BOX = (5, 30, 20, 36)

#: 纸白档：纯白、常见米色扫描纸、偏灰的旧扫描件。
PAPERS = {
    "white": (255, 255, 255),
    "cream": (240, 240, 232),
    "grey_paper": (232, 232, 232),
}

#: 实心的**相对纸白明度比**（rel = lum / paper）。0.0 = 纯黑，1.0 = 纸。
#: 真实图版实测：实心 182/255 = 0.714，包络 229/255 = 0.898。
SOLID_RELS = (0.00, 0.25, 0.45, 0.60, 0.72, 0.85)

#: 包络的**相对纸白明度比**。必须 > 对应实心的 rel（包络是实心的淡版本）。
#: 上界 0.97：再高就贴到纸上，不成一层。
SHADOW_RELS = (0.75, 0.82, 0.88, 0.93, 0.97)

#: 判为「两层可分离」所需的最小相对明度差。
#:
#: 依据：低于它的两层在视觉上几乎同色（例：实心 rel 0.60、包络 rel 0.65），
#: 任何阈值都切不开，硬切只会把其中一层整个错判 —— 这种组合**不计入失败**，
#: 而是单列为「物理不可分」，避免用不可达的目标污染通过率。
MIN_SEPARABLE_REL_GAP = 0.06

#: 配色族。`grey` 三通道相等；`warm`/`cool` 给实心与阴影各加一点色偏，
#: 模拟真实图版里"深红实心 + 浅粉包络"这种同色相不同明度的情形。
HUES = {
    "grey": ((0, 0, 0), (0, 0, 0)),
    "warm": ((120, -60, -60), (18, -18, -18)),
    "cool": ((-60, -62, 137), ((-8, 0, 19))),
}


def _make(paper, solid_rel, shadow_rel, solid_delta, shadow_delta):
    """Build a three-layer canvas from **relative** luminance.

    ``rel`` is relative to the paper, so a cream scan and a white scan of the
    same figure produce the same rel values — which is exactly the property the
    two-axis rule claims to have.
    """
    canvas = np.zeros((SIZE, SIZE, 3), dtype=np.uint8)
    canvas[...] = paper
    paper_lum = sum(paper) / 3.0

    def paint(rel, delta):
        base = rel * paper_lum
        rgb = (base + delta[0], base + delta[1], base + delta[2])
        return tuple(int(np.clip(v, 0, 255)) for v in rgb)

    solid = paint(solid_rel, solid_delta)
    shadow = paint(shadow_rel, shadow_delta)
    y0, y1, x0, x1 = SOLID_BOX
    canvas[y0:y1, x0:x1] = solid
    y0, y1, x0, x1 = SHADOW_BOX
    canvas[y0:y1, x0:x1] = shadow
    return canvas, solid, shadow



# ---------------------------------------------------------------------------
# 混合图场景：同一张图版里并存「单层列」与「双层列」
# ---------------------------------------------------------------------------
# 这是真实图版的常态（Han2026 有 15 个双层花粉列 + 浓度折线等单层元素；
# 内建教程图则整体是单层）。全图直方图分不开两类列，必须按列。

#: 混合图的列布局：(x0, x1, 角色)
#:
#: ⚠️ 这里必须复刻**真实图版的形态**：双层列里，实心与包络**在同一列内**，
#: 包络是画得更宽的 5× 版本（Han2026 Fig.3 的形态 —— QA 实测浅层/深层跨度比
#: 中位数 5.61）。第一版基准把包络做成独立的一列，那是不存在的场景，
#: 于是测出了假的失败率。
#:
#:   "single" = 单层墨迹列（黑线白底，如内建教程图）
#:   "double" = 双层列：窄的实心条 + 其外围更宽的包络，同一 x 范围
MIXED_LAYOUT = [
    (0, 40, "single"),
    (40, 80, "double"),
    (80, 120, "single"),
    (120, 160, "double"),
]
MIXED_SIZE = (60, 160)

#: 双层列内，实心条与包络的宽度（像素）。包络更宽 = 5× 夸张的视觉形态。
DOUBLE_SOLID_WIDTH = 12
DOUBLE_SHADOW_WIDTH = 30


def _mixed_figure(paper, single_lum, solid_rel, shadow_rel):
    """Build a figure with single-layer and two-layer columns side by side.

    In a ``double`` column the solid bar sits at the left edge of the column
    (as in the real figure, where fills grow from the column baseline) and the
    wider envelope surrounds it to the right.
    """
    height, width = MIXED_SIZE
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    canvas[...] = paper
    paper_lum = sum(paper) / 3.0
    solid_value = int(np.clip(solid_rel * paper_lum, 0, 255))
    shadow_value = int(np.clip(shadow_rel * paper_lum, 0, 255))
    for x0, x1, role in MIXED_LAYOUT:
        if role == "single":
            value = int(np.clip(single_lum, 0, 255))
            canvas[10:50, x0 + 2 : x1 - 2] = value
        else:
            # 包络先铺满（更宽），实心再盖在其左段上。
            canvas[10:50, x0 + 2 : x0 + 2 + DOUBLE_SHADOW_WIDTH] = shadow_value
            canvas[10:50, x0 + 2 : x0 + 2 + DOUBLE_SOLID_WIDTH] = solid_value
    edges = [x0 for x0, _x1, _r in MIXED_LAYOUT] + [MIXED_LAYOUT[-1][1]]
    return canvas, edges


def run_mixed_scan() -> list[dict]:
    """Scan figures where single-layer and two-layer columns coexist.

    Each record reports, **per column role**, whether the rule got it right.
    A rule that only works on homogeneous figures fails here.
    """
    records = []
    for paper_name, paper in PAPERS.items():
        for single_lum in (0, 90, 150):
            for solid_rel in (0.30, 0.50, 0.72):
                for shadow_rel in (0.80, 0.88, 0.95):
                    if shadow_rel <= solid_rel:
                        continue
                    canvas, edges = _mixed_figure(paper, single_lum, solid_rel, shadow_rel)
                    solid_mask, _shadow_mask = split_by_colour_and_luminance(
                        canvas, column_edges=edges)
                    single_ok = []
                    solid_ok = []
                    shadow_ok = []
                    for x0, _x1, role in MIXED_LAYOUT:
                        if role == "single":
                            box = (10, 50, x0 + 2, x0 + 36)
                            single_ok.append(_coverage(solid_mask, box) >= 0.95)
                        else:
                            # 实心段：列起点 +2 .. +2+SOLID_WIDTH
                            solid_box = (10, 50, x0 + 2, x0 + 2 + DOUBLE_SOLID_WIDTH)
                            solid_ok.append(_coverage(solid_mask, solid_box) >= 0.95)
                            # 包络独有段：实心右边界 .. 包络右边界
                            shadow_box = (10, 50,
                                          x0 + 2 + DOUBLE_SOLID_WIDTH,
                                          x0 + 2 + DOUBLE_SHADOW_WIDTH)
                            shadow_ok.append(_coverage(solid_mask, shadow_box) <= 0.05)
                    ok_single = all(single_ok)
                    ok_solid = all(solid_ok)
                    ok_shadow = all(shadow_ok)
                    records.append({
                        "paper": paper_name,
                        "single_lum": single_lum,
                        "solid_rel": solid_rel,
                        "shadow_rel": shadow_rel,
                        "single_kept": ok_single,
                        "solid_kept": ok_solid,
                        "shadow_excluded": ok_shadow,
                        "all_ok": ok_single and ok_solid and ok_shadow,
                    })
    return records


def _coverage(mask, box):
    y0, y1, x0, x1 = box
    return float(mask[y0:y1, x0:x1].mean())


def run_scan() -> list[dict]:
    """Run the full matrix and return one record per combination."""
    records = []
    for paper_name, paper in PAPERS.items():
        for solid_rel in SOLID_RELS:
            for shadow_rel in SHADOW_RELS:
                if shadow_rel <= solid_rel:
                    continue  # 包络必须比实心淡
                separable = (shadow_rel - solid_rel) >= MIN_SEPARABLE_REL_GAP
                for hue_name, (solid_delta, shadow_delta) in HUES.items():
                    canvas, solid_rgb, shadow_rgb = _make(
                        paper, solid_rel, shadow_rel, solid_delta, shadow_delta)
                    if np.array_equal(solid_rgb, shadow_rgb):
                        continue
                    solid_mask, _shadow_mask = split_by_colour_and_luminance(canvas)
                    records.append({
                        "paper": paper_name,
                        "solid_rel": solid_rel,
                        "shadow_rel": shadow_rel,
                        "rel_gap": round(shadow_rel - solid_rel, 3),
                        "separable": separable,
                        "hue": hue_name,
                        "solid_rgb": list(solid_rgb),
                        "shadow_rgb": list(shadow_rgb),
                        "solid_recall": round(_coverage(solid_mask, SOLID_BOX), 4),
                        "shadow_leak": round(_coverage(solid_mask, SHADOW_BOX), 4),
                    })
    return records


def summarise(records: list[dict]) -> dict:
    """Pass/fail **只统计物理可分离的组合**，并单列不可分离的。

    把不可分离组合排除在通过率之外，是为了让靶子可达：两层若相对明度差
    小于 ``MIN_SEPARABLE_REL_GAP``，任何阈值都切不开，把它算作失败等于
    要求算法做它做不到的事。这类组合单列，供人工判断是否需要提示用户。
    """
    sep = [r for r in records if r["separable"]]
    unsep = [r for r in records if not r["separable"]]
    leaks = [r for r in sep if r["shadow_leak"] > 0.05]
    losses = [r for r in sep if r["solid_recall"] < 0.95]
    both_ok = [r for r in sep if r["shadow_leak"] <= 0.05 and r["solid_recall"] >= 0.95]
    return {
        "total": len(records),
        "separable": len(sep),
        "unseparable": len(unsep),
        "both_ok": len(both_ok),
        "pass_rate": round(len(both_ok) / max(len(sep), 1), 4),
        "over_read": len(leaks),      # 多读：危险方向
        "under_read": len(losses),    # 少读：可见方向
        "over_read_cases": leaks,
        "under_read_cases": losses,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="机器可读输出")
    parser.add_argument("--failures", action="store_true", help="只列失败组合")
    args = parser.parse_args()

    records = run_scan()
    summary = summarise(records)
    mixed = run_mixed_scan()
    mixed_ok = [r for r in mixed if r["all_ok"]]

    if args.json:
        print(json.dumps({"summary": {k: v for k, v in summary.items()
                                      if not k.endswith("_cases")},
                          "mixed": {"total": len(mixed), "all_ok": len(mixed_ok)},
                          "records": records,
                          "mixed_records": mixed}, ensure_ascii=False, indent=2))
        return 0

    print(f"扫描组合数: {summary['total']}  "
          f"（其中物理可分离 {summary['separable']}，不可分离 {summary['unseparable']}）")
    print(f"  可分离组合通过率: {summary['pass_rate']:.1%}  "
          f"（{summary['both_ok']} / {summary['separable']}）")
    print(f"  多读（阴影漏进实心，危险）: {summary['over_read']}")
    print(f"  少读（实心被丢弃）:         {summary['under_read']}")
    print()

    if mixed:
        print(f"混合图（单层列 + 双层列并存）: {len(mixed_ok)} / {len(mixed)} 全对  "
              f"({len(mixed_ok) / max(len(mixed), 1):.1%})")
        bad = [r for r in mixed if not r["all_ok"]]
        if bad:
            print(f"  失败 {len(bad)} 例，前 6 例：")
            for r in bad[:6]:
                print(f"    paper={r['paper']:<10} single_lum={r['single_lum']:<4} "
                      f"solid_rel={r['solid_rel']:<5} shadow_rel={r['shadow_rel']:<5} "
                      f"单层保留={r['single_kept']} 实心保留={r['solid_kept']} "
                      f"包络排除={r['shadow_excluded']}")
        print()

    if summary["over_read_cases"]:
        print("=== 多读组合（按泄漏比例降序，这是优先要修的）===")
        for r in sorted(summary["over_read_cases"], key=lambda x: -x["shadow_leak"])[:20]:
            print(f"  paper={r['paper']:<10} solid_rel={r['solid_rel']:<5} "
                  f"shadow_rel={r['shadow_rel']:<5} gap={r['rel_gap']:<5} "
                  f"hue={r['hue']:<5} leak={r['shadow_leak']:.2f} "
                  f"recall={r['solid_recall']:.2f}")
        print()

    if args.failures and summary["under_read_cases"]:
        print("=== 少读组合（实心被丢弃）===")
        for r in sorted(summary["under_read_cases"], key=lambda x: x["solid_recall"])[:20]:
            print(f"  paper={r['paper']:<10} solid_rel={r['solid_rel']:<5} "
                  f"shadow_rel={r['shadow_rel']:<5} gap={r['rel_gap']:<5} "
                  f"hue={r['hue']:<5} recall={r['solid_recall']:.2f} "
                  f"leak={r['shadow_leak']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
