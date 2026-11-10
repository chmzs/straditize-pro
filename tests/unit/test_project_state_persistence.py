# -*- coding: utf-8 -*-
"""P0-A：三个"决定交付数据"的状态字段必须进工程包。

清单出处：`docs/findings/project-state-inventory-2026-11-10.md` §2 的 #1 / #2 / #5。

| 字段 | 用户失去什么 |
| --- | --- |
| `primary_axis` | 步骤 3 声明「Y 轴 = 年代」后重开 ⇒ 语义变回 `depth`；**更糟的是串值**：开 A 包（age）再开 B 包 ⇒ B 继承 A 的 `age` |
| `depth_grid` | 用户指定的取样深度网格丢失 ⇒ 交付数据的行集从"指定深度"变成别的 |
| `reader_types` | 逐列读法回落默认 ⇒ 同一列换口径 |

## 判据（尽量打到"后果"，不是只比字段）

- `primary_axis`：载入后再调一次 `calibrate_axes`（**不传** `primary_axis`）必须解析成
  `age` —— 这是 `export.py:643-644` 的真实消费点；外加**跨包串值**专门用例。
- `depth_grid`：载入后 `core.extractGridValues` 返回的 `depths` 与保存前逐值相等
  （`export.py:1036` 是它唯一的自动消费点）。
- `reader_types`：**只能做到字段级往返**，理由见下面「如实说明」。

## 三处如实说明（不许粉饰）

1. **`primary_axis` 的正向用例要靠"模拟全新会话"才有判别力。** `project.new` 不清
   `primary_axis`，所以"同一会话里保存→清空→载入"即使字段不进包也会保留 `age`
   （正是这个泄漏让正向用例假绿）。因此 `_load()` 在 `project.new` 之后把三个字段
   复位到 `session.py` 的初值（`primary_axis="depth"` / `depth_grid=[]` /
   `reader_types={}`），等价于"用户双击打开软件后的会话"。
2. **`reader_types` 在后端是"只写不读"**：`digitize(col_index, reader_type="area")`
   的默认值是字面量，从不读 `self.reader_types`（全仓只有 `digitize.py:160` 写入、
   `project_new:215` 重置、`core.py:1741-1784` 重排，无读取点）。
3. **三个读法在参考图上给出完全相同的读数**：实测 hoya 前 12 列 × (`area`/`line`/`bar`)
   共 36 组，`read_column_values` 逐值相等（0 组不同）。所以"读数换口径"这条后果
   **在本图与本实现下无法被观测到**，不能拿它当判据（会恒绿）。本文件因此只钉
   "载入后读法映射与原值相等 + 老包回落默认"，并把"接上读点"列为遗留风险。
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession

ROI_XLIM = [315, 1946]
ROI_YLIM = [511, 1311]
Y_MARKS = [
    {"pixel": 511.0, "val": 0.0},
    {"pixel": 1311.0, "val": 1300.0},
]
GRID = [0.0, 10.0, 20.0, 30.0, 40.0, 50.0]
READER_COL = 0
READER_TYPE = "bar"


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------


def _rpc(dispatcher, method: str, **params) -> dict:
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _ok(response: dict, what: str) -> dict:
    assert "error" not in response, f"{what} 失败：{response.get('error')}"
    return response["result"]


def _read_members(path: Path) -> dict[str, bytes]:
    members: dict[str, bytes] = {}
    with tarfile.open(path, "r") as tf:
        for member in tf.getmembers():
            if not member.isfile():
                continue
            stream = tf.extractfile(member)
            if stream is not None:
                members[member.name] = stream.read()
    return members


def _rewrite_payload(path: Path, mutate) -> Path:
    """改写包里的 `straditize.json`（模拟"该字段出现之前的旧包"）。"""
    members = _read_members(path)
    payload = json.loads(members["straditize.json"])
    mutate(payload)
    out = path.parent / f"{path.stem}-old.tar"
    with tarfile.open(out, "w") as tf:
        for name, data in members.items():
            if name == "straditize.json":
                data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return out


def _base_session(primary_axis: str = "depth") -> tuple[StraditizeSession, object]:
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns(data_xlim=list(ROI_XLIM), data_ylim=list(ROI_YLIM))
    session.calibrate_axes(
        y_marks=[dict(m) for m in Y_MARKS], unit="cm", primary_axis=primary_axis
    )
    assert session.columns, "前置：必须分列出列"
    return session, create_rpc_dispatcher(session)


def _reset_to_app_startup(session: StraditizeSession) -> None:
    """把会话置回"刚打开软件"的初值（`session.py:118/133/137`）。

    为什么要这一步：`project.new` **不清** `primary_axis` / `depth_grid` /
    `reader_types`，于是"清空→载入"即使字段没进包也会保留旧值，正向用例会假绿。
    复位以后，"载入了什么"才是唯一变量。
    """
    session.primary_axis = "depth"
    session.depth_grid = []
    session.reader_types = {}


def _save(dispatcher, path: Path) -> None:
    _ok(_rpc(dispatcher, "project.save", output_path=str(path)), "保存工程包")


def _load(dispatcher, session, path: Path) -> None:
    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _reset_to_app_startup(session)
    _ok(_rpc(dispatcher, "project.load", project_data=str(path)), "载入工程包")


# ---------------------------------------------------------------------------
# 1. primary_axis
# ---------------------------------------------------------------------------


def test_primary_axis_survives_roundtrip_and_still_drives_calibration(
    tmp_path: Path,
) -> None:
    """载入后 `primary_axis` 仍是 age，且后续再标定时解析成 age（真实消费点）。"""
    session, dispatcher = _base_session(primary_axis="age")
    assert session.primary_axis == "age", "前置：会话必须已声明 Y 轴 = 年代"

    pack = tmp_path / "axis_age.tar"
    _save(dispatcher, pack)
    _load(dispatcher, session, pack)

    # 后果层（先判）：再标一次且不传 primary_axis —— export.py:643-644 读 self.primary_axis。
    again = session.calibrate_axes(y_marks=[dict(m) for m in Y_MARKS], unit="cm")
    assert again["primary_axis"] == "age", (
        "载入后再标一次（不传 primary_axis）必须解析成 age，实际 "
        f"{again['primary_axis']!r}——为 depth 说明该字段没被恢复，"
        "之后的一切换算都会按深度口径解释年代"
    )
    assert session.primary_axis == "age"
    assert (session.depth_calib or {}).get("primary_axis") == "age", (
        "depth_calib 里那一份也必须被带回，实际 "
        f"{(session.depth_calib or {}).get('primary_axis')!r}"
    )


def test_primary_axis_is_visible_in_diagram_payload(tmp_path: Path) -> None:
    """`getDiagramData` 的 `calibration.primaryAxis` 也必须跟着回来（前端读它）。"""
    session, dispatcher = _base_session(primary_axis="age")
    pack = tmp_path / "axis_age2.tar"
    _save(dispatcher, pack)
    _load(dispatcher, session, pack)

    data = _ok(_rpc(dispatcher, "straditize.getDiagramData"), "读图谱数据")
    assert data["calibration"]["primaryAxis"] == "age", (
        f"载荷里的 primaryAxis 必须是 age，实际 {data['calibration']['primaryAxis']!r}"
    )


def test_primary_axis_does_not_leak_across_packages(tmp_path: Path) -> None:
    """跨包串值：开 A（age）→ 开 B（无该键）⇒ B 必须回到 depth，不继承 A。"""
    session, dispatcher = _base_session(primary_axis="age")
    pack_a = tmp_path / "A_age.tar"
    _save(dispatcher, pack_a)
    pack_b = _rewrite_payload(
        pack_a, lambda p: p.get("depth_calibration", {}).pop("primary_axis", None)
    )

    _load(dispatcher, session, pack_a)
    assert session.primary_axis == "age", "前置：A 包必须把会话设成 age"

    _ok(_rpc(dispatcher, "project.new"), "清空项目（**不**复位，模拟「开着 A 包直接开 B 包」）")
    _ok(_rpc(dispatcher, "project.load", project_data=str(pack_b)), "载入 B 包（无 primary_axis）")

    assert session.primary_axis == "depth", (
        "B 包没有声明 Y 轴语义，必须回到默认 depth；为 age 就是**跨包串值**——"
        "用户打开另一份工程后，上一份的轴语义仍在生效，而界面上完全看不出来"
    )
    again = session.calibrate_axes(y_marks=[dict(m) for m in Y_MARKS], unit="cm")
    assert again["primary_axis"] == "depth", (
        f"后果层同样必须回到 depth，实际 {again['primary_axis']!r}"
    )


# ---------------------------------------------------------------------------
# 2. depth_grid
# ---------------------------------------------------------------------------


def _grid_depths(session: StraditizeSession, dispatcher) -> list[float]:
    """`core.extractGridValues` 的深度序列（`depth_grid` 在后端唯一的自动消费点）。"""
    if not getattr(session, "column_points", None):
        for col in session.columns:
            session.digitize(col["col_index"])
    result = _ok(_rpc(dispatcher, "core.extractGridValues"), "按深度网格取值")
    return [float(d) for d in result["depths"]]


def test_depth_grid_survives_roundtrip_and_keeps_grid_values(tmp_path: Path) -> None:
    """载入后按网格取值的深度序列逐值相等。"""
    session, dispatcher = _base_session()
    _ok(_rpc(dispatcher, "core.applyDepthGrid", depths=list(GRID)), "设置取样深度网格")
    before_depths = _grid_depths(session, dispatcher)
    assert before_depths == GRID, f"前置：网格取值必须回显用户设的网格，实际 {before_depths}"

    pack = tmp_path / "grid.tar"
    _save(dispatcher, pack)
    _load(dispatcher, session, pack)

    # 后果层（先判）：网格没了，这个操作直接不可用 / 返回别的深度。
    after_depths = _grid_depths(session, dispatcher)
    assert after_depths == before_depths, (
        f"按网格取值的深度序列必须逐值相等：保存前 {before_depths}，重开后 {after_depths}"
    )
    assert [float(d) for d in session.depth_grid] == GRID, (
        "重开后取样深度网格必须逐值相等；为空说明网格没进包（交付数据的行集已经变了）"
    )


def test_old_package_without_depth_grid_stays_empty(tmp_path: Path) -> None:
    """老包无该键 ⇒ 网格为空，且不继承上一份工程的网格（向后兼容 + 不串值）。"""
    session, dispatcher = _base_session()
    _ok(_rpc(dispatcher, "core.applyDepthGrid", depths=list(GRID)), "设置取样深度网格")
    pack_a = tmp_path / "with_grid.tar"
    _save(dispatcher, pack_a)
    pack_b = _rewrite_payload(pack_a, lambda p: p.pop("depth_grid", None))

    _load(dispatcher, session, pack_a)
    assert session.depth_grid, "前置：A 包必须带网格"

    _ok(_rpc(dispatcher, "project.new"), "清空项目（不复位，验证不串值）")
    _ok(_rpc(dispatcher, "project.load", project_data=str(pack_b)), "载入无网格的老包")

    assert session.depth_grid == [], (
        f"老包没有网格，载入后必须为空，实际 {session.depth_grid!r}"
        "（若仍保留上一份工程的网格，就是跨包串值）"
    )


# ---------------------------------------------------------------------------
# 3. reader_types（只到字段级，理由见模块 docstring 第 2/3 条）
# ---------------------------------------------------------------------------


def test_reader_types_survive_roundtrip(tmp_path: Path) -> None:
    """载入后逐列读法映射必须与保存前相等（含未设置的列保持未设置）。"""
    session, dispatcher = _base_session()
    session.digitize(READER_COL, READER_TYPE)
    session.digitize(1, "line")
    before = dict(session.reader_types)
    assert before.get(READER_COL) == READER_TYPE, "前置：读法必须已写入会话"

    pack = tmp_path / "readers.tar"
    _save(dispatcher, pack)
    _load(dispatcher, session, pack)

    after = {int(k): v for k, v in session.reader_types.items()}
    assert after == before, (
        "重开后逐列读法必须与保存前相等（同一列换口径=同一份图读出不同数）；"
        f"保存前 {before}，重开后 {after}"
    )


def test_old_package_without_reader_types_falls_back_to_default(tmp_path: Path) -> None:
    """老包无该键 ⇒ 读法回落默认（`reader_types` 里没有该列，`digitize` 用 "area"）。"""
    session, dispatcher = _base_session()
    session.digitize(READER_COL, READER_TYPE)
    pack_a = tmp_path / "with_reader.tar"
    _save(dispatcher, pack_a)
    pack_b = _rewrite_payload(
        pack_a, lambda p: [c.pop("reader_type", None) for c in p.get("columns", [])]
    )

    _load(dispatcher, session, pack_a)
    assert session.reader_types.get(READER_COL) == READER_TYPE, "前置：A 包必须带读法"

    _ok(_rpc(dispatcher, "project.new"), "清空项目（不复位，验证不串值）")
    _ok(_rpc(dispatcher, "project.load", project_data=str(pack_b)), "载入无读法的老包")

    assert READER_COL not in session.reader_types, (
        "老包没有逐列读法，载入后必须回落默认（`reader_types` 里不该有该列），"
        f"实际 {session.reader_types.get(READER_COL)!r}"
    )
