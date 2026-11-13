# 工程包状态盘点：用户劳动 vs 派生缓存（2026-11-10）

> **只读审计**。未修改源码、测试、夹具；未跑 pytest（本机全量 ~40 min，且工作区另有会话在改
> `isManual`）；未做 git 写操作。
>
> ## 快照口径（重要）
>
> - **快照时间**：2026-11-10 13:12（Asia/Shanghai）。
> - **工作区是脏的**，以下文件有**未提交改动**（`git status --porcelain` 实测，节选与本次相关的）：
>   `straditize_core/session_parts/project.py`、`session_parts/core.py`、`session_parts/digitize.py`、
>   `rpc_methods/system.py`、`tests/unit/fixtures/project_save_golden.json`；
>   未跟踪新件：`tests/unit/test_project_axis_stroke_roundtrip.py`、
>   `tests/unit/test_project_load_cleanup_state.py`、`tests/unit/test_project_manual_points.py`、
>   `frontend/e2e/project-roundtrip.spec.ts`、`frontend/e2e/project-reload-calibration.spec.ts`。
> - ⇒ **本文件描述的是"当前工作区"的行为，不是 git HEAD 的行为。** 点名处的"已修/正在修"
>   一律指工作区已含该行。
> - 证据等级标注：**［码］**=已读码确认（读到该行）；**［测］**=已实测（读到测试断言/注释中的实测记录）；
>   **［推］**=推断（未追到重算调用点或未核实写入口）。

---

## 0 结论先行

工程包 `straditize.json` 的顶层键集只有 16 个（`project.py:1096-1125`）：
`version / schema_version / image / depth_calibration / roi / rois / primary_roi_id /
active_roi_id / line_removal / line_candidates / selected_candidate_ids / samples /
paper_metadata / age_depth / ensemble_tables / columns`。

session 上实际有 **73 个 `self.*` 赋值目标**（`ast` 统计，见 §1 表头）。其中被判为
**用户劳动**的有 **24 项**，而**没有进包的有 7 项**（`primary_axis`、`depth_grid`、
`exclusion_regions`、`line_strokes`、`reader_types`、`age_depth_is_calendar_year`、
`age_depth_rate_columns`），另有 1 项（`extraction_mode`）属用户选择但未进包。

**病因与 Lead 的判断一致：不是四个 bug，是"包只保存了一部分状态且没有防漏机制"。**
唯一的现成防漏装置是 `tests/unit/test_project_load_golden.py:52-118` 的三张字段清单
（`STATE_FIELDS` / `PIXEL_DERIVED` / `COLUMN_KEYS` / `ROI_KEYS` / `GROUP_KEYS`），
而它本身就是漏的（见 §4.1）。

---

## 1 状态登记表（字段级）

统计口径：`ast` 解析 `session.py` + `session_parts/*.py`，取 `Assign` / `AnnAssign` / `AugAssign`
里 `self.<name>` 目标 ⇒ **73 个唯一属性**。下表按语义分组，逐项判定。

> 判定规则：
> - **劳动**＝丢了必须重做；**派生**＝能重算（必须写清由谁在何时重算）；**缓存/临时**＝进程内优化。
> - "保存到包"列给出键名 + `file:line`；"—"＝不进包。

### 1.1 底图与图像派生

| 属性 | 属于什么 | 保存到包（键 + 行） | 载入恢复（行） | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `image_path` | 图像身份 | `image.path` `project.py:1099-1103` | `_restore_embedded_image:801`、tar 分支 `:1250` | 否 | ［码］ |
| `_image`（`image` property） | 同 | tar 成员 `image/original.png`、json 内嵌 base64 `:1128-1157` | `:871-881`（年代图同构） | 否 | ［码］ |
| `width` / `height` | 派生（PIL） | `image.width/height` `:1101-1102` | 随底图 | 否 | ［码］ |
| `image_array` | 派生（灰度数组） | — | 由 `image` 重算 | 可接受 | ［码］`session.py:67` |
| `format` / `mode` | 派生（PIL 属性） | — | 由 `image` 重算 | 可接受 | ［码］ |
| `_image_fingerprint_cache` | 缓存（几何 scope 身份） | — | `image` setter 强制作废 `session.py:230-231` | 可接受 | ［码］ |

### 1.2 前景 / 分割（全部派生）

| 属性 | 属于什么 | 保存到包 | 载入恢复 | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `foreground_mask` | 派生（Otsu） | — | `load_image` 重算 | 可接受 | ［码］`session.py:77` |
| `threshold` | 派生 | — | 同上 | 可接受 | ［码］ |
| `segmentation_mode` | 派生 / 半用户（层数模式） | — | ［推］重算时回落默认 | **待核** | ［推］ |
| **`extraction_mode`** | **用户选择**（sticky 取墨口径） | **—** | **—** | **会丢**：载入后回落 `"standard"` | ［码］`session.py:80-83`（注释自称 sticky） |
| `foreground_column_edges` | 派生（两层模式白点带） | — | 重算 | 可接受 | ［码］ |
| `shadow_mask` / `solid_layers` | 派生（放大包络） | — | 重算 | 可接受 | ［码］`_restore_aux_fields` 不含 |

### 1.3 清理（步骤 4）

| 属性 | 属于什么 | 保存到包 | 载入恢复 | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `grid_line_mask` 等 6 张掩膜 | 派生（由几何+笔迹合成） | — | `_recompose` `cleanup.py:667-737` 重算 | 可接受 | ［码］ |
| `cleanup_stats` | 派生 | — | `_recompose:737` | 可接受 | ［码］ |
| `cleanup_overlay_png` | 派生 | — | `_recompose:718` | 可接受 | ［码］ |
| `degrid_strength` | **劳动**（强度档位） | `line_removal.strength` `:1109-1112` | `_reset_line_removal:522-524` | 否 | ［码］ |
| `degrid_remove_vertical` | **劳动** | `line_removal.remove_vertical` `:1113` | `:525` | 否 | ［码］ |
| `degrid_info` | 派生 | — | 重算 | 可接受 | ［码］ |
| `line_corrections` | 劳动（**旧去线模型的笔迹**） | `line_removal.corrections` `:1114` | `:526-538`（缺 `mode` 补 `erase`） | 否 | ［码］；前端零消费者（testing-strategy §9 已定性） |
| `line_candidates` | **劳动**（确认/删除/厚度） | `line_candidates` `:1116` | `_restore_aux_fields:859-860` | 否 | ［码］ |
| `selected_candidate_ids` | 劳动（选中态，property） | `selected_candidate_ids` `:1117-1119` | `:861-862` | 否 | ［码］`cleanup.py:265` |
| **`exclusion_regions`** | **劳动**（用户划的排除区） | **—** | **—** | **会丢** | ［码］仅在 `project_new:235` 出现；`_restore_aux_fields:853-865` 不含 |
| **`line_strokes`** | **劳动**（擦除/补回笔迹） | **—** | **—** | **会丢** | ［码］同上 `:236`；载入侧不含 |
| `_candidate_seq` | 临时计数器 | — | 刻意不重置 `cleanup.py:225-227` | 可接受 | ［码］ |

### 1.4 取数区与列

| 属性 | 属于什么 | 保存到包 | 载入恢复 | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `rois`（含 `x_groups`/`default_group_id`/`name_source`） | **劳动** | `rois` `:1106` | `_restore_rois:573-594`（缺 `x_groups` 补默认组） | 否 | ［码］ |
| `primary_roi_id` / `active_roi_id` | 劳动（主区/活动区） | `:1107-1108` | `:576-581` | 否 | ［码］ |
| `data_xlim` / `data_ylim` | 劳动（ROI 边界冗余） | `roi{x,y,w,h}` `:1105` | `_reset_loaded_state:489-504` | 否 | ［码］ |
| `_roi_counter` | 派生计数器 | — | ［推］由 `rois` id 推断（未核实） | **待核**：id 重名会让几何错配 | ［推］ |
| `columns` | **劳动**（几何+标定+组归属+名字） | `columns` `:1124` | `_restore_columns:619-731` | 否 | ［码］ |
| `taxa_names` | 劳动（列名） | 间接：写进 `columns[].species/name` `:1033-1034` | `:627` 反填 | 否（但见 §3-1 重分列路径） | ［码］ |
| `control_points` | 半劳动（算法点+手改点混存） | `columns[].points[]` `:1014-1027` | `:711-731` | 否 | ［码］ |
| **`manual_points`** | **劳动**（手工点标记） | `points[].isManual` + `kind` `:1024` | `:718-731` | **工作区已修**（HEAD 会丢） | ［码］+新测试 `test_project_manual_points.py:138` |
| `column_points` | 派生（digitize 产物） | — | 需重新数字化 | 可接受（但界面"已数字化"态归零） | ［码］`core.py:1781` |
| **`reader_types`** | **劳动**（逐列读法选择） | **—** | **—** | **会丢** | ［码］仅 `project_new:215`；`_restore_columns` 不写 |
| `x_scales` | 派生 / legacy | — | `calibrate_axes:707-718` 重算 | 可接受 | ［码］ |

### 1.5 标定（步骤 3 / 6）

| 属性 | 属于什么 | 保存到包 | 载入恢复 | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `depth_calib` | **劳动**（Y 两点标定） | `depth_calibration{top_px,bottom_px,top_cm,bottom_cm,unit}` `:965-978` | `_apply_depth_calibration:545-557` | 否 | ［码］ |
| `depth_unit` | 劳动（单位） | `depth_calibration.unit` `:974` | `:542-543` | 否 | ［码］ |
| `is_calibrated` / `y_scale` | 派生 | `is_calibrated` `:969/977` | `:506` + `calibrate_axes` | 否 | ［码］ |
| **`primary_axis`** | **劳动（用户声明 Y 轴测的是深度还是年代）** | **—** | **—** | **会丢，且是"串值"而非"复位"** | ［码］见 §2-1 |
| 列级 `x_ticks` / `x_values` / `startValue` / `tickValue` | 劳动（X 标定） | `columns[].x_ticks/x_values/startValue/tickValue/tickEndX` `:1037-1056` | `:638-697` | 否 | ［码］ |
| 列级 `axis_stroke_px` | 劳动（列级轴粗覆盖） | `columns[].axis_stroke_px` `:1055` | `:705` | **工作区已修**（U-ROWS-02） | ［码］+新测试 `test_project_axis_stroke_roundtrip.py:205-330` |
| 组级 `axis_stroke_px` / `tick_layout` / `ref_span_px` | 劳动（组标定） | 经 `rois[].x_groups` `:1106` | `_restore_rois:582-594` | 否 | ［码］ |

### 1.6 采样 / 年代

| 属性 | 属于什么 | 保存到包 | 载入恢复 | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `samples`（含 `source="paste"` 的粘贴深度） | **劳动** | `samples` `:1120` | `_restore_aux_fields:857-858` | 否 | ［码］ |
| **`depth_grid`** | **劳动**（用户指定的取样深度网格；**并决定 data.csv 行**） | **—** | **—** | **会丢** | ［码］`export.py:971-1021` 写入；`project.py:1189` 读它决定导出行 |
| `age_depth_model` | **劳动**（模型+inspection+px 轨迹） | `age_depth.inspection` `:1080-1084` | `_restore_age_depth:884-907` | 否 | ［码］ |
| `age_depth_image` / `_path` | 劳动（用户载入的年代图） | `age_depth.image_path/width/height` + tar `image/age_depth.png` `:1069-1078` | `:871-881` | 否 | ［码］ |
| `age_depth_calib_state` | **劳动**（四点标定） | `age_depth.calib_state` `:1079` | `:882-883` | 否 | ［码］ |
| **`age_depth_is_calendar_year`** | **劳动**（年代口径） | **—** | **—** | **会丢** | ［码］仅 `session.py:141`，包内无对应键 |
| **`age_depth_rate_columns`** | **劳动**（速率列选择） | **—** | **—** | **会丢** | ［码］仅 `session.py:142` |
| `ensemble_tables` | 劳动（集成表） | `ensemble_tables` `:1123` | `:863-864` | 否 | ［码］ |
| `chron_events` | 疑似劳动（地质事件） | **—** | **—** | **未核实** | ［推］全仓只有 `project_new:245` 赋值，无写入入口 |

### 1.7 元数据 / 缓存 / 撤销

| 属性 | 属于什么 | 保存到包 | 载入恢复 | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `paper_metadata` | **劳动** | `paper_metadata` `:1121` | `metadata_update` `:855-856` | 否 | ［码］ |
| `meta_info` | 派生（PDF/图像元信息） | — | ［推］重新解析 | 待核 | ［推］ |
| `pdf_info` / `cached_pdf_data` / `cached_pdf_path` | 缓存 | — | 重新解析 PDF | 可接受 | ［码］ |
| `undo_stack` / `redo_stack` / `max_history` | 会话内 | — | `project_load:343-346` 主动清空 | 可接受 | ［码］ |

### 1.8 检测中间量

| 属性 | 属于什么 | 保存到包 | 载入恢复 | 会丢失吗 | 证据 |
| --- | --- | --- | --- | --- | --- |
| `tick_band` | 派生（刻度带） | — | ［推］`measure_ruler` 重算 | 可接受 | ［推］ |
| `hline_rows` | 派生（横线行） | — | ［推］检测重算 | 可接受 | ［推］ |
| `two_layer_report` | 派生（两层提取报告） | — | 重算 | 可接受 | ［码］ |
| `_load_axis_stroke_warnings` | 载入期诊断 | 写进 `manifest.json` `:921-926` | 不恢复（一次性） | 可接受 | ［码］ |

**登记表条目数：57 行**（多处以"同族合并"写法覆盖：1.3 的"6 张掩膜"一行代表
`grid_line_mask` / `candidate_line_mask` / `degrid_line_mask` / `exclusion_mask` /
`manual_restore_mask` / `manual_erase_mask` 六个属性，1.1/1.2 同理）。

判定汇总（按**属性个数**，不是表行数）：

- 判为**劳动**且**已进包**：15 个（`rois`、`primary_roi_id`、`active_roi_id`、`data_xlim`、
  `data_ylim`、`columns`、`taxa_names`、`control_points`、`manual_points`、`depth_calib`、
  `depth_unit`、`samples`、`ensemble_tables`、`paper_metadata`、`age_depth_model` 及
  `age_depth_image/_path`、`age_depth_calib_state`、`degrid_strength`、`degrid_remove_vertical`、
  `line_corrections`、`line_candidates`、`selected_candidate_ids` 等逐键项）。
- 判为**劳动**且**未进包**：**8 个** —— `primary_axis`、`depth_grid`、`exclusion_regions`、
  `line_strokes`、`reader_types`、`extraction_mode`、`age_depth_is_calendar_year`、
  `age_depth_rate_columns`（＋`chron_events` 待定性，未计入）。
- 判为**派生/缓存/会话内**：其余（约 30 个属性 + 6 张掩膜）。

第 2 组这 8 个就是本文档要交的核心清单。

---

## 2 漏项清单（按危险度排序）

| # | 字段 | 丢失后果（用户失去什么） | 现有测试覆盖 | 建议处置 |
| --- | --- | --- | --- | --- |
| 1 | **`primary_axis`** | 用户在步骤 3 声明「Y 轴 = 年代」后存档重开，**轴语义变回 `depth`**；整条岩芯的读数被当作深度导出，界面无任何异常 | ❌ 无。`step3-ycalib.spec.ts:128-179` 只测同会话内提交/回读；`_restore_columns` 与 `_apply_depth_calibration` 都不读它 | **进包**：`depth_calibration.primary_axis`（`calibrate_axes` 已写入 `depth_calib["primary_axis"]`，`export.py:723`，只是保存侧没抄、载入侧没读）。这是**最短路径的修复**：两端各一行 |
| 2 | **`depth_grid`** | 用户指定的取样深度网格丢失 ⇒ 重开后 `data.csv` 的行从"用户指定的深度"静默变成"逐行点并集"（`project.py:1189` 的 `or` 兜底），**行集不同 = 交付数据不同** | ❌ 无 | **进包**：顶层 `depth_grid: list[float]`。注意它是"输入参数"而非结果，语义上必须持久化 |
| 3 | **`exclusion_regions`** | 用户手工划的排除区全部消失 ⇒ 掩膜变了、整列读数变了，而界面上"排除区 (N 个)"归零看起来像"我本来就没划" | ⚠️ **反向覆盖**：`test_project_load_cleanup_state.py:121-128` 断言载入后 `exclusion_regions == []`、`:161-163` 断言 `exclusion_area_pixels == 0`。**这是把丢失钉成了期望**——将来真修复会让该测试变红 | **进包**：`exclusion_regions: list[dict]`；同时改那两条断言为"包内数量往返相等"。若决定不存，则必须改成显式的"未持久化"声明（见 §4.2 的 `DERIVED_FIELDS`），并让载入时给用户一条通知 |
| 4 | **`line_strokes`** | 用户擦除/补回的笔迹消失 ⇒ 同上，掩膜统计从 `manual_erase_pixels>0` 掉回 0 | ⚠️ 同上 `:125-128`（断 `== []`） | 同 #3 |
| 5 | **`reader_types`** | 用户逐列选的读法回落默认 ⇒ 同一列读数换口径 | ❌ 无 | **进包**：`columns[].reader_type`（逐列），或声明为派生并写明"回落到哪一档" |
| 6 | **`age_depth_is_calendar_year`** | 年代口径（cal BP ↔ 日历年）翻转 ⇒ 年代轴整体错位，**科学结论错** | ❌ 无 | **进包**：`age_depth.is_calendar_year` |
| 7 | **`age_depth_rate_columns`** | 速率列选择丢失 | ❌ 无 | **进包**：`age_depth.rate_columns` |
| 8 | **`extraction_mode`** | 取墨口径回落 `standard` ⇒ 两层图/扫描件的数字化结果整体变化 | ❌ 无 | **进包**（`session.py:80-83` 自称 sticky，语义上就是用户选择） |
| 9 | **`manual_points` 不在撤销快照里** | `_snapshot_editable_state`（`project.py:130-143`）存了 `control_points` 却没存 `manual_points`；`_restore_editable_state`（`:184-195`）同样不还原。⇒ Ctrl+Z 后点位坐标回到旧值、而"是手工点"的标记留新值 ⇒ **下一次重建用错口径** | ❌ 无 | **加进撤销快照**（两处各一行）。这是"包"之外的第二个持久化面，漏登记同样静默 |
| 10 | `chron_events` | 若确有写入入口则是地质事件丢失；若无入口则是死状态 | ❌ 无 | **先定性**：在全仓找写入点；无写入则删字段（避免下一个人"照着存一遍"） |

---

## 3 重建路径覆盖盘点（四条路径 + 一条隐藏路径）

### 3-1 重新分列 `core.detect_columns`（`core.py:1598-1640` → `_merge_with_existing_columns:1267`）

| 会重写/丢弃 | 机制 | 丢的是劳动吗 | 证据 |
| --- | --- | --- | --- |
| `columns` 整体替换（该 ROI 段） | `_splice_columns:1584` | 几何是重算的，不算丢 | ［码］ |
| 列名 `species/name` | `_merged_column_name:1348-1382`：`taxa_names[global_idx]` > 旧列名 > 占位码 | 否（有意保留） | ［码］ |
| `x_ticks` | `_inherit_column_state:1397-1441`：**仅当列数不变**且过区间守卫才保留；否则写 `x_ticks_dropped{reason}` | **是**（但有显式留痕，这是已修形态） | ［码］ |
| `x_values` / `unit` / `plot_type` / `scale_type` / `exaggeration_mult` | `:1395-1449` 仅在 `preserve_state`（列数不变）时继承；列数一变 ⇒ `_reset_column_group_after_relayout:1451` 全丢 | **是**（列数变化时静默丢，只有 `x_ticks` 留痕） | ［码］ |
| **列级 `axis_stroke_px`** | `_inherit_column_state` **不复制**该键；`_apply_measured_axis_stroke:1475-1514` 只写**组级**且只在组值 ≤0 时写 ⇒ 列级覆盖落到组值 | **是**（U-ROWS-02 的同型失效，只是发生在重分列路径而非打包路径） | ［码］ |
| `color` / `visible` | 两处都不继承 | **是** | ［码］ |
| `control_points`（算法点） | `_reindex_columns:1755` 的搬迁分支要求 `not is_new`，而检测出的列全部带 `_is_new_col=True`（`:1294`，**`preserve_state` 为真时也设**）⇒ 该 ROI 的控制点**一律不搬迁** | 是（算法点可重算）→ 可接受 | ［码］ |
| `manual_points`（手工点） | 兜底分支 `:1770-1779`：按**像素 x** 重新落到新列 | 否（**工作区已修**，2026-11-10） | ［码］+`test_project_manual_points.py:138` |
| `reader_types` / `column_points` / `x_scales` | 与 `control_points` 同一分支 ⇒ 对新列全部不搬迁 | `reader_types` **是劳动** | ［码］ |
| 组级 `axis_stroke_px` | `_apply_measured_axis_stroke:1510`：组上已有正数就不覆盖 | 否（有意保护） | ［码］ |
| `suspect_block` / `tickEndX` | 每次重算 | 否 | ［码］ |

### 3-2 阶段往返 `gotoStage`（前端，`helpers.ts:310-322`）

后端侧没有"进入某步"的钩子函数；**副作用全部来自前端在 step 变化时发的 RPC**：

| 进入 | 触发的后端动作 | 会覆盖的劳动成果 |
| --- | --- | --- |
| 步骤 4 | `algorithm.detectLineCandidates`（e2e 记录：`from-zero-journey.spec.ts:501-508`、`workflow-panels.spec.ts:65`） | 只产候选、不动像素与已确认几何（`from-zero-journey.spec.ts:512-516` 断言 status 全为 candidate）⇒ **不覆盖** |
| 步骤 5 | `core.detectColumns`（`from-zero-journey.spec.ts:540-546`） | **走 §3-1 全表**，是四条路径里覆盖面最大的一条 |
| 步骤 6 | 自动测齿 / `algorithm.measureRuler`（`from-zero-journey.spec.ts:593-605` 断言"不得替用户写 x_ticks"） | 只给齿位、不写读数 ⇒ **不覆盖** |
| 步骤 7 / 8 | 无写操作（只读 `samples.list` / `qa.summarize`） | 不覆盖 |

⇒ **往返本身安全，危险在"往返会顺手触发步骤 5"。** 用户从步骤 7 回步骤 5 看一眼，就会走
§3-1 的整张表。这是"阶段往返"与"重新分列"两条路径在 e2e 里无法分开测试的根因。

### 3-3 切 ROI（`roi_set_active` / `roi_update` / `roi_remove`，`roi.py:133-336`）

| 动作 | 重写什么 | 丢劳动吗 | 证据 |
| --- | --- | --- | --- |
| `roi_set_active` | 只换指针 | 否 | ［码］`roi.py:347` |
| `roi_update` 改边界 | `roi["columns_stale"]=True`（`:233`）；若为活动区则同时 `grid_line_mask=None`、`degrid_info=None`（`:237-238`）；**不动 columns** | 否，但**把标定交给下一次重分列处置** ⇒ 实际后果落在 §3-1 | ［码］ |
| `roi_update` 改名/组分/可见 | 只改 ROI 字典字段 | 否 | ［码］`roi.py:240-252` |
| `roi_remove` | 级联删该 ROI 的列 + `taxa_names` 同步删 + `_reindex_columns(sync_taxa_names=False)`（`:277-298`） | 被删 ROI 的列与点必然丢弃（用户意图）；**存活列的点存储走 §3-1 的搬迁分支（非 new ⇒ 会搬迁，安全）** | ［码］ |
| `roi_update` 的撤销 | `_record_history` 在**改写之后**才调（`:257-259`） | **是**：快照里已是新值 ⇒ Ctrl+Z 对 ROI 变更无效（`project.py:145-151` 的 B-06 纪律在此被违反） | ［码］ |

### 3-4 `project.load`（`project.py:341-412`）

| 步骤 | 重写什么 | 说明 |
| --- | --- | --- |
| `_init_cleanup():380` | 初始化 `line_candidates/exclusion_regions/line_strokes` + 6 张掩膜 + stats + overlay | 工作区新增（docstring 记录了 2026-11-09 用户报错）。**这行之前在全新会话直接打开工程包会 AttributeError** |
| `_reset_loaded_state:487` | 清 `is_calibrated/y_scale/depth_calib/`全部掩膜`/cleanup_stats/degrid_info` | 随后由 payload 重建 |
| `_reset_line_removal:519` | **写** `degrid_strength` / `degrid_remove_vertical` / `line_corrections` | 值来自 payload；缺键则**置空/置默认**，不保留旧值 |
| `_apply_depth_calibration:540` | 调 `calibrate_axes(...)`，**不传 `primary_axis`** ⇒ `resolved_axis = self.primary_axis`（`export.py:643-644`） | ⇒ **`primary_axis` 既不被 payload 覆盖，也不被重置：它沿用当前会话里的值。** "打开软件→打开工程包"时是默认 `depth`；"开着 A 包再打开 B 包"时是 **A 包的值**——串值 |
| `_reset_columns:559` | 清 `columns/taxa_names/control_points/manual_points` | 随后逐列重建 |
| `_restore_rois:566` | `_init_rois()` 后按 payload 重建；缺 `x_groups` 补默认组（`:582-594`） | 老包兼容分支 |
| `_restore_columns:619` | 逐列建 `taxa_names` / `x_values` / `x_ticks` / `axis_stroke_px` / `manual_points` | **不含 `reader_types` / `column_points` / `x_scales`** |
| `_restore_embedded_image:801` | 无条件换底图 + 作废像素派生态 | C1d 修复 |
| `_restore_aux_fields:853` | `paper_metadata` / `samples` / `line_candidates` / `selected_candidate_ids` / `ensemble_tables` | **不含 `exclusion_regions` / `line_strokes` / `depth_grid` / `primary_axis` / `age_depth_is_calendar_year` / `age_depth_rate_columns` / `reader_types`** |
| `_restore_age_depth:866` | 年代图 + `calib_state` + model | 完整 |

### 3-5 隐藏的第五条：撤销 `_restore_editable_state`（`project.py:178-195`）

快照只含 6 键（`columns / control_points / data_xlim / data_ylim / taxa_names / samples`）。
⇒ 撤销**会**回滚 columns（含 x_ticks）、control_points、samples；
**不会**回滚 `manual_points`、`exclusion_regions`、`line_strokes`、`depth_calib`、`rois`。
`manual_points` 与 `control_points` 成对出现却被拆开持久化 ⇒ 撤销后两者可能互相矛盾（§2-9）。

---

## 4 门禁设计建议：全量往返门禁

### 4.1 现有防漏装置为什么不够

`tests/unit/test_project_load_golden.py` 已经有三张清单，**它就是这个门禁的雏形**，但：

- `STATE_FIELDS`（`:52-75`）21 项里**缺** `manual_points`、`exclusion_regions`、`line_strokes`、
  `depth_grid`、`primary_axis`、`reader_types`、`column_points`、`x_scales`、
  `age_depth_is_calendar_year`、`age_depth_rate_columns`、`extraction_mode`、`chron_events`。
- `COLUMN_KEYS`（`:95-115`）19 项里**缺** `axis_stroke_px`（工作区已修但清单未更新）、
  `color`、`visible`、`points`（含 `isManual`）。
- `ROI_KEYS`（`:117`）只有 4 项，缺 `visible` / `composition` / `name_source` / `columns_stale` /
  `form_defaults` / `x_groups`。
- 语义上它是 **save→load 的 golden 比对**（`:380`），**不含** §3-1 的重分列路径。
- ⇒ 它是"**已知字段的守门员**"，不是"**新字段的探测器**"：`STATE_FIELDS` 漏掉的字段，
  这个测试永远不会红。今天就漏了 12 项。

### 4.2 让"新增状态漏登记时自动红"的机制（可机检，不靠人记）

**核心：把 `self.x = ...` 的集合变成门禁的输入，而不是靠人抄清单。**

单测 `tests/unit/test_project_state_registry.py`，三段：

1. **AST 枚举（不需要实例化，也不受"该属性今天恰好没被赋值"影响）**
   用 `ast` 解析 `session.py` + `session_parts/*.py`，收集所有 `self.<name>` 赋值目标
   ⇒ 得到集合 `ACTUAL`（当前 73 个）。
2. **声明式登记表**（同文件内，三个冻结集合，每个条目必须带理由字符串）：
   - `PACKED: dict[str, str]` — 值＝**包内键路径**，例如
     `"primary_axis": "depth_calibration.primary_axis"`、`"samples": "samples"`、
     `"columns": "columns"`。
   - `DERIVED: dict[str, str]` — 值＝**"由谁在何时重算"**，例如
     `"cleanup_stats": "_recompose() 在每次 applyLineRemoval/… 后重算"`。
   - `SESSION_ONLY: dict[str, str]` — 值＝理由，例如 `"undo_stack": "会话内，project_load 主动清空"`。
   三集合必须**两两不相交**，并断言 `PACKED | DERIVED | SESSION_ONLY == ACTUAL`（双向）：
   - `ACTUAL - 登记表` 非空 ⇒ 红：**"新属性 `<x>` 未登记：它进包吗？能重算吗？"**
   - `登记表 - ACTUAL` 非空 ⇒ 红：**"登记表已过期：`<x>` 已不存在"**（防清单腐烂）
3. **登记不能撒谎**（把声明与实现钉在一起，两条方向都断）：
   - 正向：对每个 `PACKED` 条目，真实 `project_save()` 出来的 `straditize.json`
     **必须包含该键路径**。⇒ 声明"进包"但实现没写 ⇒ 红。
   - 反向（照抄 `frontend/e2e/contract.spec.ts` 的 `auditNothingUndeclared` 思路）：
     `straditize.json` 里的**每个**键都必须能在 `PACKED` 里找到对应条目
     ⇒ 有人偷偷加了键却没登记，也红。

这条机制的关键性质：**新增一个 `self.foo = ...` 的人必然会被拦一次**，而拦下他的那句话
直接就是本文档 §1 的两个问题（"进包吗 / 谁重算"），不需要他先读这份 57 行的表。

配套（可选但便宜）：把 `DERIVED` 的"由谁重算"升级成可执行断言 —— 每个 `DERIVED` 条目
在往返门禁里断言"**载入后重新触发一次该重算入口，值与往返前一致**"（例如
`cleanup_stats` 走一次 `algorithm.applyLineRemoval`）。

### 4.3 最小会话：每类状态都必须非空

一条"造满"的夹具（`_full_state_session()`），构造顺序即依赖顺序：

| 类别 | 必须非空的字段 | 怎么造成 |
| --- | --- | --- |
| 底图 | `image`、`width/height` | `core.loadImage(sample_key="hoya")` |
| 前景/取墨 | `foreground_mask`、`threshold`、`extraction_mode`（改成非默认值） | `load_image` 自带 + 一次 `setExtractionMode` |
| 多 ROI | `rois` ≥ 2，`primary_roi_id`/`active_roi_id` 指向**不同** ROI | `roi.create` ×2 + `roi.setPrimary` |
| 组属性 | 每 ROI ≥ 2 组，`x_groups[].axis_stroke_px`/`unit`/`tick_layout`/`ref_span_px` 都有值 | `roi.groupCreate` ×2 + `roi.groupUpdate` |
| 列 | ≥ 2 列，**列级 `axis_stroke_px` 覆盖 ≠ 组值**，`color`/`visible` 非默认 | `detectColumns` + `column.update` |
| X 标定 | 至少一列 `x_ticks` 两点、另一列 `x_values`+组斜率 | `column.calibrateXTicks` |
| 控制点 | `control_points` 非空 **且** `manual_points` 非空（混合列） | `digitize` + `algorithm.extractTurningPoints` + 手工加点 |
| Y 标定 | `depth_calib` 四端点 + `unit="m"` + **`primary_axis="age"`** | `core.calibrateAxes(primary_axis="age")` |
| 清理 | `line_candidates` 有 removed 有 candidate；`exclusion_regions` ≥1；`line_strokes` 两种 mode 各 ≥1 | `detectLineCandidates` + `upsertLineGeometry` + `applyLineRemoval` |
| 采样 | `samples` 两种 source（consensus + paste） | `samples.extractConsensus` + `samples.pasteDepths` |
| 深网格 | `depth_grid` 非空且**与逐行点并集不同** | `core.applyDepthGrid` |
| 年代 | `age_depth_model` + `age_depth_calib_state` + `is_calendar_year=False` + `rate_columns` 非空 + `ensemble_tables` ≥1 | `agedepth.*` |
| 元数据 | `paper_metadata` 若干字段非空 | `metadata.update` |

### 4.4 对比什么、容差怎么定

| 值类型 | 例 | 比对策略 |
| --- | --- | --- |
| 标量（int/str/bool） | `primary_axis`、`depth_unit`、`extraction_mode` | 严格相等 |
| 浮点 | `top_px`、`axis_stroke_px`、`x_ticks[].value` | `abs(a-b) <= 1e-6`（像素量用 0；已 round 的值可直接相等） |
| 列表（有序、语义即顺序） | `depth_grid`、`samples`（按 depth）、`points`（按 y） | 逐元素，先按规范键排序再比（`_build_columns_export:1027` 已 `pts.sort(key=y)`） |
| 嵌套 dict（ROI/组/列） | `rois[]`、`x_groups[]`、`columns[]` | 按 `id` 建索引后**逐键集合相等**（键集相等 + 值相等），不做整 dict `==`（会因新增键误红） |
| 大数组 / 掩膜 | `foreground_mask`、`grid_line_mask` | **不进门禁**（派生）；若要比，比 `sha256` 前 16 位 + 像素计数 + bbox |
| 时间 / 绝对路径 | `manifest.timestamp`、`image_path` | **比对前 pop**（沿用 `testing-strategy.md` §8.5 的"稳定性三件套"） |
| `set` / property | `selected_candidate_ids` | 转 `sorted(list)` |
| NaN / None | 未标定列的读数 | 区分 `None` 与 `NaN`；**不得**用 `==`（`None != None` 在 `np` 上下文会翻车） |

### 4.5 失败信息要打印什么

一条失败消息必须让**没读过本文档的人**知道去哪儿改。模板：

```
[往返丢失] 字段 primary_axis（类别：劳动/标定）
  包内键路径：depth_calibration.primary_axis  ← 保存侧未写（期望 project.py:_build_depth_calibration_export）
  往返前：'age'    往返后：'depth'
  载入侧读取点：project.py:_apply_depth_calibration（未传 primary_axis ⇒ calibrate_axes 沿用会话旧值）
  可能丢在哪条路径：project.load
  相关不变量：ARCHITECTURE.md §9 #3 / #14 / #15
```

四要素固定：**字段名 + 类别 + 包内键路径 + 往返前后值 + 载入侧读取点 + 归因路径**。
再加一句 `修好之后请同步 STATE_FIELDS / PACKED 登记表`，把"改测试"变成流程的一部分。

### 4.6 与 §3 的衔接：同一夹具跑两条路径

往返门禁只测 `save → load`，抓不到 §3-1 的重分列覆盖。建议同一条 `_full_state_session()`
夹具跑三趟，每趟都做 4.4 的全字段对比：

1. `save → load`（打包路径）；
2. `save → load → detectColumns(同 ROI, 同边界) → 对比`（重分列路径）——
   **这一趟会立刻抓住 `axis_stroke_px`/`color`/`visible`/`reader_types` 的丢失**；
3. `save → load → roi.update(边界挪 20px) → detectColumns → 对比`（阶段往返 + 切 ROI 复合路径）。

第 2、3 趟的红灯预期：`control_points`（算法点，可接受）应**显式列入 `REBUILD_RESETS` 白名单**，
其余任何字段变化都应视为缺陷 —— 白名单本身也纳入 4.2 的双向校验。

---

## 5 未核实清单（明确交回）

| 项 | 为什么没核 |
| --- | --- |
| `chron_events` 是否真有用 | 全仓只找到 `project_new:245` 一处赋值，无 RPC/前端写入点；未跑 grep 覆盖 `frontend/src`（本次只读后端） |
| `segmentation_mode` 是否用户可选 | 只在 `session.py:79` 声明，未追到设置入口 |
| `meta_info` 的重算入口 | 未追到 |
| `tick_band` / `hline_rows` 的重算调用点 | 未逐条追 |
| `_roi_counter` 在载入后如何恢复 | 未追 |
| 前端在 `openProjectFile` 之后是否用 `[]` 覆盖 `exclusion_regions` | 只在 `test_project_load_cleanup_state.py:121-124` 的注释里读到"前端随后会用 [] 覆盖它"，未读 `frontend/src` 源码核实 |
| `primary_axis` 在"开着 A 包打开 B 包"时是否真的串值 | 由 `export.py:643-644` 的 `resolved_axis = self.primary_axis` 推断（［推］），未构造实测 |
