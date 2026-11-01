# Pollen benchmark 实测：三张画法图 vs 冻结真值

**结论先行**（数字均为实测，命令见 §2）：

| 图 | 分列数 | 1:1 对齐 20 列 | 全表 MAE（area 读取器） | 最坏一列 |
|:---|:---:|:---:|:---:|:---|
| `Pollen_riojaPlotTestData.png`（面积填充） | 21 | 是，边界偏差 ≤2px | **0.835** | Artemisia 1.71 |
| `Pollen_BarStyle_riojaPlotTestData.png`（柱状） | 21 | 是，边界偏差 ≤2px | **1.312** | Betula 3.86（单点最大 61.56） |
| `Pollen_CruveStyle_riojaPlotTestData.png`（曲线） | 21 | 是，但 3 个面板吞进邻列 | **6.192** | Gramineae 34.71 / Empetrum 34.05 |

三张图分列数都正确（20 属种 + 1 合成列，合成列 929–1055 不属于真值）。面积图已接近可用（0.835 个百分点），柱状图可接受（1.312），**曲线图不可用**（6.192），且曲线图的误差 **69%** 来自分列边界（见 §6 分解）。

六条已确认缺陷见 `bench-issues/bench-pollen.md`：高危 4 条（曲线吞邻列、读取器锁死自身轴线、自动 ROI 砍顶、`bar` 读取器未实现），中危 2 条（未标定默认量程盲猜、分列边界随画法/ROI 漂移）。

---

## 1. 真值锚定

- 真值：`.scratch/bench/abernethy_golden.json`（49 层 × 20 属种，20 个 max≥2 的列，`axis_max = ceil(max/20)*20`）。本文件不改动它。
- **面板边界（未用真值推，独立从像素测）**：在 y∈[100,560] 内找"近乎贯穿全高的竖线"，得 21 条面板左轴：

  ```
  112 213 332 345 359 378 423 474 525 544 601 652 691 704 717 812 825 839 896 909 929
  ```

  三张图此列**完全相同**（同一份排版）。据此面板宽 `W_i = spine[i+1] - spine[i]`，共 20 个数据面板 + 合成列 929–1055。
- **量程自洽性交叉验证**：各面板内彩色填充的最大宽度 `fillmax` 换算 `fillmax/W × axis_max`，20 列全部落在 18.5–20（axis 20）、36–40（axis 40）、80、100 —— 与 golden 的 `axis_max` 逐一吻合。这是 `axis_max` 映射的独立佐证，不是循环论证。
- **y→depth 映射**：本图 y 轴**不是**线性深度。左侧深度刻度（300…540，每 20cm）的行位置为

  ```
  area : 93 124 155 189 225 255 285 319 360 408 458 503 544   （间距 31,31,34,36,30,30,34,41,48,50,45,41）
  bar/curve : 82 114 145 181 217 248 279 313 355 404 456 502 543
  ```

  间距从 31px 涨到 50px，说明图上的 y 线性于**年龄**，深度标签按各自年龄落位。故 depth→row 用这 13 个印刷刻度做分段线性插值（两端线性外推）。
  敏感度实测（面积图 area 读取器）：±1px 行位移使 MAE 从 0.488 变为 0.613(−1px)/0.523(+1px)，−2px 时 0.637；0 位移处为最小值 → 映射本身不是精度瓶颈，其贡献上限约 +0.13 MAE。

## 2. 复现

```bash
cd "E:/software_dev/straditize"
.pixi/envs/default/python.exe - <<'PY'
"""bench-pollen 主测：三张 pollen 图 × 20 列 × 读取器，对齐 golden。"""
import json, numpy as np
from straditize_core.session import StraditizeSession
from straditize_core.session_parts.xscale import resolve_column_scale

GOLD=".scratch/bench/abernethy_golden.json"; D="tests/data/figures/benchmark_types/"
SPINES=[112,213,332,345,359,378,423,474,525,544,601,652,691,704,717,812,825,839,896,909,929]
DS=np.arange(300,541,20,dtype=float)
CFG={"area":("Pollen_riojaPlotTestData.png",[93,124,155,189,225,255,285,319,360,408,458,503,544]),
     "bar":("Pollen_BarStyle_riojaPlotTestData.png",[82,114,145,181,217,248,279,313,355,404,456,502,543]),
     "curve":("Pollen_CruveStyle_riojaPlotTestData.png",[82,114,145,181,217,248,279,313,355,404,456,502,543])}
g=json.load(open(GOLD)); taxa=g["taxa"]; depths=np.array(g["depth_cm"],float)
def mk(rows):
    r=np.array(rows,float)
    def f(d):
        if d<=DS[0]:  return float(r[0]+(d-DS[0])*(r[1]-r[0])/(DS[1]-DS[0]))
        if d>=DS[-1]: return float(r[-1]+(d-DS[-1])*(r[-1]-r[-2])/(DS[-1]-DS[-2]))
        return float(np.interp(d,DS,r))
    return f
for style,(img,rows) in CFG.items():
    rf=[int(round(mk(rows)(d))) for d in depths]
    s=StraditizeSession(); s.load_image(image_path=D+img)
    s.detect_columns(); print(f"{style:6s} 自动 ROI={s.data_ylim} 分列数={len(s.columns)}")
    s.roi_update(y0=float(min(rows)),y1=563.0); cols=s.detect_columns()
    for reader in ("area","bar","bars","line"):
        E=[]
        for i in range(20):
            ci=min(range(len(cols)), key=lambda k: abs(cols[k]["start"]-SPINES[i]))
            s.calibrate_column_xticks(ci, ticks=[{"px":SPINES[i],"value":0.0},
                                                {"px":SPINES[i+1],"value":float(taxa[i]["axis_max"])}])
            sc=resolve_column_scale(s,s.columns[ci],ci)
            pts={int(p["row"]):float(p["x"]) for p in s.digitize(ci,reader)["points"]}
            E+=[abs(sc.px_to_value(pts[y])-t) for d,y,t in zip(depths,rf,taxa[i]["values"])
                if t is not None and y in pts]
        print(f"       reader={reader:5s} 全表 MAE={np.mean(E):.3f} n={len(E)}")
PY
```

实测输出（多次运行逐位一致）：

```
area   自动 ROI=[197.0, 568.0] 分列数=21
       reader=area  全表 MAE=0.835  n=960
       reader=bar   全表 MAE=2.807  n=960
       reader=bars  全表 MAE=0.835  n=960
       reader=line  全表 MAE=2.807  n=960
bar    自动 ROI=[188.0, 568.0] 分列数=21
       reader=area  全表 MAE=1.312  n=960
       reader=bar   全表 MAE=3.087  n=960
       reader=bars  全表 MAE=1.312  n=960
       reader=line  全表 MAE=3.087  n=960
curve  自动 ROI=[188.0, 568.0] 分列数=21
       reader=area  全表 MAE=6.192  n=960
       reader=bar   全表 MAE=3.718  n=960
       reader=bars  全表 MAE=6.247  n=960
       reader=line  全表 MAE=3.718  n=960
```

口径说明（必须先看清楚再看数字）：

1. **`roi_update` 是本测的人为修正**。`load_image` 自动建议的 ROI 上边界是 197/188，会砍掉图顶 104px；为分离"读取器精度"与"ROI 缺陷"，测量前把 ROI 改成实测数据区（93/82 … 563）。ROI 缺陷本身单列在 P-03。
2. **量程端点用实测面板边界**（`spine[i] → 0`、`spine[i+1] → axis_max`），即任务书定义的「列有效宽度 ÷ axis_max」。这同时是产品的 `x_ticks` 标定路径（`calibrate_column_xticks` + `resolve_column_scale`），换算用的是产品自己的 `px_to_value`，不是自写公式。
3. 每列 48 个可对齐层 × 20 列 = 960 个点（49 层里 depth 550 落在图外 1 行，实际每列 48 点）。

## 3. 分列

| 图 | ncols | 与 20 真值列 1:1 | 起点偏差 Δ0（20 列） | 终点偏差 Δ1 |
|:---|:---:|:---:|:---|:---|
| area | 21 | 是 | `0,0,0,+1,0,+2,0,0,0,+1,+2,+1,+1,0,+2,+1,+1,0,0,+1` | 全 0 |
| bar | 21 | 是 | `+1` ×18，Corylus/Artemisia `+2` | 全 0 |
| curve | 21 | 是 | 多数 `0/+1`，但 Gramineae `+8`、Cyperaceae `+6`、Rumex `+4` | Empetrum `+8`、Gramineae `+6`、Ononis `+4` |

- **任务书示例里的「Ulmus 被拆成两个 13px 碎片」没有复现**。332–345 与 346–359 是两个**真实面板**：两者各自的填充最大宽度均为 12–14px，换算 `fillmax/W×20` 分别得 18.5 与 20.0，符合 axis_max=20；若并成一个 27px 面板则填充只能有 3.6/4.6px。Ulmus 本就是 13px 宽的窄面板（0.65 px/单位）。
- 真正的问题是 **curve 图丢 3 条面板左轴**：601 / 652 / 839 被 609 / 658 / 843 取代。机制已定位（见 P-01）：`detect_column_starts` 的 `min_col_width_ratio=0.01`（943px × 0.01 = 9.43px）会把"与下一候选间距 < 9.43px"的候选丢弃，而这三个面板的轴线右侧 4–8px 处恰好各出现一个候选（曲线首墨），于是保留的是后者。
  实测：`min_col_width_ratio=0.005` 时 601/652 回来（23 列），`0.002` 时 839 也回来（24 列）——但都会同时引入 609/658/843 这些伪候选，所以修法不是降阈值，而是「相邻候选保留靠前者」。
- 分列数对参数**不敏感**：阈值 0.05/0.10/0.15/0.20 × min_col_width_ratio 0.005/0.010 共 8 组合，面积图全部得到 21 列、宽度序列完全相同；只有把 min_col_width_ratio 提到 0.02 才塌成 14 列（把 13px 面板并掉）。所以"同图数出不同列数"没有发生，发生的是"边界漂移"（P-06）。

## 4. 量程

`W/ax` = 真值 px/单位（= 列有效宽度 ÷ axis_max）。`def` = 软件**未标定时**自带的 px/单位 = `max(20, min(0.65·W, 80)) / 20`。`dev` = `def / (W/ax) − 1`。

| # | 属种 | W | axis_max | W/ax | def | dev |
|---:|---|---:|---:|---:|---:|---:|
| 0 | Betula | 101 | 80 | 1.26 | 3.28 | **+160%** |
| 1 | Pinus sylvestris | 119 | 100 | 1.19 | 3.87 | **+225%** |
| 2 | Ulmus | 13 | 20 | 0.65 | 1.00 | +54% |
| 3 | Quercus | 14 | 20 | 0.70 | 1.00 | +43% |
| 4 | Alnus glutinosa | 19 | 20 | 0.95 | 1.00 | +5% |
| 5 | Corylus-Myrica | 45 | 40 | 1.12 | 1.46 | +30% |
| 6 | Salix | 51 | 40 | 1.27 | 1.66 | +30% |
| 7 | Juniperus communis | 51 | 40 | 1.27 | 1.66 | +30% |
| 8 | Calluna vulgaris | 19 | 20 | 0.95 | 1.00 | +5% |
| 9 | Empetrum | 57 | 40 | 1.43 | 1.85 | +30% |
| 10 | Gramineae | 51 | 40 | 1.27 | 1.66 | +30% |
| 11 | Cyperaceae | 39 | 40 | 0.97 | 1.27 | +30% |
| 12 | Solidago-type | 13 | 20 | 0.65 | 1.00 | +54% |
| 13 | Compositae | 13 | 20 | 0.65 | 1.00 | +54% |
| 14 | Artemisia | 95 | 80 | 1.19 | 3.09 | **+160%** |
| 15 | Astragalus alpinus | 13 | 20 | 0.65 | 1.00 | +54% |
| 16 | Ononis-type | 14 | 20 | 0.70 | 1.00 | +43% |
| 17 | Rumex acetosa-type | 57 | 40 | 1.43 | 1.85 | +30% |
| 18 | Saxifraga spp1 | 13 | 20 | 0.65 | 1.00 | +54% |
| 19 | Veronica | 20 | 20 | 1.00 | 1.00 | 0% |

**偏差 >5% 的列：17/20**（仅 Alnus +5%、Calluna +5%、Veronica 0% 在 5% 以内）。偏差一律为正，即未标定时数值系统性偏小。细则见 P-05。

## 5. 曲线精度（逐列 MAE，truth-scale 标定，检测到的列边界）

`A`=area 读取器，`B`=bars，`L`=line（`bar` 与 `L` 逐点相同，见 P-04）。

### 5.1 面积填充图

| 属种 | MAE_A | MAE_B | MAE_L | bias_A | 单点最大 |
|---|---:|---:|---:|---:|---:|
| Betula | 1.18 | 1.18 | 16.83 | −1.17 | 4.62 |
| Pinus sylvestris | 1.29 | 1.29 | 10.84 | +0.33 | 4.75 |
| Ulmus | 0.29 | 0.29 | 0.31 | −0.02 | 1.28 |
| Quercus | 1.11 | 1.11 | 0.93 | +1.11 | 2.27 |
| Alnus glutinosa | 0.15 | 0.15 | 0.19 | −0.12 | 0.95 |
| Corylus-Myrica | 1.04 | 1.04 | 3.06 | +1.03 | 3.23 |
| Salix | 0.55 | 0.55 | 2.11 | −0.55 | 1.96 |
| Juniperus communis | 0.40 | 0.40 | 1.92 | −0.40 | 2.04 |
| Calluna vulgaris | 0.42 | 0.42 | 0.87 | −0.32 | 1.35 |
| Empetrum | 0.91 | 0.91 | 2.40 | −0.47 | 5.37 |
| Gramineae | 0.62 | 0.62 | 3.05 | −0.19 | 2.91 |
| Cyperaceae | 0.84 | 0.84 | 1.26 | +0.80 | 4.24 |
| Solidago-type | 1.42 | 1.42 | 1.42 | +1.40 | 1.54 |
| Compositae | 0.06 | 0.06 | 0.04 | −0.01 | 1.18 |
| Artemisia | 1.71 | 1.71 | 4.80 | +1.70 | 4.72 |
| Astragalus alpinus | 1.49 | 1.49 | 1.47 | +1.49 | 1.54 |
| Ononis-type | 1.38 | 1.38 | 1.32 | +1.38 | 1.74 |
| Rumex acetosa-type | 0.75 | 0.75 | 2.26 | −0.74 | 5.12 |
| Saxifraga spp1 | 0.08 | 0.08 | 0.06 | −0.03 | 1.18 |
| Veronica | 1.01 | 1.01 | 1.02 | +1.01 | 1.38 |
| **全表** | **0.835** | **0.835** | **2.807** | | |

窄列（13–14px、0.65–0.70 px/单位）的 MAE 恒在 1.0–1.5：那里 **1px = 1.54 个百分点**，是分辨率地板，不是算法缺陷。bias 与 MAE 相等的那几列（Solidago 1.42/1.42、Astragalus 1.49/1.49、Ononis 1.38/1.38）就是"整整偏 1 个像素"，对应检测起点比轴线右移 1px（见 P-06）。

### 5.2 柱状图

| 属种 | MAE_A | MAE_L | 属种 | MAE_A | MAE_L |
|---|---:|---:|---|---:|---:|
| Betula | 3.86 | 17.77 | Cyperaceae | 1.17 | 1.28 |
| Pinus sylvestris | 1.13 | 10.42 | Solidago-type | 1.43 | 1.42 |
| Ulmus | 1.13 | 1.04 | Compositae | 1.50 | 1.48 |
| Quercus | 1.21 | 0.99 | Artemisia | 1.63 | 4.77 |
| Alnus glutinosa | 0.91 | 0.93 | Astragalus alpinus | 1.49 | 1.47 |
| Corylus-Myrica | 1.94 | 3.40 | Ononis-type | 1.38 | 1.32 |
| Salix | 0.56 | 1.81 | Rumex acetosa-type | 1.08 | 2.44 |
| Juniperus communis | 0.89 | 2.14 | Saxifraga spp1 | 1.48 | 1.46 |
| Calluna vulgaris | 0.63 | 0.74 | Veronica | 1.01 | 1.02 |
| Empetrum | 1.10 | 2.49 | **全表** | **1.312** | **3.087** |

`L`/`bar` 在柱状图上约为真值的一半（Betula@430：truth 73.91，area 读数 72.08，bar 读数 36.44），因为均值型读取器量的是柱体中心。

### 5.3 曲线图

| 属种 | MAE_A | MAE_L | 属种 | MAE_A | MAE_L |
|---|---:|---:|---|---:|---:|
| Betula | 0.63 | 0.65 | Cyperaceae | 4.67 | 4.19 |
| Pinus sylvestris | 1.87 | 1.06 | Solidago-type | 1.53 | 0.70 |
| Ulmus | 2.22 | 0.82 | Compositae | 1.69 | 0.81 |
| Quercus | 2.92 | 1.15 | Artemisia | 2.16 | 3.00 |
| Alnus glutinosa | 1.09 | 0.45 | Astragalus alpinus | 1.68 | 0.80 |
| Corylus-Myrica | 2.27 | 1.47 | Ononis-type | 21.09 | 8.73 |
| Salix | 0.98 | 0.35 | Rumex acetosa-type | 2.08 | 2.29 |
| Juniperus communis | 3.27 | 1.00 | Saxifraga spp1 | 1.67 | 0.79 |
| Calluna vulgaris | 1.50 | 0.30 | Veronica | 1.76 | 0.83 |
| Empetrum | **34.05** | 18.49 | **全表** | **6.192** | **3.718** |
| Gramineae | **34.71** | 26.48 | | | |

## 6. 误差分解：边界 vs 读取器（控制组）

把列边界强制设成实测面板轴线（`spine[i] … spine[i+1]`）后重测，得"纯读取器"误差：

| 图 | 读取器 MAE（真边界） | 读取器 MAE（检测边界） | 边界贡献 |
|:---|---:|---:|---:|
| area（area 读取器） | 0.488 | 0.835 | 0.347 |
| bar（area 读取器） | 0.731 | 1.312 | 0.581 |
| curve（area 读取器） | 1.942 | 6.192 | **4.250** |
| curve（line 读取器） | 1.495 | 3.718 | 2.223 |

三个结论：
1. 面积图/柱状图的误差**主要不是边界**（0.35/0.58），已经在可用区间。
2. 曲线图的误差 **69% 来自分列边界**（4.25 / 6.19）。边界一改对，MAE 从 6.19 掉到 1.94。
3. 曲线图剩下的 1.94 仍有独立缺陷：读取器把面板自身 Y 轴线当作数据（P-02）。以 Empetrum 为例，即使边界正确，48 层里仍有 **13 层读数恰为 0**，这 13 层占该列全部绝对误差的 **82%**（全列 MAE 4.42 中约 3.6 来自这里）。

## 7. 画法差异（默认取数模式该选哪个）

| 图 | area | bars | line/bar | 最优 |
|:---|---:|---:|---:|---|
| 面积填充 | **0.835** | 0.835 | 2.807 | area |
| 柱状 | **1.312** | 1.312 | 3.087 | area |
| 曲线 | 6.192 | 6.247 | **3.718** | line |

- **`area` 在 2/3 的画法上都是最优或并列最优**，作为默认值是对的。
- 但 `area` 在曲线图上比 `line` 差 66%（6.19 vs 3.72）。曲线图里"面积填充"不存在，own-component 逻辑反而去抓轴线。
- 三张图**同一列同一读取器的 MAE 差 5–30 倍**（Betula：1.18 / 3.86 / 0.63），说明"画法"这个变量对精度的影响大于"读取器"这个变量。**用一套读取器打通三种画法不可行**，必须按画法选读取器，或让读取器自己判画法。
- 补充：`area` 与 `bars` 在三张图上几乎恒等（面积图逐点完全相等），因为填充轮廓的最右像素正是行内最大 x。所以现在"两个读取器名字"实际只有一个行为。

## 8. 未判为缺陷的现象（避免误导后人）

- **分列数稳定**：三张图、8 组参数组合全部 21 列；只有 min_col_width_ratio ≥0.02 才塌成 14 列。没有"同图数出不同列数"。
- **任务书示例的 Ulmus 拆碎未复现**（见 §3）。Ulmus 13px、Quercus 14px 是两个真实面板。
- **13px 窄列的 MAE 1.0–1.5 不是缺陷**：0.65 px/单位下 1px = 1.54 个百分点，已到量化地板。
- **三张图排版完全相同**（21 条轴线逐一相同），所以跨画法比较是干净的，不存在"换了图版"的混淆。

## 9. 局限

- **被测代码不是干净 HEAD**：本仓库当时有多会话并发，工作树含他人未提交改动。测量时的代码指纹（sha256 前 12 位，`git log -1` = `03ee943`）：

  ```
  8d81957c5019 columns.py        8818b522e3e4 digitize.py
  bbcd423a7b3e session_parts/core.py    fb45d831366e session_parts/digitize.py
  85aba97f8535 session_parts/xscale.py  26c46ef4169e session_parts/xticks.py
  d40b17ab7ad2 session_parts/roi.py
  ```

  上述文件若在测量后被他人改动，本文数字需重跑 §2 才对得上；三次独立运行（跨约 15 分钟）结果逐位一致，说明测量窗口内没有漂移。
- y→depth 映射依赖 13 个印刷深度刻度分段线性插值。该图 y 轴线性于年龄而非深度，刻度间距 31–50px 不均匀；映射的残余误差已量化为 ≤+0.13 MAE（§1），但**不能**排除个别层位（如 357–375 的 2–3cm 密集采样段）行归属偏 1–2px。
- 真值本身来自 Excel（`riojaPlotTestData_Pollen_and_Diatom.xlsx` 的 `Abernethy_Pollen`），未复核绘图软件是否对数值做过取整；`axis_max = ceil(max/20)*20` 已用填充宽度独立反验（§1），但单列内部数值的取整未验。
- 合成列（Trees/Shrubs/Herbs，929–1055）不在真值内，未做精度评估。
- 全部测量为单进程 python 直接调用 `StraditizeSession`，未经过 RPC/前端；`csv` 导出路径未单独验证（使用的是与导出同一个 `resolve_column_scale.px_to_value`）。
