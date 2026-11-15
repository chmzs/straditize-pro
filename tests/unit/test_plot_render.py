"""一键画图（本机 R + riojaPlot/rioja）：探测、路径校验、真出图、失败提示、产物去向。

## 判据

1. 显式配置了不存在的 Rscript 路径 → 探测失败并说明缺什么（不静默回退到别的 R）；
2. system.updateConfig 填不存在的路径 → 当场报错，配置里的旧值原样保留；
3. 真跑一次出图：产物存在、字节头是真图片（JPEG/PNG）、大小 > 0；
4. R 缺失 / R 跑挂 → JsonRpcError 带可执行提示，绝不返回空图；
5. **产物去向**：默认不落盘（`path` 为 None），图以 `data_url` 交回前端；
   只有显式传 `output_path` 才写文件。旧行为默认写 `~/.straditize/plots`，
   用户点完按钮只拿到一句路径——那不是出图。
6. 回退如实报告：只装了 rioja 时 `unsupported` 必须列出没生效的开关（Italicise /
   Break long / Exaggeration / Min-max / 标签旋转），不许假装全应用了。

## 反向验证

把 plot_render 里的 raise JsonRpcError(...) 改成 return {"success": True} → 判据 4 变红。
把 updateConfig 的路径校验删掉 → 判据 2 变红（坏路径被写进配置）。
把 plot_render 的 data_url 去掉、改回只返回 path → 判据 5 变红。
把 unsupported 恒置为空列表 → 判据 6 在只有 rioja 的机器上变红。
"""

from __future__ import annotations

import subprocess

import pytest

from straditize_core.plotting import candidate_rscripts, detect_rscript
from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession
from straditize_core.strat_plot import DEFAULT_PLOT_SETTINGS, render_strat_diagram

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


def test_update_config_rejects_missing_rscript_and_keeps_old_value(tmp_path, monkeypatch) -> None:
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
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("R 出图失败（返回码 1）：boom")),
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
    assert str(data.get("rioja_plot_url", "")).startswith("https://")


def test_unknown_setting_is_rejected_not_ignored() -> None:
    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render(settings={"no_such_switch": True})
    assert "未知的出图设置" in str(excinfo.value), "未知开关必须报错，不能当没看见"


def test_unsupported_format_is_rejected() -> None:
    with pytest.raises(JsonRpcError) as excinfo:
        _session().plot_render(format="gif")
    assert "不支持的出图格式" in str(excinfo.value)


@pytest.mark.skipif(RSCRIPT is None, reason="本机没有 Rscript")
def test_render_writes_a_readable_pdf(tmp_path) -> None:
    csv_path = tmp_path / "in.csv"
    csv_path.write_text("depth,col01\n10,10\n20,50\n30,90\n", encoding="utf-8")
    out_path = tmp_path / "strat.pdf"

    if not _has_rioja():
        with pytest.raises(RuntimeError) as excinfo:
            render_strat_diagram(
                csv_path=str(csv_path), out_path=str(out_path), rscript=str(RSCRIPT)
            )
        assert "rioja" in str(excinfo.value)
        return

    info = render_strat_diagram(
        csv_path=str(csv_path), out_path=str(out_path), rscript=str(RSCRIPT), settings={"title": "t"}
    )

    assert out_path.is_file(), "出图必须真的落盘（这是直接调渲染层，不是 RPC）"
    assert out_path.stat().st_size > 0
    assert info["size_bytes"] == out_path.stat().st_size
    assert info["engine"] in ("riojaPlot", "rioja")
    with open(out_path, "rb") as handle:
        assert handle.read(5) == b"%PDF-", "产物必须是能被 PDF 读器打开的 PDF"


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_plot_render_returns_inline_image_and_writes_nothing(tmp_path, monkeypatch) -> None:
    # 把默认落盘目录指到 tmp：一旦实现又偷偷写文件，这条会立刻抓到。
    monkeypatch.setattr(
        StraditizeSession, "_plot_output_dir", lambda self: tmp_path / "should_not_be_used"
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
def test_png_format_is_supported(tmp_path) -> None:
    result = _session().plot_render(format="png", output_path=str(tmp_path / "p.png"))
    assert result["mime"] == "image/png"
    assert str(result["data_url"]).startswith("data:image/png;base64,")


def test_default_settings_match_requested_switches() -> None:
    assert DEFAULT_PLOT_SETTINGS["percent"] is True       # Style = Silhouette %
    assert DEFAULT_PLOT_SETTINGS["silhouette"] is True
    assert DEFAULT_PLOT_SETTINGS["bar"] is True            # show bar
    assert DEFAULT_PLOT_SETTINGS["exaggeration"] is True   # Exaggeration Show
    assert DEFAULT_PLOT_SETTINGS["rev_y"] is True          # Rev. Y
    assert DEFAULT_PLOT_SETTINGS["italicise"] is True      # Label extras: Italicise
    assert DEFAULT_PLOT_SETTINGS["label_rotate"] == 45     # Rotate 45
    assert DEFAULT_PLOT_SETTINGS["break_long"] is True     # Break long
    assert DEFAULT_PLOT_SETTINGS["break_n"] == 20          # 20 chars
    assert DEFAULT_PLOT_SETTINGS["axis"] is True           # 底部刻度轴

