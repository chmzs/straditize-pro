"""Lead 验证：x_ticks 被静默抹掉后，导出的数值是否真的改变含义（数据完整性）。"""
import sys; sys.path.insert(0, '.')
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale

s = StraditizeSession()
s.load_image(sample_key="hoya")
s.detect_columns([315, 1946], [511, 1311])
s.calibrate_column_xticks(0, ticks=[{"px": 322.0, "value": 0.0}, {"px": 480.0, "value": 20.0}],
                          unit="%", plot_type="area", scale_type="linear")
s.digitize(0, "area")

c0 = s.columns[0]
sc = resolve_column_scale(s, c0, 0)
print("=== 标定后（x_ticks 生效） ===")
print("  x_ticks :", c0.get("x_ticks"))
print("  scale   :", sc)

def sample_width():
    pts = s.column_points.get(0, [])
    return max((p.get("x",0) - c0["start"]) for p in pts) if pts else 0
w = sample_width()
print(f"  该列最大像素宽度 = {w:.1f}px")

def to_value(width):
    # 用 x_ticks 线性换算：(px - px1)/(px2-px1)*(v2-v1)+v1
    t = c0.get("x_ticks")
    if not t: return None
    px = c0["start"] + width
    return (px - t[0]["px"])/(t[1]["px"]-t[0]["px"])*(t[1]["value"]-t[0]["value"]) + t[0]["value"]
print(f"  → 按 x_ticks 换算 = {to_value(w):.4f} %")

# 触发列数变化的重分列 → 静默抹掉
s.detect_columns([340, 1946], [511, 1311])
c0b = s.columns[0]
scb = resolve_column_scale(s, c0b, 0)
print("=== 列数变化重分列后 ===")
print("  x_ticks :", c0b.get("x_ticks"))
print("  scale   :", scb)
print(f"  → 同一像素宽度按 legacy 列宽百分比换算 = {100.0*w/(c0b['end']-c0b['start']):.4f} %")
print()
print("  ⚠️ 同一个物理读数，标定前后得到的数值不同，且**没有任何用户可见提示**。")
