# -*- coding: utf-8 -*-
"""E6: sample_key='verification' 的失败形态（lead 3）"""
import os, tempfile, json, sys
sys.path.insert(0, r"E:/software_dev/straditize")
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)
from straditize_core.session import StraditizeSession
s = StraditizeSession()
for k in ("hoya", "beginner", "verification"):
    try:
        r = s.load_image(sample_key=k)
        print(f"{k}: OK {r['width']}x{r['height']}")
    except Exception as e:
        print(f"{k}: {type(e).__name__} -> {e}")
