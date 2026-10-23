# 设计规格：按列判定单层/双层，消除"单层灰列被当阴影"缺陷

> 状态：**待评审** ｜ 作者：Lead ｜ 2026-10-21
> 目标缺陷：`docs/findings/fix-two-axis-layering.md` §8.5 记录的已知局限
> 前置：`scripts/benchmark_two_axis.py` 是验收基准（当前 97.4% / 多读 0）

---

## 1. 问题陈述

当前 `split_by_colour_and_luminance` 用**一个图级边界**分层，判据是
`pale_tier & vivid`：淡档里"非彩色"的像素一律判为阴影。

这导致：**单层灰列**（如 QA 合成图的 `(182,182,182)` 列，该列没有任何包络）
被误判成阴影，覆盖率 0%。

而同一张图上"中灰实心 + 浅灰包络"的双层列却需要把 229 判成阴影。
**两种情形在列内直方图上完全同构**（都是单峰 182 或 229），
仅凭列内信息无法区分。

## 2. 决定性事实（已实测，作为设计依据）

| 事实 | 内容 | 命令 |
| :--- | :--- | :--- |
| A | **单层图**：每一列都只有一个墨层峰 | 黑列 `[0]`、灰列 `[182]` |
| B | **双层图**：15/15 列都呈**双峰** | Han2026 逐列扫描 |

推论：**"该列内部是否有 ≥2 个墨层峰"是区分单层/双层列的直接判据**，
不需要任何跨列猜测，也不需要图级聚合。

## 3. 设计

### 3.1 核心规则

对每个列带（`column_edges[i] .. column_edges[i+1]`）：

```
peaks = 该列内的墨层峰（已过 ink_floor 与抗锯齿过滤）

if len(peaks) >= 2:
    # 双层列：最亮峰是包络，其余是实心
    boundary = (peaks[-1] + peaks[-2]) / 2
    solid  = rel < boundary
    shadow = rel >= boundary 且非纸
else:
    # 单层列：唯一的墨层峰就是实心，该列没有包络
    boundary = 该峰与纸之间（取 min(solid_ratio, 峰 + ink_gap/255)）
    solid  = 该列所有非纸像素
    shadow = 空
```

### 3.2 单层列的边界：`min(1.0, peak + ink_gap)` —— **规格已修订**

> 原文写的是 `min(solid_ratio, peak + ink_gap)`。**该式错误，已修订。**

- `peak + ink_gap` 覆盖该峰自身的抗锯齿过渡带；
- **不能用 `solid_ratio` 截断**：单层列没有包络，不存在"边界需压低以免吞掉包络"的问题；
  截断反而会把墨切掉。

**实测反例（QA 复核确认）**：单层灰列明度 215（rel 0.8431）配 `solid_ratio` 0.84 时，
`min` 取到 0.84，而峰本身 0.8431 > 0.84 → **整列被判阴影、覆盖率 0%**。

正确形式：`min(1.0, peak + ink_gap)` —— 仅以纸面为上限。
实现已按此修正（`straditize_core/image.py` 按列分支，附实测反例注释）。

### 3.3 包络跨列问题（上一轮失败的根因）如何解决

上一轮按列失败，是因为**包络画得比实心宽、会越出所属列**，
落在邻列（低边界列）内的包络像素被判成实心。

本设计**不再用"每列一个边界"去切整幅图**，而是：

1. 逐列判定该列是**单层**还是**双层**（这是列级属性，可靠）；
2. 双层列用**自己的**双峰边界；
3. 单层列全部非纸像素算实心；
4. 落在列带之外/跨界的像素，用**全图边界**兜底。

关键差别：单层列不再参与"淡档判定"，因此不会被邻列的低边界误伤。

## 4. 验收判据（必须全部满足）

| # | 判据 | 阈值 | 验证方式 |
| --: | :--- | :--- | :--- |
| V1 | 基准通过率（可分离组合） | ≥ 97.4%（不得低于当前） | `pixi run python scripts/benchmark_two_axis.py` |
| V2 | **多读**（`shadow_leak > 0.05`） | **= 0**（硬门槛） | 同上 |
| V3 | 混合图全对 | = 100%（不得低于当前） | 同上 |
| V4 | 真实图版 8 类色簇 | 8/8 | 见 §6 复现命令 |
| V5 | **QA 单层灰列** | ≥ 95%（当前 0%） | `tests/unit/test_metric_sanity.py` |
| V6 | 内建教程图 `removed` | = 0（不得削掉墨） | `test_two_axis_layering.py` |
| V7 | 门禁 | lint 全绿 + test ≥382 passed | `pixi run lint` / `pixi run test` |

**V2 与 V6 是硬门槛**：任一不满足则不得合入。
- V2 是"多读"，用户无法察觉，危害最大；
- V6 是"削掉既有墨"，会让教程图结果与文档不符。

## 5. 明确不做的事

- **不改** `solid-over-shadow` 实验模式（它已被显式拒绝，保持原样）；
- **不改** RPC 契约（本轮是纯算法改动，无新方法、无新字段）；
- **不改** `session_parts/`（避免与并发任务冲突）；
- **不引入**新的图级阈值常数（所有阈值必须可从本图/本列派生）。

## 6. 复现命令

```bash
# 基准（V1–V3）
pixi run python scripts/benchmark_two_axis.py

# 真实图版 8 类色簇（V4）
pixi run python -c "
import sys; sys.path.insert(0,'.')
import numpy as np
from PIL import Image
from straditize_core.session import StraditizeSession
a=np.array(Image.open('output/han2026_ngamring/fig3_raw.jpeg').convert('RGB')).astype(int)
s=StraditizeSession(); s._init_cleanup(); s.load_image('output/han2026_ngamring/fig3_raw.jpeg')
s.extract_foreground(); m=s.foreground_mask
for lbl,c,exp in [('中灰',(182,182,182),'in'),('深灰',(167,167,167),'in'),('浅灰阴影',(229,229,229),'out'),
                  ('浅粉阴影',(244,226,226),'out'),('浅蓝阴影',(218,226,237),'out'),('纯黑',(0,0,0),'in'),
                  ('深红',(180,60,60),'in'),('深蓝',(0,62,137),'in')]:
    sel=(np.abs(a-np.array(c)).max(-1)<=8); n=int(sel.sum())
    cov=(sel&m).sum()/max(n,1)*100
    print(f'  {lbl:<8}{cov:>6.1f}% {exp}')
"

# QA 单层灰列（V5）
pixi run python -m pytest tests/unit/test_metric_sanity.py -q
```

## 7. 风险与回退

| 风险 | 缓解 |
| :--- | :--- |
| 逐列判定引入新的边界不稳定 | 用 §4 的 V1–V7 全量验收，任一退化即回退 |
| 单层列全算实心 → 若某单层列其实是"只有包络"的列 | 该情形在物理上不存在（包络必须依附实心），但需在测试里钉一条反例 |
| 与并发任务冲突 | 写作用域限定 `image.py` + 新测试文件 |

**回退点**：当前 `image.py` @ `sha256 05d821608dd46d66…` 是可工作基线（97.4% / 多读 0 / 真实图版 8/8）。
