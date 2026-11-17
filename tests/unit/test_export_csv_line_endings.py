"""issue #58：导出的 CSV 必须是 LF 行尾。

## 现象

Windows 上 `pandas.DataFrame.to_csv()` 默认 `lineterminator=None` → 用 `os.linesep` = `\\r\\n`。
自制解析器按 `split('\\n')` 切时会把 `\\r` 吃进**最后一个列名**，于是
`df['Concentration']` 查不到列（列名本身是干净的，脏的是行尾）。

## 判据

`_write_export_file(fmt="csv", ...)` 交回的 csv 文本里**不含** `\\r`。

反向验证：把 `lineterminator="\\n"` 去掉 → 本测试变红（实测 rc=1）。
"""

from __future__ import annotations

import pandas as pd

from straditize_core.session import StraditizeSession


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_export()
    return session


def test_exported_csv_uses_lf_line_endings() -> None:
    frame = pd.DataFrame({"depth": [10.0, 20.0], "Picea": [1.0, 2.0], "Concentration": [100.0, 200.0]})

    csv_string, _path = _session()._write_export_file("csv", frame, None)

    assert csv_string is not None
    assert "\r" not in csv_string, (
        "导出的 CSV 用了 CRLF：自制解析器会把 \\r 吃进末列名（issue #58）"
    )
    assert csv_string.split("\n")[0] == "depth,Picea,Concentration"
