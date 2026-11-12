"""Export session mixin (T10: Multi-ROI chunked scientific tabular exports).

Strictly adheres to:
- Frozen Contracts v1.3 §2.6 (primary_roi_id) & §4.2 (Export Mapping);
- Redesign Specification §4.2 & §5.3;
- POSIX UStar .tar archiving with data/<roi>.csv per ROI and data.csv matching primary_roi_id.
"""

from __future__ import annotations

from .export_docs import CSV_MISSING_NOTICE

import base64
import io
import json
import math
import os
import tarfile
import time
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
from .agedepth import attach_windowed_rates, build_age_depth_frame
from .xscale import read_column_values, resolve_column_scale



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


class ExportMixin:
    """Session mixin for multi-ROI chunked tabular exports (CSV/TSV/LiPD/XLSX/TAR)."""

    def _init_export(self) -> None:
        """Initialize export state."""
        pass

    def get_roi_dataframes(self, strict: bool = False) -> dict[str, pd.DataFrame]:
        """Construct a pandas DataFrame for each ROI.

        `strict` 透传给 `read_column_values`：CSV 与 XLSX/LiPD/TAR 共用本入口后，
        这个开关必须能一路传到唯一的换算函数，否则"严格模式"只剩一半语义。
        """
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
        is_calibrated = getattr(self, "is_calibrated", False)
        y_scale = getattr(self, "y_scale", None)

        roi_dfs: dict[str, pd.DataFrame] = {}

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
                    depths = [s.get("depth", s.get("row_px")) for s in samples]
                    roi_dfs[roi_name] = pd.DataFrame({"depth": depths})
                else:
                    roi_dfs[roi_name] = pd.DataFrame({"depth": []})
                continue

            if samples:
                row_list = [int(round(s.get("row_px", 0))) for s in samples]
                depth_list = [s.get("depth") for s in samples]
                if is_calibrated and y_scale:
                    depth_list = [
                        d
                        if d is not None
                        else round(
                            y_scale.get("slope", 0.0) * r
                            + y_scale.get("intercept", 0.0),
                            4,
                        )
                        for r, d in zip(row_list, depth_list)
                    ]
            else:
                c_indices = {c.get("col_index", idx) for idx, c in enumerate(roi_cols)}
                pts_rows = set()
                for c_idx in c_indices:
                    if c_idx in column_points:
                        pts_rows.update(p["row"] for p in column_points[c_idx])
                row_list = sorted(pts_rows) if pts_rows else [0]
                if is_calibrated and y_scale:
                    depth_list = [
                        round(
                            y_scale.get("slope", 0.0) * r
                            + y_scale.get("intercept", 0.0),
                            4,
                        )
                        for r in row_list
                    ]
                else:
                    depth_list = row_list

            data_dict: dict[str, Any] = {"depth": depth_list}

            taxa_names = getattr(self, "taxa_names", None) or []
            for idx, col in enumerate(roi_cols):
                c_idx = col.get("col_index", idx)
                if taxa_names and c_idx < len(taxa_names) and taxa_names[c_idx]:
                    col_name = taxa_names[c_idx]
                else:
                    col_name = (
                        col.get("name") or col.get("species") or f"col{c_idx + 1:02d}"
                    )

                scale = resolve_column_scale(self, col, c_idx)
                pts = column_points.get(c_idx, [])
                p_dict = {p["row"]: p["x"] for p in pts}
                # 缺控制点填 0 点、未标定整列不给数——两个决定都在 read_column_values 里，
                # 这里只提供像素序列（与 CSV/网格/QA 同一个入口）。
                baseline_px = float(scale.abs_px0)
                data_dict[col_name] = _mask_outside_window(
                    row_list,
                    read_column_values(
                        scale,
                        [p_dict.get(r, baseline_px) for r in row_list],
                        strict=strict,
                        col_name=col_name,
                    ),
                    _column_row_window(self, col, c_idx),
                    p_dict,
                )

            roi_dfs[roi_name] = pd.DataFrame(data_dict)

        return roi_dfs

    def get_export_readiness(self) -> dict[str, Any]:
        """Compute the Export Readiness checklist for all ROIs.

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

            if name_source == "default" or len(cols) == 0:
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
        }

    def export_multi_tar(self, output_path: str | None = None) -> dict[str, Any]:
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

        manifest = {
            "version": "2.0.0",
            "tool": "straditize pro",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "schema_version": "2.0",
            "primary_roi_id": primary_roi_id,
            "primary_roi": primary_roi_name,
            "rois": [r.get("name", r.get("id")) for r in rois],
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
            roi_meta_by_name = {r.get("name"): r for r in (getattr(self, "rois", None) or [])}
            unnamed_seq = 0
            for roi_name, df in roi_dfs.items():
                # 未标定列整列不给数：写 CSV 时用显式 `NA`，不要留空。
                # 空单元格在下游读入器里既可能是缺失也可能是 0，`NA` 是无歧义的
                # "没有这个数"（避免虚假数据）。
                csv_str = df.to_csv(index=False, na_rep="NA")
                csv_bytes = csv_str.encode("utf-8")

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

                r_scripts.append(f"# --- ROI: {roi_name} ---")
                r_scripts.append(f"if (file.exists('{csv_filename}')) {{")
                r_scripts.append(
                    f"  df_{roi_name} <- read.csv('{csv_filename}', check.names = FALSE)"
                )
                r_scripts.append(f"  if (ncol(df_{roi_name}) > 1) {{")
                r_scripts.append(
                    f"    strat.plot(df_{roi_name}[-1], yvar = df_{roi_name}[[1]], y.rev = TRUE, scale.percent = TRUE, plot.line = TRUE, title = '{roi_name}')"
                )
                r_scripts.append("  }")
                r_scripts.append("}\n")

            if not primary_csv_bytes and roi_dfs:
                primary_csv_bytes = (
                    list(roi_dfs.values())[0]
                    .to_csv(index=False, na_rep="NA")
                    .encode("utf-8")
                )

            ti_data_csv = tarfile.TarInfo(name="data.csv")
            ti_data_csv.size = len(primary_csv_bytes)
            ti_data_csv.mtime = int(time.time())
            tf.addfile(ti_data_csv, io.BytesIO(primary_csv_bytes))

            r_script_bytes = "\n".join(r_scripts).encode("utf-8")
            ti_r = tarfile.TarInfo(name="plot_strat.R")
            ti_r.size = len(r_script_bytes)
            ti_r.mtime = int(time.time())
            tf.addfile(ti_r, io.BytesIO(r_script_bytes))

            readme = (
                f"Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)\n"
                f"================================================================\n"
                f"Primary ROI: {primary_roi_name}\n"
                f"Total ROIs: {len(roi_dfs)}\n\n"
                f"Files:\n"
                f"data.csv             - Primary ROI dataset ({primary_roi_name})\n"
                f"data/<roi>.csv       - Per-ROI isolated scientific CSV tables\n"
                f"plot_strat.R         - R plotting script with sections for each ROI\n"
                f"manifest.json        - Version metadata and ROI hierarchy\n"
            ).encode("utf-8") + b"\n" + CSV_MISSING_NOTICE
            ti_readme = tarfile.TarInfo(name="README.txt")
            ti_readme.size = len(readme)
            ti_readme.mtime = int(time.time())
            tf.addfile(ti_readme, io.BytesIO(readme))

        tar_bytes = tar_bio.getvalue()
        if output_path:
            out_dir = os.path.dirname(os.path.abspath(output_path))
            os.makedirs(out_dir, exist_ok=True)
            with open(output_path, "wb") as f:
                f.write(tar_bytes)
            return {
                "path": os.path.abspath(output_path),
                "size": len(tar_bytes),
                "success": True,
            }

        b64_tar = base64.b64encode(tar_bytes).decode("ascii")
        return {
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
    ) -> dict[str, Any]:
        """Exports calibrated multi-ROI sheets into an Excel workbook."""
        roi_dfs = self.get_roi_dataframes()
        paper_meta = getattr(self, "paper_metadata", {})
        age_depth_model = getattr(self, "age_depth_model", None)
        ensemble_tables = getattr(self, "ensemble_tables", [])

        age_depth_df = None
        if include_age_depth and age_depth_model is not None and roi_dfs:
            first_df = list(roi_dfs.values())[0]
            if "depth" in first_df.columns:
                depths = first_df["depth"].tolist()
                pred = age_depth_model.predict_age(depths)
                age_depth_df = pd.DataFrame(
                    {
                        "depth": depths,
                        "age_est": pred.get("age_est", []),
                        "age_min": pred.get("age_min", []),
                        "age_max": pred.get("age_max", []),
                    }
                )
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

        if output_path:
            # 写盘模式：文件已落盘，返回路径即可，不回传内容（避免同一份数据
            # 既写文件又塞进 JSON-RPC 响应）。
            return {
                "success": True,
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
    ) -> dict[str, Any]:
        """Exports Linked Paleo Data (LiPD) JSON-LD structure with per-ROI measurement tables."""
        roi_dfs = self.get_roi_dataframes()
        paper_meta = getattr(self, "paper_metadata", {})
        age_depth_model = getattr(self, "age_depth_model", None)
        ensemble_tables = getattr(self, "ensemble_tables", [])

        age_depth_df = None
        if include_age_depth and age_depth_model is not None and roi_dfs:
            first_df = list(roi_dfs.values())[0]
            if "depth" in first_df.columns:
                depths = first_df["depth"].tolist()
                pred = age_depth_model.predict_age(depths)
                age_depth_df = pd.DataFrame(
                    {
                        "depth": depths,
                        "age_est": pred.get("age_est", []),
                        "age_min": pred.get("age_min", []),
                        "age_max": pred.get("age_max", []),
                    }
                )

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

        if output_path:
            out_dir = os.path.dirname(os.path.abspath(output_path))
            os.makedirs(out_dir, exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(lipd_jsonld, f, indent=2, ensure_ascii=False)
            return {
                "success": True,
                "output_path": os.path.abspath(output_path),
                "lipd": lipd_jsonld,
            }

        return {"success": True, "lipd": lipd_jsonld}

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
            resolved_axis = self.primary_axis
        else:
            candidate = str(primary_axis).strip().lower()
            if candidate not in ("depth", "age"):
                raise JsonRpcError(
                    INVALID_PARAMS,
                    f"primary_axis must be 'depth' or 'age' (got {primary_axis!r}).",
                )
            resolved_axis = candidate

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
        self.depth_calib = {
            "top_px": float(ordered[0][0]),
            "top_cm": float(ordered[0][1]),
            "bottom_px": float(ordered[-1][0]),
            "bottom_cm": float(ordered[-1][1]),
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

    def _primary_roi_export_frame(self, *, strict: bool) -> Any:
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
        frames = self.get_roi_dataframes(strict=strict)
        if not frames:
            raise JsonRpcError(STATE_ERROR, "No ROI sheets available to export.")
        name = self._primary_roi_sheet_name(frames)
        frame = frames.get(name)
        if frame is None:
            frame = next(iter(frames.values()))
        return frame

    # ---- dataset 行集（与前端面板下拉同义，三种都从 column_points 取值）----

    #: `export_data(dataset=...)` 允许的取值，顺序即产品下拉顺序。
    EXPORT_DATASETS = ("union_points", "depth_grid", "turning_points")

    def _dataset_frame(self, dataset: str | None, *, strict: bool) -> Any:
        """按 dataset 产出一张表；**三种行集共用同一取数口径**。

        `dataset=None`（未传）保持既有行为：`_primary_roi_export_frame`（samples 优先）。
        这是 `data.csv` / 工程包那条出口的语义，**不能**跟面板下拉混为一谈。

        面板显式传三值时：
        - `union_points` = **控制点并集**（所有 `control_points` 的 row 去重排序），
          即下拉里「真实物理拐点共振层位 [推荐]」；
        - `depth_grid` = 标尺均匀层位；
        - `turning_points` = 离散拐点长表。

        取值一律经 `extract_grid_values` / `read_column_values`，与顶栏导出同一套换算，
        不让前端再用样条造第二套数。
        """
        key = (dataset or "").strip().lower()
        if not key:
            return self._primary_roi_export_frame(strict=strict)
        if key == "union_points":
            return self._union_points_frame()
        if key == "depth_grid":
            return self._depth_grid_frame()
        if key == "turning_points":
            return self._turning_points_frame()
        raise JsonRpcError(
            INVALID_PARAMS,
            f"Unsupported dataset '{dataset}'. Use one of: {', '.join(self.EXPORT_DATASETS)}.",
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

    def _union_points_frame(self) -> Any:
        """控制点并集行集：行取自 `control_points`，值经 `extract_grid_values` 取。"""
        rows = self._control_point_rows()
        if not rows:
            return pd.DataFrame({"depth": []})
        y_scale = getattr(self, "y_scale", None)
        calibrated = bool(getattr(self, "is_calibrated", False)) and y_scale is not None
        if calibrated:
            slope = float(y_scale["slope"])
            intercept = float(y_scale["intercept"])
            depths = [round(slope * row + intercept, 4) for row in rows]
        else:
            depths = [float(row) for row in rows]
        grid = self.extract_grid_values(depths=depths)
        data: dict[str, Any] = {"depth": [round(float(d), 4) for d in grid["depths"]]}
        for idx, taxon in enumerate(grid["taxa"]):
            data[str(taxon)] = [row[idx] for row in grid["matrix"]]
        return pd.DataFrame(data)

    def _uniform_depth_list(self) -> list[float]:
        """按 `depth_calib` + `depth_interval` 生成均匀层位（标尺网格）。"""
        calib = getattr(self, "depth_calib", None) or {}
        top = calib.get("top_cm")
        bottom = calib.get("bottom_cm")
        if top is None or bottom is None:
            return []
        step_raw = getattr(self, "depth_interval", None)
        try:
            step = float(step_raw) if step_raw else 2.0
        except (TypeError, ValueError):
            step = 2.0
        if step <= 0:
            step = 2.0
        lo, hi = sorted((float(top), float(bottom)))
        count = int(round((hi - lo) / step)) + 1
        return [round(lo + i * step, 4) for i in range(max(count, 1))]

    def _depth_grid_frame(self) -> Any:
        """标尺均匀层位：直接复用 `extract_grid_values` 的取值口径。"""
        depths = list(getattr(self, "depth_grid", None) or self._uniform_depth_list())
        if not depths:
            raise JsonRpcError(
                STATE_ERROR,
                "No depth grid available: set Y calibration or call core.applyDepthGrid first.",
            )
        grid = self.extract_grid_values(depths=depths)
        data: dict[str, Any] = {"depth": [round(float(d), 4) for d in grid["depths"]]}
        for idx, taxon in enumerate(grid["taxa"]):
            data[str(taxon)] = [row[idx] for row in grid["matrix"]]
        return pd.DataFrame(data)

    def _turning_points_frame(self) -> Any:
        """离散拐点长表：每个**控制点**一行（taxon / type / depth / value / x / y）。

        行的来源是 `control_points` —— 用户眼里的"拐点"就是它们；
        `column_points` 是数字化出的逐行曲线（行数完全不同），两者不能混。
        """
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
                        "depth": depth,
                        "value": value,
                        "x": float(x_px),
                        "y": row_px,
                    }
                )
        return pd.DataFrame(
            records, columns=["taxon", "type", "depth", "value", "x", "y"]
        )

    def export_data(
        self,
        format: str = "csv",
        strict: bool = False,
        output_path: str | None = None,
        dataset: str | None = None,
    ) -> dict[str, Any]:
        """Exports the calibrated data matrix to CSV or Parquet format.

        `dataset` 选择**行集**，与前端导出面板的下拉一一对应：
        `union_points`（控制点并集）/ `depth_grid`（标尺均匀层位）/
        `turning_points`（离散拐点长表）。**不传（None）保持既有行为**（samples 优先），
        `data.csv` / 工程包走的就是这条路，两种语义不能混。
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

        if strict and not getattr(self, "is_calibrated", False):
            raise JsonRpcError(
                CALIBRATION_ERROR,
                "Axes calibration is required when strict=True.",
            )

        # 取数收敛：不再自己拼行集与列名，直接用主 ROI 的那一张表（同一入口）。
        # `_export_rows_and_depths` / `_export_value_columns` 保留给单 ROI 的既有调用与
        # 各自的判据，但 CSV 不再走它们——两条链在"行集 + 列名 + 补点时机"上各写一套
        # 正是本缺陷的来源。
        df = self._dataset_frame(dataset, strict=strict)
        depth_series = df["depth"].tolist()
        all_rows = list(range(len(depth_series)))

        if getattr(self, "age_depth_model", None) is not None:
            age_pred = self.age_depth_model.predict_age(depth_series)
            # 列序必须与旧实现一致：depth, age_est, age_min_95, age_max_95, 各属种列。
            age_frame = pd.DataFrame(
                {
                    "age_est": age_pred["age_est"],
                    "age_min_95": age_pred["age_min"],
                    "age_max_95": age_pred["age_max"],
                }
            )
            df = pd.concat(
                [df[["depth"]], age_frame, df.drop(columns=["depth"])], axis=1
            )

        csv_string, saved_path = self._write_export_file(fmt, df, output_path)

        return {
            "format": fmt,
            "strict": strict,
            "rows_count": len(df),
            "columns_count": len(df.columns),
            "columns": list(df.columns),
            "data": self._json_safe_records(df.head(50)),
            "file_path": saved_path,
            "path": saved_path,
            "csv": csv_string,
            "csv_content": csv_string,
        }

    @staticmethod
    def _json_safe_records(frame: Any) -> list[dict[str, Any]]:
        """把 DataFrame 转成**合法 JSON** 的记录列表。

        pandas 的 NaN 经 `to_dict(orient="records")` 会原样留在 dict 里，而
        `json.dumps` 默认 `allow_nan=True` 会把它写成字面量 `NaN` —— 那不是合法
        JSON。浏览器的 `Response.json()` 会抛 SyntaxError，前端再把解析失败当成
        "与后端的连接已断开"，把人引去查网络（实测：导出面板打不开 + 连接断开提示，
        真实原因是某列某层位是 NaN）。

        这里把缺测转成 `None`（JSON `null`），与"缺测 ≠ 0"的既有语义一致。
        """
        records = frame.astype(object).where(frame.notnull(), None).to_dict(
            orient="records"
        )
        # `inf`/`-inf` 也是非法 JSON（`allow_nan=False` 会抛 Out of range）。
        # 它们同样表示"这个数没有意义"，按缺测处理。
        return [
            {
                key: (None if isinstance(value, float) and not math.isfinite(value) else value)
                for key, value in record.items()
            }
            for record in records
        ]

    def _ensure_export_column_points(self) -> None:
        """没有逐行点时先补出来：控制点合成 > 现场数字化 > 取数区等距采样。

        三条回落顺序有讲究：控制点优先（用户手调过的锚点最可信），其次真数字化，
        最后才是等距采样（只保证导得出，不保证读数）。这里吞掉异常不抛——它是保底路径，
        失败由下面的 no-data 守卫统一报。
        """
        if not getattr(self, "column_points", None):
            if getattr(self, "control_points", None) and any(
                self.control_points.values()
            ):
                all_r = sorted(
                    {r for ctrls in self.control_points.values() for r in ctrls}
                )
                for c_idx in range(len(getattr(self, "columns", []))):
                    ctrls = self.control_points.get(c_idx, {})
                    c_start = float(self.columns[c_idx].get("start", 0))
                    self.column_points[c_idx] = [
                        {"row": r, "x": float(ctrls.get(r, c_start))} for r in all_r
                    ]
            elif (
                getattr(self, "columns", None)
                and getattr(self, "image", None) is not None
            ):
                # 现场数字化：失败的列**收集原因并统一报错**，不许 `pass` 之后
                # 落到"造一条水平直线"的兜底（那条兜底会把列左缘当读数，
                # 整列常数、看起来完全合法）。项目第一不变量：取不到就报错停在原地。
                failures: list[str] = []
                for col in self.columns:
                    try:
                        self.digitize(col["col_index"])
                    except (ValueError, KeyError, RuntimeError, JsonRpcError) as exc:
                        name = col.get("name") or f"col_index={col.get('col_index')}"
                        failures.append(f"{name}（{exc}）")
                if failures:
                    raise JsonRpcError(
                        STATE_ERROR,
                        "以下列无法从图像取数，且没有手工控制点可用："
                        + "；".join(failures)
                        + "。请先在步骤 5/7 数字化这些列，或补控制点后再导出。",
                    )
            else:
                raise JsonRpcError(
                    STATE_ERROR,
                    "没有任何可取数的列：既没有手工控制点，也没有可数字化的图像。"
                    "系统不会用等距采样的替代数据充数。",
                )

    def _export_rows_and_depths(self) -> tuple[list[int], list]:
        """导出用的行号序列与深度列。

        有采样层就以采样层为准（用户显式标定的深度优先），否则取各列逐行点的并集；
        已标定时深度由 y_scale 换算（round 4），未标定直接给行号。
        """
        samples = getattr(self, "samples", None) or []
        if samples:
            all_rows = [int(round(s.get("row_px", 0))) for s in samples]
            raw_depths = [s.get("depth") for s in samples]
            if (
                getattr(self, "is_calibrated", False)
                and getattr(self, "y_scale", None) is not None
            ):
                sy = self.y_scale["slope"]
                iy = self.y_scale["intercept"]
                depth_series = [
                    round(float(d), 4) if d is not None else round(sy * r + iy, 4)
                    for r, d in zip(all_rows, raw_depths)
                ]
            else:
                depth_series = [
                    d if d is not None else r for r, d in zip(all_rows, raw_depths)
                ]
        else:
            all_rows = sorted(
                {p["row"] for pts in self.column_points.values() for p in pts}
            )
            if not all_rows:
                all_rows = [0]

            if (
                getattr(self, "is_calibrated", False)
                and getattr(self, "y_scale", None) is not None
            ):
                sy = self.y_scale["slope"]
                iy = self.y_scale["intercept"]
                depth_series = [round(sy * r + iy, 4) for r in all_rows]
            else:
                depth_series = all_rows
        return all_rows, depth_series

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

            pts = self.column_points[c_idx]
            p_dict = {p["row"]: p["x"] for p in pts}
            scale = resolve_column_scale(self, col_def, c_idx)
            # 缺控制点填 **0 点**（= 列左缘 + 轴线粗，ARCHITECTURE §6.4）；未标定整列不给数。
            # 两个决定都在 read_column_values 里——四路出口共用一个入口，取整改一处即全改。
            baseline_px = float(scale.abs_px0)
            values[col_name] = _mask_outside_window(
                all_rows,
                read_column_values(
                    scale,
                    [p_dict.get(r, baseline_px) for r in all_rows],
                    strict=strict,
                    col_name=col_name,
                ),
                _column_row_window(self, col_def, c_idx),
                p_dict,
            )
        return values

    def _write_export_file(
        self, fmt: str, df: Any, output_path: str | None
    ) -> tuple[str | None, str | None]:
        """落盘（csv / parquet）并返回内存中的 csv 文本与保存路径。"""
        csv_string: str | None = None
        saved_path: str | None = None

        if fmt == "csv":
            csv_string = df.to_csv(index=False)
            # `-0.0` 的符号位会被 pandas 原样渲染，CSV 里就成了字面量 `-0.0`
            # （pandas 对 `float(-0.0)` 一律输出 `-0.0`，加 0.0 也抹不掉符号位）。
            # 下游 R / Excel / 严格校验的读入器会把它当**负深度**，而它实际就是 0。
            # 这里在**字符串层**把列首的 `-0.0` 规整成 `0.0`：
            # 只替换行首（深度列）出现的 `-0.0`，不碰其它数值列。
            csv_string = _normalize_negative_zero_depth(csv_string)
            if output_path:
                out_dir = os.path.dirname(os.path.abspath(output_path))
                os.makedirs(out_dir, exist_ok=True)
                # newline="" 必须显式给：pandas 的 to_csv 已经用 "\r\n" 结尾，
                # 文本模式默认还会把 "\n" 再翻译成 "\r\n"，落盘就成了 "\r\r\n"。
                # 下游 R/Excel 读到行尾多余 \r 会把最后一列的值/列名带上控制符。
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
    ) -> str | dict[str, Any]:
        """Generates stratigraphic CSV: depth in 1st col, unobserved taxa = 0.0 (Section 八).

        `dataset` 透传给 `export_data`，取值见 `EXPORT_DATASETS`。
        不传（None）保持既有调用字节不变（samples 优先，即 `data.csv` 的语义）。
        """
        res = self.export_data("csv", output_path=output_path, dataset=dataset)
        if output_path:
            return {"path": output_path, "success": True}
        return res.get("csv", "") if isinstance(res, dict) else str(res)

    def export_tar(self, output_path: str | None = None) -> dict[str, Any]:
        """Exports standard POSIX UStar tar project archive."""
        return self.project_save(output_path=output_path, format="tar")

    def export_r(self, output_path: str | None = None) -> str | dict[str, Any]:
        """Generates R plotting template script using rioja::strat.plot."""
        r_script = (
            "# ==============================================================================\n"
            "# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script\n"
            "# Generated automatically by Straditize v2.0 (straditize pro)\n"
            "# Requires R package 'rioja' (install.packages('rioja'))\n"
            "# ==============================================================================\n\n"
            "if (!requireNamespace('rioja', quietly = TRUE)) {\n"
            "  install.packages('rioja', repos = 'https://cloud.r-project.org')\n"
            "}\n"
            "library(rioja)\n\n"
            "data_file <- if (file.exists('data.csv')) 'data.csv' else list.files(pattern = '\\\\.csv$')[1]\n"
            "df <- read.csv(data_file, check.names = FALSE, stringsAsFactors = FALSE)\n"
            "depth <- df[[1]]\n"
            "taxa_data <- as.matrix(sapply(df[, -1, drop = FALSE], as.numeric))\n"
            "# 空单元格 = 该行不在这一列的取数窗口内（未测），**不是 0 丰度**。\n# 旧模板曾在这一步把 NA 静默填成 0，等于把「没测」画成「测到 0」，会被当成科学结论。\n# 这里**保留 NA**：rioja::strat.plot 会把 NA 画成空白/缺口。\n# 下游统计若确实需要一个数，请显式处理（na.omit / 按缺失模型插补），不要替用户决定。\n\n\n"
            "pdf('stratigraphic_diagram.pdf', width = 12, height = 8)\n"
            "strat.plot(\n"
            "  d = taxa_data,\n"
            "  yvar = depth,\n"
            "  y.rev = TRUE,\n"
            "  ylabel = 'Depth (cm)',\n"
            "  scale.percent = TRUE,\n"
            "  plot.poly = TRUE,\n"
            "  plot.line = TRUE,\n"
            "  title = 'Stratigraphic Pollen Diagram (Straditize Pro)'\n"
            ")\n"
            "dev.off()\n"
            "message('Diagram successfully rendered: stratigraphic_diagram.pdf')\n"
        )
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(r_script)
            return {"path": output_path, "success": True}
        return r_script

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
        pollen_df = pd.read_csv(io.StringIO(pollen_csv or "depth\n0\n"))

        age_depth_df = None
        if (
            include_age_depth
            and getattr(self, "age_depth_model", None) is not None
            and "depth" in pollen_df.columns
        ):
            depths = pollen_df["depth"].tolist()
            pred = self.age_depth_model.predict_age(depths)
            pred = attach_windowed_rates(
                pred, self.age_depth_model, getattr(self, "age_depth_rate_columns", [])
            )
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
        pollen_df = pd.read_csv(io.StringIO(pollen_csv or "depth\n0\n"))

        age_depth_df = None
        if (
            include_age_depth
            and getattr(self, "age_depth_model", None) is not None
            and "depth" in pollen_df.columns
        ):
            depths = pollen_df["depth"].tolist()
            pred = self.age_depth_model.predict_age(depths)
            pred = attach_windowed_rates(
                pred, self.age_depth_model, getattr(self, "age_depth_rate_columns", [])
            )
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
