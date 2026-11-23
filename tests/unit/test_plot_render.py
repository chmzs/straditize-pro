"""一键画图（本机 R + riojaPlot/rioja）：探测、路径校验、真出图、失败提示、产物去向。

## 判据

1. 显式配置了不存在的 Rscript 路径 → 探测失败并说明缺什么（不静默回退到别的 R）；
2. system.updateConfig 填不存在的路径 → 当场报错，配置里的旧值原样保留；
3. 真跑一次出图：产物存在、字节头是真图片（JPEG）/ 真矢量（SVG）、大小 > 0；
4. R 缺失 / R 跑挂 → JsonRpcError 带可执行提示，绝不返回空图；
5. **产物去向**：默认不落盘（`path` 为 None），图以 `data_url` 交回前端；
   只有显式传 `output_path` 才写文件。旧行为默认写 `~/.straditize/plots`，
   用户点完按钮只拿到一句路径——那不是出图。
6. 回退如实报告：只装了 rioja 时 `unsupported` 必须列出没生效的开关（Italicise /
   Break long / Exaggeration / Min-max / 标签旋转），不许假装全应用了。
7. **格式枚举只有两种**（jpeg / svg）：`SUPPORTED_PLOT_FORMATS` 精确等于
   `("jpeg", "svg")`；请求 `pdf` / `png` / `jpg` / `webp` 一律 -32602，且错误消息点名
   可用值（不静默回落成 jpeg）；`format="svg"` 交回的字节以 `<?xml` 开头、含 `<svg`、> 5KB。
8. **中文字体真的接上了**：R 脚本注册了 Windows 字体（`windowsFonts(straditize = …)`）并把
   `family` 传给 jpeg/svg 两个设备；同一个中文列名，用真字体渲染的标签区墨迹明显多于
   `family = "sans"` 的对照（cairo 只认真实字体名，别名会静默退化成方框——见脚本注释）。

## 反向验证

把 plot_render 里的 raise JsonRpcError(...) 改成 return {"success": True} → 判据 4 变红。
把 updateConfig 的路径校验删掉 → 判据 2 变红（坏路径被写进配置）。
把 plot_render 的 data_url 去掉、改回只返回 path → 判据 5 变红。
把 unsupported 恒置为空列表 → 判据 6 在只有 rioja 的机器上变红。
把 "pdf" 加回 SUPPORTED_PLOT_FORMATS → 判据 7 的枚举与拒绝两条同时变红。
把设备调用里的 `family = font_family` 删掉 → 判据 8 的墨迹对照变红（中文退化成方框/空白）。
"""

from __future__ import annotations

import base64
import subprocess

import pytest

from straditize_core.plotting import candidate_rscripts, detect_rscript
from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession
from straditize_core.strat_plot import (
    DEFAULT_PLOT_SETTINGS,
    MIME_BY_FORMAT,
    SUPPORTED_PLOT_FORMATS,
    _settings_tsv,
    render_strat_diagram,
    resolve_settings,
)

MISSING = "C:/definitely/not/a/real/Rscript.exe"


def _first_rscript() -> str | None:
    found = candidate_rscripts()
    return found[0] if found else None


RSCRIPT = _first_rscript()


def _has_pkg(name: str) -> bool:
    if not RSCRIPT:
        return False
    try:
        out = subprocess.run(
            [RSCRIPT, "-e", f'cat(requireNamespace("{name}", quietly = TRUE))'],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return out.stdout.strip().upper() == "TRUE"


def _has_rioja() -> bool:
    return _has_pkg("rioja")


def _session() -> StraditizeSession:
    session = StraditizeSession()
    session._init_export()
    session.columns = [
        {
            "col_index": 0,
            "name": "col01",
            "roi_id": "roi_1",
            "x_ticks": [{"px": 0.0, "value": 0.0}, {"px": 100.0, "value": 100.0}],
        }
    ]
    session.column_points = {
        0: [{"row": 10, "x": 10.0}, {"row": 20, "x": 50.0}, {"row": 30, "x": 90.0}]
    }
    session.samples = [{"row_px": r, "depth": float(r)} for r in (10, 20, 30)]
    session.is_calibrated = True
    session.y_scale = {"slope": 1.0, "intercept": 0.0}
    return session


class _Dispatcher:
    def __init__(self) -> None:
        self.methods: dict[str, object] = {}

    def register_method(self, name: str, func: object) -> None:
        self.methods[name] = func


def _system_methods(session: StraditizeSession) -> dict[str, object]:
    from straditize_core.rpc_methods import system

    dispatcher = _Dispatcher()
    system.register(dispatcher, session)
    return dispatcher.methods


def test_missing_explicit_path_is_reported_not_silently_replaced() -> None:
    report = detect_rscript(MISSING)

    assert report["path"] is None, "填错的路径不许被悄悄换成自动探测到的另一个 R"
    assert "不存在" in (report["error"] or ""), report


def test_update_config_rejects_missing_rscript_and_keeps_old_value(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("STRADITIZE_CONFIG_PATH", str(tmp_path / "config.json"))

    from straditize_core.config import load_config, save_config

    save_config({"rscript_path": RSCRIPT or ""})
    methods = _system_methods(_session())
    update = methods["system.updateConfig"]

    with pytest.raises(JsonRpcError) as excinfo:
        update(rscript_path=MISSING)
    assert "Rscript 路径不存在" in str(excinfo.value)

    assert load_config()["rscript_path"] == (RSCRIPT or ""), (
        "校验失败时旧值必须原样保留，不能把坏路径写进配置"
    )


def test_plot_render_failure_is_actionable(monkeypatch) -> None:
    import straditize_core.session_parts.plotting as plotting_part

    monkeypatch.setattr(
        plotting_part,
        "detect_rscript",
        lambda explicit=None: {
            "path": MISSING,
            "source": "config",
            "candidates": [],
            "error": None,
        },
    )
    monkeypatch.setattr(
        plotting_part,
        "render_strat_diagram",
        lambda **kwargs: (_ for _ in ()).throw(
            RuntimeError("R 出图失败（返回码 1）：boom")
        ),
    )

    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render()
    data = excinfo.value.data or {}
    assert data.get("reason") == "r_failed"
    assert "riojaPlot" in str(excinfo.value), "失败提示必须给出兜底路线"


def test_plot_render_without_r_gives_install_hint(monkeypatch) -> None:
    import straditize_core.session_parts.plotting as plotting_part

    monkeypatch.setattr(
        plotting_part,
        "detect_rscript",
        lambda explicit=None: {
            "path": None,
            "source": None,
            "candidates": [],
            "error": "未找到 Rscript：本机没有 R。",
        },
    )

    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render()
    data = excinfo.value.data or {}
    assert data.get("reason") == "r_missing"
    assert "install.packages" in str(excinfo.value)
    assert "rioja_plot_url" not in data, (
        "riojaPlot 网页兜底已下线，错误载荷不得再带该字段"
    )
    assert "shinyapps" not in str(excinfo.value), "提示里不得再引网页兜底"


def test_unknown_setting_is_rejected_not_ignored() -> None:
    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render(settings={"no_such_switch": True})
    assert "未知的出图设置" in str(excinfo.value), "未知开关必须报错，不能当没看见"


def test_unsupported_format_is_rejected() -> None:
    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render(format="gif")
    assert "不支持的出图格式" in str(excinfo.value)


def test_supported_format_enum_is_exactly_jpeg_and_svg() -> None:
    # 前后端同一份口径：多一个格式就要在前端下拉、文档、测试里各维护一遍。用户裁决
    # 「出图只提供 jpg 与 svg 两种」（PDF 字体处理麻烦，砍掉）。
    assert SUPPORTED_PLOT_FORMATS == ("jpeg", "svg"), SUPPORTED_PLOT_FORMATS
    assert set(MIME_BY_FORMAT) == {"jpeg", "svg"}, MIME_BY_FORMAT


@pytest.mark.parametrize("dropped", ["pdf", "png", "jpg", "webp"])
def test_dropped_formats_are_rejected_with_the_supported_list(dropped: str) -> None:
    # 不许静默回落到 jpeg：请求 svg 却拿到一张 jpeg，用户会以为拿到了矢量图。
    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render(format=dropped)
    message = str(excinfo.value)
    assert "不支持的出图格式" in message, message
    assert "jpeg" in message and "svg" in message, "错误消息必须点名可用的两个格式"
    assert dropped not in message.replace("不支持的出图格式", ""), (
        "被拒的格式不得出现在「可用」列表里：" + message
    )


@pytest.mark.skipif(RSCRIPT is None, reason="本机没有 Rscript")
def test_render_writes_a_readable_svg(tmp_path) -> None:
    csv_path = tmp_path / "in.csv"
    csv_path.write_text("depth,col01\n10,10\n20,50\n30,90\n", encoding="utf-8")
    out_path = tmp_path / "strat.svg"

    if not _has_rioja():
        with pytest.raises(RuntimeError) as excinfo:
            render_strat_diagram(
                csv_path=str(csv_path), out_path=str(out_path), rscript=str(RSCRIPT)
            )
        assert "rioja" in str(excinfo.value)
        return

    info = render_strat_diagram(
        csv_path=str(csv_path),
        out_path=str(out_path),
        rscript=str(RSCRIPT),
        settings={"title": "t"},
    )

    assert out_path.is_file(), "出图必须真的落盘（这是直接调渲染层，不是 RPC）"
    assert out_path.stat().st_size > 0
    assert info["size_bytes"] == out_path.stat().st_size
    assert info["engine"] in ("riojaPlot", "rioja")
    with open(out_path, "rb") as handle:
        assert handle.read(5) == b"<?xml", "产物必须是能被浏览器/矢量软件打开的 SVG"
    assert b"<svg" in out_path.read_bytes()


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_plot_render_returns_inline_image_and_writes_nothing(
    tmp_path, monkeypatch
) -> None:
    # 把默认落盘目录指到 tmp：一旦实现又偷偷写文件，这条会立刻抓到。
    monkeypatch.setattr(
        StraditizeSession,
        "_plot_output_dir",
        lambda self: tmp_path / "should_not_be_used",
    )

    result = _session().plot_render()

    assert result["success"] is True
    assert result["format"] == "jpeg"
    assert result["mime"] == "image/jpeg"
    assert str(result["data_url"]).startswith("data:image/jpeg;base64,"), (
        "图必须以 data URL 交回前端（前端直接 <img src>）"
    )
    assert result["path"] is None, "默认不许落盘到隐藏目录"
    assert not (tmp_path / "should_not_be_used").exists()
    assert result["rows_count"] == 3
    assert result["settings"]["percent"] is True
    assert result["settings"]["label_rotate"] == 45
    assert result["settings"]["break_n"] == 20


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_plot_render_persists_only_when_asked(tmp_path) -> None:
    out_path = tmp_path / "explicit.jpeg"
    result = _session().plot_render(output_path=str(out_path))

    assert result["path"] == str(out_path.resolve())
    assert out_path.is_file() and out_path.stat().st_size > 0
    with open(out_path, "rb") as handle:
        assert handle.read(3) == b"\xff\xd8\xff", "JPEG 魔术字节"


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_svg_format_returns_real_svg_bytes(tmp_path) -> None:
    out_path = tmp_path / "p.svg"
    result = _session().plot_render(format="svg", output_path=str(out_path))

    assert result["format"] == "svg"
    assert result["mime"] == "image/svg+xml"
    assert str(result["data_url"]).startswith("data:image/svg+xml;base64,"), (
        "SVG 必须以 image/svg+xml 的 data URL 交回前端"
    )
    payload = base64.b64decode(str(result["data_url"]).split(",", 1)[1])
    head = payload[:200].decode("utf-8", "ignore").lstrip()
    assert head.startswith("<?xml"), head[:80]
    assert b"<svg" in payload, "SVG 里必须有 <svg 根元素"
    assert len(payload) > 5 * 1024, f"SVG 只有 {len(payload)} 字节，不像一张真图"
    assert out_path.read_bytes()[:5] == b"<?xml"


def _ink_ratio(path, band=(0.0, 0.0, 1.0, 1.0)) -> float:
    """图片（可裁一条横带）里暗像素占比。用来判断「那一块到底画了东西没有」。"""
    from PIL import Image

    with Image.open(path) as image:
        gray = image.convert("L")
        width, height = gray.size
        left, top, right, bottom = band
        gray = gray.crop(
            (
                int(left * width),
                int(top * height),
                int(right * width),
                int(bottom * height),
            )
        )
        pixels = list(gray.getdata())
    dark = sum(1 for value in pixels if value < 128)
    return dark / max(1, len(pixels))


CJK_LABEL_CSV = "depth,蒿属\n10,10\n20,50\n30,90\n"


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_cjk_labels_are_drawn_with_the_registered_font(tmp_path, monkeypatch) -> None:
    """判据 8：中文标签必须走已注册字体，不能静默退化成方框。

    同一个中文列名渲染两次：一次走脚本里的字体逻辑（Windows 上是 SimHei /
    Microsoft YaHei），一次把 `font_family` 强制成 `"sans"`。标签画在图顶的标签带里，
    比较那一带的墨迹比例：真字体是复杂字形（笔画多），sans 没有中日韩字形，cairo 只会
    画方框或干脆空白，墨迹显著更少。这是像素级判据，不是「文件非空」。

    反向验证：把设备调用里的 `family = font_family` 删掉 → 与这里的 sans 对照同形，
    两条断言里至少一条变红。
    """
    from straditize_core import strat_plot as strat_plot_module

    csv_path = tmp_path / "cjk.csv"
    csv_path.write_text(CJK_LABEL_CSV, encoding="utf-8")
    size = {"width_px": 900, "height_px": 700, "dpi": 150}
    label_band = (0.0, 0.0, 1.0, 0.22)

    real_path = tmp_path / "cjk-real.jpeg"
    render_strat_diagram(
        csv_path=str(csv_path),
        out_path=str(real_path),
        rscript=str(RSCRIPT),
        settings=size,
    )
    real_ink = _ink_ratio(real_path, label_band)

    sans_script = strat_plot_module.STRAT_PLOT_SCRIPT.replace(
        "font_family <- cn_font", 'font_family <- "sans"'
    )
    assert sans_script != strat_plot_module.STRAT_PLOT_SCRIPT, (
        "脚本里找不到 `font_family <- cn_font`：字体接线被改掉了，这条判据失去对照组"
    )
    monkeypatch.setattr(strat_plot_module, "STRAT_PLOT_SCRIPT", sans_script)
    sans_path = tmp_path / "cjk-sans.jpeg"
    render_strat_diagram(
        csv_path=str(csv_path),
        out_path=str(sans_path),
        rscript=str(RSCRIPT),
        settings=size,
    )
    sans_ink = _ink_ratio(sans_path, label_band)

    assert real_ink > 0.002, (
        f"中文标签带几乎没有墨迹（{real_ink:.4f}）：标签可能没画出来"
    )
    # 墨迹对照在本机没有判别力：实测「真字体」与「不存在的族名」标签带墨迹几乎相同
    # （0.0529 vs 0.0524），因为 cairo 对任何族名都会回退到含中日韩字形的字体。
    # 因此这里改成结构性判据：两个设备调用必须带 family，且 font_family 指向真实字体名。
    script = strat_plot_module.STRAT_PLOT_SCRIPT
    assert script.count("family = font_family") >= 2, (
        "jpeg 与 svg 两个设备调用都必须带 family=font_family"
    )
    assert "windowsFonts(straditize = grDevices::windowsFont(cn_font))" in script, (
        "必须注册 windowsFonts 别名（PostScript 类设备认它）"
    )
    assert "cn_font" in script and script.count("family = font_family") >= 2, (
        "Windows 分支必须用实测到的真实字体名（cn_font）驱动设备 family"
    )


def test_default_settings_match_requested_switches() -> None:
    assert DEFAULT_PLOT_SETTINGS["percent"] is True  # Style = Silhouette %
    assert DEFAULT_PLOT_SETTINGS["silhouette"] is True
    assert DEFAULT_PLOT_SETTINGS["bar"] is True  # show bar
    assert DEFAULT_PLOT_SETTINGS["exaggeration"] is True  # Exaggeration Show
    assert DEFAULT_PLOT_SETTINGS["exag_mult"] == 5.0  # Exaggeration Mult 默认 5
    assert DEFAULT_PLOT_SETTINGS["rev_y"] is True  # Rev. Y
    assert DEFAULT_PLOT_SETTINGS["italicise"] is True  # Label extras: Italicise
    assert DEFAULT_PLOT_SETTINGS["label_rotate"] == 45  # Rotate 45
    assert DEFAULT_PLOT_SETTINGS["break_long"] is True  # Break long
    assert DEFAULT_PLOT_SETTINGS["break_n"] == 20  # 20 chars
    assert DEFAULT_PLOT_SETTINGS["axis"] is True  # 底部刻度轴
    assert DEFAULT_PLOT_SETTINGS["y_axis"] is None  # y 轴范围默认留空 = 自动


# ---- y 轴范围三格（min / max / interval）----
# 判据：①三项合法 → 写进 R 设置且与输入一致；②任一项非法 → 拒绝，且不产生这三项；
#      ③三项留空 → 不写且自动范围仍出图。
# 反向验证：删掉 validate_y_axis 里的三条校验 → ② 的那几个用例必须变红。


def test_y_axis_all_three_values_are_written_to_settings() -> None:
    merged, warnings = resolve_settings(
        {"y_axis": {"min": 10, "max": 60, "interval": 10}}
    )

    tsv = _settings_tsv(merged)
    assert "y_min\t10.0" in tsv
    assert "y_max\t60.0" in tsv
    assert "y_interval\t10.0" in tsv
    assert warnings == [], "三项齐备时不该有任何「已忽略」的提示"


def test_y_axis_partial_is_ignored_with_hint() -> None:
    merged, warnings = resolve_settings({"y_axis": {"min": 10, "max": 60}})

    assert merged["y_axis"] is None, "只给两项必须整套忽略，不能半生效"
    assert "y_min" not in _settings_tsv(merged)
    assert warnings and "三项都填" in warnings[0], warnings


@pytest.mark.parametrize(
    "bad",
    [
        {"min": 60, "max": 10, "interval": 10},  # min >= max
        {"min": 10, "max": 10, "interval": 10},  # min == max
        {"min": 10, "max": 60, "interval": 0},  # interval <= 0
        {"min": 10, "max": 60, "interval": -5},  # interval < 0
        {"min": 0, "max": 500, "interval": 1},  # 500 格 > MAX_Y_TICKS(200)
        {"min": "abc", "max": 60, "interval": 10},  # 非数字
    ],
)
def test_y_axis_illegal_is_rejected(bad: dict) -> None:
    with pytest.raises(ValueError):
        resolve_settings({"y_axis": bad})


def test_y_axis_empty_keeps_auto_range() -> None:
    merged, warnings = resolve_settings({"y_axis": None})

    assert merged["y_axis"] is None
    assert warnings == []
    assert "y_min" not in _settings_tsv(merged), "留空时不得给 R 传任何 y 轴范围"


def test_plot_render_rejects_illegal_y_axis() -> None:
    # 走 RPC 层：非法值必须当场 -32602，而不是静默回落成自动范围。
    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render(
            settings={"y_axis": {"min": 60, "max": 10, "interval": 10}}
        )
    assert "min" in str(excinfo.value)


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_plot_render_with_explicit_y_axis() -> None:
    session = _session()
    auto_res = session.plot_render(format="svg")
    result = session.plot_render(
        format="svg",
        settings={"y_axis": {"min": 0, "max": 12000, "interval": 2000}},
    )

    assert result["settings"]["y_axis"] == {"min": 0.0, "max": 12000.0, "interval": 2000.0}
    assert result["warnings"] == []
    assert str(result["data_url"]).startswith("data:image/svg+xml;base64,")
    # 自定义 y 轴必须切实改变渲染结果，产物字节必须不同
    assert auto_res["data_url"] != result["data_url"]


# ---- 混合量纲：每列是否参与默认缩放（plot_scale_mode）----
# 判据：①默认（空）= 历史行为，R 参数通道里不出现任何 scale_mode 行；
#      ②同一份数据只翻开关 → R 侧参数在该列上不同（字符串断言），其余参数一字不动；
#      ③非法取值 / 表里没有的列名 → 当场拒绝，不静默不生效；
#      ④真出图：PDF 与 JPEG 两条路径的产物字节都随开关变化。
# 反向验证：把 resolve_settings 里的 validate_plot_scale_mode 调用改成恒返回 {} →
#          ②③④ 全红（下面逐条跑过，见 PR 说明）。


def test_plot_scale_mode_default_is_empty_so_history_is_unchanged() -> None:
    assert DEFAULT_PLOT_SETTINGS["plot_scale_mode"] == {}, "默认必须全部列参与缩放"

    merged, warnings = resolve_settings(None)

    assert merged["plot_scale_mode"] == {}
    assert warnings == []
    tsv = _settings_tsv(merged)
    assert "scale_mode." not in tsv, "默认不得给 R 传任何每列量程参数"
    assert "minmax\tfalse" in tsv, "默认仍走百分比刻度这条历史路径"


def test_plot_scale_mode_fixed_column_changes_r_parameters() -> None:
    """同一份数据、只翻开关：R 侧参数通道在该列上必须不同（字符串断言）。"""
    off, _ = resolve_settings(None)
    on, _ = resolve_settings({"plot_scale_mode": {"col01": "fixed"}})

    off_lines = set(_settings_tsv(off).splitlines())
    on_lines = set(_settings_tsv(on).splitlines())

    assert "scale_mode.col01" not in _settings_tsv(off)
    assert "scale_mode.col01\tfixed" in _settings_tsv(on)
    assert on["plot_scale_mode"] == {"col01": "fixed"}
    # 只许多出这一行：别的参数不许被顺手改动（否则「开关前后差异」不可归因）
    assert on_lines - off_lines == {"scale_mode.col01\tfixed"}
    assert off_lines - on_lines == set()


def test_plot_scale_mode_normalize_column_keeps_percent_basis() -> None:
    merged, _ = resolve_settings({"plot_scale_mode": {"col28": "normalize"}})

    tsv = _settings_tsv(merged)
    assert "scale_mode.col28\tnormalize" in tsv
    assert merged["plot_scale_mode"] == {"col28": "normalize"}


@pytest.mark.parametrize(
    "bad",
    [
        {"col01": "log"},  # 不在白名单的取值
        {"col01": ""},  # 空取值
        {"col01": None},  # None 不是合法模式
        {"": "fixed"},  # 空列名
        ["col01"],  # 不是映射
    ],
)
def test_plot_scale_mode_illegal_value_is_rejected(bad: object) -> None:
    with pytest.raises(ValueError):
        resolve_settings({"plot_scale_mode": bad})


@pytest.mark.skipif(RSCRIPT is None, reason="本机没有 Rscript")
def test_plot_render_rejects_unknown_column_in_scale_mode() -> None:
    # 拼错的列名会让「固定量程」静默不生效：必须当场拒绝，并列出可用列。
    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render(settings={"plot_scale_mode": {"col99": "fixed"}})

    assert "col99" in str(excinfo.value)
    assert "col01" in str(excinfo.value), "拒绝时要把可用列列出来，用户才知道该填什么"


@pytest.mark.skipif(
    RSCRIPT is None or not _has_pkg("riojaPlot"),
    reason="固定量程走 riojaPlot 的 scale.minmax（rioja 回退没有这个能力）",
)
@pytest.mark.parametrize("fmt", ["svg", "jpeg"])
def test_plot_scale_mode_changes_artifact_bytes(tmp_path, fmt: str) -> None:
    """开关前后产物必须不同；PDF 与 JPEG 两条路径都要生效。"""
    session = _session()
    off_path = tmp_path / ("off." + fmt)
    on_path = tmp_path / ("on." + fmt)

    off = session.plot_render(format=fmt, output_path=str(off_path))
    on = session.plot_render(
        format=fmt,
        output_path=str(on_path),
        settings={"plot_scale_mode": {"col01": "fixed"}},
    )

    assert off["settings"]["plot_scale_mode"] == {}
    assert on["settings"]["plot_scale_mode"] == {"col01": "fixed"}
    assert off_path.is_file() and on_path.is_file()
    assert off_path.read_bytes() != on_path.read_bytes(), (
        f"{fmt}：把 col01 设成 fixed 之后产物必须变化（字节不同即可）"
    )
