"""Age-depth model diagram recognition, extraction, and uncertainty mapping.

Provides scientific algorithms to:
1. Calibrate X (Age) and Y (Depth) axes of an age-depth diagram.
2. Extract the central best-fit line (Median / Weighted Mean Age) and 95% HPD confidence envelope.
3. Map pollen sample depth horizons to calendar ages with uncertainty bounds.
4. Support user metadata attributes (Median vs Mean, confidence levels, IntCal version).
5. Generate ready-to-run rbacon MCMC simulation scripts and LiPD-compatible structures.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any
import numpy as np
from PIL import Image
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import gaussian_filter, median_filter

from .calibration import LinearCalibration, LogCalibration


class AgeDepthAxisCalibrator:
    """Bi-directional coordinate calibration for age-depth model diagrams."""

    def __init__(
        self,
        depth_px: list[float],
        depth_vals: list[float],
        age_px: list[float],
        age_vals: list[float],
        depth_unit: str = "cm",
        age_unit: str = "cal BP",
        depth_log: bool = False,
        age_log: bool = False,
    ):
        """Builds bi-directional calibrations for the two axes of an age-depth diagram.

        Each axis is calibrated independently and may optionally use a logarithmic
        transform. Age axes on Bacon / Bchron output are linear in cal BP in the
        overwhelming majority of cases; the depth axis is likewise almost always
        linear, so both flags default to ``False``.
        """
        self.depth_log = bool(depth_log)
        self.age_log = bool(age_log)

        if self.depth_log:
            self.depth_cal = LogCalibration(depth_px, depth_vals, name="depth_axis")
        else:
            self.depth_cal = LinearCalibration(depth_px, depth_vals, name="depth_axis")

        if self.age_log:
            self.age_cal = LogCalibration(age_px, age_vals, name="age_axis")
        else:
            self.age_cal = LinearCalibration(age_px, age_vals, name="age_axis")

        self.depth_unit = depth_unit
        self.age_unit = age_unit

    def px2depth(self, py: float | np.ndarray) -> float | np.ndarray:
        return self.depth_cal.px2data(py)

    def depth2px(self, depth: float | np.ndarray) -> float | np.ndarray:
        return self.depth_cal.data2px(depth)

    def px2age(self, px: float | np.ndarray) -> float | np.ndarray:
        return self.age_cal.px2data(px)

    def age2px(self, age: float | np.ndarray) -> float | np.ndarray:
        return self.age_cal.data2px(age)


class AgeDepthModel:
    """Extracted age-depth model holding fitted curves, uncertainty envelopes, and metadata."""

    def __init__(
        self,
        depths: np.ndarray,
        ages: np.ndarray,
        age_min: np.ndarray | None = None,
        age_max: np.ndarray | None = None,
        curve_type: str = "median",
        envelope_type: str = "95_hpd",
        depth_unit: str = "cm",
        age_unit: str = "cal BP",
        cal_curve: str = "IntCal20",
        calibration_curve: str | None = None,
        notes: str = "",
        analysis_depths: np.ndarray | None = None,
        analysis_ages: np.ndarray | None = None,
        analysis_age_min: np.ndarray | None = None,
        analysis_age_max: np.ndarray | None = None,
        **kwargs: Any,
    ):
        """Builds a model over ``depths``/``ages``.

        ``analysis_*`` optionally supplies a *finer* sampling of the same underlying curve.
        The interpolators, and therefore everything derived from them (point predictions
        and the age-ensemble fit), are built from the analysis arrays when given, while
        ``depths``/``ages`` remain the reported output grid. Resampling the output must not
        change how the ensemble is generated -- otherwise a UI "step size" dropdown would
        silently alter the correlation length fitted from the figure.
        """
        if calibration_curve is not None:
            cal_curve = calibration_curve
        sort_idx = np.argsort(depths)
        self.depths = np.asarray(depths, dtype=float)[sort_idx]
        self.ages = np.asarray(ages, dtype=float)[sort_idx]

        # A missing envelope is tracked as missing rather than silently defaulted to the
        # median. `self.age_min = self.ages.copy()` would describe a ZERO-WIDTH envelope,
        # i.e. a chronology claimed to be exact, and every downstream consumer (the age
        # ensemble, the rate posterior, the exported 95% CI column) would report that
        # certainty as if it had been measured.
        if age_min is not None:
            self.age_min = np.asarray(age_min, dtype=float)[sort_idx]
        else:
            self.age_min = self.ages.copy()

        if age_max is not None:
            self.age_max = np.asarray(age_max, dtype=float)[sort_idx]
        else:
            self.age_max = self.ages.copy()

        self.has_envelope = age_min is not None and age_max is not None

        self.curve_type = curve_type  # 'median' | 'weighted_mean' | 'mode' | 'best_fit' | 'custom'
        self.envelope_type = envelope_type  # '95_hpd' | '68_ci' | 'custom'
        self.depth_unit = depth_unit
        self.age_unit = age_unit
        self.cal_curve = cal_curve
        self.notes = notes
        self.px_y: np.ndarray | None = None
        self.px_x_curve: np.ndarray | None = None
        self.px_x_min: np.ndarray | None = None
        self.px_x_max: np.ndarray | None = None
        #: Which response channel located the median line ("chroma" or "darkness").
        self.curve_channel: str = "darkness"
        self.curve_channel_reason: str = ""
        #: Fraction of the traced span that was actually observed rather than interpolated.
        self.observed_row_fraction: float = 0.0
        #: How the extraction search region was derived.
        self.roi_source: str = ""
        #: False when the model was built without an envelope, so its band is unknown
        #: rather than zero-width. Set where the envelope arguments are consumed above --
        #: assigning a default here would overwrite the computed value.
        self.has_envelope: bool

        # Interpolators are built from the finest sampling available.
        if analysis_depths is not None and np.asarray(analysis_depths).size >= 2:
            a_idx = np.argsort(analysis_depths)
            fit_depths = np.asarray(analysis_depths, dtype=float)[a_idx]
            fit_ages = np.asarray(analysis_ages, dtype=float)[a_idx]
            fit_min = np.asarray(analysis_age_min, dtype=float)[a_idx]
            fit_max = np.asarray(analysis_age_max, dtype=float)[a_idx]
        else:
            fit_depths, fit_ages = self.depths, self.ages
            fit_min, fit_max = self.age_min, self.age_max

        self.analysis_depths = fit_depths
        self.analysis_ages = fit_ages
        self.analysis_age_min = fit_min
        self.analysis_age_max = fit_max

        # Monotonic-preserving PCHIP interpolators
        if len(fit_depths) >= 2:
            self._interp_age = PchipInterpolator(fit_depths, fit_ages, extrapolate=True)
            self._interp_min = PchipInterpolator(fit_depths, fit_min, extrapolate=True)
            self._interp_max = PchipInterpolator(fit_depths, fit_max, extrapolate=True)
        else:
            self._interp_age = None
            self._interp_min = None
            self._interp_max = None

    def to_inspection_data(self) -> dict[str, Any]:
        """Serializes curves, pixel coordinates, and metadata for visual overlay check in UI.

        Every parallel array is decimated with the SAME stride so that a consumer may
        index any of them with a single position ``i``. Decimating only the pixel
        arrays (an earlier defect) silently misaligned the read-out depth and age by
        the stride factor on any diagram taller than 400 rows.
        """
        step = 1
        if self.px_y is not None and len(self.px_y) > 0:
            step = max(1, len(self.px_y) // 400)

        px_dict = None
        if self.px_y is not None and len(self.px_y) > 0:
            px_dict = {
                "y": [round(float(v), 1) for v in self.px_y[::step]],
                "x_curve": [round(float(v), 1) for v in self.px_x_curve[::step]],
                "x_min": [round(float(v), 1) for v in self.px_x_min[::step]],
                "x_max": [round(float(v), 1) for v in self.px_x_max[::step]],
            }

        return {
            "depths": [round(float(d), 2) for d in self.depths[::step]],
            "ages": [round(float(a), 2) for a in self.ages[::step]],
            "age_min": [round(float(a), 2) for a in self.age_min[::step]],
            "age_max": [round(float(a), 2) for a in self.age_max[::step]],
            "px_points": px_dict,
            "decimation_step": step,
            "metadata": {
                "curve_type": self.curve_type,
                "envelope_type": self.envelope_type,
                "depth_unit": self.depth_unit,
                "age_unit": self.age_unit,
                "calibration_curve": self.cal_curve,
                "notes": self.notes,
                "curve_channel": self.curve_channel,
                "curve_channel_reason": self.curve_channel_reason,
                "observed_row_fraction": self.observed_row_fraction,
                "roi_source": self.roi_source,
            },
        }


    def _median_rate(self, grid: np.ndarray) -> np.ndarray:
        """Median accumulation rate da/ddepth on ``grid``, floored strictly positive."""
        if self._interp_age is None:
            return np.ones_like(grid, dtype=float)
        rate = np.asarray(self._interp_age.derivative()(grid), dtype=float)
        positive = rate[rate > 0]
        floor = float(np.median(positive) * 0.05) if positive.size else 1e-3
        return np.maximum(rate, max(floor, 1e-9))

    def _envelope_width(self, grid: np.ndarray) -> np.ndarray:
        """Extracted 95% envelope width (age units) on ``grid``. Skewed-safe: |hi - lo|."""
        if self._interp_min is None or self._interp_max is None:
            return np.zeros_like(grid, dtype=float)
        hi = np.abs(np.asarray(self._interp_max(grid), dtype=float))
        lo = np.abs(np.asarray(self._interp_min(grid), dtype=float))
        width = np.abs(hi - lo)
        return np.maximum(width, 1e-6)

    def infer_correlation_length(self, grid: np.ndarray | None = None) -> float:
        """Estimates the age-offset correlation length in depth units.

        Between two dated horizons the age uncertainty is pinned near the dates and grows
        in between, so the envelope width shows a local minimum at each dated level. The
        typical spacing between those minima bounds how far an accumulation-rate
        perturbation stays coherent, which is exactly the correlation length of the
        rate process. Returns a seed only: :meth:`generate_age_ensemble` refines it by
        fitting the resulting envelope.

        Falls back to one fifth of the profile length when the width curve has too few
        resolvable minima to estimate a spacing.
        """
        if grid is None:
            grid = np.linspace(
                float(self.analysis_depths.min()), float(self.analysis_depths.max()), 200
            )
        grid = np.asarray(grid, dtype=float)
        span = float(grid[-1] - grid[0])
        width = self._envelope_width(grid)
        if span <= 0 or width.size < 9:
            return max(1.0, span / 5.0)

        # Light smoothing so single-pixel extraction noise cannot manufacture a minimum.
        smooth = median_filter(width, size=min(9, (width.size // 2) * 2 + 1))
        minima = [
            i
            for i in range(1, smooth.size - 1)
            if smooth[i] <= smooth[i - 1] and smooth[i] < smooth[i + 1]
        ]
        # Keep only *prominent* minima. A dated horizon pins the age and visibly narrows the
        # band; a shallow dip is extraction noise. Without this test a band drawn as many
        # thin ensemble lines produces dozens of spurious minima and a uselessly short L.
        prominent = []
        for i in minima:
            half = max(3, smooth.size // 12)
            lo = max(0, i - half)
            hi = min(smooth.size, i + half + 1)
            if float(smooth[i]) < 0.85 * float(smooth[lo:hi].max()):
                prominent.append(i)
        minima = prominent
        if len(minima) < 2:
            return max(1.0, span / 5.0)

        # Only count minima that are genuinely local: an envelope that merely wobbles
        # gives spacings far below the sampling scale and a useless estimate.
        spacing = np.diff(grid[minima])
        spacing = spacing[spacing > 0.02 * span]
        if spacing.size == 0:
            return max(1.0, span / 5.0)
        return float(np.clip(np.median(spacing) / 3.0, 0.02 * span, 0.5 * span))

    def _solve_amplitude(
        self,
        grid: np.ndarray,
        rate_base: np.ndarray,
        target_width: np.ndarray,
        corr_length: float,
        n_segments: int = 8,
    ) -> np.ndarray:
        """Piecewise-constant seed for the log-rate amplitude.

        The exact relation to invert is ``Var[a(d)] = <u, K_d u>`` with ``u = r*sigma``,
        which is quadratic in ``u`` and triangular in depth. Solving it directly by marching
        forward is tempting but degenerate: node 0 alone would have to supply the entire
        variance at the shallowest grid point, which demands a far larger ``sigma`` there
        than the rest of the profile, so the first node saturates a physical cap and every
        later node then solves to exactly zero.

        A low-dimensional parameterization avoids that failure mode entirely. ``sigma`` is
        held constant over ``n_segments`` equal-depth bands, so the eight unknowns are
        constrained by hundreds of residual equations and a damped update converges.
        """
        n = grid.size
        n_segments = int(np.clip(n_segments, 1, max(1, n // 4)))
        edges = np.linspace(0, n, n_segments + 1).astype(int)

        sigma_seg = np.full(n_segments, 0.05, dtype=float)
        sigma = np.repeat(sigma_seg, np.diff(edges))[:n]

        dist = np.abs(grid[:, None] - grid[None, :])
        corr = np.exp(-dist / max(corr_length, 1e-9))
        scale = max(float(np.median(target_width)), 1e-9)
        width_floor = 0.05 * target_width

        best = (sigma.copy(), float("inf"))
        for _ in range(10):
            kernel = corr * sigma[:, None] * sigma[None, :] + np.eye(n) * 1e-10
            try:
                chol = np.linalg.cholesky(kernel)
            except np.linalg.LinAlgError:
                sigma_seg = sigma_seg * 0.5
                sigma = np.repeat(sigma_seg, np.diff(edges))[:n]
                continue
            eta = np.clip(chol @ np.random.default_rng(7).standard_normal((n, 200)), -25.0, 25.0)
            ages = _cumulative_trapezoid(rate_base[:, None] * np.exp(eta), grid)
            sim_width = np.maximum(
                np.percentile(ages, 97.5, axis=1) - np.percentile(ages, 2.5, axis=1), width_floor
            )
            mismatch = float(np.sqrt(np.mean(((sim_width - target_width) / scale) ** 2)))
            if mismatch < best[1]:
                best = (sigma.copy(), mismatch)
            if mismatch < 0.05:
                break

            for seg in range(n_segments):
                lo, hi = edges[seg], edges[seg + 1]
                if hi <= lo:
                    continue
                ratio = float(np.median(target_width[lo:hi] / sim_width[lo:hi]))
                sigma_seg[seg] = float(
                    np.clip(sigma_seg[seg] * ratio ** 0.5, 1e-5, 1.5)
                )
            sigma = np.repeat(sigma_seg, np.diff(edges))[:n]

        return best[0]

    def _fit_ensemble_parameters(
        self,
        grid: np.ndarray,
        target_median: np.ndarray,
        target_width: np.ndarray,
        corr_length: float,
        n_members: int,
        iterations: int,
        rng: np.random.Generator,
        shared_offset_sigma: float = 0.0,
    ) -> tuple[np.ndarray, np.ndarray, float]:
        """Corrects the analytic amplitude solve for the lognormal nonlinearity.

        :meth:`_solve_amplitude` inverts a *linearised* rate model. ``exp(eta)`` is
        lognormal, so its higher moments inflate the realised variance; this pass measures
        the residual against a draw and damps the amplitude toward agreement. It starts
        from an already-good solution, so it converges instead of oscillating.

        Returns ``(sigma, rate_base, mismatch)``, keeping the best iterate seen because the
        two coupled corrections can still trade against each other.
        """
        rate_base = self._median_rate(grid)
        # Seed from the analytic one-pass solve, then correct for the lognormal
        # nonlinearity that the linearisation in _solve_amplitude drops.
        sigma = self._solve_amplitude(grid, rate_base, target_width, corr_length)

        dist = np.abs(grid[:, None] - grid[None, :])
        corr = np.exp(-dist / max(corr_length, 1e-9))

        target_rate = np.gradient(target_median, grid)
        pos = target_rate[target_rate > 0]
        rate_floor = (float(np.median(pos)) * 0.05) if pos.size else 1e-6
        target_rate = np.maximum(target_rate, rate_floor)

        # A width floor tied to the target keeps the amplitude ratio bounded where the
        # simulated band has not opened up yet.
        width_floor = 0.05 * target_width

        # Smoothing window for the amplitude update, in nodes. A 95% quantile estimated from
        # a few hundred members is noisy enough that an unsmoothed update would chase
        # sampling noise into the amplitude field.
        grid_step = float(np.median(np.diff(grid))) if grid.size > 1 else 1.0
        smooth_nodes = int(np.clip(round(max(corr_length, grid_step) / max(grid_step, 1e-9)), 1, 41))
        if smooth_nodes % 2 == 0:
            smooth_nodes += 1

        best_sigma = sigma.copy()
        best_rate = rate_base.copy()
        best_mismatch = float("inf")
        best_band = float(np.median(target_width))

        for _ in range(max(1, iterations)):
            kernel = corr * sigma[:, None] * sigma[None, :]
            kernel = kernel + np.eye(grid.size) * 1e-10
            try:
                chol = np.linalg.cholesky(kernel)
            except np.linalg.LinAlgError:
                sigma = sigma * 0.5
                continue

            # Clamping eta keeps exp() finite; a single overflow would turn sigma into NaN
            # and silently destroy the whole fit.
            eta = np.clip(chol @ rng.standard_normal((grid.size, n_members)), -25.0, 25.0)
            rate = rate_base[:, None] * np.exp(eta)
            ages = _cumulative_trapezoid(rate, grid)
            if shared_offset_sigma > 0:
                ages = ages + rng.standard_normal(n_members)[None, :] * shared_offset_sigma

            sim_median = np.median(ages, axis=1)
            sim_width = np.percentile(ages, 97.5, axis=1) - np.percentile(ages, 2.5, axis=1)
            if not (np.all(np.isfinite(sim_median)) and np.all(np.isfinite(sim_width))):
                # Discard a bad draw instead of feeding NaN back into the parameters.
                sigma = sigma * 0.5
                continue
            sim_width = np.maximum(sim_width, width_floor)

            # 1. Re-anchor the base rate so the simulated median tracks the target median.
            sim_rate = np.maximum(np.gradient(sim_median, grid), rate_floor)
            rate_base = rate_base * np.power(np.clip(target_rate / sim_rate, 0.2, 5.0), 0.6)

            # 2. Rescale the amplitude so the simulated band tracks the target band.
            ratio = np.clip(target_width / sim_width, 0.1, 10.0)
            updated = np.clip(sigma * np.power(ratio, 0.6), 1e-5, SIGMA_LOG_RATE_CAP)
            if smooth_nodes > 2:
                updated = median_filter(updated, size=smooth_nodes)
            sigma = updated

            # Scaled RMS relative to the *median* target width. Normalising per node would
            # blow up at the shallow end, where the extracted envelope is only a few pixels
            # wide and its width is the least reliable number in the whole fit.
            scale = max(float(np.median(target_width)), 1e-9)
            mismatch = float(np.sqrt(np.mean(((sim_width - target_width) / scale) ** 2)))

            # The two coupled corrections can oscillate, so keep the best iterate seen
            # rather than returning whichever one the loop happened to stop on.
            if mismatch < best_mismatch:
                best_mismatch = mismatch
                best_sigma = sigma.copy()
                best_rate = rate_base.copy()
                best_band = float(np.median(sim_width))

            if mismatch < 0.05:
                break

        return best_sigma, best_rate, best_mismatch, best_band

    def generate_age_ensemble(
        self,
        sample_depths: list[float] | np.ndarray,
        n_ensembles: int = 1000,
        name: str = "Age_Ensemble_1000",
        random_seed: int = 42,
        correlation_length: float | None = None,
        n_grid: int = 300,
        n_fit_members: int = 400,
        fit_iterations: int = 6,
        return_diagnostics: bool = False,
    ) -> dict[str, Any]:
        """Generates an age ensemble from the extracted median curve and 95% envelope.

        A Bacon / Bchron ensemble is a set of *correlated* age-depth trajectories, not a
        set of independent per-depth draws. Drawing independent noise reproduces the
        per-depth marginals while destroying the joint structure, which makes a whole
        curve shift coherently in reality but jitter incoherently in the output. Because
        the depth of a pollen feature is governed by that coherent shift, an independent
        ensemble systematically understates feature-level age uncertainty and biases any
        downstream propagation.

        So the ensemble is built in accumulation-rate space, exactly as Bacon itself does::

            r_i(d) = r_base(d) * exp(eta_i(d)),   eta ~ GP(0, sigma(d1)sigma(d2)exp(-|dd|/L))
            a_i(d) = shift_i + a_med(d0) + integral_{d0}^{d} r_i(s) ds

        Properties that follow by construction rather than by repair:

        * ages are strictly non-decreasing downcore (the integrand is positive), so no
          post-hoc ``maximum.accumulate`` projection is needed -- that repair was itself
          a one-sided upward bias whose size depended on the sampling step;
        * the correlation length ``L`` is a *physical depth*, so the same figure yields
          the same ensemble roughness at any resampling step;
        * ``exp`` of a Gaussian is right-skewed, matching the skew of real age posteriors
          near a core top or a hiatus, which a symmetric normal draw cannot express.

        ``sigma(d)`` is fitted iteratively until the simulated 95% band matches the
        extracted envelope, and ``L`` is chosen by a small search over candidates seeded
        by :meth:`infer_correlation_length`.

        Parameters
        ----------
        sample_depths:
            Depth horizons at which to report ages (typically the pollen sample levels).
        correlation_length:
            Override ``L`` in depth units. ``None`` fits it from the envelope shape.
        return_diagnostics:
            Attach the fitted ``correlation_length``, envelope mismatch, the fitted
            whole-curve offset, and the age-reversal rate (exactly zero by construction).
        """
        d_arr = np.asarray(sample_depths, dtype=float)
        if d_arr.size == 0 or self._interp_age is None:
            return {"name": name, "columns": ["depth"], "data": []}
        if not self.has_envelope:
            # Without a measured envelope there is nothing to spread the ensemble across.
            # Proceeding would emit 1000 identical trajectories, i.e. a fabricated claim of
            # certainty, which is worse than no ensemble at all.
            raise ValueError(
                "This age-depth model has no confidence envelope, so an age ensemble cannot "
                "be generated (all members would be identical copies of the median). "
                "Extract the figure including its 95% envelope first."
            )

        model_lo = float(np.min(self.analysis_depths))
        model_hi = float(np.max(self.analysis_depths))
        if model_hi - model_lo < 1e-9:
            return {"name": name, "columns": ["depth"], "data": []}

        grid = np.linspace(model_lo, model_hi, int(max(30, n_grid)))
        target_median = np.asarray(self._interp_age(grid), dtype=float)
        target_width = self._envelope_width(grid)

        rng = np.random.default_rng(random_seed)

        # ---- Fit the correlation length by envelope agreement -----------------
        if correlation_length is not None and correlation_length > 0:
            candidates = [float(correlation_length)]
        else:
            seed = self.infer_correlation_length(grid)
            span = model_hi - model_lo
            # The seed is a heuristic; the fit decides. The ladder brackets both the seed and
            # a few fractions of the profile so a bad seed cannot trap the search.
            candidates = sorted(
                {
                    float(np.clip(v, 0.01 * span, 0.75 * span))
                    for v in (
                        seed * 0.4,
                        seed * 0.7,
                        seed,
                        seed * 1.6,
                        seed * 2.5,
                        span / 40.0,
                        span / 20.0,
                        span / 10.0,
                        span / 5.0,
                    )
                }
            )

        best_L = candidates[0]
        best_sigma: np.ndarray | None = None
        best_rate: np.ndarray | None = None
        best_mismatch = float("inf")
        best_score = float("inf")
        best_band = 0.0
        target_band_ref = max(float(np.median(target_width)), 1e-9)
        for cand in candidates:
            sigma_c, rate_c, mismatch_c, band_c = self._fit_ensemble_parameters(
                grid,
                target_median,
                target_width,
                cand,
                n_fit_members,
                fit_iterations,
                np.random.default_rng(random_seed),
            )
            # Score shape AND magnitude. Shape alone is not a usable selector here: on the
            # bundled Bchron figure it preferred L=4.4 cm, whose realised band was 75% too
            # wide, over L=2.0 cm, which matched the band to 1%.
            magnitude_c = abs(band_c - target_band_ref) / target_band_ref
            score_c = mismatch_c + magnitude_c
            if score_c < best_score:
                best_score = score_c
                best_L = cand
                best_sigma = sigma_c
                best_rate = rate_c
                best_mismatch = mismatch_c
                best_band = band_c

        if best_sigma is None or best_rate is None:
            return {"name": name, "columns": ["depth"], "data": []}

        # ---- Shared whole-curve offset ----------------------------------------
        # Integration starts at the shallowest grid node, so the local rate process alone
        # cannot produce any spread there even though the extracted envelope has some.
        # The missing variance at that node is attributed to a systematic offset shared by
        # every depth (core-top age, reservoir effect, calibration shift) and the fit is
        # re-run with it in place so the amplitude accounts for it.
        def _draw(n: int, L: float, sigma: np.ndarray, rate_base: np.ndarray, shift: float):
            dist_m = np.abs(grid[:, None] - grid[None, :])
            corr_m = np.exp(-dist_m / max(L, 1e-9))
            kern = corr_m * sigma[:, None] * sigma[None, :] + np.eye(grid.size) * 1e-10
            eta_m = np.clip(
                np.linalg.cholesky(kern) @ rng.standard_normal((grid.size, n)), -25.0, 25.0
            )
            ages_m = _cumulative_trapezoid(rate_base[:, None] * np.exp(eta_m), grid)
            if shift > 0:
                ages_m = ages_m + rng.standard_normal(n)[None, :] * shift
            return ages_m

        probe = _draw(n_fit_members, best_L, best_sigma, best_rate, 0.0)
        probe_w0 = float(
            np.percentile(probe[0], 97.5) - np.percentile(probe[0], 2.5)
        )
        target_w0 = float(target_width[0])
        s_shift = float(
            np.sqrt(max(0.0, (target_w0 / 3.92) ** 2 - (probe_w0 / 3.92) ** 2))
        )

        if s_shift > 0:
            sigma_c, rate_c, mismatch_c, _band_c = self._fit_ensemble_parameters(
                grid,
                target_median,
                target_width,
                best_L,
                n_fit_members,
                fit_iterations,
                np.random.default_rng(random_seed),
                shared_offset_sigma=s_shift,
            )
            if mismatch_c < best_mismatch:
                best_mismatch = mismatch_c
                best_sigma = sigma_c
                best_rate = rate_c

        # ---- Final draw at the requested ensemble size ------------------------
        ages_grid = _draw(int(n_ensembles), best_L, best_sigma, best_rate, s_shift)

        # Anchor so the ensemble median reproduces the extracted median curve.
        # (The offset is symmetric, so the median of ages_grid[0] equals the anchor.)
        ages_grid = ages_grid + float(target_median[0])

        # Interpolate each member onto the requested sample depths.
        sample_matrix = np.empty((d_arr.size, int(n_ensembles)), dtype=float)
        for j in range(int(n_ensembles)):
            sample_matrix[:, j] = np.interp(d_arr, grid, ages_grid[:, j])

        # Chronological ordering holds by construction; assert it rather than repair it.
        reversal_rate = float((np.diff(sample_matrix, axis=0) < 0).mean())

        columns = ["depth"] + [f"iter_{k}" for k in range(1, int(n_ensembles) + 1)]
        rows = [
            [round(float(d), 2)] + [round(float(v), 2) for v in sample_matrix[i]]
            for i, d in enumerate(d_arr)
        ]

        # Per-sample rate posterior. The ensemble already lives in rate space, so the
        # member rates are free: differentiating each member's curve amplifies noise, which
        # is exactly why the rate is typically more uncertain than the age and why a point
        # estimate from the median curve should not be reported on its own.
        rate_stats = None
        if return_diagnostics:
            grid_rate = ages_grid.copy()
            # Member-wise interval rate over the grid, then resampled to the samples.
            d_grid = np.diff(grid)
            a_grid = np.diff(grid_rate, axis=0)
            with np.errstate(divide="ignore", invalid="ignore"):
                grid_acc = np.where(
                    np.abs(d_grid)[:, None] > 1e-12, a_grid / d_grid[:, None], np.nan
                )
            # A rate is a magnitude. Isotonic regression upstream fixes the sign
            # consistently (positive for BP axes, negative for AD axes), so take the
            # absolute value rather than leaking the age convention into the units.
            grid_acc = np.abs(grid_acc)
            member_acc = np.empty((d_arr.size, int(n_ensembles)), dtype=float)
            for j in range(int(n_ensembles)):
                col = grid_acc[:, j]
                member_acc[:, j] = np.interp(
                    d_arr, 0.5 * (grid[:-1] + grid[1:]), col, left=col[0], right=col[-1]
                )
            acc_lo = np.percentile(member_acc, 2.5, axis=1)
            acc_mid = np.median(member_acc, axis=1)
            acc_hi = np.percentile(member_acc, 97.5, axis=1)
            with np.errstate(divide="ignore", invalid="ignore"):
                sed_lo = np.where(acc_hi > 0, 1.0 / acc_hi, np.nan)
                sed_mid = np.where(acc_mid > 0, 1.0 / acc_mid, np.nan)
                sed_hi = np.where(acc_lo > 0, 1.0 / acc_lo, np.nan)

            def _c(v: np.ndarray) -> list[float | None]:
                # See predict_age._clean: an undefined rate is null, not zero.
                return [round(float(x), 4) if np.isfinite(x) else None for x in v]

            rate_stats = {
                "acc_rate_yr_per_depth": _c(acc_mid),
                "acc_rate_yr_per_depth_min": _c(acc_lo),
                "acc_rate_yr_per_depth_max": _c(acc_hi),
                "sed_rate_depth_per_yr": _c(sed_mid),
                "sed_rate_depth_per_yr_min": _c(sed_lo),
                "sed_rate_depth_per_yr_max": _c(sed_hi),
                # Volume accumulation rate per unit area (dimensionally the linear rate).
                "volume_ar_cm_per_yr": _c(sed_mid),
                "volume_ar_cm_per_yr_min": _c(sed_lo),
                "volume_ar_cm_per_yr_max": _c(sed_hi),
                "units": {
                    "acc_rate": f"{self.age_unit} per {self.depth_unit}",
                    "sed_rate": f"{self.depth_unit} per year",
                    "volume_ar": "cm per year (cm3 cm-2 yr-1)",
                },
            }

        result: dict[str, Any] = {"name": name, "columns": columns, "data": rows}
        if return_diagnostics:
            simulated_width = np.percentile(ages_grid, 97.5, axis=1) - np.percentile(
                ages_grid, 2.5, axis=1
            )
            scale = max(float(np.median(target_width)), 1e-9)
            # Versus the raw extracted envelope. This is deliberately large wherever the
            # figure's envelope narrows after a dated horizon: an un-pinned accumulation
            # process cannot shed variance, so those sections are reported conservatively
            # wide instead. The fitted figure is therefore the clamped (monotone) target,
            # and `envelope_mismatch` above measures agreement with *that*.
            raw_mismatch = float(
                np.sqrt(np.mean(((simulated_width - target_width) / scale) ** 2))
            )
            result["diagnostics"] = {
                "correlation_length": round(float(best_L), 3),
                "correlation_length_fitted": correlation_length is None,
                "envelope_mismatch": round(float(best_mismatch), 4),
                "envelope_mismatch_vs_extracted": round(raw_mismatch, 4),
                "shared_offset_sigma": round(float(s_shift), 3),
                "age_reversal_rate": reversal_rate,
                "simulated_envelope_median": round(float(np.median(simulated_width)), 2),
                "target_envelope_median": round(float(np.median(target_width)), 2),
                "median_curve_max_deviation": round(
                    float(
                        np.max(
                            np.abs(
                                np.interp(d_arr, grid, np.median(ages_grid, axis=1))
                                - np.interp(d_arr, grid, target_median)
                            )
                        )
                    ),
                    2,
                ),
            }
            if rate_stats is not None:
                result["diagnostics"]["rate"] = rate_stats
        return result

    def observed_depth_range(self) -> tuple[float, float]:
        """The depth span the curve was actually traced over, in ``depth_unit``.

        Requested horizons outside this span are extrapolated from the end slope rather than
        measured, which :meth:`predict_age` reports per row via ``extrapolated``.
        """
        if self.analysis_depths is None or len(self.analysis_depths) == 0:
            return (0.0, 0.0)
        return (float(np.min(self.analysis_depths)), float(np.max(self.analysis_depths)))

    def predict_age(
        self,
        sample_depths: list[float] | np.ndarray,
    ) -> dict[str, list[float]]:
        """Maps sample depths to ages, 95% uncertainty bounds, and sedimentation rates.

        Rate conventions, labelled explicitly because the literature is inconsistent:

        * ``acc_rate_yr_per_depth`` = d(age)/d(depth), in ``age_unit`` per ``depth_unit``.
          This is what an age-depth model natively yields and what pollen-accumulation
          work needs (time per unit depth).
        * ``sed_rate_depth_per_yr`` = its reciprocal, the conventional "sedimentation
          rate" in ``depth_unit`` per year.
        * ``volume_ar_cm_per_yr`` = the same number read as a volume accumulation rate.
          Per unit area, cm3 cm-2 yr-1 reduces dimensionally to cm/yr, so this is not a
          separate measurement -- it is the linear rate under a volume interpretation.
        Mass accumulation rate (MAR, g cm-2 yr-1) is deliberately absent: it needs a dry
        bulk density that varies per sample and cannot be read off an age-depth figure, so
        it stays the caller's own conversion from the volume rate.

        ``interval_*`` rates are also returned: the finite difference between consecutive
        sample horizons rather than a point derivative. A pollen count represents an
        interval, not an instant, so interval rates are usually the honest choice.

        Rate uncertainty is deliberately *not* reported here. It comes from
        :meth:`generate_age_ensemble`, where differentiating each member's curve gives a
        posterior; a point estimate from the median curve carries no uncertainty even
        though the rate is typically more uncertain than the age itself.
        """
        d_arr = np.asarray(sample_depths, dtype=float)
        if self._interp_age is None:
            # Refuse rather than return numbers. This branch used to report `age_est = depth`
            # (and zero rates), i.e. it handed back fabricated ages that looked like a
            # result. A model with fewer than two horizons has no curve to evaluate.
            raise ValueError(
                "This age-depth model holds fewer than two horizons, so no age, envelope or "
                "rate can be evaluated. Refusing rather than returning placeholder values."
            )

        age_est = self._interp_age(d_arr)
        age_min = self._interp_min(d_arr)
        age_max = self._interp_max(d_arr)

        # Mark horizons that fall outside the observed depth range. The interpolators
        # extrapolate, so these ages are invented from the end slope rather than measured,
        # and a consumer must be able to tell. This happens as soon as the requested depths
        # (a pollen sample grid, typically) reach past the extracted curve.
        observed_lo = float(np.min(self.analysis_depths))
        observed_hi = float(np.max(self.analysis_depths))
        extrapolated = (d_arr < observed_lo) | (d_arr > observed_hi)

        # Analytic PCHIP derivative: exact, and no finite-difference step to tune.
        slope = np.asarray(self._interp_age.derivative()(d_arr), dtype=float)
        # A rate is a magnitude. The sign is fixed by the age convention declared at
        # extraction time (positive for BP axes, negative for AD axes), so report the
        # absolute rate rather than leaking that convention into the units.
        slope = np.abs(slope)
        slope = np.where(slope < 1e-12, np.nan, slope)
        sed = np.where(np.isnan(slope), 0.0, 1.0 / slope)

        order = np.argsort(d_arr)
        d_sorted = d_arr[order]
        a_sorted = np.asarray(age_est, dtype=float)[order]
        d_delta = np.diff(d_sorted)
        a_delta = np.diff(a_sorted)
        with np.errstate(divide="ignore", invalid="ignore"):
            interval = np.where(np.abs(d_delta) > 1e-12, a_delta / d_delta, np.nan)
        interval = np.abs(interval)
        # Broadcast each interval onto its two bounding horizons (forward difference).
        interval_full = np.empty(len(d_arr), dtype=float)
        interval_full[:-1] = interval
        interval_full[-1] = interval[-1] if interval.size else np.nan
        inv_interval_full = np.empty(len(d_arr), dtype=float)
        interval_sorted_full = np.empty(len(d_arr), dtype=float)
        interval_sorted_full[:-1] = interval
        interval_sorted_full[-1] = interval[-1] if interval.size else np.nan
        with np.errstate(divide="ignore", invalid="ignore"):
            inv_interval_sorted = np.where(
                np.abs(interval_sorted_full) > 1e-12, 1.0 / interval_sorted_full, np.nan
            )
        # Undo the sort so every array is in the caller's original order.
        inv_order = np.empty_like(order)
        inv_order[order] = np.arange(order.size)
        interval_full = interval_sorted_full[inv_order]
        inv_interval_full = inv_interval_sorted[inv_order]

        def _clean(values: np.ndarray) -> list[float | None]:
            """Serialises rates, using ``None`` where a rate is undefined.

            Isotonic regression can pool horizons into a flat age segment, which means an
            instantaneous deposit: the accumulation rate is genuinely zero and its
            reciprocal is undefined. Reporting ``0.0`` there would claim "no deposition",
            the exact opposite, so undefined is emitted as ``null``.
            """
            return [round(float(v), 4) if np.isfinite(v) else None for v in values]

        return {
            "depths": [round(float(d), 2) for d in d_arr],
            "age_est": [round(float(a), 2) for a in age_est],
            "age_min": [round(float(a), 2) for a in age_min],
            "age_max": [round(float(a), 2) for a in age_max],
            "acc_rate_yr_per_depth": _clean(slope),
            "sed_rate_depth_per_yr": _clean(sed),
            # Volume accumulation rate per unit area: dimensionally the same as the
            # linear rate, exposed under its own name so the choice is explicit.
            "volume_ar_cm_per_yr": _clean(sed),
            "interval_acc_rate_yr_per_depth": _clean(interval_full),
            "interval_sed_rate_depth_per_yr": _clean(inv_interval_full),
            # Legacy key: same convention as acc_rate_yr_per_depth.
            "sed_rate_yr_per_cm": _clean(slope),
            "rate_units": {
                "acc_rate": f"{self.age_unit} per {self.depth_unit}",
                "sed_rate": f"{self.depth_unit} per year",
                "volume_ar": "cm per year (cm3 cm-2 yr-1)",
            },
            # Horizons outside the observed range are extrapolated from the end slope, not
            # measured. Flagged per row so a consumer can drop or mark them.
            "extrapolated": [bool(v) for v in extrapolated],
            "observed_depth_range": [round(observed_lo, 2), round(observed_hi, 2)],
            "extrapolated_count": int(extrapolated.sum()),
            "has_envelope": self.has_envelope,
            "metadata": {
                "curve_type": self.curve_type,
                "envelope_type": self.envelope_type,
                "depth_unit": self.depth_unit,
                "age_unit": self.age_unit,
                "calibration_curve": self.cal_curve,
                "notes": self.notes,
            },

        }


SIGMA_LOG_RATE_CAP = 0.8
"""Cap on the log-accumulation-rate standard deviation.

``exp(0.8) = 2.2`` already means the rate swings by more than a factor of two at one
sigma. A fit that wants more than this is not describing a plausible sediment core, so
the amplitude is capped and the resulting envelope mismatch is reported instead.
"""


def _cumulative_trapezoid(y: np.ndarray, x: np.ndarray) -> np.ndarray:
    """Cumulative trapezoidal integral along axis 0, anchored at zero.

    Implemented directly rather than via ``scipy.integrate`` because the function was
    renamed across SciPy releases (``cumtrapz`` -> ``cumulative_trapezoid``).
    """
    y = np.asarray(y, dtype=float)
    x = np.asarray(x, dtype=float)
    dx = np.diff(x)
    if y.ndim == 1:
        seg = 0.5 * (y[1:] + y[:-1]) * dx
        out = np.zeros_like(y)
        out[1:] = np.cumsum(seg)
        return out
    shape = (-1,) + (1,) * (y.ndim - 1)
    seg = 0.5 * (y[1:] + y[:-1]) * dx.reshape(shape)
    out = np.zeros_like(y)
    out[1:] = np.cumsum(seg, axis=0)
    return out


def _pava_increasing(values: np.ndarray) -> np.ndarray:
    """Pool-Adjacent-Violators isotonic regression onto the non-decreasing cone.

    Returns the least-squares non-decreasing fit of ``values``. Used to enforce the
    single strongest physical prior available for an age-depth model: age must never
    decrease downcore.
    """
    y = np.asarray(values, dtype=float)
    n = y.size
    if n == 0:
        return y

    levels: list[float] = []
    counts: list[int] = []
    for yi in y:
        levels.append(float(yi))
        counts.append(1)
        while len(levels) >= 2 and levels[-2] > levels[-1]:
            v_hi = levels.pop()
            c_hi = counts.pop()
            v_lo = levels.pop()
            c_lo = counts.pop()
            levels.append((v_lo * c_lo + v_hi * c_hi) / (c_lo + c_hi))
            counts.append(c_lo + c_hi)

    out = np.empty(n, dtype=float)
    pos = 0
    for level, count in zip(levels, counts):
        out[pos : pos + count] = level
        pos += count
    return out


def _contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Returns inclusive (start, end) index pairs of contiguous True runs."""
    idx = np.flatnonzero(mask)
    if idx.size == 0:
        return []
    breaks = np.flatnonzero(np.diff(idx) > 1)
    starts = np.concatenate(([0], breaks + 1))
    ends = np.concatenate((breaks, [idx.size - 1]))
    return [(int(idx[s]), int(idx[e])) for s, e in zip(starts, ends)]


def _otsu_threshold(values: np.ndarray, nbins: int = 128) -> float:
    """Otsu's between-class variance maximisation on a 1-D sample."""
    if values.size == 0:
        return 100.0
    lo, hi = float(values.min()), float(values.max())
    if hi - lo < 1e-6:
        return lo
    hist, edges = np.histogram(values, bins=nbins, range=(lo, hi))
    hist = hist.astype(float)
    total = hist.sum()
    if total <= 0:
        return lo
    centres = (edges[:-1] + edges[1:]) / 2.0
    weight_bg = np.cumsum(hist)
    weight_fg = total - weight_bg
    sum_total = float((hist * centres).sum())
    cum_mean = np.cumsum(hist * centres)
    valid = (weight_bg > 0) & (weight_fg > 0)
    if not valid.any():
        return lo
    mean_bg = np.divide(cum_mean, weight_bg, out=np.zeros_like(cum_mean), where=weight_bg > 0)
    mean_fg = np.divide(
        sum_total - cum_mean, weight_fg, out=np.zeros_like(cum_mean), where=weight_fg > 0
    )
    variance = weight_bg * weight_fg * (mean_bg - mean_fg) ** 2
    variance[~valid] = -1.0
    return float(centres[int(np.argmax(variance))])


def _detect_axis_rule_box(
    gray: np.ndarray, dark_thr: float = 120.0, span_frac: float = 0.5
) -> tuple[int, int, int, int] | None:
    """Bounds the drawn data area from the extents of the plot's axis rules.

    Users calibrate against *tick labels*, but the axis rules — and the drawn curve —
    routinely extend past the outermost tick. Using the rule extents as the search
    window recovers the full curve without asking the user to guess a margin.
    """
    h, w = gray.shape
    dark = gray < dark_thr
    rows = np.flatnonzero(dark.mean(axis=1) > span_frac)
    cols = np.flatnonzero(dark.mean(axis=0) > span_frac)
    if rows.size == 0 or cols.size == 0:
        return None

    x_lo, x_hi = w, -1
    for r in rows:
        xd = np.flatnonzero(dark[r])
        if xd.size:
            x_lo = min(x_lo, int(xd[0]))
            x_hi = max(x_hi, int(xd[-1]))
    y_lo, y_hi = h, -1
    for c in cols:
        yd = np.flatnonzero(dark[:, c])
        if yd.size:
            y_lo = min(y_lo, int(yd[0]))
            y_hi = max(y_hi, int(yd[-1]))

    if x_hi - x_lo < 20 or y_hi - y_lo < 20:
        return None
    return x_lo, y_lo, x_hi + 1, y_hi + 1


def _rule_box_holds_calibration(
    box: tuple[int, int, int, int],
    px_ages: list[float],
    px_depths: list[float],
    w: int,
    h: int,
    tol_frac: float = 0.02,
) -> bool:
    """Whether a detected rule box plausibly *is* this figure's plot area.

    The four calibration points sit on the plot's own axes, so any genuine data-area box
    must contain them (within a small tolerance for a point placed just outside a tick).
    This rejects a long rule found elsewhere on the figure -- a table border in a caption,
    a second panel -- which would otherwise hijack the search window.
    """
    x0, y0, x1, y1 = box
    tol_x = tol_frac * w
    tol_y = tol_frac * h
    for x in px_ages:
        if not (x0 - tol_x <= x <= x1 + tol_x):
            return False
    for y in px_depths:
        if not (y0 - tol_y <= y <= y1 + tol_y):
            return False
    return True


def extract_age_depth_model(
    image: Image.Image | np.ndarray,
    calibrator: AgeDepthAxisCalibrator,
    roi_box: tuple[int, int, int, int] | list[int] | None = None,
    curve_type: str = "median",
    envelope_type: str = "95_hpd",
    cal_curve: str = "IntCal20",
    notes: str = "",
    depth_range: tuple[float, float] | list[float] | None = None,
    resample_step: float | None = None,
    exclude_mask: np.ndarray | None = None,
    dark_threshold: float | None = None,
    loose_threshold: float = 240.0,
    enforce_monotonic: bool = True,
    age_increases_downcore: bool = True,
    curve_channel: str = "auto",
    retain_frac: float = 0.30,
) -> AgeDepthModel:
    """Extracts the central best-fit line and the uncertainty envelope from an age-depth diagram.

    An age-depth curve is a single-valued function of depth (one x per row) and is
    physically monotonic (age never decreases downcore). The extractor therefore works
    row by row instead of relying on global connected components, which collapse on
    every common Bacon / Bchron rendering:

    * a filled grey MCMC cloud fuses into one blob whose darker outline defeats a
      "darkest pixel per row" median estimator;
    * a Bchron-style plot drawn as many thin grey lines is not connected at all, so the
      largest component is an arbitrary single realisation;
    * a solid plot frame merges with the envelope and turns the per-row extent into the
      frame edges.

    The pipeline is:

    1. Clip the search window to the calibration rectangle, the depth range, and any
       caller-supplied exclusion mask.
    2. Erase long axis / grid lines detected as columns that are dark over most of the
       window height.
    3. Smooth vertically to bridge dashed envelope outlines.
    4. Per row, pick the contiguous run with the greatest integrated darkness under a
       dark threshold (the median line) and expand it under a loose threshold to obtain
       the envelope extent.
    5. Reject outliers against a running median, interpolate gaps (hiatuses), and apply
       isotonic regression so age is non-decreasing in depth.
    6. Optionally resample onto a regular depth grid.

    Parameters
    ----------
    image:
        Diagram PIL Image or NumPy RGB / greyscale array.
    calibrator:
        AgeDepthAxisCalibrator providing pixel-to-scientific conversions.
    roi_box:
        Optional (x0, y0, x1, y1) search window. Defaults to the calibration rectangle.
    depth_range:
        Optional (min_depth, max_depth) clip applied *in scientific depth units*,
        independent of the calibration points, so a user may calibrate against the full
        axis while extracting only the analysed section.
    resample_step:
        Optional regular depth grid spacing. ``None`` keeps the native per-row sampling.
    exclude_mask:
        Optional boolean array shaped like the image; ``True`` marks pixels to ignore
        (equivalent to an eraser brush over labels, legends or dating-point panels).
    dark_threshold:
        Darkness floor (0-255) selecting the median line. Auto-detected via Otsu if omitted.
    loose_threshold:
        Greyscale ceiling (0-255) used to bound the envelope extent.
    enforce_monotonic:
        Apply isotonic regression so extracted age is monotonic in depth.
    age_increases_downcore:
        Direction of that monotonicity. ``True`` for BP-style axes ("cal yr BP", "ka BP",
        "yr b2k"), which increase downcore; ``False`` for AD/CE-style axes, which increase
        upcore so age decreases downcore. Getting this wrong applies the prior backwards
        and flattens a valid chronology, so it is declared rather than guessed from the
        unit label.
    curve_channel:
        Which response locates the median line.

        ``"auto"`` (default) traces both the darkness and the chromatic channel and picks
        whichever covers more of the panel height, which is the right answer for the
        rendering styles seen so far. ``"chroma"`` / ``"darkness"`` force one channel, as a
        manual override for a figure where the automatic comparison picks wrong -- the
        chosen channel and the reason are reported on the returned model via
        ``curve_channel`` / ``curve_channel_reason``.
    retain_frac:
        Margin applied when the axis rules cannot be used, as a fraction of each calibrated
        span. Only a fallback: the primary search region comes from the axis rule extents
        and is deliberately independent of the calibration points.
    """
    if isinstance(image, Image.Image):
        img_arr = np.array(image.convert("RGB"))
    else:
        img_arr = np.asarray(image)

    h, w = img_arr.shape[:2]

    # ---- 0. Greyscale (needed before the search window can be derived) -------
    if img_arr.ndim == 3:
        gray_full = np.dot(img_arr[..., :3], [0.299, 0.587, 0.114]).astype(np.float32)
    else:
        gray_full = img_arr.astype(np.float32)

    # ---- 1. Determine the search window -------------------------------------
    px_ages = sorted(
        (float(calibrator.age_cal.px_points[0]), float(calibrator.age_cal.px_points[1]))
    )
    px_depths = sorted(
        (float(calibrator.depth_cal.px_points[0]), float(calibrator.depth_cal.px_points[1]))
    )

    if roi_box is not None:
        rx0, ry0, rx1, ry1 = (int(round(v)) for v in roi_box)
        roi_source = "caller-supplied roi_box"
    else:
        # The search region is the plot's own data area, derived from the axis rules and
        # INDEPENDENT of where the calibration points sit.
        #
        # This used to clamp the rule extent to at most `retain_frac` beyond the
        # calibration rectangle. That coupling is unjustified: the two calibration points
        # say what the pixels MEAN, not which part of the panel to read. It also failed
        # silently on the bundled Bacon figure, because a user picks two legible ticks
        # rather than the outermost ones:
        #
        #   ticks 3000/0     -> depth   0.0 .. 160.1,  age  -30 .. 2871   (full curve)
        #   ticks 2000/1000  -> depth  64.6 .. 148.8,  age  734 .. 2242   (upper 65 cm lost)
        #   ticks 1500/500   -> depth  25.7 .. 140.3,  age  208 .. 1791
        #
        # The truncation was horizontal, so rows whose curve fell outside the clamped
        # x-window found no candidates at all and dropped out vertically too; a generous
        # depth_range could not recover them.
        span_x = max(1.0, px_ages[1] - px_ages[0])
        span_y = max(1.0, px_depths[1] - px_depths[0])
        rule_box = _detect_axis_rule_box(gray_full)
        if rule_box is not None and _rule_box_holds_calibration(
            rule_box, px_ages, px_depths, w, h
        ):
            rx0, ry0, rx1, ry1 = rule_box
            roi_source = f"axis rule extents {rule_box}"
        else:
            # No usable rule box (a frame-less or very light rendering, or the detected
            # rules are something else on the figure): fall back to the calibration
            # rectangle plus a margin, and record that this weaker basis was used.
            margin_x = retain_frac * span_x
            margin_y = retain_frac * span_y
            rx0 = int(px_ages[0] - margin_x)
            rx1 = int(px_ages[1] + margin_x) + 1
            ry0 = int(px_depths[0] - margin_y)
            ry1 = int(px_depths[1] + margin_y) + 1
            roi_source = (
                "calibration rectangle + "
                f"{retain_frac:.0%} margin (no usable axis rules detected)"
            )

    rx0 = max(0, min(w - 1, rx0))
    rx1 = max(rx0 + 1, min(w, rx1))
    ry0 = max(0, min(h - 1, ry0))
    ry1 = max(ry0 + 1, min(h, ry1))

    # ---- 2. Clip vertically to the requested depth range --------------------
    if depth_range is not None and len(depth_range) == 2:
        d_lo, d_hi = sorted(float(v) for v in depth_range)
        py_a = float(calibrator.depth2px(d_lo))
        py_b = float(calibrator.depth2px(d_hi))
        ry0 = max(ry0, int(np.floor(min(py_a, py_b))))
        ry1 = min(ry1, int(np.ceil(max(py_a, py_b))) + 1)
        if ry1 - ry0 < 2:
            raise ValueError(
                f"Depth range {depth_range} maps to fewer than 2 pixel rows inside the "
                f"search window; check the depth calibration."
            )

    # ---- 3. Two response channels: darkness and chromatic ink ----------------
    dark = (255.0 - gray_full[ry0:ry1, rx0:rx1]).astype(np.float32)
    # Published age-depth figures very often draw the median as a *coloured* dashed line
    # (red is common) over a grey ensemble cloud whose outline is black-dashed. Collapsing
    # to greyscale throws away the only signal that separates them: red (255,0,0) is grey 76
    # while black is 0, so a darkness-only tracker locks onto the envelope outline and
    # traces a boundary instead of the median.
    #
    # The response is a projection onto the figure's own dominant chromatic direction, not
    # HSV chroma. Measured on a red-dashed figure: chroma along the line swings between 0
    # and 114 row to row (the dashes and the blend into the grey cloud both shrink it),
    # whereas R - mean(G,B) stays well separated from grey and recovers 777 of 843 rows at
    # a threshold of 12. Projecting rather than taking a magnitude keeps this hue-agnostic:
    # a blue or green median projects just as cleanly.
    if img_arr.ndim == 3:
        rgb = img_arr[..., :3].astype(np.int16)
        centred = rgb - rgb.mean(axis=2, keepdims=True)
        ink_mask = (rgb.max(axis=2) - rgb.min(axis=2)) > 25
        if ink_mask.sum() >= 50:
            direction = centred[ink_mask].mean(axis=0).astype(np.float32)
            norm = float(np.linalg.norm(direction))
            if norm > 1e-6:
                projected = centred.astype(np.float32) @ (direction / norm)
                chroma = np.clip(projected[ry0:ry1, rx0:rx1], 0.0, None)
            else:
                chroma = np.zeros_like(dark)
        else:
            chroma = np.zeros_like(dark)
    else:
        chroma = np.zeros_like(dark)

    # ---- 4. Exclusion mask (user eraser brush) ------------------------------
    if exclude_mask is not None:
        em = np.asarray(exclude_mask, dtype=bool)
        if em.shape[:2] == (h, w):
            dark[em[ry0:ry1, rx0:rx1]] = 0.0
            chroma[em[ry0:ry1, rx0:rx1]] = 0.0

    rh, rw = dark.shape
    if rh < 3 or rw < 3:
        raise ValueError("Search window is degenerate; recalibrate or widen the depth range.")

    # ---- 5. Erase long straight rules (plot frame, axis lines, grid lines) ---
    # A vertical rule spans nearly the full window height; a horizontal grid line spans
    # nearly the full width. The age-depth curve itself is never straight across the
    # whole panel, so both are safe to delete. Erased rows are recovered by interpolation.
    col_dark_frac = (dark > 60.0).mean(axis=0)
    long_v = col_dark_frac > 0.55
    if long_v.any():
        # Dilate by one column so the rule's anti-aliased shoulders go with it.
        widened = long_v.copy()
        widened[1:] |= long_v[:-1]
        widened[:-1] |= long_v[1:]
        dark[:, widened] = 0.0
        chroma[:, widened] = 0.0

    row_dark_frac = (dark > 60.0).mean(axis=1)
    long_h = row_dark_frac > 0.75
    if long_h.any():
        dark[long_h, :] = 0.0
        chroma[long_h, :] = 0.0

    # ---- 6. Vertical smoothing bridges dashed strokes -----------------------
    if rh >= 5:
        smoothed = gaussian_filter(dark, sigma=(1.6, 0.8))
        chroma_smoothed = gaussian_filter(chroma, sigma=(1.6, 0.8))
    else:
        smoothed = dark
        chroma_smoothed = chroma

    # Decide which channel locates the median line. Chroma is preferred when the figure
    # actually carries a chromatic stroke, which is detected as *narrow* high-chroma runs:
    # a plotted curve is a few pixels wide, whereas a colour key or lithology swatch is a
    # solid block. Without that width test, a figure with a big colour fill (a map, a
    # legend-heavy layout) would hand the tracker a meaningless chroma profile.
    use_chroma = False
    chroma_mode_reason = "figure carries no chromatic stroke"
    chroma_available = float(chroma.max()) > 60.0

    # ---- 7. Thresholds -----------------------------------------------------
    if dark_threshold is None:
        sample = smoothed[smoothed > 12.0]
        dark_threshold = _otsu_threshold(sample) if sample.size else 90.0
        # Otsu on a mostly-empty profile tends to land too low; keep it in a sane band.
        dark_threshold = float(np.clip(dark_threshold, 45.0, 170.0))
    thr_dark = float(dark_threshold)
    thr_loose = float(255.0 - loose_threshold)
    if thr_loose >= thr_dark:
        thr_loose = max(8.0, thr_dark * 0.35)

    # The curve-selection threshold applies to whichever channel locates the median.
    # Chroma and darkness have different scales, so the darkness threshold must not be
    # reused for a chroma profile.
    if chroma_available:
        chromatic_sample = chroma_smoothed[chroma_smoothed > 20.0]
        thr_chroma = (
            float(np.clip(_otsu_threshold(chromatic_sample), 45.0, 190.0))
            if chromatic_sample.size
            else 60.0
        )
    else:
        thr_chroma = thr_dark

    # ---- 8. Per-row profile extraction --------------------------------------
    def trace_curve(
        channel: np.ndarray, thr: float, half_window: int
    ) -> tuple[list[int], list[float], list[float], list[float]]:
        """Traces the median line row by row, then measures the envelope around it.

        Candidate runs on a row are restricted to those nearly as strong as the strongest
        feature on that row; among them the tracker follows the run closest to the previous
        accepted position. Tracking continuity (rather than maximising integrated response)
        is what keeps the trace on the median line where the curve runs steeply and a single
        row crosses many columns.

        ``channel``/``thr`` select which response locates the median. The envelope is always
        measured from ``smoothed`` (darkness), because the MCMC cloud and its outline are
        grey and contribute nothing to chroma.
        """
        # Collect candidate runs per row from the curve channel.
        candidates: dict[int, list[tuple[float, float, int, int]]] = {}
        row_peaks = np.zeros(rh, dtype=float)
        for row in range(rh):
            prof = channel[row]
            row_peak = float(prof.max())
            row_peaks[row] = row_peak
            if row_peak < max(20.0, thr * 0.55):
                # Nothing strong enough: a genuine gap (hiatus) or blank margin.
                continue
            runs = _contiguous_runs(prof >= thr)
            keep: list[tuple[float, float, int, int]] = []
            for r0, r1 in runs:
                seg = prof[r0 : r1 + 1]
                peak = float(seg.max())
                if peak < 0.8 * row_peak:
                    continue
                weights = np.maximum(seg - thr * 0.5, 0.0)
                if weights.sum() <= 0:
                    centroid = (r0 + r1) / 2.0
                else:
                    centroid = float(r0 + (weights * np.arange(seg.size)).sum() / weights.sum())
                keep.append((centroid, peak, r0, r1))
            if keep:
                candidates[row] = keep

        if not candidates:
            return [], [], [], []

        # Bootstrap on the candidate with the greatest vertical support. The age-depth
        # curve spans the plot height, whereas an inline title or legend is a few rows
        # tall, so support cleanly separates them; darkness alone would happily lock onto
        # a bold text label sitting near the top of the panel.
        support_window = int(np.clip(rh // 8, 12, 45))
        reach_tol = max(8.0, rw * 0.05)

        def vertical_support(row: int, centroid: float) -> int:
            count = 0
            lo = max(0, row - support_window)
            hi = min(rh - 1, row + support_window)
            for other in range(lo, hi + 1):
                if other == row:
                    continue
                reach = reach_tol + 0.6 * abs(other - row)
                for cand in candidates.get(other, ()):
                    if abs(cand[0] - centroid) <= reach:
                        count += 1
                        break
            return count

        best_start: tuple[int, float] | None = None
        best_score: tuple[int, float] = (-1, -1.0)
        for row, cands in candidates.items():
            for cand in cands:
                score = (vertical_support(row, cand[0]), cand[1])
                if score > best_score:
                    best_score = score
                    best_start = (row, cand[0])

        if best_start is None:
            return [], [], [], []
        start, start_centroid = best_start
        chosen: dict[int, float] = {start: start_centroid}

        max_jump = max(6.0, rw * 0.05)
        for direction in (1, -1):
            anchor = chosen[start]
            last_row = start
            stop = rh if direction > 0 else -1
            for row in range(start + direction, stop, direction):
                if row not in candidates:
                    continue
                nearest = min(candidates[row], key=lambda c: abs(c[0] - anchor))
                span = max(1, abs(row - last_row))
                if abs(nearest[0] - anchor) > max_jump * span:
                    # Too far from the established track: hold position and keep scanning.
                    continue
                chosen[row] = nearest[0]
                anchor = nearest[0]
                last_row = row

        # Measure the envelope around each accepted row.
        # Deliberately reads the DARKNESS channel even in chroma mode: the MCMC cloud and
        # its outline are grey, so they contribute nothing to chroma and would give a
        # zero-width band. Chroma locates the median; darkness measures the spread.
        rows_out: list[int] = []
        curve_out: list[float] = []
        min_out: list[float] = []
        max_out: list[float] = []
        for row in sorted(chosen):
            centroid = chosen[row]
            prof = smoothed[row]
            mid_lo = int(np.floor(centroid))
            mid_hi = int(np.ceil(centroid))
            lo = max(0, mid_lo - half_window)
            hi = min(rw - 1, mid_hi + half_window)
            left = np.flatnonzero(prof[lo : mid_lo + 1] >= thr_loose)
            right = np.flatnonzero(prof[mid_hi : hi + 1] >= thr_loose)
            env_min = float(lo + left[0]) if left.size else centroid
            env_max = float(mid_hi + right[-1]) if right.size else centroid

            rows_out.append(row)
            curve_out.append(centroid)
            min_out.append(min(env_min, centroid))
            max_out.append(max(env_max, centroid))

        return rows_out, curve_out, min_out, max_out

    # Decide which response locates the median by *measuring* both, not by thresholding
    # proxy statistics. A chromatic stroke can be either the plotted curve or a set of
    # dating-point probability bars, and both are thin; what separates them is how much of
    # the panel height each one spans. Tracing both channels with a generous window and
    # comparing how many rows each covers decides it directly.
    #
    # Measured on the bundled figures: a red dashed median covers 70% as many rows as the
    # darkness trace, while blue dating-point bars reach only 23% -- a 3x separation, so the
    # cut sits at 0.55 with margin on both sides. A heuristic thickness test alone picked
    # chroma for the dating-bar figure and dragged the trace along the wrong feature.
    generous = max(2, int(round(rw * 0.45)))
    row_idx, x_curve, x_min, x_max = trace_curve(smoothed, thr_dark, generous)
    use_chroma = False
    chroma_mode_reason = "figure carries no chromatic stroke"

    forced = str(curve_channel or "auto").lower()
    if forced not in ("auto", "chroma", "darkness"):
        raise ValueError(
            f"curve_channel must be 'auto', 'chroma' or 'darkness' (got {curve_channel!r})."
        )
    if forced == "chroma" and not chroma_available:
        raise ValueError(
            "curve_channel='chroma' was requested, but this figure carries no chromatic "
            "stroke (no pixel deviates enough from grey). Use 'auto' or 'darkness'."
        )

    if chroma_available:
        c_rows, c_curve, c_min, c_max = trace_curve(chroma_smoothed, thr_chroma, generous)
        span_ratio = len(c_rows) / max(1, len(row_idx))
        auto_prefers_chroma = len(c_rows) >= 5 and span_ratio >= 0.55

        if forced == "chroma":
            if len(c_rows) < 5:
                raise ValueError(
                    f"curve_channel='chroma' was requested, but the chromatic trace found "
                    f"only {len(c_rows)} usable rows. Try 'auto' or 'darkness'."
                )
            row_idx, x_curve, x_min, x_max = c_rows, c_curve, c_min, c_max
            use_chroma = True
            chroma_mode_reason = (
                f"forced to chroma by the caller; automatic selection would have "
                f"{'chosen it' if auto_prefers_chroma else f'rejected it (row ratio {span_ratio:.2f})'}"
            )
        elif forced == "darkness":
            chroma_mode_reason = (
                "forced to darkness by the caller; automatic selection would have "
                f"{'chosen chroma (row ratio ' + format(span_ratio, '.2f') + ')' if auto_prefers_chroma else f'rejected chroma (row ratio {span_ratio:.2f})'}"
            )
        elif auto_prefers_chroma:
            row_idx, x_curve, x_min, x_max = c_rows, c_curve, c_min, c_max
            use_chroma = True
            chroma_mode_reason = (
                f"chromatic stroke spans {len(c_rows)} rows vs {len(row_idx)} for darkness"
            )
        else:
            chroma_mode_reason = (
                f"chromatic strokes span only {len(c_rows)} rows vs {len(row_idx)} for "
                f"darkness (ratio {span_ratio:.2f}); chromatic pixels are probably dating "
                f"distributions or a legend, not the median line"
            )
    elif forced == "darkness":
        chroma_mode_reason = "forced to darkness by the caller"

    # Tighten the envelope window once the median channel is settled.
    if len(row_idx) >= 5:
        observed = 0.5 * (np.asarray(x_max) - np.asarray(x_min))
        typical = float(np.median(observed))
        if typical > 0:
            tightened = int(np.clip(np.ceil(typical * 3.0) + 4, 6, max(6, generous)))
            ch = chroma_smoothed if use_chroma else smoothed
            th = thr_chroma if use_chroma else thr_dark
            row2, curve2, min2, max2 = trace_curve(ch, th, tightened)
            if len(row2) >= 5:
                row_idx, x_curve, x_min, x_max = row2, curve2, min2, max2

    if len(row_idx) < 5:
        raise ValueError(
            "Age-depth extraction found fewer than 5 usable rows. Verify the four "
            "calibration points sit on the plot axes and that the depth range overlaps "
            "the drawn curve."
        )

    # ---- 9. Outlier rejection against a running median ----------------------
    rows_arr = np.asarray(row_idx, dtype=float)
    curve_arr = np.asarray(x_curve, dtype=float)
    min_arr = np.asarray(x_min, dtype=float)
    max_arr = np.asarray(x_max, dtype=float)

    win = min(31, len(curve_arr) // 2 * 2 + 1)
    if win >= 5:
        baseline = median_filter(curve_arr, size=win)
        tol = max(6.0, 0.06 * rw)
        keep = np.abs(curve_arr - baseline) <= tol
        if keep.sum() >= 5:
            rows_arr, curve_arr = rows_arr[keep], curve_arr[keep]
            min_arr, max_arr = min_arr[keep], max_arr[keep]

    # Rows the tracer actually observed, before any gap interpolation. Everything below
    # measures against this, because after interpolation the array is contiguous by
    # construction and any coverage statistic computed on it reads a meaningless 100%.
    observed_rows = int(rows_arr.size)
    observed_span = float(rows_arr.max() - rows_arr.min() + 1.0) if rows_arr.size else 0.0
    observed_fraction = observed_rows / max(1.0, observed_span)

    # Refuse a trace that is mostly interpolation. A handful of surviving rows over a tall
    # panel produces a smooth-looking curve that is almost entirely invented between them,
    # and nothing downstream can tell. Measured on real figures, a genuine trace observes
    # at least ~55% of its own span, so 0.35 leaves room for genuinely dashed or broken
    # curves while catching "the channel found 36 rows out of 680".
    if rows_arr.size and observed_fraction < 0.35:
        raise ValueError(
            f"The '{'chroma' if use_chroma else 'darkness'}' channel only observed "
            f"{observed_rows} of {int(observed_span)} rows ({observed_fraction:.0%}); the "
            f"rest would be interpolated rather than traced. Try the other channel, widen "
            f"the depth range, or mark the problem region with the eraser."
        )

    # ---- 10. Interpolate the gaps onto every row in the window --------------
    full_rows = np.arange(rows_arr.min(), rows_arr.max() + 1, dtype=float)
    curve_f = np.interp(full_rows, rows_arr, curve_arr)
    min_f = np.interp(full_rows, rows_arr, min_arr)
    max_f = np.interp(full_rows, rows_arr, max_arr)

    if win >= 5:
        curve_f = median_filter(curve_f, size=win)
        min_f = median_filter(min_f, size=win)
        max_f = median_filter(max_f, size=win)

    # Row / column indices above are relative to the search window; the calibrator and
    # the canvas overlay both work in absolute image pixels, so offset them back.
    abs_rows = full_rows + float(ry0)
    abs_curve = curve_f + float(rx0)
    abs_min = min_f + float(rx0)
    abs_max = max_f + float(rx0)

    # ---- 11. Convert to scientific units -----------------------------------
    phys_depths = np.asarray(calibrator.px2depth(abs_rows), dtype=float)
    phys_ages = np.asarray(calibrator.px2age(abs_curve), dtype=float)
    phys_age_lo = np.asarray(calibrator.px2age(abs_min), dtype=float)
    phys_age_hi = np.asarray(calibrator.px2age(abs_max), dtype=float)

    true_min = np.minimum(phys_age_lo, phys_age_hi)
    true_max = np.maximum(phys_age_lo, phys_age_hi)

    # ---- 12. Enforce monotonic age versus depth ----------------------------
    order = np.argsort(phys_depths)
    depths_sorted = phys_depths[order]
    ages_sorted = phys_ages[order]
    min_sorted = true_min[order]
    max_sorted = true_max[order]

    # The prior is "age moves monotonically with depth", but *which way* depends on the age
    # convention, not just on the depth axis. A BP-style axis ("cal yr BP", "ka BP", "b2k")
    # increases downcore; an AD/CE-style axis increases upcore, so age decreases downcore.
    # Assuming BP for an AD figure would apply isotonic regression in the wrong direction
    # and flatten a valid chronology into a ramp, so the caller declares the convention.
    depth_increases_downward = calibrator.depth_cal.px2data(1.0) >= calibrator.depth_cal.px2data(0.0)
    ascending = depth_increases_downward == bool(age_increases_downcore)

    if enforce_monotonic and ages_sorted.size >= 3:
        # Guard against a misdeclared age direction. Isotonic regression happily "fixes"
        # data that runs the other way by flattening it, which would return a degenerate
        # constant chronology with no signal that anything was wrong. Check the raw trend
        # against the declaration first and refuse instead.
        raw_diffs = np.diff(ages_sorted)
        agreement = (
            float((raw_diffs >= 0).mean()) if ascending else float((raw_diffs <= 0).mean())
        )
        if agreement < 0.55:
            declared = "increases" if age_increases_downcore else "decreases"
            observed = "decreases" if float((raw_diffs >= 0).mean()) < 0.5 else "increases"
            raise ValueError(
                f"Declared age direction contradicts the figure: the calibration says age "
                f"{declared} downcore, but the extracted curve {observed} downcore "
                f"({agreement:.0%} of adjacent horizons agree). Check whether the age axis "
                f"is BP-style (increasing downcore) or AD/CE-style (increasing upcore), or "
                f"whether the two age calibration points are swapped."
            )

        target = ages_sorted if ascending else ages_sorted[::-1]
        fitted = _pava_increasing(target)
        ages_sorted = fitted if ascending else fitted[::-1]

        # Rebuild the envelope around the regularised median, then re-impose ordering.
        centre = ages_sorted
        lo = np.minimum(min_sorted, centre)
        hi = np.maximum(max_sorted, centre)
        # The envelope must be ordered the same way; otherwise a wiggle can invert it.
        if ascending:
            min_sorted = _pava_increasing(lo)
            max_sorted = _pava_increasing(hi)
            max_sorted = np.maximum(max_sorted, centre)
        else:
            min_sorted = _pava_increasing(lo[::-1])[::-1]
            max_sorted = _pava_increasing(hi[::-1])[::-1]
            max_sorted = np.maximum(max_sorted, centre)

    # Restore the original row order so pixel tracks stay aligned with the serialized arrays.
    inv = np.empty_like(order)
    inv[order] = np.arange(order.size)
    phys_depths = depths_sorted[inv]
    phys_ages = ages_sorted[inv]
    true_min = min_sorted[inv]
    true_max = max_sorted[inv]

    model = AgeDepthModel(
        depths=phys_depths,
        ages=phys_ages,
        age_min=true_min,
        age_max=true_max,
        curve_type=curve_type,
        envelope_type=envelope_type,
        depth_unit=calibrator.depth_unit,
        age_unit=calibrator.age_unit,
        cal_curve=cal_curve,
        notes=notes,
    )
    model.px_y = abs_rows
    model.px_x_curve = abs_curve
    model.px_x_min = abs_min
    model.px_x_max = abs_max
    # Which response located the median, for diagnostics and for the UI to report honestly
    # when a figure fell back to darkness despite carrying colour.
    model.curve_channel = "chroma" if use_chroma else "darkness"
    model.curve_channel_reason = chroma_mode_reason
    # Fraction of the traced span the channel actually observed; the remainder is
    # interpolated. Reported so a mostly-interpolated curve is visible rather than silent.
    model.observed_row_fraction = round(float(observed_fraction), 4)
    #: How the search region was derived, so a fallback to the weaker basis is visible.
    model.roi_source = roi_source

    # ---- 13. Optional regular depth grid -----------------------------------
    if resample_step is not None and float(resample_step) > 0:
        step = float(resample_step)
        if depth_range is not None and len(depth_range) == 2:
            d_lo, d_hi = sorted(float(v) for v in depth_range)
        else:
            d_lo = float(np.min(model.depths))
            d_hi = float(np.max(model.depths))

        # Never resample outside the depth range actually traced: the pixel tracks cannot
        # be interpolated beyond the rows the curve occupies.
        traced_lo = float(np.min(model.depths))
        traced_hi = float(np.max(model.depths))
        d_lo = max(d_lo, traced_lo)
        d_hi = min(d_hi, traced_hi)

        n_pts = int(np.floor((d_hi - d_lo) / step)) + 1
        if n_pts >= 2:
            grid = d_lo + step * np.arange(n_pts, dtype=float)
            pred = model.predict_age(grid)
            resampled = AgeDepthModel(
                depths=grid,
                ages=np.asarray(pred["age_est"], dtype=float),
                age_min=np.asarray(pred["age_min"], dtype=float),
                age_max=np.asarray(pred["age_max"], dtype=float),
                curve_type=curve_type,
                envelope_type=envelope_type,
                depth_unit=calibrator.depth_unit,
                age_unit=calibrator.age_unit,
                cal_curve=cal_curve,
                notes=notes,
                # Keep the figure's native sampling for interpolation and ensemble fitting:
                # the requested step is an output format, not a property of the diagram.
                analysis_depths=model.depths,
                analysis_ages=model.ages,
                analysis_age_min=model.age_min,
                analysis_age_max=model.age_max,
            )
            # Resample the pixel tracks onto the SAME grid. Keeping the native-resolution
            # tracks here would leave px_points and depths at different lengths, and a
            # consumer indexing one with the other's position would silently mis-read.
            grid_rows = np.asarray(calibrator.depth2px(grid), dtype=float)
            resampled.px_y = grid_rows
            resampled.px_x_curve = np.interp(grid_rows, model.px_y, model.px_x_curve)
            resampled.px_x_min = np.interp(grid_rows, model.px_y, model.px_x_min)
            resampled.px_x_max = np.interp(grid_rows, model.px_y, model.px_x_max)
            # Diagnostics must survive resampling too, otherwise a caller reading
            # `curve_channel` off a resampled model silently gets the class default.
            resampled.curve_channel = model.curve_channel
            resampled.curve_channel_reason = model.curve_channel_reason
            resampled.observed_row_fraction = model.observed_row_fraction
            resampled.roi_source = model.roi_source
            return resampled

    return model


def generate_bacon_script(
    core_name: str,
    dates: list[dict[str, Any]],
    thickness: float = 5.0,
    cc: int = 1,
    sample_depths: list[float] | None = None,
    hiatus_depths: list[float] | None = None,
    hiatus_max: float | None = None,
    slumps: list[list[float]] | list[tuple[float, float]] | None = None,
    d_r: float | None = None,
    d_std: float | None = None,
    acc_mean: float | None = None,
    mem_mean: float = 0.7,
) -> str:
    """Generates an automated rbacon R modeling script supporting complex stratigraphic phenomena.

    Parameters
    ----------
    core_name:
        Name of the sediment core.
    dates:
        List of radiocarbon dates with keys: 'id', 'age', 'error', 'depth', 'thickness'.
    thickness:
        Bacon section thickness (default: 5 cm).
    cc:
        Calibration curve (1 = IntCal20 Northern Hemisphere, 2 = Marine20, 3 = SHCal20, 0 = Non-14C).
    sample_depths:
        Optional list of depths to evaluate and extract full MCMC ensembles.
    hiatus_depths:
        Optional list of depths (cm) where sedimentary hiatuses / unconformities occurred.
    hiatus_max:
        Prior maximum duration of the hiatus in years (default in Bacon: 10000).
    slumps:
        List of [top, bottom] depth intervals representing instantaneous events (tephra, turbidite, slump).
    d_r, d_std:
        Local carbon reservoir offset (Delta R) and uncertainty in 14C years.
    acc_mean:
        Optional user override for prior accumulation rate (yr/cm). If None, Bacon auto-estimates from dates.
    mem_mean:
        Memory/autocorrelation prior (0.1 to 0.9, default 0.7).
    """
    csv_rows = ["id,age,error,depth,thickness"]
    for d in dates:
        csv_rows.append(
            f"{d.get('id', 'Date')},{d.get('age', 0)},{d.get('error', 0)},{d.get('depth', 0)},{d.get('thickness', 1)}"
        )
    csv_payload = "\\n".join(csv_rows)

    depths_snippet = ""
    if sample_depths:
        d_str = ", ".join(str(round(d, 2)) for d in sample_depths)
        depths_snippet = f"""
# Depths requested for pollen sample harmonization
target_depths <- c({d_str})
write.table(target_depths, file.path(core_dir, "{core_name}_depths.txt"), row.names=FALSE, col.names=FALSE)
"""

    extra_args = []
    if hiatus_depths:
        h_str = ", ".join(str(round(h, 2)) for h in hiatus_depths)
        extra_args.append(f"hiatus.depths=c({h_str})")
        if hiatus_max:
            extra_args.append(f"hiatus.max={hiatus_max}")

    if slumps:
        s_parts = []
        for s in slumps:
            s_parts.append(f"c({s[0]}, {s[1]})")
        extra_args.append(f"slump=c({', '.join(s_parts)})")

    if d_r is not None and d_std is not None:
        extra_args.append(f"d.R={d_r}, d.STD={d_std}")

    if acc_mean is not None:
        extra_args.append(f"acc.mean={acc_mean}")

    if mem_mean != 0.7:
        extra_args.append(f"mem.mean={mem_mean}")

    extra_args_str = ", " + ", ".join(extra_args) if extra_args else ""

    return f"""# ==============================================================================
# Automated Bayesian Age-Depth Modelling with rbacon (Blaauw & Christen 2011)
# Core: {core_name}
# ==============================================================================

if (!requireNamespace("rbacon", quietly=TRUE)) {{
  message("Package 'rbacon' is not installed. Installing from CRAN...")
  install.packages("rbacon", repos="https://cloud.r-project.org")
}}
library(rbacon)

core_dir <- file.path("Cores", "{core_name}")
dir.create(core_dir, recursive=TRUE, showWarnings=FALSE)

# 1. Write dating information
csv_content <- "{csv_payload}"
cat(csv_content, file=file.path(core_dir, "{core_name}.csv"))
{depths_snippet}
# 2. Run Bacon MCMC modelling with stratigraphic controls
message("Running Bacon Bayesian MCMC modeling (default 1,500,000 iterations)...")
info <- Bacon("{core_name}", thick={thickness}, cc={cc}, depths.file={str(bool(sample_depths)).upper()}, ask=FALSE, run=TRUE{extra_args_str})

# 3. Output summary statistics and sample age estimates
message("Age-depth modeling complete. Results saved to: ", file.path(core_dir, "{core_name}_ages.txt"))
"""


def generate_geochronr_script(
    lipd_file_name: str,
    site_name: str = "PollenSite",
    thickness: float = 5.0,
    hiatus_depths: list[float] | None = None,
) -> str:
    """Generates downstream R script for geoChronR (McKay et al. 2021) native integration."""
    hiatus_str = ""
    if hiatus_depths:
        h_str = ", ".join(str(round(h, 2)) for h in hiatus_depths)
        hiatus_str = f", hiatus.depths=c({h_str})"

    return f"""# ==============================================================================
# Downstream Bayesian Chronology Integration with geoChronR (McKay et al. 2021)
# Reads Straditize Pro LiPD Container and runs Bacon/Bchron MCMC
# ==============================================================================

if (!requireNamespace("geoChronR", quietly=TRUE)) {{
  message("Installing geoChronR and lipdR from GitHub / CRAN...")
  if (!requireNamespace("remotes", quietly=TRUE)) install.packages("remotes")
  remotes::install_github("nickmckay/geoChronR")
}}
library(geoChronR)

# 1. Load Straditize Pro LiPD File
lipd_file <- "{lipd_file_name}"
message("Reading LiPD package: ", lipd_file)
L <- readLipd(lipd_file)

# 2. Run Bacon MCMC Age Modeling natively on LiPD chronData
message("Running geoChronR::runBacon...")
L <- runBacon(L, thick={thickness}{hiatus_str})

# 3. Map MCMC Age Ensemble directly onto Pollen PaleoData
message("Mapping age ensemble to pollen matrix...")
L <- mapAgeEnsembleToPaleoData(L, age.var="age")

# 4. Diagnostic Plot
plotChron(L)

# 5. Export Updated LiPD package with full MCMC ensemble
writeLipd(L, path=dirname(lipd_file))
message("Updated LiPD container with MCMC age ensembles successfully saved!")
"""


def find_rscript() -> str | None:
    """Finds Rscript executable via PATH or common Windows / Unix installation paths."""
    import shutil
    import sys

    p = shutil.which("Rscript")
    if p:
        return p
    if sys.platform == "win32":
        candidates = [
            r"D:\Program Files\R\R\bin\Rscript.exe",
            r"C:\Program Files\R\R\bin\Rscript.exe",
            r"D:\Program Files\R\R-4.5.3\bin\Rscript.exe",
            r"C:\Program Files\R\R-4.5.3\bin\Rscript.exe",
            r"C:\Program Files\R\R-4.5.0\bin\Rscript.exe",
            r"C:\Program Files\R\R-4.4.2\bin\Rscript.exe",
            r"C:\Program Files\R\R-4.4.0\bin\Rscript.exe",
        ]
        for cand in candidates:
            if os.path.isfile(cand):
                return cand
    return None


def check_local_r_environment() -> dict[str, Any]:
    """Detects local R installation and available geochronology packages (rbacon, geoChronR)."""
    import subprocess

    rscript_path = find_rscript()
    if not rscript_path:
        return {
            "has_r": False,
            "rscript_path": None,
            "has_rbacon": False,
            "has_geochronr": False,
            "r_version": None,
        }

    cmd = [
        rscript_path,
        "-e",
        "cat(R.version.string, '\\n'); cat('rbacon:', requireNamespace('rbacon', quietly=TRUE), '\\n'); cat('geoChronR:', requireNamespace('geoChronR', quietly=TRUE), '\\n')",
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8.0, check=False)
        out = res.stdout
        has_rbacon = "rbacon: TRUE" in out
        has_geochronr = "geoChronR: TRUE" in out
        version_line = out.splitlines()[0] if out.splitlines() else "R"

        return {
            "has_r": True,
            "rscript_path": rscript_path,
            "has_rbacon": has_rbacon,
            "has_geochronr": has_geochronr,
            "r_version": version_line,
        }
    except Exception:
        return {
            "has_r": True,
            "rscript_path": rscript_path,
            "has_rbacon": False,
            "has_geochronr": False,
            "r_version": "Unknown",
        }


def run_local_bacon(
    dates: list[dict[str, Any]],
    core_name: str = "MyCore",
    thickness: float = 5.0,
    cc: int = 1,
    hiatus_depths: list[float] | None = None,
    slumps: list[tuple[float, float]] | None = None,
    d_r: float | None = None,
    d_std: float | None = None,
    depth_min: float = 0.0,
    depth_max: float = 150.0,
    depth_step: float = 1.0,
) -> dict[str, Any]:
    """Runs native rbacon MCMC simulation via local system Rscript (2~3s native speed)."""
    import subprocess
    import tempfile

    r_env = check_local_r_environment()
    if not r_env.get("has_r") or not r_env.get("has_rbacon"):
        return {
            "success": False,
            "has_local_r": r_env.get("has_r", False),
            "has_rbacon": r_env.get("has_rbacon", False),
            "error": "本地未安装 R 或缺少 rbacon 包，请通过增量包使用内置 WebR 算力。",
        }

    rscript_path = r_env["rscript_path"]
    with tempfile.TemporaryDirectory() as tmp_dir:
        cores_dir = Path(tmp_dir) / "Bacon_runs"
        core_dir = cores_dir / core_name
        core_dir.mkdir(parents=True, exist_ok=True)

        # 1. Generate core_name.csv
        csv_path = core_dir / f"{core_name}.csv"
        csv_rows = ["id,age,error,depth,cc"]
        for d in dates:
            d_id = str(d.get("id", "14C"))
            d_age = float(d.get("age", 0))
            d_err = float(d.get("error", 30))
            d_depth = float(d.get("depth", 0))
            d_cc = int(d.get("cc", cc))
            csv_rows.append(f"{d_id},{d_age},{d_err},{d_depth},{d_cc}")
        csv_path.write_text("\n".join(csv_rows) + "\n", encoding="utf-8")

        # 2. Build R runner script
        r_script_path = Path(tmp_dir) / "run_bacon.R"
        out_tsv_path = Path(tmp_dir) / "bacon_output.tsv"

        hiatus_arg = f"c({', '.join(map(str, hiatus_depths))})" if hiatus_depths else "NA"
        dr_val = float(d_r) if d_r is not None else 0.0
        dr_std = float(d_std) if d_std is not None else 0.0

        r_code = f"""
suppressPackageStartupMessages(library(rbacon))
coredir <- "{str(cores_dir).replace(chr(92), '/')}"
core_name <- "{core_name}"
thick <- {thickness}
hiatus_vec <- {hiatus_arg}
dr <- {dr_val}
dr_std <- {dr_std}
out_tsv <- "{str(out_tsv_path).replace(chr(92), '/')}"

tryCatch({{
    Bacon(
        core=core_name,
        thick=thick,
        coredir=coredir,
        hiatus.depths=hiatus_vec,
        delta.R=dr,
        delta.STD=dr_std,
        ask=FALSE,
        suggest=FALSE,
        run=TRUE,
        plot.pdf=FALSE,
        ssize=2000,
        verbose=FALSE
    )

    d_seq <- seq({depth_min}, {depth_max}, by={depth_step})
    ages_mat <- sapply(d_seq, function(d) {{
        ag <- tryCatch(Bacon.Age.d(d, BCAD=FALSE), error=function(e) numeric(0))
        if(length(ag) < 2) return(c(NA, NA, NA))
        c(stats::median(ag, na.rm=TRUE), stats::quantile(ag, probs=c(0.025, 0.975), na.rm=TRUE))
    }})

    df_out <- data.frame(
        depth=d_seq,
        age=as.numeric(ages_mat[1, ]),
        age_min=as.numeric(ages_mat[2, ]),
        age_max=as.numeric(ages_mat[3, ])
    )

    if(any(is.na(df_out$age))) {{
        valid_idx <- which(!is.na(df_out$age))
        if(length(valid_idx) >= 2) {{
            df_out$age <- stats::approx(df_out$depth[valid_idx], df_out$age[valid_idx], xout=df_out$depth, rule=2)$y
            df_out$age_min <- stats::approx(df_out$depth[valid_idx], df_out$age_min[valid_idx], xout=df_out$depth, rule=2)$y
            df_out$age_max <- stats::approx(df_out$depth[valid_idx], df_out$age_max[valid_idx], xout=df_out$depth, rule=2)$y
        }}
    }}

    write.table(df_out, file=out_tsv, sep="\\t", row.names=FALSE, quote=FALSE)
}}, error=function(e) {{
    cat("BACON_FATAL_ERROR:", conditionMessage(e), "\\n")
}})
"""
        r_script_path.write_text(r_code, encoding="utf-8")

        # 3. Execute via subprocess
        try:
            cmd = [rscript_path, str(r_script_path)]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30.0, check=False)
            if out_tsv_path.is_file():
                depths, ages, age_min, age_max = [], [], [], []
                lines = out_tsv_path.read_text(encoding="utf-8").strip().splitlines()
                if len(lines) > 1:
                    for line in lines[1:]:
                        parts = line.split("\t")
                        if len(parts) >= 4:
                            try:
                                depths.append(round(float(parts[0]), 1))
                                ages.append(round(float(parts[1]), 1))
                                age_min.append(round(float(parts[2]), 1))
                                age_max.append(round(float(parts[3]), 1))
                            except ValueError:
                                continue

                if depths and ages:
                    return {
                        "success": True,
                        "backend": "local_r",
                        "engine": f"rbacon native ({r_env['r_version']})",
                        "depths": depths,
                        "ages": ages,
                        "age_min": age_min,
                        "age_max": age_max,
                        "metadata": {
                            "curve_type": "median",
                            "envelope_type": "95_hpd",
                            "engine": "rbacon (native R)",
                            "r_version": r_env["r_version"],
                            "depth_unit": "cm",
                            "age_unit": "cal BP",
                            "calibration_curve": "IntCal20" if cc == 1 else f"cc_{cc}",
                        },
                    }
            return {
                "success": False,
                "error": proc.stderr or proc.stdout or "Bacon execution produced no output TSV",
            }
        except Exception as e:
            return {"success": False, "error": f"R execution failed: {e}"}

    return {"success": False, "error": "Bacon execution produced no output"}
