"""随包 `plot_strat.R` 按单位决定 `scale.percent`：非 % 列不再共用百分比基准。

## 缺口

`plot_strat.R` 对每个 ROI 一律 `scale.percent = TRUE`。用户把炭屑 / 花粉浓度放在同一
图里（col01 / col28）时，这两列会被当成 0–100 百分比画 —— 与「出图」里看到的平线是
同一个缺陷的导出侧对应物。

## 判据

1. 组里出现非 % 单位 → 脚本对该列写 `scale.percent = FALSE`（另起一次 `add = TRUE` 调用），
   且**任何**含 `scale.percent = TRUE` 的行都不提这一列；
2. `manifest.json` 记 `column_units`（按 ROI）与 `group_units`；`README.txt` 列出单位与规则；
3. 同一份数据里，列载荷 `unit` / LiPD `units` / manifest `column_units` 三处字符串一致；
4. 全 % 的工程仍生成原来那一次 `strat.plot(... scale.percent = TRUE ...)`（零回归）。

## 反向验证

把 `is_percent_unit` 改成恒 `True`（= 回到硬写 TRUE）→ 判据 1 变红。
"""

from __future__ import annotations

import base64
import io
import json
import subprocess
import tarfile

import pytest

from straditize_core.plotting import candidate_rscripts

from straditize_core.protocol import JsonRpcDispatcher
from straditize_core.rpc_methods import system as system_methods
from straditize_core.session import StraditizeSession

PLATE = "tests/data/figures/plates/han2026GPC_ngamringLake_withbackcolor.jpeg"


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=PLATE)
    session.detect_columns(data_xlim=[330, 1330], data_ylim=[233, 869])
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


def _tar_members(session: StraditizeSession) -> dict[str, bytes]:
    result = session.export_multi_tar()
    raw = base64.b64decode(result["data"])
    members: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r") as tf:
        for info in tf.getmembers():
            handle = tf.extractfile(info)
            if handle is not None:
                members[info.name] = handle.read()
    return members


def _script(session: StraditizeSession) -> str:
    return _tar_members(session)["plot_strat.R"].decode("utf-8")


def _payload(session: StraditizeSession) -> dict:
    dispatcher = JsonRpcDispatcher()
    system_methods.register(dispatcher, session)
    return dispatcher._methods["straditize.getDiagramData"]()


def _lipd_units(lipd: dict) -> dict[str, str]:
    found: dict[str, str] = {}

    def walk(node: object) -> None:
        if isinstance(node, dict):
            if "variableName" in node and "units" in node:
                found[str(node["variableName"])] = str(node["units"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(lipd)
    return found


def test_non_percent_column_is_not_plotted_on_the_percent_basis() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    units = session._roi_column_units()[session.rois[0]["name"]]
    fixed_name = next(
        c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid
    )
    pct_name = next(
        c.get("name") for c in session.columns if c.get("x_group_id") != counts_gid
    )
    assert units[fixed_name] == "counts"

    script = _script(session)

    assert f'fixed_cols <- intersect(c("{fixed_name}")' in script, (
        "非百分比列必须被单独挑出来画：\n" + script
    )
    assert "scale.percent = FALSE" in script, "非百分比列必须关掉百分比刻度"
    pct_line = next(
        line for line in script.splitlines() if "pct_cols <- intersect(" in line
    )
    assert f'"{pct_name}"' in pct_line, f"百分比列仍按百分比基准画：{pct_line}"
    # 判据的核心：含 TRUE 的那一行不许提到非百分比列（否则它又回到 0-100 基准）
    for line in script.splitlines():
        if "scale.percent = TRUE" in line:
            assert fixed_name not in line, f"非百分比列仍在百分比调用里：{line}"


def test_manifest_records_column_and_group_units() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    manifest = json.loads(_tar_members(session)["manifest.json"].decode("utf-8"))
    roi_name = session.rois[0]["name"]
    fixed_name = next(
        c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid
    )

    assert manifest["column_units"][roi_name][fixed_name] == "counts", (
        f"manifest 没记住列量纲：{manifest.get('column_units')}"
    )
    assert manifest["group_units"][roi_name]["charcoal"] == "counts"
    assert manifest["group_units"][roi_name]["pollen"] == "%"


def test_readme_documents_units_and_the_scale_rule() -> None:
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    readme = _tar_members(session)["README.txt"].decode("utf-8")

    assert "column_units" in readme, "README 必须指明权威副本在哪"
    assert "counts" in readme, "README 必须列出实际单位"
    assert "min..max" in readme, "README 必须写明非 % 列按自身量程画"
    assert "normalized" in readme, "README 必须写明 % 列是逐列归一（不是共用 0-100 轴）"


def test_all_percent_project_keeps_the_single_call_template() -> None:
    """零回归：全 % 的工程仍只生成一次 strat.plot 调用，参数与以前一致。"""
    session = _session()
    script = _script(session)

    assert "fixed_cols" not in script, "没有任何非 % 列时不该出现分两次画的代码"
    assert "scale.percent = FALSE" not in script
    assert script.count("strat.plot(") == 1
    assert "scale.percent = TRUE" in script


def test_three_places_agree_on_the_same_unit_string() -> None:
    """侧边栏 / LiPD / 随包 manifest 三处必须是同一个字符串。"""
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "粒/g"})

    fixed_name = next(
        c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid
    )
    roi_name = session.rois[0]["name"]

    payload_unit = next(
        c["unit"] for c in _payload(session)["columns"] if c.get("name") == fixed_name
    )
    lipd_unit = _lipd_units(session.export_multi_lipd()["lipd"])[fixed_name]
    manifest_unit = json.loads(_tar_members(session)["manifest.json"].decode("utf-8"))[
        "column_units"
    ][roi_name][fixed_name]

    assert payload_unit == lipd_unit == manifest_unit == "粒/g", (
        f"三处不一致：payload={payload_unit!r} lipd={lipd_unit!r} manifest={manifest_unit!r}"
    )


def test_two_percent_groups_both_go_percent_then_one_unit_splits_them() -> None:
    """两个组都是 % → 两列都走 percent；把其中一组改成 粒/g → 只有该组落到 fixed。"""
    session = _session()
    roi_id, pct_gid, other_gid = _two_groups(session)
    session.roi_group_update(roi_id, other_gid, {"unit": "%"})

    other_col = next(
        c.get("name") for c in session.columns if c.get("x_group_id") == other_gid
    )
    pct_col = next(
        c.get("name") for c in session.columns if c.get("x_group_id") == pct_gid
    )

    both_pct = _script(session)
    assert "fixed_cols" not in both_pct, "两个组都是 % 时不该出现 fixed 分支"
    assert both_pct.count("strat.plot(") == 1, "两个 % 组应共用同一次 percent 调用"
    call_line = next(line for line in both_pct.splitlines() if "strat.plot(" in line)
    assert "scale.percent = TRUE" in call_line
    # 全 % 时脚本把整张表（df[-1]）交给同一次 percent 调用，列名不出现在行里
    assert "[-1]" in call_line, f"两个 % 列必须都在同一次 percent 调用里：{call_line}"

    # 只改一个组的单位 → 只有该组的列落到 fixed 分支
    session.roi_group_update(roi_id, other_gid, {"unit": "粒/g"})
    split = _script(session)

    fixed_line = next(
        line for line in split.splitlines() if "fixed_cols <- intersect(" in line
    )
    pct_line = next(
        line for line in split.splitlines() if "pct_cols <- intersect(" in line
    )
    assert f'"{other_col}"' in fixed_line, f"非 % 组的列没落到 fixed：{fixed_line}"
    assert f'"{other_col}"' not in pct_line
    assert f'"{pct_col}"' in pct_line, f"% 组的列不该被拖进 fixed：{pct_line}"
    assert "scale.percent = FALSE" in split


def _first_rscript() -> str | None:
    found = candidate_rscripts()
    return found[0] if found else None


RSCRIPT = _first_rscript()


def _has_rioja() -> bool:
    if not RSCRIPT:
        return False
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


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_generated_script_actually_runs_on_a_mixed_project(tmp_path) -> None:
    """判据不能只看字符串：把生成物原样跑一遍，两次 strat.plot（含 add = TRUE）必须不报错。"""
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    members = _tar_members(session)
    # 本判据验的是**脚本结构**（两次 strat.plot + add = TRUE 能不能跑），不是取数：
    # 这个会话没有数字化过列，导出的表全是 NA，rioja 会因 xlim 非有限而报错——
    # 那是「没有数据」的报错，会把结构问题盖住。所以用同名列的合成数值覆盖 CSV。
    for name, data in members.items():
        if not name.startswith("data/"):
            continue
        header = data.decode("utf-8").splitlines()[0]
        cols = header.split(",")
        rows = [header]
        for row_index in range(1, 4):
            values = [str(row_index * 10)]
            values += [
                str(round(10.0 * row_index + col_index, 2))
                for col_index in range(1, len(cols))
            ]
            rows.append(",".join(values))
        target = tmp_path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(rows) + "\n", encoding="utf-8")
    (tmp_path / "plot_strat.R").write_bytes(members["plot_strat.R"])

    proc = subprocess.run(
        [RSCRIPT, "plot_strat.R"],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )

    assert proc.returncode == 0, proc.stderr or proc.stdout
    assert (tmp_path / "Rplots.pdf").is_file(), "脚本必须真的画出图来"


def test_export_script_includes_exaggeration_only_for_marked_columns() -> None:
    """仅对标记了夸大的列在生成的 R 脚本中开启 plot.exag 与其倍率。"""
    session = _session()
    _two_groups(session)
    col1 = session.columns[1]
    col2 = session.columns[2]
    name1 = col1.get("name") or "col02"
    name2 = col2.get("name") or "col03"
    col1["exaggeration_mult"] = 5.0
    col2["exaggeration_mult"] = 5.0

    script = _script(session)
    assert "plot.exag = pct_cols %in% c(" in script
    assert f'"{name1}"' in script
    assert f'"{name2}"' in script
    assert "exag.mult = 5" in script

