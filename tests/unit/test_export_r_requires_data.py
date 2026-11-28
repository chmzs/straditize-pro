# -*- coding: utf-8 -*-
"""回归钉子（#188）：`export.r` 缺少 `data.csv` 时必须 fail-fast，不得产出空 PDF 并报成功。"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from straditize_core.session import StraditizeSession


def _calibrated_session() -> StraditizeSession:
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns([315, 1946], [511, 1311])
    session.calibrate_axes(
        y_marks=[{"pixel": 511.0, "val": 0.0}, {"pixel": 1311.0, "val": 100.0}],
        unit="cm",
    )
    for col in session.columns:
        start = float(col["start"])
        col["x_ticks"] = [{"px": start, "value": 0.0}, {"px": start + 50.0, "value": 100.0}]
    return session


def test_export_r_checks_data_csv_before_opening_pdf() -> None:
    """`export_r` 生成的脚本必须在 `pdf()` 之前检查 `data.csv` 并 `stop()`。"""
    session = _calibrated_session()
    script = session.export_r()
    assert isinstance(script, str)
    assert "if (!file.exists('data.csv')) stop(" in script
    assert "出图包" in script
    assert script.index("stop(") < script.index("pdf('stratigraphic_diagram.pdf'")


def test_export_r_script_fails_in_empty_dir_and_renders_with_data(tmp_path: Path) -> None:
    """空目录运行 `Rscript plot_strat.R` 必须非零退出且不产出 PDF；放上 `data.csv` 则正常出图。"""
    rscript = shutil.which("Rscript")
    if not rscript:
        pytest.skip("Rscript not installed")

    session = _calibrated_session()
    script = session.export_r()
    assert isinstance(script, str)

    solo_dir = tmp_path / "solo"
    solo_dir.mkdir()
    solo_script = solo_dir / "plot_strat.R"
    solo_script.write_text(script, encoding="utf-8")

    proc_solo = subprocess.run(
        [rscript, str(solo_script)],
        cwd=solo_dir,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert proc_solo.returncode != 0, "缺 data.csv 时 Rscript 不得返回 exit 0"
    assert not (solo_dir / "stratigraphic_diagram.pdf").exists(), (
        "缺 data.csv 时不得产出空 PDF"
    )
    assert "Diagram successfully rendered" not in (proc_solo.stdout + proc_solo.stderr)

    # 反向哨兵：若本机装有 rioja，同目录放入 data.csv 后应正常出图且退出码为 0
    has_rioja = (
        subprocess.run(
            [rscript, "-e", "quit(status = ifelse(requireNamespace('rioja', quietly=TRUE), 0, 1))"],
            capture_output=True,
            timeout=15,
        ).returncode
        == 0
    )
    if has_rioja:
        with_data_dir = tmp_path / "with_data"
        with_data_dir.mkdir()
        (with_data_dir / "plot_strat.R").write_text(script, encoding="utf-8")
        session.export_data("csv", output_path=str(with_data_dir / "data.csv"))
        proc_ok = subprocess.run(
            [rscript, "plot_strat.R"],
            cwd=with_data_dir,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert proc_ok.returncode == 0, proc_ok.stderr
        pdf_file = with_data_dir / "stratigraphic_diagram.pdf"
        assert pdf_file.is_file() and pdf_file.stat().st_size > 10_000
