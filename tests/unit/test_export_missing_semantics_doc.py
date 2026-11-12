"""工程包说明文字的判据：缺测语义必须区分"窗口内 0.0"与"整列 NA"。

缺陷背景：README 曾写「In data.csv, unobserved taxa are strictly 0.0 (never NA)」。
这句话把两件不同的事混成一句：
  - 列取数窗口**内**没有可读像素 → 0.0（真实的零丰度）；
  - 从未数字化 / 未做 X 标定的列 → NA（没有数据）。
用户照着"never NA"去理解，会把"没测到"当成"测到 0"，进而把百分比与对数变换全算错。

本判据只钉文案，不钉数据：数据侧的两条语义已由
`test_export_missing_row_semantics` / `test_uncalibrated_column_is_null_in_every_export` 覆盖。
"""

from __future__ import annotations

from pathlib import Path

from straditize_core.session_parts.project import CSV_MISSING_NOTICE

_REPO = Path(__file__).resolve().parents[2]


def test_notice_states_both_semantics() -> None:
    text = CSV_MISSING_NOTICE.decode("utf-8")
    # 必须讲清"窗口内 = 真零"
    assert "0.0" in text and "true zero" in text, text
    # 必须讲清"整列 = NA，且不是 0"
    assert "NA" in text and "NO DATA" in text, text
    # 必须给出下游操作建议，否则用户仍会踩对数的坑
    assert "pseudocount" in text, text


def test_notice_does_not_claim_never_na() -> None:
    """不允许再出现"永不 NA"这种把两种语义抹平的断言。"""
    text = CSV_MISSING_NOTICE.decode("utf-8").lower()
    assert "never na" not in text, text
    assert "strictly 0.0" not in text, text


def test_xlsx_readme_does_not_claim_never_na() -> None:
    """XLSX 的 readme 页与 tar 的 README.txt 必须同一口径（源码级防回归）。"""
    src = (_REPO / "straditize_core" / "metadata" / "exporter_xlsx.py").read_text(encoding="utf-8")
    executable = [ln for ln in src.splitlines() if not ln.lstrip().startswith("#")]
    offenders = [ln for ln in executable if "never NA" in ln or "strictly filled as 0.00" in ln]
    assert not offenders, offenders
