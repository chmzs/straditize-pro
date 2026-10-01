"""System, inspection, and frontend state projection RPC methods."""

from __future__ import annotations

import time
from typing import Any

from ..protocol import JsonRpcError
from ..session_parts.xscale import resolve_column_scale


def register(dispatcher: Any, session: Any) -> None:
    """Register system and diagram state methods."""

    def rpc_shutdown() -> dict[str, Any]:
        if not getattr(session, "is_desktop_mode", False):
            raise JsonRpcError(403, "Shutdown is only permitted in desktop mode.")

        from ..rpc_server import graceful_shutdown

        app_server = getattr(session, "server", None)
        graceful_shutdown(server=app_server, exit_code=0, delayed_seconds=0.5)
        return {"success": True, "message": "Server shutting down..."}

    dispatcher.register_method("shutdown", rpc_shutdown)
    dispatcher.register_method(
        "system.ping", lambda: {"pong": True, "timestamp": time.time()}
    )

    def cleanup_payload() -> dict[str, Any]:
        """Cleanup keys that MUST travel with every diagram payload.

        Both branches (zero-state and loaded) return these, and they used to be
        written out twice — which is exactly how the zero-state branch ended up
        missing five of them: the frontend then read `undefined` where it meant
        "empty", so the Step-4 panel was structurally different before any image
        was loaded. One helper, one shape, no drift.
        """
        return {
            "line_candidates": [
                dict(c) for c in getattr(session, "line_candidates", []) or []
            ],
            "selected_candidate_ids": sorted(
                getattr(session, "selected_candidate_ids", set()) or set()
            ),
            "exclusion_regions": [
                dict(e) for e in getattr(session, "exclusion_regions", []) or []
            ],
            "line_strokes": [
                dict(s) for s in getattr(session, "line_strokes", []) or []
            ],
            "cleanup": {
                "roi_id": getattr(session, "active_roi_id", None),
                "stats": getattr(session, "cleanup_stats", {}) or {},
                "legend": {
                    "candidate": "#f59e0b",
                    "removed": "#ef4444",
                    "exclusion": "#9ca3af",
                    "kept": "#ffffff",
                },
            },
        }

    def get_diagram_data() -> dict[str, Any]:
        """Provides diagram state representation for web frontend.

        Adheres strictly to Blacklist Rule #39: no silent fallback to sample figures
        when session.image is None. Zero-state is returned as-is.
        """
        if session.image is None:
            return {
                "imageSrc": None,
                "imageWidth": 0,
                "imageHeight": 0,
                "columns": [],
                "activeTaxaId": "",
                "selectedEntity": None,
                "isDesktopMode": getattr(session, "is_desktop_mode", False),
                "roi": None,
                "rois": [],
                "primaryRoiId": None,
                "activeRoiId": None,
                "calibration": {
                    "isCalibrated": False,
                    "top_px": None,
                    "top_cm": None,
                    "bottom_px": None,
                    "bottom_cm": None,
                    "unit": getattr(session, "depth_unit", "cm"),
                    "depthInterval": 2,
                    "depthGridEnabled": True,
                },
                "lineRemoval": {
                    "strength": None,
                    "remove_vertical": True,
                    "corrections": [],
                },
                **cleanup_payload(),
            }

        palette = [
            "#38bdf8", "#34d399", "#fbbf24", "#a78bfa", "#f472b6", "#fb7185",
            "#2dd4bf", "#818cf8", "#f97316", "#4ade80", "#e879f9", "#60a5fa",
        ]
        formatted_cols = []
        for c in session.columns:
            c_idx = c["col_index"]
            c_start = int(c["start"])
            c_end = int(c["end"])
            name = c.get("name", f"Col {c_idx}")

            if c_idx not in session.column_points:
                session.digitize(c_idx, "area")

            ctrls = session.control_points.get(c_idx, {})
            pts = []
            for r_val, x_val in ctrls.items():
                pts.append({
                    "id": f"pt_{c_idx}_{r_val}",
                    "x": round(x_val),
                    "y": int(r_val),
                    "type": "peak",
                    "isManual": False,
                    "createdAt": 1700000000000 + int(r_val),
                })
            pts.sort(key=lambda p: p["y"])

            scale = resolve_column_scale(session, c, c_idx)
            species_val = c.get("species", name)

            formatted_cols.append({
                "id": c.get("id") or f"taxa_{c_idx}",
                # 后端自己的权威列序号；前端拿它寻址。不要用数组下标代替：
                # column_add 造的列没有 id，payload 会合成 taxa_N，按 id 反而找不到。
                "col_index": c_idx,
                "name": name,
                "species": species_val,
                "color": palette[c_idx % len(palette)],
                "startX": c_start,
                "endX": c_end,
                "scale_type": scale.scale_type,
                "plot_type": scale.plot_type,
                "plotType": scale.plot_type,
                "exaggeration_mult": scale.exaggeration_mult,
                "hasExaggeration": scale.exaggeration_mult is not None,
                "exaggerationMult": scale.exaggeration_mult,
                # 标度的唯一事实源：两个真实刻度端点。null = 未标定。
                # 删掉它整条链路就断（载荷剥字段 → 前端 hasTicks 恒 false → 标尺画不出来）。
                "x_ticks": c.get("x_ticks"),
                "startValue": scale.val0,
                "tickValue": scale.val1,
                "scaleCalib": {
                    "originX": scale.abs_px0,
                    "originVal": scale.val0,
                    "calibX": scale.abs_px1,
                    "calibVal": scale.val1,
                    "unit": scale.unit,
                },
                "tickEndX": scale.abs_px1,
                "maxPercent": max(scale.val0, scale.val1),
                "unit": scale.unit,
                "curveType": "linear",
                "visible": True,
                "isLocked": False,
                "controlPoints": pts,
                "roi_id": c.get("roi_id"),
            })

        depth_calib = session.depth_calib or {}
        roi_box = session._roi_box()
        rois = getattr(session, "rois", [])
        return {
            "imageSrc": "/image/current",
            "imageWidth": session.width or 0,
            "imageHeight": session.height or 0,
            "columns": formatted_cols,
            "activeTaxaId": formatted_cols[0]["id"] if formatted_cols else "",
            "selectedEntity": None,
            "isDesktopMode": getattr(session, "is_desktop_mode", False),
            "roi": (
                {"xMin": roi_box[0], "yMin": roi_box[1], "xMax": roi_box[2], "yMax": roi_box[3]}
                if roi_box
                else None
            ),
            "rois": rois,
            "primaryRoiId": getattr(session, "primary_roi_id", None),
            "activeRoiId": getattr(session, "active_roi_id", None),
            "calibration": {
                "isCalibrated": bool(session.is_calibrated and session.depth_calib),
                "top_px": depth_calib.get("top_px"),
                "top_cm": depth_calib.get("top_cm"),
                "bottom_px": depth_calib.get("bottom_px"),
                "bottom_cm": depth_calib.get("bottom_cm"),
                "unit": session.depth_unit,
                "depthInterval": 2,
                "depthGridEnabled": True,
            },
            "lineRemoval": {
                "strength": session.degrid_strength,
                "remove_vertical": session.degrid_remove_vertical,
                "corrections": session.line_corrections,
            },
            # Cleanup geometry is authoritative backend state. It MUST travel
            # with the diagram payload: the frontend used to hold it only in
            # memory, so every refresh silently reset it to [] and the
            # geometry vanished from the canvas.
            **cleanup_payload(),
        }

    dispatcher.register_method("straditize.getDiagramData", get_diagram_data)

    def get_status() -> dict[str, Any]:
        return {
            "has_image": session.image is not None,
            "width": session.width,
            "height": session.height,
            "columns_count": len(session.columns),
            "digitized_columns": list(session.column_points.keys()),
            "is_calibrated": session.is_calibrated,
            "taxa": session.taxa_names,
            "has_depth_grid": len(session.depth_grid) > 0,
            "depth_grid_count": len(session.depth_grid),
        }

    dispatcher.register_method("core.getStatus", get_status)

    def reset_session() -> dict[str, bool]:
        session.reset() if hasattr(session, "reset") else session.__init__()
        return {"reset": True}

    dispatcher.register_method("core.reset", reset_session)

    def rpc_get_config() -> dict[str, Any]:
        from ..config import load_config

        cfg = load_config()
        server = getattr(session, "server", None)
        port = (
            getattr(server, "actual_port", getattr(server, "port", 8765))
            if server
            else 8765
        )
        host = getattr(server, "host", "127.0.0.1") if server else "127.0.0.1"
        return {
            "remote_access_enabled": cfg.get("remote_access_enabled", False),
            "has_remote_password": bool(cfg.get("remote_password", "")),
            "allowed_hosts": cfg.get("allowed_hosts", ["127.0.0.1", "localhost"]),
            "locale": cfg.get("locale", "zh-CN"),
            "theme": cfg.get("theme", "light"),
            "llm_base_url": cfg.get("llm_base_url", "https://api.openai.com/v1"),
            "llm_api_key": cfg.get("llm_api_key", ""),
            "llm_model": cfg.get("llm_model", "gpt-4o"),
            "llm_prompt_template": cfg.get("llm_prompt_template", ""),
            "rpc_endpoint": f"http://127.0.0.1:{port}/rpc",
            "webmcp_endpoint": "/mcp",
            "server_bound_host": host,
            "server_bound_port": port,
            "is_desktop_mode": getattr(session, "is_desktop_mode", False),
            "connected": True,
        }

    dispatcher.register_method("system.getConfig", rpc_get_config)

    def rpc_update_config(
        remote_access_enabled: bool | None = None,
        remote_password: str | None = None,
        allowed_hosts: list[str] | str | None = None,
        locale: str | None = None,
        theme: str | None = None,
        llm_base_url: str | None = None,
        llm_api_key: str | None = None,
        llm_model: str | None = None,
        llm_prompt_template: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        import re
        from ..config import save_config

        updates: dict[str, Any] = {}
        if remote_access_enabled is not None:
            updates["remote_access_enabled"] = bool(remote_access_enabled)
        if remote_password is not None:
            updates["remote_password"] = str(remote_password).strip()
        if allowed_hosts is not None:
            if isinstance(allowed_hosts, str):
                parsed = [
                    h.strip() for h in re.split(r"[,;\n\r]+", allowed_hosts) if h.strip()
                ]
                updates["allowed_hosts"] = parsed
            elif isinstance(allowed_hosts, list):
                updates["allowed_hosts"] = [
                    str(h).strip() for h in allowed_hosts if str(h).strip()
                ]
        if locale is not None:
            updates["locale"] = str(locale)
        if theme is not None:
            updates["theme"] = str(theme)
        if llm_base_url is not None:
            updates["llm_base_url"] = str(llm_base_url).strip()
        if llm_api_key is not None:
            updates["llm_api_key"] = str(llm_api_key).strip()
        if llm_model is not None:
            updates["llm_model"] = str(llm_model).strip()
        if llm_prompt_template is not None:
            updates["llm_prompt_template"] = str(llm_prompt_template)

        saved = save_config(updates)
        server = getattr(session, "server", None)
        if server is not None and hasattr(server, "sync_config"):
            server.sync_config(saved)
        res_cfg = dict(saved)
        pwd = res_cfg.pop("remote_password", "")
        res_cfg["has_remote_password"] = bool(pwd)
        return {
            "success": True,
            "config": res_cfg,
            "message": "配置已成功保存并应用",
        }

    dispatcher.register_method("system.updateConfig", rpc_update_config)
