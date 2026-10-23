# 双轴（色度 + 亮度）分层：修「中灰填充被整体丢弃」

> 执行者：`layer-fixer`（task-9）
> 代码绑定：`sha256sum straditize_core/image.py` = `06fb929e163d32b6933183742f07335b1baef6b0386c9e5cedd0cf6e256e8213`
> 所有数字均来自本机真实命令输出，命令原文附在各节。

---

## 1. 结论先行

| 验收项 | 修前 | 修后 | 判据 |
| :--- | ---: | ---: | :--- |
| 中灰 `(182,182,182)` 覆盖率 | **0.0%** | **100.0%** | ≥ 95% ✅ |
| 浅粉 / 浅蓝 / 浅灰阴影进 solid | 0.0% | **0.0%** | 0%，不得退化 ✅ |
| 深红 / 深蓝 / 纯黑实心覆盖率 | 100.0% | **100.0%** | 100%，不得退化 ✅ |

三条门禁：`pixi run lint` 全绿（ruff + consistency 11 项）、`pixi run test` = **382 passed / 3 skipped / 92 subtests**（基线 342，只增不减）、`npm --prefix frontend run build` 成功。

**内建教程图不是"零像素回归"，而是"零削除"**——`hoya` +11579 px、`beginner` +15880 px，两者都是 Otsu 丢掉、新判据补回的墨。这一点与任务书里的"零回归"预期不符，我在 §6 如实交代，而不是把断言改成 `diff == 0` 蒙过去。

**我推翻了 Lead 判据里的一处**：`chroma <= 12` 与 `lum < 210 / < 170` 三条固定阈值只在 Han2026 这一张图上成立，合成图扫描 **8/16**。见 §4。我把亮度轴改成了**相对纸面**的比例，颜色轴的语义也下移了一档（见 §3）。但**边界本身仍是固定比例**，这条局限我没能消除，见 §5。

---

## 2. 根因（不是"阈值定低了"，是"用单轴定义一个双轴问题"）

`extract_foreground()` 的 `standard` 分支走 `gray < 182.0`（Otsu 在 Han2026 上得 138）。该图版有**三类**填充：

- 灰阶列：纸 255 / 阴影 229 / 实心 182 —— **三层颜色完全相同（通道极差 = 0）**，只能靠亮度分；
- 彩色列：浅阴影（244,226,226 / 218,226,237）与深实心只差亮度；
- 中灰实心 182 恰好落在 138 与 229 之间。

一条绝对亮度线只有两种结局：切在阴影之上（实心全丢——当前缺陷）或切在阴影之下（阴影进读数，数值 ×5）。**所以缺陷不是"阈值选错"，是"单轴信息不足"。**

实测基线（修前）：

```
$ pixi run python /tmp/base_measure.py
threshold 138.0 mode otsu px 227062 ratio 0.11476
paper  1337863px  cov   0.0%
pink     42441px  cov   0.0%
blue     32675px  cov   0.0%
lgrey   166107px  cov   0.0%
mgrey     6427px  cov   0.0%      ← 唯一真缺陷
dgrey     6873px  cov   0.0%      ← 明度 167，同样被切掉
red      10338px  cov 100.0%
dblue     5591px  cov 100.0%
black   141187px  cov 100.0%
```

注意 `dgrey (167,167,167)` 也是 0.0%——缺陷比问题清单里写的"只有一个中灰色"**多一档**。

---

## 3. 改法

### 3.1 新增 `split_by_colour_and_luminance()`（`straditize_core/image.py`）

```
① rel = 明度 / 本图纸白           # 相对明度，不是绝对值
② rel < boundary → 实心           # 明显离开了纸面：黑墨、饱和填充、中灰填充
③ rel >= 1.0    → 纸（背景）
④ 中间「只淡一档」带：还留着颜色 → 实心；颜色被洗淡 → 阴影
```

三个常数：

| 常数 | 值 | 依据 |
| :--- | ---: | :--- |
| `TWO_AXIS_SOLID_RATIO` | 0.84 | 相对纸面的"明显比纸暗"线。纸 255 ⇒ 明度 < 214 |
| `TWO_AXIS_PAPER_RATIO` | 0.985 | 纸白分位（`paper_white()` 用 P97.5 实测量出，不假设 255） |
| `TWO_AXIS_VIVID_CHROMA` | 64 | "还留着自己的颜色"。实测 Han 三种 5× 包络极差 18–19、淡紫包络 34；实心 ≥ 120 |

**与 Lead 判据的实质差异**（不是换个数字，是换判据形态）：

| | Lead 判据 | 本实现 |
| :--- | :--- | :--- |
| 亮度轴 | 绝对值 `lum < 210` / `< 170` | **相对纸面**的比例，纸白按图测出 |
| 颜色轴 | `chroma <= 12` 分灰/彩两支，**两支各自用不同亮度线** | 颜色只在**亮度说不清**的淡档里发言（"是否还留色"） |
| 为什么 | 为通过 Han2026 的 8 个色簇反推 | 判据结构先定，阈值只保留一个可解释的常量 |

颜色轴语义下移的理由：Lead 的写法让"是否彩色"决定用哪条亮度线，于是**淡琥珀实心 (250,220,150)（明度 224）被整块丢弃**；本实现里它作为"高明度彩釉"被颜色轴救回（合成图 E 项）。

### 3.2 接入默认路径

`build_foreground(..., two_axis=True)`（默认开）的 `standard` 分支改为：

```
ink = (双轴 solid) | (绝对阈值 abs_ink)  — 两者的"纸壳"部分
```

保留绝对阈值是因为它在**淡扫描**上有独立价值（220 明度的影印纸，相对判据会把 185 以下全算墨，连压缩噪声一起读进来）。`two_axis=False` 保留旧行为，供对照与回退。

**没有动 `split_solid_and_shadow()`**，也没有动 `session_parts/`。`extract_foreground()` 因为另一任务（task-10）已经先一步把 `standard` 接进 `build_foreground`，所以我的改动自动进入默认路径，无需碰 `core.py`。

---

## 4. 阈值是不是只是恰好适配这张图？——合成图扫描

任务书的疑问是对的。我用 **16 张已知真值的三层合成图**（纸 + 实心块 + 阴影块，两块不相交，真值由构造决定）扫描。

### 4.1 Lead 的绝对判据：8/16

```
$ pixi run python /tmp/scan_lead_synth.py
A han 255/182/229                                solid=100.0% leak=  0 PASS
A2 255/167/229                                   solid=100.0% leak=  0 PASS
B 255/182/205                                    solid=100.0% leak=225 FAIL   ← 阴影被吞进读数
B 255/150/200                                    solid=100.0% leak=225 FAIL
B 255/120/190                                    solid=100.0% leak=225 FAIL
B 255/120/170                                    solid=100.0% leak=225 FAIL
C cream 240/182/229                              solid=100.0% leak=  0 PASS
D low-chroma shading lum200                      solid=100.0% leak=225 FAIL
E pale amber                                     solid=  0.0% leak=  0 FAIL   ← 实心被丢弃
F faint 238/170/226                              solid=100.0% leak=  0 PASS
G pale grey solid 215/wash238                    solid=  0.0% leak=  0 FAIL
H pink                                           solid=100.0% leak=  0 PASS
H blue                                           solid=100.0% leak=  0 PASS
I lavender-wash                                  solid=100.0% leak=  0 PASS
J orange                                         solid=  0.0% leak=  0 FAIL
K dark blue / cyan wash 210,232,240              solid=100.0% leak=  0 PASS

Lead absolute-threshold formula: 8/16 synthetic 3-layer figures correct
```

失效模式是**成体系**的，不是随机：凡"淡阴影比 210 暗"（205/200/190/170，都是常见印刷色调）一律整块漏进读数；凡"高明度彩色实心"（淡琥珀 224、橙 184）一律被整块丢弃。

### 4.2 本实现：10/16（并把方向问题关掉）

```
$ pixi run python /tmp/final_suite.py
A  paper255/solid182/shadow229                   solid=100.0% shadow->solid=  0.0%  PASS
A2 paper255/solid167/shadow229                   solid=100.0% shadow->solid=  0.0%  PASS
B1 paper255/solid182/shadow205                   solid=100.0% shadow->solid=100.0%  FAIL
B2 paper255/solid150/shadow200                   solid=100.0% shadow->solid=100.0%  FAIL
B3 paper255/solid120/shadow190                   solid=100.0% shadow->solid=100.0%  FAIL
B4 paper255/solid120/shadow170                   solid=100.0% shadow->solid=100.0%  FAIL
C  cream240/solid182/shadow229                   solid=100.0% shadow->solid=  0.0%  PASS
D  paper255/solid0,62,137/shadow204,208,211      solid=100.0% shadow->solid=100.0%  FAIL
E  paper255/solid250,220,150/shadow252,240,220   solid=100.0% shadow->solid=  0.0%  PASS
F  faint238/solid170/shadow226                   solid=100.0% shadow->solid=  0.0%  PASS
G  paper255/solid215/shadow238 (unseparable)     solid=  0.0% shadow->solid=  0.0%  FAIL
H1 paper255/solid180,60,60/shadow244,226,226     solid=100.0% shadow->solid=  0.0%  PASS
H2 paper255/solid0,62,137/shadow218,226,237      solid=100.0% shadow->solid=  0.0%  PASS
I  paper255/solid0,62,137/shadow214,222,236      solid=100.0% shadow->solid=  0.0%  PASS
J  paper255/solid255,177,34/shadow253,235,200    solid=100.0% shadow->solid=  0.0%  PASS
K  paper255/solid0,62,137/shadow210,232,240      solid=100.0% shadow->solid=  0.0%  PASS

PASS 10/16
```

**改进的**：E（淡琥珀实心）、J（橙实心）、I（淡紫包络）三项从 FAIL 转 PASS；F（淡纸）保住。

**仍然失败的 6 项**分两类，我在 §5 逐条说明，没有一项是"悄悄变好"。

### 4.3 关键的一条：不稳定的不是阈值，是"用固定比例切未知层数"

我试过让边界从**每张图自己的直方图两峰之间派生**（`_resolve_solid_ratio`，代码保留且被测）：这能把 B1–B4 全部修好，但会在**单层图**（黑线白底）上把 Otsu 线以上的反锯齿边一并算成墨——

```
$ pixi run python /tmp/design9.py
hoya:    b=0.985 tiers=0 px=299734 otsu=288155 diff=11579
beginner b=0.985 tiers=1 px=828941 otsu=807198 diff=21743
```

两张内建教程图各多出 1.2–2.2 万像素。**单层图与多层图在同一张图版里常常并存**（教程图就有），图级直方图分不开它们。正确的解法是**按列（每个 ROI）统计**，而 `session_parts/` 不在本任务写作用域内。所以我选择"教程图不漂移"优先，把这条写成公开局限（§5.1）而不是藏起来。

---

## 5. 已知局限（全部写成会报警的测试，不假装没有）

### 5.1 【最重要】边界是固定比例，阴影画得比 0.84·纸更暗时会整块放大读数

明度 ≤ 214（纸 255）的阴影会被判成实心。这是**多读方向**，正是本模块最该防的。测试
`test_boundary_is_a_fixed_ratio_so_dark_shading_leaks` 把确切边界钉住：215 → 0% 漏入（正确），205/190/170 → 100% 漏入（已知）。

### 5.2 实心只比纸淡一档时，无信息可分离

纸 255 / 实心 215 / 阴影 238：两者落在同一相对明度档，判据把实心一起判为阴影（少读）。测试 `test_unseparable_figure_fails_safe_too_few_not_too_many` 断言**方向**：可以漏，不可以漏进读数。

### 5.3 极低极差包络叠在深色实心上

`(0,62,137)` 实心 + `(204,208,211)` 包络（极差 11）：包络被 `~vivid` 掩掉后不足以成峰，退回单档切分，包络整块进 solid。测试 `test_low_chroma_overlay_on_dark_ink_never_leaks` 记录现状并注明"这不是可接受行为"。

---

## 6. 内建教程图：不是"零像素回归"，是"零削除"

任务书要求"hoya / beginner 零回归"。实测**不是零像素差**：

```
$ pixi run python /tmp/prod_accept.py  （教程图部分）
hoya:    otsu=25.0  px=288155  two_axis_px=299734  diff=11579  add=11579  rem=0
beginner otsu=172.0 px=807198  two_axis_px=823078  diff=15880  add=15880  rem=0
```

- `hoya` 的 11579 px 是 **RGB(0,0,221)**，明度 25.19，Otsu 阈值 25.0——差 **0.19 个明度级**被切掉。它是明显的彩色描边（通道极差 221），本该读到。
- `beginner` 的 15880 px 是明度 171.7–214 的描边/抗锯齿边（其中 13564 px 通道极差为 0 的灰）。

两条都是"补进本该读到的墨"，`removed = 0`。我一开始把断言写成 `diff == 0`（照任务书的理解），实测直接红——**那是把预期的错误当成判据**。现改为断言 `removed == 0` 且 `added` 等于实测值的精确数字，并在测试 docstring 里写清两块像素的来源。若 Lead 裁定"教程图必须与 Otsu 逐像素一致"，那与"中灰填充必须被读到"在单层/多层并存的图上不可同时满足，需要按列统计（§4.3）。

---

## 7. 真实验收（产品默认路径，不是只测新函数）

```
$ pixi run python /tmp/prod_accept.py
=== 产品默认路径 extract_foreground() ===
threshold 138.0 mode otsu extraction_mode standard fg_px 271630 ratio 0.13729

  浅粉阴影  (244, 226, 226)   42441px  覆盖   0.0%
  浅蓝阴影  (218, 226, 237)   32675px  覆盖   0.0%
  浅灰阴影  (229, 229, 229)  166107px  覆盖   0.0%
  中灰实心  (182, 182, 182)    6427px  覆盖 100.0%
  深灰实心  (167, 167, 167)    6873px  覆盖 100.0%
  深红实心    (180, 60, 60)   10338px  覆盖 100.0%
  深蓝实心     (0, 62, 137)    5591px  覆盖 100.0%
  纯黑实心        (0, 0, 0)  141187px  覆盖 100.0%
```

额外验证 QA 曾指出的淡紫包络 `(194,209,228)`（极差 34，横跨"灰/彩"边界）：8148 px，solid 100% / shadow 0%——因为它 lum 206.7 / rel 0.81 < 0.84，属实心档。**这条要请 QA 复核**：它到底是包络还是另一种实心，我的判据把它算实心。

---

## 8. 回归测试 `tests/unit/test_two_axis_layering.py`（33 passed / 2 subtests）

| 组 | 守什么 |
| :--- | :--- |
| `TestColourClustersOfTheRealFigure` | Han2026 九种色簇逐个判对；solid/shadow 互斥；纸白两者都不是 |
| `test_five_envelope_colours_never_enter_the_solid_mask` | 5 种包络色（粉/蓝/浅灰/淡紫/淡青）进 solid = 0 且必须落进 shadow |
| `test_eight_solid_colours_are_fully_read` | 8 种实心色（中灰/深灰/暖灰/红/蓝/橙/淡琥珀/黑）覆盖率 = 100% |
| `test_grey_and_colour_columns_are_treated_in_the_same_direction` | **历史缺陷是反向的**，两侧必须同向 |
| `TestPaperIsMeasuredPerFigure` | 纸白按图测出（奶油纸）；同一套配色换纸后判定不变 |
| `TestBoundaryIsNotTunedToOneFigure` | 固定比例的确切失效边界；不可分图必须"少读"不"多读" |
| `TestStandardPathRegressions` | 教程图 `removed == 0`；中灰填充在 `build_foreground` 里被读到；旧行为可用 `two_axis=False` 取回 |
| `TestRealFigureAcceptance` | 真实图版三条验收（文件不在仓库时 skip） |
| `TestMeasuredWithTheSameProxiesItReplaced` | **反向对照**：把"只用亮度"与"只用颜色"的失效方式钉死 |

最后两组是本任务最重要的：`test_luminance_alone_cannot_separate_three_grey_tiers` 断言 138 的绝对线会让中灰填充 0%（把缺陷本身固化），`test_colour_alone_cannot_separate_grey_tiers` 断言灰阶三层极差全为 0。

---

## 9. 门禁

```
$ pixi run lint
ruff check straditize_core tests: All checks passed!
一致性核对通过（A/A0/B/C/D/E/G/H/I/J/F 全 OK）

$ pixi run python -m pytest -q
382 passed, 3 skipped, 92 subtests passed in 318.05s (0:05:18)

$ npm --prefix frontend run build
✓ built in 197ms
```

基线 342 → 382（+33 新测试，+7 由他人在同期加入）。**没有放宽任何既有断言**。

一处需要 Lead 知悉：跑全量时曾出现过一次 `test_metric_sanity.py::test_otsu_path_coverage_is_reported_per_column_not_aggregated` 红，原因是该文件在**我跑测试的同一分钟被另一任务改写**（mtime 13:40），重跑即绿。不是我的改动引起。

---

## 10. 文件与哈希

| 文件 | 状态 |
| :--- | :--- |
| `straditize_core/image.py` | 修改（+`split_by_colour_and_luminance` / `paper_white` / `_luminance_peaks` / `_resolve_solid_ratio` / `_derived_boundary` / `_standard_foreground`；`build_foreground` 增 `two_axis` 参数）<br>`sha256 = 06fb929e163d32b6933183742f07335b1baef6b0386c9e5cedd0cf6e256e8213` |
| `tests/unit/test_two_axis_layering.py` | 新增（33 项 + 2 subtests） |
| `docs/findings/fix-two-axis-layering.md` | 本文件 |

**未改动**：`split_solid_and_shadow()`（原样）、`session_parts/`（全部）、`frontend/`、`support/`、`scripts/`。

---

## 11. 给 Lead 的三个裁定请求

1. **教程图口径**：接受"零削除"（现实现，+11579 / +15880 px），还是坚持"与 Otsu 逐像素一致"？后者与"中灰填充必须被读到"在单层/多层并存的图上不可同时满足，需要把判据下推到**按列**（`session_parts/` 不在我写作用域）。
2. **固定比例 0.84 的取舍**：我保留固定比例换教程图稳定，代价是"阴影比 214 更暗"时会整块放大读数（§5.1，多读方向）。若认为这条比教程图像素漂移更严重，改为直方图派生边界 + 按列处理。
3. **淡紫包络 `(194,209,228)`**（8148 px）现在被判为实心。请 QA 在 task-11 里裁定它是 5× 包络还是实心——若是包络，我的 `TWO_AXIS_VIVID_CHROMA=64` 需要上调，且 Han2026 的读数会相应变小。

---

## 7. 附：Lead 尝试过的两处改动与回退（如实记录）

`layer-fixer` 交付后，Lead 试图修掉它点名的两条局限，**两次都失败并已完整回退**。
记录在此，防止后人重踩。

### 7.1 尝试一：让「阴影画得更暗」也能分（失败）

目标：修 `B1–B4`（阴影落在 205/200/190/170）—— 当前 100% 漏进实心。

改动：把 `_resolve_solid_ratio` 的"两峰相对 `solid_ratio` 位置"判据，改成
"只要有 ≥2 峰就在最亮两峰之间切"。

**结果**：合成图 B1–B4 全部修好（漏入 100% → 0%），但**真实图版三类阴影从 0%
变成 100% 漏入** —— 因为图版实际有 4 个峰 `[206, 230, 242, 249]`，
242/249 是**纸与墨之间的抗锯齿过渡**，不是墨层；按"最亮两峰"切会切到 245，
把浅灰阴影 229 整个吞进实心。**这是 ×5 误读方向，比原问题更危险，故回退。**

### 7.2 尝试二：用「峰间距骤降」识别抗锯齿（失败）

思路：抗锯齿峰紧贴纸白、间距骤降；真墨层间距大。按"间距 < 最宽间距 × 0.4 即抗锯齿"裁剪。

**结果**：真实图版的峰序列是 `[12, 20, 206, 230, 242, 249]`（前两个是深色区），
`gaps = [8, 186, 24, 12, 7]`，**最宽间距 186 来自 20→206 的空白区**（没有像素的一段），
于是 `0.4 × 186 = 74` 把 24/12/7 全部判为"骤降"→ 一路砍到只剩 `[12]`。

**根因**：直方图的"峰间距"里混入了**无像素的空档**，它不代表墨层间隔。

### 7.3 尝试三：改用 `threshold_otsu` / `threshold_multiotsu`（也未采用）

实测：
```
灰阶分支 Otsu = 115.6   → 中灰 182 / 深灰 167 都判不进实心（错）
彩色分支 Otsu = 162.0   → 深红96/深蓝52 进、浅粉231/浅蓝225 出（对）
灰阶 multiotsu 阈 = [55.7, 165.2]  → 182 仍在阈值之上（错）
```
彩色分支可用，灰阶分支因被大量浅灰阴影拉低而失效。

### 7.4 结论：当前的取舍是有意识的

现版本选择 **`0.84` 固定相对比例 + 单峰回退**：
- **正确覆盖**：本图版全部 8 类色簇（真实图版 FAIL = 0）、常见印刷阴影 229；
- **已知失效**：阴影明度 ≤ 214（比 0.84·纸更暗）时整块漏进实心。

**这个失效方向是"多读"（×5 放大），比"少读"危险**，必须让用户知道。
缓解措施已写入测试 `test_boundary_is_a_fixed_ratio_so_dark_shading_leaks`（会报警），
并在 `docs/findings/metric-luminance-vs-colour.md` §5 写明失效边界。

真正的解法是 `layer-fixer` 建议的**按列统计直方图**（单层图与多层图常在同一图版并存，
图级直方图分不开），需要改 `session_parts/`，超出本轮范围。

---

## 8. 第二轮改进（2026-10-20 下午，Lead）

### 8.1 新增量化基准（改进的前提）

`scripts/benchmark_two_axis.py` —— 252 个组合的扫描矩阵，四维：
纸白（白/米/灰） × 实心相对明度（0.00–0.85） × 包络相对明度（0.75–0.97） × 配色（灰/暖/冷）。

每个组合输出两个数，**方向分别统计**：
- `solid_recall` 低 = **少读**（曲线消失，肉眼可见）
- `shadow_leak` 高 = **多读**（×5 放大，用户无法察觉）→ 危害更大，优先修

另加**混合图场景**（81 组合）：同一张图版里并存"单层列"与"双层列"。
⚠️ 第一版基准把包络做成独立一列，那是**不存在的场景**（真实图版里包络与实心
在**同一列内**，包络画得更宽）。修正后才测出真实通过率。

### 8.2 改进幅度

| 指标 | 改进前 | 改进后 |
| :--- | ---: | ---: |
| 可分离组合通过率 | 60.7% | **97.4%** |
| 多读（危险方向） | 86 | **0** |
| 少读 | 6 | 6 |
| 混合图全对 | 66.7% | **100%** |
| 真实图版 8 类色簇 | 8/8 | **8/8** |

### 8.3 四处真实缺陷修复

| # | 位置 | 缺陷 | 证据 |
| --: | :--- | :--- | :--- |
| 1 | `_luminance_peaks` | `range(1, 256)` 从索引 1 起扫，**纯黑（bin 0）永远检测不到** | 纯黑单层图返回 `peaks=[]` → 修后 `[0]` |
| 2 | `_resolve_solid_ratio` | `min(candidate, solid_ratio)` 把派生边界锁死在 0.84 | 两峰 76/204 时中点应 140，被抬到 214 → 包络误判实心 |
| 3 | `_resolve_solid_ratio` | 地板 `candidate >= 0.40` 误伤"实心是纯黑"（正确边界必然 <0.5） | rel=0 实心配 0.749 包络，中点 0.374 被挡 → 退回 0.84 |
| 4 | `grey_matrix` | `[..., :3]` 后索引通道 2，遇 `shape=(H,W,2)` 崩溃 | `IndexError: index 2 is out of bounds` |

### 8.4 一次**误判**与回退（重要）

Lead 曾把 `min(candidate, solid_ratio)` 判定为"错误的 clamp"并删除。实测那是**误判**：

```
删除 clamp 后边界升到 218
浅蓝包络向纸面的抗锯齿过渡带 = grey_matrix 加权亮度 217.4
→ 恰好被 218 切到实心一侧，实测泄漏 54 px（"包络有 0.2% 漏进读数"）
而 0.84 这个上限恰好把边界压在该过渡带之下，是有用的保护
```

**根因是我自己的度量错误**：核对时用了**简单平均**算亮度（220.7），
而代码用 `grey_matrix` 加权 0.299/0.587/0.114（**217.4**），差 3.3 级足以翻转判定。
前几轮反复以为"边界该更高"，都是这个错误在误导。

已把这条写进代码注释：**亮度必须用 `grey_matrix`，不是简单平均**。

### 8.5 仍存在的局限（已确认，非回归）

**"两列独立单层"图上的灰列无法自判。**

- QA 合成图（黑列 + 中灰列，两者都无包络）：灰列覆盖率仍 **0%**
- 列内直方图只有 182 一个峰，无法自判"它是墨还是包络"
- 实测与真实图版形态（中灰 182 实心 + 浅灰 229 包络）的**列内峰完全相同**
  （单峰 182 vs 单峰 229），但语义相反
- 判别必须依赖"该列是否还有更淡的一层"这一**跨列**信息，当前接口不可得

**而真实图版形态（同一列内既有实心又有包络）是正确的**：
中灰 182 → 100% 进 solid，浅灰 229 → 0% 进 solid。

两条测试已按"记录现状"改写（`assert per_col[1] < 95.0` + 注明若改善则收紧），
避免用不可达目标污染通过率。

### 8.6 门禁

```
pixi run lint  → 全绿
pixi run test  → 382 passed, 3 skipped, 92 subtests
```

绑定 `sha256sum straditize_core/image.py` = `05d821608dd46d66…`
