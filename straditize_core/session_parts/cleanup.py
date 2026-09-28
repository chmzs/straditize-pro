"""Cleanup session mixin: geometry-based artifact removal.

Design (see ``docs/plans/2026-09-28-step4-cleanup-redesign.md``):

* A disturbance line is a **vector rectangle geometry** inside the ROI.
* The geometry is rasterised into a mask, and *only inside that mask* are
  foreground pixels dropped — the GIS "inverse mask" model.
* ``geometry`` is the single geometric representation. ``at`` / ``span`` /
  ``width`` are derived display fields, recomputed on every write so the
  legacy view cannot drift from the truth.
* ``status`` is the single status truth (``candidate`` / ``removed``).
  ``selected_candidate_ids`` is a derived compatibility view over it.
* Mask synthesis happens in exactly one place (:meth:`_rebuild_grid_line_mask`)
  so the preview, the statistics and the digitising path cannot disagree.
"""

from __future__ import annotations

import base64
import io
from typing import Any, Sequence

import numpy as np
from PIL import Image

from ..image import rasterize_strokes
from ..lines import detect_line_candidates

CANDIDATE = "candidate"
REMOVED = "removed"


def _rect_of(candidate: dict[str, Any]) -> tuple[int, int, int, int]:
    """Return ``(x0, y0, x1, y1)`` for a candidate.

    ``geometry`` is authoritative; the legacy ``at`` / ``span`` / ``width``
    triple is only a fallback for candidates persisted by an older session.
    """
    geometry = candidate.get("geometry")
    if geometry:
        return (
            int(geometry["x0"]),
            int(geometry["y0"]),
            int(geometry["x1"]),
            int(geometry["y1"]),
        )
    at = int(candidate["at"])
    span = candidate["span"]
    width = int(candidate.get("width", 1))
    half = width // 2
    if candidate.get("axis") == "h":
        return (int(span[0]), at - half, int(span[1]), at - half + width - 1)
    return (at - half, int(span[0]), at - half + width - 1, int(span[1]))


def _apply_derived_fields(candidate: dict[str, Any]) -> None:
    """Recompute the legacy display fields from ``geometry``."""
    x0, y0, x1, y1 = _rect_of(candidate)
    axis = candidate.get("axis", "h")
    candidate["geometry"] = {"type": "rect", "x0": x0, "y0": y0, "x1": x1, "y1": y1}
    candidate["kind"] = "A" if axis == "h" else ("B" if axis == "v" else "C")
    if axis == "h":
        candidate["at"] = (y0 + y1) // 2
        candidate["span"] = [x0, x1]
        candidate["width"] = y1 - y0 + 1
    else:
        candidate["at"] = (x0 + x1) // 2
        candidate["span"] = [y0, y1]
        candidate["width"] = x1 - x0 + 1


class CleanupMixin:
    """Line candidate geometry, exclusion regions, and unified mask synthesis."""

    line_candidates: list[dict[str, Any]]
    exclusion_regions: list[dict[str, Any]]
    line_strokes: list[dict[str, Any]]

    def _init_cleanup(self) -> None:
        """Initialize cleanup state."""
        self.line_candidates = []
        self.exclusion_regions = []
        self.line_strokes = []
        self.candidate_line_mask: np.ndarray | None = None
        self.degrid_line_mask: np.ndarray | None = None
        self.exclusion_mask: np.ndarray | None = None
        self.manual_restore_mask: np.ndarray | None = None
        self.manual_erase_mask: np.ndarray | None = None
        self.cleanup_stats: dict[str, Any] = {}
        self.cleanup_overlay_png: str | None = None

    # ------------------------------------------------------------------
    # status truth + derived compatibility view
    # ------------------------------------------------------------------

    @property
    def selected_candidate_ids(self) -> set[str]:
        """Candidates whose ``status`` is ``removed`` (compatibility view)."""
        return {
            str(cand.get("id"))
            for cand in getattr(self, "line_candidates", [])
            if cand.get("status") == REMOVED
        }

    @selected_candidate_ids.setter
    def selected_candidate_ids(self, ids: Any) -> None:
        wanted = {str(item) for item in (ids or ())}
        for cand in getattr(self, "line_candidates", []):
            cand["status"] = REMOVED if str(cand.get("id")) in wanted else CANDIDATE

    # ------------------------------------------------------------------
    # single mask composition
    # ------------------------------------------------------------------

    def _rebuild_grid_line_mask(self) -> None:
        """Compose the one mask every consumer reads.

        ``exclusion`` is absolute (it wins over a restore stroke); a restore
        stroke wins over geometry/auto removal. Everything else is a union.
        """
        sources = [
            mask
            for mask in (self.candidate_line_mask, self.degrid_line_mask)
            if mask is not None
        ]
        shape = next(
            (mask.shape for mask in sources if mask is not None),
            None,
        )
        if shape is None and self.exclusion_mask is not None:
            shape = self.exclusion_mask.shape
        if shape is None:
            self.grid_line_mask = None
            return

        line = np.logical_or.reduce(sources) if sources else np.zeros(shape, dtype=bool)
        exclusion = (
            self.exclusion_mask
            if self.exclusion_mask is not None
            else np.zeros(shape, dtype=bool)
        )
        if self.manual_erase_mask is not None:
            line = line | self.manual_erase_mask
        if self.manual_restore_mask is not None:
            line = line & ~(self.manual_restore_mask & ~exclusion)
        self.grid_line_mask = line | exclusion

    def _roi_for(self, roi_id: str | None) -> tuple[str, Any]:
        """Resolve the ROI to operate on, falling back to the active one."""
        if roi_id and hasattr(self, "_get_roi"):
            return roi_id, self._get_roi(roi_id)
        if hasattr(self, "rois") and self.rois:
            target = getattr(self, "active_roi_id", None) or self.rois[0]["id"]
            roi = self._get_roi(target) if hasattr(self, "_get_roi") else None
            return target, roi
        return "roi_1", {
            "xlim": getattr(self, "data_xlim", [0, self.width]),
            "ylim": getattr(self, "data_ylim", [0, self.height]),
        }

    def _geometry_mask(
        self,
        raw_ink: np.ndarray,
        roi_id: str,
        *,
        statuses: set[str] | None = None,
    ) -> np.ndarray:
        """Rasterise candidate geometry (optionally filtered by status)."""
        h, w = raw_ink.shape
        mask = np.zeros((h, w), dtype=bool)
        for cand in self.line_candidates:
            if cand.get("roi_id") != roi_id:
                continue
            if statuses is not None and cand.get("status") not in statuses:
                continue
            x0, y0, x1, y1 = _rect_of(cand)
            c0, c1 = max(0, min(w, x0)), max(0, min(w, x1 + 1))
            r0, r1 = max(0, min(h, y0)), max(0, min(h, y1 + 1))
            if r1 <= r0 or c1 <= c0:
                continue
            region = (slice(r0, r1), slice(c0, c1))
            mask[region] |= raw_ink[region]
        return mask

    def _exclusion_mask(self, shape: tuple[int, int], roi_id: str) -> np.ndarray:
        h, w = shape
        mask = np.zeros((h, w), dtype=bool)
        for ex in self.exclusion_regions:
            if ex.get("roi_id") not in (None, roi_id):
                continue
            kind = ex.get("kind", "rect")
            pts = ex.get("points", [])
            if kind == "rect" and len(pts) >= 4:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                x_min = max(0, min(w, int(round(min(xs)))))
                x_max = max(0, min(w, int(round(max(xs)))))
                y_min = max(0, min(h, int(round(min(ys)))))
                y_max = max(0, min(h, int(round(max(ys)))))
                mask[y_min:y_max, x_min:x_max] = True
            elif kind == "poly" and len(pts) >= 3:
                from PIL import ImageDraw

                poly_img = Image.new("1", (w, h), 0)
                ImageDraw.Draw(poly_img).polygon([tuple(p) for p in pts], fill=1)
                mask |= np.array(poly_img, dtype=bool)
        return mask

    # ------------------------------------------------------------------
    # detection
    # ------------------------------------------------------------------

    def detect_line_candidates(
        self,
        roi_id: str | None = None,
        line_fraction_h: float = 0.75,
        line_fraction_v: float = 0.30,
        line_width_min: int = 1,
        line_width_max: int | None = None,
    ) -> dict[str, Any]:
        """Detect disturbance-line geometry for an ROI.

        ``line_width_max=None`` means "derive from the ROI resolution" (see
        :func:`straditize_core.lines.resolve_width_max`). A fixed bound cannot
        work across image sizes: the same zone line is ~2px on a 1600px tutorial
        figure but ~6px on a 6126px scan, so a hard-coded 2 detects nothing at
        all on real scans.

        Detected geometry enters as ``status='candidate'``: the projection
        detector proposes, the user disposes. Nothing is removed until the
        user confirms, so a projection false positive cannot silently
        contaminate the digitisation result.
        """
        if not hasattr(self, "line_candidates") or self.line_candidates is None:
            self._init_cleanup()

        if getattr(self, "image", None) is None:
            return {"candidates": [], "roi_id": roi_id}

        if getattr(self, "foreground_mask", None) is None:
            self.extract_foreground()

        roi_id, roi = self._roi_for(roi_id)

        candidates = detect_line_candidates(
            self.foreground_mask,
            roi,
            columns=getattr(self, "columns", None),
            line_fraction_h=line_fraction_h,
            line_fraction_v=line_fraction_v,
            line_width_min=line_width_min,
            line_width_max=line_width_max,
            roi_id=roi_id,
        )
        for cand in candidates:
            cand.setdefault("status", CANDIDATE)
            cand.setdefault("source", "auto")
            cand.setdefault("confidence", None)
            _apply_derived_fields(cand)

        # Re-detection replaces this ROI's candidate set but keeps other ROIs.
        self.line_candidates = [
            c for c in self.line_candidates if c.get("roi_id") != roi_id
        ] + candidates
        return {"candidates": candidates, "roi_id": roi_id}

    # ------------------------------------------------------------------
    # geometry editing
    # ------------------------------------------------------------------

    def upsert_line_geometry(
        self,
        roi_id: str | None = None,
        geometry: dict[str, Any] | None = None,
        axis: str = "h",
        candidate_id: str | None = None,
        selected: bool = False,
        status: str | None = None,
    ) -> dict[str, Any]:
        """Add or move/resize one geometry, then recompose the shared mask."""
        if not hasattr(self, "line_candidates") or self.line_candidates is None:
            self._init_cleanup()
        if geometry is None:
            raise ValueError("geometry is required")
        if axis not in {"h", "v"}:
            raise ValueError("axis must be 'h' or 'v'")
        if any(key not in geometry for key in ("x0", "y0", "x1", "y1")):
            raise ValueError("geometry must contain x0, y0, x1 and y1")

        x0, x1 = sorted(
            [int(round(float(geometry["x0"]))), int(round(float(geometry["x1"])))]
        )
        y0, y1 = sorted(
            [int(round(float(geometry["y0"]))), int(round(float(geometry["y1"])))]
        )
        # A geometry is always a rectangle: a zero-width drag in the axis
        # direction must still rasterise instead of collapsing to nothing.
        if x0 == x1:
            x1 = x0 + 1
        if y0 == y1:
            y1 = y0 + 1

        roi_id, _ = self._roi_for(roi_id)
        candidate_id = candidate_id or f"manual_{axis}_{len(self.line_candidates) + 1}"
        existing = next(
            (item for item in self.line_candidates if item["id"] == candidate_id), None
        )
        resolved_status = status or (
            REMOVED if selected else (existing or {}).get("status", CANDIDATE)
        )

        candidate = {
            "id": candidate_id,
            "axis": axis,
            "geometry": {"type": "rect", "x0": x0, "y0": y0, "x1": x1, "y1": y1},
            "status": resolved_status,
            "source": (existing or {}).get("source", "manual"),
            "confidence": (existing or {}).get("confidence"),
            "roi_id": roi_id,
            "column_index": (existing or {}).get("column_index"),
        }
        _apply_derived_fields(candidate)

        if existing is None:
            self.line_candidates.append(candidate)
        else:
            existing.update(candidate)

        return self._recompose(roi_id)

    def set_line_geometry_status(
        self,
        candidate_id: str,
        status: str,
        roi_id: str | None = None,
    ) -> dict[str, Any]:
        """Confirm (``removed``) or retract (``candidate``) one geometry."""
        if status not in {CANDIDATE, REMOVED}:
            raise ValueError("status must be 'candidate' or 'removed'")
        target = next(
            (c for c in self.line_candidates if str(c.get("id")) == str(candidate_id)),
            None,
        )
        if target is None:
            raise ValueError(f"unknown geometry id: {candidate_id}")
        target["status"] = status
        roi_id, _ = self._roi_for(roi_id or target.get("roi_id"))
        return self._recompose(roi_id)

    def delete_line_geometry(
        self,
        candidate_id: str,
        roi_id: str | None = None,
    ) -> dict[str, Any]:
        """Delete one geometry entirely."""
        before = len(self.line_candidates)
        self.line_candidates = [
            c for c in self.line_candidates if str(c.get("id")) != str(candidate_id)
        ]
        if len(self.line_candidates) == before:
            raise ValueError(f"unknown geometry id: {candidate_id}")
        roi_id, _ = self._roi_for(roi_id)
        return self._recompose(roi_id)

    def clear_cleanup_edits(self, roi_id: str | None = None) -> dict[str, Any]:
        """Drop every Step-4 edit for an ROI and recompose."""
        roi_id, _ = self._roi_for(roi_id)
        self.line_candidates = [
            c for c in self.line_candidates if c.get("roi_id") != roi_id
        ]
        self.exclusion_regions = [
            e for e in self.exclusion_regions if e.get("roi_id") not in (None, roi_id)
        ]
        self.line_strokes = []
        self.candidate_line_mask = None
        self.exclusion_mask = None
        self.manual_restore_mask = None
        self.manual_erase_mask = None
        return self._recompose(roi_id)

    # ------------------------------------------------------------------
    # synthesis entry points
    # ------------------------------------------------------------------

    def apply_line_removal(
        self,
        roi_id: str | None = None,
        selected_ids: Sequence[str] | None = None,
        strokes: Sequence[dict[str, Any]] | None = None,
        exclusion_regions: Sequence[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Update inputs for one ROI, then recompose the shared mask."""
        if not hasattr(self, "line_candidates") or self.line_candidates is None:
            self._init_cleanup()

        if getattr(self, "image", None) is None or getattr(
            self, "foreground_mask", None
        ) is None:
            self.extract_foreground()

        roi_id, _ = self._roi_for(roi_id)

        if exclusion_regions is not None:
            others = [e for e in self.exclusion_regions if e.get("roi_id") != roi_id]
            self.exclusion_regions = others + list(exclusion_regions)

        if strokes is not None:
            self.line_strokes = list(strokes)

        if selected_ids is not None:
            wanted = {str(item) for item in selected_ids}
            for cand in self.line_candidates:
                if roi_id and cand.get("roi_id") != roi_id:
                    continue
                cand["status"] = REMOVED if str(cand.get("id")) in wanted else CANDIDATE

        return self._recompose(roi_id)

    def _recompose(self, roi_id: str) -> dict[str, Any]:
        """Rebuild geometry/exclusion/brush masks, statistics and preview."""
        if getattr(self, "foreground_mask", None) is None:
            self.extract_foreground()
        raw_ink = self.foreground_mask
        h, w = raw_ink.shape

        geometry_mask = self._geometry_mask(raw_ink, roi_id, statuses={REMOVED})
        preview_mask = self._geometry_mask(raw_ink, roi_id, statuses=None)
        exclusion_mask = self._exclusion_mask((h, w), roi_id)
        restore_mask, erase_mask = rasterize_strokes((h, w), self.line_strokes)

        self.candidate_line_mask = geometry_mask
        self.exclusion_mask = exclusion_mask
        self.manual_restore_mask = restore_mask
        self.manual_erase_mask = erase_mask
        self._rebuild_grid_line_mask()

        final_mask = (
            self.grid_line_mask
            if self.grid_line_mask is not None
            else np.zeros((h, w), dtype=bool)
        )
        degrid = (
            self.degrid_line_mask
            if self.degrid_line_mask is not None
            else np.zeros((h, w), dtype=bool)
        )

        roi_candidates = [c for c in self.line_candidates if c.get("roi_id") == roi_id]
        removed_count = sum(1 for c in roi_candidates if c.get("status") == REMOVED)

        # The mask changed, so this ROI's columns were derived from stale ink.
        # Only this ROI: a sibling ROI's columns stay valid.
        roi_ref = self._get_roi(roi_id) if hasattr(self, "_get_roi") else None
        if roi_ref is not None:
            roi_ref["columns_stale"] = True

        overlay = np.zeros((h, w, 4), dtype=np.uint8)
        kept = raw_ink & ~final_mask & ~exclusion_mask
        overlay[kept] = [255, 255, 255, 230]
        pending = raw_ink & preview_mask & ~final_mask & ~exclusion_mask
        overlay[pending] = [245, 158, 11, 230]
        overlay[raw_ink & final_mask & ~exclusion_mask] = [239, 68, 68, 230]
        overlay[exclusion_mask] = [156, 163, 175, 180]

        buf = io.BytesIO()
        Image.fromarray(overlay).save(buf, format="PNG")
        overlay_png = "data:image/png;base64," + base64.b64encode(
            buf.getvalue()
        ).decode("ascii")
        self.cleanup_overlay_png = overlay_png

        stats = {
            # geometry state
            "geometries_count": len(roi_candidates),
            "removed_count": removed_count,
            "candidates_count": len(roi_candidates),
            "selected_count": removed_count,
            # per-source pixel accounting (raw ink inside each mask)
            "geometry_removed_pixels": int((raw_ink & geometry_mask).sum()),
            "candidate_preview_pixels": int((raw_ink & preview_mask).sum()),
            "degrid_removed_pixels": int((raw_ink & degrid).sum()),
            "exclusion_pixels": int((raw_ink & exclusion_mask).sum()),
            "exclusion_area_pixels": int(exclusion_mask.sum()),
            "manual_erase_pixels": int(erase_mask.sum()),
            "manual_restore_pixels": int(restore_mask.sum()),
            "removed_line_pixels": int((raw_ink & final_mask).sum()),
            "final_removed_pixels": int((raw_ink & final_mask).sum()),
        }
        self.cleanup_stats = stats

        return {
            "roi_id": roi_id,
            "stats": stats,
            "candidates": [dict(c) for c in roi_candidates],
            "selected_ids": sorted(
                str(c["id"]) for c in roi_candidates if c.get("status") == REMOVED
            ),
            "overlay_png": overlay_png,
            "overlay_legend": {
                "candidate": "#f59e0b",
                "removed": "#ef4444",
                "exclusion": "#9ca3af",
                "kept": "#ffffff",
            },
        }
