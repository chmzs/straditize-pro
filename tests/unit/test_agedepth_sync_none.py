"""#207：`agedepth.syncToSamples` 在 mapped_samples 含 None 时不得整批崩。

判据（可判定）：
1. 含 `None` 的行被**跳过**，不抛 `TypeError`；
2. 返回体里给出 `skipped_rows`（1-based 行号）与 `warning` 文本；
3. 有值的行**照常回写**（不能因为个别缺值就一行不写）。
"""

from __future__ import annotations

from straditize_core.session import StraditizeSession


def _session_with_one_sample() -> StraditizeSession:
    session = StraditizeSession()
    session.samples = [
        {"horizon_id": "H0001", "row_px": 100, "depth": 10.0, "source": "manual"},
    ]
    return session


def test_sync_skips_none_rows_and_reports_them() -> None:
    session = _session_with_one_sample()
    mapped = {
        "depths": [10.0, None, 30.0],
        "age_est": [1000.0, 2000.0, None],
        "horizon_id": ["H0001", "H0002", "H0003"],
    }

    result = session.agedepth_sync_to_samples(mapped) if hasattr(session, "agedepth_sync_to_samples") else session.sync_to_samples(mapped)

    # 1 + 3：不抛异常，且有值的那一行（depth=10.0, age=1000.0）必须真的写回
    assert isinstance(result, dict), result
    written = session.samples or []
    assert any(
        abs(float(s.get("depth") or -1) - 10.0) < 1e-9 for s in written
    ), f"有值的行未被回写：{written[:3]}"

    # 2：缺值行必须被报出来（1-based）
    assert result.get("skipped_rows") == [2, 3], result.get("skipped_rows")
    warning = str(result.get("warning") or "")
    assert "2" in warning and "3" in warning, warning
