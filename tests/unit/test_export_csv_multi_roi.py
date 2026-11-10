# -*- coding: utf-8 -*-
"""导出数据链：多 ROI 时 CSV 与 XLSX/TAR 必须同源，且**不得按列名吞列**。

## 缺陷本体（实测 + 代码定位）

`export_data` → `_export_value_columns`（`export.py:867`）把逐列结果塞进
`values[col_name]: dict[str, ...]` —— 一个**按列名**索引的字典。两个 ROI 里的
同名属种列（`col01`…）于是互相覆盖：

- 后一个 ROI 的值把前一个顶掉 ⇒ 表头数量少于真实列数，**整列数据静默消失**；
- 若覆盖上来的那一列未标定（`read_column_values` 对未标定列整列给 `None`），
  用户看到的就是"CSV 数据格几乎全空"，而同批 XLSX/LiPD/TAR（走
  `get_roi_dataframes`，按 ROI 分表、不按名查字典）有数。

诊断实测（`.scratch/diag_multi_roi.py`，本机）：40 列 → CSV 表头只有 28 个，
其中 `col01..col13` 已被 roi_2 的未标定列顶掉（`非空 12015 / 空 10413`）；
`get_roi_dataframes()['pollen']` 则是 `22428` 个非空、`(801, 29)`。

**根因是"列名不是唯一键"**，不是"CSV 少了某个分支"。

## 修法与产品口径（本单选定）

`data.csv` = **主 ROI 的那一张表**，其余 ROI 各出一份 `data/<roi>.csv`。
理由（三条，都是既有约定，不是新发明）：

1. `frontend/e2e/from-zero-journey.spec.ts` 早已断言
   `data.csv` **逐字节等于** `data/<主 ROI>.csv` —— 这就是既定语义；
2. 界面 HUD 文案是"已将 <roi> 设为主有效区（对应导出 data.csv）"，扁平拼接与它矛盾；
3. 扁平拼接没有唯一键可反查 (roi, col_index)，天然会吞列。

因此三条链收敛到**同一个取数入口** `get_roi_dataframes()`：
`export_data` 不再自己拼行集与列名，直接取主 ROI 的 DataFrame。
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

import pandas as pd
import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

Y_MARKS = [{"pixel": 511.0, "val": 0.0}, {"pixel": 1311.0, "val": 1300.0}]
ROI1_BOX = {"x0": 315, "x1": 1946, "y0": 511, "y1": 1311}
ROI2_BOX = {"x0": 300, "x1": 1200, "y0": 700, "y1": 1300}


def _rpc(dispatcher, method: str, **params) -> dict:
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _ok(response: dict, what: str) -> dict:
    assert "error" not in response, f"{what} 失败：{response.get('error')}"
    return response["result"]


def _session_two_rois() -> tuple[StraditizeSession, object, str, str]:
    """roi_1（已标定）+ roi_2（同名列、未标定）——正是"吞列 + 看起来全空"的现场。"""
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns(data_xlim=[ROI1_BOX["x0"], ROI1_BOX["x1"]], data_ylim=[ROI1_BOX["y0"], ROI1_BOX["y1"]])
    session.calibrate_axes(y_marks=[dict(m) for m in Y_MARKS], unit="cm", primary_axis="depth")
    group = session.rois[0]["x_groups"][0]
    group["value_per_px"] = 0.16129
    group["axis_stroke_px"] = 6
    for col in session.columns:
        session.digitize(col["col_index"])

    dispatcher = create_rpc_dispatcher(session)
    roi1_id = session.rois[0]["id"]
    _ok(
        _rpc(
            dispatcher,
            "roi.create",
            name="roi2",
            x0=ROI2_BOX["x0"],
            x1=ROI2_BOX["x1"],
            y0=ROI2_BOX["y0"],
            y1=ROI2_BOX["y1"],
        ),
        "建第二个 ROI",
    )
    roi2_id = session.rois[1]["id"]
    _ok(
        _rpc(
            dispatcher,
            "core.detectColumns",
            roi_id=roi2_id,
            data_xlim=[ROI2_BOX["x0"], ROI2_BOX["x1"]],
            data_ylim=[ROI2_BOX["y0"], ROI2_BOX["y1"]],
        ),
        "给 roi_2 分列",
    )
    for col in session.columns:
        if col.get("roi_id") == roi2_id:
            session.digitize(col["col_index"])

    # 前置：两个 ROI 都有列，且**确实存在跨 ROI 同名**
    counts = {
        roi1_id: sum(1 for c in session.columns if c.get("roi_id") == roi1_id),
        roi2_id: sum(1 for c in session.columns if c.get("roi_id") == roi2_id),
    }
    assert counts[roi1_id] > 0 and counts[roi2_id] > 0, f"前置：两个 ROI 都要有列，实际 {counts}"
    names1 = {c.get("name") for c in session.columns if c.get("roi_id") == roi1_id}
    names2 = {c.get("name") for c in session.columns if c.get("roi_id") == roi2_id}
    assert names1 & names2, "前置：必须存在跨 ROI 同名列（本用例的触发条件）"
    return session, dispatcher, roi1_id, roi2_id


def _csv_frame(csv_text: str) -> pd.DataFrame:
    return pd.read_csv(io.StringIO(csv_text))


def _primary_sheet_name(session: StraditizeSession) -> str:
    primary_id = getattr(session, "primary_roi_id", None)
    for roi in session.rois:
        if roi.get("id") == primary_id:
            return roi.get("name", roi["id"])
    return session.rois[0].get("name", session.rois[0]["id"])


# ---------------------------------------------------------------------------
# 1. 多 ROI：CSV 必须有数，且与主 ROI 分表逐格相等
# ---------------------------------------------------------------------------


def test_csv_multi_roi_has_values_and_matches_primary_sheet() -> None:
    """CSV 非空、且与 `data/<主 ROI>.csv`（`get_roi_dataframes`）逐格相等。"""
    session, _, roi1_id, _ = _session_two_rois()
    # 主 ROI 指定为 roi_1（HUD 的"主有效区"对应它的表）
    session.primary_roi_id = roi1_id

    csv_text = _ok(_rpc(create_rpc_dispatcher(session), "export.csv"), "导出 CSV")
    frame = _csv_frame(csv_text)
    value_cells = frame.drop(columns=["depth"], errors="ignore")
    non_empty = int(value_cells.notna().sum().sum())

    assert non_empty > 0, (
        "多 ROI 时 CSV 的数据格不得为空表；实测本仓原实现会把同名未标定列覆盖上来，"
        f"整表看起来全空（实际非空 {non_empty} 格）"
    )

    sheet = session.get_roi_dataframes()[_primary_sheet_name(session)]
    assert list(frame.columns) == list(sheet.columns), (
        "CSV 的列必须等于主 ROI 分表的列（顺序也要一致）："
        f"CSV={list(frame.columns)[:6]}… 分表={list(sheet.columns)[:6]}…"
    )
    assert frame.shape == sheet.shape, f"形状必须一致：CSV={frame.shape} 分表={sheet.shape}"

    # 逐格比对（NaN 要按"同为缺失"处理，不能用 == ）
    a = frame.to_numpy(dtype=object)
    b = sheet.to_numpy(dtype=object)
    mismatches = []
    for r in range(a.shape[0]):
        for c in range(a.shape[1]):
            x, y = a[r][c], b[r][c]
            if x is None or x == "":
                x = None
            if isinstance(x, str):
                try:
                    x = float(x)
                except ValueError:
                    pass
            if (x is None) != (y is None) and not (
                isinstance(x, float) and isinstance(y, float) and pd.isna(x) and pd.isna(y)
            ):
                mismatches.append((r, c, x, y))
            elif x is not None and y is not None and x != pytest.approx(y):
                mismatches.append((r, c, x, y))
    assert not mismatches, f"CSV 与主 ROI 分表必须逐格相等，前 3 处 {mismatches[:3]}"


def test_no_column_is_silently_swallowed() -> None:
    """列数 == 主 ROI 的列数，且每个表头都能反查到 (roi, col_index)。"""
    session, _, roi1_id, roi2_id = _session_two_rois()
    session.primary_roi_id = roi1_id

    frame = _csv_frame(_ok(_rpc(create_rpc_dispatcher(session), "export.csv"), "导出 CSV"))
    primary_cols = [c for c in session.columns if c.get("roi_id") == roi1_id]

    assert len(frame.columns) - 1 == len(primary_cols), (
        "CSV 的数据列数必须等于主 ROI 的列数（不得因跨 ROI 同名而折叠）："
        f"表头 {len(frame.columns) - 1} 列 vs 主 ROI {len(primary_cols)} 列"
    )
    # 反查：每个表头都必须能在主 ROI 里唯一定位到一列
    for name in frame.columns[1:]:
        hits = [c for c in primary_cols if (c.get("name") or c.get("species")) == name]
        assert len(hits) == 1, (
            f"表头 {name!r} 在主 ROI 里命中 {len(hits)} 列，无法唯一反查 (roi, col_index)"
        )
    # 另一个 ROI 的列不得混进来（口径：data.csv = 主 ROI）
    assert len(frame.columns) - 1 != len(primary_cols) + sum(
        1 for c in session.columns if c.get("roi_id") == roi2_id
    ), "其他 ROI 的列不该出现在 data.csv 里（它们走 data/<roi>.csv）"


def test_csv_does_not_mix_roi_columns_across_same_names() -> None:
    """同名列的两份数据不得互相覆盖：主 ROI 的值必须来自主 ROI。"""
    session, _, roi1_id, roi2_id = _session_two_rois()
    session.primary_roi_id = roi1_id

    frame = _csv_frame(_ok(_rpc(create_rpc_dispatcher(session), "export.csv"), "导出 CSV"))
    shared = [
        c for c in session.columns
        if c.get("roi_id") == roi1_id
        and any(
            o.get("roi_id") == roi2_id and (o.get("name") == c.get("name"))
            for o in session.columns
        )
    ]
    assert shared, "前置：必须存在跨 ROI 同名列"
    for col in shared[:3]:
        name = col.get("name")
        assert int(frame[name].notna().sum()) > 0, (
            f"主 ROI 的列 {name!r} 在 CSV 里全空：说明它的值被另一个 ROI 的同名列覆盖了"
        )


# ---------------------------------------------------------------------------
# 2. 单 ROI：结构不变（逐字节对照另见交付说明）
# ---------------------------------------------------------------------------


def test_single_roi_csv_unchanged_structure() -> None:
    """单 ROI 的行数/列数/表头保持原样（守卫"修多 ROI 别把单 ROI 改坏"）。"""
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns(data_xlim=[315, 1946], data_ylim=[511, 1311])
    session.calibrate_axes(y_marks=[dict(m) for m in Y_MARKS], unit="cm", primary_axis="depth")
    group = session.rois[0]["x_groups"][0]
    group["value_per_px"] = 0.16129
    group["axis_stroke_px"] = 6
    for col in session.columns:
        session.digitize(col["col_index"])

    res = _ok(_rpc(create_rpc_dispatcher(session), "export.csv"), "导出 CSV")
    frame = _csv_frame(res)
    assert frame.shape == (801, 1 + len(session.columns)), (
        f"单 ROI 形状必须不变：{frame.shape} vs 期望 (801, {1 + len(session.columns)})"
    )
    assert list(frame.columns)[0] == "depth"
    assert frame.drop(columns=["depth"]).notna().sum().sum() > 0


# ---------------------------------------------------------------------------
# 3. plot_strat.R：不得把 NA 静默改写成 0
# ---------------------------------------------------------------------------


def test_export_r_script_keeps_na() -> None:
    """R 模板的可执行行不得把 NA 填成 0，且必须显式说明缺测语义。"""
    session, _, _, _ = _session_two_rois()
    script = _ok(_rpc(create_rpc_dispatcher(session), "export.r"), "导出 R 脚本")

    # 判据落在**可执行行**上：注释里提一句旧行为是给人看的说明，允许；
    # 真正禁止的是"代码行把 NA 改写成 0"。
    code_lines = [
        ln for ln in script.split("\n") if ln.strip() and not ln.strip().startswith("#")
    ]
    offenders = [ln for ln in code_lines if "is.na" in ln.replace(" ", "")]
    assert not offenders, (
        "R 模板的可执行行把 NA 改写成 0，等于把「未测」画成「零丰度」——"
        f"用户看到的是科学结论，而实际是没有读数。违规行：{offenders[:2]}"
    )
    assert any(
        "NA" in ln for ln in script.split("\n") if ln.strip().startswith("#")
    ), "脚本必须显式说明缺测语义（为什么保留 NA）"


def test_packaged_r_script_keeps_na(tmp_path: Path) -> None:
    """工程包里的 `plot_strat.R` 同样不得把 NA 填成 0。"""
    session, dispatcher, _, _ = _session_two_rois()
    pack = tmp_path / "multi.tar"
    _ok(_rpc(dispatcher, "project.save", output_path=str(pack)), "保存工程包")
    with tarfile.open(pack, "r") as tf:
        member = next(m for m in tf.getmembers() if m.name == "plot_strat.R")
        stream = tf.extractfile(member)
        script = stream.read().decode("utf-8")
    code_lines = [
        ln for ln in script.split("\n") if ln.strip() and not ln.strip().startswith("#")
    ]
    offenders = [ln for ln in code_lines if "is.na" in ln.replace(" ", "")]
    assert not offenders, f"包内 plot_strat.R 不得把 NA 填成 0：{offenders[:2]}"
