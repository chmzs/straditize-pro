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

#: 线宽上限的自适应比例（相对 ROI 长边）。
#:
#: 线宽判据必须以**像素**计，而像素尺寸随扫描分辨率变化：同一条 zone 横线在
#: 6126px 宽的扫描件上约 6px，在 1600px 的教程图上只有 2px。固定 ``2`` 的后果
#: 是真实扫描件上所有区带线都被判为"太厚"而**一条都检测不到**——实测某张
#: 6126×3477 的扫描图：``max_width=2`` 得 0 条，``=6`` 得 14 条（横线出现在
#: y=1809/2741，与目视测量完全一致）。
#:
#: 比例取自实测标定：真实区带线 6px / ROI 长边 4855px ≈ 0.00124，放宽到
#: 0.0015 留一点余量。更大的比例（如 0.004）会把大量纵向纹理误收为候选。
_AUTO_WIDTH_RATIO = 0.0015

#: 自适应线宽下限：再小的图也不低于 3px，否则抗锯齿边缘会被当成结构线。
_AUTO_WIDTH_FLOOR = 3


def resolve_width_max(sub_shape: Sequence[int], line_width_max: int | None) -> int:
    """把 ``line_width_max`` 解析成实际像素上限。

    ``None`` 表示按 ROI 尺寸自适应（见 :data:`_AUTO_WIDTH_RATIO`）。
    """
    if line_width_max is not None:
        return int(line_width_max)
    long_side = max(int(sub_shape[0]), int(sub_shape[1]))
    return max(_AUTO_WIDTH_FLOOR, int(round(long_side * _AUTO_WIDTH_RATIO)))


def _projection_line_rows(
    binary: np.ndarray,
    *,
    fraction: float,
    min_width: int,
    max_width: int | None,
) -> np.ndarray:
    """Mirror legacy ``_filter_lines`` on a 2-D foreground projection."""
    if binary.size == 0:
        return np.array([], dtype=int)
    coverage = binary.sum(axis=1) / float(binary.shape[1])
    locations = np.where(coverage > float(fraction))[0]
    if not len(locations):
        return locations
    chunks = _cluster_indices(locations)
    selected: list[int] = []
    for chunk in chunks:
        if len(chunk) >= max(1, int(min_width)) and (
            max_width is None or len(chunk) <= int(max_width)
        ):
            selected.extend(chunk)
    return np.asarray(selected, dtype=int)


def _projection_line_cols(
    binary: np.ndarray,
    *,
    fraction: float,
    min_width: int,
    max_width: int | None,
) -> np.ndarray:
    """Column-projection counterpart of :func:`_projection_line_rows`."""
    return _projection_line_rows(
        binary.T,
        fraction=fraction,
        min_width=min_width,
        max_width=max_width,
    )


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
    resolved_max = resolve_width_max((sub_h, sub_w), line_width_max)
    max_thick = int(resolved_max)
    min_span_v = max(1, int(round(line_fraction_v * sub_h)))

    # 1. Kind A: Horizontal lines across ROI (legacy projection semantics).
    rows_h = _projection_line_rows(
        sub_ink,
        fraction=line_fraction_h,
        min_width=line_width_min,
        max_width=resolved_max,
    )
    # ROI 边缘保护带：只够挡掉 1–2px 的 ROI 描边即可，必须是**小常量**。
    #
    # 两次事故都出在这里：曾用 `2 * line_width_max`，线宽放宽到 6px 时保护带变成
    # 12px，把贴着 ROI 下边界、距边仅 8px 的真实 zone 线当成边框吃掉；改成
    # `min(4, resolved_max)` 后仍以**恰好 1 像素**之差拒掉另一条（at_local=2384
    # vs 阈值 2384）。
    #
    # 这里选择偏召回的取舍：ROI 是 UI 叠加层、本就不在墨迹里，即使某条真实边框被
    # 检出，它也只是 `status="candidate"`（不确认就不动像素），用户否掉即可；
    # 反过来漏掉一条真实 zone 线，用户是没有任何补救手段的。
    edge_margin = 2
    for cluster in _cluster_indices(rows_h):
        at_local = int(round(float(np.mean(cluster))))
        # ROI borders are framing geometry, never removable artifacts.
        if at_local <= edge_margin or at_local >= sub_h - 1 - edge_margin:
            continue
        at_global = ry0 + at_local
        candidates.append({
            "id": f"line_h_{at_global}_{len(cluster)}px",
            "kind": "A",
            "axis": "h",
            "at": at_global,
            "span": [rx0, rx1 - 1],
            "width": len(cluster),
            "geometry": {
                "type": "rect",
                "x0": rx0,
                "y0": at_global - len(cluster) // 2,
                "x1": rx1 - 1,
                "y1": at_global + (len(cluster) - 1) // 2,
            },
            "roi_id": roi_id,
            "column_index": None,
        })

    # 2. Kind B: Cross-ROI vertical axes/grid lines (legacy projection semantics).
    cols_v = _projection_line_cols(
        sub_ink,
        fraction=line_fraction_v,
        min_width=line_width_min,
        max_width=resolved_max,
    )
    for cluster in _cluster_indices(cols_v):
        at_local = int(round(float(np.mean(cluster))))
        if at_local <= edge_margin or at_local >= sub_w - 1 - edge_margin:
            continue
        at_global = rx0 + at_local
        candidates.append({
            "id": f"line_v_{at_global}_{len(cluster)}px",
            "kind": "B",
            "axis": "v",
            "at": at_global,
            "span": [ry0, ry1 - 1],
            "width": len(cluster),
            "geometry": {
                "type": "rect",
                "x0": at_global - len(cluster) // 2,
                "y0": ry0,
                "x1": at_global + (len(cluster) - 1) // 2,
                "y1": ry1 - 1,
            },
            "roi_id": roi_id,
            "column_index": None,
        })

    mask_v = np.zeros_like(sub_ink, dtype=bool)
    if len(cols_v):
        mask_v[:, cols_v] = sub_ink[:, cols_v]

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
