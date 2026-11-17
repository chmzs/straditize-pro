"""导出/保存两类归档共用的说明文字。

**为什么要单独一个模块**：README 有两个写入点——`project.py`（保存工程包）与
`export.py`（导出数据 tar）。此前两处各写一份，结果只改了一处：保存的工程包里
有缺测说明，导出面板拿到的 tar 里没有（实测 readme_has_missing_notice=false）。
文案属于"用户会照着做分析"的内容，分叉一次就会误导一次，所以收敛到一处。
"""

from __future__ import annotations

from typing import Any, Mapping, Sequence

# data.csv 的缺测语义。**必须**同时讲清"窗口内 0.0"与"整列 NA"：
# 旧文案写的是「unobserved taxa are strictly 0.0 (never NA)」，把两种情况混成一句，
# 用户会把"没测到"当成"测到 0 丰度"拿去算百分比与对数和。
CSV_MISSING_NOTICE = (
    b"SCIENTIFIC NOTICE (missing-data semantics):\n"
    b"  1) gaps INSIDE a column's digitizing window are written 0.0 = true zero abundance.\n"
    b"  2) columns never digitized / not X-calibrated are written NA = NO DATA, not zero.\n"
    b"  3) a calibrated column's gap at a consensus horizon is filled by that column's own\n"
    b"     linear interpolation (endpoint-clamped); uncalibrated columns stay NA = NO DATA.\n"
    b"  4) never treat NA as 0; handle NA before log transforms, then add a pseudocount.\n"
)


def r_string_vector(names: Sequence[str]) -> str:
    """把列名写成 R 的 c("a", "b")：引号/反斜杠转义，属种名带标点时脚本语法不坏。"""
    quoted = [
        '"' + str(n).replace("\\", "\\\\").replace('"', '\\"') + '"' for n in names
    ]
    return "c(" + ", ".join(quoted) + ")"


def strat_plot_script_lines(
    *,
    df_var: str,
    csv_filename: str,
    roi_name: str,
    csv_expr: str | None = None,
    require_file: bool = False,
    pct_cols: Sequence[str],
    fixed_cols: Sequence[str],
    units: Mapping[str, Any],
) -> list[str]:
    """一个 ROI 的 `strat.plot` 调用段（**唯一的生成处**）。

    ## 为什么要抽出来

    `plot_strat.R` 有两个写入点：导出数据 tar（`export.py`）与保存工程包
    （`project.py`）。前者按列量纲分两次调用（`scale.percent` 只对百分比列生效），
    后者此前**硬编码**一行 `scale.percent = TRUE` 画全表 —— 于是同一份工程，
    "导出数据"给的脚本是对的，"保存工程包"给的是错的，而 README 里那段
    「非 % 列按自身量程画」的说明只在导出包里成立。

    实测（`docs/findings/recon-20261117.md` S5）：用户工程包里 A/C（比值，单位还被
    写成 `粒/g`）与 Concentration（259.74 value/px）都被按 0–100 % 画，图与
    `data.csv` 必然对不上。

    ## 语义

    - `pct_cols` / `fixed_cols` 由调用方按自己的量纲判定拆好再传进来（不在这里
      判单位）：量纲的真源是 `resolve_column_scale(...).unit`，脚本生成不该另立一套；
    - `fixed_cols` 非空时生成**两次** `strat.plot`，第二次 `add = TRUE`——
      `rioja::strat.plot` 的 `scale.percent` 是整张表一个开关；
    - `fixed_cols` 为空时**只生成一次**调用，文本与引入本函数之前逐字节相同
      （`tests/unit/test_export_script_units.py` 的零回归判据）。
    """
    pct = list(pct_cols)
    fixed = list(fixed_cols)
    lines: list[str] = [f"# --- ROI: {roi_name} ---"]
    if fixed:
        # 这一行是给人看的：脚本里为什么有两次 strat.plot 调用。
        detail = ", ".join(f"{c}({units.get(c, '')})" for c in fixed)
        lines.append(f"# 非百分比列（按自身量程画）：{detail}")
    # `csv_expr` 决定「读哪个路径表达式」：归档脚本写死文件名（老行为，零回归），
    # 单文件包（zip 那份）传 `csv_path`，好在脚本开头从命令行参数取默认值。
    # `require_file=True` 时缺文件当场 stop：否则整段绘图被静默跳过，用户拿到一张空 PDF。
    read_target = csv_expr if csv_expr is not None else f"'{csv_filename}'"
    if require_file:
        lines.append(
            f"if (!file.exists({read_target})) stop("
            f"\"\u627e\u4e0d\u5230 {csv_filename}\uff1a\u8bf7\u628a\u5b83\u4e0e\u811a\u672c\u653e\u5728\u540c\u4e00\u76ee\u5f55\u3002\")"
        )
        lines.append(f"{df_var} <- read.csv({read_target}, check.names = FALSE)")
        # 后面的绘图段以 `if (ncol(df) > 1) {` 开头、并以收尾的 `}` 关闭外层块；
        # 这里补一个裸块 `{`，让缺文件时走 stop、文件在时括号仍配平。
        lines.append("{")
    else:
        lines.append(f"if (file.exists({read_target})) {{")
        lines.append(f"  {df_var} <- read.csv({read_target}, check.names = FALSE)")
    lines.append(f"  if (ncol({df_var}) > 1) {{")
    if fixed:
        # 百分比列与绝对值列不能共用 0–100 基准：rioja::strat.plot 的
        # `scale.percent` 是整张表一个开关，所以分成两次调用，第二次 `add = TRUE`。
        lines.append(
            f"    pct_cols <- intersect({r_string_vector(pct)}, names({df_var}))"
        )
        lines.append(
            f"    fixed_cols <- intersect({r_string_vector(fixed)}, names({df_var}))"
        )
        lines.append("    if (length(pct_cols) > 0) {")
        lines.append(
            f"      strat.plot({df_var}[, pct_cols, drop = FALSE], yvar = {df_var}[[1]], y.rev = TRUE, scale.percent = TRUE, plot.line = TRUE, title = '{roi_name}')"
        )
        lines.append("    }")
        lines.append("    if (length(fixed_cols) > 0) {")
        lines.append(
            f"      strat.plot({df_var}[, fixed_cols, drop = FALSE], yvar = {df_var}[[1]], y.rev = TRUE, scale.percent = FALSE, plot.line = TRUE, add = length(pct_cols) > 0, title = '{roi_name}')"
        )
        lines.append("    }")
    else:
        lines.append(
            f"    strat.plot({df_var}[-1], yvar = {df_var}[[1]], y.rev = TRUE, scale.percent = TRUE, plot.line = TRUE, title = '{roi_name}')"
        )
    lines.append("  }")
    lines.append("}\n")
    return lines
