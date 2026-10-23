# -*- coding: utf-8 -*-
"""E10: 不按「重置」，只重新上传另一张图 —— 第 4 步几何是否跟着串到新图"""
import os, tempfile, json, sys, base64
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession

s = StraditizeSession(); s._init_cleanup()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
cands = s.detect_line_candidates()["candidates"]
for c in cands:
    s.set_line_geometry_status(c["id"], "removed")
st = s._recompose(s.active_roi_id)["stats"]
print(f"[图 A=hoya] 用户确认 {len(cands)} 条几何; removed_line_pixels = {st['removed_line_pixels']}")
print(f"[图 A] 几何像素范围样例: x0..x1 = {cands[0]['geometry']['x0']}..{cands[0]['geometry']['x1']}, y = {cands[0]['geometry']['y0']}")

# === 用户发现传错了图，直接再上传一张图 B（前端 handleOpenFile → core.loadImage）===
with open(r"E:/software_dev/straditize/straditize_core/assets/tutorials/beginner-tutorial.png","rb") as f:
    data = "data:image/png;base64," + base64.b64encode(f.read()).decode()
s.load_image(image_data=data, file_name="beginner.png")
print(f"\n[上传图 B] line_candidates 残留 = {len(s.line_candidates)}")
print(f"[上传图 B] 其中 status='removed' 的 = {sum(1 for c in s.line_candidates if c.get('status')=='removed')}")
print(f"[上传图 B] selected_candidate_ids = {sorted(s.selected_candidate_ids)}")
print(f"[上传图 B] 新图尺寸 = {s.width}x{s.height}（图 A 为 2339x1654）")

s.detect_columns([200, 1700], [200, 1600])
st_b = s._recompose(s.active_roi_id)["stats"]
print(f"\n[图 B] removed_line_pixels = {st_b['removed_line_pixels']}  <- 用户从未在图 B 上确认任何几何")
print(f"[图 B] candidates_count = {st_b['candidates_count']}")
print(f"[图 B] 残留几何是否落在新图范围内: x1={cands[0]['geometry']['x1']} < 新图宽 {s.width} -> {cands[0]['geometry']['x1'] < s.width}")
