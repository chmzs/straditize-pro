# -*- coding: utf-8 -*-
"""E3: 完全复刻前端从零旅程的 RPC 序列（含 roi_id 传递），检查 x_ticks 保全条件"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)

from straditize_core.session import StraditizeSession

print("=== 场景 1：load_image 之后 rois 是什么？ ===")
s = StraditizeSession()
info = s.load_image(sample_key="hoya")
print("load_image 返回键:", sorted(info.keys()))
print("rois =", s.rois)
print("data_xlim/ylim =", s.data_xlim, s.data_ylim)
print("active_roi_id =", s.active_roi_id, "| primary =", s.primary_roi_id)

print()
print("=== 场景 2：直接 detect_columns(无 roi_id, 无 ROI) ===")
s2 = StraditizeSession()
s2.load_image(sample_key="hoya")
s2.detect_columns([315, 1946], [511, 1311])
print("列数 =", len(s2.columns))
print("col0 =", {k: s2.columns[0][k] for k in ("col_index","id","roi_id","start","end","tickEndX")})
print("session.rois =", s2.rois)
print("session.active_roi_id =", s2.active_roi_id)

print()
print("=== 场景 3：模拟前端第 5 步：detectColumnsInRoi 带 roi_id ===")
s3 = StraditizeSession()
s3.load_image(sample_key="hoya")
# 前端 data.roi 从后端 payload 来；零状态下 rois 为空 → 前端 data.roi 是 createEmptyDiagramData 的 0/0/0/0
print("前端此时会发的 data.roi（空态回退）: xMin=0,yMin=0,xMax=0,yMax=0, id=''")
try:
    s3.detect_columns([0, 0], [0, 0], roi_id="")
except Exception as e:
    print("→ 抛错:", type(e).__name__, e)
