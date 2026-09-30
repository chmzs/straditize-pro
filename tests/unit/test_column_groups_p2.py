"""P2 unit tests for Column Groups within ROI and Multi-ROI project persistence.

Verifies:
1. Invariant 1 & 2: Groups live strictly inside an ROI; deleting a group reassigns columns
   to the default group; cannot delete the sole remaining group.
2. Derivation: Column scale derived from group tick_layout and column x_values (§3.3).
3. Re-split preservation (§6, Defect #21): Re-splitting an ROI with the same column count
   preserves column calibrations and scale settings.
4. Multi-ROI persistence (D3): project_save / project_load preserves multiple ROIs, groups,
   and per-column roi_id / x_group_id / x_values across round-trips.
5. Legacy v2 migration (D2): Legacy v2 project packages without groups are migrated
   faithfully to per-column single groups without guessing.
"""

from __future__ import annotations

import json
import pytest

from straditize_core.protocol import JsonRpcError
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale


def test_roi_create_initializes_default_group() -> None:
    """Every newly created ROI automatically has a default group (Invariant 2)."""
    session = StraditizeSession()
    res = session.roi_create(name="pollen", x0=100, x1=500, y0=100, y1=600)
    roi = res["roi"]
    assert "x_groups" in roi
    assert len(roi["x_groups"]) == 1
    def_grp = roi["x_groups"][0]
    assert def_grp["id"] == roi["default_group_id"]
    assert def_grp["name"] == "默认组"
    assert def_grp["unit"] == "%"
    assert def_grp["plot_type"] == "area"
    assert def_grp["tick_layout"] == [{"rel": 0.0}, {"rel": 1.0}]


def test_group_lifecycle_and_fallback_on_delete() -> None:
    """Group creation, update, and deletion reassigns columns (Invariant 1 & 2)."""
    session = StraditizeSession()
    roi_id = session.roi_create(name="charcoal")["roi"]["id"]

    # 1. Create a second group
    res_c = session.roi_group_create(
        roi_id=roi_id,
        name="浓度组",
        unit="粒/cm³",
        plot_type="bar",
        tick_layout=[{"rel": 0.0}, {"rel": 0.5}],
    )
    grp2 = res_c["group"]
    assert grp2["unit"] == "粒/cm³"
    assert grp2["tick_layout"] == [{"rel": 0.0}, {"rel": 0.5}]

    # 2. Update group
    res_u = session.roi_group_update(
        roi_id=roi_id,
        group_id=grp2["id"],
        updates={"unit": "grains/g", "exaggeration_mult": 2.5},
    )
    assert res_u["group"]["unit"] == "grains/g"
    assert res_u["group"]["exaggeration_mult"] == 2.5

    # 3. Add a column belonging to grp2
    session.columns.append(
        {
            "col_index": 0,
            "id": f"{roi_id}_col01",
            "name": "MicroCharcoal",
            "roi_id": roi_id,
            "x_group_id": grp2["id"],
            "start": 100.0,
            "end": 200.0,
            "x_values": [0.0, 500.0],
        }
    )

    # 4. Remove grp2 -> column reassigned to default group
    res_d = session.roi_group_remove(roi_id=roi_id, group_id=grp2["id"])
    assert res_d["reassigned_columns_count"] == 1
    assert session.columns[0]["x_group_id"] == res_d["fallback_group_id"]

    # 5. Cannot delete the only remaining group
    with pytest.raises(JsonRpcError) as exc_info:
        session.roi_group_remove(roi_id=roi_id, group_id=res_d["fallback_group_id"])
    assert exc_info.value.code == -32602


def test_resolve_column_scale_from_group_layout_and_column_values() -> None:
    """Scale derivation strictly follows: abs_px_i = start + rel_i * (end - start)."""
    session = StraditizeSession()
    roi = session.roi_create(name="pollen")["roi"]
    roi_id = roi["id"]

    # Configure a custom tick layout: 0% and 50% width
    roi["x_groups"][0]["tick_layout"] = [{"rel": 0.0}, {"rel": 0.5}]
    roi["x_groups"][0]["unit"] = "‰"
    roi["x_groups"][0]["plot_type"] = "line"

    col = {
        "col_index": 0,
        "name": "TaxonA",
        "roi_id": roi_id,
        "x_group_id": roi["default_group_id"],
        "start": 200.0,
        "end": 400.0,  # span = 200 px
        "x_values": [0.0, 25.0],
    }

    scale = resolve_column_scale(session, col)
    assert scale.calibrated is True
    assert scale.source == "group"
    # abs_px0 = 200 + 0 * 200 = 200
    # abs_px1 = 200 + 0.5 * 200 = 300
    assert (scale.abs_px0, scale.val0, scale.abs_px1, scale.val1) == (
        200.0,
        0.0,
        300.0,
        25.0,
    )
    assert scale.unit == "‰"
    assert scale.plot_type == "line"
    # At x=250 (midpoint of 200..300), value is 12.5
    assert scale.px_to_value(250.0, baseline_px=200.0) == 12.5


def test_resplit_preserves_column_calibrations_when_count_unchanged() -> None:
    """Re-split preservation (§6, Defect #21):

    Re-splitting an ROI with unchanged column count MUST keep user-defined x_ticks,
    x_values, x_group_id, unit, plot_type, scale_type, and exaggeration_mult intact.
    """
    from PIL import Image

    session = StraditizeSession()
    session.image = Image.new("L", (1000, 1000), 255)
    session.width, session.height = 1000, 1000
    roi_res = session.roi_create(name="pollen", x0=100, x1=300, y0=500, y1=1000)
    roi_id = roi_res["roi"]["id"]

    # Initial split: 2 columns [100..200, 200..300]
    session.columns = [
        {
            "col_index": 0,
            "id": f"{roi_id}_col01",
            "name": "Pinus",
            "species": "Pinus",
            "roi_id": roi_id,
            "start": 100.0,
            "end": 200.0,
            "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 180.0, "value": 40.0}],
            "unit": "粒",
            "plot_type": "bar",
            "scale_type": "linear",
            "exaggeration_mult": 5.0,
        },
        {
            "col_index": 1,
            "id": f"{roi_id}_col02",
            "name": "Betula",
            "species": "Betula",
            "roi_id": roi_id,
            "start": 200.0,
            "end": 300.0,
            "x_ticks": [{"px": 200.0, "value": 0.0}, {"px": 280.0, "value": 20.0}],
            "unit": "粒",
            "plot_type": "area",
            "scale_type": "linear",
        },
    ]
    session.taxa_names = ["Pinus", "Betula"]

    # Run detect_columns for this ROI with same column count
    session.detect_columns(data_xlim=[100, 300], data_ylim=[500, 1000], roi_id=roi_id)

    assert len(session.columns) == 2
    c0 = session.columns[0]
    assert c0["name"] == "Pinus"
    assert c0["x_ticks"] == [{"px": 100.0, "value": 0.0}, {"px": 180.0, "value": 40.0}]
    assert c0["unit"] == "粒"
    assert c0["plot_type"] == "bar"
    assert c0["exaggeration_mult"] == 5.0

    c1 = session.columns[1]
    assert c1["name"] == "Betula"
    assert c1["x_ticks"] == [{"px": 200.0, "value": 0.0}, {"px": 280.0, "value": 20.0}]


def test_multi_roi_project_save_and_load_round_trip() -> None:
    """Multi-ROI persistence (D3):

    Saves a project with 2 distinct ROIs, each with custom groups and columns,
    and loads it back into a clean session, asserting that all structures survive intact.
    """
    session = StraditizeSession()
    r1 = session.roi_create(name="pollen", x0=100, x1=500, y0=500, y1=1000, composition=True)["roi"]
    r2 = session.roi_create(name="charcoal", x0=600, x1=900, y0=500, y1=1000, composition=False)["roi"]

    # Customize groups
    grp_p = session.roi_group_create(r1["id"], name="花粉-百分比", unit="%", plot_type="area")["group"]
    grp_c = session.roi_group_create(r2["id"], name="炭屑-浓度", unit="grains/cm³", plot_type="bar")["group"]
    gr_id = grp_c["id"]

    session.columns = [
        {
            "col_index": 0,
            "id": f"{r1['id']}_col01",
            "name": "Pinus",
            "species": "Pinus",
            "roi_id": r1["id"],
            "x_group_id": grp_p["id"],
            "start": 100.0,
            "end": 300.0,
            "x_values": [0.0, 40.0],
            "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 300.0, "value": 40.0}],
            "unit": "%",
            "plot_type": "area",
        },
        {
            "col_index": 1,
            "id": f"{r2['id']}_col01",
            "name": "MacroCharcoal",
            "species": "MacroCharcoal",
            "roi_id": r2["id"],
            "x_group_id": gr_id,
            "start": 600.0,
            "end": 900.0,
            "x_values": [0.0, 1000.0],
            "x_ticks": [{"px": 600.0, "value": 0.0}, {"px": 900.0, "value": 1000.0}],
            "unit": "grains/cm³",
            "plot_type": "bar",
        },
    ]
    session.taxa_names = ["Pinus", "MacroCharcoal"]

    saved_data = session.project_save(format="json")["data"]
    assert saved_data["version"] == "3.0.0"
    assert len(saved_data["rois"]) == 2
    assert len(saved_data["columns"]) == 2
    assert saved_data["columns"][0]["roi_id"] == r1["id"]
    assert saved_data["columns"][1]["roi_id"] == r2["id"]
    assert saved_data["columns"][0]["x_group_id"] == grp_p["id"]
    assert saved_data["columns"][1]["x_group_id"] == gr_id

    # Restore in fresh session
    restored = StraditizeSession()
    restored.project_load(json.loads(json.dumps(saved_data)))

    assert len(restored.rois) == 2
    assert restored.rois[0]["name"] == "pollen"
    assert restored.rois[1]["name"] == "charcoal"
    assert len(restored.columns) == 2
    assert restored.columns[0]["roi_id"] == r1["id"]
    assert restored.columns[1]["roi_id"] == r2["id"]
    assert restored.columns[0]["x_values"] == [0.0, 40.0]
    assert restored.columns[1]["x_values"] == [0.0, 1000.0]


def test_legacy_v2_project_migration_to_column_groups() -> None:
    """Legacy v2 migration (D2):

    When loading a legacy v2 project (which has no rois and no x_groups),
    each column is migrated to a dedicated single-column group carrying its scale settings.
    """
    v2_project = {
        "version": "2.0.0",
        "roi": {"x": 100.0, "y": 200.0, "w": 400.0, "h": 500.0},
        "depth_calibration": {"is_calibrated": False, "unit": "cm"},
        "columns": [
            {
                "id": "col_0",
                "name": "Artemisia",
                "startX": 100.0,
                "endX": 250.0,
                "unit": "%",
                "plot_type": "area",
                "scale_type": "linear",
                "x_ticks": [{"px": 100.0, "value": 0.0}, {"px": 250.0, "value": 50.0}],
                "exaggeration_mult": 4.0,
            }
        ],
    }

    session = StraditizeSession()
    session.project_load(v2_project)

    assert len(session.rois) >= 1
    roi = session.rois[0]
    assert "x_groups" in roi
    # The column was migrated to a dedicated group (D2)
    assert len(session.columns) == 1
    col = session.columns[0]
    assert col["roi_id"] == roi["id"]
    assert col["x_group_id"] is not None
    assert col["x_values"] == [0.0, 50.0]

    # Verify that resolve_column_scale works seamlessly on the migrated state
    scale = resolve_column_scale(session, col)
    assert scale.calibrated is True
    assert (scale.val0, scale.val1) == (0.0, 50.0)
    assert scale.exaggeration_mult == 4.0


def test_full_portable_tar_archive_round_trips_age_depth_and_metadata(
    tmp_path: Any,
) -> None:
    """Portable .tar archive round-trip:

    Verifies that saving a .tar project archive embeds BOTH `image/original.png` and
    `image/age_depth.png`, plus `age_depth` calibration/exclude_boxes/inspection,
    `paper_metadata`, `samples`, and `ensemble_tables`, and that a clean peer session
    loading ONLY that .tar file restores all of them 100%.
    """
    from PIL import Image

    session = StraditizeSession()
    session.image = Image.new("RGB", (400, 300), (255, 255, 255))
    session.width, session.height = 400, 300
    r1 = session.roi_create(name="pollen", x0=50, x1=350, y0=50, y1=250)["roi"]
    session.columns = [
        {
            "col_index": 0,
            "id": f"{r1['id']}_col01",
            "name": "Artemisia",
            "species": "Artemisia",
            "roi_id": r1["id"],
            "x_group_id": r1["default_group_id"],
            "start": 50.0,
            "end": 150.0,
            "x_values": [0.0, 60.0],
            "x_ticks": [{"px": 50.0, "value": 0.0}, {"px": 150.0, "value": 60.0}],
        }
    ]
    session.taxa_names = ["Artemisia"]
    session.samples = [{"row_px": 100, "depth": 500.0, "source": "manual"}]
    session.metadata_update(
        {
            "site": {"site_name": "Lake Gahai", "collection_date": "2008-05"},
            "technical": {"investigators": "Jiawu Zhang", "affiliation": "Lanzhou Univ"},
        }
    )
    session.load_age_depth_diagram(sample_key="bacon")
    session.calibrate_and_extract_age_depth(
        depth_px=[32.0, 668.0],
        depth_vals=[0.0, 150.0],
        age_px=[110.0, 804.0],
        age_vals=[3000.0, 0.0],
        exclude_boxes=[[650, 120, 880, 230]],
        notes="Bacon test",
    )

    tar_path = str(tmp_path / "portable_project.tar")
    session.project_save(output_path=tar_path, format="tar")

    peer = StraditizeSession()
    res = peer.project_load(tar_path)
    assert res["success"] is True
    assert res["has_age_depth_image"] is True
    assert res["has_age_depth_model"] is True
    assert peer.image is not None and peer.image.size == (400, 300)
    assert peer.age_depth_image is not None and peer.age_depth_image.width > 0
    assert peer.age_depth_model is not None and len(peer.age_depth_model.depths) > 10
    assert peer.age_depth_calib_state["exclude_boxes"] == [[650, 120, 880, 230]]
    assert peer.paper_metadata["site"]["site_name"] == "Lake Gahai"
    assert peer.paper_metadata["site"]["collection_date"] == "2008-05"
    assert len(peer.samples) == 1
    assert len(peer.ensemble_tables) >= 1

