"""Age-depth computer vision, figure tracing, and curve extraction."""

from __future__ import annotations

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, median_filter

from .age_depth_model import AgeDepthAxisCalibrator, AgeDepthModel


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
    mean_bg = np.divide(
        cum_mean, weight_bg, out=np.zeros_like(cum_mean), where=weight_bg > 0
    )
    mean_fg = np.divide(
        sum_total - cum_mean,
        weight_fg,
        out=np.zeros_like(cum_mean),
        where=weight_fg > 0,
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
        (
            float(calibrator.depth_cal.px_points[0]),
            float(calibrator.depth_cal.px_points[1]),
        )
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
        raise ValueError(
            "Search window is degenerate; recalibrate or widen the depth range."
        )

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
                    centroid = float(
                        r0 + (weights * np.arange(seg.size)).sum() / weights.sum()
                    )
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
        c_rows, c_curve, c_min, c_max = trace_curve(
            chroma_smoothed, thr_chroma, generous
        )
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
            chroma_mode_reason = f"chromatic stroke spans {len(c_rows)} rows vs {len(row_idx)} for darkness"
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
    observed_span = (
        float(rows_arr.max() - rows_arr.min() + 1.0) if rows_arr.size else 0.0
    )
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
    depth_increases_downward = calibrator.depth_cal.px2data(
        1.0
    ) >= calibrator.depth_cal.px2data(0.0)
    ascending = depth_increases_downward == bool(age_increases_downcore)

    if enforce_monotonic and ages_sorted.size >= 3:
        # Guard against a misdeclared age direction. Isotonic regression happily "fixes"
        # data that runs the other way by flattening it, which would return a degenerate
        # constant chronology with no signal that anything was wrong. Check the raw trend
        # against the declaration first and refuse instead.
        raw_diffs = np.diff(ages_sorted)
        agreement = (
            float((raw_diffs >= 0).mean())
            if ascending
            else float((raw_diffs <= 0).mean())
        )
        if agreement < 0.55:
            declared = "increases" if age_increases_downcore else "decreases"
            observed = (
                "decreases" if float((raw_diffs >= 0).mean()) < 0.5 else "increases"
            )
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
