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
import hashlib
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

    def _image_fingerprint(self) -> str | None:
        """内容指纹：这张图的像素身份，与它从哪来、叫什么名字无关。

        为什么不用 ``image_path``：它是**来源**，不是**身份**。同一条几何在两个
        场景下会被它误判（C1e / PDF 换页）：

        - 工程包载入后 ``image_path`` 是 ``None``（``project_load`` 不恢复它，
          也不该恢复——包里的路径可能属于另一台机器），于是包里所有几何的 scope
          都对不上，用户重新打开工程时确认过的清理**静默失效**；
        - PDF 换页只有页码变、``image_path`` 反而退化成 ``upload://diagram.png``，
          两页尺寸相同时 ``image_path + width + height`` 完全无法区分。

        指纹直接回答 ``_geometry_scope`` 真正想问的问题：**"这块几何是不是画在
        这堆像素上"**。存盘带图 → 载入后像素逐字节相同 → 指纹相同 → 几何继续生效；
        换成另一张图（哪怕同尺寸、同文件名）→ 指纹不同 → 几何失效。B-03 的纵深
        防御因此仍然成立，而且不再依赖"包的图是否恰好路径一致"。

        代价：一次 sha256 要遍历整幅 RGBA。实测 hoya (2339x1654, 15.5MB)
        ``tobytes`` 15.6ms + ``sha256`` 37.6ms ≈ 53ms。故按"当前这张图"缓存进
        ``_image_fingerprint_cache``；``_geometry_scope()`` 被 ``_geometry_mask``
        在每条几何上反复调用，绝不能在那里现算。实测：冷调用 54.4ms，
        命中缓存 1000 次合计 0.21ms。

        **缓存何时作废、为什么必须作废**（与上面的存在理由放在一起，因为这是
        同一条机制的因果）：缓存的生命周期严格等于"当前 ``self.image`` 是同一堆
        像素"。它由 ``StraditizeSession.image`` 的 **property setter** 在每次赋值
        时清空——不是靠各调用点记得手工清。理由：手写清单在本项目已漏过两次
        （B-03 漏 `line_candidates`、B-11 漏 `samples`），而 ``self.image = ...``
        全仓有 6 处（load_image 两分支、rotate_image、project_new 清空、
        project_load 的 tar 分支与 json 分支），靠人肉清单必然再漏。

        作废是**正确性要求，不是性能优化**：若换图后缓存仍是旧值，
        ``_geometry_in_scope()`` 会对所有几何恒返回 True —— B-03 的跨图纵深防御
        被静默拆掉，而界面上完全看不出来。这正是"探针灵敏、观测真实、矩阵全绿，
        但让绿的那个机制已被架空"的形态，故有
        ``tests/unit/test_geometry_scope_content_identity.py::TestFingerprintFollowsTheImage``
        逐路径钉住它。
        """
        cached = getattr(self, "_image_fingerprint_cache", None)
        if cached is not None:
            return cached
        image = getattr(self, "image", None)
        if image is None:
            return None
        try:
            digest = hashlib.sha256(image.convert("RGBA").tobytes()).hexdigest()
        except (AttributeError, OSError, TypeError, ValueError):
            # 这个对象不是一个可用的图像（已 close、库桩、或测试里的占位对象）。
            # 返回 None 表示**内容身份无法判定**，让 `_image_scope_is_match` 退回
            # 按尺寸比对 —— 这是**有意的降级**，不是静默失败：尺寸仍能把跨图几何
            # 挡掉（B-03 的防御不依赖指纹存在）。
            #
            # 绝不能让 None 变成"无条件在范围内"：那等于把 B-03 拆掉。故
            # `_geometry_in_scope` 对 None 指纹走的是尺寸比对分支，见那里的注释。
            return None
        self._image_fingerprint_cache = digest
        return digest

    def _geometry_scope(self) -> dict[str, Any] | None:
        """Return the token identifying the image the current geometry belongs to.

        Step-4 geometry is stored in image pixel coordinates, so it is only
        meaningful for one image. ``roi_id`` cannot express that: ROI ids are
        reissued from ``roi_1`` for every new image (``_init_rois``), so a
        geometry left behind by image A matches image B's ROI id and silently
        erases ink there.

        The token binds **content** (sha256 of the pixels) *and* pixel size:

        - 内容指纹抓住"同一路径/同一尺寸但是另一张图"（PDF 换页、同名覆盖）；
        - 尺寸冗余保留，让缺指纹的旧工程包仍能被判定，也让 scope 在肉眼排查时
          可读。

        历史沿革：这里原本是 ``{image_path, width, height}``。``image_path`` 是
        来源而非身份，导致工程包载入后（``image_path=None``）与 PDF 换页后
        （路径退化成常量）**全部几何被误判为不属于当前图**（C1e）。改成内容
        指纹后两个场景自愈，且 B-03 的跨图防御更强而不是更松。

        This is the defensive half of the cross-image fix: ``load_image`` and
        ``project_new`` clear the geometry outright, and the scope makes a
        geometry that somehow survives clearing *unusable* instead of *harmful*.
        """
        return {
            "fingerprint": self._image_fingerprint(),
            "width": int(getattr(self, "width", 0) or 0),
            "height": int(getattr(self, "height", 0) or 0),
            # `image_path` 只用于**比对旧格式几何**（那些只记了路径的工程包），
            # 新记录的 scope 判定只看 fingerprint。留着它也是为了让 scope 在
            # 排查时肉眼可读。
            "image_path": getattr(self, "image_path", None),
        }

    def _geometry_in_scope(self, item: dict[str, Any]) -> bool:
        """Whether ``item`` was recorded for the image currently loaded.

        三档判定，从最严到最宽：

        1. **新格式**（记了指纹）：指纹必须相同。这是唯一能同时做到
           "包里的几何继续生效"与"换图后几何失效"的判据。
        2. **旧格式**（只记 ``image_path``/尺寸，来自 2026-10-23 之前的工程包）：
           退回旧的路径 + 尺寸比对。老工程包本来就不带指纹，放宽会让它们
           （以及其中可能被塞错的图）无条件生效；保持原判据是最安全的默认。
        3. **完全没有 scope**：视为在范围内（历史行为，见下）。

        Items without a scope — an older session, or a caller that recorded no
        token — are treated as in scope. Refusing to honour them would change
        the meaning of already-persisted projects, and a mismatching scope is
        what the cross-image defence actually has to catch.
        """
        owner = item.get("image_scope")
        if not isinstance(owner, dict) or not owner:
            return True

        current = self._geometry_scope() or {}
        recorded_fingerprint = owner.get("fingerprint")
        current_fingerprint = current.get("fingerprint")
        if recorded_fingerprint is not None and current_fingerprint is not None:
            # 双方都有内容身份 → 只认指纹。这是唯一能同时做到"包里的几何继续
            # 生效"与"换成同尺寸的另一张图就失效"的判据。
            return recorded_fingerprint == current_fingerprint

        # ---- 降级：至少有一方算不出指纹 ----
        # 两种来源：旧格式几何（没有指纹字段），或当前图不是可算指纹的图像对象
        # （`image` 为 None、已 close、或测试里的占位对象）。
        #
        # 此时**退回尺寸比对**。关键点：绝不能返回 True —— 那是"无条件在范围内"，
        # 等于把 B-03 的跨图纵深防御拆掉。尺寸判据弱于指纹（放过同尺寸的另一张
        # 图），但足以挡掉绝大多数跨图几何，且比直接失效更不容易误伤"图暂时
        # 算不出指纹但确实是同一张"的用户。
        #
        # 旧格式（无 fingerprint）也走这条分支，且判据与历史实现完全一致：
        # 路径 + 宽 + 高 三者全等。曾考虑"当前会话也不知道图从哪来时只比尺寸"，
        # 但那会放宽旧工程包——里面没有指纹可自证，放宽后任何同尺寸图都会让
        # 包里的几何无条件生效。旧包要获得正确行为，重新保存一次即可（writer
        # 会写指纹）。
        return (
            owner.get("image_path") == current.get("image_path")
            and owner.get("width") == current.get("width")
            and owner.get("height") == current.get("height")
        )

    def _init_cleanup(self) -> None:
        """Initialize cleanup state.

        ``_candidate_seq`` is deliberately not reset: ids are minted from it
        and lookups match on id across the session, so reusing a number would
        resurrect the collision that counter exists to prevent.
        """
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

    def _next_candidate_id(self, axis: str, *, prefix: str = "line") -> str:
        """Mint a stable, unique, opaque candidate id.

        Deliberately a session-lifetime counter, not something derived from the
        candidate itself. Two separate bugs came from deriving identity from a
        mutable source:

        * the detector used ``f"line_h_{at}_{w}px"`` — the first nudge moves
          ``at`` and ``set_line_thickness`` rewrites ``width``, so the id started
          claiming things that were no longer true;
        * manual creation used ``len(self.line_candidates) + 1``, which collides
          as soon as one is deleted (delete one of two, add one, and you mint an
          id that still exists).

        Lookups (status toggle, delete, selection) all match on id globally, so
        uniqueness is a correctness requirement, not cosmetics.
        """
        seq = getattr(self, "_candidate_seq", 0) + 1
        self._candidate_seq = seq
        return f"{prefix}_{axis}_{seq}"

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
        """Rasterise candidate geometry (optionally filtered by status).

        Candidates recorded for another image never rasterise, whatever
        ``roi_id`` they happen to carry — see :meth:`_geometry_scope`.
        """
        h, w = raw_ink.shape
        mask = np.zeros((h, w), dtype=bool)
        for cand in self.line_candidates:
            if cand.get("roi_id") != roi_id:
                continue
            if not self._geometry_in_scope(cand):
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
            if not self._geometry_in_scope(ex):
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
            self._extract_foreground_from_settings()

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
            # Namespace the detector's positional id session-wide: detection runs
            # per ROI, so "line_h_1" would otherwise repeat across ROIs and a
            # delete-by-id would hit every ROI's first line.
            cand["id"] = self._next_candidate_id(cand.get("axis", "h"))
            # Bind the geometry to the image it was measured on. Geometry lives
            # in image pixels, so this is what makes a leak across images inert
            # even if the clearing in load_image / project_new is ever missed.
            cand["image_scope"] = self._geometry_scope()
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
        candidate_id = candidate_id or self._next_candidate_id(axis, prefix="manual")
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
            # Hand-drawn geometry is drawn on the current image, so it carries
            # that image's scope like detected geometry does.
            "image_scope": self._geometry_scope(),
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

    def set_line_thickness(
        self,
        thickness: int,
        candidate_id: str | None = None,
        roi_id: str | None = None,
    ) -> dict[str, Any]:
        """Force one or all geometries in a ROI to an exact thickness in pixels.

        ``candidate_id`` given -> only that geometry; omitted -> every geometry of
        the ROI (the sidebar's "统一厚度"). The centre line (``at``) never moves:
        the band only widens/shrinks around it, so a line already sitting on the
        right row stays there. ``thickness`` is the inclusive pixel count, i.e.
        the same number the sidebar shows as ``width``.
        """
        thickness = int(thickness)
        if thickness < 1:
            raise ValueError("thickness must be >= 1")
        if thickness > 500:
            raise ValueError("thickness must be <= 500")

        roi_id, _ = self._roi_for(roi_id)
        if candidate_id is None:
            targets = [c for c in self.line_candidates if str(c.get("roi_id")) == str(roi_id)]
        else:
            targets = [c for c in self.line_candidates if str(c.get("id")) == str(candidate_id)]
            if not targets:
                raise ValueError(f"unknown geometry id: {candidate_id}")

        half = (thickness - 1) // 2
        for target in targets:
            x0, y0, x1, y1 = _rect_of(target)
            if target.get("axis") == "h":
                centre = (y0 + y1) // 2
                y0 = centre - half
                y1 = y0 + thickness - 1
            else:
                centre = (x0 + x1) // 2
                x0 = centre - half
                x1 = x0 + thickness - 1
            target["geometry"] = {"type": "rect", "x0": x0, "y0": y0, "x1": x1, "y1": y1}
            _apply_derived_fields(target)

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
            self._extract_foreground_from_settings()

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
            self._extract_foreground_from_settings()
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
