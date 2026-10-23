# -*- coding: utf-8 -*-
"""E1: project_new(clear_image=False) 残留 line_candidates / exclusion_regions / line_strokes"""
import os, tempfile, json
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)

from straditize_core.session import StraditizeSession
s = StraditizeSession()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])

# 制造第 4 步状态：检测候选线 + 一条排除区 + 一笔笔迹
res = s.detect_line_candidates()
print("detect candidates ->", len(res.get("candidates", [])))

# 手写排除区与笔迹（与前端 RPC 等价的会话状态）
s.exclusion_regions = [{"id": "excl_test_1", "x0": 400, "y0": 600, "x1": 900, "y1": 620, "roi_id": s.active_roi_id}]
s.line_strokes = [{"id": "stroke_test_1", "mode": "erase", "radius": 4, "points": [[500, 600], [520, 610]]}]

print("BEFORE project_new:",
      "line_candidates =", len(s.line_candidates),
      "| exclusion_regions =", len(s.exclusion_regions),
      "| line_strokes =", len(s.line_strokes))

# 用户点「新建工程」——这正是前端「载入新图片」之前会走的路
s.project_new(clear_image=False)

print("AFTER  project_new:",
      "line_candidates =", len(s.line_candidates),
      "| exclusion_regions =", len(s.exclusion_regions),
      "| line_strokes =", len(s.line_strokes))
print("columns =", len(s.columns), "| rois =", len(s.rois), "| image is None =", s.image is None)
