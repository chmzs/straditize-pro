"""Lead 独立复核 F-1：重分列时前端旧镜像回滚后端已接受的 ROI。
关键：用后端真值直接验证，并区分"前端镜像回滚"与"后端自身行为"。"""
import sys; sys.path.insert(0, '.')
from straditize_core.session import StraditizeSession

def fresh():
    s = StraditizeSession(); s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.detect_columns([315, 1946], [511, 1311])
    return s

# A) 后端自身：改 ROI 后重分列（传新 bounds）→ 应保持新值（证明不是后端自己回滚）
s = fresh()
s.roi_update(s.rois[0]["id"], x0=355, x1=1906)
print("A 后端 roi.update 后     :", s.rois[0]["xlim"])
s.detect_columns([355, 1906], [511, 1311], roi_id=s.rois[0]["id"])
print("A 重分列(传新bounds)后   :", s.rois[0]["xlim"], "← 保持新值，非后端自身回滚")

# B) 模拟前端旧镜像：改 ROI 后，重分列时**传旧 bounds**（正是 WorkflowController 的行为）
s2 = fresh()
old = list(s2.rois[0]["xlim"])
s2.roi_update(s2.rois[0]["id"], x0=355, x1=1906)
print("\nB 后端 roi.update 后     :", s2.rois[0]["xlim"], f"（旧镜像仍是 {old}）")
s2.detect_columns(old, [511, 1311], roi_id=s2.rois[0]["id"])   # ← 前端传旧值
print("B 重分列(传旧bounds)后   :", s2.rois[0]["xlim"], "← **被回滚**")
print("   >>> 用户改的 ROI 被静默退回旧值，且无任何错误/提示")
