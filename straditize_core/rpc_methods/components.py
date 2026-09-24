"""Component management RPC methods."""

from __future__ import annotations

from typing import Any

from ..components import component_manager


def register(dispatcher: Any, session: Any) -> None:
    """Register component manager operations."""
    dispatcher.register_method("component.getStatus", lambda name="age-modeling": component_manager.get_status(name))
    dispatcher.register_method(
        "component.install",
        lambda name="age-modeling", custom_url=None: component_manager.start_download_task(name, custom_url),
    )
    dispatcher.register_method(
        "component.installOfflineZip",
        lambda zip_path, name="age-modeling": component_manager.install_from_zip(zip_path, name),
    )
    dispatcher.register_method("component.uninstall", lambda name="age-modeling": component_manager.uninstall(name))
