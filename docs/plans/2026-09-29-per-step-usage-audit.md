# 逐步骤可用性排查（e2e 驱动）

> 目标：让 8 步工作流**每一步都能被正常使用**。判据不是"面板渲染出来了"，而是
> **真实用户动作 → 后端权威状态发生预期变化**（`getDiagramData` 里的字段）。
> 范围外的既有问题按协作原则 3 只报不改，登记到 `docs/testing-strategy.md` §9。

## 1 方法与判据

每步走同一套流程，避免"看起来覆盖了"：

1. **列动作**：面板上所有可点/可输入的控件 + 画布手势 + 快捷键（来源：`frontend/src/components/steps/*.ts` 的 id 清单）。
2. **定预期**：这个动作**应该**改变哪个后端字段（不是只改 DOM）。
3. **查覆盖**：`grep -F <id> frontend/e2e/*.spec.ts`。⚠️ **命中 ≠ 覆盖**——现有用例常只断言"控件可见"或"点了不报错"。
4. **补断言**：写成"动作 → `getDiagramData` 权威字段"；等待条件用 `expect.poll`，且**轮询被断言的那个量本身**（见 `docs/testing-strategy.md` §4 纪律 3）。
5. **弄红**：新门禁必须实测能变红，否则等于没有门禁（同文 §8）。
6. **登记**：缺陷写进 §4；范围外的不修，写进 `docs/testing-strategy.md` §9。

规模判据（**只增不减**，当前实测值写注释里）：

```bash
# 面板控件：总数 / 被 e2e 触达数 —— 当前 60 / 43（2026-09-29，步骤 5 后）
# ⚠️ 本命令只统计 `id="…"` 形态的控件；**纯 class 按钮不计入**（如步骤 2 的
#    `.btn-delete-roi` / `.btn-set-primary` / `.roi-item-card`），所以它是下界而非全量。
ids=$(grep -ohE 'id="[a-zA-Z0-9_-]+"' frontend/src/components/steps/*.ts | sed 's/id="//;s/"//' | sort -u)
for id in $ids; do grep -qF "$id" frontend/e2e/*.spec.ts >/dev/null && echo "✔ $id" || echo "✘ $id"; done
```

## 2 逐步骤矩阵（2026-09-29 实测）

| 步 | 面板 | 已有用例（承诺了什么） | 从未被任何 e2e 触达的用户动作 |
| --- | --- | --- | --- |
| 1 载入 | `LoadPanel` + **顶栏三条入口** | ✅**已排查完**（新增 `step1-load.spec.ts` 3 用例）：范例下拉**每一项逐个真载入**、拖拽真实 PNG 后断言后端尺寸、载入副作用（自动 `pollen` ROI，`composition=True`）+ 推进按钮 | 已全部覆盖 |
| 2 ROI | `RoiPanel` | ✅**已排查完**（新增 `step2-roi.spec.ts` 3 用例）：建/命名/设主/推进会话已由 `journey` 覆盖，本轮补齐 **`.btn-delete-roi`**（删除同时是活动区+主区的那一个 → 两个指针级联重指派）、**`.roi-item-card` 点选**（切活动区后面板必须跟随该 ROI 的组分与名字）、**`#chk-roi-composition`**（写后端 + 局部更新不毁名字 + 刷新后一致）、**重名改名的拒绝路径**。4 条注入金丝雀全部实测变红 | 已全部覆盖（`.btn-delete-roi` 等 class 按钮不在 id 清单内，见 §1 注释） |
| 3 Y 轴标定 | `YCalibPanel` | ✅**已排查完**（新增 `step3-ycalib.spec.ts` 4 用例）：**成功路径首次被驱动**（四数值框+单位框+应用 → 后端 `calibration` 逐字段等于用户输入，前端镜像对账，HUD 反馈）、**`btn-repick-ycalib`**（清画布标记但不动后端；再次提交整体覆盖、五个字段全换）、**倒序输入归一**（先填深层后填浅层，后端按像素排序）、**后端同像素第二道防线**（绕过面板直调被拒 + 不留痕）。4 条注入金丝雀全部实测变红且只打红目标用例 | 已全部覆盖 |
| 4 清理 | `CleanupPanel` | ✅**已排查完**（新增 `step4-cleanup.spec.ts` 7 用例）：`workflow-panels` 已覆盖扫描候选与笔刷三态，本轮补齐 ①**本步目的动作**「确认去除」的因果链——`stats.geometry_removed_pixels` 从 0 起跳（证明真的动了掩膜）→「撤回」完整回退；②**「删除」真的从后端移除**（数量-1 且 id 不再出现）；③**加横/纵几何**（真拖拽画布 → 落库的 `axis`/`source='manual'`/`status`/`roi_id`/范围逐项对账）；④**改线宽**（`btn-apply-thickness-all` 全部变 7px 且**中心行一寸不动**；`-selected` 只动那一条）；⑤越界厚度前端当场拦下；⑥**`btn-clear-cleanup-edits`** 后端四项清零 + 面板计数必须跟着清零；⑦后端防线（绕过面板直调被拒）。7 条注入金丝雀全部实测只打红目标用例 | `cleanup-candidates-list`（容器本身无行为，其 `.cleanup-row` 子节点已被驱动）；`btn-add-exclusion-rect` 仍只有 `workflow-panels` 的可见性级覆盖 |
| 5 分列 | `NamingPanel` | ✅**已排查完**（新增 `step5-naming.spec.ts` 5 用例）：`naming` 只对账过区间归属与逐列高亮，**行内改名**这条本步的**目的动作**从未被驱动——一驱动就露出三个叠在一起的缺陷（见 §4 第 14/15/16 条）。本轮补齐 ①**焦点不被重渲染吃掉**（点开后 `document.activeElement` 就是那个输入框，真实键盘输入能落进去）；②**改名写回后端**（`getDiagramData` 的 `name`/`species`）且**经得起一次真实的重新分列**（证明写进了 `session.taxa_names`）；③**同 ROI 重名**当场拦下并回滚、后端不被惊动；④**后端名字合法性防线**（非法字符被拒 → 输入回滚 + 错误冒泡到 `alert`）；⑤**`btn-trigger-ocr`** 真的打开 OCR 复核模态。6 条注入金丝雀（C1–C6）实测只打红目标用例 | 已全部覆盖 |
| 6 标定列 | `XTicksPanel` | ✅**已排查完，且四条断链已收口**（发现见 §4 第 10、20 条；修法见 §6）。既有 `workflow-panels` 用例只覆盖"检测刻度且不假报"，且它是**真通过**的（实测本样本 `band=null`/`per_column=0`，确实没有标尺可检）。6 个控件里 **4 个此前从未被任何 e2e 触达**，现已全部驱动 | **已修**（B1）：`inp-manual-tick-val1/2` + `btn-save-manual-ticks` 实测真发 `column.calibrateXTicks` 并落库、**真实 reload 后仍在**；`btn-clear-col-ticks` 在标定后真的渲染出来、点击真清后端。新增 `step6-xticks.spec.ts` 5 例 + `test_xticks_rpc_contract.py` 9 例，两组金丝雀实测能变红。**遗留**：第 21 条（回步骤 5 重新分列会静默抹掉**列级用户态**，含全部标定）待决策；第 20 条（导出/采样仍不读 `x_ticks`）属 B2；第 22 条（标定顺带重置 `plot_type`/`scale_type`/放大倍数）已修 |
| 7 拐点与采样 | `SamplesPanel` | ✅**已排查完**（`step7-8-audit.spec.ts`）：共识提取落库、单行层位删除（`.btn-delete-sample`）真发 `samples.set` 且后端数量-1、清空层位、推进到步骤 8 | 已全部覆盖 |
| 8 校验 | `QaPanel` + `ExportReadinessPanel` | ✅**已排查完**（`step7-8-audit.spec.ts`）：门禁容差输入联动 `qa.summarize` 重新计算、未标定列显式标出 ⚠️ 未标定、异步返回就地更新 peaks/exceptions 容器、就绪清单标定统计显示 | 已全部覆盖 |

## 3 排查队列（按"最可能藏 bug"排序）

优先做**用户能输入/能改参数**的路径——输入校验与单位换算是历史高发区；纯展示项最后做。

0. ✅**步骤 1 载入（已完成）**——结论见 §4 第 5 条。附带学会两条判据，后续步骤沿用：
   - **枚举型 UI 要遍历真值**：下拉/列表类控件的可用性不能靠"有这一项"证明，要**逐个真选中并断言后端权威状态**。死选项（有菜单项、无后端能力）只有遍历才会暴露。
   - **造与基线不同的输入**：拖拽用例若用一张与当前基线同尺寸的图，链路整条静默失效也会通过。探针图必须与基线**可区分**（本例 321×123 vs 基线 2339×1654）。
1. ✅**步骤 6 手填刻度（已完成）**——**查出四条断链**，结论见 §4 第 10、20 条。附带学会一条判据，后续步骤沿用：
   - **"这个动作发了什么请求"本身就该被实测**：本轮用 `page.on('request')` 逐个记录点击后发出的 RPC 方法名，直接读到 `[]`（**一个都没有**）——比"后端字段没变"更早、更无歧义地指出断点在哪一侧。此前查覆盖只问"控件被点过吗 / 断言了什么量"，还要再问一句"它**究竟把请求发给了谁**"。
2. **步骤 8 容差输入**（`qa-inp-tolerance`）：改了之后**是否真的重算**，还是只改 DOM（"看起来生效"型失效的高发区）。
3. ✅**步骤 4 加几何 + 改线宽（已完成）**——结论见 §4 第 11、12 条。`selected` vs `all` 的作用域确实不同（实测：全部 → 所有宽度变 7；选中 → 只那一条变 13、其余不动）。附带学会两条判据：
   - **"RPC 成功" ≠ "面板已重挂"**：`applyCleanupState` → `Inspector.updateData` → `render()` → `bindEvents()` → `stepPanel.mount()` 会**整块替换**步骤面板 DOM。在"后端已返回、面板还没重挂"的窗口里点击会落在正在被替换的节点上（静默无操作），而 `mount` 闭包捕获的却是**旧**的 `<input>`（读到陈旧值）。本轮 3 条用例就是这么假红的。缓解：交互前先 `settle()`——轮询到 `.cleanup-row` 行数**等于**后端 `line_candidates.length` 再动手。注意这个条件**只证明行数对**，同数量的重挂它看不出来，所以不能当"万事俱备"用。
   - **归因要挑"能归因"的统计量**：`final_removed_pixels` 是**并集**（`candidate_line_mask | degrid | exclusion | strokes`），确认一条几何后它变大，**不能证明是这一条几何干的**；`geometry_removed_pixels`（掩膜只按 `statuses={REMOVED}` 构建）才是因果信号——检测后恒 0、确认后才 >0。选错统计量会写出一条"永远通过"的断言。
4. ✅**步骤 4 `btn-clear-cleanup-edits`（已完成）**——**查出真实缺陷**，结论见 §4 第 11 条：后端清了、面板还在宣称存在排除区。
5. ✅**步骤 5 分列与命名（已完成）**——**查出三个真实缺陷**，结论见 §4 第 14、15、16 条（外加第 17 条的多 ROI 索引口径）。本步是本轮到目前为止**缺陷密度最高**的一步，而且三个缺陷叠在**同一条用户动作**（行内改名）上：输入框打不进字 → 打得进也不落库 → 落了库也经不起重新分列。附带学会一条判据，后续步骤沿用：
   - **"控件可见/可点" ≠ "目的动作可用"**：`NamingPanel` 此前有"列名对账 + 逐列高亮"的用例，看起来这一步"覆盖过了"；但**本步存在的意义**（给属种列改名）从未被驱动过。判据：先问"这一步做完，用户手上多了什么"，再去点那个"多了什么"，而不是清点控件。死按钮（`#btn-trigger-ocr`）与"点了没反应"的输入框都只有走到目的动作才会暴露。
6. ✅**步骤 2 `chk-roi-composition`（已完成）**——结论见 §4 第 7 条。附带学会一条判据：
   - **局部更新（PATCH 语义）必须单独钉**：只带一个字段的请求，最容易把未传字段一起抹掉。
     断言"改了 A" 不够，要同时断言"没动的 B 还在"。本例 `roi_update` 用 `is not None` 逐字段
     守住，但这条纪律值得固化成惯例（后端将来若改成整条记录替换，本用例会立刻变红）。
7. ✅**步骤 3（已完成）**——结论见 §4 第 8、9 条。附带学会两条判据：
   - **"成功路径从未被驱动"是最隐蔽的假覆盖**：步骤 3 有 3 处既有用例，但**没有一条**验证过
     "填四个数 + 单位 → 点应用"之后后端真的等于用户输入。查覆盖时不能只问"这个控件被点过吗"，
     要问"它的**成功终态**被断言过吗"。判据：`grep -F <控件id>` 命中后，再看那条用例**断言了什么量**。
   - **前端自算的"权威值"必须与后端对账**：`RpcClient.calibrateDepthAxis` 返回的
     `top_px/top_cm/…` 是拿前端自己刚发出的 marks 现排序算的，没读后端 `depth_calib`。
     今天两边归一规则相同所以相等——于是要用 `toEqual` 把两个来源钉在一起，
     后端哪天改了归一而前端没跟，门禁立刻变红。
   - **一次注入只证明"它打红的第一条断言"**：用例内断言按序短路，靠前的断言会成为靠后断言的
     **保护伞**。步骤 3 注入「忽略单位」后用例 1 变红，但红在后端 `unit` 断言上，最后那条
     "比例预览不得恒为 `--`"**根本没执行到** ⇒ 对它零证明力，必须再做一次只破坏比例计算的注入。
     判据：想证明哪条断言有判别力，注入就必须让**前面那些先全过**。
8. ✅**步骤 6 手填刻度（已完成，见上）**——步骤 3 期间提前探到的 #10，本轮扩成完整机制（四条断链），并额外查出 §4 第 20 条的**标度事实源分裂**（导出/采样读的根本不是用户标定值）。
9. **步骤 1 `btn-goto-step2`**、步骤 7 层位列表（次要）。

## 4 发现登记

| # | 步骤 | 现象 | 性质 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | 4 | 笔迹落库竞态：`applyLineRemoval` 两阶段写（先 `line_strokes` 后 `cleanup_stats`），轮询 `line_strokes.length` 会读到上一轮的 0 | 测试缺陷 | 已修：轮询统计量本身 |
| 2 | 4 | 「清空笔迹」只清前端镜像 + 发不带 `strokes` 的重算请求，后端 `strokes is None` 语义是"保持原值"→ 掩膜从未改变 | **真实缺陷** | 已修：走 `setLineStrokes([])` |
| 3 | 4 | 笔迹与清空都 `history.push`，但 `HistorySnapshot` 不含 `line_strokes` → 幽灵撤销项 | **真实缺陷** | 已修（方案 b）：清理编辑不进撤销栈 |
| 4 | 8 | `main.ts` 工具栏导出失败只 `console.warn` 再打开**空**导出面板，把失败伪装成"导出成功但无内容"（违反不变量 1） | **真实缺陷** | 已修：`reportBackendFailure` 且停在原地 |
| 5 | **1** | 顶栏范例下拉的「验证图谱」**永远无法载入**：`session.py:143` 指向 `verification_real_pollen_edit.png`，而该文件是 `scripts/verify_real_pollen_edit.py` 的产物（依赖上游 PyQt5 测试框架 `_base_testing`，本环境跑不起来）**且被 `.gitignore` 的 `verification_*.png` 排除**，全新克隆必失败。实测：`hoya` ✔ 2339×1654 / `beginner` ✔ 1923×1796 / `verification` ✘ `-32004 内置范例图片缺失…请确认仓库完整性`（错误信息还把责任推给用户） | **真实缺陷**（打包/设计） | 已修：从下拉移除该死选项（单行、可逆、纯前端）；后端 `core.loadImage` 保留该 key。门禁 `step1-load.spec.ts` 逐项真载入 + 已过金丝雀 |
| 6 | 5/6（OCR） | `session.py:3308` 每次 OCR 调用都 `new OcrTaxaRecognitionEngine(...)`，其 `_init_models()` 重新 `ort.InferenceSession` 读盘加载两个 PP-OCRv4 模型；`ocr/engine.py` 全文无任何缓存/单例 | **真实设计缺陷**（性能） | 未修（属后端改动）。证据：一轮 34 用例的 e2e 里该日志出现 39 次。已登记 `docs/testing-strategy.md` §9 |
| 7 | **2** | 重名改名被后端拒绝后，**名字输入框不回滚**：实测后端 `roi_2` 名字仍是 `roi_2`、卡片列表也是 `["pollen","roi_2"]`，但输入框里留着被拒的 `pollen` —— 面板内部自相矛盾（输入框显示了一个后端并不存在的名字）。`main.ts` 的 `onRenameActiveRoi` 只在成功分支重渲染，catch 里仅 `reportBackendFailure` | 设计缺陷（轻，UX 一致性问题；非静默——用户已收到 `alert`） | **未修**：两种行为都说得通（回滚输入框 vs 保留草稿让用户改），而 ROI 多区域模型是**现代版自创**、老版 `straditize/` 无 ROI 概念可供对齐，故属产品决策。最小修法（1 行，可逆）：在 `onRenameActiveRoi` 的 catch 里补一句 `sidebar?.updateData(canvasComponent.data)`——失败时后端数据未变，用现有镜像重渲染即可让输入框回到真值 |
| 8 | **3** | 步骤 3 的**成功路径零覆盖**：3 处既有用例分别只测"标记数量变了"、"图层被绘制"、"同像素被前端拒绝"，**没有一条**断言过提交后后端 `calibration` 等于用户输入。四个数值框与单位框的成功分支此前从未被驱动 | 测试缺陷（假覆盖） | 已修：`step3-ycalib.spec.ts` 用例 1 逐字段对账（含 `unit`），并加"基线与用例输入重合则失去判别力"的前置反断言 |
| 9 | **3** | `RpcClient.calibrateDepthAxis`（`RpcClient.ts:386-397`）返回的 `top_px/top_cm/bottom_px/bottom_cm` 是**前端拿自己刚发出的 marks 现排序算出来的**，没读后端返回的 `depth_calib`；后端 `calibrate_axes` 的返回体里根本没有 `canvas` 键。当前两边归一规则一致所以数值相等，但这是"前端宣称权威值"的结构性隐患（违反 `docs/ARCHITECTURE.md` §2 的精神） | 设计缺陷（契约味道，当前无可见故障） | **未修**：属 RPC 契约改动，超出本轮。已用 `step3-ycalib.spec.ts` 的三处 `toEqual`/`toMatchObject` 把前端镜像与后端权威值**钉在一起**——后端将来改了归一而前端没跟，门禁立刻变红 |
| 10 | **6** | **`x_ticks` 整条链路断裂——实测四条断链**（e2e 探针，不是推断；下游后果另见第 20 条）：①**UI→后端断**：`#btn-save-manual-ticks` 点击后**一个 RPC 都没发出**（`page.on('request')` 实测方法名列表 = `[]`），只改浏览器内存；切到步 5 再回步 6 后镜像 `x_ticks` 回到 `undefined`、输入框回到 `0/100`（任何一次 `getDiagramData` 重取都会丢）。②**后端→前端断**：`system.py:134-157` 的列载荷白名单**没有 `x_ticks`**（而 `types/pollen.ts:37` 声明了它、`XTickOverlay.ts:19-22` 靠它画标尺、`XTicksPanel.ts:14` 靠它判断已标定）；实测直调 `column.calibrateXTicks` **成功**（返回 `x_ticks:[{332,5},{497,15}]`、`px_per_unit=16.5`）之后，`getDiagramData` 与 `getState()` 里 `x_ticks` **仍是 `undefined`** ⇒ 存储有、载荷剥，`hasTicks` 恒 false：面板永远显示“未标定”、标尺叠加层永远画不出来。③**工程往返断**：`project_save`（`session.py:1980-2018`）逐字段白名单写列（`startValue`/`tickValue`/`tickEndX`/`endX`）**不含 `x_ticks`** ⇒ 标定后存工程再载入即丢。④**根本没有清除方法**：后端无 `column.clearXTicks`，而 `#btn-clear-col-ticks` 仅在 `hasTicks` 为真时渲染、`hasTicks` 又依赖恒空的 `x_ticks` ⇒ 实测计数**恒 0**，该按钮从未出现在任何用户面前 | **真实缺陷**（本步主功能不可用 + 标定值不持久化） | **未修，待决策**：四条断链必须一起收口（只修一条会留下“看起来生效”），方案见 §6 |
| 11 | **4** | **「清空本步全部几何/排除区/笔迹」这个按钮骗人**（e2e 实测）：点下去后端确实清了（`line_candidates`/`exclusion_regions`/`line_strokes` 三项归零、`#cleanup-stats` 也改口成"几何 0 条…排除区 0 px"），但面板 §③ 的表头**仍显示 `排除区 (1 个)`**——同一次渲染里统计行说 0 个、表头说 1 个，自相矛盾。根因：后端 `_recompose` 的返回体只含 `candidates`/`selected_ids`/`stats`/`overlay_png`，**不含** `exclusion_regions` 与 `line_strokes`，而 `applyCleanupState` 只覆盖它认识的那四个键 ⇒ 前端镜像里那两项原样存活 | **真实缺陷**（用户可见的自相矛盾；非静默——后端已真清，是界面在撒谎） | **已修**：`main.ts` 的 `onClearCleanupEdits` 在拿到返回值后同步把镜像归零（`line_strokes = []`；`exclusion_regions` 按后端语义**过滤**而非整体置空——只清 `roi_id` 为本 ROI 或 `None` 的，别的 ROI 的要留）。回归钉子 = `step4-cleanup.spec.ts` 用例 6 的**面板断言**（已过金丝雀：撤掉这两行后该用例红在 `toContainText('排除区 (0 个)')`，实测面板文本同时出现"排除区 0 px"与"③ 排除区 (1 个)"） |
| 12 | **4** | **越界厚度的"标红"用户根本看不见**（e2e 实测）：`CleanupPanel.applyThickness` 的守卫逻辑本身是对的（写注释的人明确说"越界不静默：把输入框标红，用户一眼知道是输入的问题"），但它用的是**普通内联样式** `style.borderColor = '#ef4444'`，而 `style.css:55-62` 有一条日间模式"强兜底安全网"`body.theme-light input[type="number"] { border-color: #cbd5e1 !important }` —— `!important` 压过普通内联样式。实测：点击后 `el.style.borderColor` = `rgb(239,68,68)`（内联确实写了），**但 `getComputedStyle(el).borderColor` 仍是 `rgb(203,213,225)`**（用户看到的还是灰的） | **真实缺陷**（"看起来生效"型失效；代码注释承诺的可见反馈从未渲染过） | **已修**：改用 `style.setProperty('border-color', '#ef4444', 'important')`（内联 `!important` 优先级高于作者样式表 `!important`，是唯一能穿透那条安全网的写法），复位改用 `removeProperty` 连优先级一起清掉；原处留注释说明**为什么必须带 `!important`**，防止日后被当冗余删掉。回归钉子 = `step4-cleanup.spec.ts` 用例 5 的 `toHaveCSS`（已过金丝雀：退回普通内联样式后该用例红在 `Expected "rgb(239, 68, 68)" / Received "rgb(203, 213, 225)"`）。⚠️ 教训：这条断言必须用 **computed** 值，断言 `el.style.borderColor` 会**永远通过**——正是"从不失败的门禁" |
| 13 | **4** | `set_line_thickness` 的越界/未知 id 走的是 `raise ValueError`（`cleanup.py:391/397/417`），经 dispatcher 统一兜成 **`-32603 后端内部错误`**，前端据此提示"请查看服务器控制台日志排查"；而同类的前端可校验参数（如 `calibrate_axes`）用的是 **`-32602 INVALID_PARAMS`**，能给出可读的字段级原因 | 设计缺陷（错误码语义不一致；用户拿到的是"内部错误"，指向排查方向错误） | **未修**：属后端改动，且"是否把 ValueError 统一映射成 `-32602`"是全局决策（还有别的算法方法同样 raise ValueError），超出本轮。已登记 `docs/testing-strategy.md` §9。门禁侧不空等：`step4-cleanup.spec.ts` 用例 7 只断言"**被拒**且几何不变"，不绑死错误码——将来改成 `-32602` 不会假红 |
| 14 | **5** | **行内改名输入框打不进字**（e2e 实测，探针取证）：点击列名进入编辑 → `focusin` 处理器调用 `onDataChange` → `Inspector.updateData` → `render()` **整块重建侧栏 DOM** → 刚拿到焦点的 `<input>` 被替换，`document.activeElement` 退回 `BODY`。探针实测 `sameNodeAfterFocus=false`、`activeElementIsTheInput=false`，逐字输入后 DOM 仍是旧值 ⇒ 用户一个字都改不了（本步的**目的动作完全不可用**） | **真实缺陷**（本步主功能不可用） | **已修**：`Sidebar.renderPreservingInlineEdit()` —— 重渲染前快照正在编辑的那个 input 的 `{colId, value, caret}`，重渲染后找回同一 `data-col-id` 的节点、回填值、恢复焦点与光标；并用 `restoringInlineEdit` 标志让 `focusin` 处理器在"程序性恢复焦点"时直接返回，**避免自己触发自己形成递归**。回归钉子 = `step5-naming.spec.ts` T1（金丝雀 C1 实测该用例红） |
| 15 | **5** | **改名从不落库**（e2e 实测，两个半边）：①前端 `onRenameTaxa` 只改内存镜像（`col.name`/`col.species`）就 `history.push` + 重渲染，**从头到尾不发任何 RPC**——界面显示新名字，后端 `columns[i].name` 纹丝不动；②补上 RPC 后 T2 又红：后端 `naming.rename_column` 写的是 `if idx < len(taxa_names): taxa_names[idx] = clean_name`，而 `taxa_names` 在"载入图片 → 分列"这条**正常路径**上恒为空列表（`session.py:471` 载入即清空，只有工程载入 `:1898` 与 `column_add` 才填充）⇒ 该 `if` **静默跳过**，一次真实的重新分列把名字打回 `col02`。实测 T2 失败信息：`Expected "E2E_TAXA_01" / Received "col02"` | **真实缺陷**（数据不持久化；且后端是"静默跳过"型——正是"看起来生效"的温床） | **已修**：前端补 `RpcClient.renameColumn`（`naming.renameColumn`）并在 `onRenameTaxa` 里 `await` 后成功才提示、失败**回滚镜像 + 冒泡报错**；后端先把 `taxa_names` **补齐**到 `len(columns)`（缺失位按列名回填）再写目标下标，替换掉那个静默 `if`。回归钉子 = T2（金丝雀 C2 打红"写回后端"那一步、C3 打红"经得起重新分列"那一步，两者**分开**验证过） |
| 16 | **5** | **面板【自动识别属种名】是死按钮**（e2e 实测）：`NamingPanel` 的 `#btn-trigger-ocr` 处理器去点 `#btn-open-ocr` / `#topbar-btn-ocr` / `[title*="OCR"]`，而这**三个选择器在真实 DOM 里都不存在**（顶栏真正打开 OCR 复核的按钮 id 是 `#btn-ocr-review-modal`，title 是 `自动识别图谱顶部种名并为各列匹配新列名`）；又因为写法是 `?.click()`，**永远不会抛错**——点下去毫无反应且没有任何提示 | **真实缺陷**（用户可见的哑按钮；同为"从不失败"形态） | **已修**：把 OCR 复核模态的开启收敛成一个 `main.ts` 顶层函数 `openOcrReviewModal()`（内含"尚未分列就先提示、不要打开空模态"的前置守卫），顶栏与 Inspector 都注入它，`NamingPanel` 改为调用 `ctx.onOpenOcrReviewModal`。回归钉子 = T5（金丝雀 C6 打红） |
| 17 | **5**（连带 **6**） | **`taxa_names` 扁平列表扛不住多 ROI**：`detect_columns` 的列名还原原先用**本 ROI 局部**下标读 `taxa_names`，而写入点 `naming.rename_column` 与另外三个读取点（`session.py:1364`/`:1586`/`:1980`）用的都是**全局** `col_index`。多 ROI 时两边差一个 `len(other_cols)`：在右 ROI 上改的名字，重新分列右 ROI 时读回来的是左 ROI 的名字（pytest 实测：期望 `RIGHT_ONLY`，实得 `col01`）。**更深一层**：`col_index` 本身由 `merged_cols = other + detected` 现场重排，换个 ROI 重新分列会让**所有**列的下标平移，扁平列表无论如何都对不上 | **真实缺陷**（第二部分是结构性的） | **前半已修**：还原循环改为用全局下标（`offset = len(other_cols)` 起算）——这是消除"写入/读取口径不一致"的最小改动，单 ROI 行为逐位不变。**后半未修**（属 RPC 契约/数据结构决策，超出本步）：彻底解决要把列名**按列 id** 存（或干脆以 `columns[i]["name"]` 为单一事实源、由它重建 `taxa_names`），已登记 `docs/testing-strategy.md` §9。回归钉子 = `tests/integration/test_multi_roi.py::test_multi_roi_column_names_follow_global_col_index`（金丝雀 C7 退回局部下标后实测变红） |
| 18 | **5** | **修 #15 时自己引入的幽灵撤销项**（自查发现）：给改名接上 RPC 之后，"失败要回滚"变成一条**新出现**的代码路径，而 `history.push('Rename Taxa …')` 排在 `await rpcClient.renameColumn(...)` **之前** ⇒ 后端拒绝时内存名字回滚了、栈顶却留着"新名字"那一帧：栈深度被虚假占用，且把 `canUndo()` 从 false 顶成 true（与步骤 4 第 3 号缺陷同族） | **真实缺陷**（本轮改动引入，非历史遗留） | **已修**：`history.push` 与 `toolbar.updateHistoryState()` 一起移进 `try` 的**成功分支**（`await` 之后）——快照内容不变、失败时不再入栈。⚠️ **未加门禁，且是有意为之**：UI 层拿不到撤销栈深度，而基线状态下 `canUndo()` 已是 true ⇒ 断言"按钮 disabled 状态不变"会**恒真**，正是 §8 说的"一个从不失败的门禁"。宁可不写，也不写一条假门禁；此处只留代码注释说明为什么入栈必须在 `await` 之后 |
| 19 | **3**（同族见于 **5** #14，机制上波及 **4/6/8**） | **面板重挂吞掉用户正在输入的内容与焦点**（步骤 5 收尾跑全量 e2e 时以偶发假红暴露）：五个标定输入框都挂了 `change` → `commitCalibration`（`YCalibPanel.ts:143-145`），只要四个数值可解析就发请求（`:121-123`）；而每次提交成功后 `applyDepthCalibration` 都调 `inspector.updateData()`（`main.ts:1687`）→ `Inspector.render()` 把 `this.element.innerHTML` 整个换掉（`Inspector.ts:142`）→ 步骤面板重挂、输入框按**后端值**重建。**实测**（探针，非推测）：① 写进 `#ycal-inp-bot-px` 的 `1100` 在一次重挂后从 DOM 里消失（仍是 `1198`，且那一发提交根本没发出）；② `core.calibrateAxes` 往返仅 **2.97 / 4.81 ms**，重挂几乎与 `change` 同时发生；③ 焦点被摧毁——`change` 前 `activeElement` 是 `ycal-inp-top-val`，`change` 后立刻变成 `<body>`。用户可见后果：填完一个框按 Tab，下一个框随即失焦，接着敲的数字落不到任何输入框；连改两个框时后一个的值可能被重挂吃掉 | **真实缺陷**（全量 e2e 偶发假红的根因） | **未修，待决策**：不能在 `Inspector.render()` 里简单"保留焦点输入框的值"——步骤 5 已实测过反面（后端拒绝时把焦点框的旧值搬过去会**掩盖后端的纠正**，那里必须先 `blur()`）。正解是把"数据更新"与"DOM 拆除"解耦（面板实现 `update(data)` 而非整块重建），属跨全部 8 步的交互架构改动。当前只做两件事：用例侧 `commitYCalib` 改为"一次写全五个值 + 只点一次应用"（只发一次提交 ⇒ 与顺序无关），并登记 `docs/testing-strategy.md` §9 |
| 20 | **6 → 7/8** | **标度事实源三套并存，导出与采样读的从来不是用户标定值**（e2e 正向对照实测）：`export_data`（`session.py:1384-1389`，即 `export.csv` 与 `core.exportData`）与 `extract_grid_values`（`session.py:1633-1639`，步骤 7 采样）都用 `LinearCalibration([start, tickEndX], [startValue, tickValue])`，即建列时写死的种子 `0/100/col_end`，**从不读 `x_ticks`**；多格式导出 `get_roi_dataframes` 虽读 `x_ticks`，但它恒空 ⇒ 落到 `val0=0, val1=100` 的**编造兜底**（`session_parts/export.py:134-138`）；`qa.py:134` 的 `declared_max` 同样因 `x_ticks` 恒空而恒为 `0.0`。**正向对照**：直调 `calibrateXTicks` 把列 0 标成 `[10,20]` 后，`export.csv` 的 `col01` 列**逐字节不变**（`[0.0,0.0,4.0,4.0,…]`，min 0 / max 62.8571）⇒ 同一份数据，CSV 与 XLSX/LiPD **两套实现给出语义不同的数值**，且都与用户标定无关；`declared_max` 恒 0 使“峰值 vs 声明上限”的检查退化为空转 | **真实缺陷**（数据正确性；违反 `docs/ARCHITECTURE.md` §2 不变量 1“绝不返回替代数据”） | **未修，待决策**：与第 10 条同根，方案见 §6.1（推荐 A）；**`0–100` 自造标度无论选哪个方案都必须去掉**（改成 `CALIBRATION_ERROR`） |
| 21 | **6 → 5** | **重新分列静默抹掉列级用户态（含全部 X 标定）**（e2e 探针实测，非推断）：把 col0 标成 `[{px:322,value:0},{px:497,value:40}]` 后，① 直发一条 `core.detectColumns`（**就是进入步骤 5 时 UI 自己会发的那条 RPC**——`main.ts:706` 的 `else if (targetStage === STAGE.SPLIT)` 分支对所有 ROI 循环调用 `detectColumnsInRoi`，**没有任何「已分列且未改动」短路**）⇒ `getDiagramData` 里该列 `x_ticks` 立刻变 `null`；② 走真实 UI 路径（标定 → 点步骤 5 → 回步骤 6）结果相同，`#btn-clear-col-ticks` 计数随之回到 0。**根因（读码确认，比初判更宽）**：`detect_columns`（`session.py:858-923`）从零构造列对象、只写 legacy 种子，然后**仅从 `taxa_names` 回填列名** ⇒ 被重置的不是 `x_ticks` 一项，而是**该 ROI 全部非几何列级用户态**（`x_ticks`/`unit`/`plot_type`/`scale_type`/`has_exaggeration`/`exaggeration_mult*`）；列名是唯一被显式保留的字段。**先纠正一处误判**：老版 `DataReader` **不是** ROI，而是**分列之后对列的分组**（`iter_all_readers = parent + children`，默认整图一组，children 承载夸饰列等子组），标度值存在组上、px 以列起点为参照（`binary.py:2327-2341`、`widgets/plots.py:751-771`），因此它天然不受列重建影响；而现代版**没有列组对象**、**故意按列存**（`x_ticks` 即 SSOT，决策 C），并用按列的 `exaggeration_mult` 表达老版 child reader 那套「另一套标度」⇒ **不能简单上提为 ROI 级**（会丢掉同一 ROI 内不同列不同刻度的能力，而 `hasExaggeration`/`exaggerationMult` 正是**按列**的）。用户可见后果：**在步骤 6 标定完，只要回步骤 5 改个列名再回来，全部标定归零**；而按决策 C，步骤 7 采样与导出正要读它 | **真实缺陷**（静默数据丢失；B3 的前置阻塞） | **未修，待决策**。候选：**（甲）按列 id 继承**——id 形如 `roi_1_colNN`，是**位置序号**，列数一变就张冠李戴；**（乙）按像素区间重叠继承**——几何上站得住，但边界移动后「还算不算同一列」要靠阈值判定，判错即静默给错标度；**（丙）不继承但显式告知**——重新分列后红字提示「标定已失效，请重新标定」，最保守、不伪造；**（戊）列级用户态整体「列外存储 + 重建时回填」**——复用 `taxa_names` 已有机制、一次性覆盖同族全部字段，改造面最大但最彻底；建议叠加**（己）去掉「进入步骤 5 即重分列」**（属幂等性缺失，「只是路过就丢数据」的杀伤面由此而来）。**修法已升级（2026-09-29 定案，废止本行原候选甲/乙/丙/戊）**：根治并入「**列分组（ROI 内）**」设计——组挂在 ROI 上并承载 单位/形态/尺度类型/放大倍数/**刻度位置**，刻度**数值**留列上（D1=乙）⇒ 重新分列时「形式与位置」**结构性不丢**（这正是老版 `DataReader` 把标度存在列外的收益）；只剩每列两个数值需按「列数不变 → 按序号回填 + 区间守卫；列数变了 → 不回填并显式上报失效列数」保住，并叠加（己）**去掉「进入步骤 5 即重分列」**这一幂等性缺失。**设计唯一事实源 = `docs/plans/2026-09-29-column-groups-design.md`（v2，自 P0 起实施）** |
| 22 | **6** | **点一次【保存】会顺手重置该列其它标度字段**（pytest 实测，先红后修）：`calibrate_column_xticks` 的形参 `unit="%"` / `plot_type="area"` / `scale_type="linear"` / `exaggeration_mult=None` 是**固定默认值且无条件覆盖**既有值，而面板只发 `col_index+ticks+unit` ⇒ 用户先在左栏设好的 `plot_type`(bar)、`scale_type`(log)、放大倍数被静默打回默认/清空（实测 `unit` 从 `'粒'` 被打回 `'%'`）。B1 把面板接上真 RPC 之后，这条路径**首次变得可由 UI 触达**，属本轮改动引入的回归 | **真实缺陷**（本轮引入；静默覆盖用户设置） | **已修**：四个形参默认改 `None` 且**未传 = 保持原值**（仅 `is not None` 才写；`mult_source` 只在真写放大倍数时置 `user`），docstring 写明该契约。回归钉子 = `test_xticks_rpc_contract.py` 新增两条（「未传保持」与「显式传参仍生效」），前者修前实测红在 `assert '%' == '粒'`。**顺带登记（未修）**：放大倍数是**三处键名/通道分裂**——前端镜像读写 `exaggerationMult`↔`exaggeration_multiplier`，且 `Inspector` 的 exag 控件只改内存 + 压撤销栈、**没有专属 RPC**（`grep -n exag frontend/src/main.ts` 为空），而导出/QA 读的是 `exaggeration_mult`，其写入者只有两处：本方法与 `roi_apply_form_defaults`（`roi.py:339-365`，把 `form_defaults.exaggerationMult` 写给全 ROI，但**全仓零调用点**） ⇒ UI 上的倍数永远到不了导出（属 B2/B3 范围） |
| 23 | **3 / 6** | **左栏五个 X 标定输入框从来没有进过后端**（`grep` 实证，非推断）：`#inp-sc-origin-x` / `#inp-sc-origin-val` / `#inp-sc-calib-x` / `#inp-sc-calib-val` / `#inp-sc-unit`（`Inspector.ts:256-285`）全部只挂 `updateScaleCalib`（`Inspector.ts:428-471`），而该函数只写**前端镜像**（`scaleCalib`/`startX`/`startValue`/`unit`/`maxPercent`/`tickValue`/`tickEndX`）+ `history.push` + `render()`，**不发任何 RPC**；同时 `RpcClient.updateColumn`（`RpcClient.ts:953-954`）与字符串 `'column.update'` 在 `frontend/src/` 内**零调用点**。后果：**用户设的满量程永远到不了后端**——后端始终用 `detect_columns` 的伪造种子（`startValue=0`/`tickValue=100`/`tickEndX=列右边界`，`session.py:871-873`、`:895-897`）去算 CSV/Parquet 导出、步骤 7 采样、XLSX/LiPD 导出与步骤 8 校验，即「**后端认为每一列都是 0–100% 标尺**」。这与已修的步骤 6「【保存】按钮从不发 RPC」**完全同型**，也是「两条换算链长期不一致却无人察觉」的成因之一 | **真实缺陷**（静默无效；用户设定的数值与实际参与科学计算的数值不符） | **已修**：`updateScaleCalib` 接入 `rpcClient.calibrateColumnXTicks`，形态/尺度/放大倍数切换接入 `rpcClient.updateColumn`，失败报警且不留幻影撤销项；由 `step6-xticks.spec.ts` T6 锁死回归 |
| 24 | **8** | **`QaPanel.ts` 异步诊断返回时遗漏更新异常与单列超刻度容器**：`updateDomWithSummary` 只写了 banner 与 4 个数值卡片，完全漏掉了 `#qa-exceptions-container` 与 `#qa-column-peaks-container`，导致页面首次挂载后这两个区域一直停留在"暂无列刻度信息"的占位符上 | **真实缺陷**（界面数据脱节） | **已修**：提取 `renderExceptionsHtml` 与 `renderColumnPeaksHtml`，在 `updateDomWithSummary` 异步返回时就地更新 innerHTML |
| 25 | **7** | **`SamplesPanel.ts` 单行层位删除按钮从不落库**：`.btn-delete-sample` 点击后只对前端内存 `cachedSamplesData.samples.splice(idx, 1)`，从不调用 `samples.set` RPC，导致删除仅在页面内存生效，重新载入或后端采样计算完全不知情 | **真实缺陷**（静默未持久化） | **已修**：点击后同步调用 `rpcClient.call('samples.set', { samples: ... })`；由 `step7-8-audit.spec.ts` 锁死回归 |
| 26 | **5 / OCR** | **OCR 识别后点【确认无误，一键赋予图谱各列】必抛 `Cannot convert undefined or null to object`**（`ocr-modal.spec.ts` 实测抓获）：后端 `ocr/engine.py::snap_labels_to_columns` 返回的 `reconciliation` 字典不含 `assigned` 键；`OcrReviewModal` 将其存入 `latestReconciliation` 后，点击应用触发 `NamingPanel.render()` 执行 `Object.entries(recon.assigned)` 直接崩溃，弹窗报错且无法关闭 | **真实缺陷**（前后端契约漏键导致步骤 5 主路径崩溃） | **已修**：`ocr/engine.py` 补齐 `assigned` 映射，`NamingPanel.ts` 增加 `recon.assigned \|\| {}` 防御，同时修复 `ocr_apply_labels` 未同步更新 `session.taxa_names` 的隐患；由 `ocr-modal.spec.ts` T2 锁死回归 |
| 27 | **年代 / 导出** | **`export_multi_lipd` 漏掉默认导出 `ensemble_tables` 分支**（`agedepth-modal.spec.ts` 实测抓获）：`export_multi_xlsx` 写了 `elif ensemble_tables: selected_ensembles = ensemble_tables`，而 `export_multi_lipd` 漏了该 `elif`，导致不显式传 `include_ensemble_names` 时 `chronEnsembleTable` 恒丢失 | **真实缺陷**（导出丢表） | **已修**：`session_parts/export.py` 补齐 `elif ensemble_tables:` 分支，并将各列真实 `unit` 与 `depth_unit` 传入 `export_lipd_jsonld`；由 `agedepth-modal.spec.ts` T1 与 `metadata-modal.spec.ts` T1 锁死 |
| 28 | **年代弹窗** | **`AgeDepthModal` 测年表【➕ 加一行】(`#btn-ad-add-date-row`) 是死按钮，且行内输入框未绑事件**（`agedepth-modal.spec.ts` T2 实测抓获）：按钮仅存在于 HTML 模板，全文无 `addEventListener`，点击后行数为 0 | **真实缺陷**（死按钮） | **已修**：绑定 `#btn-ad-add-date-row` 增行与行内 `input/select` 的 `change` 同步；由 `agedepth-modal.spec.ts` T2 锁死 |
| 29 | **元数据弹窗** | **顶栏 `#btn-metadata-modal` 被写死 `display: none`，用户无可见入口打开元数据弹窗；且 `MetadataModal` 保存失败被 `catch {}` 静默吞掉** | **真实缺陷**（隐藏入口 + 吞错） | **已修**：顶栏恢复可见的【📄 元数据】按钮，按 LiPD v1.3 补齐采集/分析人、数字化人、单位、野外采集时间、基金、国家、水深、孔长等字段，保存失败显式 `alert`；由 `metadata-modal.spec.ts` T1 锁死 |

## 5 已知不在本轮范围

- 44/90 个应用 RPC 无边界验证（WebMCP `callTool` 可直通任意方法名，非死代码）。
- 后端 `apply_line_removal` 先发布 `line_strokes` 再发布 `cleanup_stats`，并发读者可见自相不完整载荷——对 UI 无害（UI 用同一次响应），对测试是陷阱，已在 §1 纪律 3 记录。

## 6 步骤 6 修复方案（决策已被取代，2026-09-29 晚）

> ⚠️ **本节原有决策已被「列分组（ROI 内）」设计取代**：标度事实源不再是「逐列 `x_ticks`」，
> 而是「**ROI 内的组**」——组承载 单位/图形形态/尺度类型/放大倍数/**刻度位置**，刻度**数值**留列上。
> **设计唯一事实源 = `docs/plans/2026-09-29-column-groups-design.md`（v2）。**
> 下面 **B1 已完成且仍然有效**（载荷补 `x_ticks`/`col_index`、新增 `clearXTicks`、工程包存 `x_ticks`、
> 面板接真 RPC、`col_index` 统一寻址、以及第 22 条的修复）；
> **B2 / B3 / B4 由该设计的 P0 / P4 / P5 取代**，不要再按本节原计划单独执行。

**决策**（2026-09-29 定，⚠️ 已被上方取代，保留以存史）：
- 标度事实源 = **C**：`x_ticks` 为唯一事实源，**删除 legacy 三件套**（`startValue`/`tickValue`/`tickEndX`/`maxPercent`）。旧工程包**不就地拒绝**，改为**载入时迁移**（legacy → `x_ticks`），见 B3。
- 未标定列的导出 = **乙**：保留几何兜底（列宽百分比），但必须**显式标记**（`x_ticks: null` + `has_ticks: false`），并在**步骤 8 就绪清单**红字警告「N 列未标定，导出值是列宽百分比而非丰度」。`0–100` 自造标度**不再冒充**用户标定值。

依据：这不是新设计，而是把**做了一半的迁移**做完——`types/pollen.ts:37-38` 早已把 `x_ticks` 写成「标度的唯一事实源」、把 legacy 四字段标注为「严格保持向后兼容过渡别名」；`tests/unit/test_x_ticks.py` 已按 `x_ticks` 立契约（并专门 grep 禁止 `tickValue / col_width` 公式）；`tests/unit/test_qa_summary.py:130-132` 直接写着 `"tickValue": 999.0,  # Obsolete field - MUST be ignored`。

### 6.1 批次计划（每批单独绿，不制造中间态）

| 批 | 内容 | 判据 |
| --- | --- | --- |
| **B1** ✅ | **纯增量**：载荷补 `x_ticks`（`null` = 未标定）**与 `col_index`**；新增后端 `column.clearXTicks`；工程序列化补 `x_ticks`；`XTicksPanel` 两个按钮（保存/清空）接真 RPC——**成功才** `history.push` + 提示，失败 `reportBackendFailure` 且**不回写镜像**（照第 15 条模式），成功后显式 `inspector.updateData()` 让面板按后端真值重建；列寻址统一用 `col_index`（`calibrate_column_xticks`/`clear_column_xticks` 改收 `int \| str`，走 `_resolve_col_index`）。legacy 三件套**原样保留** | 步骤 6 手填/清空**真的落库**、重取后仍在；六门禁全绿；既有行为零变化 |
| **B1 门禁** ✅ | `tests/unit/test_xticks_rpc_contract.py`（9 例：载荷带 `x_ticks`/`col_index`、`clearXTicks` 语义含 `cleared:false` 不产生幻影撤销、工程 json 往返、旧包不带 `x_ticks` 即未标定、id/序号等价、未知 id 给 -32602）+ `frontend/e2e/step6-xticks.spec.ts`（5 例：保存真发 RPC、清空按钮渲染与真清、空读数当场拦下、**真实 reload 后标定仍在**、载荷字段齐全） | 已过两组金丝雀：剥载荷 `x_ticks` → {T1,T2,T4,T5} 红 / 摘掉面板 RPC 调用 → {T1,T2,T3,T4} 红（合起来每个用例都被证伪过一次）；后端门禁注入后 {2 例} 红 |
| **B2** | 消费者改读 `x_ticks`：`export_data`（`session.py:1384-1389`）、`extract_grid_values`（`:1633-1639`）、`get_roi_dataframes`（`session_parts/export.py:128-138`）、`qa.py:129-139`；前端所有读取点改读 `x_ticks`（legacy 仅兜底） | 直调 `calibrateXTicks` 后**导出数值随之改变**（第 20 条已证当前逐字节不变） |
| **B3** | **删除** legacy 三件套：建列种子（`session.py:871-897`）、载荷白名单（`system.py:128-151`）、工程序列化（`:1914-1918`/`:2013-2015`/`:2169-2171`）、`roi.py:352-353`、前端类型与全部引用；旧工程包**载入时迁移** legacy → `x_ticks`。**另需先解决第 21 条**：`detect_columns` 重建列时必须决定标定怎么继承，否则 B2 一上线，用户「回步骤 5 改个名」就会静默丢掉全部标定 | 全仓 `grep` 三件套只剩迁移代码与注释；旧工程包载入后标度正确；**重新分列后标定不丢**（新增判据） |
| **B4** | 契约文档（`JSON_RPC_SPECIFICATION.md` 补三处名字 + 字段、`ARCHITECTURE.md` §4）、步骤 8 就绪清单红字（`x_ticks` 为空时的警告文案） | 文档 `grep` 得到三处方法名与 `x_ticks`/`col_index` 字段；步骤 8 在未标定时显示红字而不是静默用 0–100 |

不进本轮：`#btn-detect-xticks` 检测结果自动落库（涉及「自动标定是否覆盖用户手填值」的策略，单独一轮）。

