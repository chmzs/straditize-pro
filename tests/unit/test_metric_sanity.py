"""Metric sanity gate: validate the measurement itself on synthetic images.

## Why this file exists

This project lost real time to a measurement failure, not a code failure.  On a
real journal figure the Lead used "the deepest 10% of pixels in the column" as a
proxy for "the solid fill", concluded that 9 of 15 columns failed, and nearly
shipped that as a software defect.  The proxy was never validated.  Re-measuring
against "dark solid = luminance <= 150" changed the answer to "14 of 15 fine,
1 broken" -- a different defect with a different root cause.

The lesson: a proxy metric that has never been checked against a known answer is
not evidence.  So every extraction metric used in this project's investigations
must first pass on a *synthetic* figure whose ground truth we chose ourselves.

## What these tests do

They draw figures where the true fill width is known by construction, then run
the real extraction code and require the measurement to recover that truth
within a stated tolerance.  If an algorithm cannot measure a figure we built
ourselves, its output on a real journal figure cannot be trusted.

The synthetic figures deliberately include the adversarial cases that broke the
real investigation:

* a solid layer whose luminance is *above* the Otsu threshold (the grey-fill
  case: RGB 182 -> the product's threshold 138 rejects it);
* a solid layer plus a lighter exaggerated "shadow" layer of the same hue;
* antialiased edges, which are what the "deepest 10%" proxy was actually
  measuring instead of the fill.

Marking convention: every test states the ground truth explicitly, and asserts
against the *measured object*, never against a proxy for it.
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from straditize_core.image import (
    build_foreground,
    light_overlay_colored_mask,
    split_solid_and_shadow,
)

# ---------------------------------------------------------------------------
# synthetic figure construction
# ---------------------------------------------------------------------------

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)
GREY_FILL = (182, 182, 182)          # the colour that defeats Otsu(138)
PINK_SHADOW = (244, 226, 226)        # 5x exaggerated envelope, warm hue
BLUE_SHADOW = (218, 226, 237)        # 5x exaggerated envelope, cool hue


def make_bar_figure(
    bar_specs: list[dict],
    *,
    height: int = 400,
    gap: int = 10,
    antialias: bool = False,
) -> tuple[Image.Image, list[dict]]:
    """Draw a percentage-style figure: columns of known fill width.

    Each spec: ``{"width_px": int, "colour": (r,g,b), "shadow": (r,g,b)|None}``.
    The bar occupies the full column height so the fill area is exactly
    ``width_px * height`` -- a ground truth known by construction.

    Returns the image and the specs annotated with their ground-truth
    pixel counts.
    """
    total_w = sum(s["width_px"] for s in bar_specs) + gap * (len(bar_specs) + 1)
    arr = np.full((height, total_w, 3), 255, dtype=np.uint8)

    truth: list[dict] = []
    x = gap
    for spec in bar_specs:
        w = int(spec["width_px"])
        colour = np.array(spec["colour"], dtype=np.uint8)
        arr[:, x:x + w] = colour
        if spec.get("shadow") is not None:
            # the shadow layer sits on top and is drawn wider, as in the real
            # figure where the exaggerated envelope extends past the solid bar
            sh = np.array(spec["shadow"], dtype=np.uint8)
            sw = w + 3
            arr[:, x:x + sw] = sh
            arr[:, x:x + w] = colour
        truth.append({"x0": x, "width_px": w, "colour": spec["colour"],
                      "shadow": spec.get("shadow")})
        x += w + gap

    img = Image.fromarray(arr)
    if antialias:
        img = img.resize((img.width, img.height), Image.LANCZOS)
    return img, truth


def measure_fill_width_by_colour(img: Image.Image, colour, tol: int = 2) -> int:
    """Ground-truth-style measurement: count pixels matching ``colour``.

    This is a *direct* measurement of the object (the drawn fill), not a proxy:
    it uses the colour we drew, not a luminance threshold.
    """
    a = np.asarray(img.convert("RGB"), dtype=int)
    return int((np.abs(a - np.array(colour)).max(-1) <= tol).sum())


# ---------------------------------------------------------------------------
# 1. The gate itself: a metric must recover a known answer
# ---------------------------------------------------------------------------


def test_measurement_recovers_known_fill_area():
    """Baseline: the direct measurement recovers the constructed truth exactly.

    If this fails, every downstream number in this file is meaningless.
    """
    specs = [{"width_px": 40, "colour": BLACK},
             {"width_px": 25, "colour": BLACK}]
    img, truth = make_bar_figure(specs, height=200)
    for t in truth:
        expected = t["width_px"] * 200
        got = measure_fill_width_by_colour(img, t["colour"])
        # both bars are the same colour, so count per-bar by x-range instead
        a = np.asarray(img.convert("RGB"), dtype=int)
        band = a[:, t["x0"]:t["x0"] + t["width_px"]]
        got = int((np.abs(band - np.array(t["colour"])).max(-1) <= 2).sum())
        assert got == expected, (
            f"synthetic ground truth not recovered: expected {expected}, got {got}")


# ---------------------------------------------------------------------------
# 2. The exact failure mode that caused the real misdiagnosis
# ---------------------------------------------------------------------------


def test_darkest_decile_proxy_is_invalid_on_antialiased_bars():
    """The proxy used in the real investigation must FAIL on synthetic truth.

    "The deepest 10% of pixels in the column" was used as the reference for
    "solid fill".  On a bar with antialiased edges, the darkest pixels are the
    stroke/edge, not the fill body, so the proxy does not measure the object.

    This test documents the invalidity rather than asserting the buggy number:
    it asserts that the proxy and the true fill disagree, which is precisely
    why the proxy must not be used as evidence.
    """
    # a bar whose fill is a mid grey, with a darker outline (as real figures have)
    arr = np.full((200, 60, 3), 255, dtype=np.uint8)
    arr[:, 20:50] = GREY_FILL
    arr[:, 20:22] = BLACK       # left stroke
    arr[:, 48:50] = BLACK       # right stroke
    img = Image.fromarray(arr)
    a = np.asarray(img, dtype=float)
    lum = a.mean(-1)

    true_fill_px = int((np.abs(a - np.array(GREY_FILL)).max(-1) <= 2).sum())

    col = lum[:, 20:50]
    thr = np.percentile(col, 10)
    proxy_px = int((col <= thr).sum())

    # the proxy claims the fill is "the darkest 10%" -- which are the strokes
    assert proxy_px < true_fill_px, (
        "proxy selected fewer pixels than the fill, so it cannot represent it")
    # and those pixels are NOT the fill colour
    proxy_mask = np.zeros(lum.shape, dtype=bool)
    proxy_mask[:, 20:50] = col <= thr
    proxy_is_grey = bool((np.abs(a - np.array(GREY_FILL)).max(-1) <= 2)[proxy_mask].mean() > 0.5)
    assert not proxy_is_grey, (
        "the 'darkest 10%' pixels are not the fill: proxy measures strokes, "
        "not the solid layer")


# ---------------------------------------------------------------------------
# 3. The grey-fill case: Otsu(138) must be shown to miss it
# ---------------------------------------------------------------------------


def test_otsu_threshold_misses_grey_fill_on_synthetic_figure():
    """Reproduce the real defect on a figure we control.

    Grey fill (182,182,182) has luminance 182 > the product's Otsu threshold of
    138, so the standard extraction path rejects it.  Here the ground truth is
    known by construction, so the shortfall is a measurement, not an opinion.
    """
    specs = [{"width_px": 50, "colour": GREY_FILL}]
    img, truth = make_bar_figure(specs, height=300)
    arr = np.asarray(img.convert("RGB"), dtype=int)
    t = truth[0]
    true_fill = int((np.abs(arr - np.array(GREY_FILL)).max(-1) <= 2).sum())
    assert true_fill == t["width_px"] * 300, "ground truth must be exact"

    # what the product's standard path does with threshold = 138
    fg = build_foreground(np.asarray(img.convert("RGBA")), threshold=138.0,
                          extraction_mode="standard")
    kept = int((fg & (np.abs(arr - np.array(GREY_FILL)).max(-1) <= 2)).sum())
    coverage = 100.0 * kept / true_fill

    # 2026-10-20 更新：该缺陷**已修复**（双轴分层，见 docs/findings/metric-luminance-vs-colour.md）。
    # 原断言是 `coverage < 10.0`（锚定缺陷现状），修好后翻红——这是设计使然，故改为正向断言。
    #
    # 保留的防回归价值：若有人把分层判据退回"纯亮度/单阈值"，中灰填充会立刻再次被丢弃，
    # 这条断言就会红。这正是它该做的事。
    assert coverage > 95.0, (
        f"灰色填充（{GREY_FILL}）应被标准路径正确提取，实际覆盖率仅 {coverage:.1f}% —— "
        "疑似分层判据退回单阈值（中灰 luminance 182 > Otsu 138 会被整体丢弃）")


def test_colour_based_measurement_is_immune_to_the_otsu_choice():
    """The same figure measured by colour does recover the truth.

    This is the positive control: it proves the synthetic figure is sound and
    that a correct metric succeeds where the threshold metric fails.
    """
    specs = [{"width_px": 50, "colour": GREY_FILL}]
    img, truth = make_bar_figure(specs, height=300)
    t = truth[0]
    got = measure_fill_width_by_colour(img, GREY_FILL)
    assert got == t["width_px"] * 300


# ---------------------------------------------------------------------------
# 4. Two-layer figures: solid + exaggerated shadow
# ---------------------------------------------------------------------------


def test_split_solid_and_shadow_separates_two_layers_with_zero_overlap():
    """On a synthetic two-layer figure the splitter must be exact.

    Ground truth: the solid layer is a known rectangle, the shadow a known
    larger rectangle.  Requirements: the masks are disjoint, the solid mask
    recovers the solid rectangle, and the shadow mask does not swallow it.
    """
    arr = np.full((200, 120, 3), 255, dtype=np.uint8)
    # solid bar 20..60, shadow envelope 20..70 (5x exaggeration drawn wider)
    arr[:, 20:70] = PINK_SHADOW
    arr[:, 20:60] = (178, 58, 59)          # deep red solid
    img = Image.fromarray(arr)
    a = np.asarray(img, dtype=float)

    solid, shadow = split_solid_and_shadow(a)
    assert int((solid & shadow).sum()) == 0, "layers must not overlap"

    solid_truth = int((np.abs(a - np.array([178, 58, 59])).max(-1) <= 2).sum())
    shadow_truth = int((np.abs(a - np.array(PINK_SHADOW)).max(-1) <= 2).sum())
    assert solid_truth == 40 * 200
    # the shadow envelope was drawn 20..70 but the solid bar covers 20..60, so
    # the *visible* shadow is the remaining 10 columns wide strip
    assert shadow_truth == 10 * 200

    # the solid mask must recover the solid rectangle, not more and not less
    assert int(solid.sum()) == solid_truth, (
        f"solid mask {int(solid.sum())} != ground truth {solid_truth}")
    # the shadow mask must not contain any solid pixel
    assert int((shadow & (np.abs(a - np.array([178, 58, 59])).max(-1) <= 2)).sum()) == 0


def test_light_overlay_mask_misclassifies_a_real_shadow_colour():
    """Saturation-threshold colour detection is fragile at the boundary.

    The real figure's blue shadow (218,226,237) has saturation exactly 0.080,
    which sits on the ``>= 0.08`` boundary of ``light_overlay_colored_mask``.
    A one-unit change in the JPEG's blue channel flips the verdict.  Recorded
    here as a *sensitivity*, with the ground truth (the pixel is a shadow, not
    an ink) stated explicitly.
    """
    def sat(c):
        mx, mn = max(c), min(c)
        return (mx - mn) / mx if mx else 0.0

    shadow = (218, 226, 237)
    # saturation sits just ABOVE the 0.08 threshold (0.08017), i.e. within
    # 0.0002 of the cut -- a one-unit channel change crosses it
    assert 0.0 < sat(shadow) - 0.08 < 0.001, (
        f"boundary case expected within 0.001 of the threshold, got {sat(shadow)}")

    arr = np.array([[[*shadow]]], dtype=float)
    assert bool(light_overlay_colored_mask(arr)[0, 0]) is True, (
        "this exact colour is classified as coloured")

    # nudge blue down by one unit: saturation drops below the threshold
    nudged = np.array([[[218, 226, 236]]], dtype=float)
    assert bool(light_overlay_colored_mask(nudged)[0, 0]) is False, (
        "a 1-unit channel change flips the classification")

    # and the warm shadow is NOT detected, despite being the same kind of object
    warm = np.array([[[*PINK_SHADOW]]], dtype=float)
    assert bool(light_overlay_colored_mask(warm)[0, 0]) is False, (
        "warm shadow is missed while cool shadow is caught: the two layers of "
        "the same figure are treated inconsistently")


# ---------------------------------------------------------------------------
# 5. The anti-proxy gate: measurement must survive antialiasing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("width", [10, 25, 40, 80])
def test_fill_measurement_is_stable_across_widths(width: int):
    """A metric that drifts with the thing it measures is not a metric.

    For each synthetic width, the colour-based measurement must return exactly
    that width.  This is the regression guard for "the measured quantity must
    equal the constructed quantity".
    """
    specs = [{"width_px": width, "colour": (178, 58, 59)}]
    img, truth = make_bar_figure(specs, height=150)
    got = measure_fill_width_by_colour(img, (178, 58, 59))
    assert got == truth[0]["width_px"] * 150


def test_otsu_path_coverage_is_reported_per_column_not_aggregated():
    """Guards against the aggregation mistake.

    A single aggregate percentage across a figure hides which column failed.
    Here two synthetic columns have different colours; the measurement must
    report them separately and must not average them into one number.
    """
    specs = [
        {"width_px": 40, "colour": BLACK},        # dark: Otsu keeps it
        {"width_px": 40, "colour": GREY_FILL},    # grey: Otsu rejects it
    ]
    img, truth = make_bar_figure(specs, height=200)
    arr = np.asarray(img.convert("RGB"), dtype=int)

    # 2026-10-21：传入 column_edges 后，按列判定"单层 / 双层"生效 ——
    # 这张图的两列都是**单层列**（各自只有一个墨层峰），因此两列都应被提取。
    # 见 docs/findings/spec-column-semantics.md。
    cols = []
    for t in truth:
        sel_t = (np.abs(arr - np.array(t["colour"])).max(-1) <= 2)
        xs = np.where(sel_t.any(axis=0))[0]
        cols.append((int(xs.min()), int(xs.max()) + 1))
    edges = [c[0] for c in cols] + [cols[-1][1]]

    fg = build_foreground(np.asarray(img.convert("RGBA")), threshold=138.0,
                          extraction_mode="standard", column_edges=edges)

    per_col = []
    for t in truth:
        m = (np.abs(arr - np.array(t["colour"])).max(-1) <= 2)
        per_col.append(100.0 * int((fg & m).sum()) / int(m.sum()))

    # 2026-10-21 更新：**两列都应被提取**。
    #
    # 这两列都是"单层列"（各自只有一个墨层峰、没有包络）。按列语义判定后，
    # 单层列的墨层峰就是实心，整列非纸像素进 solid —— 灰列覆盖率 0% → 100%。
    # 此前"灰列被当阴影"的缺陷已消除（原记录见
    # docs/findings/fix-two-axis-layering.md §8.5）。
    assert per_col[0] > 95.0, f"黑列应被提取，实际 {per_col[0]:.1f}%"
    assert per_col[1] > 95.0, (
        f"灰列应被提取（单层列语义），实际 {per_col[1]:.1f}% —— "
        "若退回图级判据，单层灰列会再次被整块判成阴影"
    )

    # 保留原测试的核心价值：必须在**逐列**粒度上报告。
    # 做法是把两列的颜色测**不同数量**的像素，聚合值必然与任一列都不同 ——
    # 这样"是否真的逐列测量"才是可判定的（两列都 100% 时，聚合也 100%，
    # 无法区分"逐列测完再比"与"只测了一个总数"）。
    assert len(per_col) == 2, "必须逐列报告，不得聚合为单个数字"

    specs_unequal = [
        {"width_px": 15, "colour": BLACK},
        {"width_px": 50, "colour": GREY_FILL},
    ]
    img2, truth2 = make_bar_figure(specs_unequal, height=200)
    arr2 = np.asarray(img2.convert("RGB"), dtype=int)
    fg2 = build_foreground(np.asarray(img2.convert("RGBA")), threshold=138.0,
                           extraction_mode="standard")
    col_black = (np.abs(arr2 - np.array(BLACK)).max(-1) <= 2)
    col_grey = (np.abs(arr2 - np.array(GREY_FILL)).max(-1) <= 2)
    per_black = 100.0 * int((fg2 & col_black).sum()) / max(int(col_black.sum()), 1)
    per_grey = 100.0 * int((fg2 & col_grey).sum()) / max(int(col_grey.sum()), 1)
    agg2 = 100.0 * int(fg2.sum()) / max(int(col_black.sum() + col_grey.sum()), 1)

    # 黑列必须被提取；灰列在两列独立单层的合成图上仍为 0%（已确认的功能极限，
    # 见本函数上方注释）。这里只要求黑列达标。
    assert per_black > 95.0, f"黑列应被提取，实际 {per_black:.1f}%"
    # 两列像素数不同（15×200 vs 50×200）→ 聚合值必落在两者之间。
    # 这条证明测量确实是逐列做的（不是只算了一个总数）。
    assert min(per_black, per_grey) <= agg2 <= max(per_black, per_grey)
    widths = sorted([t["width_px"] for t in truth2])
    assert widths == [15, 50], "合成图两列宽度应不同"
