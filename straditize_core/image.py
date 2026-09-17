"""Image loading, preprocessing, and color-aware binarization.

Pure Python/NumPy/SciPy/scikit-image/Pillow pipeline without GUI or Matplotlib.
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

import numpy as np
import skimage.color as skcolor
import skimage.morphology as skim
from PIL import Image
from skimage.filters import threshold_otsu

EXTRACTION_MODES: dict[str, str] = {
    'standard': 'standard',
    'light-overlay-white': 'light-overlay-white',
    'light overlay on white background': 'light-overlay-white',
    'dark-ink-light': 'dark-ink-light',
    'dark ink on light background': 'dark-ink-light',
    'light-ink-dark': 'light-ink-dark',
    'light ink on dark background': 'light-ink-dark',
}

SEGMENTATION_MODES: dict[str, str] = {
    'auto': 'auto',
    'guided': 'guided',
}

EXAGGERATION_MERGE_MODES: dict[str, str] = {
    'selected-priority': 'selected-priority',
    'selected region priority': 'selected-priority',
    'threshold-legacy': 'threshold-legacy',
    'threshold merge (legacy)': 'threshold-legacy',
}


def load_image(source: str | Path | Image.Image | np.ndarray) -> Image.Image:
    """Load an image source into a PIL RGBA Image."""
    if isinstance(source, Image.Image):
        return source.convert('RGBA')
    if isinstance(source, (str, Path)):
        img = Image.open(source)
        return img.convert('RGBA')
    if isinstance(source, np.ndarray):
        arr = np.asarray(source)
        if arr.ndim == 2:
            return Image.fromarray(arr).convert('RGBA')
        if arr.ndim == 3:
            if arr.shape[2] == 4:
                return Image.fromarray(arr.astype(np.uint8)).convert('RGBA')
            if arr.shape[2] == 3:
                return Image.fromarray(arr.astype(np.uint8)).convert('RGBA')
            if arr.shape[2] == 1:
                return Image.fromarray(arr[:, :, 0].astype(np.uint8)).convert('RGBA')
    raise TypeError(f"Unsupported image source type: {type(source)}")


def _unique_preserve_order(values: Iterable[Any]) -> list[Any]:
    seen = set()
    ret = []
    for value in values:
        if value not in seen:
            ret.append(value)
            seen.add(value)
    return ret


def _iter_color_tokens(target_colors: Any) -> Iterable[str]:
    if target_colors is None:
        return
    if isinstance(target_colors, (str, bytes)):
        target_colors = [target_colors]
    for color in target_colors:
        if color is None:
            continue
        text = str(color).strip()
        if not text:
            continue
        for token in re.split(r'[\s,;]+', text):
            token = token.strip()
            if token:
                yield token


def normalize_extraction_mode(extraction_mode: str | None) -> str:
    """Normalize extraction mode string."""
    if extraction_mode is None:
        extraction_mode = 'standard'
    key = str(extraction_mode).strip().lower()
    try:
        return EXTRACTION_MODES[key]
    except KeyError:
        raise ValueError(f"Unknown extraction mode: {extraction_mode}")


def detect_horizontal_grid_lines(
    binary: np.ndarray,
    min_length: int = 35,
    min_row_occupancy_ratio: float = 0.35,
) -> tuple[np.ndarray, list[int]]:
    """Detect horizontal coordinate lines and cross-column grid lines.

    Uses morphological horizontal opening combined with cross-column occupancy
    analysis to identify grid lines without misclassifying local wide pollen lobes.

    Parameters
    ----------
    binary : np.ndarray
        2D binary image (H x W) where True/1 is dark ink/foreground.
    min_length : int
        Minimum width threshold for horizontal linear structures (default: 35).
    min_row_occupancy_ratio : float
        Fraction of diagram total width that must be foreground to flag a line (default: 0.35).

    Returns
    -------
    hlines_mask : np.ndarray
        2D boolean mask of pixels belonging to detected horizontal grid lines.
    hline_rows : list of int
        Sorted list of row indices identified as containing pervasive horizontal grid lines.
    """
    binary = np.asarray(binary, dtype=bool)
    if binary.ndim != 2 or binary.size == 0:
        return np.zeros_like(binary, dtype=bool), []

    _height, width = binary.shape
    # 1. Morphological horizontal opening to isolate linear horizontal strokes
    line_kernel = np.ones((1, max(3, int(min_length))), dtype=bool)
    morph_hlines = skim.opening(binary, line_kernel)

    # 2. Cross-column pervasive line detection
    row_counts = np.sum(morph_hlines, axis=1)
    min_row_px = max(float(min_length), float(min_row_occupancy_ratio) * width)
    hline_rows = sorted(np.where(row_counts >= min_row_px)[0].tolist())

    # Build mask containing only verified grid lines
    hlines_mask = np.zeros_like(binary, dtype=bool)
    if hline_rows:
        hlines_mask[hline_rows, :] = morph_hlines[hline_rows, :]

    return hlines_mask, hline_rows


def remove_horizontal_grid_lines(
    binary: np.ndarray,
    min_length: int = 35,
    min_row_occupancy_ratio: float = 0.35,
) -> tuple[np.ndarray, list[int]]:
    """Remove pervasive horizontal grid lines from binary image to prevent profile inflation.

    Parameters
    ----------
    binary : np.ndarray
        2D binary image (H x W).
    min_length : int
        Minimum horizontal line length.
    min_row_occupancy_ratio : float
        Minimum width occupancy fraction.

    Returns
    -------
    cleaned_binary : np.ndarray
        Binary image with horizontal grid lines subtracted.
    hline_rows : list of int
        Row indices where grid lines were detected and removed.
    """
    hlines_mask, hline_rows = detect_horizontal_grid_lines(
        binary,
        min_length=min_length,
        min_row_occupancy_ratio=min_row_occupancy_ratio,
    )
    cleaned = binary & (~hlines_mask)
    return cleaned, hline_rows


def normalize_segmentation_mode(segmentation_mode: str | None) -> str:
    """Normalize segmentation mode string."""
    if segmentation_mode is None:
        segmentation_mode = 'auto'
    key = str(segmentation_mode).strip().lower()
    try:
        return SEGMENTATION_MODES[key]
    except KeyError:
        raise ValueError(f"Unknown segmentation mode: {segmentation_mode}")


    """Normalize segmentation mode string."""
    if segmentation_mode is None:
        segmentation_mode = 'auto'
    key = str(segmentation_mode).strip().lower()
    try:
        return SEGMENTATION_MODES[key]
    except KeyError:
        raise ValueError(f"Unknown segmentation mode: {segmentation_mode}")


def normalize_exaggeration_merge_mode(merge_mode: str | None) -> str:
    """Normalize exaggeration merge mode string."""
    if merge_mode is None:
        merge_mode = 'selected-priority'
    key = str(merge_mode).strip().lower()
    try:
        return EXAGGERATION_MERGE_MODES[key]
    except KeyError:
        raise ValueError(f"Unknown exaggeration merge mode: {merge_mode}")


def normalize_target_colors(target_colors: Any) -> list[str]:
    """Parse and normalize a collection of hex color strings into #RRGGBB format."""
    normalized = []
    for token in _iter_color_tokens(target_colors):
        text = token.removeprefix('#')
        if len(text) != 6 or re.search(r'[^0-9A-Fa-f]', text):
            raise ValueError(f"Invalid target color: {token}")
        normalized.append('#' + text.upper())
    return _unique_preserve_order(normalized)


def target_color_rgb(target_colors: Any) -> np.ndarray:
    """Convert target colors to an array of RGB floats in range [0, 1]."""
    norm_colors = normalize_target_colors(target_colors)
    if not norm_colors:
        return np.zeros((0, 3), dtype=float)
    return np.asarray([
        [int(color[i:i + 2], 16) for i in (1, 3, 5)]
        for color in norm_colors], dtype=float) / 255.0


def circular_hue_distance(hue: np.ndarray | float, reference: np.ndarray | float) -> np.ndarray:
    """Compute circular distance between two hues in [0, 1]."""
    diff = np.abs(np.asarray(hue) - np.asarray(reference))
    return np.minimum(diff, 1.0 - diff)


def dominant_overlay_hue(hue: np.ndarray, sat: np.ndarray, mask: np.ndarray) -> tuple[float | None, float]:
    """Compute the weighted circular mean hue and its directional coherence."""
    weights = sat[mask] + 1e-6
    if not len(weights):
        return None, 0.0
    angles = 2 * np.pi * hue[mask]
    x = np.sum(weights * np.cos(angles))
    y = np.sum(weights * np.sin(angles))
    total = np.sum(weights)
    mag = np.hypot(x, y)
    if total <= 0 or mag <= 0:
        return None, 0.0
    dominant = float((np.arctan2(y, x) / (2 * np.pi)) % 1.0)
    return dominant, float(mag / total)


def rgb_to_hsv_array(rgb: np.ndarray) -> np.ndarray:
    """Convert RGB float array to HSV using skimage (no matplotlib)."""
    rgb = np.asarray(rgb, dtype=float)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    orig_shape = rgb.shape
    if rgb.ndim == 2 and rgb.shape[-1] == 3:
        reshaped = rgb.reshape(1, -1, 3)
        hsv = skcolor.rgb2hsv(reshaped)
        return hsv.reshape(orig_shape)
    return skcolor.rgb2hsv(rgb)


def guided_target_color_mask(rgb: np.ndarray, target_colors: Any) -> np.ndarray:
    """Create a boolean mask of pixels matching the given target colors."""
    colors = target_color_rgb(target_colors)
    if not len(colors):
        return np.zeros(np.shape(rgb)[:2], dtype=bool)
    rgb = np.asarray(rgb, dtype=float)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    hsv = rgb_to_hsv_array(rgb)
    target_hsv = rgb_to_hsv_array(colors.reshape(1, -1, 3)).reshape(-1, 3)
    sat = hsv[..., 1][..., np.newaxis]
    val = hsv[..., 2][..., np.newaxis]
    deltas = rgb[..., np.newaxis, :] - colors[np.newaxis, np.newaxis, ...]
    dist = np.sqrt(np.sum(deltas ** 2, axis=-1))
    hue_dist = circular_hue_distance(
        hsv[..., 0][..., np.newaxis], target_hsv[:, 0])
    sat_delta = np.abs(sat - target_hsv[:, 1])
    val_delta = np.abs(val - target_hsv[:, 2])
    mask = (
        (dist <= 0.20) &
        (hue_dist <= 0.08) &
        (sat >= 0.03) &
        (sat_delta <= 0.25) &
        (val_delta <= 0.18) &
        (val <= 0.995))
    return mask.any(axis=-1)


def guided_target_hue_family_mask(rgb: np.ndarray, target_colors: Any) -> np.ndarray:
    """Mask pixels sharing the hue family of target colors."""
    colors = target_color_rgb(target_colors)
    if not len(colors):
        return np.zeros(np.shape(rgb)[:2], dtype=bool)
    rgb = np.asarray(rgb, dtype=float)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    hsv = rgb_to_hsv_array(rgb)
    target_hsv = rgb_to_hsv_array(colors.reshape(1, -1, 3)).reshape(-1, 3)
    hue_dist = circular_hue_distance(
        hsv[..., 0][..., np.newaxis], target_hsv[:, 0])
    sat = hsv[..., 1][..., np.newaxis]
    val = hsv[..., 2][..., np.newaxis]
    return ((hue_dist <= 0.10) & (sat >= 0.03) & (val <= 0.995)).any(axis=-1)


def light_overlay_colored_mask(rgb: np.ndarray) -> np.ndarray:
    """Return mask of pixels with sufficient saturation to indicate colored overlays."""
    rgb = np.asarray(rgb, dtype=float)
    maxc = rgb.max(axis=-1)
    minc = rgb.min(axis=-1)
    saturation = np.divide(
        maxc - minc, maxc,
        out=np.zeros_like(maxc, dtype=float), where=maxc > 0)
    return saturation >= 0.08


def remove_objects_smaller_than(arr: np.ndarray, min_size: int) -> np.ndarray:
    """Remove connected binary objects strictly smaller than min_size."""
    min_size = int(min_size)
    if min_size <= 1:
        return np.asarray(arr, dtype=bool)
    return skim.remove_small_objects(
        np.asarray(arr, dtype=bool), max_size=min_size - 1)


def build_foreground(arr: np.ndarray,
                     threshold: float = 230 * 3,
                     extraction_mode: str = 'standard',
                     segmentation_mode: str = 'auto',
                     target_colors: Any = None,
                     guided_min_pixels: int = 12) -> np.ndarray:
    """Return a foreground boolean mask for an image array."""
    ext_mode = normalize_extraction_mode(extraction_mode)
    seg_mode = normalize_segmentation_mode(segmentation_mode)
    t_colors = normalize_target_colors(target_colors)
    arr = np.asarray(arr)
    rgb = arr[..., :3]
    alpha = arr[..., -1] > 0 if arr.shape[-1] > 3 else np.ones(
        arr.shape[:2], dtype=bool)

    if ext_mode in ['standard', 'dark-ink-light']:
        auto_foreground = alpha & (rgb.sum(axis=-1) <= threshold)
    elif ext_mode == 'light-ink-dark':
        auto_foreground = alpha & (rgb.sum(axis=-1) >= threshold)
    elif ext_mode == 'light-overlay-white':
        bright = rgb.sum(axis=-1) > threshold
        colored = light_overlay_colored_mask(rgb)
        auto_foreground = alpha & (~bright | colored)
    else:
        auto_foreground = alpha & (rgb.sum(axis=-1) <= threshold)

    if seg_mode != 'guided' or not t_colors:
        return auto_foreground

    rgb_float = np.asarray(rgb, dtype=float)
    target_mask = guided_target_color_mask(rgb_float, t_colors)
    guided = auto_foreground & target_mask
    if guided.sum() >= guided_min_pixels:
        return guided

    # Fallback for background conflicts: keep target components touching auto foreground
    labels = skim.label(target_mask, connectivity=2)
    if labels.max() == 0:
        return guided
    dilated_auto = skim.dilation(
        auto_foreground, footprint=np.ones((3, 3), dtype=bool))
    touching = labels[dilated_auto & (labels > 0)]
    touching = np.unique(touching[touching > 0])
    if not len(touching):
        return guided
    fallback = np.isin(labels, touching)
    fallback = fallback & (auto_foreground | dilated_auto)
    fallback = remove_objects_smaller_than(fallback, 6)
    if fallback.sum() >= guided_min_pixels:
        return fallback
    return guided


def to_grey(image: Image.Image | np.ndarray,
            threshold: float = 230 * 3,
            extraction_mode: str = 'standard',
            segmentation_mode: str = 'auto',
            target_colors: Any = None) -> np.ndarray:
    """Convert an image to a masked greyscale numpy array."""
    pil_img = load_image(image)
    arr = np.asarray(pil_img, dtype=int)
    foreground = build_foreground(
        arr, threshold=threshold, extraction_mode=extraction_mode,
        segmentation_mode=segmentation_mode,
        target_colors=target_colors)
    grey = np.array(pil_img.convert('L'), dtype=int) + 1
    grey[(~foreground) | (grey > 255)] = 0
    return grey


def to_binary(image: Image.Image | np.ndarray,
              threshold: float = 230 * 3,
              extraction_mode: str = 'standard',
              segmentation_mode: str = 'auto',
              target_colors: Any = None) -> np.ndarray:
    """Convert an image to a clean binary numpy array (0 for background, 1 for foreground)."""
    grey = to_grey(
        image, threshold=threshold, extraction_mode=extraction_mode,
        segmentation_mode=segmentation_mode,
        target_colors=target_colors)
    binary = np.zeros_like(grey, dtype=np.uint8)
    binary[grey > 0] = 1
    return binary


def split_primary_exagg(rgb: np.ndarray,
                        base_mask: np.ndarray,
                        overlay_mask: np.ndarray,
                        bounds: Sequence[tuple[int, int]],
                        focus_mask: np.ndarray | None = None) -> np.ndarray:
    """Suggest pale same-hue exaggeration pixels using spatial constraints."""
    base_mask = np.asarray(base_mask, dtype=bool)
    overlay_mask = np.asarray(overlay_mask, dtype=bool)
    candidate = np.zeros_like(base_mask, dtype=bool)
    if focus_mask is not None:
        focus_mask = np.asarray(focus_mask, dtype=bool)
        overlay_mask = overlay_mask & focus_mask
    if not overlay_mask.any():
        return candidate

    hsv = rgb_to_hsv_array(rgb)
    hue = hsv[..., 0]
    sat = hsv[..., 1]
    val = hsv[..., 2]
    score = val - 0.65 * sat
    colored_overlay = overlay_mask & (sat >= 0.05)

    for start, end in bounds:
        start = int(start)
        end = int(end)
        section = np.s_[:, start:end]
        section_overlay = overlay_mask[section]
        section_colored = colored_overlay[section]
        if section_overlay.sum() < 12 or section_colored.sum() < 12:
            continue
        dom_hue, confidence = dominant_overlay_hue(
            hue[section], sat[section], section_colored)
        if dom_hue is None or confidence < 0.45:
            continue

        family_source = focus_mask[section] if focus_mask is not None else section_overlay
        family = family_source & (circular_hue_distance(
            hue[section], dom_hue) <= 0.10)
        family_current = family & base_mask[section]
        section_candidate = family & ~base_mask[section]
        if family_current.sum() < 12:
            continue

        primary = family_current.copy()
        layered = section_candidate.copy()
        split_ok = False
        light_inside = np.zeros_like(family_current, dtype=bool)
        inside_scores = score[section][family_current]
        if np.ptp(inside_scores) >= 0.10:
            try:
                thresh = threshold_otsu(inside_scores)
            except ValueError:
                thresh = None
            if thresh is not None:
                light_inside = family_current & (score[section] >= thresh)
                dark_inside = family_current & (~light_inside)
                split_ok = (
                    light_inside.sum() >= 8 and dark_inside.sum() >= 8 and
                    light_inside.sum() < 0.8 * family_current.sum() and
                    (val[section][light_inside].mean() >
                     val[section][dark_inside].mean() + 0.05) and
                    (sat[section][light_inside].mean() <
                     sat[section][dark_inside].mean() - 0.03))
                if split_ok:
                    primary = dark_inside
                    layered |= light_inside
        if not layered.any():
            continue

        expanded_primary = skim.dilation(
            primary, footprint=np.ones((3, 3), dtype=bool))
        if not split_ok:
            layered &= expanded_primary | section_candidate

        light_x = np.where(light_inside)[1]
        dark_x = np.where(primary)[1]
        if split_ok and len(light_x) and len(dark_x):
            preferred_side = (
                1 if np.nanmedian(light_x) >= np.nanmedian(dark_x) else -1)
        elif section_candidate.any():
            preferred_side = 1
        else:
            preferred_side = 1

        for row in range(layered.shape[0]):
            if not layered[row].any() or not primary[row].any():
                continue
            prim = np.where(primary[row])[0]
            row_x = np.where(layered[row])[0]
            if preferred_side >= 0:
                keep = row_x > prim.max()
            else:
                keep = row_x < prim.min()
            if keep.any():
                keep_x = row_x[keep]
                row_mask = np.zeros(layered.shape[1], dtype=bool)
                row_mask[keep_x] = True
                layered[row] = row_mask
            else:
                layered[row, :] = False

        labels = skim.label(layered, connectivity=2)
        if labels.max() > 0:
            touching = np.unique(labels[expanded_primary & (labels > 0)])
            touching = touching[touching > 0]
            if len(touching):
                layered = np.isin(labels, touching)
        candidate[section] |= layered

    candidate = remove_objects_smaller_than(candidate, 6)
    candidate = skim.remove_small_holes(candidate, max_size=12)
    return candidate


def estimate_deskew_angle(pil_img: Image.Image, max_angle: float = 7.0) -> float:
    """Estimates the tilt/skew angle (in degrees) of a stratigraphic diagram.

    Uses a fast two-stage coarse-to-fine Radon transform on foreground projection.
    Returns the angle in degrees that should be applied to rotate and level the diagram.
    """
    import warnings
    from skimage.transform import radon

    gray = pil_img.convert('L')
    max_d = 260
    if max(gray.width, gray.height) > max_d:
        s = max_d / max(gray.width, gray.height)
        gray = gray.resize((max(1, int(gray.width * s)), max(1, int(gray.height * s))), Image.Resampling.BILINEAR)
    arr = np.array(gray)
    binary = (arr < (np.mean(arr) * 0.9)).astype(float)

    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        # Stage 1: Coarse search step 0.5 deg
        theta_coarse = np.arange(90 - max_angle, 90 + max_angle + 0.5, 0.5)
        sino1 = radon(binary, theta=theta_coarse)
        best_coarse = theta_coarse[np.argmax(np.var(sino1, axis=0))]

        # Stage 2: Fine search +/- 0.6 deg with 0.05 step
        theta_fine = np.arange(best_coarse - 0.6, best_coarse + 0.65, 0.05)
        sino2 = radon(binary, theta=theta_fine)
        best_fine = theta_fine[np.argmax(np.var(sino2, axis=0))]

    skew = -(best_fine - 90.0)
    # Filter negligible micro-tilt (< 0.25 degree)
    if abs(skew) < 0.25:
        return 0.0
    return round(float(skew), 2)

