# -*- coding: utf-8 -*-
"""`project_load` 载入结果的**完整状态快照**（重构前行为基线）。

## 为什么需要它

`project_load` 388 行，是工程包载入主流程：解析文件/压缩包 → 复位标度与像素状态 →
重建 ROI → 重建列与 x 组 → 换内嵌底图 → 回填元数据/样本/候选线/集合表 → 恢复年代-深度模型。
现有两个测试文件只钉住两处**局部语义**（C1d 换图、未来版本门禁），
「ROI 的默认 x 组怎么补」「列缺 x_ticks 时 x_values 从哪来」「control_points 是否 round」
这类逐字段结果没有任何判据——重构时改个 `.get(..., 默认值)` 就会静默漂移，
而界面看起来完全正常。

## 钉的是什么

三个入口载荷各跑一遍，把会话侧可序列化状态**逐字段**钉住（round 6）：

1. `legacy_roi`：老包（只有 `roi` 字典、无 `rois` 列表）→ 走 `roi_create` 分支；
2. `saved_rois`：新包（`rois` 列表，其中一个 ROI 缺 `x_groups`）→ 走默认组注入分支；
3. `tar_pack`：真 `.tar`（json 成员 + png 成员）→ 走文件解包分支。

覆盖的字段：data_xlim/data_ylim、标度（y_scale/depth_calib/depth_unit）、ROI 与其 x_groups、
列全字段、taxa_names、control_points、去线配置、论文元数据、samples、
line_candidates、selected_candidate_ids、ensemble_tables、age_depth 标定与模型、
底图指纹、以及"换图后必须被清空"的像素派生状态。

## 重新生成（仅在有意义地改载入语义时）

    UPDATE_PROJECT_LOAD_GOLDEN=1 pixi run python -m pytest \
        tests/unit/test_project_load_golden.py

## 反向验证（本基线有判别力，不是摆设）

改完基线后实测：把 `project_load` 里 x_groups 默认注入那段删掉，本文件必须变红。
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import tarfile
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession

GOLDEN = Path(__file__).parent / "fixtures" / "project_load_golden.json"

SCALAR_ATTRS = [
    "data_xlim",
    "data_ylim",
    "is_calibrated",
    "y_scale",
    "depth_calib",
    "depth_unit",
    "primary_roi_id",
    "active_roi_id",
    "taxa_names",
    "control_points",
    "degrid_strength",
    "degrid_remove_vertical",
    "line_corrections",
    "samples",
    "line_candidates",
    "selected_candidate_ids",
    "ensemble_tables",
    "paper_metadata",
    "age_depth_calib_state",
    "age_depth_image_path",
]

# 换底图后必须失效的"由像素算出来"的状态；一个都不许留。
PIXEL_DERIVED = [
    "image_array",
    "foreground_mask",
    "threshold",
    "segmentation_mode",
    "shadow_mask",
    "solid_layers",
    "foreground_column_edges",
    "tick_band",
    "grid_line_mask",
    "candidate_line_mask",
    "degrid_line_mask",
    "exclusion_mask",
    "manual_restore_mask",
    "manual_erase_mask",
]

COLUMN_KEYS = [
    "col_index",
    "id",
    "name",
    "species",
    "roi_id",
    "x_group_id",
    "x_values",
    "start",
    "startX",
    "end",
    "endX",
    "scale_type",
    "plot_type",
    "unit",
    "exaggeration_mult",
    "x_ticks",
    "startValue",
    "tickValue",
    "tickEndX",
]

ROI_KEYS = ["id", "xlim", "ylim", "default_group_id"]
GROUP_KEYS = ["id", "name", "unit", "plot_type", "scale_type", "exaggeration_mult", "tick_layout"]


def _png_bytes(size: tuple[int, int], color: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _b64(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _digest(image: Image.Image | None) -> str | None:
    if image is None:
        return None
    return hashlib.sha256(image.tobytes()).hexdigest()[:12]


def _jsonable(value: Any) -> Any:
    """把 numpy / set / 浮点收敛成可 JSON 比较的形状（浮点 round 6）。"""
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, (set, frozenset)):
        return sorted(_jsonable(v) for v in value)
    if isinstance(value, np.ndarray):
        return [_jsonable(v) for v in value.tolist()]
    if isinstance(value, (np.floating, float)):
        return round(float(value), 6)
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    return value


def _legacy_payload() -> dict:
    """老包：只有 roi 字典，没有 rois 列表。"""
    pack_png = _png_bytes((400, 300), (255, 0, 0))
    ad_png = _png_bytes((120, 90), (10, 20, 30))
    return {
        "version": "3.0.0",
        "schema_version": "3.0",
        "roi": {"x": 0.0, "y": 0.0, "w": 400.0, "h": 300.0},
        "depth_calibration": {
            "unit": "cm",
            "top_px": 20.0,
            "top_cm": 0.0,
            "bottom_px": 280.0,
            "bottom_cm": 130.0,
        },
        "line_removal": {
            "strength": 0.6,
            "remove_vertical": False,
            "corrections": [
                {"points": [[1, 2], [3, 4]]},
                {"points": [[5, 6]], "mode": "restore"},
            ],
        },
        "columns": [
            {
                "id": "col_a",
                "species": "Pinus",
                "startX": 10.0,
                "endX": 60.0,
                "unit": "%",
                "x_ticks": [{"px": 10.0, "value": 0.0}, {"px": 60.0, "value": 100.0}],
                "points": [{"x": 11.5, "y": 20.4}, {"x": 12.25, "y": 40.6}],
            },
            {
                "id": "col_b",
                "name": "Betula",
                "startX": 70.0,
                "endX": 120.0,
                "startValue": 5.0,
                "tickValue": 55.0,
                "plot_type": "line",
            },
            {
                "id": "col_c",
                "name": "Quercus",
                "startX": 130.0,
                "endX": 180.0,
                "x_group_id": "roi_1_grp_9",
                "x_values": [0.0, 10.0],
                "controlPoints": [{"x": 131.0, "y": 22.0}],
            },
        ],
        "image": {"base64": _b64(pack_png), "width": 400, "height": 300},
        "paper_metadata": {
            "publication": {"title": "Test pack"},
            "site": {"name": "Ngamring"},
        },
        "samples": [{"row_px": 50, "depth": 10.0}, {"row_px": 150, "depth": 60.0}],
        "line_candidates": [{"id": "c1", "x": 1.0}, {"id": "c2", "x": 2.0}],
        # 命中 c2：status 应变成 removed，另一条为 candidate（兼容视图由 status 派生）
        "selected_candidate_ids": ["c2"],
        "ensemble_tables": [{"name": "bacon", "rows": 2}],
        "age_depth": {
            "image_base64": _b64(ad_png),
            "calib_state": {"depth_unit": "cm", "top": [20.0, 0.0]},
            "inspection": {
                "depths": [0.0, 10.0, 20.0],
                "ages": [0.0, 500.0, 1000.0],
                "age_min": [0.0, 450.0, 950.0],
                "age_max": [10.0, 550.0, 1050.0],
                "metadata": {
                    "curve_type": "median",
                    "calibration_curve": "IntCal20",
                    "depth_unit": "cm",
                    "age_unit": "cal BP",
                },
                "px_points": {
                    "y": [20.0, 150.0, 280.0],
                    "x_curve": [100.0, 120.0, 140.0],
                    "x_min": [90.0, 110.0, 130.0],
                    "x_max": [110.0, 130.0, 150.0],
                },
            },
        },
    }


def _saved_rois_payload() -> dict:
    """新包：rois 列表，其中一个 ROI 缺 x_groups → 必须注入默认组。"""
    return {
        "version": "3.0.0",
        "schema_version": "3.0",
        "rois": [
            {"id": "roi_7", "xlim": [0.0, 400.0], "ylim": [0.0, 300.0]},
            {
                "id": "roi_8",
                "xlim": [0.0, 200.0],
                "ylim": [0.0, 300.0],
                "x_groups": [
                    {
                        "id": "g1",
                        "name": "甲组",
                        "unit": "%",
                        "plot_type": "area",
                        "scale_type": "linear",
                        "exaggeration_mult": None,
                        "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                    }
                ],
                "default_group_id": "g1",
            },
        ],
        "primary_roi_id": "roi_8",
        "active_roi_id": "roi_7",
        "columns": [
            {
                "id": "c1",
                "name": "Picea",
                "roi_id": "roi_8",
                "startX": 5.0,
                "endX": 55.0,
                "x_ticks": [{"px": 5.0, "value": 0.0}, {"px": 55.0, "value": 100.0}],
            }
        ],
    }


def _tar_pack(tmp_dir: Path) -> str:
    """造一个真 .tar：json 成员 + png 成员（走文件解包分支）。"""
    payload = _legacy_payload()
    payload.pop("image", None)
    payload.pop("age_depth", None)
    payload["image"] = {"path": "image/figure.png"}
    pack_png = _png_bytes((400, 300), (0, 128, 0))
    target = tmp_dir / "pack.tar"
    with tarfile.open(target, "w") as archive:
        raw = json.dumps(payload).encode("utf-8")
        info = tarfile.TarInfo("straditize.json")
        info.size = len(raw)
        archive.addfile(info, io.BytesIO(raw))
        info_png = tarfile.TarInfo("image/figure.png")
        info_png.size = len(pack_png)
        archive.addfile(info_png, io.BytesIO(pack_png))
    return str(target)


def _snapshot(session: StraditizeSession, result: dict) -> dict:
    rois = []
    for roi in getattr(session, "rois", []) or []:
        entry = {key: _jsonable(roi.get(key)) for key in ROI_KEYS}
        entry["x_groups"] = [
            {key: _jsonable(group.get(key)) for key in GROUP_KEYS}
            for group in roi.get("x_groups", []) or []
        ]
        rois.append(entry)

    columns = [
        {key: _jsonable(column.get(key)) for key in COLUMN_KEYS}
        for column in getattr(session, "columns", []) or []
    ]

    model = getattr(session, "age_depth_model", None)
    model_state = None
    if model is not None:
        model_state = {
            "depths": _jsonable(getattr(model, "depths", None)),
            "ages": _jsonable(getattr(model, "ages", None)),
            "curve_type": getattr(model, "curve_type", None),
            "envelope_type": getattr(model, "envelope_type", None),
            "cal_curve": getattr(model, "cal_curve", None),
            "depth_unit": getattr(model, "depth_unit", None),
            "age_unit": getattr(model, "age_unit", None),
            "px_y": _jsonable(getattr(model, "px_y", None)),
            "px_x_curve": _jsonable(getattr(model, "px_x_curve", None)),
        }

    snapshot = {attr: _jsonable(getattr(session, attr, "<absent>")) for attr in SCALAR_ATTRS}
    snapshot["rois"] = rois
    snapshot["roi_count"] = len(rois)
    snapshot["columns"] = columns
    snapshot["column_count"] = len(columns)
    snapshot["pixel_derived_after_load"] = {
        attr: _jsonable(getattr(session, attr, "<absent>")) for attr in PIXEL_DERIVED
    }
    snapshot["image"] = {
        "size": list(session.image.size) if getattr(session, "image", None) else None,
        "mode": getattr(session, "image", None).mode if getattr(session, "image", None) else None,
        "format": getattr(session, "image", None).format if getattr(session, "image", None) else None,
        "digest": _digest(getattr(session, "image", None)),
        "width": getattr(session, "width", None),
        "height": getattr(session, "height", None),
    }
    snapshot["age_depth_image"] = {
        "size": list(session.age_depth_image.size)
        if getattr(session, "age_depth_image", None)
        else None,
        "digest": _digest(getattr(session, "age_depth_image", None)),
    }
    snapshot["age_depth_model"] = model_state
    snapshot["result"] = _jsonable(result)
    return json.loads(json.dumps(snapshot))


def _fresh_session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    return session


def _build_snapshots(tmp_dir: Path) -> dict:
    out: dict[str, dict] = {}

    session = _fresh_session()
    out["legacy_roi"] = _snapshot(session, session.project_load(_legacy_payload()))

    session = _fresh_session()
    out["saved_rois"] = _snapshot(session, session.project_load(_saved_rois_payload()))

    session = _fresh_session()
    out["tar_pack"] = _snapshot(session, session.project_load(_tar_pack(tmp_dir)))

    return out


def test_project_load_state_snapshot_is_stable(tmp_path) -> None:
    """同一批载荷 → 载入后的会话状态逐字段不变。"""
    snapshot = _build_snapshots(tmp_path)

    if os.environ.get("UPDATE_PROJECT_LOAD_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_PROJECT_LOAD_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))

    assert snapshot.keys() == expected.keys(), (
        f"载荷集合变了：{sorted(snapshot)} vs {sorted(expected)}"
    )

    for case in expected:
        actual_case = snapshot[case]
        for key in expected[case]:
            assert actual_case.get(key) == expected[case][key], (
                f"[{case}] {key} 变了：\nactual   = "
                f"{json.dumps(actual_case.get(key), ensure_ascii=False, sort_keys=True)}\n"
                f"expected = {json.dumps(expected[case][key], ensure_ascii=False, sort_keys=True)}"
            )
