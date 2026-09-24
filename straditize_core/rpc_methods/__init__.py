"""RPC methods auto-discovery package."""

from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Any

logger = logging.getLogger("straditize_rpc")


def register_all(dispatcher: Any, session: Any) -> list[str]:
    """Scan modules in this package and invoke register(dispatcher, session).

    Skips __init__ and modules starting with an underscore.
    Returns the list of registered module names.
    """
    registered: list[str] = []
    for module_info in pkgutil.iter_modules(__path__):
        name = module_info.name
        if name.startswith("_"):
            continue
        try:
            mod = importlib.import_module(f".{name}", package=__name__)
            if hasattr(mod, "register"):
                mod.register(dispatcher, session)
                registered.append(name)
        except Exception:
            logger.exception("Failed to load RPC method module '%s'", name)
            raise

    logger.debug("Registered RPC method modules: %s", registered)
    return registered
