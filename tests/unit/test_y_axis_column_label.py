# -*- coding: utf-8 -*-
"""issue #114：导出表首列名与出图 Y 轴标签跟随 Y 轴的**实际性质**。

## 缺陷本体

用户图上 Y 轴声明为「单位 `ka`、轴性质 `age`」（BP 约定，2010 年取样 → 顶部是
`-0.06 ka BP`，负值合法）。数据层早就知道这件事（`calibrate_axes(primary_axis=...)`
→ `self.primary_axis`），呈现层却没读它：

- 导出 CSV 首列仍叫 `depth`，里面装的是 `ka BP` 值 → 下游按 `cm` 解读整列；
- 出图 Y 轴仍印 `Depth`。

## 本文件的判据分工

| 判据 | 测什么 | 怎么判定 |
| --- | --- | --- |
| `test_column_label_table` / `test_axis_label_table` | 派生规则本身（规格表逐行） | equality |
| `test_export_first_column_follows_axis` | 导出表首列真的改了 | equality（`"age"`） |
| `test_numbers_are_byte_identical_across_column_names` | **只改列名不改数** | 整份 CSV 去掉表头后逐字节相等 |
| `test_depth_axis_is_byte_identical_default_vs_legacy` | 深度工程零回归 | 整份 CSV 逐字节相等 |
| `test_rpc_accepts_legacy_column_name` | RPC 契约真的收这个参数 | 通过 dispatcher 调用而非直调方法 |
| `test_plot_script_has_no_axis_name_literal` | 标签来源单点 | R 脚本里不出现 `Depth` 字面量 |
| `test_settings_sent_to_r_carry_derived_ylabel` | 派生结果真的交给了 R | 读 R 实际读的那份 settings TSV |

## 反向验证（改回错误实现应当变红）

- 把 `_y_column_label` 改回恒返回 `"depth"` → 判据 2/3/5 变红；
- 把 `_y_axis_label` 的 `BP` 补齐删掉 → `Age (ka BP)` → `Age (ka)`，判据 1 变红；
- 把 R 脚本的 `txt("ylabel", y_var_name)` 改回 `txt("ylabel", "Depth")` → 判据 6 变红；
- 把 `render_strat_diagram` 里的 `merged["ylabel"] = _y_axis_label(...)` 删掉 →
  判据 7 变红（settings TSV 里 `ylabel` 为空）。
"""

from __future__ import annotations

import io
import subprocess
from pathlib import Path

import pandas as pd
import pytest

from straditize_core.plotting import candidate_rscripts
from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession
from straditize_core.strat_plot import (
    DEFAULT_PLOT_SETTINGS,
    STRAT_PLOT_SCRIPT,
    _y_axis_label,
    _y_column_label,
    render_strat_diagram,
)

RSCRIPT = (candidate_rscripts() or [None])[0]

AGE_CSV = "age,col01,col02\n-0.06,10,20\n-0.10,50,30\n-0.14,90,40\n"


# ---------------------------------------------------------------------------
# 会话构造：不加载图片（本文件判的是列名与标签，不是取数口径）
# ---------------------------------------------------------------------------


def _column(c_idx: int) -> dict:
    return {
        "col_index": c_idx,
        "name": f"col{c_idx + 1:02d}",
        "roi_id": "roi_1",
        # 满量程 100%：px 0 → 0%，px 100 → 100%
        "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
    }


def _session(primary_axis: str = "depth", unit: str = "cm") -> StraditizeSession:
    """最小可用会话：两个已标定列 + 三条共识层位。

    Y 轴标定是 `px → 值的线性映射`，**方向与量纲由 primary_axis/unit 决定**：
    深度工程是 cm，年代工程是 ka BP（顶部 −0.06，负值合法）。
    """
    session = StraditizeSession()
    session._init_export()
    session.columns = [_column(0), _column(1)]
    session.column_points = {}
    session.control_points = {0: {100: 10.0, 200: 90.0}, 1: {150: 50.0}}
    session.samples = [{"row_px": r, "depth": None} for r in (100, 150, 200)]
    session.is_calibrated = True
    # px 100 → 0.0，px 200 → 1.0（年代向下的老→新不敏感：只验列名与标签）
    session.y_scale = {"slope": 0.01, "intercept": -1.0}
    session.primary_axis = primary_axis
    session.depth_unit = unit
    # 标尺网格（`dataset="depth_grid"`）要 `depth_calib`：给一个两端点即可。
    session.depth_calib = {
        "top_px": 100.0,
        "top_cm": 0.0,
        "bottom_px": 200.0,
        "bottom_cm": 1.0,
        "unit": unit,
    }
    session.depth_interval = 0.5
    return session


def _csv_text(session: StraditizeSession, **kwargs) -> str:
    return session.export_data("csv", **kwargs)["csv"] or ""


# ---------------------------------------------------------------------------
# 判据 1：两张规格表逐行
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("primary_axis", "legacy", "expected"),
    [
        ("age", False, "age"),
        ("depth", False, "depth"),
        ("age", True, "depth"),
        ("depth", True, "depth"),
        (None, False, "depth"),
        ("AGE", False, "age"),  # 大小写不敏感（calibrate_axes 已归一，这里是第二道口）
    ],
)
def test_column_label_table(primary_axis, legacy, expected) -> None:
    assert _y_column_label(primary_axis, legacy=legacy) == expected


@pytest.mark.parametrize(
    ("primary_axis", "unit", "expected"),
    [
        ("depth", "cm", "Depth (cm)"),
        ("depth", "m", "Depth (m)"),
        ("age", "ka BP", "Age (ka BP)"),
        ("age", "ka", "Age (ka BP)"),  # 唯一补语义点：ka → ka BP
        ("age", "cal yrBP", "Age (cal yrBP)"),
        ("age", "cal BP", "Age (cal BP)"),
        ("age", "AD", "Age (AD)"),
        ("age", "BC", "Age (BC)"),
        ("age", "CE", "Age (CE)"),
        ("age", "BCE", "Age (BCE)"),
        # 大小写不敏感：已写明年代基准就原样用，不再叠加
        ("age", "cal bp", "Age (cal bp)"),
        # 单位为空时只给轴名，不编一个单位
        ("age", "", "Age"),
        ("depth", None, "Depth"),
    ],
)
def test_axis_label_table(primary_axis, unit, expected) -> None:
    assert _y_axis_label(primary_axis, unit) == expected


# ---------------------------------------------------------------------------
# 判据 2：导出表首列真的跟随轴性质
# ---------------------------------------------------------------------------


def test_export_first_column_follows_axis() -> None:
    depth_csv = _csv_text(_session("depth", "cm"))
    age_csv = _csv_text(_session("age", "ka BP"))

    assert depth_csv.splitlines()[0].split(",")[0] == "depth"
    assert age_csv.splitlines()[0].split(",")[0] == "age", (
        "primary_axis=age 时首列必须叫 age；叫 depth 会让下游把 ka BP 当成 cm"
    )
    assert "depth" not in age_csv.splitlines()[0].split(","), (
        "不得同时输出 depth 与 age 两列：两列会让人无法判断哪一列才是真的"
    )


def test_turning_points_payload_carries_the_same_label() -> None:
    """长表的 Y 量列名同样跟随轴性质（它装的就是 Y 轴上那个量）。"""
    age_res = _session("age", "ka BP").export_data("csv", dataset="turning_points")
    frame = pd.read_csv(io.StringIO(age_res["csv"]))
    assert list(frame.columns) == ["taxon", "type", "age", "value", "x", "y"]


# ---------------------------------------------------------------------------
# 判据 3：只改列名，数值逐字节不变
# ---------------------------------------------------------------------------


def test_numbers_are_byte_identical_across_column_names() -> None:
    age_default = _csv_text(_session("age", "ka BP"))
    age_legacy = _csv_text(_session("age", "ka BP"), legacy_column_name=True)

    default_header, *default_body = age_default.splitlines()
    legacy_header, *legacy_body = age_legacy.splitlines()

    assert default_header.split(",")[0] == "age"
    assert legacy_header.split(",")[0] == "depth"
    assert default_header.split(",")[1:] == legacy_header.split(",")[1:], (
        "除首列名外，表头其余列必须完全一致"
    )
    assert default_body == legacy_body, (
        "legacy_column_name 只能改列名：所有数据行必须逐字节相同"
    )


# ---------------------------------------------------------------------------
# 判据 4：深度工程零回归（默认与 legacy 两种情形都与改前同形）
# ---------------------------------------------------------------------------


def test_depth_axis_is_byte_identical_default_vs_legacy() -> None:
    default_csv = _csv_text(_session("depth", "cm"))
    legacy_csv = _csv_text(_session("depth", "cm"), legacy_column_name=True)

    assert default_csv == legacy_csv, (
        "primary_axis=depth 的工程：默认与 legacy_column_name=True 必须逐字节相同"
    )
    assert default_csv.splitlines()[0].startswith("depth,"), (
        "深度工程的首列名保持 depth（既有行为不变）"
    )
    # 既有基线 `tests/unit/fixtures/export_data_golden.json` 由未改动的
    # `test_export_data_golden.py` 钉着：它没有重生成、本单之后仍全绿，
    # 等于「深度工程的 CSV 改前改后逐字节一致」—— 这里不重复读基线文件。


def test_shared_roi_entry_used_by_tar_xlsx_lipd_also_follows_axis() -> None:
    """`get_roi_dataframes` 是 CSV/TAR/XLSX/LiPD 的共同入口，同一列名。"""
    session = _session("age", "ka BP")
    for frame in session.get_roi_dataframes().values():
        assert list(frame.columns)[0] == "age"
    for frame in session.get_roi_dataframes(legacy_column_name=True).values():
        assert list(frame.columns)[0] == "depth"


@pytest.mark.parametrize(
    ("dataset", "y_index"),
    [
        (None, 0),
        ("samples", 0),
        # 拐点长表的 Y 量在第 3 列（前两列是 taxon / type），同样跟随轴性质
        ("turning_points", 2),
    ],
)
@pytest.mark.parametrize(
    ("legacy", "age_label", "depth_label"),
    [
        (False, "age", "depth"),
        (True, "depth", "depth"),
    ],
)
def test_every_dataset_rowset_names_its_y_column_by_axis(
    dataset, y_index, legacy, age_label, depth_label
) -> None:
    frame_kwargs = {} if dataset is None else {"dataset": dataset}
    kwargs = {**frame_kwargs, "legacy_column_name": legacy}

    age_header = (
        _csv_text(_session("age", "ka BP"), **kwargs).splitlines()[0].split(",")
    )
    depth_header = (
        _csv_text(_session("depth", "cm"), **kwargs).splitlines()[0].split(",")
    )

    assert age_header[y_index] == age_label, (
        f"dataset={dataset!r} legacy={legacy}：age 轴的表头应为 {age_label!r}，实得 {age_header!r}"
    )
    assert depth_header[y_index] == depth_label, (
        f"dataset={dataset!r} legacy={legacy}：depth 轴的表头应为 {depth_label!r}，"
        f"实得 {depth_header!r}"
    )


# ---------------------------------------------------------------------------
# 判据 5：RPC 契约真的收 legacy_column_name（走 dispatcher，不直调方法）
# ---------------------------------------------------------------------------


def _rpc(dispatcher, method: str, **params) -> dict:
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def test_rpc_accepts_legacy_column_name() -> None:
    dispatcher = create_rpc_dispatcher(_session("age", "ka BP"))

    default_res = _rpc(dispatcher, "export.csv")
    assert "error" not in default_res, default_res.get("error")
    assert default_res["result"].splitlines()[0].startswith("age,")

    legacy_res = _rpc(dispatcher, "export.csv", legacy_column_name=True)
    assert "error" not in legacy_res, legacy_res.get("error")
    assert legacy_res["result"].splitlines()[0].startswith("depth,")

    core_res = _rpc(dispatcher, "core.exportData", legacy_column_name=True)
    assert "error" not in core_res, core_res.get("error")
    assert core_res["result"]["columns"][0] == "depth"


# ---------------------------------------------------------------------------
# 判据 6/7：出图标签
# ---------------------------------------------------------------------------


def test_plot_script_has_no_axis_name_literal() -> None:
    """R 脚本里不得再有轴名常量：兜底值就是首列名（由 Python 侧派生）。"""
    assert '"Depth"' not in STRAT_PLOT_SCRIPT
    assert "'Depth'" not in STRAT_PLOT_SCRIPT
    assert STRAT_PLOT_SCRIPT.count('txt("ylabel", y_var_name)') == 1, (
        "rioja::strat.plot 的 ylabel 兜底必须走同一个首列名变量"
    )
    assert "y_var_name <- names(raw)[[1]]" in STRAT_PLOT_SCRIPT
    assert DEFAULT_PLOT_SETTINGS["ylabel"] == "", (
        "默认值必须是空串（= 由轴派生），留任何轴名常量都会成为第二个来源"
    )


class _FakeProc:
    returncode = 0
    stdout = "STRADITIZE_ENGINE\trioja\n"
    stderr = ""


def _fake_r(monkeypatch, calls: list[list[str]]):
    """替掉 subprocess.run：不真跑 R，但**产物与 settings 文件照写**。

    settings TSV 是 R 侧真正读的那份输入（`read_settings`），所以在它上面断言，
    测的是「交给 R 的是什么」，不是「Python 里算了什么」。
    """

    def fake_run(cmd, **kwargs):  # noqa: ANN001, ANN003
        calls.append(list(cmd))
        Path(cmd[3]).write_bytes(b"fake-image")
        return _FakeProc()

    monkeypatch.setattr(subprocess, "run", fake_run)
    return calls


@pytest.mark.parametrize(
    ("primary_axis", "unit", "expected"),
    [
        ("depth", "cm", "Depth (cm)"),
        ("age", "ka", "Age (ka BP)"),
        ("age", "cal BP", "Age (cal BP)"),
    ],
)
def test_settings_sent_to_r_carry_derived_ylabel(
    tmp_path, monkeypatch, primary_axis, unit, expected
) -> None:
    calls = _fake_r(monkeypatch, [])
    csv_path = tmp_path / "in.csv"
    csv_path.write_text("depth,col01\n0,10\n10,50\n", encoding="utf-8")
    out_path = tmp_path / "strat.svg"

    info = render_strat_diagram(
        csv_path=str(csv_path),
        out_path=str(out_path),
        rscript="Rscript",
        settings={"title": "t"},
        primary_axis=primary_axis,
        unit=unit,
    )

    assert len(calls) == 1, "应当只调一次 R"
    settings_tsv = Path(calls[0][4]).read_text(encoding="utf-8")
    ylabel_lines = [
        line.split("\t", 1)
        for line in settings_tsv.splitlines()
        if line.startswith("ylabel")
    ]
    assert len(ylabel_lines) == 1, (
        f"settings 里必须恰好一行 ylabel，实得：{settings_tsv!r}"
    )
    assert ylabel_lines[0][1] == expected, (
        f"交给 R 的 ylabel 应为 {expected!r}，实得 {ylabel_lines[0][1]!r}"
    )
    assert info["settings"]["ylabel"] == expected, "返回值里回显的也必须是派生后的标签"


def test_explicit_user_ylabel_wins(tmp_path, monkeypatch) -> None:
    """用户显式填了 ylabel 就尊重用户：不做「按轴改写」。"""
    calls = _fake_r(monkeypatch, [])
    csv_path = tmp_path / "in.csv"
    csv_path.write_text("age,col01\n0,10\n10,50\n", encoding="utf-8")

    info = render_strat_diagram(
        csv_path=str(csv_path),
        out_path=str(tmp_path / "strat.svg"),
        rscript="Rscript",
        settings={"ylabel": "Chronology (ka BP)"},
        primary_axis="age",
        unit="ka",
    )
    assert info["settings"]["ylabel"] == "Chronology (ka BP)"
    assert calls, "渲染路径必须真的走到 R"


@pytest.mark.skipif(RSCRIPT is None, reason="本机没有 Rscript")
def test_plot_render_rpc_derives_ylabel_from_axis() -> None:
    """真实用户路径：`plot.render` 返回的 settings 里必须是派生后的标签。

    这条走 RPC + `plotting.py` 的接线（`primary_axis` / `depth_unit` 两个入参），
    比直接调 `render_strat_diagram` 更接近用户点「出图」时发生的事。
    """
    session = _session("age", "ka BP")
    response = _rpc(create_rpc_dispatcher(session), "plot.render", format="svg")
    if "error" in response:
        pytest.skip(f"本机出图环境不可用：{response['error']}")
    assert response["result"]["settings"]["ylabel"] == "Age (ka BP)"


# ---------------------------------------------------------------------------
# 判据 8：派生标签真的画进了产物（不是只把字符串传过去）
# ---------------------------------------------------------------------------


@pytest.mark.skipif(RSCRIPT is None, reason="本机没有 Rscript")
def test_derived_label_reaches_the_artifact(tmp_path) -> None:
    """派生路径与「显式写死同一个标签」必须产出**逐字节相同**的图。

    cairo 把文字画成字形路径，SVG 里搜不到字面量，所以判据不能是 `"Age" in svg`。
    改用等价比对：同一份数据、同一套设置，唯一差异是「标签从哪来」。

    - `derived == explicit` → 派生确实落到了产物上（改回不填 ylabel 时两者必不同）；
    - `derived != depth_axis` → 对照组：这个判据对标签的变化是敏感的，不是恒为真。
    """
    csv_path = tmp_path / "in.csv"
    csv_path.write_text(AGE_CSV, encoding="utf-8")

    def _render(name: str, **kwargs) -> bytes:
        out = tmp_path / f"{name}.svg"
        try:
            render_strat_diagram(
                csv_path=str(csv_path),
                out_path=str(out),
                rscript=str(RSCRIPT),
                **kwargs,
            )
        except RuntimeError as exc:  # rioja 没装：本机跑不了这条判据
            pytest.skip(f"本机 R 缺 rioja：{exc}")
        return out.read_bytes()

    derived = _render("derived", settings={}, primary_axis="age", unit="ka")
    explicit = _render(
        "explicit", settings={"ylabel": "Age (ka BP)"}, primary_axis="age", unit="ka"
    )
    depth_axis = _render("depth", settings={}, primary_axis="depth", unit="cm")

    assert derived == explicit, (
        "派生标签与显式写死同一个标签必须画出逐字节相同的图："
        "两者不等说明派生值没有真正生效"
    )
    assert derived != depth_axis, (
        "age 轴与 depth 轴的产物相同 → 判据对标签不敏感，这条断言语义失效"
    )
