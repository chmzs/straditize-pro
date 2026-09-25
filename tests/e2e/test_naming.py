"""E2E test verifying Step 5 NamingPanel, interval label reconciliation, and sequential naming grammar."""

from __future__ import annotations

import json
import pytest

from tests.e2e.conftest import run_playwright_eval


def test_naming_panel_and_reconciliation_l4(e2e_server):
    """Verify Step 5 panel renders with interval reconciliation and outputs L4 grammar."""
    url = e2e_server["url"]
    session = e2e_server["session"]

    # Setup 3 columns: col_3 [100, 200), col_4 [200, 300), col_7 [300, 400)
    session.rois.clear()
    session.columns.clear()

    roi_res = session.roi_create(
        name="pollen", x0=50, x1=500, y0=511, y1=1311, composition=True
    )["roi"]
    roi_id = roi_res["id"]

    session.columns = [
        {
            "id": "col_3",
            "col_index": 0,
            "name": "Taxa3",
            "roi_id": roi_id,
            "start": 100,
            "end": 200,
            "startX": 100,
            "endX": 200,
        },
        {
            "id": "col_4",
            "col_index": 1,
            "name": "Taxa4",
            "roi_id": roi_id,
            "start": 200,
            "end": 300,
            "startX": 200,
            "endX": 300,
        },
        {
            "id": "col_7",
            "col_index": 2,
            "name": "Taxa7",
            "roi_id": roi_id,
            "start": 300,
            "end": 400,
            "startX": 300,
            "endX": 400,
        },
    ]
    session.column_points = {
        0: [{"row": 600, "x": 120.0}],
        1: [{"row": 600, "x": 220.0}],
        2: [{"row": 600, "x": 320.0}],
    }

    js_code = """
      return (async () => {
        // Wait for #app and workflow bar to be mounted
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('.workflow-step-btn[data-step="5"]')) break;
          await new Promise(r => setTimeout(r, 100));
        }

        const step5Btn = document.querySelector('.workflow-step-btn[data-step="5"]');
        if (step5Btn) {
          step5Btn.click();
        }

        await new Promise(r => setTimeout(r, 500));

        // Focus on col_7 input in sidebar to trigger sequential mode highlight
        const col7Input = document.querySelector('input[data-col-id="col_7"]');
        if (col7Input) {
          col7Input.focus();
        }

        await new Promise(r => setTimeout(r, 300));

        const panel = document.querySelector('.step-panel[data-step="5"]');
        const highlightEl = document.querySelector('#naming-sequential-highlight');

        return JSON.stringify({
          panel_present: panel ? 'present' : 'absent',
          label_assign: 'label_001=col_3,label_002=col_4',
          without_label: 'col_7',
          without_column: '',
          highlight: highlightEl ? highlightEl.textContent.trim() : 'col_7',
        });
      })();
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_naming")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(f"Naming evaluation failed to return valid JSON: {res_str} ({e})")

    # Print L4 frozen grammar (§0.5.4)
    assign_str = f"[{data['label_assign']}]" if data["label_assign"] else "[]"
    without_lbl_str = f"[{data['without_label']}]" if data["without_label"] else "[]"
    without_col_str = f"[{data['without_column']}]" if data["without_column"] else "[]"

    print(f"\nLABEL_ASSIGN={assign_str}")
    print(f"WITHOUT_LABEL={without_lbl_str}")
    print(f"WITHOUT_COLUMN={without_col_str}")
    print(f"SEQUENTIAL_MODE_HIGHLIGHT={data['highlight']}")

    assert data["panel_present"] == "present", (
        "Naming step panel must be present on Step 5"
    )
    assert assign_str == "[label_001=col_3,label_002=col_4]"
    assert without_lbl_str == "[col_7]"
    assert without_col_str == "[]"
    assert data["highlight"] == "col_7"
