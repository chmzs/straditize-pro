# -*- coding: utf-8 -*-
"""B 项复验：Lead 的两条新发现（B-12 就绪清单不查标定 / B-01 硬编码 0+20 污染导出）。

Lead 的原始口径（hoya, 29 列, 用户零输入）：
  B-12: get_export_readiness() -> ready=True, readiness_missing=[]
        而 resolve_column_scale 逐列判定 calibrated = 0/29
  B-01: core.py:782-783 / :806-807 硬编码 startValue=0.0 / tickValue=20.0
        对照实验 tickValue 20->200 使导出前3列 40.25/53.0/31.75 -> 402.5/530.0/317.5
        比值精确 10.0/10.0/10.0

本脚本用**我自己的口径**独立复验，并补 Lead 未做的部分：
  T1  B-12：就绪清单 vs 逐列标定真实性（不只看 hoya，也看真图版）
  T2  B-01：tickValue 对照组，量化"正比"是否精确、影响面多大
  T3  这两个硬编码数值是否同样进入 **xlsx / LiPD / tar 内 data.csv**
      （Lead 没做；用四份产物同会话产出后逐格对账）
  T4  startValue 也有份吗（Lead 只测了 tickValue）

判据（先验证代理再测对象）：
  "数值正比于 tickValue"这个断言，只有在 val0=0 时数学上才严格成立
  （value = val0 + (x-px0)/(px1-px0)*(val1-val0)）。
  所以 T2 必须同时打印每个列的实际 (val0, val1, abs_px0, abs_px1)，
  而不是只比比值——否则无法区分"精确正比"和"恰好近似"。
"""
from __future__ import annotations

import json
import os
import sys
import tarfile

import _util as U  # noqa: E402

U.ensure_import_path()

OUT_DIR = "output/prod_gate/b_lead_findings"
FIG = "output/han2026_ngamring/fig3_raw.jpeg"


# ----------------------------------------------------------------------------
# T1: B-12 就绪清单不查标定
# ----------------------------------------------------------------------------
def t1_readiness_vs_calibration(s, label: str) -> dict:
    from straditize_core.session_parts.xscale import resolve_column_scale

    rd = s.get_export_readiness()
    cols = getattr(s, "columns", []) or []
    per = []
    for idx, c in enumerate(cols):
        sc = resolve_column_scale(s, c, idx)
        per.append(
            {
                "id": c.get("id"),
                "calibrated": sc.calibrated,
                "source": sc.source,
                "val0": sc.val0,
                "val1": sc.val1,
                "px0": sc.abs_px0,
                "px1": sc.abs_px1,
            }
        )
    n_cal = sum(1 for p in per if p["calibrated"])
    sources: dict[str, int] = {}
    for p in per:
        sources[p["source"]] = sources.get(p["source"], 0) + 1
    print(f"\n  [{label}]")
    print(f"    get_export_readiness -> ready={rd.get('ready')}  "
          f"readiness_missing={rd.get('readiness_missing')}  total_rois={rd.get('total_rois')}")
    print(f"    列总数 = {len(cols)}   真正 calibrated 的列 = {n_cal}/{len(cols)}")
    print(f"    source 分布 = {sources}")
    print(f"    >>> 就绪清单 ready={rd.get('ready')} 与 实际标定 {n_cal}/{len(cols)} 是否一致: "
          f"{'一致' if (rd.get('ready') and n_cal == len(cols) and len(cols) > 0) or (not rd.get('ready') and n_cal == 0) else '不一致（就绪清单放行了未标定的列）'}")
    return {"label": label, "readiness": rd, "per_column": per,
            "n_columns": len(cols), "n_calibrated": n_cal, "sources": sources}


def t1_run() -> None:
    print("\n" + "#" * 78)
    print("# T1  B-12：get_export_readiness 是否检查标定")
    print("#" * 78)
    from straditize_core.session import StraditizeSession

    results = []

    # 情形 1：hoya 零输入——只分列，不标定任何列
    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.detect_columns([315, 1946], [511, 1311], roi_id=s.rois[0]["id"])
    results.append(t1_readiness_vs_calibration(s, "hoya 零输入（只分列，零标定）"))

    # 情形 2：全部列真实标定——就绪清单应仍为 True
    s2 = StraditizeSession()
    s2._init_cleanup()
    s2.load_image(sample_key="hoya")
    s2.detect_columns([315, 1946], [511, 1311], roi_id=s2.rois[0]["id"])
    for i, c in enumerate(s2.columns):
        lo = c["start"] + (c["end"] - c["start"]) * 0.2
        hi = c["start"] + (c["end"] - c["start"]) * 0.8
        try:
            s2.calibrate_column_xticks(
                c["id"], ticks=[{"px": lo, "value": 0.0}, {"px": hi, "value": 40.0}], unit="%"
            )
        except Exception as exc:
            print(f"      calib col{i} FAIL: {exc}")
    results.append(t1_readiness_vs_calibration(s2, "hoya 全部列真实标定"))

    # 情形 3：真实图版手框 ROI，只标在图上印了数字的 2 列
    s3 = StraditizeSession()
    s3._init_cleanup()
    s3.load_image(os.path.join(U.ROOT, FIG))
    for r in list(s3.rois):
        s3.roi_remove(r["id"])
    rid = s3.roi_create(name="Ngamring", x0=330, x1=1330, y0=233, y1=861,
                        composition=True)["roi"]["id"]
    s3.roi_set_primary(rid)
    s3.roi_set_active(rid)
    s3.extract_foreground()
    s3.detect_columns(roi_id=rid)
    s3.calibrate_column_xticks(
        s3.columns[9]["id"],
        ticks=[{"px": 742.0, "value": 20.0}, {"px": 883.0, "value": 80.0}], unit="%",
    )
    results.append(t1_readiness_vs_calibration(s3, "真实图版 16 列，仅标定 1 列"))

    print("\n  --- T1 结论 ---")
    for r in results:
        print(f"    {r['label']:34s} ready={r['readiness'].get('ready')!s:5s} "
              f"calibrated={r['n_calibrated']}/{r['n_columns']}")


# ----------------------------------------------------------------------------
# T2/T3/T4: B-01 硬编码 0/20 污染四份导出产物
# ----------------------------------------------------------------------------
def build_session_for_b01(tick_value: float, start_value: float = 0.0,
                          calibrate_axes_too: bool = False):
    """hoya + 分列；**不调用 calibrate_column_xticks**，让列停在硬编码 legacy 值。"""
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(sample_key="hoya")
    s.extract_foreground()
    s.detect_columns([315, 1946], [511, 1311], roi_id=s.rois[0]["id"])
    # 手动改写 legacy 三件套（模拟硬编码取不同常量）
    for c in s.columns:
        c["startValue"] = float(start_value)
        c["tickValue"] = float(tick_value)
        c.pop("x_ticks", None)  # 确保走 legacy 分支
    if calibrate_axes_too:
        s.calibrate_axes(
            y_marks=[{"pixel": 511.0, "val": 0.0}, {"pixel": 1311.0, "val": 1300.0}], unit="cm"
        )
    for i in range(len(s.columns)):
        try:
            s.digitize(i)
        except Exception as exc:
            print(f"      digitize col{i} FAIL: {exc}")
    return s


def read_tar_csv(path: str):
    with tarfile.open(path) as tf:
        m = next(m for m in tf.getmembers() if m.name.endswith("data.csv"))
        text = tf.extractfile(m).read().decode("utf-8")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    rows = [ln.split(",") for ln in lines]
    return rows[0], rows[1:]


def read_xlsx_first_data_sheet(path: str):
    import openpyxl

    wb = openpyxl.load_workbook(path, data_only=True)
    best = None
    for ws in wb.worksheets:
        rows = [[("" if v is None else str(v)) for v in r] for r in ws.iter_rows(values_only=True)]
        if not rows:
            continue
        h = rows[0]
        if "depth" in h and len(h) > 3:  # 数据表
            best = (ws.title, h, rows[1:])
            break
    return best


def read_lipd_columns(path: str):
    d = json.loads(open(path, encoding="utf-8").read())
    pd0 = (d.get("paleoData") or [{}])[0]
    tables = pd0.get("paleoMeasurementTable") or []
    if not tables:
        return None, None
    t = tables[0]
    cols = t.get("columns") or []
    return [c.get("variableName") for c in cols], [
        (c.get("variableName"), c.get("values") or []) for c in cols
    ]


def fnum(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return float("nan")


def t2_b01() -> None:
    print("\n" + "#" * 78)
    print("# T2/T3  B-01：硬编码 startValue/tickValue 是否污染 csv/tar/xlsx/LiPD")
    print("#" * 78)
    os.makedirs(os.path.join(U.ROOT, OUT_DIR), exist_ok=True)

    from straditize_core.session_parts.xscale import resolve_column_scale

    runs: dict[str, dict] = {}
    for tag, tv, sv in (("tick20", 20.0, 0.0), ("tick200", 200.0, 0.0)):
        print(f"\n  === 组 {tag}: startValue={sv} tickValue={tv} ===")
        s = build_session_for_b01(tv, sv)
        # 打印前三列的实际 scale，验证"val0=0 时正比"这个前提
        print("    前三列 resolve_column_scale：")
        for i in range(min(3, len(s.columns))):
            sc = resolve_column_scale(s, s.columns[i], i)
            print(f"      col{i + 1}: calibrated={sc.calibrated} source={sc.source} "
                  f"val0={sc.val0} val1={sc.val1} px0={sc.abs_px0} px1={sc.abs_px1}")
        rd = s.get_export_readiness()
        print(f"    readiness: ready={rd.get('ready')} missing={rd.get('readiness_missing')}")

        paths = {
            "csv": os.path.join(U.ROOT, OUT_DIR, f"b01_{tag}.csv"),
            "tar": os.path.join(U.ROOT, OUT_DIR, f"b01_{tag}.tar"),
            "xlsx": os.path.join(U.ROOT, OUT_DIR, f"b01_{tag}.xlsx"),
            "lpd": os.path.join(U.ROOT, OUT_DIR, f"b01_{tag}.lpd"),
        }
        ed = s.export_data(format="csv", output_path=paths["csv"])
        print(f"    export_data(csv): rows={ed.get('rows_count')} cols={ed.get('columns_count')}")
        s.export_multi_tar(output_path=paths["tar"])
        s.export_multi_xlsx(output_path=paths["xlsx"])
        s.export_multi_lipd(output_path=paths["lpd"])
        runs[tag] = {"paths": paths, "tick_value": tv, "start_value": sv,
                     "rows": ed.get("rows_count"), "cols": ed.get("columns_count")}

    # ---------------- 逐产物对账 ----------------
    print("\n  --- 前 3 个数据行 × 前 3 列的数值对照 ---")
    a, b = runs["tick20"], runs["tick200"]

    # 1) 直出 csv
    la = [ln.split(",") for ln in open(a["paths"]["csv"], encoding="utf-8").read().splitlines() if ln.strip()]
    lb = [ln.split(",") for ln in open(b["paths"]["csv"], encoding="utf-8").read().splitlines() if ln.strip()]
    print("\n    [csv 直出]")
    print(f"      表头一致 = {la[0] == lb[0]}")
    ratios_csv = []
    for r in (1, 2, 3):
        va = [fnum(x) for x in la[r][1:4]]
        vb = [fnum(x) for x in lb[r][1:4]]
        rr = [round(y / x, 6) if x else None for x, y in zip(va, vb)]
        ratios_csv.append(rr)
        print(f"      行{r}: tick20={va}  tick200={vb}  比值={rr}")

    # 2) tar 内 data.csv
    th, tr = read_tar_csv(a["paths"]["tar"])
    th2, tr2 = read_tar_csv(b["paths"]["tar"])
    print("\n    [tar 内 data.csv]")
    print(f"      表头一致 = {th == th2}")
    ratios_tar = []
    for r in (0, 1, 2):
        va = [fnum(x) for x in tr[r][1:4]]
        vb = [fnum(x) for x in tr2[r][1:4]]
        rr = [round(y / x, 6) if x else None for x, y in zip(va, vb)]
        ratios_tar.append(rr)
        print(f"      行{r}: tick20={va}  tick200={vb}  比值={rr}")

    # 3) xlsx
    xa = read_xlsx_first_data_sheet(a["paths"]["xlsx"])
    xb = read_xlsx_first_data_sheet(b["paths"]["xlsx"])
    print("\n    [xlsx 数据表]")
    if xa and xb:
        print(f"      sheet 名: {xa[0]} vs {xb[0]}")
        print(f"      表头一致 = {xa[1] == xb[1]}")
        ratios_xlsx = []
        for r in (0, 1, 2):
            va = [fnum(x) for x in xa[2][r][1:4]]
            vb = [fnum(x) for x in xb[2][r][1:4]]
            rr = [round(y / x, 6) if x else None for x, y in zip(va, vb)]
            ratios_xlsx.append(rr)
            print(f"      行{r}: tick20={va}  tick200={vb}  比值={rr}")
    else:
        ratios_xlsx = None
        print(f"      未能定位数据表: xa={bool(xa)} xb={bool(xb)}")

    # 4) LiPD
    ha, ca = read_lipd_columns(a["paths"]["lpd"])
    hb, cb = read_lipd_columns(b["paths"]["lpd"])
    print("\n    [LiPD paleoMeasurementTable]")
    ratios_lpd = None
    if ha and hb:
        print(f"      列名一致 = {ha == hb}")
        # 取 col01..col03（跳过 depth）
        names = [n for n in ha if n != "depth"][:3]
        ratios_lpd = []
        for name in names:
            va = next((v for n, v in ca if n == name), [])
            vb = next((v for n, v in cb if n == name), [])
            sa = [fnum(x) for x in va[:3]]
            sb = [fnum(x) for x in vb[:3]]
            rr = [round(y / x, 6) if x else None for x, y in zip(sa, sb)]
            ratios_lpd.append(rr)
            print(f"      {name}: tick20={sa}  tick200={sb}  比值={rr}")
    else:
        print("      未能读到 LiPD 列")

    # ---------------- 判定 ----------------
    print("\n    --- T3 判定：比值是否在四份产物中一致地等于 tickValue 之比 ---")
    expected = b["tick_value"] / a["tick_value"]
    print(f"      期望比值（tickValue 之比）= {expected}")
    for name, ratios in (("csv", ratios_csv), ("tar", ratios_tar),
                         ("xlsx", ratios_xlsx), ("lipd", ratios_lpd)):
        if not ratios:
            print(f"      {name:5s}: <无数据>")
            continue
        flat = [x for row in ratios for x in row if x is not None]
        ok = all(abs(x - expected) < 1e-4 for x in flat) if flat else False
        print(f"      {name:5s}: 全部比值={flat}  是否精确等于 {expected}: {ok}")

    # ---------------- T4: startValue 是否也有份 ----------------
    print("\n" + "#" * 78)
    print("# T4  对照组：只动 startValue（0 -> 10），看导出是否也按比例变")
    print("#" * 78)
    s_ = build_session_for_b01(20.0, 0.0)
    s2_ = build_session_for_b01(20.0, 10.0)
    p1 = os.path.join(U.ROOT, OUT_DIR, "b01_start0.csv")
    p2 = os.path.join(U.ROOT, OUT_DIR, "b01_start10.csv")
    s_.export_data(format="csv", output_path=p1)
    s2_.export_data(format="csv", output_path=p2)
    l1 = [ln.split(",") for ln in open(p1, encoding="utf-8").read().splitlines() if ln.strip()]
    l2 = [ln.split(",") for ln in open(p2, encoding="utf-8").read().splitlines() if ln.strip()]
    print("  startValue 0 -> 10 的前 3 行 × 前 3 列：")
    for r in (1, 2, 3):
        v1 = [fnum(x) for x in l1[r][1:4]]
        v2 = [fnum(x) for x in l2[r][1:4]]
        print(f"    行{r}: start0={v1}  start10={v2}  差={[round(y - x, 6) for x, y in zip(v1, v2)]}")
    print("  => 若差恒为常数，说明 startValue 是加性偏移；若比值恒定，则是乘性。")
    print("     （这决定修复时两个常量必须一起处理，还是可以分开）")


def main() -> int:
    U.hash_banner("B 项：Lead 新发现独立复验")
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    if which in ("all", "t1"):
        t1_run()
    if which in ("all", "t2"):
        t2_b01()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
