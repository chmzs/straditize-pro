# Straditize JSON-RPC 2.0 通信协议规范

本文档定义古气候图表数值化引擎 `straditize_core` 与前端（Web / Electron / Desktop UI）之间的 JSON-RPC 2.0 通信标准。

## 权威范围（请先读这段）

| 内容 | 权威来源 |
| :--- | :--- |
| 信封格式、错误码语义、传输方式（§1–§3） | **本文档**（已与 `protocol.py` / `errorCodes.ts` 对齐） |
| 逐方法的**参数名与返回字段** | **代码本身**：`straditize_core/rpc_methods/*.py` 中 `register_method` 的目标签名，以及 `session*.py` 的返回字典 |
| 前后端字段级对账 | `frontend/e2e/contract.spec.ts`（对真实 payload 断言 TS 声明） |
| 架构不变量与工作流语义 | `docs/ARCHITECTURE.md` |

**§4 是"示例目录"，不是全量清单。** 后端当前注册 **105** 个方法（2026-10-28 实测，
`rpc_methods/*.py` 中 `register_method` 的调用计数），§4 只逐一展开了其中 11 个。
拿 §4 当接口全集会漏掉绝大多数方法；新增或修改方法时请以代码与 `contract.spec.ts` 为准，
本文档按需补示例。

**例外：§4A 是全量清单。** 年代-深度模型与年代集合（`agedepth.*` 共 10 个、`ensemble.*` 共 2 个）
已逐一展开参数与返回字段，不再只是示例。

已核对并修正的偏差：
- 2026-09-29：§3 错误码表（`-32002` / `-32004` 原按旧语义书写）、§4.1 `core.loadImage`
  （参数、缺失的副作用与返回字段）、§4.7 `roi.update`（缺 `roi_id`）。
- 2026-10-28：新增 §4A（12 个年代方法全量）；方法总数 97 → 105；
  `agedepth.extractAndInspect` 的 `age_increases_downcore` 由前端写死 `true` 改为三态
  （`null` = 由追踪曲线判定），并新增 `metadata.age_direction_reason`。

---

## 1. 协议总览

- **协议版本**：JSON-RPC 2.0
- **传输方式**：
  1. **标准 I/O 管道 (stdio)**：适用于父子进程嵌入式通信（如 Electron 主进程 spawn Python 运行时），按换行符 `\n` 分隔每一条 JSON 消息。
  2. **本地 Localhost HTTP / SSE 服务**：适用于现代浏览器、Web 前端开发与调试。
     - RPC 端点：`POST http://127.0.0.1:8765/rpc`（包含 CORS 支持）
     - SSE 事件端点：`GET http://127.0.0.1:8765/events`（服务器向前端推送实时进度、状态通知）
     - 健康检查端点：`GET http://127.0.0.1:8765/health`
- **字符编码**：UTF-8

---

## 2. 消息封装标准

### 2.1 请求对象 (Request Object)

```json
{
  "jsonrpc": "2.0",
  "method": "core.loadImage",
  "params": {
    "image_path": "I:/path/to/diagram.png"
  },
  "id": "req-001"
}
```

- `jsonrpc`: 必须为 `"2.0"`
- `method`: 调用的过程名（字符串）
- `params`: 命名参数对象（`{}`）或位置参数数组（`[]`）
- `id`: 请求标识符（字符串、整数或 null）。若无 `id`，视为 Notification（无需响应）。

### 2.2 成功响应对象 (Success Response Object)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "width": 1920,
    "height": 1080,
    "format": "PNG"
  },
  "id": "req-001"
}
```

### 2.3 错误响应对象 (Error Response Object)

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params: missing required parameter 'image_path'",
    "data": null
  },
  "id": "req-001"
}
```

---

## 3. 标准错误码表

| 错误码 | 错误名称 | 触发场景说明 |
| :--- | :--- | :--- |
| `-32700` | **Parse error** | 客户端发送的不是有效 JSON 文本。 |
| `-32600` | **Invalid Request** | 缺少 `jsonrpc: "2.0"`，缺少 `method`，非对象类型或空 Batch 数组。 |
| `-32601` | **Method not found** | 调用的核心方法或系统方法未在服务端注册。 |
| `-32602` | **Invalid params** | 缺少必填参数、参数类型错误或参数超出合法取值范围。 |
| `-32603` | **Internal error** | 服务端内部未捕获的运行时异常。 |
| `-32001` | **STATE_ERROR** | 业务前置条件未满足（例如未加载图片直接执行识别列或数字化）。 |
| `-32002` | **CONFLICT_ERROR** | 命名 / 业务实体冲突（例如同一 ROI 内出现重复的属种列名或 ROI 名）。 |
| `-32003` | **ALGORITHM_ERROR** | 算法计算或提取失败、越界（例如整列落在 ROI 之外）。 |
| `-32004` | **FILE_ERROR** | 文件不存在、格式损坏或不可读。 |

> ⚠️ **本表以 `straditize_core/protocol.py` 与前端 `frontend/src/i18n/errorCodes.ts` 为准。**
> 这两处当前完全一致（`-32001` state / `-32002` conflict / `-32003` algorithm / `-32004` file）。
> 本文档此前把 `-32002` 记作 "File not found"、`-32004` 记作 "Export error"，那是**更早一版的
> 语义**——`protocol.py` 至今保留 `FILE_NOT_FOUND_ERROR` / `CALIBRATION_ERROR` / `EXPORT_ERROR`
> 三个仅作向后兼容的别名常量，但数值早已重新指派。照旧表把 `-32002` 渲染成"文件不存在"，
> 会把一次**命名冲突**误报成缺文件，正是历史上 `x_bounds` / `data_xlim` 那一类错位诊断。

---

## 4. 核心 RPC 方法定义（示例目录，非全量）

> 下面 9 个方法用于演示本协议的请求/返回形态与契约要点；后端实际注册 90 个应用 RPC。
> 需要某个方法的确切参数名时，读 `straditize_core/rpc_methods/` 中对应的 `register_method` 目标函数。

### 4.1 `core.loadImage`
加载图表原始图像到后端核心会话。

- **参数 (params)**：
  - `image_path` (string, 可选): 本地文件绝对路径或相对工作区路径。
  - `image_data` (string, 可选): `data:image/...;base64,...` 内联图像；适用于浏览器拖入的本地文件。
  - `sample_key` (string, 可选): 内置范例键（`hoya` / `verification` / `beginner`）。
  - `file_name` (string, 可选): 仅作为元数据回显。
  - `page_number` (number, 可选, 默认 1): 多页 PDF 的页码（1 基）。
  - 以上**都不给**时，若会话中已有缓存的 PDF，则翻到该 PDF 的第 `page_number` 页
    （见 `session.load_image` 中 `cached_pdf_data` / `cached_pdf_path` 分支）。
    因此旧版本文档写的"三者必须给出其一"**已不成立**。
- **返回 (result)**：
  ```json
  {
    "success": true,
    "width": 2339,
    "height": 1654,
    "format": "PNG",
    "mode": "RGB",
    "image_path": "E:/software_dev/straditize/hoya-del-castillo.png",
    "image_url": "/image/current",
    "suggested_roi": { "xMin": 281, "xMax": 2199, "yMin": 298, "yMax": 1456 },
    "rois": [],
    "primary_roi_id": null,
    "active_roi_id": null,
    "pdf_info": null
  }
  ```
- **契约要点 ①（几何建议，不含深度）**：`suggested_roi` 是**几何区域建议**，**只给区域、不给深度**。
  历史上这里返回的是一个含 `depthTopValue/depthBottomValue/isCalibrated` 的
  `suggested_calibration`，等于替用户声称了一把并不存在的深度尺；该字段已删除。
  深度只能来自用户在 S4 的两点标定（`core.calibrateAxes`）。
- **契约要点 ②（有副作用，且返回体比上面这份示例更宽）**：`core.loadImage` **不是只读的**——
  它在返回前会按 `suggested_roi` **自动创建一个名为 `pollen` 的 ROI**，并重置
  `depth_grid` / `data_xlim` / `data_ylim`。因此返回体还包含 `success`、`image_url`、
  `rois`、`primary_roi_id`、`active_roi_id`、`pdf_info`（上面的示例按"尚未建 ROI"的
  初始形态书写，实际以 `session.load_image` 的返回字典为准）。前端 `RpcClient` 依赖
  `suggested_roi` 存在，缺失即抛错，不静默回退。

---

### 4.2 `core.extractForeground`
对当前加载的图表执行前景分割/二值化。

- **参数 (params)**：
  - `threshold` (number, 可选): 二值化阈值。如果不传，则根据 `mode` 自动计算。
  - `mode` (string, 可选, 默认 `"otsu"`): 分割模式，支持 `"otsu"`、`"binary"`、`"adaptive"`。
  - `extraction_mode` (string, 可选, 默认 `"standard"`): 决定**哪些像素算墨迹**（`mode` 选的是阈值算法，两层不同的事），规范值 5 个：`"standard"` / `"light-overlay-white"` / `"dark-ink-light"` / `"light-ink-dark"` / `"solid-over-shadow"`。
    别名（`light overlay on white background` / `dark ink on light background` / `light ink on dark background` /
    `solid over shadow` / `双层`）在入口归一化，见 `image.py::EXTRACTION_MODES`；未知值返回 `-32602`，
    **不静默回退**——回退会让人拿到错层取的读数，而返回体里的 `extraction_mode` 仍回显他传的名字。
    省略时按 `"standard"`（Otsu）重算，**不是**沿用会话当前模式；只有隐式重算路径
    （`_extract_foreground_from_settings`）才沿用会话值。`solid-over-shadow` 只取实心层，
    夸张包络单独存于 `shadow_mask`，由 `core.getShadowLayer` 取回、永不进入读数。
- **返回 (result)**：
  ```json
  {
    "threshold": 168.0,
    "mode": "otsu",
    "foreground_pixels": 45281,
    "foreground_ratio": 0.052,
    "shape": [1311, 1946]
  }
  ```

---

### 4.3 `core.detectColumns`
在指定的图表数据区域内，自动探测或切分各花粉/环境指标列的像素边界。

- **参数 (params)**：
  - `data_xlim` ([x0, x1], 必填): 图表数据区水平像素范围 `[min_x, max_x]`。
  - `data_ylim` ([y0, y1], 必填): 图表数据区垂直像素范围 `[min_y, max_y]`。
- **返回 (result)**：
  各列边界对象列表：
  ```json
  [
    { "col_index": 0, "start": 315.0, "end": 445.0 },
    { "col_index": 1, "start": 445.0, "end": 580.0 },
    { "col_index": 2, "start": 580.0, "end": 710.0 }
  ]
  ```
  顶层**始终是数组**（前端按 `Array.isArray` 消费，不得改成对象）。

  若重分列导致某列原有的 `x_ticks` 标定失效，该列对象会额外带一个可选键
  `x_ticks_dropped`（其余列不带该键），用于向用户显式报告"标定已被清空"：

  ```json
  {
    "col_index": 0,
    "start": 319.0,
    "end": 497.0,
    "x_ticks_dropped": {
      "reason": "out_of_band",
      "px": [339.0, 477.0],
      "band": [309.0, 507.0]
    }
  }
  ```

  - `reason = "out_of_band"`：列数未变，但原刻度像素落在新列的允许区间（`band`，含左右各 10 px 放宽）之外。
  - `reason = "column_layout_changed"`：列数改变，整块标定回填被跳过；此时 `band` 是该列的**真实物理边界**（不含放宽）。

  该键在下述任一情况被移除：该列重新 `column.calibrateXTicks` 成功、
  `column.clearXTicks`、下一次分列该列未被丢弃。它**不写入工程包**
  （`project_save` 的列白名单不含此键）。

  **另一个可选键 `suspect_block`**（同样只在命中的列上出现，未命中列为 `null`）
  用于标记"这一列不是曲线，而是填满整列的色块"：

  ```json
  {
    "col_index": 20,
    "suspect_block": {
      "reason": "fills_whole_column",
      "cv": 0.008008,
      "fill_ratio": 0.97961,
      "mean_ink_width": 123.43,
      "column_width": 126
    }
  }
  ```

  判据是两个纯结构量同时成立（不依赖真值表，也不依赖绝对标度）：
  - `cv`：逐行墨迹宽度的变异系数。真实曲线随层位变化（实测 ≥0.32），
    色块宽度恒定（实测 ≤0.008），两者相差约 39 倍。
  - `fill_ratio`：均值墨迹宽 / 列宽。色块填满整列（实测 ≥0.98），
    曲线有留白（实测 ≤0.74）。

  命中该键的列**数据照原样返回**，只是附带"这不是曲线"的证据，供前端提示
  用户确认——按 §2 的"绝不返回替代数据"，此处不做静默剔除。

  注意：该键的输入源必须是灰度阈值二值化（`gray < 160`），**不能用
  `foreground_mask`**。Otsu 会把图版顶/底的整行浅灰边框线算成前景，把个别
  行的墨迹宽度人为拉满列宽，导致真实曲线的 `cv` 被压到 0.007 级别而误标
  （实测 `Pollen_CruveStyle` 的 col6：灰度口径 0.4545，掩膜口径 0.0074）。

---

### 4.4 `core.digitize`
对指定列执行初步数值化采样，提取初始曲线/条带点集并生成锚定控制点。

- **参数 (params)**：
  - `col_index` (integer, 必填): 目标列索引。
  - `reader_type` (string, 可选, 默认 `"area"`): 数值化识别器类型。
    **规范名只有三个单数**：`"area"` / `"line"` / `"bar"`，与 `plot_type`、
    `digitize_column` 共用同一套命名。历史别名 `"bars"` 只在入口归一化为 `"bar"`
    （见 `session_parts/digitize.py::normalize_reader_type`），不得成为第四条分支。
    未知值返回 `-32602` —— **不静默退化为均值**：那会让柱状图读数只有真值一半，
    而返回体里的 `reader_type` 仍回显用户传的名字（元数据说谎，详见
    `docs/findings/bench-issues/bench-pollen.md` P-04）。
- **返回 (result)**：
  ```json
  {
    "col_index": 0,
    "reader_type": "area",
    "control_points_count": 16,
    "points": [
      { "row": 511, "x": 315.0, "y": 511.0 },
      { "row": 512, "x": 317.5, "y": 512.0 },
      "..."
    ]
  }
  ```
- **契约要点**：数字化是**纯像素几何**，不需要标定；但取数范围受 ROI 约束。
  若某列 `[start, end]` 与 ROI 的 X 范围**完全不相交**，本方法返回 `-32602`，
  而不是产出一整列静默的 0 —— 列落在取数区之外意味着"没有数据"，不等于"数据为零"。

---

### 4.5 `core.updateControlPoint`
针对指定列的单行执行控制点交互修改或删除，并由后端使用保形样条插值（PCHIP）重新全列平滑重构曲线。

- **参数 (params)**：
  - `col_index` (integer, 必填): 目标列索引。
  - `row` (integer, 必填): 图像垂直像素行（Y轴）。
  - `x` (number, 必填): 鼠标在图表上点击或拖拽到的目标水平像素 X 坐标。
  - `remove` (boolean, 可选, 默认 `false`): 为 `true` 时表示删除距离 `row` 最近的手动控制点；为 `false` 时为新增或移动控制点。
- **返回 (result)**：
  ```json
  {
    "col_index": 0,
    "action": "updated",
    "updated_row": 800,
    "control_points_count": 17,
    "points": [
      { "row": 511, "x": 315.0, "y": 511.0 },
      "...",
      { "row": 800, "x": 370.0, "y": 800.0 },
      "..."
    ]
  }
  ```

---

### 4.6 `core.calibrateAxes`
绑定图表的科学标定轴（垂直深度的标尺，各列 X 轴的物理百分比/浓度比例尺）。

- **参数 (params)**：
  - `y_marks` (array of objects, 必填): Y 轴上**用户亲自点选的两个参考点**，至少 2 个：
    `[{"pixel": 556.0, "val": 1500.0}, {"pixel": 1311.0, "val": 4500.0}]`。
    点序无所谓，后端按像素 Y 排序后记录为 `top_px/top_cm` 与 `bottom_px/bottom_cm`。
  - `x_marks` (array of objects, 可选): X 轴各列标定标记列表：`[{"col_index": 0, "pixel": 315.0, "val": 0.0}, {"col_index": 0, "pixel": 445.0, "val": 100.0}]`。
  - `unit` (string, 可选, 默认 `"cm"`): 深度/年代单位自由文本（`cm` / `m` / `mm` / `cal yr BP` / `ka`）。
    刻意不做枚举：强行枚举会迫使用户误报自己的坐标轴。数值可向下递增（深度）或向上递增（年代），
    方向由 `val` 本身决定。
  - `primary_axis` (string, 可选, 默认 `"depth"`): **Y 轴测的是什么**，只接受 `"depth"` / `"age"`，
    非法值返回 `-32602`。这一项**不能由 `unit` 推断**：`cm`/`m` 只在常规写法下才暗示深度，
    `cal BP`/`ka` 只在常规写法下才暗示年代；猜错会把整根岩芯的样品放到"看起来合理但错误"的位置，
    且没有任何报错可察觉。
    - `"depth"`（默认）：Y 读数即深度，行为与历史版本完全一致。
    - `"age"`：Y 读数是年代，样品**深度由年代-深度模型反查**（`AgeDepthModel.predict_depth`，
      PCHIP 单调反演）。超出实测年龄范围的点会被标记；反查数量与范围随
      `mapped_samples.depth_provenance` 返回：
      `{"primary_axis":"age","depth_source":"…","inverse_extrapolated_count":N,"observed_age_range":[a,b]}`。
      此时若尚未载入年代-深度模型，反查无源，后端如实报 `STATE_ERROR`。
- **返回 (result)**：
  ```json
  {
    "status": "calibrated",
    "y_scale": { "slope": 1.0, "intercept": -511.0 },
    "x_scales": {
      "0": { "slope": 0.7692, "intercept": -242.3 }
    },
    "primary_axis": "depth"
  }
  ```
  `primary_axis` 是**后端生效值**的回显，而非请求值的复制——请求非法时调用方据此发现。
- **契约要点**：本方法**只写深度轴**，绝不改动取数区域 (ROI)；反向亦然（见 `roi.update`）。
  两个 `pixel` 相同会返回 `-32602`。

---

### 4.7 `roi.update`
更新数据取数区域 (ROI)。ROI 仅框定**从哪里取数**（排除坐标轴、文字、聚类树），不携带任何深度含义。

- **参数 (params)**：
  - `roi_id` (string, 可选): 目标 ROI。**多 ROI（冻结契约 v1.3）下这是关键参数**；
    省略时作用于 `active_roi_id`，仍无则退回首个 ROI。
  - `name` (string, 可选): 改名。
  - 几何（两种写法等价，取其一）：
    - `x0` / `x1` / `y0` / `y1` (number): 像素边界；或
    - `x` / `y` / `w` / `h` (number): 左上角 + 宽高。
  - `xlim` / `ylim` (number[2], 可选): 直接给区间写法（与 `x0/x1` 同义）。
  - `visible` (boolean, 可选): 显隐。
  - `composition` (boolean, 可选): 是否花粉组成型 ROI。
  - `form_defaults` (object, 可选): 形态默认值。
  - `columns_stale` (boolean, 可选): 标记已有列结果是否失效。
- **返回 (result)**：
  ```json
  {
    "data_xlim": [315.0, 1946.0],
    "data_ylim": [511.0, 1311.0],
    "roi": [315.0, 511.0, 1946.0, 1311.0]
  }
  ```
  实际返回体另含 `success` 与 `rois` 列表；以上为最小形状。
- **契约要点**：**绝不改动 `core.calibrateAxes` 建立的深度轴**。历史上两者共用一个结构体，
  拖一下 ROI 手柄就静默改写了深度。此外 ROI 是线去除的检测范围：更新 ROI 会作废缓存的线掩膜，
  下一次数字化按新范围重算。

---

### 4.8 `algorithm.degrid`
在 ROI 内检测横线（坐标网格线）与竖线（轴线脊线、列基线）并发布**去线掩膜**。

- **参数 (params)**：
  - `strength` (string, 可选, 默认 `"medium"`): `"off"` / `"weak"` / `"medium"` / `"strong"`。
    `"off"` 会**主动清空**会话中的掩膜（不是只让前端停止绘制）。
  - `corrections` (array of objects, 可选): 用户人工修正笔迹，
    `[{"mode": "erase"|"restore", "radius": 6, "points": [[x, y], ...]}]`；`erase` 擦掉误标，`restore` 补回漏标。
  - `remove_vertical` (boolean, 可选, 默认 `true`): 是否同时剔除竖线。
- **返回 (result)**：
  ```json
  {
    "success": true,
    "strength": "medium",
    "remove_vertical": true,
    "max_thickness": 3,
    "horizontal_rows": [],
    "vertical_cols": [319, 320, 1774, 1775],
    "removed_lines_count": 4,
    "removed_pixels": 2900,
    "auto_pixels": 2900,
    "manual_restore_pixels": 0,
    "manual_erase_pixels": 0,
    "roi": [315, 511, 1946, 1311],
    "overlay_png": "data:image/png;base64,..."
  }
  ```
- **判定准则**：一条线必须同时**够长**（相对 ROI 跨度的形态学开运算）且**够薄**
  （垂直于线方向的墨迹厚度 ≤ `max_thickness`）。真实花粉实心轮廓被横线穿过时厚度达数十像素，
  因此被保留；旧实现按"整行占据率"删除整行，实测在内置 Hoya 图上把 *Pinus* 列 **99%** 的实心轮廓抹掉，
  而该图 ROI 内根本没有横向网格线。
- **契约要点**：`overlay_png` 是**唯一事实源**——前端 B 键透视画的
  就是这张图（白=保留墨迹，红=实际剔除像素），所见即数字化所用。
  掩膜存于会话（`grid_line_mask`），数字化时从墨迹中减去；原始 `foreground_mask` **不被就地修改**，
  分列检测仍看到完整墨迹。

---

### 4.9 `core.exportData`
将数值化并经过标定的完整数据矩阵导出为结构化表格（CSV 或 Parquet）。

- **参数 (params)**：
  - `format` (string, 可选, 默认 `"csv"`): `"csv"` 或 `"parquet"`。
  - `strict` (boolean, 可选, 默认 `false`): 严格模式。若为 `true`，则必须已完成坐标标定，否则返回错误码 `-32003`。
  - `output_path` (string, 可选): 导出文件保存的目标路径。若未提供且 format 为 csv，则在响应对象中返回 `csv_content` 字符串。
- **返回 (result)**：
  ```json
  {
    "format": "csv",
    "strict": true,
    "rows_count": 801,
    "columns_count": 4,
    "columns": ["depth", "col_0", "col_1", "col_2"],
    "data": [
      { "depth": 0.0, "col_0": 0.0, "col_1": 15.2, "col_2": 3.4 },
      "..."
    ],
    "file_path": "E:/software_dev/straditize/export.csv",
    "csv_content": null
  }
  ```

---

### 4.10 `column.calibrateXTicks` 与 `column.clearXTicks`
步骤 6 属种列 X-轴标尺标定与清空。

- **`column.calibrateXTicks`**：
  - **参数 (params)**：
    - `col_index` (int | str, 必填): 目标列全局序号或列 id（如 `"roi_1_col01"`）。
    - `ticks` (array of `{px: float, value: float}`, 必填): 恰好 2 个端点刻度齿。
    - `unit` (string, 可选): 单位（未传保持原值）。
    - `plot_type` (string, 可选): 图表形态，取值 `"area"` / `"line"` / `"bar"`（与 §4.4 的 `READER_TYPES` 共用同一套**单数**命名）。未传保持原值。
      当前实现**不校验**该值：未知字符串会被原样存储，也不参与任何计算分支（数值化分支看 §4.4 的 `reader_type`），
      见 `docs/findings/spec-enum-audit.md` D-4。
    - `scale_type` (string, 可选): `"linear"` 或 `"log"`（未传保持原值）。大小写与首尾空白会被归一化（`LOG` 与 `log` 等价）；
      其它取值返回 `-32602`，**不静默按线性换算**（见 `xscale.py::normalize_scale_type`）。
    - `exaggeration_mult` (float | null, 可选): 局部放大倍数。
  - **返回 (result)**：`{"col_index": 0, "x_ticks": [...], "px_per_unit": 2.5, "column": {...}}`

- **`column.clearXTicks`**：
  - **参数 (params)**：`{"col_index": 0}`
  - **返回 (result)**：`{"col_index": 0, "x_ticks": null, "cleared": true}`

---

### 4.10b `straditize.getDiagramData` — 列的标度溯源 `scale_provenance`
前端渲染工作区所读的权威状态。除既有字段外，每个列对象携带一个
**可选**键 `scale_provenance`，回答"这一列的 X 标度数字是谁给的"：

```json
{
  "col_index": 0,
  "name": "Pinus",
  "startX": 319, "endX": 497,
  "x_ticks": null,
  "startValue": 0.0, "tickValue": 20.0, "maxPercent": 20.0,
  "scale_provenance": { "calibrated": false, "source": "legacy" }
}
```

- `calibrated`：**唯一权威判据**。`false` 表示该列尚未由用户真实标定，
  上面的 `startValue`/`tickValue` 是图版默认占位值，**不是量出来的读数**。
- `source` 取值与 `resolve_column_scale` 的优先级链一致：
  | source | 含义 |
  | :--- | :--- |
  | `x_ticks` | 用户标定的两个真实刻度端点（唯一可信来源） |
  | `group` | 由所属 X 组的 `tick_layout` + 列的 `x_values` 推出 |
  | `x_scales` | 会话级 `x_scales` 斜率/截距 |
  | `legacy` | 遗留三件套字段（`startValue`/`tickValue`/`tickEndX`），未标定 |
  | `default` | 完全无标度信息时的内置默认值 |

- **`x_group_id`（2026-10-31 起载荷携带）**：该列所属 X 组的 id（`roi.x_groups[].id`）。
  在此之前**整个列载荷没有这个字段**，前端读到 `undefined` 只能把每列都当成默认组，
  于是分组界面永远显示错误归属、用户无法判断哪列在哪组。分组功能依赖它，删掉即断。

> 为什么需要这个键：`getDiagramData` 始终会填上 `startValue`/`tickValue`
> （历史契约与前端渲染都依赖它们存在）。因此"界面上显示 20"并不蕴含
> "后端认为该列量程是 20%"。`scale_provenance` 把这一区别显式化，
> 使前端可以把未标定列的数值渲染成"建议值（来源：图版默认）"而非裸数字。
> 该键**不写入工程包**（`project_save` 的列白名单不含它）。

---

### 4.10c `algorithm.measureRuler` — 刻度尺**几何**（只读，不产出读数）
步骤 6 的「参考标尺模数」用它拿到每列刻度尺的客观几何：轴线行、刻线 x 位置、
格数、刻距、是否规则。后端实现见 `ruler.py::detect_ruler_for_columns` 与
`session_parts/xticks.py::measure_ruler_geometry`。

- **参数 (params)**：`{"roi_id": "roi_1"}`（可选；缺省用 `active_roi_id`）
- **返回 (result)**：

```json
{
  "roi_id": "roi_1",
  "per_column": [
    { "col_index": 0, "name": "col01", "axis_row": 1664,
      "axis_x": 259, "axis_x_right": 262,
      "ticks": [323, 449, 573, 699, 825],
      "n_cells": 4, "spacing_px": 126.0, "regular": true, "column_width": 688 },

    { "col_index": 2, "name": "col03", "axis_row": 487,
      "axis_x": 332, "axis_x_right": 332,
      "ticks": [332], "n_cells": 1, "spacing_px": 13.0, "regular": null,
      "column_width": 13, "source": "column_width_as_unit",
      "note": "该列只画了一个刻度齿（满量程 < 刻度增量），按列宽 = 1 个单位刻度处理" },

    { "col_index": 0, "name": "col01", "axis_row": null,
      "axis_x": null, "axis_x_right": null,
      "ticks": [], "n_cells": 0, "spacing_px": 38.25, "regular": null,
      "column_width": 26, "source": "shared_scale", "cells_estimate": 0.68,
      "note": "该列没有画横轴（x.axis=FALSE），按同图共用刻距折算" }
  ],
  "median_spacing_px": 124.5,
  "all_regular": true,
  "calibration_suggestions": [],
  "note": "仅测量刻线几何（轴线/刻线/格数/刻距）。不产出任何满量程读数：…"
}
```

- **`source` 字段**（三种取值，见 `docs/ARCHITECTURE.md` §6.3）：
  - 缺省/`None` —— 本列直接测出了刻距；
  - `column_width_as_unit` —— **一格宽列**：图上只画了一个齿（满量程 < 刻度增量），
    `spacing_px` 取列宽，且**该列满量程是绘图器的最小量程（rioja `min.width` 默认 5），
    不是刻度增量 10**；
  - `shared_scale` —— **完全未画横轴**：`spacing_px` 沿用同图共用刻距，
    另给 `cells_estimate = 列宽 ÷ 刻距`（可为小数）。
- 「同图共用」只在「≥3 列测出刻距且多数与中位刻距偏差 ≤5%」时成立。
  判据刻意**不用变异系数**：单个伪刻线就会让 CV 超阈值，导致整批无轴列拿不到刻度。

| 字段 | 语义 |
| :--- | :--- |
| `ticks` | 刻线 x 中心（升序）。空数组 = 该列没检测到 |
| `n_cells` | `len(ticks) - 1`，只表示"画出来的刻线间隔数"，**不等于**该列的视觉格数 |
| `spacing_px` | 相邻刻线间距的中位数 |
| `regular` | 所有间距是否都在中位数 ±8% 内 |
| `median_spacing_px` | 全 ROI 中位刻距（仅供展示"检测到多大刻距"） |
| `axis_x` / `axis_x_right` | 该列**轴线**的实测左右缘（像素）。**面积图的 0 点画在轴线上，所以标定锚点必须用它**——`Column.startX` 只是列切分给的边界代理，实测可偏离轴线数个像素（22 列图上见过 6px，且偏离方向不固定：col1 的 start 在轴线右侧，col2/col3 在左侧）。轴线识别不到时为 `null`，调用方退回 `startX` |
| `calibration_suggestions` | **恒为空**：后端拒绝产出任何"建议量程" |

- **硬约束**：本方法**不产出任何读数**。每格代表多少是作图书版的设定，图上无法推得
  （跨列外推实测误差 84%–151%，反证表见 `ruler.py::suggest_scales`）。前端只允许
  把它当几何展示；**禁止**按齿数比例去推某一列的百分比。
- **错误**：未载图 → `-32001`；该 ROI 没有列 → `-32001`（提示先回步骤 5 分列）。

前端用法（`XTicksPanel`）：进入步骤 6 时拉一次，按 `{ROI, 图片, 列像素范围}` 缓存。
面板只把结果压成一行（`检测：4 列 · 刻距 124.5px · 规则`），并用
`max(ticks[-1] - col.start)` 作为「基线 → 末齿」的自动跨度；用户只需读一个末齿读数，
点【对齐本组】即以列基线为 0 点、按同一斜率标定全组。**失败必须冒泡**
（`notifyError` + 面板原文），不得退化成"0 条刻线"，也不得退回任何写死的跨度。

---

### 4.11 `roi.groupCreate` / `roi.groupUpdate` / `roi.groupRemove`
ROI 内列分组管理（设计 2026-09-29 v2）。

- **`roi.groupCreate`**：
  - **参数 (params)**：`{"roi_id": "roi_1", "name": "默认组", "unit": "%", "plot_type": "area", "scale_type": "linear", "tick_layout": [{"rel": 0.0}, {"rel": 1.0}]}`
  - **返回 (result)**：`{"roi_id": "roi_1", "group": {...}, "groups_count": 2}`

- **`roi.groupUpdate`**：
  - **参数 (params)**：`{"roi_id": "roi_1", "group_id": "roi_1_grp1", "updates": {"unit": "‰"}}`
  - **返回 (result)**：`{"roi_id": "roi_1", "group": {...}}`

- **`roi.groupRemove`**：
  - **参数 (params)**：`{"roi_id": "roi_1", "group_id": "roi_1_grp2"}`
  - **返回 (result)**：`{"roi_id": "roi_1", "removed_group_id": "roi_1_grp2", "fallback_group_id": "roi_1_grp1", "reassigned_columns_count": 3, "groups_count": 1}`

---

### 4.12 `project.save` — 工程包导出（含占位表标记）

请求：`{output_path?, format?: "tar" | "json"}`。`output_path` 缺省时 tar 以 base64 返回。

响应（tar 分支）：

```json
{
  "success": true,
  "size": 12345,
  "path": "out/project.tar",
  "data_csv_placeholder": false,
  "data_csv_placeholder_reason": null
}
```

- `data.csv` 的真实导出失败时，后端仍产出工程包（保底不报错），但**必须显式标记**：
  `manifest.json` 增加 `data_csv_placeholder`（含 `reason` / `notice` /
  `zeros_are_not_measurements`），tar 里紧跟一份 `data.csv.PLACEHOLDER.md`，
  响应体同时带上面两个字段。
- 占位表里每个数值都是 `0.00`，既不表示「未观测」也不表示「观测到 0」。README 里那句
  `unobserved taxa are strictly 0.0` 只描述**正常导出**的约定，不能用来解释占位表。
- `json` 分支不产 `data.csv`，故不带这两个字段。

> 实测触发例：载入一个 `line_removal.strength` 为数字（如 `0.6`）的历史工程包后导出，
> 网格去线预设只认 `weak` / `medium` / `strong`，`normalize_grid_line_strength` 抛
> `ValueError`，CSV 于是退化成占位表——旧实现把这条错误静默吞掉了。
## 4A. 年代-深度模型与年代集合（`agedepth.*` / `ensemble.*`）

> 本节是全量清单，不是示例：后端 `rpc_methods/agedepth.py` 注册的 12 个方法逐一在此展开。
> 其余方法族仍遵循 §4 的"示例目录"定位。
>
> 权威来源仍是代码；本节任何字段与 `straditize_core/session_parts/agedepth.py` 的返回字典
> 不一致时，以代码为准。

### 4A.0 通用约定

| 项 | 约定 |
| :--- | :--- |
| 深度单位 | 固定 `cm`，不做换算 |
| 年代单位 | 固定 `cal BP`，不做换算 |
| 原图为 `ka` | 调用方须自行乘 1000（如 0–12 ka 填 0 / 12000） |
| 原图为 AD/CE | 须自行换成 BP（`BP = 1950 − AD`），否则年代方向相反 |
| 未校正 ¹⁴C BP | 不是时间轴；本族方法不做校正曲线 |
| 状态错误码 | 未载图调用 `extractAndInspect` → `STATE_ERROR`；无模型调用 `generateEnsemble` → `CALIBRATION_ERROR` |
| **数值精度** | 年龄、深度、速率**原样输出，不做任何四舍五入**；未定义值为 `null` |

**为什么不做四舍五入**：任何一种舍入规则都是在替使用者猜精度，猜错的后果与 bug 无异：

| 曾用的规则 | 后果（实测于 `bacon_lithology.jpg`） |
| :--- | :--- |
| 年龄 `round(x, 2)` | 三行连续层位都显示 `0.37`；405 层的不同值 399 → 356 |
| 区间宽度 `Math.round` | 317 个不同宽度 → 97，表格看起来像编的 |
| 速率 `toFixed(1)` | 0.04 ka/cm 打成 `0.0 yr/cm`，读成「完全不沉积」 |

序列化直接发出计算结果。展示精度由使用方决定——前端 `formatNumber` 就是 `String(value)`。

### 4A.1 `agedepth.loadModelDiagram`

载入待识别的年代-深度图像。三种来源互斥。

- **参数 (params)**：
  ```json
  {"image_path": "D:/data/fig.png", "base64_data": null, "sample_key": null}
  ```
  | 字段 | 类型 | 说明 |
  | :--- | :--- | :--- |
  | `image_path` | string \| null | 本地绝对路径 |
  | `base64_data` | string \| null | Data URL 或裸 base64；前缀 `data:...;base64,` 会被剥掉 |
  | `sample_key` | string \| null | 内置范例：`"bacon"` → `bacon_szek.png`，`"bchron"` → `bchron_stepped.png`。**优先于前两者** |
- **返回 (result)**：`{"status": "loaded", "width": 761, "height": 998, "has_model": false}`
- **错误**：路径不存在或未给任何来源 → `FILE_NOT_FOUND_ERROR`
- **副作用**：替换 `age_depth_image`；`has_model` 反映**上一次**会话是否留有模型，不重置它

### 4A.2 `agedepth.extractAndInspect`

识别图中年代-深度曲线与置信带，并生成花粉样品层的年龄映射与年代集合。**本族唯一做图像识别的入口。**

- **参数 (params)**：
  ```json
  {
    "depth_px": [100.0, 865.0],
    "depth_vals": [0.0, 150.0],
    "age_px": [142.0, 731.5],
    "age_vals": [0.0, 9.0],
    "roi_box": null,
    "depth_range": [0.0, 450.0],
    "depth_log": false,
    "age_log": false,
    "exclude_boxes": [[120, 700, 300, 760]],
    "age_increases_downcore": null,
    "age_is_calendar_year": true,
    "curve_channel": "auto",
    "rate_columns": [],
    "calib_markers": [{"kind": "ageA", "x": 142.0, "y": 880.0}]
  }
  ```

  | 字段 | 类型 | 必填 | 说明 |
  | :--- | :--- | :--- | :--- |
  | `depth_px` / `depth_vals` | number[2] | ✅ | 深度轴两点标定（像素 y ↔ 深度值） |
  | `age_px` / `age_vals` | number[2] | ✅ | 年龄轴两点标定（像素 x ↔ 年龄值） |
  | `roi_box` | number[4] \| null | | `[x0,y0,x1,y1]` 搜索窗；省略时由坐标轴框线自动推定 |
  | `depth_range` | number[2] \| null | | 只提取该深度段（科学单位）。输出恒为**原生逐行采样**：重采样步长参数已删除——它只稀释输出网格、不影响速率与插值源（两者一直用原生采样），保留入口徒增误解 |
  | `depth_log` / `age_log` | bool | | 轴是否取对数 |
  | `exclude_boxes` | number[4][] \| null | | 橡皮擦矩形，光栅化为掩膜 |
  | `age_increases_downcore` | **bool \| null** | | 见下方专述 |
  | `age_is_calendar_year` | bool | | `false` 表示未校正 ¹⁴C，**跳过**年代集合生成 |
  | `curve_channel` | `"auto"` \| `"chroma"` \| `"darkness"` | | 定位中值线的响应通道 |
  | `rate_columns` | string[] | | 需输出沉积速率的列，白名单外忽略 |
  | `calib_markers` | object[] \| null | | 四点标定标记，仅存档进 `calib_state` |

- **`age_increases_downcore` 三态语义（2026-10-28 起）**：

  | 取值 | 行为 |
  | :--- | :--- |
  | `null`（**推荐默认**） | 由**追踪出的曲线本体**判定方向：取整条轨迹两两斜率的中位数，符号定方向。理由随 `metadata.age_direction_reason` 返回 |
  | `true` | 强制"向下年代变老"。若与曲线矛盾 → `ValueError` |
  | `false` | 强制"向下年代变新"。若与曲线矛盾 → `ValueError` |

  > **为什么不由标定推**：四点标定只说明每个轴的像素含义。沿曲线 `d(age)/dy = (d(age)/dx)·(dx/dy)`，
  > 而 `dx/dy` 属于曲线本身。实测反例 `bacon_szek.png`：轴 3000→0 向**右**变旧、深度向下增大，
  > 按轴符号推会得出"向下变新"，但该曲线从 x=803 走到 x=110，年龄实际**向下变老**。
  > 历史实现把该参数写死为 `true`，使所有"向上变老"的轴（典型 Bacon 顶轴 0→9 ka BP）100% 识别失败。

- **返回 (result)**：
  ```json
  {
    "status": "extracted",
    "inspection": { "...": "见 §4A.3 的 inspection 字段" },
    "mapped_samples": { "depths": [0.0, 5.0], "age_est": [], "age_min": [], "age_max": [],
                        "px_y": [], "px_x_curve": [], "rate": {} },
    "generated_ensemble": {"name": "Bacon_Ensemble_1000", "columns_count": 1002,
                           "rows_count": 30, "diagnostics": {}}
  }
  ```
  `mapped_samples` 与 `generated_ensemble` 可能为 `null`（无样品层位 / 已跳过集合）。

- **错误**：未载图 → `STATE_ERROR`；可用行数 < 5、通道观测比例 < 0.35、方向与曲线矛盾 → `ValueError`

### 4A.3 `agedepth.getInspection`

返回当前会话的年代模型检查数据，**不做识别、不改状态**。

- **参数 (params)**：无
- **返回 (result)**：
  ```json
  {"has_model": true, "has_image": true, "image_width": 761, "image_height": 998,
   "calib_state": {"depth_px": [], "age_px": [], "depth_vals": [], "age_vals": [],
                   "depth_unit": "cm", "age_unit": "cal BP", "cal_curve": "IntCal20",
                   "depth_range": null, "resample_step": null, "depth_log": false,
                   "age_log": false, "exclude_boxes": [], "calib_markers": null, "notes": ""},
   "inspection": { "depths": [], "ages": [], "age_min": [], "age_max": [],
                   "sed_rate": [], "sed_rate_se": [], "sed_window_depth": 32.0,
                   "px_points": {"y": [], "x_curve": [], "x_min": [], "x_max": []},
                   "decimation_step": 2, "metadata": {} }}
  ```
  无模型且无图像时只返回 `{"has_model": false, "has_image": false}`。

- **`inspection.sed_rate` / `sed_rate_se`（2026-10-29 新增）**：分窗回归沉积速率
  （`depth_unit`/年）及其标准误，**由后端按与 `depths` 相同的 stride 附带到同一行**，
  未定义处为 `null`。速率单元因此与表格行严格对齐——前端早期版本拿花粉样品的速率数组
  按模型行号取值，两副不同的深度网格互相错位，每行显示的是别的层位的速率。
  `sed_window_depth` 是回归窗口厚度（`depth_unit`）。前端任何改动曲线形状的操作
  （就地编辑数值、加点/删点/拖控制点）都会作废这三个字段，表格回退为按当前值重算的
  邻位差分（单位随之标注为 `yr/cm`），避免把陈旧拟合值显示成活数。

- **`inspection.metadata` 字段**：

  | 键 | 类型 | 说明 |
  | :--- | :--- | :--- |
  | `curve_type` / `envelope_type` | string | 固定 `"median"` / `"95_hpd"` |
  | `depth_unit` / `age_unit` | string | 固定 `"cm"` / `"cal BP"` |
  | `calibration_curve` | string | 校正曲线名 |
  | `notes` | string | 备注 |
  | `curve_channel` | `"chroma"` \| `"darkness"` | 实际用于定位中值线的通道 |
  | `curve_channel_reason` | string | 通道选择理由（含自动判定时的行数比） |
  | `observed_row_fraction` | number | 观测行占轨迹跨度比例；其余为插值 |
  | `roi_source` | string | 搜索窗来源，如 `"axis rule extents (117, 69, 737, 979)"` |
  | `age_increases_downcore` | bool | 最终采用的年代方向 |
  | `age_direction_reason` | string | 方向判定理由（含中位斜率与采样对一致率） |

- **`decimation_step` 语义**：`inspection` 与 `px_points` 内所有并行数组以**同一 stride** 抽稀，
  故可用同一索引 `i` 访问全部字段。任何一方单独抽稀都会让读数错位。

### 4A.4 `agedepth.updateModel`

用表格编辑后的数据整体替换会话模型。这是"图上微调 → 落盘"的唯一入口。

- **参数 (params)**：
  ```json
  {"depths": [0.0, 50.0], "ages": [0.0, 3200.0],
   "age_min": [0.0, 2900.0], "age_max": [0.0, 3500.0],
   "metadata": {"notes": "手工校正"}}
  ```
  `depths` 与 `ages` 长度必须一致且 ≥ 2；`age_min` / `age_max` 若给出，长度也须一致。
- **返回 (result)**：`{"success": true, "inspection": {...}, "mapped_samples": {...}}`
- **副作用**：按深度升序重排后重建模型；若有 `calib_state` 则重算 `px_points`；
  若 `age_is_calendar_year` 为真，同时覆盖 `AgeModel_Ensemble_1000` 集合表
- **注意**：本方法接收**浮点年龄**。前端曾把年龄取整后再传入，在 0→9 ka 轴上（65.5 px/ka）
  会把连续曲线压成个位数条柱状台阶——上游必须保留原始精度。

### 4A.5 `agedepth.generateEnsemble`

从当前模型生成年代集合表并挂载到会话。

- **参数 (params)**：`{"n_ensembles": 1000, "name": "My_Ensemble"}`
- **返回 (result)**：
  ```json
  {"success": true, "table_name": "My_Ensemble",
   "columns": ["depth", "age", "age_min", "age_max", "... (+997 cols)"],
   "rows_count": 30, "total_ensembles": 2}
  ```
  **`columns` 被截断为前 5 项加一条汇总串**，不是完整列名。
- **错误**：无模型 → `CALIBRATION_ERROR`

### 4A.6 `agedepth.generateBaconScript`

生成可直接运行的 rbacon R 脚本。

- **参数 (params)**：`{"dates": [...], "core_name": "MyCore", "thickness": 5.0, "cc": 1, "hiatus_depths": null, "slumps": null, "d_r": null, "d_std": null, "acc_mean": null, "mem_mean": 0.7}`
- **返回 (result)**：**纯字符串**（R 脚本全文），不是对象
- `dates` 元素形如 `{"depth": 10.0, "age": 1200, "error": 30}`
- `cc`：`0` = Non-14C（不做 ¹⁴C 校正），`1` = IntCal20，`2` = Marine20，`3` = SHCal20。
  **Python 侧不校验该值**：它原样写进生成的 rbacon 脚本（`Bacon(..., cc=N, ...)`，见
  `age_depth_model.py:1483`），其余整数的含义以 rbacon 文档为准——本层只保证透传，不替 rbacon 解释语义。

### 4A.7 `agedepth.generateGeoChronRScript`

生成 geoChronR（LiPD 输入）R 脚本。

- **参数 (params)**：`{"lipd_file_name": "site.lpd", "site_name": "PollenSite", "thickness": 5.0, "hiatus_depths": null}`
- **返回 (result)**：**纯字符串**（R 脚本全文）

### 4A.8 `agedepth.checkREnvironment`

探测本机 R 与年代学包。只读。

- **参数 (params)**：无
- **返回 (result)**：`{"has_r": true, "rscript_path": "...", "has_rbacon": true, "has_geochronr": false, "r_version": "R version 4.5.0 ..."}`
- 找不到 Rscript 时 `rscript_path` 与 `r_version` 为 `null`

### 4A.9 `agedepth.runLocalBacon`

调用本机 rbacon 执行 MCMC，成功时**替换**当前模型并挂载集合表。

- **参数 (params)**：`{"dates": [...], "core_name": "MyCore", "thickness": 5.0, "cc": 1, "hiatus_depths": null, "slumps": null, "d_r": null, "d_std": null, "depth_min": 0.0, "depth_max": 150.0, "depth_step": 1.0}`
- **返回 (result)**：rbacon 原始结果合并下列键
  ```json
  {"success": true, "depths": [], "ages": [], "age_min": [], "age_max": [],
   "inspection": {...}, "mapped_samples": {...},
   "generated_ensemble": {"name": "Bacon_Native_Ensemble_1000",
                          "columns_count": 1002, "rows_count": 30}}
  ```
- **失败返回**（不抛错）：`{"success": false, "has_local_r": false, "has_rbacon": false, "error": "..."}`

### 4A.10 `agedepth.runBaconModeling`

按优先级自动选择后端：本机 rbacon → WebR 增量包 → 报缺依赖。**前端应优先调它，而不是直接调 `runLocalBacon`。**

- **参数 (params)**：同 `runLocalBacon`
- **返回 (result)**，三种形态之一：
  | 分支 | 返回 |
  | :--- | :--- |
  | 本机 rbacon 可用 | 同 `runLocalBacon` 的成功结构 |
  | WebR 增量包已装 | `{"success": true, "backend": "webr", "code": "AGEDEPTH_WEBR_READY", "message": "...", "component_status": {...}}` |
  | 均不可用 | `{"success": false, "need_installation": true, "has_local_r": false, "has_rbacon": false, "r_version": null, "component_status": {...}, "code": "AGEDEPTH_NO_RBACON", "message": "..."}` |

  > `success: true` 而 `backend: "webr"` 表示**尚未计算**，只是算力就绪；不要当成"模型已生成"。

### 4A.11 `ensemble.add`

导入外部集合表（Bacon MCMC 实现或代用指标汇总）。同名表会被覆盖。

- **参数 (params)**：`{"name": "Bacon_MCMC", "columns": ["depth", "age"], "data": [[0.0, 0.0], [10.0, 800.0]]}`
- **返回 (result)**：`{"success": true, "ensemble_count": 2, "tables": ["Age_Ensemble_1000", "Bacon_MCMC"]}`

### 4A.12 `ensemble.list`

列出会话内所有集合表。只读。

- **参数 (params)**：无
- **返回 (result)**：`{"count": 1, "tables": [{"name": "Age_Ensemble_1000", "columns": ["depth", "..."], "rows": 30}]}`

### 4A.13 `mapped_samples` 的速率字段（沉积速率计算方式）

`extractAndInspect` / `updateModel` / `runLocalBacon` 返回的 `mapped_samples` 带三组速率。
它们都源自同一条年代模型曲线，差别只在**求导方式**，混用会得到不同数字。

**先决条件**：模型曲线由 `(depth, age)` 点经 PAVA 保序回归（年龄不随深度倒退）后，
用 **PCHIP 分段三次 Hermite 插值**（`scipy.interpolate.PchipInterpolator`）构成 $f(d)$。

| 字段 | 公式 | 单位 | 用途 |
| :--- | :--- | :--- | :--- |
| `acc_rate_yr_per_depth` | $\lvert f'(d)\rvert$ | `yr/cm` | 每厘米耗时；花粉累积量研究要这个 |
| `sed_rate_depth_per_yr` | $1 / \lvert f'(d)\rvert$ | `cm/yr` | 常规"沉积速率" |
| `volume_ar_cm_per_yr` | 同 `sed_rate_depth_per_yr` | `cm/yr` | 单位面积下 `cm3 cm-2 yr-1` 量纲等于 `cm/yr`，**不是独立测量** |
| `interval_acc_rate_yr_per_depth` | $\lvert \Delta age / \Delta depth \rvert$ | `yr/cm` | 相邻样品层位的割线斜率 |
| `interval_sed_rate_depth_per_yr` | $1 / \lvert \Delta age / \Delta depth \rvert$ | `cm/yr` | 同上取倒 |
| `sed_rate_yr_per_cm` | 同 `acc_rate_yr_per_depth` | `yr/cm` | **遗留键，同名不同义**，勿按字面理解为"每年多少厘米" |

**全部速率都是「每真实年」，不随年龄轴量级变化（2026-10-28 修正）**：

提取出的年龄数值随用户标定的量级走——`0..9` 的 ka 轴给出 0–9 的数值——而 `age_unit`
是提取时传入的标签，`0..9` 与 `0..9000` 的标签都可能是 `cal BP`。所以 `predict_age`
从**年龄跨度自身**推断换算系数（`age_span / depth_span < 0.35` → 视为 ka），并在返回里
以 `years_per_age_unit` 如实曝出。

修正前直接把 `ka/cm` 斜率取倒，导出的 `sed_rate (cm per yr)` 列在 ka 轴上**大 1000 倍**
（实测 `bacon_lithology.jpg`：导出 960.5，真值 0.96）。速率列名也因此从
`acc_rate ({age_unit} per {depth_unit})` 改为 `acc_rate (yr per {depth_unit})`——
标签必须描述真实单位，不能套用年龄轴标签。

**为什么两种求导并存**：解析导数 $\lvert f'(d)\rvert$ 是曲线上某点的瞬时斜率；
`interval_*` 是相邻两层位之间的平均斜率。花粉一粒计数代表一段沉积区间而非瞬间，
多数场景下 `interval_*` 更诚实。两者数值**不相等**，本文档不宣称哪个"对"，由使用者按语义选。

**不提供的量**：

| 量 | 原因 |
| :--- | :--- |
| MAR（`g cm-2 yr-1`） | 需干容重，图上读不出，须调用方自行从体积速率换算 |
| 点估计速率的置信区间 | 单条中值曲线求导无法给出；不确定度须由 `generate_age_ensemble` 逐成员求导取后验 |
| 未校正 ¹⁴C 年代下的速率 | `age_is_calendar_year=false` 时本族不产出年代数据 |

**序列化约束（2026-10-28 修正）**：

1. **未定义速率一律为 `null`，绝不写成 `0`**。PCHIP 导数在平台段可为精确 0，
   此时累积率未定义，其倒数同理。写成 `0.0` 等于声称"完全不沉积"，与实情相反。
2. **速率原样输出，不做舍入**。曾用 4 位小数，在速率 < 0.01 时破坏
   `acc_rate × sed_rate = 1` 的互倒数关系（实测最差 5.3%、32 个层位中 21 个不成立）；
   现直接发出计算值，互倒数精确成立，调用方可用两列相乘校验。

### 4A.14 `mapped_samples.sedimentation` —— 带误差棒的速率（推荐使用）

上表五个字段都是「单条中值曲线的逐点导数」。那不适合作为最终报告值：逐点导数把逐像素
追踪噪声直接放大进速率、不附任何不确定度、且在保序回归压平的段上退化为未定义。

`extractAndInspect` / `updateModel` / `runLocalBacon` 的 `mapped_samples.sedimentation`
提供一个可出具的替代量：**滑动窗口内对 (depth, age) 做普通最小二乘**，斜率取倒得速率，
斜率的**解析标准误**经 $\delta(1/b) = se(b)/b^2$ 传播。

**计算式**

$$\text{age} = a + b\cdot\text{depth},\quad
\text{sed} = \frac{1}{b \cdot s},\quad
se(\text{sed}) = \frac{se(b)\cdot s}{(b s)^2}$$

其中 $s$ = `years_per_age_unit`（见下）。

**返回结构**

| 键 | 类型 | 说明 |
| :--- | :--- | :--- |
| `depths` | number[] | 报告层位 |
| `sed_rate` | (number\|null)[] | **`cm/yr`**，未定义处为 `null` |
| `sed_rate_se` | (number\|null)[] | 速率误差棒，单位同上（取 OLS 与包络两者较大值） |
| `sed_rate_se_ols` | (number\|null)[] | 仅 OLS 的标准误，供审计：它系统性偏小 |
| `acc_rate` / `acc_rate_se` | (number\|null)[] | 倒数形式，`yr/cm` |
| `status` | string[] | `ok` / `extrapolated` / `non_positive_slope` / `too_few_horizons` / `zero_depth_spread` |
| `window_depth` | number | 实际使用的窗口**厚度**（深度单位） |
| `window_per_horizon` | number[] | 每个层位实际落入窗口的层位数 |
| `age_scale_inferred` | string | `years` 或 `ka (inferred from magnitude)` |
| `years_per_age_unit` | number | `1.0` 或 `1000.0` |
| `rate_units` / `method` | object / string | 单位与算法自述 |

**窗口是「深度厚度」，不是层位数**。层位密度是重采样产物，不是信息量：native 追踪每
0.2 cm 一行，按「20 层」取窗只有 4 cm 厚，薄到 PCHIP 曲线局部线性、OLS 残差归零，
于是报出 `se = 0.0`（假的"无限确信"），还放过了 126 cm 处 0.96 cm/yr 的异常尖峰。
现在窗口由厚度控制：从 `3 × 中位层距` 起按 1.5 倍加宽，直到速率相对不确定度达标，
上限为观测跨度的 20%（`max_window_fraction`）。也可用 `window=<厚度>` 直接指定。

**为什么 `sed_rate_se` 不取 OLS**：曲线是穿过数字化点的**光滑插值**，窗口内残差只反映
插值的曲率，不反映追踪噪声，所以 OLS 标准误系统性偏小。真实不确定度来自提取的 95%
包络：窗口两端的半宽按平方和合成，除以窗口厚度得斜率误差。两者取较大值上报，同时在
`sed_rate_se_ols` 里保留 OLS 值，便于核对。

**`years_per_age_unit` 是必需的**：年龄轴可能是 `0..9000 cal BP` 也可能是 `0..9 ka`，
两者标签都是 `cal BP`，无法从字符串判断量级。本字段从年龄跨度自身推断并如实返回。
实测：同一岩芯按「年」与「按 ka」各建一次模型，`sed_rate` 完全一致（0.040130 cm/yr）；
若省略该换算，两者会相差整 1000 倍。

**实测精度参考**（`bacon_lithology.jpg`，0–9 ka BP，160 cm）：窗口自动定在 31.7 cm，
`sed_rate` 中位 0.026 cm/yr，误差棒中位约 41%——这张图的 95% 带相对年龄跨度较宽，
速率本来就约束不强。**41% 是诚实的答案**，不是算法缺陷。

**什么时候某个层位是 `null`**：窗口内斜率 ≤ 0（年代不随深度前进）、窗口内层位不足 3 个、
深度无跨度。这三种情况如实报 `null` + `status` 原因，不给数字。注意「整体下移一段年代」
不算倒置——窗口内斜率仍为正，仍会给出速率。

**两个速率并存时的取舍**：逐点导数（§4A.13 表）反映局部变化，适合看曲线形态；
`sedimentation` 的分窗速率是**可报告值**，因为每个数都带误差棒。学术引用请用后者。

**导出列**：在 `mapped_samples` 之外，导出表格可勾选三个分窗列
（`windowed_sed_rate` / `windowed_sed_rate_se` / `windowed_acc_rate`），列名为
`sed_rate_windowed (cm per yr)` 等。估算被拒绝（层位不足）时这些列**不出现**，
而不是填占位值。

---

## 5. 服务端启动与调用示例

### 5.1 启动方式
```bash
# 1. 以 Stdio 模式运行（由前端主进程作为子进程启动）
pixi run python -m straditize_core.rpc_server --stdio

# 2. 以 Localhost HTTP/SSE 服务模式运行（默认端口 8765）
pixi run python -m straditize_core.rpc_server --http --port 8765
```

### 5.2 前端 JavaScript / TypeScript 调用示例
```typescript
async function rpcCall(method: string, params: Record<string, any> = {}) {
  const response = await fetch("http://127.0.0.1:8765/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now()
    })
  });
  const data = await response.json();
  if (data.error) {
    throw new Error(`RPC Error [${data.error.code}]: ${data.error.message}`);
  }
  return data.result;
}

// 示例调用：加载图像并提取列
const imageInfo = await rpcCall("core.loadImage", { image_path: "path/to/img.png" });
const columns = await rpcCall("core.detectColumns", { data_xlim: [300, 1800], data_ylim: [500, 1300] });
```
