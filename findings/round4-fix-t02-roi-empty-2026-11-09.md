# 第四轮：T-02 + 产品决策③（2026-11-09）

> 承接 `round3-fix-t04-t01-2026-11-09.md`。本轮并行两条小改，均由独立 Verifier 复核，判「有效门禁」。
> 决策③ 显式改动了一条既有 spec（`journey.spec.ts`），该改动单独受了审读，结论：**不是放水**。

## 1 T-02：空输入点「应用标定」必须明确报错

### 改动
`frontend/src/components/steps/YCalibPanel.ts:123-215`
- `commitCalibration(reportMissing: boolean)`：`change` 监听传 `false`（逐框填写时必然缺项，静默），「应用标定」传 `true`（点提交才报错），「下一步」保持 `false`（不改变"可跳过标定"的工作流语义）。
- 缺项判定改为 `REQUIRED.filter(!Number.isFinite(...))`，命中时 `notifyError` **点名缺失字段**（空串 / `-` / `1e` 这类非数字一并算缺失）。
- 占位符 `556/0/1320/1500` **一字未改**（不用改文案当修复）。

选「可点 + 明确错误」而非「按钮 disabled」的理由：本应用 disabled 没有"为什么不可点"的说明通道；同面板已有同类用户错误走 `notifyError`；四框可由画布点选填充，真实用法是边点边试。

### 测试 `frontend/e2e/ycalib-empty-input.spec.ts`
1. 四框全空 → 点「应用标定」→ 断言：用户可见错误恰 1 条、**逐个点名缺失字段**、**真实 HTTP POST body 里没有 `core.calibrateAxes`**、后端 `isCalibrated===false` 且 `top_px/bottom_px` 仍 `null`（防占位符被当值写入）。
2. 负向对照：填齐四值 → 正好 1 次写请求，后端逐字段等于输入（锁死"永远报错/永远 disabled"）。

### 红 → 绿 → 金丝雀
| 阶段 | 结果 |
| --- | --- |
| 红（旧实现） | `✘ Expected: 1 / Received: 0`（连提示都没有），`1 failed / 1 passed`，exit 1 |
| 绿 | `2 passed (23.2s)`，exit 0；复跑 `2 passed (21.9s)` |
| 金丝雀（改回 `commitCalibration(false)`） | 同一句断言再红，exit 1；构建哈希 `C2h7sglR→VNpdL4iz` 证明真进产物 |

Verifier 另写探针实测：只缺 Y2 数值时文案是 `Y 轴标定未提交：请先填 Y2 数值（四个数值框都必须有数字）。`，**不泄漏**其余三个标签；`change` 失焦 0 提示；点「下一步」0 提示且后端仍 false。

## 2 决策③：新建 ROI = 待框选的空区域

### 先答后端约束（避免"发明默认尺寸"）
`roi.create`（`straditize_core/session_parts/roi.py:55-131`）**接受退化边界**：全零默认边界得 `xlim=[0,0] ylim=[0,0]`、自动编号、`name_source="default"`；显式 `x0==x1` 接受；越界夹到图幅内不报错。下游代价是**响亮失败**：空 ROI 上跑 `detect_columns` 会抛 `-32602 Bounds ... too small`，不是假数据。⇒ 无需改后端，也不需要发明默认矩形。

### 改动
| 文件:行 | 改动 |
| --- | --- |
| `frontend/src/services/InspectorBridge.ts:146-155` | `roi.create` 只传 `{composition:true}`，不再克隆边界、不再传 name |
| `frontend/src/components/canvas/hitTest.ts:116-126` | 零面积 ROI 的手柄命中直接返回 `br`（否则 8 手柄重合、先命中被夹死的 `tl`，拖拽纹丝不动） |
| `frontend/src/components/steps/RoiPanel.ts:19-25,68-75` | 空 ROI 的 `[data-roi-empty-hint]` 提示块（"按住手柄向右下拖"+"框选前勿进分列"） |
| `frontend/src/i18n/locales/{zh-CN,en}.ts` | 两条文案 |
| `frontend/e2e/journey.spec.ts:99-140,173` | **补一次真实鼠标框选**（见 §2.2） |

### 测试 `frontend/e2e/roi-create-empty.spec.ts`
五条判据全读后端 `rois[]`：面积 = 0；与既有 ROI 交集 = 0；`name_source==='default'`；active 切到新 ROI；面板提示可见且**框选落库后消失**。负向对照：真实鼠标拖到世界坐标 (900,700)，落库右/下边界与终点差 ≤5px。

### 2.1 红 → 绿 → 金丝雀
| 阶段 | 结果 |
| --- | --- |
| 红（克隆实现） | `Expected: 0 / Received: 1304800`（实收 `xlim=[315,1946] ylim=[511,1311]`） |
| 绿 | `1 passed (18.0s)`，exit 0 |
| 金丝雀（改回克隆 + 传 name） | 同一句再红，exit 1；构建哈希 `→ZTjFiWqv` |

### 2.2 既有 spec 的改动受审读（关键）
首次跑 `journey` **红了**：`应推进到步骤 5 Expected 5 / Received 4` + `-32602 Bounds [0,0],[0,0] too small` —— 它新建第二个 ROI 后直接推进分列，而新 ROI 现在是空区域（正是探针预言的后果）。

处置**不是放宽断言**，而是补一次真实鼠标框选（`frameActiveRoi`：从左上角手柄拖到世界 (1900,1300)，再轮询面积从 0 变正）。
Verifier 审读结论：`git diff --numstat` = **`48 0`（零删除行）**，原文断言/等待/步骤一字未动，且让 journey 多走了此前零覆盖的路径 ⇒ **不是放水，反而变强**。

## 3 判据层结论（复核要点）

- **T-02**：10 条断言里只有 2 条承重（提示条数 = 1、逐个点名）；其余是前置守卫或守"永远报错/永远 disabled/重复提交/乱写后端"。实现比门禁更强（点名粒度未被 spec 钉住），建议补一条"只缺 Y2"用例。
- **决策③**：五条判据里 3 条有判别力（面积 / `name_source` / 提示可见且框选后消失）；**交集那条数学上被面积蕴含**（无独立判别力）；**active 切换在克隆实现下同样绿**（无独立判别力）。"提示可见"不恒真——`RoiPanel` 每次 render 按面积现算，且断言框选后 `toHaveCount(0)`，堵死"永远渲染"。
- **(0,0) 抓手的可用性实测**：默认 fit 下落在画布内 `(340,190)`，不贴边不被遮；中键平移离开再回来，抓手屏幕位置与 `panX/panY` 逐像素复原（delta 0/0）。

## 4 门禁

| 命令 | 结果 | exit |
| --- | --- | --- |
| `pixi run lint` | `一致性核对通过` + `§4A matches the code.`（`.scratch/gate4-lint.log`） | **0** |
| `npm --prefix frontend run build` | 成功（`tsc && vite build`，`.scratch/gate4-build.log`） | **0** |
| `npx playwright test ycalib-empty-input roi-create-empty journey`（22969，逐条输出） | `✓ journey (21.0s)` / `✓ roi-create-empty (7.8s)` / `✓ ycalib-empty-input ×2 (6.6s + 6.1s)` → `4 passed (52.4s)` | **0** |
| `npx playwright test …7 个 spec`（22968） | 合并跑 exit 0（逐条行因 `npx` 子进程未进重定向而丢失，故不算证据） | 0（仅参考） |
| 相邻（Verifier 独立，22965） | `18 passed (2.5m)`（含 journey 20.2s） | **0** |
| `test:e2e:typecheck` | 通过 | **0** |

## 5 未解决

**产品问题（需拍板）**
1. **空 ROI 能被带进步骤 5**：`advanceToWorkflowStage` 不拦零面积 ROI，用户不框选就点下一步，到分列才吃 `-32602` 红 toast。建议：进入步骤 5 前若活动 ROI 面积为 0 → 停在步骤 2 并就地提示（改 `WorkflowController` 推进语义，单独一轮）。
2. **「下一步」仍零反馈跳过标定**（T-02 的同族）：`#btn-apply-ycalib-next` 缺项时静默推进。是"允许跳过"的设计选择还是缺陷，需要定义。
3. **空 ROI 不自动进视野**：先缩放/平移到别处再新建，抓手可能落在视口外（本轮只验证了默认 fit 场景）。

**已裁定未修**：T-06 重复写请求、T-07 `name_source` 错标（本轮 B 已在新建路径上顺带修正了名源，但 T-07 的裁定针对的是更早的独立路径，需回看是否已全覆盖）。

**Verifier 新报**：① T-02 spec 未钉"点名到具体字段"；② 决策③ 判据 B/D 无独立判别力，建议注释标明；③ `toBeTruthy()` 存在性断言；④ journey 的框选目标写死世界坐标 (1900,1300)，换图会静默失效；⑤ `hitTest` 返回 `'br'` 而文案说"左上角手柄"，措辞与实现不一致。

**环境**：`ops_bash` 仍不可用；全量 pytest 本机 ~40 min 未定性。

## 6 下一步原子动作

拍板 §5 第 1 条（空 ROI 是否阻断进入步骤 5）——定了就能把「空 ROI → 点下一步 → 停在步骤 2 并提示」写成一条能红的用例，同时把 §5 第 2 条一起收口。
