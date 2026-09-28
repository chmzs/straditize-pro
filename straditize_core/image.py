"""Image loading, preprocessing, and color-aware binarization.

Pure Python/NumPy/SciPy/scikit-image/Pillow pipeline without GUI or Matplotlib.
"""
from __future__ import annotations

import base64
import io
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


#: Grid-line removal presets, keyed by the UI strength label.
#:
#: ``run_frac`` / ``span_frac`` are fractions of the ROI extent, so the same
#: preset behaves sensibly on a 400 px and a 4000 px wide diagram.
#: ``max_thickness`` is the decisive criterion: a real grid line is razor thin,
#: whereas a filled pollen silhouette crossed by that line is tens of pixels
#: thick and must survive. Without this bound the detector used to delete entire
#: taxa (measured on the built-in Hoya diagram: 95% of everything it flagged at
#: the "weak" preset was >= 4 px thick real silhouette, and 99% of the *Pinus*
#: column was erased).
GRID_LINE_PRESETS: dict[str, dict[str, float]] = {
    'weak': {'run_frac': 0.55, 'span_frac': 0.80, 'min_run_px': 55, 'max_thickness': 2},
    'medium': {'run_frac': 0.40, 'span_frac': 0.65, 'min_run_px': 35, 'max_thickness': 3},
    'strong': {'run_frac': 0.25, 'span_frac': 0.45, 'min_run_px': 20, 'max_thickness': 5},
}


def normalize_grid_line_strength(strength: str | None) -> str:
    """Normalize a grid-line removal strength label."""
    key = str(strength or 'medium').strip().lower()
    if key not in GRID_LINE_PRESETS:
        raise ValueError(f'Unknown grid-line removal strength: {strength}')
    return key


def _run_lengths_along_rows(mask: np.ndarray) -> np.ndarray:
    """Per-pixel length of the contiguous True run containing that pixel (axis 0)."""
    rows = mask.shape[0]
    if rows == 0:
        return np.zeros(mask.shape, dtype=np.int32)
    previous = np.vstack([np.zeros((1, mask.shape[1]), dtype=bool), mask[:-1]])
    starts = mask & ~previous
    indices = np.arange(rows)[:, None]
    run_start = np.maximum.accumulate(np.where(starts, indices, -1), axis=0)
    return np.where(mask, indices - run_start + 1, 0).astype(np.int32)


def stroke_thickness(mask: np.ndarray, axis: int = 0) -> np.ndarray:
    """Per-pixel thickness of the ink stroke measured along ``axis``.

    ``axis=0`` gives the vertical extent (what makes a left-right line thin);
    ``axis=1`` gives the horizontal extent (for up-down lines).
    """
    binary = np.asarray(mask, dtype=bool)
    work = binary if axis == 0 else binary.T
    forward = _run_lengths_along_rows(work)
    backward = _run_lengths_along_rows(work[::-1])[::-1]
    # Background pixels have no stroke, so report 0 rather than the -1 the
    # forward+backward-1 arithmetic would produce for them.
    thickness = np.where(work, forward + backward - 1, 0)
    return thickness if axis == 0 else thickness.T


def _detect_linear_structures(
    binary: np.ndarray,
    *,
    run_length: int,
    min_span: int,
    max_thickness: int,
    vertical: bool,
) -> np.ndarray:
    """Isolate thin linear strokes of one orientation.

    A pixel is kept only when it belongs to (a) a long straight run, (b) a stroke
    whose perpendicular thickness is ``<= max_thickness``, and (c) a line whose
    surviving pixels add up to at least ``min_span``. Criterion (b) is what
    protects solid pollen silhouettes from being eaten by their own row length;
    criterion (c) is counted rather than measured as a bounding span, because a
    bell silhouette carries thin apex *and* base pixels in the same columns, and
    their bounding box would otherwise look like one continuous line.
    """
    if binary.size == 0:
        return np.zeros_like(binary)

    kernel_length = max(3, int(run_length))
    kernel = (
        np.ones((kernel_length, 1), dtype=bool)
        if vertical
        else np.ones((1, kernel_length), dtype=bool)
    )
    opened = skim.opening(binary, kernel)
    thickness = stroke_thickness(binary, axis=1 if vertical else 0)
    thin = binary & (thickness <= max_thickness)
    candidate = opened & thin

    if not vertical:
        # Zone separators often cross plot columns that contain labels or curves,
        # so a strict continuous opening misses the line despite high coverage.
        # Keep thin foreground pixels on rows whose *thin* coverage reaches the
        # same span threshold; this preserves the thickness guard against filled
        # silhouettes while allowing small interruptions in the horizontal stroke.
        thin_row_counts = thin.sum(axis=1)
        accepted_rows = thin_row_counts >= min_span
        candidate |= thin & accepted_rows[:, np.newaxis]

    counts = candidate.sum(axis=0) if vertical else candidate.sum(axis=1)
    accepted = counts >= min_span
    if vertical:
        return candidate & accepted[np.newaxis, :]
    return candidate & accepted[:, np.newaxis]


def _clip_roi(shape: tuple[int, int], roi: Sequence[float] | None) -> tuple[int, int, int, int]:
    """Clip ``roi`` (x0, y0, x1, y1) to the image, defaulting to the whole image."""
    height, width = shape
    if roi is None:
        return 0, 0, width, height
    x0, y0, x1, y1 = (int(round(float(v))) for v in roi)
    x0, x1 = sorted((max(0, min(width, x0)), max(0, min(width, x1))))
    y0, y1 = sorted((max(0, min(height, y0)), max(0, min(height, y1))))
    return x0, y0, x1, y1


def detect_grid_lines(
    binary: np.ndarray,
    *,
    strength: str = 'medium',
    roi: Sequence[float] | None = None,
    remove_vertical: bool = True,
    max_thickness: int | None = None,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Detect horizontal and vertical coordinate lines inside the data ROI.

    Detection is scoped to ``roi`` because that is the region the user declared as
    data: axis spines, zone brackets and cluster trees living outside it must not
    influence the thresholds, and nothing outside it is digitised anyway.

    Parameters
    ----------
    binary : np.ndarray
        2D binary image (H x W), True = ink.
    strength : str
        One of :data:`GRID_LINE_PRESETS`.
    roi : sequence, optional
        ``(x0, y0, x1, y1)`` in image pixels. Defaults to the whole image.
    remove_vertical : bool
        Also detect up-down lines (column baselines, vertical grid lines).
    max_thickness : int, optional
        Override the preset's perpendicular-thickness bound.

    Returns
    -------
    horizontal_mask, vertical_mask, info : np.ndarray, np.ndarray, dict
        Full image sized boolean masks plus a small statistics dict.
    """
    binary = np.asarray(binary, dtype=bool)
    height, width = binary.shape
    empty = np.zeros_like(binary)
    if binary.ndim != 2 or binary.size == 0:
        return empty, np.zeros_like(binary), {'strength': strength, 'roi': None}

    preset = GRID_LINE_PRESETS[normalize_grid_line_strength(strength)]
    thickness_bound = int(preset['max_thickness'] if max_thickness is None else max_thickness)

    x0, y0, x1, y1 = _clip_roi(binary.shape, roi)
    sub = binary[y0:y1, x0:x1]
    if sub.size == 0:
        return empty, np.zeros_like(binary), {'strength': strength, 'roi': [x0, y0, x1, y1]}

    sub_width, sub_height = sub.shape[1], sub.shape[0]
    horizontal = _detect_linear_structures(
        sub,
        run_length=max(preset['min_run_px'], preset['run_frac'] * sub_width),
        min_span=max(preset['min_run_px'], preset['span_frac'] * sub_width),
        max_thickness=thickness_bound,
        vertical=False,
    )
    # The ROI frame itself is not an artifact. Exclude a small edge band so a
    # full-width border cannot become a removable zone separator.
    edge_margin = max(2, thickness_bound * 2) + 1
    horizontal[:edge_margin, :] = False
    horizontal[-edge_margin:, :] = False

    vertical = np.zeros_like(sub)
    if remove_vertical:
        vertical = _detect_linear_structures(
            sub,
            run_length=max(preset['min_run_px'], preset['run_frac'] * sub_height),
            min_span=max(preset['min_run_px'], preset['span_frac'] * sub_height),
            max_thickness=thickness_bound,
            vertical=True,
        )

    horizontal_mask = np.zeros_like(binary)
    vertical_mask = np.zeros_like(binary)
    horizontal_mask[y0:y1, x0:x1] = horizontal
    vertical_mask[y0:y1, x0:x1] = vertical

    info = {
        'strength': normalize_grid_line_strength(strength),
        'roi': [x0, y0, x1, y1],
        'max_thickness': thickness_bound,
        'removed_vertical': bool(remove_vertical),
        'horizontal_rows': sorted(np.unique(np.nonzero(horizontal)[0] + y0).tolist()),
        'vertical_cols': sorted(np.unique(np.nonzero(vertical)[1] + x0).tolist()),
        'horizontal_pixels': int(horizontal.sum()),
        'vertical_pixels': int(vertical.sum()),
    }
    return horizontal_mask, vertical_mask, info


def remove_grid_lines(
    binary: np.ndarray,
    *,
    strength: str = 'medium',
    roi: Sequence[float] | None = None,
    remove_vertical: bool = True,
    max_thickness: int | None = None,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    """Subtract detected grid lines from ``binary``.

    Returns ``(cleaned, line_mask, info)``.
    """
    horizontal, vertical, info = detect_grid_lines(
        binary,
        strength=strength,
        roi=roi,
        remove_vertical=remove_vertical,
        max_thickness=max_thickness,
    )
    line_mask = horizontal | vertical
    info['removed_pixels'] = int(line_mask.sum())
    return np.asarray(binary, dtype=bool) & ~line_mask, line_mask, info


def detect_horizontal_grid_lines(
    binary: np.ndarray,
    min_length: int = 35,
    min_row_occupancy_ratio: float = 0.35,
    max_thickness: int = 3,
) -> tuple[np.ndarray, list[int]]:
    """Detect horizontal coordinate lines and cross-column grid lines.

    Kept for callers that only care about the horizontal pass. Unlike the original
    implementation -- which deleted every ink pixel in a flagged row, decapitating
    filled taxa -- only pixels belonging to a *thin* stroke are reported, and the
    band must span ``min_row_occupancy_ratio`` of the width rather than merely
    having that many foreground pixels scattered across it.

    Parameters
    ----------
    binary : np.ndarray
        2D binary image (H x W) where True/1 is dark ink/foreground.
    min_length : int
        Minimum width of a horizontal linear structure.
    min_row_occupancy_ratio : float
        Fraction of the width the thin band must span to be accepted.
    max_thickness : int
        Maximum vertical extent, in pixels, for a stroke to count as a line.

    Returns
    -------
    hlines_mask : np.ndarray
        2D boolean mask of pixels belonging to detected horizontal grid lines.
    hline_rows : list of int
        Sorted row indices containing horizontal grid lines.
    """
    binary = np.asarray(binary, dtype=bool)
    if binary.ndim != 2 or binary.size == 0:
        return np.zeros_like(binary, dtype=bool), []

    width = binary.shape[1]
    mask = _detect_linear_structures(
        binary,
        run_length=max(3, int(min_length)),
        min_span=max(float(min_length), float(min_row_occupancy_ratio) * width),
        max_thickness=int(max_thickness),
        vertical=False,
    )
    rows = sorted(np.unique(np.nonzero(mask)[0]).tolist())
    return mask, rows


def remove_horizontal_grid_lines(
    binary: np.ndarray,
    min_length: int = 35,
    min_row_occupancy_ratio: float = 0.35,
    max_thickness: int = 3,
) -> tuple[np.ndarray, list[int]]:
    """Remove pervasive horizontal grid lines from a binary image.

    Parameters
    ----------
    binary : np.ndarray
        2D binary image (H x W).
    min_length : int
        Minimum horizontal line length.
    min_row_occupancy_ratio : float
        Minimum fraction of the width the thin band must span.
    max_thickness : int
        Maximum vertical stroke extent still counted as a line.

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
        max_thickness=max_thickness,
    )
    cleaned = np.asarray(binary, dtype=bool) & (~hlines_mask)
    return cleaned, hline_rows


def rasterize_strokes(
    shape: tuple[int, int],
    strokes: Iterable[dict[str, Any]] | None,
) -> tuple[np.ndarray, np.ndarray]:
    """Rasterize user brush strokes into ``(restore_mask, erase_mask)``.

    Each stroke is ``{'mode': 'erase'|'restore', 'radius': int, 'points': [[x, y], ...]}``
    in image pixel coordinates. Strokes are stored (rather than a bitmap) so they
    stay serialisable, undoable, and re-appliable when the strength preset or the
    ROI changes the automatic mask underneath them.
    """
    restore = np.zeros(shape, dtype=bool)
    erase = np.zeros(shape, dtype=bool)
    for stroke in strokes or ():
        if not isinstance(stroke, dict):
            continue
        points: list[tuple[float, float]] = []
        for point in stroke.get('points') or ():
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            try:
                points.append((float(point[0]), float(point[1])))
            except (TypeError, ValueError):
                # A non-numeric coordinate marks a malformed stroke; skip the
                # point rather than aborting the whole correction layer.
                continue
        if not points:
            continue
        target = restore if str(stroke.get('mode')) == 'restore' else erase
        radius = max(1.0, float(stroke.get('radius', 4)))
        _draw_polyline(target, points, radius)
    return restore, erase


def _draw_polyline(canvas: np.ndarray, points: list[tuple[float, float]], radius: float) -> None:
    """Stamp a disc of ``radius`` along a polyline directly into ``canvas``."""
    height, width = canvas.shape
    if len(points) == 1:
        points = [points[0], points[0]]
    for (ax, ay), (bx, by) in zip(points[:-1], points[1:]):
        lo_x = max(0, int(np.floor(min(ax, bx) - radius)))
        hi_x = min(width, int(np.ceil(max(ax, bx) + radius)) + 1)
        lo_y = max(0, int(np.floor(min(ay, by) - radius)))
        hi_y = min(height, int(np.ceil(max(ay, by) + radius)) + 1)
        if hi_x <= lo_x or hi_y <= lo_y:
            continue
        ys, xs = np.mgrid[lo_y:hi_y, lo_x:hi_x]
        dx, dy = bx - ax, by - ay
        span = dx * dx + dy * dy
        if span <= 0:
            nearest_x, nearest_y = np.full(xs.shape, ax), np.full(ys.shape, ay)
        else:
            t = ((xs - ax) * dx + (ys - ay) * dy) / span
            np.clip(t, 0.0, 1.0, out=t)
            nearest_x = ax + t * dx
            nearest_y = ay + t * dy
        inside = (xs - nearest_x) ** 2 + (ys - nearest_y) ** 2 <= radius * radius
        canvas[lo_y:hi_y, lo_x:hi_x] |= inside


def mask_overlay_data_url(ink: np.ndarray, line_mask: np.ndarray) -> str:
    """Render the line-removal QC overlay as a ``data:image/png;base64`` URL.

    Transparent background, opaque white for ink that is kept, opaque red for
    pixels the pipeline actually removes. The frontend draws exactly this image,
    so what the user inspects under the B key *is* what extraction sees.
    """
    ink = np.asarray(ink, dtype=bool)
    line_mask = np.asarray(line_mask, dtype=bool)
    height, width = ink.shape
    rgba = np.zeros((height, width, 4), dtype=np.uint8)
    rgba[ink & ~line_mask] = (255, 255, 255, 255)
    rgba[line_mask] = (239, 68, 68, 235)
    buffer = io.BytesIO()
    Image.fromarray(rgba).save(buffer, format='PNG', optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode('ascii')
    return 'data:image/png;base64,' + encoded


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

