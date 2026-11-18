# -*- coding: utf-8 -*-
"""查看 qa.summarize 的四类诊断旗标（#91/#92 的验收工具）。

为什么需要它：旗标目前**没有前端渲染**（`QaPanel` 不读 `flags`），界面上看不到。
在 UI 补上之前，这是唯一能看见数字的路径。

## 用法

    pixi run python support/inspect_qa_flags.py <工程.tar|工程.json>
    pixi run python support/inspect_qa_flags.py <工程> --axis-px 5
    pixi run python support/inspect_qa_flags.py <工程> --roi roi_1 --axis-px 5 --rows 12

## 为什么要 `--axis-px`

`FLAG_AXIS_BLIND` 只在**显式写入**的轴粗上生效：`xscale.resolve_axis_stroke` 在列与组都
没写时会兜底 5.0，那是防止 0 点算偏的显示值，**不是实测值**。拿它去判"这一行是否落在
轴线覆盖范围内"等于用一个没人量过的数下结论，所以旗标层直接整列 `skipped(axis_width_unset)`。

实测后果：**未手填轴粗的工程上，这个旗标全部跳过、count 恒为 0**。要验它必须先给一个轴粗。

## 参数注入方式

`--axis-px` 把值写进每列的 `axis_stroke_px`（与界面里"列级轴粗"同一字段，
spec §4.10b-2）。不给就原样跑，用于观察真实默认状态。
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from straditize_core.session import StraditizeSession


def _load(path: str, image_path: str | None) -> StraditizeSession:
    """载入顺序：先图后工程。

    `project_load` 恢复的是向量模型（列定义/标定/层位），它挂在当前画布上；若先
    `project_load` 再 `load_image`，后者会重置会话，列会归零。`.tar` 工程自带图，
    由 `project_load` 一次搞定，不需要 `--image`。
    """
    session = StraditizeSession()
    if image_path:
        session.load_image(image_path)
    session.project_load(path)
    return session


def _ensure_points(session: StraditizeSession) -> None:
    """工程包不恢复 `column_points`（`project.py:395` 只恢复向量模型），必须重算。"""
    if session.column_points:
        return
    done = 0
    for index in range(len(session.columns)):
        try:
            session.digitize(index, "area")
            done += 1
        except Exception as exc:  # 单列失败不掩盖其它列
            print(f"  列{index} 数字化失败：{type(exc).__name__}: {exc}", file=sys.stderr)
    print(f"重新数字化 {done}/{len(session.columns)} 列 / "
          f"{sum(len(v) for v in session.column_points.values())} 点")


def _apply_axis_px(session: StraditizeSession, axis_px: float) -> None:
    for column in session.columns:
        column["axis_stroke_px"] = float(axis_px)


def _print_block(name: str, block: dict[str, Any], max_rows: int) -> None:
    print(f"\n=== {name} ===")
    print(f"  count={block.get('count')}  evaluated_columns={block.get('columns_evaluated')}"
          f"  reason={block.get('reason') or '-'}")
    if block.get("criterion"):
        print(f"  criterion: {block['criterion']}")
    if block.get("missing"):
        print(f"  缺字段: {block['missing']}")
    skipped = block.get("skipped_columns") or []
    if skipped:
        reasons: dict[str, int] = {}
        for item in skipped:
            reasons[item["reason"]] = reasons.get(item["reason"], 0) + 1
        print(f"  skipped {len(skipped)} 列：" +
              ", ".join(f"{reason}×{count}" for reason, count in sorted(reasons.items())))
    rows = block.get("rows") or []
    if rows:
        for row in rows[:max_rows]:
            print(f"    {json.dumps(row, ensure_ascii=False)}")
        if len(rows) > max_rows:
            print(f"    … 共 {len(rows)} 行（--rows 调整）")
    by_column = block.get("by_column") or {}
    if by_column:
        print(f"  按列: {json.dumps(by_column, ensure_ascii=False)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="查看 qa.summarize 诊断旗标")
    parser.add_argument("project", help="工程 .tar 或 .json 路径")
    parser.add_argument("--image", default=None,
                        help="工程 .json 不含图时单独给图路径（.tar 工程会自动带图）")
    parser.add_argument("--roi", default=None, help="ROI id（默认第一个）")
    parser.add_argument("--axis-px", type=float, default=None,
                        help="把该值写进每列 axis_stroke_px；不给则观察真实默认状态")
    parser.add_argument("--rows", type=int, default=6, help="每个旗标最多打印几行命中的明细")
    args = parser.parse_args()

    session = _load(args.project, args.image)
    print(f"载入：{args.project}")
    print(f"  列 {len(session.columns)}｜image={session.image is not None}｜"
          f"samples={len(session.samples)}｜rois={[r.get('id') for r in (session.rois or [])]}｜"
          f"primary_axis={getattr(session, 'primary_axis', None)}")

    _ensure_points(session)
    if args.axis_px is not None:
        _apply_axis_px(session, args.axis_px)
        print(f"已注入 axis_stroke_px={args.axis_px}（等价于界面里逐列手填轴粗）")

    summary = session.qa_summarize(roi_id=args.roi)
    print(f"\nROI={summary.get('roi_id')}｜n_horizons={summary.get('n_horizons')}"
          f"｜composition={summary.get('composition')}")

    flags = summary.get("flags") or {}
    if not flags:
        print("没有 flags 字段 —— QaSummary 未携带诊断旗标（检查 qa.py 接线）", file=sys.stderr)
        return 1
    for name, block in flags.items():
        _print_block(name, block, args.rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
