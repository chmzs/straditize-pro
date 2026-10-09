# Straditize Pro UI 设计系统

本文定义现代版界面的视觉、文案与交互规范。业务状态机与画布手势仍以 `docs/ARCHITECTURE.md` 为准。

## 1. 设计原则

1. **任务优先**：每个视图只突出一个下一步动作；其余操作降低层级。
2. **科研可信**：状态和错误如实呈现，不用替代数据、营销文案或模糊成功提示掩盖缺失。
3. **单语呈现**：界面跟随当前语言；ROI、OCR、LiPD、Bacon 等规范名可保留英文。
4. **渐进披露**：默认只显示完成当前任务所需内容；规则解释、参数细节和高级配置进入帮助或折叠区。
5. **一致反馈**：相同操作使用相同按钮、加载态、错误态和完成态。

## 2. 信息架构

- 应用顶栏第一行承载项目与全局操作，第二行承载 8 步工作流。
- 左侧栏管理属种列，右侧检查器只显示当前步骤或当前对象。
- 工作流动作条只显示当前步骤标题、一句指导、上一步和一个主要动作。
- 弹窗固定 header/footer，只有 body 滚动。

## 3. Design tokens

普通 DOM 界面只使用 `frontend/src/style.css` 的 CSS custom properties：

- 颜色：`--bg-*`、`--text-*`、`--accent-*`、`--status-*`、`--border-*`
- 间距：`--space-1` 至 `--space-6`
- 控件：`--control-h-sm/md/lg`
- 圆角：`--radius-sm/md/lg/xl`
- 阴影：`--shadow-panel/modal`
- 字号：`--font-size-xs/sm/md/lg/xl`
- 内联色值：`style` 属性中一律不得出现裸 `#hex`（含与 token 等值者及渐变实参），必须写 `var(--token)`；
  第 12 组门禁拦等值色值，第 14 组拦全部裸色值——内联色值不随主题切换，正是黑名单里「日间隐形或低对比」的成因。

`frontend/src/styles/tokens.ts` 仅用于 Canvas 固定高对比叠加色、命中尺寸和绘图几何，不是 DOM UI 色板。

品牌徽标渐变是唯一允许写死品牌色的位置：`--brand-gradient`（定义在 `style.css` 的 `:root` 内）。
`--accent-*` 在 `:root`（深色）与 `body.theme-light`（浅色）取值不同，
故界面内写死任一具体色值都会在另一主题下失真；跨主题一致性只能靠 token。

状态色与装饰色分工（第 14 组门禁的取值依据）：

- **状态**用 `--status-warning` / `--status-success`（危险态沿用 `--accent-red`，与 `.ui-status--danger` 一致），
  **装饰性强调**用 `--accent-*`；`.ui-status--warning/--success::before` 已指向 `--status-*`，状态指示器只有一个来源。
  批次 I 据此把 20 处状态文本与指示器上的 `--accent-green/amber/orange` 换成 `--status-success/warning`
  （8 文件；浅色主题下由 3.77:1 / 3.19:1 升到 5.48:1 / 5.02:1）。第 20 组门禁按「每个装饰色 token 的计数上限」
  做棘轮：既有装饰用法与数据序列配色可留存，状态文本不得再新增装饰色。
- 状态色必须逐主题取值：深色 `--status-warning: #f59e0b`（8.92:1）、`--status-success: #10b981`（7.55:1）；
  浅色 `#b45309`（5.02:1）、`#047857`（5.48:1）。沿用深色值在浅色底只剩 **2.15:1 / 2.54:1**，不达标。
- `--accent-violet` 同理：深色 `#a855f7`（4.84:1）→ 浅色 `#7c3aed`（5.70:1）；旧值 `#7c3aed` 在深色底仅 3.36:1。
- 状态填充上的文字用 `--text-on-status`（深色主题状态底色偏亮 → 深字，浅色反之）；品牌渐变等饱和底上的白字用 `--text-on-accent`。
- **动作填充与填充文字成对取值**：`--action-primary-bg/-text`、`--action-success-bg/-text`、`--action-danger-bg/-text`，
  两主题各取一次（深色 `#38bdf8`/`#10b981`/`#ef4444` 配深字 `#0b0f19`；浅色 `#0369a1`/`#047857`/`#dc2626` 配白字）。
  禁止在按钮规则里再写死字色：改填充色时字色必须一起复算（第 16 组门禁按 WCAG 复算声明值，`e2e/contrast.spec.ts` 复算实际渲染值）。
  悬停与 token 同源；`filter: brightness()` 只用于**深字填充**（深色主题全部 + 浅色 `--primary` / `--success`）。
  浅色 `--warning` / `--danger` 是白字填充，×1.08 实测把 5.02:1 / 4.83:1 压到 **4.41:1 / 4.22:1**，跌破 AA，
  改用同级后置的成对 token 重述 + 同色光晕（第 21 组门禁：每个填充变体必须有独立 `:hover`，且 warning/danger 的 hover 禁 brightness）。
  通用悬停规则（深色 `.ui-btn:hover:not(:disabled)` 为 (0,3,0)；
  浅色历史上有过 (0,4,1) 的 `.ui-btn--xs:hover`）会盖掉 (0,2,x) 的动作填充并把文字改回 `--accent-blue`：
  动作按钮的 hover 规则必须同级后置，浅色 `.ui-btn--success:hover` 另加一条防御性重述，两处都由第 16 组门禁守住。
- 以下四类**不随主题变**，不得当作主题色使用：导出就绪胶囊 `--pill-*-bg/text`（自带浅底深字）、
  画布掩膜契约色 `--overlay-*`（须与后端 `overlay_legend` 及 `src/styles/tokens.ts` 一致）、`--text-on-accent`、`--brand-gradient`。

遗留待并（尚未完成）：

- `.tool-btn`（历史基类，89 个 DOM 站点）已于批次 G-c 并入 `.ui-btn`：密集工具 → `ui-btn ui-btn--quiet ui-btn--xs`（70 处）、
  图标钮 → `ui-btn ui-icon-btn`（3 处）、本已带 `.ui-btn` 的原语按钮去掉 `tool-btn`（8 处去重）；`.active` / `.active-mode`
  保留为 `.ui-btn--xs.active(-mode)`（`!important` 维持旧优先级），`.action` → `.ui-btn--success`，`.export` / `.export-sub`
  / `.highlight` 随变体退役。等价性以 89 站点前后的计算样式快照逐项对齐（26 属性 × 常态/悬停 × 两主题；真实页面按 id 对齐 +
  类名×上下文探针），第 17 组门禁禁止选择器与源码 class 两侧回流。
- `.modal-body` / `.close-btn` 已于批次 G-a2 + G-d 并入 `.ui-modal__body` / `.ui-icon-btn`：原语补齐堆叠契约
  （`display:flex; flex-direction:column; gap:var(--space-3)`，即 12px，替代 legacy 的 18/14px 双值），
  DOM 13 处（10 文件）删除 legacy 类，CSS 5 条规则（`.close-btn`、`.close-btn:hover`、`.modal-body`、`.wpd-modal-body`）净删——
  唯一例外 `.wpd-modal-body` 必须晚于原语声明（现位于原语之后），否则其 `gap:16px` / `padding:16px` / `flex-direction:row` 会被原语覆盖。
  第 18 组门禁同时守选择器与源码 class 两侧回流，并校验原语契约与「变体晚于原语」的顺序前置条件。
  - 关闭钮命中区从 ~11×22px 字形扩到 32px 方框（`--control-h-md`），颜色由 `--text-muted` 收敛到 `--text-secondary`。
  - **导出弹窗方向修正（真实缺陷）**：`.wpd-modal-body` 此前只声明 `display:flex` 不声明方向，与 legacy `.modal-body`
    的 `flex-direction:column` 并存时按列排布——实测 body `scrollH 1540 / clientH 778`，右侧 270px 控制栏整体落到折叠线以下
    （`right.y 919` = footer 顶边）。现显式 `flex-direction: row`，实测 `scrollH == clientH == 778`，左表 880px 与右栏 270px 并列。
    该方向声明是**承重**的（若只补原语契约而不重排，原语的 `column` 会重新把两栏压成纵排）。
  - 弹窗 **header/footer** 已于批次 G-e 并入 `.ui-modal__header` / `.ui-modal__footer` / `.ui-modal__title`：
    DOM 8 处（4 个弹窗：`Inspector.ts` 深度粘贴、`ocr/TaxaDictionaryModal.ts` 词汇表、`PropertyPanel.ts` 标定与 RPC 配置）
    删除 legacy 类与内联覆盖，CSS 侧 `.modal-header` / `.modal-header h3` / `.modal-footer` 三条规则净删。
    此前标题混用 **14px（legacy 规则）/ 13.5px（Taxa 内联）/ 13px（Inspector 内联）** 三种值，现统一 `--font-size-xl` = 16px；
    内边距由 `14px 18px` 收敛到原语的 `12px 16px`，`gap` 由内联 8px / legacy 10px 收敛到 `--space-3` = 12px。
    第 15 组门禁由「禁混挂」升级为「禁出现」（DOM class 与 CSS 选择器两侧都拦），
    `frontend/e2e/modal-primitive.spec.ts` 新增词汇表弹窗的真实浏览器断言（含负控：还原 legacy header 即失败）。
    `.settings-modal-body` / `.metadata-modal-body` 仅作标签使用，无对应规则。
- `.primary-btn` 已退役（第 14 组门禁拦回填）：4 条规则共 31 行、全仓零消费者、含 2 处硬编码渐变；
  已退役的 `.btn-primary` 从未做过 token 别名，两者都不要回填渐变。
- 状态文本仍有直接取 `--accent-*` 的调用点（`--accent-green` 24 处 / `--accent-amber` 22 处，含画布侧 `AgeDepthCanvas.ts`），
  画布叠加色与界面状态色同值时无法从调用点区分，待逐处判定语义后并入 `--status-*`。

对比度契约（第 16 组静态门禁按声明 token 复算，`frontend/e2e/contrast.spec.ts` 在真实浏览器里复算渲染值，
两处都必须 ≥4.5:1；下表为浏览器实测值）：

| 动作填充 | 深色（字 `#0b0f19`） | 浅色（白字） | 悬停（`filter: brightness()` 同作用于底色与文字） |
| --- | --- | --- | --- |
| `.ui-btn--primary` | `#38bdf8` **8.94:1** | `#0369a1` **5.93:1** | 深 10.20（×1.08）/ 浅 5.26（×1.08） |
| `.ui-btn--success` | `#10b981` **7.55:1** | `#047857` **5.48:1** | 深 8.71 / 浅 4.84（×1.08） |
| `.ui-btn--danger` | `#ef4444` **5.09:1** | `#dc2626` **4.83:1** | 无 hover filter（同色光晕），比例不变 |
| `.ui-btn--warning`（状态填充） | `#f59e0b` **8.92:1** | `#b45309` **5.02:1** | 无 hover filter（同色光晕），比例不变 |

旧写法（白字压在装饰色 `--accent-blue` 上，深色 2.14:1 / 浅色 `#0284c7` 4.10:1）已废弃：
`--accent-*` 是装饰色，不是可承载文字的填充色——需要白字就得把底色压到亮度 ≤0.183，需要亮色底就得换深字。
`.open-file-btn:hover` 仍是 25% 蓝半透明叠加 + `--text-primary`（不透明化后不可复算，只由 E2E 断言文字取色）。

无填充变体的悬停语义：`.ui-btn--quiet` / `.ui-icon-btn` 用 `color-mix(in srgb, var(--accent-blue) 12%, transparent)` 底 +
`--accent-blue` 字（深浅同构；Chromium 序列化为 `color(srgb …)`，与等值 `rgba()` 只差字符串）；
`.ui-btn--secondary` 悬停沿 `--text-primary` 换底色（`color-mix(in srgb, var(--bg-tertiary) 92%, var(--text-primary))`，
浅色变深 / 深色变浅），不再只上浮（3 个顶栏站点仍无旧 `.tool-btn:hover` 的蓝色叠加，属归一，但保有可辨的悬停反馈）。
悬停一律不加边框环——底色与字色即全部信号。

## 4. 按钮

| 语义 | class | 用途 |
| --- | --- | --- |
| 主要 | `.ui-btn--primary` | 当前视图唯一下一步 |
| 次要 | `.ui-btn--secondary` | 取消、返回、备选动作 |
| 安静 | `.ui-btn--quiet` | 重置、复制、低频工具 |
| 警告 | `.ui-btn--warning` | 需用户确认的补救动作（如「旋转校正」） |
| 危险 | `.ui-btn--danger` | 删除、清空、不可逆操作 |
| 图标 | `.ui-icon-btn` | 关闭、折叠等紧凑操作 |

规则：

- 文案写“动词 + 对象”，如“保存项目”“应用年代模型”。
- 图标按钮必须有 `aria-label` 与 `title`。
- emoji 不承担操作语义；状态使用 icon、颜色、文字三者至少两种。
- 加载态保留按钮宽度并禁用重复提交。
- 语义变体负责外观：`background` / `border-color` / `color` 只在变体规则里定义，元素上不得再用内联 `style` 覆盖；
  内联覆盖会绕过禁用态与主题切换（第 12 组拦等值色值与硬编码渐变，第 14 组拦全部裸色值）。
- 状态填充按钮用 `--status-*` 变体取色，文字色由 `--text-on-status` 给出，保证深浅主题都达 AA。
- 悬停/激活态不得把文字改回装饰色：动作按钮的 hover 规则与通用 `.ui-btn:hover` 同级（见 §3 动作填充），
  且只用 `filter: brightness()` 微调亮度；改完必须在两种主题下复算文字与底色的对比度。
- 尺寸变体：`--sm` 28px、`--xs` 密集（`padding:4px 6px`、`font-size:var(--font-size-sm)`、`:active{transform:scale(0.97)}`）、
  `--lg` 36px、`--block` 满宽；`.ui-icon-btn` 固定 `width:var(--control-h-md)` 且不参与收缩。
  顶栏 `.app-toolbar .ui-btn, .app-toolbar .ui-icon-btn` 设 `flex-shrink: 0`（旧 `.tool-btn` 自带该属性，改由容器承接），
  窄窗口下顶栏按钮不收缩、由 `.toolbar-center` 横向滚动。
- `.ui-btn` 用 `font: inherit` 继承应用字体（旧 `.tool-btn` 继承的是 UA 按钮字体），故并入后纯文字/数字按钮的行盒与字宽会变
  （实测 `1:1` 按钮 26.61×18 → 22.98×20，右侧视口组整体左移 3.63px，属归一：按钮字体不再跳字体栈）。

## 5. 文案

- 标题与控件名不用中英重复（`3. Y 轴物理标定 (Calibration)` → `3. Y 轴物理标定`）；术语解释放 tooltip。
- 中文词条只保留三类括注：领域缩写（`ROI`）、键位（`Ctrl+Z`、`S`）、后端字段名（`x_ticks`、`data.csv`）；英文译文一律删除（由 `frontend/test-ui-consistency.mjs` 第 10 组强制）。
- 说明文字默认一句，超过两句移入 `<details class="ui-help">`。
- 禁止用“急救、零脑补、发表级、一键、确认无误”等情绪化词汇代替功能说明。
- 状态统一为：未开始、进行中、已完成、需要处理、失败。
- 错误必须说明“发生了什么 + 下一步”，并保留真实后端错误。

反馈通道（§1 第 5 条原则的落地）：

- **轻量提示**走 `frontend/src/ui/feedback.ts`：`notify(text, level)` / `notifyError(text)` 弹出可自动消失的 toast；
  `notifyCaught(prefix, err)` 供 catch 分支连错误原文一起冒泡；`showDetailModal(title, detail, hint?)` 用于需要留存的详情。
- **后端失败**走 `frontend/src/services/ProvenanceGate.ts` 的 `reportBackendFailure(action, err)`：弹窗保留
  「`action` 失败」标题、后端原文与「复制错误详情」，不自动消失——后端 detail 往往很长，toast 会截断并自动消失。
- 两条通道都不得用原生 `alert()`（第 4 组门禁拦回填），也不得静默吞掉异常。

级别选择（唯一判据）:
- `notify(text, 'success')`——操作成功且有产物（已激活 / 已合并 / 建模完成）。
- `notify(text, 'info')`——无操作结果或前置引导（「无需合并」「当前尚无数据可复制」）。
- `notify(text, 'warning')`——校验不通过但可补救、或部分成功（「请输入有效的 DOI」）。
- `notifyError(text)`——操作失败、后端错误、不可继续；文案不得含成功语义词。


## 6. 表单

- label 位于控件上方；必填、单位、示例分开表达。
- placeholder 只给格式示例，不重复 label。
- 校验信息紧邻字段，不用原生 `alert()`。
- 高级配置默认折叠，不与主要任务争夺首屏。

## 7. 弹窗

```html
<div class="modal-dialog ui-modal">
  <div class="ui-modal__header">
    <h3 class="ui-modal__title">标题</h3>
    <button class="ui-icon-btn" aria-label="关闭" title="关闭">&times;</button>
  </div>
  <div class="ui-modal__body">…</div>
  <div class="ui-modal__footer">
    <button class="ui-btn ui-btn--secondary ui-btn--sm">取消</button>
    <button class="ui-btn ui-btn--primary ui-btn--sm">保存</button>
  </div>
</div>
```

- 标题排版统一由 `ui-modal__title` 承载，不再依赖 `.modal-header h3`；header 右侧固定一个 `.ui-icon-btn` 关闭按钮。
- header/footer 用 `<div>` 承载（契约按类名判定，不按标签名）。

- `max-height: calc(100dvh - 48px)`。
- footer 最多三个动作，primary 在最右。
- 1366×768 下关键动作始终可见。
- Escape 关闭最上层弹窗；Tab 焦点不进入背景页面。
- header/footer 只挂 `ui-modal__header|footer`，不得再带 legacy `modal-header|modal-footer`；上下文选择器
  （如浅色主题的 `.ocr-review-dialog` 规则）必须直接指向原语，否则类名一改颜色就静默失效——第 15 组门禁强制这两点。
- `ui-modal__body` 已是唯一主体类（批次 G-a2/G-d）；变体（如 `.wpd-modal-body`、`.agedepth-dialog .ui-modal__body`）
  必须声明在原语之后或提高特化度，见 §3「遗留待并」。

## 8. 响应式与密度

- 最低支持 1280×720，优先验收 1366×768 与 1920×1080。
- 工具栏控件高 28px（`--sm`），密集工具用 `--xs`（约 18–20px，视口栏与表格工具），普通表单 32px，主要动作 36px。
- 复杂双栏弹窗在窄屏切为单列或 tab，不允许依赖裁切隐藏内容。

## 9. 可访问性

- 交互元素必须有可访问名称。
- 当前步骤使用 `aria-current="step"`；tab 使用 `role="tab"`、`aria-selected`。
- focus ring 在深浅主题均清晰可见。
- 不能只靠颜色表达状态。
- 带填充的动作按钮（主/成功/危险）与状态填充：文字与底色对比度 ≥ **4.5:1**（WCAG AA 小字线，
  10–11px 加粗仍算小字），常态与悬停都算；`filter: brightness()` 会把底色与文字一起缩放，复算时要一并叠上。

## 10. 验收

每次 UI 改动至少运行：

```bash
npm --prefix frontend test
npm --prefix frontend run build
STRADITIZE_E2E_PORT=22900 npm --prefix frontend run test:e2e
```

- `npm --prefix frontend test` 里的 `test-ui-consistency.mjs` 是 17 组 UI 门禁：design tokens、语义控件、
  内联色值/裸 hex、原生 `alert`、emoji、中英重复标题、模态框原语、动作填充对比度、遗留基类 `.tool-btn` 回流等；
  新增规则就加一组，别只写在文档里。
- `frontend/e2e/modal-primitive.spec.ts` 是弹窗原语的**运行时契约**：既断言 header/footer 不混 legacy 类，
  也用计算样式断言深浅主题下分隔线与底色真的落在原语作用域（单靠类名或计算样式任一维度都会被绕过）。
- `frontend/e2e/contrast.spec.ts` 是动作填充的**运行时对比度契约**：把带真实类名的探针插进真实文档，
  读 `getComputedStyle` 后按 WCAG 复算 3 类带填充动作按钮（主/危险/执行）× 两主题 × 常态/悬停，
  并对「打开文件」按钮单独断言悬停取色；探针继承真实层叠，
  所以能抓到"静态声明达标但被通用 hover 规则盖掉"这类回归（编写时即抓到深色主题的这条）。
- `frontend/e2e/ui-layout.spec.ts` 覆盖 1280×720 / 1366×768 / 1920×1080 三档顶栏两行不重叠。

交付前再运行 `pixi run lint` 与 `pixi run test`。
