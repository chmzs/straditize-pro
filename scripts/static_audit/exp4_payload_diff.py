# -*- coding: utf-8 -*-
"""E4: 零态 vs 已载图 payload 的键集差异"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)

from straditize_core.session import StraditizeSession
from straditize_core.rpc_server import create_rpc_dispatcher

s = StraditizeSession()
disp = create_rpc_dispatcher(s)
zero = disp.dispatch("straditize.getDiagramData", {}) if hasattr(disp, "dispatch") else None
if zero is None:
    # 直接取注册的函数
    zero = s and None
