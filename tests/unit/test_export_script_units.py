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
    counts_gid = session.roi_group_create(roi_id, name="charcoal", unit="counts")["group"]["id"]
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
    fixed_name = next(c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid)
    pct_name = next(c.get("name") for c in session.columns if c.get("x_group_id") != counts_gid)
    assert units[fixed_name] == "counts"

    script = _script(session)

    assert f'fixed_cols <- intersect(c("{fixed_name}")' in script, (
        "非百分比列必须被单独挑出来画：\n" + script
    )
    assert "scale.percent = FALSE" in script, "非百分比列必须关掉百分比刻度"
    pct_line = next(line for line in script.splitlines() if "pct_cols <- intersect(" in line)
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
    fixed_name = next(c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid)

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


def test_all_percent_project_emits_one_call_with_own_range_minmax() -> None:
    """全 % 工程：一次调用，xlim 由逐列 minmax 给出（不再写死 scale.percent = TRUE）。"""
    session = _session()
    script = _script(session)

    assert script.count("strat.plot(") == 1
    call_line = next(line for line in script.splitlines() if "strat.plot(" in line)
    assert "scale.percent = FALSE" in call_line, (
        "面板宽度必须等宽：rioja 的 percent=TRUE 会让面板宽度 ∝ 该列最大值，"
        "一个 800 的浓度列会把百分比列挤成细条"
    )
    assert "scale.minmax = TRUE" in call_line
    assert "minmax = cbind(lo, hi)" in call_line, "每列 xlim 必须由数据算出"
    assert "非百分比列" not in script, "全 % 时不该出现非百分比列说明"


def test_three_places_agree_on_the_same_unit_string() -> None:
    """侧边栏 / LiPD / 随包 manifest 三处必须是同一个字符串。"""
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "粒/g"})

    fixed_name = next(c.get("name") for c in session.columns if c.get("x_group_id") == counts_gid)
    roi_name = session.rois[0]["name"]

    payload_unit = next(c["unit"] for c in _payload(session)["columns"] if c.get("name") == fixed_name)
    lipd_unit = _lipd_units(session.export_multi_lipd()["lipd"])[fixed_name]
    manifest_unit = json.loads(_tar_members(session)["manifest.json"].decode("utf-8"))[
        "column_units"
    ][roi_name][fixed_name]

    assert payload_unit == lipd_unit == manifest_unit == "粒/g", (
        f"三处不一致：payload={payload_unit!r} lipd={lipd_unit!r} manifest={manifest_unit!r}"
    )

def test_unit_change_moves_a_group_between_percent_and_own_range() -> None:
    """两组都 % → 无「非百分比列」说明；改一组 粒/g → 该组列被点名，脚本随之变化。"""
    session = _session()
    roi_id, _pct_gid, other_gid = _two_groups(session)
    session.roi_group_update(roi_id, other_gid, {"unit": "%"})

    other_col = next(c.get("name") for c in session.columns if c.get("x_group_id") == other_gid)

    both_pct = _script(session)
    assert "非百分比列" not in both_pct, "两个组都是 % 时不该有非百分比列"
    assert both_pct.count("strat.plot(") == 1

    session.roi_group_update(roi_id, other_gid, {"unit": "粒/g"})
    split = _script(session)

    assert split != both_pct, "改单位必须改变脚本"
    assert "非百分比列" in split
    assert f"{other_col}(粒/g)" in split, f"改单位后该列必须被点名：{split[:300]}"

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
    # 脚本读的是 data.csv（主有效区）。这个会话没数字化过列，导出的表全是 NA，
    # rioja 会因 xlim 非有限而报错——那是「没有数据」的报错，会把结构问题盖住。
    # 所以用同名列的合成数值覆盖 data.csv，专测脚本结构能否跑通。
    header = members["data.csv"].decode("utf-8").splitlines()[0]
    cols = header.split(",")
    rows = [header]
    for row_index in range(1, 4):
        values = [str(row_index * 10)]
        values += [str(round(10.0 * row_index + col_index, 2)) for col_index in range(1, len(cols))]
        rows.append(",".join(values))
    (tmp_path / "data.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
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

def test_tar_member_equals_download_script_byte_identical() -> None:
    """判据：同一工程，tar 内 plot_strat.R 与「R 脚本」下载**逐字节相同**。"""
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    from_tar = _tar_members(session)["plot_strat.R"]
    from_download = session.export_r().encode("utf-8")
    assert from_tar == from_download, "tar 成员与下载内容必须同源（同一生成器）"

    # 改单位 → 两者同时变化，且仍逐字节相同
    session.roi_group_update(roi_id, counts_gid, {"unit": "%"})
    changed_tar = _tar_members(session)["plot_strat.R"]
    changed_download = session.export_r().encode("utf-8")
    assert changed_tar != from_tar, "改单位必须改变 tar 里的脚本"
    assert changed_download != from_download, "改单位必须改变下载的脚本"
    assert changed_tar == changed_download


def test_project_archive_tar_uses_the_same_script(tmp_path) -> None:
    """`project.save(format="tar")`（工程包）里的 plot_strat.R 也必须是同一份。"""
    session = _session()
    roi_id, _, counts_gid = _two_groups(session)
    session.roi_group_update(roi_id, counts_gid, {"unit": "counts"})

    out = tmp_path / "proj.tar"
    session.project_save(output_path=str(out), format="tar")
    with tarfile.open(out) as tf:
        from_project = tf.extractfile("plot_strat.R").read()

    assert from_project == session.export_r().encode("utf-8")
