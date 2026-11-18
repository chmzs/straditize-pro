"""导出出图整包（`export.bundleZip`）：data.csv + plot_strat.R + plot_strat.jpg + README.txt。

## 为什么要整包

导出面板此前只给一个 `.R`：脚本里写着 `if (file.exists('data.csv'))`，用户没有 csv 时
整段绘图被静默跳过，产物是一张空 PDF。整包把脚本、数据、成品图放一起，解压即可
`Rscript plot_strat.R`。

## 判据

1. zip 条目**恰好四个**（不静默少文件）；
2. `data.csv` 表头不含 `\\r`——列名带 `\\r` 时 `read.csv` 后 `intersect()` 匹配不上，
   整列会被静默丢掉；
3. 脚本无参可跑：含 `csv_path` / `out_path` 的默认值，且缺文件时 `stop()`；
4. `plot_strat.jpg` 是真 JPEG（魔术字节 FFD8FF）；
5. README 写明 `NA` = 无数据、不是 0。

反向验证：把 `require_file=True` 改回默认（走 `if (file.exists(...))`）→ 判据 3 变红；
把表头 strip 去掉并在列名里塞 `\\r` → 判据 2 变红。
"""

from __future__ import annotations

import base64
import io
import zipfile

import pytest

from straditize_core.session import StraditizeSession
from straditize_core.strat_plot import SUPPORTED_PLOT_FORMATS  # noqa: F401  (契约自检留痕)


def _has_rioja() -> bool:
    from straditize_core.plotting import candidate_rscripts
    import subprocess

    found = candidate_rscripts()
    if not found:
        return False
    try:
        out = subprocess.run(
            [found[0], "-e", 'cat(requireNamespace("rioja", quietly = TRUE))'],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return out.stdout.strip().upper() == "TRUE"


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_export()
    session.columns = [
        {
            "col_index": 0,
            "name": "Picea",
            "roi_id": "roi_1",
            "unit": "%",
            "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
        },
        {
            "col_index": 1,
            "name": "Concentration\r",
            "roi_id": "roi_1",
            "unit": "粒/g",
            "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 50000.0}],
        },
    ]
    session.column_points = {
        0: [{"row": 10, "x": 10.0}, {"row": 20, "x": 50.0}, {"row": 30, "x": 90.0}],
        1: [{"row": 10, "x": 20.0}, {"row": 20, "x": 60.0}, {"row": 30, "x": 80.0}],
    }
    session.samples = [{"row_px": r, "depth": float(r)} for r in (10, 20, 30)]
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    return session


@pytest.mark.skipif(not _has_rioja(), reason="整包要出一张 jpg，需要 R + rioja")
def test_bundle_contains_four_files_and_runnable_script() -> None:
    payload = _session().export_bundle_zip()

    assert payload["success"] is True
    assert payload["mime"] == "application/zip"
    data = base64.b64decode(payload["base64"])
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        names = set(bundle.namelist())
        assert names == {"data.csv", "plot_strat.R", "plot_strat.jpg", "README.txt"}, names

        csv_bytes = bundle.read("data.csv")
        # 断言整份字节没有 \r：`splitlines()` 会在 \r\n 处切开，只看 header 抓不到 CRLF 行尾
        # （issue #58：pandas 在 Windows 默认用 os.linesep，自制解析器把 \r 吃进末列名）。
        assert b"\r" not in csv_bytes, "data.csv 必须是 LF 行尾：CRLF 会让自制解析器把 \\r 吃进末列名"
        header = csv_bytes.decode("utf-8").split("\n")[0]

        script = bundle.read("plot_strat.R").decode("utf-8")
        assert "csv_path <- if (length(args) >= 1" in script, "脚本必须无参可跑"
        assert "out_path <- if (length(args) >= 2" in script
        assert "if (!file.exists(csv_path)) stop(" in script, (
            "缺 data.csv 必须当场报错，不能静默出空 PDF"
        )

        shot = bundle.read("plot_strat.jpg")
        assert shot[:3] == b"\xff\xd8\xff", "plot_strat.jpg 必须是真 JPEG"

        readme = bundle.read("README.txt").decode("utf-8")
        assert "NA" in readme and "Rscript plot_strat.R" in readme
