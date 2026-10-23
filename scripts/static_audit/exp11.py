# -*- coding: utf-8 -*-
"""E11: 残留几何是否让新图的列被标记为 stale（用户可见的「分列已过期」）"""
import os, tempfile, json, sys, base64
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession

def run(with_residue):
    s = StraditizeSession(); s._init_cleanup()
    if with_residue:
        s.load_image(sample_key="hoya")
        s.detect_columns([315, 1946], [511, 1311])
        for c in s.detect_line_candidates()["candidates"]:
            s.set_line_geometry_status(c["id"], "removed")
        s.project_new(clear_image=False)         # 用户点「重置」
    with open(r"E:/software_dev/straditize/straditize_core/assets/tutorials/beginner-tutorial.png","rb") as f:
        d = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    s.load_image(image_data=d, file_name="b.png")
    s.detect_columns([200, 1700], [200, 1600])
    roi = s._get_roi(s.active_roi_id)
    return len(s.line_candidates), roi["columns_stale"], s._recompose(s.active_roi_id)["stats"]["removed_line_pixels"]

for label, wr in (("有残留(重置后换图)", True), ("无残留(全新会话)", False)):
    n, stale, rem = run(wr)
    print(f"{label}: line_candidates={n}  columns_stale={stale}  removed_line_pixels={rem}")
