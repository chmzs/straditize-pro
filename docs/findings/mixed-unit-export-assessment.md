# 混合量纲导出评估（炭屑 / 花粉浓度 vs 百分比列）

> 触发：hoya 新场景 `c:\tmp\proj3`（28 列 / 3 组）里 col01 = 炭屑、col28 = 花粉浓度（绝对值），
> 其余列是百分比。用户问「这种导出需要做处理么？」
> 状态：**已按裁决实施方案 A+B**（2026-11-16）。画图侧另有 `settings.plot_scale_mode`。
> 实施内容与判据见本文 §6；`data.csv` 一个字节都没动。

## 结论先行

1. **需要处理，但根因不在导出层，而在数据模型**：28 列的 `unit` 全被存成 `"%"`，
   炭屑（counts）与花粉浓度（grains/cm²/yr 之类）也标成百分比。导出层只是如实照抄这个错值。
2. 用户已用「分组」表达量纲差异（grp2 = col01 炭屑、grp3 = col28 浓度，各自 slope 不同），
   但**分组信息不进 `data.csv`，也不进随包 `plot_strat.R`**，所以下游拿到的是「一张全是百分比的表」。
3. 最省事且不破坏契约的落点是 **manifest/README 记每列 unit + 随包 R 脚本按 unit 决定 scale.percent**；
   改 CSV 表头（后缀式）代价最大（见 §3 方案 C），不建议先做。

## 1. 现场事实（可复现）

| 事实 | 证据 |
| --- | --- |
| 28 列 `unit` 全为 `%` | `c:\tmp\proj3\straditize.json` 里各组 `unit`；用户实测 |
| `data.csv` 表头只有 `depth,col01..col28`，**没有任何单位信息** | `c:\tmp\proj3\data.csv` 首行 |
| `manifest.json` 只有版本/时间戳/ROI 层级，无列单位 | `c:\tmp\proj3\manifest.json`（206 B） |
| 随包 `plot_strat.R` 对每个 ROI 硬写 `scale.percent = TRUE` | `straditize_core/session_parts/export.py:504` |
| LiPD 有逐列 `units` 字段，值来自列 `unit`，缺省回落 `%` | `straditize_core/metadata/exporter_lipd.py:155,160` |
| XLSX 导出器未见逐列 unit 字段（全文件仅 readme 描述里出现 "units" 字样） | `straditize_core/metadata/exporter_xlsx.py`（grep 结果，未逐行核对 readme 生成逻辑） |

## 2. 影响面

| 出口 | 现状 | 改成「按列 unit」要动什么 | 风险 |
| --- | --- | --- | --- |
| `data.csv` / `data/<roi>.csv` | 纯数值矩阵，无单位 | 只能改表头（`col01_counts`）或加一行单位行 | **破 `data.csv` 逐字节等于 `data/<roi>.csv` 的既有断言**，且破坏 pandas/rioja 直接读表；用户下游脚本会断 |
| 随包 `plot_strat.R` | `scale.percent = TRUE` 硬写 | 按列 unit 决定 `scale.percent` / `scale.minmax`，与 `plot.render` 的新开关同源 | 低（脚本是给人看的模板，非机器契约） |
| XLSX | 未见单位列 | 加「单位」列或表头后缀 | 中：需同步跨出口相等判据（`test_export_chain_equality` 一类） |
| LiPD | 已有逐列 `units` | 无需改结构，只需 `unit` 数据本身是对的 | 低；但值仍取决于数据模型 |
| e2e | `frontend/e2e/export.spec.ts:279` 断言包内含 `plot_strat.R`；`from-zero-journey.spec.ts` 断言 `data.csv` 与 `data/<roi>.csv` 逐字节相同 | 动 CSV 表头 → 必须同步这些用例 | 中 |
| 画图 `plot.render` | 已可逐列退出默认缩放（本分支） | — | 已处理 |

## 3. 候选方案

**A. manifest + README 记单位（推荐，先做）**
- `manifest.json` 增 `column_units: {col01: "counts", col28: "grains/cm2/yr", ...}` 与 `group_units`；
  `README.txt` 增「单位」一节，写明哪些列不是百分比。
- 不动 `data.csv` 一个字节 ⇒ 现有相等判据、下游读表脚本零影响。
- 代价：机器读单位要改去读 manifest；CSV 单文件场景仍不自解释。

**B. 只修数据模型 + 让 R 模板按 unit 走（与 A 组合）**
- 让组 `unit` 真能存 `counts` / 浓度，随包 `plot_strat.R` 按 unit 决定 `scale.percent`
  （与 `plot.render` 的 `plot_scale_mode` 同一语义），并把非百分比列在 README 里点名。
- 这是「导出不再误导」的最小闭环；`data.csv` 数值不变。

**C. CSV 表头带单位（代价最大，不建议先做）**
- `col01 [counts]` 或 `col01_counts`。可读性最好，但破坏逐字节相等断言、破坏 `read.csv` 后的列名映射、
  破坏用户既有脚本。若要做，需一次迁移 + 版本号。

## 4. 本次不做（已裁决为「不做」）

- `data.csv` / `data/<roi>.csv` 表头与内容：不动（保住「`data.csv` 逐字节等于 `data/<roi>.csv`」）；
- XLSX 导出：不动（方案 A+B 不涉及）；
- LiPD 导出结构：不动（它本来就有逐列 `units`，值随组单位自动正确）；
- 独立模板 `export_r()`（不是随包文件）：仍对整表写 `scale.percent = TRUE`。它是单表模板、
  拿不到逐列量纲，未做逐列处理 —— 属已知剩余出口，未静默假装已修。

## 5. 若批准方案 A+B，验收判据（可判定）

1. `export_tar` 产出的 `manifest.json` 里，每个列名都能查到 unit，且 col01/col28 的 unit 不等于 `%`（真机 proj3 复现）；
2. `data.csv` 与 `data/<roi>.csv` 仍逐字节相同（现有 e2e 保持绿）；
3. 随包 `plot_strat.R` 里非百分比列所在 ROI 的 `strat.plot` 调用 **不含** `scale.percent = TRUE`（字符串断言）；
4. 反向验证：把 unit 强行写回 `%` → 判据 1、3 变红。
## 6. 已实施（方案 A+B，2026-11-16）

| 改动 | 落点 | 判据 |
| --- | --- | --- |
| 组单位可编辑（源头） | `frontend/src/components/steps/XTicksPanel.ts` 步骤 6 组卡片「单位」输入；`roi.py::_normalize_group_unit` 写入端归一 + 空串 `-32602` | `tests/unit/test_group_unit_editable.py`（4 条） |
| manifest 记量纲 | `export.py::export_multi_tar` → `column_units`（按 ROI）+ `group_units`（按组） | `test_export_script_units.py::test_manifest_records_column_and_group_units` |
| README 记量纲与规则 | 同一处，`Units (authoritative copy: manifest.json -> column_units)` 段 | `test_readme_documents_units_and_the_scale_rule` |
| 随包 `plot_strat.R` 按单位画 | 非 % 列单独一次 `strat.plot(..., scale.percent = FALSE, add = TRUE)`；全 % 时保持原来的一次调用（字节不变） | `test_non_percent_column_is_not_plotted_on_the_percent_basis` + `test_all_percent_project_keeps_the_single_call_template` |
| 三处字符串一致 | 列载荷 `unit` / LiPD `units` / manifest `column_units` | `test_three_places_agree_on_the_same_unit_string`（同一组设成 `粒/g`，三处全等） |
| 脚本真能跑 | 把生成物原样交给 R（合成数值覆盖 NA 表） | `test_generated_script_actually_runs_on_a_mixed_project`（skipif 无 R/rioja） |
| 组 → percent/fixed 的分裂 | 两组都是 `%` → 一次 percent 调用；把一组改成 `粒/g` → 只有该组列进 `fixed_cols`，另一组仍在 `pct_cols` | `test_two_percent_groups_both_go_percent_then_one_unit_splits_them` |
| 出图侧 UI 按组 | 导出弹窗「列量程（按组）」三态下拉，默认跟随单位；覆盖按组展开成列名 | 由 `tsc` + 元素 id 门禁兜底（无 e2e） |

### 6.1 `normalize` 到底是什么意思（必须说清）

rioja 的 `scale.percent = TRUE` 是**逐列归一**：内部 `colM <- apply(d, 2, max)`，每列除以
**本列最大值**（`rioja::strat.plot` 源码），所以 A 列 max 20% 与 B 列 max 5% 归一后都画满宽。
它不是「所有列共用一把 0–100 的尺」。要共用固定 0–100 轴，得用 `fixed` 并显式给量程。
出图侧混排时（部分列 `fixed`）走 riojaPlot 的 `scale.minmax`，所以脚本里先把 `normalize`
列按本列最大值缩到 0–100 再填 (0,100)，观感与纯 percent 模式一致。

反向验证（已实跑）：`is_percent_unit` 改成恒 `True` → `test_non_percent_column_...` 与
`test_two_percent_groups_...` 两条变红；`_normalize_group_unit` 改成恒返回 `"%"` → 组单位 4 条全红。

剩余出口：`export_r()` 的独立单表模板仍写 `scale.percent = TRUE`（见 §4），未处理。
