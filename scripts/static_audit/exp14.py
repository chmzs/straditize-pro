# -*- coding: utf-8 -*-
"""E14: 撤销栈对 x_ticks 的语义（标定/清空后 Ctrl+Z 是否真的回退）"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession

print("=== 场景 1: 标定后 Ctrl+Z ===")
s = StraditizeSession(); s._init_cleanup()
s.load_image(sample_key="hoya"); s.detect_columns([315,1946],[511,1311])
c = s.columns[0]
s.calibrate_column_xticks(0, [{"px": c["start"], "value": 0}, {"px": c["tickEndX"], "value": 40}], "%")
before = list(s.columns[0]["x_ticks"])
n0 = len(s.undo_stack)
s.history_undo()
after = s.columns[0].get("x_ticks")
print(f"  撤销前 = {before}")
print(f"  撤销后 = {after}")
print(f"  => 回退了？ {before != after}   撤销栈 {n0} -> {len(s.undo_stack)}（消耗了一步但状态没变）")

print()
print("=== 场景 2: 清空标定后 Ctrl+Z ===")
s2 = StraditizeSession(); s2._init_cleanup()
s2.load_image(sample_key="hoya"); s2.detect_columns([315,1946],[511,1311])
c2 = s2.columns[0]
s2.calibrate_column_xticks(0, [{"px": c2["start"], "value": 0}, {"px": c2["tickEndX"], "value": 40}], "%")
print("  清空前 x_ticks =", s2.columns[0]["x_ticks"])
s2.clear_column_xticks(0)
print("  清空后 x_ticks =", s2.columns[0].get("x_ticks"))
n1 = len(s2.undo_stack)
s2.history_undo()
print(f"  Ctrl+Z 后 x_ticks = {s2.columns[0].get('x_ticks')}   撤销栈 {n1} -> {len(s2.undo_stack)}")
print(f"  => 恢复了？ {s2.columns[0].get('x_ticks') is not None}")
