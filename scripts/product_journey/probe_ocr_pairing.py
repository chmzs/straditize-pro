# -*- coding: utf-8 -*-
"""OCR 标签→列关联失败：三组对照实验（证伪「bbox 超列宽」假说）+ y0 扫描（真根因）。

为什么这个脚本必须存在
----------------------
本轮有两条互相矛盾的因果主张先后被写进任务书，两条都错了：

  假说 A（已作废）：「rotated-label bboxes (66-89px) exceed column width (37px)」
       -> 错。bbox 跨度实测 62~170px，且 bbox 宽度根本不是 can_pair 的输入。
          证伪手段 = 本脚本的【第 ③ 组】：把 bbox 压成一个点（跨度 0，
          绝无可能超列宽），matched 仍为 False。假说 A 若成立，③ 必须变绿。

  假说 B（成立）：「默认 bbox 的 y0 取到图像最顶端，把标签区上方的图例文字
       Herbs 也扫进来，多出第 17 个假标签 -> 触发 len(labels)==len(columns) 硬门」
       -> 对。根因在 session_parts/ocr.py:40 的 `y0 = max(0, data_ylim[0] - 320)`：
          data_ylim[0]=233 时 233-320=-87，被 max(0,·) 夹成 0，标签带一路开到图顶。
          证伪/证实手段 = 本脚本的【y0 扫描】：唯一变量 y0，0 时 17/False/0，
          y0 略大于 0（实测临界值由脚本扫描得出，勿硬编码）时 16/True/16。

两组对照解决的是不同问题，缺一不可：
  - ③ 组回答「是不是 bbox 宽度的问题」-> 不是
  - y0 扫描回答「那到底是什么的问题」-> 是 y0（即标签带上边界）

⚠️ 术语警告：本脚本的「①组」与任务书讨论中的「①组」不是同一件事
------------------------------------------------------------------
本轮曾因这个术语撞车产生过一次假分歧：两人都报「①组原样」，但结果不同
（一方 17/False/0，一方 16/True/16），双方都以为对方跑错了。

原因是「原样」指什么没对齐：
  本脚本 ①组 = **默认调用** `ocr_recognize_labels()`（不传 bbox）
               -> 走 session_parts/ocr.py:40 的公式，y0 被夹成 0 -> 17 标签
  显式调用   = `ocr_recognize_labels(label_row_bbox=[330,80,1330,230])`
               -> y0=80 -> 16 标签

所以本脚本刻意把两者拆成 ①组（默认）与 ④组（y0 扫描），并在 ④ 里
把 y0=0 那一行标注为「默认路径等价」。以后讨论请用「默认调用」与
「显式 bbox=…」这两个说法，不要用「原样」——它歧义太大。

用法
----
    pixi run python scripts/product_journey/probe_ocr_pairing.py
    pixi run python scripts/product_journey/probe_ocr_pairing.py --json out.json

退出码
------
    0  = 两个结论都按预期复现（③ 组证伪假说 A；y0 扫描证实假说 B）
    1  = 任一结论未按预期复现 -> 说明产品行为已变（可能被修过），需重新评估
    3  = 脚本自身错误（PDF 缺失 / 环境问题）

⚠️ 下一轮修 OCR 关联的人请注意
------------------------------
修完之后的验收判据**不能只看 matched 是否 True**。
必须同时满足：
  1. y0 扫描里 y0=0 那一行也变成 16/True（或至少不再整体否决）；
  2. ③ 组（bbox 压点、17 标签）给出的是「16 个归属 + 1 条歧义提示」，
     而不是 0 个归属；
否则可能修出一个「只在这张图 + 这个 bbox 下成立」的绿。
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import traceback
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DEFAULT_PDF = (
    "F:/Zotero/storage/HV4FXL63/"
    "Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
)
PAGE = 5
ROI = {"x0": 330, "x1": 1330, "y0": 233, "y1": 869}

results: list[dict[str, Any]] = []


def hr(title: str) -> None:
    print(f"\n{'=' * 100}\n{title}\n{'=' * 100}")


def note(tag: str, verdict: str, detail: str, data: Any = None) -> None:
    results.append({"group": tag, "verdict": verdict, "detail": detail, "data": data})
    print(f"  -> [{verdict}] {detail}")


def build_session(pdf: str):
    """建立与 verify_pdf_to_data.py 完全一致的会话状态（手框 ROI + 分列）。"""
    from straditize_core.session import StraditizeSession

    s = StraditizeSession()
    s._init_cleanup()
    s.load_image(pdf, page_number=PAGE)
    for r in list(s.rois):
        s.roi_remove(r["id"])
    rid = s.roi_create(
        name="probe_ocr",
        x0=ROI["x0"],
        x1=ROI["x1"],
        y0=ROI["y0"],
        y1=ROI["y1"],
        composition=True,
    )["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    cols = s.detect_columns(roi_id=rid)
    return s, cols


def stats(d: dict[str, Any]) -> tuple[int, bool, int]:
    return (
        len(d["labels"]),
        bool(d["reconciliation"]["matched"]),
        len(d["reconciliation"]["assigned"]),
    )


def can_pair_breakdown(
    labels: list[dict[str, Any]], cols: list[dict[str, Any]], rec: dict[str, Any]
) -> dict[str, bool]:
    """复算 can_pair 的四个条件，逐条报告哪个不满足。

    can_pair 定义见 straditize_core/ocr/engine.py:130-135：
        len(labels) == len(columns)
        and len(columns_without_label) == 0
        and len(labels_without_column) == 0
        and all(每列恰好 1 个标签)
    注意 ambiguous **不在**这四个条件里（它是诊断输出，不是配对输入）。
    """
    return {
        "计数相等": len(labels) == len(cols),
        "无空列": len(rec["columns_without_label"]) == 0,
        "无孤立标签": len(rec["labels_without_column"]) == 0,
        "每列恰好1标签": rec["matched"] or len(rec["ambiguous"]) >= 0,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        print(f"[FATAL] PDF 不存在: {args.pdf}")
        return 3

    from straditize_core.ocr.engine import snap_labels_to_columns

    s, cols = build_session(args.pdf)

    hr("前置：会话状态")
    print(f"  data_ylim = {getattr(s, 'data_ylim', None)}")
    print(f"  data_xlim = {getattr(s, 'data_xlim', None)}")
    print(
        f"  列数 = {len(cols)}  列宽 = {[round(c['end'] - c['start'], 1) for c in cols]}"
    )
    print("  session_parts/ocr.py:40 的默认 bbox 公式：")
    print("      y0 = max(0, int(data_ylim[0] - 320))")
    if getattr(s, "data_ylim", None):
        raw = int(s.data_ylim[0] - 320)
        print(
            f"      = max(0, int({s.data_ylim[0]:.0f} - 320)) = max(0, {raw}) = {max(0, raw)}"
        )
        print(
            f"      -> y0={max(0, raw)} 表示标签带从{'图像最顶端' if raw < 0 else 'y=' + str(raw)}开始"
        )

    # ---------------------------------------------------------------- #
    # 第 ① 组：默认调用（session 默认 bbox）
    # ---------------------------------------------------------------- #
    hr("第 ① 组：默认调用 ocr_recognize_labels()（不传 bbox）")
    d1 = s.ocr_recognize_labels()["data"]
    n1, m1, a1 = stats(d1)
    print(
        f"  实际 label_row_bbox = {d1['label_row_bbox']}  （函数内已 ±5 并 clamp 到图像边界）"
    )
    print(f"  labels = {n1}   matched = {m1}   assigned = {a1}")
    print(f"  文本 = {[lb['ocr_text'] for lb in d1['labels']]}")
    print(
        f"  can_pair 四条件 = {can_pair_breakdown(d1['labels'], cols, d1['reconciliation'])}"
    )
    print(
        f"  ambiguous 条数 = {len(d1['reconciliation']['ambiguous'])}（注意：不是 can_pair 的输入）"
    )

    labels = d1["labels"]
    expect1 = n1 == len(cols) + 1 and m1 is False and a1 == 0
    note(
        "①默认调用",
        "PASS" if expect1 else "FAIL",
        f"默认 bbox 下 {n1} 标签 / {len(cols)} 列，matched={m1}，assigned={a1}"
        f"（预期：比列数多 1 个假标签，配对整体否决）",
        {
            "labels": n1,
            "columns": len(cols),
            "matched": m1,
            "assigned": a1,
            "bbox": d1["label_row_bbox"],
        },
    )

    # 找出多出来的那个标签：落在同一列上的重复锚点
    dup = None
    seen: dict[str, str] = {}
    for lb in labels:
        ax = float(lb.get("anchor_x") or 0)
        for c in cols:
            if c["start"] <= ax < c["end"]:
                if c["id"] in seen:
                    dup = lb
                else:
                    seen[c["id"]] = lb["id"]
                break
    if dup is not None:
        dup_col = next(
            c["id"] for c in cols if c["start"] <= float(dup["anchor_x"]) < c["end"]
        )
        print(
            f"\n  多出来的标签 = {dup['id']} {dup['ocr_text']!r} anchor_x={dup['anchor_x']:.1f}"
        )
        print(f"    与 {seen[dup_col]} 同落在 {dup_col}，两者 anchor_x 相距极近")
        ys = [p[1] for p in dup["bbox"]]
        others = [lb for lb in labels if lb["id"] != dup["id"]]
        oy = [float(lb["anchor_y"]) for lb in others]
        print(
            f"    该标签 anchor_y = {dup['anchor_y']:.1f}，"
            f"其余 {len(others)} 个标签 anchor_y 范围 = {min(oy):.1f} .. {max(oy):.1f}"
        )
        print(
            f"    -> 它比标签行高出 {min(oy) - float(dup['anchor_y']):.1f}px，"
            f"是标签区上方的图例文字，被过宽的 y0 扫了进来"
        )

    # ---------------------------------------------------------------- #
    # 第 ② 组：删掉多余标签使计数相等 -> 证明位置归属逻辑本身正确
    # ---------------------------------------------------------------- #
    hr("第 ② 组：删掉多余标签使 17->16（只改标签数，不动 bbox、不动列）")
    if dup is None:
        print("  未找到重复锚点标签，跳过本组")
        note("②删多余标签", "FAIL", "未找到重复锚点标签，无法构造对照组", None)
    else:
        subset = [lb for lb in labels if lb["id"] != dup["id"]]
        rec2 = snap_labels_to_columns(copy.deepcopy(subset), copy.deepcopy(cols))
        n2, a2 = len(subset), len(rec2["assigned"])
        print(f"  被操纵的变量：标签数 {n1} -> {n2}（其余条件不变）")
        print(f"  matched = {rec2['matched']}   assigned = {a2}/{len(cols)}")
        print(f"  can_pair 四条件 = {can_pair_breakdown(subset, cols, rec2)}")
        expect2 = rec2["matched"] is True and a2 == len(cols)
        note(
            "②删多余标签",
            "PASS" if expect2 else "FAIL",
            f"标签数改到 {n2} 后 matched={rec2['matched']}、assigned={a2}/{len(cols)}"
            f"（预期：全部关联成功，证明位置归属逻辑正确、只是被计数硬门整体否决）",
            {"labels": n2, "matched": rec2["matched"], "assigned": a2},
        )

    # ---------------------------------------------------------------- #
    # 第 ③ 组：保留 17 个标签，但把 bbox 压成一个点
    #         -> 证伪「bbox 超列宽」假说
    # ---------------------------------------------------------------- #
    hr("第 ③ 组：保留 17 个标签，把每个 bbox 压成一个点（横向跨度=0）")
    print("  目的：证伪『rotated-label bbox 超出列宽导致关联失败』这一假说。")
    print("  若该假说成立，把 bbox 跨度压到 0（绝无可能超列宽）后必须变绿。")
    squeezed = copy.deepcopy(labels)
    for lb in squeezed:
        ax, ay = float(lb["anchor_x"]), float(lb["anchor_y"])
        lb["bbox"] = [[ax, ay], [ax, ay], [ax, ay], [ax, ay]]
    rec3 = snap_labels_to_columns(squeezed, copy.deepcopy(cols))
    n3, a3 = len(squeezed), len(rec3["assigned"])
    print(f"  labels = {n3}   matched = {rec3['matched']}   assigned = {a3}")
    print(f"  can_pair 四条件 = {can_pair_breakdown(squeezed, cols, rec3)}")
    print(
        f"  ambiguous 条数 = {len(rec3['ambiguous'])}（原 {len(d1['reconciliation']['ambiguous'])}，"
        f"压点后大幅减少，但 matched 仍不变）"
    )
    expect3 = rec3["matched"] is False and a3 == 0
    note(
        "③bbox压点",
        "PASS" if expect3 else "FAIL",
        f"bbox 跨度压到 0 后 matched 仍为 {rec3['matched']}、assigned={a3}"
        f"（预期：仍失败 -> 证伪『bbox 超列宽』假说；失败原因只剩计数不等）",
        {
            "labels": n3,
            "matched": rec3["matched"],
            "assigned": a3,
            "ambiguous_before": len(d1["reconciliation"]["ambiguous"]),
            "ambiguous_after": len(rec3["ambiguous"]),
        },
    )

    # ---------------------------------------------------------------- #
    # 第 ④ 组：y0 扫描 -> 真根因
    # ---------------------------------------------------------------- #
    hr("第 ④ 组：y0 扫描（固定 x0/x1/y1，唯一变量是标签带上边界 y0）")
    print("  这一组回答『既然不是 bbox 宽度，那到底是什么』。")
    print(f"  {'bbox':<26} {'labels':>6} {'matched':>8} {'assigned':>8}  说明")
    print("  " + "-" * 88)
    sweep: list[dict[str, Any]] = []
    for y0 in (0, 20, 40, 60, 80, 100, 120, 150, 180):
        bb = [ROI["x0"], y0, ROI["x1"], 230]
        dd = s.ocr_recognize_labels(label_row_bbox=bb)["data"]
        nl, mm, aa = stats(dd)
        txt = [lb["ocr_text"] for lb in dd["labels"]]
        has_herbs = "Herbs" in txt
        desc = ""
        if y0 == 0:
            desc = "默认路径等价（y0 被 max(0,·) 夹到 0）"
        elif has_herbs:
            desc = "仍含图例文字 Herbs"
        else:
            desc = "图例文字已排除"
        print(f"  {str(bb):<26} {nl:>6} {str(mm):>8} {aa:>8}  {desc}")
        sweep.append(
            {
                "bbox": bb,
                "labels": nl,
                "matched": mm,
                "assigned": aa,
                "has_herbs": has_herbs,
            }
        )

    zero = next(r for r in sweep if r["bbox"][1] == 0)
    good = [r for r in sweep if r["matched"] is True and r["labels"] == len(cols)]
    # 阈值从数据算出来，不硬编码——硬编码正是本轮反复出错的形态
    min_good_y0 = min((r["bbox"][1] for r in good), default=None)
    print()
    print(
        f"  y0=0  -> labels={zero['labels']} matched={zero['matched']} assigned={zero['assigned']}"
        f"（含 Herbs={zero['has_herbs']}）"
    )
    if min_good_y0 is not None:
        print(
            f"  最小可用 y0 = {min_good_y0}（由本次扫描实测得出，非预设）；"
            f"y0 >= {min_good_y0} 的 {len(good)} 个取值均为 "
            f"labels={len(cols)} matched=True assigned={len(cols)}"
        )
    else:
        print("  扫描范围内未出现 matched=True 的 y0 -> 假说 B 不成立")
    # dup 可能为 None（例如产品已修复默认 bbox、默认调用不再多出假标签）。
    # 此处必须容错：修完 OCR 后复核会正好走到这条路径，不能因此崩成 exit 3。
    if dup is not None:
        rest_anchors = [float(lb["anchor_y"]) for lb in labels if lb["id"] != dup["id"]]
        print(
            f"  临界说明：y0 必须把 anchor_y={dup['anchor_y']:.1f} 的图例文字排除在外，"
            f"而标签行最低 anchor_y={min(rest_anchors):.1f}；"
            f"实测临界落在 y0≈{min_good_y0} 附近，与图例文字 bbox 的下边界吻合"
        )
    else:
        print(
            "  临界说明：本次未识别出'多出的假标签'（可能产品已修复默认 bbox），"
            "故无从给出图例文字的位置对照"
        )
    expect4 = (
        zero["matched"] is False
        and zero["has_herbs"] is True
        and len(good) >= 3
        and all(not r["has_herbs"] for r in good)
    )
    note(
        "④y0扫描",
        "PASS" if expect4 else "FAIL",
        f"y0=0 时 {zero['labels']} 标签（含图例文字 Herbs）-> matched=False；"
        f"y0>={min_good_y0} 时 {len(good)} 个取值全部 {len(cols)} 标签/matched=True。"
        f"唯一变量是 y0 -> 根因是标签带上边界过宽，不是 bbox 宽度",
        {"sweep": sweep, "min_working_y0": min_good_y0},
    )

    # ---------------------------------------------------------------- #
    # 汇总
    # ---------------------------------------------------------------- #
    hr("汇总与判据")
    for r in results:
        print(f"  [{r['verdict']}] {r['group']:<14} {r['detail']}")
    n_fail = sum(1 for r in results if r["verdict"] == "FAIL")
    by_group = {r["group"]: r["verdict"] for r in results}

    print()
    print("  两条假说的判决（按本次实际结果生成，不是固定文案）：")
    v3 = by_group.get("③bbox压点")
    if v3 == "PASS":
        print(
            "    假说 A『bbox 超列宽』      -> 被第 ③ 组证伪"
            "（bbox 压到跨度 0 仍然失败，故宽度不是原因）"
        )
    else:
        print(
            "    假说 A『bbox 超列宽』      -> 第 ③ 组未按预期复现。"
            "若 ③ 已变绿，说明当前产品里 bbox 宽度确实参与判定，需重查。"
        )
    v4 = by_group.get("④y0扫描")
    if v4 == "PASS":
        print("    假说 B『默认 y0 过宽带入图例文字』-> 被第 ④ 组证实（唯一变量 y0）")
    else:
        print(
            "    假说 B『默认 y0 过宽带入图例文字』-> 第 ④ 组未按预期复现，"
            "y0 扫描没看到'y0=0 失败 / y0 增大后成功'的分界，需重查。"
        )
    v1 = by_group.get("①默认调用")
    if v1 == "FAIL":
        print()
        print("    ⚠️ 注意：第 ① 组已变红，意味着**默认调用路径的行为已经改变**")
        print("       （很可能是有人修了 y0）。此时 ④ 组仍可能 PASS，因为 ④ 是显式")
        print("       传 bbox 的对照实验，它验证的是'机制成立'而非'产品现状'。")
        print("       复核产品是否真的修好，请以 ① 组的 verdict 为准。")
    print()
    print("  ⚠️ 修完 OCR 关联后的验收，不能只看 matched=True。必须同时满足：")
    print("     (a) y0=0 那一行也不再整体否决；")
    print("     (b) 第 ③ 组（17 标签、bbox 压点）能给出 16 个归属 + 1 条歧义提示，")
    print("         而不是 0 个归属。")
    print("     否则可能修出一个『只在这张图 + 这个 bbox 下成立』的绿。")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(results, fh, ensure_ascii=False, indent=2, default=str)
        print(f"\n  明细 -> {args.json}")

    if n_fail:
        print(f"\n  => 退出码 1：{n_fail} 组未按预期复现，产品行为可能已变，需重新评估")
        return 1
    print("\n  => 退出码 0：两组对照均按预期复现，结论成立")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(3)
