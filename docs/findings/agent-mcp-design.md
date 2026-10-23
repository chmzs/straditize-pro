# Agent / MCP 设计：怎样让机器自动提取「可信」数据

> 这份文档回答两个问题：
> ① AI 是**像人一样操作软件**，还是**用自己的方式**与软件交互？
> ② 要实现"机器自动化提取可信数据"的愿景，MCP / Agent 该怎么设计？
>
> 结论不是推演出来的，而是本轮真实上机 + 修 bug 逼出来的（见 [`production-readiness.md`](./production-readiness.md)）。

---

## 0. 先回答：像人，还是用自己的方式？

**分两层，不能用同一个答案。**

| 层 | 该像人 | 该用自己的方式 |
| :--- | :--- | :--- |
| **物理交互**（点按钮、拖手柄、缩放） | ❌ 不必 | ✅ 直接调语义接口（`roi.update`、`calibrateXTicks`） |
| **学术判断**（读数是 0 还是 40、这段是不是树花粉） | ✅ **必须像人**——而且必须由人签字 | ❌ 绝不能让 Agent 自己"推断" |

理由是一条硬事实：**软件当前分不清一个数字是人给的还是编的。**

本轮修的 Critical（B-01）就是活证据：前端拿硬编码 `0` / `20` 当"用户读数"写进后端，
后端如实标 `calibrated=True`，QA 如实显示"通过"——整条链**没有任何一处失守**，
因为它根本不知道这两个数字不该存在。一个 Agent 若沿用同一接口，
它可以同样"合法地"产出 6362 个错误数值格而不触发任何告警。

所以：**Agent 用机器接口操作是合理的（更快、更稳、可复现），
但凡是"人才能提供的知识"，接口层必须强制留痕、必须可拒。**

---

## 1. 现有 MCP 的形状与缺口

`straditize_core/mcp_server.py` 已把八步暴露为 MCP 工具（`straditize_load_image`、
`straditize_detect_xticks`、`straditize_calibrate_column`、`straditize_export` 等），
并支持两种后端：Live Web Bridge（转发到浏览器会话）与 Embedded Session（内存会话）。

**缺的不是工具数量，是三样东西：**

| 缺口 | 现状 | 后果 |
| :--- | :--- | :--- |
| **溯源（provenance）** | 工具 schema 里**没有任何**"这个读数谁提供的"字段 | Agent 的猜测与专家的判读在数据里**不可区分** |
| **能力边界（capability）** | 一个 token 能调全部工具，包括写读数 | Agent 越权"创造"读数无摩擦 |
| **可拒性（refusal）** | 接口总是尽量返回结果 | 取不到时倾向兜底，而兜底就是编造 |

---

## 2. 设计原则：把「可推」与「不可推」分开

### 2.1 三类量，三种权限

| 类别 | 例子 | 谁能定 | Agent 能否自动 |
| :--- | :--- | :--- | :--- |
| **可计算量** | 列边界像素、曲线控制点、刻度齿的 x 坐标、ROI 框的墨迹统计 | 算法 | ✅ 完全可以，越自动越好 |
| **人工判读量** | 某列满量程是 20% 还是 40%、某层位对应多少 cm、某个属种叫什么 | **人** | ❌ **只能提议，不能落写** |
| **派生量** | 百分比、深度、年龄 | 由前两者算出 | ✅ 但必须可追溯到输入 |

本轮修法的实质，就是把「刻度**位置**（可计算）」与「刻度**读数**（人工判读）」
拆开：检测只更新 `detected_ticks` / `tickEndX`，**不再**写 `x_ticks`。
这一刀应该成为所有 MCP 工具的通用规则。

### 2.2 接口契约：写入人工判读量必须带 `provenance`

```jsonc
// straditize_calibrate_column
{
  "col_index": 0,
  "ticks": [{"px": 322, "value": 0}, {"px": 402, "value": 40}],
  "unit": "%",
  "provenance": {              // ← 新增必填
    "source": "human",          // human | instrument | literature | agent_inferred
    "ref": "doi:10.xxxx/yyy#fig4",   // 若来自文献/图版
    "note": "图版横轴标注 0–40%",
    "asserted_by": "zhangsan",  // 谁签的字
    "asserted_at": "2026-10-19T19:00:00+08:00"
  }
}
```

服务端规则（关键）：
- `source == "agent_inferred"` → **拒绝写入**，只允许进"建议队列"（`proposed_ticks`）。
- `source == "human"` 但缺 `asserted_by` → 拒绝。
- 导出的 CSV / LiPD 必须把 `provenance` 一并带出（LiPD 有 `pub`/`notes` 可承载）。

这样"可信"才有定义：**每个进入论文的数字，都能回答"谁说的、依据什么"。**

### 2.3 工具应按「阶段 + 权限」拆分，而不是一个大接口

建议把写操作拆成 proposal / commit 两段：

```
straditize_detect_xticks      → 只读，返回齿位 + 置信度       （无副作用）
straditize_propose_ticks      → 写 proposed_ticks，不生效      （Agent 可调）
straditize_commit_ticks       → 需 provenance + 人工确认       （Agent 不可单独调）
```

好处：Agent 可以**尽情提议**（这正是它擅长的：OCR 命名、从图注解析刻度范围），
但"生效"这一步始终有人类签名。这比"禁止 Agent 碰标定"更实用——禁止会让 Agent 变废。

---

## 3. 让 Agent 的输出「可被审计」而非「可信」

不该指望 Agent 不出错（本轮 Agent 自己就踩了
`waitForFunction(async …)` 恒真、把"单跑绿"当"全量绿"两个坑）。
正确做法是让它**输出可审计**：

1. **每次调用落一条 operation log**：工具名、入参、返回、耗时、token 身份。
   本轮一个真实收获：`journey-trace.json` 这种"每步后端权威快照"就是这种日志，
   出了问题能精确定位到哪一步。
2. **幂等 + 可重放**：给定同一输入与随机种子，结果必须一致。
   本仓库 e2e 的 `e2e.reset` + 固定端口就是这个思路。
3. **断言式自检**：Agent 每步应断言"我期望的后端状态"，而不是"界面没报错"。
   这是本轮发现 `element was detached`（按钮点不中）与"单跑绿/全量红"的唯一手段。

---

## 4. 数据可信度的工程落地（建议顺序）

| 优先级 | 动作 | 为什么先做 |
| :--- | --- | --- |
| 1 | `provenance` 字段进 `calibrateXTicks` / `calibrateAxes` / `batchSetTaxa`，并强制导出携带 | 这是"可信"的定义本身；不加，前面所有自动化都在放大不可验证的数字 |
| 2 | 去掉所有"取不到就给默认值"的兜底（本轮已完成步骤 6 这一处） | 兜底 = 编造；§2 不变量已经写明"取不到就报错并停在原地" |
| 3 | 导出与 QA 共用同一解析入口（已具备：`resolve_column_scale`） | 防止"同一列两条换算链"（历史顽疾） |
| 4 | 加"建议队列"：Agent 的推断只入队，不入库 | 让 Agent 有用武之地而不越权 |
| 5 | 多人/多进程前的会话写锁 | 双标签页撕裂读已是 P3 风险，投产前必须解决 |

---

## 5. 一段最小可用的 Agent 契约（可直接照此实现 MCP 工具）

```python
# 伪代码：检测只读、提议入队、提交需签名
def detect_xticks(roi_id):                       # 可自动
    return {"band": ..., "per_column": [...]}    # 含 ticks 像素与置信度

def propose_ticks(col_index, ticks, reason):     # Agent 可调
    assert reason, "必须说明推断依据"
    queue.append({...})                          # 不改变 x_ticks
    return {"queued": True}

def commit_ticks(col_index, ticks, provenance):  # 需 human
    if provenance["source"] == "agent_inferred":
        raise JsonRpcError(-32003, "Agent 推断不得直接写入；请人工确认后以 human 身份提交")
    write_x_ticks(col_index, ticks, provenance)  # 同时落 operation log
    return {"x_ticks": ticks}
```

---

## 6. 一句话

**机器擅长"找位置"和"读得更多"，人负责"给数值"和"签字"。**
MCP 的价值不在于让 Agent 假装成人点完八步，而在于
**把可计算的部分全自动、把人工判读的部分全部留痕、并且让拒绝成为一等公民。**
本轮把"软件替用户编造读数"这条路堵死了；`provenance` 是把"可信"从口号变成数据字段的下一步。
