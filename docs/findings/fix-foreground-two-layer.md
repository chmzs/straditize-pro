# 前景提取双层修复 —— 状态报告

## 状态：**部分完成**（`extraction_mode` 贯通已完成；`Caryophyllaceae` 默认路径修复**未完成**；D-0 **未解决**，已加显式拒绝作为止损）

**本报告绑定的哈希**（本轮 `image.py` 多次漂移，不绑哈希的"全绿"不可复述）：

```
7db63e2a3fcc32108a215ba1d62632c09e06230043801ceaced69368b7bb9fe3  straditize_core/image.py
9d41e3e690aef96a740f15c100522152f5149e1073f35b662547b68fb5e19743  straditize_core/session_parts/core.py
22e4ce031ab1ac7f81b0a752ea0b453da69dfc8d78f4066fc92b74be7c34fcab  straditize_core/twolayer_detect.py
```

---

## 一、改动文件与意图

| 文件 | 改动 | 意图 |
| :--- | :--- | :--- |
| `straditize_core/image.py` | 新增 `two_layer_split()` / `split_solid_and_shadow()` / `shadow_layers()` / `structure_line_mask()` / `column_white_points()` / `grey_matrix()` / `two_layer_consistency()`；`EXTRACTION_MODES` 增加 `solid-over-shadow`；`SEGMENTATION_MODES` 增加 `two-layer`；`build_foreground()` 增加 `column_edges` 参数 | 让"实心层 / 夸张包络"能按**每列自己的纸白**分离，而不是靠单一灰度阈值 |
| `straditize_core/session_parts/core.py` | `extract_foreground()` 新增 `extraction_mode` / `column_edges` 参数；新增 `_extract_foreground_from_settings()` 与 `_column_band_edges()`；`solid-over-shadow` 分支接入一致性自检并在不通过时**抛错** | ① 让模式能从产品链路传进来；② 让隐式重算不再偷偷退回 Otsu；③ 不让不可信的掩膜静默出厂 |
| `straditize_core/session_parts/cleanup.py`（3 处）、`digitize.py`（1 处） | 无参 `self.extract_foreground()` → `self._extract_foreground_from_settings()` | 同上 ② |
| `straditize_core/session.py` | 新增状态 `extraction_mode` / `foreground_column_edges` / `shadow_mask` / `solid_layers` | 承载上述模式 |
| `straditize_core/rpc_methods/digitize.py` | `core.extractForeground` 改为显式接受 `extraction_mode`（非法值报 `INVALID_PARAMS`，不静默回退）；新增 `core.getShadowLayer` | 把模式接到 RPC |
| `straditize_core/protocol.py`、`frontend/src/types/rpc.ts` | 登记 `core.getShadowLayer`（104 → 105） | 契约同步（项目硬规则） |
| `straditize_core/twolayer_detect.py`（新增） | `band_is_two_layer()` / `detect_two_layer_columns()` | 自动识别"双层图"，供后续默认路径使用（**当前未被默认路径调用**，见卡点） |

**我改坏了又改回来的地方**（如实记录）：`paper` 一度被我写成 `~near_paper`，导致 `solid` 归零；已在同一轮回滚。

---

## 二、验收数字

图版：`output/han2026_ngamring/fig3_raw.jpeg`，构造 15 列后走 `extract_foreground()`（不传 `extraction_mode` = 默认 `standard`）。
复现命令：`pixi run python scripts/fix_probe/key_numbers.py`

### 2.1 Caryophyllaceae 覆盖率 —— **未修复**

**必须先说清楚口径问题**，否则这条数字无法解读。该列 `lum<=150` 的像素只有 **8 个**（分母退化）：

```
该列像素构成：lum<=150 → 8 px ｜ 150–200 → 994 px ｜ 200–224 → 120 px ｜ 224–252 → 381 px ｜ >252 → 27167 px
```

灰填充的真实主体落在 **164–182**，`lum<=150` 这个口径**几乎测不到它**。两个口径的结果：

| 口径 | 分母 | 覆盖率 | 说明 |
| :--- | ---: | ---: | :--- |
| `lum<=150`（Lead/QA 口径） | 8 px | **37.5%** | 分母只有 8 px，统计意义极弱 |
| `lum<=200`（覆盖灰填充 164–182） | 1027 px | **1.4%** | 与 Lead 基线一致 |

**结论：以有统计意义的口径（`lum<=200`）计，`Caryophyllaceae` 覆盖率 = 1.4%，与基线相同 —— 默认路径没有修好这一列。**

其余 14 列（`lum<=200` 口径）：最高 98.2%，最低 **59.0%**（Hippophae）。**注意：这个口径下 14 列不是"92–99.8%"，而是 59.0–98.2%** —— 因为该口径把阴影也算进了真值。原基线 92.1–99.8% 用的是 `lum<=150`，两个口径不可混比。

`lum<=150` 口径下 15 列的完整表（便于与 Lead/QA 基线逐列对账）：

| 列 | 覆盖率 | 列 | 覆盖率 |
| :--- | ---: | :--- | ---: |
| Pinus | 99.2% | Hippophae | 94.8% |
| Abies | 97.9% | Euphorbiaceae | 99.8% |
| Picea | 96.5% | Cyperaceae | 99.8% |
| Betula | 97.0% | Artemisia | 99.4% |
| Quercus D | 94.4% | Poaceae | 99.3% |
| Quercus E | 99.0% | Ranunculaceae | 99.1% |
| Rosaceae | 98.0% | **Caryophyllaceae** | **37.5%**（分母仅 8 px） |
| Chenopodiaceae | 98.3% | | |

该口径下 14 列最低 94.4%（基线 92.1%），`Caryophyllaceae` 从 1.4% 到 37.5% —— 但**这个提升是分母退化造成的假象**（8 px 里多命中 3 个），不构成修复。

### 2.2 两条阴影进前景比例 —— D-0 **未解决**，但已止损

以精确颜色匹配计量（`|RGB − 包络色| ≤ 8`）：

| 模式 | 蓝阴影 (218,226,237) 进前景 | 粉阴影 (244,226,226) 进前景 |
| :--- | ---: | ---: |
| `standard`（Otsu 138） | **0.0%** | **0.0%** |
| `solid-over-shadow`（若放行） | **92.4%** ❌ | **4.0%** ❌ |

两条目标都是 0，`solid-over-shadow` **两个都不合格**，且方向相反（蓝 92.4% 判实心、粉 4.0% 判实心）。

**止损措施已生效**：该模式现在**显式拒绝**产出掩膜，而不是静默返回：

```
双层分离（solid-over-shadow）在当前图上不可信，已拒绝产出前景掩膜，以免读数被按颜色分别放大。
技术原因：Two pale layers of the same figure were classified oppositely:
hue-210-225deg is 92% solid ink, while neutral is 94% shadow. ...
建议：改用 standard 并人工核对浅色层；或提交一张该图版的裁剪样本以便补足判据。
```

拒绝判据按**颜色族**（色相 15° 分族 + 中性族）分组，要求成片（最大连通块 ≥1000 px）。实测行为：

| 图版 | `solid-over-shadow` |
| :--- | :--- |
| `fig3_raw.jpeg`（真实双层） | **拒绝** |
| corpus `02_muricuo`（真实双层） | **拒绝** |
| `hoya-del-castillo.png` | 放行 |
| `beginner-tutorial.png` | 放行 |
| corpus `01` / `03` / `04` / `05` | 放行 |

即：**两张确有双层阴影的图被拦下，其余 6 张正常放行** —— 符合"不可信则拒绝"的意图。

---

## 三、门禁（真实输出）

```
$ pixi run lint
lint-ruff:        All checks passed!
lint-consistency: 11 项全 OK（A / A0 / B / C / D / E / G / H / I / J / F）
                  一致性核对通过

$ pixi run test
342 passed, 3 skipped, 90 subtests passed in 156.25s (0:02:36)
```

门禁**未放宽任何既有断言**，也未改动 `frontend/e2e/`、`support/`、`scripts/` 下他人目录。

---

## 四、卡点与下一步建议

### 4.1 为什么默认路径没修好 Caryophyllaceae

原计划是"有 `column_edges` 时逐带局部 Otsu"。**该方案经实测被推翻**，数据在 `scripts/fix_probe/band_probe.py`：

| 角度 | 实测 |
| :--- | :--- |
| 全局 Otsu 138.5 | 中灰列真值只有 **0.3%** 落在阈值以下 —— 不是"差一点"，是整列在阈值另一侧 |
| 逐列局部 Otsu | 中灰列阈值升到 206.5（+85.8pp）**但 4/15 列掉分**（Poaceae −2.2pp 等） |
| 中灰列的"双峰" | 非纸像素总共只有 220 px，两峰在 164–182 与 198–200，分离 34 级 |

**根本原因**：`standard` 是二值路径，而这张图有**三层**（纸 255 / 包络 229 / 实心 153–182）。任何单阈值都会在"包络"或"实心"其中一层上切错。这不是阈值选得不好，是**判据维度不够**。

### 4.2 为什么 D-0 没解决

我按"是否与所在列纸面同阶"重构了判据（`two_layer_split`），粉色、中性色都能正确归入包络，**但蓝色不能**：

- 蓝色包络 `(218,226,237)` 的 `grey_matrix` 明度 = **224.6**，低于 0.93×纸白（237.15）的下界 → 落进 `solid`
- 我尝试用 `pale_chromatic` 分支（按通道极值）补救，但蓝包络的 `max` 通道只有 237（0.93×纸白），而该分支要求 ≥0.95×纸白（242.25）→ 再次落空
- 三条补救规则（`pale_max_channel_ratio` / `faint_floor_ratio` / `faint_min_drop`）都是按**三色共同特征**推的，而三色包络的 `max` 通道差 15 级、`min` 通道差 8 级 —— 不存在单一阈值能同时覆盖它们

**结论：靠"绝对通道/明度阈值"做双向分离，在这张图上做不到。** 需要一个**相对判据**：即 Lead 引用的 QA 方法 —— 以"浅层/深层跨度比 ≈ 5"（实测中位数 5.61、88.4% 的行落在 [4,6]）作为唯一依据，逐列判断"谁是谁的淡版"。这是**几何关系**判据，与颜色绝对值无关，因此天然对称。

### 4.3 下一步建议（按优先级）

1. **把 `solid-over-shadow` 标记为实验性**，或按当前实现保留"不可信即拒绝"。当前实现已做到后者。
2. **改用比值判据**：逐列取"同列内两个色族的跨度中位数之比"，`≈5` 者为包络。QA 的 `p9_p10_fivefold.py` 可直接复用。
3. **`standard` 路径的建议**：不要在 `standard` 里做双层分离（4.1 已证不可行）；改为**在 Step 1 检测出双层图时提示用户显式选择模式**，把"选错模式导致读数×5"变成用户可见的选择，而不是静默的默认值。

---

## 五、结论

- **D-0（两种阴影反向处理）：未解决。** 但已从"静默给错数"改为"显式拒绝"，危害等级从"会污染论文数值"降为"功能不可用"。
- **`extraction_mode` 贯通：已完成**（RPC ↔ session ↔ 三处调用点 ↔ 前端类型）。默认行为与改动前**逐位相同**：`threshold` 仍为 138.0，前景像素 **227,062** —— 与 `HEAD` 版 `image.py` 在同图同参数下算出的 227,062 完全一致（用 `git show HEAD:straditize_core/image.py` 隔离复算）。
- **`Caryophyllaceae` 默认路径修复：未完成**（1.4%，与基线相同）。灰度填充能被 `solid-over-shadow` 正确提取（99.0%），但该模式当前被拒绝放行。
- 门禁全绿，未放宽任何断言。

---

## 六、复现命令

```bash
# 三条验收数字（默认路径 + 阴影计量 + 拒绝行为）
pixi run python scripts/fix_probe/key_numbers.py

# 逐列覆盖率的两个口径对照
pixi run python scripts/fix_probe/measure.py

# 为什么"逐带局部 Otsu"被推翻（三角度反证）
pixi run python scripts/fix_probe/band_probe.py

# 门禁
pixi run lint
pixi run test
```

探针脚本位于 `scripts/fix_probe/`（本轮新建，仅我使用）。
