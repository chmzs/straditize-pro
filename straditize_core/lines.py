"""Line candidate detection and classification (T05: Line Removal v2).

Classes:
- Kind A: Cross-ROI horizontal coordinate lines (贯穿横向线)
- Kind B: Cross-ROI vertical grid lines (贯穿纵向线)
- Kind C: Per-column vertical ticks / baselines (列内纵向线)
"""

from __future__ import annotations

from typing import Any, Sequence
import numpy as np

from .image import _detect_linear_structures


def detect_line_candidates(
    ink: np.ndarray,
    roi: Sequence[float] | dict[str, Any],
    columns: Sequence[dict[str, Any]] | None = None,
    *,
    line_fraction_h: float = 0.75,
    line_fraction_v: float = 0.30,
    line_width_min: int = 1,
    line_width_max: int | None = 2,
    roi_id: str = "roi_1",
) -> list[dict[str, Any]]:
    """Detect structured line candidates inside the declared ROI.

    Uses continuous morphological opening and perpendicular stroke thickness
    to isolate true thin linear structures without eating solid silhouette areas.
    """
    ink = np.asarray(ink, dtype=bool)
    if ink.ndim != 2 or ink.size == 0:
        return []

    height, width = ink.shape

    if isinstance(roi, dict):
        if "xlim" in roi and "ylim" in roi:
            rx0, rx1 = int(round(roi["xlim"][0])), int(round(roi["xlim"][1]))
            ry0, ry1 = int(round(roi["ylim"][0])), int(round(roi["ylim"][1]))
        else:
            rx0, rx1 = int(round(roi.get("xMin", 0))), int(round(roi.get("xMax", width)))
            ry0, ry1 = int(round(roi.get("yMin", 0))), int(round(roi.get("yMax", height)))
    else:
        rx0, rx1, ry0, ry1 = int(round(roi[0])), int(round(roi[1])), int(round(roi[2])), int(round(roi[3]))

    rx0, rx1 = sorted((max(0, min(width, rx0)), max(0, min(width, rx1))))
    ry0, ry1 = sorted((max(0, min(height, ry0)), max(0, min(height, ry1))))

    sub_ink = ink[ry0:ry1, rx0:rx1]
    sub_h, sub_w = sub_ink.shape
    if sub_h == 0 or sub_w == 0:
        return []

    candidates: list[dict[str, Any]] = []
    max_thick = int(line_width_max) if line_width_max is not None else 100

    # 1. Kind A: Horizontal lines across ROI (贯穿横向线)
    run_len_h = max(16, int(0.10 * sub_w))
    min_span_h = max(run_len_h, int(round(line_fraction_h * sub_w)))
    mask_h = _detect_linear_structures(
        sub_ink,
        run_length=run_len_h,
        min_span=min_span_h,
        max_thickness=max_thick,
        vertical=False,
    )

    # Group contiguous rows
    rows_h = np.where(mask_h.any(axis=1))[0]
    if len(rows_h) > 0:
        clusters = _cluster_indices(rows_h)
        for cluster in clusters:
            if len(cluster) >= line_width_min:
                at_local = int(round(float(np.mean(cluster))))
                at_global = ry0 + at_local
                ink_cols = np.where(np.any(mask_h[cluster, :], axis=0))[0]
                if len(ink_cols) > 0:
                    span = [int(rx0 + ink_cols[0]), int(rx0 + ink_cols[-1])]
                    candidates.append({
                        "id": f"line_h_{at_global}_{len(cluster)}px",
                        "kind": "A",
                        "axis": "h",
                        "at": at_global,
                        "span": span,
                        "width": len(cluster),
                        "roi_id": roi_id,
                        "column_index": None,
                    })

    # 2. Kind B: Cross-ROI vertical grid lines (贯穿纵向线)
    run_len_v = max(16, int(0.08 * sub_h))
    min_span_v = max(run_len_v, int(round(line_fraction_v * sub_h)))
    mask_v = _detect_linear_structures(
        sub_ink,
        run_length=run_len_v,
        min_span=min_span_v,
        max_thickness=max_thick,
        vertical=True,
    )

    cols_v = np.where(mask_v.any(axis=0))[0]
    if len(cols_v) > 0:
        clusters = _cluster_indices(cols_v)
        for cluster in clusters:
            if len(cluster) >= line_width_min:
                at_local = int(round(float(np.mean(cluster))))
                at_global = rx0 + at_local
                ink_rows = np.where(np.any(mask_v[:, cluster], axis=1))[0]
                if len(ink_rows) > 0:
                    span = [int(ry0 + ink_rows[0]), int(ry0 + ink_rows[-1])]
                    candidates.append({
                        "id": f"line_v_{at_global}_{len(cluster)}px",
                        "kind": "B",
                        "axis": "v",
                        "at": at_global,
                        "span": span,
                        "width": len(cluster),
                        "roi_id": roi_id,
                        "column_index": None,
                    })

    # 3. Kind C: Column-internal vertical lines (列内竖线)
    if columns:
        for col_idx, col in enumerate(columns):
            if col.get("roi_id") and col["roi_id"] != roi_id:
                continue
            c_start = int(round(col.get("startX", col.get("start", 0)))) - rx0
            c_end = int(round(col.get("endX", col.get("end", 0)))) - rx0
            c_start = max(0, min(sub_w, c_start))
            c_end = max(0, min(sub_w, c_end))
            if c_end - c_start <= 2:
                continue

            col_sub = sub_ink[:, c_start:c_end]
            # Column-internal lines: span between 15% and min_span_v
            min_c_span = max(10, int(0.15 * sub_h))
            col_mask_c = _detect_linear_structures(
                col_sub,
                run_length=max(8, int(0.05 * sub_h)),
                min_span=min_c_span,
                max_thickness=max_thick,
                vertical=True,
            )
            # Remove any pixels already marked as cross-ROI vertical
            cols_c = np.where(col_mask_c.any(axis=0))[0]
            if len(cols_c) > 0:
                clusters = _cluster_indices(cols_c)
                for cluster in clusters:
                    global_cluster = [c_start + c for c in cluster]
                    # verify not in mask_v
                    if not np.any(mask_v[:, global_cluster]):
                        at_local = int(round(float(np.mean(global_cluster))))
                        at_global = rx0 + at_local
                        ink_rows = np.where(np.any(col_mask_c[:, cluster], axis=1))[0]
                        if len(ink_rows) > 0 and len(ink_rows) < min_span_v:
                            span = [int(ry0 + ink_rows[0]), int(ry0 + ink_rows[-1])]
                            candidates.append({
                                "id": f"line_c_{at_global}_{len(cluster)}px",
                                "kind": "C",
                                "axis": "v",
                                "at": at_global,
                                "span": span,
                                "width": len(cluster),
                                "roi_id": roi_id,
                                "column_index": col_idx,
                            })

    return candidates


def _cluster_indices(indices: np.ndarray | Sequence[int]) -> list[list[int]]:
    if len(indices) == 0:
        return []
    sorted_idx = sorted(int(i) for i in indices)
    clusters: list[list[int]] = []
    current = [sorted_idx[0]]
    for idx in sorted_idx[1:]:
        if idx == current[-1] + 1:
            current.append(idx)
        else:
            clusters.append(current)
            current = [idx]
    if current:
        clusters.append(current)
    return clusters
