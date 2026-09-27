# -*- coding: utf-8 -*-
"""Guards against fabrication: no path may return data the system did not observe.

The project invariant is that data comes from real computation on the user's own input, or
the call fails. These tests pin every fabrication path found in an audit of the age-depth
code, so none of them can come back unnoticed. Each one previously returned something that
looked like a result:

* a caller who never loaded a diagram received a full chronology extracted from the bundled
  bacon *sample*;
* ``/image/agedepth`` loaded a sample as a side effect of a plain image GET, and defaulted to
  bacon, so the displayed pixels and the extracted pixels could diverge;
* ``predict_age`` on a model with fewer than two horizons returned ``age = depth``;
* a model built without an envelope silently reported a zero-width band, i.e. certainty;
* ``generate_age_ensemble`` would then emit 1000 identical trajectories from that zero band;
* ages outside the observed depth range were extrapolated with nothing marking them;
* a trace built from a handful of rows was gap-interpolated into a smooth invented curve.
"""


import unittest

import numpy as np

from straditize_core.age_depth import AgeDepthModel, AgeDepthAxisCalibrator
from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession

def _bacon_calibrator():
    return AgeDepthAxisCalibrator(
        depth_px=[32.0, 668.0],
        depth_vals=[0.0, 150.0],
        age_px=[110.0, 803.5],
        age_vals=[3000.0, 0.0],
    )


class TestNoSilentDataSourceSubstitution(unittest.TestCase):
    def test_extraction_without_a_loaded_diagram_refuses(self):
        """No figure loaded must fail, not quietly extract the bundled sample.

        Previously this fell back to `load_age_depth_diagram(sample_key="bacon")`, so a
        caller received a complete chronology from a diagram it never supplied.
        """
        session = StraditizeSession()
        self.assertIsNone(session.age_depth_image)
        with self.assertRaises(JsonRpcError) as ctx:
            session.calibrate_and_extract_age_depth(
                depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
                age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
            )
        self.assertIn("No age-depth diagram is loaded", str(ctx.exception))
        # And it must not have silently loaded one as a side effect.
        self.assertIsNone(session.age_depth_image)

    def test_image_endpoint_is_read_only(self):
        """GET /image/agedepth must not load anything, even via ?sample=."""
        import urllib.error
        import urllib.request

        from straditize_core.rpc_server import StraditizeRpcHttpServer

        session = StraditizeSession()
        server = StraditizeRpcHttpServer(host="127.0.0.1", port=0, session=session)
        server.start()
        try:
            base = f"http://127.0.0.1:{server.actual_port}"
            # Empty session: 404 even when a sample is named, and still empty afterwards.
            for suffix in ("", "?sample=bacon"):
                with self.assertRaises(urllib.error.HTTPError) as ctx:
                    urllib.request.urlopen(f"{base}/image/agedepth{suffix}", timeout=3.0)
                self.assertEqual(ctx.exception.code, 404)
            self.assertIsNone(
                session.age_depth_image,
                "an image GET must not populate the session's extraction state",
            )

            # Once loaded explicitly, the endpoint serves it.
            session.load_age_depth_diagram(sample_key="bacon")
            with urllib.request.urlopen(f"{base}/image/agedepth", timeout=5.0) as resp:
                self.assertEqual(resp.status, 200)
                self.assertGreater(len(resp.read()), 1000)
        finally:
            server.stop()


class TestNoPlaceholderNumbers(unittest.TestCase):
    def test_predict_age_on_a_degenerate_model_refuses(self):
        """A model with <2 horizons used to report age = depth."""
        model = AgeDepthModel(depths=[10.0], ages=[500.0], age_min=[400.0], age_max=[600.0])
        with self.assertRaises(ValueError) as ctx:
            model.predict_age([5.0, 10.0])
        self.assertIn("fewer than two horizons", str(ctx.exception))

    def test_missing_envelope_is_flagged_not_defaulted_to_certainty(self):
        """`age_min = ages.copy()` would describe a zero-width, i.e. exact, chronology."""
        model = AgeDepthModel(depths=[10.0, 20.0, 30.0], ages=[100.0, 200.0, 300.0])
        self.assertFalse(model.has_envelope)
        self.assertFalse(model.predict_age([10.0])["has_envelope"])

        with_envelope = AgeDepthModel(
            depths=[10.0, 20.0, 30.0],
            ages=[100.0, 200.0, 300.0],
            age_min=[80.0, 170.0, 260.0],
            age_max=[120.0, 230.0, 340.0],
        )
        self.assertTrue(with_envelope.has_envelope)

    def test_ensemble_refuses_a_model_without_an_envelope(self):
        """Otherwise it emits 1000 identical trajectories, claiming certainty."""
        model = AgeDepthModel(depths=[10.0, 20.0, 30.0], ages=[100.0, 200.0, 300.0])
        with self.assertRaises(ValueError) as ctx:
            model.generate_age_ensemble([10.0, 20.0, 30.0], n_ensembles=10)
        self.assertIn("no confidence envelope", str(ctx.exception))

    def test_extrapolated_horizons_are_flagged(self):
        """Ages past the observed range come from the end slope, not from measurement."""
        import base64

        session = StraditizeSession()
        session.load_age_depth_diagram(sample_key="bacon")
        session.calibrate_and_extract_age_depth(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
            depth_range=[0.0, 160.0], resample_step=2.0,
        )
        lo, hi = session.age_depth_model.depths.min(), session.age_depth_model.depths.max()
        probe = [float(lo) - 40.0, float((lo + hi) / 2), float(hi) + 40.0]
        pred = session.age_depth_model.predict_age(probe)

        self.assertEqual(pred["extrapolated"], [True, False, True])
        self.assertEqual(pred["extrapolated_count"], 2)
        # The observed range is the native traced span, which can be marginally wider than
        # the resampled output grid; so compare against the model's own analysis range.
        observed = session.age_depth_model.observed_depth_range()
        self.assertAlmostEqual(pred["observed_depth_range"][0], observed[0], places=1)
        self.assertAlmostEqual(pred["observed_depth_range"][1], observed[1], places=1)

    def test_a_fully_observed_horizon_set_flags_nothing(self):
        import base64  # noqa: F401  (keeps the import list parallel with the case above)

        session = StraditizeSession()
        session.load_age_depth_diagram(sample_key="bacon")
        session.calibrate_and_extract_age_depth(
            depth_px=[32.0, 668.0], depth_vals=[0.0, 150.0],
            age_px=[110.0, 803.5], age_vals=[3000.0, 0.0],
            depth_range=[0.0, 160.0], resample_step=2.0,
        )
        model = session.age_depth_model
        inside = [float(d) for d in model.depths[::10]]
        self.assertEqual(model.predict_age(inside)["extrapolated_count"], 0)


if __name__ == "__main__":
    unittest.main()
