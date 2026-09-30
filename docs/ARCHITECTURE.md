# Straditize Pro 架构与设计规范

> **本文是活的设计文档**：记录系统架构、不可违反的设计不变量与统一交互规范。
> 操作手册（命令 / 验收 / 交接）见 `AGENTS.md`；跨会话断点见 `HANDOFF.md`；
> 早期需求任务书见 `TASK_SPEC_V2_FINAL.md`（历史件，不再更新）。

---

## 1. 系统架构

```text
浏览器 (唯一入口: http://127.0.0.1:8765/)
   │  同源 HTTP
   ├─ GET /            后端托管的前端静态资源 (frontend/dist)
   ├─ POST /rpc        JSON-RPC 2.0
   └─ GET /image/*     会话图像 (current / slice / preview / agedepth)

frontend/  (TypeScript + Vite, 无框架)
   ├── components/  Canvas 主画布、工具栏、侧边栏、属性检查器、各弹窗
   ├── core/        Viewport(坐标变换) · HistoryManager(撤销) · SplineInterpolator · TarArchive
   ├── services/    RpcClient (JSON-RPC over HTTP)
   └── i18n/        中英文字典与运行时

straditize_core/  (Python 3.12 + NumPy/SciPy/scikit-image, 无 GUI 依赖)
   ├── session.py      会话状态机与业务编排
   ├── rpc_server.py   HTTP/Stdio 双协议 · 访问控制 · 静态资源托管
   ├── columns.py      分列基线探测
   ├── curve.py        拐点提取与轮廓压缩
   ├── calibration.py  两点式标定 (Linear / Log)
   ├── age_depth.py    年代-深度识别、提取与不确定性
   ├── ocr/            OCR 与科属词典
   └── image.py        去网格 · 二值化 · Radon 倾斜检测

straditize/  (上游第三方 PyQt5 原版, 本项目不维护)
   └── 仅作为内置范例的图片资源被引用
```

**关键点：后端同时托管前端**，因此浏览器**始终同源**，不需要任何跨源例外。
这既是安全设计（见 §3），也是开发模式下必须用代理（而非放开跨源）的原因。

---

## 2. 数据来源不变量（最重要的一条）

> **面向用户的数据只有唯一合法来源：后端对用户输入的真实计算。**
> 取不到就报错并停在原地，**绝不返回替代数据**。

对科研工具而言，伪造数值的代价是用户可能把它写进论文，因此这条优先于"体验友好"。

**已清除并禁止回退的反模式：**

| 反模式 | 曾经的伪装 |
| --- | --- |
| 等分切割 | 冒充"算法识别出的分列边界" |
| 随机抖动 | 冒充"提取到的曲线控制点" |
| 固定名单轮询 | 冒充"OCR 识别结果" |
| 前端自算 CSV | 冒充"后端导出数据" |
| 后端失败时静默降级 | 冒充"正常可用" |
| 未载图时回落内置范例 | 冒充"用户自己的工程" |

**执行约束**：`RpcClient.call()` 只有两条路径（离线即抛错 / 真后端）；
`tests/integration/test_no_fabrication.py` 是守卫测试，不得放宽。

---

## 3. 访问控制与远程访问

后端**没有任何认证**，安全边界由"只监听回环 + 以下两道校验"构成。

| 校验 | 目的 |
| --- | --- |
| `Host` 必须是回环（或显式绑定的主机） | 阻断 **DNS rebinding**：攻击者域名解析到 127.0.0.1 时 Origin 与 Host 会同时是攻击者域名，仅比对二者会被绕过 |
| `Origin` 若存在，必须与请求自身 Host 同源（或命中白名单） | 阻断 **CSRF**；浏览器对**同源 POST 也会发送 Origin**，故同源必须放行 |
| 绝不回显 `Access-Control-Allow-Origin: *` | 该头一旦存在，**用户浏览的任意网页都能读写本机后端**（CORS 允许读取响应） |

**远程使用（前后端不同机器）——推荐 SSH 隧道：**

```bash
ssh -L 8765:127.0.0.1:8765 用户@远端主机
# 然后本机浏览器打开 http://127.0.0.1:8765/
```

隧道方案下浏览器看到的是**同源回环地址**，因此**不需要 token、不需要 `--host`、不需要放行防火墙**，
且流量加密。**不要**用 `--host 0.0.0.0` 直接暴露到局域网。

**为什么不做账号 / 密码 / token**：这是单用户单会话工具（`StraditizeSession` 为单例，多人会互相覆盖状态），
账号体系意味着改密 / 找回 / 哈希存储 / 会话管理等纯负债。真正需要多人的场景应各自跑一个后端。

---

## 4. 统一交互规范

**全画布一致**：主画布与所有辅助画布（OCR 框选、旋转预览、年代弹窗）必须支持同一套手势。

| 鼠标 | 行为 |
| --- | --- |
| **右键拖拽 / 中键拖拽 / 空格+左键** | 视口平移（**三者等价**，任何画布都不得只支持其中一部分） |
| 滚轮 | 以光标为锚点缩放；`Shift`/滚轮 与 `Alt`/滚轮 水平 / 垂直平移 |
| 左键单击 | 选中 / 插入锚点 / 空白处取消选中 |
| 左键双击 | 空白处适应屏幕；锚点聚焦 |
| 左键拖拽 | 微调锚点、列边界、ROI 手柄 |
| 右键单击 | 删除锚点；退出临时工具返回选择模式 |
| **方向键** | 选中项 1px 微调；`Shift`+方向键 10px |

| 键盘 | 行为 |
| --- | --- |
| `A` / `S` / `D` / `C` | 加点 / 微调 / 删点 / 加列（对齐 WebPlotDigitizer） |
| `H` / `R` | 抓手平移 / ROI 取数区 |
| `K` / `Y` | 线掩膜人工修正笔刷 / Y 轴两点标定 |
| `M` | 像素测量尺（步骤 4）：在图上拖一条线，读出 `Δx / Δy / 距离`（图像像素）|
| `F` / `Ctrl+1` | 适应屏幕 / 1:1 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Delete` | 删除选中项 |
| `Ctrl+[` / `Ctrl+]` | 折叠左侧属种列表 / 右侧属性检查器 |
| `F1` | 交互指南 |

**禁止**：为某个画布单独定义一套手势；把已废弃的键位留在 tooltip / 注释 / 文档里
（历史教训：一条"黑名单禁辅助画布右键"的残留说法，导致年代弹窗长期与主画布行为不一致）。

---

## 5. 工作流状态机 S0–S7

```text
S0 空状态 → S1 载入 → S2 ROI 取数区 → S3 分列 → S4 标尺标定 → S5 拐点精修 → S6 校验 → S7 导出
```

⚠️ 上面是**设计稿编号**，与已实现 UI 的步骤号**不一致**（设计稿漏了「清理」与「标定列」）。
UI 的权威步骤号只有一处：`frontend/src/types/workflow.ts` ——
`1 载入 → 2 ROI → 3 Y 轴标定 → 4 清理 → 5 分列 → 6 标定列 → 7 拐点与采样层位 → 8 校验`。
下文提到阶段时若用 `S<n>` 一律指设计稿编号；指 UI 步骤时写「步骤 n」。

定义见 `frontend/src/types/workflow.ts`。阶段与可用工具的映射是**唯一事实源**：
`GeologyCanvas.getAllowedTools()` —— 浮动工具条置灰、键盘守卫、鼠标编辑路径三处都必须走它。

工具模式（`types/pollen.ts` 的 `ToolMode`）与阶段：

| 键 | 工具 | 起始阶段 |
| --- | --- | --- |
| `R` | ROI 取数区手柄 | S2 |
| `K` | 线掩膜人工修正笔刷（擦掉误标 / 补回漏标） | 步骤 4（清理） |
| `Y` | Y 轴两点标定（点两个参考行 → 填真实值） | S4 |
| `A` / `S` / `D` / `C` / `H` | 加点 / 微调 / 删点 / 加列 / 平移 | 见 §9.6 |

进入 `K` 笔刷时**强制打开 B 键叠加层**：看不见掩膜就等于闭眼涂改。

---

## 6. 坐标真值源与标定

**两点式物理刻度钉**（放弃 0–100% 相对假定）。`startValue`/`tickValue` 为物理值，
`startX`/`tickEndX` 为对应像素：

$$\text{Linear: } v(x) = s + \frac{x - x_s}{x_t - x_s}(t - s)$$
$$\text{Log: } v(x) = \exp\left(\ln s + \frac{x - x_s}{x_t - x_s}(\ln t - \ln s)\right)$$

**Log 硬约束**：`startValue > 0`、`tickValue > 0`、二者不等；界面即时禁用并提示，绝不静默退化。

### 6.0 列分组与标度统一解析源（2026-09-29 v2 设计）

为彻底杜绝「两条换算链导致同一列在 CSV/Parquet 与 XLSX/LiPD 导出不同数值」的历史顽疾，
前后端所有换算点（导出、网格采样、QA 校验、前端投影）统一收口至单一解析入口：
- 后端：`straditize_core.session_parts.xscale::resolve_column_scale`
- 前端：`CoordinateSystem.resolveColumnScale`

**ROI 内列分组架构 (D1 / D2 / D3)**：
1. **组在 ROI 内**：组共享 **单位 / 图形形态 / 尺度类型 / 放大倍数 / 刻度位置**；刻度**数值**留在每列上（D1: 组管形式与位置，列管满量程数值）。
2. **重新分列数值保全**：重新分列时，若本 ROI 列数不变，自动回填列级标定数值并施加区间守卫（刻度像素落在列边界 `[start-10, end+10]` 内），避免改名或重分列静默清空标定。
3. **多 ROI 工程包承载 (D3)**：`project_save` 与 `project_load` (v3.0.0) 完整承载多 ROI、各 ROI 内列组与每列 `roi_id` / `x_group_id` / `x_values`，旧版 v2.x 工程载入时自动按 D2 逐列一组保真迁移。

**关键区分（易错）**：

- **ROI（数据有效区）是"取数区域"，不是标尺**。它与深度/时间标定**相互独立**：
  标定刻度选在哪里，不得影响取数区域，反之亦然（历史上二者耦合，导致"换个标定就静默截断曲线"）。
- 后端 `suggest_data_region()` **只给区域、不给深度**；深度只能来自用户在 S4 的两点标定。
- 逐列百分比同理：每列印出的最大刻度值只能**人读**，禁止推断或填默认值冒充。

### 6.1 数据模型（前端）

两者是 `DiagramData` 上**两个互不派生的字段**：

```ts
roi:         { xMin, xMax, yMin, yMax }                 // 只框取数范围
calibration: { isCalibrated, top_px, top_cm,
               bottom_px, bottom_cm, unit, ... }        // 只描述像素行代表什么数值
```

- 未标定时 `isCalibrated === false` 且四个端点为 `null`。`CoordinateSystem.calibrationBounds()`
  是**唯一判定入口**：取不到就返回 `null`，深度一律显示 `--`。**禁止**任何
  `top_px ?? dataYMin` 式的回落——那正是把"框选数据的方框"当成时间轴的老路。
- 层位标尺（`SplineInterpolator.getStandardDepthHorizons`）铺在**标定跨度**上，与 ROI 无关；
  未标定时返回空数组，不生成假刻度。
- 两个参考点的 `val` 可向下递增（深度）或向上递增（年代），方向由数值本身决定，不做假设。
- 后端对应 `session.depth_calib`，与 `data_xlim/data_ylim` 同样互不派生；
  `project_save` 分 `depth_calibration` / `roi` 两个键写入，读回也不许互相兜底。

---

## 7. 分列 → 数字化的数据流

```text
core.loadImage          → 载入图像 + suggested_roi（仅区域）
core.detectColumns      → 列边界（data_xlim / data_ylim 为参）
roi.update              → 取数区域（frontend↔backend 同步；不碰标定）
algorithm.detectLineCandidates → ROI 内的候选干扰线几何（status=candidate，不动像素）
algorithm.applyLineRemoval → 重新合成线掩膜 + B 键 QC 叠加层（不改输入）
core.digitize(col)      → 该列曲线控制点（纯像素几何，线圈在 ROI 内并被线掩膜扣除）
core.calibrateAxes      → y_scale（深度，来自用户两点）+ x_scales[col]（百分比）
core.extractGridValues  → 按标准深度层位求交，未观测填 0.0（绝不输出 NA）
core.exportData / project.save
```

**注意**：`digitize` 是纯几何，不需要标定；`x_scales` 缺失时**不得**拿列宽当 100% 冒充读数。

### 7.1 线去除（干扰清理）

数据流上只有**一份**掩膜，由后端产生。Step 4 的模型是
**「矢量候选几何 → 栅格化 → 反向掩膜提取」**（等价于 GIS 的反向掩膜）：

```text
ink = foreground_mask                      # 原始墨迹，分列检测仍看这一份（不被就地修改）
candidate_line_mask = 栅格化(status == "removed" 的 geometry)
exclusion_mask      = 栅格化(排除区；绝对优先)
manual_erase / manual_restore = 栅格化(笔迹)

line = (candidate_line_mask | manual_erase)
line &= ~(manual_restore & ~exclusion_mask)
grid_line_mask = line | exclusion_mask          # 单一合成点：_rebuild_grid_line_mask()
digitize 用 ink & ~grid_line_mask & roi_mask
```

⚠️ 后端 `_recompose` 仍会把一个 `degrid_line_mask` 并进上式（`_rebuild_grid_line_mask()`），
但**前端已无任何调用方**：`algorithm.degrid`（档位式自动去线 + 笔迹 corrections）是已下线的
旧模型，仅作为后端能力保留。`degrid_line_mask` 默认 `None`，因此该项恒为空集。
下线的理由：档位是把"阈值 + 竖线开关 + 笔迹"三件事捆在一个预设里，用户无法判断某一档
到底动了哪些像素；现行模型把控制权拆成**可见的几何**（哪条线、多厚、多长）与**笔迹**
（哪几个像元），二者都能单独增删改，且与 `algorithm.detectLineCandidates` 的判据同源。

- **geometry 是唯一几何真相**：`geometry: {type:'rect', x0,y0,x1,y1}`（ROI 内像素矩形）。
  `at` / `span` / `width` / `kind` 都是后端按它**派生**的显示字段，前端不得反向写回。
- **检测与删除解耦**：检测只产出 `status="candidate"` 的几何（琥珀色，**不动任何像素**）；
  用户确认后才置 `status="removed"`（红色，实际剔除）。**没有"灵敏度"旋钮**：
  旧档位（弱/中/强）已随旧模型下线，详见上面 ⚠️。
- **判据是「够长 + 够薄」**：形态学开运算保证线足够长（相对 ROI 跨度，
  默认 `line_fraction_h=0.75` / `line_fraction_v=0.30`），
  垂直于线方向的墨迹厚度必须 ≤ `line_width_max`（默认 2px，由 `resolve_width_max()` 兜底）。
  这两组值定义在 `straditize_core/lines.py`，是后端常量，前端不暴露旋钮。
  真实花粉实心轮廓被横线穿过处厚达数十像素，因此**豁免**。
- **历史缺陷（已修）**：旧实现是"某行横向 run 超过阈值 → 删掉整行"，
  实测在内置 Hoya 图上 ROI 墨迹的 **55–70%** 被标成线，其中 **95%** 是 ≥4px 的实心轮廓，
  *Pinus* 列 **99%** 被抹掉——而那张图 ROI 内横向贯穿 run 行数为 **0**，即全是误标。
- **前端不得自行判定"哪条是线"**：`overlay_png` 是唯一事实源，B 键透视与数字化用的是同一批像素。
- **几何编辑语义**（步骤 4 画布）：选中几何后有两类手柄，形状与配色必须一眼可分——
  **白色方块 = 端点，改长度 `span`**；**青色圆点 = 长边中点，改厚度 `width`**。
  手柄坐标由叠加层 `bandOf()` 统一给出（含薄线的最小屏幕厚度补偿），
  命中测试与绘制共用同一条带，否则 2px 的真线在缩略视图上会"看着抓到、实际抓空"。
  拖动整体平移；方向键 1px（`Shift` 10px）精调；改厚度时中心行 `at` 不动，
  保证原本压对行的线改完仍压对行。
- **删除键归属**：步骤 4 删除几何**只认 `Delete` / `Backspace`**；`D` 是步骤 5 起的
  「删点」工具模式，在步骤 4 按下只会给出"尚未启用"提示，绝不删除几何。
- **统一厚度**：侧栏可填一个像素值，一键把选中 / 本 ROI 全部几何改成该厚度
  （`algorithm.setLineThickness`）。配合 `M` 测量尺先量后填，避免逐条手调。
- **候选 id 是不透明身份，不得编码可变事实**：id 由会话级单调计数器铸造
  （`line_{axis}_{n}` / `manual_{axis}_{n}`），**禁止**再出现 `line_h_{at}_{w}px`
  这类写法——第一次方向键微调就改了 `at`、改厚度又改了 `width`，id 会一直宣称
  已经不成立的事实。当前事实一律从 `at` / `width` / `span` / `geometry` 读。
  且 id 必须**跨 ROI、跨删除全局唯一**（状态切换与删除都按 id 全局匹配），
  故不能用 `len(line_candidates)+1` 这类会因删除而复用的值来铸造。
- **待提交的微调必须先落库再执行别的几何写操作**：方向键微调是「本地即时改 +
  500ms 防抖提交」。所有 Step 4 几何写操作都经前端 `runCleanupAction` 单一入口，
  它**先 `await flushPendingGeometryEdits()` 再执行动作**。否则两个 RPC 同时在途、
  顺序无保证：实测微调后 60ms 内删除，删除先落地（22→21），延迟的 upsert 后到，
  被删的几何**原地复活**（21→22，且带着微调后的 `at`）。
- **点击画布空白处必须清掉几何选中态**：空白分支要同时清 `selectedEntity` 与
  `selectedGeometryId`；只清前者会让侧栏那一行持续高亮、画布持续画手柄，
  表现为"取消了但没取消掉"。
- 人工修正分两层，**职责不重叠**：
  - **geometry**（承载工具）：整条横/竖线，可增删改、可复用；
  - **笔迹**（修补工具）：只处理 geometry 漏标/误标的**局部像元**，不画线。
  笔迹以折线 `{id, mode: 'erase'|'restore', radius, points}` 落库而非位图，
  随 `straditize.json` 的顶层 `line_strokes` 持久化（`straditize.getDiagramData` 平铺下发）。
  写成折线而非位图是为了**可重放**：改 ROI、改几何后掩膜会变，笔迹按新尺寸重新栅格化。
  提交方式是**全量覆盖**：前端把当前全部笔迹交给 `algorithm.applyLineRemoval` 的 `strokes`，
  后端不做增量合并——增量语义在多入口（画布涂抹 / 侧栏清空 / 撤销）下必然分叉。
  清空笔迹只清笔迹（把空数组**显式**交给 `strokes` 再合成），**不动** geometry 与排除区；
  要连几何一起清走 `algorithm.clearCleanupEdits`。
  ⚠️ 清空必须走**全量覆盖**（前端统一入口 `RpcClient.setLineStrokes([])`），不能只发一次
  "不带 `strokes` 的重算请求"——`strokes is None` 的语义是**保持原值**，那样会表现为
  "界面提示已清空、掩膜一点没变"（实测过的失效形态）。

#### Step 4 RPC 契约

| 方法 | 作用 | 返回 |
| --- | --- | --- |
| `algorithm.detectLineCandidates` | 投影检测，产出 `status="candidate"` 几何 | `{candidates, roi_id}` |
| `algorithm.upsertLineGeometry` | 新建（`candidate_id` 为空）或移动/缩放几何 | 清理状态 |
| `algorithm.deleteLineGeometry` | 删除一条几何 | 清理状态 |
| `algorithm.setGeometryStatus` | 确认(`removed`) / 撤回(`candidate`) | 清理状态 |
| `algorithm.setLineThickness` | 把选中(`candidate_id`)/本 ROI 全部几何统一成指定像素厚度，中心行不动 | 清理状态 |
| `algorithm.clearCleanupEdits` | 清空本 ROI 的几何 + 排除区 + 笔迹 | 清理状态 |
| `algorithm.applyLineRemoval` | 重新合成掩膜；可选 `strokes` **全量覆盖**笔迹 | 清理状态 |
| ~~`algorithm.degrid`~~ | **已下线**，后端保留但前端无调用方（见上文 ⚠️） | `DegridResult` |

「清理状态」= `{roi_id, stats, candidates, selected_ids, overlay_png, overlay_legend}`，
**这六项必须整体回灌前端**。`stats` 是面板显示的唯一数字来源。

`straditize.getDiagramData` 必须平铺下发 `line_candidates` / `selected_candidate_ids` /
`exclusion_regions` / `line_strokes`，并附 `cleanup: {roi_id, stats, legend}`。
—— 历史事故：这几个键曾**只**出现在完整分支，前端 `data.line_candidates ?? []`
于是在每次刷新时把它解析成 `[]`，用户一进 Step 4 或一拖 ROI，几何就全部从画布上消失。

---

## 8. 前端构建与产物

- `frontend/dist` **不入库**（`frontend/.gitignore`），且 `pyproject.toml` 显式 `exclude = ["frontend*"]`。
  因此**全新克隆必须先构建前端**，否则后端托管不到界面（会在 `/status` 给出提示）。
- Node.js ≥ 20 是**运行必需**，不是"仅开发需要"。
- 前端包管理**统一为 npm**，锁文件只有 `frontend/package-lock.json`。
  （曾同时存在 `pnpm-lock.yaml`：CI 用 npm 而 pixi 任务用 pnpm，两份锁必然漂移，已统一。）
- 开发模式用 Vite 代理保持同源（`frontend/vite.config.ts`），**不要**为此放开后端跨源。
  代理的 `changeOrigin` 必须为 `false`，否则 Host 被改写会触发同源校验拒绝。

---

## 9. 不变量速查（code review 用）

1. 数据只能来自后端真实计算；取不到就报错，禁止替代数据。
2. 平移手势全画布一致：右键 / 中键 / 空格+左键。
3. ROI ≠ 标尺；`suggest_data_region()` 不给深度；未标定 → 深度为 `--`，**禁止**
   `top_px ?? dataYMin` 式回落（`calibrationBounds()` 是唯一判定入口）。
4. 每列刻度值只能人读，不得填默认值冒充。
5. 绝不回显 `Access-Control-Allow-Origin: *`，绝不放开跨源换开发便利。
6. 阶段→工具表只有 `getAllowedTools()` 一份。
7. 画布叠加层用**固定高对比色**（主题色会消失在用户图上）；UI 文字必须用主题变量。
8. 改 RPC 契约必须同步前端、测试与本文档。
9. 线掩膜只有一份、由后端产生（`overlay_png` = B 键所见 = 数字化所用）；
   前端禁止自行判定"哪条是线"。
10. 线去除判据必须含**厚度上限**（够长 + 够薄）；禁止按行/列整条删除。
11. 落在 ROI 之外的数据一律不存在；整列在 ROI 外必须**报错**，不得静默产 0。
12. **画布叠加层在「世界坐标」下绘制**：`*Overlay.ts` 在 `applyTransform` 之后执行，
    ctx 已带 world→screen 变换，因此**禁止**再调 `vp.worldToScreen()`（会变换两次，
    几何被画到错误位置）。需要屏幕恒定尺寸时用 `1 / vp.scale` 反算。
    历史事故：`CleanupOverlay` / `XTickOverlay` / `SampleOverlay` 三个叠加层都犯过此错，
    表现为"检测到了但前端什么都看不到"。
13. 叠加层异常**逐个**上报，禁止整体 `catch {}` 吞掉：静默吞异常与"没检测到"无法区分。
