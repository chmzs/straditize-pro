"""Lead 决定性实验：x_ticks 被抹的真正判据是"列数变化"还是"区间守卫越界"？
做法：只动左边界（逐像素），每步同时记录 列数 与 守卫是否通过。"""
import sys; sys.path.insert(0, '.')
from straditize_core.session import StraditizeSession

def run(dx):
    s = StraditizeSession(); s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.detect_columns([315, 1946], [511, 1311])
    n0 = len(s.columns)
    c0 = s.columns[0]
    s.calibrate_column_xticks(0, ticks=[{"px": c0["start"], "value": 0.0},
                                        {"px": c0["tickEndX"], "value": 40.0}],
                              unit="%", plot_type="area", scale_type="linear")
    tick_px = s.columns[0]["x_ticks"][0]["px"] if s.columns[0].get("x_ticks") else None
    s.detect_columns([315 + dx, 1946], [511, 1311])
    n1 = len(s.columns)
    after = s.columns[0].get("x_ticks") if s.columns else None
    # 新区间下守卫判据：tick_px 是否落在 [min(start,end)-10, max(start,end)+10]
    if s.columns:
        st, en = s.columns[0]["start"], s.columns[0]["end"]
        lo, hi = min(st, en) - 10, max(st, en) + 10
        guard_ok = (tick_px is not None) and (lo <= tick_px <= hi)
    else:
        guard_ok = None
    return n0, n1, bool(after), guard_ok, tick_px

print(f"{'Δ左':>5}{'列数':>10}{'保留?':>8}{'守卫通过?':>11}{'tick_px':>10}")
first_wipe = None
for dx in range(0, 30):
    n0, n1, kept, guard, tpx = run(dx)
    mark = ""
    if not kept and first_wipe is None:
        first_wipe = dx; mark = "  ← 首次被抹"
    print(f"{dx:>5}{n0:>5}->{n1:<4}{'是' if kept else '否':>7}{('是' if guard else '否'):>10}{tpx:>10}{mark}")
print()
print(f"首次被抹出现在 Δ左 = {first_wipe}")
