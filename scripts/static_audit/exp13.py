# -*- coding: utf-8 -*-
"""E13: (a) 撤销/重做是否保全 x_ticks；(b) 空 ROI 下 detect_columns 的报错形态"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession
from straditize_core.protocol import JsonRpcError

s = StraditizeSession(); s._init_cleanup()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
s.calibrate_column_xticks(0, [{"px": s.columns[0]["start"], "value": 0},
                              {"px": s.columns[0]["tickEndX"], "value": 40}], "%")
print("标定后 col0.x_ticks =", s.columns[0]["x_ticks"])
print("undo_stack 长度 =", len(s.undo_stack))
r = s.history_undo()
print("undo ->", r, "| col0.x_ticks =", s.columns[0].get("x_ticks"))
r = s.history_redo()
print("redo ->", r, "| col0.x_ticks =", s.columns[0].get("x_ticks"))

print()
print("=== (b) ROI 为空时 detect_columns ===")
s2 = StraditizeSession(); s2._init_cleanup()
s2.load_image(sample_key="hoya")
s2.roi_remove("roi_1")
print("rois 数 =", len(s2.rois), "| active_roi_id =", s2.active_roi_id)
print("前端此时会发的 data.roi =", s2._roi_box())
try:
    s2.detect_columns([0, 0], [0, 0], roi_id="")
except JsonRpcError as e:
    print(f"  -> JsonRpcError code={e.code}: {e.message}")
print("core.detectColumns 无参调用:")
try:
    s2.detect_columns()
except JsonRpcError as e:
    print(f"  -> JsonRpcError code={e.code}: {e.message}")
