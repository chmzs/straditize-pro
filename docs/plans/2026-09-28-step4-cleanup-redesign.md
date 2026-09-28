# Step 4 干扰清理：彻底重构设计

**目标：** 把 Step 4 重做成一个"看得见、拖得动、可验证"的 Remove artifacts 工作流。核心是三条：
单一事实源（后端）、单一交互模型（画布上的矢量 geometry）、单一 mask 生命周期。

**架构：** 采用 GIS 反向掩膜模型 —— 干扰线是 ROI 内的矢量矩形 geometry，图是栅格；
geometry 栅格化成 mask 后，只在该 mask 内剔除前景像元。原图永不被修改，被改的只有
数字化前景 mask。老版（上游 PyQt5）的投影 + 线宽过滤 + 人工确认是检测基线；
创新算法不进默认删除路径。

---

## 0. 现状诊断（实测证据，不是推测）

### 缺陷 1：后端从不序列化清理状态 → geometry 必然消失

- `straditize_core/rpc_methods/system.py:128-159` 的 `get_diagram_data()` 返回的是
  `lineRemoval: {strength, remove_vertical, corrections}`，**不含**
  `line_candidates` / `selected_candidate_ids` / `exclusion_regions` / `line_strokes`。
- `frontend/src/services/RpcClient.ts:316-319` 因此每次都落到
  `data.line_candidates = data.line_candidates ?? []`。
- 后果：任何一次 `getDiagramData()` 刷新（进入 Step 4、ROI 变更、任意
  `loadNewDiagram`）都会把前端内存里的 geometry 清空。

**反证（检测算法本身正常）** —— Hoya 实时 ROI `xlim=[309,2030] ylim=[507,1314]`：

```
count: 20
A h at=819  w=2  几何 [309,818]-[2029,819]     ← 真 zone 界线
A h at=1129 w=2  几何 [309,1128]-[2029,1129]   ← 真 zone 界线
A h at=1307 w=2  几何 [309,1306]-[2029,1307]   ← 真 zone 界线
B v ×17  at=319…1961  w=2
```

结论：不是"识别不出来"，是"识别结果没送到画布"。

### 缺陷 2：编辑只有 prompt，没有画布交互

- `frontend/src/main.ts` 的 `onAddLineGeometry` / `onEditLineGeometry` 用
  `window.prompt` 收 `x0,y0,x1,y1`。
- 画布没有任何 geometry 的命中测试、拖拽、缩放手柄。
- **已存在可复用的基础设施却被绕过**：ROI 的 8 手柄
  （`ROI_HANDLE_SIZE_SCREEN`、`hoveredRoiHandle`、`draggingRoiHandle`，
  `GeologyCanvas.ts:1661/1986/2003`）与列边界 start/tick/end 拖拽。

### 缺陷 3：叠加层画得太细，异常还被吞掉

- `frontend/src/components/canvas/CleanupOverlay.ts` 用 2px 虚线画 2px 高的线，
  在密集花粉图上几乎不可见，且没有填充区域。
- `frontend/src/components/GeologyCanvas.ts:1743` 的 `catch {}` 会静默吞掉
  叠加层异常 —— 出错了用户只看到"什么都没有"，看不到原因。

### 缺陷 4：两套视觉通道可能不一致

- 后端 PNG（`lineOverlayImage`）与前端矢量（`CleanupOverlay`）各画一套，
  颜色语义靠人工在两处同步，必然漂移。

---

## 1. 重构原则

1. **后端是唯一事实源。** 前端不持有权威清理状态，只持有"正在拖拽中的临时值"。
2. **geometry 是一等可编辑矢量对象**，不是列表里的一行文字。
3. **画笔只做局部像元修正**，不画线、不替代 geometry。
4. **一次操作 = 一次 RPC = 一次重算**，禁止前端自行推测掩膜。
5. **禁止静默成功**：检测为空、overlay 为空、RPC 失败都要在面板上显式说明。

---

## 2. 数据模型：geometry 是一等对象

```python
cleanup = {
  "roi_id": "roi_1",
  "geometries": [
    {
      "id": "geo_7",
      "axis": "h" | "v",
      "rect": [x0, y0, x1, y1],        # 图像像素坐标，闭区间
      "status": "candidate" | "removed",
      "source": "auto" | "manual",
      "confidence": 0.92,              # 人工新增固定 1.0
    }
  ],
  "exclusions": [ {"id", "kind": "rect"|"poly", "points"} ],
  "strokes":    [ {"id", "mode": "erase"|"restore", "radius", "points"} ],
  "stats": {
    "geometry_removed_pixels": int,
    "exclusion_pixels": int,
    "manual_erase_pixels": int,
    "manual_restore_pixels": int,
    "final_removed_pixels": int,
  },
  "overlay_png": "data:image/png;base64,...",
}
```

- `rect` 取代旧的 `at` / `span` / `width` 三元组：编辑时只动一个矩形，
  不再需要在三种表示之间来回换算（现在的 `at`/`span`/`width` → `geometry`
  换算就是 bug 温床）。
- `status` 取代 `selected_candidate_ids` 这个平行数组：不再可能出现
  "id 在列表里但候选已不存在"的悬空引用。

### 序列化契约

`get_diagram_data()` 必须返回完整 `cleanup`，并**同时**镜像前端现有的扁平键
（`line_candidates` / `selected_candidate_ids` / `exclusion_regions` / `line_strokes`）
以免一次性改爆前端。新增 `docs/ARCHITECTURE.md` 契约条目。

---

## 3. 后端：单一 mask 生命周期

```text
geometry_mask  = 栅格化(所有 status == "removed" 的 geometry)
exclusion_mask = 栅格化(exclusions)
line_mask      = (geometry_mask | manual_erase) & ~manual_restore
final_mask     = line_mask | exclusion_mask        # 排除区优先级最高
```

- `digitize` / Step 5 只读 `final_mask`。
- `foreground_mask` 永不被就地修改 —— 可撤销、可复查。
- 每次几何/画笔/排除区变更都调用同一个 `_recompose_cleanup()`，
  返回同一个 overlay 与同一组 stats。

### RPC

保留现有方法（测试与文档已引用，不擅自改名）：

- `algorithm.degrid`：只更新自动 mask；
- `algorithm.detectLineCandidates`：自动检测 → 写入 `geometries`（`status="candidate"`）；
- `algorithm.applyLineRemoval`：兼容入口，内部走 `_recompose_cleanup()`。

新增：

| 方法 | 作用 |
| --- | --- |
| `algorithm.upsertLineGeometry` | 新增或编辑一条 geometry（已存在，需改为操作 `geometries`） |
| `algorithm.deleteLineGeometry` | 删除一条 geometry |
| `algorithm.setGeometryStatus` | candidate ↔ removed 切换 |
| `algorithm.clearCleanupEdits` | 清空本步全部 geometry/画笔/排除区 |

---

## 4. 画布交互：拖拽创建 + 选中编辑

这是"为什么只能输四至值"的直接答案：geometry 必须在图上改。

### 4.1 视觉（先解决"看不见"）

geometry 画成**有填充的半透明条带**，不再是一条发丝：

| 状态 | 外观 |
| --- | --- |
| candidate（待确认） | 琥珀色 `#f59e0b` 半透明填充 + 虚线描边 |
| removed（已去除） | 红色 `#ef4444` 半透明填充 + 实线描边 |
| selected（当前选中） | 上述填充 + 白色高亮描边 + 两端手柄 |
| exclusion | 灰色 `#9ca3af` 填充 |
| 保留墨迹 | 白色（来自后端 overlay PNG） |

关键：2px 高的线在 `scale=1` 时只有 2 屏幕像素，所以**最小渲染厚度取
8 屏幕像素**（只影响显示，不影响 mask）。

### 4.2 工具模式

复用 `ToolModeManager`，新增/调整：

```text
select   : 点选 geometry；拖动本体 = 平移；拖动端点/边手柄 = 缩放；Delete = 删除
draw-h   : 在图上横向拖拽 → 新建横向 geometry（y 范围 = 拖拽 y ± 半厚度）
draw-v   : 在图上纵向拖拽 → 新建竖向 geometry
linefix  : 既有局部像元画笔（erase / restore）
pan      : 既有平移（右键/中键/空格+左键，三者等价）
```

### 4.3 命中测试与拖拽

沿用 ROI 手柄的既有模式（屏幕恒定像素、`worldToScreen`/`screenToWorld`）：

- 命中带 = `max(geometry 实际厚度, 10 屏幕像素)`，保证 2px 的线可点中；
- 手柄：横向 geometry 给 `left` / `right` 两个端点手柄 + 上下两条厚度边；
  竖向对称；
- `hover` 时改变光标并在状态栏给出提示（"拖动移动 / 拖端点改范围"）。

### 4.4 提交时机

- **拖拽过程中**：只改前端临时值并重绘 → 60fps 跟手；
- **松手时**：一次 `algorithm.upsertLineGeometry` → 后端重算 → 回灌
  overlay + geometry 列表 → 面板刷新。
- 与既有 `dragInitialRoi` / 列边界"松手提交单条原子 Command"的实现一致，
  并且可进 `HistoryManager` 撤销。

### 4.5 删除 prompt

`onAddLineGeometry` / `onEditLineGeometry` 的 `window.prompt` 全部移除。
坐标仍可选择在面板里以数字输入框呈现（精确定位场景），但**不再是唯一入口**。

---

## 5. 画笔职责（与 geometry 不重叠）

| | geometry | 画笔 |
| --- | --- | --- |
| 粒度 | 整条线（矢量矩形） | 局部像元 |
| 用途 | 结构性去除 | 修补误标/漏标 |
| 持久化 | 对象，可编辑可复用 | 笔迹点列 |
| 典型场景 | 3 条 zone 界线 | 线穿过花粉处补回 5 个像素 |

```text
画笔恢复 > geometry 删除      # 局部特例覆盖整体规则
排除区     > 画笔恢复          # 用户显式声明的非数据区最高优先
```

面板文案必须写明这条优先级，否则用户无法预测结果。

---

## 6. 前端面板（单一流程）

```text
1. 检测
   灵敏度：弱 / 中 / 强
   方向：横线 / 竖线 / 两者
   [自动检测]        ← 检测为 0 条时明确报"未检测到，请调灵敏度或手动画"

2. 几何清单（核心）
   每条：类型 · 位置 · 覆盖范围 · 状态徽标 · [定位] [删除]
   顶部：[全部确认] [全部取消]
   点击行 = 画布选中并高亮

3. 手动几何
   [画横线] [画竖线]   ← 进入 draw-h / draw-v 模式，图上拖拽创建

4. 局部修正
   [擦除笔] [补回笔] [清除笔迹]

5. 排除区
   [添加排除区] [清除]

6. 统计（必须来自后端真实数字）
   geometry 去除 N px ｜ 排除区 M px ｜ 画笔恢复 K px ｜ 最终 R px

7. [清空本步修改]  [确认清理并进入 Step 5]
```

---

## 7. 任务拆分

### 任务 1：后端序列化契约（先修"看不见"）

- 修改 `straditize_core/rpc_methods/system.py`：`get_diagram_data()` 返回
  完整 `cleanup` + 扁平镜像键。
- 测试：`tests/unit/test_cleanup_serialization.py`（新增）——
  断言检测后 `getDiagramData` 仍返回同样的 geometry 集合。
- **验收：刷新一次数据后 geometry 不消失。**

### 任务 2：geometry 一等对象化

- 修改 `straditize_core/lines.py`：候选只产出 `rect` + `status` + `source`。
- 修改 `straditize_core/session_parts/cleanup.py`：`geometries` 取代
  `line_candidates` + `selected_candidate_ids`；实现 `_recompose_cleanup()`。
- 新增 `deleteLineGeometry` / `setGeometryStatus` / `clearCleanupEdits`。
- 保持 `at`/`span`/`width` 只读派生，供旧测试与旧前端过渡。

### 任务 3：画布 geometry 编辑

- 修改 `frontend/src/components/GeologyCanvas.ts`：
  geometry 命中测试、选中、平移、端点缩放、draw-h/draw-v 拖拽创建、Delete 删除。
- 修改 `frontend/src/components/canvas/CleanupOverlay.ts`：
  半透明填充条带、最小 8 屏幕像素厚度、选中手柄、状态配色。
- 移除 `GeologyCanvas.ts:1743` 的静默 `catch {}`，
  改为把异常上报给状态栏（禁止静默失败）。

### 任务 4：面板重构

- 重写 `frontend/src/components/steps/CleanupPanel.ts` 为第 6 节结构。
- 修改 `frontend/src/main.ts`：删掉两个 prompt handler；接入 draw 模式与
  删除/状态切换；统一 `refreshCleanup()` 路径。
- 修改 `frontend/src/types/pollen.ts`：`CleanupGeometry` 类型。
- 修改 `frontend/src/components/Inspector.ts`：`StepContext` 新增回调声明。

### 任务 5：端到端验收

```text
加载 Hoya → 进入 Step 4
→ 自动检测出 3 条横线 + N 条竖线，画布上以琥珀色条带可见
→ 点击一条 → 出现手柄 → 拖动到另一行 → 松手后条带位置与 mask 同步
→ 拖端点缩短 → 覆盖范围变化
→ 点 [画横线] → 图上拖拽 → 新增一条 geometry
→ 勾选确认 → 变红 → 该区域像元被剔除
→ 取消确认 → 变回琥珀 → 像元恢复
→ 进入 Step 5 → 使用同一 final_mask
```

---

## 8. 验收标准

- 进入 Step 4 并**刷新数据后**，geometry 仍在画布上可见（当前必然失败）；
- geometry 可在图上拖动、缩放、删除，全程无 `window.prompt`；
- 新增 geometry 只需一次拖拽；
- 任何操作后面板统计与后端 `stats` 完全一致；
- 检测为空 / 后端报错 / overlay 为空都有显式提示，不出现"已完成"却什么都没变；
- 画笔只影响局部像元，恢复优先于 geometry；
- 排除区优先级最高；
- 现有 RPC 兼容，`docs/ARCHITECTURE.md` 契约同步；
- `pixi run lint` / `pixi run test` / `npm --prefix frontend test` /
  `npm --prefix frontend run build` 全绿。

---

## 9. 明确不做

- 不引入深度学习分割；
- 不把 Canny/Hough 作为主检测路径；
- 不像素级整行/整列删除（会抹掉真实花粉）；
- 不让创新算法进入默认删除路径 —— 老版兼容路径回归通过前不加开关。
