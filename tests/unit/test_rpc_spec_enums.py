# -*- coding: utf-8 -*-
"""§4 / §4A **枚举型参数**：文档声明的取值 ↔ 代码真正分支出不同行为的取值。

为什么需要这条：`pixi run lint` 的 `lint-rpc-doc`（`scripts/check_rpc_spec_drift.py:27`）
只核对 `agedepth.*` / `ensemble.*` 两族的**方法名**，其余接口的取值写错永远不会变红。
`reader_type` 曾写成复数 `"bars"`、默认写成 `"line"`，与代码的单数 `"bar"`、默认 `"area"`
自相矛盾，于是代码里长出两套名字并存，柱状图读数只有真值一半（P-04）。

本文件是 `tests/unit/test_rpc_spec_reader_types.py`（§4.4 样板）的推广。
每条断言的形状都是「文档行里的字面量集合 == 代码里真正会走到不同分支的那集」，
默认值单独断言 —— 文档写错取值、代码改默认值，两种漂移各自变红。

代码侧的取值一律从**真正做校验/分支的那一处**取（AST 解析或行为探针），
不在这里人肉抄一份常量：抄一份常量等于把 drift 搬进测试里，测试自己也会漂。
只有 `strength` 有现成常量（`GRID_LINE_PRESETS`）可直接绑定。

审计结论与"代码未校验"清单见 `docs/findings/spec-enum-audit.md`。
"""

from __future__ import annotations

import ast
import inspect
import re
from pathlib import Path
from typing import Any

import pytest

from straditize_core.age_depth_model import generate_bacon_script
from straditize_core.image import (
    EXTRACTION_MODES,
    GRID_LINE_PRESETS,
    STROKE_MODES,
    normalize_extraction_mode,
    normalize_grid_line_strength,
    rasterize_strokes,
)
from straditize_core.protocol import INVALID_PARAMS, JsonRpcError
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.digitize import READER_TYPES
from straditize_core.session_parts.xscale import (
    SCALE_TYPES,
    ColumnScale,
    resolve_column_scale,
)

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "docs" / "JSON_RPC_SPECIFICATION.md"


# --------------------------------------------------------------------------- #
# 文档侧：把「参数那一行」里的字面量取出来
# --------------------------------------------------------------------------- #
def _section(anchor: str, end_anchor: str) -> str:
    """截取一个 §小节，避免同名参数在不同小节互相串味（`unit` 就有两处）。"""
    text = SPEC.read_text(encoding="utf-8")
    start = text.index(anchor)
    stop = text.index(end_anchor, start + len(anchor))
    return text[start:stop]


def _param_line(section: str, param: str) -> str:
    """参数的定义行。

    两级匹配：先找 `- \\`param\\` (...)` 形式的列表项，再退回 Markdown 表格行
    `| \\`param\\` | ...`。不能只写"含该参数名的那一行"——§4.2 的 `threshold`
    一行里就提到了 `` `mode` ``，会先命中它。
    """
    for pattern in (
        rf"^\s*- `{re.escape(param)}` \(.*$",
        rf"^\s*\| `{re.escape(param)}` \|.*$",
    ):
        m = re.search(pattern, section, re.M)
        if m:
            return m.group(0)
    raise AssertionError(f"文档里找不到参数 `{param}` 的定义行")


def _doc_values(section: str, param: str, *, bare: bool = False) -> set[str]:
    """定义行里反引号引起来的全部字面量。

    默认值也写在同一行（``默认 `"otsu"``），会一并被取到——这没有副作用：
    默认值本来就该是取值集合的成员（``otsu`` / ``medium`` / ``csv`` / ``depth``）。
    若哪天默认值跑到集合之外，那是真问题，应该红。

    ``bare=True`` 用于文档用裸反引号（`` `hoya` ``）而非带引号（`` `"otsu"` ``）列举的
    参数——§4.1 的 `sample_key` 就是这种写法；此时把参数名自身剔除。
    """
    line = _param_line(section, param)
    if bare:
        return set(re.findall(r"`([^`]+)`", line)) - {param}
    return set(re.findall(r'`"([^"`]+)"`', line))


def _doc_default(section: str, param: str) -> str:
    m = re.search(r'默认\s*`"([^"`]+)"`', _param_line(section, param))
    assert m, f"参数 `{param}` 的文档行没写默认值"
    return m.group(1)


# --------------------------------------------------------------------------- #
# 代码侧：从真正分支的那一处取字面量
# --------------------------------------------------------------------------- #
def _parse(rel: str) -> ast.Module:
    return ast.parse((ROOT / rel).read_text(encoding="utf-8"))


def _function(rel: str, name: str) -> ast.FunctionDef:
    for node in ast.walk(_parse(rel)):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{rel} 里找不到函数 {name}()")


def _compared_literals(rel: str, func: str, target: str) -> set[str]:
    """`func` 函数体内与 `target` 比较过的字符串字面量。

    这就是"代码真正支持的取值集合"的定义：写进 `x == "a"` / `x not in ("a", "b")`
    的名字才会走到不同分支，其余一律落进 else / raise。`target` 允许写成
    `self.scale_type` 这种属性形式。
    """
    found: set[str] = set()
    for sub in ast.walk(_function(rel, func)):
        if not isinstance(sub, ast.Compare):
            continue
        if ast.unparse(sub.left).replace(" ", "") != target:
            continue
        for cmp in sub.comparators:
            if isinstance(cmp, ast.Constant) and isinstance(cmp.value, str):
                found.add(cmp.value)
            elif isinstance(cmp, (ast.Tuple, ast.List, ast.Set)):
                found |= {
                    elt.value
                    for elt in cmp.elts
                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                }
    return found


def _dict_keys(rel: str, var_name: str) -> set[str]:
    """`var_name = {"k": ...}` 这种字典字面量的键（键即受支持的取值）。"""
    for node in ast.walk(_parse(rel)):
        if not isinstance(node, ast.Assign) or not isinstance(node.value, ast.Dict):
            continue
        if not any(isinstance(t, ast.Name) and t.id == var_name for t in node.targets):
            continue
        return {
            key.value
            for key in node.value.keys
            if isinstance(key, ast.Constant) and isinstance(key.value, str)
        }
    raise AssertionError(f"{rel} 里找不到 `{var_name} = {{...}}`")


def _arg_default(rel: str, func: str, arg: str):
    """从源码取形参默认值（用于 `register()` 里的嵌套闭包，inspect 够不着）。"""
    node = _function(rel, func).args
    positional = (
        node.args[len(node.args) - len(node.defaults) :] if node.defaults else []
    )
    for param, default in zip(positional, node.defaults):
        if param.arg == arg:
            return ast.literal_eval(default)
    for param, default in zip(node.kwonlyargs, node.kw_defaults):
        if param.arg == arg and default is not None:
            return ast.literal_eval(default)
    raise AssertionError(f"{rel}::{func}() 没有形参 {arg}")


# --------------------------------------------------------------------------- #
# 一、闭集：文档声明的取值 == 代码里真正分支出不同行为的取值
# --------------------------------------------------------------------------- #
CLOSED_SET_CASES = [
    pytest.param(
        "### 4.2 `core.extractForeground`",
        "### 4.3",
        "mode",
        "straditize_core/session_parts/core.py",
        "extract_foreground",
        "mode",
        False,
        id="mode",
    ),
    pytest.param(
        "### 4.6 `core.calibrateAxes`",
        "### 4.7",
        "primary_axis",
        "straditize_core/session_parts/export.py",
        "calibrate_axes",
        "candidate",
        False,
        id="primary_axis",
    ),
    pytest.param(
        "### 4.9 `core.exportData`",
        "### 4.10",
        "format",
        "straditize_core/session_parts/export.py",
        "export_data",
        "fmt",
        False,
        id="format",
    ),
    pytest.param(
        "### 4.1 `core.loadImage`",
        "### 4.2",
        "sample_key",
        "straditize_core/session_parts/core.py",
        None,
        "sample_candidates",
        True,
        id="sample_key",
    ),
    pytest.param(
        "### 4A.2 `agedepth.extractAndInspect`",
        "### 4A.3",
        "curve_channel",
        "straditize_core/age_depth_tracer.py",
        "_select_curve_channel",
        "forced",
        False,
        id="curve_channel",
    ),
]


@pytest.mark.parametrize(
    ("doc_start", "doc_end", "param", "code_file", "code_func", "code_var", "bare"),
    CLOSED_SET_CASES,
)
def test_documented_values_match_code(
    doc_start: str,
    doc_end: str,
    param: str,
    code_file: str,
    code_func: str | None,
    code_var: str,
    bare: bool,
) -> None:
    """文档声明的那一集，必须与代码真会区分的那一集逐字相等。"""
    documented = _doc_values(_section(doc_start, doc_end), param, bare=bare)
    if code_func is None:
        supported = _dict_keys(code_file, code_var)
    else:
        supported = _compared_literals(code_file, code_func, code_var)
    assert supported, f"{code_file} 的 {code_func} / {code_var} 处取不到任何字面量"
    assert documented == supported, (
        f"{param}：文档声明 {sorted(documented)}，代码实际 {sorted(supported)} —— "
        "读文档的人会照写一个代码不认识（或已被替换）的名字，"
        "而错误取值往往不报错、只是落进 else 分支（P-04 就是这么来的）"
    )


def test_documented_strength_matches_code() -> None:
    """`strength` 有现成常量：预设表 ∪ `"off"`（清空掩膜的那条分支）。"""
    section = _section("### 4.8 `algorithm.degrid`", "### 4.9")
    documented = _doc_values(section, "strength")
    supported = set(GRID_LINE_PRESETS) | {"off"}
    assert documented == supported, (
        f"strength：文档声明 {sorted(documented)}，代码实际 {sorted(supported)}"
    )
    # "off" 不是检测预设，若它只出现在文档里、代码只是被 normalize 拒掉，
    # 那文档承诺的"主动清空掩膜"就是假的。
    source = ast.get_source_segment(
        (ROOT / "straditize_core/session_parts/core.py").read_text(encoding="utf-8"),
        _function("straditize_core/session_parts/core.py", "algorithm_degrid"),
    )
    assert '"off"' in source or "'off'" in source, (
        'algorithm_degrid 里没有识别 "off" 的分支——文档承诺的清空行为不存在'
    )


def _scale_outcome(scale_type: str) -> float:
    """用真实换算器读一个中点像素，得到该 scale_type 的实际行为。"""
    scale = ColumnScale(
        abs_px0=0.0,
        val0=1.0,
        abs_px1=100.0,
        val1=100.0,
        unit="%",
        plot_type="area",
        scale_type=scale_type,
        exaggeration_mult=None,
        calibrated=True,
        source="x_ticks",
    )
    return scale.px_to_value(50.0, apply_exaggeration=False)


def test_documented_scale_type_matches_code() -> None:
    """`column.calibrateXTicks` 的 `scale_type`：绑白名单常量，再用实测值钉住行为。

    审计 D-1 之前这里是"写入原样落盘 + 只判 `== "log"`"，第三个取值会被静默当线性。
    现在代码有 `SCALE_TYPES`，文档与常量必须逐字相等；行为仍单独用数值验证，
    否则两处一起写错（文档抄常量、常量抄文档）时门禁就白设了。
    """
    documented = _doc_values(
        _section("### 4.10 `column.calibrateXTicks`", "### 4.10b"), "scale_type"
    )
    assert documented == set(SCALE_TYPES), (
        f"scale_type：文档声明 {sorted(documented)}，代码白名单 {sorted(SCALE_TYPES)}"
    )
    # log 用对数反演、linear 用端点直线插值——两个数必须不同，否则"两个取值"是假的。
    assert _scale_outcome("log") == pytest.approx(10.0)
    assert _scale_outcome("linear") == pytest.approx(1.0 + 0.5 * (100.0 - 1.0))


def test_unknown_scale_type_is_rejected_not_treated_as_linear() -> None:
    """审计 D-1：非法值必须抛 `INVALID_PARAMS`（-32602），不得落进线性桶。

    判别力：把 `normalize_scale_type` 的 `raise` 改回兜底线性，这条立刻红。
    """
    with pytest.raises(JsonRpcError) as excinfo:
        _scale_outcome("sqrt")
    assert excinfo.value.code == INVALID_PARAMS == -32602, (
        f"非法 scale_type 的 code 应为 -32602，实测 {excinfo.value.code}"
    )
    assert "sqrt" in str(excinfo.value), "错误消息必须点名非法取值"
    # 大小写/空白属归一化，不算"未知"：归一化后仍是 log 分支（不是被当线性）。
    assert _scale_outcome(" LOG ") == pytest.approx(10.0)


def test_stored_unknown_scale_type_is_rejected_at_resolution() -> None:
    """写入端（`session_parts/xticks.py`）当前不校验，非法值能落进列表。

    因此解析端必须同样拒绝：否则一个存进工程文件的错拼会在导出时静默换成线性公式，
    而导出的表里看不出任何异常。
    """
    with pytest.raises(JsonRpcError) as excinfo:
        resolve_column_scale(
            StraditizeSession(),
            {"scale_type": "logarithmic", "start": 0.0, "end": 100.0},
        )
    assert excinfo.value.code == INVALID_PARAMS == -32602


# --------------------------------------------------------------------------- #
# 二、默认值：文档声明的默认值 == 代码里的默认值
# --------------------------------------------------------------------------- #
DEFAULT_CASES = [
    pytest.param(
        "### 4.2 `core.extractForeground`",
        "### 4.3",
        "mode",
        "extract_foreground",
        id="mode",
    ),
    pytest.param(
        "### 4.8 `algorithm.degrid`",
        "### 4.9",
        "strength",
        "algorithm_degrid",
        id="strength",
    ),
    pytest.param(
        "### 4.9 `core.exportData`", "### 4.10", "format", "export_data", id="format"
    ),
]


@pytest.mark.parametrize(("doc_start", "doc_end", "param", "method"), DEFAULT_CASES)
def test_documented_default_matches_session_signature(
    doc_start: str, doc_end: str, param: str, method: str
) -> None:
    documented = _doc_default(_section(doc_start, doc_end), param)
    default = (
        inspect.signature(getattr(StraditizeSession, method)).parameters[param].default
    )
    assert documented == default, (
        f"{param}：文档默认 {documented!r}，{method}() 默认 {default!r}"
    )


class _RecordingDispatcher:
    """把 `register()` 注册的闭包捞出来，用于直接调用 RPC 包装层。"""

    def __init__(self) -> None:
        self.methods: dict[str, Any] = {}

    def register_method(self, name: str, func: Any) -> None:
        self.methods[name] = func


class _StubSession:
    """注册阶段会取 `session.digitize` 等一大堆属性，所以任何属性都给一个记录器。

    这样既能完成注册，又能在调用包装层后检查它**实际转发**了什么参数。
    """

    def __init__(self) -> None:
        self.calls: dict[str, dict[str, Any]] = {}

    def _column_band_edges(self) -> None:
        return None

    def __getattr__(self, name: str):
        def _record(*args: Any, **kwargs: Any) -> dict[str, Any]:
            self.calls[name] = kwargs
            return {}

        return _record


def _rpc_wrapper(name: str) -> tuple[Any, _StubSession]:
    from straditize_core.rpc_methods.digitize import register

    dispatcher = _RecordingDispatcher()
    session = _StubSession()
    register(dispatcher, session)
    return dispatcher.methods[name], session


def test_mode_default_lives_only_in_the_session_layer() -> None:
    """审计 D-6：`mode` 的默认值只应有一处（session 层）。

    包装层此前写死了一份 `"otsu"` 副本：两处任一处单独改动，省略参数时的行为就取决于
    走哪条通路。现在包装层形参默认是 `None`，且**未传时不转发** —— 否则会把 None 灌进
    session，落进它"未知模式 → INVALID_PARAMS"的分支，默认值反而失效。
    """
    documented = _doc_default(
        _section("### 4.2 `core.extractForeground`", "### 4.3"), "mode"
    )
    session_default = (
        inspect.signature(StraditizeSession.extract_foreground)
        .parameters["mode"]
        .default
    )
    assert documented == session_default, (
        f"文档默认 {documented!r} 与 session 默认 {session_default!r} 不一致"
    )
    assert (
        _arg_default(
            "straditize_core/rpc_methods/digitize.py", "core_extract_foreground", "mode"
        )
        is None
    ), "RPC 包装层不得再写死 mode 默认值"

    wrapper, session = _rpc_wrapper("core.extractForeground")
    wrapper()
    assert "mode" not in session.calls["extract_foreground"], (
        "未传 mode 时包装层仍把它转发给 session —— 默认值就不是单一来源了"
    )
    wrapper(mode="binary")
    assert session.calls["extract_foreground"]["mode"] == "binary", (
        "显式传值必须原样转发"
    )


def test_strength_default_is_the_same_at_both_sites() -> None:
    """`strength` 的默认值也是两处：`algorithm_degrid` 形参与 `normalize_grid_line_strength`。"""
    documented = _doc_default(
        _section("### 4.8 `algorithm.degrid`", "### 4.9"), "strength"
    )
    signature_default = (
        inspect.signature(StraditizeSession.algorithm_degrid)
        .parameters["strength"]
        .default
    )
    normalizer_default = normalize_grid_line_strength(None)
    assert documented == signature_default == normalizer_default, (
        f"文档 {documented!r} / 形参 {signature_default!r} / 归一化 {normalizer_default!r}"
    )


def test_documented_primary_axis_default_is_the_session_default() -> None:
    """`primary_axis` 的形参默认是 `None`（=沿用会话当前值），
    所以"默认 depth"只能由会话初始值兑现 —— 文档说的是后者。"""
    documented = _doc_default(
        _section("### 4.6 `core.calibrateAxes`", "### 4.7"), "primary_axis"
    )
    assert StraditizeSession().primary_axis == documented
    assert (
        inspect.signature(StraditizeSession.calibrate_axes)
        .parameters["primary_axis"]
        .default
        is None
    ), "形参默认应为 None（沿用会话值），改成字面量就意味着省略参数会覆盖用户设置"


def test_curve_channel_default_is_the_same_at_both_sites() -> None:
    from straditize_core.age_depth_tracer import extract_age_depth_model

    session_default = (
        inspect.signature(StraditizeSession.calibrate_and_extract_age_depth)
        .parameters["curve_channel"]
        .default
    )
    tracer_default = (
        inspect.signature(extract_age_depth_model).parameters["curve_channel"].default
    )
    assert session_default == tracer_default, (
        f"curve_channel 默认值两层不一致：session {session_default!r} / tracer {tracer_default!r}"
    )


# --------------------------------------------------------------------------- #
# 三、自由文本：`unit` 刻意不是枚举，只断言"文档说是自由文本 + 默认值一致"
# --------------------------------------------------------------------------- #
def test_unit_is_documented_as_free_text_and_really_is_one() -> None:
    section = _section("### 4.6 `core.calibrateAxes`", "### 4.7")
    line = _param_line(section, "unit")
    assert "自由文本" in line, "§4.6 必须把 unit 标为自由文本"
    assert "刻意不做枚举" in section, "§4.6 必须说明为什么不做枚举"

    documented = _doc_default(section, "unit")
    session = StraditizeSession()
    assert session.depth_unit == documented, (
        f"unit：文档默认 {documented!r}，会话初始 {session.depth_unit!r}"
    )

    # 自由文本必须真的自由：白名单外的单位也应被接受并原样记下。
    # 若哪天给 unit 加了枚举校验，这条会红 —— 那时必须同步改文档，
    # 因为文档明确承诺"强行枚举会迫使用户误报自己的坐标轴"。
    session.calibrate_axes(
        y_marks=[{"pixel": 10.0, "val": 0.0}, {"pixel": 110.0, "val": 100.0}],
        unit="furlong",
    )
    assert session.depth_unit == "furlong"


# --------------------------------------------------------------------------- #
# 四、审计 D-2～D-5 本轮新增的参数
# --------------------------------------------------------------------------- #
def test_documented_correction_modes_match_code() -> None:
    """§4.8 `corrections[].mode`（审计 D-2）：文档用 `"erase"`|`"restore"` 列举，须与常量相等。"""
    section = _section("### 4.8 `algorithm.degrid`", "### 4.9")
    found = re.search(r'"([a-z]+)"\s*\|\s*"([a-z]+)"', section)
    assert found, "§4.8 必须列出笔迹模式的两个取值"
    assert set(found.groups()) == set(STROKE_MODES), (
        f"corrections[].mode：文档声明 {sorted(found.groups())}，"
        f"代码白名单 {sorted(STROKE_MODES)}"
    )


def test_unknown_correction_mode_is_rejected() -> None:
    """审计 D-2：拼错 `restore` 过去会落进 erase 桶——方向相反地损坏掩膜。

    判别力：把 `normalize_stroke_mode` 的 raise 改回"非 restore 即 erase"，这条立刻红。
    """
    with pytest.raises(JsonRpcError) as excinfo:
        rasterize_strokes(
            (12, 12), [{"mode": "restore!", "radius": 1, "points": [[5, 5]]}]
        )
    assert excinfo.value.code == INVALID_PARAMS == -32602, (
        f"非法笔迹模式的 code 应为 -32602，实测 {excinfo.value.code}"
    )
    assert "restore!" in str(excinfo.value)

    # 两个合法值仍各自落到对的掩膜（证明校验没把正常路径也拒掉）。
    restore, erase = rasterize_strokes(
        (12, 12), [{"mode": "restore", "radius": 1, "points": [[5, 5]]}]
    )
    assert restore.any() and not erase.any()
    restore, erase = rasterize_strokes(
        (12, 12), [{"mode": "erase", "radius": 1, "points": [[5, 5]]}]
    )
    assert erase.any() and not restore.any()


def test_documented_extraction_mode_matches_code() -> None:
    """§4.2 `extraction_mode`（审计 D-5 新补的条目）：5 个规范值 == `EXTRACTION_MODES`。"""
    section = _section("### 4.2 `core.extractForeground`", "### 4.3")
    documented = _doc_values(section, "extraction_mode")
    canonical = set(EXTRACTION_MODES.values())
    assert documented == canonical, (
        f"extraction_mode：文档声明 {sorted(documented)}，代码规范值 {sorted(canonical)}"
    )
    assert _doc_default(section, "extraction_mode") == normalize_extraction_mode(None)


def test_documented_plot_type_matches_reader_types() -> None:
    """§4.10 `plot_type`（审计 D-4）：与 `READER_TYPES` 是同一套单数命名。"""
    documented = _doc_values(
        _section("### 4.10 `column.calibrateXTicks`", "### 4.10b"), "plot_type"
    )
    assert documented == set(READER_TYPES), (
        f"plot_type：文档声明 {sorted(documented)}，READER_TYPES = {sorted(READER_TYPES)}"
    )


def test_documented_cc_values_match_code() -> None:
    """§4A.6 `cc`（审计 D-3）：Python 侧没有分支，只能绑两处可判定的东西。

    (a) 代码自己的 docstring 声明的集合（`age_depth_model.py:1407`）；
    (b) 实测透传——每个文档取值都必须原样出现在生成的 rbacon 脚本里。

    这条比 §4.4 那种"绑到代码常量"弱一档，理由写在用例里而不是假装它同样强：
    `cc` 在本层就是透传，没有可绑的分支集合。
    """
    section = _section("### 4A.6 `agedepth.generateBaconScript`", "### 4A.7")
    bullet = re.search(r"^.*`cc`：.*$", section, re.M)
    assert bullet, "§4A.6 必须列出 cc 的取值"
    documented = {int(v) for v in re.findall(r"`(\d+)`\s*=", bullet.group(0))}
    declared = {
        int(v)
        for v in re.findall(
            r"\b(\d) = (?:IntCal|Marine|SHCal|Non-14C)",
            inspect.getdoc(generate_bacon_script) or "",
        )
    }
    assert documented == declared, (
        f"cc：文档声明 {sorted(documented)}，代码 docstring 声明 {sorted(declared)}"
    )
    for value in sorted(documented):
        script = generate_bacon_script(
            core_name="T", dates=[{"depth": 10.0, "age": 1200, "error": 30}], cc=value
        )
        assert f"cc={value}" in script, f"cc={value} 未原样透传进 rbacon 脚本"


# --------------------------------------------------------------------------- #
# 五、写入端：非法值必须在**保存时**就报错，而不是读的第一刻
# --------------------------------------------------------------------------- #
#: 一列上合法的两个刻度端点（实测落在内置 hoya 图 col0 的允许区间内）。
def _ticks(session: StraditizeSession) -> list[dict[str, float]]:
    """按**该列真实几何**造两个端点，别硬编码像素。

    教训：此处原写死 `px=300/400`，而 hoya 的 ROI 左界一旦变动（D-04 把它从
    309 移到 319），左端点就落到"基线附近 ±15px"的守卫之外，整组用例连带变红 ——
    测的是 scale_type 归一化，却因为坐标写死而失败。
    """
    col = session.columns[0]
    x0 = float(col.get("start", col.get("startX", 0)))
    x1 = float(col.get("end", col.get("endX", x0 + 120)))
    return [
        {"px": x0 + 1.0, "value": 0.0},
        {"px": min(x1 - 1.0, x0 + 100.0), "value": 100.0},
    ]


def _session_with_column() -> StraditizeSession:
    session = StraditizeSession()
    session.load_image(sample_key="hoya")
    session.detect_columns()
    return session


def test_invalid_scale_type_is_rejected_at_save_time() -> None:
    """审计 D-1 的另一半（lead 指出的残留）：写入端也要拒绝。

    此前 `column.calibrateXTicks` 把 `scale_type` 原样落盘 → 返回"标定成功"，
    用户以为存住了，直到下一次读（`resolve_column_scale`）才 -32602。
    判别力：把 `xticks.py` 里那句 `normalize_scale_type(scale_type)` 删掉，这条立刻红。
    """
    session = _session_with_column()
    before = dict(session.columns[0])
    with pytest.raises(JsonRpcError) as excinfo:
        session.calibrate_column_xticks(0, _ticks(session), scale_type="logarithmic")
    assert excinfo.value.code == INVALID_PARAMS == -32602
    assert "logarithmic" in str(excinfo.value)
    after = session.columns[0]
    assert after.get("scale_type") == before.get("scale_type"), (
        "非法 scale_type 仍然写进了列 —— 写入端校验没生效"
    )
    assert after.get("x_ticks") == before.get("x_ticks"), (
        "校验必须在改动 x_ticks / 撤销栈之前完成，非法值不该留下半写状态"
    )


def test_scale_type_is_canonicalised_when_saved() -> None:
    """归一化不是拒绝：`" LOG "` 是明确无歧义的写法，存进去应是 `"log"`。"""
    session = _session_with_column()
    session.calibrate_column_xticks(0, _ticks(session), scale_type=" LOG ")
    assert session.columns[0]["scale_type"] == "log"


def test_invalid_scale_type_is_rejected_for_roi_groups() -> None:
    """组的 `scale_type` 同样在写入端拒绝（`roi.groupCreate` / `roi.groupUpdate`）。"""
    session = _session_with_column()
    roi_id = session.rois[0]["id"]

    with pytest.raises(JsonRpcError) as create_err:
        session.roi_group_create(roi_id, name="g", scale_type="sqrt")
    assert create_err.value.code == INVALID_PARAMS
    assert not [g for g in session.rois[0].get("x_groups", []) if g.get("name") == "g"], (
        "非法 scale_type 仍然建出了组"
    )

    created = session.roi_group_create(roi_id, name="ok", scale_type=" LOG ")
    assert created["group"]["scale_type"] == "log"
    group_id = created["group"]["id"]

    with pytest.raises(JsonRpcError) as update_err:
        session.roi_group_update(roi_id, group_id, {"scale_type": "logarithmic"})
    assert update_err.value.code == INVALID_PARAMS
    group = next(g for g in session.rois[0]["x_groups"] if g["id"] == group_id)
    assert group["scale_type"] == "log", "非法更新仍然改了组标度"


# --------------------------------------------------------------------------- #
# 六、旧工程兼容：缺 `mode` 的报错必须点名第几笔并给出可操作的修法
# --------------------------------------------------------------------------- #
def test_legacy_stroke_without_mode_says_which_stroke_and_how_to_fix() -> None:
    """lead 要求 B2：旧工程（笔迹无 `mode`）撞墙时，文案要能照着修。

    报错方向不变（缺 mode 不静默取 erase），但必须说清"第几笔"和"补什么值"。
    判别力：把 `normalize_stroke_mode` 的 `index` 透传删掉、或把指引句删掉，这条红。
    """
    with pytest.raises(JsonRpcError) as excinfo:
        rasterize_strokes(
            (12, 12),
            [
                {"mode": "erase", "radius": 1, "points": [[1, 1]]},
                {"radius": 1, "points": [[2, 2]]},  # 旧工程：老的笔迹没有 mode 键
            ],
        )
    message = str(excinfo.value)
    assert excinfo.value.code == INVALID_PARAMS == -32602
    assert "第 2 笔" in message, f"报错必须点名第几笔，实测文案：{message}"
    assert 'mode: "erase"' in message and 'mode: "restore"' in message, (
        f"报错必须给出可操作的修法，实测文案：{message}"
    )


# --------------------------------------------------------------------------- #
# 七、旧工程迁移：载入时补 `mode`（只补这一个键），保存后再载入幂等
# --------------------------------------------------------------------------- #
def _legacy_project_payload() -> dict[str, Any]:
    """一个最小旧工程包：第一笔没有 `mode`（旧版本的写法），第二笔有。"""
    return {
        "version": "3.0.0",
        "schema_version": "3.0",
        "line_removal": {
            "strength": "medium",
            "corrections": [
                {"radius": 6, "points": [[10, 20], [30, 40]]},  # 旧包：缺 mode
                {"mode": "restore", "radius": 6, "points": [[50, 60]]},
            ],
        },
    }


def test_legacy_project_stroke_without_mode_is_backfilled_on_load() -> None:
    """旧工程缺 `mode`：载入时补 `erase`（旧代码原本就是按 erase 处理的）。

    目标不是"放宽校验"，而是让旧包打开后能直接干活：补的值必须等于当初的渲染语义，
    且**只补这一个键**（其它缺失字段照旧留空，否则等于替用户声称数据本来就在）。
    判别力：删掉 `project_load` 里的 `{**c, "mode": "erase"}`，这条立刻红。
    """
    session = StraditizeSession()
    session.project_load(_legacy_project_payload())

    assert session.line_corrections[0] == {
        "radius": 6,
        "points": [[10, 20], [30, 40]],
        "mode": "erase",  # 唯一新增的键
    }
    assert session.line_corrections[1]["mode"] == "restore", "已有取值不得被覆盖"

    # 载入后可直接应用，不再撞 `normalize_stroke_mode`。
    restore, erase = rasterize_strokes((80, 80), session.line_corrections)
    assert erase.any() and restore.any(), "两种模式的笔迹都应真的落进各自的掩膜"


def test_legacy_backfill_is_idempotent_across_save_and_reload() -> None:
    """载入 → 保存 → 再载入：第二遍不改动任何字段（补齐只发生一次）。"""
    first = StraditizeSession()
    first.project_load(_legacy_project_payload())
    saved = first.project_save(format="json")["data"]
    assert all("mode" in c for c in saved["line_removal"]["corrections"]), (
        "保存出的工程包仍缺 mode —— 下次载入还得再补一遍，说明补齐位置不对"
    )

    second = StraditizeSession()
    second.project_load(saved)
    assert second.line_corrections == first.line_corrections

    resaved = second.project_save(format="json")["data"]
    assert (
        resaved["line_removal"]["corrections"]
        == saved["line_removal"]["corrections"]
    ), "第二遍保存改变了笔迹字段 —— 补齐不是幂等的"


def test_mode_less_stroke_is_rejected_even_without_points() -> None:
    """没有点的笔迹也会被存进 `line_corrections` 并落盘，所以它同样必须带 `mode`。

    这是除"载入旧工程"之外**唯一**还能产出缺 mode 数据的路径（`algorithm.degrid`
    在 `rasterize_strokes` 返回后整份赋值）。校验因此放在"有没有点可画"之前。
    判别力：把 `normalize_stroke_mode` 挪回 `if not points: continue` 之后，这条红。
    """
    with pytest.raises(JsonRpcError) as excinfo:
        rasterize_strokes((12, 12), [{"radius": 1, "points": []}])
    assert excinfo.value.code == INVALID_PARAMS
    assert "第 1 笔" in str(excinfo.value)


def test_typo_in_stroke_mode_still_errors_with_stroke_number() -> None:
    """补缺省值 ≠ 放宽校验：拼错的取值必须继续报错，且点名第几笔。"""
    with pytest.raises(JsonRpcError) as excinfo:
        rasterize_strokes(
            (12, 12),
            [
                {"mode": "erase", "radius": 1, "points": [[1, 1]]},
                {"mode": "restroe", "radius": 1, "points": [[2, 2]]},
            ],
        )
    message = str(excinfo.value)
    assert excinfo.value.code == INVALID_PARAMS
    assert "第 2 笔" in message, f"文案要点名第几笔，实测：{message}"
    assert "restroe" in message, f"文案要点名错的那个取值，实测：{message}"
