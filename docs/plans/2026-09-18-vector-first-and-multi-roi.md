# Vector-First Slicing, Multi-ROI & Manual Correction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Implement the "Vector-First, Continuous Analytical Slicing" engine with interactive human correction and Multi-ROI linked depth architecture, decoupling diagram resolution from sample density.

**Architecture:** 
1. `straditize_core/digitize.py`: Provide subpixel closed vector polygon generation from color/gray masks and Ray-Casting continuous horizontal slicing at arbitrary non-uniform sample depths.
2. `straditize_core/session.py`: Wire Vector-First polygon extraction into `digitize()` and `extract_horizon_consensus()`, maintaining sparse interactive control points for frontend canvas drag-and-drop manipulation.
3. `frontend/src/components/GeologyCanvas.ts` & `Sidebar.ts`: Render subpixel vector polygon overlay (Visual Ghosting), allow instant dragging/inserting/deleting of anchor points with real-time polygon reconstruction, and bind Multi-ROI depth bounds to the primary ROI Y-axis.

**Tech Stack:** Python 3.12, NumPy, SciPy, scikit-image, TypeScript, HTML5 Canvas 2D, Vite, Playwright.

---

### Task 1: Core Vector-First Slicing & Polygons in Python (`straditize_core/digitize.py`)

**Files:**
- Modify: `straditize_core/digitize.py`
- Create: `tests/test_vector_first_digitize.py`

**Step 1: Write the failing test**

Create `tests/test_vector_first_digitize.py`:
```python
import numpy as np
import pytest
from straditize_core.digitize import extract_vector_polygon, slice_vector_polygon_at_depths

def test_extract_vector_polygon_and_slicing():
    # Construct a synthetic triangular bump of height 60, width 30
    mask = np.zeros((100, 50), dtype=bool)
    for y in range(20, 80):
        w = int(30 * (1.0 - abs(y - 50) / 30.0))
        mask[y, :w] = True

    poly = extract_vector_polygon(mask, baseline_x=10.0)
    assert poly.ndim == 2
    assert poly.shape[1] == 2
    assert len(poly) >= 60

    # Analytical slicing at non-uniform depths
    sample_ys = [10.0, 35.0, 50.0, 65.0, 95.0]
    widths = slice_vector_polygon_at_depths(poly, sample_ys)
    assert len(widths) == 5
    assert widths[0] == 0.0
    assert widths[4] == 0.0
    assert widths[2] > widths[1]
    assert widths[2] > widths[3]
    assert pytest.approx(widths[2], abs=1.5) == 30.0
```

**Step 2: Run test to verify it passes/fails**

Run: `"I:/software_dev/straditize/.pixi/envs/default/python.exe" -m pytest tests/test_vector_first_digitize.py -v`

**Step 3: Refine implementation in `straditize_core/digitize.py`**

Ensure `extract_vector_polygon` and `slice_vector_polygon_at_depths` handle empty masks, non-continuous baseline boundaries, and extreme float coordinate inputs without NaN.

**Step 4: Commit**

```bash
git add tests/test_vector_first_digitize.py straditize_core/digitize.py
git commit -m "feat(core): add vector-first polygon extraction and analytical slicing engine"
```

---

### Task 2: Multi-Taxa Turning Point Horizon Consensus (`straditize_core/session.py`)

**Files:**
- Modify: `straditize_core/session.py:1550-1630`
- Test: `tests/test_horizon_consensus.py`

**Step 1: Write the failing test**

Create `tests/test_horizon_consensus.py`:
```python
import numpy as np
from straditize_core.session import StraditizeSession

def test_extract_horizon_consensus_on_synthetic_curves():
    sess = StraditizeSession()
    # Mock columns and column_points
    sess.columns = [
        {"id": "col_0", "col_index": 0, "start": 10.0, "end": 100.0, "name": "Taxa_A"},
        {"id": "col_1", "col_index": 1, "start": 120.0, "end": 200.0, "name": "Taxa_B"},
    ]
    # Both taxa have sharp turning points at rows 50, 120, 200
    rows = np.arange(0, 300)
    pts_a = [{"row": int(r), "x": 10.0 + 20.0 * np.exp(-((r - 50) / 10)**2) + 30.0 * np.exp(-((r - 200) / 15)**2)} for r in rows]
    pts_b = [{"row": int(r), "x": 120.0 + 15.0 * np.exp(-((r - 50) / 8)**2) + 25.0 * np.exp(-((r - 120) / 12)**2)} for r in rows]
    sess.column_points = {0: pts_a, 1: pts_b}

    res = sess.extract_horizon_consensus(tolerance_px=3.0, min_taxa_support=1)
    assert res["horizons_count"] >= 3
    found_rows = res["pixel_y"]
    assert any(abs(r - 50) <= 2 for r in found_rows)
    assert any(abs(r - 120) <= 2 for r in found_rows)
    assert any(abs(r - 200) <= 2 for r in found_rows)
```

**Step 2: Run test to verify**

Run: `"I:/software_dev/straditize/.pixi/envs/default/python.exe" -m pytest tests/test_horizon_consensus.py -v`

**Step 3: Implementation in `straditize_core/session.py`**

Confirm `extract_horizon_consensus` clusters peaks and valleys, maps pixel Y to calibrated depths, and gracefully registers under JSON-RPC `algorithm.extractHorizonConsensus`.

**Step 4: Commit**

```bash
git add tests/test_horizon_consensus.py straditize_core/session.py straditize_core/rpc_server.py
git commit -m "feat(core): implement multi-taxa turning point horizon consensus clustering"
```

---

### Task 3: Interactive Visual Polygon & Real-Time Correction in Frontend (`frontend/src/`)

**Files:**
- Modify: `frontend/src/components/GeologyCanvas.ts`
- Modify: `frontend/src/core/SplineInterpolator.ts`
- Modify: `frontend/src/components/Sidebar.ts`
- Modify: `frontend/src/components/Inspector.ts`

**Step 1: Frontend Model Update for Vector Contours**

In `frontend/src/types/pollen.ts`:
- Ensure `TaxaColumn` contains `vectorPolygon?: Point2D[]`.
- When user drags an anchor in `GeologyCanvas.ts`, update `controlPoints` AND recompute the closed vector polygon `SplineInterpolator.buildAreaPath(sortedPoints, col.startX)` so the rendered ghosting overlay moves in real time under the mouse cursor.

**Step 2: Interactive Correction Actions**
- **Left click on canvas**: add manual point, insert into column points, rebuild polygon, re-slice.
- **Drag anchor**: update point x/y, dynamically re-slice depth horizons, recompute percent.
- **Right click on anchor**: remove point, re-interpolate without that point.

**Step 3: Multi-ROI Sub-Panel Linking**
- In `Inspector.ts` and `GeologyCanvas.ts`, when creating a new ROI (`ROI 2`), lock `yMin` and `yMax` to `ROI 1`'s vertical bounds (`dataYMin`, `dataYMax`, `depthTopValue`, `depthBottomValue`), enabling purely horizontal X bounding box adjustments.

**Step 4: Test and Build Frontend**

Run: `pnpm --prefix frontend run test && pnpm --prefix frontend run build`

**Step 5: Commit**

```bash
git add frontend/
git commit -m "feat(ui): implement real-time vector polygon manipulation and multi-ROI Y-axis locking"
```

---

### Task 4: Real Browser Playwright End-to-End Validation

**Files:**
- Create/Update: `tests/verify_vector_first_and_roi_e2e.py`

**Step 1: Write Playwright E2E verification**
- Launch frontend in Edge.
- Load sample diagram.
- Verify vector polygon renders over raw silhouette.
- Add an anchor by clicking on canvas; assert anchor count increments.
- Drag anchor; verify visual ghosting polygon updates.
- Test Excel depth paste modal: input non-uniform sequence `[10.5, 22.0, 35.8, 60.0]`; assert depth grid lines update to exact non-uniform Y positions.

**Step 2: Run verification script**

Run: `"I:/software_dev/straditize/.pixi/envs/default/python.exe" tests/verify_vector_first_and_roi_e2e.py`

**Step 3: Commit & Update Documentation**

Update `HANDOFF.md` and commit.
