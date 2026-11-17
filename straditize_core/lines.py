"""Line candidate detection and classification (T05: Line Removal v2).

Classes:
- Kind A: Cross-ROI horizontal coordinate lines (贯穿横向线)
- Kind B: Cross-ROI vertical grid lines (贯穿纵向线)
- Kind C: Per-column vertical ticks / baselines (列内纵向线)
"""

from __future__ import annotations

from typing import Any, Sequence
import numpy as np

from .image import _detect_linear_structures

#: 线宽上限的自适应比例（相对 ROI 长边）。
#:
#: 线宽判据必须以**像素**计，而像素尺寸随扫描分辨率变化：同一条 zone 横线在
#: 6126px 宽的扫描件上约 6px，在 1600px 的教程图上只有 2px。固定 ``2`` 的后果
#: 是真实扫描件上所有区带线都被判为"太厚"而**一条都检测不到**——实测某张
#: 6126×3477 的扫描图：``max_width=2`` 得 0 条，``=6`` 得 14 条（横线出现在
#: y=1809/2741，与目视测量完全一致）。
#:
#: 比例取自实测标定：真实区带线 6px / ROI 长边 4855px ≈ 0.00124，放宽到
#: 0.0015 留一点余量。更大的比例（如 0.004）会把大量纵向纹理误收为候选。
_AUTO_WIDTH_RATIO = 0.0015

#: 自适应线宽下限：再小的图也不低于 **5px**。
#:
#: 原先写 3，理由是"再小的图也不低于 3px，否则抗锯齿边缘会被当成结构线"（抗锯齿只有
#: 1px，3 已经够）。但 3 会把**清晰可见的 4px 区带线**判成"太厚"，实测一张
#: 3591×2003 的孢粉图谱（ROI 2097×1521，自适应 = max(3, round(2097*0.0015)) = 3）：
#:
#:   max_width:   3    4    5    6    8
#:   横线候选:    1    4    4    4    4（另有 2 条竖线误收）
#:   命中 y:    671  671/1039/1297/1667 …（与目视四条区带线一致）
#:
#: 即：`3` 只检到 1 条，`4` 起四条齐全，`8` 开始把纵向纹理误收为候选。所以下限取 5——
#: 比实测需要的 4 留 1px 余量（同一批扫描件里抗锯齿会让同一条线在 4/5px 之间浮动），
#: 又远离 8 那个误收起点。
#:
#: 放宽的唯一风险是"把文字笔画当线"，但候选还要求**该行/列被墨迹覆盖 fraction 以上**
#: （`line_fraction_h=0.75`），短笔画不满足，所以厚度上限放宽不会引入文字误检——
#: 上面 8px 那档误收的是**贯穿整幅的纵向纹理**，不是文字。
_AUTO_WIDTH_FLOOR_H = 5

#: 竖线（Kind B 网格线 / Kind C 列内刻度齿）的下限仍是 **3**。
#:
#: 横竖分开是因为两类线的典型厚度本来就不同：贯穿区带线是**印刷的整幅横线**，
#: 在 2000px 级扫描件上 4–6px；竖线是轴线、刻度齿、网格线，普遍 1–3px。
#: 用同一个 3 对横线偏薄（漏 4px 真线，见上），用同一个 5 对竖线偏厚 ——
#: 实测 hoya（ROI 1712×808）把上限从 3 放到 4/5，竖线候选 **15 → 20 条**
#: （多出的 5 条是粗竖纹，不是结构线），横线候选 3 条不变。
#: 所以下限按方向分开取，两边都用实测值，不做"折中一个数"。
_AUTO_WIDTH_FLOOR_V = 3

#: 与列左缘重合多少像素以内的竖线算"这一列的轴线"。
#:
#: 与 ``cleanup.AXIS_BAND_PX`` 同口径：轴线普遍 1–3px 宽，列左缘取整误差在
#: ±1px 内，2px 足以覆盖。
COLUMN_AXIS_TOLERANCE_PX = 2


def _column_axis_positions(
    columns: Sequence[dict[str, Any]] | None,
    roi_id: str,
) -> list[int]:
    """本 ROI 各列的**轴线** x 位置（列左缘）。

    过滤口径与 Kind C 的列遍历一致：``roi_id`` 不匹配的列跳过（跨 ROI 的列坐标
    与本 ROI 无关，拿它排除会误杀本 ROI 里正当的竖线）。
    """
    if not columns:
        return []
    positions: list[int] = []
    for col in columns:
        col_roi = col.get("roi_id")
        if col_roi and col_roi != roi_id:
            continue
        raw = col.get("start", col.get("startX"))
        if raw is None:
            continue
        positions.append(int(round(float(raw))))
    return positions


def _is_column_axis(at: int, axis_positions: Sequence[int]) -> bool:
    return any(
        abs(int(at) - position) <= COLUMN_AXIS_TOLERANCE_PX
        for position in axis_positions
    )


def resolve_width_max(
    sub_shape: Sequence[int],
    line_width_max: int | None,
    *,
    axis: str = "h",
) -> int:
    """把 ``line_width_max`` 解析成实际像素上限。

    ``None`` 表示按 ROI 尺寸自适应（见 :data:`_AUTO_WIDTH_RATIO`）；
    下限按方向取不同值（见 :data:`_AUTO_WIDTH_FLOOR_H` / :data:`_AUTO_WIDTH_FLOOR_V`）：
    横线是印刷的整幅区带线（实测 4–6px），竖线是轴线/刻度齿/网格（实测 1–3px）。

    ``axis`` 默认 ``"h"``：区带线是用户最常检测、也最容易被漏掉的一类。
    显式传入 ``line_width_max`` 时方向不影响结果。
    """
    if line_width_max is not None:
        return int(line_width_max)
    floor = _AUTO_WIDTH_FLOOR_V if str(axis).lower().startswith("v") else _AUTO_WIDTH_FLOOR_H
    long_side = max(int(sub_shape[0]), int(sub_shape[1]))
    return max(floor, int(round(long_side * _AUTO_WIDTH_RATIO)))


def _projection_line_rows(
    binary: np.ndarray,
    *,
    fraction: float,
    min_width: int,
    max_width: int | None,
) -> np.ndarray:
    """Mirror legacy ``_filter_lines`` on a 2-D foreground projection."""
    if binary.size == 0:
        return np.array([], dtype=int)
    coverage = binary.sum(axis=1) / float(binary.shape[1])
    locations = np.where(coverage > float(fraction))[0]
    if not len(locations):
        return locations
    chunks = _cluster_indices(locations)
    selected: list[int] = []
    for chunk in chunks:
        if len(chunk) >= max(1, int(min_width)) and (
            max_width is None or len(chunk) <= int(max_width)
        ):
            selected.extend(chunk)
    return np.asarray(selected, dtype=int)


def _projection_line_cols(
    binary: np.ndarray,
    *,
    fraction: float,
    min_width: int,
    max_width: int | None,
) -> np.ndarray:
    """Column-projection counterpart of :func:`_projection_line_rows`."""
    return _projection_line_rows(
        binary.T,
        fraction=fraction,
        min_width=min_width,
        max_width=max_width,
    )


def detect_line_candidates(
    ink: np.ndarray,
    roi: Sequence[float] | dict[str, Any],
    columns: Sequence[dict[str, Any]] | None = None,
    *,
    line_fraction_h: float = 0.75,
    line_fraction_v: float = 0.30,
    line_width_min: int = 1,
    line_width_max: int | None = 2,
    roi_id: str = "roi_1",
    include_horizontal: bool = True,
    include_vertical: bool = True,
) -> list[dict[str, Any]]:
    """Detect structured line candidates inside the declared ROI.

    Uses continuous morphological opening and perpendicular stroke thickness
    to isolate true thin linear structures without eating solid silhouette areas.

    ``include_horizontal`` / ``include_vertical`` 决定**生成哪几类**候选：

    * ``include_horizontal`` 管 Kind A（贯穿横向线，坐标线）；
    * ``include_vertical`` 管 Kind B（贯穿纵向线，网格线）**与** Kind C
      （列内纵向短线，刻度齿/基线）—— 两者都是竖的，用户眼里的"竖线"就是
      这个集合，拆成两个开关只会让人猜。

    关掉的一类**不进入生成流程**（不是生成后过滤）：Kind C 的逐列
    ``_detect_linear_structures`` 也一并跳过。默认两个都是 ``True``，因而
    不传时行为与引入开关之前**逐字节相同**。
    """
    ink = np.asarray(ink, dtype=bool)
    if ink.ndim != 2 or ink.size == 0:
        return []

    height, width = ink.shape

    if isinstance(roi, dict):
        if "xlim" in roi and "ylim" in roi:
            rx0, rx1 = int(round(roi["xlim"][0])), int(round(roi["xlim"][1]))
            ry0, ry1 = int(round(roi["ylim"][0])), int(round(roi["ylim"][1]))
        else:
            rx0, rx1 = int(round(roi.get("xMin", 0))), int(round(roi.get("xMax", width)))
            ry0, ry1 = int(round(roi.get("yMin", 0))), int(round(roi.get("yMax", height)))
    else:
        rx0, rx1, ry0, ry1 = int(round(roi[0])), int(round(roi[1])), int(round(roi[2])), int(round(roi[3]))

    rx0, rx1 = sorted((max(0, min(width, rx0)), max(0, min(width, rx1))))
    ry0, ry1 = sorted((max(0, min(height, ry0)), max(0, min(height, ry1))))

    sub_ink = ink[ry0:ry1, rx0:rx1]
    sub_h, sub_w = sub_ink.shape
    if sub_h == 0 or sub_w == 0:
        return []

    candidates: list[dict[str, Any]] = []
    # 竖线口径（Kind B / Kind C）：下限 3，与历史基线一致。
    resolved_max = resolve_width_max((sub_h, sub_w), line_width_max, axis="v")
    # 横线口径（Kind A）：下限 5，见 _AUTO_WIDTH_FLOOR_H 的实测表。
    resolved_max_h = resolve_width_max((sub_h, sub_w), line_width_max, axis="h")
    max_thick = int(resolved_max)
    min_span_v = max(1, int(round(line_fraction_v * sub_h)))
    # 列轴线位置：**结构判据**，与列几何绑定（`columns[].start ±2px`），
    # 不是又一个覆盖率阈值。见 Kind B 里的排除说明。
    axis_positions = _column_axis_positions(columns, roi_id)

    # 1. Kind A: Horizontal lines across ROI (legacy projection semantics).
    #
    # `include_horizontal=False` 时 `rows_h` 为空 —— 下面的循环一次都不进去，
    # 一条 Kind A 字典也不会被构造。这是"不生成"，不是"生成后丢掉"。
    rows_h = (
        _projection_line_rows(
            sub_ink,
            fraction=line_fraction_h,
            min_width=line_width_min,
            max_width=resolved_max_h,
        )
        if include_horizontal
        else np.array([], dtype=int)
    )
    # ROI 边缘保护带：只够挡掉 1–2px 的 ROI 描边即可，必须是**小常量**。
    #
    # 两次事故都出在这里：曾用 `2 * line_width_max`，线宽放宽到 6px 时保护带变成
    # 12px，把贴着 ROI 下边界、距边仅 8px 的真实 zone 线当成边框吃掉；改成
    # `min(4, resolved_max)` 后仍以**恰好 1 像素**之差拒掉另一条（at_local=2384
    # vs 阈值 2384）。
    #
    # 这里选择偏召回的取舍：ROI 是 UI 叠加层、本就不在墨迹里，即使某条真实边框被
    # 检出，它也只是 `status="candidate"`（不确认就不动像素），用户否掉即可；
    # 反过来漏掉一条真实 zone 线，用户是没有任何补救手段的。
    edge_margin = 2
    # Ids are OPAQUE and positional. They used to be f"line_h_{at}_{w}px", which
    # baked two mutable facts into an identity: the user's very first nudge moves
    # `at`, and `set_line_thickness` rewrites `width`, after which the id claimed
    # things that were no longer true. The current facts live in `at`/`width`/
    # `span`/`geometry` — the id only has to be unique and stable.
    seq = 0
    for cluster in _cluster_indices(rows_h):
        at_local = int(round(float(np.mean(cluster))))
        # ROI borders are framing geometry, never removable artifacts.
        if at_local <= edge_margin or at_local >= sub_h - 1 - edge_margin:
            continue
        at_global = ry0 + at_local
        seq += 1
        candidates.append({
            "id": f"line_h_{seq}",
            "kind": "A",
            "axis": "h",
            "at": at_global,
            "span": [rx0, rx1 - 1],
            "width": len(cluster),
            "geometry": {
                "type": "rect",
                "x0": rx0,
                "y0": at_global - len(cluster) // 2,
                "x1": rx1 - 1,
                "y1": at_global + (len(cluster) - 1) // 2,
            },
            "roi_id": roi_id,
            "column_index": None,
        })

    # 2. Kind B: Cross-ROI vertical axes/grid lines (legacy projection semantics).
    #
    # `include_vertical=False` 时 `cols_v` 为空（见上），循环一次都不进。
    #
    # 列轴（= 列左缘那条贯穿竖线）**一律不提**。
    #
    # 面积图的 0 点画在列轴上，而 `_extraction_mask()` 会把已确认几何的像素从
    # 墨迹里减掉。列轴被提成候选之后的每一步都是错的：
    #
    # * 它通过全部闸门是**必然**的——1–3px 宽（< max_thick）、贯穿 ROI 高度；
    #   反过来"实线轴 + 填充"会连成宽 cluster 被"太厚"滤掉。也就是说检出的
    #   偏好恰好反向选中了最不该删的那批。实测 `hoya-del-castillo.png`（29 列）：
    #   21 条候选里 18 条竖线，**18 条全部落在列左缘 ±2px 内**。
    # * 确认它 = 删掉这一列的 0 点：col02 / col15 / col22 分别有 101 / 294 / 255
    #   行读数整体位移 1px，而画布上没有任何变化（`_axis_erasure_warnings` 只
    #   负责事后报警，用户看到时数据已经偏了）。
    # * 候选清单上唯一的动作是"确认去除 / 删除"。对列轴来说这两个动作都只有害处，
    #   所以"提出来再禁用"等于把 18 行不可选项塞进一个总共 21 行的清单里——那是
    #   噪音，不是信息。故选择**不提**，而不是提出来打标记。
    #
    # 抑制条件只用列结构（`columns[].start`），与 `line_fraction_v` 无关：把
    # fraction 调到能滤掉列轴的程度，真正的贯穿纵线（表格网格线）会一起消失。
    cols_v = (
        _projection_line_cols(
            sub_ink,
            fraction=line_fraction_v,
            min_width=line_width_min,
            max_width=resolved_max,
        )
        if include_vertical
        else np.array([], dtype=int)
    )
    for cluster in _cluster_indices(cols_v):
        at_local = int(round(float(np.mean(cluster))))
        if at_local <= edge_margin or at_local >= sub_w - 1 - edge_margin:
            continue
        at_global = rx0 + at_local
        if _is_column_axis(at_global, axis_positions):
            continue
        seq += 1
        candidates.append({
            "id": f"line_v_{seq}",
            "kind": "B",
            "axis": "v",
            "at": at_global,
            "span": [ry0, ry1 - 1],
            "width": len(cluster),
            "geometry": {
                "type": "rect",
                "x0": at_global - len(cluster) // 2,
                "y0": ry0,
                "x1": at_global + (len(cluster) - 1) // 2,
                "y1": ry1 - 1,
            },
            "roi_id": roi_id,
            "column_index": None,
        })

    mask_v = np.zeros_like(sub_ink, dtype=bool)
    if len(cols_v):
        mask_v[:, cols_v] = sub_ink[:, cols_v]

    # 3. Kind C: Column-internal vertical lines (列内竖线)
    #
    # 与 Kind B 同一个开关：列内短竖线在用户眼里也是"竖线"。关掉竖线时连逐列的
    # `_detect_linear_structures` 都不跑 —— 那是本函数最贵的一段（每列一次形态学）。
    if include_vertical and columns:
        for col_idx, col in enumerate(columns):
            if col.get("roi_id") and col["roi_id"] != roi_id:
                continue
            c_start = int(round(col.get("startX", col.get("start", 0)))) - rx0
            c_end = int(round(col.get("endX", col.get("end", 0)))) - rx0
            c_start = max(0, min(sub_w, c_start))
            c_end = max(0, min(sub_w, c_end))
            if c_end - c_start <= 2:
                continue

            col_sub = sub_ink[:, c_start:c_end]
            # Column-internal lines: span between 15% and min_span_v
            min_c_span = max(10, int(0.15 * sub_h))
            col_mask_c = _detect_linear_structures(
                col_sub,
                run_length=max(8, int(0.05 * sub_h)),
                min_span=min_c_span,
                max_thickness=max_thick,
                vertical=True,
            )
            # Remove any pixels already marked as cross-ROI vertical
            cols_c = np.where(col_mask_c.any(axis=0))[0]
            if len(cols_c) > 0:
                clusters = _cluster_indices(cols_c)
                for cluster in clusters:
                    global_cluster = [c_start + c for c in cluster]
                    at_local = int(round(float(np.mean(global_cluster))))
                    at_global = rx0 + at_local
                    # 与 Kind B 同一条结构判据：列左缘那一列就是轴线本身。
                    # Kind C 只看列内 15%–30% 高度的短竖线，列轴偶尔会被底轴
                    # 打断成这种长度 —— 打断不等于它不再是这一列的 0 点。
                    if _is_column_axis(at_global, axis_positions):
                        continue
                    # verify not in mask_v
                    if not np.any(mask_v[:, global_cluster]):
                        ink_rows = np.where(np.any(col_mask_c[:, cluster], axis=1))[0]
                        if len(ink_rows) > 0 and len(ink_rows) < min_span_v:
                            span = [int(ry0 + ink_rows[0]), int(ry0 + ink_rows[-1])]
                            candidates.append({
                                "id": f"line_c_{at_global}_{len(cluster)}px",
                                "kind": "C",
                                "axis": "v",
                                "at": at_global,
                                "span": span,
                                "width": len(cluster),
                                "roi_id": roi_id,
                                "column_index": col_idx,
                            })

    return candidates


def _cluster_indices(indices: np.ndarray | Sequence[int]) -> list[list[int]]:
    if len(indices) == 0:
        return []
    sorted_idx = sorted(int(i) for i in indices)
    clusters: list[list[int]] = []
    current = [sorted_idx[0]]
    for idx in sorted_idx[1:]:
        if idx == current[-1] + 1:
            current.append(idx)
        else:
            clusters.append(current)
            current = [idx]
    if current:
        clusters.append(current)
    return clusters
