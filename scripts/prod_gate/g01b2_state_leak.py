# -*- coding: utf-8 -*-
"""G-01(b2)：load_image / switch_pdf_page 会不会漏清「非几何」状态。

设计动机：E1/E3 已证明 **几何 + 标定** 换页后被清空（PASS）。
但读 `core.py:load_image` 的复位块可见它只覆盖了 image/mask/columns/cleanup/
x_ticks/y_scale/depth_calib/depth_grid/data_*，**没有**覆盖：
    samples / paper_metadata / age_depth_model / age_depth_image /
    age_depth_calib_state / ensemble / caches
读代码不算结论，所以本探针用真实会话把这些状态**真的写进去**，
再换页，看它们是否活下来并污染新页的导出。

判别性判据（不是"有值就算残留"）：换页后这些字段是否仍在，
且是否会被 export_data / get_export_readiness / project_save 当真使用。
"""
from __future__ import annotations

import os
import sys

import _util as U  # noqa: E402

U.ensure_import_path()

PDF = "F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
OUT_DIR = "output/prod_gate"


def state(s, label: str) -> dict[str, object]:
    return {
        "label": label,
        "pdf_page": (getattr(s, "pdf_info", None) or {}).get("current_page"),
        "size": (getattr(s, "width", None), getattr(s, "height", None)),
        "n_columns": len(getattr(s, "columns", []) or []),
        "n_samples": len(getattr(s, "samples", []) or []),
        "samples_head": (getattr(s, "samples", []) or [])[:2],
        "n_depth_grid": len(getattr(s, "depth_grid", []) or []),
        "taxa_names": (getattr(s, "taxa_names", []) or [])[:5],
        "paper_metadata_keys": sorted((getattr(s, "paper_metadata", {}) or {}).keys()),
        "paper_metadata_doi": (getattr(s, "paper_metadata", {}) or {}).get(
            "publication", {}
        ).get("doi", None)
        if isinstance((getattr(s, "paper_metadata", {}) or {}).get("publication"), dict)
        else None,
        "depth_calib": getattr(s, "depth_calib", None),
        "depth_unit": getattr(s, "depth_unit", None),
        "is_calibrated": getattr(s, "is_calibrated", None),
        "y_scale": getattr(s, "y_scale", None),
        "age_depth_model": (
            None if getattr(s, "age_depth_model", None) is None else "<model object>"
        ),
        "age_depth_image": (
            None if getattr(s, "age_depth_image", None) is None else "<image present>"
        ),
        "n_ensemble": len(getattr(s, "ensemble", []) or [])
        if hasattr(s, "ensemble")
        else "<attr missing>",
    }


def main() -> int:
    U.hash_banner("G-01(b2) non-geometry state across PDF page switch")
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()

    # ---- 在 page 5 建一份"完整用户状态" ----
    s.load_image(os.path.abspath(PDF), page_number=5)
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(name="p5", x0=330, x1=1330, y0=233, y1=861, composition=True)["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    s.detect_columns(roi_id=rid)
    s.calibrate_axes(
        y_marks=[{"pixel": 232.0, "val": 0.0}, {"pixel": 862.0, "val": 787.0}], unit="cm"
    )
    # 真实写样本
    depths = [float(i) * 5.0 for i in range(20)]
    s.samples_set([{"depth": d, "label": f"{d:g}cm"} for d in depths])
    # 真实写题录
    try:
        s.metadata_update(
            {
                "publication": {
                    "doi": "10.1016/j.gloplacha.2025.105195",
                    "title": "A synthesis of pollen sequences from the central-western Tibetan Plateau",
                    "year": 2026,
                }
            }
        )
    except Exception as exc:
        print(f"    metadata_update 失败: {type(exc).__name__}: {exc}")

    before = state(s, "page5 建好状态")
    print("\n[BEFORE] page5 的用户状态")
    U.jprint(before)

    # ---- 换到 page 9（另一张真实图版，尺寸 1305x1946） ----
    print("\n>>> switch_pdf_page(9)")
    s.switch_pdf_page(9)
    after = state(s, "after switch to page9")
    print("\n[AFTER] page9 上的状态")
    U.jprint(after)

    print("\n--- 判定：哪些非几何状态跨页活了下来 ---")
    survived = []
    for k in ("n_samples", "n_depth_grid", "taxa_names", "paper_metadata_doi", "depth_unit", "n_ensemble"):
        b, a = before.get(k), after.get(k)
        live = a not in (None, 0, [], {}, "<attr missing>")
        print(f"    {k:22s} before={b!r:30.40s} after={a!r:30.40s} "
              f"{'存活' if live else '已清'}")
        if live and b not in (None, 0, [], {}):
            survived.append(k)
    print(f"    跨页存活字段: {survived}")

    # ---- 关键：这些存活字段会不会被下游当真使用 ----
    print("\n>>> 在 page9 上跑一次 get_export_readiness / export_data，看残留是否被当真")
    try:
        rd = s.get_export_readiness()
        U.jprint({k: v for k, v in rd.items() if not isinstance(v, (list, dict))})
        if isinstance(rd.get("checks"), list):
            print(f"    checks 条数 = {len(rd['checks'])}")
            for c in rd["checks"][:10]:
                print(f"      {c.get('id') or c.get('name')}: {c.get('status') or c.get('ok')} "
                      f"{str(c.get('message') or c.get('detail') or '')[:100]}")
    except Exception as exc:
        print(f"    {type(exc).__name__}: {exc}")

    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)
    out_csv = os.path.join(U.ROOT, OUT_DIR, "page9_after_switch.csv")
    print(f"\n>>> 在 page9 上 export_data -> {out_csv}")
    try:
        ed = s.export_data(format="csv", output_path=out_csv)
        U.jprint({k: v for k, v in ed.items() if not isinstance(v, (list, dict))})
        if os.path.exists(out_csv):
            with open(out_csv, encoding="utf-8") as fh:
                lines = fh.readlines()
            print(f"    行数(含表头)={len(lines)}")
            print(f"    表头={lines[0].strip()[:200]}")
            print(f"    首行={lines[1].strip()[:200] if len(lines) > 1 else '<empty>'}")
            # 残留 samples 若被当真，会出现 5cm 步长的深度
            depths_seen = []
            for ln in lines[1:9]:
                depths_seen.append(ln.split(",")[0])
            print(f"    前 8 个深度值={depths_seen}")
    except Exception as exc:
        print(f"    {type(exc).__name__}: {exc}")

    print("\n>>> 在 page9 上 project_save，看残留字段是否被写进工程包")
    out_json = os.path.join(U.ROOT, OUT_DIR, "page9_after_switch.project.json")
    try:
        ps = s.project_save(output_path=out_json, format="json")
        U.jprint({k: v for k, v in ps.items() if not isinstance(v, (list, dict))})
        import json

        with open(out_json, encoding="utf-8") as fh:
            pj = json.load(fh)
        print(f"    工程包 version={pj.get('version')} schema_version={pj.get('schema_version')}")
        print(f"    samples 条数={len(pj.get('samples') or [])}")
        print(f"    depth_calibration={pj.get('depth_calibration')}")
        pm = pj.get("paper_metadata") or {}
        print(f"    paper_metadata.publication.doi={(pm.get('publication') or {}).get('doi')}")
    except Exception as exc:
        print(f"    {type(exc).__name__}: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
