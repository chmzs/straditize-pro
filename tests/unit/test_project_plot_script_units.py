"""工程包里的 `plot_strat.R` 也要按列量纲生成（S5，现场：recon-20261117）。

## 为什么单独一个文件

导出数据 tar（`export.py`）早就有「% 列按 `scale.percent` 归一、非 % 列按自身量程」
的分调用，但**保存工程包**（`project.py::_build_project_tar`）另写了一份硬编码脚本：

    strat.plot(df[-1], yvar=df[[1]], y.rev=TRUE, scale.percent=TRUE, ...)

于是同一份工程，「导出数据」给的脚本是对的，「保存工程包」给的是错的 —— 而用户
手里那份包里 `A/C`（比值，单位还被写成 `粒/g`）与 `Concentration`（259.74 value/px）
都被按 0–100 % 画，图与 `data.csv` 必然对不上（实测 48571 的浓度被画成满格）。

## 判据

1. 组里出现非 % 单位 → 工程包脚本生成**两次** `strat.plot`，非 % 列**只**出现在
   `scale.percent = FALSE` 那次里，% 列只出现在 `TRUE` 那次里；
2. 全 % 的工程 → 仍然**只生成一次**调用（零回归，与导出侧同一口径）；
3. 脚本里点名的每一列都必须在 `data.csv` 的表头里（脚本与表同源，不是各写一份）；
4. 硬编码回退自检：把 `_plot_strat_script_for_csv` 换回那行硬编码 → 判据 1 变红。
"""

from __future__ import annotations

import io
import tarfile
import tempfile
from pathlib import Path

from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"
Y_MARKS = [
    {"pixel": 233.0, "val": 0.0},
    {"pixel": 869.0, "val": 100.0},
]


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
    session.calibrate_axes(y_marks=[dict(m) for m in Y_MARKS], unit="cm")
    return session


def _two_groups(session: StraditizeSession) -> tuple[str, str, str]:
    roi_id = session.rois[0]["id"]
    pct_gid = session.roi_group_create(roi_id, name="pollen", unit="%")["group"]["id"]
    counts_gid = session.roi_group_create(roi_id, name="charcoal", unit="counts")[
        "group"
    ]["id"]
    for idx, col in enumerate(session.columns):
        col["x_group_id"] = counts_gid if idx == 0 else pct_gid
    session.roi_group_update(roi_id, pct_gid, {"value_per_px": 0.5})
    session.roi_group_update(roi_id, counts_gid, {"value_per_px": 5.0})
    return roi_id, pct_gid, counts_gid


def _package(session: StraditizeSession) -> dict[str, bytes]:
    """跑一次真实的 `project_save`，读回 tar 成员。"""
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "project.tar"
        session.project_save(output_path=str(path))
        members: dict[str, bytes] = {}
        with tarfile.open(fileobj=io.BytesIO(path.read_bytes()), mode="r") as tf:
            for info in tf.getmembers():
                if not info.isfile():
                    continue
                handle = tf.extractfile(info)
                if handle is not None:
                    members[info.name] = handle.read()
        return members


def _script(session: StraditizeSession) -> str:
    return _package(session)["plot_strat.R"].decode("utf-8")


def _csv_header(session: StraditizeSession) -> list[str]:
    text = _package(session)["data.csv"].decode("utf-8")
    return text.splitlines()[0].split(",")[1:]


def test_project_script_splits_percent_and_count_columns() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    counts_name = next(
        c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid
    )
    pct_name = next(
        c.get("name") for c in session.columns if c.get("x_group_id") != counts_gid
    )

    script = _script(session)
    assert script.count("strat.plot(") == 2, script
    pct_line = next(
        line for line in script.splitlines() if "scale.percent = TRUE" in line
    )
    fixed_line = next(
        line for line in script.splitlines() if "scale.percent = FALSE" in line
    )
    # 非 % 列只能出现在 FALSE 那次；% 列只能出现在 TRUE 那次。
    assert counts_name in script, "非 % 列必须被显式点名，否则会被默认当百分比画"
    assert f'"{counts_name}"' not in pct_line
    assert f'"{pct_name}"' in pct_line or f'"{pct_name}"' in script
    assert f'"{pct_name}"' not in fixed_line


def test_project_script_all_percent_stays_one_call() -> None:
    """零回归：全 % 的工程仍只生成一次 `strat.plot`，与历史脚本等价。"""
    session = _session()
    script = _script(session)
    assert "scale.percent = FALSE" not in script
    assert script.count("strat.plot(") == 1
    assert "scale.percent = TRUE" in script


def test_export_r_rpc_also_splits_by_unit() -> None:
    """导出面板「R 脚本」按钮（RPC `export.r`）也必须是按量纲分调用。

    现场：这个按钮此前返回一份**独立硬编码模板**（整表 `scale.percent = TRUE`、
    纵轴写死 `Depth (cm)`），是用户最容易走的那条路径，也是 S5 的第三个分叉点。
    """
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    script = session.export_r()
    assert isinstance(script, str) and "strat.plot" in script
    assert script.count("strat.plot(") == 2, script
    assert "scale.percent = FALSE" in script
    # 纵轴不得写死单位：本会话标定单位是 cm，但分组单位可能是 counts/粒-g。
    assert "Depth (cm)" not in script


def test_project_script_names_only_columns_present_in_data_csv() -> None:
    """脚本与 `data.csv` 同源：点名的每一列都必须真的在表头里。"""
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    script = _script(session)
    # 两处 intersect(...) 的列名向量
    for line in script.splitlines():
        if " <- intersect(" not in line:
            continue
        vector = line.split("c(", 1)[1].rsplit(", names(", 1)[0]
        names = [part.strip().strip('"') for part in vector.rstrip(")").split(",")]
        header = _csv_header(session)
        missing = [name for name in names if name and name not in header]
        assert not missing, f"脚本点名了 data.csv 里没有的列：{missing}"
