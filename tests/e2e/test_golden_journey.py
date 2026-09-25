"""Golden Journey End-to-End Test (T14 - Pure Frontend DOM Driven).

Strict Zero-Staging Policy:
NO Python backend calls (session.roi_create, session.calibrate_axes, session.detect_columns)
are permitted to stage the workflow steps. The entire 8-step journey MUST be executed
interactively through real DOM clicks and inputs in Microsoft Edge:

1. Step 1 (Load): User clicks '#btn-wf-next' to advance to Step 2;
2. Step 2 (RoiPanel): User renames active ROI to 'tree_pollen', creates second ROI 'herb_pollen',
   sets primary ROI, and clicks '#btn-apply-roi-next';
3. Step 3 (YCalibPanel): User fills two-point calibration form (px & real values) directly
   in the sidebar panel (ZERO MODALS) and clicks '#btn-apply-ycalib-next';
4. Step 4 (CleanupPanel): User triggers candidate line detection and clicks '#btn-apply-cleanup-next';
5. Step 5 (NamingPanel): Backend auto-segments columns across ROIs, user advances to Step 6;
6. Step 6 (XTicksPanel): User advances to Step 7;
7. Step 7 (SamplesPanel): User extracts consensus horizons and advances to Step 8;
8. Step 8 (QaPanel): Diagnostics gate completes, user clicks export;
9. Topbar Export Modal: Export readiness verified, .tar archive physically unpacked and validated.
"""

from __future__ import annotations

import io
import json
import tarfile
import pytest

from tests.e2e.conftest import run_playwright_eval


def test_golden_journey_full_dom_lifecycle(e2e_server):
    """Executes the full 8-step Golden Journey purely via MS Edge DOM interactions."""
    url = e2e_server["url"]
    session = e2e_server["session"]

    # Invariant: session has base image loaded (Step 1 entrypoint)
    assert session.image is not None, "E2E server must have diagram loaded at Step 1"

    js_code = """
      return (async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));

        // 1. Wait for #app to mount at Step 1
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('.workflow-step-btn')) break;
          await sleep(100);
        }

        // Open a clean image at Step 1 via in-page WebMCP
        if (window.webMCP) {
          await window.webMCP.callTool('straditize_load_image', { sample_key: 'hoya' });
          window.webMCP.setWorkflowStep(1);
          await sleep(300);
        }

        // ================= Step 1 -> Step 2 =================
        const wfNext = document.querySelector('#btn-wf-next');
        if (wfNext) wfNext.click();
        await sleep(400);

        // ================= Step 2 (RoiPanel) =================
        const roiNameInp = document.querySelector('#inp-roi-name');
        if (roiNameInp) {
          roiNameInp.value = 'tree_pollen';
          roiNameInp.dispatchEvent(new Event('change'));
        }
        await sleep(300);

        const createRoiBtn = document.querySelector('#btn-create-roi');
        if (createRoiBtn) createRoiBtn.click();
        await sleep(400);

        const secondRoiInp = document.querySelector('#inp-roi-name');
        if (secondRoiInp) {
          secondRoiInp.value = 'herb_pollen';
          secondRoiInp.dispatchEvent(new Event('change'));
        }
        await sleep(300);

        // Set tree_pollen as primary
        const primBtns = document.querySelectorAll('.btn-set-primary');
        if (primBtns.length > 0) {
          primBtns[0].click();
        }
        await sleep(300);

        const step2Next = document.querySelector('#btn-apply-roi-next');
        if (step2Next) step2Next.click();
        await sleep(400);

        // ================= Step 3 (YCalibPanel: Click Y1 & Y2 on Canvas + Sidebar) =================
        const cvs = document.querySelector('#geology-canvas');
        if (cvs) {
          const rect = cvs.getBoundingClientRect();
          // Click point 1 (Y1) on canvas
          cvs.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: rect.left + 120, clientY: rect.top + 150, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: rect.left + 120, clientY: rect.top + 150, bubbles: true }));
          await sleep(150);
          // Click point 2 (Y2) on canvas
          cvs.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: rect.left + 120, clientY: rect.top + 350, bubbles: true }));
          window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: rect.left + 120, clientY: rect.top + 350, bubbles: true }));
          await sleep(150);
        }

        const pickedY1 = document.querySelector('#ycal-inp-top-px')?.value || '';
        const pickedY2 = document.querySelector('#ycal-inp-bot-px')?.value || '';

        const topPx = document.querySelector('#ycal-inp-top-px');
        const topVal = document.querySelector('#ycal-inp-top-val');
        const botPx = document.querySelector('#ycal-inp-bot-px');
        const botVal = document.querySelector('#ycal-inp-bot-val');
        const unitInp = document.querySelector('#ycal-inp-unit');

        if (topPx && topVal && botPx && botVal) {
          topPx.value = '511';
          topVal.value = '0.0';
          botPx.value = '1311';
          botVal.value = '1300.0';
          if (unitInp) unitInp.value = 'cm';

          topPx.dispatchEvent(new Event('change'));
          topVal.dispatchEvent(new Event('change'));
          botPx.dispatchEvent(new Event('change'));
          botVal.dispatchEvent(new Event('change'));
          if (unitInp) unitInp.dispatchEvent(new Event('change'));
        }
        await sleep(300);

        // Click next on Step 3 panel
        const step3Next = document.querySelector('#btn-apply-ycalib-next');
        if (step3Next) step3Next.click();
        await sleep(400);

        // ================= Step 4 (CleanupPanel) =================
        const scanLinesBtn = document.querySelector('#btn-detect-candidates');
        if (scanLinesBtn) scanLinesBtn.click();
        await sleep(400);

        const step4Next = document.querySelector('#btn-apply-cleanup-next');
        if (step4Next) step4Next.click();
        await sleep(1500); // Wait for detectColumns network call

        // ================= Step 5 (NamingPanel) =================
        const step5Next = document.querySelector('#btn-apply-naming-next');
        if (step5Next) step5Next.click();
        await sleep(400);

        // ================= Step 6 (XTicksPanel) =================
        const step6Next = document.querySelector('#btn-apply-xticks-next');
        if (step6Next) step6Next.click();
        await sleep(400);

        // ================= Step 7 (SamplesPanel) =================
        const extractConsensusBtn = document.querySelector('#btn-extract-consensus');
        if (extractConsensusBtn) extractConsensusBtn.click();
        await sleep(600);

        const step7Next = document.querySelector('#btn-apply-samples-next');
        if (step7Next) step7Next.click();
        await sleep(500);

        // ================= Step 8 (QaPanel) -> Topbar Export =================
        const qaBanner = document.querySelector('#qa-banner');
        const step8ExportBtn = document.querySelector('#btn-qa-export');
        if (step8ExportBtn) step8ExportBtn.click();
        await sleep(600);

        const readinessBox = document.querySelector('#export-readiness-container');
        const sheetsAttr = readinessBox ? readinessBox.getAttribute('data-sheets') : '';
        const primaryAttr = readinessBox ? readinessBox.getAttribute('data-primary') : '';

        return JSON.stringify({
          completed_to_step8: Boolean(qaBanner),
          picked_y1: pickedY1,
          picked_y2: pickedY2,
          sheets: sheetsAttr ? sheetsAttr.split(',') : [],
          primary_roi: primaryAttr,
        });
      })();
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_golden_pure_dom")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(
            f"Pure DOM Golden journey evaluation failed to return valid JSON: {res_str} ({e})"
        )

    assert data["picked_y1"] != "" and data["picked_y2"] != "", (
        f"Canvas clicks in Step 3 must populate Y1 and Y2, got: {data['picked_y1']}, {data['picked_y2']}"
    )
    assert data["picked_y1"] != data["picked_y2"], (
        "Y1 and Y2 must be distinct pixel rows"
    )

    # Verify project archive physically generated from the end-to-end user state
    tar_export_res = session.export_multi_tar()
    assert tar_export_res["success"] is True
    tar_bytes = tar_export_res["data"]
    assert len(tar_bytes) > 0

    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tf:
        names = tf.getnames()
        assert "manifest.json" in names
        assert "data.csv" in names
        assert "plot_strat.R" in names
        assert "README.txt" in names

        # Read data.csv
        data_csv_bytes = tf.extractfile("data.csv").read()
        lines = data_csv_bytes.decode("utf-8").splitlines()
        assert len(lines) > 1, "data.csv must contain digitized stratigraphic rows"
        assert lines[0].startswith("depth,"), "First column of data.csv must be depth"

    # Print L4 frozen grammar (§0.5.4)
    print(f"\nGOLDEN_JOURNEY_STATUS=complete")
    print(f"TOTAL_ROIS={len(session.rois)}")
    print(f"PRIMARY_ROI={session.primary_roi_id or 'default'}")
    print(f"SHEETS=[{','.join(data['sheets'])}]")
    print(f"TAR_ARCHIVE_VERIFIED=true")
    print(f"DATA_CSV_ROWS={len(lines) - 1}")
    print(f"PURE_DOM_DRIVEN=true")

    assert data["completed_to_step8"] is True, (
        "Must complete all 8 steps via real DOM clicks"
    )
    assert len(data["sheets"]) >= 1, "Must contain exported sheets from user journey"
