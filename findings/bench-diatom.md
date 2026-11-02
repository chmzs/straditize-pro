# 硅藻 benchmark 图数字化精度实测（Diatom_riojaPlotTestData.png）

> 只读探测：未改 `straditize_core/`、`frontend/`、`tests/` 任何文件，未提交，未跑 e2e。
> 全部数字来自像素/软件实测；探测一律 `.pixi/envs/default/python.exe`（不用 `pixi run python`，避免争锁）。
> 图：`tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png`，1179×600，RGB。
> 真值源：`riojaPlotTestData_Pollen_and_Diatom.xlsx` → sheet `RLGH_Diatoms`（21 行 × 43 列：Depth + Age + 41 个属种，20 个样品）。

---

## 0. 一句话结论

| 项 | 实测 |
| :--- | :--- |
| 图中真实属种面板数 | **25**（不是 24） |
| `rlgh_golden.json` 列数 | 24 —— **阈值对、golden 少一列**（漏 `Achnanthes minutissima`，Excel 第 3 列，max=3.18） |
| 软件默认 ROI 分列数 | **30**（25 个真面板全部命中，另 5 列来自 y 轴文字区与聚类树） |
| 属种面板边界定位误差 | **≤1px**（25 列中 6 列起点 −1px、6 列终点 −1px，其余 0px；仅末列右端越界 +43px） |
| 全表 MAE（真实标定 + 软件 `area` 读数） | **0.204 个百分点**（500 格），平均 R² **0.906** |
| 全表 MAE（软件默认刻度建议） | **4.059 个百分点**（同一批 25 列读数，只换刻度）⇒ 误差放大 **19.9×** |
| `max ≥ 2 → 图上列数` 规则 | **失效**：阈值得 25（对），golden 从 Excel 第 4 列起算，少算 1 列 |
| `axis_max = ceil(max/20)*20 = 20` | **失效**：25 个面板共用 px/单位 3.80，量程 = 列宽/3.80 ∈ [6.84, 22.11]，只有 1/25 列恰好 20 |

---

## 1. 先验证真值规则本身（任务要求的第一件事）

### 1.1 `max ≥ 2` 过滤的列数

```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import openpyxl
wb=openpyxl.load_workbook("tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx",data_only=True)
ws=wb["RLGH_Diatoms"]
hdr=[ws.cell(1,c).value for c in range(1,ws.max_column+1)]
ks=[(hdr[c-1],max(ws.cell(r,c).value for r in range(2,ws.max_row+1))) for c in range(3,ws.max_column+1)]
kept=[k for k in ks if k[1]>=2]
print("taxa 总数",len(ks),"max>=2 =",len(kept))
print("kept[0..3]",kept[:4])
PY
```

实测：

```
taxa 总数 41 max>=2 = 25
kept[0..3] [('Achnanthes minutissima', 3.18), ('Achnanthes marginulata', 2.78), ('Aulacoseira perglabra', 2.33), ('Brachysira vitrea', 14.3)]
```

**`max ≥ 2` 得 25 列，不是 24。** golden 漏掉的是 Excel **第 3 列** `Achnanthes minutissima`（max=3.18 ≥ 2）。
golden 的 24 条与 Excel `taxa[1:25]` **逐元素完全相同**（名字与 20 个数值都相等，脚本比对结果 `golden == excel[1:] elementwise: True`）。
成因：golden 生成时"第 4 列起"的偏移量把第 3 列（第一个属种）切掉了 —— issue **D-01**。

### 1.2 图上到底几个属种面板（像素实测）

判据：**该列在任一数据行出现填充色**（浅蓝 `(158,202,225)` 或浅灰 `(224,224,224)`）→ 属于某个面板；填充段之间的空白即面板间隙。面板左轴 = 填充段起点 − 1px。

```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import numpy as np
from PIL import Image
a=np.asarray(Image.open("tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png").convert("RGB")).astype(int)
blue=(np.abs(a[:,:,0]-158)<12)&(np.abs(a[:,:,1]-202)<12)&(np.abs(a[:,:,2]-225)<12)
gray=(np.abs(a[:,:,0]-224)<6)&(np.abs(a[:,:,1]-224)<6)&(np.abs(a[:,:,2]-224)<6)
has=(blue|gray)[80:550].any(axis=0)
runs=[];s=None
for x in range(len(has)):
    if has[x] and s is None: s=x
    elif not has[x] and s is not None: runs.append((s,x-1)); s=None
runs=[r for r in runs if r[1]-r[0]>=8]
print("n fills",len(runs)); print(runs)
print("panel_lefts",[r[0]-1 for r in runs])
PY
```

实测：

```
n fills 27
[(77,94),(103,121),(129,146),(156,212),(221,257),(266,281),(293,309),(319,335),(345,363),(372,447),(456,511),(520,530),(547,564),(573,629),(638,655),(664,680),(690,708),(717,753),(762,780),(789,825),(834,850),(861,897),(906,943),(952,969),(978,1053),(1061,1091),(1121,1139)]
panel_lefts [76,102,128,155,220,265,292,318,344,371,455,519,546,572,637,663,689,716,761,788,833,860,905,951,977,1060,1120]
```

- 前 **25 段**是属种面板（左轴 `[76,102,128,…,977]`，末段填充到 **1053**）。
- 后 2 段 `(1061,1091)` `(1121,1139)` 高度只有几行，是**聚类树的横枝**，不是面板。
- **没有** pollen 图里那种"合成列/浓度列"，25 个面板全是属种。
- 交叉验证 1：按轴色检测（暗蓝灰 ≈ (99,126,140)，覆盖率>0.6）只得 23 条，漏掉 689 / 761 两处（这两条轴线仅 1px 且更浅），故以填充法为准。
- 交叉验证 2：软件 `detect_columns(data_xlim=[70,1055])` 的 25 个起点与上表**逐列相差 ≤1px**。

### 1.3 面板 ↔ 属种 的 1:1 对应（峰值 + 拟合反证）

每个面板里有两条填充序列：**浅蓝 `(158,202,225)`** 与 **浅灰 `(224,224,224)`**。取浅蓝序列右缘峰值 ÷ 3.80（3.80 的来历见 §2.2）：

| 面板 | 属种 | 宽px | 蓝峰值px | 峰值/3.80 | Excel max | Δ |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| P00 | Achnanthes minutissima | 26 | 11 | 2.89 | 3.18 | −0.29 |
| P01 | Achnanthes marginulata | 26 | 10 | 2.63 | 2.78 | −0.15 |
| P02 | Aulacoseira perglabra | 27 | 9 | 2.37 | 2.33 | +0.04 |
| P03 | Brachysira vitrea | 65 | 54 | 14.21 | 14.30 | −0.09 |
| P04 | Brachysira brebissonii | 45 | 22 | 5.79 | 6.11 | −0.32 |
| P05 | Cymbella lunata | 27 | 8 | 2.11 | 2.19 | −0.08 |
| P06 | Eunotia pectinalis var. minor | 26 | 8 | 2.11 | 2.33 | −0.22 |
| P07 | Eunotia rhomboidea | 26 | 8 | 2.11 | 2.33 | −0.22 |
| P08 | Eunotia denticulata | 27 | 9 | 2.37 | 2.61 | −0.24 |
| P09 | Eunotia incisa | 84 | 63 | 16.58 | 16.84 | −0.26 |
| P10 | Eunotia naegelii | 64 | 39 | 10.26 | 10.49 | −0.23 |
| P11 | Eunotia vanheurckii var. intermedia | 27 | 8 | 2.11 | 2.21 | −0.10 |
| P12 | Fragilaria virescens var. exigua | 26 | 18 | 4.74 | 5.00 | −0.26 |
| P13 | Frustulia rhomboides var. saxonica | 65 | 53 | 13.95 | 14.38 | −0.43 |
| P14 | Frustulia rhomboides var. viridula | 26 | 10 | 2.63 | 2.98 | −0.35 |
| P15 | Navicula mediocris | 26 | 8 | 2.11 | 2.35 | −0.24 |
| P16 | Navicula madumensis | 27 | 18 | 4.74 | 4.84 | −0.10 |
| P17 | Navicula leptostriata | 45 | 30 | 7.89 | 8.14 | −0.25 |
| P18 | Navicula cumbriensis | 27 | 9 | 2.37 | 2.51 | −0.14 |
| P19 | Navicula hoefleri | 45 | 23 | 6.05 | 6.27 | −0.22 |
| P20 | Nitzschia perminuta | 27 | 8 | 2.11 | 2.33 | −0.22 |
| P21 | Peronia fibula | 45 | 34 | 8.95 | 9.20 | −0.25 |
| P22 | Tabellaria flocculosa | 46 | 24 | 6.32 | 6.36 | −0.04 |
| P23 | Tabellaria binalis | 26 | 9 | 2.37 | 2.71 | −0.34 |
| P24 | Tabellaria quadriseptata | 76 | 58 | 15.26 | 15.26 | 0.00 |

25/25 面板 |Δ| ≤ 0.43、均值 −0.20，且**几乎全部偏负** —— 这是"在层位行取值、没落在曲线极值行"造成的固定量化偏差（1 行 = 1px = 0.263 个百分点），不是配对错误。配对正确性的硬证据在 §4：25 个面板的"px↔真值"最小二乘斜率全部落在 3.45–3.90，R² 有 20/25 列 ≥0.89；错位一格会让斜率偏离一个数量级。

**顺序与 Excel `max≥2` 结果完全一致，1:1 无错位。**

---

## 2. 量程（第二问）

### 2.1 Y 轴 = Age（不是 Depth）

y 轴标签（x∈[20,64) 的黑字）实测 7 组行中心：`120, 190, 261, 331, 402, 472, 542` → 对应 `1860,1880,…,1980`（放大目视确认：1860 在最上、1980 在最下，20 年一格）。
→ `age(row) = 1860 + (row-120)/3.5167`（3.5167 px/年）。

用 Excel `Age` 列（1986,1985,1982,…,1848）反推 20 个样品行：

```
layer_rows = [563, 560, 549, 542, 531, 524, 517, 510, 500, 486, 458, 429, 398, 366, 345, 317, 268, 215, 148, 78]
```

**独立交叉验证**：图内可见的样本分隔线（填充区内的更浅横向混色线，逐行计数>100）为
`{148, 215, 268, 317, 345, 366, 398, 430, 458, 486, 500, 511, 518, 542, 549, 560}` —— 与上表 **16/20 逐条对上**，其余 4 条因相邻样本数值相同而不可见。层位行映射可信。

**方向**：depth 0.25（age 1986）在**最下**（row 563），depth 19.5（age 1848）在**最上**（row 78）。按行号顺序存表会整体倒序。

### 2.2 X 轴：所有面板共用一个 px/单位 = 3.80

**10 个**面板底部有印刷数字（其余 15 个窄面板只在 0 处有一根短齿、无数字），直接用"数字文本 bbox 中心 − 面板左轴"读数：

| 面板 | 宽px | 印刷刻度 | 刻度中心x | 距左轴 | px/单位 |
| :--- | ---: | :--- | ---: | ---: | ---: |
| P03 | 65 | `10` | 193 | 38 | 3.80 |
| P04 | 45 | `10` | 258 | 38 | 3.80 |
| P09 | 84 | `10` / `20` | 409 / 447.5 | 38 / 76.5 | 3.80 / 3.83 |
| P10 | 64 | `10` | 493 | 38 | 3.80 |
| P13 | 65 | `10` | 610 | 38 | 3.80 |
| P17 | 45 | `10` | 754 | 38 | 3.80 |
| P19 | 45 | `10` | 826 | 38 | 3.80 |
| P21 | 45 | `10` | 898 | 38 | 3.80 |
| P22 | 46 | `10` | 944 | 39 | 3.90 |
| P24 | 76 | `10` / `20` | 1016 / 1053.5 | 39 / 76.5 | 3.90 / 3.83 |

10/10 面板落在 **3.80–3.90**（中位 3.80）。带数字的 10 个面板宽度全部 ≥45px（45/46/64/65/76/84），15 个 26–27px 窄面板一律只有 0 处一根短齿、无任何数字 —— 即"该图能否读出量程"与列宽强相关，与属种数值无关。

**独立第二估计**（不依赖标签锚点）：每个面板做"数字化 px ↔ Excel 真值"最小二乘斜率，中位数 **3.795**，范围 **3.449–3.901**（散布来自单行取样量化）。

⇒ **量程 = 列宽 ÷ 3.80**，逐面板：

```
P00 6.84  P01 6.84  P02 7.11  P03 17.11  P04 11.84  P05 7.11  P06 6.84  P07 6.84  P08 7.11
P09 22.11 P10 16.84 P11 7.11  P12 6.84   P13 17.11  P14 6.84  P15 6.84  P16 7.11  P17 11.84
P18 7.11  P19 11.84 P20 7.11  P21 11.84  P22 12.11  P23 6.84  P24 20.00
```

### 2.3 「每列 px/单位 = 列有效宽 ÷ axis_max」是否成立

该恒等式**只在 axis_max 取实测值时成立**（= 3.80，25/25 列偏差 0%）。
若按 golden 的 `axis_max = ceil(max/20)*20 = 20`（25 列全 20），等价于要求 px/单位随列宽变化：

| 列宽 | 列数 | golden 反推 px/单位 = w/20 | 实测 px/单位 | 偏差 |
| ---: | ---: | ---: | ---: | ---: |
| 26 | 8 | 1.30 | 3.80 | **−65.8%** |
| 27 | 7 | 1.35 | 3.80 | **−64.5%** |
| 45 | 4 | 2.25 | 3.80 | **−40.8%** |
| 46 | 1 | 2.30 | 3.80 | **−39.5%** |
| 64 | 1 | 3.20 | 3.80 | **−15.8%** |
| 65 | 2 | 3.25 | 3.80 | **−14.5%** |
| 76 | 1 | 3.80 | 3.80 | **0.0%** |
| 84 | 1 | 4.20 | 3.80 | **+10.5%** |

**>5% 偏差：24/25 列命中，只有 P24（宽 76）落在 ±5% 内。** → issue **D-02**。

---

## 3. 分列（第一问）

### 3.1 软件实测（默认建议 ROI）

```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
from straditize_core.session import StraditizeSession
s=StraditizeSession()
info=s.load_image(image_path="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png")
print(info["width"],info["height"],info.get("suggested_roi"))
print("suggest_data_region",s.suggest_data_region())
cols=s.detect_columns()
print("ncols",len(cols))
for i,c in enumerate(cols): print(i,int(c["start"]),int(c["end"]),int(c["end"])-int(c["start"]))
PY
```

实测：`suggested_roi = {xMin:0, xMax:1177, yMin:1, yMax:579}`，`suggest_data_region` 同值，**`ncols = 30`**。

### 3.2 30 列 vs 25 个真面板：逐列判定

| 检测列（产品 id，0 基 idx +1） | 区间 | 宽 | 判定 | 依据 |
| :--- | :--- | ---: | :--- | :--- |
| col01（idx0） | [47,76) | 29 | **多切（非数据）** | 该区只有 y 轴刻度文字（1860/1880…，x∈[20,64)）与轴中线 x=68；掩膜 ink 1160px 全部来自文字，填充色占比 0 |
| col02–col25（idx1–24） | [76,102)…[951,977) | 26…84 | 对应 P00–P23（24 列），边界误差 ≤1px | 见下 Δ 表 |
| col26（idx25） | [977,1096) | 119 | **对应 P24 但右端越界 +43px** | 真面板 P24 = [977,1053) 宽 76；该列多吞 1053–1096 的留白与树线 |
| col27（idx26） | [1096,1114) | 18 | **多切（聚类树）** | 树在 x∈[1060,1176]，底部是 0–30 的树距离轴 |
| col28（idx27） | [1114,1138) | 24 | **多切（聚类树）** | 同上 |
| col29（idx28） | [1138,1151) | 13 | **多切（聚类树）** | 同上 |
| col30（idx29） | [1151,1177) | 26 | **多切（聚类树）** | 同上 |

真边界 vs 检测边界（25 个真面板：col02–col25 ↔ P00–P23，col26 ↔ P24）：

```
真:   76 102 128 155 220 265 292 318 344 371 455 519 546 572 637 663 689 716 761 788 833 860 905 951 977 |1053
检测: 76 102 128 155 219 265 291 318 344 370 454 519 545 572 637 663 689 716 761 788 833 859 905 951 977 |1096
Δ起点: 0   0   0   0  -1   0  -1   0   0  -1  -1   0  -1   0   0   0   0   0   0   0   0  -1   0   0   0
Δ终点: 0   0   0  -1   0  -1   0   0  -1  -1   0  -1   0   0   0   0   0   0   0   0  -1   0   0   0  +43
```

**结论**：
- **少切 0 列**：25 个属种面板全部各有 1 列，无一遗漏。
- **拆碎 0 列**：没有任何属种面板被切成两半。
- **多切 5 列**：col01（y 轴文字区 29px）+ col27–col30（聚类树 18/24/13/26px）。
- **越界 1 列**：col26 右端 +43px（真 76px → 119px，+56%）。
- 属种面板边界定位精度：**≤1px**。
- 换 ROI 即可修正：`data_xlim=[70,1055]`（裁掉 y 轴区与树）→ **恰好 25 列**，边界误差同样 ≤1px。→ issue **D-04**

---

## 4. 曲线精度（第三问）

方法：对每列写入**该面板实测的真实量程**（0 在面板左轴，`宽/3.80` 在右轴），`digitize(col, reader_type="area")`，在 §2.1 的 20 个层位行取值，与 Excel 真值逐格比。

```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import numpy as np, openpyxl
from straditize_core.session import StraditizeSession
wb=openpyxl.load_workbook("tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx",data_only=True)
ws=wb["RLGH_Diatoms"]; hdr=[ws.cell(1,c).value for c in range(1,ws.max_column+1)]
ages=[ws.cell(r,2).value for r in range(2,ws.max_row+1)]
ks=[(hdr[c-1],[ws.cell(r,c).value for r in range(2,ws.max_row+1)]) for c in range(3,ws.max_column+1)]
ks=[k for k in ks if max(k[1])>=2]; T=np.array([k[1] for k in ks],float)
rows=[int(round(120+(ag-1860)*3.5167)) for ag in ages]
S=3.80; te=[76,102,128,155,220,265,292,318,344,371,455,519,546,572,637,663,689,716,761,788,833,860,905,951,977,1053]
s=StraditizeSession(); s.load_image(image_path="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png")
cols=s.detect_columns(data_xlim=[70,1055],data_ylim=[1,579])
ae=[]
for i in range(25):
    L,R=te[i],te[i+1]; s.calibrate_column_xticks(i,[{"px":L,"value":0.0},{"px":R,"value":(R-L)/S}])
    d=s.digitize(i); p={int(q["row"]):float(q["x"]) for q in d["points"]}
    v=np.array([(p.get(r,L)-L)/S for r in rows]); e=np.abs(v-T[i]); ae.extend(e.tolist())
    r2=1-np.sum((v-T[i])**2)/np.sum((T[i]-T[i].mean())**2)
    print(f"P{i:02d} {ks[i][0][:34]:34s} MAE={e.mean():.2f} R2={r2:.4f}")
print("FULL MAE",round(float(np.mean(ae)),3))
PY
```

实测（`data_xlim=[70,1055]`，25 列）：

| 面板 | 属种 | MAE | R² | | 面板 | 属种 | MAE | R² |
| :--- | :--- | ---: | ---: | --- | :--- | :--- | ---: | ---: |
| P00 | Achnanthes minutissima | 0.25 | 0.8908 | | P13 | Frustulia rhomboides var. saxonica | 0.15 | 0.9897 |
| P01 | Achnanthes marginulata | 0.14 | 0.9518 | | P14 | Frustulia rhomboides var. viridula | 0.32 | 0.7387 |
| P02 | Aulacoseira perglabra | 0.08 | 0.9656 | | P15 | Navicula mediocris | 0.21 | 0.8390 |
| P03 | Brachysira vitrea | 0.21 | 0.9960 | | P16 | Navicula madumensis | 0.10 | 0.9925 |
| P04 | Brachysira brebissonii | 0.31 | 0.8905 | | P17 | Navicula leptostriata | 0.21 | 0.9644 |
| P05 | Cymbella lunata | 0.15 | 0.9062 | | P18 | Navicula cumbriensis | 0.12 | 0.9499 |
| P06 | Eunotia pectinalis var. minor | 0.37 | **0.3082** | | P19 | Navicula hoefleri | 0.25 | 0.9743 |
| P07 | Eunotia rhomboidea | 0.20 | 0.8138 | | P20 | Nitzschia perminuta | 0.14 | 0.9123 |
| P08 | Eunotia denticulata | 0.13 | 0.8997 | | P21 | Peronia fibula | 0.28 | 0.9783 |
| P09 | Eunotia incisa | 0.22 | 0.9890 | | P22 | Tabellaria flocculosa | 0.16 | 0.9858 |
| P10 | Eunotia naegelii | 0.26 | 0.9851 | | P23 | Tabellaria binalis | 0.24 | 0.9089 |
| P11 | Eunotia vanheurckii var. intermedia | 0.14 | 0.9077 | | P24 | Tabellaria quadriseptata | 0.14 | 0.9986 |
| P12 | Fragilaria virescens var. exigua | 0.31 | 0.9121 | | | | | |

- **全表 MAE = 0.204 个百分点**（25 列 × 20 层 = 500 格，真值无 null）。
- 平均 R² = **0.906**。
- 最差 3 列：P06（R²=0.31 / MAE=0.37）、P14（0.74 / 0.32）、P07（0.81 / 0.20）—— 全是 26px 窄列、量程 6.84、真值振幅 ≤3。
- 若改用软件自己的列边界做自洽标定（不借真值边界）：MAE **0.156**（更低，因为 digitize 的起点就是列起点）。

### 4.1 只换刻度（其余完全不变）会怎样

同一批 digitize 结果，把标定换成软件自动给的刻度建议（`startValue=0 @ 列起点`、`tickValue=20 @ tickEndX`，其中 `tickEndX − start = clamp(0.65w, 20, 80)`）：

| 列宽 | 默认 tickEndX−start | 默认 px/单位 | 真实 px/单位 | 偏差 | 默认刻度下 MAE（该宽度档全部列） | 真实刻度下 MAE |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 26（10 列） | 20.0 | 1.000 | 3.80 | **−73.6%** | 1.11–3.81 | 0.13–0.32 |
| 27（5 列） | 20.0 | 1.000 | 3.80 | **−73.6%** | 2.73–5.92 | 0.08–0.37 |
| 45（2 列） | 29.2 | 1.460 | 3.80 | **−61.5%** | 4.35–9.43 | 0.21–0.25 |
| 46（3 列） | 29.9 | 1.495 | 3.80 | **−60.5%** | 3.95–6.80 | 0.16–0.31 |
| 64（1 列） | 41.6 | 2.080 | 3.80 | **−45.1%** | 2.87 | 0.21 |
| 65（2 列） | 42.2 | 2.110 | 3.80 | **−44.3%** | 4.63–7.45 | 0.15–0.26 |
| 78（1 列） | 50.7 | 2.535 | 3.80 | **−33.3%** | 4.87 | 0.14 |
| 84（1 列） | 54.6 | 2.730 | 3.80 | **−27.9%** | 5.05 | 0.22 |

- **全表 MAE：默认刻度 4.059 vs 真实刻度 0.204（19.9×）**。
- `clamp(0.65w, 20, 80)` 的 20px 下限把 15 个 26–27px 窄列一律钉成 1.000 px/单位，真值 3.80 ⇒ 每条读数被放大 3.8 倍。
- 无一列"碰对"：8 个宽度档的 px/单位全部低于真值 3.80（−27.9%～−73.6%）。若改用默认整幅 ROI（多 5 个假列），全表 MAE 为 3.876 —— 数值相近，原因不同（多出来的列本身也带错）。

---

## 5. 其他实测（供 issue 引用）

| 项 | 实测 |
| :--- | :--- |
| `detect_columns` 连跑两次 | 30 列，边界逐列完全相同 → **稳定** |
| `digitize` 连跑两次 | 579 行 x 值完全相同 → **稳定** |
| 列边界对 `data_ylim` 的敏感性 | 仅把数据区 y 由 `[1,579]` 改成真数据框 `[78,563]`：列数仍 25，但 **idx2 起点 128→132（+4px）、idx6 291→295（+4px）、idx12 545→551（+6px）、idx16 689→691（+2px）、idx18 761→762（+1px）**；自洽 MAE 0.156 → **0.464**（idx12 单列 1.44、idx2 1.07、idx6 0.99） |
| `measure_ruler_geometry` | 30 列中只有 **11 列**测出轴行（全部 row=566），19 列 `axis_row=None`；`median_spacing_px = 33.0`（真实印刷刻距 38px）；`n_cells ∈ {0,1,2,4}`；`all_regular = False` |
| 单列 `detect_ruler` | [371,455) → 轴行 566 / 2 格 / 22.5px（真 38px）；[977,1053) → 1 格 / 38.0px（真 2 格）；[76,102) → `axis_row=None` |
| 前景掩膜 | 浅蓝 (158,202,225)：**134041/134041 全进掩膜**；浅灰 (224,224,224)：**0/114289 全被当背景** |
| `reader_type="line"` | 在填充剖面上读数恰为一半：P03 max 7.11 vs `area` 14.21；P09 8.16 vs 16.58；P22 3.16 vs 6.32 |
| `reader_type="bars"` | 与 `area` 完全一致（14.21/16.58/6.32）—— 因为最外那条灰序列根本不在掩膜里 |

---

## 6. 与 pollen 图的差异（第四问）

同工具同参数，只换图：

| 指标 | Diatom（本图） | Pollen_riojaPlotTestData.png |
| :--- | :--- | :--- |
| 属种数（Excel `max≥2`） | 25 | 20 |
| 图上的非属种面板 | **无** | 1 个合成列（x 929–1055，填充色深绿 (0,100,0)，golden 未收录） |
| `detect_columns` 默认 ROI 列数 | **30** | **21** |
| 其中**非数据区**被判为列的 | **5**（y 轴文字区 1 + 聚类树 4） | **0** |
| 真实属种面板被拆碎 | **0** | 0 |
| 列宽中位数 / 范围（软件实测） | **27px / 26–84** | **37px / 12–126** |
| `measure_ruler_geometry` 测出轴行的列 | **11/30** | **21/21** |
| `median_spacing_px` | **33.0**（真 38） | **12.5** |
| 有印刷数字的面板 | 10/25（其余只在 0 处有一根短齿） | 每列都有 |

**结论（与预设相反）**：
1. 硅藻图列确实更细密（中位 27px vs 37px）、量程更小（6.84–22.11，15 列仅 6.84–7.11），但**没有一列被拆碎** —— 26px 窄列配合 ≤1px 的边界精度，分列本身扛住了。
2. 真正的分化在**刻度尺几何**：pollen 21/21 列测出轴行、刻距 12.5px 与视觉一致；硅藻只有 11/30 列测出，`median_spacing 33.0` 与真实 38px 差 13%，窄列全部返回 0 格。原因之一是硅藻 15/25 个面板**根本没有印刷数字**，底部只有 0 位置一根短齿（`detect_ruler(76,102)` → `axis_row=None`，而 10 个带数字面板的横轴则都落在 y=566）；之二是聚类树被当列后产生 18–28px 的假刻距。
3. 两图"多出列"的成因完全不同：pollen 的 21 列全部对应图上的真实面板（20 属种 + 1 合成列，合成列只是不在 golden 里）；硅藻多出的 5 列**不来自任何面板**，而是 y 轴文字区与聚类树。即硅藻图的失效模式是"非数据区被判为数据列"，不是"数据列被拆碎"。

---

## 7. 复算前提与已知边界

- px/单位 3.80 由 10 个带印刷数字的面板直接量得（`10` ↔ 38px），并以逐面板最小二乘斜率（中位 3.795，范围 3.449–3.901）独立复核；采样行落点 ±1px 带来 0.263 个百分点的量化误差，这是本图 MAE 的下限（实测 0.204 与之同阶，说明曲线读取已接近像素极限）。
- 层位行由 y 轴 Age 标签（7 个，3.5167 px/年）与 Excel `Age` 列联合反推，并与图中 16 条可见样本分隔线逐条对上。
- 面板边界以"填充色分段"判定（可复现：25 段 + 2 段树枝）；轴色法在同图只检出 23 条（689/761 两处过浅），故不作为判据。
- 与 golden 的差异全部归因于 golden 少一列（D-01）；若用 golden 本身当真值按面板 0..23 对齐，MAE = **3.525**（而非 0.204），差 17 倍 —— 这就是整列错位一格的代价。
- 本图属种面板里还有一条浅灰 (224,224,224) 的外扩序列，其峰值恒等于面板右边界；它不在软件前景掩膜内，因此不影响读数，但它代表什么变量无法从图上确定（不做猜测）。
