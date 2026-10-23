"""Digitisation, turning points, and control points RPC methods."""

from __future__ import annotations

from typing import Any

from ..protocol import INVALID_PARAMS, STATE_ERROR, JsonRpcError


def register(dispatcher: Any, session: Any) -> None:
    """Register digitisation operations."""

    def core_extract_foreground(
        threshold: float | None = None,
        mode: str = "otsu",
        extraction_mode: str | None = None,
    ) -> dict[str, Any]:
        """Segment ink from the background, with an explicit extraction mode.

        ``extraction_mode`` decides **what counts as ink**:

        * ``standard`` (default) —— 灰度阈值；对黑白线图足够。
        * ``solid-over-shadow`` —— 双层图（实心 + 夸张包络）。只取实心层；
          包络单独存放，可由 ``core.getShadowLayer`` 单独取回。

        Omitting it keeps the session's current mode, so a client that never
        sets anything behaves exactly as before (Otsu). An unknown mode is
        rejected with ``INVALID_PARAMS`` rather than silently falling back —
        a silent fallback would hand the user a reading taken from the wrong
        layer, which is the one failure this mode exists to prevent.
        """
        from ..image import normalize_extraction_mode

        if extraction_mode is not None:
            try:
                normalize_extraction_mode(extraction_mode)
            except ValueError as exc:
                raise JsonRpcError(INVALID_PARAMS, str(exc)) from exc
        edges = session._column_band_edges()
        return session.extract_foreground(
            threshold=threshold,
            mode=mode,
            extraction_mode=extraction_mode,
            column_edges=edges,
        )

    def core_get_shadow_layer() -> dict[str, Any]:
        """Return the exaggeration envelope for display — never as data."""
        if getattr(session, "image", None) is None:
            raise JsonRpcError(STATE_ERROR, "No image loaded.")
        shadow = getattr(session, "shadow_mask", None)
        ink = getattr(session, "foreground_mask", None)
        if shadow is None:
            return {
                "available": False,
                "extraction_mode": session.extraction_mode,
                "overlay_png": None,
                "shadow_pixels": 0,
                "solid_pixels": int(ink.sum()) if ink is not None else 0,
                "layers": getattr(session, "solid_layers", None),
            }

        from ..image import mask_overlay_data_url

        return {
            "available": True,
            "extraction_mode": session.extraction_mode,
            "overlay_png": mask_overlay_data_url(ink, shadow) if ink is not None else None,
            "shadow_pixels": int(shadow.sum()),
            "solid_pixels": int(ink.sum()) if ink is not None else 0,
            "layers": getattr(session, "solid_layers", None),
        }

    dispatcher.register_method("core.extractForeground", core_extract_foreground)
    dispatcher.register_method("core.getShadowLayer", core_get_shadow_layer)
    dispatcher.register_method("core.digitize", session.digitize)
    dispatcher.register_method("core.updateControlPoint", session.update_control_point)
    dispatcher.register_method("point.add", session.point_add)
    dispatcher.register_method("point.move", session.point_move)
    dispatcher.register_method("point.remove", session.point_remove)
    dispatcher.register_method("algorithm.extractTurningPoints", session.algorithm_extract_turning_points)
    dispatcher.register_method("algorithm.extractHorizonConsensus", session.extract_horizon_consensus)
