# 混合量纲导出评估（炭屑 / 花粉浓度 vs 百分比列）

> 触发：hoya 新场景 `c:\tmp\proj3`（28 列 / 3 组）里 col01 = 炭屑、col28 = 花粉浓度（绝对值），
> 其余列是百分比。用户问「这种导出需要做处理么？」
> 状态：**仅评估，未改导出格式**。画图侧已单独处理（`settings.plot_scale_mode`）。

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

## 4. 本次未做（等裁决）

- 未改 `data.csv` / `data/<roi>.csv` 表头与内容；
- 未改 `manifest.json` / `README.txt`；
- 未改 XLSX / LiPD 导出；
- 未改随包 `plot_strat.R` 的 `scale.percent = TRUE`。

## 5. 若批准方案 A+B，验收判据（可判定）

1. `export_tar` 产出的 `manifest.json` 里，每个列名都能查到 unit，且 col01/col28 的 unit 不等于 `%`（真机 proj3 复现）；
2. `data.csv` 与 `data/<roi>.csv` 仍逐字节相同（现有 e2e 保持绿）；
3. 随包 `plot_strat.R` 里非百分比列所在 ROI 的 `strat.plot` 调用 **不含** `scale.percent = TRUE`（字符串断言）；
4. 反向验证：把 unit 强行写回 `%` → 判据 1、3 变红。
