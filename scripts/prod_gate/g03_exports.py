# -*- coding: utf-8 -*-
"""G-03：export.exportXlsx / export.exportLipd 端到端 + 与 .tar 内 data.csv 对账。

任务书要求：用真实会话语境跑这两个导出，检查产物真实可打开、列名/单位/深度列
与 .tar 内的 data.csv 一致。

对账用**同一会话、同一状态**同时产出 csv / tar / xlsx / lipd 四份，
因此任何差异都只能来自导出实现，不可能来自会话状态不同。

产物可打开性用独立读回器验证（不用写出的同一库自证）：
  · xlsx  -> openpyxl 独立打开，逐 sheet 读数
  · lipd  -> zipfile 打开，读 bag 内每个文件，按 LiPD 规范检查必备键
  · tar   -> tarfile 读 data.csv
"""
from __future__ import annotations

import io
import json
import os
import sys
import tarfile
import zipfile

import _util as U  # noqa: E402

U.ensure_import_path()

OUT_DIR = "output/prod_gate/g03"
FIG = "output/han2026_ngamring/fig3_raw.jpeg"


def build_session():
    """真实会话：真实 PDF 图版第 5 页 + 可标定的两列 + Y 轴 + 深度网格 + 样本。"""
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(os.path.join(U.ROOT, FIG))
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(name="Ngamring", x0=330, x1=1330, y0=233, y1=861,
                       composition=True)["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    s.extract_foreground()
    cands = s.detect_line_candidates(roi_id=rid)["candidates"]
    h_ids = [c["id"] for c in cands if c.get("kind") == "A"]
    s.apply_line_removal(roi_id=rid, selected_ids=h_ids)
    cols = s.detect_columns(roi_id=rid)
    # 图版只在 Euphorbiaceae(印 20/40/60/80) 与 Cyperaceae(印 20/40/60) 下面印了数字
    s.calibrate_column_xticks(
        cols[9]["id"], ticks=[{"px": 742.0, "value": 20.0}, {"px": 883.0, "value": 80.0}], unit="%"
    )
    s.calibrate_column_xticks(
        cols[10]["id"], ticks=[{"px": 954.0, "value": 20.0}, {"px": 1047.0, "value": 60.0}], unit="%"
    )
    s.calibrate_axes(
        y_marks=[{"pixel": 232.0, "val": 0.0}, {"pixel": 862.0, "val": 787.0}], unit="cm"
    )
    for i in range(len(cols)):
        try:
            s.digitize(i)
        except Exception:
            pass
    s.apply_depth_grid(start_depth=0.0, end_depth=787.0, step=10.0)
    s.samples_paste_depths([float(i) * 10.0 for i in range(0, 79)])
    # 真实题录，让 xlsx 的 meta_info / lipd 的元数据有内容
    try:
        s.metadata_update(
            {
                "publication": {
                    "doi": "10.1016/j.gloplacha.2025.105195",
                    "title": "A synthesis of pollen sequences from the central-western Tibetan Plateau",
                    "authors": ["Han Y.", "Liu L.", "Sun Z.", "Hou J.", "Cao X."],
                    "journal": "Global and Planetary Change",
                    "year": 2026,
                },
                "site": {"name": "Ngamring Co", "latitude": 29.3, "longitude": 85.3},
            }
        )
    except Exception as exc:
        print(f"    metadata_update 失败（不阻断）: {type(exc).__name__}: {exc}")
    return s, cols


def read_tar_csv(path: str) -> tuple[list[str], list[list[str]]]:
    with tarfile.open(path) as tf:
        m = next(m for m in tf.getmembers() if m.name.endswith("data.csv"))
        text = tf.extractfile(m).read().decode("utf-8")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    rows = [ln.split(",") for ln in lines]
    return rows[0], rows[1:]


def read_xlsx(path: str) -> dict[str, tuple[list[str], list[list[str]]]]:
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    out: dict[str, tuple[list[str], list[list[str]]]] = {}
    for ws in wb.worksheets:
        rows = []
        for row in ws.iter_rows(values_only=True):
            rows.append(["" if v is None else str(v) for v in row])
        if not rows:
            out[ws.title] = ([], [])
            continue
        out[ws.title] = (rows[0], rows[1:])
    return out


def read_lipd(path: str) -> dict[str, object]:
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        info = {"members": names}
        # LiPD 根级通常是 *.lpd 目录下的 json
        for n in names:
            if n.endswith(".json"):
                try:
                    info["json_file"] = n
                    info["data"] = json.loads(zf.read(n).decode("utf-8"))
                except Exception as exc:
                    info[f"json_error_{n}"] = str(exc)
        return info


def main() -> int:
    U.hash_banner("G-03 xlsx / LiPD end-to-end")
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)

    s, cols = build_session()
    print(f"\n会话就绪: {len(cols)} 列, is_calibrated={s.is_calibrated}, "
          f"samples={len(getattr(s, 'samples', []) or [])}, "
          f"depth_grid={len(getattr(s, 'depth_grid', []) or [])}")

    print("\n--- get_export_readiness ---")
    U.jprint(s.get_export_readiness())

    paths = {
        "csv": os.path.join(U.ROOT, OUT_DIR, "g03.csv"),
        "tar": os.path.join(U.ROOT, OUT_DIR, "g03.tar"),
        "xlsx": os.path.join(U.ROOT, OUT_DIR, "g03.xlsx"),
        "lpd": os.path.join(U.ROOT, OUT_DIR, "g03.lpd"),
    }

    print("\n--- 导出 ---")
    for label, fn in (
        ("csv", lambda: s.export_data(format="csv", output_path=paths["csv"])),
        ("tar", lambda: s.export_multi_tar(output_path=paths["tar"])),
        ("xlsx", lambda: s.export_multi_xlsx(output_path=paths["xlsx"])),
        ("lpd", lambda: s.export_multi_lipd(output_path=paths["lpd"])),
    ):
        try:
            r = fn()
            size = os.path.getsize(paths[label]) if os.path.exists(paths[label]) else 0
            print(f"    {label:5s} -> OK  size={size} B  "
                  f"{ {k: v for k, v in r.items() if not isinstance(v, (list, dict))} }")
        except Exception as exc:
            print(f"    {label:5s} -> {type(exc).__name__}: {exc}")

    # ---------- 对账 ----------
    print("\n" + "=" * 78)
    print("对账 1：.tar 内 data.csv  vs  .csv 直出")
    print("=" * 78)
    try:
        th, tr = read_tar_csv(paths["tar"])
        print(f"    tar/data.csv 表头 = {th}")
        print(f"    tar/data.csv 行数 = {len(tr)}")
        print(f"    tar/data.csv 首行 = {tr[0] if tr else None}")
        ch, cr = None, None
        if os.path.exists(paths["csv"]):
            lines = [ln for ln in open(paths["csv"], encoding="utf-8").read().splitlines() if ln.strip()]
            ch = lines[0].split(",")
            cr = [ln.split(",") for ln in lines[1:]]
            print(f"    .csv 表头 = {ch}")
            print(f"    .csv 行数 = {len(cr)}")
        if ch:
            print(f"    表头一致 = {th == ch}")
            # 逐格比对
            diffs = 0
            for i, (a, b) in enumerate(zip(tr, cr)):
                for j in range(min(len(a), len(b))):
                    try:
                        if abs(float(a[j]) - float(b[j])) > 1e-9:
                            diffs += 1
                            if diffs <= 5:
                                print(f"      差异 行{i} 列{j}: tar={a[j]} csv={b[j]}")
                    except (ValueError, TypeError):
                        if a[j] != b[j]:
                            diffs += 1
            print(f"    行数一致 = {len(tr) == len(cr)}   数值格差异数 = {diffs}")
    except Exception as exc:
        print(f"    tar/csv 对账失败 {type(exc).__name__}: {exc}")

    print("\n" + "=" * 78)
    print("对账 2：.xlsx 独立打开（openpyxl） + 与 tar/data.csv 对比")
    print("=" * 78)
    if not os.path.exists(paths["xlsx"]):
        print("    xlsx 不存在 -> FAIL")
    else:
        try:
            sheets = read_xlsx(paths["xlsx"])
            print(f"    sheet 数 = {len(sheets)}")
            for name, (h, rows) in sheets.items():
                print(f"      [{name}] 列数={len(h) if h else 0} 数据行={len(rows)}")
                print(f"          表头 = {h[:12] if h else None}")
                if rows:
                    print(f"          首行 = {rows[0][:8]}")
        except Exception as exc:
            print(f"    openpyxl 打开失败 {type(exc).__name__}: {exc}")
            sheets = {}

        if sheets:
            # 数据 sheet 通常叫 pollen / data / *_pollen
            cand = [n for n in sheets if "pollen" in n.lower() or n.lower() in ("data", "sheet1")]
            print(f"\n    候选数据 sheet = {cand}")
            for n in cand:
                h, rows = sheets[n]
                print(f"    [{n}] 与 tar/data.csv 对比：")
                print(f"      xlsx 表头 = {h}")
                print(f"      tar  表头 = {th}")
                print(f"      表头一致 = {h == th}")
                # 深度列对比
                if h and th:
                    try:
                        xi = h.index("depth") if "depth" in h else 0
                        ti = th.index("depth") if "depth" in th else 0
                        xd = [r[xi] for r in rows[:10]]
                        td = [r[ti] for r in tr[:10]]
                        print(f"      xlsx 深度前10 = {xd}")
                        print(f"      tar  深度前10 = {td}")
                        same = all(
                            abs(float(a) - float(b)) < 1e-9
                            for a, b in zip(xd, td)
                            if a not in ("", "None") and b not in ("", "None")
                        )
                        print(f"      深度列一致 = {same}")
                    except Exception as exc:
                        print(f"      深度列对比失败: {exc}")

    print("\n" + "=" * 78)
    print("对账 3：.lpd 独立打开（zipfile） + LiPD 规范必备键")
    print("=" * 78)
    if not os.path.exists(paths["lpd"]):
        print("    lpd 不存在 -> FAIL")
    else:
        try:
            info = read_lipd(paths["lpd"])
            print(f"    members = {info.get('members')}")
            data = info.get("data")
            if isinstance(data, dict):
                print(f"    json 顶层键 = {sorted(data.keys())}")
                for k in ("datasetName", "investigators", "geo", "paleoData", "chronData", "pub"):
                    print(f"      {k}: {'有' if k in data else '缺'}")
                pd_ = data.get("paleoData") or []
                print(f"      paleoData 表数 = {len(pd_) if isinstance(pd_, list) else '?'}")
                if isinstance(pd_, list) and pd_:
                    tbl = pd_[0]
                    print(f"      paleoData[0] 键 = {sorted(tbl.keys()) if isinstance(tbl, dict) else '?'}")
                    mv = (tbl or {}).get("measurementTable") or []
                    print(f"      paleoData[0].measurementTable 表数 = {len(mv) if isinstance(mv, list) else '?'}")
                    if isinstance(mv, list) and mv:
                        mt = mv[0]
                        cols_ = mt.get("columns") or []
                        print(f"      measurementTable[0] 列数 = {len(cols_)}")
                        for c in cols_[:6]:
                            if isinstance(c, dict):
                                print(f"        {c.get('variableName')!r:28s} "
                                      f"units={c.get('units')!r} "
                                      f"n={len(c.get('values') or [])}")
            else:
                print(f"    未能读到 json: { [k for k in info if k.startswith('json_error')] }")
        except Exception as exc:
            print(f"    zipfile 打开失败 {type(exc).__name__}: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
