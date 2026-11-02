# 投产巡检待补项登记册

> **这个文件为什么存在**：Lead 明确要求「确保它们登记在案，别只是报告里的一句话」。
> 报告里的文字会随报告翻页消失；这里每一条都是**可追踪、有判据、有验收条件**的条目，
> 由 `scripts/prod_gate/probe_self_evidence.py` 的 `REGISTRY` 里 `pending: true` 项
> 直接对应（代码与文档双向指向）。
>
> 归属：投产验收巡检（prod-gate-auditor）。写作用域内（`scripts/prod_gate/`）。
> 本轮**不修**这些，只登记。

---

## P-1 `g02_project_versions.py` 的 v3 段用「存在性」代替「相等性」

| 项 | 内容 |
| :--- | :--- |
| **文件** | `scripts/prod_gate/g02_project_versions.py` 第 149-155 行（v3 变体循环） |
| **当前断言** | 只打印/检查 `columns_count`、`is_calibrated`、`len(s.columns)`、`len(samples)`、`y_scale` |
| **缺什么** | 没有断言「载回后的字段值 **等于** 包内值」。`y_scale` 只是被 print 出来给人看，不是断言 |
| **为什么危险** | 「能载入」≠「载回保真」。一个把 `y_scale.slope` 错成 0 的回归，会让这段探针**依然通过** |
| **证据等级** | 主报告 §6.3 的往返比对（58 字段 diff=0）是**手工跑的**，未固化成断言；手工结论不可复跑 |
| **验收条件** | ① 对每个版本变体，逐字段比对包内值与会话值（至少覆盖 `y_scale`、`samples`、每列 `x_ticks`、`depth_calibration`、`rois[].xlim/ylim`）；② 注入一个已知改动（如把 `y_scale.slope` 改成 0）确认探针**会红** |
| **判据类型** | `existence` → 应升为 `equality` |
| **优先级** | P2（不影响当前结论，但影响下一轮的可信度） |

## P-2 `g03_exports.py` 的逐格对账从未失败过（无金丝雀）

| 项 | 内容 |
| :--- | :--- |
| **文件** | `scripts/prod_gate/g03_exports.py` 第 179-190 行（tar/data.csv vs csv 逐格 `diffs` 计数） |
| **当前断言** | 统计 `diffs` 并打印「数值格差异数 = 0」 |
| **缺什么** | 没有任何证据证明这个对账**真的能发现差异**。它至今从未报过红 |
| **为什么危险** | 一个从不失败的门禁等于没有门禁。若 `float()` 解析全部抛异常被 `except` 吞掉，`diffs` 会恒为 0 而看起来"完全一致" |
| **证据等级** | 主报告 §7.6 的「表头一致 / 数值格差异 0」依赖这个对账；它自身未被验证 |
| **验收条件** | 注入一个已知改动（如把 tar 内某格 +1，或把 csv 某格改写）→ 对账必须报 `diffs >= 1` 并指出行列号 |
| **判据类型** | `behaviour`（需金丝雀证明灵敏度） |
| **优先级** | P2 |

## P-3 `_geometry_in_scope` 第 3 档「无 scope 视为在范围内」

| 项 | 内容 |
| :--- | :--- |
| **文件** | `straditize_core/session_parts/cleanup.py`（`_geometry_in_scope` 末段） |
| **当前行为** | 几何若无 `image_scope` 字段，一律视为「属于当前图」 |
| **为什么危险** | 任何绕过 `image_scope` 写入的几何会在**任意图**上生效。这是 C1e 四方案矩阵里 A / C / "当前实现" 在 S2 放行的**共同原因**（实测误删 1214 px，其中 y=200/600 两行凭空消失） |
| **证据等级** | 已实测（主报告 §D.2 / §D.3），非推断 |
| **建议方向（已获 Lead 采纳为 P2）** | ① 保存时给所有几何补写指纹；② 载入旧包（几何无 scope）且当前会话已有指纹时，补绑当前指纹并记 `scope_backfilled: true`；③ 把第 3 档逐步收窄为「仅当当前会话也没有指纹时才放行」 |
| **验收条件** | 载入一个「几何无 scope」的包后，几何的 `image_scope.fingerprint` 被补写为当前图指纹，且该包被重存后几何携带指纹；再换异图 → 几何失效 |
| **优先级** | P2（Lead 已排期，不进本轮） |

## P-4 B-06 撤销标定 —— **已关闭**（2026-10-23 02:0x，附证据等级）

| 项 | 内容 |
| :--- | :--- |
| **探针** | `scripts/prod_gate/b06_undo_probe.py`（6 项判据） |
| **状态** | 已修复并复验，6 项全 PASS，退出码 `0` |
| **绑定哈希** | `session_parts/project.py` = `95c401ff84a3c93a8a21b619e0ce7300c00fda4a95ae3d26b62d6b4c8b2226a0` |

### 关闭理由**只包含这四条真证据**

| 判据 | 定性 |
| :--- | :--- |
| P1 首次 undo 为 None | 真绿 —— 根因一（记录顺序）修好 |
| P3 快照对象 id 不同 | 真绿 —— 根因二（深拷贝）修好 |
| P5 undo→redo 往返 | 真绿 —— 有效 |
| P6 浅拷贝危险面 | 真绿 —— 浅拷贝 4/4 污染、深拷贝 0/4 |

### **不**计入关闭理由的两条（假绿/弱绿，已如实标注）

| 判据 | 问题 |
| :--- | :--- |
| P2 二次 undo 不串味 | 场景弱：栈内无非空快照可串，不构成独立证据 |
| P4 写后读隔离 | 原为假绿（`null == null` 恒真）；修正后真绿但**浅拷贝对照组同样不被抓** → 对浅/深拷贝无判别力 |

### 重要定性（勿误读）

**深拷贝的价值是「防未来」，不是「修了一个正在发生的缺陷」。**
grep 全部后端源码：`x_ticks` 只有两处写入且都是整体替换
（`core.py:919`、`xticks.py:167`），**从无原地改**，故浅拷贝在旧实现下也不会产出错值。
deepcopy 消掉的是"将来任何人加一行 `x_ticks[i]['value'] = ...` 就中招"的隐患。

详细取证见主报告附录 F（§F.2 逐项定性、§F.4 机制结论、§F.8 两次自我修正）。

## 待验任务：验收探针已就绪（等 backend-fixer 落地）

| 任务 | 验收探针 | 通过标准 | 探针当前状态 |
| :--- | :--- | :--- | :--- |
| **task-6 / B-12** 就绪清单 | `b12_provenance_probe.py` 的 B12a/B12b/B12c | **三条同时满足**：零标定不 ready + 全标定 ready + 部分标定可判 | B12a **红**、B12b 绿、B12c **红** |
| **task-11 / provenance** | 同上 D1–D7 | **七条全绿**：D1–D5 内部正确 + D6/D7 真的下发且随状态变 | D1–D5 绿（内部对）、**D6/D7 红**（没下发） |
| **B-02 回归钉子** | 同上 D8a–D8c | 三条保持绿 | 三条绿 |

**两个已知陷阱（探针已内置判据）**：
1. B-12 **不能矫枉过正**改成永假 —— B12b（全标定必须 ready）会红。
2. provenance **不能只在内部算** —— D1–D5 只读 `resolve_column_scale`（内部函数），
   D6/D7 走真实 `straditize.getDiagramData` 载荷，验证它真的到了前端且随状态变。
   目前 payload 里有 `scaleCalib`（像素/数值端点），**它不是 provenance**，D6 刻意不接受它。

详细取证见主报告附录 G。

---

## 与代码登记表的对应

`scripts/prod_gate/probe_self_evidence.py` 的 `REGISTRY` 里：

```python
{"probe": "g02_project_versions.py :: v3 版本变体", ..., "pending": True}      # -> P-1
{"probe": "g03_exports.py :: 四产物逐格对账", ..., "pending": True}            # -> P-2
```

`pending: true` 的项在检查器里**不计入失败**，但会显式打印「未达标（PENDING）」，
并声明：**对应结论目前只能作为「存在性」证据，不能作为「保真」证据。**

P-3 属产品代码改动，不在我的写作用域内，故只在此登记、由 Lead 排期。

---

## 已关闭的待补项（留痕）

| 项 | 原问题 | 关闭依据 |
| :--- | :--- | :--- |
| 指纹截断当代理 | 我的 `c1e` 判别器用 `hexdigest()[:16]`，导致"指纹方案失效"假象 | 已改为完整 sha256；`probe_self_evidence.py` 第 1、5 项作为永久回归钉子 |
| 工程包是否有图的检测 | `format=json` 且不传 `output_path` 时不内嵌 `image.base64`（Lead 本轮踩点） | 已登记为 `probe_self_evidence.py` 第 2 项：检查器必须能分辨两种保存方式（实测 `传=True / 不传=False`） |
| 指纹缓存不清空 | `_image_fingerprint_cache` 从不清空 → hoya 与 beginner 指纹相同（Lead 实测均 `fea547fe…`） | backend-fixer 改为 `image` property setter 自动作废；`probe_self_evidence.py` 第 4 项实测四条路径（直接赋值 / rotate / 换图 / 载回包）全部正确 |
