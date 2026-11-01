# Pollen benchmark 缺陷清单

测量基线见 `../bench-pollen.md`。全部数字来自单进程直接调用 `straditize_core.session.StraditizeSession`（只读，不启服务），命令均在仓库根 `E:/software_dev/straditize` 下、用 `.pixi/envs/default/python.exe` 执行。

全局成绩（truth-scale 标定 + 检测到的列边界 + `area` 读取器，每图 960 点）：

| 图 | 全表 MAE | 结论 |
|:---|:---:|:---|
| 面积填充 `Pollen_riojaPlotTestData.png` | 0.835 | 可用 |
| 柱状 `Pollen_BarStyle_riojaPlotTestData.png` | 1.312 | 可用 |
| 曲线 `Pollen_CruveStyle_riojaPlotTestData.png` | 6.192 | 不可用 |

> 任务书示例「分列把 Ulmus 拆成两个 13px 碎片」**未复现**：332–345 与 346–359 是两个真实面板（各自填充最大宽度 12–14px，换算 `fillmax/W×20` = 18.5 / 20.0，与 axis_max=20 吻合；若并为一列则填充只应有 3.6/4.6px）。Ulmus 本身就是 13px 窄面板。下面 6 条均为实测到的缺陷。

---

## P-01 曲线画法丢掉 3 条面板左轴，整列吞进邻列（Empetrum 恒输出 40%）

- **现象**：`Pollen_CruveStyle_riojaPlotTestData.png` 的 `detect_columns()` 给出 21 列，但其中三列的边界越过了自己的面板：
  - Empetrum：检测 `(545, 609)`，真实面板 `544–601`（end 多 8px）
  - Gramineae：检测 `(609, 658)`，真实面板 `601–652`（start 多 8px、end 多 6px）
  - Ononis：检测 `(825, 843)`，真实面板 `825–839`（end 多 4px）

  后果是 Empetrum 整列被钉在 Gramineae 的轴线上：row 340 / 502 / 512 全部返回 `x=601.0 → 40.00%`，而 Empetrum 真值范围 0–35.56、均值 4.09。逐列 MAE：Empetrum **34.05**、Gramineae **34.71**、Ononis **21.09**；把边界改回真实面板后同一读取器降至 4.42 / 1.17 / 2.72。
- **机制**：`straditize_core/columns.py:117` 的候选合并规则 —— `min_col_width_ratio=0.01`（943px × 0.01 = 9.43px）会丢弃「与下一候选间距 < 9.43px」的候选。这三个面板的真轴线 601/652/839 右侧 4–8px 处各出现一个候选（曲线首墨），于是保留的是后者。实测把 `min_col_width_ratio` 降到 0.005 时 601/652 返回（23 列），降到 0.002 时 839 也返回（24 列）——但同时把伪候选 609/658/843 一起带出，所以**不能靠降阈值修**，应当「相邻候选保留靠前者」。
- **复现**：
  ```bash
  cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe -c "
from straditize_core.session import StraditizeSession
from straditize_core.columns import detect_column_starts
from straditize_core.image import remove_horizontal_grid_lines
s=StraditizeSession(); s.load_image(image_path='tests/data/figures/benchmark_types/Pollen_CruveStyle_riojaPlotTestData.png'); s.detect_columns()
cl,_=remove_horizontal_grid_lines(s.foreground_mask[82:563,112:1055],min_length=35,min_row_occupancy_ratio=0.30)
for mw in (0.01,0.005,0.002): print(mw,[int(v)+112 for v in detect_column_starts(cl,threshold=0.10,min_col_width_ratio=mw)])"
  ```
- **影响**：曲线画法下 Empetrum / Gramineae / Ononis 三列数据完全不可用（Empetrum 恒 40%，真值均值 4.09）；这三列把曲线图全表 MAE 从 1.94（真边界）抬到 6.19，占总误差 69%。
- **判据**：修好后 `detect_columns()` 必须给出起点 **601 / 652 / 839（±2px）**，且对应列的 `end` 不得超过 `601 / 652 / 839 + 1`；Empetrum、Gramineae、Ononis 三列 MAE 各自 **≤ 5.00**（当前 34.05 / 34.71 / 21.09；真边界控制组实测 4.42 / 1.17 / 2.72）。
- **严重度：高**

---

## P-02 读取器把面板自身 Y 轴线当作数据，曲线画法整列读 0

- **现象**：即使把 Empetrum 的列边界改成正确的 `544–601`，`digitize(col, "area")` 在 **row 502**（该层真值 34.84%）返回 `x=544.0 → 0.00%`。而该行唯一的数据墨迹在 **x=586–589**（`(587.5−544)/57×40 ≈ 30.5%`），`544` 正是本面板自己的 Y 轴线（跨度 460 行、连通面积最大的那个分量）。即读取器选中了"最高的连通分量"，而那里是坐标轴不是曲线。真边界下 Empetrum 仍有 48 层里 **13 层读数恰为 0**，这 13 层的绝对误差合计 173.8 个百分点，占该列全部绝对误差的 **82%**（全列 MAE 4.42 中约 3.6 来自这里）。
- **复现**：
  ```bash
  cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe -c "
from straditize_core.session import StraditizeSession
s=StraditizeSession(); s.load_image(image_path='tests/data/figures/benchmark_types/Pollen_CruveStyle_riojaPlotTestData.png')
s.detect_columns(); s.roi_update(y0=82.0,y1=563.0); cols=s.detect_columns()
ci=[k for k,c in enumerate(cols) if c['start']==545][0]
s.columns[ci]['start']=544.0; s.columns[ci]['end']=601.0
p={int(q['row']):float(q['x']) for q in s.digitize(ci,'area')['points']}
print('row502 x =',p[502],'  该行 586..590 像素 x =',[x for x in range(580,600) if s.foreground_mask[502,x]])"
  ```
- **影响**：所有"曲线/散点"画法（曲线与坐标轴之间是空白、不连通）的图都会中招：读数被压在轴线上（≈0），整列系统性偏低。面积填充图不受影响，因为填充与轴线连成一个分量。
- **判据**：该 row 的读数 x 必须落在 **[586, 590]**（该行唯一曲线墨迹所在）；当前返回 544。等价地，Empetrum 在真边界下的全列 MAE 应 ≤ 2.50（当前 4.42）。
- **严重度：高**

---

## P-03 自动创建的 ROI 砍掉图顶 15 层，且不报警

- **现象**：`load_image()` 自动创建 ROI 并返回 `suggested_roi`：

  | 图 | 数据区上沿 | suggested_roi.yMin | 丢失行 | 丢失层 |
  |:---|---:|---:|---:|---:|
  | area | 93 | **197** | 93–196 | 15/49（depth 300–363） |
  | bar | 82 | **188** | 82–187 | 15/49 |
  | curve | 82 | **188** | 82–187 | 15/49 |

  `digitize()` 的取数行严格限制在 ROI 内：area 图 `points` 行 = 197…568（372 行，数据区实为 93…563 共 471 行）；bar/curve 图 = 188…568（381 行，数据区 82…563 共 482 行）。**不抛错、不警告**，`quality` 里也没有"该层未被数字化"的记录。三张图一致丢失顶部 15 层（30.6%）。
- **复现**：
  ```bash
  cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe -c "
from straditize_core.session import StraditizeSession
for n in ('Pollen_riojaPlotTestData.png','Pollen_BarStyle_riojaPlotTestData.png','Pollen_CruveStyle_riojaPlotTestData.png'):
    s=StraditizeSession(); i=s.load_image(image_path='tests/data/figures/benchmark_types/'+n); s.detect_columns()
    r=s.digitize(0,'area')['points']; print(n,'suggested yMin=',i['suggested_roi']['yMin'],'points rows',r[0]['row'],'..',r[-1]['row'],'n=',len(r))"
  ```
- **影响**：默认流程下每张图静默丢掉 15 个层位（depth 300–363）；用户若直接导出 CSV，得到的是残缺序列且看不出来。这是本次实测中唯一"沉默的数据删除"。
- **判据**：`suggested_roi["yMin"]` ≤ **100**（area）/ ≤ **90**（bar, curve），或 `digitize` 返回的 `points` 行数 = **471**（area）/ **482**（bar, curve）（当前 372 / 381）；若 ROI 上边界高于数据区上沿 ≥5px，必须返回显式警告字段。
- **严重度：高**

---

## P-04 `reader_type="bar"` 未实现，静默退化为均值

- **现象**：`digitize(col, "bar")` 与 `digitize(col, "line")` 的输出**逐点完全相等**（`np.array_equal == True`，471 行）；与 `"area"` 差异最大 45.5px。`straditize_core/session_parts/digitize.py` 的分支只有 `("line","area")`、`"bars"`、`else` 三种，`"bar"` 落到 `else` 走均值。而 `straditize_core/digitize.py:317` 的 `digitize_column` 明确接受 `'bar'`（走 `trace_bar_profile`），两层契约不一致。
- **后果**：柱状图上 `bar` 读取器读到的是柱体**中心**，约为真值一半：Betula @430cm 真值 73.91，`area` 得 72.08，`bar` 得 **36.44**；@405cm 真值 65.33 → 32.48；@520cm 真值 31.88 → 15.84。全表 MAE：柱状图 `area` 1.312 vs `bar` 3.087；面积图 0.835 vs 2.807。
- **复现**：
  ```bash
  cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe -c "
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale
s=StraditizeSession(); s.load_image(image_path='tests/data/figures/benchmark_types/Pollen_BarStyle_riojaPlotTestData.png')
s.detect_columns(); s.roi_update(y0=82.0,y1=563.0); s.detect_columns()
s.calibrate_column_xticks(0,ticks=[{'px':112,'value':0.0},{'px':213,'value':80.0}])
sc=resolve_column_scale(s,s.columns[0],0)
A={int(p['row']):p['x'] for p in s.digitize(0,'area')['points']}
B={int(p['row']):p['x'] for p in s.digitize(0,'bar')['points']}
L={int(p['row']):p['x'] for p in s.digitize(0,'line')['points']}
print('bar==line 逐点:', all(B[k]==L[k] for k in B))
for y in (256,296,502): print('row',y,'area',round(sc.px_to_value(A[y]),2),'bar',round(sc.px_to_value(B[y]),2))"
  ```

  实测输出：`bar==line 逐点: True`；row 256 → area 64.16 / bar 32.48，row 296 → 72.08 / 36.44，row 502 → 30.89 / 15.84。
- **影响**：前端若把"柱状图"对应的读取器名设为 `bar`，用户看到的是标注为 bar、实际是 mean 的读数，且数值系统性只有一半；返回结果里的 `reader_type` 还回显 `"bar"`，属于"元数据说谎"。
- **判据**：`digitize(col,"bar")` 与 `digitize(col,"line")` 的输出**不得逐点相等**；柱状图上 `bar` 读取器全表 MAE ≤ **1.50**（当前 3.087；`area` 实测 1.312）。或者：不在 `{area, line, bars}` 内的 `reader_type` 必须抛 `INVALID_PARAMS`。
- **严重度：高**

---

## P-05 未标定时默认量程是"0.65×列宽 = 20 单位"的盲猜，17/20 列偏差 >5%

- **现象**：`detect_columns()` 写入 `tickEndX = start + max(20, min(0.65·W, 80))`、`tickValue = 20`，即未标定时的 px/单位恒为 `max(20,0.65W)/20`。与真值「列有效宽度 ÷ axis_max」比较：

  | 属种 | W | axis_max | 真值 px/单位 | 默认 px/单位 | 偏差 |
  |---|---:|---:|---:|---:|---:|
  | Pinus sylvestris | 119 | 100 | 1.19 | 3.87 | **+225%** |
  | Betula | 101 | 80 | 1.26 | 3.28 | **+160%** |
  | Artemisia | 95 | 80 | 1.19 | 3.09 | **+160%** |
  | Ulmus / Solidago / Compositae / Astragalus / Saxifraga | 13 | 20 | 0.65 | 1.00 | +54% |
  | Quercus / Ononis | 14 | 20 | 0.70 | 1.00 | +43% |
  | Corylus / Salix / Juniperus / Empetrum / Gramineae / Cyperaceae / Rumex | 39–57 | 40 | 0.97–1.43 | 1.27–1.85 | +30% |
  | Alnus / Calluna | 19 | 20 | 0.95 | 1.00 | +5% |
  | Veronica | 20 | 20 | 1.00 | 1.00 | 0% |

  偏差全为正 → 未标定时所有数值系统性偏小；**只有 3/20 列在 ±5% 内**。
- **复现**：
  ```bash
  cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe -c "
from straditize_core.session import StraditizeSession
s=StraditizeSession(); s.load_image(image_path='tests/data/figures/benchmark_types/Pollen_riojaPlotTestData.png'); s.detect_columns()
for c in s.columns[:-1]:
    W=c['end']-c['start']; sw=(c['tickEndX']-c['start'])/c['tickValue']; print(c['col_index'],round(W,0),round(sw,2))"
  ```
  真值 px/单位见 `../bench-pollen.md` §4 表。
- **影响**：用户不手工标定就直接导出时，读数错得离谱（Pinus 会缩到真值的 31%）。当前产品在未标定状态下**不阻止导出、不标 uncalibrated**，只在 `resolve_column_scale` 的 `source` 字段里留下 `"legacy"`。
- **判据**：未标定列（`resolve_column_scale(...).source != "x_ticks"`）中，px/单位与「列宽 ÷ axis_max」偏差 ≤5% 的列数应 ≥ **18/20**（当前 3/20）；或在未标定状态下导出/取数必须显式报错或返回 `uncalibrated=true` 标记。
- **严重度：中**（属"防呆"缺陷：正确路径存在，但错误路径静默）

---

## P-06 分列边界随画法与 ROI 漂移，且系统性右移 1px

- **现象**：
  1. **跨画法漂移**（同一面板在三张图上的检测起点）：

     | 面板 | area | bar | curve | 极差 |
     |:---|---:|---:|---:|---:|
     | Gramineae | 603 | 602 | 609 | **7px** |
     | Cyperaceae | 653 | 653 | 658 | **5px** |
     | Rumex | 839 | 840 | 843 | **4px** |
     | Empetrum（end） | 601 | 601 | 609 | **8px** |

     三张图的排版完全相同（21 条面板轴线逐一相同），所以这是纯检测差异。
  2. **同图 ROI 漂移**：面积图把 ROI 上边界从 y0=93 改到 y0=250（157px），Gramineae 起点 603→606（3px）、Cyperaceae 653→654。
  3. **系统性右移**：柱状图 20 列里有 19 列的 Δ0 = **+1px**；面积图 9 列 +1~+2px。在 13px 窄列上（0.65 px/单位）1px = **+1.54 个百分点**，表现为整列固定偏高（Solidago bias +1.40、Astragalus +1.49、Ononis +1.38、Veronica +1.01，bias 与 MAE 相等）。
- **复现**：
  ```bash
  cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe -c "
from straditize_core.session import StraditizeSession
TOPS={'Pollen_riojaPlotTestData.png':93.0,'Pollen_BarStyle_riojaPlotTestData.png':82.0,'Pollen_CruveStyle_riojaPlotTestData.png':82.0}
for n,t in TOPS.items():
    s=StraditizeSession(); s.load_image(image_path='tests/data/figures/benchmark_types/'+n)
    s.detect_columns(); s.roi_update(y0=t,y1=563.0); s.detect_columns()
    print(n,[int(c['start']) for c in s.columns])
s=StraditizeSession(); s.load_image(image_path='tests/data/figures/benchmark_types/Pollen_riojaPlotTestData.png'); s.detect_columns()
for y0 in (93,250):
    s.roi_update(y0=float(y0),y1=563.0); s.detect_columns(data_xlim=[112,1055],data_ylim=[float(y0),563.0]); print('y0',y0,[int(c['start']) for c in s.columns][9:12])"
  ```

  实测输出末行：`y0 93 [545, 603, 653]` / `y0 250 [545, 606, 654]`（Gramineae 603→606）。三行整列起点见 `../bench-pollen.md` §3。
- **影响**：同一张图两次操作（改 ROI 前后）得到不同的列边界 → 同一批数据两次导出数值不同；柱状图整体右移 1px 使每列有一个 +1.2~+1.5 个百分点的固定偏置。
- **判据**：同一面板在三张图上的 `start` 极差 ≤ **1px**（当前 7/5/4px）；同一图 ROI y0 从 93 改到 250，任何列 `start` 变化 ≤ **1px**（当前 3px）；检测起点与面板轴线偏差 = 0 的列数 ≥ **18/20**（当前 area 11/20、bar 0/20、curve 12/20）。
- **严重度：中**

---

## 未列为本清单的现象

- **分列数不稳定（同图数出 20/21/22 列）没有发生**：三张图 × 阈值 {0.05,0.10,0.15,0.20} × min_col_width_ratio {0.005,0.010} 共 24 组合全部得 21 列，宽度序列逐项相同；只有 min_col_width_ratio ≥0.02 才塌成 14 列（把 13px 面板并掉）。真正的不稳定是上条 P-06 的**边界漂移**，不是列数。
- **13px 窄列 MAE 1.0–1.5 不判为缺陷**：0.65 px/单位下 1px = 1.54 个百分点，已到量化地板。
- **合成列（Trees/Shrubs/Herbs，929–1055）** 不属于 20 列真值，未评估；分列把它切成单独一列（126px）属正确行为。
