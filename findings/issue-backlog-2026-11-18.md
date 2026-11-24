# Issue Backlog — 2026-11-18

来源：Gemini 外部讨论稿（`Gemin对话_仅用于讨论_非绝对真理.md`）逐条对撞当前实现 + 用户需求确认。
配套：`decisions-log.md`（已关闭项与决议理由）。

**本文件不含代码改动授权。** 每条落地前单独走 plan，按 `docs/ARCHITECTURE.md` 的不变量验收。

## 统计

| 状态 | 数量 | 去向 |
|---|---|---|
| OPEN | 20 | 本文件，按执行顺序排 |
| DEFERRED | 4 | 本文件，附触发条件 |
| CLOSED | 9 | `decisions-log.md` |

## 分级

| 级 | 含义 |
|---|---|
| P0 | 当前在用，且已确定在出错或不可见 |
| P1 | 当前会用，且会静默出错 |
| P2 | 中期功能请求 |
| P3 | 远期，无排期 |

## 执行顺序

| # | 编号 | 标题 | 级 | 成本 |
|---|---|---|---|---|
| 1 | STZ-A8 | 层位覆盖层补 `grid` 颜色 | P1 | 30 min |
| 2 | STZ-A2 | 聚类锚点实验（均值 vs 末成员） | P0 | 1h + 基线 2h |
| 3 | STZ-A3 | `min_taxa_support` 改"支持列数" | P0 | 2h |
| 4 | STZ-A4 | 共识回传 support / 簇宽 / 成员数 | P0 | 2h |
| 5 | STZ-A1 | 参数可见 + 层位数区间提示 | P0 | 3h |
| 6 | STZ-F3 | `sample_grid` 分支补 `primary_axis` 反演 | P1 | 3h |
| 7 | STZ-F1 | 概念用词纠正 + `y_unit` + 补起止输入 | P1 | 5h |
| 8 | STZ-B1 | 轴宽量测锚点 + 来源标注 | P1 | 4h + 三图回归 |
| 9 | STZ-A5 | 已知 N 双路径反推 | P1 | 6h |
| 10 | STZ-D1 | 三 QA 旗标 | P1 | 1d |
| 11 | STZ-A6 | 画布单条水平线增/删 | P1 | 1d |
| 12 | STZ-C2 | 断轴列组 + 多段标定 | P1 | 2d |
| 13 | STZ-A9 | 层位锁定 | P2 | 2h |
| 14 | STZ-D2 | `FLAG_COLLISION` | P2 | 4h |
| 15 | STZ-E1 | 用户标记横线纳入清理 | P2 | 4h |
| 16 | STZ-F2 | `depth` → `sample_grid` / `axis_value` | P2 | 1d |
| 17 | STZ-C5 | 主填充 + 浅色 Exagg 双层 | P2 | 2d |
| 18 | STZ-B2 | 亚像素读数 | P2 | 2–3d |
| 19 | STZ-A7 | 层位拖拽微调 | P2 | 1d |
| 20 | STZ-C1 | 双向正负列 | P2 | 3–5d |

---

# A. 层位（采样层位 / 共识层位）

**术语基线（2026-11-18 用户定义，不得再混用）**：采样层位 = 真实取样并鉴定了花粉等样品的层位。图上表现为填充/折线的折点、标记中心、bar 端点。**等距取样只是其中一种特例**，非均匀取样（按地层界、按事件层加密）同样常见。

---

## STZ-A1 参数可见 + 层位数区间提示

- 级：P0 ｜ 成本：3h ｜ 状态：OPEN
- 现状：`InspectorBridge.ts:530` 硬编码 `tolerance_px: 4.0, min_taxa_support: 1`；后端默认 `tolerance_px=2.5`（`session_parts/samples.py:107`）。两处不一致，用户无法看见也无法改。
- 实测杠杆：同一张图 `tol=4.0 → 207` 层、`tol=1.0 → 642` 层（`recon-20261117.md` §5），差 3 倍。
- 做：
  1. 面板加 `tolerance_px` / 支持列数两个输入，回显后端实际生效值。
  2. 按钮旁显示区间估计：「tol=4.0 → 约 207 层；tol=1.0 → 约 642 层」。实现上只跑 2–3 个 tol 采样点做估计，不全扫。
  3. 用户据区间自行决定是否偏离默认值——不自动替用户选参数。
- 判据：显示的估计值与实跑值误差 ≤5%。
- 依赖：无。
- 落点：`frontend/src/services/InspectorBridge.ts`、`frontend/src/components/steps/SamplesPanel.ts`。

## STZ-A2 聚类锚点实验（均值锚 vs 末成员锚）

- 级：P0 ｜ 成本：1h 实验 + 2h 基线（若改）｜ 状态：OPEN（实验先行）
- 现状：`session_parts/core.py:1985` 用簇均值做锚 `abs(r - mean(clusters[-1])) > tolerance_px`。行号已排序，但均值始终落后于最新成员，理论上"每步差 < tol"可无限串接（chaining），把密集拐点区并成一个巨大簇、均值落在中间，产出一个不对应任何真实层的假层位。
- 做：**先做对照实验，不预设结论**。取 2–3 张真图，同时跑「均值锚」与「末成员锚」（`r - clusters[-1][-1] > tol`）两版，输出三张对照表：层位数、层间距分布、每层支持列数。
- 决议口径：若差异 <2% 且无假层位实例 → 记入 `decisions-log.md` 关闭；若差异显著 → 带基线重生成后再改。
- 判据：对照表能证明"差异存在/不存在"，不靠推理。
- 依赖：STZ-A4（需要支持列数才能出第三张表）。
- 落点：`straditize_core/session_parts/core.py:1928-2017`。

## STZ-A3 `min_taxa_support` 改为"支持列数"

- 级：P0 ｜ 成本：2h ｜ 状态：OPEN
- 现状：`core.py:1967` `all_turning_rows.extend(turning_rows)` 只存行号，列 ID 已丢弃；`core.py:1994` `len(cl) >= min_taxa_support` 数的是**拐点个数**。用户设 3 以为是"≥3 个属种共振"，实际可能是同一列的 3 个相邻峰。默认 1 等于不过滤。
- 做：池子改 `list[tuple[row, col_idx]]`，计数改 `len({col for _, col in cluster})`；参数重命名 `min_support_columns`，面板显示"3 列支持 / 共 13 列"。
- 默认值：待 STZ-A2 实验数据定（先保持 1，行为不变）。
- 判据：构造合成用例——单列 3 个峰、3 列各 1 峰，前者 support=1 后者 3。
- 依赖：无（与 A2 可并行）。
- 落点：同上。

## STZ-A4 共识结果回传诊断量

- 级：P0 ｜ 成本：2h ｜ 状态：OPEN
- 现状：`core.py:2017` 只回 `{horizons_count, pixel_y, depths}`。用户无法判断"这层是 8 列共振还是 1 列孤峰"。
- 做：每层返回 `{row_px, support_columns, member_count, cluster_span_px}`；`SampleOverlay` 线宽/透明度随 `support_columns` 变（弱支持画淡）。
- 判据：返回值含上述四字段；弱支持层在画布上可见地更淡。
- 依赖：STZ-A3（support 语义先修正）。
- 落点：`core.py:2017`、`frontend/src/components/canvas/SampleOverlay.ts`。

## STZ-A5 已知样本数 N 反推参数

- 级：P1 ｜ 成本：6h ｜ 状态：OPEN
- 需求原文（用户）：「用户从论文正文或表格里直接看到样本总数输入'已知样本数 N'自动反推参数，找输出数量最接近 N 的结果」。
- 前提：**N 是外部硬约束**（论文正文/表格给出），不是猜测值。因此用 N 约束候选池合法——不生成数据，只在已有候选里选，不触碰不变量 1。
- 前置门：`H / N ≥ 4px` 才进入搜索（H = ROI 列高 px）。低于此直接报"这张图的信息量不支持 N 层"，不搜索。4px 取自 `#55` 实测的外线断行补值可分辨性下界，同量级复用。
- 双路径（**统一质量度量 = 支持列数 `support_columns`**）：
  - **路径 A（主）**：参数空间搜索。`tol` / `prominence` / `support` 对层位数均单调；先扫 `tol`（1.0–6.0，步 0.25），其余固定，不可达再放 `prominence`。多解时取支持列数中位数最高者。不改候选池，无需额外定义"削的准则"。
  - **路径 B（降级）**：`tol` 压到 1.0 后层位数仍 < N → 加密候选池，按支持列数 top-N。仅在 A 不可达时启用。
- 诊断表（先定位差距来源，再定向调参）：

  | 观测 | 诊断 | 动作 |
  |---|---|---|
  | 层位数 ≪ N，多数层支持列数 ≥5 | 召回不足 | 降 `prominence`、纳入低幅列 |
  | 层位数 ≪ N，多数层仅 1 列支持 | 候选本身是噪音 | 先提 `support` 过滤 |
  | 层位数 ≫ N | 过检 | 提 `tol` / `prominence` |
  | `H/N < 4px` | 图不支持 | 报限制退出 |
- 结果必须标注"参数调优结果"，并显示最终 `tol` 与支持度分布。**不得只报"已生成 600 层"** —— 靠调 tol 凑数得到的不是 600 个真实取样层。
- 判据：
  1. 给定 N=200、H=1500px：产出层位数 ∈ [190, 210]，支持列数中位数 ≥3；
  2. 路径 B 触发时，被削掉的候选中不得包含任何 `support_columns ≥ 5` 的层。
- 依赖：STZ-A1（参数通道）、STZ-A3（支持度）、STZ-A4（回传）。
- 落点：`core.py:1928` 外层加搜索驱动；前端面板加 N 输入。

## STZ-A6 画布单条水平线手动增/删

- 级：P1 ｜ 成本：1d ｜ 状态：OPEN
- 现状：`frontend/src/components/canvas/SampleOverlay.ts`（文件 47 行）是**纯绘制**：`for (const s of samples)` 遍历全部条目画线，无命中测试、无 layer 级事件、无拖拽。条数由 `samples` 决定，任意多。
- 做：overlay 加 hitTest（±4px 带内命中）→ 点击空白插入一条 `source='manual'` 行位 → Alt+点击删除；接入撤销栈（`samples` 已在快照内，`samples.py:27 samples_set` 有全量重写通道）。
- 判据：插入后 `samples.length` +1 且 `source='manual'`，面板与画布同步；撤销可回退。
- 依赖：无。
- 落点：`SampleOverlay.ts`、`SamplesPanel.ts`、`samples.py`。

## STZ-A7 层位拖拽微调

- 级：P2 ｜ 成本：1d ｜ 状态：OPEN
- 做：拖拽单条层位线调整 `row_px`，实时重算 `depth`（`_depth_for_row_px`）。
- 判据：拖拽后 `depth` 与 `row_px` 满足标定关系 `depth = slope*row + intercept`。
- 依赖：STZ-A6。

## STZ-A8 层位覆盖层补 `grid` 颜色

- 级：P1 ｜ 成本：30 min ｜ 状态：OPEN
- 现状：`SampleOverlay.ts:27-32` 只有三支：`auto`（绿）/ `paste`（蓝）/ else（橙，语义为 manual）。`source='grid'` 掉进 else 被画成橙色，与面板的四类统计（auto/paste/manual/grid）对不上。
- 做：补第四支颜色（建议青/紫系，与现有三色可辨）。
- 判据：四种 `source` 颜色互异，与面板图例一致。
- 落点：`SampleOverlay.ts:27-32`。

## STZ-A9 层位锁定（防重算覆盖人工点）

- 级：P2 ｜ 成本：2h ｜ 状态：OPEN
- 现状：重跑共识 = `samples_set` 全量覆盖，用户手调过的层位会丢。
- 做：sample 结构加 `locked: bool`；重算时保留 `locked` 项，合并新检出项（同 `row_px` ±tol 内去重）。
- 判据：锁定一条层位后重算，该条仍在且 `row_px` 不变。
- 落点：`samples.py:27`、`core.py:1928`。

---

# B. 读数精度

## STZ-B1 轴宽量测锚点 + 来源标注

- 级：P1 ｜ 成本：4h + 三图回归 ｜ 状态：OPEN
- 现状：`columns.py:374 measure_axis_stroke` 在 `columns.py:446` 用 `for shift in (0, 1, 2, -1, -2)` 取"±2px 内第一个 std ≤30 且与纸白差 ≥25"的列作锚。抗锯齿左缘列恰好满足这两条（灰 ~120、沿 y 均匀），于是锚点落在过渡列、`level` 取到浅灰，向右第一列即为墨芯（跳变 > `level_tol=25`）→ 量出 1px。S1 图实测：返回 1，真实轴芯 5px（`recon-20261117.md:93`）。后果是 0 点左移 4px，13 列各 +0.95%（1px = 0.238%）。
- **这不是硬 bug**：`axis_stroke` 可由用户任意填（0 = 轴线左缘 / 半宽 = 几何中心 / 全宽 = 右缘），模型本身覆盖了外部文档建议的所有档位。真缺陷是**默认值可能错 4px 且用户看不出这个数是自动测的还是自己填的**。
- 做：
  1. 锚点改"`base±2` 内灰度最深列"作墨芯，再向两侧扩展到半高（50% 深度）——即采纳外部文档的卡尺内核，但不引入交互。
  2. 面板标注来源：`自动(1px)` / `手填(5px)`，两者视觉可辨。
- 判据：三张图（S1 / beginner / fig3）同时回归，0 点位改善且无新回归。
- 风险：0 点这块踩过三次（`HANDOFF.md` 黑名单 D-05：`reference_height` 仍漂、拿轴线当 0 点更差、全图高度校正破坏 fig3 八列）。**任何一项退化即回滚。**
- 落点：`columns.py:374-491`、列设置面板。

## STZ-B2 亚像素读数

- 级：P2 ｜ 成本：2–3d ｜ 状态：OPEN
- 现状：读数是整数像素（`digitize.py:308 _own_run_last_offset(...) + 1`、`digitize.py:311 np.max(xs) + 1`）。
- 收益账：1px = 0.238%，亚像素最多回收 ±0.5px ≈ 0.12%。当前主残差是口径与 0 点（STZ-B1 的 0.95%），不是量化。
- 做：边界处按灰度 50% 亮度穿越做线性插值。
- 判据：合成图上已知真值，误差从 ±0.5px 降到 ±0.1px 以内。
- 顺序：**排在 STZ-B1 之后**，否则是给漏水的桶换量杯。
- 落点：`digitize.py:272 trace_area_profile`。

---

# C. 图形与轴类型

## STZ-C2 断轴列组 + 多段标定

- 级：P1 ｜ 成本：2d ｜ 状态：OPEN
- 需求原文（用户）：「对这种特殊列，用户可以单独编组，并指定 x 轴为断轴，轴标定采取端点前后两端或多段标定点击标定」。
- 现状：`scale_type` 只有 `linear` / `log`，无断轴。
- 做：
  1. 组级 `scale_type='broken'`，配 `segments: [{px_start, px_end, value_start, value_end}]`，每段独立两点标定。
  2. 断点区（段间空隙）内的行不读数。
- 判据：跨断点的行返回 `None`，**不插值**；段内行按各自段斜率换算。
- 落点：`xscale.py` 的 `scale_type` 分支、ColumnGroup 契约、`docs/JSON_RPC_SPECIFICATION.md`、`frontend/e2e/contract.spec.ts`。

## STZ-C5 主填充 + 浅色 Exagg 双层

- 级：P2 ｜ 成本：2d ｜ 状态：OPEN
- 现状：S1 的夸张层是**细线**（`#55`/`#56`/`#57` 已处理，走"外线÷倍率"）。用户提到的**主填充 + 浅色 Exagg 填充**是另一种形态，未做。`twolayer_detect.py:55 band_is_two_layer` 当前只判"该换阈值"，不分离两层边界。
- 做：判据换为"同色系两级亮度 + 外轮廓包络"；边界分离后按亮度层次取外缘，倍率仍由用户手填。
- 判据：合成双层图上，两层边界各自定位误差 ≤2px。
- 落点：`twolayer_detect.py`、`image.py:1469 two_layer_split`。

## STZ-C1 双向正负列

- 级：P2 ｜ 成本：3–5d ｜ 状态：OPEN
- 需求定性（用户）：「就差双向正负（Bidirectional Signed —— 距平与同位素/PCA 列）一个，可以视作一种图形，与面积/折线/标记/bar 并列，记作中期功能请求」。
- 成本真正落在**零线语义**，不在渲染：现状 `zero_px = col.startX + axis_stroke` 是派生量（`ARCHITECTURE.md:282`），双向列的 0 在列内部，必须变成**存储量** → 打穿 `xscale`、export、前端投影、QA 四处。
- 做：
  1. `plot_type='bidirectional_signed'`，配 `zero_px` 显式列级存储。
  2. 扫描方向按 `sign` 分两侧。
  3. 跨度过小者标 `ambiguous`，**禁止**用不确定度强制判 0（见 `decisions-log.md` STZ-C6）。
- 前置：需要 1–2 张真实 δ18O / PCA 图作靶。
- 判据：正负两侧分别与人工读数比对，中位差 ≤1px。
- 落点：契约级改动，需同步 `docs/ARCHITECTURE.md` §6 与全部画布。

---

# D. QA 与诊断旗标

## STZ-D1 三 QA 旗标（不改读数）

- 级：P1 ｜ 成本：1d ｜ 状态：OPEN
- 现状：`qa.py` 只有百分比总和门（`qa.py:38` 的 `include_in_sum` 掩码，`#63` 修过假阳性）。三类静默错无任何信号。
- 做（纯后处理，只加字段）：
  - `FLAG_AXIS_BLIND`：原始跨度 ≤ 轴宽。S1 实况——Quercus 内线 p50 = 4px，修 0 点后 89% 可读行恰为 0；Picea 46%。
  - `FLAG_TRUNCATED`：读数触列右边界 + 相邻两行平坦（超刻度截断峰，图上旁注数字那种）。
  - `FLAG_EXAGG_RATIO`：`ratio=(外线−z0)/(内线−z0) ∉ [3.0, 5.5]`。实测 93.5% 落在区间内、6.5% 在外。
- 判据：旗标不改任何数值字段；S1 图上 `FLAG_AXIS_BLIND` 命中 Quercus 的可读行。
- 落点：`qa.py`、`session_parts/qa.py:155 _qa_horizons`、`frontend/src/components/steps/QaPanel.ts`。

## STZ-D2 `FLAG_COLLISION`

- 级：P2 ｜ 成本：4h ｜ 状态：OPEN
- 做：读数触列边界。判据加结构条件——该行柱高是否为列高主体（柱状图逐行等宽合法触边，面积图渐变触边才可疑），而非只看触边。
- 判据：柱状图上满量程列不误报。
- 依赖：STZ-D1（共用旗标通道）。

---

# E. 清理与去线

## STZ-E1 用户标记横线纳入清理

- 级：P2 ｜ 成本：4h ｜ 状态：OPEN
- 现状：**未验证**。已知 `algorithm_degrid` 支持 `corrections`（restore/erase 双向，`core.py:2065` `rasterize_strokes`），但"用户手画的横线是否进 erase 掩膜"未确认。落地前先读代码，勿照抄本假设。
- 做：使用户标记的横线参与清理，与自动检测横线同等。
- 判据：手工加一条横线后，该行读数恢复为无横线时的值。
- 落点：`session_parts/core.py` 的 degrid / lineCorrections 链。

---

# F. 命名与语义债

## STZ-F1 概念用词纠正 + `y_unit`

- 级：P1 ｜ 成本：4h ｜ 状态：OPEN
- 现状三处错位：
  1. `samples.py:163 samples_from_depth_grid` 的 docstring 写「按**等距网格**生成**层位**」——把"等距网格"与"采样层位"混为一谈，是本轮概念错误的源头。
  2. `depth` 绑死纵轴：y 轴为年代（ka）时，`samples_paste_depths` / `samples_from_depth_grid` / `depth_grid` / `apply_depth_grid` / `start_depth` / `end_depth` 全线语义错位。
  3. 全库无 `y_unit` 概念，只有 `age_depth_model.py:42 depth_unit: str = "cm"` 硬编码。
  4. 该命名绑死**已造成实际行为缺陷**：y 轴为年代时，`sample_grid` 经 `agedepth.py:176` 分支被当深度直通，不做 `primary_axis` 反演 → 见 `STZ-F3`。不是命名洁癖。
- 做（**不动 RPC 字段名**）：
  1. docstring 与 UI 文案改为"按用户给定间隔与区间生成候选层位（适用于已知取样间隔的场景）"，与"拐点共识"并列为两条**同权**入口。
  2. 面板纵轴标签读 `y_unit`（新增，默认"深度"或按标定类型给）。
  3. **补 `start` / `end` 输入**（约 1h）：前端现只传 `{step}`（`SamplesPanel.ts:144`），区间只能吃标定默认值，用户无法指定"从 40 到 200、每 2"。
- 判据：全库 grep 不到把"等距网格"与"采样层位"等价的表述；且面板可指定起止并生效。
- 落点：`samples.py:107-163` 的 docstring、`frontend/src/types/pollen.ts:380`、`frontend/src/components/steps/SamplesPanel.ts:134`、`ARCHITECTURE.md` 相关段。

## STZ-F2 `depth` → `sample_grid` / `axis_value`

- 级：P2 ｜ 成本：1d ｜ 状态：OPEN
- 命名原则：它承载的是**一组样品位置**，不是"纵轴上的等分点"。故目标名 `sample_grid`——单位由 y 轴当前单位决定（cm / ka / m / 任意），**均匀与非均匀都装得下**。忌用 `y_grid`（`grid` 暗示等分）与 `depth_grid`（绑死深度）。
- 范围：

  | 现名 | 目标名 |
  |---|---|
  | `self.depth_grid` | `self.sample_grid` |
  | `samples_from_depth_grid(step, start_depth, end_depth)` | `samples_from_grid(step, start, end)` |
  | `samples_paste_depths(depths)` | `samples_paste_positions(positions)` |
  | `apply_depth_grid(depths, start_depth, end_depth, step)` | `apply_sample_grid(...)` |
  | `_depth_for_row_px` | `_axis_value_for_row_px` |
  | `_uniform_depth_list` / `_depth_grid_frame` | `_..._sample_grid_..` |
  | sample 结构 `"depth"` 字段、`SampleOverlay.ts` 的 `s.depth` | `"axis_value"` |
  | `age_depth_model.py:42 depth_unit="cm"` | `y_unit`（无默认，由标定提供） |
- 破坏性：RPC 字段级变更，需同步 `docs/JSON_RPC_SPECIFICATION.md` + `frontend/e2e/contract.spec.ts` + 兼容期（旧字段保留一个版本）。
- 建议：**排在 STZ-F1 之后一个版本**。纯改名不值当打断当前工程；但 `STZ-F3` 的行为修复不依赖本项，可先行。
- 判据：改后 `pixi run test-contract` + `test-e2e` 全绿。

## STZ-F3 sample_grid 分支缺 primary_axis 反演

- 级：P1 ｜ 成本：3h ｜ 状态：OPEN
- 现状：`agedepth.py:135 sample_depths_for_model` 三个来源分支处理不一致：

  | 分支 | 读 `primary_axis` | 行为 |
  |---|---|---|
  | ① `column_points`（图上 Y 读数） | **读** | `axis=="age"` 时 `model.predict_depth()` **反演** ✓ |
  | ② `self.depth_grid`（sample_grid） | **不读** | 直通，元数据写死 `"primary_axis": "depth"` ✗ |

- 失败链条：y 轴声明 age → 用户按 `step=2`（ka）生成 sample_grid → `depth_grid` 存的是 **ka 值** → 分支 ② 当成 cm 深度 → 年龄模型把 `2` 当 2cm 查年代 → 定位全错，**不报错、结果看似合理**。
- 这正是该函数 docstring 自己在分支 ① 警告的失败模式（"wrong-but-plausible position with no error to notice"），分支 ② 犯了同一个错。
- 证据等级：**已运行时复现**（GitHub #81 评论，含脚本与对照组输出）。三条同时满足触发：`primary_axis="age"` + `sample_grid` 非空 + 已加载 age-depth model。
  实测对照：同 `primary_axis="age"` 下，分支 ① 调 `predict_depth` 并反演，分支 ② 不调、直通、且 `meta` 谎报 `primary_axis="depth"`。
- 做：分支 ② 加 `primary_axis` 判断，与分支 ① 同口径——`axis=="age"` 时按 `model.predict_depth()` 反演，元数据如实写 `primary_axis` / `depth_source`。无 age model 时报 `STATE_ERROR`（照抄分支 ① 的报错语义，不静默降级）。
- 判据：y 轴声明 age、`fromGrid(step=2)` 生成后，分支 ② 返回的深度序列 == `model.predict_depth(ka 序列)`，且与分支 ① 对同一批行的结果一致；不一致即失败。
- 验证脚本要点：`primary_axis="age"` + 有 model + sample_grid 非空，三条同时满足才进分支 ②；缺 model 必须报错而非返回 ka 原值。
- 落点：`agedepth.py:176-181`。
- 关联：`STZ-F1` 仅改文案不动此处；本项是行为修复，独立可做。

---

# DEFERRED（留档，附触发条件）

## STZ-C3 双向对称纺锤图

- 级：P3 ｜ 成本：未估 ｜ 状态：DEFERRED
- 现状：无支持。纺锤图宽度表示数值，左右对称，语义与"双向正负"不同（无符号只有幅度）。
- 建议：若做，与 STZ-C1 共用"零线在列内部"的契约改造，一次做完；单独做不划算。用户已定性为「未必做」。
- **触发条件**：用户提供 ≥2 张真实纺锤图（且有明确的宽度-数值对应关系），且 STZ-C1 已落地。

## STZ-C4 误差棒图型

- 级：P3 ｜ 成本：未估 ｜ 状态：DEFERRED
- 现状：无支持。当前取"最右墨迹"，遇误差棒会**读成上限**（系统性高估），与截断峰现象有交集。
- 建议：三件必须先定 ——① 误差棒识别（横帽 vs 竖杆）；② σ 还是 1.96σ（**不可从图上推断，必须用户给**）；③ 被列边界切断时怎么办。
- **触发条件**：≥3 张带误差棒的真图 + STZ-D1 的 `FLAG_TRUNCATED` 已落地 + 用户能提供每图的 σ 倍数。

## STZ-B3 line 图描边半宽

- 级：P3 ｜ 成本：未估 ｜ 状态：DEFERRED
- 现状：`plot_type=line` 取最右墨迹 = 中心 + 半线宽。算过账：线宽 3px → 误差 ≈0.36%；7.5px → ≈0.89%。
- 建议：不做独立参数。若真需要，走**列级读数端偏移**（与 `axis_stroke` 对称），但两个偏移量容易被误用。
- **触发条件**：实测出现线宽 >7.5px 的图（此时误差与 STZ-B1 的轴宽误差同量级）。

## STZ-E2 分带线邻域保护

- 级：P3 ｜ 成本：未估 ｜ 状态：DEFERRED
- 现状：不做破坏性擦除（矢量候选 → 栅格化 → 反向掩膜，`ARCHITECTURE.md:385-400`），无连通性破坏。但存在"横线几何压在填充上 → 该段像素被排除 → 该行读数偏小"。
- 建议：先做 STZ-E1，多数场景够用。用户已定性"不急切"。
- **触发条件**：STZ-E1 落地后仍能举出 ≥3 处"横线穿过填充导致读数明显偏小"的实例，且已量化偏差。

---

# 年代-深度模块待办规划（2026-11-24）

## STZ-AD-01 主图“双 Y 轴”原生直接标定

- 级：P3 ｜ 成本：2d ｜ 状态：DEFERRED（中远期待办）
- 现状：大量发表的孢粉图直接在主图左右两侧标注深度轴（左）与年代轴（右）。当前必须截下两轴另存图片并在年代深度弹窗中做四点标定，链路断裂且引入二次像素拾取误差。
- 建议：在步骤 3 允许标定主轴（Depth）与副轴（Age），直接在主图画布建立深度与年代的转换映射，免去截图与弹窗跳转。
- **触发条件**：中远期规划，优先在多 ROI / 复合坐标轴重构阶段统一排期。

## STZ-AD-02 Hiatus 沉积间断与滑塌分段非连续样条拟合

- 级：P2 ｜ 成本：1d ｜ 状态：DEFERRED（中期待办）
- 现状：当前拟合全线采用全局连续样条（Spline/PCHIP）。在沉积间断（Hiatus）或突发堆积层（Slump/Event layer）处，年代在极小深度内阶跃跳变，连续样条会产生剧烈过冲振荡（Runge 现象），导致间断面附近沉积速率出现虚假极值或负值。
- 建议：支持在年代深度画布上添加 Hiatus 深度切分线，对间断面上下的层段执行分段独立样条拟合，断点处允许年代阶跃。

## STZ-AD-03 14C 测年点原文数据表导入与模型对接

- 级：P2 ｜ 成本：1d ｜ 状态：DEFERRED（中期待办）
- 现状：测年点目前依赖在图上手动点击拾取十字线（含深度、年代、误差）。由于科研论文原文通常附有完整的测年点表格（包含测年编号、深度、14C 年代、误差、日历校正区间等），手工图上拾取费时且精度受限。
- 建议：支持从剪贴板或 CSV 直接粘贴导入标准测年表格，直接对齐至年代深度模型，无需图上重复拾取。

## STZ-AD-04 核心数据 data.csv、age_depth.csv 与 ensemble.csv 关系型分工解耦

- 级：P2 ｜ 成本：1.5d ｜ 状态：DEFERRED（中期待办）
- 现状：`export_data` 目前在检测到年代模型时，将 `age_est`、`age_lower_95`、`age_upper_95` 强行追加合并进 `data.csv`，使核心花粉数字化矩阵与模型衍生列混杂。
- 建议（用户 2026-11-24 方案）：
  1. `data.csv`（核心数据）：仅保留 `horizon_id`、主图原生 Y 轴物理列（`depth` 或 `age`）及数字化属种列；
  2. `age_depth.csv`（深度-年代表）：存放 `horizon_id`、`depth`、`age`、`age_lower`、`age_upper`、`sed_rate` 等模型评估结果；
  3. `ensemble.csv`（集成表）：存放 `horizon_id`、`depth` 及 1000 组蒙特卡洛抽样列；
  4. 三表通过规范的共识层位主键 `horizon_id`（统一 4 位定长补零格式 `H0001`, `H0002`...）实现 Tidy Data 式关系型 Join。深度单位全软件绝对统一为 `cm`（彻底清理 `m`）；年代单位严格规范为 `cal yrBP`。当前代码库已全链路落地 `H0001` 层位主键生成与单位规范化治理。
