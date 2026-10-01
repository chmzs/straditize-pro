# Straditize JSON-RPC 2.0 通信协议规范

本文档定义古气候图表数值化引擎 `straditize_core` 与前端（Web / Electron / Desktop UI）之间的 JSON-RPC 2.0 通信标准。

## 权威范围（请先读这段）

| 内容 | 权威来源 |
| :--- | :--- |
| 信封格式、错误码语义、传输方式（§1–§3） | **本文档**（已与 `protocol.py` / `errorCodes.ts` 对齐） |
| 逐方法的**参数名与返回字段** | **代码本身**：`straditize_core/rpc_methods/*.py` 中 `register_method` 的目标签名，以及 `session*.py` 的返回字典 |
| 前后端字段级对账 | `frontend/e2e/contract.spec.ts`（对真实 payload 断言 TS 声明） |
| 架构不变量与工作流语义 | `docs/ARCHITECTURE.md` |

**§4 是"示例目录"，不是全量清单。** 后端当前注册 **97** 个方法
（90 个应用 RPC + 7 个 MCP 协议方法），§4 只逐一展开了其中 9 个。拿 §4 当接口全集会漏掉
绝大多数方法；新增或修改方法时请以代码与 `contract.spec.ts` 为准，本文档按需补示例。

已核对并修正的偏差（2026-09-29）：§3 错误码表（`-32002` / `-32004` 原按旧语义书写）、
§4.1 `core.loadImage`（参数、缺失的副作用与返回字段）、§4.7 `roi.update`（缺 `roi_id`）。

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
    "image_path": "I:/software_dev/straditize/hoya-del-castillo.png",
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

---

### 4.4 `core.digitize`
对指定列执行初步数值化采样，提取初始曲线/条带点集并生成锚定控制点。

- **参数 (params)**：
  - `col_index` (integer, 必填): 目标列索引。
  - `reader_type` (string, 可选, 默认 `"line"`): 数值化识别器类型，支持 `"line"`、`"area"`、`"bars"`。
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
- **返回 (result)**：
  ```json
  {
    "status": "calibrated",
    "y_scale": { "slope": 1.0, "intercept": -511.0 },
    "x_scales": {
      "0": { "slope": 0.7692, "intercept": -242.3 }
    }
  }
  ```
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
    "file_path": "I:/software_dev/straditize/export.csv",
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
    - `plot_type` (string, 可选): 图表形态（未传保持原值）。
    - `scale_type` (string, 可选): `"linear"` 或 `"log"`（未传保持原值）。
    - `exaggeration_mult` (float | null, 可选): 局部放大倍数。
  - **返回 (result)**：`{"col_index": 0, "x_ticks": [...], "px_per_unit": 2.5, "column": {...}}`

- **`column.clearXTicks`**：
  - **参数 (params)**：`{"col_index": 0}`
  - **返回 (result)**：`{"col_index": 0, "x_ticks": null, "cleared": true}`

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
