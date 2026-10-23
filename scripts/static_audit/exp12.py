# -*- coding: utf-8 -*-
"""E12: 残留几何是否污染「新图」的导出 CSV（量化到真实数值）"""
import os, tempfile, json, sys, base64
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession

def run(residue):
    s = StraditizeSession(); s._init_cleanup()
    if residue:
        s.load_image(sample_key="hoya")
        s.detect_columns([315, 1946], [511, 1311])
        for c in s.detect_line_candidates()["candidates"]:
            s.set_line_geometry_status(c["id"], "removed")
        s.project_new(clear_image=False)
    with open(r"E:/software_dev/straditize/straditize_core/assets/tutorials/beginner-tutorial.png","rb") as f:
        d = "data:image/png;base64," + base64.b64encode(f.read()).decode()
    s.load_image(image_data=d, file_name="b.png")
    s.detect_columns([200, 1700], [200, 1600])
    s._recompose(s.active_roi_id)
    # 用户在第 6 步为所有列标定同一标度（真实操作）
    for col in s.columns:
        s.calibrate_column_xticks(col["col_index"],
            [{"px": col["start"], "value": 0}, {"px": col["tickEndX"], "value": 20}], "%")
    return s.export_data(format="csv")

A = run(True); B = run(False)
print("导出列数:", len(A["columns"]), "vs", len(B["columns"]), "| 行数:", A["rows_count"], "vs", B["rows_count"])
diffs = []
for i in range(min(len(A["columns"]), len(B["columns"]))):
    name = A["columns"][i]
    ca = [r[name] for r in A["data"]]; cb = [r[name] for r in B["data"]]
    d = sum(1 for x, y in zip(ca, cb) if x != y)
    if d:
        diffs.append((name, d, len(ca)))
print("\n受影响列（残留 vs 干净）:")
for name, d, tot in diffs[:8]:
    print(f"  {name}: {d}/{tot} 行数值不同")
print(f"\n合计受影响列 = {len(diffs)} / {len(A['columns'])}")
