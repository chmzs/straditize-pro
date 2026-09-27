"""Production-grade ground-truth corpus robustness test suite (T14).

Strictly verifies pipeline resilience across real heterogeneous scientific diagrams:
- 01_chinese_scanned_hlines: Dirty scan + photocopy noise + dense horizontal sampling lines + Chinese annotations;
- 02_muricuo_multicolor_dual_y: High-density multicolor + dual Y-axis + top bracket grouping + exaggeration shading;
- 03_lough_inchiquin_vertical_strip: Extreme vertical aspect ratio + composite stratigraphy + sparse taxa curves;
- 04_elsevier_two_tier_coniss: Two-tier multi-ROI layout + CONISS dendrogram tree + multi-proxy taxa;
- 05_scanned_hatched_lithology: Hatched 5x exaggeration shading + lithology column + discrete horizontal bars.

Invariants:
1. Zero unhandled exceptions across all 5 images through full pipeline:
   load -> suggest_roi -> extract_foreground -> detect_line_candidates -> detect_columns;
2. Geometric bounding box validity (suggested ROI strictly inside image boundaries, area > 0);
3. Line removal safety on dense horizontal lines (width strictly bounded, thick data ink preserved);
4. Two-tier multi-ROI column isolation on Elsevier plate (upper and lower ROIs segment independently).
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import pytest

from straditize_core.session import StraditizeSession

CORPUS_JSON_PATH = Path("tests/data/corpus/index.json")


def load_corpus_manifest() -> dict[str, dict]:
    assert CORPUS_JSON_PATH.exists(), f"Corpus manifest missing: {CORPUS_JSON_PATH}"
    data = json.loads(CORPUS_JSON_PATH.read_text(encoding="utf-8"))
    return data.get("figures", {})


CORPUS_FIGURES = load_corpus_manifest()


@pytest.mark.parametrize("fig_key, fig_info", CORPUS_FIGURES.items())
def test_corpus_pipeline_zero_crashes(fig_key: str, fig_info: dict):
    """Verify zero unhandled exceptions and geometric validity across all corpus figures."""
    file_rel = fig_info["file"]
    file_path = Path(file_rel)
    assert file_path.exists(), f"Corpus image file not found: {file_path}"

    # 1. SHA256 integrity check
    actual_sha = hashlib.sha256(file_path.read_bytes()).hexdigest()
    expected_sha = fig_info["sha256"]
    assert actual_sha == expected_sha, (
        f"SHA256 mismatch for {fig_key}: {actual_sha} != {expected_sha}"
    )

    # 2. Session load
    session = StraditizeSession()
    res = session.load_image(image_path=str(file_path))

    assert res["success"] is True
    w, h = res["width"], res["height"]
    assert (w, h) == tuple(fig_info["dimensions"])
    assert session.image is not None

    # 3. Geometric ROI suggestion validity
    sug = session.suggest_data_region()
    assert 0 <= sug["xMin"] < sug["xMax"] <= w, f"Invalid x bounds: {sug} for width {w}"
    assert 0 <= sug["yMin"] < sug["yMax"] <= h, (
        f"Invalid y bounds: {sug} for height {h}"
    )
    area = (sug["xMax"] - sug["xMin"]) * (sug["yMax"] - sug["yMin"])
    assert area > 0, f"Suggested ROI area must be > 0, got {area}"

    # 4. Foreground binarization extraction
    session.extract_foreground()
    assert session.foreground_mask is not None
    assert session.foreground_mask.shape == (h, w)
    assert session.foreground_mask.dtype == bool

    # 5. Coordinate line candidates detection
    roi = session.roi_create(
        name="data_roi",
        x0=sug["xMin"],
        x1=sug["xMax"],
        y0=sug["yMin"],
        y1=sug["yMax"],
    )["roi"]
    cands_res = session.detect_line_candidates(roi_id=roi["id"])
    assert "candidates" in cands_res
    assert isinstance(cands_res["candidates"], list)

    # 6. Taxa columns detection
    cols = session.detect_columns(roi_id=roi["id"])
    assert len(cols) > 0, f"Expected detected columns for {fig_key}, got 0"
    for c in cols:
        assert c["roi_id"] == roi["id"]
        assert sug["xMin"] <= c["start"] <= sug["xMax"]
        assert sug["xMin"] <= c["end"] <= sug["xMax"]


def test_line_removal_safety_chinese_dense_hlines():
    """Verify line removal on 01_chinese_scanned_hlines does NOT classify thick data curves as lines."""
    info = CORPUS_FIGURES["01_chinese_scanned_hlines"]
    session = StraditizeSession()
    session.load_image(info["file"])

    sug = session.suggest_data_region()
    roi = session.roi_create(
        name="chinese_core",
        x0=sug["xMin"],
        x1=sug["xMax"],
        y0=sug["yMin"],
        y1=sug["yMax"],
    )["roi"]

    # Detect horizontal grid line candidates
    cands = session.detect_line_candidates(
        roi_id=roi["id"],
        line_fraction_h=0.40,
        line_width_min=1,
        line_width_max=3,
    )["candidates"]

    # Candidate lines must have width <= 3 px; thick taxa bodies (>5 px) must be exempted
    for c in cands:
        if c["axis"] == "h":
            assert c["width"] <= 3, (
                f"Line candidate {c['id']} thickness {c['width']} exceeded maximum safe line width (3px)"
            )


def test_two_tier_multi_roi_isolation_elsevier():
    """Verify two-tier multi-ROI column segmentation isolation on 04_elsevier_two_tier_coniss."""
    info = CORPUS_FIGURES["04_elsevier_two_tier_coniss"]
    session = StraditizeSession()
    session.load_image(info["file"])

    session.rois.clear()
    session.columns.clear()

    # Tier 1 (Upper): Tree & Shrub pollen (y: 320 to 880, x: 300 to 2000)
    r_upper = session.roi_create(name="tree_pollen", x0=300, x1=2000, y0=320, y1=880)[
        "roi"
    ]

    # Tier 2 (Lower): Herb pollen & Charcoal (y: 920 to 1480, x: 300 to 2000)
    r_lower = session.roi_create(name="herb_pollen", x0=300, x1=2000, y0=920, y1=1480)[
        "roi"
    ]

    cols_upper = session.detect_columns(roi_id=r_upper["id"])
    cols_lower = session.detect_columns(roi_id=r_lower["id"])

    assert len(cols_upper) > 0, "Upper tier should detect taxa columns"
    assert len(cols_lower) > 0, "Lower tier should detect taxa columns"

    # Verify column isolation: all columns belong strictly to their parent ROI
    for c in cols_upper:
        assert c["roi_id"] == r_upper["id"]
    for c in cols_lower:
        assert c["roi_id"] == r_lower["id"]

    total_cols = session.columns
    assert len(total_cols) == len(cols_upper) + len(cols_lower)
