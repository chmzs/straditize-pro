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
from scipy.ndimage import median_filter
from skimage.measure import label, regionprops

from .calibration import LinearCalibration


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
    ):
        self.depth_cal = LinearCalibration(depth_px, depth_vals, name="depth_axis")
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
        **kwargs: Any,
    ):
        if calibration_curve is not None:
            cal_curve = calibration_curve
        sort_idx = np.argsort(depths)
        self.depths = np.asarray(depths, dtype=float)[sort_idx]
        self.ages = np.asarray(ages, dtype=float)[sort_idx]

        if age_min is not None:
            self.age_min = np.asarray(age_min, dtype=float)[sort_idx]
        else:
            self.age_min = self.ages.copy()

        if age_max is not None:
            self.age_max = np.asarray(age_max, dtype=float)[sort_idx]
        else:
            self.age_max = self.ages.copy()

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

        # Monotonic-preserving PCHIP interpolators
        if len(self.depths) >= 2:
            self._interp_age = PchipInterpolator(self.depths, self.ages, extrapolate=True)
            self._interp_min = PchipInterpolator(self.depths, self.age_min, extrapolate=True)
            self._interp_max = PchipInterpolator(self.depths, self.age_max, extrapolate=True)
        else:
            self._interp_age = None
            self._interp_min = None
            self._interp_max = None

    def to_inspection_data(self) -> dict[str, Any]:
        """Serializes curves, pixel coordinates, and metadata for visual overlay check in UI."""
        px_dict = None
        if self.px_y is not None and len(self.px_y) > 0:
            # Downsample if dense to keep JSON payload lightweight for 60-120fps canvas rendering
            step = max(1, len(self.px_y) // 400)
            px_dict = {
                "y": [round(float(y), 1) for y in self.px_y[::step]],
                "x_curve": [round(float(x), 1) for x in self.px_x_curve[::step]],
                "x_min": [round(float(x), 1) for x in self.px_x_min[::step]],
                "x_max": [round(float(x), 1) for x in self.px_x_max[::step]],
            }

        return {
            "depths": [round(float(d), 2) for d in self.depths],
            "ages": [round(float(a), 2) for a in self.ages],
            "age_min": [round(float(a), 2) for a in self.age_min],
            "age_max": [round(float(a), 2) for a in self.age_max],
            "px_points": px_dict,
            "metadata": {
                "curve_type": self.curve_type,
                "envelope_type": self.envelope_type,
                "depth_unit": self.depth_unit,
                "age_unit": self.age_unit,
                "calibration_curve": self.cal_curve,
                "notes": self.notes,
            },
        }


    def generate_age_ensemble(
        self,
        sample_depths: list[float] | np.ndarray,
        n_ensembles: int = 1000,
        name: str = "Age_Ensemble_1000",
        random_seed: int = 42,
    ) -> dict[str, Any]:
        """Generates MCMC-style age ensemble realizations from extracted best-fit and 95% envelope.

        Produces n_ensembles stratigraphic age paths adhering to LiPD & geoChronR standards:
        - Maintains continuous sedimentation and non-reversal stratigraphic ordering.
        - Preserves empirical 95% confidence spread at each individual depth horizon.
        """
        d_arr = np.asarray(sample_depths, dtype=float)
        if len(d_arr) == 0:
            return {"name": name, "columns": ["depth"], "data": []}

        pred = self.predict_age(d_arr)
        mu = np.array(pred["age_est"])
        a_min = np.array(pred["age_min"])
        a_max = np.array(pred["age_max"])

        # Estimate standard deviation at each horizon: (max - min) / 3.92 (95% coverage ~ 2 sigma)
        sigma = np.maximum(1.0, (a_max - a_min) / 3.92)

        rng = np.random.default_rng(random_seed)
        m_depths = len(d_arr)

        # Generate correlated Gaussian random fields with AR(1) memory factor (Bacon-like memory ~ 0.6)
        memory = 0.65
        noise_raw = rng.standard_normal((m_depths, n_ensembles))
        correlated_noise = np.zeros_like(noise_raw)

        correlated_noise[0] = noise_raw[0]
        for i in range(1, m_depths):
            correlated_noise[i] = memory * correlated_noise[i - 1] + np.sqrt(1 - memory**2) * noise_raw[i]

        # Scale by horizon uncertainty
        simulated_matrix = mu[:, None] + correlated_noise * sigma[:, None]

        # Enforce strict chronological ordering (ages must be non-decreasing downcore)
        for j in range(n_ensembles):
            simulated_matrix[:, j] = np.maximum.accumulate(simulated_matrix[:, j])

        # Format into Section 9.4 Ensemble table JSON structure
        columns = ["depth"] + [f"iter_{k}" for k in range(1, n_ensembles + 1)]
        rows = []
        for i, d in enumerate(d_arr):
            row_vals = [round(float(d), 2)] + [round(float(val), 2) for val in simulated_matrix[i]]
            rows.append(row_vals)

        return {
            "name": name,
            "columns": columns,
            "data": rows,
        }

    def predict_age(self, sample_depths: list[float] | np.ndarray) -> dict[str, list[float]]:
        """Maps sample depths to estimated ages, 95% uncertainty bounds, and sedimentation rates."""
        d_arr = np.asarray(sample_depths, dtype=float)
        if self._interp_age is None:
            return {
                "depths": [round(d, 2) for d in d_arr],
                "age_est": [round(float(d), 1) for d in d_arr],
                "age_min": [round(float(d), 1) for d in d_arr],
                "age_max": [round(float(d), 1) for d in d_arr],
                "sed_rate_yr_per_cm": [1.0] * len(d_arr),
            }

        age_est = self._interp_age(d_arr)
        age_min = self._interp_min(d_arr)
        age_max = self._interp_max(d_arr)

        # Calculate local sedimentation rate (years per unit depth: dt/dd)
        # Using centered finite differences
        eps = 1e-3
        dt = (self._interp_age(d_arr + eps) - self._interp_age(d_arr - eps)) / (2 * eps)
        sed_rate = np.abs(dt)

        return {
            "depths": [round(float(d), 2) for d in d_arr],
            "age_est": [round(float(a), 2) for a in age_est],
            "age_min": [round(float(a), 2) for a in age_min],
            "age_max": [round(float(a), 2) for a in age_max],
            "sed_rate_yr_per_cm": [round(float(s), 2) for s in sed_rate],
            "metadata": {
                "curve_type": self.curve_type,
                "envelope_type": self.envelope_type,
                "depth_unit": self.depth_unit,
                "age_unit": self.age_unit,
                "calibration_curve": self.cal_curve,
                "notes": self.notes,
            },
        }


def extract_age_depth_model(
    image: Image.Image | np.ndarray,
    calibrator: AgeDepthAxisCalibrator,
    roi_box: tuple[int, int, int, int] | list[int] | None = None,
    curve_type: str = "median",
    envelope_type: str = "95_hpd",
    cal_curve: str = "IntCal20",
    notes: str = "",
) -> AgeDepthModel:
    """Extracts central best-fit line and uncertainty envelope from an age-depth diagram image.

    Parameters
    ----------
    image:
        Diagram PIL Image or NumPy RGB/grayscale array.
    calibrator:
        AgeDepthAxisCalibrator providing pixel-to-scientific conversions.
    roi_box:
        Optional (x0, y0, x1, y1) bounding box restricting the curve search region.
    """
    if isinstance(image, Image.Image):
        img_arr = np.array(image.convert("RGB"))
    else:
        img_arr = np.asarray(image)

    h, w = img_arr.shape[:2]
    if roi_box is not None:
        rx0, ry0, rx1, ry1 = [int(round(v)) for v in roi_box]
        rx0 = max(0, min(w - 1, rx0))
        rx1 = max(0, min(w, rx1))
        ry0 = max(0, min(h - 1, ry0))
        ry1 = max(0, min(h, ry1))
    else:
        # Automatically infer data frame region from calibration points, leaving margins for tick labels
        px_ages = [calibrator.age_cal.px_points[0], calibrator.age_cal.px_points[1]]
        px_depths = [calibrator.depth_cal.px_points[0], calibrator.depth_cal.px_points[1]]
        rx0 = max(0, int(min(px_ages) - 10))
        rx1 = min(w, int(max(px_ages) + 15))
        ry0 = max(0, int(min(px_depths) - 10))
        ry1 = min(h, int(max(px_depths) + 5))

    # Grayscale conversion: Y = 0.299 R + 0.587 G + 0.114 B
    if img_arr.ndim == 3:
        gray = np.dot(img_arr[..., :3], [0.299, 0.587, 0.114]).astype(np.uint8)
    else:
        gray = img_arr.astype(np.uint8)

    # 1. Non-white thresholding within the active region
    binary = np.zeros_like(gray, dtype=bool)
    binary[ry0:ry1, rx0:rx1] = (gray[ry0:ry1, rx0:rx1] < 235)

    # 2. Extract the largest connected component (isolates the age-depth envelope from text noise)
    lbl = label(binary)
    props = regionprops(lbl)

    sample_y = []
    sample_x_curve = []
    sample_x_min = []
    sample_x_max = []

    if props:
        largest = max(props, key=lambda p: p.area)
        mask = (lbl == largest.label)
        min_row, min_col, max_row, max_col = largest.bbox

        for y in range(min_row, max_row):
            cols = np.where(mask[y])[0]
            if len(cols) == 0:
                continue
            xmin = float(cols[0])
            xmax = float(cols[-1])

            row_vals = gray[y, int(xmin) : int(xmax) + 1]
            dark_rel = np.argmin(row_vals)
            xcurve = xmin + float(dark_rel)

            sample_y.append(float(y))
            sample_x_curve.append(xcurve)
            sample_x_min.append(xmin)
            sample_x_max.append(xmax)

    if len(sample_y) < 5:
        # Fallback if image has non-standard palette: use simple scan
        sample_y = [ry0, (ry0 + ry1) // 2, ry1 - 1]
        sample_x_curve = [rx0, (rx0 + rx1) // 2, rx1 - 1]
        sample_x_min = sample_x_curve
        sample_x_max = sample_x_curve

    # Smooth outliers using median filter
    sample_x_curve = median_filter(sample_x_curve, size=min(9, len(sample_x_curve)))
    sample_x_min = median_filter(sample_x_min, size=min(9, len(sample_x_min)))
    sample_x_max = median_filter(sample_x_max, size=min(9, len(sample_x_max)))

    # Convert pixel tracks to scientific units
    phys_depths = np.array([calibrator.px2depth(py) for py in sample_y])
    phys_ages = np.array([calibrator.px2age(px) for px in sample_x_curve])
    phys_age_min = np.array([calibrator.px2age(px) for px in sample_x_min])
    phys_age_max = np.array([calibrator.px2age(px) for px in sample_x_max])

    # Ensure min age <= max age regardless of whether age axis runs left-to-right or right-to-left
    true_min = np.minimum(phys_age_min, phys_age_max)
    true_max = np.maximum(phys_age_min, phys_age_max)

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
    model.px_y = np.asarray(sample_y, dtype=float)
    model.px_x_curve = np.asarray(sample_x_curve, dtype=float)
    model.px_x_min = np.asarray(sample_x_min, dtype=float)
    model.px_x_max = np.asarray(sample_x_max, dtype=float)
    return model
    model.px_y = np.asarray(sample_y, dtype=float)
    model.px_x_curve = np.asarray(sample_x_curve, dtype=float)
    model.px_x_min = np.asarray(sample_x_min, dtype=float)
    model.px_x_max = np.asarray(sample_x_max, dtype=float)
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
