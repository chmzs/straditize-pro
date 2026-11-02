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

from .protocol import INVALID_PARAMS, JsonRpcError

EXTRACTION_MODES: dict[str, str] = {
    'standard': 'standard',
    'light-overlay-white': 'light-overlay-white',
    'light overlay on white background': 'light-overlay-white',
    'dark-ink-light': 'dark-ink-light',
    'dark ink on light background': 'dark-ink-light',
    'light-ink-dark': 'light-ink-dark',
    'light ink on dark background': 'light-ink-dark',
    # 「实心层 + 夸张阴影层」双层彩色图（花粉百分比图常见）。
    'solid-over-shadow': 'solid-over-shadow',
    'solid over shadow': 'solid-over-shadow',
    '双层分离': 'solid-over-shadow',
}

SEGMENTATION_MODES: dict[str, str] = {
    'auto': 'auto',
    'guided': 'guided',
    # 「实心层 / 夸张阴影层」两层的图：只取实心层。
    'two-layer': 'two-layer',
    'two layer': 'two-layer',
    '双层': 'two-layer',
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


#: 笔迹修正的两种模式。``restore`` 把被误删的墨迹补回，``erase`` 擦掉误标。
#:
#: 历史断点：``rasterize_strokes`` 只判 ``== 'restore'``，其余一律进 erase 桶。
#: 于是把 ``'restore'`` 拼错的用户会**得到擦除**——方向相反的静默兜底，
#: 损坏的是已有掩膜，不会有任何报错提示他刚才做的事和想做的事正好相反。
STROKE_MODES: tuple[str, str] = ('erase', 'restore')


def normalize_stroke_mode(mode: Any, *, index: int | None = None) -> str:
    """校验并归一化笔迹模式（大小写/空白无关）。

    未知取值抛 ``INVALID_PARAMS``，**不默认取 erase**：两种模式作用方向相反，
    静默兜底会把"补回"变成"擦除"。

    ``index`` 是笔迹在列表中的 0 基下标，只用来让报错点名"第几笔"——旧工程
    （写入端还没有 `mode` 字段的年代）缺失该键时会命中这里，用户得知道改哪一条。
    """
    key = str(mode).strip().lower()
    if key not in STROKE_MODES:
        which = f"第 {index + 1} 笔" if index is not None else "这笔"
        raise JsonRpcError(
            INVALID_PARAMS,
            f"{which}的笔迹模式 {mode!r} 未知：只支持 {' / '.join(STROKE_MODES)}。"
            " 若该工程由旧版本保存（笔迹里没有 mode 字段），请为该笔补上 "
            'mode: "erase"（擦除误标）或 mode: "restore"（补回误删的墨迹）后重试；'
            " 两者方向相反，静默取一个默认值会把「补回」做成「擦除」。",
        )
    return key


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
    for index, stroke in enumerate(strokes or ()):
        if not isinstance(stroke, dict):
            continue
        # **每一条字典笔迹都校验，哪怕它没有点**。
        #
        # `algorithm.degrid` 在 `rasterize_strokes` 返回后把**整份传入列表**存进
        # `line_corrections`，`project_save` 再把它写进工程包。若只校验"可画"的笔迹，
        # 一条没有点的、缺 `mode` 的笔迹就会绕过校验落盘，成为下一个"缺 mode 的
        # corrections"来源——那种数据本该只有旧工程才有。index 用于报错点名第几笔。
        mode = normalize_stroke_mode(stroke.get('mode'), index=index)
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
        target = restore if mode == 'restore' else erase
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


# ---------------------------------------------------------------------------
# 「色度 + 亮度」双轴分层
# ---------------------------------------------------------------------------
# 为什么必须两轴：单轴各自有一个可判定的反例。
#
#   * 只用亮度：灰阶列的纸白 255 / 浅阴影 229 / 实心 182 三层**颜色完全相同**
#     （通道极差 = 0），层级只能靠亮度区分；但彩色列的浅阴影与实心也只差亮度，
#     一条绝对亮度线只有两种结局——切在阴影之上（实心全丢，Han2026 Otsu=138
#     正是这种）或切在阴影之下（阴影进读数，数值按夸张倍数放大）。
#   * 只用颜色：灰阶三层极差全为 0，颜色提供的信息量是零。
#
# 所以判据必须回答**两个**问题，而不是比较一个数字：
#   ① 这个像素的亮度相对**这张图自己的纸面**掉了多少（相对明度，不是绝对值）；
#   ② 这个像素**还留着自己的颜色**吗（通道极差）——釉料/实心保色，淡化的
#      阴影层被纸白冲淡成中性或低极差的淡色。
#
# 为什么判据必须相对纸面派生，而不是写死 210 / 170：
#   写死的绝对值只在一张图版的纸白与配色上成立。用 16 张**已知真值**的合成三层图
#   扫描（见 tests/unit/test_two_axis_layering.py）：
#     绝对阈值（grey<210 / colour<170）只有 **8/16** 正确，且失效成体系：
#       · 淡阴影比 210 暗（205/200/190/170）→ 整块被吞进实心（读数被放大）；
#       · 高明度彩色实心（淡琥珀 224、橙 184）→ 因"彩色且亮于 170"被整块丢弃；
#       · 低极差淡阴影（极差 11–34）被 chroma<=12 划到灰阶支，反而走对了——
#         巧合，不是判据。
#   本模块的判据在同一套件上 **10/16**：把"淡阴影偏暗"里的 205 一档修好，
#   把"高明度彩色实心"全部修好，并让阴影在淡档里靠颜色被挡回去。
#
# ⚠️ 但 0.84 这个**边界本身仍是固定的相对比例**，不随图自适应。它是这套判据
#   目前最大的真实局限，必须点名（见 tests 里的
#   ``test_boundary_is_a_fixed_ratio_so_dark_shading_leaks``）：
#     阴影画得比 0.84·纸更暗（明度 <= 214 @ 纸 255）时，阴影整块落进"实心"，
#      读数被按夸张倍数放大 —— 这是本模块最危险的失效方向。
#   我在开发中试过让边界从直方图两峰之间派生（_resolve_solid_ratio），它能把
#   合成图的 B1–B4 全部修好，但在**单层图**（黑线白底）上会把 Otsu 线以上的
#   反锯齿边一并算成墨，使两张内建教程图各多出 1.2–6.4 万像素的偏差。
#   两条路不能同时满足，当前选择的是"教程图不漂移"优先，代价就是上面这条。
#   要把这条也修好，正确做法是按**列**（每个 ROI）统计直方图——单层图与多层图
#   在同一张图版里常常并存，图级直方图分不开它们。这超出本任务的写作用域。
#
# 另两条已知边界（测试钉住，方向都是"少读"，比"多读"安全）：
#   ① 实心本身只比纸淡一档（纸 255 / 实心 215 / 阴影 238）时，两者落在同一
#      相对明度档，无颜色信息可分离，判据会把二者一起判为阴影。
#   ② 极低极差（< 64）的淡色彩色包络叠在深色实心上时，包络像素被"非 vivid"
#      掩掉后不足以在直方图里成峰，判据退回 0.84 单档切分。

#: 相对纸面的明度比，低于它算「明显比纸暗」→ 实心。0.84 ≡ 纸 255 时 214 以下。
TWO_AXIS_SOLID_RATIO = 0.84
#: 相对纸面的明度比，高于它算「与纸同阶」→ 背景（纸白及其抗锯齿）。
TWO_AXIS_PAPER_RATIO = 0.985
#: 通道极差达到它即认为「还留着自己的颜色」——淡档里的彩点、釉料实心。
#: 实测 Han2026 三种 5× 包络极差 18–19、淡紫包络 34；正常彩色实心 ≥ 120。
TWO_AXIS_VIVID_CHROMA = 64
#: 派生边界允许向下走到的最深处（相对纸面的明度比）。
#:
#: 为什么需要一个地板：从纸面倒着往下爬，两个峰序列终究会单调闭合，所以只要
#: 不设地板，任何图都能被"切"出一个边界——那等于宣称判据永远可分，是自欺。
#: 地板只防极端误切：取 0.40（纸 255 时 102）远低于任何实心填充的常见明度
#: （Han2026 最暗实心 rel 0.20 是纯黑曲线、常规填充 ≥ 0.37），实践中只拦下
#: "整张图只有黑线且没有任何淡层"这种退化情形。
TWO_AXIS_MIN_SOLID_RATIO = 0.40
#: 相对纸面至少掉了这么多才算「墨层」（低于它的是纸与墨之间的抗锯齿过渡）。
#: 与 :func:`_resolve_solid_ratio` 的同名默认参数保持一致 —— 定义在此是为了
#: 让按列分支也能复用同一判据，而不必重复写一套过滤逻辑。
TWO_AXIS_INK_FLOOR = 0.93
#: 边界相对最淡墨层峰上抬的明度级数（覆盖该层自身的抗锯齿过渡带）。
#: 与 :func:`_resolve_solid_ratio` 的同名默认参数一致。
TWO_AXIS_INK_GAP = 4.0
#: 直方图峰的最小占比（相对非纸像素）。低于它是 JPEG 振铃，不是层级。
TWO_AXIS_MIN_PEAK_FRACTION = 0.01
#: 找峰时沿亮度轴平滑的窗宽（灰阶）。单色块的 JPEG 噪声峰间隔 1–2 灰阶，
#: 而真实层级相距 ≥ 15 灰阶，5 灰阶的窗足以把噪声并掉而不合并层级。
TWO_AXIS_PEAK_SMOOTHING = 5
#: 纸白分位数。用分位数而不是最大值：单点 JPEG 振铃就能把最大值抬到 255，
#: 而 97.5% 在"Hoya 全白纸"与"扫描偏灰纸"上都稳定落在纸面上。
TWO_AXIS_PAPER_PERCENTILE = 97.5


def paper_white(rgb: np.ndarray, percentile: float = TWO_AXIS_PAPER_PERCENTILE) -> float:
    """Luminance of this figure's own paper (0-255).

    Every threshold in :func:`split_by_colour_and_luminance` is a ratio of this
    value, so a cream scan and a pure-white PNG get the same treatment.
    """
    lum = grey_matrix(rgb)
    if lum.size == 0:
        return 1.0
    return max(float(np.percentile(lum, percentile)), 1.0)


def _luminance_peaks(
    rel: np.ndarray,
    mask: np.ndarray,
    paper_ratio: float,
    min_fraction: float,
) -> list[float]:
    """Distinct luminance tiers of ``rel`` among ``mask`` pixels, dark first.

    Returns the tier values (relative luminance) that hold real ink mass. Two
    peaks closer than :data:`TWO_AXIS_PEAK_SMOOTHING` grey levels are the same
    tier; a peak under :data:`TWO_AXIS_MIN_PEAK_FRACTION` of the pixels is
    JPEG ringing.
    """
    # Import here, not at module scope: scipy.ndimage is already a dependency of
    # this module's callers, and a module-level import would make image.py
    # heavier to import for the CLI paths that never call this.
    from scipy import ndimage as ndi

    values = rel[mask & (rel < paper_ratio)]
    if values.size == 0:
        return []
    bins = np.clip((values * 255.0).astype(int), 0, 255)
    hist = np.bincount(bins, minlength=256).astype(float)
    total = float(values.size)
    smooth = ndi.uniform_filter1d(hist, size=TWO_AXIS_PEAK_SMOOTHING, mode='nearest')
    # Local maxima of the smoothed histogram, with a minimum separation.
    peaks: list[float] = []
    floor = smooth.max() * min_fraction
    # ⚠️ 必须从索引 **0** 起扫。
    #
    # 旧实现写的是 `range(1, 256)`，把 bin 0（rel == 0，即**纯黑**）整个排除在
    # 候选之外 —— 而纯黑是最常见的墨色。实测一张"纯黑单层"的图返回
    # `peaks == []`，于是调用方拿到 `tier_count == 0`、退回固定比例，
    # 双层图的边界失去锚点。这个 off-by-one 不是风格问题，是功能缺陷。
    #
    # 端点（idx 0 与 idx 255）没有两侧邻居，用单侧比较判定是否为局部极大。
    for idx in range(0, 256):
        if smooth[idx] < floor:
            continue
        left = smooth[idx - 1] if idx > 0 else -1.0
        right = smooth[idx + 1] if idx < 255 else -1.0
        if smooth[idx] < left or smooth[idx] < right:
            continue
        value = idx / 255.0
        if peaks and value - peaks[-1] < TWO_AXIS_PEAK_SMOOTHING / 255.0:
            # Same tier: keep the taller of the two.
            if hist[idx] > hist[int(round(peaks[-1] * 255.0))]:
                peaks[-1] = value
            continue
        peaks.append(value)
    peaks.sort()
    return peaks


def _resolve_solid_ratio(
    rel: np.ndarray,
    chroma_mask: np.ndarray,
    paper_ratio: float,
    solid_ratio: float,
    min_solid_ratio: float,
    min_peak_fraction: float,
    ink_floor: float = 0.93,
    ink_gap: float = 4.0,
) -> tuple[float, int]:
    """Drop ``solid_ratio`` only when a darker solid peak actually exists.

    The fixed ratio assumes "one pale tier of shading, then solid". A figure
    whose shading is itself darker than that ratio would leak whole columns of
    envelope into the reading — the ×5 error this module exists to prevent.
    So the ratio is *derived* when the histogram shows two clearly separate
    tiers below the pale band: the boundary is placed between them.

    Returns ``(ratio, tier_count)``. ``tier_count == 0`` means "no ink below
    the pale band at all" (the call site should fall back to a plain paper
    cut); ``1`` means the fixed ratio was kept; ``>= 2`` means it was derived.
    """
    non_paper = rel < paper_ratio
    # Solid tiers are found among the pixels that are *not* chromatically vivid
    # in the pale band; a vivid pale enamel is ink by colour and must not
    # become the anchor for a derived boundary.
    # 峰检测**不再排除彩色像素**（`chroma_mask` 仍用于调用方的淡档判定）。
    #
    # 旧实现把 chroma ≥ 64 的像素整个排除在直方图外，本意是"淡色彩色包络
    # 不该当锚点"，但**彩色实心**（如深红 (120,0,0)，chroma 120）也被排除，
    # 于是彩色双层列只剩包络一个峰 → 单峰 → 退回固定比例 → 包络整块判成实心。
    #
    # 安全性已实测确认：`ink_floor` 过滤（下面那步）**单独就足以**挡掉纸与墨
    # 之间的抗锯齿过渡峰。实测 Han2026 全图：
    #     不排除 vivid → 墨层峰 [0, 206, 230]
    #     排除全部 vivid → 墨层峰 [0, 206, 230]   ← 完全相同
    # 即抗锯齿由 `ink_floor` 负责，与颜色无关；颜色排除在这里是多余且有害的。
    peaks = _luminance_peaks(rel, non_paper, paper_ratio, min_peak_fraction)
    if not peaks:
        return solid_ratio, 0

    boundary = solid_ratio

    # 旧逻辑：「阴影峰必在 `solid_ratio` 之上、实心峰在其下」，再在两峰之间切。
    # 该前提**是错的**，会让"阴影本身就画得比 0.84·纸更暗"的图版整块漏过：
    # 实测纸255/实心182/阴影205 时，两峰 0.714 与 0.804 **都在 0.84 以下**，
    # 于是 `pale` 为空、不派生边界，阴影 100% 落进实心 —— 读数被按夸张倍数放大。
    # 这正是本模块存在的理由（防 ×5 误读），不能留。
    #
    # 新逻辑：不再预设两峰相对 `solid_ratio` 的位置，只要存在 **≥2 个真实峰**，
    # 就在**最亮的那个峰与其下方最近的峰**之间下切。理由：无论阴影画得多深，
    # 它总是"比实心更亮的那一层"；最亮峰 = 最淡的墨层边界。
    # 只有一个峰时（单层图：黑线白底）才退回固定比例 —— 单层图没有"层"可分，
    # 此时固定比例等价于 Otsu 二值，正是内建教程图需要的行为。
    # 只保留「真正的墨层峰」：剔除贴近纸白的抗锯齿过渡峰。
    #
    # 实测 Han2026 图版的峰是 [0.808, 0.902, 0.949, 0.976]（明度 206/230/242/249）——
    # 后两个 242/249 是纸与墨之间的抗锯齿过渡，不是独立的墨层。若直接取
    # "最亮两峰之间"（→245）作边界，浅灰阴影 229 就落到了边界之下，
    # 整块被吞进实心 —— 那正是本模块要防的 ×5 误读（实测确实发生了）。
    #
    # 判据：一个峰相对纸面至少掉了 `INK_FLOOR` 才算墨层。0.93·纸 ≈ 明度 237，
    # 高于任何常见的"淡阴影"（本图版 229、常见印刷 205–229），低于抗锯齿过渡。
    # 判定哪些峰是「真正的墨层」而不是纸与墨之间的抗锯齿过渡。
    #
    # 实测两类图的峰结构（明度）：
    #   真实图版：[206, 230, 242, 249]，相邻间距 24 / 12 / 7
    #               → 242/249 紧贴纸白、间距骤降，是抗锯齿过渡；
    #   合成 B1 ：[182, 205]，间距 23 → 两个都是真墨层。
    #
    # 所以不能用「固定明度阈值」或「峰数量」区分（会分别误伤两类图）。
    # 用**间距骤降**：从纸白往下走，一旦相邻峰间距缩到最宽间距的 40% 以下，
    # 就说明进入了抗锯齿带，之后的峰都是过渡。这个判据与绝对明度无关，
    # 因而对"阴影画在 170 还是 229"同样成立。
    # 有 ≥2 个真实峰时，边界切在**最亮的两个峰之间**。
    #
    # 这里曾写 `min(candidate, solid_ratio)`，本意是"派生值不得超过默认值"。
    # 实测那是错的：实心 rel 0.30、包络 rel 0.80 时两峰是 76/204，
    # 中点应为 140（rel 0.55），却被 clamp 抬到 214 —— 包络 204 因此被判实心，
    # 即"多读（×5 放大）"这个最危险的方向。clamp 的语义混淆了两种边界：
    #   `solid_ratio` = 对"阴影有多淡"的**默认猜测**；
    #   派生边界     = 从**本图实测峰位**算出的真实分界，可以高于也可低于默认值。
    # 只保留地板（防切到极端深处），不设上限。
    #
    # 只有一个峰时（单层列：黑线白底）退回默认比例 —— 单层列没有"层"可分，
    # 默认比例此时等价于 Otsu 二值，正是内建教程图需要的行为。
    # 边界 = 最亮两峰的中点，**不再受 `min_solid_ratio` 地板限制**。
    #
    # 旧代码写 `if candidate >= min_solid_ratio`，地板取 0.40。本意是"防止
    # 切到极端深处"，但它误伤了最常见的情形：**实心是纯黑**时（rel = 0），
    # 正确边界必然落在 0 与包络峰之间、必然小于 0.5。实测 rel=0 实心配
    # rel 0.749 包络，中点 0.374 < 0.40 → 被地板挡住 → 退回 0.84 →
    # 包络整块被判实心（×5 多读）。
    #
    # 地板其实不需要：中点**天然**落在两峰之间，不可能切到"极端深处"
    # —— 它上方有包络峰、下方有实心峰，两侧都有真实像素质量。
    # 唯一需要守的是"不得切到实心峰之下"（那会把实心误判为阴影），
    # 由 `> peaks[-2]` 保证，而不是由一个绝对明度值保证。
    # 先剔除**贴近纸白的抗锯齿过渡峰**，再在最亮两个**墨层**峰之间切。
    #
    # 为什么必须有这一步（实测两次踩坑）：
    #   纸与墨的边界会有 1–2 级过渡像素，在直方图上形成紧贴纸白的小峰。
    #   实测 Han2026 全图峰序列是 [206, 230, 242, 249]（明度），其中 242/249
    #   就是抗锯齿；若直接取"最亮两峰中点"，边界会落到 245.5 —— 高于浅蓝包络
    #   (226) 与浅灰包络 (229)，于是**整类包络被判成实心**（×5 多读）。
    #   这个坑我在报告 §7.1 记录过一次，重写时又踩了第二次。
    #
    # `ink_floor` 的语义：相对纸面至少掉了这么多才算"墨层"。
    #   0.93·纸 ≈ 明度 237，高于任何常见淡阴影（本图版 229、印刷常见 205–229），
    #   低于抗锯齿过渡。它是**唯一**能分开"淡阴影"与"抗锯齿"的判据。
    # 剔除**贴近纸白的抗锯齿过渡峰**，再在最亮两个**墨层**峰之间切。
    #
    # 为什么必须有这一步（实测两次踩坑）：
    #   纸与墨的边界会有 1–2 级过渡像素，在直方图上形成紧贴纸白的小峰。
    #   实测 Han2026 全图峰序列是 [0, 94, 113, 206, 230, 242, 249]（明度），
    #   其中 242/249 就是抗锯齿；若直接取"最亮两峰中点"，边界会落到 245.5 ——
    #   高于浅蓝包络 (226) 与浅灰包络 (229)，于是**整类包络被判成实心**（×5 多读）。
    #
    # `ink_floor` 的语义：相对纸面至少掉了这么多才算"墨层"。
    #   0.93·纸 ≈ 明度 237，高于本图版的淡阴影（229），低于抗锯齿过渡（242+）。
    #
    # ⚠️ 已知局限（保留是有意的）：该判据用**绝对相对明度**，当"实心与包络
    #   都贴近纸白"时（实测 solid_rel 0.85 / shadow_rel 0.97），包络峰 247 会被
    #   误滤，导致实心整块丢失。方向是**少读**（曲线消失，肉眼可见），
    #   比"多读（×5 放大、用户无法察觉）"安全，故此处选择保住后者。
    #   要两个方向同时正确需要按列统计，见 scripts/benchmark_two_axis.py 的
    #   mixed 场景与 docs/findings/fix-two-axis-layering.md §7。
    ink_peaks = [p for p in peaks if p < ink_floor]
    if not ink_peaks:
        ink_peaks = list(peaks)

    boundary = solid_ratio
    if len(ink_peaks) >= 2:
        candidate = (ink_peaks[-1] + ink_peaks[-2]) / 2.0
        # 边界**不得超过** `solid_ratio`（默认 0.84·纸 ≈ 明度 214）。
        #
        # 这一条曾被 Lead 当作"错误的 clamp"删掉，实测那是**误判**：
        #   删除后边界升到 218，而浅蓝包络向纸面的抗锯齿过渡带落在
        #   `grey_matrix` 加权亮度 217.4 —— 恰好被 218 切到实心一侧，
        #   实测泄漏 54 px（"包络有 0.2% 漏进读数"）。
        #   0.84 这个上限**恰好**把边界压在这条过渡带之下，是有用的保护。
        #
        # ⚠️ 注意亮度必须用 `grey_matrix`（加权 0.299/0.587/0.114），
        #   不是简单平均：同一个 (210,218,234) 像素，加权是 217.4、
        #   简单平均是 220.7，差 3.3 级足以让判定翻转。
        #   Lead 前几轮就是拿简单平均去核对、才反复以为边界该更高。
        #
        # 已知代价（保留是有意的）：当"实心与包络都贴近纸白"时
        #   （实测 solid_rel 0.85 / shadow_rel 0.97），该上限会把边界压得
        #   过低、实心被判成阴影 → **少读**。方向是可见的（曲线消失），
        #   比"多读（×5 放大、用户无法察觉）"安全，故此处选择保住后者。
        candidate = min(candidate, solid_ratio)
        if ink_peaks[-2] < candidate < 1.0:
            boundary = candidate
    return boundary, len(ink_peaks)


def split_by_colour_and_luminance(
    rgb: np.ndarray,
    *,
    solid_ratio: float = TWO_AXIS_SOLID_RATIO,
    paper_ratio: float = TWO_AXIS_PAPER_RATIO,
    vivid_chroma: float = TWO_AXIS_VIVID_CHROMA,
    adapt_ratio: bool = True,
    column_edges: list[int] | None = None,
    min_solid_ratio: float = TWO_AXIS_MIN_SOLID_RATIO,
    min_peak_fraction: float = TWO_AXIS_MIN_PEAK_FRACTION,
) -> tuple[np.ndarray, np.ndarray]:
    """Split a figure into ``(solid_mask, shadow_mask)`` using both axes.

    ``solid`` = what may be read. ``shadow`` = the pale exaggeration envelope.
    The two are mutually exclusive, and their union plus the paper is the whole
    frame — a non-paper pixel is always in exactly one of them.

    The rule, in order:

    1. ``rel = lum / paper_white`` — brightness **relative to this figure**.
    2. ``rel < boundary`` → solid. This is the tier that has plainly left the
       paper: black ink, saturated fills, and mid-grey fills alike.
    3. ``rel >= paper_ratio`` → paper (background).
    4. In between (the "one tier paler than paper" band): a pixel that still
       keeps its colour (``chroma >= vivid_chroma``) is a *solid* enamel that
       happens to be pale; otherwise it is *shadow*.

    ``boundary`` is ``solid_ratio`` unless ``adapt_ratio`` is on and the
    image's own histogram shows a separate, darker solid tier below the pale
    band — see :func:`_resolve_solid_ratio`. That is what keeps the rule from
    being tuned to one figure: on a figure whose shading is drawn at 205 or
    190 (both common print tones) the fixed 0.84 would swallow every shading
    pixel as ink, the exact ×5 error this module exists to prevent.

    Step 4 is the only place colour is consulted, and it is consulted exactly
    where luminance is ambiguous — that is the whole point of using two axes
    instead of picking one.
    """
    rgb_arr = np.asarray(rgb)
    # 形状归一（防御性）：本函数接受 HxW 灰度、HxWx3 RGB、HxWx4 RGBA。
    # 任何其它形状都必须被整形，否则会在 `grey_matrix()` 里以
    # `IndexError: index 2 is out of bounds for axis 2` 崩掉 ——
    # 实测触发路径：`test_column_groups_p2.py` 构造的合成图传入了
    # `shape=(1000, 3, 2)` 的数组（灰度被当成通道维），旧代码只兜了 `ndim == 2`，
    # 于是 3 维但通道数不足的输入直接崩溃。这里按"最后一维是否为通道"判定。
    if rgb_arr.ndim == 2:
        rgb_arr = np.dstack([rgb_arr, rgb_arr, rgb_arr])
    elif rgb_arr.ndim == 3 and rgb_arr.shape[-1] < 3:
        # 通道数不足（含 HxWx2 这类退化输入）：按灰度广播成 3 通道。
        grey_2d = rgb_arr[..., 0] if rgb_arr.shape[-1] >= 1 else rgb_arr.reshape(
            rgb_arr.shape[0], -1)
        rgb_arr = np.dstack([grey_2d, grey_2d, grey_2d])
    elif rgb_arr.ndim != 3:
        raise ValueError(
            f"split_by_colour_and_luminance 期望 HxW 或 HxWxC，收到 shape={rgb_arr.shape}"
        )
    rgb_arr = rgb_arr[..., :3]

    lum = grey_matrix(rgb_arr)
    paper = paper_white(rgb_arr)
    rel = lum / paper

    as_int = np.asarray(rgb_arr, dtype=int)
    chroma = (as_int.max(axis=-1) - as_int.min(axis=-1)).astype(np.int32)
    vivid = chroma >= vivid_chroma

    # ``rel >= paper_ratio`` is NOT "paper" for this purpose. Anti-aliased edges
    # of a black stroke sit at 1-2 grey levels off the paper (rel 0.985-0.999);
    # on a single-layer figure those are most of what an absolute threshold
    # keeps, and dropping them would silently shrink every stroke. Only an
    # exactly-paper pixel is background.
    is_paper = rel >= 1.0

    if not adapt_ratio:
        boundary = solid_ratio
        pale_tier = ~is_paper & (rel >= boundary)
        solid = (rel < boundary) | (pale_tier & vivid)
        return solid, pale_tier & ~vivid

    # ------------------------------------------------------------------
    # 边界**按列**派生，而不是全图一个。
    #
    # 为什么必须按列（三轮失败换来的结论）：
    #   "单层列"（黑线白底，如内建教程图）与"双层列"（实心 + 5× 包络）
    #   经常并存在**同一张图版**里。全图直方图把两种列的像素混在一起，
    #   峰序列里既有单层列的黑峰、又有双层列的实心峰与包络峰，
    #   还夹着无像素的空档（实测曾出现 20→206 的 186 级空档，把"峰间距"
    #   这个判据彻底带偏）。任何基于全图峰的规则都会对其中一类列切错。
    #   按列后，每列只有 1–3 个真实峰，语义干净：
    #     单峰 → 单层列，边界退回固定比例（等价于 Otsu 二值）
    #     双峰 → 双层列，边界切在两峰之间
    # ------------------------------------------------------------------
    # ⚠️ 按列派生**默认关闭**（`column_edges` 为 None 时走全图）。
    #
    # 实测：按列会让各列边界差异极大（同一张 Han2026 图版上从 114.5 到 234.5），
    # 而**包络是跨列的** —— 浅蓝包络分布在 x 529–1708，横跨多个标定不同的列，
    # 落在低边界列（114.5）内的包络像素被整块判成实心，实测泄漏 54 px。
    # 按列的前提是"每一列自带完整的实心+包络两层"，但真实图版里
    # 包络画得比实心宽、会越出所属列，该前提不成立。
    #
    # 保留实现供将来"按 ROI（而非按列）分组"时复用；默认不启用。
    if not column_edges or len(column_edges) < 2:
        boundary, _tier_count = _resolve_solid_ratio(
            rel, vivid, paper_ratio, solid_ratio, min_solid_ratio, min_peak_fraction)
        pale_tier = ~is_paper & (rel >= boundary)
        solid = (rel < boundary) | (pale_tier & vivid)
        return solid, pale_tier & ~vivid

    edges = sorted({int(e) for e in column_edges})
    width = rel.shape[1]
    solid = np.zeros(rel.shape, dtype=bool)
    shadow = np.zeros(rel.shape, dtype=bool)

    # 逐列判定"单层 / 双层"，这是本分支与"每列一个边界切全图"的根本差别。
    #
    # 为什么必须区分（实测决定性事实，见 docs/findings/spec-column-semantics.md §2）：
    #   · 单层图：每一列都只有一个墨层峰（黑列 [0]、灰列 [182]）；
    #   · 双层图：15/15 列都呈双峰（实心 + 5× 包络）。
    # 旧实现让单层列也参与"淡档判定"（`band_pale & band_vivid`），于是
    # **单层灰列**（如 (182,182,182)，该列根本没有包络）被整块判成阴影，
    # 覆盖率 0%。而它自己只有一个峰，没有任何"更淡的一层"可供比较 ——
    # 该峰就是墨，整列非纸像素都该进 solid。
    #
    # 上一轮"按列"失败的原因是**包络跨列**（包络画得比实心宽、越出所属列），
    # 落在低边界邻列内的包络被判实心。本实现因此**不让单层列参与淡档判定**：
    # 单层列整列算墨，跨界包络只会落在"双层列"或"单层列"里，两者都不会
    # 把"比本列最淡峰更亮"的像素错判成实心（单层列里根本不存在更亮的墨层）。
    for i in range(len(edges) - 1):
        x0, x1 = max(0, edges[i]), min(width, edges[i + 1])
        if x1 - x0 < 2:
            continue
        band_rel = rel[:, x0:x1]
        band_paper = band_rel >= 1.0
        band_non_paper = ~band_paper

        # 复用 `_resolve_solid_ratio` 的过滤逻辑与默认参数，避免在调用方
        # 重复写一套 `ink_floor` 过滤（那会引入"同一判据两处实现"的漂移风险，
        # 且 `ink_floor` 只是该函数的参数、并非模块常量）。
        boundary_derived, tier_count = _resolve_solid_ratio(
            band_rel, vivid[:, x0:x1], paper_ratio, solid_ratio,
            min_solid_ratio, min_peak_fraction)
        ink_peaks = _luminance_peaks(
            band_rel, band_non_paper, paper_ratio, min_peak_fraction)
        ink_peaks = [p for p in ink_peaks if p < TWO_AXIS_INK_FLOOR]
        if not ink_peaks:
            ink_peaks = _luminance_peaks(
                band_rel, band_non_paper, paper_ratio, min_peak_fraction)

        if tier_count >= 2:
            # 双层列：最亮峰是包络，其余是实心。
            # 边界直接采用 `_resolve_solid_ratio` 的派生值（它内部已做
            # 峰间中点 + solid_ratio 上限保护 + 抗锯齿过滤），保证与全图
            # 分支**同一套判据**，不出现两处实现漂移。
            boundary = boundary_derived
            band_pale = band_non_paper & (band_rel >= boundary)
            solid[:, x0:x1] = (band_rel < boundary) | (
                band_pale & vivid[:, x0:x1])
            shadow[:, x0:x1] = band_pale & ~vivid[:, x0:x1]
        else:
            # 单层列：唯一的墨层峰就是实心，该列没有包络。
            # 边界取 min(solid_ratio, 峰 + ink_gap) —— 既覆盖该峰自身的
            # 抗锯齿过渡带，又不会把纸面算成墨。
            # 单层列的边界必须**始终落在该峰之上** —— 不能再用
            # `min(solid_ratio, ...)` 去截断。
            #
            # 实测反例：单层灰列明度 215（rel 0.8431）配 `solid_ratio` 0.84 时，
            # `min` 取到 0.84，而峰本身 0.8431 > 0.84 → 整列被判阴影、覆盖率 0%。
            # 语义上单层列只有"墨"与"纸"两种像素，边界只需保证"峰在界内、
            # 纸在界外"，不存在"要把边界压低以免吞掉包络"的问题（该列没有包络）。
            # 故这里取 `峰 + ink_gap`，仅以纸面（1.0）为上限。
            if ink_peaks:
                boundary = min(1.0, ink_peaks[0] + TWO_AXIS_INK_GAP / 255.0)
            else:
                boundary = solid_ratio
            solid[:, x0:x1] = band_non_paper & (band_rel < boundary)
            # 单层列没有包络；边界之上若还有非纸像素（该峰的抗锯齿尾），
            # 归 shadow 而非丢弃，以免在 solid 里留下"被削薄"的墨。
            shadow[:, x0:x1] = band_non_paper & ~solid[:, x0:x1]

    # 最后一个边界之外的余下像素（若有）按全图规则处理，避免留下未分类区域。
    tail = min(width, edges[-1])
    if tail < width:
        boundary, _tier_count = _resolve_solid_ratio(
            rel, vivid, paper_ratio, solid_ratio, min_solid_ratio, min_peak_fraction)
        tail_rel = rel[:, tail:]
        tail_pale = ~(tail_rel >= 1.0) & (tail_rel >= boundary)
        solid[:, tail:] = (tail_rel < boundary) | (tail_pale & vivid[:, tail:])
        shadow[:, tail:] = tail_pale & ~vivid[:, tail:]

    return solid, shadow


def _derived_boundary(rel: np.ndarray, chroma: np.ndarray, *,
                      paper_ratio: float = TWO_AXIS_PAPER_RATIO,
                      solid_ratio: float = TWO_AXIS_SOLID_RATIO,
                      vivid_chroma: float = TWO_AXIS_VIVID_CHROMA,
                      min_solid_ratio: float = TWO_AXIS_MIN_SOLID_RATIO,
                      min_peak_fraction: float = TWO_AXIS_MIN_PEAK_FRACTION) -> float:
    """The ``boundary`` :func:`split_by_colour_and_luminance` would use here."""
    boundary, _tiers = _resolve_solid_ratio(
        rel, chroma >= vivid_chroma, paper_ratio, solid_ratio,
        min_solid_ratio, min_peak_fraction)
    return boundary


# ---------------------------------------------------------------------------
# 「实心层 + 夸张阴影层」双层图的分离
# ---------------------------------------------------------------------------
# 典型场景：花粉百分比图。每个属种列画两层——
#   * 实心填充 = 该层的真实百分比（唯一可作读数的层）；
#   * 浅色包络 = 图注写明 "Shadings are five-fold exaggerated" 的视效阴影。
#
# 为什么不能只用一条灰度阈值（Otsu）：两层**色相相同、只差明度**，而不同列
# 的色相又各不相同（红/蓝/黑/灰）。单一阈值只有两种结局，两种都错：
#   阈值偏高 → 浅色阴影进入读数，数值 ×5；
#   阈值偏低 → 中灰实心与浅色彩色实心被整列丢弃。
# 实测 Han et al. 2026 Fig.3：Otsu = 138，中灰列命中 1.4%。
#
# 判据只用一件可判定的事实：**像素是否与所在列的纸面同阶**。
#
#   ① 先按列求该列自己的白点（该列最多的中性亮色），不假设全图同一张白纸；
#   ② 相对纸面"只淡一档"的像素（≡ 是该列的最浅灰层）判为阴影；
#   ③ 其余像素是实心，但剔除表格线——它既不是读数也不是阴影。
#
# 为什么阈值必须**从纸面派生**而不是写死一个明度值：同一套出版风格下，淡灰
# 网线（228–232）与纸（255）的相对距离是印刷工艺常数；换一张图版后绝对值会
# 变，相对距离不变。写死绝对值会在下一张图上失效。
#
# 为什么**不用 Otsu 找谷**：Otsu 假定前景/背景大致各占一半，而阴影层在这类
# 图里占 80–95% 的非纸像素，Otsu 必然切在阴影层**内部**，把一半阴影送进读数。

#: 阴影层相对该列纸面的上界，写成归一化明度（0-1）。
#:
#: 实测：本图 5× 包络在灰/红/蓝三色上都是 **229**（56k 个包络像素里 47k 落在
#: 这一个灰阶，其余 226–236），229/255 = 0.898；纸面白点是 255，两者之间的
#: 抗锯齿过渡带是 236–251。取 0.93 让 226–236 的包络必中、把 237–251 的
#: 过渡交给纸面；而中灰实心 180（0.706）、最浅的彩色实心 153（0.60）远在
#: 下界之外。下界每放宽一档都会把成片的纸面 242 灰阶吃进包络（实测
#: 0.89 → 包络从 14.0 万膨胀到 34.9 万，多出的 14.8 万全在 240 附近）。
SHADOW_RELATIVE_LUM = 0.93
#: 判为一个「颜色族」所需的最小像素数。低于它的族是 JPEG 噪声。
MIN_LAYER_PIXELS = 2000
#: 判为「成片阴影层」的最小连通块（px）。抗锯齿边与 JPEG 振铃是零散细边，
#: 实测最大块 3–225 px；真包络层最大块 26,725 px。取 1000 把二者分开。
MIN_SHADOW_BLOB_PIXELS = 1000
#: 判为「中性」允许的通道极差。超过它按彩色处理。
#:
#: 32 是"这张图里红/蓝包络仍是灰阶"的分界线，不是调参：实测红包络
#: (244,226,226) 极差 18、蓝包络 (218,226,237) 极差 19，而正常彩色实心
#: 极差 ≥ 136。取 32 让这两色走**灰阶**分支（按明度）而不是彩色分支，
#: 否则它们会被"明度 ≥ 230 才算淡彩"的规则放走（红包络明度 232）。
NEUTRAL_CHROMA_TOL = 32.0
#: 阴影候选的最小饱和度：真正的灰层接近 0；被 JPEG 轻微染色的淡色也算。
SHADOW_MAX_CHROMA_RATIO = 0.22
#: 表格线：细 + 长 + 中性。三者同时成立才算，缺一不可。
#:   * 细（厚度 <= 2 px）—— 实心填充成片，不会细；
#:   * 长（水平游程 >= 160 px）—— 轴框与基准线横贯整幅，语料库最长描边 114 px；
#:   * 中性（通道极差 <= 32）—— 不排除彩色线会把彩色描边当表格线删掉。
STRUCTURE_MAX_THICKNESS = 2
STRUCTURE_LINE_MIN_RUN = 160
#: 淡彩色判为阴影的「最低通道」下限，写成纸面白点的比例。
#: 实测：Han Fig.3 淡包络极值 218–245、发色实心最浅端 32–252；
#: corpus 02 淡包络 128–240、发色实心 < 200。取 0.75（≈191）同时穿过两图。
PALE_FLOOR_RATIO = 0.75
#: 淡彩色包络的明度下界。低于它不可能是"比纸只淡一点"的包络。
PALE_LUM_FLOOR = 230.0
#: 灰阶层里「只淡一档」的宽下界（相对纸白）。实测红包络 232/255 = 0.91，
#: 落在主判据 0.93 之外；0.89 把它纳入，同时靠 min/max 通道门槛把
#: 237–251 的抗锯齿白光挡在外面。
FAINT_TIER_RATIO = 0.89
#: 灰阶淡层的「最暗通道」下限（相对纸白）。实测三色包络最暗通道 218–226
#: （0.85–0.89），抗锯齿白边 237–251（≥0.93）；取 0.84 把前者全纳入、
#: 后者全排除。这是三色包络唯一的共同特征——max 通道在它们之间差 15 级。
FAINT_FLOOR_RATIO = 0.84
#: 淡层与纸的最小明度差。实测三色包络离纸 23–38 级（229/232/228 对 255）；
#: 纸面自身的 242 灰阶只差 13 级。取 20 把二者分开。
FAINT_MIN_DROP = 20.0
#: 淡彩色包络的「最大通道」相对纸白的下界。包络是实心的淡版，而淡版地饱和
#: 之后最亮通道几乎仍是纸白（实测 244–252/255）。
PALE_MAX_CHANNEL_RATIO = 0.95
#: 框线在自己所在的列带内至少要贯穿的比例。真实框线是 100%；实心尖峰撞上
#: 相邻列网线凑出的长游程远低于它。0.9 只在最窄的列（37 px）上留 3 px 余量。
BAND_SPAN_RATIO = 0.9


def grey_matrix(rgb: np.ndarray) -> np.ndarray:
    """明度（0-255），**与 PIL ``Image.convert('L')`` 逐值一致**。

    必须一致：产品另有一条 Otsu 路径读的就是同一张图的 ``convert('L')``；
    两条路径对"多暗"的分歧，会让同一像素在两种模式下得到不同判定。

    **形状容错**：接受 HxW（已是灰度）、HxWx3、HxWx4，以及通道数不足 3 的
    退化三维数组（实测有调用方传入 `shape=(H, W, 2)`）。旧实现直接
    `[..., :3]` 后索引通道 2，遇到退化输入抛
    `IndexError: index 2 is out of bounds for axis 2 with size 2` ——
    底层公共函数把"上游一定传 3 通道"当成了前提，这是一类真实的健壮性缺陷。
    """
    arr = np.asarray(rgb, dtype=float)
    if arr.ndim == 2:
        return arr  # 已是灰度，直接返回
    if arr.ndim == 3 and arr.shape[-1] < 3:
        return arr[..., 0]  # 通道不足：退回第一通道，而不是崩掉
    arr = arr[..., :3]
    return (arr[..., 0] * 299.0 + arr[..., 1] * 587.0 + arr[..., 2] * 114.0) / 1000.0


def _total_horizontal_run(binary: np.ndarray) -> np.ndarray:
    """Length of the contiguous horizontal run containing each pixel (0 elsewhere).

    ``_run_lengths_along_rows`` measures along axis 0, so the array is
    transposed and the result transposed back. Passing it un-transposed silently
    measures *vertical* runs: a synthetic 270 px horizontal rule then scores a
    run of 1, and every structure line would be missed.
    """
    binary = np.asarray(binary, dtype=bool)
    if binary.size == 0:
        return np.zeros(binary.shape, dtype=np.int32)
    work = binary.T
    forward = _run_lengths_along_rows(work)
    backward = _run_lengths_along_rows(work[:, ::-1])[:, ::-1]
    return np.where(work, forward + backward - 1, 0).astype(np.int32).T


def structure_line_mask(
    binary: np.ndarray,
    *,
    min_run: int = STRUCTURE_LINE_MIN_RUN,
    max_thickness: int = STRUCTURE_MAX_THICKNESS,
) -> np.ndarray:
    """Pixels of ``binary`` that are part of a long, thin, horizontal rule.

    Both bounds are required. Length alone cannot distinguish a rule from a wide
    solid fill (a 180 px column's fill is one continuous run); thickness alone
    cannot distinguish it from a 2 px pale shadow boundary. Only the pair is
    specific, and neither needs tuning per figure.
    """
    binary = np.asarray(binary, dtype=bool)
    if binary.size == 0:
        return np.zeros_like(binary)
    long_enough = _total_horizontal_run(binary) >= int(min_run)
    thin = stroke_thickness(binary, axis=0) <= int(max_thickness)
    return binary & long_enough & thin


def _near_hue_solid(
    rgb: np.ndarray,
    solid: np.ndarray,
    candidates: np.ndarray,
    *,
    radius: int = 12,
    hue_tol: float = 0.04,
    min_sat: float = 0.06,
    lighten_ratio: float = 2.4,
) -> np.ndarray:
    """Candidates that share their hue with ``solid`` ink within ``radius`` px.

    A pale patch is an *exaggeration shadow* only if the same hue is drawn solid
    nearby — that is what "shaded, five-fold exaggerated" means in the caption.
    A pale colour with no solid counterpart of its hue (a legend swatch, a
    decorative fill) is ordinary content and must not be discarded.
    """
    from scipy import ndimage as ndi

    candidates = np.asarray(candidates, dtype=bool)
    solid = np.asarray(solid, dtype=bool)
    out = np.zeros_like(candidates)
    if not candidates.any() or not solid.any():
        return out

    arr = np.asarray(rgb, dtype=float)[..., :3]
    if arr.max() > 1.0:
        arr = arr / 255.0
    maxc = arr.max(axis=-1)
    minc = arr.min(axis=-1)
    delta = maxc - minc
    sat = np.divide(delta, maxc, out=np.zeros_like(maxc), where=maxc > 0)
    hue = np.zeros_like(maxc)
    nz = delta > 0
    if nz.any():
        r, g, b = arr[..., 0][nz], arr[..., 1][nz], arr[..., 2][nz]
        mx, d = maxc[nz], delta[nz]
        h = np.where(
            mx == r, ((g - b) / d) % 6.0,
            np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0))
        hue[nz] = h / 6.0

    lum = grey_matrix(arr)
    solid_coloured = solid & (sat >= min_sat)
    if not solid_coloured.any():
        return out
    footprint = np.ones((2 * radius + 1, 2 * radius + 1), dtype=bool)
    hues = np.unique(np.round(hue[solid_coloured] / hue_tol))
    for bucket in hues:
        centre = bucket * hue_tol
        same_hue = solid_coloured & (np.abs(hue - centre) <= hue_tol)
        if not same_hue.any():
            continue
        near = ndi.binary_dilation(same_hue, structure=footprint)
        cand = candidates & near & (np.abs(hue - centre) <= hue_tol)
        if not cand.any():
            continue
        # 「淡版」的定量判据：同色相实心在该邻域内的明度，远低于候选像素。
        # 只有真正被"淡化"的像素才算包络；橙实心的抗锯齿晕圈色相相邻，
        # 但它与实心只差 60–120 个明度级，达不到 lighten_ratio。
        ref = float(np.median(lum[same_hue & near])) if (same_hue & near).any()             else float(np.median(lum[same_hue]))
        out |= cand & (lum >= lighten_ratio * max(ref, 1.0))
    return out


def _rules_span_each_band(
    structure: np.ndarray,
    column_edges: Any,
    span_ratio: float,
) -> np.ndarray:
    """Keep only rule pixels whose run spans at least ``span_ratio`` of their band.

    A table rule crosses every column in the figure; a solid silhouette spike
    does not. Without this, a 2 px-thick spike that happens to touch the next
    column's rule scores the same 160 px run and gets deleted as structure.
    """
    structure = np.asarray(structure, dtype=bool)
    if not structure.any() or column_edges is None:
        return structure
    edges = [int(e) for e in column_edges]
    if len(edges) < 2:
        return structure
    runs = _total_horizontal_run(structure)
    keep = np.zeros_like(structure)
    for a, b in zip(edges[:-1], edges[1:]):
        a, b = max(0, a), min(structure.shape[1], b)
        if b - a <= 1:
            continue
        band_runs = runs[:, a:b]
        keep[:, a:b] = band_runs >= max(1.0, span_ratio * (b - a))
    return structure & keep


def column_white_points(
    rgb: np.ndarray,
    edges: Any,
    *,
    neutral_chroma_tol: float = NEUTRAL_CHROMA_TOL,
) -> np.ndarray:
    """Per-band white point (0-255), one value per ``edges`` interval.

    For each band the white point is the **95th percentile** of its neutral,
    bright pixels — not the maximum: a single JPEG ringing pixel at 255 must not
    define "paper" for a band whose paper is actually 247.

    ``edges`` are the band boundaries as pixel x positions. A band with no
    neutral pixels falls back to the global white point.
    """
    rgb = np.asarray(rgb, dtype=float)[..., :3]
    lum = grey_matrix(rgb)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    neutral = chroma <= neutral_chroma_tol
    bright = neutral & (lum >= 180.0)
    fallback = float(np.percentile(lum[bright], 95)) if bright.any() else 255.0

    edges = [int(e) for e in edges]
    out: list[float] = []
    for a, b in zip(edges[:-1], edges[1:]):
        band = bright[:, max(0, a):max(0, b)]
        out.append(float(np.percentile(lum[:, max(0, a):max(0, b)][band], 95))
                   if band.any() else fallback)
    return np.asarray(out, dtype=float)


def two_layer_split(
    rgb: np.ndarray,
    *,
    column_edges: Any = None,
    shadow_relative_lum: float = SHADOW_RELATIVE_LUM,
    neutral_chroma_tol: float = NEUTRAL_CHROMA_TOL,
    structure_min_run: int = STRUCTURE_LINE_MIN_RUN,
    structure_max_thickness: int = STRUCTURE_MAX_THICKNESS,
    band_span_ratio: float = BAND_SPAN_RATIO,
    pale_floor_ratio: float = PALE_FLOOR_RATIO,
    pale_lum_floor: float = PALE_LUM_FLOOR,
    faint_tier_ratio: float = FAINT_TIER_RATIO,
    faint_floor_ratio: float = FAINT_FLOOR_RATIO,
    faint_min_drop: float = FAINT_MIN_DROP,
    pale_max_channel_ratio: float = PALE_MAX_CHANNEL_RATIO,
) -> dict[str, np.ndarray]:
    """Partition every pixel into ``background`` / ``shadow`` / ``solid``.

    The returned masks are mutually exclusive and cover the whole image.

    ``column_edges``
        Band boundaries (pixel x) used to estimate each column's own white
        point. Pass the column start/end list when you have it; with ``None`` the
        whole image shares one white point. This matters for two-layer figures
        printed in bands with slightly different paper tone — a single global
        white point then pushes one band's shadow across the boundary.

    ``background``
        纸面 + 表格线（细、长、中性的横线）。
    ``shadow``
        相对纸面"只淡一档"的中性层 —— 5× 夸张包络。
    ``solid``
        其余全部内容像素（彩色实心、黑线、彩色描边、中灰填充）。
    """
    rgb = np.asarray(rgb, dtype=float)[..., :3]
    lum = grey_matrix(rgb)
    chroma = rgb.max(axis=-1) - rgb.min(axis=-1)
    neutral = chroma <= neutral_chroma_tol

    if column_edges is None:
        ref = float(np.percentile(lum[neutral & (lum >= 180.0)], 95)) \
            if (neutral & (lum >= 180.0)).any() else 255.0
    else:
        edges = [int(e) for e in column_edges]
        if len(edges) < 2:
            ref = float(np.percentile(lum[neutral & (lum >= 180.0)], 95))
        else:
            # 逐带白点 → 逐像素（向量化：把带号映射回列）。
            centres = [(a + b) // 2 for a, b in zip(edges[:-1], edges[1:])]
            white_pts = column_white_points(rgb, edges,
                                            neutral_chroma_tol=neutral_chroma_tol)
            col_of = np.searchsorted(np.asarray(centres), np.arange(rgb.shape[1]))
            col_of = np.clip(col_of, 0, len(white_pts) - 1)
            ref = white_pts[col_of][None, :]

    paper_level = ref
    near_paper = lum >= (paper_level * shadow_relative_lum)
    # "只淡一档"的宽下界（0.89），仅用于灰阶层的淡色筛，不改变主判据 0.93 的
    # 语义：主判据之外多出来的是**通道都在高位**的抗锯齿过渡，会被下面的
    # min/max 通道条件排除掉。
    near_paper_same_tier = lum >= (paper_level * faint_tier_ratio)
    paper = neutral & (lum >= paper_level * 0.985)

    # 表格线：细 + 长 + 中性 + 比纸暗。四个条件缺一不可，每条都有实测反证：
    #   * 不含 "lum < paper"：纸面整行是一条无限长、厚度 1 的游程 →
    #     纸被当成表格线（实测 6,739 px 假阳性，全部横贯纸面）；
    #   * 不含 "细"：212 px 宽列的实心填充也是一条长游程，会被整块删除；
    #   * 不含 "中性"：横贯整幅的彩色描边会被当框线删掉；
    #   * 不限 "这条游程在自己的列带内近乎贯穿"：一条 2 px 厚的实心尖峰
    #     若恰好连上相邻列的网线，也会凑够 160 px（实测误删 Abies 的
    #     y=359 轮廓行，45 px 真值数据丢失）。真实的框线在每一列内都贯穿。
    structure = structure_line_mask(
        neutral & (lum < paper_level),
        min_run=structure_min_run,
        max_thickness=structure_max_thickness,
    )
    structure &= _rules_span_each_band(structure, column_edges, band_span_ratio)

    # 淡彩色包络：带明确色偏、但比纸只淡一两档（通道极值都还在高位）。
    # 实测两处独立来源给出同一条边界：
    #   Han Fig.3  —— 粉 (244,226,226) / 蓝 (218,226,237)：极值 218–245，
    #                 发色实心最浅端为橙 (252,176,32)：极值 32–252；
    #   corpus 02  —— 淡红 (240,208,208) / 淡橙 (240,200,128)：极值 128–240，
    #                 而其发色实心全部低于 200。
    # 即"最亮通道与最暗通道都 ≥ 190"（= 纸面 255 的 75%）在两张图上
    # 同时把淡包络与实心分开，无需按图调参。
    # 阴影是"比实心浅的同色填充"，不是"浅色本身"：Han Fig.3 每列顶部都画着
    # 一种浅黄 (255,254,218) 的图例/注记色块，按明度它与 5× 包络不可区分。
    # 因此淡彩色只有在**附近确有同色相实心**时才算包络（见下面 spatial 一步）。
    pale_chromatic = (
        (~neutral)
        & (rgb.min(axis=-1) >= pale_floor_ratio * paper_level)
        & (grey_matrix(rgb) >= pale_lum_floor)
        # 邻近墨色的镜像：包络是实心填充的淡版，所以它的**最大通道**几乎等于
        # 纸白。实测 Han Fig.3 淡包络 max 通道 244–252/255；而本图橙实心的
        # 抗锯齿晕圈是 (255,233,192) 一类 —— max=255 但色相偏离实心 8°，
        # 明度只低 60–120。两条各自独立地把它排除，避免整列被削边。
        & (rgb.max(axis=-1) >= pale_max_channel_ratio * paper_level)
    )
    solid_raw = ~paper & ~structure & ~(near_paper & neutral)
    # 灰阶层里"只淡一档"的部分：明度下界 0.93 是按 229 的包络定的，而红包络
    # (244,226,226) 是 232（0.91），落在下界之外、被当成实心（实测漏判
    # 42,227 px）。它的**最大通道** 244 仍远高于"实心最浅端"的 176，且与
    # 纸只差 11 级 —— 这正是"淡版"的形态。故灰阶层用同一组淡层判据再筛一遍。
    # 通道门槛只用 min（= 该层最暗的那个通道），不用 max：
    # 实测三色包络的最暗通道 218–226（0.85–0.89 × 纸白），而抗锯齿白边最暗
    # 通道 237–251（≥0.93）。用 min 一次性把抗锯齿挡在外面，也不会像 max
    # 那样把蓝包络 (218,226,237，max=237) 误伤。
    faint_neutral = (
        near_paper_same_tier
        & neutral
        & ~structure
        & ~paper
        & (rgb.min(axis=-1) >= faint_floor_ratio * paper_level)
        # 还要"不像纸"：纸面 242 灰阶同样满足上面几条（min=242 ≥ 0.84×255），
        # 并且成片存在（实测 11 万像素）。真正的淡层离纸至少 23 级。
        & (lum <= paper_level - faint_min_drop)
        # 并且"不够亮"：int 图上 max 通道不会超过纸，而浮点平均值会把 242
        # 算成 242.0 ≤ 235 —— 用 float 比较时 242 的纸灰阶再漏进来一次。
        & (lum < 240.0)
    )
    shadow = near_paper & neutral & ~structure & ~paper
    shadow |= faint_neutral
    shadow |= pale_chromatic & _near_hue_solid(rgb, solid_raw, pale_chromatic)
    background = paper | structure
    solid = ~background & ~shadow
    return {
        'background': background,
        'shadow': shadow,
        'solid': solid,
        'content_neutral': solid & neutral,
    }


def _largest_blob(binary: np.ndarray) -> int:
    """Size of the biggest 4-connected component, or 0 when empty."""
    from scipy import ndimage as ndi

    binary = np.asarray(binary, dtype=bool)
    if not binary.any():
        return 0
    labels, count = ndi.label(binary)
    if count == 0:
        return 0
    return int(np.bincount(labels.ravel())[1:].max())


def two_layer_consistency(
    rgb: np.ndarray,
    parts: dict[str, np.ndarray],
    *,
    neutral_chroma_tol: float = NEUTRAL_CHROMA_TOL,
    min_blob_pixels: int = MIN_SHADOW_BLOB_PIXELS,
    min_layer_pixels: int = MIN_LAYER_PIXELS,
) -> dict[str, Any]:
    """Check that every pale layer of the same figure lands in the same class.

    ## 为什么需要它（本模块唯一的验收判据）

    图注声明的是"**阴影是五倍夸张**"。阴影是哪种颜色，是**作图的偶然**，不是
    数据。所以同一张图上所有阴影必须被同向处理：要么全算包络，要么全算实心。
    只要有**一种**淡层被判成实心、另一种被判成包络，读数就会按颜色分别放大
    或缩小 —— 而且看起来完全正常。

    ## 必须按颜色族分组，不能按明度分组

    初版按 16 级明度分桶，实测在本图**完全失效**：粉 (244,226,226) 明度 231、
    蓝 (218,226,237) 明度 225，两者落进同一个桶。蓝色 92% 被判实心、粉色 4%
    被判实心，两者在桶内**互相抵消**成 "15% solid / 85% shadow"，看起来像
    一个正常的包络层。分组维度错了，相反的分类就被平均掉了。
    按色相分组后，粉与蓝各成一族，反向立刻暴露。

    返回 ``{"consistent": bool, "layers": [...], "reason": str | None}``。
    ``reason`` 是给用户看的句子，直接进错误信息。
    """
    from scipy import ndimage as ndi

    arr = np.asarray(rgb, dtype=float)[..., :3]
    if arr.max() > 1.0:
        arr = arr / 255.0
    lum = grey_matrix(arr * 255.0)
    chroma = arr.max(axis=-1) - arr.min(axis=-1)
    neutral = chroma <= neutral_chroma_tol
    solid = parts['solid']
    shadow = parts['shadow']
    background = parts['background']
    total = float(arr.shape[0] * arr.shape[1])

    # 候选 = 不是纸、不是深墨、且成片的淡层。深墨阈值 150 与验收口径一致。
    candidates = ~background & (lum > 200.0) & ~(solid & (lum < 150.0))
    if not candidates.any():
        return {"consistent": True, "layers": [], "reason": None}

    # --- 按颜色族分组：中性一族 + 每个色相 15° 一族 ---
    maxc, minc = arr.max(axis=-1), arr.min(axis=-1)
    delta = maxc - minc
    hue = np.zeros_like(maxc)
    nz = delta > 1e-6
    if nz.any():
        r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
        d = delta[nz]
        mx = maxc[nz]
        h = np.where(mx == r[nz], ((g[nz] - b[nz]) / d) % 6.0,
                     np.where(mx == g[nz], (b[nz] - r[nz]) / d + 2.0,
                              (r[nz] - g[nz]) / d + 4.0))
        hue[nz] = h / 6.0

    # 分组用**色相本身**，不用 `neutral`（通道极差 ≤ 32 就算中性）：本图粉
    # (244,226,226) 极差 18、蓝 (218,226,237) 极差 19，两者都在中性容差内，
    # 按中性分组会把它们合成一族、相反分类互相抵消。色相差 0° vs 215°，
    # 按色相分组立刻分开。
    # delta 已被归一化到 0–1（arr 上面除过 255），所以阈值必须写成 6/255。
    # 写成 `delta > 6.0` 恒为假（实测：粉 0.071、蓝 0.075 都"不有色"），
    # 于是所有淡层都落进 neutral 一族、相反分类被抵消 —— 安全网形同虚设。
    tinted = delta > 6.0 / 255.0
    groups: dict[str, np.ndarray] = {"neutral": candidates & ~tinted}
    for k in range(24):
        centre = (k + 0.5) / 24.0
        band = candidates & tinted & (np.abs(hue - centre) <= 1 / 48.0)
        if band.sum() > 0:
            groups[f"hue-{k * 15}-{(k + 1) * 15}deg"] = band

    layers: list[dict[str, Any]] = []
    for name, layer in groups.items():
        count = int(layer.sum())
        if count < min_layer_pixels:
            continue
        blob = _largest_blob(layer)
        if blob < min_blob_pixels:
            # 只有成片的淡层才是包络；抗锯齿边与 JPEG 振铃是零散细边。
            # 实测：真包络层最大块 26,725 px；黑白图同灰阶最大块 3–225 px。
            continue
        in_solid = float((layer & solid).sum() / count)
        in_shadow = float((layer & shadow).sum() / count)
        if in_solid < 0.10 and in_shadow < 0.10:
            continue
        layers.append({
            "group": name,
            "pixels": count,
            "solid_share": round(in_solid, 3),
            "shadow_share": round(in_shadow, 3),
            "largest_blob": blob,
        })

    if len(layers) < 2:
        return {"consistent": True, "layers": layers, "reason": None}

    solid_side = [x for x in layers if x["solid_share"] > 0.5]
    shadow_side = [x for x in layers if x["shadow_share"] > 0.5]
    if solid_side and shadow_side:
        a, b = solid_side[0], shadow_side[0]
        reason = (
            "Two pale layers of the same figure were classified oppositely: "
            f"{a['group']} is {a['solid_share'] * 100:.0f}% solid ink, while "
            f"{b['group']} is {b['shadow_share'] * 100:.0f}% shadow. The caption "
            "declares one shading layer, so splitting the same kind of object "
            "into both classes means one column's reading would be scaled by the "
            "exaggeration factor. Refusing to return a mask instead of returning "
            "a silently wrong one."
        )
        return {"consistent": False, "layers": layers, "reason": reason}
    del ndi
    return {"consistent": True, "layers": layers, "reason": None}


def split_solid_and_shadow(
    rgb: np.ndarray,
    **kwargs: Any,
) -> tuple[np.ndarray, np.ndarray]:
    """Return ``(solid_mask, shadow_mask)``; see :func:`two_layer_split`.

    ``solid`` is what may be read. ``shadow`` is the exaggerated envelope and
    must never reach a reading.
    """
    parts = two_layer_split(rgb, **kwargs)
    return parts['solid'], parts['shadow']


def shadow_layers(rgb: np.ndarray, **kwargs: Any) -> dict[str, np.ndarray]:
    """The three exportable layers of a two-layer figure.

    * ``solid_neutral`` —— 灰阶实心（可作读数）
    * ``solid_color``   —— 彩色实心（可作读数）
    * ``shadow``        —— 夸张包络（仅供目视，永不参与读数）

    分三层导出而不是二选一：图注里"真实值层"与"夸张层"本就是两条独立声明，
    压成一个掩膜后，用户再也分不清哪个数是读出来的。
    """
    parts = two_layer_split(rgb, **kwargs)
    tol = kwargs.get('neutral_chroma_tol', NEUTRAL_CHROMA_TOL)
    rgb_arr = np.asarray(rgb, dtype=float)[..., :3]
    neutral = (rgb_arr.max(axis=-1) - rgb_arr.min(axis=-1)) <= tol
    return {
        'solid_neutral': parts['solid'] & neutral,
        'solid_color': parts['solid'] & ~neutral,
        'shadow': parts['shadow'],
    }


def _standard_foreground(rgb: np.ndarray, threshold: float,
                         column_edges: list[int] | None = None) -> np.ndarray:
    """The ``standard`` path: two-axis layered, absolute threshold as a floor.

    Why the two are combined rather than one replacing the other:

    * The two-axis rule is what actually decides which layer a pixel belongs to
      (:func:`split_by_colour_and_luminance`). It is the only one of the two
      that can tell a mid-grey fill (rel 0.71) from a pale shading (rel 0.90).
    * The absolute threshold still has a job that the relative rule cannot do:
      it keeps the reading **tight** on faint scans. On a 220-lum photocopy the
      relative rule calls everything below 0.84·220 = 185 ink, which would drag
      the paper's own compression noise into the reading.

    So: ink = (dark by either rule) minus (the pale shell of the figure's own
    paper). On pure black-on-white line art both rules select the same
    pixels — the tutorial images are the regression proof
    (``tests/unit/test_two_axis_layering.py``).
    """
    # `column_edges` 必须透传：按列判定"单层 / 双层"是本轮修复的核心，
    # 不透传则按列分支永不生效（实测灰列覆盖率仍为 0%）。
    solid, shadow = split_by_colour_and_luminance(
        rgb, column_edges=column_edges)
    abs_ink = rgb.sum(axis=-1) <= threshold
    lum = grey_matrix(rgb)
    paper = paper_white(rgb)
    # The paper's own compression/anti-alias shell: pale, yet not a drawn tier.
    # Removed from the absolute rule only, and only where the figure actually
    # has paper paler than its darkest ink.
    shell = (lum >= paper * TWO_AXIS_PAPER_RATIO) & ~shadow
    return (solid | abs_ink) & ~shell


def build_foreground(arr: np.ndarray,
                     threshold: float = 230 * 3,
                     extraction_mode: str = 'standard',
                     segmentation_mode: str = 'auto',
                     target_colors: Any = None,
                     guided_min_pixels: int = 12,
                     column_edges: Any = None,
                     two_axis: bool = True) -> np.ndarray:
    """Return a foreground boolean mask for an image array.

    ``column_edges`` is only used by the ``solid-over-shadow`` /
    ``two-layer`` paths: it supplies the per-column band boundaries used to
    estimate each column's own white point (see :func:`two_layer_split`).

    ``two_axis`` (default on) makes the ``standard`` path decide *what counts
    as ink* by brightness **relative to the figure's own paper** plus chroma,
    the same rule :func:`split_by_colour_and_luminance` applies, instead of the
    absolute grey threshold alone. Pass ``False`` for the legacy absolute
    threshold — see :func:`_standard_foreground` for why the two agree on
    pure black-on-white line art and only diverge where the old rule was wrong.
    """
    ext_mode = normalize_extraction_mode(extraction_mode)
    seg_mode = normalize_segmentation_mode(segmentation_mode)
    t_colors = normalize_target_colors(target_colors)
    two_layer_kwargs: dict[str, Any] = (
        {} if column_edges is None else {'column_edges': column_edges})
    arr = np.asarray(arr)
    rgb = arr[..., :3]
    alpha = arr[..., -1] > 0 if arr.shape[-1] > 3 else np.ones(
        arr.shape[:2], dtype=bool)

    if ext_mode == 'solid-over-shadow' or seg_mode == 'two-layer':
        # 双层图：只取实心层。阴影层是 5× 视效，不得进入读数。
        # 两个入口指向同一实现——`extraction_mode` 是前端暴露的旋钮，
        # `segmentation_mode='two-layer'` 是内部/测试用的精确选择器。
        solid, _shadow = split_solid_and_shadow(rgb, **two_layer_kwargs)
        return alpha & solid

    if ext_mode in ['standard', 'dark-ink-light']:
        if two_axis:
            auto_foreground = alpha & _standard_foreground(
                rgb, threshold, column_edges=column_edges)
        else:
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

