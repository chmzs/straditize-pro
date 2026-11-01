# 步骤 6（标定列与 X 轴刻度）交接 — 2026-11-01

> 读者：接手调试与完善的人。这里只写**能据以动手**的事实，不写过程叙事。
> 热状态卡在 `HANDOFF.md`；本文件是它的展开版。

## 0. 30 秒开工

```bash
cd E:/software_dev/straditize
npm --prefix frontend run build        # 前端产物 -> frontend/dist（后端据此托管）
pixi run app                           # 起服务并开浏览器

# 机械门禁（提交前必跑）
pixi run lint                          # ruff + UI 一致性 + RPC 文档漂移
npm --prefix frontend test             # 含 test-ruler-geometry.mjs 等 Node 侧判据
cd frontend && npx playwright test step6-ruler-geometry.spec.ts step6-xticks.spec.ts group-scale-ruler.spec.ts
```

后端全量：`.pixi/envs/default/python.exe -m pytest tests/ -q`（约 12 分钟）。

## 1. 已验收可用 —— 别推翻

| 能力 | 事实依据 |
| :--- | :--- |
| 刻线几何来自后端检测 | `algorithm.measureRuler`（`ruler.py::detect_ruler_for_columns`），**只在步骤 6 调用**。beginner 实测：4 列、刻距 126/125/124/124、median 124.5、`all_regular=true` |
| 0 点 = 实测轴线右缘 | `ruler.py::_find_axis_x()` → `axis_x`/`axis_x_right`；前端 `DetectedSpan.axisX` 用它，识别不到才退回 `col.startX` |
| 标度由「每根齿单位数」给出 | `px/单位 = 检测刻距 ÷ 每根齿单位数`；每列用**自己**检测到的末齿当第二端点（端点必落在列内，无需夹取） |
| 分组 | 侧栏复选框批量（Shift 连选）+ **画布点选成组**（`+ 分组` → 图上点列 → 确认）+ 删除本组；`getDiagramData().columns` 已带 `x_group_id` |

**判据可证伪（已实测）**：把锚点退回 `col.startX` → T3 变红；把命中测试坐标挪出画布 → T5 在「已选 1 列」变红；把跨度写死 40 → T3 得 0.44 px/单位变红。

## 2. 已修 bug（别重复排查）

1. **`algorithm.measureRuler` 全仓无调用**：`types/rpc.ts` 有类型声明，但没有任何组件调用；面板要用户手工拉尺，`refSpan` 兜底 `40.0`，界面出现过 4px。
2. **`getDiagramData().columns` 缺 `x_group_id`**：前端读到 `undefined`，只能把每列当默认组 → 分组界面永远显示错误归属。已在 `rpc_methods/system.py` 列序列化补上（含 `roi_id` 判重）。
3. **异步检测结束就整块重渲染**：`ensureRulerGeometry` 末尾 `ctx.onDataChange?.()` 会把 `innerHTML` 换掉，**用户正在填的输入当场消失**。这是 `step6-xticks T7` 偶发红的真因（填完值→检测返回→输入被冲→保存写旧值）。已改为 `patchRulerDom()` 只就地更新检测行与跨度文字；T7 连跑 3 次全绿。
4. **选列提示条被插进 flex 行**：成了「包含 N 个属种列 + 批量调整」那一行的第三个 flex item，被挤成 173px、文字折 5 行。已移出该行并重排；新增**布局门禁**（提示条宽度须 > 面板 80%）。
5. **`step6-xticks T7` 恒红**：它点的 `#btn-apply-ticks-to-group` 已在 `d3ff653` 被 `#btn-apply-group-scale` 取代（`git log -S` 可查），全仓无此元素。已把该用例收敛到仍有效的 Enter 保存断言。

## 3. 未完成（按优先级）

### P0 — 分列期就写入猜测刻度（**决定未定，见 A/B**）

现象：列一生成就带

```
tickEndX      = startX + max(20, min(0.65 × 列宽, 80))
scaleCalib.calibX = 同值
maxPercent    = 20
```

beginner 四列实测 `339 / 1034 / 1432 / 1656`（全部 = `startX + 80`）。

危害：界面据此画出**看着像已标定的红虚线**；`scale_provenance.calibrated=false` 只是旁证，用户看到的是假刻度。粘贴导入路径还有硬编码 `maxPercent: 40`（`GeologyCanvas.ts:573` 邻近）。

落点：`XTicksPanel.ts::getColCalibX`（约 50-62）、`GeologyCanvas.ts` 内同构函数（约 1545-1558）、上述 `tickEndX` 赋值处。

两种改法（**需产品决定**）：
- **A**（推荐）检测到才画，检测不到**不画**；顺带清掉 `maxPercent` 默认值。代价：未标定列在步骤 5 会"空"一些。
- **B** 保持现状，只在步骤 6 用检测。

### P1 — 步骤 5 完全不接检测

`measureRuler` 唯一调用点是步骤 6。步骤 5 的参考虚线全部来自 P0 的猜测。若要让步骤 5 也显示实测刻度，需把几何拉到画布层（分列完成后自动拉一次）。

### P2 — 组模数不持久

`session_parts/roi.py:446` 的 `allowed_fields` 不含 `ref_span_px / ref_val_start / ref_val_end`，前端写组模数被**静默丢弃**，只活一个会话。当前「每根齿单位数」走前端 `refDrafts`（内存），重开页面即丢。

### P3 — 手工单列标定仍用猜测 px2

`InspectorBridge.onCalibrateXTicks` 的 px2 = `startX + min(65% 列宽, 80)`。应改为检测到的末齿；检测不到应**拒绝**而不是猜。

### P4 — 全量 e2e 的既有失败（非本轮引入）

`naming:126`、`suspect-block T1/T2/T3`、`x-ticks-dropped T1/T4b/T5`。已用 `git stash` 基线对照确认与步骤 6 改动无关。

## 4. 硬约束（违反即回退）

- **绝不产出满量程读数**：每格代表多少是作图书版设定，图上无法推得。证据见 `ruler.py::suggest_scales` 的反证表（跨列外推实测 **−84% / +151%**）。
- **前端错误必须冒泡**：失败一律 `notifyError` 或面板显示原文，禁止静默兜底成默认值。
- **改 RPC 契约必须同步** `docs/JSON_RPC_SPECIFICATION.md`；`scripts/check_rpc_spec_drift.py` 已挂进 `pixi run lint`。
- **门禁必须可证伪**：新增断言要能在"把被测代码退回错误实现"时变红，否则等于没测。

## 5. 关键数字（复核对齐用）

| 图 | 尺寸 | 轴线左缘 | 轴线右缘 | 末齿 | 刻距 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `beginner-tutorial.png`（沉积图谱） | 1923×1796 | 259 / 947 / 1352 / 1576 | 262 / 952 / 1357 / 1581 | 825 / 1262 / 1542 / 1766 | 126 / 125 / 124 / 124 |
| `output/han2026_ngamring/fig3_raw.jpeg`（22 列） | 2132×928 | — | — | — | 12–13（多数列）/ 19–20 / 31 px，跨列 px/单位一致 ≈ 1.245 |

beginner 四列齿相对轴线右缘：60–61 / 185–187 px → 折算 9.6–9.8 / 29.6–29.9 / 49.7，与图印 **10 / 30 / 50** 吻合。

## 6. 冷历史

`HANDOFF.md`（热卡）｜`HANDOFF-archive/`（只增不减，日常不加载）
