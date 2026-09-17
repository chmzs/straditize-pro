"""JSON-RPC 2.0 Local Communication Server for Straditize.

Supports both Standard I/O (stdio) pipe transport and Localhost HTTP/SSE transport.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import mimetypes
import os
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

from .protocol import JsonRpcDispatcher, JsonRpcError
from .session import StraditizeSession
from .age_depth import generate_bacon_script


def find_frontend_dist(custom_path: str | None = None) -> str | None:
    """Locate the frontend/dist directory if it exists."""
    if custom_path is not None:
        if custom_path and os.path.isdir(custom_path):
            return os.path.abspath(custom_path)
        return None

    candidates = [
        os.environ.get("STRADITIZE_FRONTEND_DIST", ""),
        os.path.abspath(os.path.join(getattr(sys, "_MEIPASS", ""), "frontend", "dist")),
        os.path.abspath(os.path.join(getattr(sys, "_MEIPASS", ""), "dist")),
        os.path.abspath(os.path.join(os.getcwd(), "frontend", "dist")),
        os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "dist")
        ),
        os.path.abspath(
            os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
        ),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "dist")),
    ]
    for cand in candidates:
        if cand and os.path.isdir(cand):
            return os.path.abspath(cand)
    return None


# Configure logging to sys.stderr so stdout stays clean for stdio JSON-RPC protocol
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [straditize_rpc] %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("straditize_rpc")


def create_rpc_dispatcher(
    session: StraditizeSession | None = None,
) -> JsonRpcDispatcher:
    """Creates a JsonRpcDispatcher with registered Straditize core methods."""
    session = session or StraditizeSession()
    dispatcher = JsonRpcDispatcher()

    # Register standard core operations
    dispatcher.register_method("core.loadImage", session.load_image)
    dispatcher.register_method("core.extractForeground", session.extract_foreground)
    dispatcher.register_method("core.detectColumns", session.detect_columns)
    dispatcher.register_method("core.digitize", session.digitize)
    dispatcher.register_method("core.updateControlPoint", session.update_control_point)
    dispatcher.register_method("core.calibrateAxes", session.calibrate_axes)
    dispatcher.register_method("core.exportData", session.export_data)

    # Advanced analysis and grid extraction methods
    dispatcher.register_method("core.batchSetTaxa", session.batch_set_taxa)
    dispatcher.register_method("core.applyDepthGrid", session.apply_depth_grid)
    dispatcher.register_method("core.extractGridValues", session.extract_grid_values)

    # Section 五: JSON-RPC 2.0 规范方法表 (project, image, roi, column, point, algorithm, history, export, shutdown)
    dispatcher.register_method("project.new", session.project_new)
    dispatcher.register_method("project.load", session.project_load)
    dispatcher.register_method("agedepth.loadModelDiagram", session.load_age_depth_diagram)
    dispatcher.register_method("agedepth.extractAndInspect", session.calibrate_and_extract_age_depth)
    dispatcher.register_method("agedepth.getInspection", session.get_age_depth_inspection)
    dispatcher.register_method("agedepth.generateBaconScript", lambda dates, core_name="MyCore", thickness=5, cc=1: generate_bacon_script(core_name=core_name, dates=dates, thickness=thickness, cc=cc))
    dispatcher.register_method("project.save", session.project_save)

    dispatcher.register_method("image.load", session.load_image)
    dispatcher.register_method("image.detectDeskew", session.detect_deskew_angle)
    dispatcher.register_method("image.rotate", session.rotate_image)

    dispatcher.register_method("roi.update", session.roi_update)

    dispatcher.register_method("column.add", session.column_add)
    dispatcher.register_method("column.remove", session.column_remove)
    dispatcher.register_method("column.update", session.column_update)

    dispatcher.register_method("point.add", session.point_add)
    dispatcher.register_method("point.move", session.point_move)
    dispatcher.register_method("point.remove", session.point_remove)

    dispatcher.register_method("algorithm.detectColumns", session.algorithm_detect_columns)
    dispatcher.register_method("algorithm.extractTurningPoints", session.algorithm_extract_turning_points)
    dispatcher.register_method("algorithm.degrid", session.algorithm_degrid)

    dispatcher.register_method("history.undo", session.history_undo)
    dispatcher.register_method("history.redo", session.history_redo)

    dispatcher.register_method("export.csv", session.export_csv)
    dispatcher.register_method("export.tar", session.export_tar)
    dispatcher.register_method("export.r", session.export_r)

    def rpc_shutdown() -> dict[str, Any]:
        if not getattr(session, "is_desktop_mode", False):
            raise JsonRpcError(403, "Shutdown is only permitted in desktop mode.")

        def _delayed():
            time.sleep(0.5)
            os._exit(0)

        threading.Thread(target=_delayed, daemon=True).start()
        return {"success": True, "message": "Server shutting down..."}

    dispatcher.register_method("shutdown", rpc_shutdown)

    # Auxiliary system methods
    dispatcher.register_method(
        "system.ping", lambda: {"pong": True, "timestamp": time.time()}
    )

    def get_diagram_data() -> dict[str, Any]:
        """Provides diagram state representation for web frontend."""
        # Auto-initialize Hoya sample if nothing loaded or no columns detected yet
        if session.image is None or not session.columns:
            if session.image is None:
                sample_path = os.path.abspath("straditize/straditize/widgets/tutorial/hoya-del-castillo/hoya-del-castillo.png")
                if os.path.exists(sample_path):
                    session.load_image(sample_path)
            if session.image is not None and not session.columns:
                session.detect_columns([315, 1946], [511, 1311])
                hoya_names = [
                    'Charcoal', 'Pinus', 'Juniperus', 'Quercus ilex-type',
                    'Quercus suber-type', 'Olea', 'Betula', 'Corylus', 'Carpinus-type',
                    'Ericaceae', 'Ephedra distachya-type', 'Ephedra fragilis',
                    'Mentha-type', 'Anthemis-type', 'Artemisia', 'Caryophyllaceae',
                    'Chenopodiaceae', 'Cruciferae', 'Filipendula', 'Gramineae <40um',
                    'Gramineae >40<50um', 'Gramineae >50<60um', 'Gramineae >60um',
                    'Liguliflorae', 'Plantago coronopus', 'Pteridium', 'Filicales',
                    'Pollen Concentration'
                ]
                session.batch_set_taxa(hoya_names)
                session.apply_depth_grid(start_depth=0, end_depth=150, step=2)

        palette = [
            '#38bdf8', '#34d399', '#fbbf24', '#a78bfa', '#f472b6', '#fb7185',
            '#2dd4bf', '#818cf8', '#f97316', '#4ade80', '#e879f9', '#60a5fa'
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

            scale_type = c.get("scale_type", "linear")
            start_val = c.get("startValue", 0)
            calib_val = c.get("tickValue", (100 if c_idx < 3 else (50 if c_idx < 8 else 20)))
            calib_x = c.get("tickEndX", (c_end if (c_end - c_start) > 0 else (c_start + 60)))
            species_val = c.get("species", name)

            formatted_cols.append({
                "id": f"taxa_{c_idx}",
                "name": name,
                "species": species_val,
                "color": palette[c_idx % len(palette)],
                "startX": c_start,
                "endX": c_end,
                "scale_type": scale_type,
                "startValue": start_val,
                "tickValue": calib_val,
                "scaleCalib": {
                    "originX": c_start,
                    "originVal": start_val,
                    "calibX": calib_x,
                    "calibVal": calib_val,
                    "unit": "%",
                },
                "tickEndX": calib_x,
                "maxPercent": calib_val,
                "unit": "%",
                "curveType": "linear",
                "visible": True,
                "isLocked": False,
                "controlPoints": pts,
            })

        return {
            "imageSrc": "/image/current",
            "imageWidth": session.width or 2339,
            "imageHeight": session.height or 1654,
            "columns": formatted_cols,
            "activeTaxaId": formatted_cols[0]["id"] if formatted_cols else "taxa_0",
            "selectedEntity": None,
            "isDesktopMode": getattr(session, "is_desktop_mode", False),
            "calibration": {
                "dataXMin": session.data_xlim[0] if session.data_xlim else 315,
                "dataXMax": session.data_xlim[1] if session.data_xlim else 1946,
                "dataYMin": session.data_ylim[0] if session.data_ylim else 511,
                "dataYMax": session.data_ylim[1] if session.data_ylim else 1311,
                "depthTopValue": 0,
                "depthBottomValue": 150,
                "unit": "cm",
                "depthInterval": 2,
                "depthGridEnabled": True,
                "isCalibrated": True,
            },
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
        nonlocal session
        session = StraditizeSession()
        return {"reset": True}

    dispatcher.register_method("core.reset", reset_session)

    return dispatcher


# ============================================================================
# Stdio Server Implementation
# ============================================================================


def run_stdio_server(
    dispatcher: JsonRpcDispatcher | None = None,
    in_stream=sys.stdin,
    out_stream=sys.stdout,
) -> None:
    """Runs a line-delimited JSON-RPC server on standard input/output streams."""
    if dispatcher is None:
        dispatcher = create_rpc_dispatcher()

    logger.info("Straditize JSON-RPC 2.0 stdio server listening...")

    while True:
        try:
            line = in_stream.readline()
            if not line:
                # EOF reached
                logger.info("Stdio stream reached EOF, shutting down.")
                break

            response = dispatcher.handle_text(line)
            if response is not None:
                out_stream.write(response + "\n")
                out_stream.flush()
        except KeyboardInterrupt:
            logger.info("Stdio server interrupted by user.")
            break
        except Exception as e:  # noqa: BLE001
            logger.error("Unexpected error in stdio server loop: %s", e)


# ============================================================================
# Localhost HTTP & SSE Server Implementation
# ============================================================================


class EventBroadcaster:
    """Thread-safe event broadcaster for Server-Sent Events (SSE)."""

    def __init__(self):
        self._listeners: list[Any] = []
        self._lock = threading.Lock()

    def add_listener(self, queue_obj) -> None:
        with self._lock:
            self._listeners.append(queue_obj)

    def remove_listener(self, queue_obj) -> None:
        with self._lock:
            if queue_obj in self._listeners:
                self._listeners.remove(queue_obj)

    def broadcast(self, event_type: str, data: Any) -> None:
        msg = f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        with self._lock:
            for q in list(self._listeners):
                try:
                    q.put_nowait(msg)
                except Exception as ex:  # noqa: BLE001
                    logger.debug("Broadcast queue put error: %s", ex)


class StraditizeRpcHttpRequestHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler providing JSON-RPC 2.0 endpoint, static web files, and SSE."""

    dispatcher: JsonRpcDispatcher
    broadcaster: EventBroadcaster
    session: StraditizeSession
    dist_dir: str | None = None
    is_desktop_mode: bool = False

    def log_message(self, format, *args):
        # Redirect request logs to module logger (sys.stderr)
        logger.debug(
            "%s - - [%s] %s",
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        )

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-Requested-With",
        )

    def do_OPTIONS(self) -> None:
        """Handle CORS pre-flight requests."""
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        """Handle health check, status, current image, SSE stream, and static web files."""
        parsed = urlparse(self.path)
        raw_path = unquote(parsed.path)

        # 1. Health and status endpoints
        if raw_path in ("/health", "/status"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            has_img = False
            img_w, img_h = 0, 0
            cols_cnt = 0
            is_calib = False
            taxa_list = []
            if hasattr(self, "session") and self.session:
                has_img = self.session.image is not None
                img_w = self.session.width
                img_h = self.session.height
                cols_cnt = len(self.session.columns)
                is_calib = self.session.is_calibrated
                taxa_list = getattr(self.session, "taxa_names", [])

            body = json.dumps(
                {
                    "status": "ok",
                    "service": "straditize_rpc",
                    "version": "2.0",
                    "is_desktop_mode": getattr(self, "is_desktop_mode", False),
                    "has_image": has_img,
                    "width": img_w,
                    "height": img_h,
                    "columns_count": cols_cnt,
                    "is_calibrated": is_calib,
                    "taxa": taxa_list,
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.wfile.write(body)
            return

        # 2. Server-Sent Events endpoint
        if raw_path in ("/events", "/sse"):
            import queue

            q: queue.Queue = queue.Queue(maxsize=100)
            self.broadcaster.add_listener(q)

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self._send_cors_headers()
            self.end_headers()

            # Send initial connected notification
            try:
                self.wfile.write(b": connected\n\n")
                self.wfile.flush()
            except (ConnectionResetError, BrokenPipeError):
                self.broadcaster.remove_listener(q)
                return

            try:
                while True:
                    try:
                        msg = q.get(timeout=2.0)
                        self.wfile.write(msg.encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        # Send keep-alive comment
                        self.wfile.write(b": keep-alive\n\n")
                        self.wfile.flush()
            except (ConnectionResetError, BrokenPipeError):
                pass
            finally:
                self.broadcaster.remove_listener(q)
            return

        # 3. Current loaded image preview endpoint
        if raw_path in ("/image/slice", "/api/image/slice"):
            if (
                hasattr(self, "session")
                and self.session
                and self.session.image is not None
            ):
                qs = parse_qs(parsed.query)
                x = int(qs.get("x", [0])[0])
                y = int(qs.get("y", [0])[0])
                w = int(qs.get("w", [512])[0])
                h = int(qs.get("h", [512])[0])
                max_dim = int(qs.get("max_dim", [0])[0]) or None

                slice_img = self.session.get_image_slice(x, y, w, h, max_dim=max_dim)
                bio = io.BytesIO()
                slice_img.save(bio, format="PNG")
                img_data = bio.getvalue()

                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(img_data)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(img_data)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                err_resp = json.dumps(
                    {
                        "error": "No image loaded in current session.",
                        "code": -32001,
                        "status": "not_found",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(err_resp)
            return

        # Age-depth diagram image endpoint
        if raw_path in ("/image/agedepth", "/api/image/agedepth"):
            session = getattr(self, "session", None)
            if session:
                qs = parse_qs(parsed.query)
                sample_key = qs.get("sample", [None])[0]
                if sample_key in ("bacon", "bchron"):
                    try:
                        session.load_age_depth_diagram(sample_key=sample_key)
                    except Exception:
                        pass
                elif session.age_depth_image is None:
                    try:
                        session.load_age_depth_diagram(sample_key="bacon")
                    except Exception:
                        pass

            if session and session.age_depth_image is not None:
                bio = io.BytesIO()
                session.age_depth_image.save(bio, format="PNG")
                img_bytes = bio.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(img_bytes)))
                self.send_header("Cache-Control", "public, max-age=3600")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(img_bytes)
            else:
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"No age-depth diagram image loaded")
            return

        if raw_path in ("/image/current", "/api/image", "/image/preview"):
            if (
                hasattr(self, "session")
                and self.session
                and self.session.image is not None
            ):
                qs = parse_qs(parsed.query)
                is_preview_req = raw_path == "/image/preview" or "preview" in qs
                req_full = "full" in qs or "raw" in qs
                is_huge = (self.session.width * self.session.height) > 16_000_000

                if (is_preview_req or is_huge) and not req_full:
                    img_to_send = self.session.get_image_preview(max_dim=2048)
                else:
                    img_to_send = self.session.image

                bio = io.BytesIO()
                img_to_send.save(bio, format="PNG")
                img_data = bio.getvalue()

                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(img_data)))
                self.send_header("Cache-Control", "no-cache, must-revalidate")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(img_data)
            else:
                self.send_response(404)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                err_resp = json.dumps(
                    {
                        "error": "No image loaded in current session.",
                        "code": -32001,
                        "status": "not_found",
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(err_resp)
            return

        # 4. Frontend static files or diagnostic guidance
        dist_dir = find_frontend_dist(getattr(self, "dist_dir", None))
        if dist_dir:
            # Normalize requested relative path
            clean_path = raw_path.lstrip("/")
            if not clean_path or clean_path == "index.html":
                clean_path = "index.html"

            target_file = os.path.abspath(os.path.join(dist_dir, clean_path))
            # Security check: disallow escaping frontend/dist
            if not target_file.startswith(dist_dir):
                self.send_response(403)
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(b"Forbidden")
                return

            if os.path.isdir(target_file):
                target_file = os.path.join(target_file, "index.html")

            if os.path.isfile(target_file):
                content_type, _ = mimetypes.guess_type(target_file)
                if not content_type:
                    if target_file.endswith((".js", ".mjs")):
                        content_type = "application/javascript"
                    elif target_file.endswith(".css"):
                        content_type = "text/css"
                    elif target_file.endswith(".html"):
                        content_type = "text/html; charset=utf-8"
                    elif target_file.endswith(".json"):
                        content_type = "application/json"
                    elif target_file.endswith(".png"):
                        content_type = "image/png"
                    elif target_file.endswith((".jpg", ".jpeg")):
                        content_type = "image/jpeg"
                    elif target_file.endswith(".svg"):
                        content_type = "image/svg+xml"
                    else:
                        content_type = "application/octet-stream"

                with open(target_file, "rb") as f:
                    content = f.read()

                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(content)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(content)
                return

            # Single Page Application (SPA) fallback: if no file extension, serve index.html
            index_path = os.path.join(dist_dir, "index.html")
            if not os.path.splitext(target_file)[1] and os.path.isfile(index_path):
                with open(index_path, "rb") as f:
                    content = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(content)
                return

            # Static asset not found
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        # 5. Friendly diagnostic page when frontend/dist is not built yet
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._send_cors_headers()
        self.end_headers()
        diag_data = {
            "status": "frontend_not_built",
            "message": "Straditize Web Frontend is ready for connection, but production assets (frontend/dist) were not found.",
            "hint": "Please build the production frontend or start the Vite development server.",
            "quick_start": {
                "dev_server": "cd frontend && pnpm dev (accessible at http://localhost:5173)",
                "build_static": "cd frontend && pnpm build (compiles to frontend/dist/)",
            },
            "available_endpoints": {
                "gui": "/",
                "health": "/health",
                "status": "/status",
                "events": "/events",
                "image": "/image/current",
                "upload": "/api/upload",
                "rpc": "/rpc",
            },
            "timestamp": time.time(),
        }
        self.wfile.write(
            json.dumps(diag_data, indent=2, ensure_ascii=False).encode("utf-8")
        )

    def do_POST(self) -> None:
        """Handle JSON-RPC 2.0 requests, file uploads, and graceful shutdown."""
        parsed = urlparse(self.path)
        path = parsed.path

        # 0. Graceful shutdown endpoint (only permitted in desktop mode)
        if path == "/shutdown":
            if not getattr(self, "is_desktop_mode", False):
                self.send_response(403)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {"error": "Shutdown is only permitted in desktop mode.", "code": 403},
                        ensure_ascii=False,
                    ).encode("utf-8")
                )
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {"success": True, "message": "Server shutting down..."},
                    ensure_ascii=False,
                ).encode("utf-8")
            )
            self.wfile.flush()

            def _delayed_exit():
                time.sleep(0.5)
                lock_file = os.path.join(tempfile.gettempdir(), "straditize_desktop.lock")
                try:
                    if os.path.exists(lock_file):
                        os.remove(lock_file)
                except OSError:
                    pass
                shutdown_fn = getattr(self.__class__, "_shutdown_fn", os._exit)
                try:
                    shutdown_fn(0)
                except TypeError:
                    shutdown_fn()

            threading.Thread(target=_delayed_exit, daemon=True).start()
            return

        # 1. Image upload endpoint
        if path == "/api/upload":
            content_length = int(self.headers.get("Content-Length", 0))
            content_type = self.headers.get("Content-Type", "")
            post_bytes = self.rfile.read(content_length)

            try:
                target_path: str | None = None
                if "application/json" in content_type:
                    payload = json.loads(post_bytes.decode("utf-8"))
                    if "path" in payload:
                        target_path = payload["path"]
                    elif "image_path" in payload:
                        target_path = payload["image_path"]
                    elif "image_base64" in payload:
                        b64_str = payload["image_base64"]
                        if "," in b64_str:
                            b64_str = b64_str.split(",", 1)[1]
                        raw_bytes = base64.b64decode(b64_str)
                        suffix = payload.get("suffix", ".png")
                        with tempfile.NamedTemporaryFile(
                            suffix=suffix, delete=False
                        ) as tf:
                            tf.write(raw_bytes)
                            target_path = tf.name
                    else:
                        raise ValueError(
                            "Missing 'path' or 'image_base64' in upload request."
                        )
                elif "multipart/form-data" in content_type:
                    boundary = None
                    for part in content_type.split(";"):
                        part = part.strip()
                        if part.startswith("boundary="):
                            boundary = (
                                part.split("=", 1)[1].strip('"').encode("latin-1")
                            )
                            break
                    if not boundary:
                        raise ValueError(
                            "Invalid multipart/form-data: missing boundary header."
                        )

                    delimiter = b"--" + boundary
                    parts = post_bytes.split(delimiter)
                    file_bytes = None
                    for p in parts:
                        if b"Content-Disposition" in p:
                            if b"\r\n\r\n" in p:
                                _header_part, body_part = p.split(b"\r\n\r\n", 1)
                            elif b"\n\n" in p:
                                _header_part, body_part = p.split(b"\n\n", 1)
                            else:
                                continue
                            file_bytes = body_part.rstrip(b"\r\n").rstrip(b"--")
                            break

                    if file_bytes is None:
                        raise ValueError(
                            "No file content found in multipart/form-data."
                        )

                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                        tf.write(file_bytes)
                        target_path = tf.name
                else:
                    # Treat raw binary payload as image file
                    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tf:
                        tf.write(post_bytes)
                        target_path = tf.name

                if not hasattr(self, "session") or self.session is None:
                    raise RuntimeError("Server session instance is not available.")

                res = self.session.load_image(target_path)
                self.broadcaster.broadcast("image_loaded", res)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                resp_bytes = json.dumps(
                    {
                        "success": True,
                        "message": "Image loaded successfully into session.",
                        "result": res,
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(resp_bytes)
                return
            except Exception as ex:  # noqa: BLE001
                logger.error("Error during image upload: %s", ex)
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._send_cors_headers()
                self.end_headers()
                err_bytes = json.dumps(
                    {
                        "success": False,
                        "error": str(ex),
                    },
                    ensure_ascii=False,
                ).encode("utf-8")
                self.wfile.write(err_bytes)
                return

        # 2. JSON-RPC 2.0 requests at /rpc or /
        if path not in ("/rpc", "/"):
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(b"Not Found")
            return

        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length).decode("utf-8")

        response = self.dispatcher.handle_text(post_data)

        # Broadcast event notification on significant operations
        try:
            req_json = json.loads(post_data)
            if isinstance(req_json, dict) and "method" in req_json:
                self.broadcaster.broadcast("rpc_call", {"method": req_json["method"]})
        except Exception as ex:  # noqa: BLE001
            logger.debug("Error parsing broadcast request: %s", ex)

        if response is None:
            # Notification or empty response
            self.send_response(204)
            self._send_cors_headers()
            self.end_headers()
        else:
            resp_bytes = response.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(resp_bytes)))
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(resp_bytes)


class StraditizeRpcHttpServer:
    """Wrapper around ThreadingHTTPServer for managing local JSON-RPC server lifecycle."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8765,
        dispatcher: JsonRpcDispatcher | None = None,
        session: StraditizeSession | None = None,
        dist_dir: str | None = None,
        is_desktop_mode: bool = False,
        shutdown_fn: Any = None,
    ):
        self.host = host
        self.port = port
        self.is_desktop_mode = is_desktop_mode
        self._shutdown_fn = shutdown_fn or os._exit
        self.session = session or StraditizeSession()
        self.session.is_desktop_mode = is_desktop_mode
        self.dispatcher = dispatcher or create_rpc_dispatcher(self.session)
        self.broadcaster = EventBroadcaster()
        self.dist_dir = dist_dir

        # Build custom handler class with injected dependencies
        class BoundHandler(StraditizeRpcHttpRequestHandler):
            dispatcher = self.dispatcher
            broadcaster = self.broadcaster
            session = self.session
            dist_dir = self.dist_dir
            is_desktop_mode = self.is_desktop_mode
            _shutdown_fn = self._shutdown_fn

        self._server = ThreadingHTTPServer((self.host, self.port), BoundHandler)
        self.actual_port = self._server.server_address[1]
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Starts the HTTP server in a background thread."""
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()
        logger.info(
            "Straditize JSON-RPC HTTP server started at http://%s:%d/rpc",
            self.host,
            self.actual_port,
        )

    def stop(self) -> None:
        """Stops the HTTP server and joins thread."""
        if self._server:
            self._server.shutdown()
            self._server.server_close()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        logger.info("Straditize JSON-RPC HTTP server stopped.")


# ============================================================================
# Mode Helpers & CLI Entry Point
# ============================================================================


def is_port_in_use(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a network port is currently open/bound."""
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def find_available_port(
    start_port: int = 8765, max_attempts: int = 50, host: str = "127.0.0.1"
) -> int:
    """Find the next available port on host starting from start_port."""
    for p in range(start_port, start_port + max_attempts):
        if not is_port_in_use(p, host):
            return p
    raise RuntimeError(
        f"No available port found in range {start_port}-{start_port + max_attempts}"
    )


def check_single_instance(lock_file: str) -> int | None:
    """Checks if an existing desktop instance is alive. Returns port or None."""
    if not os.path.exists(lock_file):
        return None
    try:
        with open(lock_file, "r", encoding="utf-8") as f:
            port = int(f.read().strip())
        import urllib.request

        req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
        with urllib.request.urlopen(req, timeout=1.0) as resp:
            if resp.status == 200:
                data = json.loads(resp.read().decode("utf-8"))
                if data.get("service") == "straditize_rpc":
                    return port
    except (OSError, ValueError, urllib.error.URLError):
        pass

    try:
        if os.path.exists(lock_file):
            os.remove(lock_file)
    except OSError:
        pass
    return None


def main() -> None:
    # 1. Server mode: straditize serve [--port N]
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        if sys.platform == "win32":
            try:
                import ctypes
                kernel32 = ctypes.windll.kernel32
                if kernel32.AttachConsole(-1):
                    # Attach standard output and error to parent console
                    import io
                    sys.stdout = io.TextIOWrapper(open("CONOUT$", "wb"), encoding="utf-8", write_through=True)  # noqa: SIM115
                    sys.stderr = io.TextIOWrapper(open("CONOUT$", "wb"), encoding="utf-8", write_through=True)  # noqa: SIM115
            except Exception:  # noqa: BLE001, S110
                pass

        parser = argparse.ArgumentParser(
            prog="straditize serve",
            description="Run Straditize in Server mode (fixed port, exit button disabled)",
        )
        parser.add_argument(
            "--port",
            type=int,
            default=8765,
            help="Port to listen on (default: 8765)",
        )
        args = parser.parse_args(sys.argv[2:])

        target_port = args.port
        if is_port_in_use(target_port, "127.0.0.1"):
            print(f"Error: Port {target_port} is already in use. Exiting.", file=sys.stderr)
            sys.exit(1)

        session = StraditizeSession()
        session.is_desktop_mode = False
        dispatcher = create_rpc_dispatcher(session)
        server = StraditizeRpcHttpServer(
            host="127.0.0.1",
            port=target_port,
            dispatcher=dispatcher,
            session=session,
            is_desktop_mode=False,
        )
        server.start()
        print(f"服务已启动：http://127.0.0.1:{server.actual_port}")

        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            server.stop()
        return

    # 2. Standard I/O pipe mode
    if "--stdio" in sys.argv:
        dispatcher = create_rpc_dispatcher()
        run_stdio_server(dispatcher=dispatcher)
        return

    # 3. Explicit HTTP flag (for backward compatibility and test suites)
    if "--http" in sys.argv:
        parser = argparse.ArgumentParser(
            description="Straditize JSON-RPC 2.0 Communication Server"
        )
        parser.add_argument("--http", action="store_true")
        parser.add_argument("--host", type=str, default="127.0.0.1")
        parser.add_argument("--port", type=int, default=8765)
        args = parser.parse_args()

        session = StraditizeSession()
        session.is_desktop_mode = False
        dispatcher = create_rpc_dispatcher(session)
        server = StraditizeRpcHttpServer(
            host=args.host,
            port=args.port,
            dispatcher=dispatcher,
            session=session,
            is_desktop_mode=False,
        )
        server.start()
        print(f"服务已启动：http://127.0.0.1:{server.actual_port}")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            server.stop()
        return

    # 4. Desktop Mode (Default on double-click or no args)
    if sys.platform == "win32":
        try:
            import ctypes

            hwnd = ctypes.windll.kernel32.GetConsoleWindow()
            if hwnd:
                ctypes.windll.user32.ShowWindow(hwnd, 0)
        except (ImportError, AttributeError, OSError):
            pass

    lock_file = os.path.join(tempfile.gettempdir(), "straditize_desktop.lock")
    existing_port = check_single_instance(lock_file)
    if existing_port is not None:
        import webbrowser

        webbrowser.open(f"http://127.0.0.1:{existing_port}/")
        sys.exit(0)

    chosen_port = find_available_port(8765, max_attempts=50, host="127.0.0.1")
    try:
        with open(lock_file, "w", encoding="utf-8") as f:
            f.write(str(chosen_port))
    except OSError:
        pass

    session = StraditizeSession()
    session.is_desktop_mode = True
    dispatcher = create_rpc_dispatcher(session)
    server = StraditizeRpcHttpServer(
        host="127.0.0.1",
        port=chosen_port,
        dispatcher=dispatcher,
        session=session,
        is_desktop_mode=True,
    )
    server.start()

    import webbrowser

    webbrowser.open(f"http://127.0.0.1:{server.actual_port}/")

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.stop()
    finally:
        try:
            if os.path.exists(lock_file):
                os.remove(lock_file)
        except OSError:
            pass


if __name__ == "__main__":
    main()
