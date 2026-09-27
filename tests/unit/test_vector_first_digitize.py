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
