"""Component Manager for Straditize Pro.

Handles dynamic on-demand extension modules (e.g. WebR + rbacon WASM age-modeling pack ~40MB).
Key principles:
1. User-directory isolation: installs into %APPDATA%/Straditize/components/ (or ~/.straditize/components/ on Linux/macOS) to bypass admin privilege barriers.
2. Robust download & SHA256 verification against corrupt transfers.
3. Path traversal security (anti Zip-Slip).
4. Dual download mirrors (GitHub Releases + fast fallback mirrors for China academic networks).
5. Offline manual ZIP import support.
6. Seamless hot-plugging (zero restart needed).
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import io
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import threading
import time
from typing import Any
import urllib.error
import urllib.request
import zipfile

logger = logging.getLogger("straditize_component")


def get_base_components_dir() -> Path:
    """Returns platform-appropriate user components directory."""
    if sys.platform == "win32":
        app_data = os.getenv("APPDATA") or str(Path.home() / "AppData" / "Roaming")
        base_dir = Path(app_data) / "Straditize" / "components"
    elif sys.platform == "darwin":
        base_dir = Path.home() / "Library" / "Application Support" / "Straditize" / "components"
    else:
        # Linux / Unix
        xdg_data = os.getenv("XDG_DATA_HOME")
        if xdg_data:
            base_dir = Path(xdg_data) / "straditize" / "components"
        else:
            base_dir = Path.home() / ".local" / "share" / "straditize" / "components"

    base_dir.mkdir(parents=True, exist_ok=True)
    return base_dir


# Default official metadata for age-modeling component
DEFAULT_COMPONENTS: dict[str, dict[str, Any]] = {
    "age-modeling": {
        "name": "age-modeling",
        "title": "Bacon 贝叶斯年代建模扩展包 (WebR + rbacon WASM)",
        "version": "1.0.0",
        "min_app_version": "2.0.0",
        "max_app_version": "3.0.0",
        "size_bytes": 41943040,  # ~40 MB
        "description": "启用客户端 WebR + rbacon 独立纯内置 MCMC 年代建模算力，无需预装本地 R 语言环境。",
        "download_urls": [
            "https://github.com/chmzs/straditize-pro/releases/download/components/age-modeling-v1.0.0.zip",
            "https://ghproxy.net/https://github.com/chmzs/straditize-pro/releases/download/components/age-modeling-v1.0.0.zip",
        ],
        "sha256": "",  # Optional check if populated
    }
}


class ComponentManager:
    """Manages installation, query, update, and uninstallation of modular addon components."""

    def __init__(self, base_dir: Path | None = None):
        self.base_dir = base_dir or get_base_components_dir()
        self._active_downloads: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def get_status(self, component_name: str = "age-modeling") -> dict[str, Any]:
        """Returns the current installation and readiness status of a component."""
        comp_meta = DEFAULT_COMPONENTS.get(component_name, {
            "name": component_name,
            "title": component_name,
            "version": "1.0.0",
            "size_bytes": 0,
            "description": "",
        })

        target_dir = self.base_dir / component_name
        installed_info_path = target_dir / "installed.json"

        is_installed = False
        installed_version = None
        installed_at = None

        if target_dir.is_dir() and installed_info_path.is_file():
            try:
                with open(installed_info_path, "r", encoding="utf-8") as f:
                    info = json.load(f)
                    installed_version = info.get("version")
                    installed_at = info.get("installed_at")
                    is_installed = True
            except Exception as e:
                logger.warning("Failed to parse installed.json for %s: %s", component_name, e)

        # Check in-flight download progress
        progress_info = None
        with self._lock:
            if component_name in self._active_downloads:
                progress_info = dict(self._active_downloads[component_name])

        return {
            "name": component_name,
            "title": comp_meta.get("title", component_name),
            "description": comp_meta.get("description", ""),
            "target_version": comp_meta.get("version", "1.0.0"),
            "size_bytes": comp_meta.get("size_bytes", 0),
            "is_installed": is_installed,
            "installed_version": installed_version,
            "installed_at": installed_at,
            "target_dir": str(target_dir),
            "downloading": progress_info is not None and progress_info.get("status") == "downloading",
            "progress": progress_info,
        }

    def install_from_zip(
        self,
        zip_path_or_bytes: str | bytes | Path,
        component_name: str = "age-modeling",
        expected_sha256: str | None = None,
    ) -> dict[str, Any]:
        """Safely unzips a component archive into the user components directory (Anti Zip-Slip)."""
        target_dir = self.base_dir / component_name
        temp_dir = self.base_dir / f"{component_name}_tmp_{int(time.time())}"

        if isinstance(zip_path_or_bytes, bytes):
            bio = io.BytesIO(zip_path_or_bytes)
            zf = zipfile.ZipFile(bio, "r")
            computed_sha = hashlib.sha256(zip_path_or_bytes).hexdigest()
        else:
            p = Path(zip_path_or_bytes)
            if not p.is_file():
                raise FileNotFoundError(f"Component ZIP archive not found: {p}")
            zf = zipfile.ZipFile(str(p), "r")
            hasher = hashlib.sha256()
            with open(p, "rb") as f:
                while chunk := f.read(65536):
                    hasher.update(chunk)
            computed_sha = hasher.hexdigest()

        # SHA256 integrity check if provided
        if expected_sha256 and expected_sha256.lower() != computed_sha.lower():
            raise ValueError(
                f"SHA256 checksum mismatch! Expected: {expected_sha256}, Got: {computed_sha}"
            )

        # Anti Zip-Slip security path extraction
        try:
            temp_dir.mkdir(parents=True, exist_ok=True)
            resolved_dest = temp_dir.resolve()

            for member in zf.namelist():
                member_path = (temp_dir / member).resolve()
                if not str(member_path).startswith(str(resolved_dest)):
                    raise ValueError(f"Security Alert: Malicious Zip-Slip path detected in archive: {member}")

            zf.extractall(temp_dir)
        finally:
            zf.close()

        # Write installed.json metadata
        installed_info = {
            "name": component_name,
            "version": DEFAULT_COMPONENTS.get(component_name, {}).get("version", "1.0.0"),
            "installed_at": datetime.now(timezone.utc).isoformat(),
            "sha256": computed_sha,
            "install_dir": str(target_dir),
        }
        with open(temp_dir / "installed.json", "w", encoding="utf-8") as f:
            json.dump(installed_info, f, indent=2, ensure_ascii=False)

        # Atomic replacement of component directory
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        shutil.move(str(temp_dir), str(target_dir))

        logger.info("Component '%s' successfully installed to %s", component_name, target_dir)
        return {
            "success": True,
            "name": component_name,
            "installed_at": installed_info["installed_at"],
            "version": installed_info["version"],
            "target_dir": str(target_dir),
        }

    def uninstall(self, component_name: str = "age-modeling") -> dict[str, Any]:
        """Uninstalls a component by wiping its directory."""
        target_dir = self.base_dir / component_name
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
            logger.info("Component '%s' has been removed.", component_name)
            return {"success": True, "removed": True}
        return {"success": True, "removed": False}

    def start_download_task(
        self,
        component_name: str = "age-modeling",
        custom_url: str | None = None,
    ) -> dict[str, Any]:
        """Starts asynchronous download task in background thread with real-time progress tracking."""
        with self._lock:
            cur = self._active_downloads.get(component_name)
            if cur and cur.get("status") == "downloading":
                return {"success": True, "message": "Download already in progress", "progress": cur}

            self._active_downloads[component_name] = {
                "status": "downloading",
                "progress_percent": 0.0,
                "downloaded_bytes": 0,
                "total_bytes": 0,
                "error": None,
                "start_time": time.time(),
            }

        thread = threading.Thread(
            target=self._run_download_worker,
            args=(component_name, custom_url),
            daemon=True,
        )
        thread.start()
        return {"success": True, "status": "started"}

    def _run_download_worker(self, component_name: str, custom_url: str | None = None) -> None:
        """Worker thread executing streaming download across mirrors."""
        meta = DEFAULT_COMPONENTS.get(component_name, {})
        urls = [custom_url] if custom_url else meta.get("download_urls", [])

        temp_zip_path = self.base_dir / f"{component_name}_download.zip"
        expected_sha = meta.get("sha256") or None

        success = False
        last_error = None

        for url in urls:
            if not url:
                continue
            logger.info("Attempting component download from: %s", url)
            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "StraditizePro/2.0 (ComponentDownloader)"},
                )
                with urllib.request.urlopen(req, timeout=15.0) as resp:
                    total_len = int(resp.headers.get("Content-Length") or meta.get("size_bytes", 40000000))
                    downloaded = 0
                    chunk_size = 65536

                    with open(temp_zip_path, "wb") as out_f:
                        while chunk := resp.read(chunk_size):
                            out_f.write(chunk)
                            downloaded += len(chunk)
                            pct = round((downloaded / total_len) * 100.0, 1) if total_len > 0 else 50.0

                            with self._lock:
                                self._active_downloads[component_name]["downloaded_bytes"] = downloaded
                                self._active_downloads[component_name]["total_bytes"] = total_len
                                self._active_downloads[component_name]["progress_percent"] = min(99.0, pct)

                # Extract and verify
                self.install_from_zip(temp_zip_path, component_name=component_name, expected_sha256=expected_sha)
                success = True
                break
            except Exception as e:
                logger.warning("Download from %s failed: %s", url, e)
                last_error = str(e)
                if temp_zip_path.exists():
                    try:
                        temp_zip_path.unlink()
                    except OSError:
                        pass

        with self._lock:
            if success:
                self._active_downloads[component_name] = {
                    "status": "completed",
                    "progress_percent": 100.0,
                    "downloaded_bytes": meta.get("size_bytes", 0),
                    "total_bytes": meta.get("size_bytes", 0),
                    "error": None,
                }
            else:
                self._active_downloads[component_name] = {
                    "status": "failed",
                    "progress_percent": 0.0,
                    "downloaded_bytes": 0,
                    "total_bytes": 0,
                    "error": last_error or "All download mirrors failed",
                }

        if temp_zip_path.exists():
            try:
                temp_zip_path.unlink()
            except OSError:
                pass


# Global singleton instance
component_manager = ComponentManager()
