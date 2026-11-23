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
from typing import Any

#: 默认出图设置：对齐 riojaPlot shiny 的常用组合（Silhouette % + show bar + Exaggeration
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
    # 轴与标签字号倍率：riojaPlot 默认（cex.xlabel 0.9 / yaxis 0.7 / xaxis 0.6 /
    # ylabel 0.9）在 2200px 宽的成品图上偏小，缩到屏幕上看不清；默认放大 2 倍。
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

#: 只有 riojaPlot 才有的开关；回退到 rioja 时这些不生效，必须报告。
RIOJAPLOT_ONLY_KEYS = (
    "italicise",
    "break_long",
    "break_n",
    "minmax",
    "plot_scale_mode",
    "label_rotate",
)

#: 出图格式只有两种，前后端同一份枚举（用户裁决：jpg + svg；PDF 字体处理麻烦，砍掉）。
#: jpeg = 位图，设备端烘焙好，所见即所得（预览固定用它）；svg = 矢量，适合排版放大。
#: 曾先后支持过 png / jpg / webp / pdf：每多一种就要在前端下拉、RPC 校验、R 设备分支、
#: 文档与测试五处各维护一遍，而用户实际只用得上位图与矢量两种。
SUPPORTED_PLOT_FORMATS = ("jpeg", "svg")

MIME_BY_FORMAT = {
    "jpeg": "image/jpeg",
    "svg": "image/svg+xml",
}


#: `primary_axis` 的两个合法取值。`calibrate_axes` 已经拒绝其它值，这里是第二道口：
#: 直接构造出来的会话（测试、CLI、导入）可能没有该属性或带着脏值。
PRIMARY_AXES = ("depth", "age")

#: 「单位里已经写明年代基准」的记号。`primary_axis="age"` 且单位不含其中任何一个时
#: 补 ` BP`（`ka` → `ka BP`）；含了说明用户写完整了，原样用，不再叠加。
ERA_UNIT_MARKERS = ("BP", "AD", "BC", "CE", "BCE")


def _normalize_primary_axis(primary_axis: Any) -> str:
    """把 `primary_axis` 归一成 `"depth"` / `"age"`；缺省与脏值一律按 `"depth"`。"""
    axis = str(primary_axis or "").strip().lower()
    return axis if axis in PRIMARY_AXES else "depth"


def _y_column_label(primary_axis: Any = None, legacy: bool = False) -> str:
    """导出表**首列**的列名：跟随 Y 轴实际测的量，不是永远写 `depth`（issue #114）。

    首列装的是 Y 轴上的那个量，所以它的名字必须与 `primary_axis` 一致：
    `"age"` → `age`，`"depth"` → `depth`。只有一列，绝不并列输出两列——两列会让
    读的人无法判断哪一列才是真的。

    `legacy=True` 强制回 `depth`，给按旧列名读的下游脚本一个过渡口（RPC 参数
    `legacy_column_name`）；它**不改数值**，只改列名。

    这是列名的**唯一来源**：`get_roi_dataframes` 与三个行集构造器都调它。
    """
    if legacy:
        return "depth"
    return _normalize_primary_axis(primary_axis)


def _y_axis_label(primary_axis: Any = None, unit: Any = None) -> str:
    """出图 Y 轴标题：`Depth (cm)` / `Age (ka BP)` / `Age (cal BP)`。

    ## 唯一的补语义点

    `primary_axis="age"` 且单位不含 `BP`/`AD`/`BC`/`CE`/`BCE`（大小写不敏感）时补
    ` BP`：`ka` → `ka BP`。写 `cal BP` / `AD` 这类完整单位的原样用，不再叠加成
    `cal BP BP`。深度轴不补任何东西——`cm` / `m` 本身没有年代基准的歧义。

    单位为空时只给轴名（`Depth` / `Age`），不编一个单位。

    这是轴标签的**唯一来源**：`render_strat_diagram` 用它填 `settings["ylabel"]`。
    """
    axis = _normalize_primary_axis(primary_axis)
    title = "Age" if axis == "age" else "Depth"
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
STRAT_PLOT_SCRIPT = r"""# Generated by straditize: stratigraphic diagram (riojaPlot preferred, rioja fallback)
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
taxa <- raw[, -1, drop = FALSE]
taxa[] <- lapply(taxa, function(v) suppressWarnings(as.numeric(v)))
usable <- vapply(taxa, function(v) any(is.finite(v)), logical(1))
taxa <- taxa[, usable, drop = FALSE]
if (ncol(taxa) == 0) stop("STRADITIZE_ERROR: 所有属种列都是空的（全 NA），无法出图。")

fmt <- tolower(tools::file_ext(out_path))
W <- num("width_px", 2200)
H <- num("height_px", 1500)
DPI <- num("dpi", 150)

# ---- 中文字体：cairo 设备只认**真实字体名**，R 的 windowsFonts 别名它不认 ----------
# 用户的写法是 windowsFonts(straditize = windowsFont("SimHei")) 再 family = "straditize"。
# 实测（本机 R 4.x + cairo）：别名在 jpeg()/svg() 里**不生效** —— family = "straditize"
# 的产物与 family = "sans" 逐字节相同（同尺寸 996 个暗像素），中文全成方框；
# 直接传真实字体名 family = "SimHei" 才有字（7528 个暗像素，SVG 813B → 9.3KB 的字形轮廓）。
# 所以两件事都做：注册别名（pdf/postscript 那类设备认它），并记住真实名给 cairo 用。
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
  } else if (fmt == "svg") {
    # 尺寸与 jpeg 同口径：像素 / dpi = 英寸（2200/150 × 1500/150 = 14.67in × 10in）。
    grDevices::svg(out_path, width = W / DPI, height = H / DPI, family = font_family)
  } else {
    stop("STRADITIZE_ERROR: 不支持的输出格式 ", fmt, "（支持 jpeg/svg）")
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
par(lwd = num("axis_lwd", 4))
warns <- tryCatch(
  collect_warnings({
    if (use_riojaplot) {
      # 参数与用户实测脚本一致：riojaPlot 默认 + 这 5 项 —— 字号不再放大，标签不重叠。
      style <- riojaPlot::makeStyles(
        cex.xlabel = 0.7,
        srt.xlabel = 45,
        labels.break.n = 25,
        cex.yaxis = 0.7,
        symb.cex = 0.3,
        plot.poly = TRUE   # makeStyles 默认 poly=FALSE，我们的图要填充
      )
      style$plot.exag <- flag("exaggeration", TRUE)
      style$exag.mult <- num("exag_mult", 5)
      style$scale.percent <- flag("percent", TRUE)
      # 每列是否参与「默认缩放」：settings 里 scale_mode.<列名><TAB>normalize|fixed。
      # normalize = 与 rioja 的 scale.percent 一致：各列按最大值比例分配宽度（优势种宽、微量种窄，共享统一百分比比例尺）。
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
      # 分段模式下每段自己带 minmax，这里的「整表 minmax」会与段内子集冲突
      # （实测：`number of rows of minmax should equal number of curves`）。
      # 所以有段时不走这条预处理 —— 段内的 minmax 才是权威。
      .has_segments <- length(names(s)[startsWith(names(s), 'seg_left.')]) > 0 ||
        length(names(s)[startsWith(names(s), 'seg_right.')]) > 0
      if (any(is_fixed) && !.has_segments) {
        # riojaPlot 里 scale.percent 与 scale.minmax 走 if/else，是互斥的：
        # 要 Min/max 就必须关百分比刻度，否则 Min/max 会被静默忽略。
        style$scale.percent <- FALSE
        style$scale.minmax <- TRUE
        # riojaPlot 走 minmax 时按每列的 (min,max) 定 xlim。为了让 normalize 列与
        # scale.percent 下的观感完全一致（0-100 轴、每列画满宽），先把这些列按**本列
        # 最大值**缩到 0-100 —— 这正是 rioja 内部 scale.percent 干的事（每列除以本列 max）。
        col_max <- apply(taxa, 2, function(v) max(v, na.rm = TRUE))
        col_max[!is.finite(col_max) | col_max <= 0] <- 1
        pct_names <- colnames(taxa)[!is_fixed]
        if (length(pct_names) > 0) {
          taxa[, pct_names] <- sweep(taxa[, pct_names, drop = FALSE], 2, col_max[pct_names], "/") * 100
        }
        mins <- apply(taxa, 2, function(v) min(v, na.rm = TRUE))
        maxs <- apply(taxa, 2, function(v) max(v, na.rm = TRUE))
        # normalize 列统一到 0-100（已按本列最大值缩放），fixed 列保留自身量程。
        mins[!is_fixed] <- 0
        maxs[!is_fixed] <- 100
        style$minmax <- cbind(mins, maxs)
      }
      # 把 y 列命名成用户要的轴标题：riojaPlot 用 yvar.name 选列，同时把它当轴标签。
      y_df <- data.frame(depth)
      names(y_df) <- txt("ylabel", y_var_name)
      # 逐列形态：settings 里 plot_type.<列名> = area|bar|line|symbol。
      # riojaPlot 的 plot.poly/bar/line/symb 都是**按列索引取标量**（.riojaPlot2:401 `plot.line[i]`），
      # 所以传逻辑向量就逐列生效。缺 key 的列退回全局开关 —— 老脚本（无 plot_type.* ）字节不变。
      poly_v <- stats::setNames(rep(flag('silhouette', TRUE), ncol(taxa)), colnames(taxa))
      bar_v <- stats::setNames(rep(flag('bar', TRUE), ncol(taxa)), colnames(taxa))
      line_v <- stats::setNames(rep(flag('line', TRUE), ncol(taxa)), colnames(taxa))
      symb_v <- stats::setNames(rep(FALSE, ncol(taxa)), colnames(taxa))
      for (.ptype_col in colnames(taxa)) {
        .ptype_key <- paste0('plot_type.', .ptype_col)
        if (is.null(s[[.ptype_key]])) next
        .ptype_val <- tolower(as.character(s[[.ptype_key]]))
        poly_v[[.ptype_col]] <- identical(.ptype_val, 'area')
        bar_v[[.ptype_col]] <- .ptype_val %in% c('area', 'bar')
        line_v[[.ptype_col]] <- .ptype_val %in% c('area', 'line')
        symb_v[[.ptype_col]] <- identical(.ptype_val, 'symbol')
      }
      # 逐列夸大：settings 里 exag.<列名> = 5.0。仅对标记了夸大的列绘制外线。
      exag_keys <- names(s)[startsWith(names(s), 'exag.')]
      if (length(exag_keys) > 0) {
        exag_taxa <- substring(exag_keys, nchar('exag.') + 1)
        exag_v <- stats::setNames(colnames(taxa) %in% exag_taxa, colnames(taxa))
      } else {
        exag_v <- stats::setNames(rep(flag('exaggeration', FALSE), ncol(taxa)), colnames(taxa))
      }
      style$plot.exag <- unname(exag_v)
      style$exag.mult <- num("exag_mult", 5)
      seg_parse <- function(pre) {
        keys <- names(s)[startsWith(names(s), pre)]
        if (!length(keys)) return(list())
        parts <- strsplit(substring(keys, nchar(pre) + 1L), '.', fixed = TRUE)
        gid <- vapply(parts, `[[`, character(1), 1)
        col <- vapply(parts, function(p) paste(p[-1], collapse = '.'), character(1))
        split(col, factor(gid, levels = unique(gid)))
      }
      left_grp <- seg_parse('seg_left.')
      right_grp <- seg_parse('seg_right.')
      side_grp <- c(left_grp, right_grp)
      if (length(side_grp) > 0) {
        pct_cols <- setdiff(colnames(taxa), unlist(side_grp, use.names = FALSE))
        n_side <- length(side_grp)
        # 左边距：riojaPlot 的默认 xLeft 由 y 轴标签宽度决定（约 0.15）。
        # 我们自己按数值排布时必须留出这块，否则首段宽度为负 → "Too many variables"。
        seg_m <- num('seg_left_margin', 0.05)
        seg_r <- 0.99
        avail <- max(0.2, seg_r - seg_m)
        # 情景 C（没有 % 块，全是 fixed 列）：**列等宽**。
        # rioja 的面板宽度 ∝ colM = max(列) × graph.widths，把 graph.widths 设成 1/max
        # 就抵消掉量纲差异（刻度仍按各自 0..max 标）。有 % 块时保持默认（∝ max）。
        gw_all <- stats::setNames(rep(1, ncol(taxa)), colnames(taxa))
        if (length(pct_cols) == 0) {
          cmax_all <- apply(taxa, 2, function(v) max(v, na.rm = TRUE))
          cmax_all[!is.finite(cmax_all) | cmax_all <= 0] <- 1
          gw_all <- 1 / cmax_all
          # riojaPlot 只在**没有** `riojaPlot=` 的首次调用里读 style；段宽
          # 因此要写进 style（后续段从 rp 继承），只当直接参数传会被忽略。
          style$graph.widths <- unname(gw_all)
        }
        if (length(pct_cols) > 0) {
          cmax <- apply(taxa[, pct_cols, drop = FALSE], 2, max, na.rm = TRUE)
          cmax[!is.finite(cmax) | cmax <= 0] <- 1  # 全 NA 列 max 是 -Inf，会让段宽变 NA
          # 非 % 段宽 = 一个「平均 % 列」的宽度（用 max 会让它比多数列胖一圈）。
          r_w <- mean(cmax) / sum(cmax)
          f_side <- min(max(r_w / (1 + n_side * r_w) * avail, num('seg_side_min', 0.07)), num('seg_side_cap', 0.35) / n_side * avail)
          f_pct <- avail - n_side * f_side
          segs <- append(side_grp, list(pct_cols), after = length(left_grp))
        } else {
          # 情景 C：全是 fixed 列，没有 % 块 —— 侧段平分可用宽度，循环里没有 pct 段。
          f_side <- avail / n_side
          f_pct <- 0
          segs <- side_grp
        }
        rp <- NULL
        xr <- seg_m
        for (k in seq_along(segs)) {
          cols <- segs[[k]]
          is_pct <- identical(cols, pct_cols)
          x0 <- xr
          xr <- xr + if (is_pct) f_pct else f_side
          if (is.null(rp)) {
            rp <- riojaPlot::riojaPlot(taxa[, cols, drop = FALSE], y_df, style = style,
                                       yvar.name = names(y_df)[1], xLeft = x0, xRight = xr,
                                       graph.widths = gw_all[cols],
                                       scale.percent = is_pct,
                                       scale.minmax = FALSE,
                                       minmax = cbind(0, apply(taxa[, cols, drop = FALSE], 2, max, na.rm = TRUE)),
                                       plot.poly = poly_v[cols], plot.bar = bar_v[cols],
                                       plot.line = line_v[cols], plot.symb = symb_v[cols],
                                       plot.exag = exag_v[cols],
                                       exag.mult = num("exag_mult", 5))
          } else {
            rp <- riojaPlot::riojaPlot(taxa[, cols, drop = FALSE], y_df,
                                       yvar.name = names(y_df)[1], riojaPlot = rp,
                                       xGap = 0.01, xLeft = x0, xRight = xr,
                                       xSpace = num('x_space', 0.01),
                                       graph.widths = gw_all[cols],
                                       scale.percent = is_pct,
                                       scale.minmax = FALSE,
                                       minmax = cbind(0, apply(taxa[, cols, drop = FALSE], 2, max, na.rm = TRUE)),
                                       plot.poly = poly_v[cols], plot.bar = bar_v[cols],
                                       plot.line = line_v[cols], plot.symb = symb_v[cols],
                                       plot.exag = exag_v[cols],
                                       exag.mult = num("exag_mult", 5))
          }
        }
      } else {
        riojaPlot::riojaPlot(x = taxa, y = y_df, style = style,
                             yvar.name = names(y_df)[1],
                             plot.poly = poly_v, plot.bar = bar_v,
                             plot.line = line_v, plot.symb = symb_v,
                             plot.exag = exag_v,
                             exag.mult = num("exag_mult", 5))
      }
    } else {
      rioja::strat.plot(
        d = as.matrix(taxa),
        yvar = depth,
        y.rev = flag("rev_y", TRUE),
        ylabel = txt("ylabel", y_var_name),
        plot.poly = poly_v,
        plot.bar = bar_v,
        plot.line = line_v,
        plot.symb = symb_v,
        plot.exag = exag_v,
        exag.mult = num("exag_mult", 5),
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
    unsupported: list[str] = []
    if engine == "rioja":
        unsupported = [
            k for k in RIOJAPLOT_ONLY_KEYS if merged.get(k) not in (False, None, "", 0)
        ]
        if unsupported:
            warnings = warnings + [
                "本机只装了 rioja（没有 riojaPlot）：Italicise / Break long / "
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
