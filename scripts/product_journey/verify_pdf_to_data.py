# -*- coding: utf-8 -*-
"""产品旅程验证：论文 PDF -> 可用科研数据，一条命令跑完全链路。

设计原则（本轮教训的固化）
--------------------------
1. **先看结构再取值**。每个后端返回都先打印 `list(keys)`，再从已知键取值。
   禁止"猜字段名 -> 拿到 None -> 判产品坏"。Lead 本轮四次误判里三次源于此。
2. **真值必须与产品同口径**。数据质量对比不使用"墨迹行占比"这类直觉口径，
   而用与产品同一物理量（每行曲线墨迹的 x 位置），在同一套标度参数下换算。
   口径不同的两个数字相减没有意义。
3. **四态判定**，宁可 UNCERTAIN 不凑数：
   PASS / FAIL / PARTIAL / UNCERTAIN。
4. **不调参凑结论**。所有数字来自真实运行；不可复现的外部数字如实标注。

用法
----
    pixi run python scripts/product_journey/verify_pdf_to_data.py
    pixi run python scripts/product_journey/verify_pdf_to_data.py --page 5 --json out.json

退出码
------
    0  = 全链路通且无缺陷（无 FAIL / PARTIAL / UNCERTAIN）
    1  = 存在阻断项（FAIL）：用户走不到可用数据
    2  = 链路跑通、能产出数据，但存在 PARTIAL 或 UNCERTAIN（需人工判断能否交付）

    说明：退出码 0 在真实图版上通常不可达——本产品当前至少有两处 PARTIAL
    （建议 ROI 漏数据、OCR 关联被计数硬门拒掉）。把 0 定义为"零缺陷"而不是
    "跑通了"，是为了让这个脚本能当门禁用：只要还有已知缺陷就不该返回绿。
    若只想判断"能不能产出数据"，看是否非 1 即可。
"""

from __future__ import annotations

import argparse
import copy
import io
import json
import os
import sys
import traceback
from typing import Any

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DEFAULT_PDF = (
    "F:/Zotero/storage/HV4FXL63/"
    "Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf"
)

#: 用户手工框住的真实数据区（肉眼框住花粉柱状区，含底部横轴）
USER_ROI = {"x0": 330, "x1": 1330, "y0": 233, "y1": 869}

PASS, FAIL, PARTIAL, UNCERTAIN = "PASS", "FAIL", "PARTIAL", "UNCERTAIN"

_results: list[dict[str, Any]] = []


# --------------------------------------------------------------------------- #
# 报告原语
# --------------------------------------------------------------------------- #
def hr(title: str = "", char: str = "=") -> None:
    if title:
        print(f"\n{char * 100}\n{title}\n{char * 100}")
    else:
        print(char * 100)


def show_keys(name: str, obj: Any) -> None:
    """纪律 1：取值前先看结构。"""
    if isinstance(obj, dict):
        print(f"  [{name}] dict keys = {list(obj.keys())}")
    elif isinstance(obj, (list, tuple)):
        print(f"  [{name}] list len = {len(obj)}")
        if obj and isinstance(obj[0], dict):
            print(f"  [{name}][0] dict keys = {list(obj[0].keys())}")
    else:
        print(f"  [{name}] {type(obj).__name__} = {str(obj)[:160]}")


def record(station: str, verdict: str, detail: str, data: Any = None) -> None:
    _results.append(
        {"station": station, "verdict": verdict, "detail": detail, "data": data}
    )
    tag = {PASS: "[PASS]", FAIL: "[FAIL]", PARTIAL: "[PART]", UNCERTAIN: "[UNCT]"}[
        verdict
    ]
    print(f"  -> {tag} {detail}")


def _frontend_confirmed_list(
    columns: list[dict[str, Any]], labels: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], set[str]]:
    """逐行复刻 frontend/src/components/ocr/OcrReviewTable.ts 的真实行为。

    为什么不直接用后端 labels：后端 snap 被计数硬门拒掉后 associated_column_id
    全是 None，而 ocr.applyLabels 只认 colId。真实 UI 在 :54-62 按列遍历、
    用 anchor_x∈[startX,endX) 兜底关联，并在 :159-176 从表格行 data-col-id 取 colId。
    不模拟这一步，测的就不是用户走的那条路。

    返回 (confirmed 列表, 进入表格的标签 id 集合)。
    """
    confirmed: list[dict[str, Any]] = []
    used: set[str] = set()
    for c_idx, col in enumerate(columns):
        col_id = col.get("id") or f"taxa_{c_idx}"
        matched = next(
            (
                lb
                for lb in labels
                if lb.get("associated_column_id") == col_id
                or lb.get("associated_column_index") == c_idx
            ),
            None,
        )
        if matched is None:
            start = float(col.get("start", col.get("startX", 0.0)))
            end = float(col.get("end", col.get("endX", start + 100.0)))
            matched = next(
                (
                    lb
                    for lb in labels
                    if start <= float(lb.get("anchor_x") or 0.0) < end
                ),
                None,
            )
        if matched is None:
            continue
        used.add(matched["id"])
        # UI 默认只勾选非 unrecognized 的行（OcrModal: l.accepted = status !== 'unrecognized'）
        if matched.get("status") == "unrecognized":
            continue
        name = str(
            matched.get("user_override_name") or matched.get("suggested_name") or ""
        ).strip()
        if not name:
            continue
        confirmed.append(
            {
                "associated_column_id": col_id,
                "suggested_name": name,
                "ocr_text": name,
            }
        )
    return confirmed, used


# --------------------------------------------------------------------------- #
# 独立像素真值（不调用产品内部算法）
# --------------------------------------------------------------------------- #
def ink_profile(image_rgba, dark_threshold: int = 128) -> tuple[np.ndarray, np.ndarray]:
    """从原始像素算墨迹的行/列投影。独立实现，仅用 numpy。"""
    arr = np.asarray(image_rgba.convert("L"), dtype=np.uint8)
    dark = arr < dark_threshold
    return dark.sum(axis=1), dark.sum(axis=0)


def find_data_region(
    dark_rows: np.ndarray, dark_cols: np.ndarray, w: int
) -> dict[str, Any]:
    """独立定位"真实数据区"：最长的横轴线 + 有墨迹的列范围。

    横轴线判据：某行暗像素占全宽 > 40%。刻度齿与框线都挂在横轴上，
    所以横轴所在行就是数据区的底边（这是物理结构判据，不是对参数敏感的统计量）。
    """
    row_ratio = dark_rows / max(1, w)
    axis_candidates = np.where(row_ratio > 0.40)[0]
    axis_row = int(axis_candidates[-1]) if len(axis_candidates) else None

    col_threshold = max(3, int(dark_rows.max() * 0.02))
    ink_cols = np.where(dark_cols > col_threshold)[0]
    return {
        "axis_row": axis_row,
        "axis_row_ratio": float(row_ratio[axis_row]) if axis_row is not None else 0.0,
        "ink_x_min": int(ink_cols.min()) if len(ink_cols) else None,
        "ink_x_max": int(ink_cols.max()) if len(ink_cols) else None,
    }


# --------------------------------------------------------------------------- #
# 主流程
# --------------------------------------------------------------------------- #
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", default=DEFAULT_PDF)
    ap.add_argument("--page", type=int, default=5)
    ap.add_argument("--json", default=None, help="把完整结果写成 JSON")
    ap.add_argument("--no-cleanup", action="store_true", help="跳过清理步骤")
    args = ap.parse_args()

    if not os.path.exists(args.pdf):
        print(f"[FATAL] PDF 不存在: {args.pdf}")
        return 3

    from straditize_core.session import StraditizeSession
    from straditize_core.session_parts.xscale import resolve_column_scale

    hr("产品旅程验证：论文 PDF -> 可用科研数据")
    print(f"  PDF   = {args.pdf}")
    print(f"  page  = {args.page}")
    print(f"  ROI   = {USER_ROI}")
    print(
        f"  time  = {__import__('datetime').datetime.now().isoformat(timespec='seconds')}"
    )

    s = StraditizeSession()
    s._init_cleanup()

    # ---------------- 站 1：载入 PDF 指定页 ----------------
    hr("站 1/8  载入 PDF 指定页")
    try:
        info = s.load_image(args.pdf, page_number=args.page)
        show_keys("load_image", info)
        w, h, fmt = info["width"], info["height"], info["format"]
        pdf_info = info.get("pdf_info") or {}
        print(f"  尺寸 = {w} x {h}   format = {fmt}   pdf_info = {pdf_info}")
        ok = fmt == "PDF_IMAGE" and pdf_info.get("current_page") == args.page
        record(
            "载入PDF页",
            PASS if ok else FAIL,
            f"{w}x{h} format={fmt} page={pdf_info.get('current_page')}/{pdf_info.get('total_pages')}",
            {"width": w, "height": h, "format": fmt, "pdf_info": pdf_info},
        )
        if not ok:
            print("  非 PDF_IMAGE 或页码不符 -> 后续步骤无意义，终止")
            return 1
    except Exception as exc:
        record("载入PDF页", FAIL, f"{type(exc).__name__}: {exc}")
        traceback.print_exc()
        return 1

    # ---------------- 站 2：建议 ROI vs 真实数据区 ----------------
    hr("站 2/8  建议取数区 vs 真实数据区")
    dark_rows, dark_cols = ink_profile(s.image)
    region = find_data_region(dark_rows, dark_cols, w)
    suggested = info.get("suggested_roi") or {}
    print(
        f"  独立像素真值: 横轴线行 y={region['axis_row']} "
        f"(暗像素占全宽 {region['axis_row_ratio'] * 100:.1f}%)  "
        f"墨迹列范围 x=[{region['ink_x_min']}, {region['ink_x_max']}]"
    )
    print(f"  产品建议 ROI: {suggested}")

    miss_bottom = miss_top = None
    if region["axis_row"] is not None and suggested:
        miss_bottom = region["axis_row"] - float(suggested.get("yMax", 0))
        miss_top = float(suggested.get("yMin", 0)) - float(region["ink_x_min"] or 0) * 0
        print(
            f"  建议 ROI 底部 yMax={suggested.get('yMax')} vs 真实横轴 y={region['axis_row']} "
            f"-> 底部漏掉 {miss_bottom:.0f}px"
        )
        print(
            f"  建议 ROI 顶部 yMin={suggested.get('yMin')} vs 图像顶端 -> 顶部留白 "
            f"{float(suggested.get('yMin', 0)):.0f}px"
        )
    if miss_bottom is not None and miss_bottom > 20:
        record(
            "建议ROI覆盖",
            PARTIAL,
            f"建议 ROI 底部漏掉真实数据区 {miss_bottom:.0f}px（横轴在 y={region['axis_row']}，"
            f"建议 yMax={suggested.get('yMax')}）——用户若直接采纳会丢掉底部数据，界面无提示",
            {
                "suggested": suggested,
                "axis_row": region["axis_row"],
                "miss_bottom_px": miss_bottom,
            },
        )
    else:
        record(
            "建议ROI覆盖", PASS, "建议 ROI 覆盖了真实数据区", {"suggested": suggested}
        )

    # ---------------- 站 3：用户手框 ROI + 清理 ----------------
    hr("站 3/8  用户手框 ROI + 清理分区线")
    for r in list(s.rois):
        s.roi_remove(r["id"])
    roi = s.roi_create(
        name=f"Han2026_p{args.page}",
        x0=USER_ROI["x0"],
        x1=USER_ROI["x1"],
        y0=USER_ROI["y0"],
        y1=USER_ROI["y1"],
        composition=True,
    )
    show_keys("roi_create", roi)
    rid = roi["roi"]["id"]
    s.roi_set_primary(rid)
    s.roi_set_active(rid)
    print(f"  roi_id = {rid}")

    cleanup_note = "跳过清理（--no-cleanup）"
    if not args.no_cleanup:
        cands = s.detect_line_candidates(roi_id=rid)["candidates"]
        h_ids = [c["id"] for c in cands if c.get("kind") == "A"]
        print(f"  候选线 {len(cands)} 条，横向 kind=A {len(h_ids)} 条 -> {h_ids}")
        if h_ids:
            res = s.apply_line_removal(roi_id=rid, selected_ids=h_ids)
            show_keys("apply_line_removal", res)
            stats = res.get("stats") or {}
            print(
                f"  stats = {json.dumps(stats, ensure_ascii=False, default=str)[:300]}"
            )
            cleanup_note = f"移除 {len(h_ids)} 条横向分区线"
    record(
        "ROI与清理",
        PASS,
        f"ROI {rid} 建立成功；{cleanup_note}",
        {"roi_id": rid, "cleanup": cleanup_note},
    )

    # ---------------- 站 4：分列 ----------------
    hr("站 4/8  自动分列")
    cols = s.detect_columns(roi_id=rid)
    show_keys("detect_columns", cols)
    n_cols = len(cols)
    widths = [round(c["end"] - c["start"], 1) for c in cols]
    print(f"  列数 = {n_cols}")
    print(f"  列宽 = {widths}")
    print(f"  列名 = {[c.get('name') for c in cols]}")
    print(f"  hline_rows（被当作网格线剔除）= {getattr(s, 'hline_rows', None)}")
    record(
        "自动分列",
        PASS if n_cols else FAIL,
        f"检出 {n_cols} 列，列宽 {widths}",
        {"count": n_cols, "widths": widths},
    )

    # ---------------- 站 5：OCR 属种名 ----------------
    hr("站 5/8  OCR 识别属种名（纪律：从 data.labels 读）")
    ocr_top = s.ocr_recognize_labels()
    show_keys("ocr_recognize_labels", ocr_top)
    labels: list[dict[str, Any]] = []
    reconciliation: dict[str, Any] = {}
    if isinstance(ocr_top, dict) and isinstance(ocr_top.get("data"), dict):
        d = ocr_top["data"]
        show_keys("ocr['data']", d)
        labels = d.get("labels") or []
        reconciliation = d.get("reconciliation") or {}
        print(f"  summary = {d.get('summary')}")
        print(f"  reconciliation.matched = {reconciliation.get('matched')}")
        print(
            f"  custom_dict_entries = {d.get('custom_dict_entries')}  "
            f"builtin_dict_entries = {d.get('builtin_dict_entries')}"
        )
    else:
        record("OCR识别", FAIL, "返回里没有 data 字典，OCR 未产出结构", None)
        labels = []

    if labels:
        show_keys("labels[0]", labels[0])
        print(
            f"\n  {'#':>2}  {'ocr_text':<22} {'suggested_zh':<14} {'conf':>5} "
            f"{'status':<13} {'assoc_col':<18} anchor_x"
        )
        print("  " + "-" * 96)
        for i, lb in enumerate(labels):
            print(
                f"  {i:>2}  {str(lb.get('ocr_text'))[:22]:<22} "
                f"{str(lb.get('suggested_zh'))[:14]:<14} "
                f"{float(lb.get('confidence') or 0):>5.2f} "
                f"{str(lb.get('status')):<13} "
                f"{str(lb.get('associated_column_id')):<18} "
                f"{float(lb.get('anchor_x') or 0):>8.1f}"
            )
        n_assoc = sum(1 for lb in labels if lb.get("associated_column_id") is not None)
        n_text = sum(1 for lb in labels if (lb.get("ocr_text") or "").strip())
        n_zh = sum(
            1
            for lb in labels
            if (lb.get("suggested_zh") or "").strip()
            and lb.get("suggested_zh") != lb.get("ocr_text")
        )
        print(
            f"\n  标签总数 = {len(labels)}  有文本 = {n_text}  有中文名 = {n_zh}  "
            f"已关联列 = {n_assoc}/{len(labels)}"
        )
        print(
            f"  列数 = {n_cols}  标签数 = {len(labels)}  "
            f"-> {'相等' if len(labels) == n_cols else '不等（触发计数硬门）'}"
        )

        if n_assoc == 0:
            record(
                "OCR识别",
                PARTIAL,
                f"文本识别正常（{len(labels)} 标签，{n_text} 有文本，{n_zh} 有中文名），"
                f"但 associated_column_id 全部为 None：{len(labels)} 标签 vs {n_cols} 列，"
                f"计数不等即拒绝全部关联（reconciliation.matched=False），无用户提示",
                {
                    "labels": len(labels),
                    "with_text": n_text,
                    "with_zh": n_zh,
                    "associated": n_assoc,
                    "columns": n_cols,
                    "reconciliation": reconciliation,
                },
            )

            # ---- 内置对照实验：证明"全部关联被拒"的原因是计数硬门 ----
            #
            # 不做这一步就只能说"关联是 None"，无法区分
            #   (a) 计数硬门拒绝（可修）
            #   (b) 标签位置根本不在列区间内（结构性，不可修）
            # 假对照自查：对照组必须真的改到被操纵的变量（标签数），
            # 且其余条件（列集合、anchor_x）不动。若对照组仍 matched=False，
            # 说明计数门不是原因，我的假设错。
            #
            # 计数为什么不等？根因在 session_parts/ocr.py:40 的默认 bbox：
            #     y0 = max(0, int(data_ylim[0] - 320))
            # 本例 data_ylim[0]=233 -> 233-320=-87 -> max(0,-87)=0，
            # 标签带从图像最顶端开始，把标签区上方的图例文字 Herbs 也扫进来。
            # 完整的 y0 扫描、以及「bbox 超列宽」假说的证伪（压点到跨度 0 仍失败），
            # 见 scripts/product_journey/probe_ocr_pairing.py 的第 ③④ 组。
            print()
            print("  内置对照实验（证明原因，避免把'探针读错'误判成'产品坏'）：")
            outside = [
                lb
                for lb in labels
                if not any(
                    c["start"] <= float(lb.get("anchor_x") or 0) < c["end"]
                    for c in cols
                )
            ]
            print(
                f"    anchor_x 落在所有列区间之外的标签数 = {len(outside)}"
                f"（为 0 则说明每个标签都有合法归属列）"
            )

            if len(labels) > n_cols and not outside:
                # 找一个与别的标签落在同一列的重复锚点，删掉它使计数相等
                seen: dict[str, str] = {}
                dup = None
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
                    from straditize_core.ocr.engine import snap_labels_to_columns

                    subset = [lb for lb in labels if lb["id"] != dup["id"]]
                    rec_ctl = snap_labels_to_columns(
                        copy.deepcopy(subset), copy.deepcopy(cols)
                    )
                    n_ctl = len(rec_ctl["assigned"])
                    print(
                        f"    被操纵的变量：标签数 {len(labels)} -> {len(subset)}"
                        f"（删掉重复锚点 {dup['id']} {dup['ocr_text']!r}）"
                    )
                    print(
                        f"    对照组结果：matched={rec_ctl['matched']}  "
                        f"assigned={n_ctl}/{n_cols}"
                    )
                    if rec_ctl["matched"] and n_ctl == n_cols:
                        print(
                            "    => 计数硬门是唯一阻断原因：位置归属全部正确，"
                            "仅因 17≠16 就整体放弃关联。"
                        )
                        _results.append(
                            {
                                "station": "OCR计数门对照实验",
                                "verdict": PASS,
                                "detail": (
                                    f"对照实验成立：标签数改为 {len(subset)} 后 "
                                    f"{n_ctl}/{n_cols} 列全部关联成功，"
                                    f"证明阻断原因仅为 len(labels)!=len(columns) 硬门"
                                ),
                                "data": {
                                    "dup_removed": dup["ocr_text"],
                                    "control_assigned": n_ctl,
                                    "columns": n_cols,
                                },
                            }
                        )
                    else:
                        print("    => 对照实验未成立：计数门不是唯一原因，需继续查。")
                        _results.append(
                            {
                                "station": "OCR计数门对照实验",
                                "verdict": UNCERTAIN,
                                "detail": "对照组仍未能全部关联，计数硬门不是唯一原因",
                                "data": {
                                    "control_matched": rec_ctl["matched"],
                                    "control_assigned": n_ctl,
                                },
                            }
                        )
            elif outside:
                print(
                    f"    有 {len(outside)} 个标签位置落在列外 -> 除计数门外还有位置问题"
                )
            else:
                print(f"    标签数 {len(labels)} <= 列数 {n_cols}，计数门不适用")
        elif n_assoc < n_cols:
            record(
                "OCR识别",
                PARTIAL,
                f"文本识别正常，但只有 {n_assoc}/{n_cols} 列拿到关联",
                {"associated": n_assoc, "columns": n_cols},
            )
        else:
            record(
                "OCR识别",
                PASS,
                f"{len(labels)} 标签全部关联到列，中文名 {n_zh} 个",
                {"labels": len(labels), "associated": n_assoc},
            )

        # 下游：应用标签能否真的改到列名
        #
        # 判据陷阱（我第一版在这里判错）：直接把后端原始 labels 喂给
        # ocr_apply_labels 会得到 applied_count=0，因为后端拒绝关联后
        # associated_column_id 全是 None，而 apply 只认 colId。
        # 但真实用户不这样走：frontend/src/components/ocr/OcrReviewTable.ts:54-62
        # 按列遍历、用 anchor_x∈[startX,endX) 做前端兜底关联，
        # :159-176 又从表格行的 data-col-id 取 colId。
        # 所以必须模拟 UI 路径，否则测的不是用户走的那条路。
        confirmed, used = _frontend_confirmed_list(s.columns, labels)
        applied = s.ocr_apply_labels(confirmed_labels=confirmed)
        show_keys("ocr_apply_labels", applied)
        names_after = [c.get("name") for c in s.columns]
        n_named = sum(1 for n in names_after if n and not str(n).startswith("col"))
        print(
            f"  UI 路径：表格行 {n_cols} 列，被采纳 {len(confirmed)} 项"
            f"（未进表格的标签：{[lb['ocr_text'] for lb in labels if lb['id'] not in used]}）"
        )
        print(
            f"  applied_count = {applied.get('applied_count')} / columns = {applied.get('columns_count')}"
        )
        print(f"  应用后列名 = {names_after[:18]}")
        print(f"  真正改名的列 = {n_named}/{n_cols}")
        record(
            "OCR应用到列名",
            PASS if n_named == n_cols else (PARTIAL if n_named > 0 else FAIL),
            f"模拟真实 UI 路径后 {n_named}/{n_cols} 列拿到属种名；"
            f"未改名的是状态为 unrecognized 的标签（UI 默认不勾选采纳）",
            {
                "applied_count": applied.get("applied_count"),
                "named_columns": n_named,
                "total_columns": n_cols,
                "names": names_after,
                "labels_not_in_table": [
                    lb["ocr_text"] for lb in labels if lb["id"] not in used
                ],
            },
        )

    # ---------------- 站 6：自动刻度齿 ----------------
    hr("站 6/8  自动提取刻度齿")
    xt = s.detect_xticks_rpc(roi_id=rid)
    show_keys("detect_xticks_rpc", xt)
    band = xt.get("band")
    per = xt.get("per_column") or []
    n_ticks = sum(len(p.get("ticks") or []) for p in per)
    n_usable = sum(1 for p in per if p.get("usable"))
    print(f"  band = {band}   spacing = {xt.get('spacing')}")
    print(
        f"  per_column = {len(per)} 条，齿总数 = {n_ticks}，usable 列 = {n_usable}/{len(per)}"
    )
    if per:
        show_keys("per_column[0]", per[0])
        print(
            f"  per_column[0] = {json.dumps(per[0], ensure_ascii=False, default=str)}"
        )
    truth_band = (
        (region["axis_row"], region["axis_row"] + 7) if region["axis_row"] else None
    )
    print(f"  独立真值 band ≈ {truth_band}（横轴线行 .. +7px）")
    band_ok = (
        bool(band)
        and region["axis_row"] is not None
        and abs(band[0] - region["axis_row"]) <= 3
    )
    record(
        "自动刻度齿",
        PASS if band_ok and n_ticks >= 20 else (PARTIAL if n_ticks else FAIL),
        f"band={band}（真值≈{truth_band}），检出齿 {n_ticks} 个；"
        f"usable 列 {n_usable}/{len(per)}（usable 要求每列 ≥2 齿，产品列宽仅 {widths[:3]}px，结构性不可达）",
        {"band": band, "ticks": n_ticks, "usable": n_usable, "per_column": len(per)},
    )

    # ---------------- 站 7：标定状态 + 就绪清单 ----------------
    hr("站 7/8  标定状态与导出就绪清单")
    ready0 = s.get_export_readiness()
    show_keys("get_export_readiness", ready0)
    print(
        f"  ready = {ready0.get('ready')}   calibrated = {ready0.get('calibrated_count')}"
        f"/{ready0.get('column_count')}"
    )
    print(
        f"  provenance = {json.dumps(ready0.get('provenance'), ensure_ascii=False, default=str)}"
    )
    print(f"  readiness_missing = {ready0.get('readiness_missing')}")
    uncal = ready0.get("uncalibrated_columns") or []
    print(
        f"  uncalibrated_columns = {len(uncal)} 条，前 3 = "
        f"{json.dumps(uncal[:3], ensure_ascii=False, default=str)}"
    )
    record(
        "零标定就绪门",
        PASS if ready0.get("ready") is False else FAIL,
        f"零输入时 ready={ready0.get('ready')}，未标定列 {len(uncal)}/{ready0.get('column_count')}"
        f"（应为 False，否则用户最后一道门形同虚设）",
        {"ready": ready0.get("ready"), "uncalibrated": len(uncal)},
    )

    # 每列实际用的标度参数（解释"未标定为什么还能出数"）
    print(
        "\n  每列 resolve_column_scale（未标定时走 legacy 默认值，这是数值的真实来历）："
    )
    sources: dict[str, int] = {}
    for i, c in enumerate(cols):
        sc = resolve_column_scale(s, c, i)
        sources[sc.source] = sources.get(sc.source, 0) + 1
        if i < 3 or i == n_cols - 1:
            print(
                f"    col{i + 1:02d} {c['id']:<16} px[{sc.abs_px0:.0f},{sc.abs_px1:.0f}]"
                f" -> val[{sc.val0:.0f},{sc.val1:.0f}]  source={sc.source} calibrated={sc.calibrated}"
            )
    print(f"  标度来源分布 = {sources}")

    # ---------------- 站 8：导出 ----------------
    hr("站 8/8  导出（csv / xlsx / tar）")
    out_dir = os.path.join(ROOT, "output", "product_journey")
    os.makedirs(out_dir, exist_ok=True)

    # csv
    try:
        csv_res = s.export_data(format="csv")
        show_keys("export_data(csv)", csv_res)
        rows = csv_res.get("rows_count")
        ccount = csv_res.get("columns_count")
        print(f"  rows_count = {rows}   columns_count = {ccount}")
        csv_text = csv_res.get("csv_content") or csv_res.get("csv") or ""
        head = (csv_text.splitlines() or [""])[0][:220]
        print(f"  表头 = {head}")
        ser = True
        try:
            json.dumps(csv_res)
        except TypeError as exc:
            ser = False
            print(f"  json.dumps -> TypeError: {exc}")
        record(
            "导出CSV",
            PASS if ser and (rows or 0) > 0 else FAIL,
            f"{rows} 行 x {ccount} 列，JSON 可序列化={ser}",
            {"rows": rows, "columns": ccount, "json_ok": ser},
        )
    except Exception as exc:
        record("导出CSV", FAIL, f"{type(exc).__name__}: {exc}")
        traceback.print_exc()

    # xlsx
    try:
        xl = s.export_multi_xlsx()
        show_keys("export_multi_xlsx", xl)
        b64 = xl.get("base64") or xl.get("data")
        ser = True
        try:
            json.dumps(xl)
        except TypeError as exc:
            ser = False
            print(f"  json.dumps -> TypeError: {exc}")
        opened = False
        n_sheets = 0
        if isinstance(b64, str) and b64:
            import base64 as _b64

            try:
                import openpyxl

                wb = openpyxl.load_workbook(io.BytesIO(_b64.b64decode(b64)))
                opened = True
                n_sheets = len(wb.sheetnames)
                print(f"  openpyxl 打开成功，表 = {wb.sheetnames}")
            except Exception as exc:
                print(f"  openpyxl 打开失败: {type(exc).__name__}: {exc}")
        print(
            f"  size_bytes = {xl.get('size_bytes')}  json_ok = {ser}  openable = {opened}"
        )
        record(
            "导出XLSX",
            PASS if ser and opened else FAIL,
            f"JSON 可序列化={ser}，可被 openpyxl 打开={opened}（{n_sheets} 张表），"
            f"size={xl.get('size_bytes')}B",
            {"json_ok": ser, "openable": opened, "sheets": n_sheets},
        )
    except Exception as exc:
        record("导出XLSX", FAIL, f"{type(exc).__name__}: {exc}")
        traceback.print_exc()

    # tar
    try:
        tp = s.export_multi_tar()
        show_keys("export_multi_tar", tp)
        ser = True
        try:
            json.dumps(tp)
        except TypeError as exc:
            ser = False
            print(f"  json.dumps -> TypeError: {exc}")
        print(f"  size = {tp.get('size')}  json_ok = {ser}")
        record(
            "导出TAR",
            PASS if ser else FAIL,
            f"size={tp.get('size')}B，JSON 可序列化={ser}",
            {"size": tp.get("size"), "json_ok": ser},
        )
    except Exception as exc:
        record("导出TAR", FAIL, f"{type(exc).__name__}: {exc}")

    # ---------------- 数据质量：产品 vs 独立像素真值（同口径） ----------------
    hr("数据质量  产品提取 vs 独立像素真值")
    print("  这一节我给两个判定，一个 PASS 一个 UNCERTAIN，理由如下。")
    print()
    print("  【为什么要拆成两个】我在这一节连犯三次同型错误，全部是'判据不指向对象'：")
    print("    错1：灰度阈值 128 当真值 -> 彩色曲线（gray≈182）根本没被看见，")
    print("         只看到黑色分隔线，于是 col15 报出 102 行 10px 偏差。是假偏差。")
    print("    错2：用 max(产品列) 比 max(真值列) -> col10 产品 max 在 y=336、")
    print("         真值 max 在 y=233，两个 max 不同行，相减得 -12.75 点；")
    print("         但逐行 Δ 中位是 0.000 点。是判据错，不是产品错。")
    print("    错3：把框线/横轴行当数据行 -> 真值取到横贯全宽的框线，多读 50~200px。")
    print()
    print("  【教训结论】逐行位置偏差这个量对墨迹阈值敏感（实测中位 0~4px、")
    print("    p95 1~49px 随阈值跳动），按项目铁律不得作门禁。所以下面只用它做")
    print("    描述性证据（UNCERTAIN），门禁用与阈值无关的结构判据（PASS）。")
    print()

    try:
        box = s._roi_box(roi_id=rid)
        y0, y1 = int(round(box[1])), int(round(box[3]))
        rgb = np.asarray(s.image.convert("RGB"), dtype=np.int16)
        gray = np.asarray(s.image.convert("L"), dtype=np.uint8)
        dist = 255 - rgb.min(axis=2)

        prod = {
            i: {
                int(p["row"]): float(p["x"])
                for p in (s.digitize(i).get("points") or [])
            }
            for i in range(n_cols)
        }

        # ---- 判据 A（门禁）：提取点必须落在本列内 ----
        in_range = total_pts = 0
        for i, col in enumerate(cols):
            cs, ce = round(col["start"]), round(col["end"])
            for x in prod[i].values():
                total_pts += 1
                if cs - 0.5 <= x <= ce + 0.5:
                    in_range += 1
        pct = 100.0 * in_range / max(1, total_pts)
        print(
            "  判据 A（与阈值无关，可作门禁）：产品提取点落在本列 [start,end] 内的比例"
        )
        print(f"    = {in_range}/{total_pts} ({pct:.2f}%)   判据要求 100%")
        record(
            "数据质量/结构",
            PASS if pct >= 99.99 else FAIL,
            f"提取点全部落在本列内 {in_range}/{total_pts}（{pct:.2f}%）——不越界读到邻列",
            {"in_range": in_range, "total": total_pts, "pct": pct},
        )

        # ---- 判据 B（描述性）：逐行位置偏差，多阈值各算一遍 ----
        def longest_run(row: np.ndarray) -> int:
            best = cur = 0
            for v in row:
                cur = cur + 1 if v else 0
                best = max(best, cur)
            return best

        def runs_of(row: np.ndarray) -> list[tuple[int, int]]:
            out: list[tuple[int, int]] = []
            inr, st = False, 0
            for i, v in enumerate(row):
                if v and not inr:
                    inr, st = True, i
                elif not v and inr:
                    inr = False
                    out.append((st, i - 1))
            if inr:
                out.append((st, len(row) - 1))
            return out

        print()
        print("  判据 B（描述性，对阈值敏感 -> 不作门禁）：逐行位置偏差 |Δx|")
        print(
            f"    {'墨迹判据':<16} {'比对行':>7} {'中位px':>8} {'p95px':>8} {'>3px行':>8}"
        )
        print("    " + "-" * 52)
        rows_seen: list[tuple[str, int, float, float, int]] = []
        for label, ink in (
            ("灰度<128", gray < 128),
            ("颜色偏离>40", dist > 40),
            ("颜色偏离>60", dist > 60),
            ("颜色偏离>80", dist > 80),
        ):
            all_dx: list[float] = []
            for i, col in enumerate(cols):
                cs, ce = round(col["start"]), round(col["end"])
                w = ce - cs
                px = prod[i]
                for row_y in range(y0, y1 + 1):
                    if row_y >= s.height or row_y not in px:
                        continue
                    seg = ink[row_y, cs:ce]
                    if not seg.any():
                        continue
                    if longest_run(seg) > 0.70 * w:
                        continue  # 结构性横线（框线/横轴/网格线）
                    rr = [r for r in runs_of(seg) if r[0] > 0 and r[1] < w - 1]
                    if not rr:
                        continue  # 只剩贴边界游程 = 竖向列分隔线
                    all_dx.append(abs(px[row_y] - float(cs + rr[-1][1])))
            if all_dx:
                a = np.array(all_dx)
                nb = int((a > 3).sum())
                rows_seen.append(
                    (
                        label,
                        len(a),
                        float(np.median(a)),
                        float(np.percentile(a, 95)),
                        nb,
                    )
                )
                print(
                    f"    {label:<16} {len(a):>7} {np.median(a):>8.2f} "
                    f"{np.percentile(a, 95):>8.2f} {nb:>8}"
                )

        meds = [r[2] for r in rows_seen]
        p95s = [r[3] for r in rows_seen]
        stable = bool(meds) and max(meds) <= 1.5 and max(p95s) <= 3.0
        print()
        print(f"    中位偏差跨口径 = {[round(m, 2) for m in meds]}")
        print(f"    p95 偏差跨口径 = {[round(p, 2) for p in p95s]}")
        print(f"    稳定性: {'稳定' if stable else '不稳定（随阈值跳动）'}")
        record(
            "数据质量/精度",
            PASS if stable else UNCERTAIN,
            (
                f"逐行位置偏差在 4 套墨迹判据下中位 {min(meds):.2f}~{max(meds):.2f}px、"
                f"p95 {min(p95s):.2f}~{max(p95s):.2f}px -> 口径稳定，可作为提取准确的证据"
            )
            if stable
            else (
                f"逐行位置偏差随墨迹阈值显著跳动（中位 {min(meds):.2f}~{max(meds):.2f}px，"
                f"p95 {min(p95s):.2f}~{max(p95s):.2f}px）-> 该量不可作门禁，"
                f"数值精度只能记 UNCERTAIN，需人工抽检"
            ),
            {"medians": meds, "p95s": p95s, "stable": stable},
        )
    except Exception as exc:
        record("数据质量", UNCERTAIN, f"{type(exc).__name__}: {exc}")
        traceback.print_exc()
    except Exception as exc:
        record("数据质量", UNCERTAIN, f"{type(exc).__name__}: {exc}")
        traceback.print_exc()

    # ---------------- 汇总 ----------------
    hr("汇总")
    counts = {PASS: 0, FAIL: 0, PARTIAL: 0, UNCERTAIN: 0}
    for r in _results:
        counts[r["verdict"]] += 1
    for r in _results:
        print(f"  {r['verdict']:<6} {r['station']:<16} {r['detail']}")
    print()
    print(
        f"  PASS={counts[PASS]}  PARTIAL={counts[PARTIAL]}  "
        f"FAIL={counts[FAIL]}  UNCERTAIN={counts[UNCERTAIN]}"
    )

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(_results, fh, ensure_ascii=False, indent=2, default=str)
        print(f"  明细 -> {args.json}")

    if counts[FAIL]:
        code = 1
        print("\n  => 退出码 1：存在阻断项，用户走不到可用数据")
    elif counts[PARTIAL] or counts[UNCERTAIN]:
        code = 2
        print(
            "\n  => 退出码 2：链路跑通但存在需人工判断的缺陷（见上表 PARTIAL/UNCERTAIN）"
        )
    else:
        code = 0
        print("\n  => 退出码 0：全链路通")
    return code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        raise SystemExit(3)
