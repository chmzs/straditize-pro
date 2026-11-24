# -*- coding: utf-8 -*-
"""数据三表解耦（data.csv, age_depth.csv, ensemble.csv）单元测试。

验证不变量：
1. data.csv 纯粹性：即使存在年代-深度模型，data.csv 也绝不含模型衍生列；在 samples 存在时首列为 horizon_id。
2. age_depth.csv 独立性：单独产出 horizon_id, depth, age, age_lower, age_upper, sed_rate，且支持 dataset="age_depth" 导出。
3. 归档与打包完整性：export_multi_tar 与 export_bundle_zip 均能同时打包 age_depth.csv 与 ensemble.csv（若有）。
"""

from __future__ import annotations

import io
import tarfile
import zipfile

from straditize_core.age_depth_model import AgeDepthModel
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"


def _create_session_with_model() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    session.columns[0]["name"] = "Picea"
    session.columns[0]["unit"] = "%"
    session.columns[0]["x_ticks"] = [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}]
    session.columns[1]["name"] = "Pinus"
    session.columns[1]["unit"] = "%"
    session.columns[1]["x_ticks"] = [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}]

    session.column_points = {
        0: [{"row": 300, "x": 10.0}, {"row": 500, "x": 50.0}, {"row": 700, "x": 90.0}],
        1: [{"row": 300, "x": 20.0}, {"row": 500, "x": 60.0}, {"row": 700, "x": 80.0}],
    }
    session.is_calibrated = True
    session.y_scale = {"slope": 0.5, "intercept": -100.0}

    session.samples = [
        {"row_px": 300, "depth": 50.0, "horizon_id": "H0001"},
        {"row_px": 500, "depth": 150.0, "horizon_id": "H0002"},
        {"row_px": 700, "depth": 250.0, "horizon_id": "H0003"},
    ]

    model = AgeDepthModel(
        depths=[0.0, 100.0, 200.0, 300.0],
        ages=[0.0, 500.0, 1100.0, 1800.0],
        age_min=[0.0, 480.0, 1050.0, 1720.0],
        age_max=[0.0, 520.0, 1150.0, 1880.0],
        curve_type="mean",
        envelope_type="95_hpd",
        depth_unit="cm",
        age_unit="cal yrBP",
        notes="Bacon test model",
    )
    session.age_depth_model = model
    return session


def test_data_csv_purity_with_horizon_id_and_no_age_columns():
    """验证 data.csv 首列为 horizon_id，且不掺杂任何模型衍生列。"""
    session = _create_session_with_model()
    res = session.export_data("csv")
    cols = res["columns"]

    # 首列必须为 horizon_id，次列为 depth
    assert cols[0] == "horizon_id"
    assert cols[1] == "depth"

    # 严禁出现年代模型衍生列
    forbidden = {"age_est", "age_lower_95", "age_upper_95", "depth_est", "sed_rate"}
    assert forbidden.isdisjoint(cols), f"data.csv 被模型衍生列污染: {forbidden.intersection(cols)}"

    # 验证行数与内容
    assert res["rows_count"] == 3
    assert res["data"][0]["horizon_id"] == "H0001"
    assert res["data"][1]["horizon_id"] == "H0002"
    assert res["data"][2]["horizon_id"] == "H0003"


def test_age_depth_dataframe_and_dataset_export():
    """验证 age_depth 数据集独立导出与字段完整性。"""
    session = _create_session_with_model()
    df = session.get_age_depth_dataframe()
    assert df is not None
    expected_cols = ["horizon_id", "depth", "age", "age_lower", "age_upper", "sed_rate"]
    assert list(df.columns) == expected_cols
    assert len(df) == 3
    assert df.iloc[0]["horizon_id"] == "H0001"
    assert df.iloc[0]["depth"] == 50.0

    # 经 RPC 风格 export_data 导出
    res = session.export_data("csv", dataset="age_depth")
    assert res["columns"] == expected_cols
    assert res["rows_count"] == 3
    assert res["data"][0]["horizon_id"] == "H0001"
    assert "H0001" in res["csv"]


def test_archive_tar_and_bundle_zip_include_age_depth():
    """验证 export_multi_tar 与 export_bundle_zip 正确打包独立的 age_depth.csv。"""
    session = _create_session_with_model()

    # 1. TAR 归档包
    tar_res = session.export_multi_tar()
    import base64
    tar_raw = base64.b64decode(tar_res["tar_base64"])
    tf = tarfile.open(fileobj=io.BytesIO(tar_raw))
    names = tf.getnames()
    assert "data.csv" in names
    assert "data/age_depth.csv" in names
    manifest_file = tf.extractfile("manifest.json")
    assert manifest_file is not None
    import json
    manifest = json.loads(manifest_file.read().decode("utf-8"))
    assert manifest.get("age_depth_csv") == "data/age_depth.csv"

    # 2. ZIP 出图包
    zip_res = session.export_bundle_zip()
    import base64
    zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(zip_res["base64"])))
    z_names = zf.namelist()
    assert "data.csv" in z_names
    assert "age_depth.csv" in z_names
    readme_text = zf.read("README.txt").decode("utf-8")
    assert "age_depth.csv" in readme_text
