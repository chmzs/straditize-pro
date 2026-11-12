"""导出/保存两类归档共用的说明文字。

**为什么要单独一个模块**：README 有两个写入点——`project.py`（保存工程包）与
`export.py`（导出数据 tar）。此前两处各写一份，结果只改了一处：保存的工程包里
有缺测说明，导出面板拿到的 tar 里没有（实测 readme_has_missing_notice=false）。
文案属于"用户会照着做分析"的内容，分叉一次就会误导一次，所以收敛到一处。
"""

from __future__ import annotations

# data.csv 的缺测语义。**必须**同时讲清"窗口内 0.0"与"整列 NA"：
# 旧文案写的是「unobserved taxa are strictly 0.0 (never NA)」，把两种情况混成一句，
# 用户会把"没测到"当成"测到 0 丰度"拿去算百分比与对数和。
CSV_MISSING_NOTICE = (
    b"SCIENTIFIC NOTICE (missing-data semantics):\n"
    b"  1) gaps INSIDE a column's digitizing window are written 0.0 = true zero abundance.\n"
    b"  2) columns never digitized / not X-calibrated are written NA = NO DATA, not zero.\n"
    b"  3) never treat NA as 0; handle NA before log transforms, then add a pseudocount.\n"
)
