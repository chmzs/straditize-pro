"""Age-depth modelling and chronology RPC methods."""

from __future__ import annotations

from typing import Any

from ..age_depth import (
    check_local_r_environment,
    generate_bacon_script,
    generate_geochronr_script,
)
from ..protocol import INVALID_PARAMS, JsonRpcError


def register(dispatcher: Any, session: Any) -> None:
    """Register age-depth operations."""
    dispatcher.register_method("agedepth.loadModelDiagram", session.load_age_depth_diagram)
    dispatcher.register_method("agedepth.extractAndInspect", session.calibrate_and_extract_age_depth)
    dispatcher.register_method("agedepth.getInspection", session.get_age_depth_inspection)
    dispatcher.register_method("agedepth.updateModel", session.update_age_depth_model)
    dispatcher.register_method("agedepth.generateEnsemble", session.generate_age_ensemble)

    def _generate_bacon_script(
        dates: list[dict[str, Any]],
        core_name: str = "MyCore",
        thickness: float = 5.0,
        cc: int = 1,
        hiatus_depths: list[float] | None = None,
        slumps: list | None = None,
        d_r: float | None = None,
        d_std: float | None = None,
        acc_mean: float | None = None,
        mem_mean: float = 0.7,
    ) -> str:
        """生成可交付的 rbacon 脚本；**至少要一条测年**。

        没有测年的 Bacon 脚本跑下去得到的是**纯先验年龄模型**：它看起来像结果，却没有任何
        数据约束——与导出的占位 CSV 属同一类误导。所以在生成这一端就拒绝，
        而不是让用户拿着脚本去 R 里发现没有约束。
        """
        if not dates:
            raise JsonRpcError(
                INVALID_PARAMS,
                "生成 Bacon 脚本至少需要一条测年：没有测年只会得到纯先验年龄模型。",
            )
        return generate_bacon_script(
            core_name=core_name,
            dates=dates,
            thickness=thickness,
            cc=cc,
            hiatus_depths=hiatus_depths,
            slumps=slumps,
            d_r=d_r,
            d_std=d_std,
            acc_mean=acc_mean,
            mem_mean=mem_mean,
        )

    dispatcher.register_method("agedepth.generateBaconScript", _generate_bacon_script)
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
