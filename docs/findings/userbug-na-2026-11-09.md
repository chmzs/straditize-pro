# 用户缺陷诊断：标定/识别都做了，导出数据仍是 NA（2026-11-09）

**一句话根因**：工程包本身是好的（组级 X 标定存在 `rois[].x_groups[].value_per_px` 里，后端 `resolve_column_scale` 读出 4/4 `calibrated=true, source=group_slope`，后端每条导出都有数）；NA 只出现在**前端**——「打开项目」时 `normalizeProject` 不从后端取 `scale_provenance`，而 `CoordinateSystem.resolveColumnScale` 在没有 provenance 时退回看 `x_ticks`（包内为 `null`），于是前端把四列全判成"未标定"，导出预览表 / 「复制当前数据」逐格写 `NA`。用户的"导出数据"读的是这张前端表，不是后端导出物。

标尺（全篇遵守）：**已实测**＝本轮真跑出来的观察；**读码推断**＝只读代码得出的因果；**未验证**＝没测到。

---

## 1. 六条路径逐条结果（包载入零状态后端 22980 之后）

前置：`support/serve_zero_backend.py`（`STRADITIZE_ZERO_PORT=22980`，干净会话）→ `project.load`（tar 内 `straditize.json` + `image/original.png` 转 base64）→ 逐条调用。证据 `.scratch/userbug-NA/probe3.json`、`probe.out.log`、`export.csv`、`ui_export.xlsx`。

| # | 出口 | 结果（已实测） | 走的 scale 解析入口 |
|---|---|---|---|
| ① | 包内 `data.csv`（保存时生成） | **有数**：36 行 × 5 列，`tar_data_csv_na=0`，首行 `156.7599,67.7419,0.9836,9.5161,19.1803` | 后端 `export.get_roi_dataframes` → `resolve_column_scale`（`export.py:199`）+ `read_column_values`（`:207`，profile=EXPORT） |
| ② | XLSX 导出（RPC + UI 各一次） | **有数**：`pollen` 表 35 行，`none_cells = 0/140`；UI 下载的 `ui_export.xlsx` 与 RPC 版一致 | 同上（`get_roi_dataframes`，`export.py:467`） |
| ③ | LiPD 导出 | **有数**：`paleoMeasurementTable` 5 列 × 35 行，`nulls=0`，`nonzero=35/列`（depth 156.7599…，Pinus 67.4194…） | 同上（`export.py:559` → `get_roi_dataframes`） |
| ④ | `core.extractGridValues` | **有数**：`null_cells=0`，首行 `{depth:156.7599, Pinus:67.4193, Juniperus:0.9836, type:9.5161, Chenopodiaceae:19.1803}` | `export.py:1102` + `read_column_values`（`:1106`，EXPORT profile） |
| ⑤ | **前端导出预览表 / 「复制当前数据」** | **NA**：表头 `Depth_cm,Pinus,Juniperus,type,Chenopodiaceae`，数据行 `156.76,NA,NA,NA,NA`；全文 `NA` 计数 **500**（125 行 × 4 列）。截图 `.scratch/userbug-NA/preview-NA.png` | **前端** `ExportModal.ts:273/303/333` 调 `CoordinateSystem.hasRealCalibration(col)`；未标定分支写 `UNCALIBRATED_NA`（`:257`） |
| ⑥ | `qa.summarize` | **有数**：`n_uncalibrated=0`、`uncalibrated_columns=[]`、四列 `calibrated=true`、`peak` 96.9 / 57.2 / 23.1 / 23.9、`sum p50=93.5` | `qa.py:183` + `read_column_values(profile=READ_PROFILE_QA)`（`qa.py:198`） |

补充（已实测）：`export.getReadiness` → `ready=true, calibrated_count=4/4, sources={"group_slope":4}`；`getDiagramData` 四列 `scale_provenance = {calibrated:true, source:"group_slope"}`。

**结论**：后端六路里五路有数，唯一 NA 的是**前端自己算的那一路**（⑤）。这解释了"data.csv 有数、别的地方 NA"。

---

## 2. 为什么同一个包 data.csv 有数而预览没有

不是同一份数据被两条判据读，而是**两个进程各算一遍**：

- `data.csv` / XLSX / LiPD / 网格 / QA：**后端**算。后端持有 `rois[].x_groups[].value_per_px`，`resolve_column_scale` 命中组斜率分支 → `calibrated=True`（`xscale.py:296-312`，`_scale_from_group_slope` 见 `:502-536`）。EXPORT profile 因此不写 null（`xscale.py:203-209`，`read_column_values:242-243`）。
- 导出预览表：**前端**算。`normalizeProject` 重建列对象时只塞 `scaleCalib`（由 `startX/startValue/tickEndX/tickValue` 合成，`ProjectManager.ts:323-329`），**从不写 `scale_provenance`**；`CoordinateSystem.resolveColumnScale`（`CoordinateSystem.ts:145-177`）在无 provenance 时退回 `Array.isArray(col.x_ticks) && length>=2`（`:162`）——包里 `x_ticks=null` ⇒ `calibrated=false` ⇒ 预览逐格 NA。

`resolve_column_scale` 的完整优先级与这四列的落点（`straditize_core/session_parts/xscale.py`）：

| 分支 | 行号 | 本包是否命中 | 结果 |
|---|---|---|---|
| A1 组 `tick_layout` + 列 `x_values` | `:282-294` | 否（`x_values=null`） | — |
| 组斜率 `value_per_px` | `:296-312` | **是**（`roi_1_grp1=0.16129`、`roi_1_grp2=0.16393`） | `calibrated=True, source="group_slope"` |
| 列 `x_ticks` | `:314-325` | 否（`null`） | — |
| 兜底 `startValue/tickValue/tickEndX` | `:327-337` → `:569-632` | 仅当组丢失时才会走到 | `calibrated=False, source="legacy"`（`:619,:630`） |

两条读取 profile（`xscale.py:200-217`）在这里的差别：

- `READ_PROFILE_EXPORT`：`null_when_uncalibrated=True`（`:208`）→ 未标定列**整列 None**。这就是"一旦前端判未标定，预览整列 NA"的机制。
- `READ_PROFILE_QA`：`null_when_uncalibrated=False`（`:215`）→ 未标定列也粗算，好让"该列没标定"能被提示。所以即使真未标定，QA 也照样出数（这也解释了为什么 QA 这条看不出问题）。

---

## 3. `groups` 键缺失是不是根因

**不是。该假设已被实测否证。**

1. **保存端确实没有顶层 `groups` 键**（已实测：`straditize.json` 顶层 keys 仅 16 个，无 `groups`），但组标定**不在这里**——它嵌在 `rois[0].x_groups[]` 里：
   ```
   roi_1_grp1: {tick_layout:[rel0,rel1], axis_stroke_px:6, value_per_px:0.16129032258064516}
   roi_1_grp2: {tick_layout:[…], value_per_px:0.16393442622950818}
   ```
   （`project.py:953-982` 把 `self.rois` 原样写进 `project_json["rois"]`，见 `:963`。）
2. **读入端原样恢复**：`_restore_rois`（`project.py:539-560`）直接 `[dict(r) for r in saved_rois]`，只在**缺** `x_groups` 时才补一个无 `value_per_px` 的默认组（`:549-560`）。本包不缺 ⇒ 不补。
3. **没有 groups 时**（反事实）`resolve_column_scale` 会走到 `_scale_from_fallback`：`val1=tickValue=0.1613`、`abs_px1=tickEndX`、`calibrated=False, source="legacy"`（`:584-619`）——**几何还在，标定资格丢了**，EXPORT 就会整列 None。这正是我最初怀疑的机制，但它**没有在本包上发生**（实测 4/4 `group_slope`）。

⇒ 用户工程包"组级标定丢失"不成立；丢的是**前端镜像里的标定资格标记**。

---

## 4. 不改代码的缓解路径（实测）

**缓解 A（已实测，立即可用）**：用导出模态里的**下载按钮**（`CSV` / `导出 XLSX` / `LiPD` / `TAR 归档` / `JSON`），不要用「数据表格 / 原始文本 / 复制当前数据」。
- 实测：UI 点「导出 XLSX」→ `straditize_scientific_1794233028536.xlsx`，`pollen` 表 35 行 × 5 列，**缺失 0 格**，与包内 `data.csv` 数值一致（`.scratch/userbug-NA/ui_export.xlsx` + `ui_xlsx_check.log`）。
- 代价：预览表仍显示 NA，用户无法在导出前肉眼核对。

**缓解 B（读码推断，未实测）**：打开项目后在**步骤 6**对任一列重新点一次刻度齿并确认（`column.calibrateXTicks` → `RpcClient.notifyScaleMutated`（`RpcClient.ts:527-533,556`）→ `scaleSync` 拉 `getDiagramData` 并把 `scale_provenance` 回填到**所有**列（`app/scaleSync.ts:36-50`）），预览即恢复出数。
- 未实测的原因：步骤 6 的取齿需要在 12% 缩放的画布上精确点中刻度线，本轮没做；机制本身在代码里是确定的。

---

## 5. 可复现缺陷（交下一轮修）

### U-NA-01【高】「打开项目」后前端丢失列标定资格：导出预览/复制全 NA，后端导出有数

- **最小步骤**（6 步）：① 起零状态后端（22980）→ 打开应用；② 顶栏「打开项目」选 `F:\Downloads\straditize_project_1794232440046.tar`；③ 等 HUD「成功载入 Straditize 科学项目包 (.tar)」；④ 点顶栏「导出」；⑤ 读预览表 / 切「原始文本」；⑥ 与「导出 XLSX」下载物对比。
- **期望**：步骤 ⑤ 的预览与步骤 ⑥ 的下载物同值（两处都来自同一个后端标定事实）。
- **实际**：⑤ 四列全 `NA`（500 个 NA 令牌），面板同时自相矛盾：步骤 6 写「X 轴标定（本组共用）**已标定 · 0.1613 %/px**」而「标定进度 **0 / 4 列 (0%)**」；⑥ 的 XLSX 35 行全部有数。
- **首次分叉点**：第 ② 步 `project.load` 成功之后——后端 `getDiagramData` 已给出 `scale_provenance.calibrated=true`（4/4），而前端 `normalizeProject` 产出的列对象没有 `scale_provenance`；第一次可观测分叉就是第 ⑤ 步预览逐格 NA。
- **机制（读码推断）**：`ProjectManager.normalizeProject`（`frontend/src/core/ProjectManager.ts:266-330`）只合成 `scaleCalib`，不写 `scale_provenance`；`CoordinateSystem.resolveColumnScale`（`frontend/src/core/CoordinateSystem.ts:145-177`，退回判据在 `:162`）见 `x_ticks=null` 即判未标定；`ExportModal.ts:257,273,303,333` 据此写 `NA` 并跳过换算。
- **修法方向（不在本轮范围）**：`openProjectFile`/`onProjectLoad` 成功后拉一次 `straditize.getDiagramData`，按 `id` 把 `scale_provenance` / `scaleCalib` 回填（复用 `app/scaleSync.ts` 已有例程）；或让 `project.load` 的响应直接回带投影列。**禁止**改成"前端自己按 legacy 字段推断已标定"——那会让真正未标定的列也出数。
- **证据**：`.scratch/userbug-NA/`：`probe3.json`（后端 4/4 group_slope + XLSX/LiPD/grid 有数）、`probe.out.log`、`preview-NA.png`（预览 NA 截图）、`ui_export.xlsx`（UI 下载的 XLSX）、`ui_xlsx_check.log`、`export.csv`、`tar-list.txt`。

### 旁证缺陷（同一次实测撞到，未展开）

1. **打开项目即弹后端错误**（已实测）：HUD 报成功的同时弹「载入项目后重算清理掩膜失败 —— `'StraditizeSession' object has no attribute 'exclusion_regions'`（-32603）」。读码推断：`project_load` 未走 `project_new`/`_init_cleanup`，`exclusion_regions` 只在 `core.py:450`、`cleanup.py:230`、`project.py:235`（`project_new`）初始化；在"刚启动、未先载图"的会话里打开项目就会缺这个属性。
2. **QA 的 `declared_max` 把"每像素斜率"当满量程**（已实测数值，风险待判）：`per_column_max` 四列 `declared_max=0.2`、`peak=96.9/57.2/23.1/23.9`、`over=true`。0.2 是 `value_per_px≈0.1613` 取一位小数的结果——`_scale_from_group_slope` 把 `val1` 设成"每 px 的 %"（`xscale.py:525-536`），而任何把 `val1` 当"满量程"用的下游（QA 的 `declared_max`、前端 `maxPercent`、工程包里的 `tickValue`）都会拿到一个速率。**是否误导用户需产品确认**，本轮不改。
3. **`e2e.reset` 后再 `project.load` 会出现"calibrated=true 但读数全 0"**（已实测，仅测试通道）：`probe2.json` 里 LiPD/QA 全 0，而干净会话（`probe3`）同包同调用全对。判定为测试复位顺序残留（`column_points` 未随 reset 重建），**不是用户路径**；记录以免被误当产品缺陷。

### 未验证

- 用户在真实安装包里看到的 NA 究竟取自哪个按钮（截图/描述未提供）。本轮能确定的是：同一台机器、同一构建（`frontend/dist` 21:41 构建，用户 21:54 保存包）下，**预览/复制 = NA、下载 = 有数**；两者都在同一 UI 里。
- 缓解 B（重新点齿）未实测。
- LiPD/QA 的 `declared_max` 误报是否已被既有文档登记：本轮未查。
