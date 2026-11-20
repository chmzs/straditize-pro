# -*- coding: utf-8 -*-
"""自适应线宽下限决定「步骤 4 能不能看见区带线」，而 3px 会漏掉 4px 的真线。

## 现场（`.recon_20261117`，3591×2003 的孢粉图谱）

ROI 2097×1521 → `resolve_width_max(None)` = `max(3, round(2097*0.0015))` = **3**。
同一张图、同一份工程，只改 `line_width_max`：

| max_width | 横向候选 | 命中 y |
|--:|--:|:--|
| 3（原自适应） | **1** | 671 |
| 4 | **4** | 671 / 1039 / 1297 / 1667 |
| 5 | 4 | 同上 |
| 6 | 4 | 同上 |
| 8 | 4（+2 条竖线误收） | 同上 |

目视该图恰有 **4 条**贯穿区带线，实测线厚 4px。所以下限 3 让用户"只看到一条横线"，
这不是检测算法的问题，是上限比真线薄了 1px。

## 改动

`_AUTO_WIDTH_FLOOR` 3 → **5**：比实测需要的 4 留 1px 余量（同一批扫描件上抗锯齿会让
同一条线在 4/5px 之间浮动），又远离 8 那个"开始把纵向纹理误收"的起点。

放宽厚度上限不会引入文字误检：候选还要求该行被墨迹覆盖 `line_fraction_h`（默认 0.75）
以上，短笔画不满足——8px 那档误收的是贯穿整幅的纵向纹理，不是文字。

## 判据

1. `resolve_width_max` 对现场 ROI 形状返回 **≥4 且 <8**（下界来自"真线 4px 必须能过"，
   上界来自"8px 开始误收竖线"）；
2. 合成图（1521×2097，四条 4px 全幅横带）：自适应调用必须检出 **4 条**；
   显式 `line_width_max=3` 必须检出 **≤1 条** —— 证明差异确实来自这个下限，而不是别处；
3. 零回归：合成图（小尺寸，自适应仍是 5）里 12px 的全幅厚带**不得**被当成线。
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from straditize_core.lines import resolve_width_max
from straditize_core.session import StraditizeSession

H, W = 1521, 2097
BAND_ROWS = (300, 700, 1100, 1400)
BAND_THICKNESS = 4


def _roi(x0: int, y0: int, x1: int, y1: int) -> dict:
    """与工程包里 `rois[0]` 同形的 ROI 字典（只带检测需要的键）。"""
    return {
        "id": "roi_1",
        "name": "pollen",
        "xlim": [float(x0), float(x1)],
        "ylim": [float(y0), float(y1)],
        "x_groups": [],
        "composition": True,
        "visible": True,
        "columns_stale": False,
        "name_source": "auto",
        "form_defaults": {},
    }


def _session_with_bands(tmp_path, rows, thickness):
    img = np.full((H, W), 255, dtype=np.uint8)
    for row in rows:
        img[row : row + thickness, :] = 0
    path = tmp_path / "bands.png"
    Image.fromarray(img).save(path)

    session = StraditizeSession()
    session._init_cleanup()
    session.load_image(image_path=str(path))
    session.columns = None
    session.rois = [_roi(0, 0, W - 1, H - 1)]
    session.roi = "roi_1"
    session.data_ylim = [0.0, float(H - 1)]
    return session


def _horizontal_rows(candidates):
    return sorted(
        {
            int(round(float(c.get("at", c.get("y", 0)))))
            for c in candidates
            if c.get("kind") == "A"
        }
    )


def test_auto_width_bracket_from_measured_line_thickness() -> None:
    auto_h = resolve_width_max((1521, 2097), None, axis="h")
    assert auto_h >= 4, f"现场真线 4px，横线自适应给 {auto_h} = 只检到 1 条（实测）"
    assert auto_h < 8, f"实测 8px 起把纵向纹理误收为候选，横线自适应不该到 {auto_h}"

    # 竖线口径保持 3：hoya 实测把它放到 4/5 会多出 5 条粗竖纹误收，横线 3 条不变
    assert resolve_width_max((808, 1712), None, axis="v") == 3

    # 大扫描件仍由比例主导，不被下限吃掉
    assert resolve_width_max((3477, 4855), None, axis="h") > 5
    # 显式值优先于方向
    assert resolve_width_max((1521, 2097), 2, axis="h") == 2
    assert resolve_width_max((1521, 2097), 2, axis="v") == 2


def test_four_px_bands_detected_with_auto_width(tmp_path) -> None:
    session = _session_with_bands(tmp_path, BAND_ROWS, BAND_THICKNESS)

    auto = session.detect_line_candidates(roi_id="roi_1")["candidates"]
    rows = _horizontal_rows(auto)
    assert len(rows) == len(BAND_ROWS), (
        f"四条 4px 全幅横带应全部检出，实得 {rows}（自适应 max_width="
        f"{resolve_width_max((H, W), None)}）"
    )

    # 反向：把上限压回 3（旧自适应值）⇒ 只能检到 ≤1 条 —— 差异确实来自这个下限
    strict = session.detect_line_candidates(roi_id="roi_1", line_width_max=3)[
        "candidates"
    ]
    assert len(_horizontal_rows(strict)) <= 1, (
        f"max_width=3 时不应检出四条（实得 {_horizontal_rows(strict)}）——"
        "若这里也全检出，说明本判据没在测厚度上限"
    )


def test_thick_band_is_not_a_line(tmp_path) -> None:
    """12px 全幅厚带不是区带线：自适应上限（5）必须把它挡住。"""
    session = _session_with_bands(tmp_path, (700,), 12)
    rows = _horizontal_rows(
        session.detect_line_candidates(roi_id="roi_1")["candidates"]
    )
    assert rows == [], f"12px 厚带被当成线：{rows}"
