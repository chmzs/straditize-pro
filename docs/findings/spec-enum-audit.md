# RPC 文档枚举取值 ↔ 代码实际支持：审计与实施记录

范围：`docs/JSON_RPC_SPECIFICATION.md` §4 全章（4.1–4.11）+ §4A 中带枚举参数的条目。
产物：`tests/unit/test_rpc_spec_enums.py`（30 条用例，全部可判定）。
方法：文档侧从参数定义行取字面量，代码侧从**真正做校验/分支的那一处**取（AST 解析或行为探针），
两侧集合相等才通过；默认值单独断言。

四轮记录：
- 第 1 轮（审计）：只改文档与新增测试，不动产品代码。
- 第 2 轮（D-1～D-6）：按 lead 决策改代码/文档。
- 第 3 轮（A/B）：A 把 D-1 的校验推到**写入端**；B 把 D-2 的旧工程报错做成**可操作**。
- 第 4 轮（B 收口）：旧工程**载入时**补 `mode`（只补这一个键），并堵掉除载入外的另一处产出点。

授权边界（累计）：`session_parts/xscale.py`、`session_parts/xticks.py`、`session_parts/roi.py`、
`session_parts/project.py`、`image.py`、`rpc_methods/digitize.py`、
`docs/JSON_RPC_SPECIFICATION.md`、本文件与测试文件。
**未触碰** `columns.py` / `digitize.py` / `session_parts/digitize.py`（bench-curve 在改）。

## 1. 覆盖与判定

| 参数 | 参数位置 | 文档说 | 代码实际 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| `mode` | §4.2 `core.extractForeground` | 默认 `"otsu"`；`"otsu"`/`"binary"`/`"adaptive"` | `core.py:716/743/745` 三分支，其余 `INVALID_PARAMS`；默认只在 `core.py:663` 声明（D-6 后包装层不重复） | 一致 |
| `extraction_mode` | §4.2（D-5 新补） | 默认 `"standard"`；5 个规范值 | `image.py::EXTRACTION_MODES` 的 values；未命中 → `INVALID_PARAMS` | 一致（文档此前**没有这个参数**） |
| `reader_type` | §4.4 `core.digitize` | 默认 `"area"`；`"area"`/`"line"`/`"bar"` | `digitize.py:28 READER_TYPES` | 一致（由 `test_rpc_spec_reader_types.py` 覆盖，本文件不重复） |
| `unit` | §4.6 `core.calibrateAxes` | 默认 `"cm"`；**自由文本**，刻意不做枚举 | 默认 `session.py:127`；`export.py:636` 只 `strip()` | 一致（按自由文本断言） |
| `primary_axis` | §4.6 | 默认 `"depth"`；只接受 `"depth"`/`"age"` | `export.py:603` 白名单；默认 `session.py:133`；形参默认 `None` | 一致 |
| `strength` | §4.8 `algorithm.degrid` | 默认 `"medium"`；`"off"`/`"weak"`/`"medium"`/`"strong"` | `image.py::GRID_LINE_PRESETS` + `core.py:1503` 的 `"off"` 清空分支 | 一致 |
| `corrections[].mode` | §4.8 | `"erase"`/`"restore"` | `image.py::STROKE_MODES`，`rasterize_strokes` 逐笔校验（D-2） | 一致（缺/错值均拒绝） |
| `format` | §4.9 `core.exportData` | 默认 `"csv"`；`"csv"`/`"parquet"` | `export.py:731` 白名单；形参默认 `"csv"` | 一致 |
| `sample_key` | §4.1 `core.loadImage` | `hoya`/`verification`/`beginner` | `core.py:159-169` 字典，未命中 → `INVALID_PARAMS` | 一致 |
| `scale_type` | §4.10 `column.calibrateXTicks`；§4.11 组同源 | `"linear"`/`"log"`，其它 `-32602` | `xscale.py::SCALE_TYPES` + `normalize_scale_type`；**写入端**（`xticks.py`、`roi.py` groupCreate/groupUpdate）与**解析端**（`ColumnScale.__post_init__`、`resolve_column_scale`）双重校验 | 一致（两端都拒绝） |
| `plot_type` | §4.10（D-4 补取值） | `"area"`/`"line"`/`"bar"` | 与 `READER_TYPES` 同名，但不参与计算分支、也**不校验** | 取值一致；校验仍缺（§8） |
| `curve_channel` | §4A.2 `agedepth.extractAndInspect` | `"auto"`/`"chroma"`/`"darkness"` | `age_depth_tracer.py:634` 白名单；两层默认都是 `"auto"` | 一致 |
| `cc` | §4A.6 `agedepth.generateBaconScript` | `0`/`1`/`2`/`3`（D-3 补 0） | 不校验、透传进 rbacon 脚本；代码 docstring 亦声明 0–3 | 一致（弱绑定，§4） |

## 2. 决策与实施状态

| # | 参数 | 决策 | 做了什么 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| D-1 | `scale_type` | 改代码（两端校验） | 第 2 轮：`xscale.py` 新增 `SCALE_TYPES` + `normalize_scale_type()`，`ColumnScale.__post_init__` 归一化。第 3 轮：`xticks.py::calibrate_column_xticks` 在**任何状态变更之前**校验；`roi.py::roi_group_create` / `roi_group_update` 同样校验 | **完成（写入端 + 解析端）** |
| D-2 | `corrections[].mode` | 改代码（双值校验 + 可操作报错 + 旧包载入补齐） | 第 2 轮：`image.py::STROKE_MODES` + `normalize_stroke_mode()`。第 3 轮：报错点名"第 N 笔"并给出两种可照抄的写法。第 4 轮：校验移到"有点可画"之前（堵掉无点笔迹绕过校验），`project_load` 只给缺失 `mode` 补 `erase` | **完成（含旧工程迁移）** |
| D-3 | `cc` | 改文档 | §4A.6 补 `` `0` = Non-14C `` + 透传说明 | 完成 |
| D-4 | `plot_type` | 改文档 | §4.10 补三个取值 + 如实写明"不校验、不参与分支" | 文档完成；校验仍缺 |
| D-5 | `extraction_mode` | 改文档 | §4.2 整条参数 + 5 个规范值 + 别名归一化 + `-32602` | 完成 |
| D-6 | `mode` 默认值 | 改代码去重 | 包装层 `mode: str | None = None`，未传不转发，session 层唯一默认源 | 完成 |

### 2.1 旧工程（笔迹缺 `mode`）迁移说明

**做了什么**：报错侧（B2）——旧工程撞墙时文案必须能照着重修。实测文案：

```
第 2 笔的笔迹模式 None 未知：只支持 erase / restore。 若该工程由旧版本保存（笔迹里
没有 mode 字段），请为该笔补上 mode: "erase"（擦除误标）或 mode: "restore"（补回误删
的墨迹）后重试； 两者方向相反，静默取一个默认值会把「补回」做成「擦除」。
```

**全链路盘点（第 4 轮复核："除载入旧工程外，还有别处会产出缺 `mode` 的 corrections 吗？"）**：

| 位置 | 是否可能缺 `mode` | 处理 |
| :--- | :--- | :--- |
| `session_parts/core.py:1554`（`algorithm.degrid` 存 `line_corrections`） | 曾经可能 | `rasterize_strokes` 只校验"可画"的笔迹，而**没有点的笔迹同样会被持久化** → 它曾绕过校验落盘。现把校验移到"有没有点可画"**之前**，已堵（`image.py`） |
| `session_parts/cleanup.py:639`（`applyLineRemoval`） | 不入包 | 写的是 `line_strokes`（临时几何），`project_save` 只序列化 `line_corrections` |
| `session_parts/project.py:420`（`project_load`） | 旧包会缺 | **已修**：载入时只给缺失的 `mode` 补 `"erase"`（旧代码的原始语义） |
| `session_parts/project.py:812`（`project_save`） | 不会 | 只写内存里的 `line_corrections`；RPC 路径已验证、载入路径已补 |
| 前端 `frontend/src/types/pollen.ts:297` | 不会 | `mode` 是该类型的必填字段，客户端不会发出缺键笔迹 |

结论：**除"载入旧工程"外没有第二处产出点**；那条唯一路径第 4 轮也已补齐。

**载入侧补缺省（第 4 轮，已落地）**：`session_parts/project.py:420` 现为

```python
self.line_corrections = [
    c if "mode" in c else {**c, "mode": "erase"}
    for c in corrections
    if isinstance(c, dict)
]
```

三条约束各自怎么落地的：
1. **只补 `mode`**：`{**c, "mode": "erase"}` 只加这一个键，其它缺失键原样留空——补了就等于替用户
   声称"数据本来就在"（用例 ① 断言补齐后的字典**恰好**等于原字典 + `mode`）。
2. **补在载入期、不动落盘内容**：`project_load` 只改内存对象；真正写盘要等下一次 `project_save`，
   那时写出去的才是已补齐的数据（用例 ② 断言"载入→保存→再载入"后字段完全不变，即补齐只发生一次）。
3. **校验不放宽**：`"restroe"` 这类真拼错仍然报 `-32602` 并点名第几笔（用例 ③）。

**工程格式有没有版本号 / 迁移钩子**（按 lead 要求先查再定）：
- 有版本号：`project_save` 写 `version: "3.0.0"` / `schema_version: "3.0"`；
  `project.py::_check_project_schema_version` 以 `SUPPORTED_SCHEMA_MAJOR = 3` 为界，
  只挡"来自更新版本"的包，老包一律放行并记日志。
- **没有迁移钩子**：全仓 `grep -rn migrat straditize_core/` 零命中；版本门禁只做"挡新"，不做"改旧"。

**结论：不需要升工程格式版本。** 理由：这条改动只是给一个**本来就可选**的键补缺省值，不改字段集合、
不改结构、不改任何现有取值的语义；`schema 3.0` 的包继续按同一套规则解析，旧包继续能打开。
升版本反而让"本程序最高支持 3.x"这道门禁失去意义。

## 3. 实测异常类型与 code

| 触发 | 路径 | 实测 |
| :--- | :--- | :--- |
| `scale_type="sqrt"` | 构造 `ColumnScale` | `JsonRpcError`，`-32602`，`未知的 X 轴标度类型 'sqrt'：只支持 linear / log。` |
| `col["scale_type"]="logarithmic"` | `resolve_column_scale()` | `JsonRpcError`，`-32602`，同上格式 |
| `calibrateXTicks(scale_type="logarithmic")` | **写入端**（`xticks.py`） | `JsonRpcError`，`-32602`；实测列对象与 `x_ticks` 均未变（校验在所有变更之前） |
| `roi.groupCreate(scale_type="sqrt")` / `groupUpdate({"scale_type": …})` | 写入端（`roi.py`） | `JsonRpcError`，`-32602`；实测未建出组 / 组标度未变 |
| `corrections=[{"mode":"restore!"}]` | `session.algorithm_degrid()`（端到端） | `JsonRpcError`，`-32602`，文案见 §2.1 |
| `{"mode":"erase!"}` / 缺 `mode` | `rasterize_strokes()` | 同上；缺键时点名"第 N 笔"并给出两种写法 |

选 `JsonRpcError` 而非 `ValueError`：`protocol.py:368` 把**非** `JsonRpcError` 的一律映射成
`-32603 Internal error`，而这里要的是 `-32602 Invalid params`。

## 4. 弱绑定声明（不是每条强度相同）

- `cc`：本层没有分支，只有透传。用例绑（a）代码 docstring 声明的集合（`age_depth_model.py:1407`）
  与（b）实测透传。它挡不住"文档与 docstring 一起写错"，这点明写，不假装等价于常量绑定。
- `unit`：刻意自由文本，只断言"文档声明自由文本 + 默认值一致 + 任意单位被接受"。

## 5. 代码侧仍有常量缺口（不影响门禁）

| 参数 | 现状 | 说明 |
| :--- | :--- | :--- |
| `mode` | `core.py` elif 链 | 无常量；默认值已收敛（D-6） |
| `primary_axis` / `format` / `curve_channel` | `export.py:603`、`export.py:731`、`tracer:634` 内联元组 | 可分别提出常量 |
| `sample_key` | `core.py:159` 函数内字典 | 可提模块级常量（`mcp_server.py:57` 另有一份描述） |
| `strength` | `GRID_LINE_PRESETS` + 字面 `"off"` | 可提 `GRID_STRENGTHS` |
| `plot_type` | 无白名单 | 与 D-1 同一失效型，仍开口（§8） |

## 6. 顺带修正的一处代码注释（属 D-5 范围）

`rpc_methods/digitize.py` 原注释称 *"Omitting it keeps the session's current mode"* 与事实不符：
`normalize_extraction_mode(None)` 恒返回 `standard`（`core.py:701`），只有隐式重算路径
`_extract_foreground_from_settings`（`core.py:836`）才沿用会话值。已改注释并在 §4.2 按真实行为书写。

## 7. 判别力验证记录

每次只改一处 → 跑 `tests/unit/test_rpc_spec_enums.py` → 字节级复原。

### 7.1 第 1 轮（文档/默认值漂移）

M1 `strength` 取值、M2/M2b `mode` 增删取值、M3 `primary_axis` 默认、M4 `sample_key` 取值、
M5 `curve_channel` 取值、M6 `format` 默认、M7 `scale_type` 取值、M8 `unit` 默认、
M9 代码 `format` 默认、M10 包装层 `mode` 默认、M11 `depth_unit` 默认、M12 `algorithm_degrid` 默认
—— **12 处全部 RED，且各自命中对应用例**（基线 15 passed）。

### 7.2 第 2 轮（D-1～D-6 后新增门禁）

| # | 变异 | 命中 |
| :--- | :--- | :--- |
| N1 | 文档 `scale_type` `"log"` → `"log10"` | `test_documented_scale_type_matches_code` |
| N2 | 文档 `cc` `0` → `9` | `test_documented_cc_values_match_code` |
| N3 | 文档 `plot_type` `"bar"` → `"bars"` | `test_documented_plot_type_matches_reader_types` |
| N4 | 文档 `extraction_mode` 一个规范值改错 | `test_documented_extraction_mode_matches_code` |
| N5 | 文档 `corrections` `"restore"` → `"restores"` | `test_documented_correction_modes_match_code` |
| N6 | `normalize_scale_type` 改回静默 `"linear"` | 两条非法值用例 |
| N7 | `rasterize_strokes` 改回"非 restore 即 erase" | `test_unknown_correction_mode_is_rejected` |
| N8 | 包装层改回无条件转发 `mode` | `test_mode_default_lives_only_in_the_session_layer` |

### 7.3 第 3 轮（A/B 写入端）

| # | 变异 | 命中 |
| :--- | :--- | :--- |
| A1 | 删掉 `xticks.py` 的 `normalize_scale_type(scale_type)` | `test_invalid_scale_type_is_rejected_at_save_time` + `test_scale_type_is_canonicalised_when_saved` |
| A2a | 删掉 `roi_group_create` 的校验 | `test_invalid_scale_type_is_rejected_for_roi_groups` |
| A2b | 删掉 `roi_group_update` 的校验 | 同上 |
| B1 | 不再透传笔迹序号（`index=None`） | `test_legacy_stroke_without_mode_says_which_stroke_and_how_to_fix` |
| B2 | 删掉报错里 `mode: "restore"` 的可操作写法 | 同上 |

基线：第 1 轮 15 → 第 2 轮 22 → 第 3 轮 26 → 第 4 轮 **30 passed**，每次变异复原后均回到 30。

### 7.4 第 4 轮（旧工程载入补齐 + 产出点收口）

| # | 变异 | 命中 |
| :--- | :--- | :--- |
| P1 | 删掉 `project_load` 里的 `{**c, "mode": "erase"}` 补齐 | `test_legacy_project_stroke_without_mode_is_backfilled_on_load` + `test_legacy_backfill_is_idempotent_across_save_and_reload` |
| P2 | 把 `normalize_stroke_mode` 挪回 `if not points: continue` 之后 | `test_mode_less_stroke_is_rejected_even_without_points` |

> 第三个坑：变异脚本若用 `Path.read_text()` 读 CRLF 文件，Python 的换行归一化会把 `\r\n` 变成 `\n`，
> 于是含 `\r\n` 的锚点**永远匹配不上**（P1/P2 首轮就是这样假跳过的，输出"跳过，锚点命中 0 次"）。
> 读写都必须走 `read_bytes()` / `write_bytes()`。

> 两个坑，记下来免得下轮重踩：
> 1. 「红」要先分清是**断言红**还是**收集红**：第 1 轮首验时 M9/M11/M12 的 RED 实际是另一并发会话
>    改包导致的 `ImportError: _panel_axis_labels`（收集错误），落盘后用 `-k` 定向重跑才确认。
> 2. `xscale.py` / `image.py` / `xticks.py` 是 **CRLF** 行尾：含 `\n` 的变异锚点会静默"跳过"
>    （N6/N7 就假跳过一次）。变异脚本必须按字节锚定并断言命中数 == 1。

## 8. 本轮未覆盖（建议另开一轮）

- **输出侧枚举**（方向相反）：`x_ticks_dropped.reason`、`suspect_block.reason`、
  `scale_provenance.source`、`sedimentation.status`、`inspection.metadata.curve_channel`。
- `plot_type` 的入口校验（D-4 只补了文档）。
