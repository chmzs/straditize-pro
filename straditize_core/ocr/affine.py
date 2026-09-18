"""Affine transformation and angle rectification module for pollen diagrams.

Features:
1. Rotates oblique pollen labels (+45°, +60°, -45°, etc.) into horizontal reading posture.
2. Bilinear interpolation preservation of fine strokes.
3. Mathematically rigorous bi-directional coordinate mapping conforming to SciPy rotate convention.
4. Computes the baseline anchor point (lowest X position) for spatial column snapping.
"""
from __future__ import annotations

from typing import Any
import numpy as np
from PIL import Image
from scipy.ndimage import rotate


def rotate_label_strip(
    image: Image.Image | np.ndarray,
    angle_deg: float = 45.0,
    background_color: int | tuple[int, ...] = (255, 255, 255),
) -> tuple[np.ndarray, dict[str, Any]]:
    """Rotates oblique label row image into a horizontal reading strip.

    Parameters
    ----------
    image:
        Input cropped label strip.
    angle_deg:
        Rotation angle in degrees. Default is +45.0 (typical slanted pollen text in European/Chinese diagrams).
    background_color:
        Fill color for margins (default white).

    Returns
    -------
    (rotated_array, transform_meta)
    """
    if isinstance(image, Image.Image):
        img_arr = np.array(image.convert("RGB"))
    else:
        img_arr = np.asarray(image)

    orig_h, orig_w = img_arr.shape[:2]

    # scipy.ndimage.rotate rotates counter-clockwise for positive angles
    rot_arr = rotate(
        img_arr,
        angle=angle_deg,
        reshape=True,
        order=1,
        mode="constant",
        cval=255,
    )

    rot_h, rot_w = rot_arr.shape[:2]

    theta = np.deg2rad(angle_deg)
    cos_t = np.cos(theta)
    sin_t = np.sin(theta)

    orig_cx = orig_w / 2.0
    orig_cy = orig_h / 2.0
    rot_cx = rot_w / 2.0
    rot_cy = rot_h / 2.0

    meta = {
        "angle_deg": angle_deg,
        "orig_w": orig_w,
        "orig_h": orig_h,
        "rot_w": rot_w,
        "rot_h": rot_h,
        "theta": theta,
        "cos_t": cos_t,
        "sin_t": sin_t,
        "orig_c": (orig_cx, orig_cy),
        "rot_c": (rot_cx, rot_cy),
    }

    return rot_arr, meta


def map_box_to_original(
    box_pts: list[tuple[float, float]] | list[list[float]],
    meta: dict[str, Any],
    global_offset: tuple[float, float] = (0.0, 0.0),
) -> list[list[float]]:
    """Maps 4-point bounding box coordinates from rotated space back to original diagram space."""
    rot_cx, rot_cy = meta["rot_c"]
    orig_cx, orig_cy = meta["orig_c"]
    cos_t = meta["cos_t"]
    sin_t = meta["sin_t"]
    gx, gy = global_offset

    mapped = []
    for px, py in box_pts:
        # 1. Translate relative to rotated center
        rx = px - rot_cx
        ry = py - rot_cy

        # 2. Reverse rotation for scipy image convention (Y downwards):
        # ox = rx * cos(theta) - ry * sin(theta) + orig_cx
        # oy = rx * sin(theta) + ry * cos(theta) + orig_cy
        ox = rx * cos_t - ry * sin_t + orig_cx
        oy = rx * sin_t + ry * cos_t + orig_cy

        # 3. Add global crop offset
        final_x = ox + gx
        final_y = oy + gy

        mapped.append([round(float(final_x), 1), round(float(final_y), 1)])

    return mapped


def compute_baseline_anchor(box_orig: list[list[float]]) -> tuple[float, float]:
    """Computes the bottom-most / lowest point of an oblique text label in original diagram space.

    In a slanted pollen label, the lowest Y point vertically points to the baseline (Column.startX).
    """
    pts = np.array(box_orig)
    lowest_idx = np.argmax(pts[:, 1])
    anchor_x = float(pts[lowest_idx, 0])
    anchor_y = float(pts[lowest_idx, 1])
    return anchor_x, anchor_y
