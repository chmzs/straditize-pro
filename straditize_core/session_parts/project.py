"""Project session mixin managing project serialization, loading, archiving, and undo/redo."""

from __future__ import annotations

from .export_docs import CSV_MISSING_NOTICE

import base64
import copy
import io
import json
import logging
import os
import tarfile
import time
from typing import Any

import numpy as np
from PIL import Image

from ..age_depth import AgeDepthModel
from ..image import GRID_LINE_PRESETS, is_supported_grid_line_strength
from ..protocol import (
    FILE_NOT_FOUND_ERROR,
    INVALID_PARAMS,
    JsonRpcError,
)
from .xscale import resolve_column_scale, store_exaggeration

logger = logging.getLogger("straditize_rpc")


def _payload_exaggeration(raw_column: dict[str, Any]) -> Any:
    """工程包里的放大倍数：优先现代键；老包只有 `has_exaggeration` + multiplier 那一对。"""
    canonical = raw_column.get("exaggeration_mult")
    if canonical is not None:
        return canonical
    if not bool(raw_column.get("has_exaggeration", raw_column.get("hasExaggeration", False))):
        return None
    return raw_column.get("exaggeration_multiplier", raw_column.get("exaggerationMult"))

def _canonical_degrid_strength(raw: Any, *, origin: str) -> str | None:
    """把去线强度收敛到唯一合法域：{weak, medium, strong} ∪ {None}。

    这个字段是**枚举**，而工程包是用户可手改的文本、会话状态也可能被别的入口写入，
    所以写入侧与读取侧都过这一道：空 → None；合法预设 → 规范名（大小写不敏感）；
    其余 → None + 告警。不做"数字 → 预设"的映射：0.6 究竟算 weak 还是 medium 没有
    任何可靠依据，猜一个比不设更危险。

    为什么不抛错：它是外观设置，不该把整份工程挡在门外——这与 `_parse_schema_major`
    对乱码版本号的处理是同一取舍（那个决定的是"要不要拒绝版本"，不是"允许非法值"）。
    但非法值**绝不能**进运行时：它会一路走到 `algorithm_degrid` 抛 ValueError，再被
    project_save 的保底逻辑吞成一份全 0 的占位 CSV（用户会以为是自己没数字化）。
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    if is_supported_grid_line_strength(raw):
        return str(raw).strip().lower()
    logger.warning(
        "%s的去线强度=%r 不是合法预设（%s），已按未设置处理。",
        origin,
        raw,
        " / ".join(sorted(GRID_LINE_PRESETS)),
    )
    return None


def _parse_schema_major(raw_version: Any) -> int | None:
    """从工程包版本号里取出主版本整数；无法判定时返回 None。

    工程包里同时存在两种写法（都是写盘侧产生的真实值）：
    `"3.0.0"`（`version`）与 `"3.0"`（`schema_version`），故只取第一个点号
    之前的部分。**不可解析一律返回 None 交给调用方放行**——这个函数只负责
    判断"能不能确定版本更高"，不负责拒绝。乱码（`"banana"`、负数、空串、
    非字符串非数字类型）都归到 None，绝不让门禁因为解析失败而把老包挡死。
    """
    if isinstance(raw_version, bool):
        # bool 是 int 的子类，`True` 会被当成 1，那是误读而非版本号。
        return None
    if isinstance(raw_version, int):
        return raw_version if raw_version >= 0 else None
    if isinstance(raw_version, float):
        return int(raw_version) if raw_version >= 0 else None
    if not isinstance(raw_version, str):
        return None
    head = raw_version.strip().split(".", 1)[0].strip()
    if not head.isdigit():
        return None
    return int(head)


class ProjectSessionMixin:
    """Session mixin for project lifecycle: new, load, save, undo, and redo."""

    def _snapshot_editable_state(self) -> dict[str, Any]:
        """Captures the undoable entities as a **self-contained** copy.

        用深拷贝，不用 `[dict(c) for c in ...]`。

        **诚实定性（2026-10-23 复核，含否决掉的初版说法）**：浅拷贝只复制列字典
        的第一层，`x_ticks`（``list[dict]``）、`x_values`、`detected_ticks`、
        `control_points` 这些嵌套容器会与快照**共享同一个对象**。对象层面的共享
        已实测确认（原地改实时嵌套值会穿透到快照）。

        但在**当前**产品代码里，`x_ticks` 只通过整体替换写入
        （`xticks.py` 的 `col["x_ticks"] = [{...}, {...}]`，`core.py:919` 的
        `col["x_ticks"] = t`），全仓 grep 没有任何一处原地改它的元素。整体替换
        不触及旧对象，所以**当前不存在可触发的穿透路径**——用浅拷贝跑现有全量
        测试也是绿的。

        因此这里的定性是：**消除了一类潜在的状态共享（当前无触发路径，由深拷贝
        预防）**，不是"修好了正在发生的写穿透"。真实存在过的 B-06 缺陷只有一条
        ——记录时机（先改后记），见 `_record_history` 的 docstring。

        保留深拷贝的理由是防未来：这个模块里已经有 `control_points[row] = x`
        这类原地写（`digitize.py`），任何人给标定加一行
        `col["x_ticks"][0]["value"] = ...`（这是很自然的写法）就会静默污染全部
        历史。1ms 换掉这一类隐患划算。

        代价实测（hoya 28 列 + 727 个控制点的真实负载）：
        浅拷贝 0.02ms，`deepcopy(columns)` 0.34ms，两份合计 ~1.04ms/次。
        撤销栈上限 500 格，用户单次操作最多多花 1ms。

        **这条判据不能用探针"绿了"来证明**：`scripts/prod_gate/b06_undo_probe.py`
        的 P4 就是这个坑——它比较的两个值都取自"标定前"那一格快照（两个
        `null` 相等于恒真），用浅拷贝重跑同样 PASS。判据若无判别力，绿得再整齐
        也不算证据。本文件对应的测试用**构造非空快照**的方式保证有判别力。
        """
        columns = getattr(self, "columns", []) or []
        control_points = getattr(self, "control_points", {}) or {}
        data_xlim = getattr(self, "data_xlim", None)
        data_ylim = getattr(self, "data_ylim", None)
        return {
            "columns": copy.deepcopy(columns),
            "control_points": copy.deepcopy(control_points),
            "data_xlim": list(data_xlim) if data_xlim else None,
            "data_ylim": list(data_ylim) if data_ylim else None,
            "taxa_names": list(getattr(self, "taxa_names", []) or []),
            # 采样层位（B-06b）。它此前完全不在撤销范围内：写入路径虽然调了
            # `_record_history`，但快照里没有这个键，于是撤销后 samples 原样不动、
            # 用户却以为撤回了。层位是步骤 7 的核心科研输入，必须可撤销。
            #
            # 同样深拷贝：`samples` 是 `list[dict]`，浅拷贝会让快照与实时共享
            # 字典，任何原地改（如改某条的 depth）都会污染历史。
            "samples": copy.deepcopy(getattr(self, "samples", []) or []),
            # 步骤 4 的三类清理几何（2026-11-14）。它们此前**完全不在撤销范围内**：
            # `cleanup.py` 的六个入口一次都不调 `_record_history`，快照里也没有这
            # 三个键，于是 Ctrl+Z 对"确认删除一条干扰线"毫无反应——用户误删之后
            # 唯一的退路是"清空全部重来"，而那个动作本身也不可撤销。
            #
            # 为什么必须深拷贝、而且必须**保住 id**：`line_candidates` 里每条候选
            # 的身份是 `id`。前端按 id 记住"哪条被确认""哪条被选中"，后端
            # `_geometry_mask` 按 status 扣墨迹。若撤销后重新铸 id（例如按位置
            # 重建），前端的选择集与 `selected_candidate_ids` 会指向不存在的对象，
            # 而 `_candidate_seq` 的注释写明的撞号风险也会回来（重铸的 id 可能
            # 与现存候选相同，delete-by-id 就会一次删掉两条）。deepcopy 原样搬运
            # 字典，id 字符串不变，这也是这里唯一正确的做法。
            "line_candidates": copy.deepcopy(
                getattr(self, "line_candidates", []) or []
            ),
            "exclusion_regions": copy.deepcopy(
                getattr(self, "exclusion_regions", []) or []
            ),
            "line_strokes": copy.deepcopy(getattr(self, "line_strokes", []) or []),
        }

    def _record_history(self, action_name: str) -> None:
        """Records a snapshot of editable entities for undo/redo (max 500 steps, Section 七).

        **必须在修改之前调用**（B-06）。快照记录的是"调用这一刻"的状态，若先改
        再记，存进去的已经是新值，于是撤销只会把新值再回填一次——用户按 Ctrl+Z
        看到状态不动，却白耗一格撤销栈。
        """
        snapshot = {"action": action_name, "timestamp": time.time()}
        snapshot.update(self._snapshot_editable_state())
        undo_stack = getattr(self, "undo_stack", None)
        if undo_stack is None:
            self.undo_stack = []
            undo_stack = self.undo_stack
        undo_stack.append(snapshot)
        max_hist = getattr(self, "max_history", 500)
        if len(undo_stack) > max_hist:
            undo_stack.pop(0)
        if hasattr(self, "redo_stack") and self.redo_stack is not None:
            self.redo_stack.clear()

    def history_undo(self) -> dict[str, Any]:
        """Undo last command."""
        undo_stack = getattr(self, "undo_stack", [])
        if not undo_stack:
            return {"success": False, "message": "Nothing to undo"}
        current = self._snapshot_editable_state()
        if not hasattr(self, "redo_stack") or self.redo_stack is None:
            self.redo_stack = []
        self.redo_stack.append(current)
        prev = undo_stack.pop()
        self._restore_editable_state(prev)
        return {"success": True, "action": prev.get("action", "undo")}

    def _restore_editable_state(self, snapshot: dict[str, Any]) -> None:
        """Applies a snapshot back onto the session.

        再复制一遍是**刻意的**：快照一旦被回填成实时状态，两者就共享对象了，
        用户下一步的编辑会顺手改掉历史。历史记录必须只读。
        """
        self.columns = copy.deepcopy(snapshot["columns"])
        self.control_points = copy.deepcopy(snapshot["control_points"])
        self.data_xlim = list(snapshot["data_xlim"]) if snapshot["data_xlim"] else None
        self.data_ylim = list(snapshot["data_ylim"]) if snapshot["data_ylim"] else None
        self.taxa_names = list(snapshot["taxa_names"])
        # `samples` 用 `.get` 兜底：2026-10-23 之前压进栈的快照没有这个键，
        # 而撤销栈是会话内存状态、不跨版本持久化，所以这里是"同一次会话里
        # 旧代码新代码混用"才会遇到。缺键时保持当前 samples 不动，而不是清空
        # —— 清空会让"回到一个本来就没有 samples 的状态"和"把用户数据洗掉"
        # 变得无法区分。
        if "samples" in snapshot:
            self.samples = copy.deepcopy(snapshot["samples"])
        # 步骤 4 的清理几何。缺键的兜底理由与 `samples` 完全相同（同一次会话里
        # 旧快照新代码混用）：保持当前清理状态不动，而不是清空——"回到本来就
        # 没有几何的状态"与"把用户确认过的清理全部洗掉"必须可区分。
        restored_cleanup = False
        for key in ("line_candidates", "exclusion_regions", "line_strokes"):
            if key in snapshot:
                setattr(self, key, copy.deepcopy(snapshot[key]))
                restored_cleanup = True
        if restored_cleanup:
            self._rebuild_cleanup_masks_after_restore()

    def _rebuild_cleanup_masks_after_restore(self) -> None:
        """把清理几何回填之后，必须重算派生掩膜。

        只回填列表是不够的：`grid_line_mask` 是撤销**之前**那版合成结果，而
        `_extraction_mask()` 直接读它。不重算的表现是——候选列表上写着
        `candidate`（界面上"未确认"），取数却照样把这块墨迹扣掉；也就是说
        "撤销"看起来成功了，数据没回来。这正是本项目最怕的静默错。

        没有像素时（还没载图）无法合成：把派生掩膜全部置空，宁可"没有掩膜"，
        也绝不留下与恢复状态不符的旧掩膜。
        """
        if getattr(self, "image", None) is None or getattr(
            self, "foreground_mask", None
        ) is None:
            self.candidate_line_mask = None
            self.exclusion_mask = None
            self.manual_restore_mask = None
            self.manual_erase_mask = None
            self.grid_line_mask = None
            return
        roi_id, _ = self._roi_for(None)
        self._recompose(roi_id)

    def history_redo(self) -> dict[str, Any]:
        """Redo last undone command."""
        redo_stack = getattr(self, "redo_stack", [])
        if not redo_stack:
            return {"success": False, "message": "Nothing to redo"}
        current = self._snapshot_editable_state()
        if not hasattr(self, "undo_stack") or self.undo_stack is None:
            self.undo_stack = []
        self.undo_stack.append(current)
        nxt = redo_stack.pop()
        self._restore_editable_state(nxt)
        return {"success": True, "action": nxt.get("action", "redo")}

    def project_new(self, clear_image: bool = False) -> dict[str, Any]:
        """Clears session state to start a clean project."""
        self.columns = []
        self.column_points = {}
        self.control_points = {}
        self.reader_types = {}
        self.is_calibrated = False
        self.y_scale = None
        self.x_scales = {}
        self.depth_calib = None
        self.grid_line_mask = None
        self.candidate_line_mask = None
        self.degrid_line_mask = None
        self.exclusion_mask = None
        self.manual_restore_mask = None
        self.manual_erase_mask = None
        self.cleanup_stats = {}
        self.cleanup_overlay_png = None
        self.degrid_strength = None
        self.degrid_info = None
        self.line_corrections = []
        # 与 `load_image()` 同样的理由（见那里的长注释）：新建项目必须清掉
        # 属于上一个项目的清理几何，否则它们会在新图/新项目里继续剔除墨迹，
        # 且因为 ROI 计数器归零后 id 重名（`roi_1`）而无法被 roi 过滤挡住。
        self.line_candidates = []
        self.exclusion_regions = []
        self.line_strokes = []
        self.selected_candidate_ids = set()
        self.taxa_names = []
        self.depth_grid = []
        self.samples = []
        self.age_depth_model = None
        self.age_depth_image = None
        self.age_depth_image_path = None
        self.ensemble_tables = {}
        self.chron_events = []
        self.undo_stack = []
        self.redo_stack = []
        self._init_rois()

        if clear_image:
            self.image = None
            self.image_path = None
            self.width = 0
            self.height = 0
            self.foreground_mask = None
            self.data_xlim = None
            self.data_ylim = None
            self.meta_info = {}

        return {"success": True, "status": "new_project_created"}

    # 当前程序能完整解释的工程包主版本上限。
    #
    # 写盘侧有两套版本号（`project_save` 的 manifest 写 2.0.0 / schema 2.0，
    # 而 straditize.json 正文写 3.0.0 / schema 3.0），载入侧真正解析的是
    # straditize.json 正文，所以以 **3** 为界。manifest 里的 2.0 只是归档
    # 元信息，不参与解析判定。
    SUPPORTED_SCHEMA_MAJOR = 3

    def _check_project_schema_version(self, project_data: dict[str, Any]) -> None:
        """工程包版本门禁：**只挡未来版本，绝不挡老包**。

        ## 为什么需要这道门（缺陷实测，不是假设）

        旧实现完全不读 version：v1.0.0 / v2.0.0 / 删掉 version / "banana" /
        v4.0.0 五种输入**全部放行**。前四种放行是对的（老包本来就没这些字段，
        且实测能正确载回），但 v4.0.0 放行是错的——将来 v4 真加了不兼容字段，
        用户拿到的是**被静默丢弃**的工程，字段丢了、语义错位，界面却完全正常。
        按不变量「取不到就报错停在原地」，这里必须显式拒绝。

        ## 放行策略（三档，逐档说明）

        1. **主版本高于上限 → 抛 JsonRpcError**，附可操作提示。不降级解析。
        2. **主版本不高于上限 → 放行**。v1 / v2 必须继续可用：已实测
           `output/han2026_ngamring/*.project.json`（v3.0.0）与 v2 变体都能
           正确载回列与标定。为了加门禁把老包挡死是反向破坏。
        3. **缺失或不可解析（"banana" 之类）→ 放行 + warning**。老包没版本号
           属正常；乱码版本号无法判断新旧，宁可放行也不要让用户打不开自己的
           工程。这两档都只记日志，不改变返回结构（前端契约零变更）。

        ## 调用点核查（加门禁前已确认，避免打断既有路径）

        `project_load` 的 .tar 分支与 .json 分支都在 :266/:270 **递归回本函数**，
        门禁放在递归之后、解析之前，所以两条路径共用同一道门。前端
        `project.load` 的调用方有三处：`ProjectManager.openProjectFile`（真工程包，
        带版本）、草稿恢复 `restoreDraft`（经 `draftToProjectPayload` 翻译，
        **显式写死 version/schema_version = 3.0.0/3.0**，见
        `frontend/src/core/ProjectManager.ts`）、以及测试直调 dict。
        三者都不会被这道门误伤。
        """
        raw_version = project_data.get("schema_version")
        source_key = "schema_version"
        if raw_version in (None, ""):
            raw_version = project_data.get("version")
            source_key = "version"

        if raw_version in (None, ""):
            logger.warning(
                "工程包未声明版本号（schema_version / version 均缺失），"
                "按当前规则解析；若该包来自更新版本，部分字段可能已丢失。"
            )
            return

        major = _parse_schema_major(raw_version)
        if major is None:
            logger.warning(
                "工程包版本号不可解析（%s=%r），按当前规则解析；"
                "无法判断其是否来自更新版本。",
                source_key,
                raw_version,
            )
            return

        if major > self.SUPPORTED_SCHEMA_MAJOR:
            raise JsonRpcError(
                INVALID_PARAMS,
                f"该工程包由更新版本保存（{source_key}={raw_version}，"
                f"本程序最高支持 {self.SUPPORTED_SCHEMA_MAJOR}.x）。"
                f"请升级软件后再打开——为避免静默丢失字段，本程序不会用旧规则"
                f"解析新版本工程包。",
            )

        if major < self.SUPPORTED_SCHEMA_MAJOR:
            logger.info(
                "载入旧版工程包（%s=%s，当前支持 %s.x），按兼容路径解析。",
                source_key,
                raw_version,
                self.SUPPORTED_SCHEMA_MAJOR,
            )

    def project_load(self, project_data: dict[str, Any] | str) -> dict[str, Any]:
        """Loads a project from a POSIX .tar archive, .json file, or dictionary."""
        if hasattr(self, "undo_stack") and self.undo_stack is not None:
            self.undo_stack.clear()
        if hasattr(self, "redo_stack") and self.redo_stack is not None:
            self.redo_stack.clear()

        if isinstance(project_data, str):
            return self.project_load(self._decode_project_file(project_data))

        self._check_project_schema_version(project_data)

        # 清理状态必须**先**初始化，再让 payload 覆盖。
        #
        # ## 缺这一行会怎样（用户实测，2026-11-09）
        #
        # `StraditizeSession.__init__` 不初始化清理状态（`_init_cleanup()` 只在
        # detect/upsert/apply 三个入口的兜底里被调），而本方法此前从头到尾也没调过它：
        # `_reset_loaded_state` 只清掩膜与 `cleanup_stats`，`_reset_line_removal` 只写
        # `degrid_*` 与 `line_corrections`。于是"全新会话直接打开工程包"（用户双击
        # 打开软件后的第一步）之后，`line_candidates` 由 `_restore_aux_fields` 从
        # payload 建出来了，`exclusion_regions` / `line_strokes` **根本不存在**。
        #
        # 下一步前端就会发 `algorithm.applyLineRemoval` 重算掩膜：它的入口兜底判的是
        # `line_candidates`（已存在 → 兜底不触发），于是直接撞上
        # `cleanup.py:652` 的 `self.exclusion_regions` → AttributeError，
        # 界面弹「载入项目后重算清理掩膜失败」。即使调用方省略 `exclusion_regions`，
        # `_recompose` 也会在 `_exclusion_mask`（cleanup.py:363）以同一异常失败。
        #
        # ## 为什么调 `_init_cleanup()` 而不是再手写一遍四项
        #
        # 这四个属性此前有两个手写副本（`project_new` 的 project.py:234-237、
        # `load_image` 的 core.py:449-451），本方法缺失 —— 再加第三份手写只会让
        # 下一个入口继续漏。`_init_cleanup()` 是这件事的**唯一**入口（含掩膜、
        # `cleanup_stats`、`cleanup_overlay_png`），也刻意不重置 `_candidate_seq`
        # （id 会跨会话查重，重用编号会让 id 冲突复活）。
        #
        # 注意：这里的初始化**不**负责恢复 payload 里的几何 —— 那是
        # `_restore_aux_fields` 的事，它的赋值发生在本行之后，不会被抹掉。
        self._init_cleanup()

        cal = (
            project_data.get("depth_calibration")
            or project_data.get("calibration")
            or {}
        )
        roi = project_data.get("roi") or {}

        self._reset_loaded_state(roi)
        self._reset_line_removal(project_data)
        self._apply_depth_calibration(cal)

        raw_cols = project_data.get("columns", [])
        self._reset_columns()
        primary_roi = self._restore_rois(project_data)
        # 载入期自检的收集器：只有在这里才拿得到"**包里的** tickEndX"（见
        # `_audit_restored_tick_end` 的说明：保存端比对自己的输出是循环论证）。
        # 告警在**下一次 project_save** 时出现在 manifest.json 里。
        self._load_axis_stroke_warnings = []
        self._restore_columns(raw_cols, primary_roi)
        self._restore_reader_types(raw_cols)
        self._restore_embedded_image(project_data)
        self._restore_aux_fields(project_data)
        self._restore_age_depth(project_data)

        return {
            "success": True,
            "columns_count": len(self.columns),
            "taxa": self.taxa_names,
            "is_calibrated": self.is_calibrated,
            "has_age_depth_image": getattr(self, "age_depth_image", None) is not None,
            "has_age_depth_model": self.age_depth_model is not None,
        }

    load_project = project_load

    # ---- project_load 的分段实现（调用顺序即载荷顺序，不可重排）----

    def _decode_project_file(self, project_data: str) -> dict[str, Any]:
        """把工程文件（.json / .tar）读成 payload 字典，tar 里的图顺手挂进会话。

        `.tar` 的 json 成员只写 `image.path`（图在 tar 的另一个成员里），所以解包这一步
        必须先把内嵌图挂到 `self.image` / `self.age_depth_image` 上，再由
        `_restore_embedded_image` 处理 payload 里的 base64。顺序反过来，那条
        "payload 无 base64 就保持当前底图" 的有意行为会把刚解出来的图弄没。
        """
        path = os.path.abspath(project_data)
        if not os.path.exists(path):
            raise JsonRpcError(FILE_NOT_FOUND_ERROR, f"Project file not found: {path}")

        if path.endswith(".tar") or tarfile.is_tarfile(path):
            with tarfile.open(path, "r") as tf:
                json_member = None
                img_member = None
                ad_img_member = None
                for m in tf.getmembers():
                    nl = m.name.lower()
                    if nl.endswith("straditize.json") or (
                        nl.endswith(".json")
                        and "manifest" not in nl
                        and "info" not in nl
                    ):
                        json_member = m
                    elif "age_depth" in nl and nl.endswith((".png", ".jpg", ".jpeg")):
                        ad_img_member = m
                    elif nl.endswith((".png", ".jpg", ".jpeg")):
                        img_member = m

                if not json_member:
                    raise JsonRpcError(
                        INVALID_PARAMS, "No straditize.json found in .tar archive."
                    )

                f_json = tf.extractfile(json_member)
                if not f_json:
                    raise JsonRpcError(
                        INVALID_PARAMS,
                        "Could not extract straditize.json from archive.",
                    )
                parsed = json.loads(f_json.read().decode("utf-8"))

                if img_member:
                    f_img = tf.extractfile(img_member)
                    if f_img:
                        img_bytes = f_img.read()
                        img_obj = Image.open(io.BytesIO(img_bytes))
                        img_obj.load()
                        self.image = img_obj
                        self.width, self.height = img_obj.size
                        self.format = img_obj.format or "PNG"
                        self.mode = img_obj.mode

                if ad_img_member:
                    f_ad = tf.extractfile(ad_img_member)
                    if f_ad:
                        ad_bytes = f_ad.read()
                        ad_obj = Image.open(io.BytesIO(ad_bytes))
                        ad_obj.load()
                        self.age_depth_image = ad_obj
                        self.age_depth_image_path = "archive://image/age_depth.png"

                return parsed
        else:
            with open(path, "r", encoding="utf-8") as f:
                parsed = json.load(f)
            return parsed

    def _reset_loaded_state(self, roi: dict[str, Any]) -> None:
        """按 payload 的 roi 重算 data 范围，并清掉上一份工程留下的标度/掩膜状态。"""
        self.data_xlim = None
        self.data_ylim = None
        if "w" in roi and "h" in roi:
            self.data_xlim = [
                float(roi.get("x", 0)),
                float(roi.get("x", 0)) + float(roi["w"]),
            ]
            self.data_ylim = [
                float(roi.get("y", 0)),
                float(roi.get("y", 0)) + float(roi["h"]),
            ]
        elif roi:
            if "x0" in roi and "x1" in roi:
                self.data_xlim = [float(roi["x0"]), float(roi["x1"])]
            if "y0" in roi and "y1" in roi:
                self.data_ylim = [float(roi["y0"]), float(roi["y1"])]

        self.is_calibrated = False
        self.y_scale = None
        self.depth_calib = None
        self.grid_line_mask = None
        self.candidate_line_mask = None
        self.degrid_line_mask = None
        self.exclusion_mask = None
        self.manual_restore_mask = None
        self.manual_erase_mask = None
        self.cleanup_stats = {}
        self.cleanup_overlay_png = None
        self.degrid_info = None

    def _reset_line_removal(self, project_data: dict[str, Any]) -> None:
        """恢复去线强度/竖线开关与笔迹，并把旧包缺 `mode` 的笔迹补成 erase。"""
        line_removal = project_data.get("line_removal") or {}
        self.degrid_strength = _canonical_degrid_strength(
            line_removal.get("strength"), origin="工程包"
        )
        self.degrid_remove_vertical = bool(line_removal.get("remove_vertical", True))
        corrections = line_removal.get("corrections") or []
        self.line_corrections = [
            # 旧工程（`mode` 字段出现之前的版本）里笔迹没有 mode，旧代码一律按 erase
            # 处理。载入时补同一个值，让旧包打开后的渲染与当初一致，也不会在第一次
            # 应用去线掩膜时被 `normalize_stroke_mode` 挡住（那条报错是留给"真写错了"
            # 的取值的，比如 "restroe"）。
            #
            # **只补 `mode` 这一个键**：其它缺失字段一律照旧留空——补了就等于替用户
            # 声称"数据本来就在"。新数据由 `rasterize_strokes` 校验后才写入，永不带缺键。
            c if "mode" in c else {**c, "mode": "erase"}
            for c in corrections
            if isinstance(c, dict)
        ]

    def _apply_depth_calibration(self, cal: dict[str, Any]) -> None:
        """payload 带完整标定端点时直接重算 y 轴标度，并**无条件**恢复 Y 轴语义。

        `primary_axis` 为什么要在这里显式赋值（P0-A）：`calibrate_axes` 的
        `primary_axis=None` 分支会沿用 `self.primary_axis`（`export.py:643-644`），
        所以"打开 A 包（age）再打开 B 包"会让 B 继承 A 的轴语义 —— 界面上完全看不出。
        老包没有该键时显式回到 `depth`，等价于"打开软件后直接开这个包"的行为。
        该赋值**不依赖是否标定**：只声明了轴语义、还没标定的工程同样要能恢复。
        """
        if unit := cal.get("unit"):
            self.depth_unit = str(unit)

        axis = str(cal.get("primary_axis") or "depth").strip().lower()
        if axis not in ("depth", "age"):
            axis = "depth"
        self.primary_axis = axis

        top_px, bottom_px = cal.get("top_px"), cal.get("bottom_px")
        top_val = cal.get("top_cm", cal.get("top_val"))
        bottom_val = cal.get("bottom_cm", cal.get("bottom_val"))
        if None not in (top_px, bottom_px, top_val, bottom_val) and float(
            bottom_px
        ) != float(top_px):
            self.calibrate_axes(
                y_marks=[
                    {"pixel": float(top_px), "val": float(top_val)},
                    {"pixel": float(bottom_px), "val": float(bottom_val)},
                ],
                unit=self.depth_unit,
                primary_axis=axis,
            )

    def _reset_columns(self) -> None:
        """清空列/控制点/物种名，准备按 payload 逐列重建。"""
        self.columns = []
        self.control_points = {}
        self.manual_points = {}
        self.taxa_names = []
        # `reader_types` 按 col_index 存，列一旦重建，旧索引指向的是别的列（P0-A）。
        # 不清它，老包（没有逐列读法）会把上一份工程的读法套到新工程的同号列上。
        self.reader_types = {}

    def _restore_rois(self, project_data: dict[str, Any]) -> dict[str, Any] | None:
        """恢复 ROI 列表（缺 x_groups 的补默认组），返回主 ROI。

        老包只有 `roi` 字典时按它 `roi_create` 出一个默认 ROI —— 这条分支是
        **唯一**给老工程包兜底的地方，删掉会让老包载入后没有 ROI。
        """
        self._init_rois()
        saved_rois = project_data.get("rois")
        if saved_rois and isinstance(saved_rois, list):
            self.rois = [dict(r) for r in saved_rois]
            self.primary_roi_id = project_data.get("primary_roi_id") or (
                self.rois[0]["id"] if self.rois else None
            )
            self.active_roi_id = (
                project_data.get("active_roi_id") or self.primary_roi_id
            )
            for r in self.rois:
                if not r.get("x_groups"):
                    def_grp = {
                        "id": f"{r['id']}_grp1",
                        "name": "默认组",
                        "unit": "%",
                        "plot_type": "area",
                        "scale_type": "linear",
                        "exaggeration_mult": None,
                        "tick_layout": [{"rel": 0.0}, {"rel": 1.0}],
                    }
                    r["x_groups"] = [def_grp]
                    r["default_group_id"] = def_grp["id"]
        else:
            roi_raw = project_data.get("roi")
            if roi_raw and isinstance(roi_raw, dict):
                rx0 = float(roi_raw.get("x", 0.0))
                ry0 = float(roi_raw.get("y", 0.0))
                rx1 = rx0 + float(roi_raw.get("w", 100.0))
                ry1 = ry0 + float(roi_raw.get("h", 100.0))
            else:
                rx0, ry0 = 0.0, 0.0
                rx1 = float(getattr(self, "width", 100.0) or 100.0)
                ry1 = float(getattr(self, "height", 100.0) or 100.0)
            created = self.roi_create(name="pollen", x0=rx0, x1=rx1, y0=ry0, y1=ry1)[
                "roi"
            ]
            self.primary_roi_id = created["id"]
            self.active_roi_id = created["id"]

        primary_roi = (
            self._get_roi(self.primary_roi_id)
            if self.primary_roi_id
            else (self.rois[0] if self.rois else None)
        )
        return primary_roi

    def _restore_columns(
        self,
        raw_cols: list[dict[str, Any]],
        primary_roi: dict[str, Any] | None,
    ) -> None:
        """逐列重建：缺 x_ticks 时从起点/刻度值推 x_values，需要时补 x 组。"""
        for idx, c in enumerate(raw_cols):
            name = c.get("species") or c.get("name") or f"Col {idx}"
            self.taxa_names.append(name)
            col_roi_id = c.get("roi_id") or (
                self.primary_roi_id if len(self.rois) <= 1 else None
            )
            if not col_roi_id and self.rois:
                col_roi_id = self.rois[0]["id"]

            target_roi = self._get_roi(col_roi_id) if col_roi_id else primary_roi

            x_group_id = c.get("x_group_id")
            x_values = c.get("x_values")
            x_ticks = c.get("x_ticks")

            if not x_group_id and target_roi:
                grp_id = f"{col_roi_id}_grp_{idx + 1}"
                c_start = float(c.get("startX", c.get("start", 0)))
                c_end = float(c.get("endX", c.get("end", c_start + 100)))
                c_span = max(1e-9, c_end - c_start)

                if x_ticks and len(x_ticks) >= 2:
                    val0 = float(x_ticks[0].get("value", 0))
                    val1 = float(x_ticks[1].get("value", 100))
                    px0 = float(x_ticks[0].get("px", c_start))
                    px1 = float(x_ticks[1].get("px", c_end))
                    rel0 = (px0 - c_start) / c_span
                    rel1 = (px1 - c_start) / c_span
                    x_values = [val0, val1]
                else:
                    rel0 = 0.0
                    rel1 = 1.0
                    if (
                        c.get("startValue") is not None
                        or c.get("tickValue") is not None
                    ):
                        x_values = [
                            float(c.get("startValue", 0)),
                            float(c.get("tickValue", 100)),
                        ]

                grp = {
                    "id": grp_id,
                    "name": f"{name}组",
                    "unit": c.get("unit", "%"),
                    "plot_type": c.get("plot_type") or c.get("plotType") or "area",
                    "scale_type": c.get("scale_type", "linear"),
                    "exaggeration_mult": c.get("exaggeration_mult"),
                    "tick_layout": [{"rel": rel0}, {"rel": rel1}],
                }
                target_roi.setdefault("x_groups", []).append(grp)
                x_group_id = grp_id

            col_dict = {
                "col_index": idx,
                "id": c.get("id") or f"{col_roi_id}_col{idx + 1:02d}",
                "name": name,
                "species": name,
                "roi_id": col_roi_id,
                "x_group_id": x_group_id,
                "x_values": x_values,
                "start": c.get("startX", c.get("start", 0)),
                "startX": c.get("startX", c.get("start", 0)),
                "end": c.get("endX", c.get("end", 100)),
                "endX": c.get("endX", c.get("end", 100)),
                "scale_type": c.get("scale_type", "linear"),
                "plot_type": c.get("plot_type") or c.get("plotType") or "area",
                "unit": c.get("unit", "%"),
                "exaggeration_mult": _payload_exaggeration(c),
                "x_ticks": x_ticks,
                "startValue": c.get("startValue", 0),
                "tickValue": c.get("tickValue", 100),
                "tickEndX": c.get("tickEndX", c.get("endX", 100)),
                # 列级轴粗覆盖（ARCHITECTURE §6.4）：**只放用户显式设的值**，
                # 没设过就是 None（= 回落组值）。
                #
                # 缺这一行会让"本列轴粗"一进包就丢：载入后 `resolve_axis_stroke`
                # 只能回落到组值，0 点随之平移（实测用户包 Pinus 列 4→6，2px），
                # 而整列读数按 value_per_px 系统性偏移（0.16129×2 = 0.3226），
                # 界面上看不出任何异常。老包没有这个键 → `.get` 得 None → 行为与今天一致。
                "axis_stroke_px": c.get("axis_stroke_px"),
            }
            store_exaggeration(col_dict, col_dict.get("exaggeration_mult"))
            self.columns.append(col_dict)
            self._audit_restored_tick_end(col_dict)

            pts = c.get("points") or c.get("controlPoints") or []
            ctrls: dict[int, float] = {}
            manual: dict[int, dict[str, Any]] = {}
            for p in pts:
                y_val = round(p.get("y", 0))
                x_val = float(p.get("x", 0))
                ctrls[y_val] = x_val
                # 老包没有 `isManual` 这个键 → `.get` 得 None → 按 false 处理，
                # 行为与今天（"所有点都是算法的"）一致；只有显式 true 才记成手工。
                if p.get("isManual"):
                    manual[y_val] = {
                        "x": x_val,
                        "kind": str(p.get("kind") or "manual"),
                    }
            self.control_points[idx] = ctrls
            if not isinstance(getattr(self, "manual_points", None), dict):
                self.manual_points = {}
            if manual:
                self.manual_points[idx] = manual
            else:
                self.manual_points.pop(idx, None)

    def _audit_restored_tick_end(self, col_dict: dict[str, Any]) -> None:
        """载入期自检：包里的 `tickEndX` 与**该列实际生效的**轴粗是否自洽（Triage 建议）。

        ## 为什么这条检查放在**载入**而不是保存

        保存端写出去的 `tickEndX` 就是 `scale.abs_px1`（由轴粗算出来的），拿它再和
        `start + 轴粗 + 1` 比是**循环论证**，永远相等，红不了。只有"包里的
        `tickEndX`"这个来自文件的值，才可能和当前解析出的轴粗矛盾。

        ## 为什么用"生效轴粗"而不是"列级覆盖"

        用户那份包的形状恰恰是**列级覆盖已经丢了**（所以包里的 `tickEndX=264`
        与组值 6 推出的 266 差 2px）。若要求"列级覆盖存在"才检查，就正好漏掉它。

        ## 为什么只在 `source == "group_slope"` 时比较

        只有这条分支的 `abs_px1` 是**由轴粗推出来的**（`start + 轴粗 + 1`）。
        列带两齿 `x_ticks` 时 `abs_px1` 是第二个齿的像素；由 `x_values` 组布局时
        又是另一套算法——拿它们去和"轴粗 + 1"比是无意义的比较，会把正常工程
        全部刷成告警（首次实测：golden 用例里带 `x_ticks` 的列立刻误报，
        `tickEndX=60` 与 `start+5+1=16` 被当成矛盾）。

        ## 为什么不会给新工程刷一屏告警

        `detect_columns` 会写一个**占位** `tickEndX`（`core.py:1133/1157` 的
        `start + init_tick_w`，与轴粗无关），但那个值**不经过本函数**——本函数只在
        `_restore_columns` 里被调，也就是只检查"从包里读出来的 `tickEndX`"。
        新建/分列路径不会走进来，因此不存在"每个新工程 28 条告警"的噪音。

        不抛错：用户此刻可能正需要这个包，阻断导出只会让人更没法取证。
        """
        if not hasattr(self, "_load_axis_stroke_warnings"):
            return
        tick_end = col_dict.get("tickEndX")
        if tick_end is None:
            return
        try:
            scale = resolve_column_scale(self, col_dict, col_dict.get("col_index"))
        except Exception:  # noqa: BLE001 - 自检绝不能因解析失败而改变载入结果
            return
        if scale.source != "group_slope":
            return
        expected = float(scale.abs_px1)
        start = float(col_dict.get("startX", col_dict.get("start", 0.0)) or 0.0)
        try:
            actual = float(tick_end)
        except (TypeError, ValueError):
            return
        if abs(actual - expected) > 1e-6:
            self._load_axis_stroke_warnings.append(
                {
                    "kind": "axis_stroke_tick_end_mismatch",
                    "col_index": col_dict.get("col_index"),
                    "column_id": col_dict.get("id"),
                    "column_name": col_dict.get("name") or col_dict.get("species"),
                    "column_axis_stroke_px": col_dict.get("axis_stroke_px"),
                    "effective_axis_stroke_px": round(expected - start - 1.0, 6),
                    "startX": start,
                    "tickEndX_in_package": actual,
                    "tickEndX_expected": expected,
                    "offset_px": round(actual - expected, 6),
                    "note": (
                        "工程包里的 tickEndX 与该列当前生效的轴粗对不上：0 点可能已整体平移，"
                        "整列读数会按 value_per_px 系统性偏移。请核对这一列的轴粗与刻度后再导出。"
                    ),
                }
            )

    def _restore_reader_types(self, raw_cols: list[dict[str, Any]]) -> None:
        """逐列读法（P0-A）：包的每列对象带 `reader_type`。

        `reader_types` 在后端是 `dict[col_index, str]`（`session.py:118`），列对象上
        则是一个标量；两端用 **col_index** 对齐——`_restore_columns` 的 `idx` 就是
        包里的列序，与 `col_index` 一致。

        只写非空值：`None` 表示"这一列没被用户单独设过"，不该在 `reader_types` 里
        留一个空串键（那会让"有没有设过"无从判断）。
        """
        self.reader_types = {}
        for idx, raw in enumerate(raw_cols or []):
            if not isinstance(raw, dict):
                continue
            reader_type = raw.get("reader_type")
            if reader_type:
                self.reader_types[int(idx)] = str(reader_type)

    def _restore_embedded_image(self, project_data: dict[str, Any]) -> None:
        """payload 自带 base64 时无条件替换底图，并作废由旧像素算出来的状态。"""
        img_meta = project_data.get("image") or {}
        # 自带底图的 .json 工程包必须**无条件**换掉当前底图（C1d）。
        #
        # 旧实现这里还有 `and getattr(self, "image", None) is None`，于是
        # "会话里已经有图"时整段被跳过：列 / 标定 / ROI 全换成包里的，底图却
        # 还是上一张，之后所有读数都基于错图像素，而界面看起来完全正常
        # （实测：会话 900x700 + 包 400x300 → 载入后仍是 900x700）。
        #
        # 那个守卫的**原始意图**（git 追到 af7ce98 的注释 "Restore embedded
        # images (if loading from self-contained .json)"）是"从自包含 .json 里
        # 恢复内嵌图"，说的是"没有图时才需要从包里恢复"，不是"要保护用户当前
        # 的图"，也没有任何调用点依赖这个保护。所以正确语义是：
        #   - payload **确实带** base64  → 无条件替换（包里的图才是工程的一部分）；
        #   - payload **不带** base64    → 保持当前底图不动（不是清空）。
        # 后者是有意行为：`.tar` 的 json 成员只写 `image.path`（图在 tar 里的
        # 另一个成员中，由 `project_load` 的 tar 分支先解出来），此时无 base64
        # 属正常，绝不能把刚解出来的图弄没。
        #
        # 位置说明（已实测，不是推断）：这段在 rois / columns 的读取**之后**。
        # payload 的 ROI（实测 roi_1 xlim=[20,380]）与列（4 列）在设图后原样保留，
        # 因为下面只清"由像素算出来"的状态，不碰 rois / columns / x_ticks。
        # 反过来把设图提到读取之前会要求重跑 `_init_rois()`，那才会冲掉包里的 ROI。
        if isinstance(img_meta, dict) and img_meta.get("base64"):
            raw_b64 = img_meta["base64"]
            if "," in raw_b64:
                raw_b64 = raw_b64.split(",", 1)[1]
            img_obj = Image.open(io.BytesIO(base64.b64decode(raw_b64)))
            img_obj.load()
            self.image = img_obj
            # 尺寸以**真实解码结果**为准：payload 里的 width/height 是保存时写下的
            # 数字，可能与实际图不符（例如保存后被外部工具改过），信它就会让
            # ROI / 列坐标整体错位。
            self.width, self.height = img_obj.size
            self.format = img_obj.format or "PNG"
            self.mode = img_obj.mode
            # 换底图后，所有"由上一张图的像素算出来"的状态都必须失效，否则它们
            # 以旧图尺寸参与新图计算：旧 `foreground_mask` (700,900) 与新图
            # (300,400) 尺寸不符会在布尔运算里直接报错或被静默裁剪；
            # 旧 `shadow_mask` / `solid_layers` 会把上一张图的像素计数报给用户；
            # 旧 `image_array` 会被 `extract_foreground` 当作新图的像素源。
            # 这些**不**由下面的 rois/columns 读取覆盖，必须在这里清。
            self.image_array = None
            self.foreground_mask = None
            self.threshold = None
            self.segmentation_mode = None
            self.shadow_mask = None
            self.solid_layers = None
            self.foreground_column_edges = None
            self.tick_band = None

    def _restore_aux_fields(self, project_data: dict[str, Any]) -> None:
        """回填论文元数据、样本、候选线（含 status 兼容视图）、集合表。"""
        if project_data.get("paper_metadata"):
            self.metadata_update(project_data["paper_metadata"])
        if project_data.get("samples") is not None:
            self.samples = list(project_data["samples"])
        # 取样深度网格（P0-A）。**键缺失时显式清空**，不是"保持原值"：
        # `_reset_loaded_state` 不清它，若这里不动，载入一份没有网格的老包会继承
        # 上一份工程的网格（跨包串值），而交付数据的行集会因此错位。
        depth_grid = project_data.get("depth_grid")
        self.depth_grid = (
            [float(d) for d in depth_grid] if isinstance(depth_grid, list) else []
        )
        if project_data.get("line_candidates") is not None:
            self.line_candidates = list(project_data["line_candidates"])
        # 排除区与笔迹（P0-B）。键缺失时**显式清空**（`_init_cleanup` 已置空，
        # 这里再写一次是为了让"老包 ⇒ 空"成为这条代码路径本身的性质，
        # 而不是依赖调用顺序）。载入时必须 `dict(...)` 拷贝：包里的 dict 一旦被
        # 活状态原地改写，重新保存时就会把改动写回同一份载荷。
        exclusion_regions = project_data.get("exclusion_regions")
        self.exclusion_regions = (
            [dict(e) for e in exclusion_regions if isinstance(e, dict)]
            if isinstance(exclusion_regions, list)
            else []
        )
        line_strokes = project_data.get("line_strokes")
        self.line_strokes = (
            [dict(s) for s in line_strokes if isinstance(s, dict)]
            if isinstance(line_strokes, list)
            else []
        )
        if project_data.get("selected_candidate_ids") is not None:
            self.selected_candidate_ids = set(project_data["selected_candidate_ids"])
        if project_data.get("ensemble_tables") is not None:
            self.ensemble_tables = list(project_data["ensemble_tables"])

    def _restore_age_depth(self, project_data: dict[str, Any]) -> None:
        """恢复年代-深度底图、标定状态与模型（含像素点轨迹）。"""
        ad_data = project_data.get("age_depth")
        ad_data = project_data.get("age_depth")
        if isinstance(ad_data, dict):
            if (
                ad_data.get("image_base64")
                and getattr(self, "age_depth_image", None) is None
            ):
                ad_b64 = ad_data["image_base64"]
                if "," in ad_b64:
                    ad_b64 = ad_b64.split(",", 1)[1]
                ad_obj = Image.open(io.BytesIO(base64.b64decode(ad_b64)))
                ad_obj.load()
                self.age_depth_image = ad_obj
                self.age_depth_image_path = "archive://image/age_depth.png"
            if ad_data.get("calib_state"):
                self.age_depth_calib_state = dict(ad_data["calib_state"])
            insp = ad_data.get("inspection")
            if isinstance(insp, dict) and insp.get("depths") and insp.get("ages"):
                meta = insp.get("metadata") or {}
                model = AgeDepthModel(
                    depths=insp["depths"],
                    ages=insp["ages"],
                    age_min=insp.get("age_min"),
                    age_max=insp.get("age_max"),
                    curve_type=meta.get("curve_type", "median"),
                    envelope_type=meta.get("envelope_type", "95_hpd"),
                    depth_unit=meta.get("depth_unit", "cm"),
                    age_unit=meta.get("age_unit", "cal BP"),
                    cal_curve=meta.get("calibration_curve", "IntCal20"),
                    notes=meta.get("notes", ""),
                )
                px_pts = insp.get("px_points")
                if isinstance(px_pts, dict):
                    model.px_y = np.asarray(px_pts.get("y", []), dtype=float)
                    model.px_x_curve = np.asarray(
                        px_pts.get("x_curve", []), dtype=float
                    )
                    model.px_x_min = np.asarray(px_pts.get("x_min", []), dtype=float)
                    model.px_x_max = np.asarray(px_pts.get("x_max", []), dtype=float)
                self.age_depth_model = model

    def project_save(
        self,
        output_path: str | None = None,
        format: str = "tar",
    ) -> dict[str, Any]:
        """Saves project to POSIX UStar .tar archive or JSON per Section 八."""
        manifest = {
            "version": "2.0.0",
            "tool": "straditize pro",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "schema_version": "2.0",
        }
        # 载入期自检（`_audit_restored_tick_end`）发现的矛盾随本次保存落到
        # manifest.json。**只在非空时加键**：一致时不改变工程包结构，
        # 也让"有没有告警"成为一个可判定的信号（键存在 ⇔ 确实有问题）。
        load_warnings = list(getattr(self, "_load_axis_stroke_warnings", []) or [])
        if load_warnings:
            manifest["warnings"] = load_warnings

        calib = self._build_depth_calibration_export()
        roi = self._build_roi_export()
        columns = getattr(self, "columns", [])
        taxa_names = getattr(self, "taxa_names", [])
        cols_export = self._build_columns_export(columns, taxa_names)
        ad_export = self._build_age_depth_export()
        project_json = self._build_project_json(calib, roi, cols_export, ad_export)

        if format.lower() == "json":
            return self._save_project_json(project_json, ad_export, output_path)

        tar_bytes, csv_reason = self._build_project_tar(project_json, manifest, columns)
        placeholder = {
            "data_csv_placeholder": csv_reason is not None,
            "data_csv_placeholder_reason": csv_reason,
        }
        if output_path:
            with open(output_path, "wb") as f:
                f.write(tar_bytes)
            return {
                "path": output_path,
                "size": len(tar_bytes),
                "success": True,
                **placeholder,
            }

        return {
            "tar_base64": base64.b64encode(tar_bytes).decode("ascii"),
            "size": len(tar_bytes),
            "success": True,
            **placeholder,
        }

    save_project = project_save

    # ---- project_save 的分段实现（顺序即工程格式的组装顺序）----

    def _build_depth_calibration_export(self) -> dict[str, Any]:
        """标定段：有 depth_calib 就写完整端点，否则只写 is_calibrated=False + 单位。

        `primary_axis` **两个分支都写**（P0-A）：它声明 Y 轴测的是深度还是年代，
        与"有没有标定端点"无关；只写标定分支会让"声明了 age 但还没标定"的工程
        在重开后静默变回 depth。老包没有该键 ⇒ 载入端按 `depth` 处理。
        """
        axis = str(getattr(self, "primary_axis", "depth") or "depth")
        if getattr(self, "depth_calib", None):
            calib = {
                "is_calibrated": True,
                "top_px": self.depth_calib["top_px"],
                "bottom_px": self.depth_calib["bottom_px"],
                "top_cm": self.depth_calib["top_cm"],
                "bottom_cm": self.depth_calib["bottom_cm"],
                "unit": self.depth_calib.get("unit") or self.depth_unit,
                "primary_axis": axis,
            }
        else:
            calib = {
                "is_calibrated": False,
                "unit": getattr(self, "depth_unit", "cm"),
                "primary_axis": axis,
            }
        return calib

    def _build_roi_export(self) -> dict[str, Any] | None:
        """旧字段 roi：由 data_xlim / data_ylim 折成 x/y/w/h（无 bounds 时为 None）。"""
        roi = (
            {
                "x": self.data_xlim[0],
                "y": self.data_ylim[0],
                "w": self.data_xlim[1] - self.data_xlim[0],
                "h": self.data_ylim[1] - self.data_ylim[0],
            }
            if getattr(self, "data_xlim", None) and getattr(self, "data_ylim", None)
            else None
        )
        return roi

    def _build_columns_export(
        self,
        columns: list[dict[str, Any]],
        taxa_names: list[str],
    ) -> list[dict[str, Any]]:
        """列段：名字/标度/控制点/刻度一起写全（含 legacy startX/endX 兼容字段）。"""
        cols_export = []
        reader_types = getattr(self, "reader_types", {}) or {}
        for idx, col in enumerate(columns):
            c_idx = col.get("col_index", idx)
            name = (
                col.get("species")
                or col.get("name")
                or (taxa_names[c_idx] if c_idx < len(taxa_names) else f"Col {c_idx}")
            )
            ctrls = getattr(self, "control_points", {}).get(c_idx, {})
            # 控制点是"谁给的"必须落盘：只写坐标的话，重开工程包后用户手工补/改的
            # 点全变成算法点，页脚「锚点: N 手动 / M 总计」归零，后续重分列/重提取
            # 会把这些点当自动结果重算掉（用户手工劳动静默丢失，2026-11-10）。
            manual_store = getattr(self, "manual_points", None) or {}
            manual = manual_store.get(c_idx, {}) if isinstance(manual_store, dict) else {}
            pts = []
            for y_r, x_c in ctrls.items():
                rec = manual.get(int(y_r)) or manual.get(y_r) or {}
                pts.append(
                    {
                        "x": round(x_c, 2),
                        "y": y_r,
                        "value": round(x_c, 2),
                        "kind": str(rec.get("kind") or "peak"),
                        "valid_segment": True,
                        "isManual": bool(rec),
                    }
                )
            pts.sort(key=lambda p: p["y"])
            scale = resolve_column_scale(self, col, c_idx)
            cols_export.append(
                {
                    "id": col.get("id") or f"col_{c_idx}",
                    "col_index": c_idx,
                    "species": name,
                    "name": name,
                    "roi_id": col.get("roi_id"),
                    "x_group_id": col.get("x_group_id"),
                    "x_values": col.get("x_values"),
                    "x_ticks": col.get("x_ticks"),
                    "color": col.get("color", "#38bdf8"),
                    "visible": col.get("visible", True),
                    "scale_type": scale.scale_type,
                    "plot_type": scale.plot_type,
                    "unit": scale.unit,
                    "exaggeration_mult": scale.exaggeration_mult,
                    "startX": col.get("startX", col.get("start", 0)),
                    "start": col.get("start", 0),
                    "endX": col.get("endX", col.get("end", 100)),
                    "end": col.get("end", 100),
                    "startValue": scale.val0,
                    "tickValue": scale.val1,
                    # 列级轴粗覆盖必须进包，否则载入后退化到组值（U-ROWS-02）。
                    # 写 `col.get(...)` 而不是 `scale` 里那个有效值：这里是**覆盖**，
                    # 不是"最终生效值"——把有效值写进列级键会让"清除覆盖"失效
                    # （下次载入又会把组值当成本列覆盖，从此再也回不到组值）。
                    "axis_stroke_px": col.get("axis_stroke_px"),
                    # 逐列读法（P0-A）：area / line / bar。从 `self.reader_types` 取，
                    # 不从列对象取——那是会话级按 col_index 存的映射，列对象上没有这个键。
                    "reader_type": reader_types.get(c_idx),
                    "tickEndX": scale.abs_px1,
                    "points": pts,
                }
            )
        return cols_export

    def _build_age_depth_export(self) -> dict[str, Any] | None:
        """年代-深度段：底图尺寸 + 标定状态 + 模型 inspection（两者都没有时为 None）。"""
        ad_export: dict[str, Any] | None = None
        if (
            getattr(self, "age_depth_image", None) is not None
            or getattr(self, "age_depth_model", None) is not None
        ):
            ad_export = {
                "image_path": "image/age_depth.png"
                if getattr(self, "age_depth_image", None) is not None
                else None,
                "width": self.age_depth_image.width
                if getattr(self, "age_depth_image", None) is not None
                else 0,
                "height": self.age_depth_image.height
                if getattr(self, "age_depth_image", None) is not None
                else 0,
                "calib_state": getattr(self, "age_depth_calib_state", None),
                "inspection": (
                    self.age_depth_model.to_inspection_data()
                    if getattr(self, "age_depth_model", None) is not None
                    else None
                ),
            }
        return ad_export

    def _build_project_json(
        self,
        calib: dict[str, Any],
        roi: dict[str, Any] | None,
        cols_export: list[dict[str, Any]],
        ad_export: dict[str, Any] | None,
    ) -> dict[str, Any]:
        """把各段拼成一份 project.json（键集即工程格式契约）。"""
        project_json: dict[str, Any] = {
            "version": "3.0.0",
            "schema_version": "3.0",
            "image": {
                "path": "image/original.png",
                "width": getattr(self, "width", 0),
                "height": getattr(self, "height", 0),
            },
            "depth_calibration": calib,
            "roi": roi,
            "rois": getattr(self, "rois", []),
            "primary_roi_id": getattr(self, "primary_roi_id", None),
            "active_roi_id": getattr(self, "active_roi_id", None),
            "line_removal": {
                "strength": _canonical_degrid_strength(
                    getattr(self, "degrid_strength", None), origin="会话"
                ),
                "remove_vertical": getattr(self, "degrid_remove_vertical", True),
                "corrections": getattr(self, "line_corrections", []),
            },
            "line_candidates": getattr(self, "line_candidates", []),
            # 排除区与笔迹（P0-B）：都是**用户手工划的**，丢了必须重划，且会改变掩膜
            # ⇒ 整列读数随之变化，而界面上"排除区(0 个)"看起来像"我本来就没划"。
            # 只 `dict(...)` 浅拷贝：它们的值都是标量/列表，浅拷贝足以断开与活状态的
            # 容器共享（与 `_build_columns_export` 对 points 的处理同一理由）。
            "exclusion_regions": [
                dict(e) for e in (getattr(self, "exclusion_regions", []) or [])
            ],
            "line_strokes": [
                dict(s) for s in (getattr(self, "line_strokes", []) or [])
            ],
            "selected_candidate_ids": sorted(
                getattr(self, "selected_candidate_ids", set()) or set()
            ),
            "samples": getattr(self, "samples", []),
            # 取样深度网格（P0-A）：它是**输入参数**而不是结果——用户指定在哪些深度
            # 出数，直接决定交付数据的行集。逐项 float 化，避免 numpy 标量进 JSON。
            "depth_grid": [
                float(d) for d in (getattr(self, "depth_grid", []) or [])
            ],
            "paper_metadata": getattr(self, "paper_metadata", {}),
            "age_depth": ad_export,
            "ensemble_tables": getattr(self, "ensemble_tables", []),
            "columns": cols_export,
        }
        return project_json

    def _save_project_json(
        self,
        project_json: dict[str, Any],
        ad_export: dict[str, Any] | None,
        output_path: str | None,
    ) -> dict[str, Any]:
        """json 分支：带路径时把底图/年代-深度图内嵌成 base64 再落盘。"""
        if output_path:
            if getattr(self, "image", None) is not None:
                ib = io.BytesIO()
                self.image.save(ib, format="PNG")
                project_json["image"]["base64"] = base64.b64encode(
                    ib.getvalue()
                ).decode("ascii")
            if (
                ad_export is not None
                and getattr(self, "age_depth_image", None) is not None
            ):
                ab = io.BytesIO()
                self.age_depth_image.save(ab, format="PNG")
                ad_export["image_base64"] = base64.b64encode(ab.getvalue()).decode(
                    "ascii"
                )
        json_str = json.dumps(project_json, indent=2, ensure_ascii=False)
        if output_path:
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(json_str)
            return {"path": output_path, "success": True}
        return {"data": project_json, "success": True}

    def _export_csv_or_placeholder(
        self, columns: list[dict[str, Any]]
    ) -> tuple[bytes, str | None]:
        """出 data.csv：先走真实数字化，失败才退占位表（首列 depth，未观测列填 0.00）。

        占位表是保底不报错的老行为：真实导出失败时若抛错，用户拿不到整个 tar。
        但它**绝不静默**——第二个返回值就是失败原因，调用方必须三处落痕：
        manifest.json 的 data_csv_placeholder 字段、tar 里的 data.csv.PLACEHOLDER.md、
        以及 project_save 的返回值（前端据此提示）。全 0 的矩阵长得像合法数据，只靠
        README 里那句「unobserved = 0.0」根本分辨不出来。
        """
        try:
            if not getattr(self, "column_points", None) and columns:
                for col in columns:
                    self.digitize(col["col_index"])
            res = self.export_data("csv")
            csv_str = (
                (res.get("csv") or res.get("csv_content") or "")
                if isinstance(res, dict)
                else str(res)
            )
            if not csv_str.strip():
                raise ValueError("导出结果为空字符串")
            return csv_str.encode("utf-8"), None
        except (ValueError, KeyError, RuntimeError, JsonRpcError) as exc:
            reason = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
            headers = ["depth"] + [
                c.get("species") or c.get("name") or f"col_{idx}"
                for idx, c in enumerate(columns)
            ]
            lines = [",".join(headers)]
            depth_vals = getattr(self, "depth_grid", None) or [
                0.0,
                50.0,
                100.0,
                150.0,
            ]
            for d in depth_vals:
                lines.append(",".join([str(round(d, 2))] + ["0.00"] * len(columns)))
            return "\n".join(lines).encode("utf-8"), reason

    def _csv_placeholder_notice(self, reason: str) -> bytes:
        """占位表的显式说明（写进 tar，紧跟 data.csv）。人打开包第一眼就该看到它。"""
        text = (
            "# data.csv 是占位表，不是真实读数\n\n"
            "本次打包时真实导出失败，data.csv 里**每一个数值都是 0.00**。"
            "它们既不表示「未观测」，也不表示「观测到 0」，只是占位符。\n\n"
            f"- 失败原因：{reason}\n"
            "- 机器可读标记：manifest.json 的 data_csv_placeholder 字段\n"
            "- 怎么办：回到步骤 8 重新取数（确认每列都已数字化），再重新导出工程包。\n\n"
            "README.txt 里的 SCIENTIFIC NOTICE 描述的是**正常导出**"
            "的约定，不要用它解释本文件旁边的 data.csv。\n"
        )
        return text.encode("utf-8")

    def _build_project_tar(
        self,
        project_json: dict[str, Any],
        manifest: dict[str, Any],
        columns: list[dict[str, Any]],
    ) -> tuple[bytes, str | None]:
        """tar 分支：manifest / straditize.json / 两张图 / data.csv / plot_strat.R / README。

        返回 (tar 字节, 占位表原因|None)。占位表出现时额外写 data.csv.PLACEHOLDER.md，
        并在 manifest 里留机器可读字段——两条通道分别服务人读与程序读。
        """
        csv_data, csv_reason = self._export_csv_or_placeholder(columns)
        manifest = dict(manifest)
        if csv_reason:
            manifest["data_csv_placeholder"] = {
                "reason": csv_reason,
                "notice": "data.csv.PLACEHOLDER.md",
                "zeros_are_not_measurements": True,
            }
        tar_bio = io.BytesIO()
        with tarfile.open(fileobj=tar_bio, mode="w") as tf:
            # 1. manifest.json
            m_bytes = json.dumps(manifest, indent=2).encode("utf-8")
            ti_m = tarfile.TarInfo(name="manifest.json")
            ti_m.size = len(m_bytes)
            ti_m.mtime = int(time.time())
            tf.addfile(ti_m, io.BytesIO(m_bytes))

            # 2. straditize.json
            sj_bytes = json.dumps(project_json, indent=2, ensure_ascii=False).encode(
                "utf-8"
            )
            ti_sj = tarfile.TarInfo(name="straditize.json")
            ti_sj.size = len(sj_bytes)
            ti_sj.mtime = int(time.time())
            tf.addfile(ti_sj, io.BytesIO(sj_bytes))

            # 3. image/original.png
            if getattr(self, "image", None) is not None:
                img_bio = io.BytesIO()
                self.image.save(img_bio, format="PNG")
                img_data = img_bio.getvalue()
                ti_img = tarfile.TarInfo(name="image/original.png")
                ti_img.size = len(img_data)
                ti_img.mtime = int(time.time())
                tf.addfile(ti_img, io.BytesIO(img_data))

            # 3b. image/age_depth.png
            if getattr(self, "age_depth_image", None) is not None:
                ad_bio = io.BytesIO()
                self.age_depth_image.save(ad_bio, format="PNG")
                ad_data = ad_bio.getvalue()
                ti_ad = tarfile.TarInfo(name="image/age_depth.png")
                ti_ad.size = len(ad_data)
                ti_ad.mtime = int(time.time())
                tf.addfile(ti_ad, io.BytesIO(ad_data))

            # 4. data.csv（若退化成占位表，紧跟着写一份显式说明）
            ti_csv = tarfile.TarInfo(name="data.csv")
            ti_csv.size = len(csv_data)
            ti_csv.mtime = int(time.time())
            tf.addfile(ti_csv, io.BytesIO(csv_data))

            if csv_reason:
                notice = self._csv_placeholder_notice(csv_reason)
                ti_notice = tarfile.TarInfo(name="data.csv.PLACEHOLDER.md")
                ti_notice.size = len(notice)
                ti_notice.mtime = int(time.time())
                tf.addfile(ti_notice, io.BytesIO(notice))

            # 5. plot_strat.R
            r_script = (
                b"# Straditize Pro - Geological Stratigraphic Pollen Diagram Plotting Script\n"
                b"# Generated automatically by Straditize v2.0 (straditize pro)\n"
                b"if (!requireNamespace('rioja', quietly=TRUE)) install.packages('rioja')\n"
                b"library(rioja)\n"
                b"df <- read.csv('data.csv', check.names=FALSE)\n"
                b"strat.plot(df[-1], yvar=df[[1]], y.rev=TRUE, scale.percent=TRUE, plot.line=TRUE, title='Stratigraphic Pollen Diagram (Straditize Pro)')\n"
            )
            ti_r = tarfile.TarInfo(name="plot_strat.R")
            ti_r.size = len(r_script)
            ti_r.mtime = int(time.time())
            tf.addfile(ti_r, io.BytesIO(r_script))

            # 6. README.txt
            readme = (
                b"Straditize Pro - Stratigraphic Project Archive (POSIX UStar .tar)\n"
                b"================================================================\n\n"
                b"Hierarchy:\n"
                b"manifest.json      - Version and metadata\n"
                b"image/original.png - Original stratigraphic diagram\n"
                b"straditize.json    - Full vector model\n"
                b"data.csv           - Calibrated matrix (Depth in 1st col, unobserved = 0.0)\n"
                b"plot_strat.R       - rioja::strat.plot plotting template\n"
                b"README.txt         - Documentation\n\n"
                + CSV_MISSING_NOTICE
            )
            ti_readme = tarfile.TarInfo(name="README.txt")
            ti_readme.size = len(readme)
            ti_readme.mtime = int(time.time())
            tf.addfile(ti_readme, io.BytesIO(readme))
        return tar_bio.getvalue(), csv_reason


ProjectMixin = ProjectSessionMixin
