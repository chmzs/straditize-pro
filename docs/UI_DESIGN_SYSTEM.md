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

- 颜色：`--bg-*`、`--text-*`、`--accent-*`、`--border-*`
- 间距：`--space-1` 至 `--space-6`
- 控件：`--control-h-sm/md/lg`
- 圆角：`--radius-sm/md/lg/xl`
- 阴影：`--shadow-panel/modal`
- 字号：`--font-size-xs/sm/md/lg/xl`

`frontend/src/styles/tokens.ts` 仅用于 Canvas 固定高对比叠加色、命中尺寸和绘图几何，不是 DOM UI 色板。

## 4. 按钮

| 语义 | class | 用途 |
| --- | --- | --- |
| 主要 | `.ui-btn--primary` | 当前视图唯一下一步 |
| 次要 | `.ui-btn--secondary` | 取消、返回、备选动作 |
| 安静 | `.ui-btn--quiet` | 重置、复制、低频工具 |
| 危险 | `.ui-btn--danger` | 删除、清空、不可逆操作 |
| 图标 | `.ui-icon-btn` | 关闭、折叠等紧凑操作 |

规则：

- 文案写“动词 + 对象”，如“保存项目”“应用年代模型”。
- 图标按钮必须有 `aria-label` 与 `title`。
- emoji 不承担操作语义；状态使用 icon、颜色、文字三者至少两种。
- 加载态保留按钮宽度并禁用重复提交。

## 5. 文案

- 标题不用中英重复；术语解释放 tooltip。
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
