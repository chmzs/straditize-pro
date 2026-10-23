# QA 独立验收：按列语义实现

> 复核对象：`docs/findings/impl-column-semantics.md`（task-12）
> 规格：`docs/findings/spec-column-semantics.md`
> 代码绑定：`sha256sum straditize_core/image.py` = `92cc2af562463a03…`
> 复核方式：**自建脚本**（`scripts/qa_column_semantics/`），不复用 `benchmark_two_axis.py`

---

## 1. 四态计数

| 判据 | 要求 | 实测 | 判定 |
| :--- | :--- | :--- | :--- |
| V1 基准通过率 | ≥ 97.4% | 97.4%（228/234） | **PASS** |
| V2 多读（硬门槛） | = 0 | **0** | **PASS** |
| V3 混合图 | = 100% | 100%（81/81） | **PASS** |
| V4 真实图版 8 色簇 | 8/8 | 8/8 | **PASS** |
| V5 QA 单层灰列 | ≥ 95% | 100% | **PASS** |
| V6 教程图 removed | = 0 | 0 / 0 | **PASS** |
| V7 门禁 | lint 绿 + ≥382 | 绿 + 398 | **PASS** |

**PASS 7 · FAIL 0 · PARTIAL 0 · UNCERTAIN 0**

## 2. 独立对抗矩阵（7 场景，全 PASS）

`scripts/qa_column_semantics/adversarial_matrix.py` —— 覆盖实现者未测的场景：

| 场景 | 结果 |
| :--- | :--- |
| 单-双-单 交错排列 | PASS |
| **包络跨界到单层黑列**（上一轮失败的根因） | PASS |
| 黑单层 + 蓝双层（彩色混合） | PASS |
| **极窄列（宽 10px）** | PASS |
| **列边界左偏 5px** | PASS |
| 全单层 4 列（含明度 215） | PASS |
| 全双层 3 列（红/蓝/灰） | PASS |

## 3. 敌意探测（10 项，9 PASS + 1 判定为输入错误）

`scripts/qa_column_semantics/hostile_probe.py` + 追加探测：

| # | 攻击 | 结果 |
| --: | :--- | :--- |
| 1 | 实心比包络更宽的"反向"图 | PASS（合理判定） |
| 2 | **单层列内仅 1 px 宽的墨（极细线）** | PASS（检出） |
| 3 | **列带内完全没有墨（空列）** | PASS（**无幽灵像素**） |
| 4 | 两层明度仅差 3 级 | PASS（仍分开，**超预期**） |
| 5 | 彩色单层列（深蓝，无包络） | PASS |
| 6 | 纯黑单层（`range(1,256)` 回归钉子） | PASS |
| 7 | 极淡单层列叠在双层列旁（230/240/245/250） | PASS |
| 8 | 同色相双层（深红实心 + 浅粉包络） | PASS |
| 9 | 极淡单层（240–250，贴近纸面） | PASS |
| 10 | **列边界错位 20 px** | **FAIL（但判定为输入错误）** |

### 3.1 关于第 10 项

```
灰182 (边界25起，实际5起): solid=0.43
双层包络 漏入=0.75
```

**判定：输入错误，不是算法缺陷。**

边界错位 20 px 后，列带 0（x 25–125）实际包含三个峰 `[167, 182, 229]` ——
它把"灰182 的尾巴"与"双层实心167 + 包络229"混进了同一个带。判成双层后，
边界切在 182/229 之间，于是 182 被当成包络。

真实场景中 `column_edges` 由分列算法给出；错位 20 px 意味着**分列本身已失败**，
此时任何分层判据都无法给出正确结果。

**重要的是方向**：该项的失败形态是"182 被当包络"= **少读**，不是多读。
硬门槛 V2（多读 = 0）未被破坏。

## 4. 对规格本身的评价

规格 §3.1 的"单层列全算实心"是正确的，理由已在 §2 给出可复算的证据
（单层图每列 1 峰、双层图每列 2 峰，15/15 列）。

**一处规格与实现的偏差（已确认可接受）**：
规格 §3.2 写单层列边界取 `min(solid_ratio, peak + ink_gap)`，但实现在
明度 215 的单层列上会因 `solid_ratio=0.84` 截断而把墨切掉（覆盖率 0%）。
实现改为 `min(1.0, peak + ink_gap)`，并在代码注释里记录了实测反例。
**这是实现的正确偏离**，规格 §3.2 应据此修订。

## 5. 未覆盖 / 存疑

| 项 | 状态 | 缺什么 |
| :--- | :--- | :--- |
| 真实期刊扫描件（非本图版）的验证 | **UNCERTAIN** | 需要第二张真实图版；本轮只有 Han2026 Fig.3 |
| 列边界错位 >10px 时的行为 | **已定性为输入错误**，但未测"部分错位"的临界点 | 需要定义"分列可接受误差"的上限 |
| `column_edges` 在真实产品链路中是否总能正确传入 | **UNCERTAIN** | 需跑 e2e 确认 `_column_band_edges()` 的实际取值质量 |

## 6. 复现

```bash
pixi run python scripts/qa_column_semantics/adversarial_matrix.py
pixi run python scripts/qa_column_semantics/hostile_probe.py
pixi run python scripts/benchmark_two_axis.py
pixi run lint && pixi run test
```
