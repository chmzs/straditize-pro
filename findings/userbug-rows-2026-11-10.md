# 用户第二轮：行数对不上 + Pinus 恒差 0.3226（2 px）（2026-11-10）

**一句话**：行数不是数据错，是**两个不同的行集定义并存且界面没说明**——导出预览默认用「所有列控制点 y 的并集」(125 行)，而 CSV 下载走后端「采样层位 samples」(35 行)；那 0.3226 是**载入工程包时丢掉了 Pinus 的"仅本列轴粗"覆盖**，x0 从 263 漂到 265（+2 px），四列里只有 Pinus 设过这个覆盖。

标尺：**已实测**＝本轮真跑；**读码推断**＝只读代码；**未验证**＝没测到。证据 `.scratch/userbug-rows/`（`probe_rows.json`、`reloaded.project.json`、`export.csv`、`probe.out.log`、`stroke_check.log`）。

---

## 1. 行集：125 行 vs 35 行，各自怎么来

**导出预览（前端，已实测 125 行）**
- 数据集下拉三个选项：`union_points`（**默认 selected**）/ `depth_grid` / `turning_points` — `frontend/src/components/ExportModal.ts:98-100`。
- `union_points` 的定义：把**所有可见列**的 `controlPoints[].y` 收进一个 `Set`，排序后逐行插值 — `ExportModal.ts:288-316`（去重并集在 `:290-294`）。
- 本包实测：`union_control_rows = 125`（`.scratch/userbug-rows/probe_rows.json`），与用户看到的预览行数一致；昨天同一包在浏览器里数到的预览正文也是 125 行（`500 NA / 4 列`）。
- 另两个选项的行数：`depth_grid` 按 `SplineInterpolator.getStandardDepthHorizons`（`SplineInterpolator.ts:150-189`，本包 250→350 cm、span=100 < 200 故 interval=2，ROI 外推到 156→446 cm ⇒ 约 15 行）；`turning_points` 是每列控制点全展开（行数 = 各列点数之和）。

**CSV 下载（后端，已实测 35 行）**
- 按钮 `#btn-wpd-download-csv` 直接 `rpcClient.call('export.csv')`，**完全忽略上面的数据集下拉** — `ExportModal.ts:513-539`（`:516` 只发方法名，无 dataset 参数）。
- 后端 `export.csv` → `export_data` → `_export_rows_and_depths`：**有 `samples` 就用 samples 的行**（`straditize_core/session_parts/export.py:831-848`）；只有 `samples` 为空时才退回"各列逐行点的并集"（`:849-852`）。
- 本包 `samples` 35 条（`source=auto`，row_px 各不相同）⇒ CSV 35 行；包内 `data.csv` 35 行、新导出 35 行，三者 depth 完全一致（已实测，`probe_rows.json` 的 `pkg_csv_rows=35 / new_csv_rows=35 / export_rows=35`）。

**用户在 UI 上能看到的唯一线索**：只有下拉框那三行文案（`ExportModal.ts:96-101`）。**没有任何文字**说明 ① 预览与下载用的是不同行集；② 下载按钮不受 Dataset 选择影响。相反，默认项文案写着「[推荐: 忠实原图/无伪插值]」，会把用户引向"这就是导出结果"的误解。

**⇒ 裁定**：行数对不上**不是数据缺陷**（35 是三份产物一致的行数，125 是另一套定义），是**界面/文案缺陷**：同一模态里两个行集并存、选择器不控制下载、且无任何说明。责任在 UI 层（选择器与下载按钮的契约），不在用户的包。

---

## 2. 那 2 px 是哪个字段变的（字段级）

方法：22990 零状态后端 → `project.load`（包内 `straditize.json` + `image/original.png` 转 base64）→ `straditize.getDiagramData()` + 再 `project.save(format=json)` 落盘（拿到"当前会话认为的字段值"）→ 与包内原值逐字段比对。

**唯一变化的字段：Pinus 的 `tickEndX`。**（已实测）

| 字段 | 包内原值（Pinus） | 载入后（`project.save` 回写） | 另三列 |
|---|---|---|---|
| `start` / `startX` | 259 / 259 | 259 / 259（不变） | 不变 |
| `end` / `endX` | 947 / 947 | 947 / 947（不变） | 不变 |
| **`tickEndX`** | **264.0** | **266.0** | Juniperus 953→953、type 1359→1359、Chenopodiaceae 1582→1582（**全不变**） |
| `startValue` / `tickValue` | 0 / 0.16129 | 0 / 0.16129（不变） | 不变 |
| `x_group_id` | `roi_1_grp1` | `roi_1_grp1`（不变） | 不变 |
| `scaleCalib.originX`（载入后下发） | —（包内无此键） | **265.0** | 952 / 1358 / 1581 |
| `scale_provenance` | — | `{calibrated:true, source:"group_slope"}` | 同 |

（`probe_rows.json` 的 `pkg_columns` / `reloaded_columns` / `diagram_columns`；`stroke_check.log`）

**推导链（已实测数值 + 读码）**：`_scale_from_group_slope` 定义 `abs_px0 = c_start + axis_stroke`、`abs_px1 = abs_px0 + 1`（`xscale.py:523-528`），而 `_build_columns_export` 把 `tickEndX` 写成 `scale.abs_px1`（`project.py:913`）。于是：

- 包内 `tickEndX=264` ⇒ 当时的 `abs_px0 = 263` ⇒ 当时的 `axis_stroke = 263 − 259 = 4`。
- 载入后 `tickEndX=266` ⇒ `abs_px0 = 265` ⇒ `axis_stroke = 6`（＝组 `roi_1_grp1.axis_stroke_px = 6`，实测）。
- 差值 2 px × 0.16129 %/px = **0.3226**，与用户观测的每行恒差完全对上（差值集合 `{0.3225, 0.3226}`，仅 1 行因四舍五入）。

**为什么"当时是 4、现在是 6"**：`resolve_axis_stroke` 的优先级是**列级覆盖 > 组级 > 缺省 5**（`xscale.py:31-56`）。包里 `columns[].axis_stroke_px` 根本不存在——**保存端不写它**（列段字段表 `project.py:891-916` 无此键），**载入端也不恢复它**（`project.py:644-664` 的 `col_dict` 白名单无此键）。所以：保存时 Pinus 列上那个 `axis_stroke_px=4` 只活在内存里，落盘即丢；重新载入后列上没有覆盖 ⇒ 回落到组值 6 ⇒ x0 从 263 变 265 ⇒ 整列读数少 2 px 的当量。

三条同组列的自洽性反证（已实测）：type 也在 `roi_1_grp1`，其 `tickEndX=1359`、`start=1352` ⇒ stroke=6，与组值一致；Juniperus / Chenopodiaceae 在 `roi_1_grp2`（无 `axis_stroke_px`）⇒ stroke=5（缺省）⇒ 953−947−1=5、1582−1576−1=5，也一致。**只有 Pinus 的 264 与组的 6 不一致**，这只能是列级覆盖 4 被丢了。

---

## 3. 哪个数是对的

按产品定义，读数 = `(x − abs_px0) × slope`，其中 `abs_px0 = start + resolve_axis_stroke(col, group)`（`read_column_values` 的基线取 `scale.abs_px0`，`xscale.py:244`；组斜率分支 `xscale.py:502-536`；ARCHITECTURE §6.4：绿线 = 列左缘 + 轴粗）。

- 工程包里的 **67.7419** 用的 x0 = 263，即**当时列上生效的轴粗 4**（用户在步骤 6 面板「仅本列: px（留空 = 跟随组）」显式设过，`ExportModal` 同源控件 `#inp-col-axis-stroke` 在面板上可见）。
- 新导出的 **67.4194** 用的 x0 = 265，即**列覆盖丢失后回落的组值 6**。

⇒ **67.7419 更符合定义**（它带着用户的显式设置）；67.4194 不是"另一种合理口径"，而是**载入路径丢失设置后的默认值**。反过来说：如果用户从没设过列级轴粗，那包里的 264 就不该出现——但它出现了，且只能由 4 推出，所以"包里的值是对的、新导出是丢设置后的退化"。

**影响面**：仅影响"设过列级轴粗"的列。本例 Pinus 每行 −0.3226 %（相对误差 ~0.5%，绝对量小），但它是**系统性的常量偏移**，会改变峰值位置吗？不会——斜率不变、只整体平移；改的是"0 点在哪"，对接近 0 的读数影响最大（低丰度段相对误差可达 100%）。

---

## 4. 两条可复现缺陷（交下一轮，本轮未改代码）

### U-ROWS-01【中】导出预览与 CSV 下载使用不同行集，且选择器不控制下载、无任何说明

- **最小步骤**：① 起零状态后端，打开应用；② 打开本项目 tar；③ 顶栏「导出」；④ 数「数据表格」行数（125）；⑤ 点同一模态里的 `CSV` 按钮下载；⑥ 数下载文件行数（35）。
- **期望**：同一模态里"看到的就是导出的"；或选择器旁明确写出"下载使用采样层位（samples），与本表行集不同"。
- **实际**：④=125 行（`union_points` 默认），⑥=35 行（后端 `samples`）；选择器切换对下载无效（`ExportModal.ts:513-539` 只发 `export.csv`，`export.py:831-848` 用 samples）；界面无任何提示，默认项还标「推荐」。
- **首次分叉点**：第 ⑤ 步——点击下载时行集从"前端并集"切到"后端 samples"，此前 ④ 的 125 行并不能代表下载物。
- **证据**：`probe_rows.json`（`union_control_rows=125`、`samples=35`、`export_rows=35`）、`export.csv`、`ExportModal.ts:96-101/288-316/513-539`、`export.py:825-865`。

### U-ROWS-02【中】工程包不持久化"列级轴粗"，重开后 x0 漂移（Pinus 每行 −0.3226）

- **最小步骤**：① 在步骤 6 给某一列设「仅本列轴粗 = 4」（其余列留空跟随组 6）；② 标定并保存工程包；③ 重新打开该包；④ 导出 CSV；⑤ 与包内 `data.csv` 对比该列。
- **期望**：重开后该列读数与保存时逐值一致（包内 `tickEndX=264` 与组轴粗 6 自洽，或保存时把 `axis_stroke_px` 一并写入）。
- **实际**：该列 `tickEndX` 264 → **266**，x0 263 → **265**，全列读数整体 −0.3226（= 2 × 0.16129），另三列 0 处不一致。
- **首次分叉点**：第 ③ 步 `project.load` 之后，该列对象上不再有 `axis_stroke_px`；第一次可观测值是 `getDiagramData().scaleCalib.originX = 265`（保存时应为 263）。
- **根因（读码）**：保存端列段字段表 `straditize_core/session_parts/project.py:891-916` 不含 `axis_stroke_px`；载入端 `col_dict` 白名单 `project.py:644-664` 同样不含。而解析端明确支持列级覆盖（`xscale.py:42-48`）。
- **修法方向**：把 `axis_stroke_px` 加入工程包列段（读写两侧），并在载入时把它恢复到列对象；同时给"包内 tickEndX 与组轴粗不自洽"的情形留一条一致性自检（保存时断言 `tickEndX == start + stroke + 1`，不成立就说明覆盖丢了——现在正是丢的那一刻）。
- **证据**：`probe_rows.json`（`pkg_columns` vs `reloaded_columns`：仅 Pinus `tickEndX` 264→266）、`stroke_check.log`、`probe.out.log`（`dg Pinus calib originX=265`、另三列 952/1358/1581）、`export.csv` 与包内 `data.csv` 的逐列差值 `{Pinus: 35/35 行，Δ∈{0.3225,0.3226}}`。

---

## 5. 澄清 801 行 vs 35 行

- 本包 `has_depth_grid=false`（`core.getStatus`），`export.csv` 走 `_export_rows_and_depths` 的 **samples 分支** ⇒ **35 行**（已实测）。
- `apply_depth_grid` 本身**没有默认点数**：必须显式给 `depths` 或 `start/end/step`（`export.py:971-1016`）。801 = `100 cm / 0.125 cm + 1`，或任意"801 个点的栅格"，只能来自调用方显式构造。
- 因此 Verifier 上一轮报的 801 行**不是本包的 CSV 路径**，最可能是它当时的现场走的是**深度栅格**（预览选项 2 / `core.extractGridValues` + 自建 801 点栅格），或会话里 `samples` 为空而退回"并集/等距采样"。**未验证**具体来源（其现场未保留）。
- 结论：35 与 801 不矛盾，是**两条不同行集**；本包 CSV 的权威行数就是 35。

---

## 6. 本轮未做 / 未验证

- 未验证：用户是否真的在步骤 6 给 Pinus 设过「仅本列 4」（包内不存该字段，只能由 `tickEndX=264` 反解；反解唯一）。
- 未验证：Verifier 801 行的现场。
- 未做：任何代码修改。
