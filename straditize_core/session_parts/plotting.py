"""Session mixin: 一键出图（本机 R + riojaPlot/rioja）。

数据来源只有一处：ExportMixin._primary_roi_export_frame()，也就是 data.csv 那一张表。
出图不另造格式、不重新插值——用户导出的数就是画出来的数。

## 产物去向

默认**不落盘**：图以 data URL 交回前端，由用户决定「看图」还是「下载」。
以前默认写到 `~/.straditize/plots`，用户点完按钮只得到一句路径，人还得自己去那个
隐藏目录里找——那不是「出图」，是「出文件路径」。只有显式传 `output_path` 才落盘。
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from ..plotting import detect_rscript
from ..protocol import EXPORT_ERROR, INVALID_PARAMS, STATE_ERROR, JsonRpcError
from ..strat_plot import (
    SUPPORTED_PLOT_FORMATS,
    resolve_settings,
    read_as_data_url,
    render_strat_diagram,
)

#: R 缺失 / R 失败时给用户的下一步动作，随错误消息一起返回。
R_MISSING_HINT = (
    "本机出图需要 R + rioja 包：安装 R（https://cran.r-project.org/）后，"
    "在 R 里执行 install.packages('rioja')；要在图上启用 Italicise / Break long / "
    "Exaggeration / Min-max 这些开关，还需 install.packages('riojaPlot', "
    "repos = 'https://nsj3.r-universe.dev')；或在设置页填写 Rscript 路径。"
)


class PlottingMixin:
    """一键出图：探测 R、用导出数据画图、把图交回前端。"""

    def _plot_output_dir(self) -> Path:
        """显式要求落盘时的默认目录（~/.straditize/plots）。不传 output_path 时不用它。"""
        return Path(os.path.expanduser("~")) / ".straditize" / "plots"

    def _plot_source_frame(self) -> Any:
        """出图用的数据帧 = data.csv 的那一张表（与四路导出同源）。"""
        return self._primary_roi_export_frame(strict=False)

    def plot_detect_r(self) -> dict[str, Any]:
        """探测 Rscript，并把配置值 / 候选列表 / 缺什么如实报给前端。"""
        from ..config import load_config

        cfg = load_config()
        configured = str(cfg.get("rscript_path") or "")
        report = detect_rscript(configured)
        report["configured"] = configured
        report["available"] = bool(report.get("path"))
        report["hint"] = None if report.get("path") else R_MISSING_HINT
        return report

    def plot_render(
        self,
        format: str = "jpeg",
        output_path: str | None = None,
        title: str | None = None,
        settings: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """用本机 R 出图，默认把图以 data URL 返回（不落盘）。

        失败一律报错并停在原地（附可执行提示），不产出空白图：R 缺失给
        data.reason=r_missing，R 跑挂给 data.reason=r_failed，前端据此给补救动作。
        """
        fmt = (format or "jpeg").lower().lstrip(".")
        if fmt not in SUPPORTED_PLOT_FORMATS:
            raise JsonRpcError(
                INVALID_PARAMS,
                "不支持的出图格式，可用：" + ", ".join(SUPPORTED_PLOT_FORMATS),
            )

        try:
            merged, setting_warnings = resolve_settings(settings)
        except ValueError as exc:
            raise JsonRpcError(INVALID_PARAMS, str(exc)) from exc
        if title is not None:
            merged["title"] = title

        detected = self.plot_detect_r()
        if not detected.get("path"):
            raise JsonRpcError(
                EXPORT_ERROR,
                str(detected.get("error") or "未找到 Rscript。") + " " + R_MISSING_HINT,
                {
                    "reason": "r_missing",
                    "candidates": detected.get("candidates", []),
                    "configured": detected.get("configured", ""),
                },
            )

        frame = self._plot_source_frame()
        if frame is None or len(getattr(frame, "columns", [])) < 2 or len(frame) == 0:
            raise JsonRpcError(
                STATE_ERROR,
                "没有可绘制的数据：先把列数字化并完成步骤 3（深度标定）与步骤 6（列刻度）。",
            )

        # 过滤非属种列（如 horizon_id, age, age_min/max, age_lower/upper, depth_est, sample_code 等），防止年代数值与层位主键污染图谱
        _non_taxa = {
            "horizon_id",
            "age",
            "age_est",
            "age_min",
            "age_max",
            "age_lower",
            "age_upper",
            "age_lower_95",
            "age_upper_95",
            "depth",
            "depth_est",
            "sample_code",
            "sample_id",
            "row_px",
        }
        _valid_cols = [frame.columns[0]] + [
            c
            for c in frame.columns[1:]
            if str(c).strip().lower() not in _non_taxa
        ]
        if len(_valid_cols) > 1:
            frame = frame[_valid_cols]

        # plot_scale_mode 的列名必须真在导出表里：拼错的列名会让「固定量程」静默不生效，
        # 用户以为调过了而图上什么都没变。这里当场拒绝并列出可用列。
        scale_modes = merged.get("plot_scale_mode") or {}
        table_columns = [str(col) for col in frame.columns]
        unknown_scale_cols = sorted(set(scale_modes) - set(table_columns))
        if unknown_scale_cols:
            raise JsonRpcError(
                INVALID_PARAMS,
                "plot_scale_mode 指定了导出表里没有的列："
                + ", ".join(unknown_scale_cols)
                + "（可用列："
                + ", ".join(table_columns)
                + "）",
            )

        # 拼接法：按「组」切段 —— 组是用户定义的量纲/形态归属，比单位字符串可靠。
        # 列数最多的组当主块（% 块），其余组各自成段；列序在主块之前的放左、之后的放右。
        _PCT_UNITS = ("%", "％", "percent", "pct")
        from .xscale import resolve_column_scale

        _taxa = getattr(self, "taxa_names", None) or []
        _resolved: list[tuple[str, str, str]] = []
        _exag_cols: dict[str, float] = {}
        for _i, _col in enumerate(getattr(self, "columns", []) or []):
            _c = int(_col.get("col_index", _i))
            _nm = (
                _taxa[_c]
                if (_taxa and _c < len(_taxa) and _taxa[_c])
                else (_col.get("name") or _col.get("species") or f"col{_c + 1:02d}")
            )
            _scale = resolve_column_scale(self, _col, _c)
            _unit = str(_scale.unit or "")
            _gid = str(_col.get("x_group_id") or "g0")
            _resolved.append((str(_nm), _unit, _gid))
            # 逐列形态：画布上每列可以是 area / bar / line / symbol，出图必须同口径。
            # 默认值是 "area"（= 填充 + 条纹 + 轮廓，与全局开关一致），仍按列写出去，
            # 免得 R 侧再猜「这一列没写是不是没设」。
            merged[f"plot_type.{_nm}"] = str(_scale.plot_type or "area")
            if _scale.exaggeration_mult is not None and _scale.exaggeration_mult > 1.0:
                _exag_cols[str(_nm)] = float(_scale.exaggeration_mult)
                merged[f"exag.{_nm}"] = str(_scale.exaggeration_mult)

        if _exag_cols:
            merged["exaggeration"] = True
            merged["exag_mult"] = next(iter(_exag_cols.values()))
        else:
            merged["exaggeration"] = False

        _cols = [str(c) for c in frame.columns[1:]]
        _resolved = [t for t in _resolved if t[0] in _cols]
        # 分段口径。三种情景由 `plot_scale_mode` 决定，不再让「列量程」静默失效：
        #   A. 全是 normalize（没有 fixed）→ **不分段**，单块用 scale.percent 归一；
        #   B. 混排 → `% 块`（normalize 列）+ 侧段（fixed 列各成段，按自身量程画）；
        #   C. 全是 fixed → 没有 `% 块`，所有列都在侧段（R 侧 pct 为空）。
        # 没有显式 `plot_scale_mode` 时退回「按组切段」的老口径（组数 ≥2 才分段）。
        _scale_modes = {
            str(_k): str(_v).lower()
            for _k, _v in (merged.get("plot_scale_mode") or {}).items()
        }
        _order = [t[0] for t in _resolved]
        _fixed_cols = [_n for _n in _order if _scale_modes.get(_n) == "fixed"]
        _main_names = [_n for _n in _order if _n not in _fixed_cols]
        _seg_flag = merged.get("plot_segments")
        _by_gid: dict[str, list[str]] = {}
        _main_gid: str | None = None
        if _fixed_cols:
            for _n, _u, _g in _resolved:
                if _n in _fixed_cols:
                    _by_gid.setdefault(_g, []).append(_n)
            _seg_on = True if _seg_flag is None else bool(_seg_flag)
            _main_first = _order.index(_main_names[0]) if _main_names else len(_order)
        else:
            for _n, _u, _g in _resolved:
                _by_gid.setdefault(_g, []).append(_n)
            # 显式给了 plot_scale_mode 且没有 fixed 列 → 情景 A：不分段（全部按归一画）。
            _auto_seg = (len(_by_gid) > 1) and not _scale_modes
            _seg_on = _auto_seg if _seg_flag is None else bool(_seg_flag)
            if _by_gid:
                _main_gid = max(_by_gid, key=lambda g: len(_by_gid[g]))
                _main_first = min(_order.index(x) for x in _by_gid[_main_gid])
            else:
                _main_first = 0
        if _seg_on and _by_gid:
            if not _main_names:
                # 情景 C（全 fixed）：**列等宽**。riojaPlot 的面板宽度 ∝ 各列 max，
                # 而 `graph.widths` 在这条路径上不生效（实测设进 style 与当直接参数传都
                # 无效，产物字节不变）。所以让**每列自成一个段**：段宽我们说了算
                # （avail / 列数），单列段必然铺满，于是所有列等宽。
                _by_gid = {
                    f"{_g}__{_n}": [_n] for _n, _u, _g in _resolved if _n in _fixed_cols
                }
            for _g, _names in _by_gid.items():
                if not _fixed_cols and _g == _main_gid:
                    continue
                _first = min(_order.index(x) for x in _names)
                _pre = "seg_left." if _first < _main_first else "seg_right."
                for _n in _names:
                    merged[_pre + _g + "." + _n] = "1"
        with tempfile.TemporaryDirectory(prefix="straditize-plot-") as tmp_dir:
            csv_tmp = Path(tmp_dir) / "plot_input.csv"
            frame.to_csv(csv_tmp, index=False, na_rep="NA", lineterminator="\n")
            out_tmp = Path(tmp_dir) / ("strat_plot." + fmt)

            try:
                info = render_strat_diagram(
                    csv_path=str(csv_tmp),
                    out_path=str(out_tmp),
                    rscript=str(detected["path"]),
                    settings=merged,
                    # Y 轴标题跟随轴的实际性质（issue #114）：`depth`/`cm` → `Depth (cm)`，
                    # `age`/`ka` → `Age (ka BP)`。派生逻辑只在 `strat_plot._y_axis_label`。
                    primary_axis=getattr(self, "primary_axis", None),
                    unit=getattr(self, "depth_unit", None),
                )
            except RuntimeError as exc:
                raise JsonRpcError(
                    EXPORT_ERROR,
                    str(exc) + " " + R_MISSING_HINT,
                    {
                        "reason": "r_failed",
                        "rscript": detected.get("path"),
                    },
                ) from exc

            mime, data_url = read_as_data_url(info["path"], fmt)

            persisted: str | None = None
            if output_path:
                target = Path(output_path).expanduser()
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(info["path"], target)
                persisted = str(target.resolve())

        return {
            "success": True,
            "engine": info["engine"],
            "format": fmt,
            "mime": mime,
            "size_bytes": info["size_bytes"],
            # 图就在这次响应里：前端要么 <img src>，要么给 <a download>。
            "data_url": data_url,
            "path": persisted,
            "rows_count": int(len(frame)),
            "columns_count": int(len(frame.columns) - 1),
            "settings": info["settings"],
            "warnings": info["warnings"] + setting_warnings,
            "unsupported": info["unsupported"],
            "rscript": info["rscript"],
            "source": "data.csv（主 ROI 当前导出表）",
        }
