"""E2E test verifying topbar export button, Export Readiness Modal, and L4 grammar."""

from __future__ import annotations

import json
import pytest

from tests.e2e.conftest import run_playwright_eval


def test_topbar_export_and_readiness_l4(e2e_server):
    """Verify clicking topbar export button opens readiness dialog with multi-ROI grammar."""
    url = e2e_server["url"]
    session = e2e_server["session"]

    # 1. Setup 3 ROIs: pollen (named), charcoal (named), concentration (unnamed default)
    session.rois.clear()
    session.columns.clear()

    r1 = session.roi_create(name="pollen", composition=True)["roi"]
    # Force name_source to user for pollen & charcoal
    r1["name_source"] = "user"

    r2 = session.roi_create(name="charcoal", composition=False)["roi"]
    r2["name_source"] = "user"

    r3 = session.roi_create(name="concentration", composition=False)["roi"]
    # concentration is NOT user-named (default source) -> must appear in READINESS_MISSING
    r3["name_source"] = "default"

    session.roi_set_primary(r1["id"])

    # Allocate columns so pollen and charcoal have columns
    session.columns = [
        {
            "col_index": 0,
            "name": "Pinus",
            "roi_id": r1["id"],
            "start": 100,
            "end": 200,
            "startX": 100,
            "endX": 200,
        },
        {
            "col_index": 1,
            "name": "MicroCharcoal",
            "roi_id": r2["id"],
            "start": 300,
            "end": 400,
            "startX": 300,
            "endX": 400,
        },
    ]

    session.column_points = {
        0: [{"row": 50, "x": 180.0}, {"row": 100, "x": 180.0}],
        1: [{"row": 50, "x": 350.0}, {"row": 100, "x": 350.0}],
    }
    session.samples = [
        {"row_px": 50, "depth": 10.0, "source": "manual"},
        {"row_px": 100, "depth": 20.0, "source": "manual"},
    ]

    js_code = """
      return (async () => {
        // Click existing topbar export button (#btn-export-csv)
        const topbarExportBtn = document.querySelector('#btn-export-csv');
        if (topbarExportBtn) {
          topbarExportBtn.click();
        }

        // Wait for export dialog to render
        await new Promise(r => setTimeout(r, 600));

        const dialog = document.querySelector('.wpd-export-dialog');
        const readinessBox = document.querySelector('#export-readiness-container');

        const sheetsAttr = readinessBox ? readinessBox.getAttribute('data-sheets') : '';
        const primaryAttr = readinessBox ? readinessBox.getAttribute('data-primary') : '';
        const dataCsvEq = readinessBox ? readinessBox.getAttribute('data-data-csv-equals-primary') : 'false';
        const missingAttr = readinessBox ? readinessBox.getAttribute('data-readiness-missing') : '';

        const sheetsList = sheetsAttr ? sheetsAttr.split(',') : [];
        const missingList = missingAttr ? missingAttr.split(',') : [];

        return JSON.stringify({
          dialog_present: dialog ? 'present' : 'absent',
          readiness_present: readinessBox ? 'present' : 'absent',
          sheets: sheetsList,
          primary_roi: primaryAttr,
          data_csv_equals_primary: dataCsvEq === 'true',
          readiness_missing: missingList,
        });
      })();
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_export")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(f"Export evaluation failed to return valid JSON: {res_str} ({e})")

    # Print L4 frozen grammar (§0.5.4)
    sheets_grammar = f"[{','.join(data['sheets'])}]"
    missing_grammar = f"[{','.join(data['readiness_missing'])}]"
    print(f"\nSHEETS={sheets_grammar}")
    print(f"PRIMARY_ROI={data['primary_roi']}")
    print(
        f"DATA_CSV_EQUALS_PRIMARY={'true' if data['data_csv_equals_primary'] else 'false'}"
    )
    print(f"READINESS_MISSING={missing_grammar}")

    assert data["dialog_present"] == "present", (
        "Export dialog must open upon clicking topbar button"
    )
    assert data["readiness_present"] == "present", (
        "Readiness container must render inside dialog"
    )
    assert data["sheets"] == ["pollen", "charcoal", "concentration"]
    assert data["primary_roi"] == "pollen"
    assert data["data_csv_equals_primary"] is True
    assert data["readiness_missing"] == ["concentration"]
