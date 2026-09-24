"""E2E test verifying Step 6 XTicks calibration panel and interaction controls."""

from __future__ import annotations

import json
import pytest

from tests.e2e.conftest import run_playwright_eval


def test_xticks_panel_and_controls(e2e_server):
    """Verify Step 6 panel renders with automatic extraction button and x_ticks fact section."""
    url = e2e_server["url"]

    js_code = """
      // Switch to Step 6 (标定列)
      const step6Btn = document.querySelector('.workflow-step-btn[data-step="6"]');
      if (step6Btn) {
        step6Btn.click();
      }

      const panel = document.querySelector('.step-panel[data-step="6"]');
      const detectBtn = document.querySelector('#btn-detect-xticks');
      const nextBtn = document.querySelector('#btn-apply-xticks-next');

      return JSON.stringify({
        panel_present: panel ? 'present' : 'absent',
        detect_btn: detectBtn ? 'present' : 'absent',
        next_btn: nextBtn ? 'present' : 'absent',
      });
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_xticks")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(f"XTicks evaluation failed to return valid JSON: {res_str} ({e})")

    # Print L4 frozen grammar
    print(f"\nXTICKS_PANEL={data['panel_present']}")
    print(f"XTICKS_DETECT_BUTTON={data['detect_btn']}")
    print(f"NEXT_STEP_BUTTON={data['next_btn']}")

    assert data["panel_present"] == "present", "XTicks step panel must be present on Step 6"
    assert data["detect_btn"] == "present", "Auto-detect x-ticks button must be present"
    assert data["next_btn"] == "present", "Next step button must be present"
