# -*- coding: utf-8 -*-
"""E18: 步骤6自动提取写入的两个 value 分别来自哪里"""
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
d = disp.handle_object({"jsonrpc":"2.0","id":1,"method":"straditize.getDiagramData","params":{}})["result"]
c0 = d["columns"][0]
print("payload col0 关键字段:")
for k in ("startX","endX","tickEndX","x_ticks","maxPercent","startValue","tickValue","scaleCalib","col_index"):
    print(f"  {k} = {c0.get(k)}")
print()
print("InspectorBridge.ts:356-360 的取值表达式（复刻）：")
print("  val1 = col.x_ticks?.[0]?.value ?? 0                  ->", (c0.get("x_ticks") or [{}])[0].get("value") if c0.get("x_ticks") else 0)
print("  val2 = col.x_ticks?.[1]?.value ?? col.maxPercent ?? ..->", c0.get("maxPercent"))
print()
print("=> val1 恒为字面量 0；val2 来自 detect_columns 硬编码的 tickValue:20.0 -> payload.maxPercent")
print("   两者都与用户在图上的任何读数无关")
