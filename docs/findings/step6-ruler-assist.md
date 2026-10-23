# Step 6 刻线几何检测（algorithm.measureRuler）

> 交付人：Lead（task-6）｜ 2026-10-19
> 起因：真实期刊图版（Han et al. 2026, GPC 256:105195 Fig.3）内测时发现，
> Step 6 要求用户对每列手工填两个读数（15 列 × 2 = 30 次判读），
> 而其中 **10 列图上根本没印数字** → 用户只能猜，猜就是编造读数。

---

## 1. 做了什么

新增**只读**接口，测量刻度尺的**几何**，不产出任何读数。

| 文件 | 内容 |
| :--- | :--- |
| `straditize_core/ruler.py`（新增） | `detect_ruler` / `detect_ruler_for_columns` / `suggest_scales` |
| `straditize_core/session_parts/xticks.py` | `measure_ruler_geometry()` 会话方法 |
| `straditize_core/rpc_methods/xticks.py` | 注册 `algorithm.measureRuler` |
| `straditize_core/protocol.py` | `ALL_RPC_METHODS` 声明 |
| `frontend/src/types/rpc.ts` | `RpcMethod` 类型声明 |
| `tests/unit/test_ruler.py` | 6 项（几何精度 + 拒绝外推） |
| `tests/unit/test_measure_ruler_rpc.py` | 8 项（契约 + 错误路径 + 不产读数） |

## 2. 接口契约

```python
s.measure_ruler_geometry(roi_id=None) -> {
    "roi_id": "roi_1",
    "per_column": [
        {
            "col_index": 10,
            "name": "Cyperaceae",
            "axis_row": 869,        # 刻度尺所依附的轴线行
            "ticks": [931, 944, 956, ...],   # 刻线 x 中心，升序
            "n_cells": 13,          # 格数 = len(ticks) - 1
            "spacing_px": 13.0,     # 相邻刻线间距的中位数
            "regular": True,        # 所有间距是否在中位数 ±8% 内
            "column_width": 172,
        },
        ...
    ],
    "median_spacing_px": 12.5,      # 全 ROI 中位刻距
    "all_regular": True,
    "calibration_suggestions": [],  # 恒为空，见 §4
    "note": "仅测量刻线几何……不产出任何满量程读数……",
}
```

## 3. 真实图版实测结果

对 Han et al. (2026) Fig.3（2132×928）15 列：

```
中位刻距: 12.5 px  |  all_regular: True
Pinus             轴线869  格数  2  刻距 13.0
Abies             轴线869  格数  2  刻距 12.5
Picea             轴线869  格数  2  刻距 12.5
Betula            轴线869  格数  2  刻距 12.0
QuercusD          轴线869  格数  3  刻距 13.0
QuercusE          轴线869  格数  3  刻距 12.0
Rosaceae          轴线869  格数  2  刻距 12.5
Chenopodiaceae    轴线869  格数  2  刻距 13.0
Hippophae         轴线869  格数  3  刻距 12.0
Euphorbiaceae     轴线869  格数 17  刻距 12.0
Cyperaceae        轴线869  格数 13  刻距 13.0
Artemisia         轴线869  格数  2  刻距 12.5
Poaceae           轴线869  格数  3  刻距 13.0
Ranunculaceae     轴线869  格数  2  刻距 12.5
Caryophyllaceae   轴线869  格数  2  刻距 19.0   ← 刻距异常，明显偏离中位数
```

**这条数据的价值**：`Caryophyllaceae` 刻距 19.0 与中位 12.5 差 52%，一眼看出该列刻度尺
与其余列不同规格 —— 这正是"显示几何给用户看"能提供的**诊断力**，而它不涉及任何读数编造。

## 4. 为什么 `suggest_scales()` 一个数字都不产出

原设想：「同一图版各列刻度尺规格一致 ⟹ 满量程 ∝ 格数 ⟹ 用户读一列即可推导全部」。

**实测否决。** 以 Cyperaceae（13 格 = 70.07%，与论文 reported max 吻合）为锚点：

| 列 | 刻距 | 格数 | 外推满量程 | 论文 max | 误差 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Rosaceae | 12.5 | 2 | 10.78 | 12.97 | −17% |
| Ranunculaceae | 12.5 | 2 | 10.78 | 14.00 | −23% |
| **Pinus** | 13.0 | 2 | 10.78 | 40.74 | **−74%** |
| **Artemisia** | **12.5** | 2 | 10.78 | **67.42** | **−84%** |
| **Poaceae** | 13.0 | 3 | 16.17 | 9.21 | **+76%** |
| **Hippophae** | 12.0 | 3 | 16.17 | 7.75 | **+109%** |
| **Caryophyllaceae** | 19.0 | 2 | 10.78 | 4.29 | **+151%** |

**关键反证**：`Artemisia` 刻距 12.5px 与锚点 13.0px 几乎相同（差 4%），误差却 **−84%**。
所以「刻距相同」既推不出「每格数值相同」，也不能当可靠性判据。

**每格代表多少，是作图书版的设定，图上没有任何信息可以推得。**
任何跨列外推都是猜 —— 而猜就是编造读数（`docs/ARCHITECTURE.md` §2）。

因此 `suggest_scales()` 只交出「格数」这一客观事实，`suggested_full_scale` 恒为 `None`，
`confidence` 恒为 `"none"`，并附拒绝理由。回归钉子：
`test_suggest_scales_produces_no_numbers`。

## 5. 踩坑记录（进黑名单候选）

| 坑 | 现象 | 正解 |
| :--- | :--- | :--- |
| 刻线在轴线**下方**而非上方 | 按上方找 → 全图 **0 检出** | 搜索窗 `(axis+1, axis+8)` |
| 副齿仅 3–4 行高 | `min_tick_height=4` → 格数少一半（Cyperaceae 只剩 7） | 取 **3** |
| 窄列轴线覆盖率仅 71% | `min_coverage=0.80` → 窄列 `axis_row=None` | 取 **0.65** |
| 轴线搜索窗太靠底 | `search_from=0.85` → 柱体贴轴线的图版误判轴线 | 取 **0.70** |

## 6. 门禁

```
pixi run lint  → 全绿（ruff + 11 项一致性检查）
pixi run test  → 331 passed / 3 skipped （基线 317 + 本任务新增 14）
```

**一致性检查器当场立功**：加 RPC 后立即报
`FAIL H. 后端已注册 'algorithm.measureRuler'，但未在 ALL_RPC_METHODS 声明`
与 `FAIL I. 未在 rpc.ts:RpcMethod 声明` —— 补声明后才过。
这正是它存在的意义（历史事故：前后端契约漂移被静默兜底）。

## 7. 尚未做的部分（交给 fix-engineer）

前端 Step 6 面板展示几何（"共 N 列 / 中位刻距 X px / 格数 [...]"）需要改
`XTicksPanel.ts` + `InspectorBridge.ts`，与 task-5 的 `extraction_mode` 改动
同文件，为避免并发冲突已让给 fix-engineer。需求已写在 task-6 描述里。
