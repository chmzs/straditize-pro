"""Cleanup session mixin (T05: Line Removal v2 & Exclusion Regions)."""

from __future__ import annotations

import base64
import io
from typing import Any, Sequence
import numpy as np
from PIL import Image

from ..lines import detect_line_candidates
from ..image import rasterize_strokes


class CleanupMixin:
    """Session mixin for line candidate detection, exclusion regions, and mask synthesis."""

    line_candidates: list[dict[str, Any]]
    selected_candidate_ids: set[str]
    exclusion_regions: list[dict[str, Any]]
    line_strokes: list[dict[str, Any]]

    def _init_cleanup(self) -> None:
        """Initialize cleanup state."""
        self.line_candidates = []
        self.selected_candidate_ids = set()
        self.exclusion_regions = []
        self.line_strokes = []

    def detect_line_candidates(
        self,
        roi_id: str | None = None,
        line_fraction_h: float = 0.75,
        line_fraction_v: float = 0.30,
        line_width_min: int = 1,
        line_width_max: int | None = 2,
    ) -> dict[str, Any]:
        """Detect structured line candidates for an ROI."""
        if not hasattr(self, "line_candidates") or self.line_candidates is None:
            self._init_cleanup()

        if getattr(self, "image", None) is None:
            return {"candidates": []}

        if getattr(self, "foreground_mask", None) is None:
            self.extract_foreground()

        roi = None
        if roi_id and hasattr(self, "_get_roi"):
            roi = self._get_roi(roi_id)
        elif hasattr(self, "rois") and self.rois:
            target_id = getattr(self, "active_roi_id", None) or self.rois[0]["id"]
            roi = self._get_roi(target_id)
            roi_id = target_id
        else:
            roi_id = "roi_1"
            roi = {"xlim": getattr(self, "data_xlim", [0, self.width]), "ylim": getattr(self, "data_ylim", [0, self.height])}

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

        # Merge or replace candidates belonging to this ROI
        other_cands = [c for c in self.line_candidates if c.get("roi_id") != roi_id]
        self.line_candidates = other_cands + candidates
        return {"candidates": candidates}

    def apply_line_removal(
        self,
        roi_id: str | None = None,
        selected_ids: Sequence[str] | None = None,
        strokes: Sequence[dict[str, Any]] | None = None,
        exclusion_regions: Sequence[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Synthesize final mask according to priority: Exclusion > Erase > (Candidates U Restore)."""
        if not hasattr(self, "line_candidates") or self.line_candidates is None:
            self._init_cleanup()

        if getattr(self, "image", None) is None or getattr(self, "foreground_mask", None) is None:
            self.extract_foreground()

        if roi_id and hasattr(self, "_get_roi"):
            roi = self._get_roi(roi_id)
        elif hasattr(self, "rois") and self.rois:
            roi_id = getattr(self, "active_roi_id", None) or self.rois[0]["id"]
            roi = self._get_roi(roi_id)
        else:
            roi_id = "roi_1"
            roi = {"xlim": getattr(self, "data_xlim", [0, self.width]), "ylim": getattr(self, "data_ylim", [0, self.height])}

        # 1. Update exclusions
        if exclusion_regions is not None:
            other_ex = [e for e in self.exclusion_regions if e.get("roi_id") != roi_id]
            self.exclusion_regions = other_ex + list(exclusion_regions)

        # 2. Update brush strokes
        if strokes is not None:
            self.line_strokes = list(strokes)

        # 3. Update selected candidates
        if selected_ids is not None:
            self.selected_candidate_ids = set(selected_ids)

        # 4. Synthesize binary mask
        h, w = self.foreground_mask.shape
        raw_ink = self.foreground_mask.copy()

        # Build candidate line mask
        candidate_mask = np.zeros((h, w), dtype=bool)
        for cand in self.line_candidates:
            if cand["id"] in self.selected_candidate_ids:
                axis = cand["axis"]
                at = cand["at"]
                span = cand["span"]
                width = cand.get("width", 1)
                half = width // 2
                if axis == "h":
                    r0 = max(0, at - half)
                    r1 = min(h, at + half + (width % 2))
                    c0 = max(0, span[0])
                    c1 = min(w, span[1] + 1)
                    candidate_mask[r0:r1, c0:c1] |= raw_ink[r0:r1, c0:c1]
                else:
                    c0 = max(0, at - half)
                    c1 = min(w, at + half + (width % 2))
                    r0 = max(0, span[0])
                    r1 = min(h, span[1] + 1)
                    candidate_mask[r0:r1, c0:c1] |= raw_ink[r0:r1, c0:c1]

        # Brush strokes: restore and erase
        restore_mask, erase_mask = rasterize_strokes((h, w), self.line_strokes)

        # Exclusions: rect and poly
        exclusion_mask = np.zeros((h, w), dtype=bool)
        for ex in self.exclusion_regions:
            kind = ex.get("kind", "rect")
            pts = ex.get("points", [])
            if kind == "rect" and len(pts) >= 4:
                xs = [p[0] for p in pts]
                ys = [p[1] for p in pts]
                x_min, x_max = int(round(min(xs))), int(round(max(xs)))
                y_min, y_max = int(round(min(ys))), int(round(max(ys)))
                x_min, x_max = max(0, min(w, x_min)), max(0, min(w, x_max))
                y_min, y_max = max(0, min(h, y_min)), max(0, min(h, y_max))
                exclusion_mask[y_min:y_max, x_min:x_max] = True
            elif kind == "poly" and len(pts) >= 3:
                from PIL import ImageDraw
                poly_img = Image.new("1", (w, h), 0)
                ImageDraw.Draw(poly_img).polygon([tuple(p) for p in pts], fill=1)
                exclusion_mask |= np.array(poly_img, dtype=bool)

        # Priority Rule: Exclusion is ABSOLUTE
        # final_removed = (candidate_mask | erase_mask | exclusion_mask) & (~restore_mask | exclusion_mask)
        # ink removed from digitisation:
        # line pixels to be subtracted = (candidate_mask & ~restore_mask) | erase_mask
        # Note: restore inside exclusion is rejected / ignored.
        effective_restore = restore_mask & (~exclusion_mask)
        final_line_removal = (candidate_mask | erase_mask) & (~effective_restore)

        # Set session mask for digitisation & columns
        self.grid_line_mask = final_line_removal | exclusion_mask

        # Mark per-ROI columns_stale
        if roi and hasattr(roi, "__setitem__"):
            roi["columns_stale"] = True

        # Generate overlay PNG (RGBA):
        # White = kept ink, Red = removed line pixels, Gray pattern / tint = exclusion
        overlay = np.zeros((h, w, 4), dtype=np.uint8)
        # Kept ink -> White
        kept_ink = raw_ink & (~final_line_removal) & (~exclusion_mask)
        overlay[kept_ink] = [255, 255, 255, 230]
        # Line removed -> Red
        overlay[raw_ink & final_line_removal] = [239, 68, 68, 230]
        # Exclusion -> Gray
        overlay[exclusion_mask] = [156, 163, 175, 180]

        img = Image.fromarray(overlay)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        overlay_b64 = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")

        stats = {
            "candidates_count": len(self.line_candidates),
            "selected_count": len(self.selected_candidate_ids),
            "removed_line_pixels": int((raw_ink & final_line_removal).sum()),
            "exclusion_pixels": int(exclusion_mask.sum()),
        }

        return {"stats": stats, "overlay_png": overlay_b64}
