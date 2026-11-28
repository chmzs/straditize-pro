"""本地地层图渲染：统一只用 CRAN rioja::strat.plot，缺包即硬失败，返回图片字节。

## 为什么只用 rioja::strat.plot

1. 与导出脚本（`export_docs.py::strat_plot_script_lines`）同源同引擎，保证应用内预览
   与导出的 `plot_strat.R` 所见即所得。
2. `rioja` 仅依赖 CRAN 标准包（且支持 webR），不再依赖 R-universe 的 `riojaPlot`
   及其 tidyverse 族依赖。
3. 不静默降级：本机缺少 `rioja` 时直接 `stop()` 并给出安装命令，绝不产出空白图。
"""

from __future__ import annotations

import base64
import subprocess
from pathlib import Path
from typing import Any

#: 默认出图设置：常用地层图组合（Silhouette % + show bar + Exaggeration
#: + Rev. Y + 标签斜体/45°/20 字符折行 + 底部刻度轴）。
DEFAULT_PLOT_SETTINGS: dict[str, Any] = {
    "percent": True,
    "silhouette": True,
    "bar": True,
    "line": True,
    "rev_y": True,
    "exaggeration": True,
    "exag_mult": 5.0,
    "exag_alpha": 0.15,
    "minmax": False,
    # 每列是否参与「默认缩放」：{列名: "normalize" | "fixed"}。
    # normalize（默认）= rioja 的 scale.percent 语义：**每列按本列最大值**归一后画满宽
    #   （不是共用一把 0–100 的尺）；fixed = 按该列自身量程（min..max）画，
    #   炭屑 / 花粉浓度这类绝对值列用它。
    # 空 dict = 全部 normalize，即历史行为（scale.percent），脚本与产物都不变。
    "plot_scale_mode": {},
    "italicise": True,
    "break_long": True,
    "break_n": 20,
    "label_rotate": 45,
    # 轴与标签字号倍率（保留设置项以兼容外部调用）。
    "font_scale": 2.0,
    "axis": True,
    # 空串 = 「由 Y 轴性质派生」：`plot_render` 出图前用 `_y_axis_label(primary_axis, unit)`
    # 填进来，用户显式给了才用用户的。这里**不留任何轴名常量**——列名与轴标签只有
    # `_y_column_label` / `_y_axis_label` 两个来源（issue #114）。
    "ylabel": "",
    "title": "",
    "width_px": 2200,
    "height_px": 1500,
    "dpi": 150,
    # y 轴范围三格（min / max / interval）。None = 自动（数据范围 + pretty 刻度）。
    # 三格必须同时给：只给一部分会「半生效」，所以整套忽略并如实提示。
    "y_axis": None,
    # 拼接法开关：默认关（单块出图行为不变）。
    "plot_segments": None,
    # 分段布局三参数（R 侧 num() 读取，必须在这里登记否则被当成未知设置拒绝）。
    "seg_left_margin": 0.05,
    "seg_side_min": 0.07,
    "seg_side_cap": 0.35,
}

##: 出图格式只有两种，前后端同一份枚举（用户裁决：jpg + svg；PDF 字体处理麻烦，砍掉）。
#: jpeg = 位图，设备端烘焙好，所见即所得（预览固定用它）；svg = 矢量，适合排版放大。
#: 曾先后支持过 png / jpg / webp / pdf：每多一种就要在前端下拉、RPC 校验、R 设备分支、
#: 文档与测试五处各维护一遍，而用户实际只用得上位图与矢量两种。
SUPPORTED_PLOT_FORMATS = ("jpeg", "png", "svg")

MIME_BY_FORMAT = {
    "jpeg": "image/jpeg",
    "png": "image/png",
    "svg": "image/svg+xml",
}


#: `primary_axis` 的预设合法取值。`calibrate_axes` 校验预设值与合法自定义标识符：
PRIMARY_AXES = ("depth", "age", "code")

#: 「单位里已经写明年代基准」的记号。`primary_axis="age"` 且单位不含其中任何一个时
#: 补 ` BP`（`ka` → `ka BP`）；含了说明用户写完整了，原样用，不再叠加。
ERA_UNIT_MARKERS = ("BP", "AD", "BC", "CE", "BCE")


def _normalize_primary_axis(primary_axis: Any) -> str:
    """把 `primary_axis` 归一成合法轴名（age/depth/code 或合法的自定义标识符）；缺省与脏值一律按 "depth"（空/缺省）。"""
    import re

    axis = str(primary_axis or "").strip().lower()
    if axis.startswith("custom:"):
        axis = axis.split("custom:", 1)[1].strip()
    if axis in PRIMARY_AXES:
        return axis
    if re.match(r"^[a-z][a-z0-9_-]{0,31}$", axis):
        return axis
    return "depth"


def _y_column_label(primary_axis: Any = None, legacy: bool = False) -> str:
    """导出表**首列**的列名：跟随 Y 轴实际测的量，不是永远写 `depth`（issue #114）。

    首列装的是 Y 轴上的那个量，所以它的名字必须与 `primary_axis` 一致：
    `"age"` → `age`，`"depth"` → `depth`，`"code"` → `code`，自定义 → 用户标识符（如 `elev`）。
    只有一列，绝不并列输出两列——两列会让读的人无法判断哪一列才是真的。

    `legacy=True` 强制回 `depth`，给按旧列名读的下游脚本一个过渡口（RPC 参数
    `legacy_column_name`）；它**不改数值**，只改列名。

    这是列名的**唯一来源**：`get_roi_dataframes` 与三个行集构造器都调它。
    """
    if legacy:
        return "depth"
    return _normalize_primary_axis(primary_axis)


def _y_axis_label(primary_axis: Any = None, unit: Any = None) -> str:
    """出图 Y 轴标题：`Depth (cm)` / `Age (ka BP)` / `Sample Code` / `Elev (m)`。

    ## 唯一的补语义点

    `primary_axis="age"` 且单位不含 `BP`/`AD`/`BC`/`CE`/`BCE`（大小写不敏感）时补
    ` BP`：`ka` → `ka BP`。写 `cal BP` / `AD` 这类完整单位的原样用，不再叠加成
    `cal BP BP`。深度轴不补任何东西——`cm` / `m` 本身没有年代基准的歧义。

    单位为空时只给轴名（`Depth` / `Age` / `Sample Code` / `Elev`），不编一个单位。

    这是轴标签的**唯一来源**：`render_strat_diagram` 用它填 `settings["ylabel"]`。
    """
    axis = _normalize_primary_axis(primary_axis)
    if axis == "age":
        title = "Age"
    elif axis == "depth":
        title = "Depth"
    elif axis == "code":
        title = "Sample Code"
    else:
        title = axis.capitalize()

    text = str(unit or "").strip()
    if not text:
        return title
    if axis == "age" and not any(marker in text.upper() for marker in ERA_UNIT_MARKERS):
        text = f"{text} BP"
    return f"{title} ({text})"


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
        raise ValueError(
            "y 轴范围只接受 min / max / interval，未知项：" + ", ".join(unknown)
        )

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
            'plot_scale_mode 需要 {列名: "normalize" | "fixed"}，收到 '
            + type(value).__name__
        )
    out: dict[str, str] = {}
    for raw_col, raw_mode in value.items():
        col = str(raw_col).strip()
        if not col:
            raise ValueError("plot_scale_mode 里有空列名")
        mode = str(raw_mode).strip().lower()
        if mode not in SCALE_MODES:
            raise ValueError(
                f"plot_scale_mode[{col}] 只接受 "
                + " / ".join(SCALE_MODES)
                + f"，收到 {raw_mode!r}"
            )
        out[col] = mode
    return out


def resolve_settings(
    settings: dict[str, Any] | None,
) -> tuple[dict[str, Any], list[str]]:
    """归一化设置，并返回「已经如实告知、但没生效」的提示列表。

    y 轴三格只填了一部分时，这里把它归成 None（整套忽略）并把原因放进 warnings，
    而不是让三个参数里只生效两个。
    """
    merged = dict(DEFAULT_PLOT_SETTINGS)
    warnings: list[str] = []
    if settings:
        # seg_left./seg_right.：拼接法分段标记，键名依赖数据，按前缀放行。
        # plot_type./exag.：逐列形态与逐列夸大外线倍率，按前缀放行。
        unknown = sorted(
            k
            for k in set(settings) - set(DEFAULT_PLOT_SETTINGS)
            if not (
                str(k).startswith("seg_left.")
                or str(k).startswith("seg_right.")
                or str(k).startswith("plot_type.")
                or str(k).startswith("exag.")
            )
        )
        if unknown:
            raise ValueError("未知的出图设置：" + ", ".join(unknown))
        merged.update(settings)
    y_axis, hint = validate_y_axis(merged.get("y_axis"))
    merged["y_axis"] = y_axis
    if hint:
        warnings.append(hint)
    merged["plot_scale_mode"] = validate_plot_scale_mode(merged.get("plot_scale_mode"))
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


#: R 侧脚本。写成纯文本而不是 f-string：里面全是 R 的花括号，任何格式化都会出事。
STRAT_PLOT_SCRIPT = r"""# Generated by straditize: stratigraphic diagram (rioja::strat.plot)
args <- commandArgs(trailingOnly = TRUE)
csv_path <- args[[1]]
out_path <- args[[2]]
settings_path <- args[[3]]

read_settings <- function(path) {
  lines <- readLines(path, warn = FALSE, encoding = "UTF-8")
  lines <- lines[nzchar(lines)]
  if (length(lines) == 0) return(list())
  parts <- strsplit(lines, "\t", fixed = TRUE)
  keys <- vapply(parts, function(p) p[[1]], character(1))
  vals <- vapply(
    parts,
    function(p) if (length(p) > 1) paste(p[-1], collapse = "\t") else "",
    character(1)
  )
  stats::setNames(as.list(vals), keys)
}
s <- read_settings(settings_path)
flag <- function(key, default) {
  v <- s[[key]]
  if (is.null(v) || !nzchar(v)) return(default)
  identical(tolower(v), "true")
}
num <- function(key, default) {
  v <- s[[key]]
  if (is.null(v) || !nzchar(v)) return(default)
  out <- suppressWarnings(as.numeric(v))
  if (is.na(out)) default else out
}
txt <- function(key, default) {
  v <- s[[key]]
  if (is.null(v) || !nzchar(v)) default else v
}

raw <- utils::read.csv(csv_path, check.names = FALSE, na.strings = c("NA", "", "NaN"))
if (ncol(raw) < 2) stop("STRADITIZE_ERROR: 导出的表只有 Y 轴列，没有可画的属种列。")
depth <- suppressWarnings(as.numeric(raw[[1]]))
# Y 轴标题的**兜底值**就是首列的列名。首列名由 Python 侧的 `_y_column_label` 按
# `primary_axis` 给出（`age` / `depth`），所以这里不需要、也不允许再写一个轴名常量：
# `tests/unit/test_y_axis_column_label.py` 断言本脚本里不出现轴名字面量。
y_var_name <- names(raw)[[1]]
# 排除非属种的坐标/元数据列，防止将年代或样本编号作为属种绘制
non_taxa <- tolower(names(raw)) %in% c("age", "age_min", "age_max", "sample_code", "sample_id", "row_px")
taxa_cols <- setdiff(names(raw)[-1], names(raw)[non_taxa])
if (length(taxa_cols) == 0) {
  taxa_cols <- names(raw)[-1]
}
taxa <- raw[, taxa_cols, drop = FALSE]
taxa[] <- lapply(taxa, function(v) suppressWarnings(as.numeric(v)))
usable <- vapply(taxa, function(v) any(is.finite(v)), logical(1))
taxa <- taxa[, usable, drop = FALSE]
if (ncol(taxa) == 0) stop("STRADITIZE_ERROR: 所有属种列都是空的（全 NA），无法出图。")

fmt <- tolower(tools::file_ext(out_path))
W <- num("width_px", 2200)
H <- num("height_px", 1500)
DPI <- num("dpi", 150)

# ---- 中文字体：cairo 设备只认**真实字体名**，R 的 windowsFonts 别名它不认 ----------
CN_FONT_NAMES <- c("SimHei", "Microsoft YaHei", "Noto Sans CJK SC")
CN_FONT_FILES <- c(
  "SimHei" = "simhei.ttf",
  "Microsoft YaHei" = "msyh.ttc",
  "Noto Sans CJK SC" = "NotoSansCJK-Regular.ttc"
)
font_installed <- function(name) {
  if (requireNamespace("systemfonts", quietly = TRUE)) {
    hit <- systemfonts::match_fonts(name)
    return(nzchar(hit$path[[1]]) && file.exists(hit$path[[1]]))
  }
  file_name <- CN_FONT_FILES[[name]]
  if (is.null(file_name)) return(FALSE)
  file.exists(file.path(Sys.getenv("WINDIR", "C:/Windows"), "Fonts", file_name))
}
font_family <- "sans"
font_warnings <- character(0)
if (.Platform$OS.type == "windows") {
  cn_font <- NULL
  for (candidate in CN_FONT_NAMES) {
    if (font_installed(candidate)) { cn_font <- candidate; break }
  }
  if (is.null(cn_font)) {
    stop("STRADITIZE_ERROR: 没找到可用的中文字体（试过 ", paste(CN_FONT_NAMES, collapse = " / "),
         "）：请安装其中任一款后重试 —— 静默回退 sans 会把中文标签画成方框。")
  }
  grDevices::windowsFonts(straditize = grDevices::windowsFont(cn_font))
  font_family <- cn_font
} else if (requireNamespace("sysfonts", quietly = TRUE) && requireNamespace("systemfonts", quietly = TRUE)) {
  for (candidate in CN_FONT_NAMES) {
    hit <- systemfonts::match_fonts(candidate)
    if (nzchar(hit$path[[1]]) && file.exists(hit$path[[1]])) {
      sysfonts::font_add("straditize", regular = hit$path[[1]])
      font_family <- "straditize"
      break
    }
  }
  if (font_family == "sans") {
    font_warnings <- c(font_warnings, paste0(
      "非 Windows 且没找到中文字体（sysfonts / systemfonts）：",
      "标签可能显示为方框。装 Noto Sans CJK 或 SimHei 后重试。"
    ))
  }
} else {
  font_warnings <- c(font_warnings, paste0(
    "非 Windows 且缺少 sysfonts/systemfonts 包：中文字体未注册，标签可能显示为方框。"
  ))
}

open_device <- function() {
  if (fmt == "jpeg") {
    grDevices::jpeg(out_path, width = W, height = H, res = DPI, quality = 95,
                    type = "cairo", family = font_family)
  } else if (fmt == "png") {
    grDevices::png(out_path, width = W, height = H, res = DPI,
                   type = "cairo", family = font_family)
  } else if (fmt == "svg") {
    grDevices::svg(out_path, width = W / DPI, height = H / DPI, family = font_family)
  } else {
    stop("STRADITIZE_ERROR: 不支持的输出格式 ", fmt, "（支持 jpeg/png/svg）")
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

if (!requireNamespace("rioja", quietly = TRUE)) {
  stop("STRADITIZE_ERROR: 本机未安装 rioja。出图只支持 rioja::strat.plot，",
       "请先执行 install.packages(\"rioja\") 后重试。")
}
engine <- "rioja"

ymin_v <- num("y_min", NA_real_)
ymax_v <- num("y_max", NA_real_)
yint_v <- num("y_interval", NA_real_)

open_device()
warns <- tryCatch(
  collect_warnings({
    ylabel_text <- txt("ylabel", y_var_name)
    title_text <- txt("title", "")
    ylim_v <- range(depth, na.rm = TRUE)
    ytks_v <- NULL
    if (is.finite(ymin_v) && is.finite(ymax_v)) {
      ylim_v <- c(ymin_v, ymax_v)
      if (is.finite(yint_v) && yint_v > 0) {
        ytks_v <- seq(ymin_v, ymax_v, by = yint_v)
      }
    }
    ylabs <- if (!is.null(ytks_v)) as.character(ytks_v) else as.character(pretty(ylim_v, n = 10))

    # 长标签折行 + 斜体（纯 Base R 预处理后交给 x.names）
    x_labels <- colnames(taxa)
    if (flag("break_long", TRUE)) {
      bn <- max(1L, as.integer(num("break_n", 20)))
      x_labels <- vapply(
        x_labels,
        function(lbl) paste(strwrap(lbl, width = bn), collapse = "\n"),
        character(1)
      )
    }
    if (flag("italicise", TRUE)) {
      x_labels <- as.expression(lapply(x_labels, function(lbl) bquote(italic(.(lbl)))))
    }
    names(x_labels) <- colnames(taxa)

    cex_xl <- 0.7
    cex_yl <- 0.9
    cex_ya <- 0.7
    cex_xa <- 0.6
    srt_xl <- num("label_rotate", 45)

    # 自适应画布边距防裁切（基于 strwidth 测量，严格单页）
    graphics::plot.new()
    fin <- graphics::par("fin")
    plot_ratio <- fin[1] / fin[2]
    mx_y <- max(vapply(ylabs, function(x) graphics::strwidth(x, units = "figure", cex = cex_ya), numeric(1)))
    lbl_h <- graphics::strheight(if (nzchar(ylabel_text)) ylabel_text else "Y", units = "figure", cex = cex_yl)
    x_left <- min(0.28, max(num("seg_left_margin", 0.05), mx_y + lbl_h * 2.5 + 0.02, 0.08))

    maxlen_x <- max(vapply(seq_along(x_labels), function(i) graphics::strwidth(x_labels[i], units = "figure", cex = cex_xl), numeric(1)))
    ang_rad <- pi / 180 * (90 - srt_xl)
    if (srt_xl > 0) {
      y_top <- 1 - (maxlen_x * plot_ratio * cos(ang_rad)) - graphics::strwidth("m", units = "figure", cex = cex_xl) - 0.04
    } else {
      maxh_x <- max(vapply(seq_along(x_labels), function(i) graphics::strheight(x_labels[i], units = "figure", cex = cex_xl), numeric(1)))
      y_top <- 1 - maxh_x - 0.05
    }
    if (nzchar(title_text)) y_top <- min(y_top, 0.86)
    y_top <- min(0.90, max(0.55, y_top))
    y_bottom <- 0.07

    # 量程模式：normalize（百分比比例缩放）vs fixed（自身 min..max 等宽）
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

    # 逐列形态：rioja::strat.plot 的 plot.poly/bar/line/symb 为标量，按连续同形态切片并用 add = TRUE 拼接
    poly_v <- stats::setNames(rep(flag("silhouette", TRUE), ncol(taxa)), colnames(taxa))
    bar_v <- stats::setNames(rep(flag("bar", TRUE), ncol(taxa)), colnames(taxa))
    line_v <- stats::setNames(rep(flag("line", TRUE), ncol(taxa)), colnames(taxa))
    symb_v <- stats::setNames(rep(FALSE, ncol(taxa)), colnames(taxa))
    for (.ptype_col in colnames(taxa)) {
      .ptype_key <- paste0("plot_type.", .ptype_col)
      if (is.null(s[[.ptype_key]])) next
      .ptype_val <- tolower(as.character(s[[.ptype_key]]))
      poly_v[[.ptype_col]] <- identical(.ptype_val, "area")
      bar_v[[.ptype_col]] <- .ptype_val %in% c("area", "bar")
      line_v[[.ptype_col]] <- .ptype_val %in% c("area", "line")
      symb_v[[.ptype_col]] <- identical(.ptype_val, "symbol")
    }

    # 逐列夸大（rioja::strat.plot 原生支持向量 exag）
    exag_keys <- names(s)[startsWith(names(s), "exag.")]
    if (length(exag_keys) > 0) {
      exag_taxa <- substring(exag_keys, nchar("exag.") + 1)
      exag_v <- stats::setNames(colnames(taxa) %in% exag_taxa, colnames(taxa))
    } else {
      exag_v <- stats::setNames(rep(flag("exaggeration", FALSE), ncol(taxa)), colnames(taxa))
    }

    seg_parse <- function(pre) {
      keys <- names(s)[startsWith(names(s), pre)]
      if (!length(keys)) return(list())
      parts <- strsplit(substring(keys, nchar(pre) + 1L), ".", fixed = TRUE)
      gid <- vapply(parts, `[[`, character(1), 1)
      col <- vapply(parts, function(p) paste(p[-1], collapse = "."), character(1))
      split(col, factor(gid, levels = unique(gid)))
    }
    left_grp <- seg_parse("seg_left.")
    right_grp <- seg_parse("seg_right.")
    side_grp <- c(left_grp, right_grp)

    macro_segs <- list()
    if (length(side_grp) > 0) {
      pct_cols <- setdiff(colnames(taxa), unlist(side_grp, use.names = FALSE))
      raw_segs <- if (length(pct_cols) > 0) {
        append(side_grp, list(pct_cols), after = length(left_grp))
      } else {
        side_grp
      }
      for (cols in raw_segs) {
        cols <- intersect(cols, colnames(taxa))
        if (!length(cols)) next
        is_pct_seg <- (length(pct_cols) > 0 && identical(cols, pct_cols)) && flag("percent", TRUE)
        macro_segs[[length(macro_segs) + 1L]] <- list(cols = cols, is_pct = is_pct_seg)
      }
    } else if (!flag("percent", TRUE) || all(is_fixed)) {
      macro_segs <- list(list(cols = colnames(taxa), is_pct = FALSE))
    } else if (!any(is_fixed)) {
      macro_segs <- list(list(cols = colnames(taxa), is_pct = TRUE))
    } else {
      runs <- rle(!unname(is_fixed))
      pos_i <- 1L
      for (r_idx in seq_along(runs$lengths)) {
        len_r <- runs$lengths[[r_idx]]
        cols <- colnames(taxa)[pos_i:(pos_i + len_r - 1L)]
        macro_segs[[length(macro_segs) + 1L]] <- list(cols = cols, is_pct = runs$values[[r_idx]])
        pos_i <- pos_i + len_r
      }
    }

    last_col <- macro_segs[[length(macro_segs)]]$cols
    last_name <- last_col[[length(last_col)]]
    last_w <- graphics::strwidth(x_labels[last_name], units = "figure", cex = cex_xl) * sin(ang_rad)
    x_right <- min(0.98, max(0.80, 1 - max(0.02, last_w * 0.6)))

    # 计算每列在 rioja::strat.plot 中的宽度权重（% 列按 5 向上取整 max，fixed 列等宽=1）
    col_w <- stats::setNames(rep(1, ncol(taxa)), colnames(taxa))
    for (m in macro_segs) {
      if (m$is_pct) {
        cm <- apply(taxa[, m$cols, drop = FALSE], 2, max, na.rm = TRUE)
        cm[!is.finite(cm) | cm <= 0] <- 0
        cm <- floor((cm + 5) / 5) * 5
        cm[cm < 5] <- 5
        col_w[m$cols] <- cm
      }
    }

    sp <- num("x_space", 0.01)
    xgap <- 0.015
    n_total <- sum(vapply(macro_segs, function(m) length(m$cols), integer(1)))
    n_gaps <- max(0L, length(macro_segs) - 1L)
    avail <- max(0.2, x_right - x_left - (n_total + 2L) * sp - n_gaps * xgap)

    is_pct_seg_v <- vapply(macro_segs, function(m) m$is_pct, logical(1))
    if (any(is_pct_seg_v) && any(!is_pct_seg_v)) {
      pct_all <- unlist(lapply(macro_segs[is_pct_seg_v], `[[`, "cols"), use.names = FALSE)
      cmax_pct <- col_w[pct_all]
      r_w <- mean(cmax_pct) / sum(cmax_pct)
      n_side <- sum(!is_pct_seg_v)
      f_side <- min(max(r_w / (1 + n_side * r_w) * avail, num("seg_side_min", 0.07)),
                    num("seg_side_cap", 0.35) / n_side * avail)
      f_pct_total <- max(0.1, avail - n_side * f_side)
      w_pct_sum <- sum(cmax_pct)
      for (mi in seq_along(macro_segs)) {
        if (macro_segs[[mi]]$is_pct) {
          macro_segs[[mi]]$width <- f_pct_total * sum(col_w[macro_segs[[mi]]$cols]) / w_pct_sum
        } else {
          macro_segs[[mi]]$width <- f_side
        }
      }
    } else if (any(is_pct_seg_v)) {
      w_sum <- sum(vapply(macro_segs, function(m) sum(col_w[m$cols]), numeric(1)))
      for (mi in seq_along(macro_segs)) {
        macro_segs[[mi]]$width <- avail * sum(col_w[macro_segs[[mi]]$cols]) / w_sum
      }
    } else {
      for (mi in seq_along(macro_segs)) {
        macro_segs[[mi]]$width <- avail * length(macro_segs[[mi]]$cols) / n_total
      }
    }

    # 在每个宏段内部按连续同形态切分最小切片，并用标准 rioja::strat.plot(..., add = TRUE) 绘制
    slices <- list()
    for (mi in seq_along(macro_segs)) {
      m <- macro_segs[[mi]]
      m_cols <- m$cols
      m_w_sum <- sum(col_w[m_cols])
      sigs <- vapply(
        m_cols,
        function(cn) paste(poly_v[[cn]], bar_v[[cn]], line_v[[cn]], symb_v[[cn]], sep = "_"),
        character(1)
      )
      runs <- rle(unname(sigs))
      pos_i <- 1L
      for (ri in seq_along(runs$lengths)) {
        len_r <- runs$lengths[[ri]]
        s_cols <- m_cols[pos_i:(pos_i + len_r - 1L)]
        c1 <- s_cols[[1]]
        slices[[length(slices) + 1L]] <- list(
          cols = s_cols,
          is_pct = m$is_pct,
          width = m$width * sum(col_w[s_cols]) / m_w_sum,
          gap = (mi > 1L && ri == 1L),
          poly = poly_v[[c1]],
          bar = bar_v[[c1]],
          line = line_v[[c1]],
          symb = symb_v[[c1]]
        )
        pos_i <- pos_i + len_r
      }
    }

    graphics::par(lwd = num("axis_lwd", 2))
    cur_x <- x_left
    for (idx in seq_along(slices)) {
      sl <- slices[[idx]]
      if (isTRUE(sl$gap)) cur_x <- cur_x + xgap
      k <- length(sl$cols)
      xr_s <- min(1.0, cur_x + sl$width + (k + 1L) * sp)
      d_sl <- taxa[, sl$cols, drop = FALSE]
      mm <- NULL
      if (!sl$is_pct) {
        mins <- pmin(0, apply(d_sl, 2, min, na.rm = TRUE))
        maxs <- apply(d_sl, 2, max, na.rm = TRUE)
        mins[!is.finite(mins)] <- 0
        maxs[!is.finite(maxs)] <- 1
        bad <- maxs <= mins
        maxs[bad] <- mins[bad] + 1
        mm <- cbind(mins, maxs)
      }
      rioja::strat.plot(
        d = d_sl,
        yvar = depth,
        scale.percent = sl$is_pct,
        scale.minmax = !sl$is_pct,
        minmax = mm,
        xLeft = cur_x,
        xRight = xr_s,
        yBottom = y_bottom,
        yTop = y_top,
        y.axis = (idx == 1L),
        x.axis = flag("axis", TRUE),
        y.rev = flag("rev_y", TRUE),
        ylim = ylim_v,
        y.tks = ytks_v,
        ylabel = if (idx == 1L) ylabel_text else "",
        title = if (idx == 1L) title_text else "",
        cex.yaxis = cex_ya,
        cex.ylabel = cex_yl,
        cex.axis = cex_xa,
        cex.xlabel = cex_xl,
        srt.xlabel = srt_xl,
        x.names = x_labels[sl$cols],
        xSpace = sp,
        plot.poly = sl$poly,
        plot.bar = sl$bar,
        plot.line = sl$line,
        plot.symb = sl$symb,
        col.poly = "darkgreen",
        col.bar = "grey",
        col.line = "black",
        col.symb = "black",
        symb.cex = 0.7,
        lwd.bar = 0.5,
        lwd.line = 1,
        exag = unname(exag_v[sl$cols]),
        exag.mult = num("exag_mult", 5),
        col.exag = "#cce0cc",
        add = TRUE
      )
      cur_x <- cur_x + sl$width + (if (idx == 1L) (k + 1L) else k) * sp
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
for (w in unique(c(font_warnings, warns))) {
  cat(sprintf("STRADITIZE_WARN\t%s\n", gsub("[\r\n]+", " ", w)))
}
"""


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
    primary_axis: Any = None,
    unit: Any = None,
    timeout: float = 180.0,
) -> dict[str, Any]:
    """跑 R 出图；失败抛 RuntimeError（消息里带 R 自己的 stderr）。

    `primary_axis` / `unit` 只用于派生 Y 轴标题：用户没在 `settings` 里显式给
    `ylabel` 时，用 `_y_axis_label(primary_axis, unit)` 填进去（issue #114）。
    显式给了 `ylabel` 就尊重用户，不做「按轴改写」。
    """
    merged = normalize_settings(settings)
    if not str(merged.get("ylabel") or "").strip():
        merged["ylabel"] = _y_axis_label(primary_axis, unit)
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    settings_path = out.with_name(out.name + ".settings.tsv")
    settings_path.write_text(_settings_tsv(merged), encoding="utf-8")
    script_path = out.with_name(out.stem + ".R")
    script_path.write_text(STRAT_PLOT_SCRIPT, encoding="utf-8")

    try:
        proc = subprocess.run(
            [
                rscript,
                str(script_path),
                str(Path(csv_path)),
                str(out),
                str(settings_path),
            ],
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
        raise RuntimeError(
            f"R 出图失败（返回码 {proc.returncode}）：{stderr or '没有错误输出'}"
        )

    engine, warnings = _parse_stdout(proc.stdout)

    return {
        "path": str(out.resolve()),
        "r_script": str(script_path.resolve()),
        "size_bytes": out.stat().st_size,
        "engine": engine or "rioja",
        "warnings": warnings,
        "settings": merged,
        "rscript": rscript,
        "command": [
            rscript,
            str(script_path),
            str(Path(csv_path)),
            str(out),
            str(settings_path),
        ],
    }


def read_as_data_url(path: str, fmt: str) -> tuple[str, str]:
    """把产物读成 data URL；前端直接塞 <img src>，不必再要一个下载端点。"""
    data = Path(path).read_bytes()
    mime = MIME_BY_FORMAT.get(fmt.lower(), "application/octet-stream")
    return mime, "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")
