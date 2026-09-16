# Straditize JSON-RPC 2.0 通信协议规范

本文档定义古气候图表数值化引擎 `straditize_core` 与前端（Web / Electron / Desktop UI）之间的 JSON-RPC 2.0 通信标准。

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
| `-32001` | **Session state error** | 业务前置条件未满足（例如未加载图片直接执行识别列或数字化）。 |
| `-32002` | **File not found error** | 指定的图片文件或输入目标路径在文件系统不存在。 |
| `-32003` | **Calibration error** | 科学坐标标定数据缺失（例如 `strict: true` 导出时未先完成标定）。 |
| `-32004` | **Export error** | 导出数据格式失败或缺少依赖（如缺少 parquet 引擎）。 |

---

## 4. 核心 RPC 方法定义

### 4.1 `core.loadImage`
加载图表原始图像到后端核心会话。

- **参数 (params)**：
  - `image_path` (string, 必填): 本地文件绝对路径或相对工作区路径。
- **返回 (result)**：
  ```json
  {
    "width": 1946,
    "height": 1311,
    "format": "PNG",
    "mode": "RGBA",
    "image_path": "I:/software_dev/straditize/diagram.png"
  }
  ```

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
绑定图表的科学标定轴（如垂直深度的标尺，各列 X 轴的物理百分比/浓度比例尺）。

- **参数 (params)**：
  - `y_marks` (array of objects, 必填): Y 轴标定标记列表，至少 2 个点：`[{"pixel": 511.0, "val": 0.0}, {"pixel": 1311.0, "val": 800.0}]`。
  - `x_marks` (array of objects, 可选): X 轴各列标定标记列表：`[{"col_index": 0, "pixel": 315.0, "val": 0.0}, {"col_index": 0, "pixel": 445.0, "val": 100.0}]`。
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

---

### 4.7 `core.exportData`
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
