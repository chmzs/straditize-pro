# -*- coding: utf-8 -*-
"""E2: 重新分列是否静默抹掉 x_ticks（step6-xticks.spec.ts 注释里的开放缺陷）"""
import os, tempfile, json, sys
REPO = r"E:/software_dev/straditize"
sys.path.insert(0, REPO)
cfg = tempfile.mkdtemp(prefix="strad_audit_cfg_")
os.environ["STRADITIZE_CONFIG_PATH"] = os.path.join(cfg, "config.json")
with open(os.environ["STRADITIZE_CONFIG_PATH"], "w") as f:
    json.dump({"remote_access_enabled": False, "allowed_hosts": ["127.0.0.1"]}, f)

from straditize_core.session import StraditizeSession
s = StraditizeSession()
s.load_image(sample_key="hoya")
# 与 e2e 基线完全相同的 ROI
s.detect_columns([315, 1946], [511, 1311])
print("初始列数 =", len(s.columns))

c0 = s.columns[0]
px1 = c0["start"]
px2 = c0["tickEndX"]
print(f"col0: start={px1} end={c0['end']} tickEndX={px2}")

# 走真实 RPC 入口标定
res = s.calibrate_column_xticks(0, [{"px": px1, "value": 0}, {"px": px2, "value": 40}])
print("标定后 col0.x_ticks =", s.columns[0]["x_ticks"])

# 场景 A：ROI 不变，重新分列（用户从步骤 6 退回步骤 5 再前进 = 前端必发 core.detectColumns）
s.detect_columns([315, 1946], [511, 1311])
print(f"[A] 同 ROI 重新分列后 col0.x_ticks = {s.columns[0].get('x_ticks')!r}  列数={len(s.columns)}")

# 重新标定，再测场景 B：列数变了
s.calibrate_column_xticks(0, [{"px": s.columns[0]["start"], "value": 0}, {"px": s.columns[0]["tickEndX"], "value": 40}])
print("再次标定后 =", s.columns[0]["x_ticks"])
old_n = len(s.columns)
s.detect_columns([315, 1500], [511, 1311])   # 缩小 ROI → 列数几乎必然变化
print(f"[B] 列数变化({old_n}->{len(s.columns)}) 后 col0.x_ticks = {s.columns[0].get('x_ticks')!r}")

# 场景 C：ROI 不变但列宽微变（列数不变）——检查区间守卫是否误杀
s2 = StraditizeSession()
s2.load_image(sample_key="hoya")
s2.detect_columns([315, 1946], [511, 1311])
c = s2.columns[0]
# 故意标到靠近列右边界的位置
s2.calibrate_column_xticks(0, [{"px": c["start"], "value": 0}, {"px": c["end"] - 1, "value": 40}])
print("\n[C] 标定到 end-1 =", s2.columns[0]["x_ticks"])
s2.detect_columns([315, 1946], [511, 1311])
print(f"[C] 同 ROI 重分列后 = {s2.columns[0].get('x_ticks')!r}")
