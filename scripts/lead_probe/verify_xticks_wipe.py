"""Lead 独立验证：'重新分列会静默抹掉全部 x_ticks' 这条既有注释是否仍然成立。
纯进程内（不起 HTTP 服务），与 journey-runner 的实现方式不同，构成独立复核。"""
import sys; sys.path.insert(0, '.')
from straditize_core.session import StraditizeSession

def fresh():
    s = StraditizeSession()
    s.load_image(sample_key="hoya")
    s.detect_columns([315, 1946], [511, 1311])
    return s

def ticks(s, idx=0):
    return s.columns[idx].get("x_ticks")

# --- A: 标定后同边界重分列 ---
s = fresh()
s.calibrate_column_xticks(0, ticks=[{"px": 322.0, "value": 0.0}, {"px": 480.0, "value": 20.0}],
                          unit="%", plot_type="area", scale_type="linear")
print("A 标定后      :", ticks(s))
n_before = len(s.columns)
s.detect_columns([315, 1946], [511, 1311])
print("A 同边界重分列:", ticks(s), "| 列数", n_before, "->", len(s.columns))

# --- B: 标定后边界微差重分列 ---
s2 = fresh()
s2.calibrate_column_xticks(0, ticks=[{"px": 322.0, "value": 0.0}, {"px": 480.0, "value": 20.0}],
                           unit="%", plot_type="area", scale_type="linear")
print("B 标定后      :", ticks(s2))
s2.detect_columns([316, 1945], [511, 1311])
print("B 微差重分列  :", ticks(s2))

# --- C: 列数变化的极端情形（用户重新划一个完全不同的 ROI）---
s3 = fresh()
s3.calibrate_column_xticks(0, ticks=[{"px": 322.0, "value": 0.0}, {"px": 480.0, "value": 20.0}],
                           unit="%", plot_type="area", scale_type="linear")
print("C 标定后      :", ticks(s3))
s3.detect_columns([400, 900], [511, 1311])   # 明显不同区间 → 列数很可能变
print("C 换区间重分列:", ticks(s3), "| 列数", len(s3.columns))
