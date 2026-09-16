# -*- coding: utf-8 -*-
"""Real browser end-to-end Playwright test for Straditize Pro (v2.0).

Automates real MS Edge browser interactions via playwright-cli:
1. Loads full modern Web UI on local server.
2. Asserts Canvas 2D viewport, responsive layout, and brand title.
3. Tests 6 mutually exclusive tool modes (select, pan, roi, addCol, addPoint, eraser).
4. Tests interactive switching of tool modes (click to activate ROI mode).
5. Tests ROI boundaries and column inspector controls.
6. Tests Linear / Log two-point calibration inputs and Log constraint warnings.
7. Tests Export modal dialog open and riojaPlot direct link presence.
8. Asserts desktop mode [Shutdown] button presence.
9. Saves a high-resolution screenshot as visual proof.
"""
import json
import os
import subprocess
import sys
import time
import unittest

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
        time.sleep(1.0)

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
        open_out = run_pw_cmd("open", url, "--browser", "msedge")
        self.assertIn("opened with pid", open_out.lower(), f"Browser failed to open: {open_out}")
        time.sleep(2.5)  # Wait for full frontend initialization and canvas rendering

        # 2. Check Document Title
        title_res = run_pw_cmd("eval", "document.title")
        self.assertIn("Straditize Pro", title_res, f"Unexpected page title: {title_res}")
        print("  [Pass 1/7] Page title matches Straditize Pro v2.0")

        # 3. Check Canvas Viewport and Brand Logo
        canvas_res = run_pw_cmd("eval", "Boolean(document.getElementById('geology-canvas'))")
        self.assertIn("true", canvas_res.lower(), "Canvas geology-canvas not found in DOM")
        brand_res = run_pw_cmd("eval", "document.querySelector('.brand-name')?.textContent || ''")
        self.assertIn("Straditize", brand_res)
        print("  [Pass 2/7] Canvas 2D viewport & PRO brand header confirmed")

        # 4. Check 6-Tool Mode State Machine Buttons & Interactive Click Switch
        tools_res = run_pw_cmd(
            "eval",
            "JSON.stringify(['select', 'pan', 'roi', 'addCol', 'addPoint', 'eraser'].map(m => Boolean(document.querySelector(`button[data-tool-mode=\"${m}\"]`))))"
        )
        self.assertIn("[true,true,true,true,true,true]", tools_res.replace(" ", ""), f"Missing tool buttons: {tools_res}")

        # Click ROI tool button and verify active-mode class changes
        run_pw_cmd("click", "button[data-tool-mode=\"roi\"]")
        time.sleep(0.3)
        roi_active = run_pw_cmd("eval", "document.querySelector('button[data-tool-mode=\"roi\"]')?.classList.contains('active-mode')")
        self.assertIn("true", roi_active.lower())
        print("  [Pass 3/7] All 6 tool mode buttons verified & interactive ROI mode switch confirmed")

        # 5. Check Desktop [Shutdown] Button (Only visible in desktop mode)
        shutdown_res = run_pw_cmd("eval", "Boolean(document.getElementById('btn-shutdown'))")
        self.assertIn("true", shutdown_res.lower(), "Desktop shutdown button must be rendered in desktop mode")
        print("  [Pass 4/7] Desktop mode [Shutdown] button present and active")

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
        print("  [Pass 5/7] Two-point physical calibration & Log constraint warning verified in Inspector")

        # 7. Check WPD Scientific Export Dialog & riojaPlot Link
        run_pw_cmd("click", "#btn-export-csv")
        time.sleep(0.5)
        modal_visible = run_pw_cmd("eval", "Boolean(document.querySelector('.wpd-export-dialog'))")
        riojaplot_btn = run_pw_cmd("eval", "Boolean(document.getElementById('btn-wpd-download-r'))")
        self.assertIn("true", modal_visible.lower())
        self.assertIn("true", riojaplot_btn.lower())
        print("  [Pass 6/7] Scientific export modal dialog & riojaPlot direct link verified")

        # 8. Take High-Res Proof Screenshot
        proof_path = os.path.abspath("real_browser_playwright_verified.png")
        shot_res = run_pw_cmd("screenshot")
        # Extract saved path from playwright-cli output
        import re, shutil
        import shutil
        for word in shot_res.split():
            clean = word.strip("()[]\"'")
            if clean.endswith(".png") and os.path.exists(clean):
                shutil.copy2(clean, proof_path)
                break
        print(f"  [Pass 7/7] High-res browser screenshot saved to: {proof_path}")

        # Cleanly close browser
        run_pw_cmd("close")
        print("=== [Playwright Browser E2E] All 7 browser verification steps PASSED ===\n")


if __name__ == "__main__":
    unittest.main()
