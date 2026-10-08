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
- 状态色必须逐主题取值：深色 `--status-warning: #f59e0b`（8.92:1）、`--status-success: #10b981`（7.55:1）；
  浅色 `#b45309`（5.02:1）、`#047857`（5.48:1）。沿用深色值在浅色底只剩 **2.15:1 / 2.54:1**，不达标。
- `--accent-violet` 同理：深色 `#a855f7`（4.84:1）→ 浅色 `#7c3aed`（5.70:1）；旧值 `#7c3aed` 在深色底仅 3.36:1。
- 状态填充上的文字用 `--text-on-status`（深色主题状态底色偏亮 → 深字，浅色反之）；品牌渐变等饱和底上的白字用 `--text-on-accent`。
- 以下四类**不随主题变**，不得当作主题色使用：导出就绪胶囊 `--pill-*-bg/text`（自带浅底深字）、
  画布掩膜契约色 `--overlay-*`（须与后端 `overlay_legend` 及 `src/styles/tokens.ts` 一致）、`--text-on-accent`、`--brand-gradient`。

遗留待并（尚未完成）：

- `.tool-btn`（历史基类，89 个 DOM 站点）尚未并入 `.ui-btn`——它的 `padding:4px 6px`、`font-size:11px`、
  `:active{transform:scale(0.97)}`、`.active-mode` 三件套在 `.ui-btn` 内没有对应变体，需先补尺寸与激活态变体，
  且波及面广（每个弹窗都要视觉复核），不可批量替换。
- `.modal-body` 尚未并入 `.ui-modal__body`：原语不提供堆叠契约（`display:flex; flex-direction:column; gap:14px`），
  6 处元素仍靠 legacy 类拿这两个属性；而 `.wpd-modal-body` 自带 `gap:16px` 且位置在原语规则之前，
  直接给 `.ui-modal__body` 补契约会把 16px 覆盖成 14px——迁移必须先重排规则顺序。
- `.primary-btn` 已退役（第 15 组门禁拦回填）：4 条规则共 31 行、全仓零消费者、含 2 处硬编码渐变；
  已退役的 `.btn-primary` 从未做过 token 别名，两者都不要回填渐变。
- 状态文本仍有直接取 `--accent-*` 的调用点（`--accent-green` 24 处 / `--accent-amber` 22 处，含画布侧 `AgeDepthCanvas.ts`），
  画布叠加色与界面状态色同值时无法从调用点区分，待逐处判定语义后并入 `--status-*`。

已知缺陷（待决策，未经授权不要单独修改）：`.ui-btn--primary` 白字压在 `--accent-blue` 上，
深色 `#38bdf8` 仅 **2.14:1**、浅色 `#0284c7` **4.09:1**，均低于 AA 文字线 4.5:1；
该缺陷是全局性的，修法（加深底色 / 改深字 / 提高字重字号）会影响所有主按钮观感，需先定方案。

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

## 5. 文案

- 标题与控件名不用中英重复（`3. Y 轴物理标定 (Calibration)` → `3. Y 轴物理标定`）；术语解释放 tooltip。
- 中文词条只保留三类括注：领域缩写（`ROI`）、键位（`Ctrl+Z`、`S`）、后端字段名（`x_ticks`、`data.csv`）；英文译文一律删除（由 `frontend/test-ui-consistency.mjs` 第 10 组强制）。
- 说明文字默认一句，超过两句移入 `<details class="ui-help">`。
- 禁止用“急救、零脑补、发表级、一键、确认无误”等情绪化词汇代替功能说明。
- 状态统一为：未开始、进行中、已完成、需要处理、失败。
- 错误必须说明“发生了什么 + 下一步”，并保留真实后端错误。

## 6. 表单

- label 位于控件上方；必填、单位、示例分开表达。
- placeholder 只给格式示例，不重复 label。
- 校验信息紧邻字段，不用原生 `alert()`。
- 高级配置默认折叠，不与主要任务争夺首屏。

## 7. 弹窗

```html
<div class="modal-dialog ui-modal">
  <header class="ui-modal__header">…</header>
  <section class="ui-modal__body">…</section>
  <footer class="ui-modal__footer">…</footer>
</div>
```

- `max-height: calc(100dvh - 48px)`。
- footer 最多三个动作，primary 在最右。
- 1366×768 下关键动作始终可见。
- Escape 关闭最上层弹窗；Tab 焦点不进入背景页面。
- header/footer 只挂 `ui-modal__header|footer`，不得再带 legacy `modal-header|modal-footer`；上下文选择器
  （如浅色主题的 `.ocr-review-dialog` 规则）必须直接指向原语，否则类名一改颜色就静默失效——第 15 组门禁强制这两点。
- `ui-modal__body` 目前仍与 legacy `modal-body` 并存，原因与迁移前置条件见 §3「遗留待并」。

## 8. 响应式与密度

- 最低支持 1280×720，优先验收 1366×768 与 1920×1080。
- 工具栏控件高 28px，普通表单 32px，主要动作 36px。
- 复杂双栏弹窗在窄屏切为单列或 tab，不允许依赖裁切隐藏内容。

## 9. 可访问性

- 交互元素必须有可访问名称。
- 当前步骤使用 `aria-current="step"`；tab 使用 `role="tab"`、`aria-selected`。
- focus ring 在深浅主题均清晰可见。
- 不能只靠颜色表达状态。

## 10. 验收

每次 UI 改动至少运行：

```bash
npm --prefix frontend test
npm --prefix frontend run build
STRADITIZE_E2E_PORT=22900 npm --prefix frontend run test:e2e
```

交付前再运行 `pixi run lint` 与 `pixi run test`。
