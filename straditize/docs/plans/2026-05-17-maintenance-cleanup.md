# Maintenance Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the tested dependency declarations and reduce low-risk deprecation and mutable-default warnings without changing digitization behavior.

**Architecture:** Keep the existing Python/PyQt5/psyplot architecture. Apply targeted source changes only, restrict the Pixi lint task to the source repository, and leave broad Ruff modernization for a separate reviewable effort.

**Tech Stack:** Python 3.12, Pixi, Ruff, pytest, Pillow, setuptools, pandas, xarray.

---

### Task 1: Align dependency declarations

**Files:**
- Modify: `README.rst`
- Modify: `setup.py`
- Modify: `../pixi.toml`

**Steps:**
1. Use version `0.2.2` consistently.
2. Align runtime bounds with the tested Pixi environment: Python 3.12, pandas `<3.0`, matplotlib `<3.11`, SciPy `<1.14`, xarray `<2025`, and matching lower bounds for serialization and GUI dependencies.
3. Document pandas 3.x as unsupported because NetCDF project serialization currently fails.
4. Restrict Pixi Ruff tasks to `straditize` so `.pixi` packages are not linted.

### Task 2: Remove low-risk Pillow and mutable-default warnings

**Files:**
- Modify: `straditize/binary.py`
- Modify: `straditize/colnames.py`
- Modify: `straditize/straditizer.py`
- Modify: `straditize/__main__.py`
- Modify: `straditize/widgets/colnames.py`
- Modify: `straditize/widgets/menu_actions.py`
- Modify: `straditize/evaluator.py`
- Modify: `straditize/widgets/stacked_area_reader.py`

**Steps:**
1. Remove deprecated Pillow `mode` arguments where RGBA array shape already determines the mode.
2. Replace mutable defaults for reader children, plotting keyword dictionaries, and evaluator labels with `None` and initialize locally.
3. Run focused tests, then the complete suite.

### Task 3: Verify and record remaining debt

**Commands:**
- `pixi run lint`
- `pixi run test`

**Expected:** Tests pass. Ruff reports only pre-existing behavioral/style debt in the source tree; the Pixi task must no longer scan `.pixi`.

**Follow-up:** Handle remaining Ruff categories in small groups with tests, not with an unreviewed repository-wide formatter run.
