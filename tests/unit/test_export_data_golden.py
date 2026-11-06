# -*- coding: utf-8 -*-
"""`export_data` 的输出基线（重构前）。

## 为什么需要它

这是 CSV / Parquet 的唯一出口，也是 `project_save` 打包 data.csv 的同一个入口。它的行为有三处
容易改错且**看不出来**：列缺控制点时补的是 `0 点`（不是列左缘）、未标定列整列给 `None`
（不是 0）、以及 CSV 里深度列的 `-0.0` 要在**字符串层**规整（pandas 保留符号位，下游会读成负深度）。

## 钉的是什么

| 案例 | 盯的分支 |
| --- | --- |
| `csv_calibrated_with_samples` | 有采样层 + 已标定 → 深度由 `y_scale` 算 |
| `csv_uncalibrated` | 未标定 → 整列 `None` |
| `csv_with_age_model` | 有年代模型 → age_est / age_min_95 / age_max_95 三列 |
| `rows_from_column_points` | 没有采样层 → 行号取自 column_points 的并集 |
| `control_points_only` | 只有控制点、没有逐行点 → 按控制点合成 |
| `errors` | 坏格式 / parquet 缺路径 / strict 未标定 / 完全没数据 |

## 重新生成

    UPDATE_EXPORT_DATA_GOLDEN=1 pixi run python -m pytest tests/unit/test_export_data_golden.py
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from straditize_core.age_depth_model import AgeDepthModel
from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

GOLDEN = Path(__file__).parent / "fixtures" / "export_data_golden.json"
PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"


def _session(calibrated: bool = True) -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    for column in session.columns[:3]:
        session.digitize(column["col_index"])
    if calibrated:
        session.is_calibrated = True
        session.y_scale = {"slope": 0.5, "intercept": -100.0}
    return session


def _snapshot(result: dict) -> dict:
    csv_text = result["csv"] or ""
    return {
        "format": result["format"],
        "strict": result["strict"],
        "rows_count": result["rows_count"],
        "columns_count": result["columns_count"],
        "columns": result["columns"],
        "file_path": os.path.basename(result["file_path"]) if result["file_path"] else None,
        "path_matches_file_path": result["path"] == result["file_path"],
        "csv_content_equals_csv": result["csv_content"] == result["csv"],
        "csv_digest": hashlib.sha256(csv_text.encode("utf-8")).hexdigest()[:16],
        "csv_head": csv_text.splitlines()[:3],
        "data_head": json.loads(json.dumps(result["data"][:3])),
    }


def _case(fn) -> dict:
    try:
        return {"ok": _snapshot(fn())}
    except JsonRpcError as error:
        return {"raised": {"code": error.code, "message": str(error.message)}}


def _collect(tmp_dir: Path) -> dict:
    out: dict = {}

    session = _session()
    session.samples = [
        {"row_px": 300, "depth": None},
        {"row_px": 500, "depth": 150.0},
        {"row_px": 700, "depth": None},
    ]
    out["csv_calibrated_with_samples"] = _case(lambda: session.export_data("csv"))
    out["csv_with_file"] = _case(
        lambda: session.export_data("csv", output_path=str(tmp_dir / "out" / "data.csv"))
    )

    out["csv_uncalibrated"] = _case(lambda: _session(calibrated=False).export_data("csv"))

    model = AgeDepthModel(
        depths=[0.0, 100.0, 200.0, 320.0],
        ages=[0.0, 400.0, 900.0, 1500.0],
        age_min=[0.0, 380.0, 870.0, 1450.0],
        age_max=[0.0, 420.0, 930.0, 1550.0],
        curve_type="median",
        envelope_type="95_hpd",
        depth_unit="cm",
        age_unit="cal BP",
        cal_curve="IntCal20",
        notes="",
    )
    session_with_model = _session()
    session_with_model.age_depth_model = model
    out["csv_with_age_model"] = _case(lambda: session_with_model.export_data("csv"))

    out["rows_from_column_points"] = _case(lambda: _session().export_data("csv"))

    control_only = _session()
    control_only.column_points = {}
    control_only.control_points = {
        0: {300: 120.0, 400: 140.0},
        1: {300: 160.0, 400: 180.0},
    }
    out["control_points_only"] = _case(lambda: control_only.export_data("csv"))

    # 关键一条：列**已标定**时才会走 px_to_value。前面几条例的列都没标度，
    # 整列 None —— 那样钉住的只是「未标定给 None」，数值换算路径根本没被执行。
    calibrated_cols = _session()
    for column in calibrated_cols.columns[:3]:
        column["x_ticks"] = [
            {"px": float(column["start"]), "value": 0.0},
            {"px": float(column["end"]), "value": 100.0},
        ]
    calibrated_cols.samples = [{"row_px": 300, "depth": 10.0}, {"row_px": 700, "depth": 210.0}]
    out["csv_calibrated_columns"] = _case(lambda: calibrated_cols.export_data("csv"))

    errors = {}
    try:
        _session().export_data("xlsx")
    except JsonRpcError as error:
        errors["bad_format"] = {"code": error.code, "message": str(error.message)}
    try:
        _session().export_data("parquet")
    except JsonRpcError as error:
        errors["parquet_needs_path"] = {
            "code": error.code,
            "message": str(error.message),
        }
    try:
        _session(calibrated=False).export_data("csv", strict=True)
    except JsonRpcError as error:
        errors["strict_uncalibrated"] = {
            "code": error.code,
            "message": str(error.message),
        }
    empty = StraditizeSession()
    empty._init_cleanup()
    try:
        empty.export_data("csv")
    except JsonRpcError as error:
        errors["no_data"] = {"code": error.code, "message": str(error.message)}
    out["errors"] = errors
    return out


def test_export_data_snapshot_is_stable(tmp_path) -> None:
    snapshot = _collect(tmp_path)

    if os.environ.get("UPDATE_EXPORT_DATA_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_EXPORT_DATA_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)[:1800]}\n"
            f"expected = {json.dumps(expected[case], ensure_ascii=False, sort_keys=True)[:1800]}"
        )
