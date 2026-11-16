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

        # 列宽 ∝ 原图列宽（endX - startX）；用户显式给了 plot_column_widths 就用用户的。
        if not merged.get("plot_column_widths"):
            merged["plot_column_widths"] = self._column_source_widths(frame)

        with tempfile.TemporaryDirectory(prefix="straditize-plot-") as tmp_dir:
            csv_tmp = Path(tmp_dir) / "plot_input.csv"
            frame.to_csv(csv_tmp, index=False, na_rep="NA")
            out_tmp = Path(tmp_dir) / ("strat_plot." + fmt)

            try:
                info = render_strat_diagram(
                    csv_path=str(csv_tmp),
                    out_path=str(out_tmp),
                    rscript=str(detected["path"]),
                    settings=merged,
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

