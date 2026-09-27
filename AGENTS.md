# straditize 开发代理指南

> **这是操作手册。** 设计规范 / 架构不变量 / 交互规范在 `docs/ARCHITECTURE.md`；
> 跨会话断点与试错黑名单在 `HANDOFF.md`。三者分工不重叠，改动前先各就各位。

## 项目定位

现代版是 **Python 后端（`straditize_core`，JSON-RPC over HTTP）+ TypeScript 前端（`frontend/`，Vite）**。
后端同时托管前端静态资源，故浏览器**始终同源**（默认 `http://127.0.0.1:8765/`）。

`straditize/` 是上游第三方 PyQt5 原版（Author: Philipp Sommer），**本项目不维护、当前环境缺依赖跑不起来**，
仅作为内置范例的图片资源被引用。

**两条不可违反的不变量**（详见 `docs/ARCHITECTURE.md` §2、§9）：

1. 面向用户的数据**只能来自后端对用户输入的真实计算**；取不到就报错并停在原地，绝不返回替代数据。
2. 平移手势**全画布一致**：右键拖拽 / 中键拖拽 / 空格+左键，三者等价。

## 环境与依赖

- 使用项目根目录的 Pixi 环境；不要使用全局 Python。
- Python 约束见 `pixi.toml`，当前为 Python 3.12。
- 默认优先 PyPI wheel，以减小环境体积；只有 PyPI 不可用或缺少系统/原生依赖时才放入 `[dependencies]`（conda-forge）。
- 修改 `pixi.toml` 后运行 `pixi install` 并检查 `pixi.lock` 的变化。
- Python 包安装使用 Pixi 任务或 `pixi run python -m pip`，不要直接污染全局环境。
- `frontend/dist` 不入库且被 `pyproject.toml` 排除，**全新克隆必须先构建前端**；Node.js ≥ 20 是运行必需。
- ⚠️ 本机 npm 的 cache 默认指向 `D:\Program Files\nodejs\node_cache`（受保护目录），
  `npm install` 会以 `EPERM errno -4048` 失败。加 `--cache "$env:LOCALAPPDATA\npm-cache"` 即可，
  或一次性 `npm config set cache "$env:LOCALAPPDATA\npm-cache"` 改到可写位置。

## 常用命令

```bash
# 质量门禁
pixi run lint             # ruff 检查（straditize_core + tests）
pixi run format           # ruff 格式化
pixi run test             # pytest 全量后端测试
pixi run frontend-dev     # 前端开发服务器（vite:5173，已配好到 8765 的代理）

# 构建与启动
npm --prefix frontend run build   # 前端产物 → frontend/dist（后端据此托管界面）
pixi run app              # 现代版应用主入口（自动开浏览器 + 顶栏退出按钮 + WebMCP）
pixi run build-windows    # PyInstaller 独立分发包
```

前端包管理统一为 **npm**（锁文件只有 `frontend/package-lock.json`）；CI、pixi 任务与文档均使用 npm。

⚠️ 两个陷阱命令：

- `pixi run run-straditize`（`python -m straditize`）启动的是**上游 PyQt5 原版**，不是现代版，且当前环境缺 `docrep` 会直接报错。
- `pixi run test-legacy` 需要上述遗留依赖，当前环境不可用。

## 修改规范

- 先读相关模块和测试，再修改；优先补充回归测试。
- 不擅自删除或重命名公共 API。
- **前端错误必须冒泡到用户**：后端失败、契约不符一律显式报错；禁止静默兜底或替代数据（`docs/ARCHITECTURE.md` §2）。
- 改 **RPC 契约**（方法名 / 参数名 / 返回字段）必须同步前端、测试与 `docs/ARCHITECTURE.md`。
  —— 历史事故：前端发 `x_bounds` 而后端要 `data_xlim`，被静默兜底掩盖很久。
- 交互/键位变更必须同步全部画布与所有 tooltip / 注释 / 文档，不允许残留旧说法。
- 不提交 `.pixi/`、缓存、构建产物和本地 IDE 状态。
- 不自动执行破坏性 Git 操作；提交前保留他人的未提交修改。

## 验收门槛

提交或交付前至少运行：

1. `pixi run lint`
2. `pixi run test`
3. `npm --prefix frontend run build`（含 `tsc` 类型检查）
4. 改动前端逻辑时另跑 `npm --prefix frontend test`

CI（`.github/workflows/ci.yml`）执行的就是前三条；本地跑通这三条即与 CI 一致。

## 会话交接（项目特定部分）

规则与触发口令以全局 `~/.dsh/AGENTS.md` 为准，此处只记本项目特有的落点：

- 单一事实源：项目根 `HANDOFF.md`；全文 ≤ **50 行**，单节 ≤ 8 行，超限把最旧节整段移入 `HANDOFF-archive/`。
- **只改自己那一节**，严禁整文件覆盖或改写他节（本仓库长期多会话并发）。
- 黑名单节只追加不覆盖；冷历史（复盘、归档）只增不减、日常不加载。

## 索引

- 设计规范：`docs/ARCHITECTURE.md` ｜ 交接卡：`HANDOFF.md` ｜ 历史归档：`HANDOFF-archive/`
- 协议规范：`docs/JSON_RPC_SPECIFICATION.md` ｜ 教程：`docs/tutorials/`
