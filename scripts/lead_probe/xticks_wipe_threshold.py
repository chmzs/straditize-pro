"""Lead 独立定位 '重新分列抹掉 x_ticks' 的触发阈值（纯进程内）。"""
import sys; sys.path.insert(0, '.')
from straditize_core.session import StraditizeSession

def probe(x0, x1):
    s = StraditizeSession()
    s.load_image(sample_key="hoya")
    s.detect_columns([315, 1946], [511, 1311])
    n0 = len(s.columns)
    s.calibrate_column_xticks(0, ticks=[{"px": 322.0, "value": 0.0}, {"px": 480.0, "value": 20.0}],
                              unit="%", plot_type="area", scale_type="linear")
    kept_before = s.columns[0].get("x_ticks")
    s.detect_columns([x0, x1], [511, 1311])
    after = s.columns[0].get("x_ticks") if s.columns else None
    return kept_before, after, n0, len(s.columns)

print(f"{'新区间':<18}{'Δ左':>6}{'Δ右':>6}  {'列数':>10}  x_ticks 结果")
for x0, x1 in [(315,1946),(315,1940),(320,1946),(315,1930),(330,1946),(340,1946),(315,1900),(350,1946),(400,1946),(400,900)]:
    before, after, n0, n1 = probe(x0, x1)
    dl, dr = x0-315, x1-1946
    verdict = "保留" if after else "**被抹掉**"
    print(f"[{x0},{x1}]".ljust(18) + f"{dl:>6}{dr:>6}  {n0:>4}->{n1:<4}  {verdict}")
