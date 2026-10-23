"""Shared helpers for the qa_review probes.

Deliberately self-contained: no import from scripts/lead_probe, no reuse of
Lead's probe implementation.  Only ``straditize_core`` product code is imported
where the point of the check is "what does the *product* do".
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
FIG = REPO / "output" / "han2026_ngamring" / "fig3_raw.jpeg"

# Column geometry as measured by Lead (docs/findings/pollen-extraction-han2026.md §4).
# Reproduced here as *input to be tested*, not as ground truth.
LEAD_COLUMNS: list[tuple[str, int, int]] = [
    ("Pinus", 332, 38),
    ("Abies", 370, 37),
    ("Picea", 407, 38),
    ("Betula", 445, 37),
    ("Quercus_D", 482, 39),
    ("Quercus_E", 521, 61),
    ("Rosaceae", 582, 37),
    ("Chenopodiaceae", 619, 38),
    ("Hippophae", 657, 47),
    ("Euphorbiaceae", 704, 220),
    ("Cyperaceae", 924, 172),
    ("Artemisia", 1096, 37),
    ("Poaceae", 1133, 60),
    ("Ranunculaceae", 1193, 38),
    ("Caryophyllaceae", 1231, 49),
]

PLOT_TOP = 232
PLOT_BOTTOM = 862


def load_fig() -> Image.Image:
    return Image.open(FIG).convert("RGB")


def load_rgb() -> np.ndarray:
    return np.asarray(load_fig(), dtype=np.uint8)


def load_gray() -> np.ndarray:
    return np.asarray(load_fig().convert("L"), dtype=np.uint8)


def my_otsu(gray: np.ndarray, nbins: int = 256) -> float:
    """Independent Otsu implementation (no skimage), for cross-checking C1."""
    hist, _ = np.histogram(gray, bins=nbins, range=(0, nbins))
    total = gray.size
    idx = np.arange(nbins, dtype=float)
    sum_total = float(np.dot(idx, hist))
    w_bg = 0.0
    sum_bg = 0.0
    best_var = -1.0
    best_t = 0
    for t in range(nbins):
        w_bg += float(hist[t])
        if w_bg == 0:
            continue
        w_fg = total - w_bg
        if w_fg == 0:
            break
        sum_bg += float(t) * float(hist[t])
        m_bg = sum_bg / w_bg
        m_fg = (sum_total - sum_bg) / w_fg
        var = w_bg * w_fg * (m_bg - m_fg) ** 2
        if var > best_var:
            best_var = var
            best_t = t
    return float(best_t)


def my_otsu_skimage_equivalent(gray: np.ndarray) -> float:
    """skimage.threshold_otsu returns bin centers, i.e. idx+0.5 semantics.

    Reimplemented so we do not depend on skimage being installed.
    """
    hist, _ = np.histogram(gray, bins=256, range=(0, 256))
    # skimage builds 256 bin centres at 0.5, 1.5, ... for uint8 input
    centers = np.arange(256, dtype=float) + 0.5
    weight1 = np.cumsum(hist)
    weight2 = np.cumsum(hist[::-1])[::-1]
    mean1 = np.cumsum(hist * centers) / weight1
    mean2 = (np.cumsum((hist * centers)[::-1]) / weight2[::-1])[::-1]
    variance12 = weight1[:-1] * weight2[1:] * (mean1[:-1] - mean2[1:]) ** 2
    idx = int(np.argmax(variance12))
    return float(centers[idx])


def column_slice(x0: int, width: int) -> tuple[int, int]:
    return x0, x0 + width
