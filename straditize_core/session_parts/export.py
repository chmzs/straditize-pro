"""Export session mixin (T10: Multi-ROI chunked scientific tabular exports).

Strictly adheres to:
- Frozen Contracts v1.3 §2.6 (primary_roi_id) & §4.2 (Export Mapping);
- Redesign Specification §4.2 & §5.3;
- POSIX UStar .tar archiving with data/<roi>.csv per ROI and data.csv matching primary_roi_id.
"""

from __future__ import annotations

from .export_docs import CSV_MISSING_NOTICE, strat_plot_script_lines

import base64
import inspect
import io
import json
import math
import os
import re
import tarfile
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Collection, Sequence

import numpy as np
import pandas as pd

from ..metadata import (
    export_lipd_package,
)
from ..metadata.exporter_lipd import export_lipd_jsonld
from ..metadata.exporter_xlsx import export_scientific_xlsx
from ..protocol import (
    CALIBRATION_ERROR,
    EXPORT_ERROR,
    INVALID_PARAMS,
    STATE_ERROR,
    JsonRpcError,
)

#: 导出表首列的名字**只从** `strat_plot._y_column_label` 来（issue #114）：列名必须
#: 跟随 `primary_axis`，`primary_axis="age"` 时首列是 `age` 而不是 `depth`。
#: 本模块所有构造首列的地方都走 `_y_col_label`，不在各处另写 `if primary_axis == "age"`。
from ..strat_plot import _y_column_label
from .agedepth import attach_windowed_rates, build_age_depth_frame
from .xscale import READ_PROFILE_EXPORT, read_column_values, resolve_column_scale


#: 视为「百分比类」的单位写法。**其余一律按该列自身量程画** —— 炭屑（counts）、
#: 花粉浓度（粒/cm2/yr）这类绝对值列若按百分比画，会被压成一条平线。
#:
#: 注意 percent 分支的语义：rioja 的 `scale.percent = TRUE` 是**每列按本列最大值**
#: 归一后画满宽（花粉图惯例），不是所有列共用一把 0–100 的尺。
PERCENT_UNITS = ("%", "％", "percent", "pct")


def is_percent_unit(unit: Any) -> bool:
    """该单位是否属于百分比族（只有这些才用 `scale.percent = TRUE`）。"""
    return str(unit or "").strip().lower() in PERCENT_UNITS


def sanitize_filename_stem(stem: Any) -> str:
    """Sanitizes a filename stem by replacing illegal characters with underscores,
    collapsing multiple underscores, and stripping leading/trailing dots and underscores.
    Falls back to 'straditize' if the result is empty.
    """
    if stem is None:
        return "straditize"
    s = str(stem).strip()
    if not s:
        return "straditize"
    cleaned = re.sub(r'[\\/*?:"<>|\s]+', "_", s).strip("._")
    cleaned = re.sub(r"_+", "_", cleaned)
    return cleaned or "straditize"


def extract_project_name_from_filename(filename: str | None) -> str | None:
    """从导入的工程/归档文件名中提取项目定义名前缀。
    例如：'pollen_bars_riojaplot_stradpro_project_20261120_1200.tar' -> 'pollen_bars_riojaplot'。
    """
    if not filename:
        return None
    clean = os.path.basename(str(filename).strip().replace("\\", "/"))
    for ext in (".tar.gz", ".tar", ".zip", ".json", ".csv", ".xlsx", ".lpd"):
        if clean.lower().endswith(ext):
            clean = clean[: -len(ext)]
            break
    m = re.match(
        r"^(.*?)(?:_(?:stradpro_)?project(?:_\d{8}_(?:\d{4}|\d{6})|\d+)?)$",
        clean,
        flags=re.IGNORECASE,
    )
    stem = m.group(1) if (m and m.group(1)) else clean
    m2 = re.match(
        r"^(.*?)(?:_(?:stradpro_)?(?:matrix|report|plot_bundle|lipd|strat_diagram)(?:_\d{8}_(?:\d{4}|\d{6})|\d+)?)$",
        stem,
        flags=re.IGNORECASE,
    )
    if m2 and m2.group(1):
        stem = m2.group(1)
    m3 = re.match(r"^(.*?)(?:_\d{8}_(?:\d{4}|\d{6}))$", stem)
    if m3 and m3.group(1):
        stem = m3.group(1)
    m4 = re.match(r"^(.*?)_stradpro$", stem, flags=re.IGNORECASE)
    if m4 and m4.group(1):
        stem = m4.group(1)
    cleaned = sanitize_filename_stem(stem)
    if not cleaned or cleaned.lower() in ("straditize", "original", "diagram"):
        return None
    return cleaned


def resolve_project_name(session: Any = None, explicit_name: str | None = None) -> str:
    """Resolves project name according to priority:
    1. User-configured project_name (explicit_name parameter or session.project_name)
    2. Base image main filename (derived from image path, stripped of upload:// or archive:// and ext,
       ignoring generic names like 'original' or 'diagram')
    3. Default fallback: 'straditize'
    """
    if explicit_name is not None and str(explicit_name).strip():
        cleaned = re.sub(r'[\\/*?:"<>|\s]+', "_", str(explicit_name).strip()).strip(
            "._"
        )
        cleaned = re.sub(r"_+", "_", cleaned)
        if cleaned:
            return cleaned

    session_proj = None
    if session is not None:
        if isinstance(session, dict):
            session_proj = session.get("project_name")
        else:
            session_proj = getattr(session, "project_name", None)
    if session_proj is not None and str(session_proj).strip():
        cleaned = re.sub(r'[\\/*?:"<>|\s]+', "_", str(session_proj).strip()).strip("._")
        cleaned = re.sub(r"_+", "_", cleaned)
        if cleaned:
            return cleaned

    image_path = None
    if session is not None:
        if isinstance(session, dict):
            image_path = session.get("image_path")
        else:
            image_path = getattr(session, "image_path", None)
    if image_path and isinstance(image_path, str) and image_path.strip():
        clean = image_path.replace("upload://", "").replace("archive://", "")
        clean = clean.replace("\\", "/")
        base_with_ext = os.path.basename(clean)
        base, _ = os.path.splitext(base_with_ext)
        base = base.strip()
        if base and base.lower() not in ("original", "diagram"):
            cleaned = re.sub(r'[\\/*?:"<>|\s]+', "_", base).strip("._")
            cleaned = re.sub(r"_+", "_", cleaned)
            if cleaned:
                return cleaned

    return "straditize"


def format_export_filename(
    project_name: str,
    suffix: str,
    ext: str,
    dt: datetime | None = None,
) -> str:
    """Formats export filename as {project_name}_stradpro_{suffix}_{YYYYMMDD_HHmm}.{ext}."""
    if dt is None:
        dt = datetime.now()
    dt_str = dt.strftime("%Y%m%d_%H%M")
    clean_suffix = suffix.strip("_") if suffix else ""
    clean_ext = ext.lstrip(".")
    stem = sanitize_filename_stem(project_name)
    if clean_suffix:
        return f"{stem}_stradpro_{clean_suffix}_{dt_str}.{clean_ext}"
    return f"{stem}_stradpro_{dt_str}.{clean_ext}"


def _column_row_window(
    session: Any, col: dict[str, Any], c_idx: int
) -> tuple[int, int] | None:
    """该列在**哪几行**上出数（取数窗口 y0..y1）。

    窗口内的缺行是「该行没有墨迹」→ 0（见 test_export_missing_row_semantics.py）；
    窗口**之外**且没有实测点的行则是「不在本列读数范围内」→ None，不能给 0。

    返回 None 表示**判不出范围**（没有取数区、或整列落在 ROI 外）。此时调用方不裁：
    不知道边界就抹空，会把"手工构造的会话 / 移动过 ROI 但点还在"的真实读数一起杀掉。
    """
    try:
        _, _, y0, y1 = session._digitize_column_window(col, col.get("roi_id"), c_idx)
    except JsonRpcError:
        # 整列落在 ROI 外：范围判不出（用户可能只是把 ROI 挪走了，点还在）→ 不裁。
        return None
    except (TypeError, AttributeError):
        # 会话没有取数区（data_ylim/ROI 都缺，常见于手工构造的会话）：返回 None，
        # 由调用方按「判不出范围」处理——不裁，保持原行为。
        return None
    return int(y0), int(y1)


def _mask_outside_window(
    rows: Sequence[int],
    values: list[Any],
    window: tuple[int, int] | None,
    measured_rows: Collection[int],
) -> list[Any]:
    """把「窗口之外且没有实测点」的行置为 None。

    只有**能判定范围**时才裁（`window` 是 (y0, y1)）；判不出范围就原样返回——
    不知道边界却把整列抹空，会造成比原问题更严重的失真。

    两个例外必须保留原值：
    1. 行在窗口内（正常情况）；
    2. 该行**有实测点**（column_points 里真有这一行）——窗口只是「哪些行应该有数」的
       启发式，而实测点是真量到过的，绝不能因为窗口判窄就抹掉。
    """
    if not isinstance(window, tuple):
        return list(values)
    y0, y1 = window
    return [
        v if (y0 <= r <= y1 or r in measured_rows) else None
        for r, v in zip(rows, values)
    ]


def _control_point_only_columns(session: Any) -> set[int]:
    """哪些列的逐行点是**由控制点合成**的（不是真数字化出来的）。

    两类「某行没有点」物理含义完全不同，不能给同一个数：

    - 真数字化过的列：缺行 = 那一行没有墨迹 = **真零丰度** → 0；
    - 控制点合成列：缺行 = 这一层没有拐点/样点 → 按该列曲线**线性插值**（已标定列）
      或 NA（未标定列）。把前者写成 0，用户会把「没测」当成「测到 0」。
    """
    return set(getattr(session, "control_point_columns", None) or ())


def _read_row_values(
    scale: Any,
    rows: Sequence[int],
    p_dict: dict[int, float],
    *,
    strict: bool,
    col_name: str,
    missing_is_na: bool,
    sources_dict: dict[int, str] | None = None,
    profile: str = READ_PROFILE_EXPORT,
) -> list[Any]:
    """按行读一列读数；缺行怎么补由该列的来历决定。

    - `missing_is_na=False`（真数字化过的列）：缺行 = 那一行没有墨迹 = **真零丰度**，
      用基线（列左缘 + 轴线粗，ARCHITECTURE §6.4）换算成 0；
    - `missing_is_na=True`（控制点合成列）：缺行 = 这一层没有拐点/样点，**按该列自己的
      锚点线性插值**（端点 clamp，与 `extract_grid_values` 同口径）。已标定列给插值读数；
      未标定列仍由 `read_column_values` 整列给 None → 导出 NA（未标定列一律不给数）。

    「这一行有没有点」只认 p_dict（真有这一点行），基线只在「无墨迹 = 0」的列里成立。
    """
    baseline_px = float(scale.abs_px0)
    px = [p_dict.get(r) for r in rows]
    srcs = [sources_dict.get(r) if sources_dict else None for r in rows]
    if missing_is_na:
        filled = _interpolate_missing_px(px, rows, p_dict)
        values = read_column_values(
            scale,
            [baseline_px if p is None else p for p in filled],
            profile=profile,
            strict=strict,
            col_name=col_name,
            sources=srcs,
        )
        return [None if p is None else v for p, v in zip(filled, values)]
    values = read_column_values(
        scale,
        [baseline_px if p is None else p for p in px],
        profile=profile,
        strict=strict,
        col_name=col_name,
        sources=srcs,
    )
    return list(values)


def resolve_row_values(
    session: Any,
    col_def: dict[str, Any],
    col_index: int,
    rows: Sequence[int],
    *,
    strict: bool = False,
    profile: str = READ_PROFILE_EXPORT,
    col_name: str = "",
) -> list[Any]:
    """唯一行值出口：normalize/points → 逐行科学读数（导出 CSV/XLSX/LiPD/TAR/R 与 QA 共用）。"""
    column_points = getattr(session, "column_points", None) or {}
    pts = column_points.get(col_index, [])
    p_dict = {p["row"]: p["x"] for p in pts}
    sources_dict = {p["row"]: p.get("source") for p in pts}
    scale = resolve_column_scale(session, col_def, col_index)
    missing_is_na = col_index in _control_point_only_columns(session)
    raw_values = _read_row_values(
        scale,
        rows,
        p_dict,
        strict=strict,
        col_name=col_name,
        missing_is_na=missing_is_na,
        sources_dict=sources_dict,
        profile=profile,
    )
    return _mask_outside_window(
        rows,
        raw_values,
        _column_row_window(session, col_def, col_index),
        p_dict,
    )


def _interpolate_missing_px(
    px: Sequence[float | None], rows: Sequence[int], p_dict: dict[int, float]
) -> list[float | None]:
    """缺行按该列锚点线性插值（端点 clamp）；整列没有锚点时给 None（→ NA）。

    只做**该列自己**的插值：跨列借值等于替另一列编读数。未标定列即便插出像素，
    也会被 `read_column_values` 的 `null_when_uncalibrated` 整列丢掉。
    """
    known = sorted(p_dict)
    if not known:
        return [None] * len(rows)
    known_rows = [float(r) for r in known]
    known_x = [float(p_dict[r]) for r in known]
    return [
        float(np.interp(r, known_rows, known_x)) if p is None else p
        for r, p in zip(rows, px)
    ]


def _normalize_negative_zero_depth(csv_string: str) -> str:
    """把 CSV 行首（深度列）的 `-0.0` 规整成 `0.0`。

    为什么需要：`pandas.DataFrame.to_csv` 对 `float(-0.0)` 一律渲染成 `-0.0`，
    连 `round(x, 4) + 0.0` 也抹不掉符号位（实测确认）。而 `-0.0` 在 CSV 里是
    一个**合法但不该出现**的深度：R 的 `read.csv` / Excel 会读成负深度，
    严格校验的下游（rioja、LiPD 工具链）会直接报错——它实际就是 0。

    只替换**每行第一个字段**（深度列），不碰其它数值列：列值里偶然出现
    `-0.0` 的情况由 `px_to_value` 的 `ndigits` 规整，且不应在这里被改写。
    """
    if "-0.0" not in csv_string:
        return csv_string
    out = []
    for i, line in enumerate(csv_string.split("\n")):
        if i > 0 and line.startswith("-0.0,"):
            line = "0.0," + line[len("-0.0,") :]
        out.append(line)
    return "\n".join(out)


# ---------------------------------------------------------------------------
# 行集身份（issue #113 / #100）
# ---------------------------------------------------------------------------

#: `rowset["provenance"]` 的**全部**取值。RPC 返回、归档 `manifest.json`、
#: 归档 README 与 `docs/ARCHITECTURE.md` 都引用这一组字面量：行集的"身份"
#: 只有这一处定义，不在各处另写同义词。
#:
#: `samples` 是唯一一种"这 N 行各是一个样品层位"的行集；其余四种都不是样品，
#: 行数由数字化密度 / 标尺间隔 / 拐点数决定，而不是由取样设计决定。
ROWSET_SAMPLES = "samples"
ROWSET_PIXEL_ROWS = "pixel_rows"
ROWSET_CONTROL_POINTS = "control_points"
ROWSET_DEPTH_GRID = "depth_grid"
ROWSET_TURNING_POINTS = "turning_points"


def serialize_export_frame(frame: Any) -> str:
    """DataFrame → 导出 CSV 文本（**唯一**序列化入口，四路出口共用）。

    ## 为什么必须只有一处（2026-11-19 实测）

    修前 `to_csv` 有四个调用点，其中三个（`export_multi_tar` 的
    `data/<roi>.csv`、它的兜底分支、`export_bundle_zip` 的 `data.csv`）**不**做
    `-0.0` 规整，只有 `_write_export_file`（面板下载）做。于是同一份工程：

    | 出口 | 首列顶行 |
    |:--|:--|
    | 面板 / `core.exportData` | `0.0` |
    | 归档 `data.csv` | `-0.0` |

    两者字节不同，"归档是本轮导出的字节复本"这条判据直接不成立。收敛到本函数后，
    `na_rep` / 行尾 / `-0.0` 三个口径只有一处可改。
    """
    # `lineterminator` 必须显式给：pandas 默认 `os.linesep`，Windows 上落盘成 CRLF
    # （`tests/unit/test_csv_lf_terminator.py` 有源码级门禁钉住这一条）。
    text = frame.to_csv(index=False, na_rep="NA", lineterminator="\n")
    return _normalize_negative_zero_depth(text)


@dataclass(frozen=True)
class RowSet:
    """一个导出行集的**身份**：行从哪来、是不是样品层位、为什么。

    issue #100 的本体是"并集分支答不上来『这些行凭什么算样品』"。把答案做成
    字段之后，这个问题变成可判定的：`provenance == ROWSET_SAMPLES` ⇔ 行确实来自
    用户设定的层位（`samples`）；否则 `is_sample_rows` 为假，任何出口都不得把它
    标成「共识层位 / 样品」。
    """

    #: 像素行号（与 `column_points[...]["row"]` / `samples[...]["row_px"]` 同域）。
    rows: tuple[Any, ...]
    #: 与 `rows` 等长的首列值（深度 / 年代）。未标定时就是行号本身 —— 那条路径
    #: 走不到 `export_data`（深度标定守卫），但出图/QA 也读本结构。
    depths: tuple[Any, ...]
    #: 见模块级 `ROWSET_*` 常量。
    provenance: str
    #: 会话里 `samples` 的条数（`provenance != samples` 时用于解释"为什么是空"）。
    samples_count: int
    #: 一句话说明"这些行凭什么算样品"，直接进 RPC 返回与归档 manifest。
    why: str

    @property
    def rows_count(self) -> int:
        return len(self.rows)

    @property
    def is_sample_rows(self) -> bool:
        """行集是否**就是**样品层位（唯一可以标成「共识层位」的情形）。"""
        return self.provenance == ROWSET_SAMPLES

    @property
    def describe(self) -> str:
        """给人看的一句话（面板/README/错误文案共用）。

        名字不叫 `label`：`support/consistency_check.py` 的 Check A 按**尾名**匹配
        调用点，本仓里 `ndimage.label(...)` / `ndi.label(...)` / `skim.label(...)`
        会被判成"调用了这里的签名"，整项校验直接变红（实测 5 处误报）。
        为一条误报去放松校验等于把门禁拆掉，所以改名字。
        """
        if self.is_sample_rows:
            return f"样品层位（samples，{self.samples_count} 条）"
        if self.provenance == ROWSET_PIXEL_ROWS:
            return f"逐列数字化的像素行并集（{self.rows_count} 行，不是样品层位）"
        if self.provenance == ROWSET_CONTROL_POINTS:
            return f"控制点（拐点）层位并集（{self.rows_count} 行）"
        if self.provenance == ROWSET_DEPTH_GRID:
            return f"按深度间隔重采样的规则层位（{self.rows_count} 行）"
        return f"拐点原始坐标（{self.rows_count} 行，长表）"

    def as_dict(self) -> dict[str, Any]:
        """RPC 返回 / `manifest.json` 用的机器可读形式。"""
        return {
            "provenance": self.provenance,
            "is_sample_rows": self.is_sample_rows,
            "rows_count": self.rows_count,
            "samples_count": self.samples_count,
            "label": self.describe,
            "why": self.why,
        }


class ExportMixin:
    """Session mixin for multi-ROI chunked tabular exports (CSV/TSV/LiPD/XLSX/TAR)."""

    def _init_export(self) -> None:
        """Initialize export state.

        control_point_columns = 逐行点由控制点合成的列（见
        _ensure_export_column_points）。这些列的缺行按 NA 出，不按 0 出。
        """
        self.control_point_columns: set[int] = set()

    def get_age_depth_dataframe(self) -> pd.DataFrame | None:
        """产出独立的年代-深度关系表 (age_depth.csv)。

        列结构：horizon_id, depth, age, age_lower, age_upper, sed_rate
        - 当存在 age_depth_model 时，基于模型预测与沉积速率推算；
        - 当无模型但 samples 已包含年代数据时，提取 samples 内记录；
        - 若两者均不存在，返回 None。
        """
        model = getattr(self, "age_depth_model", None)
        samples = list(getattr(self, "samples", None) or [])
        if model is None and not any(s.get("age") is not None for s in samples):
            return None

        if samples:
            axis = getattr(self, "primary_axis", "depth") or "depth"
            horizon_ids = [
                s.get("horizon_id") or f"H{idx + 1:04d}"
                for idx, s in enumerate(samples)
            ]

            if axis == "age":
                # 图版主轴为年代：样品的读数属于年代（cal yr BP），物理深度需从模型反演
                sample_ages: list[float] = []
                for s in samples:
                    a = s.get("depth")  # 兼容既有字段结构：age 标定下的层位值落在 depth 键
                    if a is None and s.get("age") is not None:
                        a = s["age"]
                    if a is None and "row_px" in s:
                        a = self._depth_for_row_px(s["row_px"])
                    sample_ages.append(float(a) if a is not None else 0.0)

                if model is not None:
                    inverse = model.predict_depth(sample_ages)
                    sample_depths = [
                        round(float(d), 4) if d is not None else None
                        for d in inverse["depth_est"]
                    ]
                    age_est = [round(float(a), 4) for a in sample_ages]
                    pred_env = model.predict_age([d if d is not None else 0.0 for d in sample_depths])
                    raw_lower = pred_env.get("age_lower", pred_env.get("age_min"))
                    age_lower = [
                        round(float(l), 4) if l is not None and sample_depths[i] is not None else None
                        for i, l in enumerate(raw_lower)
                    ] if raw_lower is not None else [None] * len(sample_depths)
                    raw_upper = pred_env.get("age_upper", pred_env.get("age_max"))
                    age_upper = [
                        round(float(u), 4) if u is not None and sample_depths[i] is not None else None
                        for i, u in enumerate(raw_upper)
                    ] if raw_upper is not None else [None] * len(sample_depths)

                    try:
                        valid_for_sed = [d if d is not None else 0.0 for d in sample_depths]
                        sed_info = model.estimate_sedimentation_rate(valid_for_sed)
                        raw_sed = sed_info.get("sed_rate")
                        sed_rate = [
                            round(float(r), 4) if r is not None and sample_depths[i] is not None else None
                            for i, r in enumerate(raw_sed)
                        ] if raw_sed is not None else [None] * len(sample_depths)
                    except Exception:
                        sed_rate = [None] * len(sample_depths)
                else:
                    sample_depths = [None] * len(sample_ages)
                    age_est = [round(float(a), 4) for a in sample_ages]
                    age_lower = [s.get("age_lower", s.get("age_min")) for s in samples]
                    age_upper = [s.get("age_upper", s.get("age_max")) for s in samples]
                    sed_rate = [s.get("sed_rate") for s in samples]

                return pd.DataFrame(
                    {
                        "horizon_id": horizon_ids,
                        "depth": sample_depths,
                        "age": age_est,
                        "age_lower": age_lower,
                        "age_upper": age_upper,
                        "sed_rate": sed_rate,
                    }
                )

            sample_depths: list[float] = []
            for s in samples:
                d = s.get("depth")
                if d is None and "row_px" in s:
                    d = self._depth_for_row_px(s["row_px"])
                sample_depths.append(round(float(d), 4) if d is not None else 0.0)

            if model is not None:
                pred = model.predict_age(sample_depths)
                age_est = [round(float(a), 4) if a is not None else None for a in pred["age_est"]]
                raw_lower = pred.get("age_lower", pred.get("age_min"))
                age_lower = [round(float(l), 4) if l is not None else None for l in raw_lower] if raw_lower is not None else [None] * len(sample_depths)
                raw_upper = pred.get("age_upper", pred.get("age_max"))
                age_upper = [round(float(u), 4) if u is not None else None for u in raw_upper] if raw_upper is not None else [None] * len(sample_depths)

                try:
                    sed_info = model.estimate_sedimentation_rate(sample_depths)
                    raw_sed = sed_info.get("sed_rate")
                    sed_rate = [round(float(r), 4) if r is not None else None for r in raw_sed] if raw_sed is not None else [None] * len(sample_depths)
                except Exception:
                    sed_rate = [None] * len(sample_depths)
            else:
                age_est = [s.get("age") for s in samples]
                age_lower = [s.get("age_lower", s.get("age_min")) for s in samples]
                age_upper = [s.get("age_upper", s.get("age_max")) for s in samples]
                sed_rate = [s.get("sed_rate") for s in samples]

            return pd.DataFrame(
                {
                    "horizon_id": horizon_ids,
                    "depth": sample_depths,
                    "age": age_est,
                    "age_lower": age_lower,
                    "age_upper": age_upper,
                    "sed_rate": sed_rate,
                }
            )

        if model is not None:
            depths = [round(float(d), 4) for d in model.depths]
            horizon_ids = [f"H{idx + 1:04d}" for idx in range(len(depths))]
            pred = model.predict_age(depths)
            age_est = [round(float(a), 4) if a is not None else None for a in pred["age_est"]]
            raw_lower = pred.get("age_lower", pred.get("age_min"))
            age_lower = [round(float(l), 4) if l is not None else None for l in raw_lower] if raw_lower is not None else [None] * len(depths)
            raw_upper = pred.get("age_upper", pred.get("age_max"))
            age_upper = [round(float(u), 4) if u is not None else None for u in raw_upper] if raw_upper is not None else [None] * len(depths)
            try:
                sed_info = model.estimate_sedimentation_rate(depths)
                raw_sed = sed_info.get("sed_rate")
                sed_rate = [round(float(r), 4) if r is not None else None for r in raw_sed] if raw_sed is not None else [None] * len(depths)
            except Exception:
                sed_rate = [None] * len(depths)

            return pd.DataFrame(
                {
                    "horizon_id": horizon_ids,
                    "depth": depths,
                    "age": age_est,
                    "age_lower": age_lower,
                    "age_upper": age_upper,
                    "sed_rate": sed_rate,
                }
            )

        return None

    def get_ensemble_dataframe(self) -> pd.DataFrame | None:
        """产出蒙特卡洛抽样集成表 (ensemble.csv)。

        列结构：horizon_id (若有 samples), depth, ens_0001, ens_0002, ...
        """
        tables = getattr(self, "ensemble_tables", None) or []
        if not tables:
            return None
        table = tables[-1]
        columns = list(table.get("columns", []))
        data = list(table.get("data", []))
        if not columns or not data:
            return None
        first_row = data[0]
        if isinstance(first_row, dict):
            missing = [col for col in columns if col not in first_row]
            if missing:
                raise JsonRpcError(
                    EXPORT_ERROR,
                    f"集成表结构不完整：缺少列 {', '.join(str(c) for c in missing[:5])}。",
                )
            df = pd.DataFrame(data)[columns]
        else:
            row_len = len(first_row) if hasattr(first_row, "__len__") else 0
            if row_len != len(columns):
                raise JsonRpcError(
                    EXPORT_ERROR,
                    f"集成表列数不匹配：表头 {len(columns)} 列，数据行 {row_len} 列。",
                )
            df = pd.DataFrame(data, columns=columns)

        samples = list(getattr(self, "samples", None) or [])
        if samples and len(samples) == len(df):
            horizon_ids = [
                s.get("horizon_id") or f"H{idx + 1:04d}"
                for idx, s in enumerate(samples)
            ]
            df.insert(0, "horizon_id", horizon_ids)
        return df

    def _y_col_label(self, legacy_column_name: bool = False) -> str:
        """导出表**首列**的列名（本模块唯一的取名入口）。

        跟着 `self.primary_axis` 走：`"age"` → `age`，`"depth"` → `depth`。
        派生逻辑在 `strat_plot._y_column_label`，这里只是一层带会话状态的薄包装，
        好让四路出口（CSV / TAR / XLSX / LiPD）与三个行集构造器都用同一个名字。
        """
        return _y_column_label(
            getattr(self, "primary_axis", None), legacy=legacy_column_name
        )

    def _row_depths(
        self, rows: Sequence[Any], raw_depths: Sequence[Any] | None = None
    ) -> list[Any]:
        """像素行 → 首列值（深度 / 年代）的**唯一**换算。

        既有语义原样保留（这是 `get_roi_dataframes` 与 `_export_rows_and_depths`
        两份实现的合并，两者此前逐字等价）：

        - 用户给了层位深度（`samples[i]["depth"]`）就**原样用**，不再二次取整；
        - 没给（`None`）时，已标定 → `y_scale` 线性换算并 round 4；未标定 → 给行号。

        未标定给行号的那条分支不会被 `export_data` 放行（那里有深度标定守卫），
        但 `get_roi_dataframes` 同时服务出图与 QA，仍需要一个不自称"深度"的返回值。
        """
        y_scale = getattr(self, "y_scale", None)
        calibrated = bool(getattr(self, "is_calibrated", False)) and y_scale is not None
        raw = list(raw_depths) if raw_depths is not None else [None] * len(rows)
        slope = float(y_scale.get("slope", 0.0)) if calibrated else 0.0
        intercept = float(y_scale.get("intercept", 0.0)) if calibrated else 0.0
        is_code = getattr(self, "primary_axis", None) == "code"

        out: list[Any] = []
        for row, depth in zip(rows, raw):
            if depth is not None:
                out.append(int(round(float(depth))) if is_code else depth)
            elif calibrated:
                val = slope * row + intercept
                out.append(int(round(float(val))) if is_code else round(val, 4))
            else:
                out.append(row)
        return out

    def _resolve_rowset(
        self, *, column_indices: Collection[int] | None = None
    ) -> RowSet:
        """**唯一**行集来源：面板预览 / CSV 下载 / 归档 `data.csv` 都从这里取行。

        ## 两条分支，身份不同（issue #113 / #100）

        | `samples` | 行 = | `provenance` | 行数是"样品数"吗 |
        |:--|:--|:--|:--|
        | 非空 | `samples[i]["row_px"]`，逐条对应 | `samples` | 是（== `len(samples)`） |
        | 空 | 这些列逐行数字化点的像素行并集 | `pixel_rows` | **不是**，随数字化密度变化 |

        第二分支保留（出图与 `data.csv` 仍要能导原始曲线），但它**永远不再自称
        样品**：`as_dict()` 里的 `is_sample_rows=False` + `why` 就是"凭什么"的答案
        ——答案是"它们不是样品"。真正要按样品导的地方（面板「共识层位」、
        `dataset="samples"`）在 `_dataset_frame` 里直接拒绝，见那里的注释。

        `column_indices`：多 ROI 时只取该 ROI 的列（行集按 ROI 分开，与
        `data/<roi>.csv` 的表内容一致）。
        """
        samples = list(getattr(self, "samples", None) or [])
        if samples:
            rows = [int(round(float(s.get("row_px", 0)))) for s in samples]
            depths = self._row_depths(rows, [s.get("depth") for s in samples])
            return RowSet(
                rows=tuple(rows),
                depths=tuple(depths),
                provenance=ROWSET_SAMPLES,
                samples_count=len(samples),
                why=(
                    f"用户设定了 {len(samples)} 个样品层位（步骤 7）：第 i 行的 row_px "
                    "取自 samples[i]，层位序列由用户给定，不由数字化密度推出。"
                ),
            )

        points = getattr(self, "column_points", None) or {}
        indices = (
            set(column_indices) if column_indices is not None else set(points.keys())
        )
        row_values = {
            point["row"]
            for index in indices
            for point in (points.get(index) or [])
            if "row" in point
        }
        rows = sorted(row_values) if row_values else [0]
        why = (
            "未设样品层位（samples 为空）：行取自这些列逐行数字化点的像素行并集，"
            "行数随图像高度与数字化密度变化 —— 它们是**像素行**，不是样品层位。"
        )
        if not row_values:
            why = (
                "未设样品层位（samples 为空），且这些列没有任何逐行数字化点："
                "当前只有一行占位行 0 —— 它既不是样品，也不是读数。"
            )
        return RowSet(
            rows=tuple(rows),
            depths=tuple(self._row_depths(rows)),
            provenance=ROWSET_PIXEL_ROWS,
            samples_count=0,
            why=why,
        )

    def get_roi_dataframes(
        self, strict: bool = False, *, legacy_column_name: bool = False
    ) -> dict[str, pd.DataFrame]:
        """Construct a pandas DataFrame for each ROI.

        `strict` 透传给 `read_column_values`：CSV 与 XLSX/LiPD/TAR 共用本入口后，
        这个开关必须能一路传到唯一的换算函数，否则"严格模式"只剩一半语义。

        `legacy_column_name` 只改**首列名**（`age` → `depth`），不改任何数值；给按旧
        列名读的下游脚本一个过渡口。首列名本身来自 `_y_col_label`（唯一来源）。
        """
        # 导出前统一门禁：任何导出通道（CSV / XLSX / LiPD / TAR / R）都必须先补齐
        # 逐行点并在无可取数列时抛出 -32001，不允许静默交付空表。
        self._ensure_export_column_points()
        controls = getattr(self, "control_points", None) or {}
        points = getattr(self, "column_points", None)
        if points is None:
            self.column_points = points = {}
        if not points and any(controls.values()):
            columns = list(getattr(self, "columns", None) or [])
            for position, col in enumerate(columns):
                idx = col.get("col_index", position)
                ctrls = controls.get(idx, {}) or {}
                if ctrls:
                    points[idx] = [
                        {"row": int(round(float(row))), "x": float(x)}
                        for row, x in sorted(ctrls.items())
                    ]

        rois = getattr(self, "rois", [])
        # 手工构造的会话（测试、CLI 直调）常常没有 ROI 记账，但列上仍带着某个 roi_id。
        # 此时下面的 `roi_cols` 过滤会把整张表判空（roi_id 对不上合成出来的 "pollen"）。
        # 语义上：**没有 ROI 记账就没有排除任何列的依据**，所以合成单 ROI 时要收全部列。
        # 真实会话永远有 rois，走不到这条分支。
        synthetic_roi = not rois
        if synthetic_roi:
            rois = [{"id": "pollen", "name": "pollen", "name_source": "default"}]

        all_columns = getattr(self, "columns", [])
        samples = getattr(self, "samples", [])
        column_points = getattr(self, "column_points", {})

        roi_dfs: dict[str, pd.DataFrame] = {}
        y_col = self._y_col_label(legacy_column_name)

        for roi in rois:
            roi_id = roi["id"]
            roi_name = roi.get("name", roi_id)

            roi_cols = (
                list(all_columns)
                if synthetic_roi
                else [
                    c
                    for c in all_columns
                    if c.get("roi_id") == roi_id
                    or (
                        not c.get("roi_id")
                        and (
                            len(rois) <= 1
                            or roi_id == getattr(self, "primary_roi_id", None)
                        )
                    )
                ]
            )

            if not roi_cols:
                if samples:
                    horizon_ids = [
                        s.get("horizon_id") or f"H{idx + 1:04d}"
                        for idx, s in enumerate(samples)
                    ]
                    depths = [s.get("depth", s.get("row_px")) for s in samples]
                    roi_dfs[roi_name] = pd.DataFrame({"horizon_id": horizon_ids, y_col: depths})
                else:
                    roi_dfs[roi_name] = pd.DataFrame({y_col: []})
                continue

            # 行集只从 `_resolve_rowset` 来（issue #113）：面板预览、CSV 下载、
            # 归档 data.csv 与 XLSX/LiPD 全部走这里，不允许再各算一套。
            # `pts_rows` 为空时它给的那一行占位行 0 也由它自己标记（`why` 里写清）。
            c_indices = {c.get("col_index", idx) for idx, c in enumerate(roi_cols)}
            rowset = self._resolve_rowset(column_indices=c_indices)
            row_list = list(rowset.rows)
            depth_list = list(rowset.depths)

            data_dict: dict[str, Any] = {y_col: depth_list}

            taxa_names = getattr(self, "taxa_names", None) or []
            for idx, col in enumerate(roi_cols):
                c_idx = col.get("col_index", idx)
                if taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx]:
                    col_name = taxa_names[c_idx]
                else:
                    col_name = (
                        col.get("name") or col.get("species") or f"col{c_idx + 1:02d}"
                    )

                data_dict[col_name] = resolve_row_values(
                    self,
                    col,
                    c_idx,
                    row_list,
                    strict=strict,
                    col_name=col_name,
                )

            frame = pd.DataFrame(data_dict)
            # 行集身份随表带走：下游（归档 README / manifest / 测试）不必重新推断
            # "这 N 行是什么"。pandas `attrs` 不参与相等比较，也不进 CSV 字节。
            frame.attrs["rowset"] = rowset.as_dict()
            roi_dfs[roi_name] = frame

        return roi_dfs

    def get_export_readiness(self, dataset: str | None = None) -> dict[str, Any]:
        """Compute the Export Readiness checklist for all ROIs.

        `dataset`（可选，2026-11-19，issue #100）：面板按当前下拉取值调用本方法，
        拿到的 `rowset.label` 就是**这一行集**的人话名字（「样品层位」/「逐列数字化的
        像素行并集（625 行，不是样品层位）」…）。不传 = `data.csv` 那条语义
        （samples 优先，samples 为空则像素行）。这样面板标题不必在前端按 dataset 名
        写死一套同义词——那正是 `samples=0` 时把像素行标成「按共识层位」的来源。

        ## 标定检查（B-12）

        就绪清单原本只查两件事——ROI 是否被用户命名、该 ROI 有没有列。它**从不看
        列有没有标定**，于是对着 28 列全部未标定的会话报 `ready=True`。那是用户
        导出前的最后一道门，却对"所有读数都是程序默认值"毫无反应。

        现在逐列调用 `resolve_column_scale(...).calibrated` 作为**唯一**判据
        （与导出、网格采样、QA 共用同一个解析入口，不另造第二套判定）。判据形状
        也必须由它决定，不能去看 `startValue`/`tickValue` 是否存在——那两个字段
        在 `detect_columns` 里被硬编码成 0.0/20.0，**存在不等于标定过**。

        ## 为什么"放行 + 标 provenance"而不是"拒绝导出"

        1. **用户可能真的想导原始读数**。未标定列导出的是像素几何百分比
           （legacy 列宽归一），对"先看一眼形态"是有效输出。锁死等于替用户决定
           他不能导出自己刚画的东西。
        2. **拒绝无法表达"部分标定"**。28 列里标了 1 列时，一个布尔 `ready`
           无论真假都是错的信息。

        所以这里的判定是：**`ready` 反映"能不能不带保留地导出"，但导出动作本身不被
        阻止**。未标定时 `ready=False` 且 `provenance` 说清哪些列是默认值、来源是
        什么；前端据此可以"放行 + 显著标注"，也可以拦住用户。把"是否阻止"的决定
        留给 UI，后端只负责**如实报告**。

        两条边界（都有对应的反向哨兵）：
        - 全部列已标定 → `ready=True`（防矫枉过正改成恒假）；
        - 部分标定 → `ready=False`，但 `uncalibrated_columns` 精确列出缺哪几列
          （一个布尔无法表达这个信息）。

        既有字段名全部保留，`frontend/e2e/export.spec.ts` 的键集断言仍成立；
        但 `ready` 的**判定条件**从两个变成三个（新增标定）。任务书第 4 条要求的
        正是这一变更：让"零标定也算就绪"那条历史测试改为"命名 + 有列 + 已标定"。
        `readiness_missing` 仍只记 ROI 级缺项（未命名 / 无列），**不**把"有未标定
        列"算进去——否则同一个 ROI 名会重复出现，前端按名字展示会变成两条。
        """
        # 非法 dataset 名先报：`rowset` 的身份与行数都由它选，静默当 None 处理
        # 会让面板标题显示"样品层位"而表却是别的行集。
        dataset_key = (dataset or "").strip().lower()
        if dataset_key and dataset_key not in self.EXPORT_DATASETS:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Unsupported dataset '{dataset}'. Use one of: {', '.join(self.EXPORT_DATASETS)}.",
            )

        rois = getattr(self, "rois", [])
        if not rois:
            rois = [{"id": "pollen", "name": "pollen", "name_source": "default"}]

        all_columns = getattr(self, "columns", [])
        primary_roi_id = getattr(self, "primary_roi_id", None) or rois[0]["id"]
        primary_roi_name = next(
            (r.get("name", r["id"]) for r in rois if r["id"] == primary_roi_id),
            rois[0].get("name", "pollen"),
        )

        sheets = [r.get("name", r["id"]) for r in rois]
        missing_rois: list[str] = []

        for r in rois:
            r_id = r["id"]
            r_name = r.get("name", r_id)
            name_source = r.get("name_source", "default")
            cols = [c for c in all_columns if c.get("roi_id") == r_id]

            # 与前端 ExportReadinessPanel.ts 单一真相源对齐：
            # 单 ROI 使用默认名（如 'pollen'）是标准且完备的，不作未命名阻拦；
            # 仅多 ROI 时仍为默认名，或任意 ROI 尚无属种列，才记入未就绪。
            is_unnamed = len(rois) > 1 and name_source == "default"
            if is_unnamed or len(cols) == 0:
                missing_rois.append(r_name)

        # ---- 逐列标定审计 ----
        uncalibrated_columns: list[dict[str, Any]] = []
        source_counts: dict[str, int] = {}
        for index, column in enumerate(all_columns):
            scale = resolve_column_scale(self, column, index)
            source_counts[scale.source] = source_counts.get(scale.source, 0) + 1
            if not scale.calibrated:
                uncalibrated_columns.append(
                    {
                        "col_index": index,
                        "name": column.get("name")
                        or column.get("species")
                        or f"col{index + 1:02d}",
                        "roi_id": column.get("roi_id"),
                        # `source` 说明这个数是哪来的：legacy = 用旧字段/列宽归一
                        # 换算，default = 连标度信息都没有。两者都不是用户读出来
                        # 的刻度值。
                        "source": scale.source,
                    }
                )

        calibrated_count = len(all_columns) - len(uncalibrated_columns)
        # 第三个就绪条件：列标定。三个条件一起决定 ready：
        #   ROI 已命名  ∧  该 ROI 有列  ∧  所有列都已标定
        fully_calibrated = bool(all_columns) and not uncalibrated_columns
        return {
            "sheets": sheets,
            "primary_roi": primary_roi_name,
            "primary_roi_id": primary_roi_id,
            "readiness_missing": missing_rois,
            "total_rois": len(rois),
            "ready": len(missing_rois) == 0 and fully_calibrated,
            # 以下为新增的"读数来历"信息，供放行导出时标注来源使用。
            "calibrated_count": calibrated_count,
            "column_count": len(all_columns),
            "uncalibrated_columns": uncalibrated_columns,
            "provenance": {
                "all_calibrated": fully_calibrated,
                "calibrated_count": calibrated_count,
                "column_count": len(all_columns),
                "sources": source_counts,
            },
            # 行集身份 + 质量指标（issue #100）：面板打开时就能拿到"这次导出会
            # 交付什么行集、多少行、支持列数中位、要不要重跑共识"，不必先导一次。
            # 与 `core.exportData` / 归档 manifest 是同一个构造函数，不会各说一套。
            "rowset": self._rowset_report(
                dataset_key or None, self._rowset_rows_estimate(dataset_key or None)
            ),
        }

    def _roi_column_units(self) -> dict[str, dict[str, str]]:
        """ROI 名 → {列名: unit}，列名规则与 `data/<roi>.csv` 同源。

        为什么要按 ROI 分开：两个 ROI 里可以各有同名 `col01`，量纲却不同；
        一张全局 name→unit 的表会让它们互相覆盖（`data.csv` 那处就踩过这个坑）。
        """
        roi_name_by_id = {
            r.get("id"): r.get("name") for r in (getattr(self, "rois", None) or [])
        }
        taxa_names = getattr(self, "taxa_names", None) or []
        out: dict[str, dict[str, str]] = {}
        for idx, col in enumerate(getattr(self, "columns", []) or []):
            c_idx = col.get("col_index", idx)
            name = (
                taxa_names[c_idx]
                if (taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx])
                else (col.get("name") or col.get("species") or f"col{c_idx + 1:02d}")
            )
            roi_name = roi_name_by_id.get(col.get("roi_id"))
            if not roi_name:
                continue
            out.setdefault(roi_name, {})[name] = resolve_column_scale(
                self, col, c_idx
            ).unit
        return out

    def _roi_column_exaggerations(self) -> dict[str, dict[str, float]]:
        """ROI 名 → {列名: exaggeration_mult}，仅记录倍率 > 1.0 的列。"""
        roi_name_by_id = {
            r.get("id"): r.get("name") for r in (getattr(self, "rois", None) or [])
        }
        taxa_names = getattr(self, "taxa_names", None) or []
        out: dict[str, dict[str, float]] = {}
        for idx, col in enumerate(getattr(self, "columns", []) or []):
            c_idx = col.get("col_index", idx)
            name = (
                taxa_names[c_idx]
                if (taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx])
                else (col.get("name") or col.get("species") or f"col{c_idx + 1:02d}")
            )
            roi_name = roi_name_by_id.get(col.get("roi_id"))
            if not roi_name:
                continue
            scale = resolve_column_scale(self, col, c_idx)
            if scale.exaggeration_mult is not None and scale.exaggeration_mult > 1.0:
                out.setdefault(roi_name, {})[name] = float(scale.exaggeration_mult)
        return out

    def export_multi_tar(
        self,
        output_path: str | None = None,
        project_name: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Exports standard POSIX UStar .tar project archive with multi-ROI support."""
        roi_dfs = self.get_roi_dataframes()
        rois = getattr(self, "rois", [])
        primary_roi_id = getattr(self, "primary_roi_id", None) or (
            rois[0]["id"] if rois else "pollen"
        )
        primary_roi_name = next(
            (r.get("name", r["id"]) for r in rois if r["id"] == primary_roi_id),
            list(roi_dfs.keys())[0] if roi_dfs else "pollen",
        )

        # 量纲：`data.csv` 里只有数值、没有单位位，所以单位必须在这里落一份，
        # 否则炭屑/浓度与百分比列在下游长得一模一样（用户实测 28 列全 %）。
        units_by_roi = self._roi_column_units()
        exag_by_roi = self._roi_column_exaggerations()
        group_units = {
            f"{r.get('name', r.get('id'))}": {
                g.get("name"): g.get("unit") for g in (r.get("x_groups") or [])
            }
            for r in rois
        }

        # 行集身份（issue #113 / #100）：每张表都说明"这 N 行是什么、凭什么"。
        # 记录来自 `get_roi_dataframes` → `_resolve_rowset`，与写进 data.csv 的
        # 那张表同源，所以这份元数据不会与字节脱节。`samples` 为空时它明说
        # "是逐列像素行，不是样品层位"——这就是 #100 要求能答上来的那句话。
        rowset_by_roi = {
            name: {
                **dict(frame.attrs.get("rowset") or {}),
                # 质量指标随行集一起落盘：层位数 / 支持列数中位 / 容差。
                # 用户拿归档时不用回跑软件就能判断"要不要重跑共识优化"。
                "quality": self._rowset_quality(
                    len(frame),
                    is_sample_rows=bool(
                        (frame.attrs.get("rowset") or {}).get("is_sample_rows")
                    ),
                ),
            }
            for name, frame in roi_dfs.items()
        }
        primary_rowset = rowset_by_roi.get(primary_roi_name) or {}

        age_depth_df = self.get_age_depth_dataframe()
        ensemble_df = self.get_ensemble_dataframe()

        manifest = {
            "version": "2.0.0",
            "tool": "straditize pro",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "schema_version": "2.0",
            "primary_roi_id": primary_roi_id,
            "primary_roi": primary_roi_name,
            "rois": [r.get("name", r.get("id")) for r in rois],
            # data.csv 的行集身份（`provenance` / `is_sample_rows` / `why`）。
            # 机器可读的那一份；人读的那一份在 README.txt。
            "data_csv_rowset": primary_rowset,
            "rowset_by_roi": rowset_by_roi,
            # 每列量纲（按 ROI 分组；同名不同 ROI 的列不会互相覆盖）
            "column_units": units_by_roi,
            # 每组量纲（用户编辑的源头，见步骤 6「单位」输入）
            "group_units": group_units,
            "age_depth_csv": "data/age_depth.csv" if age_depth_df is not None else None,
            "ensemble_csv": "data/ensemble.csv" if ensemble_df is not None else None,
        }

        tar_bio = io.BytesIO()
        with tarfile.open(fileobj=tar_bio, mode="w") as tf:
            m_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
            ti_m = tarfile.TarInfo(name="manifest.json")
            ti_m.size = len(m_bytes)
            ti_m.mtime = int(time.time())
            tf.addfile(ti_m, io.BytesIO(m_bytes))

            img = getattr(self, "image", None)
            if img is not None:
                img_bio = io.BytesIO()
                img.save(img_bio, format="PNG")
                img_data = img_bio.getvalue()
                ti_img = tarfile.TarInfo(name="image/original.png")
                ti_img.size = len(img_data)
                ti_img.mtime = int(time.time())
                tf.addfile(ti_img, io.BytesIO(img_data))

            primary_csv_bytes: bytes = b""
            r_scripts: list[str] = [
                "# ==============================================================================",
                "# Straditize Pro - Multi-ROI Stratigraphic Diagram Plotting Script",
                "# Generated automatically by Straditize v2.0 (straditize pro)",
                "# Requires R package 'rioja' (install.packages('rioja'))",
                "# ==============================================================================\n",
                "if (!requireNamespace('rioja', quietly = TRUE)) install.packages('rioja')",
                "library(rioja)\n",
            ]

            # 每个 ROI 的 CSV 文件名规则：用户显式命名的用名字，未命名的用
            # `data_roi_<序号>`（序号按 roi_dfs 顺序从 1 起）。用名字时保留可读性，
            # 未命名时不把 `roi_1` 这类内部 ID 暴露给下游脚本。
            roi_meta_by_name = {
                r.get("name"): r for r in (getattr(self, "rois", None) or [])
            }
            unnamed_seq = 0
            for roi_name, df in roi_dfs.items():
                # 序列化只走 `serialize_export_frame`：与面板下载**逐字节相同**的
                # 前提正是 na_rep / LF / `-0.0` 三项口径只有一处（判据 4）。
                csv_bytes = serialize_export_frame(df).encode("utf-8")

                meta = roi_meta_by_name.get(roi_name) or {}
                if meta.get("name_source") == "user":
                    member_name = roi_name
                else:
                    # 序号只在"未命名"的 ROI 之间递增：已命名的 ROI 不占号，
                    # 否则第一个未命名分区会因为前面有 pollen 而变成 data_roi_2。
                    unnamed_seq += 1
                    member_name = f"data_roi_{unnamed_seq}"
                csv_filename = f"data/{member_name}.csv"
                ti_roi_csv = tarfile.TarInfo(name=csv_filename)
                ti_roi_csv.size = len(csv_bytes)
                ti_roi_csv.mtime = int(time.time())
                tf.addfile(ti_roi_csv, io.BytesIO(csv_bytes))

                if roi_name == primary_roi_name:
                    primary_csv_bytes = csv_bytes

                roi_units = units_by_roi.get(roi_name, {})
                roi_exag = exag_by_roi.get(roi_name, {})
                pct_cols = sorted(c for c, u in roi_units.items() if is_percent_unit(u))
                fixed_cols = sorted(
                    c for c, u in roi_units.items() if not is_percent_unit(u)
                )
                r_scripts.extend(
                    strat_plot_script_lines(
                        df_var=f"df_{roi_name}",
                        csv_filename=csv_filename,
                        roi_name=roi_name,
                        pct_cols=pct_cols,
                        fixed_cols=fixed_cols,
                        units=roi_units,
                        exag_cols=roi_exag,
                        primary_axis=getattr(self, "primary_axis", None),
                        unit=getattr(self, "depth_unit", None),
                    )
                )

            if not primary_csv_bytes and roi_dfs:
                primary_csv_bytes = serialize_export_frame(
                    list(roi_dfs.values())[0]
                ).encode("utf-8")

            ti_data_csv = tarfile.TarInfo(name="data.csv")
            ti_data_csv.size = len(primary_csv_bytes)
            ti_data_csv.mtime = int(time.time())
            tf.addfile(ti_data_csv, io.BytesIO(primary_csv_bytes))

            if age_depth_df is not None:
                ad_bytes = serialize_export_frame(age_depth_df).encode("utf-8")
                ti_ad = tarfile.TarInfo(name="data/age_depth.csv")
                ti_ad.size = len(ad_bytes)
                ti_ad.mtime = int(time.time())
                tf.addfile(ti_ad, io.BytesIO(ad_bytes))

            if ensemble_df is not None:
                ens_bytes = serialize_export_frame(ensemble_df).encode("utf-8")
                ti_ens = tarfile.TarInfo(name="data/ensemble.csv")
                ti_ens.size = len(ens_bytes)
                ti_ens.mtime = int(time.time())
                tf.addfile(ti_ens, io.BytesIO(ens_bytes))

            r_script_bytes = "\n".join(r_scripts).encode("utf-8")
            ti_r = tarfile.TarInfo(name="plot_strat.R")
            ti_r.size = len(r_script_bytes)
            ti_r.mtime = int(time.time())
            tf.addfile(ti_r, io.BytesIO(r_script_bytes))

            # 行集来源标记（issue #100）：打开归档第一眼就要知道 data.csv 那 N 行
            # 是不是样品层位。人读的这份在 README，机器读的那份在
            # `manifest.json -> data_csv_rowset`，两份都来自 `_resolve_rowset`。
            quality = primary_rowset.get("quality") or {}
            rowset_notice = (
                f"data.csv row set : {primary_rowset.get('label', 'unknown')}\n"
                f"  provenance     : {primary_rowset.get('provenance', 'unknown')}\n"
                f"  is samples     : {primary_rowset.get('is_sample_rows')}\n"
                f"  rows / samples : {primary_rowset.get('rows_count')} / "
                f"{primary_rowset.get('samples_count')}\n"
                f"  why            : {primary_rowset.get('why', '')}\n"
                f"  quality        : support_columns_median="
                f"{quality.get('support_columns_median')} (n={quality.get('support_columns_n')}, "
                f"min..max {quality.get('support_columns_min')}.."
                f"{quality.get('support_columns_max')})\n"
                f"                   tolerance_px={quality.get('tolerance_px')} "
                f"(default {quality.get('default_tolerance_px')}) "
                f"roi_height_px={quality.get('roi_height_px')} "
                f"rows_equal_roi_height={quality.get('rows_equal_roi_height')}\n"
            )
            if primary_rowset and not primary_rowset.get("is_sample_rows"):
                rowset_notice += (
                    "WARNING: samples is empty -> data.csv rows are digitized PIXEL "
                    "ROWS, not sample horizons.\n"
                    "警告：本工程未设样品层位（samples 为空），data.csv 的行是逐列数字化的"
                    "像素行，不是样品层位——\n"
                    "      行数由图像高度与数字化密度决定，不能当作「样品数」引用。\n"
                )

            readme = (
                (
                    f"Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)\n"
                    f"================================================================\n"
                    f"Primary ROI: {primary_roi_name}\n"
                    f"Total ROIs: {len(roi_dfs)}\n\n" + rowset_notice + "\nFiles:\n"
                    f"data.csv             - Primary ROI dataset ({primary_roi_name})\n"
                    f"data/<roi>.csv       - Per-ROI isolated scientific CSV tables\n"
                    f"plot_strat.R         - R plotting script with sections for each ROI\n"
                    f"manifest.json        - Version metadata and ROI hierarchy\n"
                    + "\nUnits (authoritative copy: manifest.json -> column_units):\n"
                    + (
                        "\n".join(
                            f"  {roi_name}/{col_name}: {unit}"
                            for roi_name, cols in units_by_roi.items()
                            for col_name, unit in cols.items()
                        )
                        or "  (no columns)"
                    )
                    + "\n  % columns use rioja scale.percent = TRUE: each column is normalized"
                    + " to its own\n  maximum (a 0-100 axis per column), NOT a single shared"
                    + " 0-100 axis.\n"
                    + "  Non-% columns use scale.percent = FALSE: plotted on their own"
                    + " min..max range.\n"
                ).encode("utf-8")
                + b"\n"
                + CSV_MISSING_NOTICE
            )
            ti_readme = tarfile.TarInfo(name="README.txt")
            ti_readme.size = len(readme)
            ti_readme.mtime = int(time.time())
            tf.addfile(ti_readme, io.BytesIO(readme))

        tar_bytes = tar_bio.getvalue()
        proj = resolve_project_name(self, project_name)
        filename = format_export_filename(proj, "_project", "tar")
        if output_path:
            out_dir = os.path.dirname(os.path.abspath(output_path))
            os.makedirs(out_dir, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(tar_bytes)
            return {
                "path": os.path.abspath(output_path),
                "filename": filename,
                "size": len(tar_bytes),
                "success": True,
            }

        b64_tar = base64.b64encode(tar_bytes).decode("ascii")
        return {
            "filename": filename,
            "data": b64_tar,
            "tar_base64": b64_tar,
            "size": len(tar_bytes),
            "success": True,
        }

    def export_multi_xlsx(
        self,
        output_path: str | None = None,
        include_meta_sheets: bool = True,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
        include_readme: bool = True,
        project_name: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Exports calibrated multi-ROI sheets into an Excel workbook."""
        roi_dfs = self.get_roi_dataframes()
        paper_meta = getattr(self, "paper_metadata", {})
        age_depth_model = getattr(self, "age_depth_model", None)
        ensemble_tables = getattr(self, "ensemble_tables", [])

        age_depth_df = None
        if include_age_depth and age_depth_model is not None and roi_dfs:
            first_df = list(roi_dfs.values())[0]
            y_col = self._y_col_label()
            if y_col in first_df.columns:
                depths = first_df[y_col].tolist()
                if getattr(self, "primary_axis", None) == "age":
                    pred = age_depth_model.predict_depth(depths)
                    age_depth_df = pd.DataFrame(
                        {
                            "age": depths,
                            "depth_est": pred.get("depth_est", []),
                        }
                    )
                elif getattr(self, "primary_axis", None) == "depth":
                    pred = age_depth_model.predict_age(depths)
                    ad_data = {
                        "depth": depths,
                        "age_est": pred.get("age_est", []),
                        "age_lower": pred.get("age_lower", pred.get("age_min", [])),
                        "age_upper": pred.get("age_upper", pred.get("age_max", [])),
                    }
                    if getattr(self, "samples", None) and len(self.samples) == len(depths):
                        ad_data = {
                            "horizon_id": [
                                s.get("horizon_id", f"H{idx + 1:04d}")
                                for idx, s in enumerate(self.samples)
                            ],
                            **ad_data,
                        }
                    age_depth_df = pd.DataFrame(ad_data)
                if getattr(age_depth_model, "has_envelope", False) and not any(
                    t.get("name") == "Age_Uncertainty_U1000" for t in ensemble_tables
                ):
                    try:
                        ens = age_depth_model.generate_age_ensemble(
                            sample_depths=depths,
                            n_ensembles=1000,
                            name="Age_Uncertainty_U1000",
                        )
                        if ens and ens.get("data"):
                            ensemble_tables = list(ensemble_tables) + [ens]
                    except Exception:
                        pass

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t for t in ensemble_tables if t.get("name") in include_ensemble_names
            ]
        elif ensemble_tables:
            selected_ensembles = ensemble_tables

        xlsx_bytes = export_scientific_xlsx(
            meta_info=paper_meta,
            pollen_df=None,
            roi_dfs=roi_dfs,
            include_meta_sheets=include_meta_sheets,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
            include_readme=include_readme,
            output_path=output_path,
        )

        proj = resolve_project_name(self, project_name)
        filename = format_export_filename(proj, "_report", "xlsx")

        if output_path:
            # 写盘模式：文件已落盘，返回路径即可，不回传内容（避免同一份数据
            # 既写文件又塞进 JSON-RPC 响应）。
            return {
                "success": True,
                "filename": filename,
                "size_bytes": len(xlsx_bytes),
                "output_path": os.path.abspath(output_path),
                "base64": None,
                "data": None,
            }

        # 浏览器下载模式：**必须** base64。
        #
        # 旧实现这里返回 `"data": xlsx_bytes`（原始 bytes）。JSON-RPC 的
        # `json.dumps` 无法序列化 bytes，会抛
        # `TypeError: Object of type bytes is not JSON serializable`，服务端
        # 在写出响应前就崩掉并关闭连接，前端拿到 RemoteDisconnected —— 用户
        # 点「导出 Excel」既没有文件也没有报错（实测复现，见
        # docs/findings/production-gate-2026-10-23.md §7.3）。
        #
        # 字段名对齐同文件的 `export_multi_tar`（`tar_base64`）与
        # `export_advanced_xlsx`（`base64`）：前端 `ExportModal.ts` 判的就是
        # `res.base64`。`data` 保留为**同一个 base64 串**（而不是 bytes），
        # 让历史上读 `res.data` 的调用方继续拿到可序列化的等价内容。
        b64_xlsx = base64.b64encode(xlsx_bytes).decode("ascii")
        return {
            "success": True,
            "filename": filename,
            "size_bytes": len(xlsx_bytes),
            "output_path": None,
            "base64": b64_xlsx,
            "data": b64_xlsx,
        }

    def export_multi_lipd(
        self,
        output_path: str | None = None,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
        project_name: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Exports Linked Paleo Data (LiPD) JSON-LD structure with per-ROI measurement tables."""
        roi_dfs = self.get_roi_dataframes()
        paper_meta = getattr(self, "paper_metadata", {})
        age_depth_model = getattr(self, "age_depth_model", None)
        ensemble_tables = getattr(self, "ensemble_tables", [])

        age_depth_df = None
        if include_age_depth and age_depth_model is not None and roi_dfs:
            first_df = list(roi_dfs.values())[0]
            y_col = self._y_col_label()
            if y_col in first_df.columns:
                depths = first_df[y_col].tolist()
                if getattr(self, "primary_axis", None) == "age":
                    pred = age_depth_model.predict_depth(depths)
                    age_depth_df = pd.DataFrame(
                        {
                            "age": depths,
                            "depth_est": pred.get("depth_est", []),
                        }
                    )
                elif getattr(self, "primary_axis", None) == "depth":
                    pred = age_depth_model.predict_age(depths)
                    ad_data = {
                        "depth": depths,
                        "age_est": pred.get("age_est", []),
                        "age_lower": pred.get("age_lower", pred.get("age_min", [])),
                        "age_upper": pred.get("age_upper", pred.get("age_max", [])),
                    }
                    if getattr(self, "samples", None) and len(self.samples) == len(depths):
                        ad_data = {
                            "horizon_id": [
                                s.get("horizon_id", f"H{idx + 1:04d}")
                                for idx, s in enumerate(self.samples)
                            ],
                            **ad_data,
                        }
                    age_depth_df = pd.DataFrame(ad_data)

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t for t in ensemble_tables if t.get("name") in include_ensemble_names
            ]
        elif ensemble_tables:
            selected_ensembles = ensemble_tables

        col_units: dict[str, str] = {}
        taxa_names = getattr(self, "taxa_names", None) or []
        for idx, col in enumerate(getattr(self, "columns", [])):
            c_idx = col.get("col_index", idx)
            c_name = (
                taxa_names[c_idx]
                if (taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx])
                else (col.get("name") or col.get("species") or f"col{c_idx + 1:02d}")
            )
            col_units[c_name] = resolve_column_scale(self, col, c_idx).unit

        lipd_jsonld = export_lipd_jsonld(
            meta_info=paper_meta,
            pollen_df=None,
            roi_dfs=roi_dfs,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
            column_units=col_units,
            depth_unit=getattr(self, "depth_unit", "cm") or "cm",
        )

        # 返回口径与 export_advanced_xlsx 完全一致（同一套浏览器下载契约）：
        # - 写盘模式：落盘 .lpd 包，base64 为 None；
        # - 浏览器下载模式：**必须**给 base64（zip 字节），否则前端拿不到文件。
        #
        # 旧实现两条分支都只返回 lipd 字典、且写盘时写的是**纯 JSON 文本**：
        # 前端判 res.base64 恒为 undefined → 点「LiPD」既不下载也不报错（用户实测）。
        # 这里改用与 tar 出口同一个打包函数，保证 .lpd 是真 zip（PK 头）。
        pkg_bytes = export_lipd_package(lipd_jsonld, output_path=output_path)
        proj = resolve_project_name(self, project_name)
        filename = format_export_filename(proj, "_lipd", "lpd")
        if output_path:
            return {
                "success": True,
                "filename": filename,
                "size_bytes": len(pkg_bytes),
                "output_path": os.path.abspath(output_path),
                "base64": None,
                "lipd": lipd_jsonld,
            }

        b64 = base64.b64encode(pkg_bytes).decode("ascii")
        return {
            "success": True,
            "filename": filename,
            "size_bytes": len(pkg_bytes),
            "output_path": None,
            "base64": b64,
            "lipd": lipd_jsonld,
        }

    def calibrate_axes(
        self,
        y_marks: list[dict[str, float]],
        x_marks: list[dict[str, float]] | None = None,
        unit: str | None = None,
        primary_axis: str | None = None,
    ) -> dict[str, Any]:
        """Calibrates pixel coordinates into scientific depth/age and percentage units.

        ``primary_axis`` declares what the Y axis MEASURES, because that is not derivable
        from ``unit``: "cm"/"m" imply depth and "cal BP"/"ka" imply age only for the
        conventional spellings, and a wrong guess silently mis-maps every sample in the
        core. ``"depth"`` (default) keeps the existing behaviour untouched; ``"age"``
        makes the age-depth pipeline read sample ages off the Y axis and invert the
        age-depth model to recover their depths.
        """
        if not y_marks or len(y_marks) < 2:
            raise JsonRpcError(
                INVALID_PARAMS,
                "y_marks must contain at least 2 calibration points: [{'pixel': p, 'val': v}, ...]",
            )

        if primary_axis is None:
            resolved_axis = getattr(self, "primary_axis", "depth")
        else:
            candidate = str(primary_axis).strip().lower()
            if candidate.startswith("custom:"):
                custom_name = candidate.split("custom:", 1)[1].strip()
                if not re.match(r"^[a-z][a-z0-9_-]{0,31}$", custom_name):
                    raise JsonRpcError(
                        INVALID_PARAMS,
                        f"primary_axis 自定义标识符必须以字母开头且仅含小写字母/数字/下划线（收到 {custom_name!r}）。",
                    )
                resolved_axis = custom_name
            elif candidate in ("depth", "age", "code"):
                resolved_axis = candidate
            else:
                raise JsonRpcError(
                    INVALID_PARAMS,
                    f"primary_axis must be 'depth', 'age', 'code', or 'custom:<name>' (got {primary_axis!r}).",
                )

        y_pixels = np.array(
            [m.get("pixel") if "pixel" in m else m.get("px") for m in y_marks],
            dtype=float,
        )
        y_vals = np.array(
            [m.get("val") if "val" in m else m.get("value") for m in y_marks],
            dtype=float,
        )

        if np.all(y_pixels == y_pixels[0]):
            raise JsonRpcError(
                INVALID_PARAMS, "Y calibration pixels cannot all be identical"
            )

        slope_y, intercept_y = np.polyfit(y_pixels, y_vals, deg=1)
        self.y_scale = {"slope": float(slope_y), "intercept": float(intercept_y)}

        ordered = sorted(
            zip(y_pixels.tolist(), y_vals.tolist()), key=lambda pair: pair[0]
        )
        self.y_marks = [{"pixel": float(p), "val": float(v)} for p, v in ordered]
        self.depth_calib = {
            "top_px": float(ordered[0][0]),
            "top_cm": float(ordered[0][1]),
            "bottom_px": float(ordered[-1][0]),
            "bottom_cm": float(ordered[-1][1]),
            "marks": self.y_marks,
        }
        if unit:
            self.depth_unit = str(unit).strip() or self.depth_unit
        self.depth_calib["unit"] = self.depth_unit

        self.x_scales = {}
        if x_marks:
            col_groups: dict[int, list[dict[str, float]]] = {}
            for xm in x_marks:
                c_idx = int(xm.get("col_index", 0))
                col_groups.setdefault(c_idx, []).append(xm)

            for c_idx, marks in col_groups.items():
                if len(marks) >= 2:
                    xp = np.array([m["pixel"] for m in marks], dtype=float)
                    xv = np.array([m["val"] for m in marks], dtype=float)
                    sx, ix = np.polyfit(xp, xv, deg=1)
                    self.x_scales[c_idx] = {"slope": float(sx), "intercept": float(ix)}
                elif (
                    len(marks) == 1
                    and getattr(self, "columns", None)
                    and c_idx < len(self.columns)
                ):
                    col_start = self.columns[c_idx]["start"]
                    xp = float(marks[0]["pixel"])
                    xv = float(marks[0]["val"])
                    span = max(1.0, xp - col_start)
                    sx = xv / span
                    self.x_scales[c_idx] = {
                        "slope": float(sx),
                        "intercept": float(-sx * col_start),
                    }

        columns = getattr(self, "columns", [])
        for c_idx, col in enumerate(columns):
            if c_idx not in self.x_scales:
                col_w = max(1.0, col["end"] - col["start"])
                sx = 100.0 / col_w
                ix = -sx * col["start"]
                self.x_scales[c_idx] = {"slope": float(sx), "intercept": float(ix)}

        self.is_calibrated = True
        self.primary_axis = resolved_axis
        if self.depth_calib is not None:
            self.depth_calib["primary_axis"] = resolved_axis
        return {
            "status": "calibrated",
            "y_scale": self.y_scale,
            "x_scales": {str(k): v for k, v in self.x_scales.items()},
            # Echoed so the caller can confirm what the axis will be read as, instead of
            # trusting that its request was accepted.
            "primary_axis": resolved_axis,
            "unit": self.depth_unit,
            "marks": getattr(self, "y_marks", None),
        }

    def _primary_roi_sheet_name(self, frames: dict[str, Any]) -> str:
        """主 ROI 在 `get_roi_dataframes()` 里的表名（键是 ROI **名字**）。"""
        primary_id = getattr(self, "primary_roi_id", None)
        for roi in getattr(self, "rois", []) or []:
            if roi.get("id") == primary_id:
                name = roi.get("name", roi["id"])
                if name in frames:
                    return name
        return next(iter(frames))

    def _primary_roi_export_frame(
        self, *, strict: bool, legacy_column_name: bool = False
    ) -> Any:
        """`data.csv` 用的数据帧 = **主 ROI 的那一张表**（`get_roi_dataframes` 同一入口）。

        ## 为什么不能"把各 ROI 的列拼平"（2026-11-10 实测）

        旧实现 `_export_value_columns` 把逐列结果写进 `values[col_name]` —— 一个
        **按列名**索引的 dict。两个 ROI 里的同名属种列（`col01`…）互相覆盖：
        后一个 ROI 的值顶掉前一个。若顶上来的是未标定列（`read_column_values`
        对未标定整列给 `None`），用户看到的就是"CSV 整表全空，而 XLSX 有数"；
        同时表头数量少于真实列数，**整列数据静默消失**，且没有任何提示。

        列名不是唯一键，所以任何"按名字拼表"的做法都必然吞列。收敛到
        `get_roi_dataframes()` 后：本函数只取一张表，列名在表内天然唯一，
        其余 ROI 各出一份 `data/<roi>.csv`（XLSX/LiPD/TAR 本来就这么做）。

        ## 产品口径（与既有约定一致，不是新发明）

        `data.csv` = 主 ROI；这与 `frontend/e2e/from-zero-journey.spec.ts` 早已断言的
        「`data.csv` 逐字节等于 `data/<主 ROI>.csv`」一致，也与 HUD 文案
        「已将 <roi> 设为主有效区（对应导出 data.csv）」一致。
        """
        frames = self.get_roi_dataframes(
            strict=strict, legacy_column_name=legacy_column_name
        )
        if not frames:
            raise JsonRpcError(STATE_ERROR, "No ROI sheets available to export.")
        name = self._primary_roi_sheet_name(frames)
        frame = frames.get(name)
        if frame is None:
            frame = next(iter(frames.values()))
        return frame

    # ---- dataset 行集（与前端面板下拉同义，三种都从 column_points 取值）----

    #: `export_data(dataset=...)` 允许的取值，顺序即产品下拉顺序。
    #: 第一项是丰度矩阵表（samples 优先，无 samples 时退化为全像素行）。
    #: 第二项是拐点原始坐标长表（纯几何记录，不拼假插值矩阵）。
    #: 第三项是年代-深度关系表（独立模型预测表）。
    EXPORT_DATASETS = ("samples", "turning_points", "age_depth")

    def _dataset_frame(
        self,
        dataset: str | None,
        *,
        strict: bool,
        legacy_column_name: bool = False,
    ) -> Any:
        """按 dataset 产出一张表。

        `dataset=None` 或 `samples`：`_primary_roi_export_frame`（数据转录矩阵，
        CSV/TAR/XLSX/LiPD/预览统一走 `read_column_values` 真实读数，不插值）。
        `dataset="turning_points"`：离散拐点长表。
        `dataset="age_depth"`：独立的年代-深度关系表。
        """
        key = (dataset or "").strip().lower()
        if not key:
            return self._primary_roi_export_frame(
                strict=strict, legacy_column_name=legacy_column_name
            )
        # 参数错误必须先报：非法 dataset 名不该被"还没标定"这条前置条件盖住。
        if key not in self.EXPORT_DATASETS:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Unsupported dataset '{dataset}'. Use one of: {', '.join(self.EXPORT_DATASETS)}.",
            )
        if key == "age_depth":
            df = self.get_age_depth_dataframe()
            if df is None:
                raise JsonRpcError(
                    STATE_ERROR,
                    "当前工程没有年代-深度模型或年代数据，无法导出 age_depth 数据集。"
                    " No age-depth model or age data available for age_depth dataset.",
                )
            return df

        # 面板两张表都以「读数」为内容：一列都没标定 X 刻度时它们只能给出整表空白，
        # 那看起来像"这张图没数据"，而不是"你还没做步骤 6"。
        self._assert_export_column_scale()
        if key == "samples":
            return self._primary_roi_export_frame(
                strict=strict, legacy_column_name=legacy_column_name
            )
        # 只剩 turning_points（上面已校验取值）
        return self._turning_points_frame(legacy_column_name=legacy_column_name)

    #: 判"要不要优化"用的默认容差来源：直接读共识 RPC 的签名默认值，不在此另写
    #: 一个字面量（改了 RPC 默认值这里自动跟）。
    def _rowset_rows_estimate(self, dataset: str | None) -> int:
        """不建表就估出该 `dataset` 的行数（`export.getReadiness` 用）。

        只用于面板标题/身份的"共 N 行"，**不参与任何数值计算**；面板真正渲染的行数
        永远来自 `export.csv` 返回的那张表。两者应当一致，行集来源同一处
        （`_resolve_rowset` / `_control_point_rows` / 深度网格 / 拐点清单）。
        """
        key = (dataset or "").strip().lower()
        if key == "age_depth":
            df = self.get_age_depth_dataframe()
            return len(df) if df is not None else 0
        if not key or key == "samples":
            points = getattr(self, "column_points", None) or {}
            if points:
                return len(self._resolve_rowset().rows)
            # 逐行点还没补齐（刚打开的工程）：`export_data` 会先走
            # `_fill_missing_column_points` 的"整表为空 → 按控制点合成"分支，
            # 行集就是控制点的 row 并集。这里按同一规则估，否则标题写 1 行
            # （占位行 0）、表面却是控制点行数，标题与表又对不上。
            if any((getattr(self, "control_points", None) or {}).values()):
                return len(self._control_point_rows())
            return len(self._resolve_rowset().rows)
        # turning_points：一行 = 一个控制点
        return sum(
            len(pts) for pts in (getattr(self, "control_points", None) or {}).values()
        )

    def _default_tolerance_px(self) -> float | None:
        extractor = getattr(self, "samples_extract_consensus", None)
        if extractor is None:
            return None
        parameter = inspect.signature(extractor).parameters.get("tolerance_px")
        if parameter is None or not isinstance(parameter.default, (int, float)):
            return None
        return float(parameter.default)

    def _rowset_quality(
        self, rows_count: int, *, is_sample_rows: bool
    ) -> dict[str, Any]:
        """本次导出的**质量指标**：层位数 / 支持列数中位 / 当前 tolerance_px。

        为什么必须有（issue #100）：只报一个行数，用户无法判断"这 625 行该不该
        接受"。三个量给出来，他才有判断依据——

        - `rows` = 层位数（这个表有多少行）；
        - `support_columns_median` = 每层有多少列给了值的中位数（与画布上
          「8 列共振 / 1 列孤峰」同一口径；`samples` 侧优先读层位自带的
          `support_columns`，pixel_rows 侧现场按 `column_points` 数）；
        - `tolerance_px` = **产生这批层位时**的容差；没跑过共识（或该工程在这
          项诊断量落地之前生成）就是 `None`，不编造。`default_tolerance_px` 给出
          "改跑一次共识会按多少容差"，那是可选优化入口，不是前置条件。

        `rows_equal_roi_height`：行数恰等于 ROI 高度时，行集几乎一定来自逐像素
        数字化 —— 这是"625 行不是 625 个样品"最直接的物证。
        """
        samples = list(getattr(self, "samples", None) or [])
        points = getattr(self, "column_points", None) or {}

        support: list[int] = []
        support_source: str | None = None
        if is_sample_rows:
            from_samples = [
                int(sample["support_columns"])
                for sample in samples
                if sample.get("support_columns") is not None
            ]
            if from_samples:
                support = from_samples
                support_source = "samples.support_columns"
        else:
            per_row: dict[Any, int] = {}
            for pts in points.values():
                for point in pts:
                    if "row" in point:
                        per_row[point["row"]] = per_row.get(point["row"], 0) + 1
            if per_row:
                support = list(per_row.values())
                support_source = "column_points"

        roi_height = self._primary_roi_height_px()
        return {
            "rows": int(rows_count),
            "samples": len(samples),
            "support_columns_median": (float(np.median(support)) if support else None),
            "support_columns_min": (min(support) if support else None),
            "support_columns_max": (max(support) if support else None),
            "support_columns_n": len(support),
            "support_columns_source": support_source,
            # 产生这批层位用的容差：samples 未随层位落盘该字段（#83 之前生成的
            # 工程一个都没有），所以这里如实给 None，不拿默认值冒充实际值。
            "tolerance_px": None,
            "default_tolerance_px": self._default_tolerance_px(),
            "roi_height_px": roi_height,
            "rows_equal_roi_height": (
                roi_height is not None and int(rows_count) == int(roi_height)
            ),
        }

    def _primary_roi_height_px(self) -> int | None:
        """主 ROI 的像素高度（没有 ROI 记账时退回 `data_ylim`）。"""
        primary_id = getattr(self, "primary_roi_id", None)
        for roi in getattr(self, "rois", None) or []:
            ylim = roi.get("ylim")
            if ylim and (primary_id is None or roi.get("id") == primary_id):
                return int(round(float(ylim[1]) - float(ylim[0])))
        ylim = getattr(self, "data_ylim", None)
        if ylim:
            return int(round(float(ylim[1]) - float(ylim[0])))
        return None

    def _rowset_report(self, dataset: str | None, rows_count: int) -> dict[str, Any]:
        """本次导出**实际交付的行集身份**（RPC 返回 + 归档 manifest 共用一份）。

        `rows_count` 由调用方从真正产出的 DataFrame 传入，不在这里重算：判据是
        「面板行数 == 下载行数 == 归档行数 == `len(samples)`」，只认那张表。
        """
        key = (dataset or "").strip().lower()
        samples_count = len(getattr(self, "samples", None) or [])
        if key == "age_depth":
            is_sample = bool(samples_count > 0 and rows_count == samples_count)
            return {
                "provenance": "age_depth",
                "is_sample_rows": is_sample,
                "rows_count": int(rows_count),
                "samples_count": samples_count,
                "label": f"年代-深度关系表（{rows_count} 行）",
                "why": "基于年代-深度模型预测推算的层位年代与沉积速率数据。",
                "dataset": "age_depth",
                "quality": self._rowset_quality(rows_count, is_sample_rows=is_sample),
            }

        if key != "turning_points":
            report = self._resolve_rowset().as_dict()
            report["rows_count"] = int(rows_count)
            report["dataset"] = key or None
            report["quality"] = self._rowset_quality(
                rows_count, is_sample_rows=bool(report["is_sample_rows"])
            )
            return report

        provenance = ROWSET_TURNING_POINTS
        caption = "拐点原始坐标（长表）"
        why = (
            "一行 = 一个控制点（taxon / type / depth / value / x / y 六列），"
            "是点清单而不是层位矩阵。"
        )

        return {
            "provenance": provenance,
            "is_sample_rows": False,
            "rows_count": int(rows_count),
            "samples_count": samples_count,
            "label": caption,
            "why": why,
            "dataset": key,
            "quality": self._rowset_quality(rows_count, is_sample_rows=False),
        }

    def _export_column_scale_summary(self) -> tuple[int, int]:
        """(参与导出的列数, 其中已标定 X 刻度的列数)。

        判据与取数层同源：列集取 `column_points` 的键（= 表里真正会出现的列），
        「是否已标定」走 `resolve_column_scale(...).calibrated`，不在这里另写一套
        ——组级斜率（`value_per_px`）、列两点（`x_ticks`）、`x_scales` 三种来源的
        标定状态只有那一个函数判得准。
        """
        columns = getattr(self, "columns", []) or []
        indices = sorted((getattr(self, "column_points", None) or {}).keys())
        calibrated = 0
        for idx in indices:
            col_def = columns[idx] if idx < len(columns) else {}
            if resolve_column_scale(self, col_def, idx).calibrated:
                calibrated += 1
        return len(indices), calibrated

    def _assert_export_column_scale(self) -> None:
        """全列未标定 X 刻度时**拒绝**面板导出，而不是交付一张整表空白。

        `docs/ARCHITECTURE.md` §2：取不到数据就报错并停在原地，绝不返回替代数据。
        未标定的列在取数层（`read_column_values` 的 export profile）按既有 `NA`
        语义整列留空——单列如此是对的（缺的是那一列的刻度，不是整份数据）。但
        **所有列都没标定**时，三张表就只剩 `depth` 列有值，面板仍会把它渲染成
        「来源（N 行）· 预览、复制与 CSV 下载都按此行集导出」的正常表：用户看不出
        自己卡在步骤 6，只会以为"这张图没有数据"。

        所以只挡这一种情况：`calibrated == 0` 才拒绝；只要有一列标定过就照常导出
        （已标定列给真值，未标定列整列 NA），不因"有列没标定"整体拒绝。

        错误码沿用 `CALIBRATION_ERROR`（-32003）：这是同一种"标定缺失 → 拒绝导出"，
        新造错误码只会逼前端再写一套分支。区分两种缺什么，靠文案 + `data.reason`。
        """
        total, calibrated = self._export_column_scale_summary()
        if total == 0 or calibrated > 0:
            return
        raise JsonRpcError(
            CALIBRATION_ERROR,
            f"导出需要列刻度：{total} 列都没有 X 轴标度，请先完成步骤 6 的刻度齿标定，"
            "再回到这里导出。 Export requires column X-scale calibration (step 6): none "
            f"of the {total} columns has its tick endpoints yet.",
            {"reason": "column_scale", "columns": total, "calibrated": 0},
        )

    def _control_point_rows(self) -> list[int]:
        """`control_points` 里所有 row 的并集（去重排序）；缺失时退回 `column_points`。"""
        rows = {
            int(round(float(row)))
            for pts in (getattr(self, "control_points", None) or {}).values()
            for row in pts
        }
        if not rows:
            rows = {
                int(round(float(p["row"])))
                for pts in (getattr(self, "column_points", None) or {}).values()
                for p in pts
            }
        return sorted(rows)

    def _turning_points_frame(self, *, legacy_column_name: bool = False) -> Any:
        """离散拐点长表：每个**控制点**一行（taxon / type / <Y 轴量> / value / x / y）。

        行的来源是 `control_points` —— 用户眼里的"拐点"就是它们；
        `column_points` 是数字化出的逐行曲线（行数完全不同），两者不能混。

        第 3 列的列名跟随 Y 轴性质（`depth` / `age`），与矩阵表首列**同一来源**
        （`_y_col_label`）：它装的就是 Y 轴上那个量，写 `depth` 而装 `ka` 会让人误读。
        """
        y_col = self._y_col_label(legacy_column_name)
        columns = getattr(self, "columns", []) or []
        taxa_names = getattr(self, "taxa_names", []) or []
        y_scale = getattr(self, "y_scale", None)
        calibrated = bool(getattr(self, "is_calibrated", False)) and y_scale is not None
        slope = float(y_scale["slope"]) if calibrated else None
        intercept = float(y_scale["intercept"]) if calibrated else None

        records: list[dict[str, Any]] = []
        for c_idx, pts in sorted((getattr(self, "control_points", None) or {}).items()):
            col_def = columns[c_idx] if c_idx < len(columns) else {}
            name = (
                col_def.get("species")
                or col_def.get("name")
                or (taxa_names[c_idx] if c_idx < len(taxa_names) else f"col_{c_idx}")
            )
            scale = resolve_column_scale(self, col_def, c_idx)
            for row, x_px in sorted(pts.items(), key=lambda item: item[0]):
                row_px = float(row)
                depth = round(slope * row_px + intercept, 4) if calibrated else row_px
                value = read_column_values(scale, [float(x_px)], col_name=name)[0]
                records.append(
                    {
                        "taxon": name,
                        "type": "peak",
                        y_col: depth,
                        "value": value,
                        "x": float(x_px),
                        "y": row_px,
                    }
                )
        return pd.DataFrame(
            records, columns=["taxon", "type", y_col, "value", "x", "y"]
        )

    def export_data(
        self,
        format: str = "csv",
        strict: bool = False,
        output_path: str | None = None,
        dataset: str | None = None,
        legacy_column_name: bool = False,
        project_name: str | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Exports the calibrated data matrix to CSV or Parquet format.

        `dataset` 选择**行集**，与前端导出面板的下拉一一对应：
        `union_points`（控制点并集）/ `depth_grid`（标尺均匀层位）/
        `turning_points`（离散拐点长表）。**不传（None）保持既有行为**（samples 优先），
        `data.csv` / 工程包走的就是这条路，两种语义不能混。

        `legacy_column_name`（默认 `False`）：`True` 时把首列名强制回 `depth`，给按旧
        列名读的下游脚本一个过渡口。它**只改列名，一个数值都不动**，也不并列输出两列
        —— 两列会让人无法判断哪一列才是真的（issue #114）。
        """
        self._ensure_export_column_points()

        if not getattr(self, "column_points", None):
            raise JsonRpcError(STATE_ERROR, "No digitized data available to export.")

        fmt = format.lower()
        if fmt not in ("csv", "parquet"):
            raise JsonRpcError(
                INVALID_PARAMS,
                f"Unsupported export format '{format}'. Use 'csv' or 'parquet'.",
            )

        # 导出必须有深度：没有 Y 轴标定就没有 depth 列。任何"未标定也能出数"的形态
        # 要么把像素行号冒充深度，要么给下游一张 depth 全空的表——两者都在撒谎。
        # 步骤 3（Y 两点标定）本来就在导出之前，所以这个门槛在正常流程里不会被触发。
        # 「有深度标定」的判据要与取数层一致：`is_calibrated` 是派生属性，某些
        # 会话（测试/导入）只设了 `y_scale` 或 `depth_calib`。三者在同一次
        # calibrate_axes 里一起写入，这里任一个成立即视为已标定。
        _has_calibration = bool(
            getattr(self, "is_calibrated", False)
            or getattr(self, "y_scale", None)
            or (getattr(self, "depth_calib", None) or {}).get("top_cm") is not None
        )
        if not _has_calibration:
            raise JsonRpcError(
                CALIBRATION_ERROR,
                "导出需要深度标定：请先完成步骤 3 的 Y 轴两点标定（当前 is_calibrated=false）。"
                " Export requires depth calibration (two-point Y calibration).",
                # 前端据 `data.reason` 区分「缺深度标定」与「缺列刻度」两种 -32003：
                # 两者的补救动作在不同步骤（3 vs 6），靠模糊的 includes('标定') 判不出来。
                {"reason": "depth_calibration"},
            )

        # 取数收敛：不再自己拼行集与列名，直接用主 ROI 的那一张表（同一入口）。
        # `_export_rows_and_depths` / `_export_value_columns` 保留给单 ROI 的既有调用与
        # 各自的判据，但 CSV 不再走它们——两条链在"行集 + 列名 + 补点时机"上各写一套
        # 正是本缺陷的来源。
        df = self._dataset_frame(
            dataset, strict=strict, legacy_column_name=legacy_column_name
        )

        # 行集身份 + 判据门禁（issue #113）：`samples` 语义下**行数必须等于 samples
        # 条数**。这不再是"测试里比一比"，而是后端在交付前自己拒绝不一致的表。
        rows_count = len(df)
        rowset_report = self._rowset_report(dataset, rows_count)
        if (
            rowset_report["is_sample_rows"]
            and rows_count != rowset_report["samples_count"]
        ):
            raise JsonRpcError(
                EXPORT_ERROR,
                "行集与样品层位不一致：本工程 samples "
                f"{rowset_report['samples_count']} 条，但导出行数是 {rows_count}。"
                "两者必须相等（每一行对应一个样品层位），这份表不会交付。",
                {
                    "reason": "rowset_mismatch",
                    "samples": rowset_report["samples_count"],
                    "rows": rows_count,
                },
            )

        csv_string, saved_path = self._write_export_file(fmt, df, output_path)
        proj = resolve_project_name(self, project_name)
        filename = format_export_filename(proj, "_matrix", fmt)

        return {
            "format": fmt,
            "strict": strict,
            "filename": filename,
            "rows_count": rows_count,
            "columns_count": len(df.columns),
            "columns": list(df.columns),
            # 行集身份：`provenance` / `is_sample_rows` / `samples_count` / `why`。
            # 判据「这些行为什么算样品」的答案就在这里，不放注释里。
            "rowset": rowset_report,
            "data": self._json_safe_records(df.head(50)),
            "file_path": saved_path,
            "path": saved_path,
            "csv": csv_string,
            "csv_content": csv_string,
        }

    @staticmethod
    def _json_safe_records(frame: Any) -> list[dict[str, Any]]:
        """把 DataFrame 转成**合法 JSON** 的记录列表。

        pandas 的 NaN 经原生 records 转字典会原样留在 dict 里，而
        `json.dumps` 默认 `allow_nan=True` 会把它写成字面量 `NaN` —— 那不是合法
        JSON。浏览器的 `Response.json()` 会抛 SyntaxError，前端再把解析失败当成
        "与后端的连接已断开"，把人引去查网络（实测：导出面板打不开 + 连接断开提示，
        真实原因是某列某层位是 NaN）。

        这里把缺测转成 `None`（JSON `null`），与"缺测 ≠ 0"的既有语义一致。
        """
        records = (
            frame.astype(object).where(frame.notnull(), None).to_dict(orient="records")
        )
        # `inf`/`-inf` 也是非法 JSON（`allow_nan=False` 会抛 Out of range）。
        # 它们同样表示"这个数没有意义"，按缺测处理。
        return [
            {
                key: (
                    None
                    if isinstance(value, float) and not math.isfinite(value)
                    else value
                )
                for key, value in record.items()
            }
            for record in records
        ]

    def _fill_missing_column_points(self) -> list[str]:
        """补齐逐行点：**整表为空**时按老口径全补；**部分存在**时只补被掩膜作废的列。

        ## 两条路径的语义差别（不能合并）

        | 情形 | 行为 | 理由 |
        |:--|:--|:--|
        | `column_points` 整张表为空 | 有控制点 → 按控制点合成（**不**数字化）；否则全列现场数字化 | 既有口径：用户还没数字化时让「导得出」，而控制点是用户手调的权威 |
        | 表里有列、但某几列被作废 | **只**补那几列（控制点优先，其次数字化） | 未数字化的列必须保持 `NA`（README 缺测约定）；把"只数字化了 3 列"补成 17 列 = 伪造读数 |

        历史：本方法的前身是 `if not column_points:` 一整块，只有"全补"一条路；于是掩膜
        变更（`_invalidate_digitized_points` 清掉受影响列）之后永远不重建 ——
        `data.csv` 用旧点，用户看到"清除线无效"（`docs/findings/recon-20261117.md` §3.2）。

        ## 失败处理

        只收集原因**不抛**：导出侧统一报错（`_ensure_export_column_points`），QA 自行决定
        怎么呈现。绝不造一条水平直线兜底（那会把列左缘当读数冒充真实数据）。
        """
        columns = list(getattr(self, "columns", None) or [])
        if not columns:
            return []
        points = getattr(self, "column_points", None)
        if points is None:
            self.column_points = points = {}
        controls = getattr(self, "control_points", None) or {}
        invalidated = set(getattr(self, "_points_invalidated", None) or set())
        failures: list[str] = []

        def _points_from_controls(index: int, ctrls: dict) -> None:
            # 只给**真有控制点**的行建点：没有控制点的行是「这一列没有这一层的读数」，
            # 编一个 c_start 像素（旧行为）等于把它写成 0 丰度。
            points[index] = [
                {"row": int(round(float(row))), "x": float(x)}
                for row, x in sorted(ctrls.items())
            ]
            self.control_point_columns = set(
                getattr(self, "control_point_columns", set()) or set()
            ) | {index}

        def _digitize(col: dict) -> None:
            try:
                self.digitize(col["col_index"])
            except (ValueError, KeyError, RuntimeError, JsonRpcError) as exc:
                name = col.get("name") or f"col_index={col.get('col_index')}"
                failures.append(f"{name}（{exc}）")

        if not points:
            if any(controls.values()):
                for position, col in enumerate(columns):
                    _points_from_controls(
                        col.get("col_index", position),
                        controls.get(col.get("col_index", position), {}) or {},
                    )
                return []
            if getattr(self, "image", None) is None:
                raise JsonRpcError(
                    STATE_ERROR,
                    "没有任何可取数的列：既没有手工控制点，也没有可数字化的图像。"
                    "系统不会用等距采样的替代数据充数。",
                )
            for col in columns:
                _digitize(col)
            return failures

        for position, col in enumerate(columns):
            index = col.get("col_index", position)
            if index not in invalidated:
                continue
            ctrls = controls.get(index, {}) or {}
            if ctrls:
                _points_from_controls(index, ctrls)
            else:
                _digitize(col)
            invalidated.discard(index)
        self._points_invalidated = invalidated
        return failures

    def _ensure_export_column_points(self) -> None:
        """导出前补齐逐行点；补不出来的列**收集原因并统一报错**。"""
        if not getattr(self, "columns", None):
            if not getattr(self, "column_points", None):
                raise JsonRpcError(
                    STATE_ERROR,
                    "没有任何可取数的列：既没有手工控制点，也没有可数字化的图像。"
                    "系统不会用等距采样的替代数据充数。",
                )
            return
        failures = self._fill_missing_column_points()
        if failures:
            raise JsonRpcError(
                STATE_ERROR,
                "以下列无法从图像取数，且没有手工控制点可用："
                + "；".join(failures)
                + "。请先在步骤 5/7 数字化这些列，或补控制点后再导出。",
            )

    def _export_rows_and_depths(self) -> tuple[list[Any], list[Any]]:
        """导出用的行号序列与首列值 —— **薄封装**，行集来自 `_resolve_rowset`。

        本方法此前自己算一遍（samples 优先，否则各列逐行点并集），与
        `get_roi_dataframes` 里的另一份实现逐字重复：这就是 issue #113「面板与导出
        各算一套」的根。现在两者共用 `_resolve_rowset`（再往下共用 `_row_depths`），
        本方法只为既有调用方保留签名。

        差异备注：旧实现会把用户给定的 `samples[i]["depth"]` 再 round 到 4 位，
        现在**不再二次取整**（用户给的数原样用）；生产代码已无调用方（`export_data`
        走 `_dataset_frame`），此改动不影响任何出口的字节。
        """
        rowset = self._resolve_rowset()
        return list(rowset.rows), list(rowset.depths)

    def _export_value_columns(
        self, all_rows: list[int], strict: bool
    ) -> dict[str, Any]:
        """逐列把像素换算成读数：标度解析复用唯一入口，未标定的列整列给 None。

        缺控制点的行填 0 点（= 列左缘 + 轴线粗）而不是列左缘：画布绿线画在 0 点，
        基线与换算必须同源，否则这批行会落进轴内算出负值再被 clamp。
        """
        columns = getattr(self, "columns", [])
        taxa_names = getattr(self, "taxa_names", [])
        values: dict[str, Any] = {}
        for c_idx in sorted(self.column_points.keys()):
            col_def = columns[c_idx] if c_idx < len(columns) else {}
            if taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx]:
                col_name = taxa_names[c_idx]
            else:
                col_name = (
                    col_def.get("name")
                    or col_def.get("species")
                    or f"col{c_idx + 1:02d}"
                )

            values[col_name] = resolve_row_values(
                self,
                col_def,
                c_idx,
                all_rows,
                strict=strict,
                col_name=col_name,
            )
        return values

    def _write_export_file(
        self, fmt: str, df: Any, output_path: str | None
    ) -> tuple[str | None, str | None]:
        """落盘（csv / parquet）并返回内存中的 csv 文本与保存路径。"""
        csv_string: str | None = None
        saved_path: str | None = None

        if fmt == "csv":
            # 序列化只有一处（`serialize_export_frame`）：缺测写 `NA`、行尾 LF、
            # 首列 `-0.0` 规整三项口径与归档 `data.csv` **同源**。修前归档那三处
            # `to_csv` 没做 `-0.0` 规整，于是同一份工程面板给 `0.0`、归档给 `-0.0`，
            # 字节不同（见 `serialize_export_frame` 的说明）。
            csv_string = serialize_export_frame(df)
            if output_path:
                out_dir = os.path.dirname(os.path.abspath(output_path))
                os.makedirs(out_dir, exist_ok=True)
                # newline="" 必须显式给：行尾由 `to_csv(lineterminator="\n")` 单点决定，
                # 文本模式不能再翻译一遍。历史上漏了这个参数，pandas 写 "\r\n"、文本模式再把
                # "\n" 翻成 "\r\n"，落盘成了 "\r\r\n"（R/Excel 会把最后一列的值与列名带上
                # 控制符，实测 35 行的表按 splitlines() 数出 71 行）。现在两头都钉死：
                # 终止符只有一处来源（pandas 参数），文件层不做任何翻译。
                with open(output_path, "w", encoding="utf-8", newline="") as f:
                    f.write(csv_string)
                saved_path = os.path.abspath(output_path)
        elif fmt == "parquet":
            if not output_path:
                raise JsonRpcError(
                    EXPORT_ERROR,
                    "Parquet export requires 'output_path' parameter.",
                )
            try:
                out_dir = os.path.dirname(os.path.abspath(output_path))
                os.makedirs(out_dir, exist_ok=True)
                df.to_parquet(output_path, index=False)
                saved_path = os.path.abspath(output_path)
            except Exception as pe:  # noqa: BLE001
                raise JsonRpcError(
                    EXPORT_ERROR,
                    f"Failed to export parquet (ensure pyarrow/fastparquet is installed): {pe}",
                )
        return csv_string, saved_path

    def batch_set_taxa(self, names: list[str]) -> dict[str, Any]:
        """Batch sets or updates taxa names for diagram columns."""
        if not isinstance(names, list) or not all(
            isinstance(n, (str, int, float)) for n in names
        ):
            raise JsonRpcError(
                INVALID_PARAMS, "Parameter 'names' must be a list of strings."
            )

        clean_names = [str(n).strip() for n in names]
        self.taxa_names = clean_names

        columns = getattr(self, "columns", [])
        for idx, col in enumerate(columns):
            if idx < len(clean_names):
                col["name"] = clean_names[idx]
            else:
                col.setdefault("name", f"col_{idx}")

        return {
            "taxa": self.taxa_names,
            "count": len(self.taxa_names),
        }

    def apply_depth_grid(
        self,
        depths: list[float] | None = None,
        start_depth: float | None = None,
        end_depth: float | None = None,
        step: float | None = None,
    ) -> dict[str, Any]:
        """Generates and sets a global geological sampling depth grid."""
        if depths is not None:
            if not isinstance(depths, list) or len(depths) == 0:
                raise JsonRpcError(
                    INVALID_PARAMS, "'depths' must be a non-empty list of numbers."
                )
            try:
                grid = [round(float(d), 4) for d in depths]
            except (ValueError, TypeError) as e:
                raise JsonRpcError(INVALID_PARAMS, f"Invalid value in 'depths': {e}")
        elif start_depth is not None and end_depth is not None and step is not None:
            try:
                s = float(start_depth)
                e = float(end_depth)
                st = float(step)
            except (ValueError, TypeError) as ex:
                raise JsonRpcError(
                    INVALID_PARAMS, f"Invalid start_depth, end_depth, or step: {ex}"
                )

            if st <= 0:
                raise JsonRpcError(INVALID_PARAMS, "Parameter 'step' must be positive.")
            if s == e:
                grid = [round(s, 4)]
            elif e > s:
                num_steps = int(np.floor((e - s) / st + 1e-6))
                grid = [round(float(s + i * st), 4) for i in range(num_steps + 1)]
                if grid[-1] < e and abs(grid[-1] - e) < 1e-4:
                    grid[-1] = round(e, 4)
            else:
                num_steps = int(np.floor((s - e) / st + 1e-6))
                grid = [round(float(s - i * st), 4) for i in range(num_steps + 1)]
                if grid[-1] > e and abs(grid[-1] - e) < 1e-4:
                    grid[-1] = round(e, 4)
        else:
            raise JsonRpcError(
                INVALID_PARAMS,
                "Either 'depths' list or ('start_depth', 'end_depth', 'step') must be provided.",
            )

        self.depth_grid = grid
        return {
            "depths": self.depth_grid,
            "count": len(self.depth_grid),
        }

    def extract_grid_values(
        self,
        depths: list[float] | None = None,
    ) -> dict[str, Any]:
        """Extracts abundance curves across all taxa along the global depth grid."""
        if not getattr(self, "column_points", None):
            raise JsonRpcError(
                STATE_ERROR,
                "No digitized columns available. Please call core.digitize first.",
            )

        target_depths = (
            depths if depths is not None else getattr(self, "depth_grid", None)
        )
        if not target_depths:
            raise JsonRpcError(
                STATE_ERROR,
                "No depth grid available. Provide 'depths' or call core.applyDepthGrid first.",
            )

        try:
            clean_depths = [float(d) for d in target_depths]
        except (ValueError, TypeError) as e:
            raise JsonRpcError(INVALID_PARAMS, f"Invalid value in depths: {e}")

        col_indices = sorted(self.column_points.keys())
        taxa_labels = []
        columns = getattr(self, "columns", [])
        taxa_names = getattr(self, "taxa_names", [])
        for c_idx in col_indices:
            if taxa_names and c_idx < len(taxa_names):
                taxa_labels.append(taxa_names[c_idx])
            elif c_idx < len(columns) and "name" in columns[c_idx]:
                taxa_labels.append(columns[c_idx]["name"])
            else:
                taxa_labels.append(f"col_{c_idx}")

        matrix: list[list[float]] = []
        records: list[dict[str, Any]] = []

        is_calib = (
            getattr(self, "is_calibrated", False)
            and getattr(self, "y_scale", None) is not None
        )
        if is_calib:
            sy = self.y_scale["slope"]
            iy = self.y_scale["intercept"]
            if sy == 0:
                raise JsonRpcError(
                    CALIBRATION_ERROR, "Invalid y_scale slope (cannot be zero)."
                )

        for d in clean_depths:
            row_vals = []
            # `round(-1e-5, 4)` 得到 `-0.0`，写进 CSV 就是字面量 `-0.0`。
            # 下游 R/Excel/pandas 会把它读成**负深度**（严格校验的读入器直接报错），
            # 而它实际就是 0。加 0.0 把 `-0.0` 规整成 `0.0`。
            row_dict: dict[str, Any] = {"depth": round(d, 4) + 0.0}

            if is_calib:
                target_pixel_row = (d - iy) / sy
            else:
                target_pixel_row = d

            for c_idx, taxon in zip(col_indices, taxa_labels):
                pts = self.column_points[c_idx]
                if not pts:
                    # 这一列一个点都没有（控制点合成列里没有控制点的列）：网格上整列
                    # 无读数 → NA。np.interp 对空 points 会抛，也不该拿 0 充数。
                    row_vals.append(None)
                    row_dict[taxon] = None
                    continue
                p_rows = np.array([p["row"] for p in pts], dtype=float)
                p_x = np.array([p["x"] for p in pts], dtype=float)

                sort_idx = np.argsort(p_rows)
                # 网格采样保持**线性插值 + 端点 clamp**（既有语义，e2e `verify_straditize_pro`
                # 明确断言「已标定列必须给数」）。这不是本轮的改动点：把它改成「范围外 None」
                # 会让网格出现空洞，属独立的产品判断，已登记 §9。
                interp_x = float(
                    np.interp(target_pixel_row, p_rows[sort_idx], p_x[sort_idx])
                )

                col_def = columns[c_idx] if c_idx < len(columns) else {}
                scale = resolve_column_scale(self, col_def, c_idx)
                # 未标定列不出数：与 CSV / TAR / XLSX 同一个入口、同一套策略。
                # `px_to_value` 在 legacy/default 分支会用列宽归一估一个百分比——那是程序
                # 默认值不是读数；四路出口必须都按同一条判据给 None。
                val = read_column_values(scale, [interp_x], col_name=taxon)[0]

                row_vals.append(val)
                row_dict[taxon] = val

            matrix.append(row_vals)
            records.append(row_dict)

        return {
            "depths": [round(d, 4) for d in clean_depths],
            "taxa": taxa_labels,
            "matrix": matrix,
            "data": records,
            "rows_count": len(matrix),
            "columns_count": len(taxa_labels),
        }

    def export_csv(
        self,
        depths: list[float] | None = None,
        output_path: str | None = None,
        dataset: str | None = None,
        legacy_column_name: bool = False,
    ) -> str | dict[str, Any]:
        """Generates stratigraphic CSV: Y axis in 1st col, unobserved taxa = 0.0 (Section 八).

        `dataset` 透传给 `export_data`，取值见 `EXPORT_DATASETS`。
        不传（None）保持既有调用字节不变（samples 优先，即 `data.csv` 的语义）。

        `legacy_column_name` 同样透传：`True` 时首列名强制回 `depth`（只改名，不改值）。
        """
        res = self.export_data(
            "csv",
            output_path=output_path,
            dataset=dataset,
            legacy_column_name=legacy_column_name,
        )
        if output_path:
            return {"path": output_path, "success": True}
        return res.get("csv", "") if isinstance(res, dict) else str(res)

    def export_tar(self, output_path: str | None = None) -> dict[str, Any]:
        """Exports standard POSIX UStar tar project archive."""
        return self.project_save(output_path=output_path, format="tar")

    def export_r(
        self,
        output_path: str | None = None,
        settings: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> str | dict[str, Any]:
        """导出面板「R 脚本」按钮的 `plot_strat.R`：**按列量纲**分调用（与归档同一生成器）。

        ## 现场缺陷（recon-20261117，S5）

        本方法此前是一份**独立硬编码模板**：整表 `scale.percent = TRUE`，还把纵轴写死成
        `ylabel = 'Depth (cm)'`（本工程的轴是 `ka`）。于是同一份工程，三处给出的脚本互不相同：

        | 入口 | 修复前 | 修复后 |
        |:--|:--|:--|
        | 导出数据 tar（`export_multi_tar`） | 按量纲分两次调用 | 不变 |
        | 导出面板「R 脚本」（本方法） | 整表 `scale.percent = TRUE` | 与归档同源 |
        | 保存工程包（`project.save`） | 硬编码一行 `scale.percent=TRUE` | 与归档同源 |

        用户点「R 脚本」拿到的脚本把 A/C（比值）与 Concentration（259.74 value/px）都画成
        0–100 %，与 `data.csv` 必然对不上 —— 而这是导出面板上最显眼的那条路径。

        ## 形态

        保留"一次跑出 PDF"的便利（`pdf(...)` 包住调用 + `dev.off()`），但绘图调用段改为
        `strat_plot_script_lines` 生成，因此：`%` 列用 `scale.percent = TRUE`、非 `%` 列
        用该列自身量程（`add = TRUE` 叠加），与归档脚本口径一致。
        """
        from .export_docs import strat_plot_script_lines

        frame = self._primary_roi_export_frame(strict=False)
        names = [
            str(name)
            for name in list(getattr(frame, "columns", []))
            if str(name) != self._y_col_label()
        ]
        units = self._primary_roi_units_for(names)
        pct_cols = [name for name in names if is_percent_unit(units.get(name))]
        fixed_cols = [name for name in names if not is_percent_unit(units.get(name))]

        lines = [
            "# ==============================================================================",
            "# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script",
            "# Generated automatically by Straditize v2.0 (straditize pro)",
            "# Requires R package 'rioja' (install.packages('rioja'))",
            "# ==============================================================================",
            "",
            "if (!requireNamespace('rioja', quietly = TRUE)) {",
            "  install.packages('rioja', repos = 'https://cloud.r-project.org')",
            "}",
            "library(rioja)",
            "",
            "# 空单元格 = 该行不在这一列的取数窗口内（未测），**不是 0 丰度**；脚本保留 NA。",
            "# 下游统计若确实需要一个数，请显式处理（na.omit / 按缺失模型插补），不要替用户决定。",
            "# 列量纲来自工程里的列组单位：% 列按 rioja 的 scale.percent 各自归一，",
            "# 非 % 列（比值 / 浓度 / 粒数）按该列自身量程画，两种不能共用一把尺。",
            "",
            "pdf('stratigraphic_diagram.pdf', width = 12, height = 8)",
        ]
        lines.extend(
            strat_plot_script_lines(
                df_var="df",
                csv_filename="data.csv",
                roi_name=self._primary_roi_name(),
                pct_cols=pct_cols,
                fixed_cols=fixed_cols,
                units=units,
                exag_cols=self._roi_column_exaggerations().get(
                    self._primary_roi_name(), {}
                ),
                y_axis=(settings or {}).get("y_axis") if settings else None,
                primary_axis=getattr(self, "primary_axis", None),
                unit=getattr(self, "depth_unit", None),
            )
        )
        lines.extend(
            [
                "dev.off()",
                "message('Diagram successfully rendered: stratigraphic_diagram.pdf')",
                "",
            ]
        )
        r_script = "\n".join(lines)

        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(r_script)
            return {"path": output_path, "success": True}
        return r_script

    def export_bundle_zip(
        self,
        output_path: str | None = None,
        project_name: str | None = None,
        settings: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """一次性交付：`data.csv` + `plot_strat.R` + `plot_strat.jpg` + `README.txt`。

        ## 为什么是整包而不是单个 `.R`

        导出面板此前给的 `plot_strat.R` 里写着 `if (file.exists('data.csv'))`：用户只拿到
        脚本、没有 csv 时，整段绘图被**静默跳过**，产物是一张空 PDF。整包把脚本、数据、
        成品图放在一起，解压即可 `Rscript plot_strat.R`。

        ## 脚本形态

        - 无参可跑：`csv_path` / `out_path` 都有默认值，仍可用命令行覆盖
          （`Rscript plot_strat.R my.csv my.pdf`）；
        - 缺 `data.csv` 时 `stop()`，不再静默出空图；
        - 绘图调用段来自 `export_docs.strat_plot_script_lines`（唯一生成器），
          因此 % 列与非 % 列的量纲口径与归档脚本一致。

        ## 表头去 `\\r`

        列名尾部带 `\\r` 时，`read.csv` 后 `intersect()` 匹配不上，整列会被静默丢掉。
        写 csv 前统一 strip，脚本侧也用同一批干净列名。
        """
        import base64
        import tempfile
        import zipfile

        from .export_docs import CSV_MISSING_NOTICE, strat_plot_script_lines

        frame = self._primary_roi_export_frame(strict=False)
        frame = frame.rename(columns=lambda col: str(col).strip("\r\n"))
        names = [
            str(name)
            for name in list(frame.columns)
            if str(name) != self._y_col_label()
        ]
        units = self._primary_roi_units_for(names)
        pct_cols = [name for name in names if is_percent_unit(units.get(name))]
        fixed_cols = [name for name in names if not is_percent_unit(units.get(name))]
        csv_bytes = serialize_export_frame(frame).encode("utf-8")

        script_lines = [
            "# ==============================================================================",
            "# Straditize Pro - 地层图出图包（单 ROI）",
            "# 用法：与本文件同目录下 `Rscript plot_strat.R`（可选：Rscript plot_strat.R 表.csv 图.pdf）",
            "# 依赖：install.packages('rioja')",
            "# ==============================================================================",
            "args <- commandArgs(trailingOnly = TRUE)",
            "csv_path <- if (length(args) >= 1 && nzchar(args[[1]])) args[[1]] else 'data.csv'",
            "out_path <- if (length(args) >= 2 && nzchar(args[[2]])) args[[2]] else 'plot_strat.svg'",
            "if (!requireNamespace('rioja', quietly = TRUE)) stop('缺 rioja 包：install.packages(\"rioja\")')",
            "library(rioja)",
            # 设备用 cairo 的 svg：R 原生 pdf() 不嵌入字体、也没有 cairo 的抗锯齿，
            # 同一份数据出来的图与应用内 jpeg/svg 完全是两张脸（issue #105）。
            "grDevices::svg(out_path, width = 12, height = 8)",
        ]
        script_lines.extend(
            strat_plot_script_lines(
                df_var="df",
                csv_filename="data.csv",
                roi_name=self._primary_roi_name(),
                pct_cols=pct_cols,
                fixed_cols=fixed_cols,
                units=units,
                csv_expr="csv_path",
                require_file=True,
                exag_cols=self._roi_column_exaggerations().get(
                    self._primary_roi_name(), {}
                ),
                y_axis=(settings or {}).get("y_axis") if settings else None,
                primary_axis=getattr(self, "primary_axis", None),
                unit=getattr(self, "depth_unit", None),
            )
        )
        script_lines.extend(["dev.off()", "message('已输出: ', out_path)", ""])

        age_depth_df = self.get_age_depth_dataframe()
        ensemble_df = self.get_ensemble_dataframe()

        readme_lines = [
            "Straditize 出图包",
            "================",
            "",
            "文件：",
            "  data.csv       本工程的数字化数据（NA = 无数据，不是 0）",
        ]
        if age_depth_df is not None:
            readme_lines.append("  age_depth.csv  年代-深度关系与沉积速率（来自模型预测或层位标注）")
        if ensemble_df is not None:
            readme_lines.append("  ensemble.csv   蒙特卡洛年代集成矩阵（1000 组独立轨迹）")
        readme_lines.extend(
            [
                "  plot_strat.R   rioja::strat.plot 出图脚本（与本目录的 data.csv 配套）",
                "  plot_strat.jpg 同一份数据、同一生成器的成品图",
                "",
                "运行：",
                "  cd 到本目录，然后  Rscript plot_strat.R",
                "  可选覆盖：       Rscript plot_strat.R my.csv my.pdf",
                "",
            ]
        )
        # 行集身份进 README（issue #100）：`samples` 为空时这张 data.csv 的行是
        # 逐列像素行，不能当样品数引用；同一条记录也在 `core.exportData` 的
        # `rowset` 字段里，两边都来自 `_resolve_rowset`。
        rowset = self._resolve_rowset()
        quality = self._rowset_quality(
            rowset.rows_count, is_sample_rows=rowset.is_sample_rows
        )
        readme_lines.extend(
            [
                "data.csv 行集来源：",
                f"  来源(provenance) : {rowset.provenance}",
                f"  是否样品层位     : {rowset.is_sample_rows}",
                f"  行数 / samples   : {rowset.rows_count} / {rowset.samples_count}",
                f"  为什么           : {rowset.why}",
                "  质量指标（判断要不要重跑共识优化用）：",
                f"    支持列数中位   : {quality['support_columns_median']}"
                f"（n={quality['support_columns_n']}，"
                f"{quality['support_columns_min']}..{quality['support_columns_max']}）",
                f"    tolerance_px   : {quality['tolerance_px']}"
                f"（默认 {quality['default_tolerance_px']}）",
                f"    ROI 高度 / 行数: {quality['roi_height_px']} / {quality['rows']}"
                f"（行数==ROI 高度：{quality['rows_equal_roi_height']}）",
            ]
        )
        if not rowset.is_sample_rows:
            readme_lines.append(
                "  注意：本工程 samples 为空 → 这些行是逐列数字化的**像素行**，不是样品"
                "层位；行数由图像高度与数字化密度决定，不能当作「样品数」引用。"
            )
        readme_lines.append("")
        readme_lines.append(CSV_MISSING_NOTICE.decode("utf-8"))

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr("data.csv", csv_bytes)
            if age_depth_df is not None:
                bundle.writestr("age_depth.csv", serialize_export_frame(age_depth_df).encode("utf-8"))
            if ensemble_df is not None:
                bundle.writestr("ensemble.csv", serialize_export_frame(ensemble_df).encode("utf-8"))
            bundle.writestr("plot_strat.R", "\n".join(script_lines).encode("utf-8"))
            bundle.writestr("README.txt", "\n".join(readme_lines).encode("utf-8"))
            with tempfile.TemporaryDirectory(prefix="straditize-bundle-") as tmp_dir:
                shot_path = os.path.join(tmp_dir, "plot_strat.jpg")
                self.plot_render(format="jpeg", output_path=shot_path, settings=settings)
                with open(shot_path, "rb") as shot:
                    bundle.writestr("plot_strat.jpg", shot.read())

        payload = buffer.getvalue()
        proj = resolve_project_name(self, project_name)
        filename = format_export_filename(proj, "_plot_bundle", "zip")
        if output_path:
            with open(output_path, "wb") as f:
                f.write(payload)
            return {
                "success": True,
                "filename": filename,
                "output_path": os.path.abspath(output_path),
                "path": os.path.abspath(output_path),
                "mime": "application/zip",
                "size_bytes": len(payload),
            }

        return {
            "success": True,
            "filename": filename,
            "mime": "application/zip",
            "base64": base64.b64encode(payload).decode("ascii"),
            "size_bytes": len(payload),
        }

    def _primary_roi_name(self) -> str:
        """主 ROI 的显示名（与 `data.csv` 同一 ROI）。"""
        primary_id = getattr(self, "primary_roi_id", None)
        for roi in getattr(self, "rois", None) or []:
            if roi.get("id") == primary_id:
                return str(roi.get("name") or roi.get("id"))
        return "pollen"

    def _primary_roi_units_for(self, names: list[str]) -> dict[str, str]:
        """按**位置**把 `data.csv` 的列名对到列单位（不按名字查表：同名不同 ROI 会错位）。"""
        from .xscale import resolve_column_scale

        primary_id = getattr(self, "primary_roi_id", None)
        columns = [
            col
            for col in (getattr(self, "columns", None) or [])
            if col.get("roi_id") in (None, primary_id)
        ] or list(getattr(self, "columns", None) or [])
        units: dict[str, str] = {}
        for position, name in enumerate(names):
            unit = ""
            if position < len(columns):
                unit = str(
                    resolve_column_scale(self, columns[position], position).unit or ""
                )
            units[name] = unit
        return units

    def export_advanced_xlsx(
        self,
        output_path: str | None = None,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
        include_qc: bool = False,
        include_readme: bool = True,
    ) -> dict[str, Any]:
        """Exports calibrated pollen data and metadata into a publication-ready multi-sheet XLSX."""
        pollen_res = self.export_data("csv")
        pollen_csv = (
            pollen_res.get("csv") if isinstance(pollen_res, dict) else str(pollen_res)
        )
        y_col = self._y_col_label()
        pollen_df = pd.read_csv(io.StringIO(pollen_csv or f"{y_col}\n0\n"))

        age_depth_df = None
        if (
            include_age_depth
            and getattr(self, "age_depth_model", None) is not None
            and y_col in pollen_df.columns
        ):
            depths = pollen_df[y_col].tolist()
            if getattr(self, "primary_axis", None) == "age":
                pred = self.age_depth_model.predict_depth(depths)
                age_depth_df = pd.DataFrame(
                    {
                        "age": depths,
                        "depth_est": pred.get("depth_est", []),
                    }
                )
            elif getattr(self, "primary_axis", None) == "depth":
                pred = self.age_depth_model.predict_age(depths)
                pred = attach_windowed_rates(
                    pred, self.age_depth_model, getattr(self, "age_depth_rate_columns", [])
                )
                if getattr(self, "samples", None) and len(self.samples) == len(depths):
                    pred["horizon_id"] = [
                        s.get("horizon_id", f"H{idx + 1:04d}")
                        for idx, s in enumerate(self.samples)
                    ]
                age_depth_df = build_age_depth_frame(
                    pred,
                    getattr(self, "age_depth_rate_columns", []),
                    self.age_depth_model.age_unit,
                    self.age_depth_model.depth_unit,
                )

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t
                for t in getattr(self, "ensemble_tables", [])
                if t["name"] in include_ensemble_names
            ]

        xlsx_bytes = export_scientific_xlsx(
            meta_info=getattr(self, "paper_metadata", {}),
            pollen_df=pollen_df,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
            include_readme=include_readme,
            output_path=output_path,
        )

        b64 = base64.b64encode(xlsx_bytes).decode("ascii")
        return {
            "success": True,
            "size_bytes": len(xlsx_bytes),
            "output_path": os.path.abspath(output_path) if output_path else None,
            "base64": b64 if not output_path else None,
        }

    def export_advanced_lipd(
        self,
        output_path: str | None = None,
        include_age_depth: bool = True,
        include_ensemble_names: list[str] | None = None,
    ) -> dict[str, Any]:
        """Exports into Linked Paleo Data (LiPD) .lpd package compliant with LiPDverse."""
        pollen_res = self.export_data("csv")
        pollen_csv = (
            pollen_res.get("csv") if isinstance(pollen_res, dict) else str(pollen_res)
        )
        y_col = self._y_col_label()
        pollen_df = pd.read_csv(io.StringIO(pollen_csv or f"{y_col}\n0\n"))

        age_depth_df = None
        if (
            include_age_depth
            and getattr(self, "age_depth_model", None) is not None
            and y_col in pollen_df.columns
        ):
            depths = pollen_df[y_col].tolist()
            if getattr(self, "primary_axis", None) == "age":
                pred = self.age_depth_model.predict_depth(depths)
                age_depth_df = pd.DataFrame(
                    {
                        "age": depths,
                        "depth_est": pred.get("depth_est", []),
                    }
                )
            elif getattr(self, "primary_axis", None) == "depth":
                pred = self.age_depth_model.predict_age(depths)
                pred = attach_windowed_rates(
                    pred, self.age_depth_model, getattr(self, "age_depth_rate_columns", [])
                )
                if getattr(self, "samples", None) and len(self.samples) == len(depths):
                    pred["horizon_id"] = [
                        s.get("horizon_id", f"H{idx + 1:04d}")
                        for idx, s in enumerate(self.samples)
                    ]
                age_depth_df = build_age_depth_frame(
                    pred,
                    getattr(self, "age_depth_rate_columns", []),
                    self.age_depth_model.age_unit,
                    self.age_depth_model.depth_unit,
                )

        selected_ensembles = None
        if include_ensemble_names:
            selected_ensembles = [
                t
                for t in getattr(self, "ensemble_tables", [])
                if t["name"] in include_ensemble_names
            ]

        lipd_jsonld = export_lipd_jsonld(
            meta_info=getattr(self, "paper_metadata", {}),
            pollen_df=pollen_df,
            age_depth_df=age_depth_df,
            ensemble_tables=selected_ensembles,
        )
        pkg_bytes = export_lipd_package(lipd_jsonld, output_path=output_path)

        b64 = base64.b64encode(pkg_bytes).decode("ascii")
        return {
            "success": True,
            "size_bytes": len(pkg_bytes),
            "output_path": os.path.abspath(output_path) if output_path else None,
            "base64": b64 if not output_path else None,
        }
