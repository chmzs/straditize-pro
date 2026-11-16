"""本地地层图渲染：riojaPlot 优先、rioja 回退，返回图片字节。

## 为什么单独一个模块

原来的 `plotting.py` 只负责「找 R / 跑一个写死参数的 rioja::strat.plot」。
本次要做的三件事都属于「画什么、怎么画」：默认启用 riojaPlot 那套常用开关、
把产物以图片字节交回前端（不是默认落盘到 ~/.straditize/plots）、以及如实报告
降级（装了 riojaPlot 才有 Italicise / Break long / Exaggeration / Min/max）。

## 不静默降级

riojaPlot 缺失时回退 `rioja::strat.plot`，但**必须把这些开关没生效这件事报出去**
（返回 `unsupported` 列表 + 一条 warning），而不是画一张少了一半特征的图当作成功。
"""

from __future__ import annotations

import base64
import subprocess
from pathlib import Path
from typing import Any, Mapping, Sequence

#: 默认出图设置：对齐 riojaPlot vignette（allen1999 版式）——**只开 silhouette**，
#: 不开 bar/line（横条纹 + 轮廓发毛的来源），字号不放大，齿长 tcl=-0.1，列间留 0.01 白缝。
#: 需要更粗/更大的观感时由用户调 settings，不做默认放大。
DEFAULT_PLOT_SETTINGS: dict[str, Any] = {
    "percent": True,
    "silhouette": True,
    # 参考图（vignette allen1999）只开 silhouette；bar 会画等距横条纹、line 让边缘发毛。
    "bar": False,
    "line": False,
    "rev_y": True,
    # exaggeration：参考图没有这个概念，3× 列内放大会压到相邻面板、也与 minmax 轴标签打架。
    # 默认关；需要时用户开 settings.exaggeration。
    "exaggeration": False,
    "exag_mult": 3.0,
    "exag_alpha": 0.15,
    "minmax": False,
    # 每列是否参与「默认缩放」：{列名: "normalize" | "fixed"}。
    # normalize（默认）= rioja 的 scale.percent 语义：**每列按本列最大值**归一后画满宽
    #   （不是共用一把 0–100 的尺）；fixed = 按该列自身量程（min..max）画，
    #   炭屑 / 花粉浓度这类绝对值列用它。
    # 空 dict = 全部 normalize，即历史行为（scale.percent），脚本与产物都不变。
    "plot_scale_mode": {},
    # 显式列宽（相对权重）：{列名: 正数}。留空 = 按规则自动算：
    #   百分比列 ∝ 该列最大值；非百分比列/段 = 固定占比。
    # 用户可在这里覆盖任何一列，宽度会以**字面数字**写进导出的 R 脚本，便于手工改。
    "plot_column_widths": {},

    "italicise": True,
    "break_long": True,
    "break_n": 20,
    "label_rotate": 45,
    # 字号倍率：1.0 = riojaPlot 默认（cex.xlabel 0.9 / yaxis 0.7 / xaxis 0.6 / ylabel 0.9）。
    # 参考图同样是宽图，用小字号反而清爽；嫌小请自己调这个值，不做默认放大。
    "font_scale": 1.0,
    # 齿长 / 底部留白 / 列间距：与参考图一致（tcl -0.1、yBottom 0.06、xSpace 0.01）。
    "tcl": -0.1,
    "y_bottom": 0.06,
    "x_space": 0.01,
    "axis": True,
    "ylabel": "Depth",
    "title": "",
    "width_px": 2200,
    "height_px": 1500,
    "dpi": 300,
    # y 轴范围三格（min / max / interval）。None = 自动（数据范围 + pretty 刻度）。
    # 三格必须同时给：只给一部分会「半生效」，所以整套忽略并如实提示。
    "y_axis": None,
    # 中文字体：Python 侧探测后写入（系统优先、随包 OFL 兜底）。
    # 必须在这里登记，否则 resolve_settings 会以「未知的出图设置」拒绝。
    "font_path": "",
    "font_source": "",
}

#: 中文字体候选（**系统探测优先**，仓库打包的 OFL 字体兜底）。
#: 注意：`simhei.ttf`（中易黑体）与 `msyh.ttc`（微软雅黑）是**专有字体，不可随包分发**，
#: 这里只是在本机探测使用；仓库内随包的必须是 OFL 许可的字体（Noto Sans SC / 思源黑体）。
CJK_FONT_CANDIDATES = (
    ("C:/Windows/Fonts/simhei.ttf", "中易黑体（专有，仅本机使用）"),
    ("C:/Windows/Fonts/msyh.ttc", "微软雅黑（专有，仅本机使用）"),
    ("C:/Windows/Fonts/NotoSansSC-Regular.ttf", "Noto Sans SC（OFL）"),
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "Noto Sans CJK（OFL）"),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "文泉驿正黑（GPL+FE）"),
)


def probe_cjk_font() -> tuple[str | None, str | None]:
    """探测可用的中文字体，返回 (路径, 来源说明)；找不到返回 (None, None)。

    调用方必须把「找不到」如实报给用户（中文标签会变方框），不许静默降级。
    """
    for path, source in CJK_FONT_CANDIDATES:
        if Path(path).is_file():
            return path, source
    bundled = Path(__file__).parent / "assets" / "fonts" / "NotoSansSC-Regular.ttf"
    if bundled.is_file():
        return str(bundled), "随包 Noto Sans SC（OFL）"
    return None, None

#: 只有 riojaPlot 才有的开关；回退到 rioja 时这些不生效，必须报告。
RIOJAPLOT_ONLY_KEYS = (
    "italicise",
    "break_long",
    "break_n",
    "exaggeration",
    "exag_mult",
    "exag_alpha",
    "minmax",
    "plot_scale_mode",
    "label_rotate",
)

#: 出图格式只有两种，前后端同一份枚举（用户裁决："前后端一致支持两种就行了，
#: jpg 和 pdf，没必要冗余"）。jpeg = 位图，直接分享；pdf = 矢量，适合排版放大。
#: 曾同时支持 png / jpg / webp / svg，四份冗余枚举要在前端下拉、RPC 校验、文档与测试
#: 四处各维护一遍，且没有任何一种带来 jpeg/pdf 之外的用途。
SUPPORTED_PLOT_FORMATS = ("jpeg", "pdf")

MIME_BY_FORMAT = {
    "jpeg": "image/jpeg",
    "pdf": "application/pdf",
}


def normalize_settings(settings: dict[str, Any] | None) -> dict[str, Any]:
    """把用户给的设置并到默认值上，未知键直接拒绝（不做「当没看见」）。"""
    return resolve_settings(settings)[0]


#: y 轴范围最多允许的刻度格数（再密就没法读，R 里 seq() 也会糊成一片）。
MAX_Y_TICKS = 200


def validate_y_axis(value: Any) -> tuple[dict[str, float] | None, str | None]:
    """把 y 轴三格归一成 `{min,max,interval}` 或 None，并给出「被忽略」的原因。

    - 三格都没填（None / 空串 / 空 dict）→ `(None, None)`，走自动范围；
    - 只填了 1~2 格 → `(None, 提示)`：整套忽略，不进入半生效状态；
    - 三格都在但非法（min>=max / interval<=0 / 格数>MAX_Y_TICKS）→ 抛 ValueError；
    - 三格合法 → `({min,max,interval}, None)`。
    """
    if value is None or value == {}:
        return None, None
    if not isinstance(value, dict):
        raise ValueError("y 轴范围需要三项：{min, max, interval}")
    unknown = sorted(set(value) - {"min", "max", "interval"})
    if unknown:
        raise ValueError("y 轴范围只接受 min / max / interval，未知项：" + ", ".join(unknown))

    def _one(key: str) -> float | None:
        raw = value.get(key)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            return None
        try:
            num = float(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"y 轴 {key} 不是数字：{raw!r}") from exc
        if num != num or num in (float("inf"), float("-inf")):
            raise ValueError(f"y 轴 {key} 不是有限数字：{raw!r}")
        return num

    ymin, ymax, interval = _one("min"), _one("max"), _one("interval")
    filled = [v for v in (ymin, ymax, interval) if v is not None]
    if not filled:
        return None, None
    if len(filled) != 3:
        hint = (
            "y 轴范围需要 min / max / interval 三项都填才生效："
            f"只填了 {len(filled)} 项，本次已忽略，刻度按数据自动。"
        )
        return None, hint
    assert ymin is not None and ymax is not None and interval is not None
    if ymin >= ymax:
        raise ValueError(f"y 轴范围非法：min({ymin:g}) 必须小于 max({ymax:g})")
    if interval <= 0:
        raise ValueError(f"y 轴刻度间隔必须大于 0，收到 {interval:g}")
    ticks = (ymax - ymin) / interval
    if ticks > MAX_Y_TICKS:
        raise ValueError(
            f"y 轴范围过密：({ymax:g} - {ymin:g}) / {interval:g} = {ticks:.0f} 格，上限 {MAX_Y_TICKS} 格"
        )
    return {"min": ymin, "max": ymax, "interval": interval}, None


#: 「每列是否参与默认缩放」的两个合法取值。
SCALE_MODES = ("normalize", "fixed")


def validate_plot_scale_mode(value: Any) -> dict[str, str]:
    """把「每列是否参与默认缩放」归一成 {列名: "normalize" | "fixed"}。

    - 留空（None / 空 dict）→ {}：全部列走 normalize，即历史行为；
    - 取值只接受 normalize / fixed，其他取值一律 ValueError（拼错的开关不静默吞掉）；
    - 列名是否存在由调用方（plot_render，它手上有导出表）负责核对。

    normalize = rioja 的 scale.percent 语义：**每列按本列最大值**归一后画满宽（不是
    共用一把 0–100 的尺）。fixed = 按该列自身量程（min..max）画。
    """
    if value is None or value == {}:
        return {}
    if not isinstance(value, dict):
        raise ValueError(
            'plot_scale_mode 需要 {列名: "normalize" | "fixed"}，收到 ' + type(value).__name__
        )
    out: dict[str, str] = {}
    for raw_col, raw_mode in value.items():
        col = str(raw_col).strip()
        if not col:
            raise ValueError("plot_scale_mode 里有空列名")
        mode = str(raw_mode).strip().lower()
        if mode not in SCALE_MODES:
            raise ValueError(
                f"plot_scale_mode[{col}] 只接受 " + " / ".join(SCALE_MODES) + f"，收到 {raw_mode!r}"
            )
        out[col] = mode
    return out


def validate_plot_column_widths(value: Any) -> dict[str, float]:
    """把「显式列宽」归一成 {列名: 正数权重}；留空 → {}（走自动规则）。

    宽度必须 > 0 且有限：0 会让该列面板消失（看起来像「列丢了」），
    负数/NaN 会让整段布局崩掉。
    """
    if value is None or value == {}:
        return {}
    if not isinstance(value, dict):
        raise ValueError("plot_column_widths 需要 {列名: 正数}，收到 " + type(value).__name__)
    out: dict[str, float] = {}
    for raw_col, raw_w in value.items():
        col = str(raw_col).strip()
        if not col:
            raise ValueError("plot_column_widths 里有空列名")
        try:
            weight = float(raw_w)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"plot_column_widths[{col}] 不是数字：{raw_w!r}") from exc
        if not (weight > 0) or weight != weight or weight == float("inf"):
            raise ValueError(f"plot_column_widths[{col}] 必须是有限正数，收到 {raw_w!r}")
        out[col] = weight
    return out


def resolve_settings(settings: dict[str, Any] | None) -> tuple[dict[str, Any], list[str]]:
    """归一化设置，并返回「已经如实告知、但没生效」的提示列表。

    y 轴三格只填了一部分时，这里把它归成 None（整套忽略）并把原因放进 warnings，
    而不是让三个参数里只生效两个。
    """
    merged = dict(DEFAULT_PLOT_SETTINGS)
    warnings: list[str] = []
    if settings:
        unknown = sorted(set(settings) - set(DEFAULT_PLOT_SETTINGS))
        if unknown:
            raise ValueError("未知的出图设置：" + ", ".join(unknown))
        merged.update(settings)
    y_axis, hint = validate_y_axis(merged.get("y_axis"))
    merged["y_axis"] = y_axis
    if hint:
        warnings.append(hint)
    merged["plot_scale_mode"] = validate_plot_scale_mode(merged.get("plot_scale_mode"))
    merged["plot_column_widths"] = validate_plot_column_widths(merged.get("plot_column_widths"))
    return merged, warnings


def _settings_tsv(settings: dict[str, Any]) -> str:
    """把设置写成 key<TAB>value 行；不用 JSON，省掉 R 侧对 jsonlite 的依赖。"""
    lines: list[str] = []
    for key, value in settings.items():
        if key == "y_axis":
            # 三格齐备才写成 R 认识的三行；None 时一行都不写（R 得到 NA = 自动）。
            if isinstance(value, dict):
                lines.append("y_min\t" + repr(float(value["min"])))
                lines.append("y_max\t" + repr(float(value["max"])))
                lines.append("y_interval\t" + repr(float(value["interval"])))
            continue

        if key == "plot_column_widths":
            # 每列一行：colwidth.<列名><TAB><权重>（字面数字，R 侧直接用）
            for col, weight in value.items():
                safe = str(col).replace("\t", " ").replace("\r", " ").replace("\n", " ")
                lines.append("colwidth." + safe + "\t" + repr(float(weight)))
            continue
        if key == "plot_scale_mode":
            # 每列一行：scale_mode.<列名><TAB><mode>。用键前缀而不是把整张表塞进一行，
            # 列名里出现分隔符也不会串味（R 侧按键前缀收集）。
            for col, mode in value.items():
                safe = str(col).replace("\t", " ").replace("\r", " ").replace("\n", " ")
                lines.append("scale_mode." + safe + "\t" + str(mode))
            continue
        if isinstance(value, bool):
            text = "true" if value else "false"
        elif isinstance(value, (int, float)):
            text = repr(float(value)) if isinstance(value, float) else str(value)
        else:
            text = str(value).replace("\t", " ").replace("\r", " ").replace("\n", " ")
        lines.append(key + "\t" + text)
    return "\n".join(lines) + "\n"


#: 视为「百分比类」的单位写法（与 `export.py` 共用同一份口径）。
PERCENT_UNITS = ("%", "％", "percent", "pct")


def is_percent_unit(unit: Any) -> bool:
    """该单位是否属于百分比族（只有这些才按「每列自身量程」画）。"""
    return str(unit or "").strip().lower() in PERCENT_UNITS


def _r_string_vector(names: Sequence[str]) -> str:
    """把列名写成 R 的 c("a", "b")：引号/反斜杠转义，属种名带标点时脚本语法不坏。"""
    quoted = ['"' + str(n).replace("\\", "\\\\").replace('"', '\\"') + '"' for n in names]
    return "c(" + ", ".join(quoted) + ")"



def build_strat_plot_r_script(
    entries: Sequence[tuple[str, str, Mapping[str, str]]],
    *,
    widths: Mapping[str, float] | None = None,
) -> str:
    """**唯一的**导出用 R 脚本生成器（rioja::strat.plot）。

    `entries` 里每项是 `(标签, CSV 相对路径, {列名: unit})`。tar 内的 `plot_strat.R`、
    导出弹窗「R 脚本」下载、以及任何别的出口都必须调这一个函数 —— 三处各写一份模板，
    就是「用户拿到的脚本还是旧版」的成因（`project.py` 与 `export_r` 曾各自硬编码）。

    量纲：
    - 百分比列：按**本列最大值**铺满自己的面板（`scale.percent = TRUE` 在 rioja 里会让
      面板宽度与该列最大值成正比，一个 800 的浓度列会把 27 个百分比列挤成细条，
      所以这里用 `scale.percent = FALSE` + `scale.minmax = TRUE` + 逐列 `minmax` 矩阵，
      等价且等宽 —— 依据见 `rioja::strat.plot` 源码 :149-158 / :312-320 / :400。
    - 非百分比列：`scale.percent = FALSE`，按该列自身 min..max 画。
    """
    lines: list[str] = [
        "# ==============================================================================",
        "# Straditize Pro - Stratigraphic Diagram Plotting Script",
        "# Generated automatically by Straditize v2.0 (straditize pro)",
        "# Requires R package 'rioja' (install.packages('rioja'))",
        "#",
        "# 量纲：% 列按本列最大值铺满自己的面板；非 % 列按自身 min..max 画。",
        "# 每列的面板宽度相等（scale.percent = FALSE），xlim 由 minmax 矩阵逐列给出。",
        "#",
        "# 空单元格 = 该行不在这一列的取数窗口内（未测），**不是 0 丰度**。",
        "# 本脚本**保留 NA**：rioja::strat.plot 会把 NA 画成空白/缺口。",
        "# 下游统计若确实需要一个数，请显式处理（na.omit / 按缺失模型插补），不要替用户决定。",
        "# ==============================================================================",
        "",
        "if (!requireNamespace('rioja', quietly = TRUE)) install.packages('rioja')",
        "library(rioja)",
        "",
    ]
    explicit_widths = dict(widths or {})
    explicit_widths = dict(widths or {})
    for label, csv_path, units in entries:
        ordered = list(units)
        # 连续同类列成一段；段序 = 画布列序（col01 最左 … col28 最右）
        segments: list[tuple[bool, list[str]]] = []
        for name in ordered:
            is_pct = is_percent_unit(units[name])
            if segments and segments[-1][0] == is_pct:
                segments[-1][1].append(name)
            else:
                segments.append((is_pct, [name]))
        lines.append(f"# --- ROI: {label} ---")
        non_pct = [c for c in ordered if not is_percent_unit(units[c])]
        if non_pct:
            detail = ", ".join(f"{c}({units[c]})" for c in non_pct)
            lines.append(f"# 非百分比列（各自成段、按自身量程画）：{detail}")
        lines.append(f"if (file.exists('{csv_path}')) {{")
        lines.append(f"  df <- read.csv('{csv_path}', check.names = FALSE)")
        lines.append("  if (ncol(df) > 1) {")
        lines.append("    # 段列表：段数 / 每段列集合 / 每段是否按百分比画 —— 生成期即确定，可直接核对。")
        seg_lines = [
            f"      list(cols = {_r_string_vector(seg_cols)}, percent = {'TRUE' if is_pct else 'FALSE'})"
            for is_pct, seg_cols in segments
        ]
        lines.append("    segments <- list(")
        lines.append(",\n".join(seg_lines))
        lines.append("    )")
        width_pairs = ", ".join(
            f'"{c}" = {float(explicit_widths.get(c, 1.0))!r}' for c in ordered
        )
        if widths:
            note = "; ".join(f"{c}={widths[c]:.0f}px" for c in ordered if c in widths)
            lines.append(f"    # 列宽 = 原图列宽（endX-startX）占比：{note}")
        lines.append(f"    col_widths <- c({width_pairs})")
        lines.append("    for (i in seq_along(segments)) {")
        lines.append("      seg <- segments[[i]]")
        lines.append("      d <- df[, seg$cols, drop = FALSE]")
        lines.append(
            "      lo <- if (seg$percent) rep(0, length(seg$cols)) else apply(d, 2, function(v) min(v, na.rm = TRUE))"
        )
        lines.append("      hi <- apply(d, 2, function(v) max(v, na.rm = TRUE))")
        lines.append("      hi[!is.finite(hi) | hi <= lo] <- lo[!is.finite(hi) | hi <= lo] + 1")
        lines.append("      strat.plot(d, yvar = df[[1]], y.rev = TRUE, scale.percent = FALSE,")
        lines.append("                  scale.minmax = TRUE, minmax = cbind(lo, hi),")
        lines.append("                  graph.widths = col_widths[seg$cols], plot.line = TRUE,")
        lines.append(f"                  add = i > 1, title = '{label}')")
        lines.append("    }")
        lines.append("  }")
        lines.append("}")
        lines.append("")
    return "\n".join(lines)


#: R 侧脚本。写成纯文本而不是 f-string：里面全是 R 的花括号，任何格式化都会出事。
STRAT_PLOT_SCRIPT = r'''# ==============================================================================
# Straditize Pro - 地层图 R 脚本（自包含，可直接运行）
#
# 怎么跑：
#   Rscript <本文件>                 # 用默认 data.csv / strat_diagram.jpeg
#   Rscript <本文件> my.csv my.jpeg   # 覆盖输入 / 输出
#   source('<本文件>')                # 在 RStudio 或 R 会话里直接跑
#
# 依赖：riojaPlot（优先，缺则回退 rioja）；中文字体用 sysfonts + showtext（PDF 走 cairo_pdf）。
# 字体：__FONT_COMMENT__
# 配置已内嵌在下方 settings 里，不需要任何外部 tsv 文件。
# ==============================================================================
args <- commandArgs(trailingOnly = TRUE)
csv_path <- if (length(args) >= 1 && nzchar(args[[1]])) args[[1]] else '__DEFAULT_CSV__'
out_path <- if (length(args) >= 2 && nzchar(args[[2]])) args[[2]] else '__DEFAULT_OUT__'

# 配置（由 straditize 生成时写入；键名与设置页一致）
s <- __SETTINGS_LIST__
flag <- function(key, default) {
  v <- s[[key]]
  if (is.null(v) || !nzchar(as.character(v))) return(default)
  identical(tolower(as.character(v)), "true")
}
num <- function(key, default) {
  v <- s[[key]]
  if (is.null(v) || !nzchar(as.character(v))) return(default)
  out <- suppressWarnings(as.numeric(v))
  if (is.na(out)) default else out
}
txt <- function(key, default) {
  v <- s[[key]]
  if (is.null(v) || !nzchar(as.character(v))) default else as.character(v)
}

raw <- utils::read.csv(csv_path, check.names = FALSE, na.strings = c("NA", "", "NaN"))
if (ncol(raw) < 2) stop("STRADITIZE_ERROR: 导出的表只有深度列，没有可画的属种列。")
depth <- suppressWarnings(as.numeric(raw[[1]]))
taxa <- raw[, -1, drop = FALSE]
taxa[] <- lapply(taxa, function(v) suppressWarnings(as.numeric(v)))
usable <- vapply(taxa, function(v) any(is.finite(v)), logical(1))
taxa <- taxa[, usable, drop = FALSE]
if (ncol(taxa) == 0) stop("STRADITIZE_ERROR: 所有属种列都是空的（全 NA），无法出图。")

fmt <- tolower(tools::file_ext(out_path))
W <- num("width_px", 2200)
H <- num("height_px", 1500)
DPI <- num("dpi", 300)

open_device <- function() {
  if (fmt == "jpeg") {
    grDevices::jpeg(out_path, width = W, height = H, res = DPI, quality = 95, type = "cairo")
  } else if (fmt == "pdf") {
    grDevices::cairo_pdf(out_path, width = W / DPI, height = H / DPI, family = "straditize")
  } else {
    stop("STRADITIZE_ERROR: 不支持的输出格式 ", fmt, "（支持 jpeg/pdf）")
  }
}

collect_warnings <- function(expr) {
  seen <- character(0)
  withCallingHandlers(
    expr,
    warning = function(w) {
      seen <<- c(seen, conditionMessage(w))
      invokeRestart("muffleWarning")
    }
  )
  seen
}

fs <- num("font_scale", 2)
# y 轴范围三格：Python 侧只有三项齐备才写这三行；缺行 → NA → riojaPlot 用自动范围。
ymin_v <- num("y_min", NA_real_)
ymax_v <- num("y_max", NA_real_)
yint_v <- num("y_interval", NA_real_)
use_riojaplot <- requireNamespace("riojaPlot", quietly = TRUE)
engine <- if (use_riojaplot) "riojaPlot" else "rioja"

open_device()
# 轴与刻度齿的线宽：axis() 不接收 lwd 形参，只认 par("lwd")。放这里只影响轴/齿，
# 不影响曲线（riojaPlot 画线时显式传了 lwd.line）。
# ── 中文字体：sysfonts + showtext（PDF 走 cairo_pdf）────────────────────────
# 字体路径由 Python 侧探测后写进 settings（系统字体优先，随包 OFL 字体兜底）。
# 找不到就**报错退出**，不静默画成方框/空白。
font_path <- txt("font_path", "")
if (!nzchar(font_path) || !file.exists(font_path)) {
  stop("STRADITIZE_ERROR: 未找到中文字体（simhei/msyh/Noto/文泉驿），中文标签会显示为方框；请安装任一中文字体或在设置里指定。")
}
if (requireNamespace("sysfonts", quietly = TRUE) && requireNamespace("showtext", quietly = TRUE)) {
  sysfonts::font_add("straditize", regular = font_path)
  showtext::showtext_auto()
} else {
  stop("STRADITIZE_ERROR: 缺少 sysfonts / showtext 包，无法注册中文字体（install.packages(c(\"sysfonts\", \"showtext\"))）。")
}
par(family = "straditize")
par(lwd = num("axis_lwd", 4))
warns <- tryCatch(
  collect_warnings({
    if (use_riojaplot) {
      style <- riojaPlot::makeStyles(
        scale.percent = flag("percent", TRUE),
        plot.poly = flag("silhouette", TRUE),
        plot.bar = flag("bar", TRUE),
        plot.line = flag("line", TRUE),
        y.rev = flag("rev_y", TRUE),
        ymin = ymin_v,
        ymax = ymax_v,
        yinterval = yint_v,
        plot.exag = flag("exaggeration", TRUE),
        exag.mult = num("exag_mult", 5),
        exag.alpha = num("exag_alpha", 0.2),
        labels.italicise = flag("italicise", TRUE),
        labels.break.long = flag("break_long", TRUE),
        labels.break.n = as.integer(num("break_n", 20)),
        srt.xlabel = num("label_rotate", 45),
        cex.xlabel = 0.9 * fs,
        cex.xaxis = 0.6 * fs,
        cex.yaxis = 0.7 * fs,
        cex.ylabel = 0.9 * fs,
        # 齿长 tcl 与「标签离轴距离」在 riojaPlot 里是绑死的：内部 spc <- -tclx，
        # 标签起点正好落在齿末端。所以把 tcl 调大只会让**刻度齿穿过数字**
        # （实测 -1.3 时 10/20/30 被齿线穿过）。帮助页写 tcl 默认 -0.3，保持默认。
        tcl = num("tcl", -0.1),
        lwd.axis = num("axis_lwd", 4),
        plot.bottom.axis = flag("axis", TRUE),
        plot.top.axis = FALSE,
        plot.yaxis = TRUE,
        x.pc.omit0 = TRUE,
        # y 轴标题走 yvar.name（帮助页：name of the variable to use for primary
        # y-axis），它是 **chron 数据框的列名**；把该列命名成想要的标题即可，
        # 见下面调用处的 names(y_df)。style$ylabel 在 y.rev 下会被算到画布外，别用。
        # 配色与留白：默认的深灰填充 + 黑竖线在打印/投影上都显脏，这里降一档对比度。
        col.poly = "#C9CFD8",
        col.bar = "#3B4453",
        col.line = "#1F2937",
        col.exag = grDevices::adjustcolor("#C9CFD8", alpha.f = num("exag_alpha", 0.2)),
        # 列名位置：y.rev 时列名画在图顶，默认 xlabPos 0.1 会在顶部留出一大块空白；
        # y 轴标签同理，默认会压在刻度数字上（实测 "Depth" 与 10/20/30 重叠）。
        # 字放大后需要更多留白，否则列名顶到画布边缘、y 轴标题被裁掉（实测）。
        xlabPos = num("xlab_pos", 0.12),
        # 列名是 +45° 斜排且字号被放大 2 倍，仅靠 xlabPos 不够：
        # 实测斜体字母上缘会顶到画布边。显式下移绘图区顶端，给标签留出实体空间。
        yTop = num("y_top", 0.86),
        # 底部拥挤：字号放大 2 倍后，x 轴刻度数字与面板底边、与相邻列都贴在一起。
        # 把绘图区底边上抬（默认 0.05 → 0.12），给刻度一整行的高度。
        # tcl 回到默认后齿不再需要大留白；0.15 会在底部留下一整块空白（实测）。
        yBottom = num("y_bottom", 0.06),
        # 列间留白：参考图 0.01；0 会让面板贴在一起（看不出分栏）。
        xSpace = num("x_space", 0.01),
        # ylabPos 不覆盖：留空让 riojaPlot 按刻度实际宽度自己算。
        # 列名角度 +45°（逆时针上倾）+ 斜体；y.rev 时列名画在图顶，
        # 不再强制居中——居中会把长属种名挤到邻列上。
        centre.xlabel = FALSE
      )
      # 每列是否参与「默认缩放」：settings 里 scale_mode.<列名><TAB>normalize|fixed。
      # normalize = 与 rioja 的 scale.percent **同一算法**：每列各自按**本列最大值**归一
      # （不是共用一把 0-100 的尺：A 列 max 20% 与 B 列 max 5% 都画满宽）。
      # fixed = 按该列自身量程画（min..max），炭屑 / 花粉浓度这类绝对值列用它。
      # 两条都没有（空表 + minmax=FALSE）→ 历史路径，字节不变。
      scale_mode_keys <- names(s)[startsWith(names(s), "scale_mode.")]
      scale_modes <- if (length(scale_mode_keys) == 0) {
        character(0)
      } else {
        stats::setNames(
          vapply(scale_mode_keys, function(k) tolower(s[[k]]), character(1)),
          substring(scale_mode_keys, nchar("scale_mode.") + 1)
        )
      }
      is_fixed <- stats::setNames(rep(flag("minmax", FALSE), ncol(taxa)), colnames(taxa))
      for (mode_col in intersect(names(scale_modes), colnames(taxa))) {
        is_fixed[[mode_col]] <- identical(scale_modes[[mode_col]], "fixed")
      }
      # ── 列宽：∝ 原图列宽（endX - startX），全部列统一 ─────────────────────
      # 原图列宽本身就是作者按丰度给的版式（实测宽度与列 max 的秩相关 0.663，
      # 按宽度前 5 与按 max 前 5 是同一批列），所以直接沿用源图版式：
      # 不按 max 重算、不设地板。权重由 Python 侧算好，写成字面量 colwidth.<列>。
      maxs <- apply(taxa, 2, function(v) max(v, na.rm = TRUE))
      maxs[!is.finite(maxs) | maxs <= 0] <- 1
      w <- stats::setNames(rep(1, ncol(taxa)), colnames(taxa))
      for (w_name in names(w)) {
        ov <- num(paste0("colwidth.", w_name), NA_real_)
        if (!is.na(ov) && ov > 0) w[[w_name]] <- ov
      }
      y_df <- data.frame(depth)
      names(y_df) <- txt("ylabel", "Depth")
      # 单次调用：scale.percent=FALSE 让宽度完全由 w 决定；
      # minmax 让每列铺满自己的面板（% 列 (0, max)、非 % 列 (min, max)）。
      mins <- apply(taxa, 2, function(v) min(v, na.rm = TRUE))
      mins[!is_fixed] <- 0
      style$scale.percent <- FALSE
      style$scale.minmax <- TRUE
      style$minmax <- cbind(mins, maxs)
      style$graph.widths <- as.numeric(w)
      riojaPlot::riojaPlot(x = taxa, y = y_df, style = style,
                           yvar.name = names(y_df)[1])
    } else {
      rioja::strat.plot(
        d = as.matrix(taxa),
        yvar = depth,
        y.rev = flag("rev_y", TRUE),
        ylabel = txt("ylabel", "Depth"),
        plot.poly = flag("silhouette", TRUE),
        plot.bar = flag("bar", TRUE),
        plot.line = flag("line", TRUE),
        scale.percent = flag("percent", TRUE),
        srt.xlabel = num("label_rotate", 45),
        mgp = c(3, 0.45 * fs, 0.3),
        x.pc.omit0 = TRUE,
        title = txt("title", "")
      )
    }
  }),
  error = function(e) {
    graphics.off()
    stop(e)
  }
)
invisible(grDevices::dev.off())
if (!file.exists(out_path)) stop("STRADITIZE_ERROR: R 没有产出文件：", out_path)

cat(sprintf("STRADITIZE_ENGINE\t%s\n", engine))
for (w in unique(warns)) {
  cat(sprintf("STRADITIZE_WARN\t%s\n", gsub("[\r\n]+", " ", w)))
}
'''


def _parse_stdout(stdout: str) -> tuple[str | None, list[str]]:
    engine = None
    warnings: list[str] = []
    for line in (stdout or "").splitlines():
        if line.startswith("STRADITIZE_ENGINE\t"):
            engine = line.split("\t", 1)[1].strip()
        elif line.startswith("STRADITIZE_WARN\t"):
            warnings.append(line.split("\t", 1)[1].strip())
    return engine, warnings


def render_strat_diagram(
    *,
    csv_path: str,
    out_path: str,
    rscript: str,
    settings: dict[str, Any] | None = None,
    timeout: float = 180.0,
) -> dict[str, Any]:
    """跑 R 出图；失败抛 RuntimeError（消息里带 R 自己的 stderr）。"""
    merged = normalize_settings(settings)
    # 中文字体探测必须在这里做，而不是只放在 plot_render：任何直接调 render_strat_diagram
    # 的调用方（测试、脚本、MCP）都会因为没有 font_path 而让 R 侧 stop()。
    if not merged.get("font_path"):
        _probe_path, _probe_src = probe_cjk_font()
        merged["font_path"] = _probe_path or ""
        merged["font_source"] = _probe_src or ""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    def _r_literal(value: Any) -> str:
        if isinstance(value, bool):
            return "TRUE" if value else "FALSE"
        if isinstance(value, (int, float)):
            return repr(value)
        if value is None:
            return "NULL"
        return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'

    settings_literal = (
        "list(\n  "
        + ",\n  ".join(f"{k} = {_r_literal(v)}" for k, v in merged.items() if v is not None)
        + "\n)"
    )
    script_path = out.with_name(out.stem + ".R")
    script_text = (
        STRAT_PLOT_SCRIPT.replace("__SETTINGS_LIST__", settings_literal)
        .replace("__DEFAULT_CSV__", Path(csv_path).name)
        .replace("__DEFAULT_OUT__", out.name)
        .replace(
            "__FONT_COMMENT__",
            f"{merged.get('font_source') or '系统字体'}（{merged.get('font_path') or '未找到'}）",
        )
    )
    script_path.write_text(script_text, encoding="utf-8")

    try:
        proc = subprocess.run(
            [rscript, str(script_path), str(Path(csv_path)), str(out)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"R 出图超时（>{timeout:.0f}s）：数据行数过多或 R 进程卡住。{exc}"
        ) from exc

    if proc.returncode != 0 or not out.is_file():
        stderr = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(f"R 出图失败（返回码 {proc.returncode}）：{stderr or '没有错误输出'}")

    engine, warnings = _parse_stdout(proc.stdout)
    unsupported: list[str] = []
    if engine == "rioja":
        unsupported = [k for k in RIOJAPLOT_ONLY_KEYS if merged.get(k) not in (False, None, "", 0)]
        warnings = warnings + [
            "本机只装了 rioja（没有 riojaPlot）：Italicise / Break long / Exaggeration / "
            "Min/max / 每列独立量程（plot_scale_mode）/ 标签旋转 这些开关在 "
            "rioja::strat.plot 里没有，本图未应用。"
        ]

    return {
        "path": str(out.resolve()),
        "r_script": str(script_path.resolve()),
        "size_bytes": out.stat().st_size,
        "engine": engine or "unknown",
        "warnings": warnings,
        "unsupported": unsupported,
        "settings": merged,
        "rscript": rscript,
        "command": [rscript, str(script_path), str(Path(csv_path)), str(out)],
    }


def read_as_data_url(path: str, fmt: str) -> tuple[str, str]:
    """把产物读成 data URL；前端直接塞 <img src>，不必再要一个下载端点。"""
    data = Path(path).read_bytes()
    mime = MIME_BY_FORMAT.get(fmt.lower(), "application/octet-stream")
    return mime, "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")

