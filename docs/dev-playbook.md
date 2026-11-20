# 开发/测试/调试手册（playbook）

> 面向"改一行代码、立刻看见效果"的日常循环。设计规范见 `ARCHITECTURE.md`，
> 测试策略见 `testing-strategy.md`，本文只记**怎么把环境跑起来**与**哪些坑已经踩过**。
> 所有命令与结论均在 2026-11-12 本机实测。

## 1 三十秒上手

```bash
cd E:/software_dev/straditize

# ① 环境体检（只读，19 项，PASS/WARN/FAIL）
pixi run doctor                    # == pixi run python support/dev_doctor.py

# ② 一条命令起「后端 + vite dev」，改 src 即热更新
pixi run dev                       # == pixi run python support/dev_up.py；后端 :8765 → 前端 :5173

# ③ 打开 http://127.0.0.1:5173/ ，浏览器句柄 window.__straditize 可直接调
```

`dev_up.py` 会先探测再启动：端口被你别的实例占着就**报错退出**，绝不静默换端口；
`Ctrl+C` 一次收掉后端与 npm 派生的 node。

## 2 命令速查（按你手上的活分层）

| 你要做的事 | 命令 | 说明 |
| --- | --- | --- |
| 环境体检 | `pixi run python support/dev_doctor.py [--json\|--tsc]` | 只读；`--json` 供脚本消费 |
| 后端 + 前端热更新 | `pixi run python support/dev_up.py` | 推荐日常 debug |
| 只起后端 | `pixi run python support/dev_up.py --no-vite --sample hoya` | 载内置范例，秒进有数据状态 |
| 只起前端 | `npm --prefix frontend run dev` | 需先有后端；代理目标由 `STRADITIZE_BACKEND` 决定 |
| 常规应用（自带前端） | `pixi run app` | 开浏览器 + 托管 `frontend/dist`，**要先 build** |
| 后端测试（全量） | `pixi run test` | = `python -m pytest -q`，约 3–4 min |
| 单个后端测试 | `pixi run python -m pytest tests/unit/test_x.py -q` | 不要用裸 `pytest`，见 §3-1 |
| 前端模块测试 | `npm --prefix frontend test` | 20 个 node 脚本 + e2e 类型检查 |
| E2E（全量） | `pixi run test-e2e` | 先 build，再 typecheck，再 playwright（152 用例/55 文件） |
| E2E（单文件，调试用） | `cd frontend && npx playwright test step4-cleanup.spec.ts --headed` | 单跑最快；`--headed` 看真实界面 |
| 契约快车道 | `pixi run test-contract` | 26 s，改 RPC 字段名先跑这条 |
| 从零旅程 lane | `pixi run test-e2e-zero` | 零状态后端；端口硬限 22920–22930 |
| 门禁三连 | `pixi run lint && pixi run test && npm --prefix frontend run build` | 与 CI 一致 |
| 打包 | `pixi run build-windows` | 依赖 `pyinstaller`，见 §3-1 的坑 |

## 3 已踩过的坑（症状 → 真因 → 正确做法）

### 3-1 `pixi run pytest` 报 `uv trampoline failed to canonicalize script path`

- **真因**：`.pixi/envs/default/Scripts/` 下 pip 装的 console script 是 46 KB 的 uv trampoline，已损坏。
  实测坏的：`pytest.exe`、`pyinstaller.exe`；没坏的：`ruff.exe`（26 MB 真二进制，conda 提供）。
- **正确做法**：`pixi run python -m pytest …` / `pixi run python -m PyInstaller …`。
- **影响面**：`pixi run test` 与 `pixi run lint` 本身是好的（它们分别写 `python -m pytest` 与 `ruff`），
  所以 CI 不受影响；受害的是你手敲的那些命令。

### 3-2 后端端口"自己跑了"，前后端连不上

- **真因**：`gateway/cli.py` 的 `start_desktop_mode` 用 `find_available_port(args.port or 8765)`
  —— 8765 被占时后端会**静默换到 8766**；而 `frontend/vite.config.ts` 的代理目标写死
  `STRADITIZE_BACKEND ?? http://127.0.0.1:8765`，于是代理打空。
- **正确做法**：用 `support/dev_up.py`（先探测、端口透传给 vite），或显式
  `STRADITIZE_BACKEND=http://127.0.0.1:<你的端口> npm --prefix frontend run dev`。

### 3-3 `pixi run app` 一闪而过，没有后端

- **真因**：桌面模式有单实例锁 `%TEMP%\straditize_desktop.lock`。锁指向的实例仍活着时，
  新进程**直接 return**（只开一个浏览器标签），`--port` 完全不生效。
- **正确做法**：`support/dev_doctor.py` 会报这条 WARN 并给出活端口；
  确认要并行第二份时用 `support/dev_up.py --mode serve`（`serve` 子命令不走单实例分支）。
- 锁残留（指向已死端口）会自愈：`check_single_instance` 会删掉它。

### 3-4 `timeout 60 npx …` 退出码 126、零输出

- **真因**：`timeout` 无法执行 `.cmd` shim（`npx` 是 `.cmd`）。
- **正确做法**：`timeout 60 cmd /c npx …`，或直接不加 `timeout` 靠 Playwright 自己的 `timeout` 配置。

### 3-5 `ego_*` 工具报 `EBUSY: … unlink '…\ego-lite-linux\profile\lockfile'`

- **真因**：ego 浏览器的 profile 被**活着的 Edge** 持有（`msedge.exe --class=ego-lite-linux
  --user-data-dir=…\ego-lite-linux\profile`），不是僵尸锁。`tasklist | findstr ego` 查不到它
  —— ego 以 `node.exe` + `msedge.exe --class=…` 形态存在。
- **正确做法**：等占用方释放，或复用它的会话（`ego_status` / `ego_tabs list`）。
  **不要删 lockfile**：删了不解除占用，还会伤到正在跑的会话。
- 判据：`support/dev_doctor.py` 的「ego profile 锁」一项会打印 `ego-cast.json` 里的 pid 与存活状态。

### 3-6 `EXECUTOR_UNAVAILABLE … awk.exe -> Temp\dsh-ops-niu-exec-*`

- **真因**：`dsh-ops` 的 exec-tree 复制在 link-count 计数上偶发失败（官方说明要求 ≥ 0.5.2；
  本机已是 0.5.4，仍偶发过一次）。属工具侧，不是仓库问题。
- **正确做法**：重试一次即可恢复；持续失败时按官方提示清理 exec-tree 缓存
  （`dsh-ops cache status --kind exec-tree` → `cache reclaim …`），不要绕过沙箱。

### 3-7 Windows/Shell 侧小坑（写脚本时会撞）

| 症状 | 真因 | 做法 |
| --- | --- | --- |
| `tasklist //FI "…"` 报 `Invalid argument/option` | MSYS bash 把 `/FI` 当路径改写 | 用 `powershell -NoProfile -Command "Get-CimInstance Win32_Process …"` |
| `Start-Process … -Environment` 参数不存在 | 本机只有 PowerShell 5.1 | 先设 `$env:X`，再用 `cmd /c start /b …` 继承 |
| `Start-Process` 报"字典中的关键字 HTTPS_PROXY / https_proxy" | 两个大小写变量并存 | 同上，或先 `Remove-Item Env:https_proxy` |
| 查询 bundle 目录"缺失" | DSH 双层解析：profile `node_modules` + **dsh 安装目录** `node_modules` | 12 个 `@deepseek-ai/*` core bundle 在后者，别误判 |

### 3-8 worktree 里跑不了 e2e（2026-11-12 实测）

- **症状**：`npx playwright test` 报
  `Process from config.webServer was not able to start. Exit code: 1`，
  看起来像"用例全红"，其实**一条都没跑**。
- **真因**：`frontend/playwright.config.ts` 的 `webServer` 是
  `pixi run python support/serve_e2e_backend.py`；pixi 会先对**工作树路径**做一次 editable 安装
  （`straditize-pro @ file:///…/.agents/worktrees/<name>`），uv 的 build cache 在
  `get_requires_for_build_editable.txt` 上 `PermissionError`，后端起不来。
- **三条规则**：
  1. **e2e 只在主 checkout 跑**；worktree 只用于改代码与跑单测（`pixi run python -m pytest`）。
  2. 多会话并发用**串行化 + 各自端口**隔离（`STRADITIZE_E2E_PORT=2301x`），
     不要指望用 worktree 隔离 `frontend/dist` —— `dist` 属于主 checkout，
     worktree 里跑 e2e 读到的是别人构建的产物。
  3. 跑 e2e 前必须 `npm --prefix frontend run build`，且**先看 BUILD 的退出码**：
     `BUILD≠0` 时 e2e 的"通过"是旧 `dist` 给的假绿（已实测踩过两次）。

### 3-9 步骤 7 侧栏选列与单列 Inspector 挂载解耦陷阱（2026-11-20 实测）

- **症状**：E2E 测试报 `locator('#btn-col-delete') element(s) not found` 或 `#btn-col-digitize` 找不到。
- **真因**：重构步骤 7 时，右侧面板恒定为「样品层位发现」；`SidebarBridge.ts` 在点击侧栏属种列时，未同步设置 `selectedEntity = { type: 'column', id: taxaId }`。当需要单列删除或重新取数时，单列属性检查器根本没有被挂载到 DOM 中。
- **正确做法**：`SidebarBridge.ts` 在 `STAGE.SPEARS_AND_SAMPLES`（步骤 7）点击属种列时，必须同步触发 `selectedEntity` 并通知 Inspector 重绘；`Inspector.ts` 条件中放开步骤 7 的单列渲染。

### 3-10 E2E 像素判据与 Canvas 描边抗锯齿羽化假红（2026-11-20 实测）

- **症状**：`step6-pick-highlight.spec.ts` 报 `ROI 上方 40px 之外不许被高亮染到 Expected: 0, Received: 1`（RGB `[255, 255, 255]` 变成 `[247, 251, 253]`）。
- **真因**：高亮边框以 `1.5 * k` 宽度描边，向上外扩半线宽，Canvas 还会产生 1–2px 的羽化抗锯齿过渡；而在低缩放比（例如 `scale = 0.43`）下，世界坐标 5px 换算为屏幕坐标仅 2.1px，直接踩中了描边的抗锯齿羽化带，并非高亮大范围溢出。
- **正确做法**：断言非目标区域未受污染时，采样点距离动态几何边框必须预留合理的物理像素安全缓冲（例如世界坐标距边框 $\ge 15\text{px}$），防止亚像素与抗锯齿带来假阳性。

### 3-11 按钮选择器贪婪匹配顶栏 Input title 冲突（2026-11-20 实测）

- **症状**：测试中点击【打开导出面板】按钮，导出模态框无反应或报未显示。
- **真因**：选择器写为 `[title*="导出"]`，而顶栏的项目名称输入框 title 也包含“导出”（`title="当前项目名称（用作导出与工程包文件名前缀...）"`），Playwright 误命中了该文本框而非按钮。
- **正确做法**：操作按钮必须使用精准的选择器（如 `#btn-export-csv` 或限定标签 `button#btn-export`），严禁使用宽松的通配属性选择器。

### 3-12 列表卡片循环中禁止使用静态 DOM ID（2026-11-20 实测）

- **症状**：`locator('#btn-col-delete') resolved to 2 elements` 严格模式报错。
- **真因**：在侧边栏属种卡片循环渲染的 HTML 模板中写死了静态 `id="btn-col-delete"`，导致页面上存在 N 个同名 ID，与检查器中的按钮冲突。
- **正确做法**：循环生成的列表元素一律使用 class（如 `class="btn-col-delete-action"`）并走父级事件委托，静态 `id` 仅保留给全局唯一的检查器或工具栏控件。

## 4 端口分配约定

| 端口 | 用途 | 谁在用 | 备注 |
| --- | --- | --- | --- |
| 8765 | 后端（桌面/serve 模式） | `pixi run app` / `dev_up.py` | vite 代理默认目标 |
| 5173 | vite dev（前端热更新） | `npm --prefix frontend run dev` | 被占时 vite 自己 +1 |
| 8799 | e2e 后端默认 | `pixi run test-e2e` | `STRADITIZE_E2E_PORT` 可改；`reuseExistingServer: false` |
| 22920–22930 | zero lane 后端 | `pixi run test-e2e-zero` | **`STRADITIZE_ZERO_PORT` 越界会在配置期直接抛错** |
| 23010–23015 | 建议的并发 e2e 段 | 多会话同时跑时 | 先跑 `dev_doctor.py` 看是否空闲 |

并发跑第二份 e2e：

```bash
STRADITIZE_E2E_PORT=23010 pixi run test-e2e     # 产物目录随之变 test-results-23010/
```

注意 zero lane 读的是**另一个**变量名（`STRADITIZE_ZERO_PORT`），别把 `23010` 传给它。

## 5 调试入口（不启浏览器也能查）

| 入口 | 用法 |
| --- | --- |
| `GET /health` | 判活 + 当前会话摘要（`has_image` / `width` / `columns_count` / `is_calibrated`） |
| `POST /rpc` | 裸 JSON-RPC。注意应用级错误是 **HTTP 200 + body.error**，只看 status 会漏 |
| `window.__straditize` | 浏览器内句柄：`getState()`（前端镜像）/ `gotoStage(n)` / `rpc(method, params)` |
| 后端权威状态 | `straditize.getDiagramData`；`samples` 是 client-owned，真相走 `samples.list` |
| 单条 e2e 复跑 | `cd frontend && npx playwright test <spec>.spec.ts --headed --debug` |
| trace | 失败自动留 `frontend/test-results-<port>/`；`npx playwright show-trace <zip>` |

判据纪律（与 `testing-strategy.md` §4 一致）：**`getState()` 只当前端镜像用**，
断言业务状态一律读后端权威 RPC；`page.reload()` 会被 `beforeunload` 守卫拦掉，
重建路径用 RPC（重新分列 / `gotoStage` / 换 ROI / 导出回读）。

## 6 交付前门禁顺序

```bash
pixi run lint                                  # ruff + 跨文件一致性 + RPC 文档漂移（约 1 s）
pixi run test                                  # 后端 798 条（约 3–4 min）
npm --prefix frontend run build                # tsc(src) + vite build
npm --prefix frontend test                     # node 层 + e2e 类型检查
pixi run test-e2e                              # 改了界面/RPC 才需要（build + typecheck + 152 用例）
```

前三条即 CI 内容；`test-contract`（26 s）适合"只动了 RPC 字段名"的快速反馈。
