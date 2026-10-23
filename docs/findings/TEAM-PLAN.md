# 本轮团队组织与分工

> 触发：用真实期刊图版（Han et al. 2026 GPC 256:105195 Fig.3）内测，暴露多起缺陷。
> 用户要求"按照软件开发/调试/产品经理等组织架构组织人员"推进。

## 角色与职责

| 角色 | 成员 | 职责 | 任务 |
| :--- | :--- | :--- | :--- |
| **产品经理 / Lead** | lead（本会话） | 需求收敛、事实核实、任务书、门禁裁定、最终交付 | T4 收口 |
| **修复工程师** | fix-engineer | 修复 `Caryophyllaceae` 类灰度填充提取失败；`extraction_mode` 贯通 RPC↔UI | T5 |
| **数据工程师** | data-engineer | 产出读数来源可追溯的花粉表；论文量程交叉校验 | T7 |
| **QA / 质量门禁** | qa-reviewer | 独立复核全部结论；建"度量自欺"合成图门禁 | T8 |
| **（待认领）** | — | Step 6 刻线几何检测 + 按格数比例建议标定 | T6 |

## PM 已处置的风险

### R-1【已处置】我自己的度量错误

我最初报告"9/15 列提取失败、丢失 14804 像素"。**该结论错误**：
- 错误做法：用「该列最深 10% 像素」当"实心填充"参考 → 那 10% 主要是**抗锯齿边缘**
- 正确做法：用「亮度 ≤ 150」→ **14/15 列覆盖率 92–99.8%**
- **真实缺陷只有 1 列**：`Caryophyllaceae`（灰填充 182）被 Otsu 阈值 138 切掉，覆盖率 1.4%

已在 `defects-from-real-figure.md` 顶部加更正声明，并保留原文以示过程。
**教训**：代理指标（proxy metric）必须先用已知真值验证，再用它去测真实对象 → 这是 T8 的立项依据。

### R-2【进行中】收敛"数据可信度"的定义

`Pinus` 列深色像素只有 191 个，且仅出现在 y>700 层位。这说明该列**大部分层位接近 0**，
与论文报的 `max 40.74%`（整条记录历史极值）并不矛盾。
→ 数据工程师必须做**逐列偏差表**，不能只报 max。

## 门禁基线（交给 QA 作为对照）

`pixi run lint` exit 0 ｜ `pixi run test` 317 passed / 3 skipped ｜ `pixi run test-e2e` 85 passed

---

## PM 进展日志

### D+0 深夜 —— 刻线几何检测（task-6 前半，Lead 亲自完成）

新增 `straditize_core/ruler.py`（+ `tests/unit/test_ruler.py`，6 项全过）：

| 函数 | 作用 |
| :--- | :--- |
| `detect_ruler(gray, x0, x1)` | 单列刻线几何：轴线行、刻线列表、格数、刻距、是否规则 |
| `detect_ruler_for_columns(gray, cols)` | 批量 + 中位刻距 |
| `suggest_scales(...)` | **按设计不产出任何数字**（见下） |

**真实图版实测**：中位刻距 **12.5 px**，Cyperaceae **13 格**、Euphorbiaceae **17 格**、
窄列 2–3 格，15 列全部 `regular=True`，轴线一律检出 y=869。

### 踩坑记录（值得写进黑名单）

| 坑 | 现象 | 正解 |
| :--- | :--- | :--- |
| 刻线在轴线**下方**，不是上方 | 按上方找 → 全图 **0 检出** | 窗口取 `(axis+1, axis+8)` |
| 副齿只有 3–4 行 | `min_tick_height=4` → 格数少一半（Cyperaceae 只剩 7） | 取 3 |
| 窄列轴线覆盖率只有 71% | `min_coverage=0.80` → 窄列全部 `axis_row=None` | 取 0.65 |
| 轴线搜索窗口太靠底 | `search_from=0.85` → 柱体贴轴线的图版误判 | 取 0.70 |

### 最重要的一条：**跨列外推被实测否决**

原设想"刻距统一 ⟹ 满量程 ∝ 格数 ⟹ 用户读一列即可推导全部"。
以 Cyperaceae（13 格 = 70.07%，与论文吻合）为锚点外推：

```
Pinus            2 格 → 10.78  论文 40.74   误差 -74%
Artemisia        2 格 → 10.78  论文 67.42   误差 -84%   ← 刻距 12.5 vs 锚点 13.0，几乎相同！
Caryophyllaceae  2 格 → 10.78  论文  4.29   误差 +151%
Hippophae        3 格 → 16.17  论文  7.75   误差 +109%
```

**结论**：每格代表多少是作图书版设定，图上无信息可推。任何外推都是猜。
故 `suggest_scales()` 现在**一个数字都不产出**，只交出"格数"这一客观事实，
并给出拒绝理由。回归钉子：`test_suggest_scales_produces_no_numbers`。

### task-6 完成（Lead）

新增：
- `straditize_core/ruler.py` —— 刻线几何检测
- `straditize_core/session_parts/xticks.py::measure_ruler_geometry` —— 会话方法
- `straditize_core/rpc_methods/xticks.py` —— 注册 `algorithm.measureRuler`
- 契约同步：`protocol.py:ALL_RPC_METHODS` + `frontend/src/types/rpc.ts:RpcMethod`
- `tests/unit/test_ruler.py`（6 项）+ `tests/unit/test_measure_ruler_rpc.py`（8 项）

**门禁**：`pixi run lint` 全绿（ruff + 11 项一致性）｜`pixi run test` **331 passed / 3 skipped**
（较基线 317 增加 14 项新测试，零回归）。

**一致性检查器立功**：加 RPC 后立刻报
`FAIL H. 后端已注册 'algorithm.measureRuler'，但未在 ALL_RPC_METHODS 声明` 与
`FAIL I. 未在 rpc.ts:RpcMethod 声明` —— 这正是它存在的意义（历史事故：契约漂移被静默兜底）。

---

## 收口（Lead，2026-10-20 00:00）

### 团队产出

| 角色 | 交付 | 状态 |
| :--- | :--- | :--- |
| Lead（PM） | `ruler.py` + `measureRuler` RPC + 14 项测试 + `step6-ruler-assist.md` + 可信提取表 | ✅ |
| fix-engineer | `extraction_mode` 贯通 + `two_layer_split` + 止损（`solid-over-shadow` 显式拒绝） | ⚠️ 部分完成（如实报告） |
| qa-reviewer | `qa-review-real-figure.md` + `test_metric_sanity.py`（11 项）+ 23 脚本 | ✅ |
| data-engineer | — | ❌ 未交付，Lead 接手完成 |

### 关键成果

1. **`algorithm.measureRuler`**：刻线几何只读接口，实测中位刻距 12.5px，
   Cyperaceae 13 格、Euphorbiaceae 17 格，15 列 `regular=True`。
2. **可信提取表**：`Han2026_Fig3_trusted.csv`（479 行 × 3 列），
   Cyperaceae 提取 max 71.54% vs 论文 70.07%，**偏差 +2.1%**。
3. **最终裁定**：软件对深色实心层覆盖率 **100%**、浅色阴影 **0%**（均正确）；
   唯一真缺陷是**中灰填充（6427px）被二值阈值丢弃**。
4. **止损**：`solid-over-shadow` 现显式拒绝产出错误掩膜（危害从"污染数值"降为"功能不可用"）。

### 教训（三条，全部来自本轮真实翻车）

1. **代理指标必须先验证**。用"最深 10% 像素"代理"实心填充"→ 得出"9/15 列失败"的错误结论。
2. **度量口径必须绑定被测对象的定义方式**。填充层是**按颜色**定义的，
   却用**亮度**去代理 → 三方各得一个不同数字（1.4% / 80.9% / 37.5%），**三个都不对**。
3. **并发开发必须绑定哈希**。`image.py` 在复核期间改了 5 次，同一份测试在不同哈希上翻转。

### 派活教训

`data-engineer` 未能交付，因为任务前提（"按格数比例外推满量程"）被实测否决后未及时收敛。
**下次派数据任务，应把"可交付上限"先写死**（本例：只有 2 列可做）。

### 门禁终态

见 `README.md` §2.4 与 `bug-report.md` §0.5。


---

## 追加（2026-10-20 00:30）：后台代理遗留产出的裁定

`data-engineer` 在失败前留下了实质产出（`Han2026_Fig3_deviation.json`、
`Han2026_Fig3_with_paper_ranges.csv`、`de_*.png` 诊断图）。Lead 复核后裁定：

### 产出清单

| 文件 | 内容 | 处置 |
| :--- | :--- | :--- |
| `Han2026_Fig3_with_paper_ranges.csv` | 全 15 列，逐列标 provenance，表头明写 `paper_range` 非图版直读 | 保留（用法诚实） |
| `Han2026_Fig3_deviation.json` | 偏差表（提取 max vs 论文 max） | 保留作证据 |
| `de_*.png`（7 张） | Caryophyllaceae / Artemisia / 刻度尺诊断裁图 | 保留 |

### 裁定：`paper_range` 组的负偏是**方法论错误**

6 个 `paper_range` 列**全部负偏**（−13.8% ~ −88.5%），而 `human` 组的 Cyperaceae
只偏 −4.1%。若是算法缺陷，不会只挑 `paper_range` 组出错。

**根因**：把**论文 reported max（159 样品的历史极值）**当成了**图版满量程（作图轴上限）**。
两者没有函数关系。

**定量证据**：偏差与"曲线延伸占列宽比"**单调相关** ——
Cyperaceae 延伸占 96% 列宽 → 偏差 −4.1%；Pinus 占 26% → 偏差 −88.5%。
这正是"轴上限被设得比历史极值大"的直接体现。

详见 `adjudication-paper-range-bias.md`。

### 教训（第二条）

> **不要把"某论文报告的一个数字"当作"图版上某个几何量的真值"。**
> 前者是研究结果（统计量），后者是作图参数（视觉设计量）。

满量程**只能**取自图版刻度尺印刷数字；无数字的列**不可标定**，输出 `NA`。
论文 reported max 只能用于**量级合理性检查**，不能用于反推满量程。
