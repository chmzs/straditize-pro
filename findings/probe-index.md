# 探针索引（probe-index.md）

## 为什么有这份索引

`scripts/` 在 2026-10 的缺陷攻坚期累积了 **223 个一次性验证脚本**。它们回答过真实问题，
但**结论**已沉淀到 `docs/findings/`、回归测试与已修代码里 —— 脚本本身是过程产物。

2026-11-04 做分层治理（issue #11）：

1. **存续**：仍需长期复跑的升为 pixi 任务；门禁自证与真值生成器保留；
2. **归档**：其余从工作树移出，完整快照在 **tag `audit-2026-11-04`**（`git show audit-2026-11-04:scripts/<路径>`）；
3. **防复发**：新探针一律写进 `scripts/probes/`（**默认不入库**）；结论必须落成测试断言或在
   findings 里写清"判据 + 实测值"，否则算未完成。

**这份索引代替 tag 作为可读历史** —— 想知道"当初怎么验证的"，看表就够；真要看代码，再取 tag。

## 目录索引（已归档）

| 目录 | 当时在回答什么 | 结论落点 | 备注 |
|---|---|---|---|
| `static_audit/` | E1–E18：逐个操作问"会不会串状态/丢标定"（如 E10「换图不重置，第 4 步几何会不会串到新图」） | findings + 回归测试 | 53 个，多为 `exp{N}.py` 同骨架迭代 |
| `qa_review/` | 独立复核**产品判据本身**（如 C1「产品 Otsu 阈值真是 138 吗」用两条路互证） | findings | 55 个；`c2_*` 6 版是"用什么定义填充"的争议演进 |
| `prod_gate/` | 投产前巡检 gate，逐项过产品行为 | `production-gate-2026-10-23.md` | 33 个；其中 2 个门禁自证**已存续** |
| `lead_probe/` | Lead 亲自诊断（如真实期刊图版逐列识别率） | findings | 24 个；`serve_zero.py` 与 4 个 verify 脚本**已存续** |
| `verify_zero_flow/` | 独立复核 A/B/C，**刻意不复用队友脚本** | findings | 12 个 |
| `zero_flow_probes/` | 零态后端 + RPC 客户端（基础设施） | — | 17 个，5 份 RPC 客户端各写各的（膨胀证据） |
| `fix_probe/` | 特定修复的反证（如"局部阈值为什么救不回双层图"） | findings | 9 个 |
| `product_journey/` | 用户旅程逐列精度基准 | `bench-*.md` | 5 个 |
| `truth/` | 结构性判据验证（**取代**"数齿真值"——旧口径六次测量六个数字） | findings | 2 个，1 个已存续 |
| `qa_column_semantics/` | QA 对抗矩阵（攻击实现者没测到的场景） | findings | 2 个 |
| `cross_image_probe/`、`lock_probe/` | 换图状态残留复现 / B-08 并发压测 | findings | 各 1 个 |

## 存续件（仍在工作树）

| 文件 | 用途 | 入口 |
|---|---|---|
| `check_rpc_spec_drift.py` | RPC 文档 ↔ 代码漂移检查 | **pixi 任务**：`lint-rpc-doc`（`pixi run lint` 的一部分） |
| `record_tutorials.py` | 教程截图录制 | **pixi 任务**：`record-tutorials` |
| `benchmark_two_axis.py` | benchmark 图的逐列精度基准 | **pixi 任务**：`bench-two-axis` |
| `bench_golden.py`、`truth/` 中的结构性判据脚本 | 真值/基准生成 | 手动（结论进 `tests/data/`） |
| `prod_gate/probe_sensitivity_check.py`、`probe_self_evidence.py` | 门禁自证：证明对照组真改到了被操纵的变量 | 手动 |
| `lead_probe/serve_zero.py` | 零态后端（供 verify 脚本用） | **pixi 任务**：`serve-zero` |
| `lead_probe/verify_f01_fabricated_ticks.mjs`、`verify_f1_roi_rollback.py`、`verify_f2_cross_image.py` | 三条缺陷的复跑入口 | **pixi 任务**：`verify-f01` / `verify-f1` / `verify-f2`（前置 `serve-zero`） |

## 已知坏件（已修，留作教训）

- `lead_probe/xticks_wipe_threshold.py` 曾是**假 oracle**：它把 `x_ticks is None` 一律标"被抹掉"，
  而现行规格**要求**抹掉（靠 `x_ticks_dropped` 显式告知）。判据一移（silent → explicit），
  脚本就从证据变成假证据。**这不是"旧"，是"说反话"。** 已改为三态输出。
