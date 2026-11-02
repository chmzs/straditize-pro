# 曲线画法三件套修复实测（P-01 / P-02 / D-08）

> 只改后端：`straditize_core/columns.py`、`straditize_core/digitize.py`、
> `straditize_core/session_parts/digitize.py`；新增
> `tests/unit/test_curve_reader_columns.py`、`tests/unit/test_curve_reader_line_fill.py`。
> 未改前端、未改 `docs/JSON_RPC_SPECIFICATION.md`、未碰 `test_reader_types.py`。
> 全部数字为实测（`.pixi/envs/default/python.exe`，单进程直调 `StraditizeSession`）。
> 真值：`tests/data/figures/benchmark_types/golden/{abernethy_pollen,rlgh_diatom}.json`。
> 量程不用 golden 的 `max` 推：pollen 用 `ceil(max/20)*20`、diatom 用「列宽 ÷ 3.80」。

---

## P-01 `detect_column_starts` 丢掉 3 条面板左轴

**改了什么**：`columns.py` 的候选合并规则从「与下一候选间距够宽才保留」改成
「间距 < `min_diff` 的候选归为一簇，取**垂直贯穿率最高**的那个，并列取靠前者」。

旧规则把「真轴线 + 其右侧 4–8 px 的曲线首墨」当成两个候选时保留后者，
于是 Empetrum 的 band 一路吃到 Gramineae 的轴线。实测两者的垂直贯穿率
（该 x 上有墨的行数 / 数据区行数）差一个数量级，这是结构性判据，不是调参：

| 位置 | 贯穿率 | 位置 | 贯穿率 |
|---|---:|---|---:|
| 601（真轴线） | 1.000 | 609（曲线首墨） | 0.094 |
| 652（真轴线） | 1.000 | 658（曲线首墨） | 0.073 |
| 839（真轴线） | 1.000 | 843（曲线首墨） | 0.098 |
| 691（真轴线） | 1.000 | 690（1 px 反锯齿点） | 0.015 |
| 76（diatom 真轴线） | 0.865 | 73（反锯齿点） | 0.010 |

最后两行说明为什么不能简单地「相邻候选保留靠前者」：那条规则会把 diatom 的
21 条真轴线整体左移 1–3 px 落到反锯齿点上（实测 `76→73`、`318→315`、`546→544`）。

**判据与实测**（曲线图，truth-scale 标定，检测到的列边界，`area` 读取器）：

| 项 | 修前 | 修后 | 判据 |
|---|---|---|---|
| Gramineae/…列起点 | 609 / 658 / 843 | **602 / 653 / 839** | 601 / 652 / 839 ±2 px ✅ |
| Empetrum 列 `end` | 609 | **601** | ≤ 601+1 ✅ |
| Gramineae 列 `end` | 658 | **652** | ≤ 652+1 ✅ |
| Empetrum 列 MAE | 34.051 | **1.180** | ≤ 5.00 ✅ |
| Gramineae 列 MAE | 34.712 | **1.173** | ≤ 5.00 ✅ |
| Ononis-type 列 MAE | 21.086 | **2.723** | ≤ 5.00 ✅ |
| 曲线图全表 MAE | 6.192 | **1.653** | — |

真边界控制组（不改检测、只把边界强设成实测轴线）为 4.42 / 1.17 / 2.72，修复后
三列已落到控制组同一水平（Empetrum 甚至更低：检测起点 545 恰好把轴线排除在外）。

**无回归**：pollen 面积图、柱状图、diatom 图的列起点与修前**逐列完全相同**
（`[112,213,332,346,...]` / `[113,214,333,346,...]` / diatom 25 列
`[76,102,128,155,219,...]` 均不变）；只有曲线图的 3 处（以及随之的 gap 重排）变化。

---

## P-02 读取器把面板自身的 Y 轴线当数据

**改了什么**：新增 `digitize._axis_ink_offsets()`，在每行的墨迹里剔除「轴线像素」；
判定依据是**垂直贯穿率 ≥ 0.9 且从 band 左缘连续**（轴线几乎每行有墨，数据曲线只是路过）：

```
curve Empetrum  x=544 -> 0.998 | x=545 -> 0.434 | x=546 -> 0.305
area  Empetrum  x=544 -> 0.998 | x=545 -> 0.616
diatom panel 0  x= 76 -> 0.879 | x= 77 -> 0.709
```

只剔除「覆盖率高」还不够：若整行只剩轴线像素，那几列此时就是数据本身（值≈0），
这时不剔除（否则 2 px 的读数会被抹成 0，实测填空型 pollen 图全表 MAE 从 0.835 涨到 0.843）。
`trace_area_profile`（批量路径）走同一条规则，避免两条路径分叉。

**判据与实测**：

| 项 | 修前 | 修后 | 判据 |
|---|---|---|---|
| Empetrum 真边界下 row 502 读数 x | 544.0 | **589.0** | ∈ [586,590] ✅（该行唯一墨迹 586–589） |
| Empetrum 真边界下全列 MAE | 4.420 | **1.180** | ≤ 2.50 ✅ |

**无回归**（同一 A/B，只切换 `_axis_ink_offsets`）：

| 图 | 剔除轴线 ON | OFF（旧行为） |
|---|---:|---:|
| pollen 面积图（area 读取器全表 MAE） | 0.835 | 0.835 |
| pollen 柱状图 | 1.312 | 1.312 |
| diatom 图（自洽标定） | 0.156 | 0.156 |

---

## D-08 `line` 读取器在填充型剖面上读数是真值的一半

**改了什么**：`digitize._line_own_offset()` 取代 `np.mean(fg_indices)`。判据是结构性的：
墨迹从基线连续起笔 → 填充型，读**墨迹右缘（填充顶边）**；墨迹悬在数值处 → 细线画，读**中心**。
画法按**整列**判一次（`_band_is_filled`：≥50% 有墨行从基线起笔），不逐行翻转——
逐行判会让同一列里 22–38 行的读数比 `area` 低 0.5–3.5 px（虚线缺口、2 px 填充各占一半）。

**判据与实测**：

| 项 | 修前 | 修后 | 判据 |
|---|---|---|---|
| diatom `line` 全表 MAE（自洽标定） | 1.713 | **0.156** | 与 `area`（0.156）同量级 ✅ |
| diatom 25 列 line/area 振幅比 | **0.500**（逐列精确） | **1.000**（25/25） | 0.9–1.1 ✅ |
| P03 Brachysira vitrea 峰值 | 7.11 | **14.21**（area 14.21） | 不得「恰好一半」 ✅ |
| P09 Eunotia incisa | 8.42 | **16.84**（area 16.84） | ✅ |
| P22 Tabellaria flocculosa | 3.16 | **6.32**（area 6.32） | ✅ |
| pollen 面积图 line 全表 MAE | 2.807 | **0.835**（= area） | ✅ |
| pollen 柱状图 line 全表 MAE | 3.087 | **1.312**（= area） | ✅ |
| pollen 曲线图 line 全表 MAE | 3.718 | **1.580**（area 1.653） | 细线画仍读中心，未被压向基线 ✅ |

---

## 可证伪性（把被测代码退回错误实现后是否变红）

三处都做了「退回—跑测试—恢复」，恢复后 `grep -c "LEGACY PROBE"` = 0：

| 退回的实现 | 变红的测试 | 实测红值 |
|---|---|---|
| `columns.py` 恢复 `gaps > min_diff` | P-01 的三条（合成用例 / 三轴线 / 三列 MAE） | 三列 MAE 34.15 > 5.00 |
| `_axis_ink_offsets` 恒返回空 | P-02 的三条（合成 band / row 502 / Empetrum MAE） | row 502 = 544.0；MAE 4.42 > 2.50 |
| `_line_own_offset` 恢复 `np.mean` | D-08 的三条（两种合成行 + diatom 振幅比） | 振幅比 0.500，`line` max 7.11 ≠ 14.21 |

测试共 10 条：
`tests/unit/test_curve_reader_columns.py`（P-01 ×3、P-02 ×3）、
`tests/unit/test_curve_reader_line_fill.py`（`line` 语义 ×3、diatom 振幅比 ×1）。

---

## 联合影响（须由统一提交方处置）

1. **`tests/unit/test_reader_types.py::test_bar_reader_is_not_mean_of_column` 现在会红**。
   该测试用「`bar` 与 `line` 逐点不同」当作「`bar` 没退化成柱内均值」的代理；而在
   填充/柱状画法上 `line` 修复后与 `bar` 读的是同一个物理量（填充顶边），代理失效。
   建议代理改为「`bar` ≠ 该行墨迹均值」或「bar 读数 > 均值」；该文件在禁改清单内，未动。
   同一张图上 `area` 与 `bar` 也一直逐点相同（bench-pollen.md §7 已记录），所以这不是新现象，
   只是 `line` 加入了这个等价类。
2. **列起点零位移**：pollen 面积/柱状图与 diatom 图的分列结果与修前逐列相同，跨图对照
   （`bench-pollen.md` §3）无需重测；只有曲线图从「吞邻列」回到真轴线。
3. **`_own_run_last_offset` 重构为 `_own_run_span`**（右缘取 `[1]`），成员规则未变；
   `tests/unit/test_digitize_anchoring.py` 12 条全绿。
4. **`trace_area_profile` 同步剔除轴线**：批量路径与 session 路径仍共用一个读取规则；
   只有轴线的行保持旧的 1 px 读数（合成测试已钉住）。
5. **曲线图 `line` 全表 MAE 1.580 vs `area` 1.653**：细线画下两者仍未统一，属画法差异
   （bench-pollen.md §7 的结论），不在本次三条缺陷范围内。

## 复现命令

```bash
cd "E:/software_dev/straditize"
.pixi/envs/default/python.exe -m pytest tests/unit/test_curve_reader_columns.py \
    tests/unit/test_curve_reader_line_fill.py -q          # 10 passed
.pixi/envs/default/python.exe -m pytest tests/unit/test_columns.py \
    tests/unit/test_digitize_anchoring.py tests/unit/test_aber_accuracy.py \
    tests/unit/test_benchmark_morphologies.py -q          # 26 passed
```

列起点 / 逐列 MAE / row 502 / diatom 振幅比的测量脚本结构见
`docs/findings/bench-pollen.md` §2 与 `bench-diatom.md` §4（本次探针同构，仅把
`min_col_width_ratio` 与读取器两处换成实测对象）。
