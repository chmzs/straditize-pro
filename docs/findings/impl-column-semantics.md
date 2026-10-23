# 实现报告：按列判定单层/双层

> 规格：`docs/findings/spec-column-semantics.md`
> 代码绑定：`sha256sum straditize_core/image.py` = `92cc2af562463a03…`
> 门禁：`pixi run lint` 全绿 ｜ `pixi run test` **398 passed / 3 skipped**

---

## 1. 结论

**V1–V7 全部达标。** 核心目标达成：**单层灰列覆盖率 0% → 100%**。

| 判据 | 要求 | 实测 | 判定 |
| :--- | :--- | :--- | :--- |
| V1 基准通过率 | ≥ 97.4% | **97.4%**（228/234） | PASS |
| V2 多读（`shadow_leak>0.05`） | **= 0** | **0** | PASS |
| V3 混合图全对 | = 100% | **100%**（81/81） | PASS |
| V4 真实图版 8 类色簇 | 8/8 | **8/8** | PASS |
| V5 QA 单层灰列 | ≥ 95% | **100%** | PASS |
| V6 教程图 `removed` | = 0 | **0**（hoya / beginner 皆 0） | PASS |
| V7 门禁 | lint 绿 + ≥382 | 绿 + **398 passed** | PASS |

## 2. 实现要点

### 2.1 判据（规格 §3.1）

对每个列带，先数**墨层峰个数**：

- **≥2 峰 → 双层列**：亮的是包络、暗的是实心；边界取 `_resolve_solid_ratio` 的派生值
- **1 峰 → 单层列**：该峰就是实心，整列非纸像素进 `solid`，边界取 `峰 + ink_gap`
- 列带外像素用全图边界兜底

**为什么这是对的**（规格 §2 的决定性事实）：

| 图类型 | 列内峰 |
| :--- | :--- |
| 单层图 | 每列 **1** 个墨层峰 |
| 双层图 | 每列 **2** 个（Han2026 实测 15/15 列） |

### 2.2 三处关键改动

| # | 改动 | 为什么 |
| --: | :--- | :--- |
| 1 | `split_by_colour_and_luminance` 的 `column_edges` 分支重写 | 原实现让单层列也参与淡档判定（`pale_tier & vivid`），把单层灰列整块判成阴影 |
| 2 | **`_standard_foreground` 透传 `column_edges`** | 原实现无参调用 `split_by_colour_and_luminance(rgb)`，**按列分支永不生效** —— 这是 V5 仍为 0% 的直接原因 |
| 3 | 单层列边界**不再受 `solid_ratio` 截断** | 实测反例：单层灰列 215（rel 0.8431）配 `solid_ratio` 0.84 → `min` 取 0.84，峰 0.8431 > 0.84 → 整列判阴影、覆盖率 0% |

### 2.3 复用而非重写

按规格 §5"不引入新常数"的要求，按列分支**复用 `_resolve_solid_ratio`** 的派生边界与峰过滤，
不另写一套。新增的两个模块常量 `TWO_AXIS_INK_FLOOR` / `TWO_AXIS_INK_GAP`
**只是把该函数已有的默认参数提升为常量**（值相同：0.93 / 4.0），目的是让按列分支能复用同一判据，
避免"同一判据两处实现"的漂移。

## 3. 踩坑记录（供后续参考）

| 坑 | 现象 | 正解 |
| :--- | :--- | :--- |
| `ink_floor` / `ink_gap` 是 `_resolve_solid_ratio` 的**局部参数**，非模块常量 | `NameError` | 提升为模块常量，或直接复用函数返回值 |
| 只改 `split_by_colour_and_luminance` 不够 | V5 灰列仍 0% | 必须同时让 `_standard_foreground` 透传 `column_edges` |
| 单层列用 `min(solid_ratio, ...)` 截断边界 | 明度 215 的单层列覆盖率 0% | 单层列无包络，边界只需落在峰之上；仅以纸面 1.0 为上限 |

## 4. 新增测试（16 项）

`tests/unit/test_column_semantics.py`：

| 类 | 覆盖 |
| :--- | :--- |
| `TestSingleLayerColumns` | 单层灰列、5 档明度（0/60/120/182/215）、两列独立单层 |
| `TestDoubleLayerColumns` | 灰双层（182+229）、彩双层（深蓝+浅蓝），包络必须 0% 漏入 |
| `TestMixedFigure` | 单-双-单交错；包络跨界到邻列 |
| `TestLayerCounting` | 层数判定本身；**纯黑必须被检出**（`range(1,256)` 回归钉子） |
| `TestWithoutColumnEdges` | 不传边界时退回图级判据、两掩膜互斥 |
| `TestStandardPathIntegration` | `build_foreground` 必须透传 `column_edges` |

## 5. 未做（按规格 §5）

- 未改 `solid-over-shadow` 实验模式（保持显式拒绝）
- 未改 RPC 契约（本轮纯算法改动）
- 未改 `session_parts/` / `frontend/`

## 6. 复现

```bash
pixi run python scripts/benchmark_two_axis.py        # V1–V3
pixi run python -m pytest tests/unit/test_column_semantics.py -q   # 新增 16 项
pixi run lint && pixi run test                       # V7
```

V4（真实图版 8 类色簇）的复现命令见规格 §6。
