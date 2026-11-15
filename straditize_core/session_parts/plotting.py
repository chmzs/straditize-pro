"""Session mixin: 一键出图（本机 R + rioja::strat.plot）。

数据来源只有一处：ExportMixin._primary_roi_export_frame()，也就是 data.csv 那一张表。
出图不另造格式、不重新插值——用户导出的数就是画出来的数。
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path
from typing import Any

from ..plotting import detect_rscript, render_with_rioja
from ..protocol import EXPORT_ERROR, INVALID_PARAMS, STATE_ERROR, JsonRpcError

#: riojaPlot 的公开实例：兜底路线，需要用户手动上传 CSV（不是本地出图）。
RIOJA_PLOT_URL = "https://nsj3.shinyapps.io/riojaPlot/"

SUPPORTED_PLOT_FORMATS = ("pdf", "png", "svg")

#: R 缺失 / R 失败时给用户的下一步动作，随错误消息一起返回。
R_MISSING_HINT = (
    "本机出图需要 R + rioja 包：安装 R（https://cran.r-project.org/）后，"
    "在 R 里执行 install.packages('rioja')；或在设置页填写 Rscript 路径。"
    "也可以改用 riojaPlot 网页：把导出的 CSV 手动上传到 " + RIOJA_PLOT_URL
)


class PlottingMixin:
    """一键出图：探测 R、用导出数据画图、返回产物路径。"""

    def _plot_output_dir(self) -> Path:
        """默认落盘目录：~/.straditize/plots（每次一个带时间戳的文件）。"""
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
        format: str = "pdf",
        output_path: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        """用本机 R 把当前导出数据画成 PDF/PNG/SVG。

        失败一律报错并停在原地（附可执行提示），不产出空白图：R 缺失给
        data.reason=r_missing，R 跑挂给 data.reason=r_failed，前端据此给补救动作。
        """
        fmt = (format or "pdf").lower().lstrip(".")
        if fmt not in SUPPORTED_PLOT_FORMATS:
            raise JsonRpcError(
                INVALID_PARAMS,
                "不支持的出图格式，可用：" + ", ".join(SUPPORTED_PLOT_FORMATS),
            )

        detected = self.plot_detect_r()
        if not detected.get("path"):
            raise JsonRpcError(
                EXPORT_ERROR,
                str(detected.get("error") or "未找到 Rscript。") + " " + R_MISSING_HINT,
                {
                    "reason": "r_missing",
                    "candidates": detected.get("candidates", []),
                    "configured": detected.get("configured", ""),
                    "rioja_plot_url": RIOJA_PLOT_URL,
                },
            )

        frame = self._plot_source_frame()
        if frame is None or len(getattr(frame, "columns", [])) < 2 or len(frame) == 0:
            raise JsonRpcError(
                STATE_ERROR,
                "没有可绘制的数据：先把列数字化并完成步骤 3（深度标定）与步骤 6（列刻度）。",
            )

        if output_path:
            out_path = Path(output_path).expanduser()
        else:
            stamp = time.strftime("%Y%m%d_%H%M%S")
            out_path = self._plot_output_dir() / ("strat_plot_" + stamp + "." + fmt)

        csv_tmp = Path(tempfile.gettempdir()) / ("straditize_plot_" + str(os.getpid()) + ".csv")
        frame.to_csv(csv_tmp, index=False, na_rep="NA")

        try:
            info = render_with_rioja(
                csv_path=str(csv_tmp),
                out_path=str(out_path),
                rscript=str(detected["path"]),
                title=(title or "Stratigraphic diagram"),
            )
        except RuntimeError as exc:
            raise JsonRpcError(
                EXPORT_ERROR,
                str(exc) + " " + R_MISSING_HINT,
                {
                    "reason": "r_failed",
                    "rscript": detected.get("path"),
                    "rioja_plot_url": RIOJA_PLOT_URL,
                },
            ) from exc

        return {
            "success": True,
            "engine": info["engine"],
            "format": fmt,
            "path": info["path"],
            "size_bytes": info["size_bytes"],
            "rows_count": int(len(frame)),
            "columns_count": int(len(frame.columns) - 1),
            "rscript": info["rscript"],
            "r_script": info["r_script"],
            "source": "data.csv（主 ROI 当前导出表）",
        }
