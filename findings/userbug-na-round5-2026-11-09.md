# 第五轮：用户报「标定/识别都做了，数据仍 NA」的根因、修复与验证（2026-11-09）

> 触发：用户提供真实工程包 `straditize_project_1794232440046.tar`（19.4 万字节，导出时间 21:54）。
> 结论先说：**包是好的，数据没丢；NA 只是前端一条判定错**。已修两条、复核有效，并顺带查出三条更危险的问题（未修）。

## 1 用户包的健康状况（逐字段实测）

| 项 | 实测 |
| --- | --- |
| 成员 | `manifest.json / straditize.json / image/original.png / data.csv / plot_strat.R / README.txt` |
| Y 标定 | `depth_calibration = {is_calibrated: true, top_px 806, bottom_px 1235, top 250 cm, bottom 350 cm}` |
| ROI | 1 个 `roi_1 / pollen`，`xlim [258,1803] ylim [403,1649]` |
| 列 | 4 列（Pinus / Juniperus / type / Chenopodiaceae），33~46 个控制点；`x_ticks` 全 `null`，`x_group_id` 指向组 |
| 组标定 | `rois[0].x_groups[].value_per_px` = 0.16129（grp1）/ 0.16393（grp2） |
| `data.csv` | **有数**，36 行，175 个非空单元格 |
| `samples` | 35 条 `source="auto"`，深度与 Y 标定换算一致 |

**"组级 X 标定"是合法形态**：后端 `xscale.py:296-312` 命中组斜率 → `calibrated=true, source=group_slope`，4/4 列。

## 2 NA 出现在哪条路径（六条出口实测）

| 出口 | 结果 | 谁在算 |
| --- | --- | --- |
| 包内 `data.csv` | 有数（NA=0） | 后端 |
| XLSX | 有数（35×4，缺失 0/140） | 后端 |
| LiPD | 有数（null=0） | 后端 |
| `core.extractGridValues` | 有数（null_cells=0） | 后端 |
| `qa.summarize` | 有数（`n_uncalibrated=0`） | 后端 |
| **导出预览 / 复制当前数据** | **NA（实测 500 / 8344 格全 NA）** | **前端** |

## 3 U-NA-01（高）：打开项目后前端丢"标定资格"

**根因链**：工程包 `straditize.json` 里没有 `scale_provenance`（它是 `getDiagramData` 的派生物）→ `ProjectManager.normalizeProject` 只合成 `scaleCalib`（`ProjectManager.ts:266-330`），列对象无 provenance → `CoordinateSystem.ts:145-177` 退回 `x_ticks.length >= 2`（组斜率列是 `null`）→ false → `ExportModal.ts:257/273/303/333` 的 `hasRealCalibration` 判未标定 → 整表 `UNCALIBRATED_NA`。

**修复**：`scaleSync.ts:35-67` 抽出 `applyScaleSnapshot`（与既有回填同源）；`ProjectManager.ts:636-679` 新增 `hydrateScaleProvenance`：载入后拉一次 `getDiagramData`，**按列 id 回填后端算好的快照**，取不到就 `notifyError`（不静默）；`:750`/`:781` 两个载入分支在 `onProjectLoad` 之前 await。**前端不做任何本地推断**。

**证据**：红 `NA 8344 / 8344` → 绿 `NA=0 / numeric=8344 / 非零=2356 / max=31.94`；金丝雀（注掉 hydrate）再红；相邻 15 passed。

## 4 U-CLEANUP（高）：打开项目后重算清理掩膜崩

**现象**：用户每次打开包都会看到「载入项目后重算清理掩膜失败 —— `'StraditizeSession' object has no attribute 'exclusion_regions'`」。

**根因**（Fixer 实测，修正了 Triage 的两处推断）：`project_load`（`project.py:341`）不初始化清理状态；`_reset_loaded_state` / `_reset_line_removal` 都不管 `line_candidates / exclusion_regions / line_strokes`；唯一"创建" `line_candidates` 的是 `_restore_aux_fields`（`:734`，来自 payload）。于是载入后缺 `exclusion_regions` / `line_strokes`，抛点在 `cleanup.py:652`。`apply_line_removal` 的兜底判的是 `line_candidates`（恰好已存在）⇒ 兜底不触发。

**修复**：`project.py:380` 在 `apply payload` 之前加一行 `self._init_cleanup()`（唯一入口；不重置 `_candidate_seq` 以免 id 复活）。

**证据**：红 `AttributeError` → 绿 `2 passed`；金丝雀注掉即红；4 个 project golden `46 passed` 且**未修改任何 golden**（`git diff` 空，最后改动 2026-11-06）。Verifier 另试了两种替代修法：惰性 `getattr` 兜底能让用户不崩但门禁仍红；加宽入口守卫更坏（`geometries_count: 0`，几何静默消失）。

## 5 顺带查出、本轮**未修**的三条（都更危险）

1. **保存丢清理编辑（静默数据丢失）**：`project_save`（`project.py:985-1011`）只写 `line_removal{strength,remove_vertical,corrections}` + `line_candidates`，**不写** `exclusion_regions` / `line_strokes`；`_restore_aux_fields` 也只恢复 `line_candidates`。实测：源会话放 1 个排除区 + 1 条笔迹 → 保存 → 解包两键皆无 → 载入后 `[]`。**用户画的排除区与笔迹在保存那一刻就丢了，且不报错。**
2. **两套层位网格（同层位两处读数不同）**：预览默认用 `union_points`（所有控制点 y 的并集，本现场 298 行不规则层位），后端 `export.csv` 是 801 行恒 0.1 步长，`core.getStatus` 报 `has_depth_grid:false` ⇒ 两套互不共享。实测同列出现 1.63（预览）vs 19.1935（导出）。**两边都有数、看不见的失败**，比 NA 更危险。
3. **`naStr` 默认 `0.0`**（`ExportModal.ts:252-258,336-340`）：缺测写 `0.0`，只有整列未标定才写 `NA` ⇒ 下载物里"缺测"与"真 0%"完全同形，顶到不变量「不得把缺失数据解释为 0」。

另：QA 把 `value_per_px` 当满量程（`declared_max=0.2`）导致四列 `over=true` 误报（只报）。

## 6 门禁（真实输出）

| 命令 | 结果 | exit |
| --- | --- | --- |
| `npx playwright test project-reload-calibration`（22984 / 22986） | `2 passed (26.4s)` / `2 passed (28.0s)` | **0** |
| 相邻 `project-roundtrip export contract step6-group-slope step6-picktick`（22984） | `15 passed (2.0m)` | **0** |
| `pytest -q tests/unit/test_project_load_cleanup_state.py -x` | `2 passed in 13.99s` | **0** |
| 相邻 4 个 project golden | `46 passed in 8.37s`（+新用例合计 48 passed） | **0** |
| `test:e2e:typecheck` | 通过 | **0** |

## 7 判据层（Verifier 裁定，写下来避免后人误读）

- **U-CLEANUP 门禁有效**，且"过严"是有理由的严格：它挡住两种更坏的修法（惰性兜底、加宽入口守卫会让几何静默消失）。
- **U-NA-01 门禁本体有效，但第 7 组断言被替换过，属部分放水**：原定"预览 == 后端 `data.csv` 逐格同值"在实测中被证伪（两套网格），改成"预览 ==「原始文本」下载物"（同源 `currentRows`）⇒ 抓不到数值算错，只能抓"矩阵被弄丢"；拦"全填 0.00"靠 `nonZero≥100` + `max>1` 两个手挑阈值。
  **已处置**：`project-reload-calibration.spec.ts` 头部 docstring 已改为如实描述（含"为什么不再断言跨端逐格相等"与恢复条件），测试标题同步改为「与『原始文本』下载物逐格同值」。
- 两条判据缺陷已登记：`geometry_removed_pixels > 0` 是位置相关量（横带移到 y=100/300/1400 时为 0）；`exclusion_area_pixels == 0` 无法证明 exclusion 分支跑过（空输入与跳过同值）。

## 8 下一步原子动作

先修第 5 节第 1 条（保存丢排除区/笔迹）——它直接造成用户可感知的数据丢失，且已有可复现的实测口径（保存→解包看键、载入后读 `[]`）。
