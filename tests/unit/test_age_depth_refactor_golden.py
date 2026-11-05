# -*- coding: utf-8 -*-
"""`extract_age_depth_model` 的输出快照（重构前的行为基线）。

## 为什么先有它，再动结构

这个函数 677 行、是后端最长的流水线，拆它必然要挪动变量与执行顺序。
现有 `test_age_depth_extraction_quality.py` 断言的是**容差内的质量**（误差 ≤ 若干年），
它容忍小幅漂移——对重构恰恰不够：一次"看起来无害"的等价改写就能让曲线偏几像素，
质量测试仍然全绿。

所以这里钉**逐元素快照**：同样的图 + 同样的标定，重构前后输出数组必须完全相同
（round 到 9 位小数后逐项相等，容差 0）。重构时任何等价性偏差都会当场红。

重新生成（只在**有意**改变算法时）：

    UPDATE_AGE_DEPTH_GOLDEN=1 .pixi/envs/default/python.exe -m pytest \
        tests/unit/test_age_depth_refactor_golden.py
"""

import json
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from straditize_core.age_depth import AgeDepthAxisCalibrator, extract_age_depth_model

FRAME_X0, FRAME_Y0 = 110, 60
FRAME_X1, FRAME_Y1 = 800, 1000
AGE_AT_X0, AGE_AT_X1 = 7000.0, 0.0
DEPTH_AT_Y0, DEPTH_AT_Y1 = 0.0, 500.0

GOLDEN = Path(__file__).parent / "fixtures" / "age_depth_extraction_golden.json"


def _calibrator() -> AgeDepthAxisCalibrator:
    return AgeDepthAxisCalibrator(
        depth_px=[FRAME_Y0, FRAME_Y1],
        depth_vals=[DEPTH_AT_Y0, DEPTH_AT_Y1],
        age_px=[FRAME_X0, FRAME_X1],
        age_vals=[AGE_AT_X0, AGE_AT_X1],
        depth_unit="cm",
        age_unit="cal BP",
    )


def _render(*, stroke) -> Image.Image:
    """白色底 + 坐标框 + 一条带正弦扰动的折线，并挖掉几段制造断线（触发插值分支）。"""
    img = Image.new("RGB", (900, 1100), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.rectangle([FRAME_X0, FRAME_Y0, FRAME_X1, FRAME_Y1], outline=(0, 0, 0), width=2)

    n = 400
    ys = np.linspace(FRAME_Y0 + 5, FRAME_Y1 - 5, n)
    frac = (ys - FRAME_Y0) / (FRAME_Y1 - FRAME_Y0)
    xs = FRAME_X0 + 60 + (FRAME_X1 - FRAME_X0 - 120) * frac + 25.0 * np.sin(frac * 6.0)
    pts = [(float(x), float(y)) for x, y in zip(xs, ys)]
    draw.line(pts, fill=stroke, width=3)

    # 挖掉几段：虚线/断点必须由插值补回，这条分支也要被快照覆盖
    for start in range(0, n - 6, 40):
        draw.line(pts[start : start + 5], fill=(255, 255, 255), width=7)
    return img


CASES = {
    "black_stroke": lambda: _render(stroke=(0, 0, 0)),
    "red_stroke": lambda: _render(stroke=(220, 20, 20)),
}


def _round(values) -> list:
    return [round(float(v), 9) for v in np.asarray(values, dtype=float).ravel()]


def _snapshot(model) -> dict:
    return {
        "depths": _round(model.depths),
        "ages": _round(model.ages),
        "age_min": _round(model.age_min),
        "age_max": _round(model.age_max),
        "px_y": _round(model.px_y),
        "px_x_curve": _round(model.px_x_curve),
        "px_x_min": _round(model.px_x_min),
        "px_x_max": _round(model.px_x_max),
        "curve_channel": model.curve_channel,
        "observed_row_fraction": model.observed_row_fraction,
        "age_increases_downcore": bool(model.age_increases_downcore),
    }


def _collect() -> dict:
    out = {}
    for name, factory in CASES.items():
        out[name] = _snapshot(extract_age_depth_model(factory(), _calibrator()))
    return out


def test_extraction_snapshot_is_stable():
    """同图同标定 → 输出逐元素不变（容差 0）。"""
    snapshot = _collect()

    if os.environ.get("UPDATE_AGE_DEPTH_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True) + "\n", encoding="utf-8"
        )
        return

    assert GOLDEN.exists(), f"缺少基线文件 {GOLDEN}；用 UPDATE_AGE_DEPTH_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert snapshot.keys() == expected.keys(), "快照用例集合变了"
    for name in expected:
        for field, want in expected[name].items():
            got = snapshot[name][field]
            if isinstance(want, list):
                assert got == want, (
                    f"{name}.{field} 与基线不一致：长度 {len(got)} vs {len(want)}，"
                    f"首个差异位 {next((i for i, (a, b) in enumerate(zip(got, want)) if a != b), None)}"
                )
            else:
                assert got == want, f"{name}.{field} 与基线不一致：{got!r} vs {want!r}"
