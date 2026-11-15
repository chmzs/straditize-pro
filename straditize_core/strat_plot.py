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
    "exag_mult": 3.0,
    "exag_alpha": 0.15,
    "minmax": False,
    "italicise": True,
    "break_long": True,
    "break_n": 20,
    "label_rotate": 45,
    # 轴与标签字号倍率：riojaPlot 默认（cex.xlabel 0.9 / yaxis 0.7 / xaxis 0.6 /
    # ylabel 0.9）在 2200px 宽的成品图上偏小，缩到屏幕上看不清；默认放大 2 倍。
    "font_scale": 2.0,
    "axis": True,
    "ylabel": "Depth",
    "title": "",
    "width_px": 2200,
    "height_px": 1500,
    "dpi": 150,
    # y 轴范围三格（min / max / interval）。None = 自动（数据范围 + pretty 刻度）。
    # 三格必须同时给：只给一部分会「半生效」，所以整套忽略并如实提示。
    "y_axis": None,
}

#: 只有 riojaPlot 才有的开关；回退到 rioja 时这些不生效，必须报告。
RIOJAPLOT_ONLY_KEYS = ("italicise", "break_long", "break_n", "exaggeration", "exag_mult", "exag_alpha", "minmax", "label_rotate")

SUPPORTED_PLOT_FORMATS = ("jpeg", "jpg", "png", "webp", "pdf", "svg")

#: webp 不是 R 的图形设备（webp 包只读写、不画图）：先出 PNG，再用 Pillow 转码。
PNG_TRANSCODE_FORMATS = ("webp",)

MIME_BY_FORMAT = {
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "pdf": "application/pdf",
    "svg": "image/svg+xml",
    "webp": "image/webp",
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
        if isinstance(value, bool):
            text = "true" if value else "false"
        elif isinstance(value, (int, float)):
            text = repr(float(value)) if isinstance(value, float) else str(value)
        else:
            text = str(value).replace("\t", " ").replace("\r", " ").replace("\n", " ")
        lines.append(key + "\t" + text)
    return "\n".join(lines) + "\n"


#: R 侧脚本。写成纯文本而不是 f-string：里面全是 R 的花括号，任何格式化都会出事。
STRAT_PLOT_SCRIPT = r'''# Generated by straditize: stratigraphic diagram (riojaPlot preferred, rioja fallback)
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
DPI <- num("dpi", 150)

open_device <- function() {
  if (fmt %in% c("jpeg", "jpg")) {
    grDevices::jpeg(out_path, width = W, height = H, res = DPI, quality = 95, type = "cairo")
  } else if (fmt == "png") {
    grDevices::png(out_path, width = W, height = H, res = DPI, type = "cairo")
  } else if (fmt == "svg") {
    grDevices::svg(out_path, width = W / DPI, height = H / DPI)
  } else if (fmt == "pdf") {
    grDevices::pdf(out_path, width = W / DPI, height = H / DPI)
  } else {
    stop("STRADITIZE_ERROR: 不支持的输出格式 ", fmt, "（支持 jpeg/png/pdf/svg）")
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
        tcl = num("tcl", -0.3),
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
        yBottom = num("y_bottom", 0.08),
        # ylabPos 不覆盖：留空让 riojaPlot 按刻度实际宽度自己算。
        # 列名角度 +45°（逆时针上倾）+ 斜体；y.rev 时列名画在图顶，
        # 不再强制居中——居中会把长属种名挤到邻列上。
        centre.xlabel = FALSE
      )
      if (flag("minmax", FALSE)) {
        # riojaPlot 里 scale.percent 与 scale.minmax 走 if/else，是互斥的：
        # 要 Min/max 就必须关百分比刻度，否则 Min/max 会被静默忽略。
        style$scale.percent <- FALSE
        style$scale.minmax <- TRUE
        mins <- apply(taxa, 2, function(v) min(v, na.rm = TRUE))
        maxs <- apply(taxa, 2, function(v) max(v, na.rm = TRUE))
        style$minmax <- cbind(mins, maxs)
      }
      # 把 y 列命名成用户要的轴标题：riojaPlot 用 yvar.name 选列，同时把它当轴标签。
      y_df <- data.frame(depth)
      names(y_df) <- txt("ylabel", "Depth")
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
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    settings_path = out.with_name(out.name + ".settings.tsv")
    settings_path.write_text(_settings_tsv(merged), encoding="utf-8")
    script_path = out.with_name(out.stem + ".R")
    script_path.write_text(STRAT_PLOT_SCRIPT, encoding="utf-8")

    try:
        proc = subprocess.run(
            [rscript, str(script_path), str(Path(csv_path)), str(out), str(settings_path)],
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
            "Min/max / 标签旋转 这些开关在 rioja::strat.plot 里没有，本图未应用。"
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
        "command": [rscript, str(script_path), str(Path(csv_path)), str(out), str(settings_path)],
    }


def read_as_data_url(path: str, fmt: str) -> tuple[str, str]:
    """把产物读成 data URL；前端直接塞 <img src>，不必再要一个下载端点。"""
    data = Path(path).read_bytes()
    mime = MIME_BY_FORMAT.get(fmt.lower(), "application/octet-stream")
    return mime, "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")

