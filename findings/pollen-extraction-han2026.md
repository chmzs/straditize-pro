# Han et al. (2026) Fig. 3 花粉图提取记录

> 目标：`zotero://select/library/items/9WCEPLZJ`
> Han Y., Liu L., Sun Z., Hou J., Cao X. (2026). *A synthesis of pollen sequences from the
> central-western Tibetan Plateau reveals regional aridification since the Middle to Late Holocene.*
> **Global and Planetary Change 256: 105195.** DOI: `10.1016/j.gloplacha.2025.105195`

---

## 1. 结论先行（含一条必须承认的失败）

| 环节 | 状态 |
| :--- | :--- |
| 论文定位与 PDF 获取 | ✅ 完成（`I:/Zotero/storage/HV4FXL63/`，13 页，5.7 MB） |
| 花粉图定位与无损提取 | ✅ 完成（Fig. 3，内嵌位图 2132×928，JPEG 原图取出） |
| 年代-深度框架 | ✅ 完成（787 cm / 18 cal ka BP / 157 个 5 cm 层位；见 §3） |
| 八步流程走通（软件本体） | ✅ 完成（15 列、7185 个数字化点、479 个有效层位、CSV 导出） |
| **逐列百分比的可信标定** | ❌ **只做到 5/15 列**（见 §5） |

**必须直说**：这不是"提取失败"，而是"提取到了曲线几何，但其中 **10 列的面积读数无法从图版直读**"。
继续硬凑数字只会产出一份看起来完整、实则读数来源不可追溯的 CSV —— 那正是本仓库
`docs/ARCHITECTURE.md` §2 明令禁止的"返回替代数据"。所以我停在这里，把边界写清。

---

## 2. 论文里的三样东西在哪

| 内容 | 位置 | 说明 |
| :--- | :--- | :--- |
| **花粉图** | **Fig. 3**（PDF p5） | Ngamring Co 花粉浓度与常见属种百分比；**内嵌位图 2132×928**，可无损取出 |
| **年代-深度框架** | Fig. 3 左侧双轴 + §3.2 正文 | 787 cm 岩心，底界 **~18 cal ka BP**，沉积速率基本稳定 |
| 分区与年代 | Fig. 3 右侧 Zone 列 + Fig. 7 | CONISS 五区带：I–V |
| 正文 | p1–p13 | 已全文落盘 `fulltext.txt`（75,188 字符） |

**图注原文（Fig. 3）**：
> Pollen concentration and percentages of common taxa for Ngamring Co.
> **Shadings are five-fold exaggerated.** A constrained incremental sum-of-squares (CONISS)
> identified five pollen zones.

最后这句是本次提取最关键的一条约束 —— 它意味着**每列都有两层**：深色实心 = 真实百分比，
浅色阴影 = 5 倍夸张包络。把阴影当成读数会把数值放大 5 倍（我在调试中确实踩了这个坑）。

---

## 3. 年代-深度框架（已确认，可直接用于标定）

```
深度轴：0 cm  @  y=232 px（顶线）
        787 cm @  y=862 px（底线）
年龄轴：0      @  y=232 px
        18078 cal BP @ y=862 px
取样：每 5 cm 一个样品，共 159 个（正文 §3.2）
```

**正文原句（可回溯）**：
> "The age-depth model returns a basal age of ~18 cal ka BP, and the depositional rate is
> basically stable (Sun et al., 2022a). … A freeze-dried sample (3–5 g) was taken every 5 cm
> for pollen analysis, giving a total of 159 samples."

两点式标定（软件 `calibrate_axes`）：
- 深度：`(232px, 0 cm)` → `(862px, 787 cm)` → **1.2492 cm/px**
- 年龄：`(232px, 0 cal BP)` → `(862px, 18078 cal BP)` → **28.70 cal BP/px**

**五区带边界（正文 §3.2 给出，可用于交叉校验）**：

| 带 | 深度 (cm) | 年龄 (cal ka BP) |
| :--- | :--- | :--- |
| I | 787–681 | 18–14.6 |
| II | 681–605 | 14.6–10.28 |
| III | 605–405 | 10.28–3.45 |
| IV | 405–55 | 3.45–0.74 |
| V | 55–0 | 0.74–0 |

---

## 4. 花粉图的列几何（逐像素实测）

绘图区：`y ∈ [232, 862]`（顶线/底线），15 个柱状列 + 1 条浓度折线 + 分区/聚类树。

| # | 属种 | 列基线 x | 列宽 px |
| --: | :--- | ---: | ---: |
| 1 | Pinus | 332 | 38 |
| 2 | Abies | 370 | 37 |
| 3 | Picea | 407 | 38 |
| 4 | Betula | 445 | 37 |
| 5 | Quercus(D) | 482 | 39 |
| 6 | Quercus(E) | 521 | 61 |
| 7 | Rosaceae | 582 | 37 |
| 8 | Chenopodiaceae | 619 | 38 |
| 9 | Hippophae | 657 | 47 |
| 10 | Euphorbiaceae | 704 | 220 |
| 11 | Cyperaceae | 924 | 172 |
| 12 | Artemisia | 1096 | 37 |
| 13 | Poaceae | 1133 | 60 |
| 14 | Ranunculaceae | 1193 | 38 |
| 15 | Caryophyllaceae | 1231 | 49 |

> 注：`Poaceae` 在图中出现两次（前列 x=582 区域标签经核对实为 **Rosaceae**）。
> 列名以图版顶部斜排标签逐列裁图核对为准（`labels_grid.png`）。

刻度尺：每列底部有独立刻度尺，**小齿 12.5 px、大齿 25 px**。

---

## 5. 为什么只有 5 列能做可信标定

图版只在 **5 列**的刻度尺下方印了数字：

| 属种 | 印刷数字位置 | 可标定 |
| :--- | :--- | :--- |
| Quercus(E) | `20` @ x=569 | ✅ |
| Euphorbiaceae | `20@742, 40@789, 60@835, 80@883` | ✅ |
| Cyperaceae | `20@954, 40@1001, 60@1047` | ✅ |
| Poaceae | `20` @ x=1181 | ✅ |
| Caryophyllaceae | `20` @ x=1264 | ✅ |

其余 **10 列**（Pinus、Abies、Picea、Betula、Quercus D、Rosaceae、Chenopodiaceae、
Hippophae、Artemisia、Ranunculaceae）**只有一个刻度齿、且不印数字**，从图版上无法确定满量程。

**交叉验证（用论文正文报告的量程反推，证明各列满量程互不相同）**：

```
Artemisia  列宽 37px，正文 max 67.42%  → 若满列宽 = 0.55 px/%
Pinus      列宽 38px，正文 max 40.74%  → 若满列宽 = 0.93 px/%
Cyperaceae 列宽 172px，正文 max 70.07% → 若满列宽 = 2.45 px/%
Poaceae    列宽 60px，正文 max  9.21%  → 若满列宽 = 6.51 px/%
```

`px/%` 相差 **11.8 倍**，说明**每列是独立量程**、不能统一假设。
在缺印刷数字的列上，任何"按列宽等分"或"按比例外推"的做法都是**编造读数**。

**这就是我停下的原因。**

---

## 6. 本次实际产出（软件本体流程，读数来源已标注）

```bash
pixi run python scripts/extract_han2026_fig3.py
```

```
[1/8] 载入 2132x928
[2/8] ROI roi_1: x[324,1280] y[233,861]
[3/8] Y 轴: 232px=0cm → 862px=787cm
[4/8] 清理: 候选 12 条（保持未确认，不改原图墨迹）
[5/8] 分列: 15 列（图版实测边界）
[6/8] 标定: 15 列（ruler 5 / paper 10）
[7/8] 数字化 7185 点；深度网格 158 层（5 cm，同原论文取样）
[8/8] QA: 层位 479 / 空层 1
      导出 output/han2026_ngamring/Han2026_Fig3_pollen.csv
```

产物：
- `Han2026_Fig3_pollen.csv` —— 479 行 × 16 列（深度 + 15 属种）
- `Han2026_Fig3_pollen.project.json` / `.project.tar` —— **软件工程包，可载回继续编辑**
- `fig3_raw.jpeg` —— 图版无损原图（后续可加印刻度数字后重标）

**读数来源标注**（CSV 里未混入，见 `scripts/extract_han2026_fig3.py` 的 `COLUMN_SPECS`）：
- `ruler`（5 列）：满量程取自图上刻度尺 → **可信**
- `paper`（10 列）：满量程取自论文正文报告的最大值 → **仅作量级参考，不可作为精确读数**

---

## 7. 要把这份图做到"可信"，还差什么（下一步的原子动作）

1. **拿到原始数据**（最优）：论文的数据可用性声明 / 补充材料 / 通讯作者。
   这类 Q1 期刊的 Fig. 3 通常有配套表格，能一次解决全部 15 列。
2. **拿到更高分辨率图**：若刻度数字在 600 dpi 原图上可见，则 10 列也能直读。
3. **引 Sun et al. (2022b)**：本文的年龄模型与花粉原始数据来自该文，那篇可能附完整数据表。
4. 若以上都不可得，则只发布 **5 列 ruler 标定的可信结果**，其余 10 列明确标为"不可用"。

---

## 8. 本次暴露的软件能力边界（值得进 issue）

| 现象 | 影响 | 建议 |
| :--- | :--- | :--- |
| `extract_foreground` 用**灰度 Otsu** 阈值 | 淡色填充（如本图 L≈228 的 5× 阴影）被判为背景；**彩色曲线**在灰度化后可能丢失 | 支持按**颜色通道**提取（`light-overlay-white` 已存在但会话层未暴露给 `digitize` 链路） |
| 图注明示"阴影为 5 倍夸张" | 若不识别分层，会把阴影当读数、数值放大 5 倍 | 建议在 Step 4/5 提供"识别夸张层"的显式选项，而非隐含假设 |
| 刻度尺数字靠人读 | 缺数字的列无法标定 | 建议 Step 6 支持"批量从图注/表格导入满量程"（MCP 场景尤其重要，见 `agent-mcp-design.md`） |

---

## 9. 【补充】可信子集：只用印刷数字定线，2 列达标

前面 §5 说明"10 列无数字、无法标定"。这里给出**能标定的部分**的严格做法与结果。

### 9.1 方法（不跨列外推）

对每列**用该列自己的印刷数字**做最小二乘定线 `value = slope·px + intercept`，
外推到"0% 所在 x"与"列末端"，再走软件两点式标定。

只有 2 列有 ≥2 个印刷数字可定线：

| 列 | 印刷数字 | 拟合校验（数字px → 预测值） |
| :--- | :--- | :--- |
| Euphorbiaceae | `20/40/60/80` @ 742/789/835/883 | 20.0 / 40.1 / 59.7 / 80.2 |
| Cyperaceae | `20/40/60` @ 954/1001/1047 | 19.9 / 40.1 / 59.9 |

**拟合校验全部命中**（最大偏差 0.3），说明"等距线性刻度"这一读法是对的。

### 9.2 结果与论文交叉校验

```bash
pixi run python scripts/extract_han2026_trusted.py
```

```
[5] Euphorbiaceae  0% @ x=695.0 → 满量程 97.7%
    Cyperaceae     0% @ x=907.7 → 满量程 81.0%
[6] 958 点 / 158 深度层（5 cm）
[8] 与论文 reported max 交叉校验
    Euphorbiaceae  提取 max= 73.35%  非零 478/479
    Cyperaceae     提取 max= 71.54%  非零 478/479  论文 70.07%  偏差 +2.1%
```

**Cyperaceae 偏差仅 +2.1%** —— 这是本次提取唯一有外部真值可校验的列，
说明"印刷数字定线 + 软件两点式标定 + 面积数字化"这条链**是可靠的**。

产物：`output/han2026_ngamring/Han2026_Fig3_trusted.csv`（479 行 × 3 列：深度 + 2 属种）

### 9.3 为什么只交 2 列而不是 5 列

另 3 列（Quercus E / Poaceae / Caryophyllaceae）**只有一个印刷数字**，
单点只能定截距、定不了斜率 → 满量程仍不可知。用其它列的斜率去补就是跨列外推，
已被实测否决（§5）。故**不产出**。

这正是本项目的原则：**宁可少一列，不可编一列**。

### 9.4 要拿到全部 15 列的正确做法

论文 §Data availability 明写：

> "Pollen record from Ngamring Co can be obtained from the corresponding author
> **Xianyong Cao (xcao@itpcas.ac.cn)**"

原始数据（159 样品 × 全部类群）**未随论文公开**，只能向通讯作者索取。
图版提取的定位是**几何复现 + 量级校验**（本节的 +2.1% 就是校验结果），
不是原始数据的替代品。
