"""Affine transformation and angle rectification module for pollen diagrams.

Features:
1. Rotates oblique pollen labels (+45°, +60°, -45°, etc.) into horizontal reading posture.
2. Bilinear interpolation preservation of fine strokes.
3. Mathematically rigorous bi-directional coordinate mapping conforming to SciPy rotate convention.
4. Computes the baseline anchor point (lowest Y position in original image) for spatial column snapping.
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
        Label slant angle. Default is 45.0 degrees.
        In scipy.ndimage.rotate, negative angle rotates clockwise.
        For labels rising from bottom-left to top-right, a clockwise rotation of -45°
        rectifies text into standard horizontal posture.
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

    # Scipy angle for clockwise rectification
    # If angle_deg > 0 (standard 45° slant), we rotate by -angle_deg
    scipy_angle = -abs(angle_deg) if angle_deg != 0 else 0.0

    rot_arr = rotate(
        img_arr,
        angle=scipy_angle,
        reshape=True,
        order=1,
        mode="constant",
        cval=255,
    )

    rot_h, rot_w = rot_arr.shape[:2]

    theta = np.deg2rad(scipy_angle)
    cos_t = np.cos(theta)
    sin_t = np.sin(theta)

    orig_cx = orig_w / 2.0
    orig_cy = orig_h / 2.0
    rot_cx = rot_w / 2.0
    rot_cy = rot_h / 2.0

    meta = {
        "angle_deg": angle_deg,
        "scipy_angle": scipy_angle,
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
        rx = px - rot_cx
        ry = py - rot_cy

        # Reverse map from scipy rotated coords to original unrotated crop coords
        ox = rx * cos_t - ry * sin_t + orig_cx
        oy = rx * sin_t + ry * cos_t + orig_cy

        final_x = ox + gx
        final_y = oy + gy

        mapped.append([round(float(final_x), 1), round(float(final_y), 1)])

    return mapped


def compute_baseline_anchor(box_orig: list[list[float]]) -> tuple[float, float]:
    """Computes the bottom-most / lowest point of an oblique text label in original diagram space.

    In a slanted pollen label, the lowest Y point vertically points to the column baseline (Column.startX).
    """
    pts = np.array(box_orig)
    lowest_idx = np.argmax(pts[:, 1])
    anchor_x = float(pts[lowest_idx, 0])
    anchor_y = float(pts[lowest_idx, 1])
    return anchor_x, anchor_y
