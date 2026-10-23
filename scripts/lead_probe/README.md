# Lead 自查探针（非交付物）

本目录是 Lead 在做"从零开始上机旅程"时用于**自证环境与因果**的一次性探针，
不属于最终交付文档集。保留它是为了让你能复跑 Lead 自己下过的结论。

| 文件 | 用途 |
| :--- | :--- |
| `serve_zero.py` | 真正的零状态后端（不预载图、不预跑分列）。`STRADITIZE_ZERO_PORT=22910 pixi run python scripts/lead_probe/serve_zero.py` |
| `drive_zero_upload.mjs` | 零状态 boot + 真实文件选择器上传（早期版本，含已知探针缺陷，见下） |
| `drive_zero_upload2.mjs` | 加固版：显式接管 dialog、Node 侧轮询等待、采集通知与失败 RPC |
| `drive_zero_upload3.mjs` | 记录 `core.loadImage` 与 `getDiagramData` 的完整载荷 |
| `drive_zero_upload4.mjs` | 完整 RPC 时序（含 `image.detectDeskew`），证明上传链路串行且最终态正确 |
| `race_ui.mjs` | 单标签页 6 轮上传，统计撕裂读数（结果：0） |
| `realistic_race.mjs` | 上传期间前端在途并发读（结果：0） |
| `twotab.mjs` | **两标签页并发**：A 页上传 + B 页轮询（结果：30 次撕裂，用户可达） |

## 一个必须记住的探针陷阱（Lead 自己踩过）

`page.waitForFunction(async () => {...})` 传入 **async 函数**时返回的是 Promise，
**永远为真值**，于是 waitForFunction 立即返回、根本没等待。Lead 的
`drive_zero_upload.mjs` 第一版就是这样，导致误判成"上传后仍是 0×0"。
正确写法是在 Node 侧用 `for` 循环 + `page.waitForTimeout` 轮询，或在页面内
用同步表达式。加固版见 `drive_zero_upload2.mjs`。

Playwright 默认会自动 dismiss 原生对话框；若该对话框正是"拦下操作"的原因，
不显式 `page.on('dialog')` 接管就会把它当成"什么都没发生"。

## 复现 Lead 下过的结论（Python，纯进程内，无需起 HTTP 服务）

| 脚本 | 复现哪条结论 | 一键命令 |
| :--- | :--- | :--- |
| `xticks_wipe_threshold.py` | 【P1】重新分列抹 `x_ticks` 的**触发条件表**（判据是"列数是否变化"，不是边界差 20px） | `pixi run python scripts/lead_probe/xticks_wipe_threshold.py` |
| `xticks_wipe_impact.py` | 【P1】同一物理读数换算值改变（13.9241% → 47.6190%） | `pixi run python scripts/lead_probe/xticks_wipe_impact.py` |
| `verify_xticks_wipe.py` | 同上，另一种写法（A/B/C 三情形），用于交叉验证 | `pixi run python scripts/lead_probe/verify_xticks_wipe.py` |
| `rpc_isolate.py` | 后端层面隔离：`loadImage` 从零/重传都建 ROI；`project.new` 后归零 | 需先起 `serve_zero.py`，改脚本内端口后 `pixi run python scripts/lead_probe/rpc_isolate.py` |
| `race_first.py` | 【P1】撕裂读首次发现（并发猛打，20/25 次撕裂） | 需先起 `serve_zero.py` |
| `race_strength.py` | 【P1】撕裂读强度（8 轮，8/8 轮出现，6~14 次/轮） | 需先起 `serve_zero.py` |
| `race_persistent_state.py` | 证明撕裂是**瞬时**的（并发结束后静态回读已恢复，故不夸大为永久损坏） | 需先起 `serve_zero.py` |

> 注：`race_*.py` 与 `rpc_isolate.py` 里的端口是写死的（22913）。请先按上面命令起
> `serve_zero.py`（`STRADITIZE_ZERO_PORT=22913`），或把脚本里的端口改成你自己的。
