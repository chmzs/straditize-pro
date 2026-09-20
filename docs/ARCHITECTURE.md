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
`tests/test_no_fabrication.py` 是守卫测试，不得放宽。

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
| `H` / `R` | 抓手平移 / ROI 有效区 |
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
S0 空状态 → S1 载入 → S2 ROI 有效区 → S3 分列 → S4 标尺标定 → S5 拐点精修 → S6 校验 → S7 导出
```

定义见 `frontend/src/types/workflow.ts`。阶段与可用工具的映射是**唯一事实源**：
`GeologyCanvas.getAllowedTools()` —— 浮动工具条置灰、键盘守卫、鼠标编辑路径三处都必须走它。

---

## 6. 坐标真值源与标定

**两点式物理刻度钉**（放弃 0–100% 相对假定）。`startValue`/`tickValue` 为物理值，
`startX`/`tickEndX` 为对应像素：

$$\text{Linear: } v(x) = s + \frac{x - x_s}{x_t - x_s}(t - s)$$
$$\text{Log: } v(x) = \exp\left(\ln s + \frac{x - x_s}{x_t - x_s}(\ln t - \ln s)\right)$$

**Log 硬约束**：`startValue > 0`、`tickValue > 0`、二者不等；界面即时禁用并提示，绝不静默退化。

**关键区分（易错）**：

- **ROI（数据有效区）是"取数区域"，不是标尺**。它与深度/时间标定**相互独立**：
  标定刻度选在哪里，不得影响取数区域，反之亦然（历史上二者耦合，导致"换个标定就静默截断曲线"）。
- 后端 `suggest_data_region()` **只给区域、不给深度**；深度只能来自用户在 S4 的两点标定。
- 逐列百分比同理：每列印出的最大刻度值只能**人读**，禁止推断或填默认值冒充。

---

## 7. 分列 → 数字化的数据流

```text
core.loadImage          → 载入图像 + suggested_roi（仅区域）
core.detectColumns      → 列边界（data_xlim / data_ylim 为参）
core.digitize(col)      → 该列曲线控制点（纯像素几何，与标定无关）
calibrate_axes          → y_scale（深度）+ x_scales[col]（百分比）
core.extractGridValues  → 按标准深度层位求交，未观测填 0.0（绝不输出 NA）
core.exportData / project.save
```

**注意**：`digitize` 是纯几何，不需要标定；`x_scales` 缺失时**不得**拿列宽当 100% 冒充读数。

---

## 8. 前端构建与产物

- `frontend/dist` **不入库**（`frontend/.gitignore`），且 `pyproject.toml` 显式 `exclude = ["frontend*"]`。
  因此**全新克隆必须先构建前端**，否则后端托管不到界面（会在 `/status` 给出提示）。
- Node.js ≥ 20 是**运行必需**，不是"仅开发需要"。
- 前端存在**两份锁文件**（`package-lock.json` 与 `pnpm-lock.yaml`）：CI 用 npm，
  `pixi run frontend-dev` 用 pnpm。二者可能漂移，改动依赖时需同时照顾。
- 开发模式用 Vite 代理保持同源（`frontend/vite.config.ts`），**不要**为此放开后端跨源。
  代理的 `changeOrigin` 必须为 `false`，否则 Host 被改写会触发同源校验拒绝。

---

## 9. 不变量速查（code review 用）

1. 数据只能来自后端真实计算；取不到就报错，禁止替代数据。
2. 平移手势全画布一致：右键 / 中键 / 空格+左键。
3. ROI ≠ 标尺；`suggest_data_region()` 不给深度。
4. 每列刻度值只能人读，不得填默认值冒充。
5. 绝不回显 `Access-Control-Allow-Origin: *`，绝不放开跨源换开发便利。
6. 阶段→工具表只有 `getAllowedTools()` 一份。
7. 画布叠加层用**固定高对比色**（主题色会消失在用户图上）；UI 文字必须用主题变量。
8. 改 RPC 契约必须同步前端、测试与本文档。
