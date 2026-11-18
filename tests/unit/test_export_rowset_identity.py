# -*- coding: utf-8 -*-
"""导出行集的**身份**：#113（三处行集同源）+ #100（并集分支不得静默）。

## 缺陷本体（2026-11-19 现场，`straditize_project_1795007270385.tar`）

用户看到导出表 **625 行**，而这张图的论文样品数是 159。该工程 `samples=0`、
`depth_grid=0`，导出走的是"各列逐行数字化点并集"分支：

- ROI `ylim=[239, 864)`，高 **625 px**；
- 19 列全部数字化后，逐行点并集正好是 625 个像素行（239..863）；
- 导出表就是这 625 个**像素行**，行数等于 ROI 高度 —— 不是 625 个样品。

同一份工程在三处出口必须给出同一张表（面板预览 / `core.exportData` 下载 / 归档
`data.csv`），且**必须答得上"这些行凭什么算样品"**：`rowset.is_sample_rows` 为假，
`rowset.provenance == "pixel_rows"`，`rowset.why` 说清原因。

## 判据分工

| 判据 | 测什么 | 强度 |
| :--- | :--- | :--- |
| `test_pixel_rows_project_is_labelled_pixel_rows` | `samples=0` → 身份是像素行、行数==ROI 高度 | equality |
| `test_three_exits_are_byte_identical_pixel_rows` | 面板 == 下载 == 归档（逐字节） | equality |
| `test_samples_project_three_exits_equal_sample_count` | 有层位 → 三处行数 == `len(samples)` | equality |
| `test_archive_manifest_and_readme_carry_rowset` | 归档元数据/README 带来源标记 | contains |
| `test_readiness_exposes_same_rowset` | 面板打开就能拿到同一份身份 | equality |
| `test_rowcount_samplecount_mismatch_is_refused` | 行数 ≠ samples 条数 → 拒绝交付 | raises |

## 反向验证（改回错误实现应当变红）

- 把 `_resolve_rowset` 的 `samples` 分支删掉（永远走并集）→ 判据 3 变红；
- 把 `serialize_export_frame` 里的 `_normalize_negative_zero_depth` 去掉 →
  判据 2 在含 `-0.0` 首行的工程上变红；
- 把 `is_sample_rows` 改成恒 `True` → 判据 1 变红。
"""

from __future__ import annotations

import hashlib
import io
import json
import tarfile

import pytest

from straditize_core.protocol import EXPORT_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession

#: 现场 ROI：`ylim=[239, 864)` → 625 px。逐行数字化后并集正好 625 行。
ROI_TOP = 239
ROI_BOTTOM = 864
ROI_HEIGHT = ROI_BOTTOM - ROI_TOP
N_COLUMNS = 19


def _sha(data: str | bytes) -> str:
    payload = data.encode("utf-8") if isinstance(data, str) else data
    return hashlib.sha256(payload).hexdigest()


def _session(*, samples: int = 0, dense_points: bool = True) -> StraditizeSession:
    """复刻现场形状：19 列 / ROI 高 625 px / `primary_axis="age"` + `unit="ka"`。

    `dense_points=True` → 每列在每个像素行都有点（= 现场"整列数字化"后的状态），
    并集因此是 625 个连续行；`False` → 只有离散控制点行。
    """
    session = StraditizeSession()
    session._init_export()
    session.rois = [
        {
            "id": "roi_1",
            "name": "roi_1",
            "name_source": "user",
            "xlim": [192.0, 1548.0],
            "ylim": [float(ROI_TOP), float(ROI_BOTTOM)],
        }
    ]
    session.primary_roi_id = "roi_1"
    session.columns = [
        {
            "col_index": index,
            "name": f"col{index + 1:02d}",
            "roi_id": "roi_1",
            "x_ticks": [
                {"px": 100.0 + 20.0 * index, "value": 0.0},
                {"px": 140.0 + 20.0 * index, "value": 100.0},
            ],
        }
        for index in range(N_COLUMNS)
    ]
    session.control_points = {}
    if dense_points:
        session.column_points = {
            index: [
                {"row": row, "x": 110.0 + 20.0 * index + (row % 7)}
                for row in range(ROI_TOP, ROI_BOTTOM)
            ]
            for index in range(N_COLUMNS)
        }
    else:
        session.column_points = {
            index: [
                {"row": row, "x": 110.0 + 20.0 * index}
                for row in (ROI_TOP, ROI_TOP + 200, ROI_BOTTOM - 1)
            ]
            for index in range(N_COLUMNS)
        }
    session.is_calibrated = True
    # 现场 y_scale：px 310 → 2.0 ka，px 448 → 6.0 ka（顶部为负值，BP 约定合法）。
    session.y_scale = {"slope": 0.028985507246376795, "intercept": -6.985507246376806}
    session.primary_axis = "age"
    session.depth_unit = "ka"
    session.samples = [
        {"row_px": ROI_TOP + round(i * (ROI_HEIGHT - 1) / max(samples - 1, 1)),
         "depth": None,
         "source": "auto"}
        for i in range(samples)
    ]
    return session


def _archive_csv(session: StraditizeSession) -> tuple[bytes, dict, str]:
    """导一次 tar 归档，取回 (data.csv 字节, manifest, README 文本)。"""
    import os
    import tempfile

    handle, path = tempfile.mkstemp(suffix=".tar")
    os.close(handle)
    try:
        session.export_multi_tar(output_path=path)
        with tarfile.open(path) as archive:
            csv_bytes = archive.extractfile("data.csv").read()
            manifest = json.loads(archive.extractfile("manifest.json").read())
            readme = archive.extractfile("README.txt").read().decode("utf-8")
    finally:
        os.unlink(path)
    return csv_bytes, manifest, readme


# ---------------------------------------------------------------------------
# 判据 1：samples=0 → 身份是"像素行"，且能回答"凭什么"
# ---------------------------------------------------------------------------


def test_pixel_rows_project_is_labelled_pixel_rows() -> None:
    session = _session(samples=0)
    result = session.export_data("csv")

    rowset = result["rowset"]
    assert rowset["provenance"] == "pixel_rows"
    assert rowset["is_sample_rows"] is False
    assert rowset["samples_count"] == 0
    assert rowset["rows_count"] == ROI_HEIGHT, (
        f"逐行点并集应正好覆盖 ROI 高度 {ROI_HEIGHT} 行，实得 {rowset['rows_count']}"
    )
    assert "像素行" in rowset["why"] and "不是样品" in rowset["why"], (
        f"`why` 必须直接回答'这些行凭什么算样品'，实得：{rowset['why']!r}"
    )
    assert "不是样品层位" in rowset["label"]

    quality = rowset["quality"]
    assert quality["rows"] == ROI_HEIGHT
    assert quality["roi_height_px"] == ROI_HEIGHT
    assert quality["rows_equal_roi_height"] is True, (
        "行数恰等于 ROI 高度是'这些是像素行不是样品'的物证，必须能被程序判出"
    )
    assert quality["samples"] == 0
    # 每行都被 N_COLUMNS 列覆盖（整列数字化），中位数应是列数
    assert quality["support_columns_median"] == float(N_COLUMNS)
    assert quality["support_columns_source"] == "column_points"
    # 没跑过共识 → 不知道当时的容差，如实 null，不拿默认值冒充
    assert quality["tolerance_px"] is None
    assert isinstance(quality["default_tolerance_px"], float)


def test_discrete_points_project_is_not_pixel_rows() -> None:
    """正对照：只有离散控制点行时，并集是小集合，且**不**等于 ROI 高度。"""
    session = _session(samples=0, dense_points=False)
    rowset = session.export_data("csv")["rowset"]

    assert rowset["provenance"] == "pixel_rows"
    assert rowset["rows_count"] == 3
    assert rowset["quality"]["rows_equal_roi_height"] is False


# ---------------------------------------------------------------------------
# 判据 2 / 3：三处出口同一行集、同一字节
# ---------------------------------------------------------------------------


def test_three_exits_are_byte_identical_pixel_rows() -> None:
    session = _session(samples=0)
    panel = session.export_csv(dataset="samples")
    download = session.export_data("csv")["csv"]
    archive_csv, _, _ = _archive_csv(session)

    assert panel == download, "面板（export.csv{dataset:'samples'}）与下载必须逐字节相同"
    assert archive_csv == download.encode("utf-8"), "归档 data.csv 必须是下载的字节复本"
    assert _sha(panel) == _sha(archive_csv)


@pytest.mark.parametrize("sample_count", [3, 159])
def test_samples_project_three_exits_equal_sample_count(sample_count: int) -> None:
    session = _session(samples=sample_count)
    panel = session.export_csv(dataset="samples")
    result = session.export_data("csv")
    archive_csv, manifest, readme = _archive_csv(session)

    rowset = result["rowset"]
    assert rowset["provenance"] == "samples"
    assert rowset["is_sample_rows"] is True
    assert rowset["samples_count"] == sample_count
    assert rowset["rows_count"] == sample_count, (
        f"有层位时行数必须 == len(samples)={sample_count}，实得 {rowset['rows_count']}"
    )
    assert panel.strip().count("\n") == sample_count
    assert result["rows_count"] == sample_count
    assert archive_csv.decode("utf-8").strip().count("\n") == sample_count
    assert panel == result["csv"] and archive_csv == result["csv"].encode("utf-8")
    assert manifest["data_csv_rowset"]["is_sample_rows"] is True
    assert manifest["data_csv_rowset"]["samples_count"] == sample_count
    assert "WARNING: samples is empty" not in readme


def test_rowcount_samplecount_mismatch_is_refused(monkeypatch) -> None:
    """反向哨兵：层位行集却算出别的行数 → 整份表不交付（不是"打日志继续"）。"""
    session = _session(samples=3)
    original = session._dataset_frame

    def _inflated(dataset, *, strict, legacy_column_name=False):
        import pandas as pd

        frame = original(
            dataset, strict=strict, legacy_column_name=legacy_column_name
        )
        return pd.concat([frame, frame], ignore_index=True)

    monkeypatch.setattr(session, "_dataset_frame", _inflated)
    with pytest.raises(JsonRpcError) as excinfo:
        session.export_data("csv")

    assert excinfo.value.code == EXPORT_ERROR
    assert excinfo.value.data["reason"] == "rowset_mismatch"
    assert excinfo.value.data["samples"] == 3
    assert excinfo.value.data["rows"] == 6


# ---------------------------------------------------------------------------
# 判据 4 / 5：归档元数据 + README + readiness 都带同一份身份
# ---------------------------------------------------------------------------


def test_archive_manifest_and_readme_carry_rowset() -> None:
    session = _session(samples=0)
    _, manifest, readme = _archive_csv(session)

    recorded = manifest["data_csv_rowset"]
    assert recorded["provenance"] == "pixel_rows"
    assert recorded["is_sample_rows"] is False
    assert recorded["quality"]["rows_equal_roi_height"] is True
    assert "WARNING: samples is empty" in readme, (
        "samples 为空时 README 必须显式警告 data.csv 的行是像素行"
    )
    assert "provenance" in readme and "pixel_rows" in readme
    assert "support_columns_median" in readme


def test_readiness_exposes_same_rowset() -> None:
    session = _session(samples=0)
    readiness = session.get_export_readiness()
    download = session.export_data("csv")["rowset"]

    assert readiness["rowset"]["provenance"] == download["provenance"]
    assert readiness["rowset"]["rows_count"] == download["rows_count"]
    assert readiness["rowset"]["is_sample_rows"] is False
    assert readiness["rowset"]["quality"]["rows_equal_roi_height"] is True
