"""E2E test verifying Step 8 QA verification panel, geological gates, and diagnostics grammar."""

from __future__ import annotations

import json
import pytest

from tests.e2e.conftest import run_playwright_eval


def test_qa_panel_and_diagnostics_l4(e2e_server):
    """Verify Step 8 panel renders with diagnostics banner and outputs L4 grammar."""
    url = e2e_server["url"]
    session = e2e_server["session"]

    # Prepare standard L4 geological test horizons on the session
    # 76 horizons: 2 empty horizons, 1 peak horizon Σ=103.2, 73 valid horizons ensuring mean shortfall exactly 4.0
    target_sums = [96.0] * 72 + [92.0, 103.2, 0.0, 0.0]
    assert len(target_sums) == 76

    roi_res = session.roi_create(name="pollen", composition=True)
    roi_id = roi_res["roi"]["id"]

    session.columns = [
        {
            "col_index": 0,
            "name": "Pinus",
            "roi_id": roi_id,
            "start": 100.0,
            "end": 200.0,
            "startX": 100.0,
            "endX": 200.0,
            "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 200.0, "value": 100.0}],
            "scale_type": "linear",
        }
    ]

    col_pts = []
    samples = []
    for idx, s in enumerate(target_sums):
        r_px = 100 + idx * 5
        # x coordinate in pixels corresponding to value s: 100 + s
        col_pts.append({"row": r_px, "x": 100.0 + s})
        samples.append({"row_px": r_px, "depth": float(idx * 2), "source": "auto"})

    session.column_points = {0: col_pts}
    session.samples = samples

    js_code = """
      return (async () => {
        // Switch to Step 8 (校验)
        const step8Btn = document.querySelector('.workflow-step-btn[data-step="8"]');
        if (step8Btn) {
          step8Btn.click();
        }

        // Wait a short moment and click re-run QA button
        await new Promise(r => setTimeout(r, 400));
        const runQaBtn = document.querySelector('#btn-run-qa');
        if (runQaBtn) {
          runQaBtn.click();
        }

        // Allow async RPC to settle
        await new Promise(r => setTimeout(r, 800));

        const panel = document.querySelector('.step-panel[data-step="8"]');
        const banner = document.querySelector('#qa-banner');
        const nHorizonsEl = document.querySelector('#qa-n-horizons');
        const sumMaxEl = document.querySelector('#qa-sum-max');
        const shortfallMeanEl = document.querySelector('#qa-shortfall-mean');
        const nEmptyEl = document.querySelector('#qa-n-empty');

        return JSON.stringify({
          panel_present: panel ? 'present' : 'absent',
          banner_level: banner ? banner.getAttribute('data-level') : 'none',
          n_horizons: nHorizonsEl ? nHorizonsEl.textContent.trim() : '0',
          sum_max: sumMaxEl ? sumMaxEl.textContent.trim() : '0',
          shortfall_mean: shortfallMeanEl ? shortfallMeanEl.textContent.trim() : '0',
          n_empty: nEmptyEl ? nEmptyEl.textContent.trim() : '0',
        });
      })();
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_qa")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(f"QA evaluation failed to return valid JSON: {res_str} ({e})")

    # Print L4 frozen grammar (§0.5.4)
    print(f"\nBANNER_LEVEL={data['banner_level']}")
    print(f"N_HORIZONS={data['n_horizons']}")
    print(f"SUM_MAX={data['sum_max']}")
    print(f"SHORTFALL_MEAN={data['shortfall_mean']}")
    print(f"N_EMPTY={data['n_empty']}")

    assert data["panel_present"] == "present", "QA step panel must be present on Step 8"
    assert data["banner_level"] == "red", (
        "Banner level must be red for composition violations"
    )
    assert data["n_horizons"] == "76", "Total horizons count must be 76"
    assert data["sum_max"] == "103.2", "Max sum must be 103.2"
    assert data["shortfall_mean"] == "4.0", "Mean shortfall must be 4.0"
    assert data["n_empty"] == "2", "Empty horizons count must be 2"
