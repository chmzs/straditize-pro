# -*- coding: utf-8 -*-
"""`export.exportLipd` 的下载契约：浏览器模式必须给 base64（真 zip）。

## 缺陷本体（用户实测：点「LiPD」没反应）

export_multi_lipd 两条分支都只返回 lipd 字典，从不返回 base64；写盘分支还把**纯 JSON 文本**
写进 .lpd。前端 ExportModal 判 res.base64 恒为 undefined → 既不下载也不报错。

## 判据

1. 无 output_path：base64 非空、解码后以 PK\x03\x04 开头（真 zip）、size_bytes 一致；
2. 有 output_path：落盘且 base64 is None，落盘文件也是 zip；
3. lipd 键保留（既有调用方 test_export_chain_equality / test_export_script_units 依赖）。

## 反向验证

把返回体改回 {"success": True, "lipd": ...}（无 base64）→ 第 1 条立刻红。
"""

from __future__ import annotations

import base64

from straditize_core.session import StraditizeSession


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.rois = [
        {
            "id": "roi_1",
            "name": "pollen",
            "default_group_id": "g1",
            "x_groups": [
                {
                    "id": "g1",
                    "name": "g1",
                    "unit": "%",
                    "plot_type": "area",
                    "scale_type": "linear",
                    "exaggeration_mult": None,
                    "value_per_px": 0.5,
                    "axis_stroke_px": 6,
                    "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                }
            ],
            "xlim": [200, 900],
            "ylim": [300, 700],
        }
    ]
    session.active_roi_id = "roi_1"
    session.primary_roi_id = "roi_1"
    session.columns = [
        {
            "col_index": 0,
            "name": "Pinus",
            "species": "Pinus",
            "roi_id": "roi_1",
            "x_group_id": "g1",
            "startX": 259.0,
            "start": 259.0,
            "endX": 947.0,
            "end": 947.0,
            "axis_stroke_px": None,
            "x_ticks": None,
        }
    ]
    session.taxa_names = ["Pinus"]
    session.is_calibrated = True
    session.y_scale = {"slope": 0.15, "intercept": 100.0}
    session.depth_calib = {
        "top_px": 400.0,
        "bottom_px": 600.0,
        "top_cm": 0.0,
        "bottom_cm": 30.0,
        "unit": "cm",
        "primary_axis": "depth",
    }
    session.depth_unit = "cm"
    session.samples = [
        {"row_px": row, "depth": None, "source": "auto"} for row in (400, 500)
    ]
    session.column_points = {0: [{"row": 400, "x": 300.0}, {"row": 500, "x": 340.0}]}
    session.control_points = {0: {400: 300.0, 500: 340.0}}
    return session


def test_browser_mode_returns_zip_base64() -> None:
    session = _session()
    result = session.export_multi_lipd()

    assert result.get("output_path") is None
    payload = result.get("base64")
    assert isinstance(payload, str) and payload, "浏览器下载模式必须返回 base64"
    raw = base64.b64decode(payload)
    assert raw[:4] == b"PK\x03\x04", f"不是 zip：头 {raw[:4]!r}"
    assert result["size_bytes"] == len(raw)
    assert result.get("lipd"), "lipd 键必须保留（既有调用方依赖）"


def test_write_mode_writes_zip_and_returns_no_base64(tmp_path) -> None:
    session = _session()
    target = tmp_path / "out.lpd"
    result = session.export_multi_lipd(output_path=str(target))

    assert result["base64"] is None, "写盘模式不得同时返回 base64"
    assert result["output_path"] == str(target.resolve())
    assert target.exists(), "写盘模式必须真的落盘"
    raw = target.read_bytes()
    assert raw[:4] == b"PK\x03\x04", f"落盘的不是 zip：头 {raw[:4]!r}"
    assert result["size_bytes"] == len(raw)
