# -*- coding: utf-8 -*-
"""E16: exclusion_regions 的载荷形状 vs 前端 CleanupOverlay 期望的 points"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession
from straditize_core.rpc_server import create_rpc_dispatcher
s = StraditizeSession(); s._init_cleanup()
s.load_image(sample_key="hoya"); s.detect_columns([315,1946],[511,1311])
disp = create_rpc_dispatcher(s)
# 看后端 exclusion_regions 的规范形状
import inspect
src = inspect.getsource(type(s))
print("session 上是否已有 exclusion_regions:", hasattr(s, "exclusion_regions"))
d = disp.handle_object({"jsonrpc":"2.0","id":1,"method":"straditize.getDiagramData","params":{}})["result"]
print("payload exclusion_regions =", d["exclusion_regions"])
print("payload line_candidates[0] 键 =", sorted(d["line_candidates"][0].keys()) if d["line_candidates"] else None)
