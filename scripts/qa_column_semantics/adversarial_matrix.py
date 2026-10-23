# -*- coding: utf-8 -*-
"""QA 独立对抗矩阵 —— 不复用 benchmark_two_axis.py 的实现。

目标：攻击实现者**没测到**的场景。
"""
from __future__ import annotations
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
import numpy as np
from straditize_core.image import split_by_colour_and_luminance

PAPER = (255, 255, 255)
H = 60


def make(width, bands):
    """bands: [(x0,x1,[(colour, x_from, x_to), ...])]"""
    c = np.zeros((H, width, 3), dtype=np.uint8)
    c[...] = PAPER
    for x0, x1, layers in bands:
        for colour, lx0, lx1 in layers:
            c[5:55, max(x0, lx0):min(x1, lx1)] = colour
    edges = [b[0] for b in bands] + [bands[-1][1]]
    return c, edges


def cov(mask, y0, y1, x0, x1):
    return float(mask[y0:y1, x0:x1].mean())


CASES = []


def case(name, canvas, edges, checks):
    solid, shadow = split_by_colour_and_luminance(canvas, column_edges=edges)
    fails = []
    for label, y0, y1, x0, x1, want in checks:
        got = cov(solid, y0, y1, x0, x1)
        if want == "solid" and got < 0.95:
            fails.append(f"{label}: solid 覆盖 {got:.2f} < 0.95")
        if want == "shadow" and got > 0.05:
            fails.append(f"{label}: 漏入 solid {got:.2f} > 0.05")
    CASES.append((name, fails))


# 1. 单-双-单 交错
c, e = make(160, [
    (5, 40, [((0, 0, 0), 5, 40)]),
    (45, 90, [((229, 229, 229), 45, 90), ((182, 182, 182), 45, 70)]),
    (95, 130, [((167, 167, 167), 95, 130)]),
])
case("单-双-单 交错", c, e, [
    ("列0 单层黑", 5, 55, 5, 40, "solid"),
    ("列1 实心", 5, 55, 45, 70, "solid"),
    ("列1 包络", 5, 55, 70, 90, "shadow"),
    ("列2 单层灰", 5, 55, 95, 130, "solid"),
])

# 2. 包络越出所属列（跨到邻列）
c, e = make(160, [
    (10, 60, [((229, 229, 229), 10, 100), ((182, 182, 182), 10, 40)]),
    (60, 110, [((0, 0, 0), 60, 110)]),
    (110, 150, [((167, 167, 167), 110, 150)]),
])
case("包络跨界到单层黑列", c, e, [
    ("列0 实心", 5, 55, 10, 40, "solid"),
    ("列0 自己的包络", 5, 55, 40, 60, "shadow"),
])

# 3. 黑单层 + 灰双层 同图
c, e = make(160, [
    (5, 40, [((0, 0, 0), 5, 40)]),
    (50, 110, [((218, 226, 237), 50, 110), ((0, 62, 137), 50, 80)]),
])
case("黑单层 + 蓝双层", c, e, [
    ("黑单层", 5, 55, 5, 40, "solid"),
    ("蓝实心", 5, 55, 50, 80, "solid"),
    ("蓝包络", 5, 55, 80, 110, "shadow"),
])

# 4. 极窄列（宽 10px）
c, e = make(60, [
    (5, 15, [((182, 182, 182), 5, 15)]),
    (20, 30, [((229, 229, 229), 20, 30), ((167, 167, 167), 20, 25)]),
    (35, 45, [((0, 0, 0), 35, 45)]),
])
case("极窄列(10px)", c, e, [
    ("窄单层灰", 5, 55, 5, 15, "solid"),
    ("窄双层实心", 5, 55, 20, 25, "solid"),
    ("窄双层包络", 5, 55, 25, 30, "shadow"),
    ("窄单层黑", 5, 55, 35, 45, "solid"),
])

# 5. 列边界 ±5px 偏移
c, e = make(160, [
    (5, 40, [((182, 182, 182), 5, 40)]),
    (50, 110, [((229, 229, 229), 50, 110), ((167, 167, 167), 50, 80)]),
])
shifted = [max(0, x - 5) for x in e]
case("列边界左偏5px", c, shifted, [
    ("实心", 5, 55, 50, 80, "solid"),
    ("包络", 5, 55, 85, 105, "shadow"),
])

# 6. 全单层多列（QA 场景放大）
c, e = make(200, [
    (5, 40, [((0, 0, 0), 5, 40)]),
    (50, 90, [((182, 182, 182), 50, 90)]),
    (100, 140, [((215, 215, 215), 100, 140)]),
    (150, 190, [((120, 120, 120), 150, 190)]),
])
case("全单层4列(含215)", c, e, [
    ("黑", 5, 55, 5, 40, "solid"),
    ("中灰182", 5, 55, 50, 90, "solid"),
    ("浅灰215", 5, 55, 100, 140, "solid"),
    ("深灰120", 5, 55, 150, 190, "solid"),
])

# 7. 全双层多列
c, e = make(200, [
    (5, 45, [((244, 226, 226), 5, 45), ((180, 60, 60), 5, 28)]),
    (55, 95, [((218, 226, 237), 55, 95), ((0, 62, 137), 55, 78)]),
    (105, 145, [((229, 229, 229), 105, 145), ((182, 182, 182), 105, 128)]),
])
case("全双层3列(红/蓝/灰)", c, e, [
    ("红实心", 5, 55, 5, 28, "solid"),
    ("红包络", 5, 55, 28, 45, "shadow"),
    ("蓝实心", 5, 55, 55, 78, "solid"),
    ("蓝包络", 5, 55, 78, 95, "shadow"),
    ("灰实心", 5, 55, 105, 128, "solid"),
    ("灰包络", 5, 55, 128, 145, "shadow"),
])

print(f"{'场景':<26}{'结果'}")
npass = 0
for name, fails in CASES:
    if fails:
        print(f"{name:<26}FAIL")
        for f in fails:
            print(f"    {f}")
    else:
        print(f"{name:<26}PASS")
        npass += 1
print()
print(f"QA 对抗矩阵: {npass}/{len(CASES)} PASS")
