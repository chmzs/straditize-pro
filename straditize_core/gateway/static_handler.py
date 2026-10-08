"""Static web files and component assets delivery handler."""

from __future__ import annotations

import json
import mimetypes
import os
import sys
import time
from typing import Any


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


class StaticAssetHandler:
    """Delivers frontend build artifacts and extension component assets (WebR/WASM)."""

    def __init__(self, handler: Any):
        self.handler = handler

    def handle_component_asset(self, raw_path: str) -> bool:
        """Serve component static assets (WASM/JS/Data for WebR and extension packages)."""
        if not raw_path.startswith(("/components/", "/webr/")):
            return False

        from ..components.manager import get_base_components_dir

        base_comp_dir = os.path.abspath(str(get_base_components_dir()))

        if raw_path.startswith("/components/"):
            rel_path = raw_path[len("/components/") :].lstrip("/")
        else:
            rel_path = "webr/" + raw_path[len("/webr/") :].lstrip("/")

        target_file = os.path.abspath(os.path.join(base_comp_dir, rel_path))
        if not os.path.exists(target_file):
            alt_file = os.path.abspath(
                os.path.join(base_comp_dir, "age-modeling", rel_path)
            )
            if os.path.exists(alt_file):
                target_file = alt_file

        # Security check: prevent directory traversal outside base_comp_dir
        if not target_file.startswith(base_comp_dir):
            self.handler.send_response(403)
            self.handler._send_cors_headers()
            self.handler.end_headers()
            self.handler.wfile.write(
                b"Forbidden: Path traversal outside components directory"
            )
            return True

        if os.path.isfile(target_file):
            content_type, _ = mimetypes.guess_type(target_file)
            if not content_type:
                if target_file.endswith(".wasm"):
                    content_type = "application/wasm"
                elif target_file.endswith((".js", ".mjs")):
                    content_type = "application/javascript"
                elif target_file.endswith(".json"):
                    content_type = "application/json"
                elif target_file.endswith(".data"):
                    content_type = "application/octet-stream"
                elif target_file.endswith(".css"):
                    content_type = "text/css"
                else:
                    content_type = "application/octet-stream"

            with open(target_file, "rb") as f:
                content = f.read()

            self.handler.send_response(200)
            self.handler.send_header("Content-Type", content_type)
            self.handler.send_header("Content-Length", str(len(content)))
            self.handler.send_header("Cross-Origin-Resource-Policy", "cross-origin")
            self.handler.send_header("Cache-Control", "public, max-age=3600")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            self.handler.wfile.write(content)
            return True
        else:
            self.handler.send_response(404)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            err_resp = json.dumps(
                {
                    "error": f"Component asset not found: {rel_path}",
                    "code": -32002,
                    "status": "not_found",
                },
                ensure_ascii=False,
            ).encode("utf-8")
            self.handler.wfile.write(err_resp)
            return True

    def handle_static_file(self, raw_path: str) -> bool:
        """Serve compiled frontend static artifacts (HTML/JS/CSS) or fallback SPA index.html."""
        dist_dir = find_frontend_dist(getattr(self.handler, "dist_dir", None))
        if dist_dir:
            clean_path = raw_path.lstrip("/")
            if not clean_path or clean_path == "index.html":
                clean_path = "index.html"

            target_file = os.path.abspath(os.path.join(dist_dir, clean_path))
            if not target_file.startswith(dist_dir):
                self.handler.send_response(403)
                self.handler._send_cors_headers()
                self.handler.end_headers()
                self.handler.wfile.write(b"Forbidden")
                return True

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

                self.handler.send_response(200)
                self.handler.send_header("Content-Type", content_type)
                self.handler.send_header("Content-Length", str(len(content)))
                self.handler._send_cors_headers()
                self.handler.end_headers()
                self.handler.wfile.write(content)
                return True

            index_path = os.path.join(dist_dir, "index.html")
            if not os.path.splitext(target_file)[1] and os.path.isfile(index_path):
                with open(index_path, "rb") as f:
                    content = f.read()
                self.handler.send_response(200)
                self.handler.send_header("Content-Type", "text/html; charset=utf-8")
                self.handler.send_header("Content-Length", str(len(content)))
                self.handler._send_cors_headers()
                self.handler.end_headers()
                self.handler.wfile.write(content)
                return True

            self.handler.send_response(404)
            self.handler.send_header("Content-Type", "text/plain; charset=utf-8")
            self.handler._send_cors_headers()
            self.handler.end_headers()
            self.handler.wfile.write(b"Not Found")
            return True

        # Friendly diagnostic page when frontend/dist is not built yet
        self.handler.send_response(200)
        self.handler.send_header("Content-Type", "application/json; charset=utf-8")
        self.handler._send_cors_headers()
        self.handler.end_headers()
        diag_data = {
            "status": "frontend_not_built",
            "message": "Straditize Web Frontend is ready for connection, but production assets (frontend/dist) were not found.",
            "hint": "Please build the production frontend or start the Vite development server.",
            "quick_start": {
                "dev_server": "cd frontend && npm run dev (accessible at http://localhost:5173)",
                "build_static": "cd frontend && npm run build (compiles to frontend/dist/)",
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
        self.handler.wfile.write(
            json.dumps(diag_data, indent=2, ensure_ascii=False).encode("utf-8")
        )
        return True
