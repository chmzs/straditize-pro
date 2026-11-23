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
    exag_cols: Mapping[str, float] | Sequence[str] | None = None,
    y_axis: Mapping[str, Any] | None = None,
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

    ## 夸大线支持（按列标记精准开启）
    - 仅对工程中标记了夸大的列（`exaggeration_mult > 1`）开启 `plot.exag`；
    - 全表未标记时保持关闭（零回归）；
    - 部分列标记时传逻辑向量（`pct_cols %in% c(...)`）与标量 `exag.mult`。
    """
    pct = list(pct_cols)
    fixed = list(fixed_cols)
    lines: list[str] = [f"# --- ROI: {roi_name} ---"]
    if fixed:
        # 这一行是给人看的：脚本里为什么有两次 strat.plot 调用。
        detail = ", ".join(f"{c}({units.get(c, '')})" for c in fixed)
        lines.append(f"# 非百分比列（按自身量程画）：{detail}")

    if isinstance(exag_cols, Mapping):
        exag_taxa = [k for k, v in exag_cols.items() if v is not None and float(v) > 1.0]
        mult_candidates = [
            float(v) for v in exag_cols.values() if v is not None and float(v) > 1.0
        ]
        exag_mult_val = (
            int(mult_candidates[0])
            if mult_candidates and mult_candidates[0].is_integer()
            else (mult_candidates[0] if mult_candidates else 5)
        )
    elif exag_cols:
        exag_taxa = list(exag_cols)
        exag_mult_val = 5
    else:
        exag_taxa = []
        exag_mult_val = 5

    def _exag_str(group_cols: list[str], var_expr: str) -> str:
        if not exag_taxa:
            return ""
        in_group = [c for c in group_cols if c in exag_taxa]
        if not in_group:
            return ""
        if len(in_group) == len(group_cols):
            return f", plot.exag = TRUE, exag.mult = {exag_mult_val}"
        return f", plot.exag = {var_expr} %in% {r_string_vector(in_group)}, exag.mult = {exag_mult_val}"

    y_axis_args = ""
    if y_axis and isinstance(y_axis, (dict, Mapping)):
        ymin = y_axis.get("min")
        ymax = y_axis.get("max")
        yint = y_axis.get("interval")
        if ymin is not None and ymax is not None:
            try:
                ymin_f = float(ymin)
                ymax_f = float(ymax)
                y_axis_args += f", ylim = c({ymin_f:g}, {ymax_f:g})"
                if yint is not None and float(yint) > 0:
                    yint_f = float(yint)
                    y_axis_args += f", y.tks = seq({ymin_f:g}, {ymax_f:g}, by = {yint_f:g})"
            except (ValueError, TypeError):
                pass

    # `csv_expr` 决定「读哪个路径表达式」：归档脚本写死文件名（老行为，零回归），
    # 单文件包（zip 那份）传 `csv_path`，好在脚本开头从命令行参数取默认值。
    # `require_file=True` 时缺文件当场 stop：否则整段绘图被静默跳过，用户拿到一张空 PDF。
    read_target = csv_expr if csv_expr is not None else f"'{csv_filename}'"
    if require_file:
        lines.append(
            f"if (!file.exists({read_target})) stop("
            f'"找不到 {csv_filename}：请把它与脚本放在同一目录。")'
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
        pct_ex = _exag_str(pct, "pct_cols")
        lines.append(
            f"      strat.plot({df_var}[, pct_cols, drop = FALSE], yvar = {df_var}[[1]], y.rev = TRUE, scale.percent = TRUE, plot.poly = TRUE, plot.line = TRUE{pct_ex}{y_axis_args}, title = '{roi_name}')"
        )
        lines.append("    }")
        lines.append("    if (length(fixed_cols) > 0) {")
        fixed_ex = _exag_str(fixed, "fixed_cols")
        lines.append(
            f"      strat.plot({df_var}[, fixed_cols, drop = FALSE], yvar = {df_var}[[1]], y.rev = TRUE, scale.percent = FALSE, plot.poly = TRUE, plot.line = TRUE{fixed_ex}{y_axis_args}, add = length(pct_cols) > 0)"
        )
        lines.append("    }")
    else:
        all_ex = _exag_str(pct, f"names({df_var})[-1]")
        lines.append(
            f"    strat.plot({df_var}[-1], yvar = {df_var}[[1]], y.rev = TRUE, scale.percent = TRUE, plot.poly = TRUE, plot.line = TRUE{all_ex}{y_axis_args}, title = '{roi_name}')"
        )
    lines.append("  }")
    lines.append("}\n")
    return lines
