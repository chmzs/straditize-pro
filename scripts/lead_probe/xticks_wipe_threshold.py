"""Lead 独立定位 '重新分列抹掉 x_ticks' 的触发阈值（纯进程内）。

## 判据在 2026-11 之后变了——这个脚本原来会"说反话"

旧版把 `x_ticks is None` 一律标成「**被抹掉**」，读起来像缺陷。但现行规格
**要求**重新分列后抹掉旧的 x_ticks（列带变了，旧标定不再成立），
只要同时下发 `x_ticks_dropped`（含 reason/px/band）就是**正确行为**。

真正该报的是「**被静默**抹掉」：`x_ticks` 没了、`x_ticks_dropped` 也没有 ——
那才是用户无从得知标定失效的缺陷（对应 `test_xticks_drop_is_explicit.py`）。

所以本脚本现在输出三态：保留 / 被抹掉·已记录（正确）/ 被静默抹掉（缺陷）。
"""
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
    dropped = s.columns[0].get("x_ticks_dropped") if s.columns else None
    return kept_before, after, dropped, n0, len(s.columns)

print(f"{'新区间':<18}{'Δ左':>6}{'Δ右':>6}  {'列数':>10}  x_ticks 结果")
for x0, x1 in [(315,1946),(315,1940),(320,1946),(315,1930),(330,1946),(340,1946),(315,1900),(350,1946),(400,1946),(400,900)]:
    before, after, dropped, n0, n1 = probe(x0, x1)
    dl, dr = x0-315, x1-1946
    if after:
        verdict = "保留"
    elif dropped:
        verdict = f"被抹掉·已记录({dropped.get('reason')})"   # 正确：显式告知
    else:
        verdict = "**被静默抹掉（缺陷）**"                      # 缺陷：用户无从得知
    print(f"[{x0},{x1}]".ljust(18) + f"{dl:>6}{dr:>6}  {n0:>4}->{n1:<4}  {verdict}")
