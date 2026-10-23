# -*- coding: utf-8 -*-
"""E8: 残留几何在「重置 + 换成另一张图」后，是否静默剔除新图上本不该删的像素"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession
import numpy as np

# --- 干净会话：图 A = hoya，确认大量几何 ---
s = StraditizeSession()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
cands = s.detect_line_candidates()["candidates"]
for c in cands:
    s.set_line_geometry_status(c["id"], "removed")
st = s._recompose(s.active_roi_id)["stats"]
print(f"图 A(hoya): 确认 {len(cands)} 条几何 -> removed_line_pixels = {st['removed_line_pixels']}")

# --- 用户点「重置全部操作」（底图保留） ---
s.project_new(clear_image=False)

# --- 用户换成另一张图 B = beginner ---
s.load_image(sample_key="beginner")
print(f"图 B(beginner) 载入后: line_candidates 残留 = {len(s.line_candidates)}")
s.detect_columns([200, 1700], [200, 1600])
st_b = s._recompose(s.active_roi_id)["stats"]
print(f"图 B: removed_line_pixels = {st_b['removed_line_pixels']}  (用户从未在图 B 上确认任何几何)")

# 对照：全新会话直接载入图 B
s2 = StraditizeSession()
s2._init_cleanup()
s2.load_image(sample_key="beginner")
s2.detect_columns([200, 1700], [200, 1600])
st_b2 = s2._recompose(s2.active_roi_id)["stats"]
print(f"对照组（全新会话图 B）: removed_line_pixels = {st_b2['removed_line_pixels']}")

# 数字化对比
s.digitize(0, "area"); s2.digitize(0, "area")
pa = s.column_points[0]; pb = s2.column_points[0]
print(f"\n残留会话 col0 点数 = {len(pa)} | 对照会话 col0 点数 = {len(pb)}")
xa = [p['x'] for p in pa]; xb = [p['x'] for p in pb]
common = min(len(xa), len(xb))
diff = sum(1 for i in range(common) if abs(xa[i]-xb[i]) > 0.5)
print(f"前 {common} 点中 x 有差异的点数 = {diff}")
