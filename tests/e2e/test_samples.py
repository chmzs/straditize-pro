"""E2E test verifying Step 7 samples panel, consensus extraction button, and clear action."""

from __future__ import annotations

import json
import pytest

from tests.e2e.conftest import run_playwright_eval


def test_samples_panel_and_controls(e2e_server):
    """Verify Step 7 panel renders with consensus extraction button and horizon list."""
    url = e2e_server["url"]

    js_code = """
      return (async () => {
        // Wait for app to be ready
        for (let i = 0; i < 30; i++) {
          if (window.__straditize || document.querySelector('.workflow-step-btn[data-step="7"]')) break;
          await new Promise(r => setTimeout(r, 100));
        }

        if (window.__straditize) {
          await window.__straditize.gotoStage(7);
        } else {
          const step7Btn = document.querySelector('.workflow-step-btn[data-step="7"]');
          if (step7Btn) step7Btn.click();
        }

        for (let i = 0; i < 30; i++) {
          if (document.querySelector('.step-panel[data-step="7"]')) break;
          await new Promise(r => setTimeout(r, 100));
        }

        const panel = document.querySelector('.step-panel[data-step="7"]');
        const consensusBtn = document.querySelector('#btn-extract-consensus');
        const clearBtn = document.querySelector('#btn-clear-horizons');
        const nextBtn = document.querySelector('#btn-apply-samples-next');

        return JSON.stringify({
          panel_present: panel ? 'present' : 'absent',
          consensus_btn: consensusBtn ? 'present' : 'absent',
          clear_btn: clearBtn ? 'present' : 'absent',
          next_btn: nextBtn ? 'present' : 'absent',
        });
      })();
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_samples")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(f"Samples evaluation failed to return valid JSON: {res_str} ({e})")

    # Print L4 frozen grammar
    print(f"\nSAMPLES_PANEL={data['panel_present']}")
    print(f"CONSENSUS_EXTRACT_BUTTON={data['consensus_btn']}")
    print(f"CLEAR_HORIZONS_BUTTON={data['clear_btn']}")
    print(f"NEXT_STEP_BUTTON={data['next_btn']}")

    assert data["panel_present"] == "present", "Samples step panel must be present on Step 7"
    assert data["consensus_btn"] == "present", "Consensus extraction button must be present"
    assert data["clear_btn"] == "present", "Clear horizons button must be present"
    assert data["next_btn"] == "present", "Next step button must be present"
