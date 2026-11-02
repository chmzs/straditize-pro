"""Digitisation, turning points, and control points RPC methods."""

from __future__ import annotations

from typing import Any

from ..protocol import INVALID_PARAMS, STATE_ERROR, JsonRpcError


def register(dispatcher: Any, session: Any) -> None:
    """Register digitisation operations."""

    def core_extract_foreground(
        threshold: float | None = None,
        mode: str | None = None,
        extraction_mode: str | None = None,
    ) -> dict[str, Any]:
        """Segment ink from the background.

        ``mode`` 选阈值算法（``otsu`` / ``binary`` / ``adaptive``），``extraction_mode``
        决定**哪些像素算墨迹**——两层不同的事，别混。

        ``mode`` 的默认值**只由 session 层声明**（``session.extract_foreground``）。
        本层此前写死了一份副本 ``"otsu"``：两处任一处单独改动都会变成"省略该参数时
        行为取决于走哪条通路"的幽灵默认值，而默认值恰恰是没人会去测的那一侧。所以这里
        ``None`` 表示"未传"，交给 session 用自己的默认值。

        ``extraction_mode`` 省略时**不是**"沿用会话当前值"，而是按 ``standard``（Otsu）
        重算；只有隐式重算路径（``_extract_foreground_from_settings``）才沿用会话值。
        未知取值返回 ``INVALID_PARAMS``，不静默回退——静默回退会让用户拿到错层取的读数，
        而返回体里的 ``extraction_mode`` 仍回显他传的名字。
        """
        from ..image import normalize_extraction_mode

        if extraction_mode is not None:
            try:
                normalize_extraction_mode(extraction_mode)
            except ValueError as exc:
                raise JsonRpcError(INVALID_PARAMS, str(exc)) from exc
        edges = session._column_band_edges()
        # 只在真正传了 mode 时才转发：否则会把 None 灌进 session，
        # 落进它"未知模式 → INVALID_PARAMS"的分支，默认值就失效了。
        forwarded: dict[str, Any] = {} if mode is None else {"mode": mode}
        return session.extract_foreground(
            threshold=threshold,
            extraction_mode=extraction_mode,
            column_edges=edges,
            **forwarded,
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
