# -*- coding: utf-8 -*-
"""E4: 零态 vs 已载图 payload 的键集差异 + 前端镜像后果"""
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

def call(m, p=None):
    r = disp.handle_object({"jsonrpc": "2.0", "id": 1, "method": m, "params": p or {}})
    return r

z = call("straditize.getDiagramData")
zero = z.get("result", z)
print("ZERO keys:", sorted(zero.keys()))
print("ZERO roi =", zero.get("roi"))
print("ZERO rois =", zero.get("rois"))

s.load_image(sample_key="hoya")
l = call("straditize.getDiagramData")
loaded = l.get("result", l)
print()
print("LOADED keys:", sorted(loaded.keys()))
print("LOADED rois =", [(r['id'], r['name']) for r in loaded.get('rois', [])])
print()
print("ZERO-only keys:", sorted(set(zero) - set(loaded)))
print("LOADED-only keys:", sorted(set(loaded) - set(zero)))
print()
print("ZERO rois element type:", type(zero.get("rois")), "| len", len(zero.get("rois") or []))
r0 = (loaded.get("rois") or [{}])[0]
print("LOADED rois[0] keys:", sorted(r0.keys()))
print("LOADED rois[0].xlim =", r0.get("xlim"), "| xMin =", r0.get("xMin"))
print()
print("=== 前端 RpcClient.getDiagramData 的 rois 直接透传 → 元素形状不同 ===")
