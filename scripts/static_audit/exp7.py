# -*- coding: utf-8 -*-
"""E7: 残留清理几何是否影响「重置 + 重新载图」后的数字化"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession

s = StraditizeSession()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
res = s.detect_line_candidates()
cands = res["candidates"]
print("检测到候选几何:", len(cands))
# 用户确认其中 3 条为「已去除」
for c in cands[:3]:
    s.set_line_geometry_status(c["id"], "removed")
stats = s.apply_line_removal()["stats"] if isinstance(s.apply_line_removal(), dict) else None
st = s._recompose(s.active_roi_id)["stats"]
print("确认 3 条后 removed_line_pixels =", st["removed_line_pixels"])

def dig(col_idx):
    s.digitize(col_idx, "area")
    pts = s.column_points.get(col_idx, [])
    return len(pts), (pts[0] if pts else None)

n_before, p_before = dig(0)
print(f"确认几何生效时 col0: points={n_before}, first={p_before}")

# === 用户点「重置全部操作」 ===
print("\n--- 重置 (project_new, clear_image=False) ---")
s.project_new(clear_image=False)
print("line_candidates 残留 =", len(s.line_candidates))
print("rois =", len(s.rois), "columns =", len(s.columns))
print("grid_line_mask is None =", s.grid_line_mask is None)

# === 用户重新上传同一张图（load_image） ===
print("\n--- 重新载入图片 (load_image) ---")
s.load_image(sample_key="hoya")
print("line_candidates 残留 =", len(s.line_candidates))
print("selected_candidate_ids 残留 =", len(s.selected_candidate_ids))
s.detect_columns([315, 1946], [511, 1311])
st2 = s._recompose(s.active_roi_id)["stats"]
print("重载后 removed_line_pixels =", st2["removed_line_pixels"])
n_after, p_after = dig(0)
print(f"重载后 col0: points={n_after}, first={p_after}")
print()
print("=> 结论：", "残留几何继续作用于新图" if st2["removed_line_pixels"] > 0 else "无影响")
