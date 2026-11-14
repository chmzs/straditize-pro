# -*- coding: utf-8 -*-
"""整列墨迹被清理擦光时，`digitize` 必须拒绝，不得返回全 0。

## 缺陷本体

`_read_column_profile` 对"该行没有墨迹"的处理是 ``feat_x = float(c_start)``
（`digitize.py:297`）。于是当一列的墨迹被步骤 4 整列擦掉时：

* `_extraction_mask()` = ``foreground & ~grid_line_mask & roi_mask`` 在该列窗口内为全空；
* `digitize()` 照常返回 `y1-y0+1` 个点，每个点的 ``x`` 都等于列左缘；
* 换算成读数就是**整列 0**，与"这一列真是 0"在返回结构上**完全一致**。

实测（`hoya-del-castillo.png` col09 [1065,1097)）：排除区盖住整列后
``ink in window = 0``、``distinct x = [1065.0]``、801 个点、``control_points=2``，
RPC 响应无任何警告。这一步把"没有测量值"伪装成了"测量值为 0"，
违反 `docs/ARCHITECTURE.md` §2「取不到就报错并停在原地，绝不返回替代数据」。

## 判据（可判定，且不用魔数阈值）

**raw 有墨、kept 无墨** ⇒ 拒。两个计数取同一窗口：

* ``raw``  = `foreground_mask`（原图墨迹，未扣任何清理）；
* ``kept`` = `_extraction_mask()`（实际喂给读取器的墨迹）。

`raw > 0 and kept == 0` 是"这一列的数据被擦光了"的**充分且可证**的判据：
它不是"读数偏小"，而是**没有任何像素可供读取**。

不做的事（并说明为什么）：

* **不按"全 0"拒**：一层花粉为 0 是合法读数，`_read_column_profile` 对空行
  返回基线正是为此。按"全 0"拒会把正常的空层当缺陷。
* **不按比例阈拒**：部分擦除（例如一条干扰线）是正常操作，`_axis_erasure_warnings`
  已经在轴线被覆盖 ≥50% 高度时报警；这里只在"一个像素都不剩"时拒绝，
  判据没有可调参数，不存在"调到哪算对"的问题。
"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from straditize_core.protocol import STATE_ERROR, JsonRpcError
from straditize_core.session import StraditizeSession


def _session() -> tuple[StraditizeSession, str]:
    """60x120 图：col01=[10,30) 有墨，col02=[30,50) 一点墨都没有。"""
    mask = np.zeros((120, 60), dtype=bool)
    mask[:, 10] = True  # col01 的轴线
    mask[60:, 10:30] = True  # col01 的填充
    session = StraditizeSession()
    session.image = Image.fromarray((~mask).astype(np.uint8) * 255)
    session.width, session.height = 60, 120
    session.foreground_mask = mask
    session._init_rois()
    roi = session.roi_create(name="pollen", x0=0, x1=60, y0=0, y1=120)["roi"]
    session.columns = [
        {
            "col_index": 0,
            "name": "col01",
            "species": "col01",
            "roi_id": roi["id"],
            "start": 10.0,
            "end": 30.0,
            "startValue": 0.0,
            "tickValue": 100.0,
            "tickEndX": 30.0,
            "scale_type": "linear",
            "x_ticks": None,
        },
        {
            "col_index": 1,
            "name": "col02",
            "species": "col02",
            "roi_id": roi["id"],
            "start": 30.0,
            "end": 50.0,
            "startValue": 0.0,
            "tickValue": 100.0,
            "tickEndX": 50.0,
            "scale_type": "linear",
            "x_ticks": None,
        },
    ]
    return session, roi["id"]


def _rect(x0: int, x1: int, y0: int, y1: int) -> dict:
    return {"kind": "rect", "points": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]}


def test_digitize_refuses_a_column_whose_ink_was_erased() -> None:
    session, roi_id = _session()
    session.apply_line_removal(roi_id=roi_id, exclusion_regions=[_rect(10, 30, 0, 120)])

    with pytest.raises(JsonRpcError) as excinfo:
        session.digitize(0, reader_type="area")

    assert excinfo.value.code == STATE_ERROR
    message = str(excinfo.value)
    assert "col01" in message, f"报错必须点名是哪一列：{message}"
    assert "步骤 4" in message or "清理" in message, (
        f"报错必须指出数据是被清理擦掉的：{message}"
    )


def test_digitize_still_reads_a_column_with_no_ink_at_all() -> None:
    """金丝雀：**原本就空**的列不得被拒 —— 那是合法读数，不是被擦掉的数据。"""
    session, roi_id = _session()
    session.apply_line_removal(roi_id=roi_id, exclusion_regions=[_rect(10, 30, 0, 120)])

    result = session.digitize(1, reader_type="area")

    assert len(result["points"]) == 120, (
        f"col02 没有任何墨迹（也未被排除区覆盖），应照常返回逐行读数，"
        f"实际 {len(result['points'])} 个点"
    )


def test_digitize_still_reads_a_partially_excluded_column() -> None:
    """金丝雀：只擦掉一部分（有墨剩）时不得拒 —— 那是正常的步骤 4 用法。"""
    session, roi_id = _session()
    session.apply_line_removal(roi_id=roi_id, exclusion_regions=[_rect(20, 30, 0, 120)])

    result = session.digitize(0, reader_type="area")

    assert result["points"], "部分排除后仍有墨迹，必须照常返回读数"
