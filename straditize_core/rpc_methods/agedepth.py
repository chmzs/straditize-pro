"""Age-depth modelling and chronology RPC methods."""

from __future__ import annotations

from typing import Any

from ..age_depth import (
    check_local_r_environment,
    generate_bacon_script,
    generate_geochronr_script,
)


def register(dispatcher: Any, session: Any) -> None:
    """Register age-depth operations."""
    dispatcher.register_method("agedepth.loadModelDiagram", session.load_age_depth_diagram)
    dispatcher.register_method("agedepth.extractAndInspect", session.calibrate_and_extract_age_depth)
    dispatcher.register_method("agedepth.getInspection", session.get_age_depth_inspection)
    dispatcher.register_method("agedepth.updateModel", session.update_age_depth_model)
    dispatcher.register_method("agedepth.generateEnsemble", session.generate_age_ensemble)
    dispatcher.register_method(
        "agedepth.generateBaconScript",
        lambda dates, core_name="MyCore", thickness=5.0, cc=1, hiatus_depths=None,
        slumps=None, d_r=None, d_std=None, acc_mean=None, mem_mean=0.7: generate_bacon_script(
            core_name=core_name, dates=dates, thickness=thickness, cc=cc,
            hiatus_depths=hiatus_depths, slumps=slumps, d_r=d_r, d_std=d_std,
            acc_mean=acc_mean, mem_mean=mem_mean,
        ),
    )
    dispatcher.register_method(
        "agedepth.generateGeoChronRScript",
        lambda lipd_file_name, site_name="PollenSite", thickness=5.0, hiatus_depths=None: generate_geochronr_script(
            lipd_file_name=lipd_file_name, site_name=site_name, thickness=thickness, hiatus_depths=hiatus_depths,
        ),
    )
    dispatcher.register_method("agedepth.checkREnvironment", lambda: check_local_r_environment())
    dispatcher.register_method("agedepth.runLocalBacon", session.run_local_bacon)
    dispatcher.register_method("agedepth.runBaconModeling", session.run_age_modeling)
    dispatcher.register_method("ensemble.add", session.ensemble_add)
    dispatcher.register_method("ensemble.list", session.ensemble_list)
