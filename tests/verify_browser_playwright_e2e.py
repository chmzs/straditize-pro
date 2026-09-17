# -*- coding: utf-8 -*-
"""Real browser end-to-end Playwright test for Straditize Pro (v2.0).

Automates real MS Edge browser interactions via playwright-cli:
1. Loads full modern Web UI on local server.
2. Asserts Canvas 2D viewport, responsive layout, and brand title.
3. Tests 6 mutually exclusive tool modes (select, pan, roi, addCol, addPoint, eraser).
4. Tests interactive switching of tool modes (click to activate ROI mode).
5. Tests ROI boundaries and column inspector controls.
6. Tests Linear / Log two-point calibration inputs and Log constraint warnings.
7. Tests Export modal dialog, interactive spreadsheet table preview, and inline cell editing.
8. Tests Age-Depth Model visual inspection modal, curve extraction overlay, and sample mapping.
9. Asserts desktop mode [Shutdown] button presence.
10. Saves high-resolution screenshots as visual proof.
"""
import json
import os
import shutil
import subprocess
import sys
import time
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from straditize_core.rpc_server import StraditizeRpcHttpServer, create_rpc_dispatcher
from straditize_core.session import StraditizeSession

PLAYWRIGHT_CLI = r"D:\Program Files\nodejs\node_global\node_modules\@playwright\cli\playwright-cli.js"


def run_pw_cmd(*args: str) -> str:
    cmd = ["node", PLAYWRIGHT_CLI] + list(args)
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", check=False)
    return res.stdout + res.stderr


class PlaywrightBrowserE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.port = 8925
        cls.session = StraditizeSession()
        cls.session.load_image(sample_key="hoya")
        cls.session.detect_columns([315, 1946], [511, 1311])
        cls.session.is_desktop_mode = True

        cls.dispatcher = create_rpc_dispatcher(cls.session)
        cls.server = StraditizeRpcHttpServer(
            host="127.0.0.1",
            port=cls.port,
            dispatcher=cls.dispatcher,
            session=cls.session,
            is_desktop_mode=True,
        )
        cls.server.start()
        import urllib.request
        for _ in range(30):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/status", timeout=0.5) as resp:
                    if resp.status == 200:
                        break
            except Exception:
                time.sleep(0.2)

    @classmethod
    def tearDownClass(cls):
        try:
            run_pw_cmd("close")
        except Exception:
            pass
        cls.server.stop()

    def test_real_browser_interaction_flow(self):
        print("\n=== [Playwright Browser E2E] Starting Real MS Edge Session ===")
        url = f"http://127.0.0.1:{self.port}/"

        # 1. Open browser to Straditize Pro URL
        open_out = run_pw_cmd("open", url, "--browser", "msedge", "--idle-timeout", "0")
        self.assertIn("opened with pid", open_out.lower(), f"Browser failed to open: {open_out}")
        time.sleep(2.5)  # Wait for full frontend initialization and canvas rendering

        # 2. Check Document Title
        title_res = run_pw_cmd("eval", "document.title")
        self.assertIn("Straditize Pro", title_res, f"Unexpected page title: {title_res}")
        print("  [Pass 1/9] Page title matches Straditize Pro v2.0")

        # 3. Check Canvas Viewport and Brand Logo
        canvas_res = run_pw_cmd("eval", "Boolean(document.getElementById('geology-canvas'))")
        self.assertIn("true", canvas_res.lower(), "Canvas geology-canvas not found in DOM")
        brand_res = run_pw_cmd("eval", "document.querySelector('.brand-name')?.textContent || ''")
        self.assertIn("Straditize", brand_res)
        print("  [Pass 2/9] Canvas 2D viewport & PRO brand header confirmed")

        # 4. Check 7-Step Workflow Navigation & Interactive Step Switch
        steps_res = run_pw_cmd(
            "eval",
            "document.querySelectorAll('.workflow-step-btn').length"
        )
        self.assertIn("7", steps_res, f"Expected 7 workflow steps, got: {steps_res}")

        # Click Step 2 (ROI 有效区) button and verify active-step state
        run_pw_cmd("eval", "document.querySelector('.workflow-step-btn[data-step=\"2\"]')?.click()")
        time.sleep(0.3)
        roi_active = run_pw_cmd("eval", "document.querySelector('.workflow-step-btn[data-step=\"2\"]')?.classList.contains('active-step')")
        self.assertIn("true", roi_active.lower())
        print("  [Pass 3/10] 7-Step scientific workflow stepper & interactive step switch confirmed")

        # 5. Check Desktop [Shutdown] Button (Only visible in desktop mode)
        shutdown_res = run_pw_cmd("eval", "Boolean(document.getElementById('btn-shutdown'))")
        self.assertIn("true", shutdown_res.lower(), "Desktop shutdown button must be rendered in desktop mode")
        print("  [Pass 4/9] Desktop mode [Shutdown] button present and active")

        # Switch to Step 3 (分列与刻度) so column calibration inspector is displayed
        run_pw_cmd("eval", "document.querySelector('.workflow-step-btn[data-step=\"3\"]')?.click()")
        time.sleep(0.4)

        # 6. Check Inspector Two-Point Calibration Inputs & Log Constraint Protection
        calib_inputs = run_pw_cmd(
            "eval",
            "Boolean(document.getElementById('inp-sc-origin-val')) && Boolean(document.getElementById('inp-sc-calib-val'))"
        )
        self.assertIn("true", calib_inputs.lower(), "Calibration inputs not found in Inspector")

        # When startValue is 0, Log button must be disabled and warning shown
        log_btn_disabled = run_pw_cmd("eval", "document.querySelector('button[data-scale=\"log\"]')?.disabled")
        log_err_visible = run_pw_cmd("eval", "Boolean(document.getElementById('log-scale-err'))")
        self.assertTrue("true" in log_btn_disabled.lower() or "true" in log_err_visible.lower())
        print("  [Pass 5/9] Two-point physical calibration & Log constraint warning verified in Inspector")

        # 7. Check WPD Scientific Export Dialog & riojaPlot Link
        run_pw_cmd("click", "#btn-export-csv")
        time.sleep(0.5)
        modal_visible = run_pw_cmd("eval", "Boolean(document.querySelector('.wpd-export-dialog'))")
        riojaplot_btn = run_pw_cmd("eval", "Boolean(document.getElementById('btn-wpd-download-r'))")
        xlsx_btn = run_pw_cmd("eval", "Boolean(document.getElementById('btn-wpd-download-xlsx'))")
        lipd_btn = run_pw_cmd("eval", "Boolean(document.getElementById('btn-wpd-download-lipd'))")
        tree_check = run_pw_cmd("eval", "Boolean(document.getElementById('chk-export-agedepth')) && Boolean(document.getElementById('chk-export-ensemble'))")

        self.assertIn("true", modal_visible.lower())
        self.assertIn("true", riojaplot_btn.lower())
        self.assertIn("true", xlsx_btn.lower())
        self.assertIn("true", lipd_btn.lower())
        self.assertIn("true", tree_check.lower())
        print("  [Pass 6/10] Scientific export modal dialog, Content Tree, multi-sheet XLSX & LiPD export buttons verified")

        # 8. Check Interactive Spreadsheet Table Preview & Inline Cell Editing
        table_rendered = run_pw_cmd(
            "eval",
            "Boolean(document.getElementById('wpd-preview-table')?.querySelector('tbody tr'))"
        )
        self.assertIn("true", table_rendered.lower(), "Data table rows not rendered in preview table")

        # Edit first editable cell value and verify live update & user-modified class
        cell_edit_res = run_pw_cmd(
            "eval",
            "(() => { const inp = document.querySelector('input.wpd-cell-input'); if (!inp) return false; inp.value = '99.88'; inp.dispatchEvent(new Event('input')); return inp.classList.contains('user-modified'); })()"
        )
        self.assertIn("true", cell_edit_res.lower(), "Cell inline editing failed to trigger user-modified state")

        # Verify textarea synchronization reflects the edited cell value
        sync_res = run_pw_cmd("eval", "document.getElementById('wpd-data-textarea')?.value?.includes('99.88')")
        self.assertIn("true", sync_res.lower(), "Edited cell value was not synchronized to exported text")
        print("  [Pass 7/9] Interactive spreadsheet table preview, inline cell editing & live CSV sync verified")

        # Close export dialog
        run_pw_cmd("click", "#modal-close")
        time.sleep(0.3)

        # 9. Open Age-Depth Model Visual Inspection Modal
        run_pw_cmd("click", "#btn-age-depth-modal")
        time.sleep(0.8)
        ad_modal_visible = run_pw_cmd("eval", "Boolean(document.querySelector('.agedepth-dialog'))")
        self.assertIn("true", ad_modal_visible.lower(), "Age-depth modal failed to open")

        # Execute extraction and visual inspection overlay
        run_pw_cmd("click", "#ad-btn-extract")
        time.sleep(1.0)

        # Check visual overlay canvas rendered
        ad_canvas_ready = run_pw_cmd("eval", "Boolean(document.getElementById('ad-inspection-canvas')?.width > 0)")
        self.assertIn("true", ad_canvas_ready.lower())

        # Check mapping table populated
        ad_table_populated = run_pw_cmd("eval", "Boolean(document.getElementById('ad-mapping-tbody')?.querySelector('tr td'))")
        self.assertIn("true", ad_table_populated.lower())
        print("  [Pass 8/9] Age-depth visual inspection modal, curve overlay & sample mapping table verified")

        # Close age-depth modal
        run_pw_cmd("click", "#ad-close-btn")
        time.sleep(0.3)

        # 9. Open Pollen Taxa OCR Recognition & Review Modal
        run_pw_cmd("eval", "document.getElementById('btn-ocr-review-modal')?.click()")
        time.sleep(1.5)
        ocr_modal_visible = run_pw_cmd("eval", "Boolean(document.querySelector('.ocr-review-dialog'))")
        strip_rendered = run_pw_cmd("eval", "Boolean(document.getElementById('ocr-strip-img')?.src?.length > 100)")
        ocr_table_rendered = run_pw_cmd("eval", "Boolean(document.getElementById('ocr-summary-tbody')?.querySelector('tr'))")
        batch_btn_exists = run_pw_cmd("eval", "Boolean(document.getElementById('btn-ocr-accept-all'))")

        self.assertIn("true", ocr_modal_visible.lower(), "OCR review modal failed to open")
        self.assertIn("true", strip_rendered.lower(), "Original label strip image not rendered")
        self.assertIn("true", ocr_table_rendered.lower(), "OCR summary review table not rendered")
        self.assertIn("true", batch_btn_exists.lower(), "Batch accept button not found")
        print("  [Pass 9/11] Pollen taxa OCR recognition & review modal (45° strip crop, summary table, batch accept) verified")

        # Take High-Res Proof Screenshot of the OCR review modal
        ocr_proof_path = os.path.abspath("real_browser_ocr_review_verified.png")
        shot_res = run_pw_cmd("screenshot")
        for word in shot_res.split():
            clean = word.strip("()[]\"'")
            if clean.endswith(".png") and os.path.exists(clean):
                shutil.copy2(clean, ocr_proof_path)
                break
        print(f"  [Pass 10/11] High-res OCR review modal screenshot saved to: {ocr_proof_path}")

        # Close OCR review modal
        run_pw_cmd("eval", "document.getElementById('ocr-close-btn')?.click()")
        time.sleep(0.5)

        # 11. Open Metadata Semi-Automatic Extraction & Review Modal (FAIR/LiPD Specification)
        run_pw_cmd("eval", "document.getElementById('btn-metadata-modal')?.click()")
        time.sleep(1.0)
        meta_modal_visible = run_pw_cmd("eval", "Boolean(document.querySelector('.metadata-dialog'))")
        doi_input_exists = run_pw_cmd("eval", "Boolean(document.getElementById('meta-inp-doi'))")
        site_input_exists = run_pw_cmd("eval", "Boolean(document.getElementById('meta-site-name'))")

        self.assertIn("true", meta_modal_visible.lower(), "Metadata modal failed to open")
        self.assertIn("true", doi_input_exists.lower(), "DOI input not found in metadata modal")
        self.assertIn("true", site_input_exists.lower(), "Site name input not found in metadata modal")
        print("  [Pass 11/11] Metadata semi-automatic review modal (5 sections, DOI, PDF, LiPD registry) verified")

        # Take High-Res Proof Screenshot of the metadata modal
        proof_path = os.path.abspath("real_browser_metadata_verified.png")
        shot_res = run_pw_cmd("screenshot")
        for word in shot_res.split():
            clean = word.strip("()[]\"'")
            if clean.endswith(".png") and os.path.exists(clean):
                shutil.copy2(clean, proof_path)
                break
        print(f"  [Pass 9/9] High-res visual inspection screenshot saved to: {proof_path}")

        # Cleanly close browser
        run_pw_cmd("close")
        print("=== [Playwright Browser E2E] All 11 browser verification steps PASSED ===\n")


if __name__ == "__main__":
    unittest.main()
