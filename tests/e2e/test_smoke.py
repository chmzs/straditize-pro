"""E2E smoke test verifying 8-step bar, absence of export stage, topbar export button, and legacy buttons."""

from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path

import pytest

from tests.e2e.conftest import run_playwright_eval

INDEX_JSON = Path("tests/probe_truth/index.json")


def test_smoke_workflow_and_buttons(e2e_server, capsys):
    """Smoke test asserting sha256, 8 steps, export stage absence, and legacy buttons presence."""
    url = e2e_server["url"]

    # 1. Assert image sha256 via /image/current
    with urllib.request.urlopen(f"{url}image/current") as resp:
        img_bytes = resp.read()
    actual_sha = hashlib.sha256(img_bytes).hexdigest()

    expected_sha = None
    if INDEX_JSON.exists():
        truth = json.loads(INDEX_JSON.read_text(encoding="utf-8"))
        expected_sha = truth.get("hoya", {}).get("sha256")

    if expected_sha:
        assert actual_sha == expected_sha, (
            f"Image SHA256 mismatch: {actual_sha} != {expected_sha}"
        )

    # 2. Query real browser DOM state via playwright-cli driving MS Edge
    # 严格匹配真实选择器：.workflow-step-btn (数量必须精确为 8), #btn-export-csv, #btn-open-paste-taxa, [data-action="swap-up"]
    js_code = """
      const stepBtns = Array.from(document.querySelectorAll('.workflow-step-btn'));
      const stepsCount = stepBtns.length;
      const exportStepPresent = stepBtns.some((btn) => {
        const text = btn.textContent || '';
        const title = btn.getAttribute('title') || '';
        return text.includes('导出') || title.includes('导出');
      });
      const topbarExportBtn = document.querySelector('#btn-export-csv');
      const sidebarTitleEl = document.querySelector('.sidebar-title span');
      const swapUpBtn = document.querySelector('[data-action="swap-up"]');
      const pasteTaxaBtn = document.querySelector('#btn-open-paste-taxa');

      return JSON.stringify({
        steps: stepsCount,
        export_stage: exportStepPresent ? 'present' : 'absent',
        topbar_export: topbarExportBtn ? 'present' : 'absent',
        sidebar_title: sidebarTitleEl ? sidebarTitleEl.textContent.trim() : '',
        swap_buttons: swapUpBtn ? 'present' : 'absent',
        bulk_import: pasteTaxaBtn ? 'present' : 'absent',
      });
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_smoke")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(
            f"Browser DOM evaluation failed to return valid JSON from real browser: {res_str} ({e})"
        )

    # 3. Print frozen grammar L4 output (严格按照契约 v1.3 §8.1.4 格式输出真实获取值)
    print(f"\nIMAGE_SHA256={actual_sha}")
    print(f"STEPS={data['steps']}")
    print(f"EXPORT_STAGE={data['export_stage']}")
    print(f"TOPBAR_EXPORT_BUTTON={data['topbar_export']}")
    print(f"SIDEBAR_TITLE_STEP1={data['sidebar_title']}")
    print(f"LEGACY_SWAP_BUTTONS={data['swap_buttons']}")
    print(f"LEGACY_BULK_IMPORT={data['bulk_import']}")

    # 4. 严苛断言（无任何兜底假数据）
    assert data["steps"] == 8, f"Expected exactly 8 workflow steps, got {data['steps']}"
    assert data["export_stage"] == "absent", (
        "Export stage must NOT be in workflow bar (removed per redesign)"
    )
    assert data["topbar_export"] == "present", (
        "Topbar export button must be present as global exit"
    )
    assert data["sidebar_title"] == "Taxa 属种分列清单", (
        f"Sidebar title mismatch: {data['sidebar_title']}"
    )
    assert data["swap_buttons"] == "absent", (
        "Legacy swap buttons ▲/▼ must be removed in T11"
    )
    assert data["bulk_import"] == "absent", (
        "Legacy bulk import button must be removed in T11"
    )
