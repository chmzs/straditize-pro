# 列分组（ROI 内）设计（v2，决议已定）

> 状态：**决议已定，待实施**（2026-09-29）。
> 上游依据：`docs/plans/2026-09-29-per-step-usage-audit.md`（第 21/22 条）、
> `docs/testing-strategy.md` §9，以及本轮「标度字段全量读写点」调研。

## 0 已拍板的决议

| 编号 | 决议 | 含义 |
| --- | --- | --- |
| **D1** | **乙：共享「形式 + 刻度位置」，刻度数值留在列上** | 组管 单位/图形形态/尺度类型/放大倍数/刻度位置；每列保留自己的两个满量程数值。避免把满量程不同的属种静默绑在一起。 |
| **D2** | **逐列一组，保真迁移** | 旧工程迁移时每列各成一个组，绝不猜"哪些列该合并"；另给「合并标度相同的组」手动操作。 |
| **D3** | **P2 一并修多 ROI 工程包存取** | `project_save`/`project_load` 改为承载多 ROI（含每列 `roi_id` 与组），否则多 ROI 用户的组存不下来。 |

## 1 一句话

在 **ROI 内部**引入「组」（不跨 ROI）：每列恰属一组，组共享 **单位 / 图形形态 / 尺度类型 /
放大倍数 / 刻度位置**；刻度**数值**留在列上。把后端 6 处「像素 → 数值」换算统一到**一个解析入口**。

| 目标 | 现在的状态 | 分组后 |
| --- | --- | --- |
| 设一次、全组生效 | 28 列要设 28 遍单位与形态 | 组设一次，组内全部列生效 |
| 重新分列不丢（第 21 条） | 形式与刻度都存在列上，`detect_columns` 重建列对象即抹掉 | 形式与刻度**位置**存在组上（组挂在 ROI 上），列重建不影响；只剩每列两个数值需重填，按 §6 规则保住 |
| 两条换算链数字不一致 | CSV/Parquet 与 XLSX/LiPD 读不同字段 | 全部走同一个解析函数 |

## 2 不变量

1. **组在 ROI 内**：组成员必须同属一个 `roi_id`，不允许跨 ROI。
2. **每列恰属一组**：无孤儿列。没有组时自动建默认组并把该 ROI 的列全放进去。
3. **标度是唯一权威**：组或列的标度缺失 = **未标定**，显式报错或显式标记，**绝不伪造兜底值**
   （项目不变量 1，`docs/ARCHITECTURE.md` §2）。
4. 前端错误必须冒泡到用户（`reportBackendFailure`）。

## 3 数据模型

### 3.1 ROI 上新增

```json
{
  "id": "roi_1",
  "x_groups": [
    {
      "id": "grp_1",
      "name": "百分比-面积",
      "unit": "%",
      "plot_type": "area",
      "scale_type": "linear",
      "exaggeration_mult": null,
      "tick_layout": [{ "rel": 0.0 }, { "rel": 1.0 }]
    }
  ],
  "default_group_id": "grp_1"
}
```

- `tick_layout[i].rel` = 第 i 个刻度的像素位置占**本列宽度**的比例（`0` = 列左边界，`1` = 列右边界）。
  默认 `[0, 1]`，即"满量程铺满本列"，绝大多数组用默认值即可。
- 组**不含数值**（D1）。

### 3.2 列上

- 新增 `col["x_group_id"] = "grp_1"` 与 `col["x_values"] = [0.0, 50.0]`
  —— 两个刻度位置上的数值，即**该列自己的满量程**。
- **移除**列上的 `unit` / `plot_type` / `scale_type` / `exaggeration_mult` / `mult_source` /
  `has_exaggeration` / `x_ticks` 与 legacy 三件套（`startValue`/`tickValue`/`tickEndX`）。
  这一步吸收原计划的 B3「删掉 legacy 三件套」。

### 3.3 派生规则（唯一一处）

```
abs_px_i = col.start + tick_layout[i].rel * (col.end - col.start)
value_i  = col.x_values[i]
```

即后端新增唯一解析入口：

```python
def resolve_column_scale(session, col) -> ColumnScale:
    """列 -> (abs_px0, val0, abs_px1, val1, unit, plot_type, scale_type,
              exaggeration_mult, calibrated: bool, source: str)"""
```

### 3.4 为什么这样切（而非把数值也放组里）

- **列等宽时**，"相对本列宽度的比例"与"相对列起点的固定像素偏移"等价，两者都成立。
- **列宽不等时**，`rel` 按各列自身宽度缩放，仍是正确语义（满量程铺满本列）。
- **数值必须留列上**：花粉图里不同属种常有不同最大值（一个 0–50%、一个 0–20%）。若把数值也组共享，
  改 A 列满量程会**静默连带改掉 B 列**，界面上看不出异常——正是本项目一直在清的那类"看起来生效"的失效。

## 4 六处换算统一（本设计的核心收益）

现状：两条**互不相通**的换算链，同一列同一标定算出不同数字。

| # | 位置 | 现在读什么 | 链 |
| --- | --- | --- | --- |
| 1 | `session.py:1383-1444` `export_data`（CSV/Parquet） | legacy 三件套 | L |
| 2 | `session.py:1633-1667` `extract_grid_values`（步骤 7 采样） | legacy 三件套 | L |
| 3 | `session_parts/export.py:128-176` `get_roi_dataframes`（XLSX/LiPD/TAR） | `x_ticks`，缺失则 `0→100%` 伪造 | X |
| 4 | `session_parts/qa.py:130-191` `qa_summarize`（步骤 8 校验） | `x_ticks`，缺失则 `declared_max=0`（**静默豁免超限判定**） | X |
| 5 | `rpc_methods/system.py:127-158` 列载荷（前端换算与绘制） | legacy 三件套 + `x_ticks` 双发；`unit` 硬编码 `"%"` | 两者 |
| 6 | 前端 `CoordinateSystem.ts:87-135` / `SplineInterpolator.ts:122-137` / `PropertyPanel.ts:834` | legacy 三件套 + `scaleCalib`（两处优先级相反） | L |

**统一方案**：上表 6 处全部改为只调 `resolve_column_scale`；前端经 `getDiagramData` 载荷拿
**已派生的绝对刻度**（载荷下发 `x_groups` 与每列 `x_group_id`/`x_values`），前端不在本地重复实现派生。

**顺带修掉的既有缺陷**（同一份调研查实，逐条有行号）：

- 两条链数字不一致（上表）；
- `qa.py:126,139`：未标定列 `declared_max=0` ⇒ **静默豁免**超限判定；
- `system.py:154,158`：列载荷 `unit` 硬编码 `"%"` ⇒ 用户设的「粒」永远显示不出来；
- 列 `plot_type` 后端**只写不读**、载荷不含该键 ⇒ 重载后前端 `plotType` 退回 `'area'`；
- `exaggeration_mult` ↔ `exaggeration_multiplier` 两键互不连通；
- `mult_source` 只写不读。

**不并入本设计**（另案登记在 `docs/testing-strategy.md` §9）：
`column_remove` 删中间列后 `control_points`/`column_points` 不搬键导致取数错位；
`PropertyPanel.ts:976-1022` 前端直接打开工程包时不读刻度；OCR 每次重载模型。

## 5 界面

- **组管理**（放步骤 6「标定列」）：组列表 + 新建 / 改名 / 删除 / 设默认组 +
  「合并标度相同的组」（D2 的手动收尾工具）。
- **列归属**：左栏列列表支持多选 → 「加入组 ▾」；每列显示所属组名与组色。
- **组设置**：单位 / 图形形态 / 尺度类型 / 放大倍数 / 刻度位置（默认 `[0%,100%]`）。
- **列设置**：两个数值（该列满量程）。若改的是组级字段且该组还有其他列，提示
  「这会改变整组（N 列）」，并提供「只改本列」→ 自动为该列**单建一组**。
- 步骤 8 就绪清单：未标定列必须先分组并标定，红字放行门禁。

## 6 迁移

| 来源 | 规则 |
| --- | --- |
| 旧工程列上的 `x_ticks`（绝对 px） | 数值 → `col["x_values"]`；位置 → `rel = (px - startX) / (endX - startX)` 写入组 `tick_layout` |
| legacy 三件套 | 数值由 `startValue`/`tickValue` 取；位置由 `startX`/`tickEndX` 换算 `rel` |
| 组织形式 | **逐列一组**（D2）：每列各建一个组，组携带该列原有的 unit/plot_type/scale_type/放大倍数 |
| `roi.form_defaults`（`XScaleForm`） | 转为**默认组**的属性；`roi.applyFormDefaults`（后端已实现、**全仓零调用点**）改为"重设为默认组"或废弃 |
| 列 `roi_id` 缺失（`column_add` / `project_load` 不写） | 单 ROI 时归该 ROI；多 ROI 时缺 `roi_id` 的列**显式报错**（不猜） |
| 工程包 `version` | 升到 `3.0.0`；载入 `2.x` 走上述迁移 |

**重新分列时保住每列数值**（第 21 条的第二半，因 D1 而只剩数值需保）：
- 该 ROI **列数不变** → 按列序号回填 `x_values`，并对每个刻度施加**区间守卫**
  （刻度像素须落在该列 `[start-10, end+10]` 内，放不下则丢弃该列的数值并**计数上报**）；
- 列数变了 → 不回填，并显式报告"重新分列已使 N 列的标定失效"。

## 7 分期实施

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0** | 新增 `resolve_column_scale`（**`x_ticks` 优先、legacy 三件套兜底**，并返回 `calibrated`/`source` 标记）；6 处换算全部改调它 | 六门禁全绿；新增「CSV/Parquet/XLSX/LiPD 四种导出数值必须相等」一致性测试；步骤 7 采样开始尊重步骤 6 标定（**这是修复**） |
| **P1** | 「未标定」显式化：步骤 8 不再静默豁免；载荷 `unit` 不再硬编码；`plot_type` 入载荷；未标定列的导出策略（拒绝 / 导出但显式标红） | 各配回归钉 |
| **P2** | 组数据模型 + `col["x_group_id"]`/`x_values` + 载荷与序列化 + **多 ROI 工程包存取（D3）** + 逐列一组迁移 | 单测：派生、跨 ROI 成员被拒、无孤儿列、多 ROI round-trip |
| **P3** | UI：组管理 + 列归属 + 组设置 + 合并工具 | e2e：建组→设一次→组内多列同时变；改组单位→全组显示变；重新分列后组仍在 |
| **P4** | 删列上旧字段（吸收原 B3）+ 旧工程迁移收尾 | 旧工程载入用例 |
| **P5** | 文档：`JSON_RPC_SPECIFICATION.md`、`ARCHITECTURE.md` §4、步骤 8 红字 | 门禁 + 文档一致性 |

**P0 先做的理由**：它修掉的是**已经在产生错数据**的缺陷（同一标定换个导出格式数字就变），
且不引入新模型，风险最低；后续阶段都建立在同一个解析入口上，避免"边迁边裂"。

**P0 的行为变化（明确承认）**：`x_ticks` 优先意味着 CSV/Parquet 导出与步骤 7 采样在"已标定列"上
**数值会变**——变成与 XLSX/LiPD 一致。未标定列仍走 legacy 兜底，但在 P0 就被标记为
`calibrated=False`，为 P1 的策略决定留好接口。

## 8 测试与门禁

- **单测**：`rel → 绝对 px` 派生；组缺失/刻度缺失的未标定标记；跨 ROI 成员被拒；
  **同一列同一标定在 CSV / Parquet / XLSX / LiPD 四种导出的数值必须相等**（本轮最高价值的断言）；
  legacy 与 `x_ticks` 冲突时以 `x_ticks` 为准；重新分列的数值回填与区间守卫。
- **契约测试**：`getDiagramData` 载荷必须带 `x_groups`；列必须带 `x_group_id`/`x_values`
  （沿用 `test_xticks_rpc_contract.py` 的"载荷白名单断链"手法）。
- **e2e**：建组→设一次→组内多列同时生效；改组单位→全组显示变；重新分列→组与形式仍在。
- **金丝雀**：6 处换算各注入一次（`docs/testing-strategy.md` §8：一个从不失败的门禁等于没有门禁）。

## 9 明确不做

- 不跨 ROI 分组（D1 的界定）。
- 不引入组的**嵌套**（老版 `parent`/`children` 是"同批列不同放大倍数"的重叠结构，
  `create_exaggerations_reader` 里 `ret.columns = self.columns`）。扁平分区 + 例外单建组已能表达。
- 不改 OCR、清理、去线、历史撤销。
- 不顺手改 `column_remove` 下标错位（另案）。

## 10 风险

| 风险 | 处置 |
| --- | --- |
| 已标定列在 CSV/Parquet 与步骤 7 的数值会变 | 那是修复（原来读另一条链）。用一致性测试钉住，文档写明 |
| 迁移产生大量单列组（D2） | 提供「合并标度相同的组」按钮，但**不自动合并** |
| 多 ROI 工程包原本存不下来（D3） | P2 一并修，配多 ROI round-trip 测试 |
| 旧版与新版工程包互不兼容 | 工程包 `version` → `3.0.0`，载入 `2.x` 走迁移 |
| P0 与 P2 之间两套模型并存 | P0 只引入解析入口不引入组；P2 再让解析入口改读组，切换点唯一 |
