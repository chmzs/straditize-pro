# -*- coding: utf-8 -*-
"""横线的**贯穿率**判据把真区带线挡在门外（issue #101）。

## 现场（`Han2026_Fig3_pollen`，图 2132×928，ROI 1798×478）

用户目测有 1–2px 的区带横线，`algorithm.detectLineCandidates`（前端唯一入口，
只传 `roi_id` / `include_horizontal` / `include_vertical`，不传任何阈值）返回
**0 条 Kind A**、6 条 Kind B。ROI 内逐行墨迹投影，覆盖率 > 0.4 的行全图只有 4 行：

| y    | cov   | 厚度 | 判读 |
|-----:|------:|-----:|:-----|
| 266  | 0.709 | 1px  | 压在 ROI 上边界 → `edge_margin` 挡掉（正确） |
| 359  | 0.691 | 1px  | 真区带线（IV/III 界）→ **漏检** |
| 594  | 0.714 | 1px  | 真区带线（III/II 界）→ **漏检** |
| 743  | 0.702 | 1px  | 压在 ROI 下边界 → `edge_margin` 挡掉（正确） |

厚度不是原因：自适应上限 `resolve_width_max((478,1798), None, axis="h")` = **5**，
两条线都只有 1px。原因是覆盖率 0.691 / 0.714 输给了默认 `line_fraction_h=0.75`。

线本身是贯通的：灰度剖面上 dip>10 的列跨度为 ROI 宽的 0.928 / 0.988。缺的墨迹来自
分层——该图 Otsu=138，线的灰度 156–202 跨在 two-axis 的 solid/pale 边界上，浅的
几段被判进 `shadow` 层、不进 `foreground_mask`。所以检测器看到的是"带 22% 洞的
1px 线"，而这正是本判据必须容忍的形态。

## 改动

`DEFAULT_LINE_FRACTION_H` 0.75 → **0.65**（`straditize_core/lines.py`），
`CleanupMixin.detect_line_candidates` 的缺省值改为引用同一常量（此前两个字面量各写一份，
前端走的正是 session 那一个，改检测器里那个等于没改）。

四张实测图在 0.65 / 0.75 下的横线候选数：本图 0→2、`.recon_20261117` 4→4（位置与
厚度不变）、hoya 3→3、beginner-tutorial 0→0；降到 0.45 上述三张仍不变。

## 判据

1. 1px 线、墨迹只有 0.69 幅宽（洞由浅色段造成）⇒ 检出；同一张图把 `line_fraction_h`
   退回 0.75 ⇒ **检不出**（证明差异确实来自这个比例，而不是别处）；
2. 覆盖率 0.55 的稀疏行 ⇒ 仍不检出（比例还有牙）；
3. 覆盖率 0.69 的 12px 厚带 ⇒ 不检出（厚度闸门未受影响）；
4. 满幅 1px 线 ⇒ 检出（零回归）；
5. RPC 层与检测器层的缺省值必须是同一个对象（传递链只有一处定义）。
"""

from __future__ import annotations

import inspect

import numpy as np

from straditize_core.lines import (
    DEFAULT_LINE_FRACTION_H,
    detect_line_candidates,
    resolve_width_max,
)
from straditize_core.session import StraditizeSession

#: 与现场 ROI 同形的画布（1798×478），保证自适应上限落在 5 这一档。
W, H = 1798, 478
#: 现场两条真线的位置（ROI 相对行号）：359-266=93、594-266=328。
FIELD_ROWS = (93, 328)
#: 现场实测最差一条的墨迹覆盖率。
FIELD_COVERAGE = 0.6908


def _roi() -> dict:
    return {
        "id": "roi_1",
        "name": "pollen",
        "xlim": [0.0, float(W - 1)],
        "ylim": [0.0, float(H - 1)],
        "x_groups": [],
        "composition": True,
        "visible": True,
        "columns_stale": False,
        "name_source": "auto",
        "form_defaults": {},
    }


def _hole_slice(coverage: float, gaps: int = 5) -> list[slice]:
    """把 ``1 - coverage`` 的宽度均分成 ``gaps`` 段空洞，位置确定（不用随机数）。

    现场的空洞不是均匀的（111/10/131/94/136/57/8 px），但判据只认总覆盖率，
    所以这里只要总宽度对得上即可。
    """
    holes_total = int(round((1.0 - coverage) * W))
    width = holes_total // gaps
    step = W // (gaps + 1)
    out = []
    for k in range(gaps):
        start = step * (k + 1) - width // 2
        out.append(slice(start, start + width))
    return out


def _canvas(rows, coverage: float, thickness: int = 1) -> np.ndarray:
    ink = np.zeros((H, W), dtype=bool)
    holes = _hole_slice(coverage)
    for row in rows:
        band = slice(row, row + thickness)
        ink[band, :] = True
        for hole in holes:
            ink[band, hole] = False
    return ink


def _rows(candidates) -> list[int]:
    return sorted(
        {int(round(float(c.get("at", c.get("y", 0))))) for c in candidates if c.get("kind") == "A"}
    )


def test_field_coverage_is_below_the_old_gate() -> None:
    """先钉住现场算术：0.6908 一定过不了 0.75，一定过得默认值。"""
    assert FIELD_COVERAGE < 0.75, "现场覆盖率若已 ≥0.75，本 issue 的诊断就是错的"
    assert FIELD_COVERAGE > DEFAULT_LINE_FRACTION_H, (
        f"默认 {DEFAULT_LINE_FRACTION_H} 吃不下现场最差的一条（{FIELD_COVERAGE}）"
    )
    assert resolve_width_max((H, W), None, axis="h") == 5, "厚度上限不该是这里的瓶颈"


def test_holey_thin_line_is_detected_and_old_gate_is_proven_red() -> None:
    ink = _canvas(FIELD_ROWS, FIELD_COVERAGE)
    detected = _rows(detect_line_candidates(ink, _roi()))
    assert detected == list(FIELD_ROWS), f"1px 区带线（墨迹覆盖 0.69）应检出，实得 {detected}"

    # 反向：把判据退回旧值，同样两条线必须消失 —— 否则本判据没在测这个比例
    strict = _rows(detect_line_candidates(ink, _roi(), line_fraction_h=0.75))
    assert strict == [], f"line_fraction_h=0.75 下不该检出（实得 {strict}）——判据失去判别力"


def test_sparse_row_is_still_rejected() -> None:
    ink = _canvas((200,), 0.55)
    assert _rows(detect_line_candidates(ink, _roi())) == [], "覆盖率 0.55 的行不该算横线"


def test_holey_thick_band_is_still_rejected() -> None:
    ink = _canvas((200,), FIELD_COVERAGE, thickness=12)
    assert _rows(detect_line_candidates(ink, _roi())) == [], "12px 厚带不该因覆盖率放行"


def test_full_width_line_still_detected() -> None:
    ink = _canvas((200, 300), 1.0)
    assert _rows(detect_line_candidates(ink, _roi())) == [200, 300]


def test_session_and_detector_share_one_default() -> None:
    """传递链只许有一处定义：前端走的是 session 的缺省值。"""
    default = inspect.signature(StraditizeSession.detect_line_candidates).parameters[
        "line_fraction_h"
    ].default
    assert default is DEFAULT_LINE_FRACTION_H
