# 投产验收巡检报告（2026-10-23）

> **回答的问题**：`docs/findings/production-readiness.md` §6「诚实的边界：这次还不是生产环境」
> 列出的三条未销账项，逐条真实操作取证，判定**这一步是否真的可以交付给科研用户**。
>
> **纪律**：只报不改。所有结论都有真实命令 + 真实输出；读不清的单独列「未验证假设」。
> 产品源码（`straditize_core/`、`frontend/`、`tests/`）零改动。
>
> **取样对象已按用户修正**：真实业务是「从论文 PDF 提取图版」，纸质扫描件不是关键。
> 故 G-01 以 PDF 内嵌图版为取样对象（原"扫描件"线已放弃）。

---

## 0. 一句话结论

**三条全部未达到投产标准。** 其中两条是**功能性阻断**（用户按正常流程操作会拿不到可用的科学数据），
一条是**契约级缺陷**（导出按钮点击后静默无响应，且后端会抛未捕获异常）。

| 编号 | 判定 | 一句话 |
| :--- | :--- | :--- |
| G-01(a) 真实图版自动提取 | **FAIL** | 真实 2132×928 图版上，刻度齿自动搜索**恒为死代码**（数学可证），一个齿都检不出 |
| G-01(b) PDF 换页状态残留 | **PARTIAL** | 几何/标定正确清空；但 `samples` 曾跨页残留并**改变导出数值**——巡检期间已被队友修复，现复验 PASS |
| G-01(c) 页码 prompt 静默兜底 | **FAIL** | 输入 `abc`/空串/`0` 均静默变第 1 页（已在真实 Edge 上实测） |
| G-02 旧版工程包兼容 | **PASS（但语义有误）** | v2.x 能载入且不丢字段；但 `version` 字段**从未被读取**，任何版本号都放行 |
| G-03 xlsx / LiPD 端到端 | **FAIL** | `export.exportXlsx` 经 HTTP 返回 bytes 导致 **HTTP 连接断开**；两个按钮在前端均不下载 |

---

## 1. 结论绑定的哈希

本次巡检跨约 50 分钟，期间 **backend-fixer 先后两次修改产品源码**
（`core.py`：`40bcf163` → `8e1482f4` → `f28543d3`）。所有结论都已在新哈希上
**重跑复验**，下文每条判定附带的输出均来自最终哈希。

```
git rev-parse HEAD
caaac017c7dbcfdc69393c5be0766a5b0aec169d      （HEAD 未变，改动全在工作区）

sha256（最终结论绑定版本）
f28543d3f23be7a3cd81526e42aea798c784f155e82600f78fe2ceb0a3f9feb5  straditize_core/session_parts/core.py
52e57c65dae67e427f0a37d668c58fdac0ac58278785b6b7a27f52244a0fc5ee  straditize_core/session.py
7bbcc175466593182211a1c0de51a294443d2eee0a1ac947d058762c57f0f721  straditize_core/session_parts/project.py
02988cf67f6fae9f518417d6738b53505b01a53ef582f63da0e989e86ebd59c5  straditize_core/session_parts/xticks.py
fe6834465437968386da612f635fe8149d5b58974f30f40c78db53bba37499a9  straditize_core/session_parts/export.py
5e71ff10676cdeabc615cf4dcab8ad0361ca7e568c201768e3fca68f1ab334cb  straditize_core/session_parts/cleanup.py
0705501b2d8e6f22a741646c3821dbccf8ee8a1cca119608f7be82fe45a098a2  straditize_core/metadata/exporter_lipd.py
75b0e5aec5a110545ddd03a4431b0a8be6cc399a8fc252e0c01296e138cf34db  straditize_core/protocol.py
97f33886fee264145e04bec519d47bdaeb62e58d657441f7c69fba7b69c50b56  frontend/src/services/FileLoaderService.ts
4f94164fc1afa753ce9010d6d733b90676b45996967ad4fd128c8938f04a63f6  frontend/src/components/ExportModal.ts
```

**未随队友改动漂移的证据**：`export.py` / `project.py` / `cleanup.py` /
`exporter_lipd.py` / `protocol.py` / 两个前端文件的哈希在整个巡检期间**始终未变**，
故 G-02 与 G-03 的结论绑定的是巡检开始时的代码状态，无需重跑。
`xticks.py` 有变动，但其 band 搜索循环的夹取条件逐字未变（下方 §3.3 引用的是
当前 `02988cf6` 版本的原文），G-01(a) 结论已在新哈希上重跑确认。

取样 PDF（独立复验，不照抄 Lead 的数字）：

```
F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf
size    = 5743322 B
sha256  = 1490fa09864d6f1eae2eeab9c81cf2e2688fe8a09a3ad82f1b7e3a4c70668969
```

---

## 2. 取样对象家底（独立复验，与 Lead 数字对照）

### 2.1 复验方法上的一个坑

第一次用 `page["/Resources"]["/XObject"]` 手挖位图，得到「第 2/5/7/9 页全部 0 张」——
与后端行为矛盾。改用 `pypdf` 的 **`page.images`**（按 content stream 实际绘制顺序枚举，
含内联图与 Form XObject 递归）后与后端一致。

**这是本团队犯过的同一类错**：用资源字典当"页内位图"的代理指标，而没先验证代理本身。

复现：`pixi run python scripts/prod_gate/g01_pdf_inventory.py`

### 2.2 逐页真值（`page.images`）vs 后端 `load_image`

| 页 | 真实内嵌位图 | 后端行为 |
| -: | :--- | :--- |
| 1 | 3 张：`118x117`, `236x298`, `248x271` | OK → **236x298**（面积最大） |
| 2 | 2 张：`1753x918`, `743x553` | OK → **1753x918**（面积最大） |
| 3,4,6,8,10,11,12,13 | 0 张 | `JsonRpcError` FILE_ERROR |
| 5 | 1 张：`2132x928` | OK → **2132x928** |
| 7 | 1 张：`1424x1836` | OK |
| 9 | 1 张：`1305x1946` | OK |

**多图页 = [1, 2]，零图页 = [3, 4, 6, 8, 10, 11, 12, 13]**（Lead 说的"第 2 页 2 张、第 3 页 0 张"复验属实）。

### 2.3 多图页静默选最大 → 用户无知情权（观察项，非本轮判定重点）

第 1 页 3 张、第 2 页 2 张，后端 `max(imgs, key=area)` **静默**选最大者，返回值里
没有任何"本页有 N 张位图、我选了哪张"的字段：

```
page  1: OK  236x298   format=PDF_IMAGE   pdf_info={'total_pages': 13, 'current_page': 1}
page  2: OK  1753x918  format=PDF_IMAGE   pdf_info={'total_pages': 13, 'current_page': 2}
```

`pdf_info` 只有 `total_pages` / `current_page`。用户在第 2 页可能是想取那张 743×553 的插图，
但软件不会告诉他还有另一张。**建议**：`load_image` 返回 `embedded_images: [{w,h,chosen}]`，
多图时前端明确提示"本页检出 N 张位图，已选最大者，可切换"。

### 2.4 异常文案双句号（真实存在，但成因与 Lead 猜测不同）

```
PDF 解析失败: 该 PDF 第 3 页为纯矢量流未内嵌位图图谱。请将该页在外部导出为 PNG/JPG 图像后载入。。请确认 PDF 包含图谱位图或转为 PNG 后导入。
                                                                                        ^^ 两个句号
```

Lead 猜"两层异常处理各拼一句"。实测成因是**同一个 f-string 内嵌句自带的句号 + 外层模板再加句号**
（`core.py` 第 160-162 行的路径分支）——不是两层 `except` 叠加：抛错后
`except JsonRpcError: raise` 原样上抛，不会被外层再包一层。属文案瑕疵，P3。

---

## 3. G-01(a) 真实图版自动提取 —— **FAIL**

### 3.1 结论

在真实 2132×928 期刊图版上，**刻度齿自动搜索永远不会产出任何结果**。
这不是"算法认不出齿"，而是搜索循环的夹取条件**在数学上恒真**，导致 60 个候选
`(top, band_height)` 组合全部被 `continue` 掉。

### 3.2 复现命令

```bash
pixi run python scripts/prod_gate/g01a_band_deadcode.py
pixi run python scripts/prod_gate/g01a_xticks_mechanics.py
pixi run python scripts/prod_gate/g01a_band_clamp.py
```

### 3.3 真实输出（关键片段）

```
=== 1. 纯数学：对任意 y_bottom，夹取都吃掉全部 60 个组合 ===
    top ∈ [y_bottom-4, y_bottom+15], bh ∈ {6,7,8}, hi_search = y_bottom
    最小 top+bh = (y_bottom-4)+6 = y_bottom+2 > y_bottom = hi_search

    y_bottom=   60  skipped=60/60  tested= 0  全部夹掉
    y_bottom=  233  skipped=60/60  tested= 0  全部夹掉
    y_bottom=  861  skipped=60/60  tested= 0  全部夹掉
    y_bottom=  928  skipped=60/60  tested= 0  全部夹掉
    y_bottom= 2000  skipped=60/60  tested= 0  全部夹掉

    结论：自动 band 搜索是否会产出 band 恒为 False == True
    （不依赖图像内容，也不依赖 ROI 的 y_top，只依赖 hi_search = y_bottom）
```

**证明**：`top` 最小值 `y_bottom-4`，`bh` 最小值 `6`，故 `top+bh ≥ y_bottom+2`；
而夹取条件 `hi_search = min(img_h, round(y_bottom)) ≤ y_bottom`（当 `y_bottom ≤ img_h`）。
因此 `top+bh > hi_search` **恒成立**，`continue` 命中全部 60 个组合。

### 3.4 算法本身是好的——只是被挡住了

```
=== 4. 对照：显式给 band=(869,875) 时，同一图能检出多少齿 ===
    band=(869,875) -> band=[869, 875] per_column=16 有齿列=16 总齿=32
    => 算法本身完全够用；挡住它的是上面那条恒成立的夹取条件。
```

独立像素真值：ROI `x∈[330,1290]` 内真实刻度齿 **46 个**，间隔集中在 25px（26 处）、13px（9 处）、12px（5 处）。
真实齿干位于 `y=869..875`（7px 高），正落在扫描窗口 `[y_bottom-4, y_bottom+15)` 之内。

### 3.5 这是 §4.1 那次修复的副作用（回归）

`production-readiness.md` §4.1 记载：为修「ROI 下方 16px 抓到列框线」，
把搜索窗口夹到 ROI 纵向范围内。修复方向正确，但**夹取的边界取错了**：
它要求整个 band 落在 `[y_top, y_bottom]` 内，而真实刻度尺恰恰在 `y_bottom` **下方**。

实测 ROI 底边与真实齿带的关系：

```
    ROI y1=  861: 能否覆盖真实齿带 top=869,bh=6 -> False
    ROI y1=  876: 能否覆盖真实齿带 top=869,bh=6 -> True   （但 tested 仍为 0）
```

即使用户把 ROI 底边拖到 876，`tested` 仍是 0——因为夹取条件与 `y_bottom` 同步移动，
分母永远追不上分子。**这是一个自指的死循环，不是参数调优能救的。**

### 3.6 回归未破（确认修复需保留的性质）

```
=== 5. 回归未破：hoya（真值 has_tick_ruler=false）仍为 0 齿 ===
    hoya: band=None per_column=0 总齿=0
```

现有门禁 `tests/data/truth/*__x_ticks.json` 里两张有尺子的图仍可检出
（`exaggeration_bell` band=[907,916] 65 齿、`composite_cluster` band=[839,848] 120 齿），
因为 `detect_xticks(band=None)` 会回落到**全图** `_find_tick_band`。
但真实图版在这个全图搜索里也失败——

### 3.7 全图兜底同样失败，原因是底框线污染 bimodal

```
band=(869,875) n_strokes=88 (上限 w*0.5=1066) bimodal=0.3776 (需>=0.97 -> 不过) 超长游程齿=24 (需为0 -> 不过)
    超长游程样本: [(195, 662), (332, 662), (333, 662), (370, 662), (407, 662), (445, 662)]
对照 bell（真值可检出）的同三项：
  band=(907,916) n_strokes=65 bimodal=0.9884 max_run=11
```

`y=869` 是底框线（960px 内 783px 为暗），落进 band 后把绝大多数列的 `col_fill`
拉到 `1/9≈0.111`，既非 `>0.95` 也非 `<0.05`，于是 `bimodal` 崩到 0.38。

**两条路径都断**：ROI 内搜索被夹取条件吃掉，全图搜索被底框线破坏 bimodal。

### 3.8 U-05 第二问：分区线会不会被当刻度齿 —— **不会误判，但前提是 band 高度对齐**

独立实测：图版横向分区线**只有 1–2px 粗**（不是任务书假设的 6px）：

```
full_width_horizontal_lines:
  y=266..266  thickness=1  coverage=1.0
  y=359..359  thickness=1  coverage=1.0
  y=594..595  thickness=2  coverage=1.0
  y=742..743  thickness=2  coverage=1.0
```

把 band 强行套在分区线上时，`_strokes_in_band` **确实会吐出齿**（`y=359 top=356 bh=6 -> 齿数=8`），
但这些齿的纵向游程是 `12/174/371` 级别的长竖线（列框线），会被 `TICK_MAX_RUN=12` 滤掉；
而真正的刻度齿游程恰好是 7。

所以：**「6px 粗分区线被当刻度」这个原始担忧不成立**——真实图版没有 6px 粗线，
且算法用"绝对游程 ≤12"这个判据能正确区分。这条可以从未验证假设里销掉。

### 3.9 自动提取是否命中过多列 —— **ROI 取决于用户怎么框，默认框选会多出 9 列**

同一条链路，两种 ROI 的真实结果：

| ROI 来源 | ROI 范围 | 检出列数 | 与真值（15 个花粉列）对比 |
| :--- | :--- | -: | :--- |
| `load_image` 自动建议 | `[69,1867] × [266,744]` | **25** | 多 9 列（含左侧 Depth/Age 轴、右侧 Tree/Shrubs、CONISS 树） |
| 按图版数据区手框 | `[330,1330] × [233,861]` | **16** | 多 1 列（最右 Tree/Shrubs 柱状图的一部分） |

自动建议的 ROI 还**纵向丢了数据**：

```
默认 ROI 覆盖数据区的比例: 纵向 266..744 / 真值 232..869
  -> 丢了顶部 34px、底部 125px
```

底部 125px 正好吃掉 Zone I（18–14.6 ka）的大部分。**这不是"算法不准"，而是默认 ROI
建议在真实图版上把 15% 的数据区排除在外，且不给任何提示。**

复现：`pixi run python scripts/prod_gate/g01_full_chain.py --roi auto` 与 `--roi measured`。

### 3.10 完整链路其余步骤（手框 ROI 路径）

```
[1] load_image: 2132 x 928
[3] extract_foreground: threshold=138.0 mode=otsu foreground_pixels=271630 foreground_ratio=0.1373
[4] detect_line_candidates -> 9 candidates（4 条 kind=A 横线 + 5 条 kind=B 竖线）
[5] apply_line_removal -> 成功
[6] detect_columns -> 16 列
    hline_rows（被当作网格线剔除的行，ROI 内相对坐标）= [0, 33, 126, 361, 510]
[7] detect_xticks_rpc: band=None per_column=0          ← 见 §3.1
[8] calibrate_column_xticks: 仅 2 列有印刷数字，全部标定成功
[10] digitize: 16/16 列成功，每列 629 点
[11] apply_depth_grid: count=158
[13] export_data(csv): rows=158 cols=17
[14] export_multi_tar: 921600 B success=True
```

除刻度检测外，链路本身（清理 → 分列 → 标定 → 采样 → 导出）在真实图版上**可跑通**。
但 `hline_rows = [0, 33, 126, 361, 510]` 值得注意：ROI 内真实横线在相对坐标
`33 / 126 / 361 / 510`（对应绝对 `266/359/594/743`），另外还多出 `0`——
即 ROI 顶边 `y=233` 被当成网格线剔除了。这条恰好是数据区第一行。

---

## 4. G-01(b) PDF 换页状态残留 —— **PARTIAL →（队友修复后）PASS**

### 4.1 结论

Lead 的怀疑**方向正确，但归因错了**。`_geometry_scope()` 确实只绑
`image_path + width + height`，可 PDF 换页时 `image_path` 会变成 `upload://diagram.png`
（因为 `_decode_diagram_source` 对本地路径返回 `resolved_path`，但换页走的是
`cached_pdf_data` 的 base64 分支，`resolved_path=None`），所以几何反而被正确区分了。

**真正会残留的不是几何，是非几何状态**：`samples`。

### 4.2 E1：真实 PDF 换页（page5 → page7）—— 几何与标定全部清空

```bash
pixi run python scripts/prod_gate/g01b_pdf_switch.py e1
```

```
--- E1 判定：换页后哪些状态活了下来 ---
    n_columns                  before=16        after=0
    cols_with_x_ticks          before=['roi_2_col10', 'roi_2_col11']  after=[]
    is_calibrated              before=True      after=False
    y_scale                    before={'slope': 1.249206...}  after=None
    n_line_candidates          before=9         after=0
    n_selected_candidate_ids   before=4         after=0
    geometry_scope             before={'image_path': 'F:\\Zotero\\...pdf', ...}
                               after ={'image_path': 'upload://diagram.png', ...}   ← 不同
```

### 4.3 E3：构造同尺寸两页 PDF —— 仍是 PASS，但原因不是尺寸

```bash
pixi run python scripts/prod_gate/g01b_pdf_switch.py e3
```

构造 `output/prod_gate/same_size_two_pages.pdf`（两页各嵌一张 2132×928，内容不同）：

```
    page 1: n_images=1 sizes=['2132x928']
    page 2: n_images=1 sizes=['2132x928']
...
    A/B 的 _geometry_scope 是否相同: False
    B 页残留 line_candidates : 0
    B 页残留 x_ticks 的列     : []
    B 页 y_scale             : None
```

**同尺寸 + 同 image_path 的假设场景下仍然不残留**，因为 `image_path` 在换页后
变异成 `upload://diagram.png`，`_geometry_scope` 靠这一维就区分开了。
换言之：**这里 PASS 是"侥幸的 PASS"**——若日后有人把 `image_path` 改成稳定的
"PDF 路径 + 页码"形式（更正确的设计），`_geometry_scope` 就会退化成只有 w/h 两维，
同尺寸页的几何残留会立刻重现。建议在 `_geometry_scope` 里显式加入
`page_number`（或最近一次解码出的位图内容摘要）。

### 4.4 真正的缺陷：`samples` 跨页残留并**改变导出数值**

```bash
pixi run python scripts/prod_gate/g01b4_real_path.py   # 修复前
```

组 A（page5 完整链路 + 粘贴 158 个深度 → switch 到 page9 → page9 完整链路 → 导出）
vs 组 B（全新会话直接 page9）：

```
    switch 后: page=9 size=1305x1946 n_samples=158      ← 158 条深度跨页存活
    A 导出: rows=158  cols=11
    B 导出: rows=1501 cols=11
    A 组深度范围: 0.0 .. 785.0     （page5 的深度！page9 的轴是 0..500）
    B 组深度范围: 0.0 .. 502.681
    A 组数值格: 非零 482  / 总 1580
    B 组数值格: 非零 4992 / 总 15010
    完全一致: False
```

**这是真实用户路径**：`samples_paste_depths` 要求已有 Y 轴标定，会把深度反算成
`row_px`（实测 `rowpx_head = [233, 237, 241, 245, 249]`）。换页后这些 `row_px`
在新图上指向完全不同的位置，导出便拿旧行号配新图数据。

影响：**导出 158 行 vs 1501 行、数值格只有应得的 1/10**，且深度轴上界用错
（785 vs 502）。用户拿到的 CSV 看起来格式正确、深度单调递增，**没有任何报错**。

### 4.5 巡检期间已被队友修复，现复验 PASS

backend-fixer 在 `core.py` 的 `load_image` 复位块里加了 `self.samples = []`
（代码注释明确引用「B-11」）。在新哈希上重跑：

```
    >>> switch_pdf_page(9)
    switch 后: page=9 size=1305x1946 n_samples=0
    A 导出: rows=1501 cols=11
    B 导出: rows=1501 cols=11
    A: (87754, '897323dba019a06d97fff08149424c246b39a84d')
    B: (87754, '897323dba019a06d97fff08149424c246b39a84d')
    完全一致: True
    A 组数值格: 非零 4992 / 总 15010
    B 组数值格: 非零 4992 / 总 15010
```

**判定修正**：该缺陷在 `core.py@8e1482f4` 上已不可复现，**PASS**。
但报告保留 §4.4 的原始取证，因为它证明了「**换页路径的复位清单是逐项手写的**，
漏一项就静默产出错数据」这一结构性风险。同一次修改还补了
`x_scales` / `reader_types` / `shadow_mask` / `solid_layers` / `tick_band` /
`undo_stack` / `redo_stack`——这些漏项此前同样无人验证。

### 4.6 E2：换页到纯矢量页失败后，会话是否"停在原地"

```bash
pixi run python scripts/prod_gate/g01b_pdf_switch.py e2
```

结论：抛 `JsonRpcError` 后会话保持**完好停在 page5**（`pdf_current_page=5`、
`size=(2132,928)`、`n_columns=16`、`y_scale` 不变），失败后 `digitize(0)` 仍能正常取数。
符合不变量 ①「取不到就报错并停在原地」。**PASS**。

---

## 5. G-01(c) 页码 prompt 静默兜底 —— **FAIL**

### 5.1 结论

`frontend/src/services/FileLoaderService.ts:92`：

```ts
const pageNum = Math.max(1, parseInt(inputPage.trim() || '1', 10) || 1);
```

`parseInt` 失败返回 `NaN`，`NaN || 1` → `1`。于是**任何非数字输入都静默变成第 1 页**。
这违反不变量 ①（取不到就报错停在原地，不返回替代数据）的精神：
用户输入 `abc` 时，软件不是"停在原地问清楚"，而是**替他决定看第 1 页**。

### 5.2 真实浏览器实测（系统 Edge + 真实后端，端口 23083）

```bash
pixi run python scripts/prod_gate/g01c_prompt_e2e.py
```

用 `page.on('dialog')` 拦截真实 `window.prompt` 并依次回答：

```
=== case: valid_5  回答=['5'] ===
      type=prompt default='1' answer='5'
      core.loadImage  page_number=5

=== case: nonnumeric_abc  回答=['abc'] ===
      type=prompt default='1' answer='abc'
      core.loadImage  page_number=1          ← 静默变第 1 页

=== case: empty_string  回答=[''] ===
      type=prompt default='1' answer=''
      core.loadImage  page_number=1          ← 静默变第 1 页

=== case: zero  回答=['0'] ===
      type=prompt default='1' answer='0'
      core.loadImage  page_number=1          ← Math.max(1, 0) 静默变第 1 页

=== case: out_of_range_14  回答=['14'] ===
      type=prompt default='1' answer='14'
      core.loadImage  page_number=14         ← 交给后端，后端报页码越界（正确）

=== case: cancel  回答=[None] ===
      loadImage 类 RPC 调用数 = 0            ← 正确取消
```

对比可见：**取消（`null`）被正确处理了**，说明作者知道"用户没给答案"需要单独处理；
但"给了非法答案"却被当成"给了 1"。

### 5.3 复刻解析逻辑的纯函数验证（无需浏览器）

```bash
node -e '
const cases = ["5","abc","","0","-3","1.9","   ","999999999999","٣"];
for (const raw of cases) {
  console.log(JSON.stringify(raw).padEnd(16), "->",
    Math.max(1, parseInt(raw.trim() || "1", 10) || 1));
}'
```

```
"5"              -> 5
"abc"            -> 1     ← 静默兜底
""               -> 1     ← 静默兜底
"0"              -> 1     ← 静默兜底
"-3"             -> 1     ← 静默兜底
"1.9"            -> 1     ← 静默截断
"   "            -> 1     ← 静默兜底
"999999999999"   -> 999999999999   （交给后端，后端会报越界，OK）
```

### 5.4 旁证：后端其实**有**正确的越界报错

```bash
pixi run python scripts/prod_gate/g01_pdf_inventory.py
```

```
page 14（不存在）→ JsonRpcError: 页码超出有效范围：该 PDF 共有 13 页，请求的第 14 页不存在。
              请输入 1 到 13 之间的页码。
```

后端文案完整、可操作。**前端在把输入送进后端之前就把它改写成了合法值**，
等于把后端已有的正确校验架空。

### 5.5 建议修法（不实现，只给方案）

```ts
const raw = inputPage.trim();
const parsed = Number(raw);
if (raw === '' || !Number.isInteger(parsed) || parsed < 1) {
  this.callbacks.reportBackendFailure('PDF 页码',
    new Error(`页码必须是 ≥1 的整数，收到 ${JSON.stringify(inputPage)}。已取消载入，请重试并输入正确页码。`));
  return;
}
const pageNum = parsed;
```

---

## 6. G-02 旧版工程包兼容 —— **PASS（但版本号语义与任务书假设不同）**

### 6.1 任务书怀疑点需要更正

任务书说「`project_save` 写盘固定 3.0.0/3.0（622-623 行），而 manifest 里还有
2.0.0/2.0（517-520 行）——同一次保存里出现两套版本号本身可疑」。

**实测：这不是同一次保存里的两套版本号，而是两个不同对象各自的版本号。**

```bash
pixi run python scripts/prod_gate/g02_project_versions.py v1
pixi run python scripts/prod_gate/g02_project_versions.py v2
```

真实保存一次后拆 tar：

```
--- tar 内文件清单 ---
    manifest.json                      118 B
    straditize.json                  19645 B
    image/original.png               69764 B
    data.csv                          1007 B
    plot_strat.R                       406 B
    README.txt                         575 B

    [manifest.json] 顶层键 = ['schema_version', 'timestamp', 'tool', 'version']
        version = '2.0.0'
        schema_version = '2.0'
        tool = 'straditize pro'
        timestamp = '2026-10-22T16:26:59Z'

    [straditize.json] 顶层键 = ['active_roi_id', 'age_depth', 'columns', ...]
        version = '3.0.0'
        schema_version = '3.0'
```

`manifest.json` 是**归档容器**的清单（`export_multi_tar` 第 217-225 行产出，
按 §8 归档规范订为 2.0.0/2.0），`straditize.json` 是**工程主体**
（`project_save` 第 622-623 行，按 §八 工程格式订为 3.0.0/3.0）。
两者是不同规范的两个对象，各记各的版本号**是正确的设计**，不是缺陷。

> 但两者都叫 `version` 而无命名区分（如 `archive_schema_version`），
> 审阅者极易误读——这正是本次任务书误判的成因。建议改名，P3。

### 6.2 v2.x 能否载入 —— 能，且不丢字段

```bash
pixi run python scripts/prod_gate/g02_project_versions.py v3
```

```
    [v2.0.0/2.0 (原样只是降版本号)] -> OK
        columns=28 is_calibrated=True
        载回后 columns=28 samples=7 y_scale={'slope': 1.625, 'intercept': -830.375...}
        col0.x_ticks=[{'px': 319.0, 'value': 0.0}, {'px': 399.0, 'value': 40.0}]
    [v1.0.0/1.0] -> OK
    [version 缺失] -> OK
    [version 乱码 banana] -> OK
    [v4.0.0/4.0 (未来版本)] -> OK
```

**五种版本号全部放行**。原因：

```bash
grep -n "version" straditize_core/session_parts/project.py
517:            "version": "2.0.0",
520:            "schema_version": "2.0",
622:            "version": "3.0.0",
623:            "schema_version": "3.0",
```

`project.py` 里 `version` **只出现在写盘路径，`project_load` 从不读取它**。
所以"v2.x 能否被正确读入"的答案是：**任何版本号都能被读入，因为根本没有版本门禁**。

### 6.3 真正的老包（缺 v3 字段）也能载入，但语义要看清

```bash
# 模拟真正的 v2 老包：删掉 v3 新增字段
```

```
    本包里存在的 v3 新增字段: ['rois', 'primary_roi_id', 'active_roi_id', 'age_depth',
                              'line_candidates', 'selected_candidate_ids', 'paper_metadata']
    load -> OK  columns=28 is_calibrated=True
    载回后: rois=1 columns=28 samples=7 y_scale={'slope': 1.625, ...}
    默认 ROI = [('roi_1', [315.0, 1946.0], [511.0, 1311.0])]
    col0 属于哪个 roi = roi_1
```

关键：老包没有 `rois`，载回后后端**从遗留的 `roi` 单字段重建出一个 `roi_1`**，
并把所有列归到它名下。列、标定、样本、Y 轴全部保住。

**这是隐式迁移**（不是显式版本分支），工作正常但不可观测：用户与开发者都无法知道
"这份工程是按 v2 语义补出来的还是 v3 原生的"。

### 6.4 往返保真（v3 → load → save）

```bash
pixi run python scripts/prod_gate/g02_project_versions.py v4
```

```
    原包字段数=58  重存后字段数=58
    仅原包有 (0): []
    仅重存有 (0): []
    值改变 (0): []
    版本号：原 3.0.0/3.0 -> 重存 3.0.0/3.0
```

### 6.5 判定与建议

- **PASS**：v2.x 工程包能被当前 `project_load` 正确读入，不丢字段，往返零漂移。
- **须补**（不阻断交付，但阻断"可维护"）：`project_load` 应读取 `version`，
  对 `> 支持上限` 的包**拒绝载入并说明**（当前 v4.0.0 静默按 v3 解析，若将来 v4
  真加了不兼容字段，用户会拿到**被静默丢弃**的工程）。建议：
  ```python
  MAJOR_SUPPORTED = 3
  v = data.get("version") or data.get("schema_version")
  if v and int(str(v).split(".")[0]) > MAJOR_SUPPORTED:
      raise JsonRpcError(INVALID_PARAMS,
          f"该工程包版本 {v} 高于本程序支持的 {MAJOR_SUPPORTED}.x，"
          f"请升级软件后再打开（不降级解析，以免静默丢字段）。")
  ```

---

## 7. G-03 xlsx / LiPD 端到端 —— **FAIL**

### 7.1 结论（两条独立缺陷）

1. **`export.exportXlsx` 经 HTTP 调用会直接断开连接**——返回体里 `data` 是 `bytes`，
   `json.dumps` 抛 `TypeError`，连接被服务端关闭，前端拿到网络错误而非可下载文件。
2. **`export.exportLipd` 返回的是 JSON-LD 字典，从不打包成 `.lpd`（ZIP）**，
   且前端期望的 `res.base64` 永远不存在 → 按钮点击后**不下载、不报错**。

### 7.2 真实输出：session 直调（不带 output_path，与前端同形）

```bash
pixi run python scripts/prod_gate/g03b_rpc_base64.py
```

```
  export_multi_xlsx(output_path=None)
    返回键 = ['data', 'output_path', 'size_bytes', 'success']
    含 base64 ? False
    base64 类型/长度 = NoneType / n/a

  export_multi_lipd(output_path=None)
    返回键 = ['lipd', 'success']
    含 base64 ? False
    含 lipd   ? True
    含 output_path ? False
```

### 7.3 真实输出：HTTP 后端（127.0.0.1:23071）

```
    >>> export.exportXlsx  (前端同形：不传 output_path)
      HTTP 失败: RemoteDisconnected: Remote end closed connection without response

    >>> export.exportLipd  (前端同形：不传 output_path)
      返回键 = ['lipd', 'success']
      含 base64 ? False
      前端 `if (res && res.base64)` 是否会进入下载分支 = False
      >>> 结论：按钮点击后不下载、不报错（前端无 else 分支）
```

后端日志（`output/prod_gate/g03/backend.log`）抓到完整调用栈：

```
Traceback (most recent call last):
  File "straditize_core\rpc_server.py", line 235, in _handle_rpc_post
    response = self.dispatcher.handle_text(post_data)
  File "straditize_core\protocol.py", line 428, in handle_text
    return json.dumps(res, ensure_ascii=False)
  ...
TypeError: Object of type bytes is not JSON serializable
```

### 7.4 根因定位（对照两个同类方法）

`export_multi_xlsx`（第 396-399 行）：

```python
return {
    "success": True,
    "size_bytes": len(xlsx_bytes),
    "output_path": os.path.abspath(output_path) if output_path else None,
    "data": xlsx_bytes if not output_path else None,     # ← bytes，未 base64
}
```

`export_advanced_xlsx`（第 1007-1013 行，**同一类导出**）：

```python
b64 = base64.b64encode(xlsx_bytes).decode("ascii")
return {
    "success": True,
    "size_bytes": len(xlsx_bytes),
    "output_path": os.path.abspath(output_path) if output_path else None,
    "base64": b64 if not output_path else None,          # ← 正确
}
```

`export_multi_tar`（第 325-330 行）也返回 `tar_base64` 字符串。**只有 `export_multi_xlsx`
漏了 base64**，且把契约字段名从 `base64` 写成了 `data`。

前端 `ExportModal.ts:616` 期望 `res.base64`：

```ts
if (res && res.base64) { ...触发下载... }
// 没有 else，也没有报错
```

**三重不一致**：字段名（`data` vs `base64`）、类型（bytes vs base64 字符串）、
缺失编码步骤。任一处修好都能让按钮工作，但只修字段名会让 `atob(bytes)` 继续崩。

### 7.5 `.lpd` 根本不是 LiPD 容器

`export_multi_lipd` 直接 `json.dump(lipd_jsonld, f)` 写纯文本：

```
$ file output/prod_gate/g03/g03.lpd
output/prod_gate/g03/g03.lpd: JSON text data

$ head -c 40 output/prod_gate/g03/g03.lpd
{"@context": "https://linkedearth.github.io/schema/context.json",...
```

而 LiPDverse / NOAA WDS-Paleo 的 `.lpd` 规范是 **ZIP 容器**。仓库里已有正确用法可对照：
`output/zhou_2024_gahai/GHB_Lake_Gahai_2024.lpd` 是 `Zip archive data`，
其生成脚本 `run_digitize_zhou2024.py:357` 显式调了 `package_lipd_archive(...)`：

```python
lipd_res = session.export_multi_lipd(output_path=.../GHB_Lake_Gahai_2024.jsonld)
package_lipd_archive(lipd_res["lipd"], output_path=.../GHB_Lake_Gahai_2024.lpd)
```

**产品 RPC 路径没有这一步**，所以 UI 导出的 `.lpd` 不是合法 LiPD 容器，
paleoData / LiPDverse 工具链读不进去。

### 7.6 内容层面：xlsx 是对的，LiPD 有元数据塌陷

同会话同时导出四份产物后对账（`pixi run python scripts/prod_gate/g03_exports.py`）：

**`.tar` 内 `data.csv` vs `.csv` 直出：完全一致**

```
    tar/data.csv 表头 = ['depth', 'col01', ..., 'col16']
    tar/data.csv 行数 = 79
    表头一致 = True
    行数一致 = True   数值格差异数 = 0
```

**`.xlsx` 独立打开（openpyxl，非写出方自证）：表头与数值一致**

```
    sheet 数 = 3
      [meta_info] 列数=5 数据行=19
          表头 = ['Category', 'Field', 'Value', 'Source', 'Confidence']
      [Ngamring] 列数=17 数据行=79
          表头 = ['depth', 'col01', 'col02', ...]
      [readme] 列数=2 数据行=5
```

xlsx 是真能打开、真有三张表、数据行数与 tar 一致。**这一半是好的。**

**但 LiPD 元数据塌陷**：

```
  datasetName = 'Unnamed_Site_Y._2026'      ← 应为 Ngamring_...
  geo.siteName = 'Unnamed_Site'             ← 应为 Ngamring Co
```

我在会话里明确写入过：

```python
s.metadata_update({"site": {"name": "Ngamring Co", "latitude": 29.3, "longitude": 85.3}, ...})
```

最小复现（不依赖完整导出）：

```bash
pixi run python -c "
import sys, json; sys.path.insert(0,'.')
from straditize_core.session import StraditizeSession
s=StraditizeSession(); s._init_cleanup()
s.metadata_update({'site':{'name':'Ngamring Co','latitude':29.3,'longitude':85.3}})
pm=s.paper_metadata
print(\"paper_metadata['site'] =\", json.dumps(pm.get('site'), ensure_ascii=False))
print('exporter_lipd.py:39 取 site.get(\"site_name\") ->', repr((pm.get('site') or {}).get('site_name')))
print('实际存的是 site[\"name\"]              ->', repr((pm.get('site') or {}).get('name')))
"
```

真实输出：

```
paper_metadata['site'] = {"site_name": "", "country": "", "latitude": 29.3, "longitude": 85.3,
                          "elevation_m": "", "water_depth_m": "", "core_length_m": "",
                          "archive_type": "lake sediment", "collection_date": "",
                          "name": "Ngamring Co"}

exporter_lipd.py:39 取 site.get("site_name") -> ''
实际存的是 site["name"]              -> 'Ngamring Co'
```

`metadata_update` 把用户给的 `name` **原样塞进** `site["name"]`，而 `site["site_name"]`
保持初始空串。`exporter_lipd.py:39` 的 `site.get("site_name") or "Unnamed_Site"`
于是拿到空串（falsy）→ 回落 `Unnamed_Site`。**站点名静默塌陷**，
且 `datasetName` 连带变成 `Unnamed_Site_Y._2026`。

`authors_first` 的另一个独立问题：`exporter_lipd.py:45` 用 `.split()[-1]`：

```
'Han Y.' -> 'Y.'
'Liu L.' -> 'L.'
'Sun Z.' -> 'Z.'
```

对西式"姓 首字母"格式取到的是**首字母**而非姓，故 `datasetName` 形如
`<站点>_Y._2026`。中文姓名（`San Zhang` → `Zhang`）反而是对的——
这是一个只在西式姓名上错的**方向性错误**。

**这是不变量 ① 的直接违反**：元数据取不到时应报错，而不是返回 `Unnamed_Site` 这种
看起来合法的占位值——用户会把它写进论文的 LiPD 存档。

数值部分是正确的（`depth` 79 值、`col01..` 单位 `%`、`depth` 单位 `cm`）：

```
    depth units= cm n= 79 values[:3]= [0.0, 10.0, 20.0]
    col01 units= % n= 79 values[:3]= [0.0, 0.8097, 0.8097]
```

### 7.7 判定拆分

| 子项 | 判定 | 说明 |
| :--- | :--- | :--- |
| xlsx 文件本身可打开、列名/深度列与 tar 一致 | **PASS** | openpyxl 独立读回，0 差异 |
| `export.exportXlsx` 作为 RPC 可用 | **FAIL** | HTTP 断开（bytes 不可 JSON 序列化） |
| xlsx 按钮在真实 UI 可用 | **FAIL** | 前端要 `res.base64`，后端给 `data: bytes` |
| LiPD 数值列与 tar 一致 | **PASS** | 79 行 × 17 列，单位正确 |
| `.lpd` 是合法 LiPD 容器 | **FAIL** | 写的是纯 JSON，不是 ZIP |
| LiPD 元数据保真 | **FAIL** | `siteName`/`datasetName` 静默塌陷为 `Unnamed_Site` |
| LiPD 按钮在真实 UI 可用 | **FAIL** | 前端要 `res.base64`，后端从不返回 |

---

## 8. 未验证假设（不与已确认发现混计）

| # | 假设 | 为什么没验 |
| - | :--- | :--- |
| U-1 | `_geometry_scope` 在"image_path 稳定"的前提下会让同尺寸页几何残留 | E3 里 `image_path` 变异成 `upload://diagram.png`，无法构造该场景；需先改产品才能测 |
| U-2 | 多图页（page 1/2）用户真正想要哪张 | 无地面真值；只能证明"静默选最大且不告知" |
| U-3 | `hline_rows` 把 ROI 顶边 `y=233` 当网格线剔除是否影响首行读数 | 未逐格比对"剔与不剔"的导出差异 |
| U-4 | `x_scales`/`reader_types`/`shadow_mask`/`tick_band` 的跨页残留是否曾造成错值 | 队友已在同一提交里修复，无法在旧哈希上重建（旧哈希基线已不可得） |
| U-5 | 真实图版上 25 列里哪些是"用户不想要"的 | 需要领域判断（Tree/Shrubs 柱状图对某些研究也是有效数据） |

---

## 9. 距离投产还差什么（按阻断程度排序）

### 阻断级（用户按正常流程操作会拿到错数据或拿不到数据）

1. **刻度齿自动检测在真实图版上完全失效**（§3.1）
   `session_parts/xticks.py` 的 band 搜索循环夹取条件恒真，60 个候选全被跳过。
   修法：把 `hi_search` 的语义从"band 必须完全落在 ROI 内"改成
   "band 的**起点**必须在 ROI 内，允许越过 `y_bottom` 下方一个 band 高度"
   （即 `top <= hi_search`，而非 `top + bh <= hi_search`），同时保留
   `TICK_MAX_RUN` 对长竖线的过滤——这才是真正区分"列框线"与"刻度齿"的判据。
   修完必须用 hoya（应仍 0 齿）+ 真实图版（应得 46 齿）双向验证。

2. **`export.exportXlsx` RPC 一调就断连**（§7.3）
   `export_multi_xlsx` 返回 `bytes`。修法：照 `export_advanced_xlsx` 的写法
   `base64.b64encode(...).decode("ascii")` 放到 `base64` 字段。

3. **`export.exportLipd` 从不打包 ZIP，且元数据静默塌陷**（§7.5、§7.6）
   ① RPC 层调 `package_lipd_archive` 产出真 ZIP；② `exporter_lipd.py:39`
   的 `site.get("site_name")` 与 `metadata_update` 存的 `site["name"]` 键名对齐；
   ③ 取不到时**报错**而非填 `Unnamed_Site`。

4. **两个导出按钮在前端均无反应且不报错**（§7.4）
   `ExportModal.ts:616/652` 的 `if (res && res.base64)` 缺少 `else` 分支——
   任何响应形态不符都应 `notifyError`。这条单独成立，即使后端修好，
   也应对"响应缺 base64"显式报错，否则下次契约漂移还是静默。

### 高（会让科研数值错，但不必然发生）

5. **PDF 换页页码静默兜底为 1**（§5）
   输入 `abc`/空串/`0` 静默载入第 1 页。后端已有正确越界报错，前端把它架空了。

6. **默认 ROI 建议在真实图版上排除 15% 数据区且不提示**（§3.9）
   纵向丢 34px + 125px，Zone I 大部分被排除；却仍报 25 列"可用"。

### 中（可维护性 / 可观测性）

7. **`project_load` 无版本门禁**（§6.5）——未来版本包会被静默降级解析。
8. **`manifest.json` 与 `straditize.json` 的 `version` 同名不同义**（§6.1）——
   本次任务书自己就误判了，说明这个命名会持续引发误判。
9. **多图页静默选最大位图**（§2.3）——用户不知道本页还有别的图。
10. **`_geometry_scope` 当前靠 `image_path` 变异侥幸区分换页**（§4.3）——
    建议显式加入 `page_number`，避免日后"修好 image_path"反而引入残留。

### 低（文案）

11. 异常文案双句号「。。」（§2.4）。

---

## 10. 复跑方式

```bash
# 取样家底（独立真值 + 后端逐页行为）
pixi run python scripts/prod_gate/g01_pdf_inventory.py

# G-01(a) 刻度检测在真实图版上的失效（含数学证明 + 端到端复核）
pixi run python scripts/prod_gate/g01a_band_deadcode.py
pixi run python scripts/prod_gate/g01a_xticks_mechanics.py
pixi run python scripts/prod_gate/g01a_band_clamp.py

# G-01 完整链路（两种 ROI 对照）
pixi run python scripts/prod_gate/g01_full_chain.py --roi measured
pixi run python scripts/prod_gate/g01_full_chain.py --roi auto

# G-01(b) 换页残留
pixi run python scripts/prod_gate/g01b_pdf_switch.py all
pixi run python scripts/prod_gate/g01b2_state_leak.py
pixi run python scripts/prod_gate/g01b4_real_path.py

# G-01(c) 页码 prompt（需 frontend/dist 已构建；用系统 Edge）
pixi run python scripts/prod_gate/g01c_prompt_e2e.py

# G-02 工程包版本与 v2 兼容
pixi run python scripts/prod_gate/g02_project_versions.py all

# G-03 xlsx / LiPD
pixi run python scripts/prod_gate/g03_exports.py
pixi run python scripts/prod_gate/g03b_rpc_base64.py
```

端口占用：`23071`（G-03 HTTP）、`23083`（G-01(c) HTTP），均在 23000-23099 巡检段内，
未触碰 22902 / 22920-22930。

产物目录 `output/prod_gate/`（gitignore，仅本机存在）。

---

# 附录 A：Lead 指派的三项补充复验（2026-10-23 第二轮）

> 本节按 Lead 的指派新增，**不改写上方任何已确认的旧节**。
> A 项（复验 backend-fixer 的 G-01a 修复）待其落地后另起一节。

## A.0 本轮绑定的哈希

```
git HEAD = caaac017c7dbcfdc69393c5be0766a5b0aec169d
d524ace7ab6bf4ca754c9bd221aed4c7c0e6b5f37ca40b257ed1b2182a5af2dd  session_parts/core.py   （又变，见下）
fe6834465437968386da612f635fe8149d5b58974f30f40c78db53bba37499a9  session_parts/export.py （未变）
7bbcc175466593182211a1c0de51a294443d2eee0a1ac947d058762c57f0f721  session_parts/project.py（未变）
02988cf67f6fae9f518417d6738b53505b01a53ef582f63da0e989e86ebd59c5  session_parts/xticks.py （未变）
cf8209c364759ba9e376fcbb23c4c77aab8034d6f0ca5ad389472cf89ab7b998  frontend/src/core/ProjectManager.ts
```

`core.py` 在本轮期间从 `f28543d3` 变为 `d524ace7`（backend-fixer 仍在改）。
B-01 的硬编码值位于 `core.py:813-814` 与 `:837-838`，已在新哈希上复跑，结论不变。

---

## B. 复验 Lead 的两条新发现

### B-12 就绪清单从不检查标定 —— **CONFIRMED（判定 FAIL）**

```bash
pixi run python scripts/prod_gate/b_lead_findings.py t1
```

| 场景 | `get_export_readiness()` | 真实 `calibrated` 列数 | 是否一致 |
| :--- | :--- | -: | :--- |
| hoya 零输入（只分列） | `ready=True, missing=[]` | **0 / 28** | **不一致** |
| hoya 全部列真实标定 | `ready=True, missing=[]` | 28 / 28 | 一致 |
| 真实图版 16 列，仅标定 1 列 | `ready=True, missing=[]` | **1 / 16** | **不一致** |

```
  [hoya 零输入（只分列，零标定）]
    get_export_readiness -> ready=True  readiness_missing=[]  total_rois=1
    列总数 = 28   真正 calibrated 的列 = 0/28
    source 分布 = {'legacy': 28}
```

`source` 分布是关键证据：零输入时 28 列**全部**走 `legacy` 分支（即硬编码 0/20），
`resolve_column_scale` 明确返回 `calibrated=False`，而就绪清单照样 `ready=True`。

**与 Lead 口径的差异（如实记录）**：Lead 说 29 列，我得 28 列。
差异来自我的 `detect_columns([315,1946],[511,1311])` 调用方式；
列数是 ROI 相关量，不影响「0 标定仍放行」这个结论。

**根因确认**：`export.py:171-203` 的 `get_export_readiness` 只对每个 ROI 检查
`name_source == "default"` 与 `len(cols) == 0`，**从不调用 `resolve_column_scale`**，
因此 `calibrated` 状态根本不进入判定。

**危害**：步骤 8 的"就绪"徽章会让用户以为可以导出。配合 B-01（下条），
用户导出的是**硬编码 0→20 量程**下的数值，且界面全绿。

### B-01 硬编码 `startValue=0.0 / tickValue=20.0` 污染**全部四份产物** —— **CONFIRMED 且范围比 Lead 测的更大**

位置（`core.py:813-814` 与 `:837-838`，两处分支各一份）：

```python
"startValue": 0.0,
"tickValue": 20.0,
```

```bash
pixi run python scripts/prod_gate/b_lead_findings.py t2
```

前置校验（先验证代理再测对象）：`val0=0` 时换算公式 `value = val0 + (x-px0)/(px1-px0)·(val1-val0)`
严格正比于 `val1`，所以「比值精确等于 tickValue 之比」是合法的强判据。实测三列：

```
      col1: calibrated=False source=legacy val0=0.0 val1=20.0  px0=319.0 px1=399.0
      col2: calibrated=False source=legacy val0=0.0 val1=20.0  px0=497.0 px1=577.0
      col3: calibrated=False source=legacy val0=0.0 val1=20.0  px0=728.0 px1=808.0
```

tickValue 20 → 200，**四份产物**逐格对照：

```
    [csv 直出]
      行3: tick20=[2.5, 31.0, 0.75]  tick200=[25.0, 310.0, 7.5]  比值=[10.0, 10.0, 10.0]
    [tar 内 data.csv]
      行2: tick20=[2.5, 31.0, 0.75]  tick200=[25.0, 310.0, 7.5]  比值=[10.0, 10.0, 10.0]
    [xlsx 数据表]
      行2: tick20=[2.5, 31.0, 0.75]  tick200=[25.0, 310.0, 7.5]  比值=[10.0, 10.0, 10.0]
    [LiPD paleoMeasurementTable]
      col03: tick20=[0.25, 0.25, 0.75]  tick200=[2.5, 2.5, 7.5]  比值=[10.0, 10.0, 10.0]

    --- T3 判定 ---
      期望比值（tickValue 之比）= 10.0
      csv  : 全部比值=[10.0 ×9]  是否精确等于 10.0: True
      tar  : 全部比值=[10.0 ×9]  是否精确等于 10.0: True
      xlsx : 全部比值=[10.0 ×9]  是否精确等于 10.0: True
      lipd : 全部比值=[10.0 ×9]  是否精确等于 10.0: True
```

**Lead 没做的那部分结论**：不只 csv —— **tar 内 data.csv、xlsx、LiPD 三份产物
全部同比例污染，无一幸免**。这条把 B-01 的影响面从"导出 csv 错"扩大到
"**所有交付格式都错**"，包括本来要进论文存档的 LiPD。

### 新增：`startValue` 不只是加性偏移 —— 它同时改变斜率（Lead 未测）

```bash
# T4 对照组：只动 startValue（0 -> 10）
```

```
    行1: start0=[0.25, 0.25, 0.25]  start10=[10.125, 10.125, 10.125]  差=[9.875, 9.875, 9.875]
    行3: start0=[2.5, 31.0, 0.75]   start10=[11.25, 25.5, 10.375]     差=[8.75, -5.5, 9.625]
```

第 1 行差恒为 9.875（像纯加性），第 3 行差却是 `8.75 / -5.5 / 9.625` ——
**差值随读数变化**。数学上清楚：`value = val0 + t·(val1-val0)`，`val0` 同时进入
截距与斜率项，故不是单纯平移。

**修复含义**：`startValue` 与 `tickValue` **必须一起处理**，
不能只改 `tickValue`。（若只钉住 `tickValue` 而 `startValue` 仍为硬编码 0，
对柱状图尚可，但一旦有人把硬编码 0 也"调整"成别的值，同样的静默错误会重演。）

---

## C. 补 Lead 漏掉的两个测点

### C1 `image_path` 退化 —— **不影响工程包保存，但暴露两个新问题**

```bash
pixi run python scripts/prod_gate/c1_image_path_clean.py a
```

```
  page 1 载入后 image_path = 'F:\Zotero\storage\HV4FXL63\Han Y.-2026-...pdf'
           cached_pdf_path  = 'F:\Zotero\...pdf'
  page 2 换页后 image_path = 'upload://diagram.png'   <- 退化
           cached_pdf_path  = None
```

**Lead 的问题「是否影响工程包保存」的答案：不影响，但原因值得记。**

```
    image_keys     = ['base64', 'height', 'path', 'width']
    image.path     = image/original.png
    顶层含 image_path 的键 = []
    顶层含 pdf 的键 = []
    顶层含 page 的键 = []
    退化值 'upload://diagram.png' 是否出现在工程包文本里: False
```

`project_save` 的 `image.path` 恒为字面量 `image/original.png`，底图以 base64 独立内嵌，
与 `image_path` 无关。所以退化**只影响会话内 scope**，不污染工程包。

**新问题 1（可观测性，P2）**：工程包**不记录任何 PDF 溯源**——`image` 只有
`path/width/height/base64`，没有源 PDF 路径，也没有页码。
一份从 PDF 第 5 页提取的工程，载回后无法自证出自哪个 PDF 的哪一页。
这对科研可复现性是实质缺陷（论文图表数字化本应能回溯到图版来源）。

**新问题 2（真缺陷，P1，见 C1b/C1d）**：`project_load` 载回后 `image_path = None`，
这使 `_geometry_scope()` 的 token 退化为 `{'image_path': None, 'width': W, 'height': H}`。
两个**同尺寸的不同工程**载回后 token 完全相同。实测：

```bash
pixi run python scripts/prod_gate/c1_image_path_clean.py b
```

```
    A 的 geometry_scope = {'image_path': None, 'width': 1200, 'height': 800}
    B 的 geometry_scope = {'image_path': None, 'width': 1200, 'height': 800}
    >>> A 与 B 的 scope 是否相同: True
        （相同 = 防线在这条路径上失效）
```

### C1d 顺带挖到一个更重的缺陷：`project_load` 不替换已存在的底图 —— **FAIL（新发现）**

用判别性对照排除"是我测试写错"：

```bash
pixi run python scripts/prod_gate/c1b2_load_replaces_image.py
```

```
  === 基准：只载入 B ===
      载入后会话像素 sha256_16 = 06012901fd5cd8dd   独立统计：>75% 宽的暗行数 = 0
  === 对照：先载入 A，再载入 B ===
      A: 会话像素 sha256_16 = 3166e120340e82e6   暗行数 = 8  at [150,151,350,351,550,551,750,751]
      B: 会话像素 sha256_16 = 3166e120340e82e6   暗行数 = 8  at [150,151,350,351,550,551,750,751]
         <- 载入 B 后像素 sha 与 A 完全相同，B 自己的底图被忽略
```

真实 UI 路径（前端 `ProjectManager.ts:641-651` / `:678-682` 会显式把底图塞进
`project_data.image.base64` 再调 `project.load`）：

```bash
pixi run python scripts/prod_gate/c1d_real_ui_path.py
```

```
  === 场景 1（基线）：空白会话 project_load 工程包 ===
    会话图像 = (1920, 1000)  sha16=d23876b401344eeb  贯穿横线=6
  === 场景 2（真实 UI）：先载入 hoya，再 project_load 同一工程包 ===
    载入 hoya 后：(2339, 1654)  sha16=4372d520ba2c73b6
    project_load 后：(2339, 1654)  sha16=4372d520ba2c73b6   <- 没换
    期望：1920x1000 且 3 条横线
    实际：(2339, 1654) 且 4 条横线
    >>> 底图是否被替换: False
```

**根因**（`project.py:434-443`，非推断，是唯一解释上述两组对照的代码）：

```python
if (
    isinstance(img_meta, dict)
    and img_meta.get("base64")
    and getattr(self, "image", None) is None      # <-- 会话已有图时整段跳过
):
```

**危害**：用户在会话里已经有图（正常使用中必然如此），打开工程包后
**列、标定、ROI 全部换成了工程包的，底图却还是上一张**。
ROI 的 `xlim` 来自工程包（实测载回后 `xlim=[[0,1920]]`），却作用在 2339×1654 的旧图上
—— 用户会在错的底图上看到对的 ROI 框，随后所有读数都基于错图的像素。

这条比 G-03 的 xlsx 断连更危险：xlsx 至少会断连（失败可见），
这条是**看起来完全正常**的错位。

**判定**：新增缺陷，**FAIL**。修复建议（不实现）：
```python
if isinstance(img_meta, dict) and img_meta.get("base64"):
    # 工程包自带底图时，它才是权威：即便会话里已有图也要替换
    ...
```
`.tar` 路径不受影响（`project.py:219` 在进入 `project_load(parsed)` 之前
直接 `self.image = img_obj`），所以这是 **JSON 路径独有**的不一致——
同一个功能两条路径行为不同，本身也是缺陷。

### C2 `export.exportXlsx` 传 `output_path` 时**不再断连** —— 修复面是一处

```bash
pixi run python scripts/prod_gate/c_lead_checks.py c2
```

```
  >>> export.exportXlsx  不传 output_path
      断连/失败: RemoteDisconnected: Remote end closed connection without response
  >>> export.exportXlsx  传 output_path
      返回键 = ['data', 'output_path', 'size_bytes', 'success']
      data 类型 = NoneType
      base64 存在 = False
      未断连

  --- 后端日志里的 TypeError 次数 ---
    'Object of type bytes is not JSON serializable' 出现 1 次
    传 output_path 那次同时写出文件了吗: True  (89757 B)
```

**答案**：这是「**仅无 `output_path` 时崩**」，不是"只要返回就必崩"。
传 `output_path` 时 `data=None`（`export.py:398` 的 `xlsx_bytes if not output_path else None`），
可正常 JSON 序列化，且文件真写出 89757 B。

因此修复面只有**一处**：把 `export_multi_xlsx` 的
`"data": xlsx_bytes` 改成 `"base64": base64.b64encode(xlsx_bytes).decode("ascii")`
（照同文件 `export_advanced_xlsx` 第 1007-1013 行的写法）。

**但前端的第二个缺陷独立存在且仍需单独修**：`ExportModal.ts:616` 判 `res.base64`，
传 `output_path` 时后端返回的是 `output_path` 而不是 `base64`，
前端仍不会下载。两条都要修，只是**后端只需改一处**。

---

## D. 本轮新增/变更的四态判定汇总

| 条目 | 判定 | 依据 |
| :--- | :--- | :--- |
| B-12 就绪清单不查标定 | **FAIL** | 0/28 与 1/16 两种未标定场景均 `ready=True` |
| B-01 硬编码 0/20 污染导出 | **FAIL** | csv/tar/xlsx/LiPD **四份产物**比值精确 10.0 |
| B-01 附带：startValue 同时改斜率 | **新增发现** | 差值随读数变化（9.875 vs 8.75/-5.5/9.625） |
| C1 退化对工程包保存的影响 | **PASS** | 退化值不进工程包 |
| C1 附带：工程包不记录 PDF 溯源 | **FAIL（新）** | `image` 只有 path/width/height/base64 |
| C1d `project_load` 不替换已有底图 | **FAIL（新，P1）** | 两组对照均显示载入后像素 sha 不变 |
| C2 xlsx 传 output_path 边界 | **PASS（仅无路径时崩）** | `data=None` 时不断连，文件真写出 |

## E. 本轮复跑命令

```bash
pixi run python scripts/prod_gate/b_lead_findings.py t1     # B-12
pixi run python scripts/prod_gate/b_lead_findings.py t2     # B-01 四产物对账 + startValue 对照
pixi run python scripts/prod_gate/c1_image_path_clean.py a  # image_path 演化 + 工程包溯源
pixi run python scripts/prod_gate/c1_image_path_clean.py b  # 跨工程 scope 混淆
pixi run python scripts/prod_gate/c1b2_load_replaces_image.py  # 判别性对照：项目载入是否换图
pixi run python scripts/prod_gate/c1d_real_ui_path.py          # 真实 UI 路径复现
pixi run python scripts/prod_gate/c_lead_checks.py c2          # xlsx output_path 边界
```

端口：C2 用 `23086`，在 23000-23099 段内。

## F. 本节新增的未验证假设

| # | 假设 | 为什么没验 |
| - | :--- | :--- |
| U-6 | 前端 `.tar` 路径是否真的绕过了 `image.base64` 守卫 | 我验了 `.json` 路径（场景 2/3）；`.tar` 路径需真实浏览器上传 .tar，本轮未做 |
| U-7 | `project_load` 不换图的缺陷在真实 Edge UI 上是否被 `onProjectLoad` 前端镜像掩盖 | 需前端 E2E；后端已证伪，前端是否"看起来正常"未验 |
| U-8 | 生产环境中"用户先载图再开工程包"的频率 | 无使用数据；从 UI 流程看是主路径（工具栏常驻"打开工程"） |

---

# 附录 B：三处前端兜底链的真实影响面（2026-10-23 第三轮）

> 本节回答 Lead 的问题：**若后端 `detect_columns` 不再返回 `startValue` / `tickValue`，
> 用户在画布与 inspector 上看到的是什么？** 结论用于决定 B-01 全量修复的方向
> （保留字段但标 provenance，还是彻底移除字段并同步改前端）。
>
> 不改写上方任何已确认的旧节。

## B.0 绑定哈希

```
git HEAD = caaac017c7dbcfdc69393c5be0766a5b0aec169d
5b8a9ce6396d49b8ccf99a56117c940be5b0f7e25d607db7583551fb2c177ca9  frontend/src/services/RpcClient.ts
ac69f0d8383fe1a3657436c54b82553b06b6cdd87214f531b24bf89a280bd784  frontend/src/core/CoordinateSystem.ts
02438d591db8ccd6c5162e0da0a3d1e17c1ffca8efb9bad160c33e9c87889ce3  frontend/src/components/GeologyCanvas.ts
cf8209c364759ba9e376fcbb23c4c77aab8034d6f0ca5ad389472cf89ab7b998  frontend/src/core/ProjectManager.ts
```

本次**未改动任何产品源码或 `frontend/dist`**：所有实验通过
「后端 shim 重新注册 RPC 方法」与「Playwright 驱动真实 Edge」完成。

**一处并发情况须记录**：`frontend/dist/` 在巡检期间（`00:55:50`）被他人在工作区重新构建
（整个 `dist/` 目录 mtime 一致，是 vite build 的产物；我从头到尾未运行 npm / vite）。
本节的**决定版结论**（`a2d`）产生于 `01:10`，晚于该次重建，故绑定的是重建后的 dist。
被我推翻的三个中间版本（`a2b` 约 00:55-00:58、`a2c` 约 00:58-01:00）可能跨越该重建时刻，
但它们**不用于取证**，仅作「我为何推翻它们」的过程记录（见 §B.5）。

---

## B.1 结论先行

**你的担心（"会从 20 变成 100"）在有 UI 实测支撑的路径上 *没有* 发生；
但它没有发生的原因不是兜底链健全，而是另一条你没列到的兜底接住了。
真实风险比"变 100"更隐蔽：变成后端自己算出来的占位值。**

| 场景 | 用户在步骤 6 看到 | 说明 |
| :--- | :--- | :--- |
| 后端**正常**返回 `startValue=0, tickValue=20` | `X1=0`，`X2=20` | 对照组 |
| 后端**完全不发**这两个字段 | `X1=0`，`X2=20` | **与对照组完全相同** |

也就是说：**移除字段后用户看不出任何变化**——这恰恰是最危险的状态，
因为它意味着"显示 20"根本不代表"后端说了 20"。

---

## B.2 为什么不是 100 —— 决定性的链路

你列的三处兜底里，`RpcClient.ts:838` 的 `c.tickValue || 100` 确实会产出 100。
但它发生在 **`detectColumnsInRoi`** 这条路径上（`RpcClient.ts:818-841`）。
而步骤 6 面板读的 `data.columns` 来自**另一条**路径
（`RpcClient.ts:412-476` 的 `getDiagramData`），那条路径：

*(`RpcClient.ts:413-476` 的原文注释明确写着「这里只做结构映射，不补任何默认值」，
列对象原样来自后端，完全不经过 `|| 100`。)*

而后端 `straditize.getDiagramData` 会**自己算出**两个替代值
（`rpc_methods/system.py:155-166`）：

```python
"startValue": scale.val0,
"tickValue": scale.val1,
"scaleCalib": {
    "originX": scale.abs_px0, "originVal": scale.val0,
    "calibX": scale.abs_px1,  "calibVal": scale.val1, ...
},
"tickEndX": scale.abs_px1,
"maxPercent": max(scale.val0, scale.val1),      # ← 关键
```

`scale` 来自 `resolve_column_scale`，在 legacy 分支返回
`val0 = col_dict["startValue"]`、`val1 = col_dict["tickValue"]`（`xscale.py:283-292`）。
所以：**只要后端的列字典里还有这两个字段，`getDiagramData` 就会把它们复制回来；
即使剥掉，`maxPercent = max(0, …)` 仍会保留一个数值外形。**

实测印证（`scripts/prod_gate/a2d_backend_shim.py`，shim 让后端真的不发字段）。

两组在**同一次运行、同一条件**下取得（`stage` 均为 6，UI 均读到值）：

```
=== case: control  STRIP_FIELDS='' ===
    网络响应里含 startValue = True
    网络响应里含 tickValue  = True
    步骤6后 getDiagramData: nCols=28 含startValue=True 含tickValue=True
      首列 = {"startValue": 0, "tickValue": 20, "startX": 319, "endX": 497,
              "maxPercent": 20, "tickEndX": 399, "x_ticks": null}
    UI stage=6  val1='0'  val2='20'

=== case: stripped  STRIP_FIELDS='startValue,tickValue' ===
    网络响应里含 startValue = False      ← 网络层确证：真的没发
    网络响应里含 tickValue  = False
    步骤6后 getDiagramData: nCols=28 含startValue=False 含tickValue=False
      首列 = {"startX": 319, "endX": 497, "maxPercent": 20, "tickEndX": 399, "x_ticks": null}
    UI stage=6  val1='0'  val2='20'      ← 用户看到的与对照组一模一样
```

**`maxPercent: 20` 就是那个接住的东西。** 它是后端用
`max(scale.val0, scale.val1)` 算出来的——而 `scale.val1` 之所以是 20，
是因为 `core.py:813-814` 的硬编码 `tickValue: 20.0` 还在。
换句话说：**B-01 的硬编码是"经 B-12 的就绪放行 + getDiagramData 的复制 + XTicksPanel 的 ?? 20"
三层串联后才显示给用户的**，任何单点移除都会被另一层补上同样的数字。

---

## B.3 三处兜底的真实优先级（实测 + 代码对齐）

| 位置 | 兜底表达式 | 在本路径上是否生效 | 依据 |
| :--- | :--- | :--- | :--- |
| `RpcClient.ts:838` | `c.tickValue \|\| 100` | **不生效**（该路径不是步骤 6 的数据源） | `getDiagramData` 不经此映射 |
| `CoordinateSystem.ts:140` | `col.tickValue ?? sc?.calibVal ?? col.maxPercent ?? 20` | 链路中存在，被上游抢先 | `col.tickValue` 由后端填入，`??` 不触发 |
| `GeologyCanvas.ts:1535` | `col.maxPercent ?? col.tickValue ?? 20` | **生效**（`maxPercent` 由后端给） | 实测首列 `maxPercent: 20` |
| `XTicksPanel.ts:131` | `activeCol?.tickValue ?? 20` | 末端显示 | 实测 val2='20' |

所以 `?? 20` 这个"看起来在兜底"的字面量，在正常数据下**从未被执行过**——
它给人的"有兜底"的安全感是假的。真正决定显示值的是后端的 `maxPercent` 与
`tickValue`，而这两个又都源自 `core.py` 的硬编码。

---

## B.4 对 B-01 全量修复方向的建议（基于实测，非偏好）

**两个方向都不能单独成立，必须先加 provenance 再谈移除。**

1. **只移除字段 → 不可行。** 实测显示移除后显示值不变（仍是 20），
   但原因换成了 `maxPercent` 兜底。用户与开发者都无法分辨
   "这 20 是图版上的真实刻度"还是"这是 `core.py:814` 的常量"。
   **等于把缺陷藏得更深**——移除前至少 `startValue/tickValue` 字段名字面上
   还提示了这是 legacy，移除后就只剩一个孤零零的 `maxPercent: 20`。

2. **只改前端兜底 → 不可行。** 你已判断 `|| 100` 改错会更离谱（100 比 20 更远离真值），
   实测也证实 `100` 那条路径当前根本没被走到；改它是在修一条不在关键路径上的代码。

3. **可行方向：后端显式标注 provenance，前端据此决定"显示数值"还是"显示未标定"。**
   `resolve_column_scale` 已经返回 `calibrated` 与 `source`（`legacy` / `x_ticks` /
   `x_scales` / `default` / `group`）——**这两个字段就是现成的 provenance**，
   只是没有下发到前端。建议 `getDiagramData` 每列增加：
   ```python
   "scale_provenance": {"calibrated": scale.calibrated, "source": scale.source},
   ```
   前端在 `XTicksPanel` 里据此渲染：`calibrated=False` 时输入框显示
   `未标定（建议值 20，来源：图版默认）` 而不是裸的 `20`。
   这样既保留兼容（不破坏现有字段），又让"这个 20 是谁给的"变成可见事实，
   并为将来真正移除字段铺路（前端已能区分两种情形）。

---

## B.5 本轮的方法论失误（如实记录，第三次同类）

这一轮我先后写了 **4 个探针版本**才得到可信结论，前 3 个都被自己推翻：

| 版本 | 做法 | 为什么不算数 |
| :--- | :--- | :--- |
| A2a | 抓页面上的 `%` 文本 | **代理指标**：页面满是无关百分比（缩放 10%~1000%、"100% 原始物理分辨率"），无法判定列量程 |
| A2b | fetch 钩子剥字段 | 钩子记录的是**剥离前**内容，日志 `hasTick=True` 是假象 |
| A2c | 钩子 + 深剥 + 方法日志 | 改了响应却得到 `stripped=6, nCols=0`——钩子把结构改坏了，实验条件不成立 |
| A2d | **后端 shim 重新注册 RPC** | ✅ 网络层可证"真的没发"，且不改 dist 不改源码 |

教训与你和我在前两轮各自踩的是同一条：**对照组必须能证明自己改到了那个变量**。
A2b/A2c 里我"以为剥掉了"，但没有任何一层证据能证明前端真的收到了剥离后的响应；
A2d 才用 `networkHasStartValue=False` 这个网络层断言把实验条件钉死。

另外补一条本轮学到的：**"剥掉了字段"和"剥掉了字段对渲染的影响"是两件事**，
前者可以断言，后者必须再读一次用户可见的 DOM（`inp-manual-tick-val2` 的 `value`）。

---

## B.6 本轮新增未验证假设

| # | 假设 | 为什么没验 |
| - | :--- | :--- |
| U-9 | 画布上（非 inspector）的量程标签是否与 inspector 同源 | 需 OCR 或 canvas 像素分析；本轮只读 DOM input |
| U-10 | `ProjectManager.ts:264/312` 的 `?? 100` 在草稿恢复路径上是否改变落库值 | 那条路径需真实草稿文件触发，本轮未构造 |
| U-11 | 若同时移除 `maxPercent`，显示会落到 `?? 20` 还是报错 | 需再改一次 shim，本轮为控制变量未叠做 |

## B.7 复跑命令

```bash
# 决定版（后端 shim，网络层可证"真的没发"）
pixi run python scripts/prod_gate/a2d_backend_shim.py

# 中间版本（保留以便复核我为何推翻它们，不用于取证）
pixi run python scripts/prod_gate/a2_frontend_fallback.py
pixi run python scripts/prod_gate/a2b_visible_range.py
pixi run python scripts/prod_gate/a2c_data_source.py
```

端口：`23091`（a2）、`23092`（a2b）、`23093`（a2c）、`23094/23095`（a2d 两组），
均在 23000-23099 巡检段内。

---

# 附录 C：把「对照组没改到变量」沉淀成可执行检查（2026-10-23 第四轮）

> 本轮不改产品代码、不新增取证。产出一个**给下一轮用的防错工具**：
> `scripts/prod_gate/probe_sensitivity_check.py`。
>
> 动机：本团队（含本报告作者）在投产巡检里连续犯过**三次同一个错**——
> 探针没有证明自己真的改到了那个变量，就下了结论。口号没用，把它变成断言。

## C.1 三次同类失误（事实清单）

| # | 谁 | 探针 | 错法 | 后果 |
| - | :--- | :--- | :--- | :--- |
| 1 | 本报告作者 | `g01_pdf_inventory.py` 首版 | 用手挖 `/Resources/XObject` 当"页内位图"的代理 | 得出"第 2/5/7/9 页全 0 张"，与真值（1/2/1/1 张）相反 |
| 2 | Lead | C1d 复验首版 | "基准"也设成"先载 A 再 load B" | 两组都先载 A → 两组都得到 A → 无判别力，白跑一次 |
| 3 | 本报告作者 | A2a / A2b / A2c | A2a 抓页面 `%` 文本当量程；A2b 钩子记录的是**剥离前**内容；A2c 钩子把响应结构改坏（`stripped=6, nCols=0`） | 三次都得不出可信结论，直到 A2d 改用后端 shim 才成立 |

三者结构完全相同：**处理组与对照组在被操纵的变量上并无差异（或差异无法证明），
结论却按"有差异"来写。**

## C.2 工具做的事

`probe_sensitivity_check.py` 对每对已登记的「对照/处理」产物做三项断言：

| 断言 | 检查内容 | 失败含义 |
| :--- | :--- | :--- |
| **S1** | 处理组在**被操纵的那个变量**上确实不同于对照组 | 假对照 —— 这对没有判别力 |
| **S2** | 两组**都**读到了观测值（无 None/空） | 差异可能来自"一边没读到"而非处理效果 |
| **S3** | 观测值是否真的产生差异 | 若相同，必须显式论证"为什么结论仍成立"，否则判为不可用 |

S3 是最关键的一条：**两组观测值相同时，"处理无影响"与"探针不灵敏"是两个完全不同的
结论，而数据本身分不开它们。** 工具不替你判断，但强制你把这一对标为
`NON_DISCRIMINATING` 并写出论证，否则拒绝通过。

## C.3 实测输出

```bash
pixi run python scripts/prod_gate/probe_sensitivity_check.py
```

```
### A2d 断路器：后端不发 startValue/tickValue
  S1 对照组确已改变变量: PASS  (control=True -> treated=False)
  S2 两组都读到观测值: PASS  (5 个观测量)
       网络层是否含 startValue: control=True  treated=False
       getDiagramData 是否含 startValue: control=True  treated=False
       getDiagramData 首列 maxPercent: control=20  treated=20
       用户可见 X2 (inp-manual-tick-val2): control='20'  treated='20'
       UI 所处步骤: control='6'  treated='6'
  S3 观测有差异: PASS  (2/5 项不同)

### G-01b4 samples 跨页残留（修复后复验）
  **该对照对无效，不可作为取证依据**
    原因：当前两个 csv 均为修复后重跑产物，sha1 相同（897323db…），
          且修复前那次差异产物已被覆盖。它们只能证明"修复后 A/B 一致"，
          不能证明"该探针能测出差异"。

结论：有 1 项未通过或未解释，相关结论不得直接采用。
```

退出码 `1`（无管道时实测）。`--list` 列出已登记对，`--self-test` 跑金丝雀。

## C.4 金丝雀：这个检查器自己会失败吗

一个从不失败的门禁等于没有门禁。`--self-test` 构造一对**故意无效**的对照
（treated 是 control 的完整副本，即"以为改了其实没改"，正是上述三次失误的形态）：

```bash
pixi run python scripts/prod_gate/probe_sensitivity_check.py --self-test
```

```
SELF-TEST：构造一个'对照组没改到变量'的假对照，确认本检查器能抓出
  S1 判定 = False  (control=True -> treated=True)
  结果：**抓到了** —— 本检查器对'假对照'具备灵敏度
```

退出码 `0`（自测通过）。

## C.5 我自己这一轮又踩了一次（如实记录，第四次）

写本节前我回读 `a2d_control.json` 时发现：那次 control 运行受浏览器
`ERR_NO_BUFFER_SPACE` 影响，`out.stage` / `out.val1` / `out.val2` **全为 None**
（`trail` 里 9 个 stage 也全是 None）。而我在附录 B 里写的"两组完全一致"，
实际是拿**更早一次 a2b 运行**的 control 数字去配 a2d 的 treated 数字——
**两组不是同一次运行、条件也不同**，正是同一类错误。

处理：重跑 `a2d_backend_shim.py`，取得同一次运行、两组 `stage` 均为 6、
UI 均读到值的有效对照对，并据此改写附录 B §B.2 的表述
（已核对：结论本身不变——两组 `val2` 都是 `'20'`，变化的是取证严谨性）。

**这一条正是本工具 S2 要拦的东西**：任一组观测值为 None，这对就不构成有效对照。
工具存在之后，这种"拿两次不同运行的数字硬凑"会在第一步被拦下。

## C.6 工具的局限（诚实说明）

1. **只检查已登记的对。** 它不能自动发现"该有对照却没有"的探针。
   通用解法是每个动态探针自报 `manipulated_variable` 与 `expected_observable`，
   再由本工具核对。本轮**没有**改造全部 25 个探针——那会侵入已有取证脚本，
   风险大于收益。目前只覆盖**出过事的**与**最重要的**对。
2. **它只证明"这对观测有判别力"，不证明结论正确。** 后者仍需人来判断。
   脚本末尾会打印这句，避免使用者误解。
3. 对 `G-01a` 这类"数学恒等式 + 反向对照"型结论，S1/S2 不适用
   （没有"两组"），只能靠 `if_not_discriminating` 里写明反向对照在哪。
   这是本工具的结构性局限：它偏向"有对照对"的探针范式。

## C.7 复跑

```bash
pixi run python scripts/prod_gate/probe_sensitivity_check.py             # 检查
pixi run python scripts/prod_gate/probe_sensitivity_check.py --list      # 列出登记对
pixi run python scripts/prod_gate/probe_sensitivity_check.py --self-test # 金丝雀
```

新增登记对只需在 `PAIRS` 里加一条，声明
`control / treated / manipulated / probe_signal / observables / discriminating /
if_not_discriminating` 七个字段。

---

# 附录 D：C1e 四种修复方案的判别性实验 + 需补对照的探针清单（2026-10-23 第五轮）

> 两件：① 用判别性实验回答 Lead 的"C1e 该选哪个方案"；② 按 Lead 要求列出
> 「结构上需要对照但目前没有」的探针清单。
>
> 只报不改。本轮产品源码零改动。

## D.0 绑定哈希与一个前提说明

```
git HEAD = caaac017c7dbcfdc69393c5be0766a5b0aec169d
840ef295c00d9f0ffa137a425481905d6ce810074ea5f088bcd1d80b7f32310b  session_parts/cleanup.py
3cb8a0d15abf2630eb059e44349765b500c5cc5fb8672fbe65f37e574fda9da3  session_parts/project.py
d524ace7ab6bf4ca754c9bd221aed4c7c0e6b5f37ca40b257ed1b2182a5af2dd  session_parts/core.py
```

**前提说明**：我开始这一轮时，backend-fixer 已在 `cleanup.py` 中**实现**了图像指纹方案
（`_image_fingerprint()` + `_geometry_scope()` 返回 `{fingerprint, width, height}`）。
因此本节的"方案 B"不是假想方案，而是**当前工作区代码的真实行为**；
A/C/D 三种则通过构造对应形态的工程包来模拟（不改产品代码）。

## D.1 判别性实验设计

方案的有效性必须**同时**满足两条相反的要求——只满足一条都是错的：

| | 要求 | 若不满足 |
| :--- | :--- | :--- |
| **R1 不能误杀** | 载入工程包后，包里已确认的清理几何必须继续生效 | C1e 没修好 |
| **R2 不能放行** | 载入包后换一张不同的图（哪怕同尺寸、同文件名），旧几何必须失效 | B-03 立的跨图防御被破坏 |

三个场景，每个方案都要过：

```
S1  空会话载入包 P_A                     -> 几何应生效      （测 R1）
S2  载入包 P_A，再载入包 P_B（同尺寸异图）  -> P_B 上几何应失效（测 R2）
S3  载入包 P_A，再 loadImage(同尺寸异图)   -> 几何应失效    （测 R2）
```

**只有 S1=生效 且 S2=S3=失效 的方案合格。** 只测 S1 的方案看起来"修好了"，
却可能把 R2 一起破坏——这正是 Lead 担心"重写 scope 是掩盖失配"的技术含义。

## D.2 实测矩阵

```bash
pixi run python scripts/prod_gate/c1e_scheme_discriminator.py
```

构造两张**同尺寸（1200×800）不同内容**的图：A 有 3 条贯穿横线，B 只有 1 条。
`fpA=27917769af0f429d…`，`fpB=e7f0a90a79a3a907…`

`eff` = 生效的 removed 几何条数；`px` = 这些几何实际剔除的墨迹像素数。

| 方案 | S1（应生效） | S2（应失效） | S3（应失效） | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| 当前（几何**不带** scope） | eff=3 px=3600 | eff=3 **px=1214** | eff=0 px=0 | **S2 失败** |
| **A 包里记路径** | eff=3 px=3600 | eff=3 **px=1214** | eff=0 px=0 | **S2 失败** |
| **B 图像指纹**（当前代码） | eff=3 px=3600 | eff=0 **px=0** | eff=0 px=0 | **✅ 四项全对** |
| C pack_id | eff=3 px=3600 | eff=3 **px=1214** | eff=0 px=0 | **S2 失败** |
| D 重写 scope | eff=3 px=3600 | eff=0 px=0 | eff=0 px=0 | 行为全绿，但**机制上是掩盖**（见 §D.4） |

**结论：只有 B（图像指纹）既修好 C1e 又保住跨图防御。**

> 注意 D 那一行：它在**行为矩阵上四格全绿**。如果判据只有"跑一遍看绿不绿"，
> D 会被判为合格并写进结论——这是本表最容易误读的地方。因此我把这组对照
> 登记进 `probe_sensitivity_check.py` 时**额外加了一条机制性判据**
> （`MECHANICALLY_UNSOUND`），让 D 即使行为全绿也标为 ⚠️ 不合格：
> 详见 §D.4 与 §D.8。

## D.3 S2 的失败是真·跨图误删（不是数字游戏）

对上表里 `px=1214` 那一格做像素级定位（`当前` 方案，载包 A 后载包 B）：

```
载入包A后: fp= 27917769af0f429d 几何数= 3
载入包B后: fp= e7f0a90a79a3a907 几何数= 3      <- 图换了，几何还在
被剔除像素总数 = 1214
被剔除像素所在行 = [200, 400, 600]
```

B 图**只在 y=400 有内容**（1 条横线）；A 的几何记的是 y=200/400/600。
所以 B 图上被剔除的 1214 像素里，**y=200 与 y=600 两行是凭空误删**——
用户在图 B 上什么都没确认过，却有两处墨迹被静默抹掉。

基线对照（B 图无几何时）：墨迹 7181 像素，剔除 **0**。
所以 1214 完全来自 A 的残留几何。

## D.4 四条判据的解读（为什么 D 不能选）

| 方案 | 为什么不合格 |
| :--- | :--- |
| A 包里记路径 | 包里记的路径只解决"同机同路径"；一旦图内容变了（同名覆盖、换机器、导出重存），路径仍相等 → S2 放行。**它把身份绑在来源上，而来源不是身份。** |
| C pack_id | 产品的 `_geometry_in_scope` 只认 `image_scope.fingerprint` 与旧格式的 `image_path`；`pack_id` 是无 scope（第 3 档"视为在范围内"）→ S2 放行。**要让它生效必须先改判定逻辑**，而一旦判定改成"pack_id 相同即生效"，同 pack 内换图依旧无法区分（同一个包可以内含不同图？当前实现不会，但这是把正确性寄托在"包永不被改"上）。 |
| **D 重写 scope** | 它让 S1/S2/S3 全绿，但**绿的方式是"把几何的 scope 改成当前 scope"**——等于宣布"任何几何都属于当前图"，跨图防御被关掉。它能过 S2 只是因为测试里我重写成 A 的 scope、而载入 B 后 B 的 scope 与它不同；**换一个实现方式（每次载图都重写）就会连 S2 一起放行**。这正是"掩盖失配"的定义：不是让判定正确，而是让判定失去内容。 |
| **B 图像指纹** | 唯一让"是不是同一堆像素"成为**可判定事实**的方案。载入带图工程包 → 像素逐字节相同 → 指纹相同 → 几何复活（R1）；换任何一张图 → 指纹不同 → 几何失效（R2）。不依赖路径、文件名、包 id 这些**代理**。 |

**对 Lead 倾向的回应**：你倾向 B 或 C、不倾向 D —— 实测支持 B，但**不支持 C**。
C（pack_id）在「载入包后换一张不同的图」时与 A 一样放行（S2 = `px=1214`），
因为 `pack_id` 描述的是"哪个包"，而不是"哪堆像素"。同一个包被替换内嵌图、
或用户在包基础上继续换图，pack_id 都不变。

## D.5 一个必须一起处理的遗留问题（实测发现，非推断）

`_geometry_in_scope` 的第 3 档是：

> **完全没有 scope：视为在范围内（历史行为）**

这条是 S2 里 A/C/"当前"三方案放行的**共同原因**。它的存在有正当理由
（老工程包里的几何本来就不带 scope，拒绝会让它们全部失效），但它意味着：

**任何绕过 `image_scope` 记录路径写进去的几何，都会无条件在任意图上生效。**

建议（不实现）：`_geometry_scope()` 已经能给出指纹，那么在**保存**工程包时
给所有几何补写指纹；**载入**旧包（几何无 scope）时，若当前会话已有指纹，
可考虑"补绑当前指纹"并记一条 provenance（`scope_backfilled: true`），
而不是永久依赖"无 scope 即放行"。这样第 3 档可以逐步收窄为"仅当当前会话
也没有指纹时才放行"。

## D.6 需补对照但目前没有的探针清单（Lead 要求）

以下探针**结构上应该有成对/多组对照**，但当前只有单次运行或单调断言。
不要求改造，仅列入口，供下一轮按需补。

| 探针 | 现有证据形态 | 缺什么对照 | 优先级 |
| :--- | :--- | :--- | :--- |
| `g01_full_chain.py` | `--roi auto` / `--roi measured` 两次独立运行 | 两次运行**未配对登记**（未进 `PAIRS`），且未断言"两组的列数/丢失像素必须不同" | 高 |
| `g01b_pdf_switch.py` E1 | 单次换页前后快照 | 缺"不换页"的对照（证明快照本身稳定，而非任何操作都会清空） | 中 |
| `g01b2_state_leak.py` | 单组（page5→page9） | 缺"page5→page5"对照（证明残留来自换页，而非 `samples_set` 未生效） | 中 |
| `g01c_prompt_e2e.py` | 6 个输入 case，各自独立 | 缺"后端直接收 page_number=1 与 14"的对照（区分前端兜底 vs 后端校验）——注：该项实际已在 `g01_pdf_inventory.py` 覆盖页码越界，但两者未交叉登记 | 低 |
| `g02_project_versions.py` v3 | 六种版本号变体各自 load | 缺"字段被丢弃"的断言：目前只证明"能载入"，**没证明字段值一致** | 高 |
| `g03_exports.py` | 四产物同会话导出并逐格对账 | 已有对照，但未登记进 `PAIRS`；且缺"故意改一个值确认对账能发现差异"的金丝雀 | 高 |
| `g03b_rpc_base64.py` C2 | 传/不传 `output_path` 两组 | **已是有效对照**，未登记进 `PAIRS` | 中 |
| `c1_image_path_clean.py` a/b/c | b 有 A/B 跨工程对照 | 未登记进 `PAIRS`；`a`/`c` 是单调观测（无对照） | 中 |
| `c1d_real_ui_path.py` | 场景1（空会话）/ 场景2（已有图） | 有对照，但 `c1b2_load_replaces_image.py` 才是判别版；两者未交叉登记 | 中 |
| `a2b/a2c`（已废弃） | 曾试图剥字段 | 已被 `a2d` 取代，**不建议再补对照**，保留作反面教材即可 | — |

**清单里最值得补的两条**（若只能补两个）：

1. `g02_project_versions.py` 的字段级断言——目前"能载入"被写成 PASS，
   但**没有断言载回后的字段值与包内一致**。我在主报告 §6.3 用的比对是手工跑的，
   没固化成断言。这是"用存在性代替相等性"的典型代理指标风险。
2. `g03_exports.py` 的对账金丝雀——那套逐格对账目前从未失败过，
   无法证明它真的能发现差异。应注入一个已知改动（如把某格 +1）确认报红。

## D.7 复跑

```bash
pixi run python scripts/prod_gate/c1e_scheme_discriminator.py
# 明细：output/prod_gate/c1e/c1e_matrix.json
```

无端口占用（纯后端进程内实验）。

## D.8 把这组对照固化：行为绿 ≠ 机制对

`c1e_scheme_discriminator.py` 的矩阵已登记进 `probe_sensitivity_check.py`
（`PAIRS` 里的 `special: "c1e_matrix"`），运行：

```bash
pixi run python scripts/prod_gate/probe_sensitivity_check.py
```

```
### C1e 方案判别：载包A后载入同尺寸异图B（应失效）
  方案矩阵（eff：S1 应=3, S2/S3 应=0）
    ❌ 当前(无scope几何)   S1=3  S2=3  S3=0
    ❌ A_包里记路径        S1=3  S2=3  S3=0
    ✅ B_图像指纹          S1=3  S2=0  S3=0
    ❌ C_pack_id           S1=3  S2=3  S3=0
    ⚠️ D_重写scope         S1=3  S2=0  S3=0
       行为绿但机制不成立：它把几何 scope 改写成当前图，等于声明
       "任何几何都属于当前图"；换一种实现（每次载图都重写）就会连 S2 一起放行。
       判据：让判定失去内容 ≠ 让判定正确。
  合格方案: ['B_图像指纹']
```

**这里有一个方法论要点值得单独记**：D 在行为矩阵上是四格全绿。
只用"跑一遍看绿不绿"当判据，D 会被判合格并写进交付建议。
所以我在登记这组对照时加了 `MECHANICALLY_UNSOUND` 这条**机制性判据**——
它与 S1/S2/S3 是不同层次的检查：

| 判据 | 问的问题 |
| :--- | :--- |
| S1/S2/S3 | 这对**观测**有没有判别力 |
| 机制性判据 | 让观测变绿的那个**手段**是否仍保有原本要判定的内容 |

这是本轮在"探针灵敏度"之外发现的第二类失效模式：**探针灵敏、观测真实、
矩阵全绿，但结论所依赖的机制已经被架空。** 它比前三类更难发现，
因为所有数字都指向"通过"。

## D.9 本轮复跑是否踩过同类问题（如实记录）

本轮我又踩了一次与"代理指标"同源的问题，值得记下：

写 `c1e_scheme_discriminator.py` 时，我的 `img_fp()` 返回
`hexdigest()[:16]`（截断到 16 字符）。产品的 `_geometry_in_scope`
对 `fingerprint` 做**精确字符串相等**比较，而 `_geometry_scope()`
返回的是完整 64 字符。于是第一版矩阵里"B 图像指纹"方案在 S1 显示 `eff=0`
——看起来像"指纹方案连 C1e 都没修好"。

我差点据此报告"B 方案失效"。查证后发现是**我的测试用了截断值当指纹**，
即又一次"用代理指标代替按定义的对象"（指纹的定义是完整 sha256，
而我用了它的前 16 位）。修正为完整值后矩阵才正确。

这条说明：**探针工具本身也需要被验证**，否则它会把"我的 bug"报成"产品的 bug"。
`probe_sensitivity_check.py` 的 S1/S2/S3 检查不到这一类（它检查的是对照关系，
不检查探针内部实现是否正确）。这是它已知的盲区，已记入 §C.6 的局限。

## D.10 对 Lead 决策的直接回答

| 你的倾向 | 实测结论 |
| :--- | :--- |
| 倾向 B（指纹）或 C（pack_id） | **支持 B，不支持 C**。C 在「载包后换同尺寸异图」时与"当前实现"一样放行（S2 `px=1214`，实测误删 y=200/600 两行墨迹）。pack_id 描述的是"哪个包"，不是"哪堆像素"。 |
| 不倾向 D（重写 scope） | **同意，且给出了比"直觉"更硬的依据**：D 在行为矩阵上全绿，只有机制性判据能把它挡住。若团队日后有人重提 D，用 §D.8 的 `MECHANICALLY_UNSOUND` 判定即可反驳。 |
| B 是否完全够用 | 行为上够（四项全对）。但**必须同时处理 §D.5 的第 3 档遗留**：「无 scope 视为在范围内」是 A/C/当前三方案放行的共同原因。指纹方案本身不引入新风险，但那条遗留让"绕过 image_scope 写入的几何"仍无条件生效。 |

---

# 附录 E：S0 层——探针内部实现自证（2026-10-23 第六轮）

> 两件：① 补上 `probe_sensitivity_check` 的已知盲区（S1/S2/S3 检查不到
> "探针自己量错了"）；② 把 `g02` / `g03` 两条待补项**登记成可追踪文件**
> （Lead 要求"别只是报告里的一句话"）。
>
> 只报不改。本轮产品源码零改动。

## E.0 绑定哈希

```
git HEAD = caaac017c7dbcfdc69393c5be0766a5b0aec169d
63f88ec408f280d350ddf485b51a3ac80adf4210c02807975d5f55ac09b96695  session_parts/cleanup.py
3cb8a0d15abf2630eb059e44349765b500c5cc5fb8672fbe65f37e574fda9da3  session_parts/project.py
```

## E.1 为什么需要 S0（三次事故的共同形状）

`probe_sensitivity_check.py` 的 S1/S2/S3 检查「对照关系有没有判别力」，
**不检查探针内部实现是否正确**。这个盲区已被三次真实事故证实：

| # | 谁 | 探针内部错在哪 | 表面症状 |
| - | :--- | :--- | :--- |
| 1 | 本报告作者 | `hexdigest()[:16]` 截断后当指纹；产品做完整 64 字符精确比较 | 矩阵里"指纹方案 S1 `eff=0`"，像产品没修好 |
| 2 | Lead | `project_save(format='json')` 只在传 `output_path` 时才内嵌 `image.base64`（`project.py:686-694`） | "指纹为空"，像产品没修好 |
| 3 | 本报告作者 | 手挖 `/Resources/XObject` 当"页内位图" | "第 2/5/7/9 页 0 张"，与真值相反 |

三次都是**探针自己错了，却报成产品的错**。S1/S2/S3 全拦不住——
对照关系可以完全成立，只是探针量的不是它声称量的东西。

## E.2 S0 要求探针声明什么

对每个探针，强制声明三件事，并由脚本用**已知真值**反验：

| 要素 | 内容 | 失败含义 |
| :--- | :--- | :--- |
| **E1 `asserted_object`** | 这个探针断言的是什么对象？必须是"按定义的对象"，不能是代理 | 断言的东西和声称的东西不是一回事 |
| **E2 `known_truth`** | 用一个**答案已知**的输入跑同一段代码，结果必须等于那个答案 | 无法证明探针有分辨能力 |
| **E3 `assertion_strength`** | `equality` / `existence` / `behaviour`；若为 `existence` 必须说明为何够用 | 用"字段存在"冒充"值相等" |

E2 是"先验证代理本身"的可执行形态——也就是本团队三次事故都没做的那一步。

## E.3 实测输出

```bash
pixi run python scripts/prod_gate/probe_self_evidence.py
```

```
### 1. c1e_scheme_discriminator.py :: img_fp()
  断言对象: 图像的 sha256 内容指纹（完整 64 hex），与产品 _image_fingerprint() 同一定义
  曾被代理: 曾用 hexdigest()[:16] —— 指纹的前缀，不是指纹
  E2 已知真值反验: PASS  同图: product==mine -> True (len 64 vs 64); 异图: product!=product_b -> True

### 2. 所有走 project_load 的探针 :: 包内是否有图
  断言对象: 工程包 image.base64 字段是否真实存在（=载入后 image 是否为 None）
  曾被代理: 曾用'文件非零字节'/'project_save 成功'当作'包里有图'
  E2 已知真值反验: PASS  传 output_path 是否含 base64 = True; 不传时 = False;
                        检查器能否分辨两者 = True

### 3. _geometry_scope() / 指纹缓存
  E2 已知真值反验: PASS  hoya=fea547fe7e0d4afc… beginner=df5ef616986c1485…
                        两者不同=True（若相同则缓存未失效，机制被架空）

### 4. 指纹失效：覆盖全部 6 处 self.image 赋值路径
  E2 已知真值反验: PASS  直接赋值改变指纹=True; rotate 改变指纹=True;
                        hoya!=beginner=True; 载回包后指纹==包内图=True

### 5. c1e_scheme_discriminator.py 源码
  E2 已知真值反验: PASS  img_fp 的 return 语句 = 'return hashlib.sha256(
                        im.convert("RGBA").tobytes()).hexdigest()'

### 6. g02_project_versions.py :: v3 版本变体
  **未达标（PENDING）**：只断言存在性，未断言载回后字段值与包内逐值相等

### 7. g03_exports.py :: 四产物逐格对账
  **未达标（PENDING）**：从未失败过，无法证明它真能报红

结论：0 项未通过，2 项已登记待补（PENDING 不计入失败）。
```

退出码 `0`。

## E.4 第 4 项：顺便独立验证了 backend-fixer 的指纹缓存修复

Lead 本轮实测产品曾因 `_image_fingerprint_cache` 从不清空，使 hoya 与 beginner
两张完全不同的图指纹相同（都是 `fea547fe7e0d4afc`）。
**行为上"换图后几何失效"仍是绿的**（因为 `load_image` 另清了几何），
所以行为测试看不出来——正是 D 那一格的形态。

现在产品改为 `image` **property setter** 自动作废缓存（`session.py:200-228`）。
我实测四条路径全部正确：

```
1) load hoya            fp= fea547fe7e0d4afc
2) 直接赋 self.image     fp= 7b668a8163cd175a   变了=True
3) load->rotate(15)     fp: fea547fe… -> 7f0b663b…  变了=True
4) hoya->beginner->载回 hoya 包
   hoya       = fea547fe7e0d4afc
   beginner   = df5ef616986c1485   变=True
   载回包后    = fea547fe7e0d4afc   应等于 hoya : True
```

第 4 条的「载回包后指纹精确回到 hoya」正是 **C1e 修好的直接证据**：
包内图与源图逐字节相同 → 指纹相同 → 包里几何复活。

**为什么 property 比"记得去清"更好**（backend-fixer 的判断我认同并有实测支撑）：
`self.image = ...` 全仓 6 处赋值点，靠手写清单已漏过 `line_candidates`（B-03）
与 `samples`（B-11）。做成 setter 后任何赋值路径（含将来新增的）都无法绕过。

## E.5 待补项登记成文件（Lead 要求）

新建 `docs/findings/production-gate-open-items.md`，把 P-1/P-2/P-3 写成
**可追踪条目**，每条含：文件+行号、当前断言、缺什么、为什么危险、证据等级、
**验收条件**、判据类型、优先级。

与代码双向对应：`probe_self_evidence.py` 的 `REGISTRY` 里 `pending: true`
的两项直接对应 P-1 / P-2。代码里 `pending` 不计入失败，但显式打印
「未达标（PENDING）」，并声明**对应结论只能作为"存在性"证据，不能作为"保真"证据**。

摘要：

| 编号 | 条目 | 判据类型 | 优先级 |
| :--- | :--- | :--- | :--- |
| P-1 | `g02` v3 段用存在性代替相等性（`y_scale` 只 print 不断言） | `existence` → 应升 `equality` | P2 |
| P-2 | `g03` 逐格对账从未失败过（无金丝雀，`float()` 异常可能被吞） | `behaviour` 需金丝雀 | P2 |
| P-3 | `_geometry_in_scope` 第 3 档「无 scope 视为在范围内」 | 产品改动，需 Lead 排期 | P2 |

## E.6 金丝雀：这个 S0 检查器自己会失败吗

```bash
pixi run python scripts/prod_gate/probe_self_evidence.py --self-test
```

```
SELF-TEST：构造一个'截断指纹'的假探针，确认本检查器能抓出
  完整指纹前16 = 239f59ed55e737c7
  截断值 == 完整值 ? False  (期望 False)
  真实反验函数是否发现长度不一致 ? True
  结果：**抓到了** —— 截断与完整不可等同，且反验函数能分辨
```

退出码 `0`（自测通过）。

## E.7 本轮修正 S0 自身的一次问题（如实记录）

第 5 项（`c1e` 脚本源码检查）第一次跑是 **FAIL**。原因是我的正则扫了整段函数体，
而 `img_fp` 的 docstring 里为了说明"不能截断"必然出现 `[:16]` 字样，
被我的检测误判成"实现里残留截断"。

改成只检查 **return 语句**后通过。这条本身是个小教训，且与主题同型：
**判据要指向被断言的对象，docstring 不是 return 语句。**
若我当时图省事把判据放宽成"函数体里不含 `[:16]`"，就会变成一条
永远可能误报、最终被人关掉的坏门禁。

## E.8 三层检查体系（至此完整）

| 层 | 脚本 | 问的问题 | 何时失效 |
| :--- | :--- | :--- | :--- |
| **S0** | `probe_self_evidence.py` | 探针**内部的断言**对不对（对象/真值/强度） | 探针量的不是它声称量的东西 |
| **S1/S2/S3** | `probe_sensitivity_check.py` | 这对**观测**有没有判别力 | 对照组没改到变量 / 一边没读到 / 无差异却当有影响 |
| **机制性判据** | （同上，`MECHANICALLY_UNSOUND`） | 让观测变绿的那个**手段**是否仍保有原本要判定的内容 | 矩阵全绿但机制被架空 |

三层覆盖三种不同失效模式。仍**未覆盖**的：结论本身的科学判断（工具不替人做）。

## E.9 复跑

```bash
pixi run python scripts/prod_gate/probe_self_evidence.py              # S0 检查
pixi run python scripts/prod_gate/probe_self_evidence.py --list       # 列登记项
pixi run python scripts/prod_gate/probe_self_evidence.py --self-test  # 金丝雀
pixi run python scripts/prod_gate/probe_sensitivity_check.py          # S1/S2/S3 + 矩阵
```

无端口占用。

---

# 附录 F：B-06 验收探针——「照这个测会红」的对照（2026-10-23 第七轮）

> Lead 指派：用 S0 + S1/S2/S3 + 机制性判据三件套验 B-06（Ctrl+Z 撤不回列标定），
> 并特别要求一个别人容易漏的点——**必须断言 undo 后再次 undo 仍为 None**，
> 以及机制性判据「让 undo 生效的手段是否同时保证快照独立」。
>
> 本轮交付：`scripts/prod_gate/b06_undo_probe.py`。
>
> **⚠️ 本节经过一次重要修正（2026-10-23 02:0x，Lead 指出）**：探针第一版在
> backend-fixer 修复后报 **5/5 PASS**，其中 **P4 与 P5 是假绿**——P4 用
> `null == null` 恒真，P5 因为 undo 未生效而"碰巧"满足往返断言。
> 已重写：P4 强制构造"非空快照 + 原地改"场景并加**浅拷贝对照组**；
> 新增 P6 用纯对象证明共享危险面；P2/P4 增加**判别力自评**并在汇总中单列。
>
> 修正后结论见 §F.2。**核心机制（根因一顺序、根因二深拷贝）确已修好且可证**，
> 但深拷贝的价值是**防未来**，不是"修了一个正在发生的缺陷"——详见 §F.8。

## F.0 绑定哈希

```
git HEAD = caaac017c7dbcfdc69393c5be0766a5b0aec169d
3cb8a0d15abf2630eb059e44349765b500c5cc5fb8672fbe65f37e574fda9da3  session_parts/project.py
ce8e81a0b8d334d87b8b3d5ebe1853e760cba2471f5ffdeb88190e66e20031be  session.py
```

## F.1 两个根因必须分开测（这是本探针的核心设计）

Lead 给的取证里有两个独立根因，**症状有交集**，若只写一条判据就分不清修好了哪个：

| 根因 | 机制 | 症状 |
| :--- | :--- | :--- |
| **一（顺序）** | `_record_history` 在**改动之后**调用，栈顶快照存的是"标定后"的值 | 第一次 undo 后 `x_ticks` 仍非 None |
| **二（浅拷贝）** | `[dict(c) for c in columns]` 只复制外层，`x_ticks` 这个 `list[dict]` 与实时列**共享同一对象** | 改实时列 → 栈内快照跟着变 |

所以探针设计成 **5 条独立判据**，一次运行就能看出剩哪个没修：

| 判据 | 测什么 | 与根因的对应 |
| :--- | :--- | :--- |
| **P3** | 栈顶快照与实时列的 `x_ticks` **对象 id** 是否相同 | **只测浅拷贝**，与顺序完全无关 |
| **P1** | 标定后 undo 一次，`x_ticks` 应为 None | 测顺序（根因一） |
| **P2** | 第二次 undo 后，标定值**不得串味**回来 | 测跨层污染 |
| **P4** | **原地改**实时列元素，栈内快照不得随之变 | 浅拷贝的另一面 |
| **P5** | undo → redo 往返应回到标定后状态 | 端到端可用性 |

**P3 是机制性判据**：它直接回答 Lead 那个问题——「让 undo 生效的那个手段
（快照在改前记录）是否同时保证了快照独立」。答案是**否**，且不依赖任何观测变绿与否。

## F.2 修复后的实测与**逐项定性**（Lead 已独立复验）

```bash
pixi run python scripts/prod_gate/b06_undo_probe.py
```

修复后（backend-fixer 已改 `project.py`，sha256 `95c401ff…`）实测：

```
--- 准备阶段 ---
    标定前 x_ticks: None        标定前栈深: 1
    标定后 x_ticks: [{'px': 354.6, 'value': 0.0}, {'px': 461.4, 'value': 40.0}]
    标定后栈深: 2
    栈顶快照 col0.x_ticks: None          ← 记录发生在修改之前（根因一修好）

  [PASS] P3_快照独立性
      snapshot_x_ticks_ids: [None, 140704515983456]
      栈顶快照与实时列共享同一 x_ticks 对象: False    ← 深拷贝生效（根因二修好）

  [PASS] P1_首次undo后为None
      x_ticks_after_1st_undo: None

  [PASS(弱)] P2_二次undo后不串味
      栈内非空快照下标: []
      has_discriminating_power: False   ← 场景弱，不构成独立证据

  [PASS(弱)] P4_写后读隔离
      前置_存在非空快照: True
      前置_成功原地改: True
      真实实现_被污染快照: []
      浅拷贝对照_被污染快照: []          ← 对照组也没被抓到
      has_discriminating_power: False
      evidence_grade: weak

  [PASS] P6_浅拷贝危险面（机制性）
      浅拷贝被污染项: 4/4 全中
      深拷贝被污染项: 0/4
      has_discriminating_power: True

  [PASS] P5_redo往返
      标定后: [...0.0/40.0...]   undo后: None   redo后: [...0.0/40.0...]

结论：6 项全 PASS —— B-06 已修复
注意：以下项 PASS 但**无判别力**：['P2_二次undo后不串味', 'P4_写后读隔离']
```

### 逐项定性（采纳 Lead 的裁定）

| 判据 | 状态 | 定性 |
| :--- | :--- | :--- |
| **P1** 首次 undo 为 None | 真绿 | 根因一（记录顺序）**确已修好** |
| **P3** 快照对象 id 不同 | 真绿 | 根因二（深拷贝）**确已修好** |
| **P2** 二次 undo 不串味 | 绿但**场景弱** | 栈内无非空快照可串 → **不构成独立证据** |
| **P4** 写后读隔离 | **弱绿（原为假绿）** | 见 §F.3。构造非空场景后真绿，但浅拷贝对照组**同样不被抓** → 对"浅/深拷贝"**当前无判别力** |
| **P6** 浅拷贝危险面 | 真绿（新增） | 纯对象证明：浅拷贝 4/4 污染、深拷贝 0/4。**这是 deepcopy 价值的唯一可证部分** |
| **P5** undo→redo 往返 | 真绿 | 有效（修复前它红是因为 undo 根本没生效） |

**原第一版的错误**：P4 用 `快照值_改前: null` / `改后: null` 比对，恒真；
P5 因 undo 未生效而"碰巧"满足往返。两者都是**假绿**。

## F.3 P4 两次假绿：先是判据太弱，后是场景为空

第一版 P4 的写法是：

```python
s2.columns[0]["x_ticks"] = [{"px": 1.0, "value": 999.0}, ...]   # 整体替换
```

它**通过了**——于是 P3（说共享）与 P4（说隔离）互相矛盾。查证后发现：
整体替换只是把字段指向另一个新 list，**原 list 不被触及**，所以栈顶快照确实没变。

而共享引用的暴露方式是**原地修改 list 里的 dict**。改成
`live_ticks[0]["value"] = 777.0` 后立刻转红。

这正是 S0 层要抓的「判据强度不足」：**测的对象不是它声称的对象**。
「改实时列不影响快照」这个声称，用整体替换去测只覆盖了一半语义。
若不是 P3 给出了矛盾信号，我会带着一条假绿判据交付。

> 已把这个坑写进脚本注释与 S0 登记项（`was_proxy` 字段），防止下一轮重犯。

## F.4 为什么浅拷贝在产品里抓不到（这是本节最重要的机制结论）

Lead 用"浅拷贝"模拟旧实现重跑同一探针，**浅拷贝也没被抓到**。我独立复验并复现：

```
浅拷贝(退回旧实现): 栈深=3 非空快照=[2] 被污染=[]      <- 未抓到
深拷贝(当前实现)  : 栈深=3 非空快照=[2] 被污染=[]      <- 未抓到
```

**原因是产品里不存在触发路径，不是探针写坏了。** grep 全部后端源码，`x_ticks`
只有两处写入，且都是**整体替换**：

```
straditize_core/session_parts/core.py:919      col["x_ticks"] = t
straditize_core/session_parts/xticks.py:167    col["x_ticks"] = [{"px": px0, ...}, {...}]
```

没有任何 `x_ticks[0]["value"] = ...` 这类原地改。机制上：

```
浅拷贝后：快照与实时共享同一 list（is 判定 True）
产品标定：整体替换 -> 实时指向**新 list**，旧 list 原封不动
          => 快照持有的旧 list 永不被触及 => 浅拷贝也不出错

只有「原地改旧 list 的元素」才会污染快照，而产品从不这么做。
```

我另用纯 Python 对象验证了**共享危险面确实存在**（这是 P6 的内容）：

```
浅拷贝被污染项: ['x_ticks 原地改元素', 'detected_ticks 原地 append',
                 'x_values 原地改元素', 'control_points 原地改']   4/4
深拷贝被污染项: []                                                    0/4
```

**准确定性**：深拷贝消掉的是「将来任何人加一行原地改就中招」的隐患。
这是有价值的改动，**但不是"修了一个正在发生的缺陷"**。报告不得把它表述成后者。

**关于 P3 与 P4 是否该合并**：
| | P3 | P4 |
| :--- | :--- | :--- |
| 测什么 | 快照与实时是否**同一对象**（`id`） | 改实时后快照的**值**是否变 |
| 当前判别力 | 强（可直接区分浅/深拷贝） | **无**（产品无触发路径） |
| 保留理由 | 定位机制，直接指向 `project.py` 的拷贝方式 | 保留为"若将来出现原地改"的前置哨兵；一旦有人加原地改，P4 会转红 |

两条都留，但**只有 P3 计入"根因二已修好"的证据**。P4 的价值是未来哨兵。

## F.5 给 backend-fixer 的验收条件（按修正后的判据）

| 验收项 | 命令 | 通过标准 |
| :--- | :--- | :--- |
| 主验收 | `pixi run python scripts/prod_gate/b06_undo_probe.py` | **6 项全 PASS**，退出码 `0` |
| 机读 | `... --json` | `summary.all_pass == true` |
| 判别力自评 | 同上，看 `summary.pass_but_weak_evidence` | 允许含 `P2`/`P4`（它们在本产品内无判别力，属已知且已注明） |
| S0 反验 | `probe_self_evidence.py` 第 6 项 | PASS（探针要如实标出弱证据项，不许自夸） |

**必须同时满足的具体断言**：

1. `undo` 一次 → `col0.x_ticks is None`（根因一）
2. 栈顶快照与实时列的 `x_ticks` **不是同一对象**（根因二，P3 直接判定）
3. `undo → redo` 往返 → 回到标定后状态
4. P6：浅拷贝 4/4 被污染、深拷贝 0/4（证明 deepcopy 的危险面真实存在）

**不再要求**：P4 的"深拷贝对照组被抓到"。**产品里没有原地改 `x_ticks` 的路径，
该对照组在当前产品内不可能红**。强行要求它红等于要求一件产品里不存在的事。

**给 backend-fixer 的一句话**（与 Lead 的结论一致）：
深拷贝改动**保留**，方向正确。但它的价值是**防未来**（任何人日后加一行
`x_ticks[i]["value"] = ...` 就中招），**不是修了一个正在发生的缺陷**。
不要据此宣称"修掉了一个数据污染 bug"。

## F.6 三层体系如何套用于此

| 层 | 在本任务上的具体形态 |
| :--- | :--- |
| **S0（探针自证）** | `probe_self_evidence.py` 第 6 项：断言该探针**在当前代码上能红**。若它永远绿，就无法当"会红"的验收条件 |
| **S1/S2/S3** | 本任务没有"对照对"（是单路径的行为断言），故走 S0 的 `behaviour` 强度 + 已知真值反验；P1↔P2 构成本地对照（第一次 undo 与第二次 undo 是两个观测点） |
| **机制性判据** | **P3**：直接问"快照独立"是否成立，不经过任何观测 |

## F.7 复跑

```bash
pixi run python scripts/prod_gate/b06_undo_probe.py          # 人读，红则退出码 1
pixi run python scripts/prod_gate/b06_undo_probe.py --json    # 机读
pixi run python scripts/prod_gate/probe_self_evidence.py      # S0 全套（第 6 项为本探针灵敏度）
```

无端口占用。

## F.8 本节的两次自我修正（留痕）

这一节是本报告中修正次数最多的一节，两次都是**假绿**：

| 版本 | 探针问题 | 谁发现 |
| :--- | :--- | :--- |
| v1 | P4 用整体替换代替原地改 → 共享引用测不出，P4 假通过 | 我自己（P3 与 P4 结论矛盾时发现） |
| v2 | P4 场景为空（`null == null` 恒真）；P5 因 undo 未生效而碰巧通过 | **Lead** |

**v2 的教训比 v1 更重**：v1 是我自己发现矛盾后查出来的，v2 是我在"5/5 全 PASS"
面前收手了——我看到了 `快照值_改前: null` 这行输出，却没有问"拿空值比对能证明什么"。
**"全绿"本身就是最需要怀疑的信号**，尤其当判据里的关键输入是 null 时。

现在的防线：
- `has_discriminating_power` + `evidence_grade` 字段：判据自己声明能否区分实现；
- 汇总里单列 `pass_but_weak_evidence`，**全绿时也会打印警告**；
- S0 第 6 项反验的是"探针是否如实标出弱证据项"，而不是"是否全绿"。

## F.9 对交付文档的影响（Lead 特别交代）

> "别让一份假绿判据进交付文档——那比没有判据更危险，因为下一个人会信任它。"

已按此执行：
- §F.2 改为逐项定性表，P2/P4 明确标 `PASS(弱)` 与 `has_discriminating_power: False`；
- §F.4 明确写出「深拷贝是防未来，不是修当前」，并附产品无触发路径的 grep 证据；
- §F.5 验收条件**移除了**"要求 P4 对照组被抓到"这一条（产品内不可能）；
- 待补项登记册 P-4 的验收条件同步更新。

**结论保留**：B-06 确已修好（根因一、根因二均可证），可关闭；但关闭理由**只包含
P1、P3、P5、P6 四条真证据**，不包含 P2、P4。

---

# 附录 G：B-12 / provenance / B-02 三个探针（2026-10-23 第八轮）

> 按 Lead 给的判据方向，为 task-6（B-12）、task-11（scale_provenance）预先建好探针，
> 等 backend-fixer 落地即可直接用。另附一条本轮顺带发现的 **B-02 新机制验证**。
>
> 只报不改。产品源码零改动。

## G.0 绑定哈希

```
git HEAD = caaac017c7dbcfdc69393c5be0766a5b0aec169d
fe6834465437968386da612f635fe8149d5b58974f30f40c78db53bba37499a9  session_parts/export.py
85aba97f853549fa6872220057e786c19621a6e61e513571863db7c42c29e5d8  session_parts/xscale.py
296400528c2195c1add657af81c24434c46ec4215c830d57a325e88c2cf7b8fe  rpc_methods/system.py
```

探针：`scripts/prod_gate/b12_provenance_probe.py`（13 项判据）

## G.1 当前实测（修复前基线，**这就是"会红"的对照**）

```bash
pixi run python scripts/prod_gate/b12_provenance_probe.py
```

```
结论：9/13 PASS，失败 = ['B12a_零标定不得ready', 'B12c_部分标定须可判',
                         'D6_provenance须下发', 'D7_下发值须随状态变']
```

## G.2 B-12 就绪清单：双向判据（按 Lead 的方向）

Lead 明确要求两条**同时**成立，只有一条绿都是错的：

| 判据 | 当前 | 要求 | 说明 |
| :--- | :--- | :--- | :--- |
| **B12a** 零标定不得 ready | **FAIL** | `ready is not True` | 实测 0/28 标定却 `ready=True` —— 原缺陷 |
| **B12b** 全标定必须 ready | PASS | `ready is True` 且 28/28 | **反向要求**：防矫枉过正改成永假 |
| **B12c** 部分标定须可判 | **FAIL** | `ready is not True` 或带 provenance | 实测 1/28 标定、`ready=True`、无 provenance |

实测明细：

```
零标定会话  : {"列数": 28, "真正 calibrated 列数": 0,  "source 分布": ["legacy"],
               "readiness": {"ready": true, "readiness_missing": [], "total_rois": 1}}
全标定会话  : {"列数": 28, "真正 calibrated 列数": 28, "source 分布": ["x_ticks"],
               "readiness": {"ready": true, ...}}
部分标定会话: {"列数": 28, "真正 calibrated 列数": 1,  "是否带 provenance 字段": false,
               "readiness": {"ready": true, ...}}
```

**B12b 现在就是绿的**——这不是缺陷，而是它的价值所在：它是"防矫枉过正"的哨兵，
修复后必须仍然绿。一条判据在修复前后都为绿是有意义的，前提是它守住的方向相反。

## G.3 provenance：**先验动态性质，而不是静态读四个档位**

Lead 的提醒（P4 那次教训）：若实现只是把 `resolve_column_scale` 的返回值复制出来
而从不改变，四条静态断言可能全绿但 `source` 恒定。所以主判据是 D 系列（动态）：

| 判据 | 内容 | 当前 |
| :--- | :--- | :--- |
| **D1** 改状态后 source 必须变 | 同一列 无标定 → 标定 | PASS（`legacy` → `x_ticks`） |
| **D2** 值必须接上 | 同列再标定 40→80，source 仍 `x_ticks` 但 `val1` 必须变 | PASS（40.0 → 80.0） |
| **D3** 清回 legacy 须变回 | 双向性，不能单向只增 | PASS（`x_ticks` → `legacy`） |
| **D4** 同会话多档并存 | 已标定列与未标定列必须不同 source | PASS（`['legacy','x_ticks']`） |
| **D5** 取值域自证 | 观测到的 source 都在声明域内 | PASS |

**D1 是最关键的**：一次就能证伪「source 恒定」的假实现。

实测证据：

```
D1: before={"source":"legacy","val1":20.0,"px1":399.0}
    after ={"source":"x_ticks","val1":40.0,"px1":461.4}
```

## G.4 但 D1–D5 有一个软肋：它们读的是**内部函数**，不是用户能看到的东西

`resolve_column_scale` 是内部函数。**即使它算得完全正确，前端也可能永远拿不到**
——这正是 C1e 那类"改对了但没接上出口"的形态。故补了 D6/D7：

| 判据 | 内容 | 当前 |
| :--- | :--- | :--- |
| **D6** provenance 须下发 | 走真实 `straditize.getDiagramData` 载荷，检查列字典里有没有 `scale_provenance`（或平铺 `calibrated`/`source`） | **FAIL** |
| **D7** 下发值须随状态变 | 改状态前后各取一次 payload，provenance 必须不同（防在 payload 层写死） | **FAIL** |

实测：

```
payload 首列 keys: ["col_index","color","controlPoints","curveType","endX",
  "exaggerationMult","exaggeration_mult","hasExaggeration","id","isLocked",
  "maxPercent","name","plotType","plot_type","roi_id","scaleCalib",
  "scale_type","species","startValue","startX","tickEndX","tickValue","unit",
  "visible","x_ticks","x_ticks_dropped"]
含 scale_provenance: false      含平铺 source/calibrated: false
```

**注意 payload 里有 `scaleCalib`（含 originVal/calibVal）** —— 那是像素与数值端点，
**不是 provenance**：它无法告诉用户"这个数是图版印的还是程序默认 20"。
所以 D6 判据刻意不接受 `scaleCalib` 充当 provenance。

**结论：provenance 目前完全没下发。** D1–D5 绿只证明"内部算得对"，
不证明用户能看见。修复后必须 D1–D7 全绿。

## G.5 顺带验证 B-02 的新机制：`x_ticks_dropped` 的不可变性

payload 首列里出现了 `x_ticks_dropped`（B-02 修复的新字段，前端有消费者
`XTicksDroppedNotice.ts`）。它的代码注释明确写着：

> 值必须是**不可变**的：撤销栈的列快照是 `[dict(c) for c in self.columns]`（浅拷贝），
> 嵌套容器会被快照与活动列共享引用。故 px/band 用 tuple。

**这与 B-06 是同一个隐患面，且是新机制、此前无人验证。** 我加了三项判据：

| 判据 | 内容 | 实测 |
| :--- | :--- | :--- |
| **D8a** 能触发 dropped | 重分列使旧刻度越界 | PASS（`reason: column_layout_changed`） |
| **D8b** 内部容器不可变 | px/band 必须是 tuple | PASS（`tuple` / `tuple`） |
| **D8c** 共享也不可污染 | 即使外层 dict 与快照共享，就地改 px[0] 必须失败 | PASS（抛 `TypeError`，快照值不变） |

实测：

```
x_ticks_dropped = {'reason': 'column_layout_changed',
                   'px': (354.6, 461.4), 'band': (319.0, 497.0)}
px 类型 = tuple   band 类型 = tuple   不可变 = True
快照持有同一 dict 对象 = True   ← 外层确实共享（浅拷贝的必然结果）
尝试就地改 px[0] 是否成功 = False   ← tuple 挡住
快照里的 px 值仍为 = (354.6, 461.4)
```

**结论**：B-02 的这个设计是**正确**的，且比"深拷贝整个列"更轻。
backend-fixer 显然从 B-06 的浅拷贝问题里学到了，主动用不可变类型防御。

> D8a 存在的理由（P4 教训）：如果触发不了 dropped，D8b/D8c 测的是空气，
> 会假绿。故先断言前置条件成立。

**前端侧不受影响**：payload 层是 Python tuple，经 JSON 到 JS 变成普通 Array（可变），
但前端只读它渲染提示、不写回后端，故后端内的共享污染风险已被 tuple 挡住。

## G.6 移交：三条验收条件

| 任务 | 命令 | 通过标准 |
| :--- | :--- | :--- |
| **task-6 / B-12** | `b12_provenance_probe.py` 的 `B12a/B12b/B12c` | **三条同时满足**：零标定不 ready + 全标定 ready + 部分标定可判 |
| **task-11 / provenance** | 同上 `D1–D7` | **七条全绿**（D1–D5 内部正确 + D6/D7 真的下发且随状态变） |
| **B-02 回归钉子** | 同上 `D8a–D8c` | 三条保持绿（若有人把 tuple 改回 list，D8c 会红） |
| 全部 | `pixi run python scripts/prod_gate/b12_provenance_probe.py --json` | `summary.all_pass == true` |

**给 backend-fixer 的两句提醒**（都是本轮踩过的坑）：

1. **B-12 别矫枉过正**：把 `ready` 改成永假会让 B12b 红。应该按 `calibrated` 真实
   状态判定；部分标定时要么 `ready=False`，要么 `ready=True` 但必须给出 provenance
   说清缺哪些列。
2. **provenance 别只在内部算**：D6/D7 会检查它是否真的出现在
   `straditize.getDiagramData` 的 `columns[]` 里、且随状态变化。只在
   `resolve_column_scale` 里返回、不接到 payload，D6 会红。

## G.7 复跑

```bash
pixi run python scripts/prod_gate/b12_provenance_probe.py          # 人读
pixi run python scripts/prod_gate/b12_provenance_probe.py --json    # 机读
```

无端口占用。
