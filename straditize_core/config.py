"""Configuration management and persistence for Straditize."""

from __future__ import annotations

import fnmatch
import json
import os
from pathlib import Path
from typing import Any

from .metadata.llm_extractor import EXTRACTION_SYSTEM_PROMPT

DEFAULT_CONFIG: dict[str, Any] = {
    "remote_access_enabled": False,
    "remote_password": "",
    "allowed_hosts": ["127.0.0.1", "localhost"],
    "locale": "zh-CN",
    "theme": "light",
    "llm_base_url": "https://api.openai.com/v1",
    "llm_api_key": "",
    "llm_model": "gpt-4o",
    "llm_prompt_template": EXTRACTION_SYSTEM_PROMPT,
}


def get_config_path() -> Path:
    """Returns the path to ~/.straditize/config.json or STRADITIZE_CONFIG_PATH override."""
    override = os.environ.get("STRADITIZE_CONFIG_PATH")
    if override:
        return Path(override).expanduser().resolve()
    return Path.home() / ".straditize" / "config.json"


def load_config() -> dict[str, Any]:
    """Loads user configuration from config.json, merged with defaults."""
    cfg = dict(DEFAULT_CONFIG)
    path = get_config_path()
    if path.is_file():
        try:
            with open(path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            if isinstance(saved, dict):
                for k in DEFAULT_CONFIG:
                    if k in saved:
                        cfg[k] = saved[k]
        except Exception:
            pass
    return cfg


def save_config(updates: dict[str, Any]) -> dict[str, Any]:
    """Updates configuration, persists to ~/.straditize/config.json, and returns updated dict."""
    cfg = load_config()
    for k, v in updates.items():
        if k in DEFAULT_CONFIG:
            cfg[k] = v
    path = get_config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
    return cfg


def match_host_pattern(host: str, pattern: str) -> bool:
    """Matches a host against an allowed pattern (supporting wildcards like 192.168.1.*)."""
    h = host.strip().lower()
    p = pattern.strip().lower()
    if not p:
        return False
    if p == "*" or h == p:
        return True
    return fnmatch.fnmatch(h, p)


def is_host_allowed(host: str, allowed_hosts: list[str] | set[str]) -> bool:
    """Checks whether host matches any pattern in allowed_hosts."""
    h = host.strip().lower()
    for pat in allowed_hosts:
        if match_host_pattern(h, pat):
            return True
    return False
