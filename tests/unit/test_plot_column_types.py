"""逐列形态（`plot_type`）必须逐列生效，不是全局一个开关。

## 背景

画布上每列可以是 `area / bar / line / symbol`（`frontend/src/types/pollen.ts`），
但 R 模板此前只有全局 `silhouette/bar/line` 三个 flag —— 画布改了形态，出图还是老样子。

## 做法

`plot_type.<列名>` 写进 settings，R 侧按列拼逻辑向量传给 `riojaPlot`
（`.riojaPlot2:401` 是 `plot.line[i]`，本来就是逐列取值）。

## 判据

1. settings 里每列都有一条 `plot_type.<列名>`；
2. 把一列改成 `line`、另一列改成 `symbol`，产物字节必须变化；
3. 脚本里必须出现 `plot.poly = poly_v`（缺 key 的列退回全局开关）。

反向验证：把四处 `plot.poly = poly_v...` 删掉 → 判据 2 变红（字节相同）。
"""

from __future__ import annotations

import pytest

from straditize_core.plotting import candidate_rscripts
from straditize_core.strat_plot import STRAT_PLOT_SCRIPT, render_strat_diagram

CSV = "depth,Picea,Abies,Concentration\n10,10,20,1000\n20,50,10,2000\n30,90,40,3000\n"


def _rscript() -> str | None:
    found = candidate_rscripts()
    return found[0] if found else None


RSCRIPT = _rscript()


def _has_rioja() -> bool:
    """CI 上有 R 但没有 rioja 包：只探测 Rscript 会让这两条转成运行期报错，而不是 skip。"""
    if not RSCRIPT:
        return False
    import subprocess

    try:
        out = subprocess.run(
            [RSCRIPT, "-e", 'cat(requireNamespace("rioja", quietly = TRUE))'],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return out.stdout.strip().upper() == "TRUE"


@pytest.mark.skipif(not _has_rioja(), reason="plot_render 需要 R + rioja")
def test_every_column_carries_a_plot_type_key() -> None:
    from straditize_core.session import StraditizeSession

    session = StraditizeSession()
    session._init_export()
    session.columns = [
        {
            "col_index": 0,
            "name": "Picea",
            "roi_id": "roi_1",
            "plot_type": "line",
            "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
        },
        {
            "col_index": 1,
            "name": "Abies",
            "roi_id": "roi_1",
            "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
        },
    ]
    session.column_points = {
        0: [{"row": 10, "x": 10.0}, {"row": 20, "x": 50.0}],
        1: [{"row": 10, "x": 20.0}, {"row": 20, "x": 40.0}],
    }
    session.samples = [{"row_px": r, "depth": float(r)} for r in (10, 20)]
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}

    result = session.plot_render()
    settings = result["settings"]

    assert settings["plot_type.Picea"] == "line"
    assert settings["plot_type.Abies"] == "area", "没设过的列按默认 area 写出去"


def test_template_wires_vectors_for_every_call() -> None:
    # 四处接线：段内首段 / 段内后续 / 不分段 / 向量构造
    assert STRAT_PLOT_SCRIPT.count("plot.poly = poly_v") >= 3
    assert (
        "symb_v[[.ptype_col]] <- identical(.ptype_val, 'symbol')" in STRAT_PLOT_SCRIPT
    )


@pytest.mark.skipif(not _has_rioja(), reason="本机没有 R + rioja")
def test_plot_type_changes_the_artifact(tmp_path) -> None:
    csv_path = tmp_path / "in.csv"
    csv_path.write_text(CSV, encoding="utf-8")
    base = {"plot_segments": False}

    area = render_strat_diagram(
        csv_path=str(csv_path),
        out_path=str(tmp_path / "area.jpeg"),
        rscript=str(RSCRIPT),
        settings={**base, "plot_type.Picea": "area", "plot_type.Abies": "area"},
    )
    lines = render_strat_diagram(
        csv_path=str(csv_path),
        out_path=str(tmp_path / "line.jpeg"),
        rscript=str(RSCRIPT),
        settings={**base, "plot_type.Picea": "line", "plot_type.Abies": "symbol"},
    )

    assert area["size_bytes"] != lines["size_bytes"], (
        "改了列形态但产物字节一样：R 侧根本没吃 plot_type.<列名>"
    )
