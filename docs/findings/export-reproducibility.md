# 导出可复现性：五个面，一个根因

> 2026-11-19，由 #113 / #100 / #121 与两处新发现归纳。
> 结论：**这不是五个 bug，是一个缺失的抽象——「导出快照」。**

## 1. 现象：同一张图能导出五种不同的表

| # | 面 | 触发条件 | 后果 |
|---|---|---|---|
| 1 | **三处行集不一致**（#113） | 同一次导出，看面板 / 下载 / 归档 | 1 / 249 / 479 行 |
| 2 | **行集身份错**（#100） | `samples` 为空 | 625 个像素行被当样品 |
| 3 | **行集不持久**（#121） | 导出 → 重开 → 再导出 | 625 → 344 行 |
| 4 | **同 row set 两套取值**（本次实测） | 换 `dataset` 参数 | **82.33% 单元格不同** |
| 5 | **两个零点入口**（`axis-stroke` 发现） | 改兜底常量 | `scaleCalib.originX` 不变、`controlPoints` 全变 |

## 2. 第四面的实测（`.recon_20261117`，19 列 / 1 ROI / age / ka，控制点 6530 点 / 1467 个不同 row）

### 主场景：`samples = 203`（载入时的真实状态）

```python
a = session._dataset_frame(None, strict=False)            # data.csv / 归档语义 → samples 优先
b = session._dataset_frame("union_points", strict=False)  # 面板「控制点并集」
```

```
ds=None      : (203, 20)    ← 共识层位（203 条）
union_points : (1467, 20)   ← 控制点并集
共同行 203 | 可比单元格 3857 | 有差异 3459 (89.66%)
差异 p50 1.187 / p95 779.25
```

**行数差 7 倍，共同行上近九成值不同。**

### 对照：`samples = 0`（清空后，隔离"取值口径"这一个变量）

```
ds=None      : (1520, 20)   ← 全像素行（= ROI 高度）
union_points : (1467, 20)   ← 控制点并集
共同行 1467 | 可比单元格 27873 | 有差异 22948 (82.33%)
差异 p50 0.477 / p95 33.19 / max 83895.7（Concentration）
```

清空 `samples` 后两条路径的行集接近（1520 vs 1467），差异更纯粹地反映"取值口径"；
而**真实场景（`samples=203`）下，行集与取值同时分叉**，所以 89.66% 比 82.33% 更严重。

### 两条链的差别不是"行集不同导致对不齐"

即使在共同行上，值也大面积不同：

- `ds=None` → `read_column_values`：**读该像素行的真实墨迹**
- `union_points` → `extract_grid_values` → `np.interp`：**在 depth 轴上插值**

一个"读"、一个"算"。插值端点 clamp 在量级 1e3–1e4 的浓度列上放大成两位数以上的偏差（`samples=0` 时 max 达 83895.7）。

**而 `_dataset_frame` 的 docstring 写着"三种行集共用同一取数口径"。这句是错的。** 声称统一，实现是两条路。

## 3. 第五面：一个载荷里两个零点

`getDiagramData` 返回的同一个 payload 里：

| 字段 | 零点来源 | 认不认组级 `axis_stroke_px=6` |
|---|---|---|
| `scaleCalib.originX` | `resolve_column_scale → resolve_axis_stroke` | **认** |
| `controlPoints` | 逐列 `digitize` 的零点 | **不认**，吃兜底 |

于是改一个兜底常量，同一个画布上"画出来的标定绿线"和"画出来的控制点"锚在差 3px 的两个原点上。

## 4. 根因：导出的表不被固化，而是每次现算

一张导出表由**四个独立维度**决定，每个维度都有 ≥2 个入口：

| 维度 | 入口 A | 入口 B |
|---|---|---|
| **行集**：哪些行 | `_resolve_rowset`（samples 优先） | 控制点并集 / depth_grid / turning_points / 像素行 |
| **取值**：每行读什么 | `read_column_values`（读像素） | `extract_grid_values`（depth 轴插值） |
| **零点**：0 在哪 | `resolve_axis_stroke`（认组值） | 逐列 digitize 零点（不认组值、吃兜底） |
| **持久化**：重开是否一样 | `column_points` 不落盘 → 按控制点重建 | 落盘（当前不存在） |

`2 × 2 × 2 × 2 = 16` 种可能的输出。**没有任何一处告诉用户"这次用的是哪条链"。**

这就是为什么五个面看起来各自独立、修起来却总是"修了 A 冒出 B"——它们不是 bug 的集合，是**同一个缺失抽象的五次显形**。

## 5. 正确设计：导出快照

导出前固化一次快照，所有出口读同一份：

```python
ExportSnapshot = {
  "rowset":     {"provenance": ..., "rows_digest": ..., "rows_count": ...},
  "zero_point": {"source": "group|column|fallback", "values": {col: px}, "digest": ...},
  "reader":     {"name": "read_column_values|extract_grid_values", "version": 1},
  "masks":      {"grid_line_mask_digest": ..., "roi_ylim": [...]},
  "produced_at": ...,
}
```

三条规则：

1. **单入口**：每个维度只有一个解析函数，其余都是它的调用者（现在 `_dataset_frame` 有两套取值就是违反）；
2. **快照可持久化**：写进工程包；重开时比对，若当前状态与快照不符 → `stale=true` + "上次 625 行 / 现在 344 行"；
3. **偏离可见**：不允许静默重算，也不允许静默用旧值——用户显式选"用快照"或"重算"。

## 6. 分步落地（每步都能独立验收）

| 步 | 内容 | 验收 |
|---|---|---|
| 1 | `ExportSnapshot` 结构 + 三处出口共用（面板 / 下载 / 归档逐字节相同） | 已有基础：`row-source` 的 `RowSet` 与 `serialize_export_frame` 已做到三出口同字节 |
| 2 | **取值口径归一**：`union_points` 不再走 `extract_grid_values` 插值，改为在控制点行上 `read_column_values` | 第四面的 82.33% 差异降为 0（或差异仅来自行集） |
| 3 | **零点单入口**：`controlPoints` 也走 `resolve_column_scale(...).abs_px0` | 改兜底常量时 `scaleCalib` 与 `controlPoints` 同步变化 |
| 4 | 快照持久化 + `stale` 判定 | 重开工程：625 vs 344 被明确报出，不静默 |
| 5 | 快照可选"用旧的" | 用户能复现上个月那张表 |

## 7. 为什么必须按这个顺序

第 2、3 步会改变数值（82% 的单元格、全部控制点）。如果先做第 4 步（持久化），会把**错的**快照固化成"标准答案"，之后每次修口径都要做一次格式迁移。

**先归一，再固化。**

## 8. 一条判据（可机检）

同一工程、同一状态、任意两个出口：

```python
assert sha256(panel_csv) == sha256(download_csv) == sha256(archive_csv)
assert set(cols_panel) == set(cols_archive)
assert rows_count_invariant  # 换出口不改变行数
```

以及一条反向哨兵：**把兜底常量改 ±1px，若某个出口的值不变而另一个变了，就是这个 issue 复发。**
