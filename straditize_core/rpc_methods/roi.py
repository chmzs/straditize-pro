"""RPC methods for multi-ROI management."""

from __future__ import annotations

from typing import Any


def register(dispatcher: Any, session: Any) -> None:
    """Register roi.* RPC methods."""
    dispatcher.register_method("roi.create", session.roi_create)
    dispatcher.register_method("roi.update", session.roi_update)
    dispatcher.register_method("roi.remove", session.roi_remove)
    dispatcher.register_method("roi.list", session.roi_list)
    dispatcher.register_method("roi.setActive", session.roi_set_active)
    dispatcher.register_method("roi.setPrimary", session.roi_set_primary)
    dispatcher.register_method("roi.applyFormDefaults", session.roi_apply_form_defaults)
