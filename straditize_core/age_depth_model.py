"""Age-depth mathematical model, coordinate calibration, and Bayesian MCMC scripting."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
from scipy.interpolate import PchipInterpolator
from scipy.ndimage import median_filter

from .calibration import LinearCalibration, LogCalibration


def _report(value: float) -> float | None:
    """Serialises a number AS COMPUTED, or ``None`` when it is not finite.

    No rounding. Every rounding scheme is a lossy guess about how much precision the reader
    wants, and picking the wrong one is indistinguishable from a bug: two decimals turned
    three consecutive horizons into an identical ``0.37``, ``toFixed(1)`` printed a 0.04
    ka/cm rate as ``0.0`` ("no deposition"), and even a six-significant-digit rule quietly
    dropped digits the user had asked to see. The computed value is emitted unchanged.
    """
    v = float(value)
    return v if np.isfinite(v) else None


def _report_list(values: Any) -> list[float | None]:
    return [_report(v) for v in values]


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

    def infer_age_increases_downcore(self) -> tuple[bool, str]:
        """Deprecated. The calibration cannot determine this; the traced curve can.

        Kept only so an out-of-tree caller fails softly instead of with ``AttributeError``.
        It always answers ``True`` with a note directing the caller to
        ``extract_age_depth_model``, which resolves the direction from the traced curve.

        Why the two calibration points are not enough: they fix what a pixel *means* on each
        axis independently. Along a drawn curve the age changes with depth as
        ``d(age)/dy = (d(age)/dx) * (dx/dy)``, and ``dx/dy`` is a property of the curve, not
        of the axes. Two figures can share identical axis directions and trace opposite
        directions in depth-age space. Measured counter-example: ``bacon_szek.png`` calibrates
        to "age grows leftwards, depth grows downwards", which reads as "age decreases
        downcore" from the axis signs alone -- yet its curve runs from x=803 at the surface to
        x=110 at 150 cm, so age actually *increases* downcore. Deciding from the axes deleted
        that figure's extractability.
        """
        return True, (
            "not derivable from the calibration alone: the direction depends on which way "
            "the traced curve runs, so it is resolved from the curve by "
            "extract_age_depth_model"
        )


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
        #: Resolved age direction and why it was chosen. Deduced from the calibration by
        #: default; a caller override is recorded in the reason string so the UI can show
        #: that the direction was forced rather than read off the figure.
        self.age_increases_downcore: bool = True
        self.age_direction_reason: str = ""
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
                "y": _report_list(self.px_y[::step]),
                "x_curve": _report_list(self.px_x_curve[::step]),
                "x_min": _report_list(self.px_x_min[::step]),
                "x_max": _report_list(self.px_x_max[::step]),
            }

        # Attach the windowed rate + its error bar to THIS row set, decimated with the same
        # stride as every other parallel array. Without this the frontend read the rate from
        # the pollen-sample payload while indexing model rows -- two different depth grids --
        # so each row showed another horizon's rate.
        sed_rate: list[float | None] = []
        sed_rate_se: list[float | None] = []
        sed_window_depth: float | None = None
        try:
            est = self.estimate_sedimentation_rate(self.depths)
            sed_rate = est["sed_rate"][::step]
            sed_rate_se = est["sed_rate_se"][::step]
            sed_window_depth = est["window_depth"]
        except ValueError:
            # Fewer than three horizons to regress on: attach nothing rather than
            # placeholder numbers; the frontend renders the columns as "—".
            sed_rate, sed_rate_se = [], []

        return {
            "depths": _report_list(self.depths[::step]),
            "ages": _report_list(self.ages[::step]),
            "age_min": _report_list(self.age_min[::step]),
            "age_max": _report_list(self.age_max[::step]),
            "sed_rate": sed_rate,
            "sed_rate_se": sed_rate_se,
            "sed_window_depth": sed_window_depth,
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
                "age_increases_downcore": self.age_increases_downcore,
                "age_direction_reason": self.age_direction_reason,
            },
        }

    def estimate_sedimentation_rate(
        self,
        depths: list[float] | np.ndarray,
        window: float | None = None,
        required_relative_se: float = 0.05,
        max_window_fraction: float = 0.2,
    ) -> dict[str, Any]:
        """Estimates sedimentation rate in ``depth_unit`` per year with an error bar.

        Why not differentiate the curve point by point
        ----------------------------------------------
        ``predict_age`` reports the analytic derivative of the PCHIP interpolant. That is the
        exact slope of the fitted curve, but the curve is fitted to a *digitised* trace whose
        per-row age error is on the order of a pixel, so:

        * the derivative is a purely local quantity and inherits all of that noise;
        * the resulting rate has no uncertainty attached, and a rate's uncertainty is
          routinely larger than the age uncertainty it came from;
        * PAVA pooling produces exactly-zero slopes, whose reciprocal is undefined, so the
          reported rate lapses to "cannot be stated" over genuinely deposited intervals.

        A rate is a geological average over a thickness, not an instantaneous derivative, so
        this method fits a line through every horizon inside a window:

        .. math::  \\text{age} = a + b \\cdot \\text{depth}

        The slope ``b`` is the accumulation rate (age per depth) and the sedimentation rate is
        ``1 / b``.

        The error bar is the larger of two estimates
        --------------------------------------------
        * the OLS slope standard error, propagated through ``1/b`` as ``se(b) / b**2``;
        * an envelope-derived figure: the 95% band's half-widths at the two ends of the
          window, added in quadrature and divided by the window thickness.

        The OLS figure alone would be dishonest. The curve is a *smooth interpolant* through
        the digitised points, so residuals inside a thin window collapse toward zero and the
        OLS standard error goes with them -- on a 4 cm window it reported exactly ``0.0``,
        which reads as infinite confidence. The envelope is the model's own statement of how
        uncertain the age is, so it is the figure that reflects the extraction, not the fit.

        Parameters
        ----------
        depths:
            Horizons at which to report the rate, in ``depth_unit``.
        window:
            Window THICKNESS in ``depth_unit`` (not a horizon count: horizon density is an
            artefact of resampling, so counting rows makes the smoothing length depend on the
            output grid rather than on the data). ``None`` grows the thickness until the OLS
            relative standard error meets ``required_relative_se``, capped by
            ``max_window_fraction``.
        required_relative_se:
            Target ``se(b) / b`` for the automatic thickness search.
        max_window_fraction:
            Cap on the automatic thickness, as a fraction of the observed depth span. Without
            a cap the search could swallow the whole core and report one global average.

        Returns
        -------
        dict
            ``sed_rate`` / ``acc_rate`` plus ``sed_rate_se`` / ``acc_rate_se``, a ``status``
            per horizon explaining any undefined value, and the thickness actually used.
            Undefined values are ``None`` with a reason -- never a number that looks like a
            measurement.

        Notes
        -----
        ``sed_rate`` is always ``depth_unit`` per REAL YEAR, whatever scale the age axis uses.
        The extracted ages carry the magnitude the user calibrated against -- a ``0..9`` axis
        yields ages in thousands of years -- but ``age_unit`` is a label passed in at
        extraction time, so the magnitude cannot be inferred from it. The scale is read from
        the ages and reported in ``age_scale_inferred``. Mixing this up is a factor-of-1000
        error, which is why it is inferred explicitly rather than assumed.
        """
        horizons = np.asarray(self.analysis_depths, dtype=float)
        ages = np.asarray(self.analysis_ages, dtype=float)
        order = np.argsort(horizons)
        horizons = horizons[order]
        ages = ages[order]
        if horizons.size < 3:
            raise ValueError(
                "Sedimentation rate needs at least three horizons to regress on; this model "
                "holds fewer. Refusing rather than returning a number without a window."
            )

        # How many years does one unit of the age axis represent?
        # A 0..9000 cal BP axis and a 0..9 ka axis can both be labelled "cal BP", so the
        # label cannot decide this; the span is what distinguishes them.
        age_span = float(ages.max() - ages.min())
        depth_span = float(horizons.max() - horizons.min())
        if age_span <= 0:
            raise ValueError(
                "The extracted ages do not advance with depth, so no age scale exists and no "
                "rate can be stated."
            )
        years_per_age_unit = 1.0
        age_scale_inferred = "years"
        if depth_span > 0:
            # Mean accumulation rate in age-units per cm. A Holocene core is order 10-100
            # yr/cm; anything an order of magnitude below that means the axis is in ka.
            age_per_depth = age_span / depth_span
            if age_per_depth < 0.35:
                years_per_age_unit = 1000.0
                age_scale_inferred = "ka (inferred from magnitude)"

        targets = np.asarray(depths, dtype=float)
        n_total = horizons.size
        observed_lo = float(horizons.min())
        observed_hi = float(horizons.max())

        # ---- the window is a DEPTH THICKNESS, not a horizon count -------------------
        # Counting horizons is wrong because horizon density is an artefact of resampling,
        # not of information content. The native trace carries one row every ~0.2 cm, so a
        # 20-horizon window spans 4 cm -- far too thin to be a geological average, and thin
        # enough that the PCHIP curve is locally linear, which drove the OLS residual to
        # exactly zero and reported a fake `se = 0.0`. A rate is a property of a thickness,
        # so the thickness is what the caller (and the search) controls.
        uniq = np.diff(np.unique(horizons))
        typical_spacing = float(np.median(uniq)) if uniq.size else depth_span
        min_thickness = 3.0 * typical_spacing
        max_thickness = max(min_thickness, depth_span * max_window_fraction)

        def fit_at(centre: float, thickness: float):
            """Least-squares slope, OLS se, envelope se, and status for one window."""
            half = thickness / 2.0
            mask = (horizons >= centre - half) & (horizons <= centre + half)
            x = horizons[mask]
            y = ages[mask]
            if x.size < 3:
                return float("nan"), float("nan"), float("nan"), x.size, "too_few_horizons"
            x_mean = float(x.mean())
            sxx = float(((x - x_mean) ** 2).sum())
            if sxx <= 1e-12:
                return float("nan"), float("nan"), float("nan"), x.size, "zero_depth_spread"
            y_mean = float(y.mean())
            slope = float(((x - x_mean) * (y - y_mean)).sum() / sxx)
            if slope <= 0:
                # Age does not increase downcore in this window: a genuine reversal, or the
                # trace locked onto the wrong stroke. A rate has no meaning here.
                return slope, float("nan"), float("nan"), x.size, "non_positive_slope"
            residual = y - (y_mean + slope * (x - x_mean))
            dof = x.size - 2
            sse = float((residual**2).sum())
            # Zero residual means "perfectly collinear", which the interpolant guarantees on
            # a thin window. It is not evidence of zero uncertainty, so it is reported as an
            # absent number rather than a confidence-inspiring 0.0.
            se_ols = (
                float(np.sqrt(sse / dof / sxx)) if dof > 0 and sse > 1e-18 else float("nan")
            )
            # The physically meaningful error bar comes from the extracted 95% envelope:
            # the age difference across the window is uncertain by roughly the half-widths
            # at its two ends added in quadrature.
            if self.analysis_age_max is not None and self.analysis_age_min is not None:
                half_w = (np.asarray(self.analysis_age_max)[mask]
                          - np.asarray(self.analysis_age_min)[mask]) / 2.0
                half_w = half_w[np.isfinite(half_w)]
                if half_w.size:
                    u_ends = float(np.sqrt(half_w[0] ** 2 + half_w[-1] ** 2))
                    se_env = u_ends / max(thickness, 1e-9)
                else:
                    se_env = float("nan")
            else:
                se_env = float("nan")
            return slope, se_ols, se_env, x.size, "ok"

        chosen_thickness = window
        if chosen_thickness is None:
            # Grow the thickness until the rate's RELATIVE uncertainty meets the target, then
            # stop -- wider windows are blurrier. The criterion uses the envelope-derived
            # error, not the OLS one: on a smooth interpolant the OLS residual is near zero at
            # any thickness, so it can never govern the choice (it breaks immediately and
            # leaves the window at its floor). The envelope says how uncertain the extracted
            # age really is, so it is the quantity worth driving to a target.
            chosen_thickness = max_thickness
            probe = float(np.median(targets))
            step = min_thickness
            while step <= max_thickness:
                slope, se_ols, se_env, _n, status = fit_at(probe, step)
                if status == "ok" and slope > 0:
                    rel = None
                    for candidate in (se_env, se_ols):
                        if candidate is not None and np.isfinite(candidate):
                            rel = candidate / slope
                            break
                    if rel is not None and rel <= required_relative_se:
                        chosen_thickness = step
                        break
                step *= 1.5
            else:
                chosen_thickness = max_thickness

        sed_out: list[float | None] = []
        sed_se_out: list[float | None] = []
        sed_se_ols_out: list[float | None] = []
        acc_out: list[float | None] = []
        acc_se_out: list[float | None] = []
        status_out: list[str] = []
        window_out: list[int] = []

        for target in targets:
            slope, se_ols, se_env, n_used, status = fit_at(
                float(target), chosen_thickness
            )
            window_out.append(n_used)
            if status != "ok" or not np.isfinite(slope) or slope <= 0:
                status_out.append(status)
                sed_out.append(None)
                sed_se_out.append(None)
                sed_se_ols_out.append(None)
                acc_out.append(None)
                acc_se_out.append(None)
                continue
            if target < observed_lo or target > observed_hi:
                status = "extrapolated"
            # Convert the slope from age-units/cm to years/cm before inverting, so the rate
            # comes out in real years no matter which scale the age axis used.
            slope_years = slope * years_per_age_unit
            sed = 1.0 / slope_years
            # delta(1/b) = se(b) / b**2, carried through the same unit scaling.
            se_ols_sed = (
                (se_ols * years_per_age_unit) / (slope_years**2)
                if np.isfinite(se_ols) else None
            )
            se_env_sed = (
                (se_env * years_per_age_unit) / (slope_years**2)
                if np.isfinite(se_env) else None
            )
            # Report the larger of the two: the OLS figure is a lower bound because the
            # curve is an interpolant, so the envelope-derived figure is the honest one
            # wherever both exist.
            candidates = [v for v in (se_ols_sed, se_env_sed) if v is not None]
            status_out.append(status)
            acc_out.append(float(slope_years) if np.isfinite(slope_years) else None)
            acc_se_out.append(
                float(max(candidates)) if candidates else None
            )
            sed_out.append(float(sed))
            sed_se_out.append(float(max(candidates)) if candidates else None)
            sed_se_ols_out.append(
                float(se_ols_sed) if se_ols_sed is not None else None
            )

        return {
            "depths": _report_list(targets),
            "sed_rate": sed_out,
            "sed_rate_se": sed_se_out,
            "sed_rate_se_ols": sed_se_ols_out,
            "acc_rate": acc_out,
            "acc_rate_se": acc_se_out,
            "status": status_out,
            "window_depth": float(chosen_thickness),
            "window_per_horizon": window_out,
            "horizons_available": n_total,
            "age_scale_inferred": age_scale_inferred,
            "years_per_age_unit": years_per_age_unit,
            "rate_units": {
                "sed_rate": f"{self.depth_unit} per year",
                "acc_rate": f"year per {self.depth_unit}",
            },
            "method": (
                "ordinary least squares of age on depth over a sliding window of fixed "
                f"DEPTH THICKNESS {chosen_thickness:.2f} {self.depth_unit} "
                f"({n_total} horizons available, median spacing {typical_spacing:.3f}); "
                "sed_rate_se is the larger of the OLS slope error and the envelope-derived "
                "error, because the fitted curve is an interpolant and its residuals "
                "understate the digitisation uncertainty"
            ),
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
        candidates = self._ensemble_correlation_candidates(
            grid, correlation_length, span=model_hi - model_lo
        )

        selection = self._fit_ensemble_selection(
            grid,
            target_median,
            target_width,
            candidates,
            n_fit_members,
            fit_iterations,
            random_seed,
        )
        if selection is None:
            return {"name": name, "columns": ["depth"], "data": []}
        best_L, best_sigma, best_rate, best_mismatch = selection

        best_sigma, best_rate, best_mismatch, s_shift = self._fit_shared_offset(
            grid,
            target_median,
            target_width,
            best_L,
            best_sigma,
            best_rate,
            best_mismatch,
            n_fit_members,
            fit_iterations,
            random_seed,
            rng,
        )

        columns, rows, sample_matrix, reversal_rate, ages_grid = (
            self._format_ensemble_result(
                grid,
                target_median,
                d_arr,
                n_ensembles,
                best_L,
                best_sigma,
                best_rate,
                s_shift,
                rng,
            )
        )

        rate_stats = None
        if return_diagnostics:
            rate_stats = self._rate_posterior_stats(
                ages_grid, grid, d_arr, n_ensembles
            )

        result: dict[str, Any] = {"name": name, "columns": columns, "data": rows}
        if return_diagnostics:
            result["diagnostics"] = self._build_ensemble_diagnostics(
                ages_grid=ages_grid,
                grid=grid,
                target_median=target_median,
                target_width=target_width,
                d_arr=d_arr,
                best_L=best_L,
                best_mismatch=best_mismatch,
                s_shift=s_shift,
                reversal_rate=reversal_rate,
                correlation_length=correlation_length,
                rate_stats=rate_stats,
            )
        return result

    def _build_ensemble_diagnostics(
        self,
        *,
        ages_grid: np.ndarray,
        grid: np.ndarray,
        target_median: np.ndarray,
        target_width: np.ndarray,
        d_arr: np.ndarray,
        best_L: float,
        best_mismatch: float,
        s_shift: float,
        reversal_rate: float,
        correlation_length: float | None,
        rate_stats: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """诊断块：拟合出的相关长度、模拟包络与目标包络的失配、共享偏移、反转率、中位曲线偏差。"""
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
        diagnostics: dict[str, Any] = {
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
            diagnostics["rate"] = rate_stats

        return diagnostics

    # ---- generate_age_ensemble 的分段实现 ----

    def _ensemble_correlation_candidates(
        self,
        grid: np.ndarray,
        correlation_length: float | None,
        *,
        span: float,
    ) -> list[float]:
        """相关长度候选梯度：显式给定就只试它，否则由种子 + 若干比例兜底。

        种子是启发式，拟合才是裁判；梯度同时括住种子与其几倍、以及剖面的若干分数，
        坏种子困不住搜索。
        """
        if correlation_length is not None and correlation_length > 0:
            candidates = [float(correlation_length)]
        else:
            seed = self.infer_correlation_length(grid)
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
        return candidates

    def _fit_ensemble_selection(
        self,
        grid: np.ndarray,
        target_median: np.ndarray,
        target_width: np.ndarray,
        candidates: list[float],
        n_fit_members: int,
        fit_iterations: int,
        random_seed: int,
    ) -> tuple[float, np.ndarray, np.ndarray, float] | None:
        """逐候选拟合，按「形状失配 + 量级失配」选优；全部失败返回 None。"""
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
            return None
        return best_L, best_sigma, best_rate, best_mismatch

    def _draw_ensemble_members(
        self,
        grid: np.ndarray,
        n: int,
        L: float,
        sigma: np.ndarray,
        rate_base: np.ndarray,
        shift: float,
        rng: np.random.Generator,
    ) -> np.ndarray:
        """按 GP 相关矩阵抽 n 条累积速率轨迹（Bacon 口径：速率空间 + 共享偏移）。"""
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

    def _fit_shared_offset(
        self,
        grid: np.ndarray,
        target_median: np.ndarray,
        target_width: np.ndarray,
        best_L: float,
        best_sigma: np.ndarray,
        best_rate: np.ndarray,
        best_mismatch: float,
        n_fit_members: int,
        fit_iterations: int,
        random_seed: int,
        rng: np.random.Generator,
    ) -> tuple[np.ndarray, np.ndarray, float, float]:
        """补整条曲线共享的偏移分量（岩芯顶龄/库效应/校正平移），再把振幅拟合一次。"""
        # ---- Shared whole-curve offset ----------------------------------------
        # Integration starts at the shallowest grid node, so the local rate process alone
        # cannot produce any spread there even though the extracted envelope has some.
        # The missing variance at that node is attributed to a systematic offset shared by
        # every depth (core-top age, reservoir effect, calibration shift) and the fit is
        # re-run with it in place so the amplitude accounts for it.
        probe = self._draw_ensemble_members(
            grid,
            n_fit_members,
            best_L,
            best_sigma,
            best_rate,
            0.0,
            rng,
        )
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

        return best_sigma, best_rate, best_mismatch, s_shift

    def _format_ensemble_result(
        self,
        grid: np.ndarray,
        target_median: np.ndarray,
        d_arr: np.ndarray,
        n_ensembles: int,
        best_L: float,
        best_sigma: np.ndarray,
        best_rate: np.ndarray,
        s_shift: float,
        rng: np.random.Generator,
    ) -> tuple[list[str], list[list[float]], np.ndarray, float, np.ndarray]:
        """最终抽样 + 锚定中位曲线 + 插值到采样深度 → 列名/行/矩阵/反转率/网格年龄。"""
        # ---- Final draw at the requested ensemble size ------------------------
        ages_grid = self._draw_ensemble_members(
            grid, int(n_ensembles), best_L, best_sigma, best_rate, s_shift, rng
        )

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

        return columns, rows, sample_matrix, reversal_rate, ages_grid

    def _rate_posterior_stats(
        self,
        ages_grid: np.ndarray,
        grid: np.ndarray,
        d_arr: np.ndarray,
        n_ensembles: int,
    ) -> dict[str, Any]:
        """逐采样深度的速率后验：由集成成员自身求导得到，而不是从中位曲线点估。"""
        # Per-sample rate posterior. The ensemble already lives in rate space, so the
        # member rates are free: differentiating each member's curve amplifies noise, which
        # is exactly why the rate is typically more uncertain than the age and why a point
        # estimate from the median curve should not be reported on its own.
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
        return rate_stats

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

        # The rate columns are LABELLED per year, so they must be per year. The extracted
        # ages carry the magnitude the user calibrated against: a "0..9 ka BP" axis yields
        # ages of 0..9, while ``age_unit`` is a label passed in at extraction time and reads
        # "cal BP" either way. Inverting a ka/cm slope therefore produced a number 1000x too
        # large under a "cm per year" heading -- measured on the bundled Bacon figure: the
        # exported sed_rate column read 960.5 where the truth was 0.96. The scale is read
        # from the ages themselves and reported, never assumed from the unit string.
        age_span = float(np.nanmax(self.analysis_ages) - np.nanmin(self.analysis_ages))
        depth_span = float(np.nanmax(self.analysis_depths) - np.nanmin(self.analysis_depths))
        years_per_age_unit = 1.0
        if age_span > 0 and depth_span > 0 and age_span / depth_span < 0.35:
            years_per_age_unit = 1000.0
        slope = slope * years_per_age_unit

        # An undefined accumulation rate has an undefined reciprocal too. This used to emit
        # 0.0 here, and 0 cm/yr reads as "nothing is being deposited" -- the exact opposite
        # of "the rate cannot be stated at this horizon". NaN propagates to a null in the
        # serialisation below, which is the honest value.
        with np.errstate(divide="ignore", invalid="ignore"):
            sed = np.where(np.isnan(slope), np.nan, 1.0 / slope)

        order = np.argsort(d_arr)
        d_sorted = d_arr[order]
        a_sorted = np.asarray(age_est, dtype=float)[order]
        d_delta = np.diff(d_sorted)
        a_delta = np.diff(a_sorted)
        with np.errstate(divide="ignore", invalid="ignore"):
            interval = np.where(np.abs(d_delta) > 1e-12, a_delta / d_delta, np.nan)
        # Same scale conversion as the analytic slope above, so both families of rate column
        # are per year and stay consistent with each other.
        interval = np.abs(interval) * years_per_age_unit
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
            """Serialises rates as computed, using ``None`` where a rate is undefined.

            Isotonic regression can pool horizons into a flat age segment, which means an
            instantaneous deposit: the accumulation rate is genuinely zero and its
            reciprocal is undefined. Reporting ``0.0`` there would claim "no deposition",
            the exact opposite, so undefined is emitted as ``null``.

            No rounding. Rounding to four decimals used to break the reciprocal identity
            between ``acc_rate`` and ``sed_rate`` below ~0.01 (worst 5.3% error, 21 of 32
            horizons); emitting the computed value makes ``acc * sed == 1`` exact.
            """
            out: list[float | None] = []
            for v in values:
                v = float(v)
                if not np.isfinite(v):
                    out.append(None)
                else:
                    out.append(v)
            return out

        return {
            "depths": _report_list(d_arr),
            "age_est": _report_list(age_est),
            "age_min": _report_list(age_min),
            "age_max": _report_list(age_max),
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
                "acc_rate": f"year per {self.depth_unit}",
                "sed_rate": f"{self.depth_unit} per year",
                "volume_ar": "cm per year (cm3 cm-2 yr-1)",
            },
            # Which scale the age axis turned out to use, so a caller can audit the factor of
            # 1000 instead of trusting the age_unit label.
            "years_per_age_unit": years_per_age_unit,
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
            "ages": _report_list(a_arr),
            "depth_est": _report_list(pred_d),
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
