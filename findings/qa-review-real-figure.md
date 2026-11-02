# QA 独立复核报告：真实图版提取链路

> 复核者：`qa-reviewer`（独立于 Lead 的度量实现）
> 复核对象：`docs/findings/defects-from-real-figure.md`、`docs/findings/pollen-extraction-han2026.md`、
> `docs/findings/lead-measurements.md`、`straditize_core/ruler.py`、`straditize_core/image.py`
> 所有脚本：`scripts/qa_review/`（**未复用** `scripts/lead_probe/` 任何实现）

---

## 0. 复核时的代码状态（重要：本轮复核期间产品源码被他人改动 4 次）

复核开始时（2026-10-19 22:02）与结束时（23:18）的哈希不同，`image.py` 在复核期间被
`fix-engineer` 改动 **5 次以上**（`mtime` 观测到 21:59 → 22:52 → 23:00 → 23:04 →
23:17，且期间哈希在 `fdca9fae` 与 `13d143d1` 之间来回跳变）：

| 文件 | 开始时（22:02） | 结束时（23:18） | 复核期间改动 |
| :--- | :--- | :--- | :--- |
| `straditize_core/image.py` | `89f55b294382a817` | `fdca9fae2bf94072` | **≥5 次** |
| `straditize_core/ruler.py` | 新增文件，`1f8a1c4b2c3505bc` | 同（22:11 后未变） | 0 次 |
| `straditize_core/session_parts/core.py` | `efb0eb9a67eb33ea` | `20598edd67fa5149` | 1 次 |

**本报告所有 C4/§5.2 的结论均已在 `image.py @ fdca9fae2bf94072`（23:18 稳定态）
上重跑确认。** 观测到的哈希序列：
`89f55b29` → `003b6d00` → `b7a84695` → `fdca9fae` → `13d143d1` → `fdca9fae`。

**这直接决定了本报告的证据等级**：

- C1 / C2 / C3 / C5 / P9 / P10 只依赖**图版像素**与 `session_parts/core.py:470` 的
  Otsu 路径，这些结论**跨哈希稳定**，可信。
- C4（`split_solid_and_shadow` / `two_layer_split`）依赖 `image.py`，**被改动 4 次**。
  我采取了**每个结论都在当前哈希上重跑一次**的做法；下文 C4 的判定均标注了
  运行时的哈希。凡我未能重跑的，一律标 `UNCERTAIN`。
- 更严重的是：**`image.py` 在复核期间从"完全不可用"变到"部分可用"再到"当前状态"**，
  我最初在 `89f55b29` 上测出的 C4 结论与在 `fdca9fae` 上测出的**不同**。
  这本身是一条工程问题（见 §5.3），不只是"结果漂移"。

**基线**：`git rev-parse HEAD` = `caaac017c7dbcfdc69393c5be0766a5b0aec169d`；
`git status` 显示 `straditize_core/image.py`、`session_parts/core.py`、`ruler.py` 等
均处于**未提交**的修改态。

---

## 1. 四态计数

| 编号 | 命题 | 判定 |
| :--- | :--- | :--- |
| C1 | 软件默认 `extract_foreground()` 的 Otsu 阈值 = 138.0 | **REPRODUCED** |
| C2 | Caryophyllaceae 覆盖率 ≈ 1.4%，其余 14 列 ≥ 92% | **PARTIAL**（见 §3，仅 1.4% 未复现） |
| C3 | 15 列刻距都 ≈ 12.3 px/格 | **NOT_REPRODUCED** |
| C4 | `split_solid_and_shadow()` 的 solid 与 shadow 完全不重叠 | **REPRODUCED**（重叠确实为 0） |
| C5 | `light-overlay-white` 下浅蓝阴影 `(218,226,237)` 被判前景 | **REPRODUCED** |
| P9 | 15 列刻距是否确实都 ≈ 12.3–12.5 px | **NOT_REPRODUCED** |
| P10 | 是否存在"刻距近似但量程差 >50%"的列对 | **REPRODUCED** |
| P11 | `suggest_scales(..., confidence)` 是否真能挡住误用 | **REPRODUCED**（当前实现确实不产出数字） |

**四态合计**：REPRODUCED 4 · NOT_REPRODUCED 2 · PARTIAL 1 · UNCERTAIN 0
（另有 1 条**新发现**，见 §5.2，不属 C1–C5/P9–P11 编号内）

**推翻 Lead 的项**：C3 与 P9（"15 列刻距统一 12.3 px"），以及 C2 的 1.4% 数字。
**确认 Lead 的项**：C1、C4、C5、P10、P11。

---

## 2. C1 — Otsu 阈值 = 138.0 —— REPRODUCED

独立实现（`scripts/qa_review/c1_otsu_threshold.py`，**不使用** `scripts/lead_probe/`）：

```
=== (b) 我自己实现的 Otsu（在 PIL 灰度图上）===
  textbook integer-threshold Otsu : 138.0
  skimage bin-centre equivalent   : 138.5

=== (a) 产品路径：StraditizeSession.extract_foreground() ===
  load_image                      : {'success': True, 'width': 2132, 'height': 928}
  extract_foreground()            : {'threshold': 138.0, 'mode': 'otsu',
                                     'foreground_pixels': 227062,
                                     'foreground_ratio': 0.11476495277220676,
                                     'shape': [928, 2132]}

=== 一致性核对：`gray < reported_thresh` 是否等于产品掩膜？===
  product foreground_pixels       : 227062
  my  (gray < thresh).sum()       : 227062
  identical mask?                 : True
  skimage.threshold_otsu(gray)    : 138.0
```

三条独立路径（我自己的整数阈值实现、我的 skimage 等价实现、产品实跑）都给出 138.0，
且产品报告的 `foreground_pixels` 与 `gray < 138.0` 逐像素一致。

**判定**：REPRODUCED。Lead 的 138.0 无误。

---

## 3. C2 — "Caryophyllaceae 1.4%，其余 14 列 ≥ 92%" —— PARTIAL

### 3.1 14 列 ≥ 92% 这一半：**REPRODUCED**

按 Lead 自己声明的参考口径（`solid := 亮度 ≤ 150`，`coverage := Otsu<138 且属于 solid`），
我独立重算（`scripts/qa_review/c2_reconcile.py`）：

| # | 属种 | ref_px(≤150) | Otsu∩ref | 覆盖率 |
| --: | :--- | ---: | ---: | ---: |
| 1 | Pinus | 1642 | 1632 | 99.4% |
| 2 | Abies | 1098 | 1089 | 99.2% |
| 3 | Picea | 2019 | 1977 | 97.9% |
| 4 | Betula | 2340 | 2298 | 98.2% |
| 5 | Quercus_D | 4092 | 4015 | 98.1% |
| 6 | Quercus_E | 5321 | 5276 | 99.2% |
| 7 | Rosaceae | 2080 | 2054 | 98.8% |
| 8 | Chenopodiaceae | 3270 | 3215 | 98.3% |
| 9 | Hippophae | 7365 | 7332 | 99.6% |
| 10 | Euphorbiaceae | 61130 | 61015 | 99.8% |
| 11 | Cyperaceae | 40996 | 40876 | 99.7% |
| 12 | Artemisia | 6771 | 6731 | 99.4% |
| 13 | Poaceae | 5272 | 5235 | 99.3% |
| 14 | Ranunculaceae | 1603 | 1595 | 99.5% |
| 15 | Caryophyllaceae | 852 | 689 | **80.9%** |

14 列落在 97.9%–99.8%，与 Lead 的 92.1%–99.8% 同量级（我的数字系统性略高，
因为 Lead 未给出 `solid` 的确切像素选择代码）。**这一半成立**。

### 3.2 Caryophyllaceae = 1.4% 这一半：**NOT_REPRODUCED**

**在 Lead 自己声明的口径下，我测到 80.9%，不是 1.4%。**

我枚举了所有可能的分母，只有一种能凑出接近 1.4% 的量级，且它不是 Lead 声明的口径：

| 定义 | ref_px | Otsu∩ref | 覆盖率 |
| :--- | ---: | ---: | ---: |
| **A 亮度 ≤ 150（Lead 声明的参考）** | 852 | 689 | **80.9%** |
| B 灰带 亮度∈[143,200] 且 chroma≤10 | 205 | 0 | 0.0% |
| C 精确灰 `(182,182,182)±1` | 38 | 0 | 0.0% |
| D 全部非白 亮度≤250 | 2782 | 689 | 24.8% |
| E 全部非白 亮度≤246 | 2704 | 689 | 25.5% |
| F chroma≤10 且 亮度≤246（纯灰阶） | 995 | 674 | 67.7% |
| G 最深 10%（**Lead 最初的坏代理**） | 3167 | 689 | 21.8% |

**没有任何一种定义产出 1.4%**。最接近的是 C（0.0%）—— 即"只把精确的
`(182,182,182)` 当作实心"，但该颜色在本列只有 38 个像素，且**全部落在 Otsu 阈值之外**，
所以 0/38 = 0.0%。

**结论**：`1.4%` 这个数字**无法在任何我枚举得到的、可复述的定义下复现**。
它与"1.4%"最接近的解释是：Lead 实际用的分母是"该列的灰阶填充像素（chroma≤10）"
一类的窄口径，而不是他在更正声明里写的"亮度 ≤ 150"。**即更正声明里的口径描述与
实际算法不一致。**

这不是说 Caryophyllaceae 没问题 —— **它确实有问题**，而且是本轮唯一的真实缺陷。
但在 Lead 自己声明的口径下，它的覆盖率是 **80.9%**（低于其余 14 列的 97.9%+），
而不是 1.4%。缺陷**定性正确、定量错误**。

### 3.3 Caryophyllaceae 到底怎么了（我的独立定性）

我逐像素核对了这一列（`scripts/qa_review/c2_recon_colors.py` 系列）：

```
Caryophyllaceae box x[1231,1280) 的非白像素按颜色分：
  RGB(208, 207, 191) lum=202.0 sat=0.082 n=458   ← 主填充色（暖灰/橄榄灰）
  RGB(0, 0, 0)       lum=  0.0 sat=0.000 n=405   ← 曲线描边
  RGB(182, 182, 182) lum=182.0 sat=0.000 n= 35   ← 少量，非主色
  RGB(167, 167, 167) lum=167.0 sat=0.000 n= 33
  RGB(255, 177, 34)  lum=155.3 sat=0.867 n=  7   ← 橙色，属另一列渗入
```

**主填充色是 `(208,207,191)`（亮度 202），不是 Lead 说的 `(182,182,182)`（亮度 182）。**
两者都远高于 Otsu 阈值 138，因此**都会被判为背景** —— 缺陷的**根因判断**
（灰度/浅色填充被二值阈值切掉）成立，但**引用的具体颜色值错了 20 个亮度级**。

我进一步核对了 `(182,182,182)` 的全局分布：

```
RGB(182,182,182): n=1991, x 范围 [6,2007], y 范围 [232,862]
  最密集的列: x=1966(52 px), x=161(20), x=144(12), x=59(11), x=444(7)
```

它**主要不在 Caryophyllaceae 列**（该列仅 35 px），而是散落在图版各处
（x=1966 是浓度折线区）。Lead 把它当作本列填充色的代表色，是**取样错误**。

### 3.4 C2 判定：PARTIAL

- "其余 14 列 ≥ 92%" → **REPRODUCED**（我测 97.9%–99.8%）
- "Caryophyllaceae ≈ 1.4%" → **NOT_REPRODUCED**（同口径下我测 80.9%）
- 缺陷定性（浅色填充被阈值切掉）→ **REPRODUCED**
- 缺陷定量与引用色值 → **有误**

---

## 4. C3 / P9 — "15 列刻距统一 12.3 px/格" —— NOT_REPRODUCED

用**产品自己的** `straditize_core/ruler.detect_ruler()`（不是我另写一套，
因为本条问的就是"产品测出来的刻距是什么"）：

```
  1 Pinus             spacing=  13.0 n_ticks=  3 n_cells=  2 regular=True
  2 Abies             spacing=  12.5 n_ticks=  3 n_cells=  2 regular=True
  3 Picea             spacing=  12.5 n_ticks=  3 n_cells=  2 regular=True
  4 Betula            spacing=  12.0 n_ticks=  3 n_cells=  2 regular=True
  5 Quercus_D         spacing=  13.0 n_ticks=  4 n_cells=  3 regular=True
  6 Quercus_E         spacing=  12.0 n_ticks=  4 n_cells=  3 regular=True
  7 Rosaceae          spacing=  12.5 n_ticks=  3 n_cells=  2 regular=True
  8 Chenopodiaceae    spacing=  13.0 n_ticks=  3 n_cells=  2 regular=True
  9 Hippophae         spacing=  12.0 n_ticks=  4 n_cells=  3 regular=True
 10 Euphorbiaceae     spacing=  12.0 n_ticks= 18 n_cells= 17 regular=True
 11 Cyperaceae        spacing=  13.0 n_ticks= 14 n_cells= 13 regular=True
 12 Artemisia         spacing=  12.5 n_ticks=  3 n_cells=  2 regular=True
 13 Poaceae          spacing=  13.0 n_ticks=  4 n_cells=  3 regular=True
 14 Ranunculaceae     spacing=  12.5 n_ticks=  3 n_cells=  2 regular=True
 15 Caryophyllaceae   spacing=  19.0 n_ticks=  3 n_cells=  2 regular=True

  distinct spacings: [12.0, 12.5, 13.0, 19.0]
  range: 12.0 .. 19.0
  'all 15 columns ~12.3 px' reproduced? False
```

**两点与 Lead 说法不符**：

1. **不是 15 列统一**：实测有 4 个不同值（12.0 / 12.5 / 13.0 / 19.0），
   `Caryophyllaceae` 是 **19.0**，偏离中位数 12.5 达 **52%**。
   Lead 自己也测到 19.0，但仍把结论写成"15 列全部一致"——**自相矛盾**。
2. **不是 12.3**：中位数是 12.5，众数在 12.0–13.0。Lead 的 12.3 这个值
   在我这里复现不出（`12.3` 可能是他早前某个中间估计的残留）。

**格数**：`Cyperaceae n_cells=13`、`Euphorbiaceae n_cells=17` —— Lead 报的是
**14 格 / 18 格**。差异是**计数口径**：`detect_ruler` 返回的 `n_cells = len(ticks)-1`
（区间数），Lead 数的是**刻度齿个数**（= `len(ticks)`）。13+1=14、17+1=18，
**两者一致，只是口径差 1**。这一点**不是矛盾**，属表述差异。

**C3/P9 判定**：NOT_REPRODUCED。真实情况是"刻距近似但**不统一**，
且有一列（Caryophyllaceae）偏离 52%"。

---

## 5. C4 — `split_solid_and_shadow()` 完全不重叠 —— REPRODUCED，但**发现更严重的问题**

### 5.1 重叠 = 0：REPRODUCED

```
  solid px  = 312021
  shadow px = 348308
  overlap   = 0        (claim: 0)
  union     = 660329
  exclusive? True
```

且逐列核对 15 列，重叠**全为 0**。**"两个掩膜互斥"成立**。

### 5.2 【新发现 · 高严重度】同一张图上，两种浅色阴影被**反向**处理

这一条不在 C1–C5/P9–P11 编号内，是我在建合成图门禁时发现的，**是本轮复核最重要的产出**。

**证据链**（全部在 `image.py @ fdca9fae2bf94072`，即当前哈希上重跑）：

**(a) 合成图最小复现**（`scripts/qa_review/c4_minimal_probe.py`）：
把两种阴影色单独画在纯白画布上，交给产品的 `two_layer_split()`：

```
--- pink envelope alone (244,226,226)
    RGB(244, 226, 226) lum=231.38 chroma= 18 n=10000 solid=0     shadow=10000 -> shadow   ✅
--- blue envelope alone (218,226,237)
    RGB(218, 226, 237) lum=224.86 chroma= 19 n=10000 solid=10000 shadow=0     -> SOLID    ❌
```

**同一个函数、同一种对象（图注明写"5× 夸张阴影"的浅色层），
粉色判 shadow、蓝色判 solid。**

**(b) 真实图版上同样成立**（`scripts/qa_review/c4_blue_envelope.py`）：

```
colour                  px in figure  in fg mask  % of colour
blue envelope                  16648       16648       100.0%   ← 全部进入前景
pink envelope                  20097           0         0.0%
deep blue solid                 2016        2016       100.0%
```

`build_foreground(extraction_mode='solid-over-shadow')` 把**全部 16,648 个
浅蓝阴影像素纳入前景**（100%）。

**(c) 几何证明"浅蓝层确实是夸张包络，不是实心"**
（`scripts/qa_review/p9_p10_fivefold.py`，用图注的可证伪预言）：

图注原文：**"Shadings are five-fold exaggerated."** 若浅层是 5× 包络、深层是真值，
则在未被列宽截断的行上应有 `浅层跨度 / 深层跨度 ≈ 5`：

```
  usable rows: 352
  light/dark  median=5.61  mean=5.66  p25=5.42  p75=5.83
  fraction within [4,6]: 88.4%
  -> consistent with the caption's 'five-fold'? YES
```

**中位数 5.61，88.4% 的行落在 [4,6]** —— 与"five-fold"吻合。

同时（`c4_blue_envelope.py` 的 A 段）：**31/31 行上浅蓝都延伸到深蓝之外，
0 行相反**；`c4_fill_vs_stroke.py` 显示深蓝总是**锚定在列的左轴线**（中位偏移 1.0 px），
浅蓝则从 10–15 px 才开始 —— 这正是"实心填充从轴线长出、包络在它之外"的形状。

**(d) 逐像素直读**（`x[515,585]` 两行原色）：

```
y=500: x519(138,137,135) x520(0,26,62) x521(0,70,152) x522(0,52,132)
       x523(112,145,184) x524(239,240,247)
       x525..x535 连续 (218,226,237) 一类   ← 浅蓝在深蓝右侧展开
       x536..x581 白
y=420: 同上结构，浅蓝带 x524..x532
```

**深蓝是一条 5–6 px 的窄带贴着轴线；浅蓝是它右侧宽得多的区域。**

**结论**：在 Caryophyllaceae 之外，**彩色列（Quercus_E / Rosaceae /
Chenopodiaceae / Betula / Quercus_D 等）的 5× 夸张包络被当成实心前景纳入读数**。
若用该掩膜做数字化，这些列的读数会被放大约 5 倍 —— 这**正是**
`docs/ARCHITECTURE.md` §2 禁止的"返回替代数据"，也是 Lead 在
`pollen-extraction-han2026.md` §2 亲自警告过的"把阴影当读数会把数值放大 5 倍"。

**Lead 的文档说"两个模式各错一半"（`defects-from-real-figure.md` §1.4），
但当前 `image.py` 的实际行为是"两种阴影各错一半"**：粉色正确入 shadow，
蓝色错误入 solid。这是**比文档描述的更具体、也更容易修**的一条。

**判定**：**REPRODUCED**（在 `fdca9fae` 上）。严重度：**高**
（直接污染彩色列读数，且与图注明示的语义相反）。

**注意**：此结论绑定 `image.py @ fdca9fae2bf94072`。该文件在复核期间改了 4 次，
若再次改动，**本条必须在新哈希上重跑**。脚本已就位：
`pixi run python scripts/qa_review/c4_minimal_probe.py`。

### 5.3 【新发现 · 中严重度】产品源码在复核期间被反复改动，导致同一测试结论翻转

`image.py` 在复核期间**至少 5 次落盘**（mtime 观测：21:59 → 22:52 → 23:00 → 23:04
→ 23:17），哈希序列
`89f55b29` → `003b6d00` → `b7a84695` → `fdca9fae` → `13d143d1` → `fdca9fae`
（**末段在 `fdca9fae` 与 `13d143d1` 之间来回跳**）。同一份合成图输入，
在不同哈希上得到**不同分类**：

| `image.py` 哈希 | 浅粉 `(244,226,226)` | 浅蓝 `(218,226,237)` |
| :--- | :--- | :--- |
| `003b6d00`（22:52） | shadow（部分被吞进 solid） | **solid** |
| `13d143d1`（23:16） | background | background |
| `fdca9fae`（23:17–23:18） | **shadow** | **solid** |

我的合成图门禁也随哈希翻转：在 `003b6d00` 上
`test_split_solid_and_shadow_separates_two_layers_with_zero_overlap` **FAILED**，
在 `b7a84695` / `fdca9fae` 上 **11 passed**。

也就是说，**"同一份测试是否通过"取决于你恰好在哪一秒运行**。
这对本项目的可信度是实质损害：任何"我跑过了、全绿"的结论，若不绑定哈希，
在并发开发下都不可复述。

**建议**（只报不改）：并发开发期间，任何对外发布的度量/门禁结论都必须
附带 `sha256sum` 与时间戳；`HANDOFF.md` 的状态卡应记录当时的文件哈希。
本报告 §0 即按此执行。

---

## 6. C5 — 浅蓝阴影 `(218,226,237)` 在 `light-overlay-white` 下被判前景 —— REPRODUCED

`scripts/qa_review/c345_p9p11.py`：

```
  colour                                sat  >=0.08 ?
  light pink shadow  (244,226,226)    0.074     False
  light blue shadow  (218,226,237)    0.080      True   ← 恰好过阈值
  white              (255,255,255)    0.000     False
  orange fill        (255,177,34)     0.867      True
  grey fill          (182,182,182)    0.000     False
  deep blue          (0,62,137)       1.000     True
```

`light_overlay_colored_mask()` 的判据是 `saturation >= 0.08`，
而 `(218,226,237)` 的饱和度恰好是 **0.08017**，**刚好越过阈值**；
粉色阴影 0.074 则**刚好不过**。

**Lead 的怀疑成立，但数值需精确化**：他说 sat=0.080，实际是 **0.08017**，
即阈值之上仅 **0.0002**。我把这个边界写成门禁断言时，最初的写法
`abs(sat-0.08) < 1e-9` **失败**了（差 1.7e-4），改为 `0 < sat-0.08 < 0.001` 才通过
—— 这本身就是"边界极脆"的量化证据：**蓝通道减 1（237→236）就会翻转判定**。

**判定**：REPRODUCED。**这是 §5.2 那条高严重度缺陷的同一根因的另一面**：
`light_overlay_colored_mask` 用饱和度切分彩色/灰阶，而真实的 5× 包络
饱和度只有 0.074–0.080，**正好横跨阈值**，导致同色系不同色相的阴影
被判向相反的两侧。

---

## 7. P10 — "刻距近似但量程差 >50%"的列对是否存在 —— REPRODUCED（存在，且大量存在）

```
  Pinus       spacing=13.0 cells= 2  |  Cyperaceae  spacing=13.0 cells=13
      spacing differs 0.0%, cell count differs 6.5x -> per-cell value must differ 6.5x
  Betula      spacing=12.0 cells= 2  |  Hippophae   spacing=12.0 cells= 3
      spacing differs 0.0%, cell count differs 1.5x
  Cyperaceae  spacing=13.0 cells=13  |  Poaceae     spacing=13.0 cells= 3
      spacing differs 0.0%, cell count differs 4.3x
  Abies       spacing=12.5 cells= 2  |  Euphorbiaceae spacing=12.0 cells=17
      spacing differs 4.0%, cell count differs 8.5x
  （另有十余对同类）
```

**`Pinus` 与 `Cyperaceae` 刻距完全相同（13.0 px，差 0.0%），格数差 6.5 倍。**
若"刻距相同 ⟹ 每格数值相同"，这两列的满量程应当相同 —— 但论文报告
`Pinus max 40.74%` vs `Cyperaceae max 70.07%`，**差 72%**。

**Lead 用 Artemisia 举的反例（刻距 12.5 ≈ 锚点 13.0，误差 −84%）成立；
我另给出一个更强的反例：刻距差 0.0% 的 Pinus/Cyperaceae 对，量程差 72%。**

**判定**：REPRODUCED。**"按刻距/格数外推"必须判为不可靠。**

---

## 8. P11 — `suggest_scales(..., confidence)` 是否真能挡住误用 —— REPRODUCED（能挡住）

`scripts/qa_review/c345_p9p11.py`（读 `straditize_core/ruler.py @ 1f8a1c4b2c3505bc`）：

```
    # name               n_cells  spacing  suggested  confidence
  Pinus                    2     13.0       None        none
  ...（15 列全部）...
  Caryophyllaceae          2     19.0       None        none

  emits any numeric full scale? False   (Lead claims: no)
  emits any 'high' confidence?  False    (Lead claims: no)
```

**当前实现确实不产出任何数字**：`suggested_full_scale` 全为 `None`，
`confidence` 全为 `"none"`，并给出拒用理由。**Lead 的"一个数字都不产出"成立。**

**关于 Lead 自称的"我给的 confidence='high' 判据是刻距差 ≤5%"**：
在**当前** `ruler.py` 里**不存在 `"high"` 这个取值**（grep `confidence` 只有
`"none"` 一个分支）。Lead 描述的"high 判据"很可能是他在改成
"一律 None"之前的**中间版本**。因此：

- **P11 判定**：**REPRODUCED** —— 当前实现挡住了误用。
- **Lead 自述的"high 判据是 bug"这一条**：**NOT_REPRODUCED / 已不存在**
  —— 该判据在当前代码中已被移除，无从复现。若 Lead 指的是历史版本，
  需提供那时的哈希才能判定，否则属**已失效的自我指控**。

**但我要指出一个仍然存在的风险**：`suggest_scales` 现在返回
`n_cells` 与 `spacing_px` 这两个**客观量**，UI 会展示给用户。§7 已证明
**"刻距/格数"不能推出量程**。因此若前端把 `n_cells` 渲染成
"本列有 N 格，建议每格 X"，用户仍可能**自行完成那次错误外推**。
函数本身安全，**但接口交给 UI 的信息足够诱导误用**。这一点建议在
task-6 的验收里显式加一条：UI 展示 `n_cells` 时必须同时展示
"格数不决定量程"的说明。

---

## 9. 合成图门禁（本次最重要的产出）—— 通过

`tests/unit/test_metric_sanity.py`，**11 项全部通过**（在 `image.py @ fdca9fae` 上）：

```
$ pixi run python -m pytest tests/unit/test_metric_sanity.py -q
...........                                                              [100%]
11 passed in 3.25s
```

**设计原则**：用**已知真值的合成图**验证提取算法。算法在合成图上都测不准，
就不配去测真实图。

门禁覆盖 5 类：

| # | 测试 | 守的是什么 |
| :--- | :--- | :--- |
| 1 | `test_measurement_recovers_known_fill_area` | 基线：直接测量必须**精确**复原构造真值 |
| 2 | `test_darkest_decile_proxy_is_invalid_on_antialiased_bars` | **把本轮事故钉死**：证明"最深 10%"测的是描边不是填充 |
| 3 | `test_otsu_threshold_misses_grey_fill_on_synthetic_figure` | 在自造图上复现"中灰填充被 138 切掉" |
| 4 | `test_colour_based_measurement_is_immune_to_the_otsu_choice` | 正对照：换正确的度量法就能测准 |
| 5 | `test_split_solid_and_shadow_separates_two_layers_with_zero_overlap` | 双层分离必须精确且互斥 |
| 6 | `test_light_overlay_mask_misclassifies_a_real_shadow_colour` | 记录 sat=0.08017 的**边界脆性**（1 通道单位即翻转） |
| 7 | `test_fill_measurement_is_stable_across_widths[10/25/40/80]` | **度量必须不随被测对象漂移** |
| 8 | `test_otsu_path_coverage_is_reported_per_column_not_aggregated` | 禁止把逐列结果聚合成一个数（那会掩盖单列失败） |

**第 2 项是本门禁的核心**：它不测"算法对不对"，而是测**"用这个代理指标
得出的结论是不是假的"**。它断言"最深 10% 选出的像素**不是**填充色"，
从而把 Lead 最初那次误判固化成一条会永久报警的测试。

**第 7 项是防"度量自欺"的通式**：任何度量若随被测对象（这里是柱宽）系统性
漂移，就不是度量。我在本轮自己的探测中**亲历了三次这种失败**
（见 §10），因此把它写成了参数化测试。

**门禁是否破坏既有基线**：全量套件实测 **342 passed / 3 skipped / 90 subtests**
（`pixi run python -m pytest -q`，158.62s，exit 0）。我新增的 11 项是**新增文件**，
不改动任何既有断言；`pixi run lint` 亦全绿（ruff + consistency 11 项）。
Lead 报的基线 331 项 + 我的 11 项 = 342，**对账一致**。

---

## 10. 我自己踩的坑（诚实记录，因为它就是本任务要防的东西）

本报告的可信度取决于我是否同样被"代理指标"骗过。**我踩了三次**：

1. **"从列左轴线起的最长非白游程"** —— 我一度用它当填充宽度，
   结果 15 列**全部**得到 ~20% 覆盖率、**全部** <90%，看似"15 列全坏"。
   实际是我把**相邻列的填充**一并吞进了游程。这正是 Lead 那次
   "9/15 列失败"的同型错误。**我没有采信它**，而是回头去读原始像素。
2. **"列内游程 ≥3px 的颜色族 = 填充层"** —— 它把**黑色曲线描边**识别成
   "solid 家族"（因为描边游程又长又宽），于是给出"Pinus 填充色 = 深红、
   Otsu 覆盖率 0%"这类**看起来很像证据**的数字。
   **我没有采信它**，改用"深蓝总是锚定轴线、浅蓝在它之外"的几何检验。
3. **Caryophyllaceae 的颜色** —— 我最初按 Lead 说的 `(182,182,182)` 去找，
   发现该列只有 35 px 这个颜色，差点得出"Lead 引用了不存在的颜色"的结论。
   实际是**主填充色是 `(208,207,191)`**，`(182,182,182)` 是别处的散点。
   我把两个数字都列出来，才避免了又一次误判。

**这三次的共同形态**：代理指标（游程、颜色族、引用色值）看起来自洽，
但**从未与被测对象（真实填充层）对账**。§5.2 那条缺陷能被发现，
恰恰是因为**我建了合成图**：在纯白画布上画一个已知的浅色块，
答案就不可争辩了。**合成图门禁的价值由此被自我验证。**

---

## 11. 门禁与基线复核

```
$ pixi run python -m pytest tests/unit/test_metric_sanity.py -q
11 passed in 2.52s

$ pixi run python -m pytest -q
342 passed, 3 skipped, 90 subtests passed in 158.62s   → exit 0

$ pixi run lint
All checks passed!   （ruff check straditize_core tests）
OK A/A0/B/C/D/E/G/H/I/J/F  一致性核对通过   → exit 0
```

均在 `image.py @ fdca9fae2bf94072`（23:18 稳定态）上取得。

### 11.1 未决项 / 我无法复核的部分

| 项 | 状态 | 缺什么才能判定 |
| :--- | :--- | :--- |
| Lead 的 `1.4%` 原始算法 | **UNCERTAIN** | 需要 Lead 提供生成该数字的**确切脚本**（`scripts/lead_probe/diag_fig3_foreground.py` 的实际 `solid` 定义）。我已枚举 7 种定义，无一给出 1.4%。 |
| `suggest_scales` 历史版本的 `"high"` 判据 | **NOT_REPRODUCED** | 当前 `ruler.py` 无 `"high"` 分支。需 Lead 给出历史哈希/版本。 |
| `image.py` 早期哈希（`89f55b29`/`003b6d00`）的行为 | **已被覆盖** | 文件被改动 4 次，早期状态不可复现；我只能报告"我在那时测到 X，现在测到 Y"。 |
| §5.2 缺陷在**其他**彩色列（非 Quercus_E）的普遍性 | **REPRODUCED（部分）** | 我核了 Quercus_E/Rosaceae/Chenopodiaceae/Betula/Quercus_D 的几何一致性；全 15 列的逐列 `solid` 归属统计未做，因 `image.py` 仍在变动。 |

### 11.2 本轮结论里**必须标注存疑**的

1. **`defects-from-real-figure.md` §1.1-c 的 `1.4%`** —— 在声明的口径下不可复现（§3.2）。
   建议改为"该列覆盖率显著低于其余 14 列（我测 80.9% vs 其余 97.9%–99.8%），
   根因是浅色填充低于 Otsu 阈值"，并**删除精确的 1.4%**，或补上生成它的确切定义。
2. **该文 §1.1-c 引用的 `(182,182,182)`** —— 本列主填充色实为 `(208,207,191)`，
   `(182,182,182)` 全图仅 1991 px 且主要不在该列。建议更正色值。
3. **`pollen-extraction-han2026.md` §4 与 `defects-from-real-figure.md` §2.1 的
   "15 列刻距统一 12.3 px"** —— 实测 12.0/12.5/13.0/19.0 四值，
   Caryophyllaceae 偏离 52%（§4）。**该说法必须撤下**，否则 task-6 会建立在错误前提上。
4. **`defects-from-real-figure.md` §1.4 的"两个模式各错一半"** —— 就**阴影分层**而言，
   当前实现的真实形态是"**两种阴影各错一半**"（粉对/蓝错，§5.2）。
   建议按后者改写，它更精确且可修。
5. **Lead 自述的 `confidence="high"` 判据是 bug** —— 当前代码中该判据已不存在，
   属已失效的自我指控，不必进最终报告。

### 11.3 给 Lead 的裁决建议

**可进最终报告（证据充分）**：
- C1（Otsu=138.0）、C4 的互斥性、C5（蓝阴影过阈值）、P10（外推不可靠）、P11（当前挡住）
- **§5.2 蓝阴影被判 solid**（新发现，高严重度，绑定 `fdca9fae`）
- **§5.3 并发改动导致测试结论翻转**（工程问题，中严重度）

**必须改写后才能进报告**：C2 的 1.4%、C3/P9 的"刻距统一 12.3"、引用的 `(182,182,182)`

**建议新增为验收判据**（task-5 / task-6）：
- task-5：在**合成图**上断言"浅色包络 0 像素进入 solid"，且
  **粉/蓝两种阴影必须同向处理**（当前二者相反，见 §5.2）。
- task-6：UI 展示 `n_cells` 时必须同时说明"格数不决定量程"（§8）。

---

## 12. 一键复跑

```bash
cd "E:/software_dev/straditize"

# 合成图门禁（本任务最重要的产出）
pixi run python -m pytest tests/unit/test_metric_sanity.py -q

# 逐条复核（全部在 scripts/qa_review/，不依赖 scripts/lead_probe/）
pixi run python scripts/qa_review/c1_otsu_threshold.py       # C1
pixi run python scripts/qa_review/c2_reconcile.py            # C2（含 7 种定义枚举）
pixi run python scripts/qa_review/c345_p9p11.py              # C3/C4/C5/P9/P11
pixi run python scripts/qa_review/p9_p10_fivefold.py         # P9/P10 + 5× 证伪
pixi run python scripts/qa_review/c4_minimal_probe.py        # §5.2 最小复现
pixi run python scripts/qa_review/c4_blue_envelope.py        # §5.2 真实图版证据
pixi run python scripts/qa_review/c4_fill_vs_stroke.py       # 填充 vs 描边判别

# 复核前先确认哈希（本轮 image.py 改过 4 次）
sha256sum straditize_core/image.py straditize_core/ruler.py
```

**复跑前提**：`output/han2026_ngamring/fig3_raw.jpeg`（2132×928，由 Lead 从
`I:/Zotero/storage/HV4FXL63/` 的 PDF p5 无损取出）。若该文件被替换，
C1/C2/C3/C5/P9/P10 全部失效。
