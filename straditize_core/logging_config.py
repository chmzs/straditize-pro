"""Straditize structured logging and log rotation configuration.

- Log directory:
    Windows: %LOCALAPPDATA%/straditize/logs/
    POSIX/macOS: ~/.straditize/logs/
    Fallback: %TEMP%/straditize/logs/
- Rotation:
    RotatingFileHandler (max 5 MB per file, max 3 backups -> <= 15 MB total cap).
- Retention:
    Automatically deletes log files older than 7 days on startup.
"""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

_CONFIGURED = False
_LOG_FILE: Path | None = None
_LOG_DIR: Path | None = None


def get_log_dir() -> Path:
    """Return the authoritative log directory, creating it if necessary."""
    global _LOG_DIR
    if _LOG_DIR is not None and _LOG_DIR.exists():
        return _LOG_DIR

    custom = os.environ.get("STRADITIZE_LOG_DIR")
    if custom:
        d = Path(custom)
    elif platform.system() == "Windows":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            d = Path(local_app_data) / "straditize" / "logs"
        else:
            d = Path(os.environ.get("TEMP", os.path.expanduser("~"))) / "straditize" / "logs"
    else:
        d = Path.home() / ".straditize" / "logs"

    try:
        d.mkdir(parents=True, exist_ok=True)
    except Exception:
        d = Path(os.environ.get("TEMP", "/tmp")) / "straditize" / "logs"
        d.mkdir(parents=True, exist_ok=True)

    _LOG_DIR = d
    return d


def get_log_file_path() -> Path:
    """Return the path to the primary active log file."""
    global _LOG_FILE
    if _LOG_FILE is not None:
        return _LOG_FILE
    d = get_log_dir()
    _LOG_FILE = d / "straditize.log"
    return _LOG_FILE


def clean_old_logs(max_age_days: int = 7) -> None:
    """Purge log files older than max_age_days in the log directory."""
    try:
        log_dir = get_log_dir()
        cutoff = time.time() - (max_age_days * 86400)
        for item in log_dir.glob("*.log*"):
            if item.is_file() and item.name != "straditize.log":
                if item.stat().st_mtime < cutoff:
                    try:
                        item.unlink()
                    except OSError:
                        pass
    except Exception:
        pass


def setup_logging() -> Path:
    """Configure structured logging to stderr and rotating file."""
    global _CONFIGURED
    log_file = get_log_file_path()
    if _CONFIGURED:
        return log_file

    clean_old_logs(max_age_days=7)

    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    formatter = logging.Formatter(
        "[%(asctime)s] %(levelname)s [%(name)s]: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # 1. Console / stderr handler
    has_stream = any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler)
        for h in root_logger.handlers
    )
    if not has_stream:
        stream_handler = logging.StreamHandler(sys.stderr)
        stream_handler.setFormatter(formatter)
        stream_handler.setLevel(logging.INFO)
        root_logger.addHandler(stream_handler)

    # 2. Rotating file handler (5 MB, 3 backups)
    has_file = any(isinstance(h, RotatingFileHandler) for h in root_logger.handlers)
    if not has_file:
        try:
            file_handler = RotatingFileHandler(
                log_file,
                maxBytes=5 * 1024 * 1024,
                backupCount=3,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            file_handler.setLevel(logging.INFO)
            root_logger.addHandler(file_handler)
        except Exception as e:
            sys.stderr.write(f"Warning: Failed to setup file logger at {log_file}: {e}\n")

    _CONFIGURED = True
    logging.getLogger("straditize_rpc").info(f"Structured logging active at: {log_file}")
    return log_file


def open_log_dir() -> bool:
    """Open the log directory in system file explorer."""
    d = get_log_dir()
    system = platform.system()
    try:
        if system == "Windows":
            os.startfile(str(d))
            return True
        elif system == "Darwin":
            subprocess.run(["open", str(d)], check=False)
            return True
        else:
            subprocess.run(["xdg-open", str(d)], check=False)
            return True
    except Exception as e:
        logging.getLogger("straditize_rpc").error(f"Failed to open log dir: {e}")
        return False
