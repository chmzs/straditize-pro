# 硅藻 benchmark 图实测 issue 清单

> 对象：`tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png`（1179×600）
> 真值源：`tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx` → sheet `RLGH_Diatoms`
> 完整方法与数字表见 `docs/findings/bench-diatom.md`。
> 全部为只读探测，未修改产品代码。
> 常量说明：该图 25 个属种面板共用 **px/单位 = 3.80**（10 个带印刷数字的面板实测 10 ↔ 38–39px，中位 3.80；逐面板最小二乘斜率中位 3.795，范围 3.449–3.901）。

---

## D-01 真值 `rlgh_golden.json` 比 `max ≥ 2` 规则少一列：24 应为 25

- 现象：Excel `RLGH_Diatoms` 共 41 个属种列（第 3–43 列），`max ≥ 2` 命中 **25** 个；`rlgh_golden.json` 只有 **24** 条，且与 Excel 的 `taxa[1:25]` 逐元素完全相同。缺失的是 Excel **第 3 列** `Achnanthes minutissima`（max = 3.18 ≥ 2）。图上实测同样有 **25** 个属种面板（左轴边界 `[76,102,128,155,220,265,292,318,344,371,455,519,546,572,637,663,689,716,761,788,833,860,905,951,977,1053]`），按 Excel 顺序与 25 个属种 1:1 吻合。也就是说 golden 的"第 4 列起"偏移了 1 列（数据从第 3 列就开始了）。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import openpyxl, json
wb=openpyxl.load_workbook("tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx",data_only=True)
ws=wb["RLGH_Diatoms"]; hdr=[ws.cell(1,c).value for c in range(1,ws.max_column+1)]
ks=[(hdr[c-1],max(ws.cell(r,c).value for r in range(2,ws.max_row+1))) for c in range(3,ws.max_column+1)]
kept=[k for k in ks if k[1]>=2]
g=json.load(open('.scratch/bench/rlgh_golden.json',encoding='utf-8'))
print("excel max>=2 =",len(kept),"golden =",g['n_taxa'])
print("excel kept[0] =",kept[0],"golden taxa[0] =",(g['taxa'][0]['name'],g['taxa'][0]['max']))
PY
```
- 影响：golden 与图上的列一一对应关系整体错位一格。若按下标把 golden 的 24 列对到图上前 24 个面板，全表 MAE 从 **0.204** 恶化到 **3.525**（17 倍），每个属种都被安到相邻属种身上；导出的丰度表整表列名与数值错配。
- 判据：`rlgh_golden.json` 的 `n_taxa` 必须等于 25，且 `taxa[0]["name"] == "Achnanthes minutissima"`、`taxa[0]["values"]` 等于 Excel 第 3 列 20 个值（逐值相等，容差 0）。
- 严重度：**高**

---

## D-02 `图上量程 = ceil(max/20)*20` 规则在硅藻图上失效：实测量程是「列宽 ÷ 3.80」，25 列中只有 1 列等于 20

- 现象：该图 25 个面板共用同一 **px/单位 = 3.80**：10 个带印刷数字的面板直接量得刻度 `10` 落在左轴右侧 **38px**（P03/P04/P10/P13/P17/P19/P21），其中 P22/P24 为 39px，`20` 落在 76.5px（P09/P24）；实测区间 3.80–3.90，中位 3.80。因此每个面板的量程 = 列宽 ÷ 3.80 = `{6.84, 7.11, 17.11, 11.84, 22.11, 16.84, 12.11, 20.00, …}`，**不是均匀的 20**。若按 golden 的 `axis_max = 20` 反推，宽 26px 列应为 1.30 px/单位（实测 3.80，偏差 **−65.8%**）、宽 84px 列应为 4.20（偏差 **+10.5%**）；24/25 列偏差 >5%，只有宽 76px 的 P24 恰好是 20.0。
- 复现：
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
runs=[r for r in runs if r[1]-r[0]>=8][:25]      # 末两段是聚类树横枝，非面板
e=[r[0]-1 for r in runs]+[1053]; w=[e[i+1]-e[i] for i in range(len(e)-1)]
print("panels",len(w),"widths",w)
print("axis_max(w/3.80)",[round(x/3.80,2) for x in w])
print("px/unit if axis_max==20",[round(x/20,2) for x in w])
# 印刷刻度：y 568..584 黑字分组，看 10 与左轴的像素距
m=a.mean(axis=2); sub=m[568:584,:]<150
col=sub.sum(axis=0); g2=[]
for x in np.where(col>0)[0]:
    if g2 and x-g2[-1][-1]<=1: g2[-1].append(x)
    else: g2.append([x])
print("label bboxes", [(k[0],k[-1]) for k in g2 if len(k)>1][:14])
PY
```
- 影响：任何用 golden 的 `axis_max` 去标定硅藻图的流程，会把读数按错误量程换算——窄列（15/25 列是 26–27px）读数被系统性放大到 **3.8 倍**，宽列被压低约 10%。丰度表不是"略有偏差"，而是逐列不同倍率的错误。
- 判据：对每个面板，"由 golden `axis_max` 反推的 px/单位"与"该面板印刷刻度像素距 ÷ 刻度值"的相对差必须 ≤5%；本图实测 24/25 列超限（最大 −65.8%）。反过来说，若采用实测 `axis_max = 列宽/3.80`，则 25/25 列的 px/单位必须全等于 3.80±0.05。
- 严重度：**高**

---

## D-03 软件默认刻度建议 `clamp(0.65×列宽, 20, 80)` 令 px/单位系统性偏低 27.9%–73.6%，全表 MAE 因此从 0.204 涨到 4.059

- 现象：`detect_columns` 给每列的初始刻度是 `startValue=0 @ 列起点`、`tickValue=20 @ tickEndX`，而 `tickEndX − start = clamp(0.65×列宽, 20, 80)`。本图真实 px/单位恒为 3.80，于是：26–27px 窄列（15 列）被 20px 下限钉成 **1.000 px/单位（−73.6%）**，45–46px 列 1.46–1.50（−61.5%/−60.5%），64–65px 列 2.08–2.11（−45.1%/−44.3%），84px 列 2.73（−27.9%）。用同一批 digitize 结果只换刻度：**全表 MAE 0.204 → 4.059（19.9×）**，最差单列 9.43（宽 45px 的 Navicula leptostriata）。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import numpy as np, openpyxl
from straditize_core.session import StraditizeSession
wb=openpyxl.load_workbook("tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx",data_only=True)
ws=wb["RLGH_Diatoms"]; hdr=[ws.cell(1,c).value for c in range(1,ws.max_column+1)]
ages=[ws.cell(r,2).value for r in range(2,ws.max_row+1)]
ks=[(hdr[c-1],[ws.cell(r,c).value for r in range(2,ws.max_row+1)]) for c in range(3,ws.max_column+1)]
ks=[k for k in ks if max(k[1])>=2]; T=np.array([k[1] for k in ks],float)
rows=[int(round(120+(ag-1860)*3.5167)) for ag in ages]; S=3.80
s=StraditizeSession(); s.load_image(image_path="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png")
cols=s.detect_columns(data_xlim=[70,1055],data_ylim=[1,579])
ed=[]; pu=[]
for i,c in enumerate(cols):
    st=float(c["start"]); tick=float(c["tickEndX"])-st; pu.append(round(tick/20.0,3))
    s.calibrate_column_xticks(i,[{"px":st,"value":0.0},{"px":st+tick,"value":20.0}])
    d=s.digitize(i); p={int(q["row"]):float(q["x"]) for q in d["points"]}
    v=np.array([(p.get(r,st)-st)/(tick/20.0) for r in rows]); ed.extend(np.abs(v-T[i]).tolist())
print("default-tick px/unit per col", pu, " true", S)
print("full-table MAE with default tick =", round(float(np.mean(ed)),3))
PY
```
- 影响：用户点开"自动分列"就接受默认刻度时，整张表的丰度被整体放大 1.4–3.8 倍（并按列宽分档不同倍率），比随机误差更危险——形状对、量级错。
- 判据：默认 `tickEndX − start` 与"该列印刷刻度的像素距"（本图 38px）的相对差必须 ≤5%。当前实现里，凡列宽 < 30.8px（即 `0.65w < 20` 触发下限）必然违反该判据；本图 15/25 列触发。
- 严重度：**高**

---

## D-04 默认数据区不裁掉 y 轴文字区与聚类树：30 列里 5 列是假列，末列还越界 43px

- 现象：`suggest_data_region()` 与 `load_image` 的 `suggested_roi` 都返回整幅图 `{xMin:0, xMax:1177, yMin:1, yMax:579}`，`detect_columns()` 据此给出 **30 列**，而图里只有 **25 个属种面板**（`[76,1053)`）+ 一个聚类树 `[1060,1176)`。多出的 5 列：`col01 [47,76)`（idx0）宽 29（内容全是 y 轴刻度文字 `1860/1880…` 与轴中线 x=68，掩膜 ink 1160px 无一来自数据填充）、`col27 [1096,1114)`、`col28 [1114,1138)`、`col29 [1138,1151)`、`col30 [1151,1177)`（聚类树被切 4 段）。另有 `col26 [977,1096)`（idx25）宽 119，把真面板 `[977,1053)`（宽 76）与 43px 留白+树线吞在一起（**右端越界 +43px**）。把 `data_xlim` 收到 `[70,1055]` 后列数恰为 25，全部边界误差 ≤1px。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
from straditize_core.session import StraditizeSession
p="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png"
s=StraditizeSession(); s.load_image(image_path=p)
print("suggest_data_region",s.suggest_data_region())
cols=s.detect_columns(); print("default ncols",len(cols))
m=s.foreground_mask
for i,c in enumerate(cols):
    st,en=int(round(float(c['start']))),int(round(float(c['end'])))
    print(i,(st,en),"w",en-st,"ink",int(m[80:550,st:en].sum()))
s2=StraditizeSession(); s2.load_image(image_path=p)
print("trimmed ncols",len(s2.detect_columns(data_xlim=[70,1055])))
PY
```
- 影响：导出表里凭空多出 5 个"属种"列（其中 4 列读的是聚类树的枝、1 列读的是轴上数字），末列把 43px 空白并进最后一个属种、使该列宽度从 76 变 119，量程随之算错（真值 20.0，按 119/3.80 会变成 31.3）；`measure_ruler_geometry` 也会对着树线量出 18–28px 的假刻距。
- 判据：默认 ROI 下的列数必须等于图中的数据面板数（本图 25）；且每一列的掩膜 ink 至少有 50% 落在该图的填充色（本图 `(158,202,225)` 或 `(224,224,224)`）上。当前 col01/col27–col30 的填充色占比为 0。
- 严重度：**中**

---

## D-05 列起点对 `data_ylim` 敏感：只改数据区 y 范围，5 列起点右移 1–6px，全表 MAE 从 0.156 涨到 0.464

- 现象：同一张图、`data_xlim` 固定 `[70,1055]`，只把 `data_ylim` 由 `[1,579]`（默认）换成真数据框 `[78,563]`，列数仍 25，但 `idx2` 起点 128→132（+4px，列宽 27）、`idx6` 291→295（+4px）、`idx12` 545→**551（+6px，列宽 27，起点位移占列宽 22.2%）**、`idx16` 689→691（+2px）、`idx18` 761→762（+1px）。用软件自己的列边界做自洽标定后：MAE `0.156`（ylim `[1,579]`）→ `0.310`（`[70,565]`）→ `0.464`（`[78,563]`），单列最差 idx12 = 1.44、idx2 = 1.07、idx6 = 0.99。也就是说"把数据区裁得更贴近真实数据框"这个看似更正确的操作，反而让精度掉 3 倍。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import numpy as np, openpyxl
from straditize_core.session import StraditizeSession
wb=openpyxl.load_workbook("tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx",data_only=True)
ws=wb["RLGH_Diatoms"]; hdr=[ws.cell(1,c).value for c in range(1,ws.max_column+1)]
ages=[ws.cell(r,2).value for r in range(2,ws.max_row+1)]
ks=[(hdr[c-1],[ws.cell(r,c).value for r in range(2,ws.max_row+1)]) for c in range(3,ws.max_column+1)]
ks=[k for k in ks if max(k[1])>=2]; T=np.array([k[1] for k in ks],float)
rows=[int(round(120+(ag-1860)*3.5167)) for ag in ages]; S=3.80
p="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png"
for ylim in ([1,579],[70,565],[78,563]):
    s=StraditizeSession(); s.load_image(image_path=p)
    cols=s.detect_columns(data_xlim=[70,1055],data_ylim=ylim)
    print(ylim,"ncols",len(cols),"starts",[round(float(c['start'])) for c in cols][:20])
    if len(cols)==25:
        errs=[]
        for i,c in enumerate(cols):
            L,R=float(c['start']),float(c['end'])
            s.calibrate_column_xticks(i,[{"px":L,"value":0.0},{"px":R,"value":(R-L)/S}])
            d=s.digitize(i); pt={int(q["row"]):float(q["x"]) for q in d["points"]}
            v=np.array([(pt.get(r,L)-L)/S for r in rows]); errs.extend(np.abs(v-T[i]).tolist())
        print("   self-consistent MAE",round(float(np.mean(errs)),3))
PY
```
- 影响：列起点就是"0 值原点"，起点右移 6px 意味着该列全部读数整体抬高 6/3.80 = **1.58 个百分点**；对量程只有 6.84、真值 max 2.21 的 `Eunotia vanheurckii var. intermedia`（idx12），这已达全量程的 23%、真值最大值的 71%。同一张图、换一个看起来更合理的 ROI 就换一套数字，结果不可复现。
- 判据：对同一张图，`data_ylim` 在数据框内外 3 种取值下，任一列的起点像素差必须 ≤1px（面板左轴是固定的物理结构，不该随 ROI 移动）。当前实测最大 **6px**。
- 严重度：**高**（读数随非物量参数漂移，且没有物理依据）

---

## D-06 刻度尺几何检测在 19/30 列返回 0 格，`median_spacing_px` 33.0 与真实 38px 不符

- 现象：`measure_ruler_geometry()` 返回 30 条 `per_column`，其中只有 **11 条**有 `axis_row`（全部 row=566，正确），另外 19 条 `axis_row=None / n_cells=0`；`median_spacing_px = 33.0`、`all_regular = False`、`n_cells ∈ {0,1,2,4}`。图为 10 个带印刷数字的面板实测刻距 **38–39px**（10 单位）。同一接口在 `Pollen_riojaPlotTestData.png` 上是 **21/21 列测出、median 12.5px**。单列直调 `detect_ruler`：[371,455) → 轴行 566 / 2 格 / 22.5px（真 38px）；[977,1053) → 1 格 / 38.0px（真 2 格）；[76,102) → `axis_row=None`。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
from straditize_core.session import StraditizeSession
s=StraditizeSession(); s.load_image(image_path="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png")
s.detect_columns()
rg=s.measure_ruler_geometry()
pc=rg["per_column"]
print("median_spacing_px",rg["median_spacing_px"],"all_regular",rg["all_regular"])
print("with axis_row:",sum(1 for c in pc if c.get("axis_row") is not None),"/",len(pc))
for c in pc:
    if c.get("axis_row") is not None: print("  ",c["col_index"],c["column_width"],c["n_cells"],c["spacing_px"],c["regular"])
PY
```
- 影响：这一步本应给用户"哪些列没有印刷数字、哪些列刻距异常"的提示；现在 19 列直接空返回、全局刻距 33.0（真 38，差 −13%），用户照此标定会把量程算错约 13%。同时它污染了"刻距是否规则"的全局判断（`all_regular=False` 里有一部分来自聚类树假刻线）。
- 判据：对每个真面板，`spacing_px` 与"带印刷数字面板实测刻距 38px"的相对差 ≤5%，且 `n_cells` 等于该面板轴上可见刻线数（P09 = 2 格、P24 = 2 格，其余带标签面板 = 1 格；无标签面板允许 0 格但 `axis_row` 仍应非空）。当前 11 条非空里有 4 条间距错误（22.5 / 28.0 / 19.0 / 18.0）。
- 严重度：**中**

---

## D-07 25 个面板里 15 个没有印刷横轴，量程无法从图上直读（结构信息缺口）

- 现象：只有 **10 个**面板底部有印刷数字（`10` 或 `10/20`），每个数字都落在左轴右侧 38–39px；其余 **15 个 26–27px 窄面板底部只有 0 位置一根短齿**、没有任何数字（`detect_ruler(76,102)` → `axis_row=None`；目视放大确认）。这 15 列的 `axis_max`（6.84–7.11）只能靠"全图共用 3.80 px/单位"这一跨列关系推出，图上无任何单列信息可读。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import numpy as np
from PIL import Image
a=np.asarray(Image.open("tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png").convert("RGB")).astype(int)
m=a.mean(axis=2); sub=m[568:584,:]<150; col=sub.sum(axis=0)
g=[]
for x in np.where(col>0)[0]:
    if g and x-g[-1][-1]<=1: g[-1].append(x)
    else: g.append([x])
print("text glyph groups (>1px 宽，即可读数字):",[(k[0],k[-1]) for k in g if len(k)>1])
print("单像素组（=轴齿）:",[k[0] for k in g if len(k)==1])
PY
```
- 影响：把该图当"每列都有独立量程"的常规 rioja 图处理，会让 15 列拿不到量程；而跨列外推（用共享 px/单位）在别的图上正是被明令禁止的做法（`ruler.py` 里 13 格≠12.5px 的反例，外推误差 −84%～+151%）。硅藻图恰好是"共享 px/单位"成立的反例，但软件无从判断——这条规则成立与否必须由外部真值确认。
- 判据：若图存在 ≥2 个带印刷数字的面板，则它们的刻距 px/单位相对差 ≤5%（本图 10 个面板实测 3.80–3.90，成立）；此时对无数字列使用共享 px/单位，其读数与该列真值的 MAE 应 ≤0.5 个百分点（本图 15 个无数字列实测 0.08–0.37，成立）。若该先验不成立，必须先报"量程未知"而不是外推。
- 严重度：**中**（不是软件缺陷本身，但它决定 D-02/D-03 的修法方向：此处不允许按列宽猜量程，也不允许默默外推，必须二选一并显式标注）

---

## D-08 `reader_type="line"` 在填充型剖面上读数恰好是真值的一半

- 现象：对同一列同一标定，`area` 给 14.21 / 16.58 / 6.32，`line` 给 7.11 / 8.16 / 3.16（P03/P09/P22），比值精确等于 0.5。原因是 `line` 取该行前景像素索引的**均值**，而填充剖面从轴一直填到数值处，均值正好是中点。`bars` 与 `area` 结果完全一致。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import numpy as np, openpyxl
from straditize_core.session import StraditizeSession
ws=openpyxl.load_workbook("tests/data/figures/benchmark_types/riojaPlotTestData_Pollen_and_Diatom.xlsx",data_only=True)["RLGH_Diatoms"]
ages=[ws.cell(r,2).value for r in range(2,ws.max_row+1)]
rows=[int(round(120+(ag-1860)*3.5167)) for ag in ages]
te=[76,102,128,155,220,265,292,318,344,371,455,519,546,572,637,663,689,716,761,788,833,860,905,951,977,1053]; S=3.80
s=StraditizeSession(); s.load_image(image_path="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png")
s.detect_columns(data_xlim=[70,1055])
for i in (3,9,22):
    L,R=te[i],te[i+1]
    s.calibrate_column_xticks(i,[{"px":L,"value":0.0},{"px":R,"value":(R-L)/S}])
    for rt in ("area","line","bars"):
        d=s.digitize(i,reader_type=rt); pt={int(q["row"]):float(q["x"]) for q in d["points"]}
        v=np.array([(pt.get(r,L)-L)/S for r in rows]); print(i,rt,round(float(v.max()),2))
PY
```
- 影响：用户在"曲线/填充"两种读数模式之间切换时，整表数值差 2 倍而界面不报任何异常；对于填充剖面（本类图正是填充剖面），选 `line` 输出的丰度全部是真实值的一半。
- 判据：对填充剖面，`line` 与 `area` 在同一列的读数比必须落在 0.9–1.1（若 `line` 语义定义为"曲线中心"，则必须在 UI 与导出中标注为"半值，仅用于线图"）。当前实测恒为 **0.500**。
- 严重度：**中**

---

## D-09 浅灰 (224,224,224) 序列被前景阈值整条判为背景（本图无害，同类图致命）

- 现象：本图每个属种面板内其实有两条填充序列：浅蓝 `(158,202,225)` 与浅灰 `(224,224,224)`。前景掩膜对浅蓝像素 **134041/134041 全部收录**，对浅灰 **0/114289 全部排除**。本图的数据序列是浅蓝（峰值 ÷3.80 与 Excel max 吻合到 0.2 以内），所以读数没被污染；但只要某张图的**数据**序列用同档次浅灰，整列会读成 0。项目里已有同类先例（`Caryophyllaceae` 灰填充 182 被 Otsu 阈值 138 切掉，覆盖率 1.4%）。
- 复现：
```bash
cd "E:/software_dev/straditize" && .pixi/envs/default/python.exe - <<'PY'
import numpy as np
from straditize_core.session import StraditizeSession
s=StraditizeSession(); s.load_image(image_path="tests/data/figures/benchmark_types/Diatom_riojaPlotTestData.png")
s.detect_columns(data_xlim=[70,1055])
a=np.asarray(s.image.convert("RGB")).astype(int); m=s.foreground_mask
blue=(np.abs(a[:,:,0]-158)<12)&(np.abs(a[:,:,1]-202)<12)&(np.abs(a[:,:,2]-225)<12)
gray=(np.abs(a[:,:,0]-224)<6)&(np.abs(a[:,:,1]-224)<6)&(np.abs(a[:,:,2]-224)<6)
print("blue in mask",int(m[blue].sum()),"/",int(blue.sum()))
print("gray224 in mask",int(m[gray].sum()),"/",int(gray.sum()))
PY
```
- 影响：多序列面板中，非数据序列若颜色更浅会被静默丢弃（无害），数据序列若更浅会被静默读成 0（致命），两者在现有实现里无法区分且都不报错。
- 判据：对已知含两条填充序列的面板，前景掩膜必须覆盖**两条**序列各 ≥95% 的像素（当前浅灰覆盖 0%）；或显式报"检测到 N 条填充序列，请指定哪条是数据"，不得静默只取一条。
- 严重度：**中**（本图未致错，属潜伏缺陷；与前例合并即"灰度填充"这一类）
