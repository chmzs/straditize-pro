"""Regression tests for the T00-b probe (geometric x-axis tick detection).

These tests lock in the probe's *findings*, not just its happy path:

* the gate images must give 100% recall / 0 false positives in **both** band modes;
* a ruler is drawn **per column**, so spacing is uniform *within* a column and not
  across the strip -- the gate must use the per-column value;
* a figure with **no** tick ruler must report zero ticks (inventing them was the
  defect the probe caught in the ground truth);
* a column with fewer than two ticks must be reported unusable **with a reason**;
* the two implementation findings are pinned so nobody re-introduces them:
  (a) scoring candidate bands by *stroke count* selects the data area, and
  (b) 2-D connected components merge a connector-joined ruler into one component.

Run:  pixi run python -m pytest tests/test_probe_x_ticks.py -q
"""

from __future__ import annotations

import hashlib
import json

import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]

from support.probe_x_ticks import (  # noqa: E402
    GATE_KEYS,
    NON_GATE_KEYS,
    TICK_MAX_RUN,
    _find_tick_band,
    _per_column_spacing,
    detect_xticks,
)

TRUTH_DIR = ROOT / "tests" / "data" / "truth"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _load(key: str) -> tuple[np.ndarray, dict]:
    truth = json.loads((TRUTH_DIR / f"{key}__x_ticks.json").read_text(encoding="utf-8"))
    path = ROOT / truth["image"]
    return np.array(Image.open(path).convert("L")), truth


class TestGroundTruthIntegrity(unittest.TestCase):
    def test_images_match_recorded_sha256(self) -> None:
        for key in GATE_KEYS + NON_GATE_KEYS:
            with self.subTest(key=key):
                truth = json.loads(
                    (TRUTH_DIR / f"{key}__x_ticks.json").read_text(encoding="utf-8")
                )
                self.assertEqual(
                    _sha256(ROOT / truth["image"]),
                    truth["sha256"],
                    f"{key}: image changed without regenerating the ground truth",
                )

    def test_only_two_images_have_a_real_tick_ruler(self) -> None:
        """The other two were *wrong* in GT v1: their 'ticks' were long baselines.

        Pinned as a test so a regression to the loose band rule (bimodal only) is
        caught: that rule produced 35 and 13 fake ticks respectively.
        """
        rulers = {}
        for key in GATE_KEYS + NON_GATE_KEYS:
            truth = json.loads(
                (TRUTH_DIR / f"{key}__x_ticks.json").read_text(encoding="utf-8")
            )
            rulers[key] = truth["has_tick_ruler"]
        self.assertTrue(rulers["exaggeration_bell"])
        self.assertTrue(rulers["composite_cluster"])
        self.assertFalse(
            rulers["filled_silhouette"],
            "filled_silhouette has no tick ruler; GT v1 invented 35 ticks for it",
        )
        self.assertFalse(
            rulers["hoya"], "hoya has no tick ruler; GT v1 invented 13 ticks"
        )


class TestGateRecallAndFalsePositives(unittest.TestCase):
    def test_gate_images_perfect_in_both_band_modes(self) -> None:
        for key in GATE_KEYS:
            gray, truth = _load(key)
            gt = sorted(truth["ticks"])
            self.assertGreater(len(gt), 0)
            for label, band in (("auto", None), ("manual", tuple(truth["band"]))):
                with self.subTest(key=key, mode=label):
                    found = detect_xticks(gray, band)["ticks"]
                    missed = [x for x in gt if not any(abs(x - f) <= 1 for f in found)]
                    spurious = [
                        x for x in found if not any(abs(x - g) <= 1 for g in gt)
                    ]
                    self.assertEqual(missed, [], f"{key}[{label}] missed ticks")
                    self.assertEqual(spurious, [], f"{key}[{label}] invented ticks")
                    self.assertEqual(len(found), len(gt))

    def test_no_fabrication_when_the_figure_has_no_ruler(self) -> None:
        """A figure without a tick ruler must report zero ticks, not invented ones."""
        for key in NON_GATE_KEYS:
            gray, truth = _load(key)
            with self.subTest(key=key):
                self.assertFalse(truth["has_tick_ruler"])
                res = detect_xticks(gray, None)
                self.assertIsNone(res["band"])
                self.assertEqual(res["ticks"], [])


class TestSpacingIsUniformPerColumnNotGlobally(unittest.TestCase):
    def test_within_column_uniformity_is_high_while_global_is_not(self) -> None:
        """A ruler is drawn per column: gaps differ *between* columns by construction.

        Gating on global spacing was the probe's own early mistake (0.72/0.75);
        the per-column median must be ~1.0.
        """
        for key in GATE_KEYS:
            gray, truth = _load(key)
            res = detect_xticks(gray, tuple(truth["band"]))
            cols = _column_bounds(gray, key)
            per = _per_column_spacing(res["ticks"], cols)
            vals = [
                c["frac_within_15pct"]
                for c in per
                if c.get("frac_within_15pct") is not None
            ]
            with self.subTest(key=key):
                self.assertGreaterEqual(len(vals), 3, "too few columns with >=3 ticks")
                self.assertGreaterEqual(float(np.median(vals)), 0.9)
                # and the global figure really is *not* uniform, which is why the
                # per-column unit matters
                global_frac = res["spacing"]["frac_within_15pct"]
                self.assertLess(global_frac, float(np.median(vals)))


class TestPerColumnUnusableGuard(unittest.TestCase):
    def test_column_with_fewer_than_two_ticks_is_reported_unusable(self) -> None:
        gray, truth = _load("exaggeration_bell")
        res = detect_xticks(gray, tuple(truth["band"]))
        w = gray.shape[1]
        columns = [(0.0, 1.0), (1.0, 2.0), (float(w) * 0.4, float(w) * 0.9)]
        per = detect_xticks(gray, tuple(truth["band"]), columns=columns)["per_column"]

        empty = per[0]
        self.assertFalse(empty["usable"], "a column with 0 ticks must not be usable")
        self.assertTrue(empty["reason"], "an unusable column must carry a reason")

        rich = per[2]
        self.assertTrue(rich["usable"])
        self.assertGreaterEqual(rich["n"], 2)
        self.assertIsNone(rich["reason"])
        self.assertGreater(len(res["ticks"]), 0)


class TestPinnedImplementationFindings(unittest.TestCase):
    """The two things that *did not work*, pinned so they are not retried blindly."""

    def test_data_area_also_looks_bimodal_so_stroke_count_must_not_score(self) -> None:
        """Scoring candidate bands by stroke count picks the plot, not the ruler.

        In the bell figure the data area yields ~228 'strokes' against the real
        ruler's 80, because every column baseline is a short narrow stroke *within*
        a 9-row window. The discriminator is the **absolute** vertical run.
        """
        gray, truth = _load("exaggeration_bell")
        dark = gray < 160
        h = 9
        band_height = truth["band"][1] - truth["band"][0]

        def strokes_at(top: int) -> int:
            return int((dark[top : top + band_height, :].mean(axis=0) > 0.95).sum())

        def max_run_at(top: int) -> int:
            cols = np.where(dark[top : top + band_height, :].mean(axis=0) > 0.95)[0]
            y_ref = top + band_height // 2
            runs = []
            for x in cols:
                a = b = y_ref
                while a - 1 >= 0 and dark[a - 1, x]:
                    a -= 1
                while b + 1 < gray.shape[0] and dark[b + 1, x]:
                    b += 1
                runs.append(b - a + 1)
            return max(runs) if runs else 0

        data_top = truth["band"][0] - 90  # inside the plot
        ruler_top = truth["band"][0]
        self.assertGreater(
            strokes_at(data_top),
            strokes_at(ruler_top),
            "precondition of the finding: the data area has more 'strokes'",
        )
        self.assertGreater(max_run_at(data_top), TICK_MAX_RUN)
        self.assertLessEqual(max_run_at(ruler_top), TICK_MAX_RUN)
        # and the band search itself still finds the ruler (i.e. it is not simply
        # refusing everything and passing by accident)
        band = _find_tick_band(gray, band_height=h, dark_threshold=160)
        self.assertIsNotNone(band)
        self.assertLessEqual(abs(band[0] - ruler_top), 2)

    def test_connector_line_merges_the_comb_so_components_cannot_be_used(self) -> None:
        """A synthetic ruler with a connector line is one component, not N ticks."""
        from skimage.measure import label, regionprops

        img = np.full((60, 200), 255, dtype=np.uint8)
        # connector line + 10 ticks hanging from it
        img[20, 20:180] = 0
        for x in range(20, 180, 16):
            img[20:32, x] = 0

        dark = img < 128
        comps = list(regionprops(label(dark[18:34, :], connectivity=2)))
        self.assertEqual(
            len(comps),
            1,
            "connector + ticks form a single component, so 2-D components cannot "
            "enumerate ticks -- this is why the probe uses a column-wise pass",
        )
        # the column-wise pass does count them
        band = (20, 32)
        ticks = detect_xticks(img, band)["ticks"]
        self.assertGreaterEqual(len(ticks), 9)


def _column_bounds(gray: np.ndarray, key: str) -> list[tuple[float, float]]:
    """Real column bounds via the production detector (mirrors how T07 will work)."""
    from straditize_core.session import StraditizeSession

    truth = json.loads((TRUTH_DIR / f"{key}__x_ticks.json").read_text(encoding="utf-8"))
    sess = StraditizeSession()
    sess.load_image(str(ROOT / truth["image"]))
    h, w = gray.shape
    cols = sess.detect_columns(
        [int(w * 0.02), int(w * 0.995)], [int(h * 0.27), int(h * 0.96)]
    )
    return [(float(c["start"]), float(c["end"])) for c in cols]


if __name__ == "__main__":
    unittest.main()
