"""一键画图（本机 R + rioja）：探测、路径校验、真实出图、失败提示。

## 判据

1. 显式配置了不存在的 Rscript 路径 → 探测失败并说明缺什么（不静默回退到别的 R）；
2. system.updateConfig 填不存在的路径 → 当场报错，配置里的旧值原样保留；
3. 真跑一次出图：产物存在、能被 PDF 读器打开（%PDF 头）、大小 > 0；
4. R 缺失 / R 跑挂 → JsonRpcError 带可执行提示（安装 R、装 rioja，或改用 riojaPlot 网页），
   绝不返回空图。

## 反向验证

把 plot_render 里的 raise JsonRpcError(...) 改成 return {"success": True} → 判据 4 变红。
把 updateConfig 的路径校验删掉 → 判据 2 变红（坏路径被写进配置）。
"""

from __future__ import annotations

import subprocess

import pytest

from straditize_core.plotting import candidate_rscripts, detect_rscript, render_with_rioja
from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

MISSING = "C:/definitely/not/a/real/Rscript.exe"


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
        "render_with_rioja",
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


@pytest.mark.skipif(RSCRIPT is None, reason="本机没有 Rscript")
def test_render_writes_a_readable_pdf(tmp_path) -> None:
    csv_path = tmp_path / "in.csv"
    csv_path.write_text("depth,col01\n10,10\n20,50\n30,90\n", encoding="utf-8")
    out_path = tmp_path / "strat.pdf"

    if not _has_rioja():
        with pytest.raises(RuntimeError) as excinfo:
            render_with_rioja(
                csv_path=str(csv_path), out_path=str(out_path), rscript=str(RSCRIPT)
            )
        assert "rioja" in str(excinfo.value)
        return

    info = render_with_rioja(
        csv_path=str(csv_path), out_path=str(out_path), rscript=str(RSCRIPT), title="t"
    )

    assert out_path.is_file(), "出图必须真的落盘"
    assert out_path.stat().st_size > 0
    assert info["size_bytes"] == out_path.stat().st_size
    with open(out_path, "rb") as handle:
        assert handle.read(5) == b"%PDF-", "产物必须是能被 PDF 读器打开的 PDF"


@pytest.mark.skipif(RSCRIPT is None or not _has_rioja(), reason="本机没有 R + rioja")
def test_plot_render_end_to_end(tmp_path) -> None:
    out_path = tmp_path / "e2e.pdf"
    result = _session().plot_render(output_path=str(out_path))

    assert result["success"] is True
    assert result["engine"] == "rioja"
    assert result["rows_count"] == 3
    assert out_path.is_file() and out_path.stat().st_size > 0
