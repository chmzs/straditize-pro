# -*- coding: utf-8 -*-
"""P1-A：`export_multi_xlsx` 的返回值必须能被 JSON-RPC 序列化。

## 缺陷本体（实测取证，不是推断）

旧实现 `session_parts/export.py` 的 `export_multi_xlsx` 返回
`{"data": xlsx_bytes}`，`xlsx_bytes` 是**原始 bytes**。JSON-RPC 层在
`protocol.handle_text` 里对结果做 `json.dumps`，于是抛
`TypeError: Object of type bytes is not JSON serializable`。服务端在写出
响应前就崩掉并关闭连接，前端拿到 `RemoteDisconnected`——用户点「导出 Excel」
**既没有文件也没有报错**（`docs/findings/production-gate-2026-10-23.md` §7.3）。

## 判据设计（避开三类假绿）

1. **不是 existence，是 equality**：断言 `base64` 解码后的字节 **等于**
   `size_bytes`，且 openpyxl 能打开、表名集合 **等于** 期望集合。只断言
   "`base64` 存在"会把 `base64=""` 也判绿。
2. **对象同一**：判据测的就是 RPC 层真正会 `json.dumps` 的那个 dict
   （`export_multi_xlsx` 的返回值），不是另建对象再序列化。
3. **有判别力**：把实现退回 `"data": xlsx_bytes` 时，
   `test_xlsx_result_is_json_serialisable` 必然变红（TypeError）。
   本文件第 4 条 `test_bytes_payload_would_not_serialise` 把这个反例
   **就地钉死**，证明这条判据确实能区分对错实现，而不是恒真。
"""

from __future__ import annotations

import base64
import io
import json
from pathlib import Path

import openpyxl
import pytest

from straditize_core.session import StraditizeSession

HOYA_PATH = Path("straditize_core/assets/tutorials/hoya-del-castillo.png")


def _make_calibrated_session() -> StraditizeSession:
    """真实图 + 两个 ROI + 两列已标定 + 两个采样层位（不是空会话，避免空对空恒真）。"""
    session = StraditizeSession()
    session.load_image(image_path=str(HOYA_PATH))
    # load_image 只自动建 1 个名为 pollen 的 ROI；第二张表必须显式建，
    # 否则"期望两张表"这个断言就成了凭空写下的数字（实测确认过）。
    session.roi_create(name="charcoal", composition=False)
    session.columns = [
        {
            "id": "col_1",
            "name": "Pinus",
            "startX": 320.0,
            "endX": 380.0,
            "col_index": 0,
            "roi_id": "roi_1",
            "x_ticks": [
                {"px": 320.0, "value": 0.0},
                {"px": 380.0, "value": 100.0},
            ],
        },
        {
            "id": "col_2",
            "name": "MicroCharcoal",
            "startX": 400.0,
            "endX": 460.0,
            "col_index": 1,
            "roi_id": "roi_2",
            "x_ticks": [
                {"px": 400.0, "value": 0.0},
                {"px": 460.0, "value": 1000.0},
            ],
        },
    ]
    session.column_points = {
        0: [{"row": 550, "x": 330.0}, {"row": 1100, "x": 320.0}],
        1: [{"row": 550, "x": 420.0}, {"row": 1100, "x": 410.0}],
    }
    session.samples = [
        {"row_px": 550, "depth": 20.0, "source": "manual"},
        {"row_px": 1100, "depth": 120.0, "source": "manual"},
    ]
    return session


def test_xlsx_result_is_json_serialisable():
    """不传 output_path（= 前端 ExportModal 的调用形状）必须能 json.dumps。"""
    session = _make_calibrated_session()
    result = session.export_multi_xlsx(include_meta_sheets=False)

    # 这一行就是旧实现崩掉的地方（TypeError: Object of type bytes ...）
    dumped = json.dumps(result)
    assert isinstance(dumped, str) and dumped

    # 契约字段：前端 ExportModal.ts 判 `res.base64`
    assert isinstance(result["base64"], str) and result["base64"]
    # 向后兼容：`data` 是**同一个 base64 串**，不是 bytes
    assert result["data"] == result["base64"]

    raw = base64.b64decode(result["base64"])
    # equality 判据：解出的字节数必须等于后端自报的 size_bytes
    assert len(raw) == result["size_bytes"]

    workbook = openpyxl.load_workbook(io.BytesIO(raw))
    assert set(workbook.sheetnames) == {"pollen", "charcoal"}


def test_xlsx_bytes_are_real_not_empty_placeholder():
    """base64 必须解出真实工作簿，而不是空壳（防 `base64=""` 之类假绿）。"""
    session = _make_calibrated_session()
    result = session.export_multi_xlsx(include_meta_sheets=False)
    raw = base64.b64decode(result["base64"])

    # xlsx 是 zip 容器：前两个字节必须是 PK
    assert raw[:2] == b"PK"
    workbook = openpyxl.load_workbook(io.BytesIO(raw))
    sheet = workbook["pollen"]
    rows = list(sheet.iter_rows(values_only=True))
    # 表头行 + 至少一个数据行，证明内容是真算出来的
    assert len(rows) >= 2
    assert "depth" in [str(cell) for cell in rows[0]]


def test_xlsx_with_output_path_returns_path_and_no_payload(tmp_path):
    """传 output_path：落盘 + 返回路径，且**不**回传内容（现状语义，别改坏）。"""
    session = _make_calibrated_session()
    target = tmp_path / "export.xlsx"
    result = session.export_multi_xlsx(
        output_path=str(target), include_meta_sheets=False
    )

    assert json.dumps(result)  # 同样必须可序列化
    assert result["success"] is True
    assert result["output_path"] == str(target)
    assert result["base64"] is None
    assert result["data"] is None

    # 文件真的落盘且是真 xlsx
    assert target.exists()
    written = target.read_bytes()
    assert len(written) == result["size_bytes"]
    assert written[:2] == b"PK"
    assert set(openpyxl.load_workbook(io.BytesIO(written)).sheetnames) == {
        "pollen",
        "charcoal",
    }


def test_bytes_payload_would_not_serialise():
    """判别力自证：旧形状（data=bytes）**必须**让 json.dumps 失败。

    这条是给上面前三条判据做对照的：如果哪天 `json.dumps` 变得能吞 bytes，
    上面"能序列化"的断言就不再具备判别力，这条会变红提醒复核判据。
    """
    session = _make_calibrated_session()
    result = session.export_multi_xlsx(include_meta_sheets=False)
    raw = base64.b64decode(result["base64"])

    legacy_shape = dict(result)
    legacy_shape["data"] = raw  # ← 退回旧实现的值类型

    with pytest.raises(TypeError):
        json.dumps(legacy_shape)
