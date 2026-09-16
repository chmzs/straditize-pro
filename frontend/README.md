# Straditize Modern Interactive Digitizer (Web Frontend)

现代化的地质/古气候图谱交互数字化前端工程，采用现代 TypeScript + Vite + HTML5 Canvas 架构。专为扫描花粉图谱、沉积物地层剖面设计，支持亚像素级交互与实时曲线吸附拉伸。

---

## 🌟 核心特性与交互设计

1. **高性能地学图谱视口引擎 (Viewport)**
   - 滚轮平滑缩放 (`Viewport.zoomAt`)，以鼠标为中心平滑缩放，范围覆盖 5% ~ 3000%；
   - 空格键 + 鼠标左键拖拽（或鼠标中键直接拖拽）全自由度平移；
   - 支持适应全图 (Fit) 与 1:1 物理像素居中复位；
   - 自动 DevicePixelRatio (DPR) 高清渲染，视网膜屏幕下线条锐利。

2. **半透明红色垂直分列标线 (Taxa Column Boundaries)**
   - 在图谱上方以半透明红色标线标定各 Taxa 属种列基线 (`startX`) 与满刻度线 (`endX`)；
   - 鼠标悬停进入 6px 阈值范围内即变亮为高光橙红，光标切换为 `col-resize`；
   - 按住标线直接左右拖动，实时微调属种范围，并自动保持相邻属种列无缝衔接。

3. **花粉轮廓线与控制锚点交互体系**
   - **普通左键点击**：在点击位置直接添加控制点，轮廓线平滑拉伸吸附到鼠标光标处；
   - **左键按住已有控制点**：实时拖拽调整轮廓走势；
   - **右键点击已有控制点**：直接删除该锚点，无需繁琐的辅助键，曲线自动重新平滑连接；
   - **撤销 / 重做 (Undo / Redo)**：支持 `Ctrl+Z` 与 `Ctrl+Y`（或 `Ctrl+Shift+Z`），记录所有加点、拖点、删点与边界拖拽操作；
   - **双插值渲染模式**：支持 Catmull-Rom 贝塞尔平滑与严格折线连接切换。

4. **专业属性面板与标定系统**
   - **左侧 Taxa 属种面板**：列出全部花粉属种、色标、基线像素范围、满刻度百分比、锚点数量（手动/自动点区分）、显隐切换；
   - **地层深度标定弹窗**：支持配置剖面顶界物理深度、底界深度、测量单位（如 cm、m、cal yr BP）及 Y 轴有效像素范围；
   - **实时数据导出**：支持一键导出标准 CSV 表格及结构化 JSON 数据，支持剪贴板复制及本地文件下载保存。

5. **JSON-RPC 2.0 Client / 高仿真 Mock 桥接层**
   - 实现标准 JSON-RPC 2.0 客户端；
   - 启动时自动探测后端 RPC 服务（默认 `http://127.0.0.1:8765/rpc`）；
   - **无后端时 100% 自主运行**：内置 Hoya del Castillo 真实花粉剖面地学数据（Pinus canariensis, Erica-type, Poaceae 等 8 大主属种），支持完全离线交互、编辑与导出；
   - 当 Agent 2 的 JSON-RPC 后端启动后，点击顶部状态药丸可随时无缝连接。

---

## 🚀 启动与构建

```bash
# 进入前端目录
cd frontend

# 安装依赖 (如尚未安装)
npm install

# 启动本地开发服务 (支持 HMR 热重载)
npm run dev

# 运行核心算法与逻辑回归自测
npm test

# 生产环境打包构建 (严格 TypeScript 类型检查 + Vite 优化)
npm run build
```

构建输出位于 `frontend/dist/`，可直接部署在任意 Web 服务器或由 Python 后端静态托管。

---

## 📡 JSON-RPC 2.0 协议规范 (与 Agent 2 对接)

| 方法名 | 说明 | 参数 Params | 返回值 Result |
| :--- | :--- | :--- | :--- |
| `straditize.ping` | 探测服务连通性 | `{}` | `true` |
| `straditize.getDiagramData` | 获取图谱及属种信息 | 无 | `DiagramData` |
| `straditize.updateCurvePoints` | 批量保存属种控制锚点 | `{ taxaId: string, points: ControlPoint[] }` | `boolean` |
| `straditize.updateColumnBoundary` | 调整属种列左右边界 | `{ taxaId: string, startX: number, endX: number }` | `boolean` |
| `straditize.digitizeColumn` | 请求算法重新识别曲线 | `{ taxaId: string }` | `ControlPoint[]` |
| `straditize.exportData` | 请求导出数字化结果 | `{ format: "csv" \| "json" }` | `string` |
