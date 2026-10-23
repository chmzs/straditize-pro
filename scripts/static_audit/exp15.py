# -*- coding: utf-8 -*-
"""E15: 未标定列导出时用的是哪一套标度？（验证 startValue/tickValue 硬编码 0/20）"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale

s = StraditizeSession(); s._init_cleanup()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
print("detect_columns 写进每列的标度字段（未经用户任何确认）：")
for c in s.columns[:3]:
    print("  ", {k: c.get(k) for k in ("col_index","start","end","tickEndX","startValue","tickValue","scale_type")})
sc = resolve_column_scale(s, s.columns[0], 0)
print("\nresolve_column_scale(col0):", {"val0": sc.val0, "val1": sc.val1, "px0": sc.abs_px0,
      "px1": sc.abs_px1, "calibrated": sc.calibrated, "source": sc.source})
print("\n=> 结论：未标定列按 (startValue=0 -> tickValue=20) 线性映射导出，"
      "该 0/20 是 detect_columns 硬编码（session_parts/core.py 里 \"startValue\": 0.0, \"tickValue\": 20.0）")

# 对照：没有任何 legacy 字段的列（column_add 造出来的）走 100.0 默认
s2 = StraditizeSession(); s2._init_cleanup()
s2.load_image(sample_key="hoya")
s2.detect_columns([315, 1946], [511, 1311])
s2.column_add({"name": "extra"})
last = s2.columns[-1]
print("\ncolumn_add 造的列:", {k: last.get(k) for k in ("col_index","start","end","tickEndX","startValue","tickValue")})
sc2 = resolve_column_scale(s2, last, last["col_index"])
print("resolve_column_scale(new col):", {"val0": sc2.val0, "val1": sc2.val1, "calibrated": sc2.calibrated, "source": sc2.source})
