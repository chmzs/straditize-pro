"""E2E test verifying Step 4 cleanup panel, candidates scanning, and exclusion controls."""

from __future__ import annotations

import json
import pytest

from tests.e2e.conftest import run_playwright_eval


def test_cleanup_panel_and_interactions(e2e_server):
    """Verify cleanup panel renders on step 4 with candidate controls and exclusion button."""
    url = e2e_server["url"]

    # 1. Navigate to Step 4 via real UI clicks or direct step trigger
    js_code = """
      return (async () => {
      let api;
      for (let i = 0; i < 40; i++) {
        api = window.__straditize;
        if (api) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!api) return JSON.stringify({ error: 'no-handle' });

      // Switch to Step 4 (清理) through the same workflow entry point as production.
      await api.gotoStage(4);

      // 工作流切换包含异步后端刷新；轮询面板出现，避免固定 sleep 与竞态。
      for (let i = 0; i < 40; i++) {
        if (document.querySelector('.step-panel[data-step="4"]')) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      // Query Cleanup panel controls
      const panel = document.querySelector('.step-panel[data-step="4"]');
      const scanBtn = document.querySelector('#btn-detect-candidates');
      const exclusionBtn = document.querySelector('#btn-add-exclusion-rect');
      const linefixBtn = document.querySelector('#btn-trigger-linefix');
      const nextBtn = document.querySelector('#btn-apply-cleanup-next');

      return JSON.stringify({
        panel_present: panel ? 'present' : 'absent',
        scan_btn: scanBtn ? 'present' : 'absent',
        exclusion_btn: exclusionBtn ? 'present' : 'absent',
        linefix_btn: linefixBtn ? 'present' : 'absent',
        next_btn: nextBtn ? 'present' : 'absent',
      });
      })();
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_cleanup")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(f"Cleanup evaluation failed to return valid JSON: {res_str} ({e})")

    # 2. Print L4 frozen grammar
    print(f"\nCLEANUP_PANEL={data['panel_present']}")
    print(f"CANDIDATES_SCAN_BUTTON={data['scan_btn']}")
    print(f"EXCLUSION_BUTTON={data['exclusion_btn']}")
    print(f"LINEFIX_BUTTON={data['linefix_btn']}")
    print(f"NEXT_STEP_BUTTON={data['next_btn']}")

    assert data["panel_present"] == "present", "Cleanup step panel must be present on Step 4"
    assert data["scan_btn"] == "present", "Scan candidates button must be present"
    assert data["exclusion_btn"] == "present", "Exclusion button must be present"
    assert data["linefix_btn"] == "present", "Linefix K-brush button must be present"
    assert data["next_btn"] == "present", "Next step button must be present"
