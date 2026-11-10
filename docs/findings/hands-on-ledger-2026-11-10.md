# 实操发现台账（2026-11-10，用户工作流视角）

> 目的：把"真实操作撞出来的问题"集中一处，便于按用户损失排序决策。
> 每条都注明：**怎么发现的**（真机操作 / 取证脚本）、**证据在哪**、**当前状态**。
> 状态口径：`已修(有金丝雀)` / `在修` / `未修` / `待判(未定性)`。

## A 会丢用户劳动（最高优先级）

| ID | 问题 | 发现方式 | 证据 | 状态 |
| --- | --- | --- | --- | --- |
| H-01 | 清理笔迹 / 排除区**保存即丢**（我实测涂 38559 px → 重开归 0，零提示） | 真机：步骤 4 拖一笔 → 保存 → 解包 → 重开 | `.scratch/saved-check.json`、`round5` 文档 | **已修**（P0-B，双端金丝雀） |
| H-02 | 载入工程包后**新建 ROI 撞 id `roi_1`** | 真机：载入 → 「+ 新建 ROI」 | `docs/findings/userbug-rows`、triage 报告 | **已修**（去重循环，金丝雀） |
| H-03 | 撞 id 后**删"空 ROI"把真实 4 列一起删光** | 真机：点第二张卡的 ×，`columns` 4→0 | 同上 | **已修**（id 唯一 + 需显式确认） |
| H-04 | 删除"有列 ROI"在 **UI 上不可达**（后端要 `confirm_drop_columns`，前端没有入口） | 真机：点 × 只弹 `-32002` | `.scratch/hands-on/multi-roi/2` | 未修（前端确认框待派） |
| H-27 | 控制点 `isManual` 不持久化，**重分列覆盖手工点** | 真机：载入后页脚「0 手动/46 总计」；重分列 33→34、40→42 | `test_project_manual_points.py` | **已修**（2 条金丝雀；C3 待补） |
| H-26 | 列级轴粗不进包 → 整列偏 **0.3226**（2px 当量） | 用户 CSV vs 包内 `data.csv` 逐值对比（793 行） | `userbug-rows-2026-11-10.md` | **已修**（双端金丝雀） |
| H-10 | `primary_axis` 不持久化（Y=年代重开变深度，且跨包串值） | 真机：切主轴 → 保存 → 重开 | `test_project_state_persistence.py` | **后端已修**；**前端初始化也已修**（实测 select=age） |
| H-21 | `reader_types` 进包但**后端只写不读**（36 组读数逐值相同） | 取证：12 列 × 3 读法对比 | P0-A 回复 | 未修（需接读取点） |
| H-20 | `depth_grid` / `exclusion_regions` / `line_strokes` 之前全不进包 | 状态盘点 + P0-A/B | `project-state-inventory-2026-11-10.md` | **已修**（P0-A/B） |

## B 会把数据算错 / 导出错（科研可信度）

| ID | 问题 | 证据 | 状态 |
| --- | --- | --- | --- |
| H-11 | **有第二个带列 ROI 时 `export.csv` 整表静默变空**（0/5040），XLSX/LiPD/TAR 有数 | `.scratch/hands-on/export/` | **已修**：根因是 `values[col_name]` **按列名索引**导致跨 ROI 互相覆盖（"吞列"与"整表空"是同一 bug 的两面）；CSV 已收敛到 `get_roi_dataframes` 唯一入口；单 ROI 输出**逐字节相同**（`3c6f2c6d…` 114016B） |
| H-12 | **~~按列名去重吞列~~ 已撤回**：后续对照里 33 列完整导出（29+4，同名重复列完好）⇒ 早前"33→30"的复现条件未知。**代码侧事实仍成立**：旧 `export_data` 用 `values[col_name]`（`export.py:895`）按列名索引，同名必互相覆盖；但"用户可见的 30 列"未能在新构建复现 | 两轮实测（`multi-roi/1`、`D-qa-isolation`） | **已修**：`data.csv` = 主 ROI 一张表，其余各出 `data/<roi>.csv`（与既有 e2e 断言、HUD 文案一致） |
| H-13 | 随包 `plot_strat.R` 把 `NA` 改 0（未测→零丰度） | 同上 | **已修**：删除 `is.na<-0`，保留 NA 并加注释；判据钉在**可执行行**上（注释里提旧行为允许） |
| H-33 | **CSV 文件名取 primary、内容取"所有列扁平并集"——两者不同源**（3/3 复现：文件名 `roi_2`，表头 col01…col29 属 roi_1） | `.scratch/hands-on/multi-roi/C-qa/filename-ownership.md` | 随 H-12 收敛后应消失，**待复验** |
| H-34 | 同批数据**两种缺测表示**：CSV 写文本 `NA`（17271 个），XLSX 写**空单元格**（23432 个） | `artifacts-parse.json` | 未修（下游 R/Excel 对空格解释不一） |
| H-35 | `#wpd-na-fill` 默认 `0.0 (地学)`，但**不影响 CSV/XLSX 产物**（XLSX 空格 23432、=0 仅 1） | `na-fill/` | 未修（默认值误导；尚未污染数据） |
| H-36 | `999999.0` **不在任何产物里**（CSV/XLSX 均 0 命中）⇒ 纯前端显示哨兵 | 同上 | 随 H-29 修 |
| H-14 | **修正口径**：步骤 8 `#qa-banner` 其实是**正确的、且是红的**（「788 个层位总和 > 100%+2%」，SUM_MAX 728.9%），正对照成立 ⇒ 不是"永远说达标" | `.scratch/hands-on/multi-roi/C-qa/` | **该条撤回**（横幅无缺陷） |
| H-29 | **真正谎报的是导出模态自检行**：同一后端状态相隔 2 秒，模态写「平均总和 100.0%（各层位介于 **999999.0% ~ 0.0%**，**质检达标**）**0 层位质检**」；`999999` 是**前端本地哨兵**（后端真实最大 728.9%，RPC 响应递归扫描 0 命中） | `.scratch/hands-on/multi-roi/C-qa/` | 在修（改为复用步骤 8 的 QA 结果；并加"步骤 8 横幅不得被改绿"的回归断言） |
| H-30 | 导出面板 `#wpd-na-fill` **默认值就是 `0.0 (地学)`**（不是用户选择），与"缺测≠0"冲突；但实测选 `0.0` 后 CSV 产物**仍写 `NA`** ⇒ 目前只污染界面，未污染 CSV（XLSX 待验） | `.scratch/hands-on/multi-roi/na-fill/` | 未修（默认改 NA/空；0.0 需显式选择） |
| H-25 | 打开项目后预览整表 NA（后端有数） | `userbug-na-round5` | **已修**（载入回填 provenance） |
| H-24 | 预览 125 行 vs 下载 35 行（两套行集无说明） | `userbug-rows` | **已修**（选择器同时控制 + 说明文字） |
| H-06 | 会话内标定 X 后前端不刷新 → 预览仍 NA（须刷页面） | fixer 构造现场时发现 | 在修（`notifyScaleMutated` 接线） |
| H-19 | LiPD 单位**取组不取列**（列级 `grains/g` 被写成 `%`） | `.scratch/hands-on/export/2-ui` | 未修 |
| H-20b | 多 ROI 时 QA **只算 `roi_1`**，另一 ROI 未标定列不进告警 | 同上 | 未修 |

## C 界面撒谎 / 阻断（影响判断与操作）

| ID | 问题 | 证据 | 状态 |
| --- | --- | --- | --- |
| H-09 | 步骤 6 同屏「标定进度 0/4 列 (0%)」+「已标定 · 0.1613 %/px」 | 真机截图 | 未修 |
| H-15 | 卡片写「roi_2 (0列)」，左栏仍渲染 29 个列输入框，切 active 不刷新 | `.scratch/hands-on/multi-roi/3` | 未修 |
| H-16 | 一次「确认清理」对 primary+active **各发一条 `detectColumns`**，报错的那个被静默跳过、另一个被建 29 列 | 同上 | 待复核 |
| H-17 | 空 ROI 可一路推进到步骤 4 才被 `-32602 Bounds too small` 拒 | 同上 | 未修（UX） |
| H-18 | XLSX 打开时 `wb.active = meta_info`（用户先看到元信息，数据在第二页） | `.scratch/hands-on/export/` | 未修（UX） |
| H-07 | **保存项目零反馈**（无 toast），无法区分"存了/没存" | 真机 | 未修 |
| H-08 | 步骤 7「提取采样共识层位」点了无反馈、35→35 无变化 | 真机 | 未修（或属幂等，需产品定义） |
| H-05 | 撤销 = **目标漂移**：同一动作（列改名）撤销时先后落到 `roi.update` / `algorithm.applyLineRemoval` / `algorithm.measureRuler` / **0 条** 四种结果，**永不命中被撤销的那个动作**；7 个动作 7/7 后端零回退，4/7 按钮还灰着 | fetch 包装探针三轮（`.scratch/hands-on/undo/`） | 未修（需按"每类动作自己的正/反向通道"重做） |
| H-37 | **QA 范围与导出范围不一致**：QA 只算 **active** ROI（`qa.summarize{roi_id:"roi_2"}`），CSV 导出算**全部 ROI 并集**。实测 active=空 roi_2 时 `N_HORIZONS 0` → 横幅「门禁通过」，而 roi_1 有 **788 层超标** ⇒ **绿灯 + 漏检** | `.scratch/hands-on/multi-roi/D-qa-isolation/` | 在修（前端聚合 + 范围声明；后端 `roi_id=None` 语义待派） |
| H-32 | **列删除在 UI 上不可达（能力有、入口无）**：后端 `column.remove` 已注册（`rpc_methods/columns.py:11`），前端 `grep "column\.remove|deleteColumn|removeColumn|btn-col-delete"` **全部 0 命中** ⇒ `docs/testing-strategy.md` 里"#btn-col-delete 接入 column.remove"是**过期描述** | 三入口实测（`[data-col-id]` 卡片 / 画布点列 / `▾` 下拉均无）+ 代码 grep | 未修（要么补入口，要么删文档里的假承诺） |
| H-31 | 模态框 **Esc 3/3 不关闭**（点关闭按钮能关）。**"滚动锁泄漏"已撤回**：3/3 关闭后 `overflow` 均恢复；`PageDown` 恒 0 是因为页面 100vh 无滚动容器，不能当证据 | `.scratch/hands-on/undo/` | 未修（Esc 未绑定） |
| H-22 | 打开项目时先弹「恢复未保存草稿」，误点会**覆盖**刚打开的包 | 真机 | 未修（UX 风险） |
| H-23 | 中途导航后 `exportData` 报「连接已断开」（`getDiagramData`/`export.csv` 同时刻正常） | fixer 现场 | 待判（是否影响真实用户） |

## D 拐点算法（已量化，结论：不是调参问题）

- 现状召回 **0.845**（Pinus/Juniperus 与用户结果**零差异**，漏点集中在 type 0.76 / Chenopodiaceae 0.60）。
- 24 个漏点里 **22 个显著度 = 0**（落在平台/斜坡）；你手工补的 135 个非峰谷锚点与 **RDP 保形顶点重合 75.6%（4× 基线）**。
- 四个改进候选全部输给现状（最好 F1 0.798 < 0.837）；`max_points` 上限、`prominence` 下调均无效；平滑是负收益。
- **结论**：拐点耗时的根因在"人工点留存"（H-27）与"建议点通道缺失"，不在检测算法。
- 文档：`turning-points-eval-2026-11-10.md`。

## E 待办优先级（按用户损失）

1. **H-11/H-12 导出链**（现在多 ROI 导出的 CSV 不可用于分析）—— 在修
2. **H-14 QA 横幅**（把失败说成通过）—— 在修
3. **H-04 删除确认入口 + H-05 单笔撤销**（用户决策②的落点）
4. **H-27 C3 补验 + H-21 `reader_types` 接读取点**
5. **H-09 / H-07 / H-08 / H-15 / H-22** 界面诚实性与反馈
6. **拐点建议点通道**（RDP 顶点，只渲染不写库）—— 待产品决策
