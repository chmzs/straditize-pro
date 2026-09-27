# 归档：顶栏减负（去线去重 + 缩放/透视下沉到底部视口栏）

> 从 `HANDOFF.md` 移出（2026-09-20，因新增 8 步工作流设计节超出 50 行上限）。
> 内容逐字保留，只增不减。
> ⚠️ **该节末尾的待决项仍未完成**：「步骤条仍溢出 216px，需再往下搬 元数据/OCR/年代 或收窄左组文案。未做，等用户定。」

## [UI] 2026-09-20 12:03 — 顶栏减负：去线去重 + 缩放/透视下沉到底部视口栏
- 折叠按钮辨识度（前一轮，已提交）：`.icon-btn` 基色→`--text-secondary`、hover 去写死白字；`.icon-btn.panel-toggle`（28×28+底+框）挂 `Sidebar.ts:72`/`Inspector.ts:98`。
- **删顶栏「去线」**：与 `Inspector.ts:240 #select-inspector-degrid` 是同回调**重复入口**且两处显示值互不同步。副作用：该控件现在只在 S2 面板可见（原顶栏常驻），S3+ 要改需点步骤条回 S2。
- **缩放组 + 透视组下沉**到画布底部新 `.canvas-view-bar`：`main.ts` 建宿主 → `Toolbar.setViewControlsHost()` 每次 render 后搬移，**搬前先清宿主里同 ID 旧节点**（render 重建不会清走已搬走的）。搬移后只有 render 之后的更新方法改 `document.getElementById`；`bindEvents` 必须仍用 `this.element`（构造函数内首次 render 时元素未挂载 document）。
- 实测：顶栏中间容器 29 → **317px**；底部栏 213px，左距工具条 7px / 右距雷达图 6px；缩放点击 27%→33% ✓、透视 active 切换 ✓。build ✓ ｜ E2E 11/11 ✓ ｜ test 153 passed ｜ lint ✓。
- 引导栏文字：去掉写死的 `max-width:320px` 改 `flex:1 1 auto`，可用宽度 320 → 约 410px（不再无谓截断）。
- ⚠️ **步骤条仍溢出 216px**（需 534 / 实得 317）。已批准减负共释放 288px，原始缺口 505px；不压步骤条（用户已否决）就还差约 216px，需再往下搬 元数据/OCR/年代（约 164px）或收窄左组文案。**未做，等用户定。**
