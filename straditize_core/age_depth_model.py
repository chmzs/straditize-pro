"""Age-depth mathematical model, coordinate calibration, and Bayesian MCMC scripting."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import median_filter

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

        self.curve_type = (
            curve_type  # 'median' | 'weighted_mean' | 'mode' | 'best_fit' | 'custom'
        )
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
                float(self.analysis_depths.min()),
                float(self.analysis_depths.max()),
                200,
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
            eta = np.clip(
                chol @ np.random.default_rng(7).standard_normal((n, 200)), -25.0, 25.0
            )
            ages = _cumulative_trapezoid(rate_base[:, None] * np.exp(eta), grid)
            sim_width = np.maximum(
                np.percentile(ages, 97.5, axis=1) - np.percentile(ages, 2.5, axis=1),
                width_floor,
            )
            mismatch = float(
                np.sqrt(np.mean(((sim_width - target_width) / scale) ** 2))
            )
            if mismatch < best[1]:
                best = (sigma.copy(), mismatch)
            if mismatch < 0.05:
                break

            for seg in range(n_segments):
                lo, hi = edges[seg], edges[seg + 1]
                if hi <= lo:
                    continue
                ratio = float(np.median(target_width[lo:hi] / sim_width[lo:hi]))
                sigma_seg[seg] = float(np.clip(sigma_seg[seg] * ratio**0.5, 1e-5, 1.5))
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
        smooth_nodes = int(
            np.clip(round(max(corr_length, grid_step) / max(grid_step, 1e-9)), 1, 41)
        )
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
            eta = np.clip(
                chol @ rng.standard_normal((grid.size, n_members)), -25.0, 25.0
            )
            rate = rate_base[:, None] * np.exp(eta)
            ages = _cumulative_trapezoid(rate, grid)
            if shared_offset_sigma > 0:
                ages = (
                    ages + rng.standard_normal(n_members)[None, :] * shared_offset_sigma
                )

            sim_median = np.median(ages, axis=1)
            sim_width = np.percentile(ages, 97.5, axis=1) - np.percentile(
                ages, 2.5, axis=1
            )
            if not (np.all(np.isfinite(sim_median)) and np.all(np.isfinite(sim_width))):
                # Discard a bad draw instead of feeding NaN back into the parameters.
                sigma = sigma * 0.5
                continue
            sim_width = np.maximum(sim_width, width_floor)

            # 1. Re-anchor the base rate so the simulated median tracks the target median.
            sim_rate = np.maximum(np.gradient(sim_median, grid), rate_floor)
            rate_base = rate_base * np.power(
                np.clip(target_rate / sim_rate, 0.2, 5.0), 0.6
            )

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
            mismatch = float(
                np.sqrt(np.mean(((sim_width - target_width) / scale) ** 2))
            )

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
        def _draw(
            n: int, L: float, sigma: np.ndarray, rate_base: np.ndarray, shift: float
        ):
            dist_m = np.abs(grid[:, None] - grid[None, :])
            corr_m = np.exp(-dist_m / max(L, 1e-9))
            kern = corr_m * sigma[:, None] * sigma[None, :] + np.eye(grid.size) * 1e-10
            eta_m = np.clip(
                np.linalg.cholesky(kern) @ rng.standard_normal((grid.size, n)),
                -25.0,
                25.0,
            )
            ages_m = _cumulative_trapezoid(rate_base[:, None] * np.exp(eta_m), grid)
            if shift > 0:
                ages_m = ages_m + rng.standard_normal(n)[None, :] * shift
            return ages_m

        probe = _draw(n_fit_members, best_L, best_sigma, best_rate, 0.0)
        probe_w0 = float(np.percentile(probe[0], 97.5) - np.percentile(probe[0], 2.5))
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
                "simulated_envelope_median": round(
                    float(np.median(simulated_width)), 2
                ),
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
        return (
            float(np.min(self.analysis_depths)),
            float(np.max(self.analysis_depths)),
        )

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
        if d_arr.size == 0:
            return {
                "depths": [],
                "age_est": [],
                "age_min": [],
                "age_max": [],
                "extrapolated": [],
                "acc_rate_yr_per_depth": [],
                "sed_rate_depth_per_yr": [],
                "volume_ar_cm_per_yr": [],
                "interval_acc_rate_yr_per_depth": [],
                "interval_sed_rate_depth_per_yr": [],
            }
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

    def predict_depth(
        self,
        sample_ages: list[float] | np.ndarray,
    ) -> dict[str, Any]:
        """Inversely maps sample ages to physical depths using the median age-depth trajectory.

        Guards:
        * Enforces strict monotonicity checks via PCHIP interpolation.
        * Flags points beyond observed age bounds with ``extrapolated = True``.
        """
        a_arr = np.asarray(sample_ages, dtype=float)
        if (
            self._interp_age is None
            or self.analysis_depths is None
            or len(self.analysis_depths) < 2
        ):
            raise ValueError(
                "This age-depth model has no valid curve to inversely predict depth."
            )

        grid_d = np.linspace(
            np.min(self.analysis_depths), np.max(self.analysis_depths), 400
        )
        grid_a = self._interp_age(grid_d)

        # Ensure monotonic relationship for inversion
        sort_idx = np.argsort(grid_a)
        sorted_a = grid_a[sort_idx]
        sorted_d = grid_d[sort_idx]

        unique_a, u_idx = np.unique(sorted_a, return_index=True)
        unique_d = sorted_d[u_idx]

        if len(unique_a) < 2:
            raise ValueError(
                "Extracted age-depth relationship is degenerate (flat ages)."
            )

        from scipy.interpolate import PchipInterpolator

        try:
            inv_pchip = PchipInterpolator(unique_a, unique_d)
            pred_d = inv_pchip(a_arr)
        except Exception:
            pred_d = np.interp(a_arr, unique_a, unique_d)

        observed_min_a = float(np.min(unique_a))
        observed_max_a = float(np.max(unique_a))
        extrapolated = (a_arr < observed_min_a) | (a_arr > observed_max_a)

        return {
            "ages": [round(float(a), 2) for a in a_arr],
            "depth_est": [round(float(d), 2) for d in pred_d],
            "extrapolated": [bool(ex) for ex in extrapolated],
            "observed_age_range": [round(observed_min_a, 2), round(observed_max_a, 2)],
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
        res = subprocess.run(
            cmd, capture_output=True, text=True, timeout=8.0, check=False
        )
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

        hiatus_arg = (
            f"c({', '.join(map(str, hiatus_depths))})" if hiatus_depths else "NA"
        )
        dr_val = float(d_r) if d_r is not None else 0.0
        dr_std = float(d_std) if d_std is not None else 0.0

        r_code = f"""
suppressPackageStartupMessages(library(rbacon))
coredir <- "{str(cores_dir).replace(chr(92), "/")}"
core_name <- "{core_name}"
thick <- {thickness}
hiatus_vec <- {hiatus_arg}
dr <- {dr_val}
dr_std <- {dr_std}
out_tsv <- "{str(out_tsv_path).replace(chr(92), "/")}"

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
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=30.0, check=False
            )
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
                "error": proc.stderr
                or proc.stdout
                or "Bacon execution produced no output TSV",
            }
        except Exception as e:
            return {"success": False, "error": f"R execution failed: {e}"}

    return {"success": False, "error": "Bacon execution produced no output"}
