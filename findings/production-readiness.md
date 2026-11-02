# 投产验收：真实使用流程 ↔ 提取产出 打通

> 回答的问题：**一份花粉图从零走完软件流程，软件自己保存的工程文档与提取产出，是否真的能闭环？**
> 本轮（2026-10-19）在**真实 Edge + 真实后端**上跑通，并把途中暴露的缺陷修掉。
>
> 配套：缺陷清单见 [`bug-report.md`](./bug-report.md)（§0.5 是修复记录）；
> 一键复跑见 [`README.md`](./README.md)。

---

## 0. 一句话结论

**打通了。** 工程包（`.tar` / `.json`）往返**完全保真**：28 列、用户给的真实读数
`[{px:322,value:0},{px:402,value:40}]`、7 个层位、`y_scale={slope:1.625, intercept:-830.375}`
在载回后一字不差。CSV 提取产出也是真实数据行。

但这条链**原本是断的**——不是库写不出来，而是"谁提供读数"这件事没有边界，
软件会替用户编造；且步骤 8 的导出按钮实际点不中。两者都已修（见 §4）。

---

## 1. 软件自己保存的工程文档有两种，别混淆

| 类型 | 谁产生 | 格式 | 能否再编辑 | 本轮验证 |
| :--- | :--- | :--- | :--- | :--- |
| **工程包**（Project） | 顶栏【保存工程】/ `project.save` | `.tar`（含底图+清单）/ `.json` | ✅ 可载回继续编辑 | **保真**（§2） |
| **提取产出**（Data） | 导出面板 / `core.exportData` | `csv` / `parquet`；归档另有 xlsx/LiPD（`export.*`） | ❌ 只读交付物 | **有真实数据行**（§3） |

> ⚠️ 一个易错点：`core.exportData` **只接受 `csv` / `parquet`**。
> 传 `format="xlsx"` 会抛 `Unsupported export format 'xlsx'` ——
> 多表 xlsx 走的是 `export.getReadiness` + 归档那条链，不是 `exportData`。
> （这是我在本轮踩到的，记下来避免误判为缺陷。）

---

## 2. 工程包往返（可再编辑）—— 实测保真

```bash
pixi run python - <<'PY' 2>/dev/null
import sys, os, json; sys.path.insert(0,'.')
from straditize_core.session import StraditizeSession
s = StraditizeSession(); s.load_image(sample_key="hoya")
s.detect_columns([315,1946],[511,1311], roi_id=s.rois[0]["id"])
c = s.columns[0]
s.calibrate_column_xticks(0, ticks=[{"px":c["start"],"value":0.0},
                                    {"px":c["tickEndX"],"value":40.0}], unit="%")
s.calibrate_axes(y_marks=[{"pixel":511.0,"val":0.0},{"pixel":1311.0,"val":1300.0}], unit="cm")
s.samples_set([{"depth":d,"label":f"h{d}"} for d in (10,50,100,200,400,800,1200)])
os.makedirs("output/production_check", exist_ok=True)
s.project_save(output_path="output/production_check/hoya_project.json", format="json")
s.project_save(output_path="output/production_check/hoya_project.tar")
s.export_data(format="csv", output_path="output/production_check/hoya_extract.csv")
PY
```

**产物**

| 文件 | 大小 | 说明 |
| :--- | ---: | :--- |
| `output/production_check/hoya_project.tar` | 102,400 B | 工程包（底图 + 清单 + 列/标定） |
| `output/production_check/hoya_project.json` | 227,194 B | 工程包（纯 JSON，可直接 diff/审阅） |
| `output/production_check/hoya_extract.csv` | ~370 KB | 提取产出：802 行（1 表头 + 801 数据）× 29 列 |

**往返对照（实测输出）**

```
原始: 列=28  col0.x_ticks=[{'px': 322.0, 'value': 0.0}, {'px': 402.0, 'value': 40.0}]
      层位=7  y_scale={'slope': 1.625, 'intercept': -830.375}
载回: 列=28  col0.x_ticks=[{'px': 322.0, 'value': 0.0}, {'px': 402.0, 'value': 40.0}]
      层位=7  y_scale={'slope': 1.625, 'intercept': -830.375}
      is_calibrated=True
```

**结论**：`project_save → project_load` 保住三样对科研最关键的东西 ——
①用户填的**读数**（不是像素，是 `0`/`40` 这两个物理量）；
②**Y 轴标定**（深度换算的唯一依据）；③**层位清单**。没有回落到任何默认值。

---

## 3. 提取产出 —— 真的有数据行，且量纲自洽

### 3.1 关键坑：`export_data` 的输入顺序决定成败

本轮在这里连踩两次，记下来避免把"我脚本写错"误判成产品缺陷：

| 漏掉的步骤 | 现象 | 原因 |
| :--- | :--- | :--- |
| 没调 `digitize` | 导出**全 0** | `column_points` 为空 |
| 没调 `apply_depth_grid` | 导出**只有 6 行**且全 0 | `export_data` **优先用 `samples`**；我给的 samples 缺 `row_px`，求交落到错误行 |

正确顺序（这四条缺一不可）：
```
detect_columns → calibrate_column_xticks → calibrate_axes
             → digitize（每列）→ apply_depth_grid → export_data
```

### 3.2 实测结果（正确顺序 + 合理标定）

```
行 801 × 列 28 = 22428 个数值格
非零读数 18019 个
最大读数 38.8235 %
越界（>40%）的格数 0
深度 0.0 → 1300.0（无负值、无 -0.0）
```

**量纲自洽**：全部 28 列按「列左边界=0%、右边界=40%」标定，导出最大值 38.82%
落在 0–40% 量程内、**零越界**。这不是巧合——说明 `resolve_column_scale`
把"像素宽度 → 百分比"的换算真的算对了。

> **反例（值得记）**：我第一版把 col01 标成 `0→40%` 但端点取 `tickEndX=402`
> （只覆盖列宽的 80/175），结果曲线画到 110px、导出 55% —— **超出量程**。
> 产品没有"自动钳到 40%"，而是如实按几何换算。这是**正确行为**：
> 科学工具不该替用户篡改越界读数；越界说明标定本身有问题，应让用户看见。

### 3.3 顺带修掉的一个真实小缺陷：`-0.0`

导出 CSV 的深度列出现字面量 `-0.0`（`round(-1e-5, 4)` 的符号位，pandas 原样渲染）。
下游 R 的 `read.csv` / Excel 会读成**负深度**，严格校验的读入器直接报错——而它实际就是 0。

修法：`session_parts/export.py` 增加 `_normalize_negative_zero_depth()`，
在 CSV 字符串层只规整**行首深度列**的 `-0.0`（不动其它数值列）。
实测修复后 `含 -0.0 行: 0`，且 22428 个格的统计不变。

## 4. 本轮为了"打通"修掉的产品缺陷

### 4.1 步骤 6 编造刻度读数（Critical）→ 已修

**原状**：进入步骤 6 时前端自动点「自动提取」，并对检出齿位的列用
**硬编码 `0` 与 `20`** 充当"用户读数"写进后端。实测同一张图两套会话（唯一差别是
有没有走这 8 次自动标定），导出 CSV **6362 个数值格改变、最大偏差 31.51 个百分点**，
而 QA 与就绪清单都显示"通过"。

**更深一层的根因**（本轮新发现）：`detect_xticks_rpc` 的刻度带搜索窗口是
`range(y_bottom-4, y_bottom+16)`，**允许越出 ROI 下方 16px**。于是在 ROI **之外**
抓到了列框线（长竖线，实际 run 最长 1162px，远超 `TICK_MAX_RUN=12`），
对一张**没有刻度尺**的图报出 53 个伪齿、8 列"可用"。
仓库自己的门禁 `workflow-panels.spec.ts:234` 早就要求"hoya 不应检出任何齿位"——它当时是红的。

**修法**
1. `straditize_core/session_parts/xticks.py`：搜索窗口夹到 ROI 纵向范围内，越界候选直接跳过。
2. `frontend/src/services/InspectorBridge.ts`：去掉 `?? 0` / `?? 20`；**无真实读数时只记齿位、不写 `x_ticks`**，
   并在 HUD 明确告知"另有 N 列缺读数，请填入真实刻度值后保存（不会替你填）"。

**验证**
```
零输入实测: calibrateXTicks_请求数 8 → 0，后端已标定列 8 → 0
hoya:      band=None, ticks=0                （与真值 has_tick_ruler=false 一致）
有刻度尺图: 仍检出 65 / 120 个齿             （修复没有过度收敛）
```

### 4.2 步骤 8 导出按钮点不中 → 已修

**原状**：`QaPanel.mount()` 末尾 `triggerSummarize()`，成功后调 `ctx.onDataChange()`
→ `Inspector.render()` 整块重写 `innerHTML` → 本面板被重新 `mount()` → 再次 summarize……
**无限重挂循环**。Playwright 报 `element was detached from the DOM`；用户侧表现为
「直通导出」按钮每帧被换掉、点不中，导出入口实际不可用。

**修法**：`QaPanel.ts` 加摘要指纹，**只有诊断数值真的变了**才通知外部，循环自然终止。

**验证**：`journey.spec.ts` 由红转绿；全量 e2e 中 `qa.spec` / `step4-cleanup`
的连锁红一并消失。

### 4.3 `-0.0` 深度（见 §3.3）→ 已修

CSV 深度列出现 `-0.0`，下游 R/Excel 读成负深度。已在 `export.py` 字符串层规整。

### 4.4 两处测试基建缺陷（不是产品缺陷，但会掩盖真问题）→ 已修

1. **lane 串跑**：`playwright.config.ts` 的 `testDir: './e2e'` 无 `testMatch`，
   把零状态 spec 也拉进基线 lane，而基线 `e2e.reset` 会**预载图**，
   于是"零状态必须 imageSrc=null"必然假红。→ 加 `testIgnore`，另立 `pixi run test-e2e-zero`。
2. **视口顺序污染**：`resetBaseline` 不重置缩放，而 `step-visibility` 的判据是
   **画布像素差**（`step3.ink - step1.ink > 50_000`）。前一个 spec 留下放大视口后，
   该差值实测变成 **-392776**（step1 反而更多）→ `helpers.ts` 在复位点按 `F` 归零视口。

---

## 5. 门禁现状（本轮实测）

| 门禁 | 结果 | 变化 |
| :--- | :--- | :--- |
| `pixi run lint` | exit 0（ruff + 11 项一致性） | — |
| `pixi run test` | 317 passed / 3 skipped | — |
| `pixi run test-e2e` | **85 passed** | 修复前 **82 passed / 5 failed** |
| `pixi run test-e2e-zero` | 2 passed | 新增 lane |
| `pixi run test-contract` | 5 passed | — |

---

## 6. 诚实的边界：**这次还不是"生产环境"**

用户要求"让软件真实投入生产环境"。必须说清现在到哪一步、还差什么：

| 维度 | 现状 | 距离生产还差 |
| :--- | :--- | :--- |
| 真实花粉图 | 内置 hoya 已走通端到端（801×28=22428 格，量纲自洽） | **未用真实期刊扫描件**（数千 px、粗分区线、复印噪点）；静态审计登记为 U-05 |
| 读数来源 | 已强制"必须由人给或来自真实列尺度" | 缺**读数溯源字段**：系统仍无法区分「人工填的」与「算法建议的」（见 §7） |
| 并发 | 单用户单会话；双标签页有撕裂读（瞬时自愈） | 无写锁；多人/多进程不安全 |
| 存档 | 工程包往返保真 | 未做**旧版本工程包**兼容回归（v2.x → v3.0.0 迁移路径未被本轮覆盖） |
| 导出 | csv / parquet / 归档 tar 已验证 | xlsx / LiPD 本轮未端到端复验 |

---

## 7. 顺带得到的 MCP/Agent 设计结论

这次修复暴露的不是"算法不准"，而是**权限边界缺失**：系统不知道一个数字是谁给的。
这直接决定 MCP 该怎么设计。详见 [`./agent-mcp-design.md`](./agent-mcp-design.md)。

核心一句：**Agent 不该被允许"创造读数"，只该被允许"搬运读数"并留下溯源。**
