"""Lead 独立复核 B-06：标定后 Ctrl+Z（history_undo）是否真的撤销不掉 x_ticks。"""
import sys; sys.path.insert(0, '.')
from straditize_core.session import StraditizeSession

s = StraditizeSession(); s._init_cleanup()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
c = s.columns[0]
px0, px1 = c["start"], c["tickEndX"]
print("标定前 col0.x_ticks =", c.get("x_ticks"))
s.calibrate_column_xticks(0, ticks=[{"px": px0, "value": 0.0}, {"px": px1, "value": 40.0}],
                          unit="%", plot_type="area", scale_type="linear")
after = s.columns[0].get("x_ticks")
print("标定后 col0.x_ticks =", after)
print("undo 栈深度 =", len(getattr(s, "undo_stack", [])))

r = s.history_undo()
print("history_undo ->", r)
back = s.columns[0].get("x_ticks")
print("undo 后 col0.x_ticks =", back)
print()
print(">>> 撤销后 x_ticks 是否仍在（若在 => 撤销覆盖不到它）:", back is not None)
