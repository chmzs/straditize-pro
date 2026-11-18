"""导出的 CSV 落盘行尾必须是**单个换行**，且不能出现 `\\r\\r\\n` 这类被翻译两次的尾巴。

两段缺陷史，别混：

1. 历史缺陷（真实上机发现）：`_write_export_file` 用文本模式 `open(..., "w")` 写
   `df.to_csv()` 的结果，pandas 已用 `\\r\\n` 结尾，文本模式再把 `\\n` 翻成 `\\r\\n`
   ⇒ 落盘成了 `\\r\\r\\n`。R / Excel 读到多余 `\\r` 会把最后一列的值与列名带上控制符
   （实测：内存字符串 35 行，落盘文件按 `splitlines()` 数出 71 行）。修法是显式 `newline=""`。
2. 现行契约：`to_csv(lineterminator="\\n")` + `newline=""` ⇒ 落盘行尾是**单个 LF**，
   与平台无关（Windows 上也不再是 CRLF）。这样同一工程在 Windows/Linux 上导出的字节一致，
   按 `split('\\n')` 解析的脚本也不会把 `\\r` 吃进最后一列的名字。

下面两条用例断言的是第 2 条契约；第 1 条的"不许出现 CRCRLF"仍然成立（现在是"一个 CR 都不许有"）。
"""

from __future__ import annotations

import pandas as pd

from straditize_core.session import StraditizeSession


def test_csv_file_has_no_carriage_return(tmp_path) -> None:
    session = StraditizeSession()
    frame = pd.DataFrame({"depth": [1.0, 2.0, 3.0], "Pinus": [0.0, 1.5, 2.5]})
    _, path = session._write_export_file("csv", frame, str(tmp_path / "out.csv"))
    raw = open(path, "rb").read()
    # 一个 CR 都不许有：既是历史上 "\r\r\n" 那类缺陷的更狠版本，
    # 也保证跨平台字节一致（见模块 docstring 第 2 条契约）。
    assert raw.count(b"\r") == 0, raw[:120]
    assert raw.count(b"\n") == len(frame) + 1, raw.count(b"\n")


def test_csv_file_line_count_matches_frame(tmp_path) -> None:
    session = StraditizeSession()
    frame = pd.DataFrame({"depth": [0.5] * 7, "A": [0.0] * 7})
    _, path = session._write_export_file("csv", frame, str(tmp_path / "n.csv"))
    text = open(path, encoding="utf-8", newline="").read()
    assert len(text.splitlines()) == len(frame) + 1
