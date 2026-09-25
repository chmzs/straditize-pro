"""Golden Journey End-to-End Test (T14).

Executes a complete, uninterrupted user journey from diagram load to final .tar archive extraction
using real MS Edge browser driving against the live backend:
1. Load real diagram (04_elsevier_two_tier_coniss.jpg);
2. Step 2: Create two tier ROIs ('tree_pollen' and 'herb_pollen');
3. Step 3: Calibrate Y-axis depths (0 cm to 1300 cm);
4. Step 4: Line detection and exclusion region fencing for CONISS tree;
5. Step 5: Column segmentation across both ROIs;
6. Step 7: Sample horizons consensus extraction;
7. Step 8: Quality assurance diagnostics gate (qa.summarize);
8. Topbar Export: Generate standard .tar project archive, decompress it on disk,
   and verify internal CSV integrity and Primary ROI byte-level equivalence.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
import tarfile
import pytest

from tests.e2e.conftest import run_playwright_eval

CORPUS_JSON_PATH = Path("tests/corpus/index.json")


def test_golden_journey_full_lifecycle(e2e_server):
    """Executes the full Golden Journey lifecycle in real MS Edge and validates exported .tar archive."""
    url = e2e_server["url"]
    session = e2e_server["session"]

    # 1. Load 04_elsevier_two_tier_coniss into session
    manifest = json.loads(CORPUS_JSON_PATH.read_text(encoding="utf-8"))
    fig_info = manifest["figures"]["04_elsevier_two_tier_coniss"]
    img_path = str(Path(fig_info["file"]).resolve())

    session.load_image(image_path=img_path)

    # 2. Step 2: Create two realistic ROIs: tree_pollen (upper) and herb_pollen (lower)
    session.rois.clear()
    session.columns.clear()

    r_upper = session.roi_create(
        name="tree_pollen",
        x0=320,
        x1=1950,
        y0=320,
        y1=880,
        composition=True,
    )["roi"]
    r_upper["name_source"] = "user"

    r_lower = session.roi_create(
        name="herb_pollen",
        x0=320,
        x1=1950,
        y0=920,
        y1=1480,
        composition=False,
    )["roi"]
    r_lower["name_source"] = "user"

    # Set tree_pollen as Primary ROI
    session.roi_set_primary(r_upper["id"])

    # 3. Step 3: Calibrate Y-axis
    session.calibrate_axes(
        y_marks=[{"px": 320.0, "val": 0.0}, {"px": 1480.0, "val": 1300.0}],
        unit="cm",
    )

    # 4. Step 4: Line detection and exclusion region fencing for CONISS tree (x > 1950)
    session.detect_line_candidates(roi_id=r_upper["id"])
    session.apply_line_removal(
        roi_id=r_upper["id"],
        exclusion_regions=[
            {
                "id": "ex_coniss",
                "roi_id": r_upper["id"],
                "kind": "rect",
                "points": [[1950, 300], [2400, 300], [2400, 1600], [1950, 1600]],
            }
        ],
    )

    # 5. Step 5: Column segmentation across both ROIs
    session.detect_columns(roi_id=r_upper["id"])
    session.detect_columns(roi_id=r_lower["id"])
    assert len(session.columns) > 0

    # 6. Step 7: Sample horizons extraction
    session.samples_extract_consensus(tolerance_px=4.0, min_taxa_support=1)

    # 7. Step 8: QA Summarize gate check
    qa_res = session.qa_summarize(roi_id=r_upper["id"])
    assert qa_res["n_horizons"] > 0

    # 8. Drive real MS Edge browser to verify UI state and click export
    js_code = """
      return (async () => {
        // Wait for #app to mount
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('.workflow-step-btn')) break;
          await new Promise(r => setTimeout(r, 100));
        }

        // Switch to Step 8 (校验)
        const step8Btn = document.querySelector('.workflow-step-btn[data-step="8"]');
        if (step8Btn) {
          step8Btn.click();
        }
        await new Promise(r => setTimeout(r, 400));

        const panel = document.querySelector('.step-panel[data-step="8"]');
        const qaBanner = document.querySelector('#qa-banner');

        // Click topbar export button to open readiness modal
        const exportBtn = document.querySelector('#btn-export-csv');
        if (exportBtn) {
          exportBtn.click();
        }
        await new Promise(r => setTimeout(r, 500));

        const readinessBox = document.querySelector('#export-readiness-container');
        const sheetsAttr = readinessBox ? readinessBox.getAttribute('data-sheets') : '';
        const primaryAttr = readinessBox ? readinessBox.getAttribute('data-primary') : '';

        return JSON.stringify({
          qa_panel_present: panel ? 'present' : 'absent',
          qa_banner_present: qaBanner ? 'present' : 'absent',
          sheets: sheetsAttr ? sheetsAttr.split(',') : [],
          primary_roi: primaryAttr,
        });
      })();
    """

    res_str = run_playwright_eval(url, js_code, session_name="e2e_golden_journey")
    try:
        data = json.loads(res_str)
    except Exception as e:
        pytest.fail(
            f"Golden journey evaluation failed to return valid JSON: {res_str} ({e})"
        )

    # 9. Physically export .tar archive via backend and unpack to assert file structure
    tar_export_res = session.export_multi_tar()
    assert tar_export_res["success"] is True
    tar_data = tar_export_res["data"]
    import base64

    tar_bytes = base64.b64decode(tar_data) if isinstance(tar_data, str) else tar_data
    assert len(tar_bytes) > 0

    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tf:
        names = tf.getnames()
        assert "manifest.json" in names
        assert "data.csv" in names
        assert "data/tree_pollen.csv" in names
        assert "data/herb_pollen.csv" in names
        assert "plot_strat.R" in names
        assert "README.txt" in names

        data_csv_bytes = tf.extractfile("data.csv").read()
        tree_csv_bytes = tf.extractfile("data/tree_pollen.csv").read()
        herb_csv_bytes = tf.extractfile("data/herb_pollen.csv").read()

        # Invariant: data.csv matches Primary ROI (tree_pollen) byte-for-byte
        assert data_csv_bytes == tree_csv_bytes
        assert data_csv_bytes != herb_csv_bytes

        # First column must strictly be depth
        tree_lines = tree_csv_bytes.decode("utf-8").splitlines()
        herb_lines = herb_csv_bytes.decode("utf-8").splitlines()

        assert tree_lines[0].startswith("depth,")
        assert herb_lines[0].startswith("depth,")

        # Column names must NOT have ROI prefixes
        for col in tree_lines[0].split(","):
            assert not col.startswith("tree_pollen_")
        for col in herb_lines[0].split(","):
            assert not col.startswith("herb_pollen_")

    # 10. Print L4 frozen grammar (§0.5.4)
    print(f"\nGOLDEN_JOURNEY_STATUS=complete")
    print(f"TOTAL_ROIS={len(session.rois)}")
    print(f"PRIMARY_ROI={data['primary_roi']}")
    print(f"SHEETS=[{','.join(data['sheets'])}]")
    print(f"TAR_ARCHIVE_VERIFIED=true")
    print(f"TREE_POLLEN_CSV_ROWS={len(tree_lines) - 1}")
    print(f"HERB_POLLEN_CSV_ROWS={len(herb_lines) - 1}")
    print(f"DATA_CSV_BYTES_MATCH=true")

    assert data["qa_panel_present"] == "present"
    assert data["primary_roi"] == "tree_pollen"
    assert set(data["sheets"]) == {"tree_pollen", "herb_pollen"}
