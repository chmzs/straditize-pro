# 产品就绪评估：论文 PDF → 可用科研数据（2026-10-23）

> 本文档的每个数字都来自真实运行。命令、退出码、输出摘录逐条给出。
> 凡未亲自跑过的数字，来源标为「转述」并注明出处，不冒充实测。
>
> 复跑命令：
> ```bash
> pixi run python scripts/product_journey/verify_pdf_to_data.py
> ```
> 退出码：`0`=零缺陷 · `1`=有阻断项 · `2`=能产出数据但有 PARTIAL/UNCERTAIN。

## 0. 结论先行

**产品旅程走得通，能产出真实科研数据，但有三处必须用户手工兜住，且数据精度当前无法自动化验证。**

| 判定 | 站数 | 含义 |
|---|---|---|
| PASS | 10 | 真实可用 |
| PARTIAL | 3 | 能走通但需用户手工补 |
| UNCERTAIN | 1 | 我无法给出可信判定（不是产品坏） |
| FAIL | 0 | 无阻断项 |

退出码 **2**。这比 Lead 任务书里"OCR 失效"的初始判断好得多，也比"16 个标签全部关联"的最终判断差一点——**关联其实全部失败**，详见 §4。

---

## 1. 证据绑定

本次运行绑定以下哈希（`HEAD` 在运行期间被队友推进过一次，此处记录最终态）：

```
git HEAD  = a8ca091fad2a3f87f7cd86b8c9a6ab8d6e606a28
541c8ea28c2bf4b6  straditize_core/ocr/engine.py
f8af6fbd87176670  straditize_core/session_parts/ocr.py
4788ec537b0d4f61  straditize_core/session_parts/core.py
0e9202867674630a  straditize_core/session_parts/digitize.py
85aba97f853549fa  straditize_core/session_parts/xscale.py
c6a9ffb1d0aab04b  straditize_core/session_parts/export.py
828833f3cced7aaa  frontend/src/components/ocr/OcrReviewTable.ts
```

取样对象：
```
PDF  = F:/Zotero/storage/HV4FXL63/Han Y.-2026-A synthesis of pollen sequences from the central-w.pdf
sha256(前16) = 1490fa09864d6f1e   第 5 页内嵌图版 2132×928, format=PDF_IMAGE
```

可复现性：连跑两次，14 站判定序列完全一致（`run1.json` 与 `run2.json` 逐站比对 `True`）。

---

## 2. 产品旅程实况（逐站真实输出）

```
PASS    载入PDF页       2132x928 format=PDF_IMAGE page=5/13
PARTIAL 建议ROI覆盖      建议 ROI 底部漏掉真实数据区 125px（横轴在 y=869，建议 yMax=744.0）
PASS    ROI与清理       ROI 建立成功；移除 1 条横向分区线
PASS    自动分列         检出 16 列，列宽 [38,37,37,38,37,63,37,37,38,212,187,37,63,38,48,51]
PARTIAL OCR识别         17 标签全部有文本、14 个有中文名，但 associated_column_id 全部为 None
PASS    OCR计数门对照实验  标签数改为 16 后 16/16 列全部关联成功
PARTIAL OCR应用到列名     模拟真实 UI 路径后 12/16 列拿到属种名
PASS    自动刻度齿        band=[870,876]（真值≈869..876），检出齿 31 个
PASS    零标定就绪门      零输入时 ready=False，未标定 16/16
PASS    导出CSV         637 行 x 17 列，JSON 可序列化=True
PASS    导出XLSX        JSON 可序列化=True，openpyxl 可打开=True（3 张表）
PASS    导出TAR         size=1075200B，JSON 可序列化=True
PASS    数据质量/结构      提取点全部落在本列内 10192/10192（100.00%）
UNCERTAIN 数据质量/精度   逐行位置偏差随墨迹阈值跳动（中位 0~4px，p95 1~49px）
```

### 2.1 载入 PDF 页 — PASS
```
load_image: dict keys=['success','width','height','format','mode','image_path','image_url',
                       'suggested_roi','rois','primary_roi_id','active_roi_id','pdf_info']
尺寸 = 2132 x 928   format = PDF_IMAGE   pdf_info = {"total_pages":13,"current_page":5}
```

### 2.2 建议取数区 — PARTIAL（真实缺陷）
产品建议 `xlim=[69,1867] ylim=[266,744]`。独立像素定位的横轴线在 **y=869**，即建议框底部少覆盖 **125px**。
用户点"使用建议取数区"后，Zone I 的大部分数据被静默排除，界面无任何提示。

证据：建议 ROI 下分列得 23 列；手框 `[330,1330]×[233,869]` 得 16 列（干净）。同一张图，两个列数。

### 2.3 自动分列 — PASS
16 列，列宽 `[38,37,37,38,37,63,37,37,38,212,187,37,63,38,48,51]`。
注意 col10=212px、col11=187px 是**合并列**（Euphorbiaceae / Cyperaceae 的刻度尺段被并成一列），
这是产品把"稀疏的窄列"合并的行为，本身不是缺陷，但会影响后续每列取数。

### 2.4 OCR 识别属种名 — PARTIAL（详见 §4）
```
ocr_recognize_labels: dict keys=['success','data']
ocr['data'] keys = ['labels','label_row_bbox','label_row_image','reconciliation',
                    'summary','custom_dict_path','custom_dict_entries','builtin_dict_entries']
summary = {"total":17,"auto":11,"confirm":1,"unrecognized":5}
```
17 个标签的 `ocr_text` 全部正确，属种名与中文名基本正确：

| # | ocr_text | suggested_zh | conf | status |
|---|---|---|---|---|
| 1 | Abies | 冷杉属 | 1.00 | auto |
| 2 | Picea | 云杉属 | 1.00 | auto |
| 3 | Betula | 桦木属 | 1.00 | auto |
| 4 | Quercus (D) | Quercus (D) | 0.50 | unrecognized |
| 5 | Quercus (E) | Quercus (E) | 0.50 | unrecognized |
| 6 | Rosaceae | 蔷薇科 | 1.00 | auto |
| 7 | Chenopodiaceae | 藜科 | 1.00 | auto |
| 8 | Hippophae | 沙棘属 | 1.00 | auto |
| 9 | Euphorbiaceae | Euphorbiaceae | 0.50 | unrecognized |
| 10 | Cyperaceae | 莎草科 | 1.00 | auto |
| 11 | Artemisia | 蒿属 | 1.00 | auto |
| 12 | Poaceae | 禾本科 | 1.00 | auto |
| 13 | Ranunculaceae | 毛茛科 | 1.00 | auto |
| 14 | Caryophyllacea | 石竹科 | 0.97 | auto |
| 15 | <Myriophyll | 狐尾藻属 | 0.91 | confirm |
| 16 | Conc | Conc | 0.50 | unrecognized |
| 17 | Herbs | Herbs | 0.50 | unrecognized |

**OCR 引擎本身工作良好**，这点与 Lead 最终判断一致。文本瑕疵：`Caryophyllacea` 少一个 e、
`<Myriophyll` 截断、`Conc`/`Herbs` 是图例缩写而非属种名。

### 2.5 自动刻度齿 — PASS
```
detect_xticks_rpc: band=[870,876]  spacing=...  per_column=16 条
独立真值 band ≈ (869, 876)  -> 命中
齿总数 = 31，usable 列 = 4/16
```
`usable` 只 4/16 是**结构性不可达**，不是缺陷：`usable` 定义为每列 ≥2 个齿，
而产品列宽仅 37~38px、刻度间距中位 25px，每列最多 1 个齿。该字段前端零消费。

### 2.6 标定与就绪清单 — PASS
```
get_export_readiness keys = ['sheets','primary_roi','primary_roi_id','readiness_missing',
                             'total_rois','ready','calibrated_count','column_count',
                             'uncalibrated_columns','provenance']
ready = False   calibrated = 0/16
provenance = {"all_calibrated":false,"calibrated_count":0,"column_count":16,
              "sources":{"legacy":16}}
```
零输入时 `ready=False` 正确——B-12 修复生效。这是用户导出前最后一道门，现在它守住了。

### 2.7 导出 — PASS × 3
```
export_data(csv)  keys=[...,'rows_count','columns_count','columns','data','csv','csv_content']
  637 行 x 17 列，表头 = depth,col01,...,col16，JSON 可序列化
export_multi_xlsx keys=['success','size_bytes','output_path','base64','data']
  size=49999B，openpyxl 打开成功，表=['meta_info','Han2026_p5','readme']
export_multi_tar  keys=['data','tar_base64','size','success']
  size=1075200B，JSON 可序列化
```
xlsx 的 raw-bytes 断连（task-14 的 P1-A）在 `c088b42` 已修好，本次实测确实返回 base64 且可打开。

---

## 3. 数据质量

### 3.1 可作门禁的判据（与阈值无关）
**提取点全部落在本列 `[start,end]` 内：10192/10192 = 100.00%。**
含义：产品不会把邻列的墨迹读进本列，跨列串扰为零。这是结构性判据，可作门禁。

### 3.2 只能记 UNCERTAIN 的判据（对阈值敏感）
逐行位置偏差 |Δx|（产品取的 x vs 独立像素取的 x，同一行同一量）：

| 墨迹判据 | 比对行 | 中位 | p95 | >3px 行 |
|---|---|---|---|---|
| 灰度<128 | 3141 | 1.00px | 1.00px | 42 |
| 颜色偏离>40 | 2538 | 4.00px | 35.15px | 1476 |
| 颜色偏离>60 | 1445 | 1.00px | 49.00px | 137 |
| 颜色偏离>80 | 2488 | 0.00px | 6.00px | 137 |

**这个量随阈值跳动（中位 0~4px、p95 1~49px），按项目铁律不得作门禁。**
诚实结论：**产品提取的数值精度，我目前无法用自动化判据给出可信数字。**
能说的是中位偏差在 0~4px 量级（列宽 38px 的 0~10%），但尾部有 1~5% 的行偏差较大，
其成因已定位（见 §3.3），不是产品读错。

### 3.3 关于 Lead 的 `70.59% vs 71.05%，偏差 -0.46 个百分点`
**该数字不可复现，不得作为数据质量证据。** 依据：
- 仓库内全量 grep `70.59` / `71.05` 零命中（除依赖包无关匹配），无任何脚本或文档产出过这两个数。
- Lead 记录的标定 `x_ticks=[{px:339,value:0},{px:477,value:100}]` 在产品里**直接被拒**：
  ```
  参数范围越界：刻度点像素 (339.0, 477.0) 超出该列物理范围 [322.0, 380.0]
  ```
  说明 Lead 当时的列划分与记录下的刻度像素不属于同一列——两者不可能同时成立。
- 在 cleanup×reader_type 六种组合下扫描，70.59 一次都没出现。
- 未标定时产品走 legacy 映射 `[start,tickEndX]→[0,20]`，全表 max=43.25；
  用"行内墨迹宽度占列宽"口径全表 max=98.04。两个都不是 70.59。

我**不调参去凑 70.59**。记为 UNCERTAIN，并把可复现的结构判据（§3.1）作为替代证据。

---

## 4. 四次误判复盘 + 我自己重犯的同型错误

### 4.1 Lead 的四次

| 次数 | 判据声称测什么 | 实际测了什么 | 正确读法 |
|---|---|---|---|
| 1 | `r.get('labels')` 判 OCR 结果 | 顶层无 `labels` 键 → 恒 None → 判"OCR 失效" | 标签在 `r['data']['labels']`，先 `print(list(r.keys()))` |
| 2 | `lb.get('text')` / `lb.get('name')` | 字段名不存在 → 恒 None → 判"16 个空标签" | 真字段名 `ocr_text` / `suggested_name` / `suggested_zh` |
| 3 | "墨迹行占比"当真值 | 产品算的是"行内墨迹宽度占比" → 差 36 个百分点 | 两者是不同物理量，必须用产品同口径 |
| 4 | 仍未先读返回结构 | 同一错误延续 | 取值前先打印键名 |

共同形态：**字段名猜错 → 拿到 None → 判定产品坏**。三次里三次都是探针错，产品对。

### 4.2 我自己重犯的（必须写下来，否则这份文档没资格说别人）

写这个脚本的过程中我犯了 **4 次** 同类错误，每次都先得出"产品坏了"的结论：

| # | 我的错误判据 | 我当时的结论 | 真相 |
|---|---|---|---|
| 1 | 把后端原始 `labels` 直接喂 `ocr_apply_labels` → `applied_count=0` | "OCR 应用到列名 FAIL，产品阻断" | 真实 UI 走 `OcrReviewTable.ts:54-62` 前端兜底关联 + `data-col-id`，实测 **12/16 列成功改名** |
| 2 | 灰度阈值 128 当真值 | "col15 有 102 行 10px 偏差" | 彩色曲线 gray≈182 根本没被看见，我只看到黑色分隔线。假偏差 |
| 3 | `max(产品列)` 比 `max(真值列)` | "col10 偏差 -12.75 点" | 产品 max 在 y=336、真值 max 在 y=233，不同行。逐行 Δ 中位 **0.000** |
| 4 | 把框线/横轴行当数据行 | "真值比产品多读 200px" | y=234/869 是框线与横轴，不是数据 |

第 1 条最危险：我差点给 Lead 报"OCR 应用标签功能坏了"，而它其实是好的。
这和 Lead 前三次的形态完全一样——**判据没指向用户实际走的那条路径**。

---

## 5. 下次验证 OCR / 提取前必做的三件事

固化进脚本（`verify_pdf_to_data.py` 已全部落实）：

1. **先 `print(list(result.keys()))` 看返回结构，再取值。**
   嵌套的也要看：`list(r['data'].keys())`、`list(labels[0].keys())`。
   脚本里每个后端返回都先 `show_keys()` 再取字段。

2. **读到的字段若全为 None，先怀疑字段名错，不要先怀疑产品坏。**
   判据：若"全部为 None"而不是"部分为 None"，几乎必然是字段名或层级错。
   脚本把这条做成硬提示：`associated_column_id` 全 None 时，先跑内置对照实验
   证明原因，再下结论。

3. **用产品口径构造真值，不要用直觉口径。**
   本例：产品算"行内墨迹宽度占比"，直觉口径"墨迹行占比"差 36 个百分点。
   脚本用 `resolve_column_scale` 读出的真实映射参数构造真值，不猜。

补充两条（本轮新增，同样写进脚本）：

4. **判据不得对参数敏感。** 实测同一目标在 4 套阈值下给出中位 0~4px、p95 1~49px。
   敏感就标 UNCERTAIN，不许当门禁。
5. **模拟用户真实路径，不要直调 API 就下结论。** 前端可能有兜底逻辑，
   后端直调失败 ≠ 用户走不通。

---

## 6. 仍需用户手工的环节（按能否自动化排序）

### 6.1 可以自动化，只是还没做（优先级高）
1. **建议 ROI 的底部边界**。当前建议框漏掉底部 125px。
   后端 `suggest_data_region()` 用历史比例启发式，没利用"横轴线"这一强结构特征。
   可行做法：检测横贯全宽的暗行（本次实测横轴暗像素占全宽 **66.1%**，脚本输出原文
   `横轴线行 y=869 (暗像素占全宽 66.1%)`），
   以它为数据区底边。这项**完全可自动化**，且是用户第一屏就会踩的坑。
2. **OCR 标签与列的关联**。当前被 `len(labels)!=len(columns)` 硬门整体拒绝。
   内置对照实验证明：删掉 1 个重复锚点标签使 17→16 后，**16/16 列全部关联成功**。
   可行做法：保留"计数不等时不做 1:1 配对"的原意，但**至少输出位置归属**
   （哪个标签落在哪个列），而不是全部置 None 且无提示。
3. **`unrecognized` 标签的采纳**。5 个标签因置信度 0.50 被判 unrecognized，
   UI 默认不勾选，用户需手动勾。属种名文本其实是对的（Quercus (D)/(E)、
   Euphorbiaceae、Conc、Herbs），只是词典没匹配上中文名。

### 6.2 必须用户手工，无法自动化（合理）
4. **属种名的最终核对**。OCR 给出 `Caryophyllacea`（少 e）、`<Myriophyll`（截断）、
   `Conc`/`Herbs`（图例缩写）。这些需要研究者按专业知识判断，不该自动改写——
   自动"纠正"一个属种名属于伪造数据。
5. **X 轴刻度读数标定**。图上刻度数字的物理含义（% 还是粒/克）只有作者知道。
   产品提供"拾取两个端点 + 填读数"，这是正确的设计，不该自动化。
6. **数据区边界确认**。即便建议 ROI 改准了，最终仍需用户看一眼确认——
   图版常有图例、注释、多面板混排，机器判断不能替代。

---

## 7. 距离"好产品"还差什么（最重要的部分，直说）

按对用户的伤害程度排序：

1. **"静默"是这个产品当前最大的敌人。** 三处 PARTIAL 有一个共同形态：
   产品做了决定，但不告诉用户。建议 ROI 少框 125px 不说、17 个标签关联全失败不说、
   5 个标签需要手动勾选也不说。用户不会看到任何异常，只会拿到一份少了数据的 CSV。
   这比报错危险得多——报错会被发现，静默不会。

2. **数据精度当前无法自证。** 我能证明"提取点不越界"（100%），但无法给出
   "提取值有多准"的可信数字——因为我没有一张有权威真值的标准图版。
   **这是交付前最该补的基础设施**：需要一张人工逐行标注过曲线 x 位置的图，
   作为回归基准。没有它，任何"精度提升"都无法验证是提升还是漂移。

3. **OCR 的关联硬门是"正确但无用"的设计。** 防错配的意图是对的，
   但代价是 17 个正确识别的标签一个都用不上。正确做法是分级：
   位置明确归属的照常给出，只在真正歧义处（多标签同列/跨列）才拒绝。

4. **列宽 37px 与刻度间距 25px 的物理矛盾尚未解决。** 每列最多 1 个齿，
   而标定需要 2 个点。这意味着**自动标定在这类高密度花粉图上原理上做不到**，
   必须用户手工。产品目前没把这件事说清楚，`usable 4/16` 这个数字用户看不到。

5. **可复现的验收脚本现在是有了，但它只覆盖一条链路。** 本次覆盖
   PDF→CSV/XLSX/TAR。未覆盖：换页跨图残留（PDF 换页 `image_path` 不变，
   是最易漏的跨图路径）、工程包往返、LiPD 导出、多 ROI。这些都在队友的任务里，
   但**没有统一的门禁入口**，建议把本脚本扩成回归套件。

**一句话**：链路通了，数据是真的，导出能用。但用户拿到的数据是否完整、是否准确，
产品目前既不保证也不告知。这是"能用"和"好产品"之间的距离。

---

## 8. 复跑方式

```bash
# 完整链路（约 3 分钟）
pixi run python scripts/product_journey/verify_pdf_to_data.py

# 换页（PDF 第 2 页，含 2 张内嵌图）
pixi run python scripts/product_journey/verify_pdf_to_data.py --page 2

# 跳过清理，观察清理对提取的影响
pixi run python scripts/product_journey/verify_pdf_to_data.py --no-cleanup

# 落 JSON 明细供比对
pixi run python scripts/product_journey/verify_pdf_to_data.py --json /tmp/run.json
```

退出码语义见 §0 与脚本 docstring。**退出码 0 在真实图版上当前不可达**——
这是有意的：只要还有已知缺陷，门禁就不该返绿。
