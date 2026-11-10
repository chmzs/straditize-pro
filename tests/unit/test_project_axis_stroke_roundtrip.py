# -*- coding: utf-8 -*-
"""工程包必须持久化**列级轴粗**（`axis_stroke_px`），否则重开后整列读数系统性偏移（U-ROWS-02）。

## 缺陷本体（用户实测 + 代码定位，二者一致）

用户的包 `straditize_project_1794232440046.tar` 里 Pinus 列 `tickEndX=264`，另三列
`953/1359/1582`。载入后**只有 Pinus 变成 266**，其余不动；`start/startX`、`end/endX`、
`startValue/tickValue`、`x_group_id` 全不变。

链路（`session_parts/xscale.py:523-528` 的 `_scale_from_group_slope`）：

    abs_px0 = start + resolve_axis_stroke(col, group)
    abs_px1 = abs_px0 + 1

`resolve_axis_stroke`（xscale.py:31-56）的优先级是「列级覆盖 > 组级 > 缺省 5」。
包内 `tickEndX=264` ⇒ `abs_px0 = start+4` ⇒ 列级轴粗 **4**；载入后 `266` ⇒ 回落到组值 **6**。
2px × `value_per_px 0.16129` = **0.3226**，与用户看到的逐行恒差吻合。

根因是**两端都不写这个字段**：

* 保存端 `_build_columns_export` 的列段字段表没有 `axis_stroke_px`；
* 载入端 `_restore_columns` 的 `col_dict` 白名单也没有。

于是"列级覆盖"这一档一进包就丢，载入后必然退化到组值。包里的 **67.7419 是对的**
（它承载用户显式设的"本列轴粗=4"）；覆盖丢失后重新导出的 67.4194 是退化值。

## 判据

1. 保存的 `straditize.json` 里该列 `axis_stroke_px == 4`；
2. 载入后该列仍是 4（不是回落到组值 6）；
3. **承重**：同一列同一批样本行，load 前后 `read_column_values` 逐值相等（1e-9）——
   当前实现下这里差 0.3226 那一类，必红；
4. 负向对照：**没设过列级覆盖**的列载入后仍取组值；**显式清空（None）**后同样回落组值；
5. 载入期自检：包里的 `tickEndX` 与该列轴粗矛盾时，**下一次保存**的 `manifest.json`
   出现告警，但导出照常成功；一致时不得凭空生成告警。

## 反向验证（金丝雀）

把保存端新增的 `"axis_stroke_px": col.get(...)` 一行注掉，第 1 条立刻红（`None != 4.0`）；
把载入端新增的那一行注掉，第 3 条红在读数逐值比对（0.3226 那一类）。
"""

from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

import pytest

from straditize_core.rpc_server import create_rpc_dispatcher
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import read_column_values, resolve_column_scale

# 载图/分列用与既有 e2e 一致的真值参数，保证列几何可复现。
ROI_XLIM = [315, 1946]
ROI_YLIM = [511, 1311]

# 参与比对的列：0 承载"列级覆盖"，1 是"没设过覆盖"的对照。
COLUMN_WITH_OVERRIDE = 0
COLUMN_WITHOUT_OVERRIDE = 1

GROUP_STROKE = 6.0
COLUMN_STROKE = 4.0
# 用户包里的斜率量级：让 2px 的差变成 0.3226 这个可辨认的数。
VALUE_PER_PX = 0.16129

TOL = 1e-9


def _rpc(dispatcher, method: str, **params) -> dict:
    """走真 dispatcher：参数绑定、错误映射、方法注册都按生产路径发生。"""
    return dispatcher.handle_object(
        {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    )


def _ok(response: dict, what: str) -> dict:
    assert "error" not in response, f"{what} 失败：{response.get('error')}"
    return response["result"]


def _start_of(col: dict) -> float:
    """列左缘：`detect_columns` 写 `start`，`project_load` 同时写 `start`/`startX`。

    与 `resolve_column_scale` 的取法保持一致（先 `startX` 后 `start`），
    否则测试自己的口径和被测代码的口径会分叉。
    """
    return float(col.get("startX", col.get("start", 0.0)) or 0.0)


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
    """改写工程包里的 `straditize.json`（模拟"更早版本保存的包"），其余成员原样搬运。

    用改写文件而不是改内存/session 对象：本用例要复现的正是"**包里的**两个数互相矛盾"，
    在会话对象上动手脚会绕过载入路径，等于测了个假的东西。
    """
    members = _read_members(path)
    payload = json.loads(members["straditize.json"])
    mutate(payload)
    out = path.parent / f"{path.stem}-rewritten.tar"
    with tarfile.open(out, "w") as tf:
        for name, data in members.items():
            if name == "straditize.json":
                data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            info = tarfile.TarInfo(name=name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    return out


def _session_with_overrides() -> tuple[StraditizeSession, object]:
    """载图 → 分列 → 组轴粗 6 + 组斜率 → 第 0 列覆盖成 4。

    组的 `value_per_px` / `axis_stroke_px` 走 `roi.groupUpdate`，列的覆盖走
    `column.update`——两者都是真实用户路径（步骤 6 的"仅本列"输入框）。
    """
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns(data_xlim=list(ROI_XLIM), data_ylim=list(ROI_YLIM))
    assert session.columns, "前置：必须分列出列"
    assert len(session.columns) > COLUMN_WITHOUT_OVERRIDE, "前置：至少要两列"

    dispatcher = create_rpc_dispatcher(session)
    roi_id = session.rois[0]["id"]
    group_id = session.rois[0]["x_groups"][0]["id"]

    _ok(
        _rpc(
            dispatcher,
            "roi.groupUpdate",
            roi_id=roi_id,
            group_id=group_id,
            updates={"value_per_px": VALUE_PER_PX, "axis_stroke_px": GROUP_STROKE},
        ),
        "写组级斜率与轴粗",
    )
    _ok(
        _rpc(
            dispatcher,
            "column.update",
            col_index=COLUMN_WITH_OVERRIDE,
            updates={"axis_stroke_px": COLUMN_STROKE},
        ),
        "写列级轴粗覆盖",
    )

    # 前置自检：列级覆盖真的生效（0 点 = 列左缘 + 4，不是 + 6）。
    col = session.columns[COLUMN_WITH_OVERRIDE]
    scale = resolve_column_scale(session, col, COLUMN_WITH_OVERRIDE)
    assert scale.source == "group_slope", f"前置：应走组斜率分支，实际 {scale.source}"
    assert scale.abs_px0 == pytest.approx(_start_of(col) + COLUMN_STROKE), (
        "前置：列级轴粗 4 必须已经生效（0 点 = start + 4）"
    )
    return session, dispatcher


def _reading_snapshot(session: StraditizeSession, col_index: int) -> dict:
    """同一列、同一批样本行的读数快照（承重判据的原料）。

    样本行取自 `column_points`——`digitize` 逐行产出的真实数字化结果
    （不是控制点那种稀疏 32 点，也不是测试自己编的行号）。
    """
    session.digitize(col_index, "area")
    col = session.columns[col_index]
    scale = resolve_column_scale(session, col, col_index)
    points = session.column_points.get(col_index) or []
    rows = [int(p["row"]) for p in points]
    xs = [float(p["x"]) for p in points]
    return {
        "startX": _start_of(col),
        "stroke_override": col.get("axis_stroke_px"),
        "abs_px0": scale.abs_px0,
        "abs_px1": scale.abs_px1,
        "source": scale.source,
        "rows": rows,
        "xs": xs,
        "values": read_column_values(scale, xs),
    }


@pytest.fixture()
def saved_pack(tmp_path: Path) -> Path:
    """带"列级轴粗覆盖"的工程包（保存时用的就是被测代码）。"""
    session, dispatcher = _session_with_overrides()
    pack = tmp_path / "axis_stroke_project.tar"
    _ok(_rpc(dispatcher, "project.save", output_path=str(pack)), "保存工程包")
    assert pack.exists(), "前置：工程包必须落盘"
    return pack


def test_saved_package_contains_column_axis_stroke(saved_pack: Path) -> None:
    """① 保存的 straditize.json 里，列级轴粗必须写进去（当前实现必红）。"""
    payload = json.loads(_read_members(saved_pack)["straditize.json"])
    columns = payload["columns"]
    assert len(columns) > COLUMN_WITHOUT_OVERRIDE, "前置：包内必须有列"

    stored = columns[COLUMN_WITH_OVERRIDE].get("axis_stroke_px")
    assert stored == COLUMN_STROKE, (
        "列级轴粗是用户显式设的『本列』值，必须进包；"
        f"当前包内该键为 {stored!r}（缺失即覆盖丢失，载入后会退化到组值 {GROUP_STROKE}）"
    )
    # 对照：没设过覆盖的列不该凭空多出一个键（否则等于替用户声称"这列被单独设过"）。
    assert columns[COLUMN_WITHOUT_OVERRIDE].get("axis_stroke_px") is None, (
        "没有列级覆盖的列不得写 axis_stroke_px："
        f"实际 {columns[COLUMN_WITHOUT_OVERRIDE].get('axis_stroke_px')!r}"
    )


def test_roundtrip_preserves_column_axis_stroke(saved_pack: Path) -> None:
    """② 载入后该列仍是 4，而不是回落到组值 6。"""
    session, dispatcher = _session_with_overrides()
    before = _reading_snapshot(session, COLUMN_WITH_OVERRIDE)

    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(saved_pack)), "载入工程包")

    restored = session.columns[COLUMN_WITH_OVERRIDE]
    assert restored.get("axis_stroke_px") == COLUMN_STROKE, (
        "载入后列级轴粗必须仍是 4；若为 None 说明包里的覆盖被丢，"
        f"0 点会退化成 start+{GROUP_STROKE}。实际 {restored.get('axis_stroke_px')!r}"
    )
    after = _reading_snapshot(session, COLUMN_WITH_OVERRIDE)
    assert after["abs_px0"] == before["abs_px0"], (
        f"0 点漂移：载入前 {before['abs_px0']}，载入后 {after['abs_px0']}"
        f"（差 {after['abs_px0'] - before['abs_px0']}px）"
    )
    assert after["abs_px1"] == before["abs_px1"], (
        f"tickEndX 漂移：载入前 {before['abs_px1']}，载入后 {after['abs_px1']}"
    )


def test_roundtrip_preserves_column_readings(saved_pack: Path) -> None:
    """③ 承重：同一列同一批样本行，load 前后读数逐值相等（1e-9）。

    这一条是"数据完整性"本身——上面两条只是它的可归因形式。
    当前实现下这里会出现 2px × value_per_px ≈ 0.3226 的逐行恒差。
    """
    session, dispatcher = _session_with_overrides()
    before = _reading_snapshot(session, COLUMN_WITH_OVERRIDE)
    assert before["rows"], "前置：该列必须有数字化样本行，否则本条断言是空转"

    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(saved_pack)), "载入工程包")

    after = _reading_snapshot(session, COLUMN_WITH_OVERRIDE)
    assert after["rows"] == before["rows"], "样本行集合不该因保存/载入而变化"
    assert after["xs"] == before["xs"], "同一行的像素位置不该因保存/载入而变化"

    diffs = [
        (row, b, a)
        for row, b, a in zip(before["rows"], before["values"], after["values"])
        if b is None or a is None or abs(float(b) - float(a)) > TOL
    ]
    assert not diffs, (
        f"载入前后读数必须逐值相等（容差 {TOL}），实际有 {len(diffs)} 行不同。"
        f"前 3 条 (row, 载入前, 载入后)：{diffs[:3]}。"
        "这类整列恒差正是列级轴粗丢失后 0 点右移 2px 造成的。"
    )


def test_column_without_override_still_uses_group_stroke(saved_pack: Path) -> None:
    """④负向对照：没设过列级覆盖的列，载入后仍取组值（不能被这条改动改坏）。"""
    session, dispatcher = _session_with_overrides()
    before = _reading_snapshot(session, COLUMN_WITHOUT_OVERRIDE)
    assert before["stroke_override"] is None, "前置：对照列不该有列级覆盖"
    assert before["abs_px0"] == pytest.approx(before["startX"] + GROUP_STROKE), (
        "前置：对照列的 0 点必须来自组值 6"
    )

    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(saved_pack)), "载入工程包")

    after = _reading_snapshot(session, COLUMN_WITHOUT_OVERRIDE)
    assert after["stroke_override"] is None, (
        "载入不得给对照列凭空补一个列级覆盖（那会改变它原本的组值行为）"
    )
    assert after["abs_px0"] == before["abs_px0"], (
        f"对照列 0 点不该变：载入前 {before['abs_px0']}，载入后 {after['abs_px0']}"
    )
    assert after["values"] == before["values"], "对照列读数不该变"


def test_explicitly_cleared_override_falls_back_to_group(saved_pack: Path, tmp_path: Path) -> None:
    """④负向对照：列级被显式清空（`None`）后，存/取都回落组值。"""
    session, dispatcher = _session_with_overrides()

    # 经由产品写入入口把覆盖清掉（`None` = 清除，回到组值）。这不是测试端塞值。
    _ok(
        _rpc(
            dispatcher,
            "column.update",
            col_index=COLUMN_WITH_OVERRIDE,
            updates={"axis_stroke_px": None},
        ),
        "清除列级轴粗覆盖",
    )
    assert session.columns[COLUMN_WITH_OVERRIDE].get("axis_stroke_px") is None

    path = tmp_path / "cleared.tar"
    _ok(_rpc(dispatcher, "project.save", output_path=str(path)), "保存（已清除覆盖）")
    payload = json.loads(_read_members(path)["straditize.json"])
    assert payload["columns"][COLUMN_WITH_OVERRIDE].get("axis_stroke_px") is None, (
        "清除后的列不得把旧值写回包（那会让用户「清除」后又冒出来）"
    )

    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(path)), "载入")

    col = session.columns[COLUMN_WITH_OVERRIDE]
    scale = resolve_column_scale(session, col, COLUMN_WITH_OVERRIDE)
    assert col.get("axis_stroke_px") is None
    assert scale.abs_px0 == pytest.approx(_start_of(col) + GROUP_STROKE), (
        f"清除覆盖后 0 点必须回落到组值 6，实际偏移 {scale.abs_px0 - _start_of(col)}px"
    )


def test_load_reports_inconsistent_tick_end_in_manifest(
    saved_pack: Path, tmp_path: Path
) -> None:
    """⑤ 载入期自检：包里的 tickEndX 与列级轴粗矛盾 → 下次保存的 manifest 里有告警。

    这正是用户那份包的形状：`tickEndX` 按真实的轴粗 4 算（start+5），
    而列级轴粗在更早的版本里被丢掉了。这种包打开后读数整列偏 2px，界面却完全正常，
    所以必须让用户在某处看到一行字。
    """

    def corrupt(payload: dict) -> None:
        col = payload["columns"][COLUMN_WITH_OVERRIDE]
        # 列级轴粗在包里"丢了"：删掉键，只留按 4 算出来的 tickEndX。
        col.pop("axis_stroke_px", None)
        col["tickEndX"] = _start_of(col) + COLUMN_STROKE + 1.0

    broken = _rewrite_payload(saved_pack, corrupt)

    session, dispatcher = _session_with_overrides()
    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(broken)), "载入旧式包")

    out = tmp_path / "after-broken-load.tar"
    result = _ok(_rpc(dispatcher, "project.save", output_path=str(out)), "再次保存")
    assert result["success"] is True, "自检只记告警，不得阻断导出"

    manifest = json.loads(_read_members(out)["manifest.json"])
    warnings = manifest.get("warnings") or []
    assert warnings, (
        "包里的 tickEndX 与该列轴粗矛盾时必须写进 manifest.warnings，"
        "否则用户永远看不到这份包的读数已经偏了"
    )
    target = [
        w
        for w in warnings
        if isinstance(w, dict) and w.get("kind") == "axis_stroke_tick_end_mismatch"
    ]
    assert target, f"告警必须带可机读的 kind，实际 {warnings}"
    assert any(int(w.get("col_index")) == COLUMN_WITH_OVERRIDE for w in target), (
        f"告警必须指名是哪一列，实际 {target}"
    )
    assert target[0]["offset_px"] == pytest.approx(COLUMN_STROKE - GROUP_STROKE), (
        f"告警里的偏移量必须是真的差值，实际 {target[0].get('offset_px')}"
    )


def test_consistent_roundtrip_has_no_manifest_warnings(
    saved_pack: Path, tmp_path: Path
) -> None:
    """⑤负向对照：自洽的包（修复后保存的包）载入再保存，不得凭空生成告警。

    这条同时是缺陷的第二个判别器：载入端若丢掉列级轴粗，`tickEndX` 会按组值
    重算，与包里的值对不上，于是这里会冒出告警——也就是说"没告警"本身
    证明了覆盖真的被还原了。
    """
    session, dispatcher = _session_with_overrides()
    _ok(_rpc(dispatcher, "project.new"), "清空项目")
    _ok(_rpc(dispatcher, "project.load", project_data=str(saved_pack)), "载入工程包")

    out = tmp_path / "consistent-again.tar"
    _ok(_rpc(dispatcher, "project.save", output_path=str(out)), "再次保存")

    manifest = json.loads(_read_members(out)["manifest.json"])
    assert not manifest.get("warnings"), (
        "本次载入/保存完全自洽，不该有 warnings，实际 "
        f"{manifest.get('warnings')!r}（若有，通常是载入端丢了列级轴粗）"
    )
