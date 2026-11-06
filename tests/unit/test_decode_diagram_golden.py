# -*- coding: utf-8 -*-
"""`_decode_diagram_source` 的输出与报错基线。

## 为什么需要它

这个模块级函数是**所有图谱入口的解析器**：内置范例、base64 上传、本地路径、PDF 页抽取。
它的失败面几乎全是面向用户的中文提示（缺文件 / 范例缺失 / base64 坏了 / 页码越界 / PDF 纯矢量流），
而这些文案**没有任何测试断言过**——只有 docs/findings 里零散记录。

它内部还有一段几乎重复的 PDF 处理（base64 分支一份、路径分支一份），两份文案已经漂了：
`未包含任何页面` vs `未包含任何有效页面`、`请将该页导出…` vs `请将该页在外部导出…`。
要把它们合一，必须先有基线——否则"改了哪几句话"无法审计。

## 钉的是什么

正常路径：范例两张、base64 上传（data URL 与原样两种）、真 PDF 的位图页、真实图版路径。
失败路径：未知范例名、坏 base64、PDF 页码越界（base64 与路径两个入口各一）、路径不存在、
把 PNG 命名成 .pdf。每条都钉 `(format, size, mode, 路径文件名, pdf_info, PDF 原始字节数)`
或 `(错误码, 完整错误文案)`。

## 重新生成

    UPDATE_DECODE_GOLDEN=1 pixi run python -m pytest tests/unit/test_decode_diagram_golden.py
"""

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path

from PIL import Image

from straditize_core.protocol import JsonRpcError
from straditize_core.session_parts.core import _decode_diagram_source

GOLDEN = Path(__file__).parent / "fixtures" / "decode_diagram_golden.json"

PLATE = "tests/data/figures/real_plates/fig3_raw.jpeg"
VECTOR_PDF = "tests/data/figures/benchmark_types/Pollen_riojaPlotTestData.pdf"


def _label(value):
    if value is None:
        return None
    if value.startswith("upload://"):
        return value
    return os.path.basename(value)


def _png_bytes(size=(200, 150), color=(10, 120, 200)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def _pdf_bytes(tmp_dir: Path) -> bytes:
    target = tmp_dir / "bitmap.pdf"
    Image.new("RGB", (180, 120), (40, 40, 40)).save(target, "PDF")
    return target.read_bytes()


def _data_url(raw: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64," + base64.b64encode(raw).decode("ascii")


def _ok(result) -> dict:
    img, fmt, resolved_path, pdf_info, raw_pdf = result
    return {
        "format": fmt,
        "size": list(img.size),
        "mode": img.mode,
        "path": _label(resolved_path),
        "pdf_info": pdf_info,
        "raw_pdf_len": len(raw_pdf) if raw_pdf else None,
    }


def _case(**kwargs) -> dict:
    try:
        return {"ok": _ok(_decode_diagram_source(**kwargs))}
    except JsonRpcError as error:
        return {"raised": {"code": error.code, "message": str(error.message)}}


def _collect(tmp_dir: Path) -> dict:
    png = _png_bytes()
    pdf = _pdf_bytes(tmp_dir)
    return {
        "sample_hoya": _case(sample_key="hoya"),
        "sample_beginner": _case(sample_key="beginner"),
        "sample_unknown_key": _case(sample_key="no-such-sample"),
        "b64_png_data_url": _case(image_data=_data_url(png), file_name="x.png"),
        "b64_png_bare": _case(image_data=base64.b64encode(png).decode("ascii")),
        "b64_bad": _case(image_data="data:image/png;base64,!!!!not-base64!!!!"),
        "b64_pdf_page_1": _case(
            image_data=_data_url(pdf, "application/pdf"), page_number=1
        ),
        "b64_pdf_page_out_of_range": _case(
            image_data=_data_url(pdf, "application/pdf"), page_number=5
        ),
        "b64_png_named_pdf": _case(image_data=_data_url(png), file_name="scan.pdf"),
        "path_plate": _case(image_path=PLATE),
        "path_missing": _case(image_path="tests/data/does-not-exist.png"),
        "path_pdf_page_1": _case(image_path=str(tmp_dir / "bitmap.pdf"), page_number=1),
        "path_pdf_page_out_of_range": _case(
            image_path=str(tmp_dir / "bitmap.pdf"), page_number=5
        ),
        # 三条"两份 PDF 代码块文案已经漂了"的对照：同一个文件、两个入口各走一次。
        # 纯矢量流（仓内真实 rioja 图版）与坏 PDF 头各一条，加路径/内嵌两条入口。
        "vector_pdf_path": _case(image_path=VECTOR_PDF),
        "vector_pdf_b64": _case(
            image_data=_data_url(Path(VECTOR_PDF).read_bytes(), "application/pdf")
        ),
        "garbage_pdf_b64": _case(
            image_data=_data_url(b"%PDF-1.4 this is not a pdf", "application/pdf")
        ),
        "no_source": _case(),
    }


def test_decode_diagram_snapshot_is_stable(tmp_path) -> None:
    snapshot = _collect(tmp_path)

    if os.environ.get("UPDATE_DECODE_GOLDEN") == "1":
        GOLDEN.parent.mkdir(parents=True, exist_ok=True)
        GOLDEN.write_text(
            json.dumps(snapshot, indent=1, sort_keys=True, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return

    assert GOLDEN.exists(), f"缺少基线 {GOLDEN}；用 UPDATE_DECODE_GOLDEN=1 生成"
    expected = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert snapshot.keys() == expected.keys()

    for case in expected:
        assert snapshot[case] == expected[case], (
            f"[{case}] 变了：\nactual   = "
            f"{json.dumps(snapshot[case], ensure_ascii=False, sort_keys=True)}\n"
            f"expected = {json.dumps(expected[case], ensure_ascii=False, sort_keys=True)}"
        )
