"""X-Ticks session mixin (T07: Geometric x-axis tick detection and column calibration)."""

from __future__ import annotations

from typing import Any, Sequence
import numpy as np

from ..protocol import STATE_ERROR, JsonRpcError
from ..xticks import detect_xticks

#: 横轴线的判定门限：该行暗像素占全图宽度的比例。
#:
#: 刻度尺的物理结构是"**一条横轴 + 一排垂直于它、向下伸出的短齿**"。故先找轴线，
#: 再在轴线正下方找齿——这个先后顺序是判据可信的来源，不是先找齿再猜哪条带像尺。
#:
#: 实测（fig3_raw 2132×928）：
#:
#: | 行 | 暗像素占比 | 是什么 |
#: |---|---|---|
#: | 868 | 3.8% | 空白 |
#: | **869** | **66.4%** | **横轴线** |
#: | 870-875 | 4-7% | 齿 |
#: | 886 | <4% | 印刷数字 |
#:
#: 66% 与 4% 差一个数量级，40% 的门限落在中间的宽裕位置，对扫描噪点不敏感。
AXIS_DARK_FRACTION = 0.40

#: 齿的最大长度（px）：从轴线向下连续暗的行数。
#:
#: 真齿实测 4-7px（fig3 实测 6px 内全部为暗）。列框线/分隔线是**贯穿全图**的，
#: 长度可达数百像素，远超此值。二者数量级相差两个数量级。
#:
#: ## 已知局限：本带高只收长度 ≥6px 的齿，漏掉短齿（P2，未修）
#:
#: `_strokes_in_band` 用 `col_fill > 0.95`（带高 6 行里几乎每行都暗才认一列），
#: 所以**填不满 6 行带高的齿被整批滤掉**。
#:
#: fig3 实测齿长是**离散分档**（不是连续分布）：`{1px: 3, 3px: 24, 4px: 14,
#: 5px: 1, 6px: 51}`，T2 后全部齿 **93 个**。产品带高 6 时只收长度 ≥6 的 **51 个**，
#: 漏检 **42 个**短齿（1-5px），占 45%。
#:
#: | 带高 | 齿数 | 间距中位 | 说明 |
#: |---|---|---|---|
#: | ≤3 | 90 | 13 | 收全（长齿 + 1-5px 短齿） |
#: | 6 | 51 | 25 | **只收 6px 长齿（当前实现）** |
#:
#: **不影响 band 定位**（band 正确落在 870-876，三图分离稳定 51/0/0），只影响
#: 齿数完整性，故本轮不修。若将来要让"自动提取"给出完整齿位，必须连
#: `_strokes_in_band` 的 `col_fill` 阈值一起改造（例如先按 run 长度分档：长齿定位
#: 带、短齿补齿位）。**不要只把 `TICK_DEPTH` 调小**：depth≤3 时 hoya/beginner 的
#: 三图分离度尚未验证。
#:
#: 注意"齿长"有两个口径，方向相反，勿混用：本模块用 `col_fill > 0.95`（齿必须
#: 贯穿整个带高），而探针常用 `run <= depth`（齿长上限）。同一 depth 下两者给出的
#: 齿数完全不同（实测 depth=6：前者 51、后者 93），拿其中一个的数字去描述另一个
#: 的行为会得出错误结论。
TICK_DEPTH = 6

#: 轴线上方多少行内不得有暗像素（排除条件 T2）。
#:
#: 这是区分"齿"与"贯穿框线"的关键：真齿**只从轴线向下伸出**，其正上方是空白；
#: 而列框线、图例字母的竖笔会**穿过**轴线或在其上方就有笔画。
#:
#: 实测（fig3，16 个已知框线位）：16/16 全部满足"轴线上方有暗"，16/16 被 T2 排除；
#: 而真齿 51 个全部通过（T2 不误伤真齿）。
TICK_CLEAR_ABOVE = 3

#: 一条带至少要有这么多齿才认为是刻度尺。
#:
#: 实测分离度：
#:
#: | 图 | 最佳候选带的齿数 | 真值 |
#: |---|---|---|
#: | fig3_raw（有尺） | **51**（轴线 y=869） | 有刻度尺 |
#: | hoya（无尺） | 16（轴线 y=1307，图例文字） | 无刻度尺 |
#: | beginner（无尺） | 2（轴线 y=1664） | 无刻度尺 |
#:
#: 51 与 16 之间有 3 倍余量，取 20 落在中间。这个判据不与齿数「绝对值」挂钩
#: 于任何已知真值——它只问"这条轴线下方的齿数是否达到了刻度尺的量级"。
MIN_TICKS_FOR_SCALE = 20


def _merge_adjacent(columns: Sequence[int], gap: int = 2) -> list[int]:
    """把相邻（间隙 ≤ ``gap``）的列合并成一条齿，返回每条齿的中心 x。

    一条视觉上的齿在二值图里常占 2-3 个连续列（抗锯齿）；不合并会把一条齿数成
    两三条，齿数因此膨胀（实测未合并时 fig3 的 51 条齿会被数成 70+）。
    """
    groups: list[list[int]] = []
    for x in sorted(int(value) for value in columns):
        if groups and x - groups[-1][-1] <= gap:
            groups[-1].append(x)
        else:
            groups.append([x])
    return [group[len(group) // 2] for group in groups]


class XTicksMixin:
    """Session mixin for X-ticks detection and per-column calibration."""

    tick_band: list[int] | None

    def _init_xticks(self) -> None:
        """Initialize xticks state."""
        self.tick_band = None

    def _locate_tick_band(
        self,
        gray: np.ndarray,
        *,
        ylim: Sequence[float],
    ) -> tuple[int, int] | None:
        """找出横轴刻度尺所在的带；找不到返回 ``None``。

        ## 旧实现为什么恒为死代码（G-01a）

        旧搜索窗口 ``range(y_bottom - 4, y_bottom + 16)`` 同时要求
        ``top + bh <= hi_search``（``hi_search = y_bottom``）。最小可达的
        ``top + bh`` 是 ``(y_bottom - 4) + 6 = y_bottom + 2``，**恒大于** ``hi_search``
        ——60 个候选全被 ``continue``，一个都没测过。步骤 6 的"自动提取"因此完全
        不可用，而表面现象只是"这张图没有刻度尺"。

        而且"刻度尺紧贴 ROI 底部 ±16px"这个假设本身是错的：fig3_raw 的 ROI 底是
        744，真尺在 869-875，差 125px。ROI 是用户框的**取数区**，刻度尺画在图版
        下缘。故本实现不再假设相对位置，而是**按物理结构找轴线**。

        ## 判据（按物理结构，不按齿数拟合）

        刻度尺的定义性结构是"一条横轴 + 一排垂直于它、只向下伸出的短齿"。据此：

        1. **找轴线**：逐行算暗像素占全宽比例，超过 :data:`AXIS_DARK_FRACTION`
           的行是横轴候选（fig3 实测 y=869 达 66%，其余行 ≤7%）；
        2. **在轴线正下方找齿**：轴线之下 :data:`TICK_DEPTH` 行内连续为暗的列；
        3. **T2 排除**：该列在轴线上方 :data:`TICK_CLEAR_ABOVE` 行内不得有暗像素
           ——真齿只往下伸，贯穿框线与图例字母的竖笔会穿过轴线；
        4. **量级门槛**：齿数需达 :data:`MIN_TICKS_FOR_SCALE`。这一步挡的是
           "轴线下恰好有零星短笔画"（hoya 图例区最多 16、beginner 最多 2）。

        ## 为什么不用"齿数最多"或"游程最长"当判据

        两者都实测过、都不成立：fig3 的**数字区**（y=886）齿数 55 比真齿区 51 还多
        ——齿数不但不能区分对错，方向甚至相反；而真齿带里含贯穿框线，最长游程达
        662px，用游程阈值会把真尺整条误杀。这也是本任务书前几版判据全部失败的原因。

        返回 ``(axis + 1, axis + 1 + TICK_DEPTH)``：带从轴线**下方第一行**开始，
        不含轴线本身（含轴线会把横线算成一整条"齿"）。
        """
        img_h = int(gray.shape[0])
        if img_h <= TICK_DEPTH:
            return None
        dark = gray < 160
        y_top = max(0, int(round(float(ylim[0]))))
        y_bottom = float(ylim[1])

        axis_rows = [
            y
            for y in range(min(y_top, int(round(y_bottom))), img_h)
            if dark[y].mean() > AXIS_DARK_FRACTION
        ]
        if not axis_rows:
            return None

        # 合并相邻轴线行（粗轴线可能占 2-3 行），取每组最后一行作为齿的起点。
        axis_groups: list[list[int]] = []
        for y in axis_rows:
            if axis_groups and y - axis_groups[-1][-1] <= 2:
                axis_groups[-1].append(y)
            else:
                axis_groups.append([y])

        best: tuple[int, tuple[int, int]] | None = None
        for group in axis_groups:
            axis = group[-1]
            band_start = axis + 1
            if band_start + TICK_DEPTH >= img_h:
                continue
            band = dark[band_start : band_start + TICK_DEPTH, :]
            stroke_columns = np.where(band.mean(axis=0) > 0.99)[0]
            if len(stroke_columns) < MIN_TICKS_FOR_SCALE:
                continue
            # T2：真齿只从轴线向下伸出，正上方必须是空白。
            clear_above = [
                int(x)
                for x in stroke_columns
                if not any(
                    dark[axis - offset, x]
                    for offset in range(1, TICK_CLEAR_ABOVE + 1)
                    if axis - offset >= 0
                )
            ]
            merged = _merge_adjacent(clear_above)
            tick_count = len(merged)
            if tick_count < MIN_TICKS_FOR_SCALE:
                continue
            if best is None or tick_count > best[0]:
                best = (tick_count, (band_start, band_start + TICK_DEPTH))

        return best[1] if best is not None else None

    def detect_xticks_rpc(
        self,
        roi_id: str | None = None,
        band: Sequence[int] | None = None,
        dark_threshold: int = 160,
    ) -> dict[str, Any]:
        """Detect x-axis tick marks for an ROI using geometric run algorithm."""
        if getattr(self, "image", None) is None:
            return {"band": None, "per_column": []}

        # Convert image to greyscale
        img = self.image.convert("L")
        gray = np.array(img)

        cols = []
        target_roi_id = roi_id
        if not target_roi_id and hasattr(self, "rois") and self.rois:
            target_roi_id = getattr(self, "active_roi_id", None) or self.rois[0]["id"]

        for col in getattr(self, "columns", []):
            if not target_roi_id or col.get("roi_id") == target_roi_id:
                cols.append((col.get("startX", col.get("start", 0)), col.get("endX", col.get("end", 0))))

        resolved_band = band
        if resolved_band is None and target_roi_id and hasattr(self, "_get_roi"):
            try:
                target_roi = self._get_roi(target_roi_id)
                ylim = target_roi.get("ylim") if target_roi else None
                if ylim and len(ylim) == 2:
                    resolved_band = self._locate_tick_band(gray, ylim=ylim)
            except Exception:
                pass

        res = detect_xticks(
            gray,
            band=resolved_band,
            dark_threshold=dark_threshold,
            columns=cols if cols else None,
        )
        if res.get("band"):
            self.tick_band = list(res["band"])
        return res

    def calibrate_column_xticks(
        self,
        col_index: int | str,
        ticks: list[dict[str, float]],
        unit: str | None = None,
        plot_type: str | None = None,
        scale_type: str | None = None,
        exaggeration_mult: float | None = None,
    ) -> dict[str, Any]:
        """Calibrate a column's scale using exactly two tick endpoints [Tick(px, value), Tick(px, value)].

        ``col_index`` accepts either the numeric index or the column id
        (``roi_1_col01``) — same convention as ``column_remove``/``column_update``.

        Enforces:
        - Exactly two ticks required;
        - Pixel coordinates must not be identical;
        - Updates Column.x_ticks as the sole source of truth.

        ``unit``/``plot_type``/``scale_type``/``exaggeration_mult`` are written
        **only when actually passed** (``None`` = keep the current value), so
        calibrating ticks never silently resets a column's other scale fields.
        """
        if not ticks or len(ticks) != 2:
            raise JsonRpcError(
                -32602,
                f"参数格式不合规：每列标定需要恰好 2 个端点刻度齿 (Tick)，当前提供了 {len(ticks) if ticks else 0} 个。请在【步骤 6: 标定列】点选起点和终点刻度。",
            )

        t0, t1 = ticks[0], ticks[1]
        px0, val0 = float(t0.get("px", t0.get("pixel", 0))), float(t0.get("value", t0.get("val", 0)))
        px1, val1 = float(t1.get("px", t1.get("pixel", 0))), float(t1.get("value", t1.get("val", 0)))

        if px0 == px1:
            raise JsonRpcError(
                -32602,
                "参数格式不合规：两个标定刻度齿的像素 X 坐标不能相同。请重新拾取相隔一定距离的刻度线齿。",
            )

        resolved = self._resolve_col_index(col_index)
        columns = getattr(self, "columns", [])
        if resolved < 0 or resolved >= len(columns):
            raise JsonRpcError(
                -32001,
                f"前置状态缺失：列索引 {resolved} 超出范围。请先在【步骤 5: 分列】确认列切分。",
            )

        col = columns[resolved]

        # 检查刻度端点物理合理性：
        # 1. px0 作为起点基线，必须严格锚定在当前列起点附近（允许 ±15px 手抖误差）；
        # 2. px1 作为满刻度端点，在花粉图中（如紧凑排版）完全可能超过狭窄列的右边界
        #    （例如属种含量仅 2% 切出 14px 列宽，但标尺标准跨度为 40px=20%）。
        #    因此 px1 必须位于 px0 右侧，并允许延伸至合理标尺跨度范围内（不超过图像边界）。
        c_start = float(col.get("startX", col.get("start", 0)))
        c_end = float(col.get("endX", col.get("end", 0)))
        c_min = min(c_start, c_end)
        c_max = max(c_start, c_end)
        max_img_w = float(getattr(self, "width", 0) or 100000.0)

        lo = c_min - 15.0
        # 允许标尺跨越狭窄列（例如含量 <2% 的 14px 窄列仍可接收 40px 的标准模数标尺）：
        ref_span = 0.0
        x_group_id = col.get("x_group_id")
        if x_group_id:
            for r_item in getattr(self, "rois", []):
                for grp in r_item.get("x_groups", []):
                    if grp.get("id") == x_group_id and grp.get("ref_span_px"):
                        ref_span = max(ref_span, float(grp["ref_span_px"]))
        max_span = max(c_max - c_min + 15.0, (ref_span + 15.0) if ref_span > 0 else 80.0)
        hi = min(c_min + max_span, max_img_w)

        p_left = min(px0, px1)
        p_right = max(px0, px1)

        if not (lo <= p_left <= c_max + 15.0 and c_min < p_right <= hi):
            raise JsonRpcError(
                -32602,
                f"参数范围越界：刻度端点 ({px0}, {px1}) 超出有效范围。左端点 ({p_left}) 必须在该列基线附近 [{lo}, {c_max + 15.0}]，"
                f"右端点 ({p_right}) 必须在有效范围内 (<= {hi})。",
            )

        # **先记录，再修改**（B-06）。
        #
        # 反了就是"撤销撤不回标定"：`_record_history` 记录的是调用那一刻的状态，
        # 先写 `x_ticks` 再记录，存进撤销栈的已经是**标定后**的值，于是 Ctrl+Z
        # 只是把新值再回填一次——用户看到状态毫无变化，却白耗一格撤销栈（实测
        # 栈顶快照里就是 `[{px:339,...},{px:477,...}]`，与实时值一模一样）。
        #
        # 注意顺序必须放在所有越界校验**之后**：校验抛错时不该留下撤销条目，
        # 否则用户点一次越界会得到一格什么都不做的历史。
        record_history = getattr(self, "_record_history", None)
        if callable(record_history):
            record_history(f"Calibrate X-Ticks for {col.get('name', f'col_{resolved}')}")

        # Set sole source of truth
        col["x_ticks"] = [{"px": px0, "value": val0}, {"px": px1, "value": val1}]
        # 用户重新标定成功 = B-02 留下的"标定已被清空"提醒已经过时。
        # 不 pop 就是**永久假警报**：面板会一直在已标定的列上喊"标定已清空"。
        col.pop("x_ticks_dropped", None)
        # 只写调用方真正传了的字段：**未传 = 保持原值**。
        # 这几个形参原本是 "%"/"area"/"linear"/None 的固定默认值，于是「标定刻度」
        # 会顺手把用户设好的单位 / plot_type / scale_type / 放大倍数重置掉
        # ——面板只发 col_index+ticks+unit，点一次【保存】就静默清空三项。
        if unit is not None:
            col["unit"] = unit
        if plot_type is not None:
            col["plot_type"] = plot_type
        if scale_type is not None:
            col["scale_type"] = scale_type
        if exaggeration_mult is not None:
            col["exaggeration_mult"] = exaggeration_mult
            col["mult_source"] = "user"

        # Derive px_per_unit for inspection
        px_span = abs(px1 - px0)
        val_span = abs(val1 - val0)
        px_per_unit = (px_span / val_span) if val_span > 0 else 0.0

        return {
            "col_index": resolved,
            "x_ticks": col["x_ticks"],
            "px_per_unit": px_per_unit,
            "column": col,
        }

    def clear_column_xticks(self, col_index: int | str) -> dict[str, Any]:
        """Remove a column's scale calibration, returning it to the uncalibrated state.

        Inverse of `calibrate_column_xticks`: afterwards the column has no
        `x_ticks` (i.e. `null` = 未标定). Consumers must then either refuse or
        explicitly flag the fallback — never silently substitute a scale.

        History is recorded **only when something was actually cleared**, so a
        no-op click cannot plant a phantom undo entry.
        """
        resolved = self._resolve_col_index(col_index)
        columns = getattr(self, "columns", [])
        if resolved < 0 or resolved >= len(columns):
            raise JsonRpcError(
                -32001,
                f"前置状态缺失：列索引 {resolved} 超出范围。请先在【步骤 5: 分列】确认列切分。",
            )

        col = columns[resolved]
        # **先记录，再清除**（B-06，与 calibrate 同一个道理）。
        # 先 pop 再记录，撤销栈里存的就是"已清除"的状态，Ctrl+Z 清不回来。
        # 只在真的会清除时才记录：无操作也压栈等于幻影撤销条目。
        if col.get("x_ticks") is not None:
            record_history = getattr(self, "_record_history", None)
            if callable(record_history):
                record_history(f"Clear X-Ticks for {col.get('name', f'col_{resolved}')}")

        had_ticks = col.pop("x_ticks", None) is not None
        # 用户主动清除标定 = 他自己知道现在没标定，不需要再挂一条
        # "标定被换图/重分列清空了"的提醒（那是被动丢失的提示，两个语义不能混）。
        col.pop("x_ticks_dropped", None)

        return {"col_index": resolved, "x_ticks": None, "cleared": had_ticks}

    def measure_ruler_geometry(self, roi_id: str | None = None) -> dict[str, Any]:
        """Measure each column's **tick-ruler geometry** (read-only, no side effects).

        Returns, per column: the axis row, tick x-positions, cell count, cell
        spacing and whether the spacing is regular — plus the ROI-wide median
        spacing. No calibration values are produced or written.

        ## 为什么只给几何、不给读数

        刻度尺的**几何**是客观的（图上有几条刻线、间距多少），可以自动测；
        但**每格代表多少**是作图书版的设定，图上没有任何信息可推。

        实测反证（Han et al. 2026 Fig.3，以 Cyperaceae 13 格 = 70.07% 为锚点外推）：
        `Artemisia` 刻距 12.5px 与锚点 13.0px 几乎相同，外推误差却达 **−84%**；
        `Caryophyllaceae` 达 **+151%**。故任何跨列外推都是猜，本方法坚决不产出。

        前端应把 `n_cells` 展示给用户，用于**发现**哪些列没有印刷数字、
        哪些列刻距异常（例如明显偏离中位数的列），而不是用来生成读数。
        """
        if getattr(self, "image", None) is None:
            raise JsonRpcError(
                STATE_ERROR, "No image loaded. Please call core.loadImage first."
            )

        from ..ruler import detect_ruler_for_columns

        target_roi_id = roi_id or getattr(self, "active_roi_id", None)
        if not target_roi_id and getattr(self, "rois", None):
            target_roi_id = self.rois[0]["id"]

        columns = [
            c
            for c in getattr(self, "columns", [])
            if not target_roi_id or c.get("roi_id") == target_roi_id
        ]
        if not columns:
            raise JsonRpcError(
                STATE_ERROR,
                "前置状态缺失：当前有效区内没有列。请先在【步骤 5: 分列】确认列切分后再测量刻度尺。",
            )

        gray = np.array(self.image.convert("L"))
        result = detect_ruler_for_columns(gray, columns)
        result["roi_id"] = target_roi_id
        # 明确声明：本接口不产出任何读数。
        result["calibration_suggestions"] = []
        result["note"] = (
            "仅测量刻线几何（轴线/刻线/格数/刻距）。不产出任何满量程读数："
            "每格数值是作图书版设定，图上无法推得；跨列外推实测误差可达 84%–151%。"
        )
        return result
