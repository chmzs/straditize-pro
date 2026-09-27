# 冻结契约 v1.3（数据模型 / 派生量 / RPC / 单一事实源）

> **这是唯一事实源。** 任何任务单需要增删字段或改 RPC，**必须先改本文件并升版本**，
> 并在单子里引用版本号。**单子不得自行发明字段名。**
> 违反即触发任务单体系红线 5（改契约不同步文档）。

- **版本**：v1.3
- **冻结日期**：2026-09-20
- **前置**：**`T00-b` 已通过**（结论见 §7）；`T00-a`/`T12` 按决策延后（暂不阻塞主干工作流贯通）；`T00-c` 裁决 D 类剔除
- **配套**：设计稿 `2026-09-20-8step-workflow-redesign.md`；任务单 `2026-09-20-8step-workflow-tickets.md`

---

## 1. 为什么需要这份文件（历史缺陷）

上一版任务单让 T01/T07/T09/T12 各自声明字段，结果是**同一件事有四种说法**：

| 冲突点 | T01 说 | T07 说 | T09 说 | T12 说 |
| --- | --- | --- | --- | --- |
| 标度事实源 | `defaults.tickValue` + `override`，由 `effective_column_settings` 合并 | 事实源是 `Column.xTicks`，旧模型已推翻 | 读 `effective_column_settings.tickValue` 当"满刻度" | — |
| 徽章数据来源 | `effectiveColumnSettings` | 又说来自 `effectiveColumnSettings`（旧版残留） | — | — |
| 倍数来源 | `defaults.exaggerationMult` | — | — | 需要 `mult_source`，但 T01 没有 |

**根因**：把"继承/合并"与"具体值"混在一起，于是"谁是事实源"变成每张单子各自解释。
**v1 的解法**：**取消一切继承与合并**。所有值都是**具体值**；
ROI 上的表单值只是**表单记忆**，应用它是一次**写动作**，不产生任何"派生关系"。

---

## 2. 实体（字段即契约）

### 2.1 `DataRoi`

```ts
interface DataRoi {
  id: string;                 // "roi_1"，创建后不变
  name: string;               // 唯一；^[\w\u4e00-\u9fa5-]{1,31}$
  name_source: 'default' | 'user';   // 默认名 vs 用户命名（导出就绪清单据此判断"是否已命名"）
  composition: boolean;       // true = 各层位总和应 ≤ 100%
  visible: boolean;
  xlim: [number, number];
  ylim: [number, number];
  columns_stale: boolean;     // **per-ROI**（不是全局）：本 ROI 的掩膜变过，分列可能已失效
  form_defaults: XScaleForm | null;  // **仅表单记忆，不参与任何计算**（见 §3）
}
```

### 2.2 `XScaleForm`（只是表单）

```ts
interface XScaleForm {
  plotType: 'area' | 'bar' | 'line' | 'symbol';
  startValue: number;
  step: number;               // 刻度区间值（几何路径用）
  unit: string;
  scaleType: 'linear' | 'log';
  exaggerationMult: number | null;
}
```

### 2.3 `Column`

```ts
interface Column {
  id: string;
  name: string;               // 同一 ROI 内唯一（§5）
  roi_id: string;
  startX: number; endX: number;
  visible: boolean;
  color: string;

  /** 标度的**唯一事实源**：两个真实刻度端点（像素 + 读数）。null = 未标定。 */
  x_ticks: [Tick, Tick] | null;

  /** 逐列具体值（**不是继承**） */
  plot_type: 'area' | 'bar' | 'line' | 'symbol';
  scale_type: 'linear' | 'log';
  unit: string;
  exaggeration_mult: number | null;          // null = 无局部放大
  mult_source: 'user' | 'inferred' | null;   // null 当 exaggeration_mult 为 null

  control_points: Point[];
}

interface Tick { px: number; value: number; }
```

**已删除的字段**（不得再出现）：
- `override` —— 继承机制已取消
- `startValue` / `tickValue`（列级）—— 读数只在 `x_ticks` 里，满刻度是**派生量**（§4）
- `scaleCalib` —— 旧结构，由 `x_ticks` 取代

### 2.4 线掩膜

```ts
interface LineCandidate {
  id: string;
  kind: 'A' | 'B' | 'C';   // A 贯穿横 / B 贯穿竖 / C 列内竖（D 列内横按 W1 裁决已剔除）
  axis: 'h' | 'v';
  at: number;                    // axis='h' 时是行号；'v' 时是列号
  span: [number, number];
  width: number;                 // 实测线宽，px
  roi_id: string;
  column_index: number | null;    // 仅 kind C 非空
}

/** 复用上一轮已实现的类型（`straditize_core/image.py: rasterize_strokes` 已支持） */
interface LineMaskStroke {
  id: string;
  mode: 'erase' | 'restore';
  radius: number;
  points: [number, number][];
}

interface ExclusionRegion {
  id: string;
  roi_id: string;
  kind: 'rect' | 'poly';
  points: [number, number][];     // rect 恰好 4 点，顺序 tl,tr,br,bl
}
```

**存储形态（冻结，不许择一）**：三者都是**扁平列表**，归属由 `roi_id` 表达；**不用 `dict[roi_id, ...]`**。

### 2.5 采样层位

```ts
interface SampleHorizon {
  row_px: number;
  depth: number | null;                       // 未标定必须是 null，不得填 0
  source: 'auto' | 'paste' | 'manual';        // 必须存活到导出元数据
}
```

### 2.6 `DiagramData`

```ts
interface DiagramData {
  rois: DataRoi[];
  primary_roi_id: string;      // **冻结**：`.tar` 里 data.csv 用哪个 ROI；默认首个；用户可改
  active_roi_id: string;       // 当前编辑焦点
  columns: Column[];           // 扁平；顺序恒为 startX 升序
  calibration: DepthCalibration;   // 全局唯一，多 ROI 共享（上一轮已冻结）
  line_candidates: LineCandidate[];
  selected_candidate_ids: string[];
  line_strokes: LineMaskStroke[];
  exclusion_regions: ExclusionRegion[];
  samples: SampleHorizon[];
}
```

### 2.7 QA

```ts
interface QaSummary {
  roi_id: string; roi_name: string; composition: boolean;
  n_horizons: number; n_horizons_with_data: number; n_horizons_empty: number;
  empty_horizons: { depth: number | null; reason: string }[];
  sum: { min: number; p50: number; max: number; mean: number };
  tolerance: number;
  violations_over: { depth: number | null; sum: number }[];
  shortfall: { min: number; max: number; mean: number };
  per_column_max: { name: string; peak: number; declared_max: number; over: boolean }[];
}
```

---

## 3. 单一事实源表（**最要紧的一节**）

| 量 | 唯一事实源 | 谁都不许 | 谁读它 |
| --- | --- | --- | --- |
| 深度/年代轴 | `DiagramData.calibration`（全局） | ROI 不得携带深度 | 全部 |
| X 轴标度 | **`Column.x_ticks`**（每列具体） | 🚫 不得用 `defaults`/`override` 合并出标度 | 像素↔读数换算、QA、导出 |
| 满刻度读数 | **派生**：`declaredMax(col) = max(x_ticks[0].value, x_ticks[1].value)` | 🚫 不得存储；不得从 `form_defaults.tickValue` 读 | `qa.per_column_max` |
| plotType / unit / scaleType / exaggeration_mult / mult_source | **`Column` 上的具体值** | 🚫 不得继承 | 数字化、导出 |
| ROI 表单记忆 | `DataRoi.form_defaults` | 🚫 **不参与任何计算**；不得被任何读取路径消费 | 只被"应用默认"动作读 |
| 列顺序 | `startX` 升序（几何顺序） | 🚫 用户不可重排 | 全部 |
| 列名 | `Column.name` | 🚫 不得自动加后缀去重 | 导出、QA |
| 线掩膜 | `line_candidates`(选中) + `line_strokes` | 🚫 前端不得自算 | 数字化 |
| 排除区 | `exclusion_regions` | 🚫 不得由算法推断 | 数字化 |
| 采样层位 | `samples` | 🚫 不得用参考层位冒充；`source` 必须存活 | 导出、QA |
| 主 ROI | `primary_roi_id` | 🚫 不得由"第一个/活动"隐式推断 | 导出 |

**"应用组默认"是一次写动作**（不是继承）：

```
POST roi.applyFormDefaults(roi_id)
  → 把该 ROI 的 form_defaults 逐字段写入该 ROI 全部 Column 的具体字段
  → 返回 { changed: [{column_id, field, from, to}], count }   # 供 UI 显示 diff
```

---

## 4. 派生量（一律计算，不得存储）

```
pxPerUnit(col)      = (x2.px - x1.px) / (x2.value - x1.value)
valueAtX(col, x)    = 线性：v1 + (x - x1)/(x2 - x1) * (v2 - v1)
declaredMax(col)    = max(x1.value, x2.value)
roiOfColumn(col)    = rois.find(r => r.id === col.roi_id)
```

**由几何路径构造 `x_ticks`**（刻度检测 + 用户读出的两个数字）：

```
n = 该列检测到的刻度数；若 n < 2 → 拒绝（不得除零、不得瞎猜）
px_per_interval = (x_lastTick - x_firstTick) / (n - 1)
x_ticks = [ {px: x_firstTick, value: startValue},
            {px: x_lastTick,  value: startValue + (n - 1) * step} ]
```

**不得假设"列基线 = 0"**。

---

## 5. 校验规则（冻结）

| 规则 | 行为 |
| --- | --- |
| ROI 名 | 唯一、非空、`^[\w\u4e00-\u9fa5-]{1,31}$`；重名 → `-32602`，**不自动加后缀** |
| 列名 | 同一 `roi_id` 内唯一；重名 → `-32602` 并指出冲突的两列；**不自动加后缀** |
| `x_ticks` | 两端点 px 必须不同，且都落在 `[startX, endX]` 内；越界 → 拒绝（不夹紧） |
| 刻度检测 | `n_ticks < 2` → 明说"本列检测到 N 条刻度，请改用手点路径"，**不得产出成功结果** |
| 排除区 | `rect` 必须恰好 4 点；`poly` ≥ 3 点；越界坐标裁剪到图像内 |
| `composition` | 只由用户设定；`false` 时 `qa` 不做 `>100%` 判定，**不得从列单位推断** |
| `scipy`/`skimage` | 分层/检测失败时**报错并停在原地**，不得回落 |

---

## 6. 掩膜合成（0/1 语义与**显式优先级**，冻结）

```
ink        = foreground_mask                                   # bool
exclusion  = OR over regions of rasterize(region)               # bool
restore    = OR over strokes with mode='restore'  of stamp(stroke)
erase      = OR over strokes with mode='erase'    of stamp(stroke)
line_mask  = ( OR over selected candidates | restore ) AND ( NOT erase )
final_ink  = ink AND ( NOT line_mask ) AND ( NOT exclusion )
```

### 6.1 优先级（**必须写成显式规则**，不许说"不存在优先级"）

| 优先级 | 对象 | 含义 |
| --- | --- | --- |
| 1（最高） | `exclusion` | **绝对优先，无条件扣除**。排除区声明"这块没有数据"，任何 `restore`、任何候选都**不能**把它救回 |
| 2 | `erase` | 高于候选与 `restore`：用户手工擦掉的一律不删 |
| 3 | `selected candidates` ∪ `restore` | 两者是**并集**，彼此无优先级 |

**UI 约束（必须实现）**：`restore` 笔迹**落在排除区内时**要么被拒绝、要么提示"该区域已被排除，笔迹不会生效"——
不得让用户以为刷了却无效（静默无效 = 红线 2 的变体）。

> **上一版写"排除区与线掩膜作用于不同对象，因此不存在谁优先的问题"是错的**：
> 它们最终都作用于 `ink`，公式里 `exclusion` 无条件扣除，所以**有优先级**，必须明写。
> 相应地把 T05 的测试期望改为"排除区内的 restore **被忽略**"。

---

## 7. 探针结论（W0 产出，已并入本契约）

**Ground truth 工件**：`tests/probe_truth/`（由 `support/probe_truth/gen_ground_truth.py` 生成，
输入图像 sha256 已记录，规则见各 JSON 的 `rule` 字段）。

| 图 | sha256 | 刻度尺 | 刻度数（双规则一致率） | exaggeration 四层像素 |
| --- | --- | --- | --- | --- |
| `type2_exaggeration_bell.png` | `6e0437c0…1794` | ✓ | **65**（1.000） | true_green 45539 / exag_green 21330 / true_yellow 39342 / exag_yellow 37155 |
| `type6_composite_zonation_cluster.png` | `631ba045…103d` | ✓ | **120**（1.000） | true_green 36867 / exag_green 17384 / true_yellow 31376 / exag_yellow 29683 |
| `type1_filled_silhouette_aber.png` | `6ec1da6b…f8b8` | **✗ 无** | 0（`has_tick_ruler=false`） | 无 |
| `hoya-del-castillo.png` | `f94196e6…1c1f` | **✗ 无** | 0（`has_tick_ruler=false`） | 无 |

> **GT v1.1 更正（由 T00-b 探针查出）**：v1 的条带规则只要求"列暗度双峰"，于是把
> **穿过条带的列基线**也当成了刻度：`filled_silhouette` 的 35 条"刻度"实测中位游程
> **64px**（最大 333px）、`hoya` 的 13 条中位 **149px**（最大 1162px）——**这两张图根本没有刻度尺**。
> 现规则追加"**每条笔画列的绝对竖直游程 ≤ 12px**"（短孤立笔画），两张图如实报 0。
> 给没有刻度尺的图编出刻度，正是本探针要抓的缺陷。

**已确认的事实**（探针 T00-a 前半，2026-09-20）：

1. 四层灰度：`true_green 95.6 < exag_green 174.7 < true_yellow 189.1 < exag_yellow 222.1`。
2. **单一全局阈值数学上无解**：要保留 `true_yellow` 需 `thr ≥ 189.1`；要排除 `exag_green` 需 `thr < 174.7`。
3. `otsu = 159` 时 `true_yellow` 保留率 **0.0%**（黄色列真实层被判背景），
   当前靠**更深的描边**（灰度≈129）侥幸取到正确轮廓；`exag_green` 保留率 0.0%（碰巧正确）。
4. 裕度：`exag_green` 距 otsu 仅 **15.7** 灰度；`true_yellow` 距 otsu 仅 **30.1** 灰度。

### 7.1 T00-b 探针结果：**PASS**（2026-09-20）

工件：`support/probe_x_ticks.py`、`tests/test_probe_x_ticks.py`（**已入 `pixi run test`**）。

| 图 | 组 | 自动条带 | 手动条带 | 召回 | 误检 |
| --- | --- | --- | --- | --- | --- |
| bell | **gate** | `[907,916]` | `[907,916]` | **1.0000** | **0** |
| composite | **gate** | `[839,848]` | `[839,848]` | **1.0000** | **0** |
| filled_silhouette | 非 gate | `None` | — | 如实报 0 | 0 |
| hoya | 非 gate | `None` | — | 如实报 0 | 0 |

**gate 组 = 2 张**（v1 曾列 3 张，`filled_silhouette` 因无刻度尺移出）。
**结论：`T07` 启用几何路径**（设计稿 §5.3.1 路径 ①）。

**随探针产出的三条实现结论（已固化为测试，勿重试）**：

1. **候选条带不能按"笔画数"打分**：数据区每列基线在 9 行窗口内都是"窄短笔画"——
   bell 图数据区有 **228** 条、真刻度尺只有 **80** 条，按笔画数必然选中数据区。
   判据必须是**绝对竖直游程**（数据区 >12px，刻度尺 ≤12px）。
2. **2-D 连通域不可用**：刻度尺常有**连接横线**把所有刻度连成一个**超宽**分量，
   于是被宽度过滤全数拒绝（探针第一版因此一条都检不出）。必须用**逐列 1-D** 通过。
3. **间距均匀性只在列内成立**：实测 bell 间隔序列 `20,20,20,20,19,14,20,13,20,24`，
   13/14 落在列边界——**刻度尺是逐列画的**。全局均匀率仅 0.72/0.75，
   **逐列中位均匀率 = 1.0000**。这提供了 GT 规则完全不使用的独立佐证。

### 7.2 W1 范围裁剪决策（2026-09-20）

1. **Exaggeration（T00-a / T12）延后（Deferred）**：
   按架构决策，优先打通 8 步核心工作流；放大层双色分离属于特定图型算法增强，不阻塞端到端主链路，暂不参与第一期 W4 并行。
2. **D 类线裁除（Dropped）**：
   原 D 类（列内细横线）在真实图例中难以建立无争议 ground truth 且算法易误杀，正式从 LineCandidate kind 中剔除（仅保留 A 贯穿横 / B 贯穿竖 / C 列内竖），避免在清理步骤引入过度复杂性。

---

## 8. RPC 契约（冻结）

> 方法名 / 参数名 / 返回字段一旦冻结，实现单不得改名。新增方法**必须**在此登记。

| 方法 | 参数 | 返回（关键字段） |
| --- | --- | --- |
| `roi.create` | `name, x0, x1, y0, y1, composition?` | `{roi, rois_count}` |
| `roi.update` | `roi_id` + 可改字段 | `{roi}` |
| `roi.remove` | `roi_id` | `{success, removed_column_ids}` |
| `roi.list` | — | `{rois}` |
| `roi.setActive` | `roi_id` | `{active_roi_id}` |
| `roi.setPrimary` | `roi_id` | `{primary_roi_id}` |
| `roi.applyFormDefaults` | `roi_id` | `{changed:[{column_id,field,from,to}], count}` |
| `algorithm.detectColumns` | `roi_id` | 该 ROI 的列 |
| `algorithm.detectLineCandidates` | `roi_id, line_fraction?, line_width_min?, line_width_max?` | `{candidates}`（**无掩膜**） |
| `algorithm.applyLineRemoval` | `roi_id, selected_ids, strokes, exclusion_regions` | `{stats, overlay_png}` |
| `algorithm.detectXTicks` | `roi_id, band?` | `{band, per_column:[{column_index, ticks:[px…], n}]}` |
| `algorithm.extractHorizonConsensus` | （已有） | `{horizons_count, pixel_y, depths}` |
| `samples.set` / `samples.list` / `samples.clear` | `roi_id, …` | `{samples}` |
| `column.update` | `col_index, updates` | `{column}` |
| `qa.summarize` | `roi_id, tolerance?` | `QaSummary` |
| `ocr.recognizeLabels` | （已有） | `{labels:[{…, bbox, anchor_x, anchor_y, associated_column_id}]}` |

**`ocr.recognizeLabels` 的归属规则必须改**（现状 `ocr/engine.py:339` `_snap_labels_to_columns`
是**贪心最近邻 + 45px 绝对阈值 + `used_col_indices` 独占**，阈值 ≈ 本图最窄列宽 23px 的 2 倍，
且先处理的标签抢占列 → **顺序敏感**）。冻结为：

> 标签取 `anchor_x`，落在 `[col.startX, col.endX)` 区间者归属该列；
> **数量不一致时不做任何配对**，改为返回三类对账：`columns_without_label` / `labels_without_column` / `ambiguous`。

---

## 8.1 扩展点接口（**冻结**；W2/W3 按此实现，特性单按此扩展）

> 上一版只在任务单里描述扩展点，契约里没有 → W1 冻结时 W2/W3 执行者只能自己发明。现冻结如下。

### 8.1.1 后端 RPC 扩展点

```python
# straditize_core/rpc_methods/<feature>.py
def register(dispatcher, session) -> None:
    """把一个特性模块的全部方法登记进 dispatcher。"""
```

```python
# straditize_core/rpc_methods/__init__.py
def register_all(dispatcher, session) -> list[str]:
    """pkgutil.iter_modules 扫描本包下所有模块，逐个 import 并调用其 register()。
    返回已加载模块名列表（供自检与日志）。跳过 __init__ 与下划线开头的模块。"""
```

`rpc_server.py` 只调用 `register_all(dispatcher, session)`，
**不得出现任何具体方法名**（否则特性单必须再改它 → 破坏扩展点）。

### 8.1.2 后端会话 mixin 扩展点

```python
# straditize_core/session_parts/<feature>.py
class <Feature>Mixin:
    """只允许读写 session 自身属性；不得 import 其他 session_parts 模块。"""
```

`session.py` 的组合列表 **W2 一次性固定，且必须覆盖全部 W4 特性**：

```python
class StraditizeSession(
    CoreMixin, RoiMixin, CleanupMixin, XTicksMixin,
    SamplesMixin, LayersMixin, QaMixin, ExportMixin,
):
    ...
```

W2 为**每一个** mixin 建空文件（方法体 `raise NotImplementedError`），**此后 `session.py` 只读**。
某特性若发现需要新 mixin，**必须回 W1 改本契约**，不得直接改 `session.py`。

### 8.1.3 前端步骤 / 叠加层扩展点

```ts
// frontend/src/components/steps/*Panel.ts
export const step: number;                       // 1..8
export function render(data: DiagramData): string;
export function mount(root: HTMLElement, ctx: StepContext): void;

// frontend/src/components/canvas/*Overlay.ts
export const id: string;
export const z: number;                          // 绘制顺序
export function draw(ctx: CanvasRenderingContext2D, data: DiagramData, vp: Viewport): void;
```

`_registry.ts` 用 `import.meta.glob('./*Panel.ts' | './*Overlay.ts')` 自动收集；
**`Inspector.ts` / `Sidebar.ts` / `GeologyCanvas.ts` 内不得出现任何具体步骤名**。

### 8.1.4 L4 输出的最小 grammar（**冻结**）

```
KEY=VALUE                 # 单值
KEY=[V1,V2,...]           # 列表（逗号分隔、无空格；元素为字符串）
KEY=null                  # 缺省
```

- `KEY` 必须匹配 `^[A-Z][A-Z0-9_]*$`；
- **一行一个 KEY，同一脚本内 KEY 不得重复**；值为单行文本，不含换行；
- 值内允许 `-`、`_`、`/`、`.`、`%`、`,`、中文；
- **禁止**"元变量"式输出：枚举必须在脚本里**选定一个实际值**再打印
  （例：`BANNER_LEVEL=red`，**不是** `BANNER_LEVEL=(red|yellow|info)`）。

---

## 9. 变更记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| v1 | 2026-09-20 | 首版冻结；取消 `override`/继承与 `effective_column_settings`；`x_ticks` 为标度事实源；`declaredMax` 为派生量；`columns_stale` 改 per-ROI；新增 `name_source`/`primary_roi_id`/`mult_source`；线/排除区/采样扁平列表；探针结论并入 |
| **v1.1** | 2026-09-20 | ① §6 补**显式优先级**（排除区 > erase > 候选∪restore）+ UI 约束 —— 上一版"不存在优先级"的说法自相矛盾；② 新增 §8.1 **扩展点接口**（RPC `register`/`register_all`、mixin 组合列表、前端 panel/overlay 接口、L4 `KEY=VALUE` grammar）—— 上一版只写在任务单里，W2/W3 无契约可依 |
| **v1.2** | 2026-09-20 | §7 并入 **T00-b 探针结果（PASS）**：GT 条带规则补"短孤立笔画 ≤12px"（原规则误把列基线当刻度，`filled_silhouette`/`hoya` 的 35/13 条刻度是假的）；**gate 组 3 → 2 张**；记录三条实现结论（不可按笔画数打分 / 不可用 2-D 连通域 / 间距均匀只在列内成立）；**T07 启用几何路径** |
| **v1.3** | 2026-09-20 | 架构决策裁剪：① §2.4 与 §7.2 裁除 D 类线（`kind: 'A' | 'B' | 'C'`）；② T00-a / T12（Exaggeration 双层分离）延后（Deferred），优先打通主干工作流；③ W1 契约冻结正式生效 |
