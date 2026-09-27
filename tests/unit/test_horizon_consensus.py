import numpy as np
from straditize_core.session import StraditizeSession

def test_extract_horizon_consensus_on_synthetic_curves():
    sess = StraditizeSession()
    sess.columns = [
        {"id": "col_0", "col_index": 0, "start": 10.0, "end": 100.0, "name": "Taxa_A"},
        {"id": "col_1", "col_index": 1, "start": 120.0, "end": 200.0, "name": "Taxa_B"},
    ]
    # Both taxa have sharp turning points at rows 50, 120, 200
    rows = np.arange(0, 300)
    pts_a = [{"row": int(r), "x": 10.0 + 20.0 * np.exp(-((r - 50) / 10)**2) + 30.0 * np.exp(-((r - 200) / 15)**2)} for r in rows]
    pts_b = [{"row": int(r), "x": 120.0 + 15.0 * np.exp(-((r - 50) / 8)**2) + 25.0 * np.exp(-((r - 120) / 12)**2)} for r in rows]
    sess.column_points = {0: pts_a, 1: pts_b}

    res = sess.extract_horizon_consensus(tolerance_px=3.0, min_taxa_support=1)
    assert res["horizons_count"] >= 3
    found_rows = res["pixel_y"]
    assert any(abs(r - 50) <= 2 for r in found_rows)
    assert any(abs(r - 120) <= 2 for r in found_rows)
    assert any(abs(r - 200) <= 2 for r in found_rows)
