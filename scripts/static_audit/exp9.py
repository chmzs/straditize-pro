# -*- coding: utf-8 -*-
"""E9: 残留几何对新图数字化结果的逐列影响"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession

def build(residue: bool):
    s = StraditizeSession()
    s._init_cleanup()
    if residue:
        s.load_image(sample_key="hoya")
        s.detect_columns([315, 1946], [511, 1311])
        for c in s.detect_line_candidates()["candidates"]:
            s.set_line_geometry_status(c["id"], "removed")
        s.project_new(clear_image=False)     # 用户点「重置」
    s.load_image(sample_key="beginner")      # 换成图 B
    s.detect_columns([200, 1700], [200, 1600])
    s._recompose(s.active_roi_id)
    for col in s.columns:
        s.digitize(col["col_index"], "area")
    return s

A = build(residue=True)
B = build(residue=False)
print(f"列数: 残留={len(A.columns)} 对照={len(B.columns)}")
tot_diff = 0
for i in range(min(len(A.columns), len(B.columns))):
    pa = A.column_points.get(i, []); pb = B.column_points.get(i, [])
    da = {p["row"]: p["x"] for p in pa}; db = {p["row"]: p["x"] for p in pb}
    rows = sorted(set(da) | set(db))
    d = sum(1 for r in rows if abs(da.get(r, -1) - db.get(r, -1)) > 0.5)
    if d:
        tot_diff += 1
        if tot_diff <= 5:
            ex = next(r for r in rows if abs(da.get(r, -1) - db.get(r, -1)) > 0.5)
            print(f"  列{i} ({A.columns[i].get('name')}): {d}/{len(rows)} 行不同  例 row={ex} 残留x={da.get(ex)} 对照x={db.get(ex)}")
print(f"\n受影响列数 = {tot_diff} / {len(A.columns)}")
