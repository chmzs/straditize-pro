# -*- coding: utf-8 -*-
"""Shared segmentation helpers used by data readers.

This module centralizes image segmentation logic so reader classes can focus on
state handling and digitization orchestration.
"""
from __future__ import division

import re

import matplotlib.colors as mcol
import numpy as np
import six
import skimage.morphology as skim
from scipy.ndimage import convolve
from skimage.filters import threshold_otsu


READER_SCHEMA_VERSION = 2

EXTRACTION_MODES = {
    'standard': 'standard',
    'light-overlay-white': 'light-overlay-white',
    'light overlay on white background': 'light-overlay-white',
    'dark-ink-light': 'dark-ink-light',
    'dark ink on light background': 'dark-ink-light',
    'light-ink-dark': 'light-ink-dark',
    'light ink on dark background': 'light-ink-dark',
}

SEGMENTATION_MODES = {
    'auto': 'auto',
    'guided': 'guided',
}

EXAGGERATION_MERGE_MODES = {
    'selected-priority': 'selected-priority',
    'selected region priority': 'selected-priority',
    'threshold-legacy': 'threshold-legacy',
    'threshold merge (legacy)': 'threshold-legacy',
}


def _unique_preserve_order(values):
    seen = set()
    ret = []
    for value in values:
        if value not in seen:
            ret.append(value)
            seen.add(value)
    return ret


def _iter_color_tokens(target_colors):
    if target_colors is None:
        return
    if isinstance(target_colors, six.string_types):
        target_colors = [target_colors]
    for color in target_colors:
        if color is None:
            continue
        text = six.text_type(color).strip()
        if not text:
            continue
        for token in re.split(r'[\s,;]+', text):
            token = token.strip()
            if token:
                yield token


def normalize_extraction_mode(extraction_mode):
    if extraction_mode is None:
        extraction_mode = 'standard'
    key = six.text_type(extraction_mode).strip().lower()
    try:
        return EXTRACTION_MODES[key]
    except KeyError:
        raise ValueError('Unknown extraction mode: %s' % extraction_mode)


def normalize_segmentation_mode(segmentation_mode):
    if segmentation_mode is None:
        segmentation_mode = 'auto'
    key = six.text_type(segmentation_mode).strip().lower()
    try:
        return SEGMENTATION_MODES[key]
    except KeyError:
        raise ValueError('Unknown segmentation mode: %s' % segmentation_mode)


def normalize_exaggeration_merge_mode(merge_mode):
    if merge_mode is None:
        merge_mode = 'selected-priority'
    key = six.text_type(merge_mode).strip().lower()
    try:
        return EXAGGERATION_MERGE_MODES[key]
    except KeyError:
        raise ValueError('Unknown exaggeration merge mode: %s' % merge_mode)


def normalize_target_colors(target_colors):
    normalized = []
    for token in _iter_color_tokens(target_colors):
        text = token[1:] if token.startswith('#') else token
        if len(text) != 6 or re.search(r'[^0-9A-Fa-f]', text):
            raise ValueError('Invalid target color: %s' % token)
        normalized.append('#' + text.upper())
    return _unique_preserve_order(normalized)


def target_color_rgb(target_colors):
    target_colors = normalize_target_colors(target_colors)
    if not target_colors:
        return np.zeros((0, 3), dtype=float)
    return np.asarray([
        [int(color[i:i + 2], 16) for i in (1, 3, 5)]
        for color in target_colors], dtype=float) / 255.0


def circular_hue_distance(hue, reference):
    diff = np.abs(hue - reference)
    return np.minimum(diff, 1.0 - diff)


def dominant_overlay_hue(hue, sat, mask):
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
    dominant = (np.arctan2(y, x) / (2 * np.pi)) % 1.0
    return dominant, mag / total


def guided_target_color_mask(rgb, target_colors):
    colors = target_color_rgb(target_colors)
    if not len(colors):
        return np.zeros(np.shape(rgb)[:2], dtype=bool)
    rgb = np.asarray(rgb, dtype=float)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    hsv = mcol.rgb_to_hsv(rgb)
    target_hsv = mcol.rgb_to_hsv(colors.reshape(1, -1, 3)).reshape(-1, 3)
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


def guided_target_hue_family_mask(rgb, target_colors):
    colors = target_color_rgb(target_colors)
    if not len(colors):
        return np.zeros(np.shape(rgb)[:2], dtype=bool)
    rgb = np.asarray(rgb, dtype=float)
    if rgb.max() > 1.0:
        rgb = rgb / 255.0
    hsv = mcol.rgb_to_hsv(rgb)
    target_hsv = mcol.rgb_to_hsv(colors.reshape(1, -1, 3)).reshape(-1, 3)
    hue_dist = circular_hue_distance(
        hsv[..., 0][..., np.newaxis], target_hsv[:, 0])
    sat = hsv[..., 1][..., np.newaxis]
    val = hsv[..., 2][..., np.newaxis]
    return ((hue_dist <= 0.10) & (sat >= 0.03) & (val <= 0.995)).any(axis=-1)


def light_overlay_colored_mask(rgb):
    rgb = np.asarray(rgb, dtype=float)
    maxc = rgb.max(axis=-1)
    minc = rgb.min(axis=-1)
    saturation = np.divide(
        maxc - minc, maxc,
        out=np.zeros_like(maxc, dtype=float), where=maxc > 0)
    return saturation >= 0.08


def _remove_objects_smaller_than(arr, min_size):
    min_size = int(min_size)
    if min_size <= 1:
        return np.asarray(arr, dtype=bool)
    return skim.remove_small_objects(
        np.asarray(arr, dtype=bool), max_size=min_size - 1)


def build_foreground(arr, threshold=230 * 3, extraction_mode='standard',
                     segmentation_mode='auto', target_colors=None,
                     guided_min_pixels=12):
    """Return a foreground mask with optional guided color constraints."""
    extraction_mode = normalize_extraction_mode(extraction_mode)
    segmentation_mode = normalize_segmentation_mode(segmentation_mode)
    target_colors = normalize_target_colors(target_colors)
    arr = np.asarray(arr)
    rgb = arr[..., :3]
    alpha = arr[..., -1] > 0 if arr.shape[-1] > 3 else np.ones(
        arr.shape[:2], dtype=bool)

    if extraction_mode in ['standard', 'dark-ink-light', 'light-ink-dark']:
        auto_foreground = alpha & (rgb.sum(axis=-1) <= threshold)
    elif extraction_mode == 'light-overlay-white':
        bright = rgb.sum(axis=-1) > threshold
        colored = light_overlay_colored_mask(rgb)
        auto_foreground = alpha & (~bright | colored)
    else:
        auto_foreground = alpha & (rgb.sum(axis=-1) <= threshold)

    if segmentation_mode != 'guided' or not target_colors:
        return auto_foreground

    rgb_float = np.asarray(rgb, dtype=float)
    target_mask = guided_target_color_mask(rgb_float, target_colors)
    guided = auto_foreground & target_mask
    if guided.sum() >= guided_min_pixels:
        return guided

    # Fallback for background conflicts: keep target components that are
    # adjacent to the auto foreground.
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
    fallback = _remove_objects_smaller_than(fallback, 6)
    if fallback.sum() >= guided_min_pixels:
        return fallback
    return guided


def split_primary_exagg(rgb, base_mask, overlay_mask, bounds, focus_mask=None):
    """Suggest pale same-hue exaggeration pixels using spatial constraints."""
    base_mask = np.asarray(base_mask, dtype=bool)
    overlay_mask = np.asarray(overlay_mask, dtype=bool)
    candidate = np.zeros_like(base_mask, dtype=bool)
    if focus_mask is not None:
        focus_mask = np.asarray(focus_mask, dtype=bool)
        overlay_mask &= focus_mask
    if not overlay_mask.any():
        return candidate

    hsv = mcol.rgb_to_hsv(np.asarray(rgb, dtype=float))
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
                threshold = threshold_otsu(inside_scores)
            except ValueError:
                threshold = None
            if threshold is not None:
                light_inside = family_current & (score[section] >= threshold)
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
            # Area-like readers are width-from-left by construction.
            # For outside-only overlays we keep the right-side extension.
            preferred_side = 1
        else:
            preferred_side = 1

        # Keep only "outer" light pixels for rows with both primary and
        # exaggeration values.
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

    candidate = _remove_objects_smaller_than(candidate, 6)
    candidate = skim.remove_small_holes(candidate, max_size=12)
    return candidate


def trace_area_profile(section_mask):
    """Return rightmost non-zero index (+1) per row for area-like readers."""
    section_mask = np.asarray(section_mask, dtype=bool)
    values = np.zeros(section_mask.shape[0], dtype=float)
    for row in range(section_mask.shape[0]):
        xs = np.where(section_mask[row])[0]
        if len(xs):
            values[row] = xs.max() + 1
    return values


def trace_bar_profile(section_mask, boundary_pad=1, closing_width=3,
                      max_gap=1):
    """Trace a bar profile while preferring the left-anchored foreground.

    Unlike generic area tracing, bars are expected to grow from the column
    start. We therefore prefer the component attached to the left side,
    suppress isolated full-width rows caused by horizontal guide lines, and
    bridge tiny single-row dropouts in low-resolution scans.
    """
    section_mask = np.asarray(section_mask, dtype=bool)
    if not section_mask.any():
        return np.zeros(section_mask.shape[0], dtype=float)

    cleaned = skim.closing(
        section_mask, footprint=np.ones((1, max(1, int(closing_width))),
                                        dtype=bool))
    values = np.zeros(cleaned.shape[0], dtype=float)
    prev_end = None

    def iter_runs(row_mask):
        xs = np.where(row_mask)[0]
        if not len(xs):
            return []
        splits = np.where(np.diff(xs) > 1)[0] + 1
        groups = np.split(xs, splits)
        return [(int(group[0]), int(group[-1]) + 1) for group in groups]

    def choose_run(runs):
        anchored = [run for run in runs if run[0] <= boundary_pad]
        candidates = anchored or runs
        if prev_end is None:
            return min(candidates, key=lambda run: (run[0], -(run[1] - run[0])))
        return min(
            candidates,
            key=lambda run: (run[0] > boundary_pad,
                             abs(run[1] - prev_end),
                             run[0], -(run[1] - run[0])))

    for row in range(cleaned.shape[0]):
        runs = iter_runs(cleaned[row])
        if not runs:
            prev_end = None
            continue
        start, end = choose_run(runs)
        values[row] = end
        prev_end = end

    col_width = float(cleaned.shape[1])
    suspect_threshold = max(col_width - 1.0, col_width * 0.9)
    min_jump = max(2.0, col_width * 0.25)
    for row, value in enumerate(values):
        if value < suspect_threshold:
            continue
        neigh = values[max(0, row - 1):row].tolist() + \
            values[row + 1:min(len(values), row + 2)].tolist()
        neigh = np.asarray([v for v in neigh if v > 0], dtype=float)
        if not len(neigh):
            continue
        if value - np.nanmedian(neigh) >= min_jump:
            values[row] = np.nan

    values[values == 0] = np.nan
    values = _fill_short_gaps(values, max_gap=max_gap)
    values[~np.isfinite(values)] = 0.0
    return values


def _fill_short_gaps(values, max_gap=4):
    values = np.asarray(values, dtype=float).copy()
    valid = np.where(np.isfinite(values))[0]
    if len(valid) < 2:
        return values
    for left, right in zip(valid[:-1], valid[1:]):
        gap = right - left - 1
        if gap <= 0 or gap > max_gap:
            continue
        values[left + 1:right] = np.linspace(
            values[left], values[right], gap + 2)[1:-1]
    return values


def trace_line_center(section_mask, prune_iterations=2):
    """Trace a stable line center from a binary section."""
    section_mask = np.asarray(section_mask, dtype=bool)
    if not section_mask.any():
        return np.full(section_mask.shape[0], np.nan, dtype=float)

    cleaned = _remove_objects_smaller_than(section_mask, 2)
    if not cleaned.any():
        cleaned = section_mask

    skeleton = skim.skeletonize(cleaned)
    if skeleton.any():
        kernel = np.ones((3, 3), dtype=int)
        for _ in range(max(0, int(prune_iterations))):
            neigh = convolve(skeleton.astype(int), kernel, mode='constant', cval=0)
            endpoints = skeleton & (neigh <= 2)
            if not endpoints.any():
                break
            if skeleton.sum() - endpoints.sum() < max(4, section_mask.shape[0] // 3):
                break
            skeleton = skeleton & (~endpoints)
            if not skeleton.any():
                break
    if not skeleton.any():
        skeleton = cleaned

    centers = np.full(section_mask.shape[0], np.nan, dtype=float)
    prev = None
    for row in range(section_mask.shape[0]):
        xs = np.where(skeleton[row])[0]
        if not len(xs):
            xs = np.where(cleaned[row])[0]
        if not len(xs):
            continue
        if prev is None:
            x = float(np.median(xs))
        else:
            x = float(xs[np.argmin(np.abs(xs - prev))])
        centers[row] = x
        prev = x
    if np.isfinite(centers).sum() < max(4, int(0.4 * len(centers))):
        for row in range(section_mask.shape[0]):
            if np.isfinite(centers[row]):
                continue
            xs = np.where(cleaned[row])[0]
            if len(xs):
                centers[row] = float(np.median(xs))
    if np.isfinite(centers).sum() < 2:
        for row in range(section_mask.shape[0]):
            xs = np.where(section_mask[row])[0]
            if len(xs):
                centers[row] = float(np.median(xs))
    return _fill_short_gaps(centers, max_gap=max(8, section_mask.shape[0]))
