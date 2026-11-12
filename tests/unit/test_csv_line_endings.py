"""导出的 CSV 落盘行尾必须是单个 CRLF，不能是 CRCRLF。

缺陷背景（真实上机发现）：`_write_export_file` 用文本模式 `open(..., "w")` 写
`df.to_csv()` 的结果。pandas 已经用 `\\r\\n` 结尾，文本模式的换行翻译再把 `\\n`
翻成 `\\r\\n`，落盘就成了 `\\r\\r\\n`。R / Excel 读到行尾多余的 `\\r` 会把最后一列
的值与列名带上控制符（本次实测：内存字符串 35 行、落盘文件按 `splitlines()` 数出 71 行，
就是被 `\\r\\r\\n` 多切了一刀）。
"""

from __future__ import annotations

import pandas as pd

from straditize_core.session import StraditizeSession


def test_csv_file_has_no_double_carriage_return(tmp_path) -> None:
    session = StraditizeSession()
    frame = pd.DataFrame({"depth": [1.0, 2.0, 3.0], "Pinus": [0.0, 1.5, 2.5]})
    _, path = session._write_export_file("csv", frame, str(tmp_path / "out.csv"))
    raw = open(path, "rb").read()
    assert raw.count(b"\r\r\n") == 0, raw[:120]
    assert raw.count(b"\r\n") == len(frame) + 1, raw.count(b"\r\n")


def test_csv_file_line_count_matches_frame(tmp_path) -> None:
    session = StraditizeSession()
    frame = pd.DataFrame({"depth": [0.5] * 7, "A": [0.0] * 7})
    _, path = session._write_export_file("csv", frame, str(tmp_path / "n.csv"))
    text = open(path, encoding="utf-8", newline="").read()
    assert len(text.splitlines()) == len(frame) + 1
