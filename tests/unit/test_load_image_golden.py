# -*- coding: utf-8 -*-
"""`load_image` 的结果与副作用快照（重构前基线）。

## 为什么需要它

`load_image` 139 行，真正的复杂度不在"载入"，而在**换图必须清空哪些"上一张图"的状态**：
清理清单里每一行都对着一个实测缺陷（B-03 清理几何残留、B-11 samples 串图、x_scales/reader_types
按 col_index 存、撤销栈能把旧图列复活到新图上……），同时**故意不清**年代学与论文元数据。
漏清一项界面上完全看不出来，要到导出 CSV 或撤销时才发现。

现有测试是分散的功能断言，没有一处逐字段钉住"载入之后会话应该长什么样"。

## 钉的是什么

六个案例：两个内置范例、一条真实图版路径、一段 base64 上传、一个现场生成的位图 PDF 第 1 页
（仓库里的 rioja PDF 是纯矢量流，只用它钉住的会是报错分支），以及最要紧的第六个——
先载 hoya、把上一张图的状态全部造出来（列/样本/掩膜/标定/撤销栈/PDF 缓存），再载第二张。
只用空白会话载入时，清理清单删掉任何一行都测不出来（实测：删掉 samples 的赋值仍全绿）。
每条都钉：

* 返回字典（尺寸/格式/模式/image_path/suggested_roi/pdf_info/rois 几何）；
* 载入后的会话状态（列/样本/候选线/刻度带/掩膜/撤销栈/标定字段/ROI 计数）；
* `image_array` 只在超过 16M 像素时置空，故同时钉"置空与否"。

## 重新生成

    UPDATE_LOAD_IMAGE_GOLDEN=1 pixi run python -m pytest tests/unit/test_load_image_golden.py
"""

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image

from straditize_core.session import StraditizeSession

GOLDEN = Path(__file__).parent / "fixtures" / "load_image_golden.json"

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
# PDF 用 PIL 现场生成：仓库里的 rioja 图版是纯矢量流（源码里明确会 raise），
# 那样钉住的只是报错分支，钉不到"从 PDF 抽位图"的正常路径。

CLEARED_ATTRS = [
    "foreground_mask",
    "grid_line_mask",
    "candidate_line_mask",
    "degrid_line_mask",
    "exclusion_mask",
    "manual_restore_mask",
    "manual_erase_mask",
    "foreground_column_edges",
    "shadow_mask",
    "solid_layers",
    "tick_band",
    "y_scale",
    "depth_calib",
    "data_xlim",
    "data_ylim",
    "cleanup_overlay_png",
    "degrid_strength",
    "degrid_info",
]

LIST_ATTRS = [
    "columns",
    "samples",
    "line_candidates",
    "line_strokes",
    "exclusion_regions",
    "taxa_names",
    "depth_grid",
    "undo_stack",
    "redo_stack",
]

DICT_ATTRS = ["column_points", "control_points", "reader_types", "x_scales", "cleanup_stats"]


def _path_label(value):
    """把绝对路径收敛成文件名——基线入库后要能在别的机器/CI 上跑。"""
    if value is None:
        return None
    if value.startswith("upload://"):
        return value
    return os.path.basename(value)


def _png_data_url() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (240, 180), (200, 40, 40)).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _jsonable(value):
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in sorted(value.items())}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    if isinstance(value, set):
        return sorted(_jsonable(v) for v in value)
    if isinstance(value, float):
        return round(float(value), 3)
    if hasattr(value, "tolist"):
        return _jsonable(value.tolist())
    return value


def _snapshot(session: StraditizeSession, result: dict) -> dict:
    rois = [
        {"id": roi.get("id"), "xlim": _jsonable(roi.get("xlim")), "ylim": _jsonable(roi.get("ylim"))}
        for roi in getattr(session, "rois", []) or []
    ]
    return {
        "result": {
            "success": result["success"],
            "width": result["width"],
            "height": result["height"],
            "format": result["format"],
            "mode": result["mode"],
            "image_path": _path_label(result["image_path"]),
            "image_url": result["image_url"],
            "suggested_roi": _jsonable(result["suggested_roi"]),
            "pdf_info": _jsonable(result["pdf_info"]),
            "primary_roi_id": result["primary_roi_id"],
            "active_roi_id": result["active_roi_id"],
        },
        "rois": rois,
        "image": {
            "size": list(session.image.size),
            "mode": session.image.mode,
            "format": session.format,
        },
        "image_array": {
            "is_none": session.image_array is None,
            "shape": list(session.image_array.shape) if session.image_array is not None else None,
        },
        "is_calibrated": session.is_calibrated,
        "selected_candidate_ids": _jsonable(session.selected_candidate_ids),
        "cleared": {attr: _jsonable(getattr(session, attr, "<absent>")) for attr in CLEARED_ATTRS},
        "lists": {attr: len(getattr(session, attr, []) or []) for attr in LIST_ATTRS},
        "dicts": {attr: _jsonable(getattr(session, attr, {})) for attr in DICT_ATTRS},
        "pdf_cache": {
            "has_pdf_data": getattr(session, "cached_pdf_data", None) is not None,
            "cached_pdf_path_is_pdf": bool(
                (getattr(session, "cached_pdf_path", None) or "").lower().endswith(".pdf")
            ),
            "pdf_info": _jsonable(getattr(session, "pdf_info", None)),
        },
    }


def _collect(tmp_dir: Path) -> dict:
    out = {}

    session = StraditizeSession()
    session._init_cleanup()
    out["sample_hoya"] = _snapshot(session, session.load_image(sample_key="hoya"))

    session = StraditizeSession()
    session._init_cleanup()
    out["sample_beginner"] = _snapshot(session, session.load_image(sample_key="beginner"))

    session = StraditizeSession()
    session._init_cleanup()
    out["path_plate"] = _snapshot(session, session.load_image(image_path=PLATE))

    session = StraditizeSession()
    session._init_cleanup()
    out["base64_upload"] = _snapshot(
        session,
        session.load_image(image_data=_png_data_url(), file_name="my-diagram.png"),
    )

    # 关键案例：必须先有一张图 + 一堆"上一张图"的状态，再载第二张。
    # 只用空白会话载入时，清理清单里删掉任何一行都测不出来（实测：删 samples 赋值仍全绿）。
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(sample_key="hoya")
    session.samples = [{"row_px": 10, "depth": 5.0}]
    session.columns = [{"id": "stale_col", "col_index": 0, "start": 1, "end": 2}]
    session.control_points = {0: {5: 1.0}}
    session.x_scales = {0: 1.5}
    session.reader_types = {0: "area"}
    session.line_candidates = [{"id": "cand_stale", "status": "candidate"}]
    session.exclusion_regions = [{"id": "region_stale"}]
    session.line_strokes = [{"id": "stroke_stale"}]
    session.selected_candidate_ids = {"cand_stale"}
    session.foreground_mask = np.zeros((8, 8), dtype=bool)
    session.grid_line_mask = np.zeros((8, 8), dtype=bool)
    session.tick_band = {"y0": 1, "y1": 2}
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    session.depth_calib = {"top_px": 0.0, "bottom_px": 10.0, "top_cm": 0.0, "bottom_cm": 5.0}
    session.taxa_names = ["Stale"]
    session.depth_grid = [0.0, 10.0]
    session.cleanup_stats = {"removed": 1}
    session.degrid_strength = 0.5
    session.degrid_info = {"strength": 0.5}
    session.undo_stack = ["snapshot_of_previous_image"]
    session.cached_pdf_data = b"%PDF-1.4 stale"
    out["reload_over_stale_state"] = _snapshot(
        session, session.load_image(sample_key="beginner")
    )

    pdf_path = tmp_dir / "bitmap-doc.pdf"
    Image.new("RGB", (300, 200), (30, 30, 30)).save(pdf_path, "PDF")
    session = StraditizeSession()
    session._init_cleanup()
    out["pdf_page_1"] = _snapshot(
        session, session.load_image(image_path=str(pdf_path), page_number=1)
    )

    # 缓存 PDF 回落：不传任何图源时，load_image 必须回到上一次的 PDF（PDF 换页正靠它）。
    # 这条以前没被本文件覆盖——正是它漏掉了 helper 里 image_path/image_data 未初始化的
    # UnboundLocalError（全量套件里的 switch_pdf_page 用例抓到）。
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(pdf_path), page_number=1)
    session.samples = [{"row_px": 3, "depth": 1.0}]
    out["cached_pdf_reload"] = _snapshot(session, session.switch_pdf_page(1))

    return out


def test_load_image_snapshot_is_stable(tmp_path) -> None:
    snapshot = _jsonable(_collect(tmp_path))

    if os.environ.get("UPDATE_LOAD_IMAGE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_LOAD_IMAGE_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        for key in expected[case]:
            assert snapshot[case][key] == expected[case][key], (
                f"[{case}] {key} 变了：\nactual   = "
                f"{json.dumps(snapshot[case][key], ensure_ascii=False, sort_keys=True)[:1500]}\n"
                f"expected = "
                f"{json.dumps(expected[case][key], ensure_ascii=False, sort_keys=True)[:1500]}"
            )
