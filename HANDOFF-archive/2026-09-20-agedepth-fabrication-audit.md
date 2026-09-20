# 年代-深度模块：编造路径清查（2026-09-20）

对应提交 `93084b1`（实现）+ `8a93b92`（测试）。守卫：`tests/test_no_fabrication.py`（7 测试）。

项目不变量：**数据只能来自对用户自己输入的真实计算，否则调用失败。** 本文件记录一次系统审计的结果——所有「没观测到却给出了值」的路径。每条都曾返回过看起来像结果的东西。

## A. 静默替换数据源

### A1. 未载图 → 悄悄用内置 bacon 范例提取
`session.calibrate_and_extract_age_depth`

```python
if self.age_depth_image is None:
    self.load_age_depth_diagram(sample_key="bacon")   # 已删
```

调用方从未提供这张图，却拿到一份**来自另一张图的完整年代学**（含 1000 条集合）。现改为抛 `JsonRpcError(STATE_ERROR, ...)`，且**不产生任何副作用状态**（测试断言 `age_depth_image` 仍为 None）。

连带影响：`tests/test_metadata_and_lipd.py::test_07` 原本依赖这个兜底，现改为显式 `load_age_depth_diagram(sample_key="bacon")`。

### A2. `/image/agedepth` 有状态 + 静默默认 bacon
`straditize_core/rpc_server.py`

原来接受 `?sample=bacon|bchron`，空会话时回落 bacon。问题有两层：
1. **一次普通图片 GET 会改掉提取会话状态** → 「显示的图」与「提取的图」可能不一致且无信号；
2. 无参数时静默替换数据源。

现改为**只读**：只服务 `session.age_depth_image`，空会话 404 并给出 `hint: Call agedepth.loadModelDiagram first.`。

前端配套（`AgeDepthModal.loadSampleImage`）：先 `await` RPC 载入，再取像素（拆出 `fetchAgeDepthPixels`），顺序显式而非依赖竞态。契约测试**起真服务器打 HTTP** 验证（空会话 404、且不 populate 会话；显式载入后 200）。

## B. 占位数字

### B1. `predict_age` 在退化模型上返回 `age_est = depth`
`AgeDepthModel.predict_age`

`_interp_age is None`（层位 < 2）时原返回：

```python
"age_est":  [round(float(d), 1) for d in d_arr],   # ← 把深度当年纪
"age_min":  ...同值...,
"acc_rate_yr_per_depth": zeros,
```

即「年龄等于深度」加全零速率。现改为抛 `ValueError`。

### B2. 缺包络 → `age_min = ages.copy()` 描述零宽包络
`AgeDepthModel.__init__`

零宽包络等于**声称这条年代学是精确的**。下游全部中招：速率后验、导出的 95% CI 列都会把这份「确定性」当实测值报出去。

现改为显式跟踪 `has_envelope`（并在 payload 暴露），`generate_age_ensemble` 对缺包络模型**直接拒绝**——否则它会吐 1000 条**完全相同**的轨迹。

**附带修掉一个静默覆盖**：`__init__` 里后置的注解 `self.has_envelope: bool = True` 会覆盖前面算好的值，导致缺包络时仍报 True。该注解已移到计算之后。

### B3. 外推无标记
`AgeDepthModel.predict_age`

PCHIP 以 `extrapolate=True` 构造，超出实测深度范围的层位按端点斜率**外推**。只要花粉采样网格超出提取曲线就会触发（很常见），之前毫无标记。

现逐行返回 `extrapolated: bool[]`、`extrapolated_count`，以及 `observed_depth_range`（新增方法，返回**原生** traced span，可能略宽于重采样后的输出网格）。

## C. 编造曲率

### C1. gap 插值可编造 94% 的曲线
`extract_age_depth_model`

在纯灰度图上**强制 chroma 通道**时，只有 36 行（共 572 行）有杂散彩色像素通过门禁，其余 94% 由 `np.interp` 填充成一条**看起来平滑、实则几乎全部虚构**的曲线，下游无从分辨。

现加**观测覆盖率守卫**：在插值**之前**计算 `observed_rows / (span)`，低于 0.35 直接拒绝并报出计数与百分比。实测真实轨迹至少观测自身跨度的 ~55%，故 0.35 留有余量。`observed_row_fraction` 一并进 payload。

> 注意：**必须在插值前量**。插值后数组按构造连续，任何覆盖率统计都恒为「100%」——审计中我先踩过这个坑。

## D. 判定「保留但要标注」的项（未删）

| 项 | 为何保留 |
|---|---|
| 年龄集合本身是建模产物 | 这就是它的定义；但 `notes` 写明来源，且现在校验包络真实存在 |
| `rate_floor`（抬高近零速率） | 数值保护，防 `exp` 溢出；代价是平坦段速率小幅抬高，已注释 |
| PAVA 保序会改写观测曲线 | 已知先验，方向声明矛盾时拒绝，`enforce_monotonic=False` 可关 |
| 集合中 `np.interp` 端点钳制 | 当前网格覆盖全深度范围，不可达；若可达会把成员钳到端点值 |
| `_median_rate` 无插值器时返回全 1 | 哑值，但该路径已被 `predict_age`/`generate_age_ensemble` 上游拒绝，实际不可达 |

最后一条是唯一「严格算哑值但已被上游挡住」的残留，可清可不清。
