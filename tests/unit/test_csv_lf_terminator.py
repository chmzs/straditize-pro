# -*- coding: utf-8 -*-
"""导出的 CSV 必须是 LF 行尾（POSIX 契约），不能随平台漂移。

## 缺陷（Windows 现场）

`pandas.DataFrame.to_csv()` 的 `lineterminator` 默认是 `os.linesep`，在 Windows 上 = `\r\n`：

```python
pd.DataFrame({'a':[1],'b':[2]}).to_csv(na_rep='NA')   # -> ',a,b\r\n0,1,2\r\n'
```

所以 `data.csv` 是 CRLF。后果两条：

1. **解析**：按 `split('\n')` 解析的脚本会把 `\r` 吃进最后一列的名字（现场看到的
   `Concentration\r`）；R 的 `read.csv` 与 Python 的 `csv` 模块不受影响。
2. **字节稳定**：同一工程在 Windows 与 Linux 上导出的 `data.csv` 字节不同。当前 CI 是
   `windows-latest` 所以基线一致，一旦加 Linux job 或跨平台交换工程，digest 基线会假红。

## 判据

1. **运行时**（强）：`export_data()["csv"]` 不含 `\r`，且行数 = `rows_count + 1`。
2. **结构**（弱，但覆盖其余 4 个写入点）：`straditize_core/` 里每一处 `to_csv(` 调用都必须
   显式传 `lineterminator="\\n"`。这条是源码级检查，**不执行那些路径**——它唯一的作用是
   拦住"将来新增一个 to_csv 忘了传参"，这一层运行时用例覆盖不到。两层的判别力不同，
   故分开写、分开命名。

反向验证：把 `export.py` 里任一处的 `lineterminator="\\n"` 去掉 → 判据 1 或 2 变红。
"""

from __future__ import annotations

import re
from pathlib import Path

from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"
CORE = Path(__file__).resolve().parent.parent.parent / "straditize_core"


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    for column in session.columns[:3]:
        session.digitize(column["col_index"])
    session.is_calibrated = True
    session.y_scale = {"slope": 0.5, "intercept": -100.0}
    return session


def test_export_csv_uses_lf_line_endings() -> None:
    result = _session().export_data(format="csv")
    csv_text = result["csv"]

    assert "\r" not in csv_text, "导出 CSV 里出现 CR：Windows 上 pandas 默认写 CRLF"
    assert csv_text.count("\n") == result["rows_count"] + 1, (
        f"行数应与 rows_count+1 相等：实际 {csv_text.count(chr(10))} 行，"
        f"rows_count={result['rows_count']}"
    )
    # 表头最后一段不得带走任何控制字符（现场症状就是最后一个列名后面挂了 \r）
    header = csv_text.split("\n", 1)[0]
    assert header.split(",")[-1].strip() == header.split(",")[-1], (
        f"表头最后一个列名带空白/控制字符：{header.split(',')[-1]!r}"
    )


def test_every_to_csv_call_pins_lf_terminator() -> None:
    """源码级：任何 `to_csv(` 调用都必须显式 `lineterminator="\\n"`。

    这一层不跑那些写入路径（LiPD / tar / 出图临时文件各自的构造太重），只防"新增调用点忘传参"。
    """
    offenders: list[str] = []
    for path in sorted(CORE.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r"\.to_csv\((?:[^()]|\([^()]*\))*\)", text):
            call = match.group(0)
            if "lineterminator" not in call:
                line = text[: match.start()].count("\n") + 1
                offenders.append(f"{path.relative_to(CORE)}:{line}  {call[:70]}")
    assert not offenders, "以下 to_csv 调用没钉住 LF 行尾：\n" + "\n".join(offenders)
