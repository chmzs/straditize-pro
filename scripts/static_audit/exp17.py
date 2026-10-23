# -*- coding: utf-8 -*-
"""E17: 重新分列抹掉 x_ticks 的确切触发条件"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession

def fresh(bounds=([315,1946],[511,1311])):
    s = StraditizeSession(); s._init_cleanup()
    s.load_image(sample_key="hoya"); s.detect_columns(*bounds)
    return s

print("A) 同 ROI 重分列（列数不变）")
s = fresh()
s.calibrate_column_xticks(0, [{"px": s.columns[0]["start"], "value": 0}, {"px": s.columns[0]["tickEndX"], "value": 40}], "%")
n0 = len(s.columns)
s.detect_columns([315,1946],[511,1311])
print(f"   列数 {n0}->{len(s.columns)}; col0.x_ticks = {s.columns[0].get('x_ticks')}")

print("\nB) ROI 微调导致列数变化（用户在步骤 2 拖了 ROI 手柄）")
s = fresh()
s.calibrate_column_xticks(0, [{"px": s.columns[0]["start"], "value": 0}, {"px": s.columns[0]["tickEndX"], "value": 40}], "%")
print(f"   标定后 col0.x_ticks = {s.columns[0]['x_ticks']}")
n0 = len(s.columns)
s.detect_columns([315, 1500], [511, 1311])   # 右边界内收
print(f"   列数 {n0}->{len(s.columns)}; col0.x_ticks = {s.columns[0].get('x_ticks')}  <- 被抹掉")
print(f"   其余列 x_ticks 全为 None: {all(c.get('x_ticks') is None for c in s.columns)}")

print("\nC) 列数相同但刻度像素落在列边界外（区间守卫）")
s = fresh()
# 手工把 x_ticks 的 px 放到列外 >10px
c = s.columns[0]
s.columns[0]["x_ticks"] = [{"px": c["start"] - 50, "value": 0}, {"px": c["tickEndX"], "value": 40}]
print(f"   人为放到列外: {s.columns[0]['x_ticks']}")
n0 = len(s.columns)
s.detect_columns([315,1946],[511,1311])
print(f"   列数 {n0}->{len(s.columns)}; col0.x_ticks = {s.columns[0].get('x_ticks')}  <- 守卫拦下")

print("\nD) 结论：preserve_state = (len(old_roi_cols) == len(detected_cols))")
print("   只要该 ROI 的列数变了，全部列的 x_ticks 无条件丢弃（core.py 的 if preserve_state 分支）")
