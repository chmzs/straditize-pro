## [UI] 2026-09-20 09:46 — 按钮辨识度（折叠按钮不可见）
- 根因：`.icon-btn` 与 `.tool-btn` 基础态都是 `background:transparent; border:none`，且 hover 写死 `color:#fff`——日间 hover 变白字压白底，等于隐形。
- 改动：`.icon-btn` 基色 `--text-muted`→`--text-secondary` 并给强调蓝 hover；新增 `.icon-btn.panel-toggle`（28×28 + 底色 + 边框）；`Sidebar.ts:72` / `Inspector.ts:98` 折叠按钮挂该类；`.minimap-btn` 与 `.tool-btn` hover 同步（暗色主题取值不变）。
- 验证：build ✓ ｜ lint ✓ ｜ test 137 passed；实机量测 28×28、border 1px rgb(203,213,225)，截图 `verify_btn_light2.png`。**顶栏按钮维持现状（已试验并否决）**：加常驻底不改宽（实测 scroll 1280→1280），但顶栏按钮多在 `.btn-group` 分段容器内，再加底＝框套框、切碎分组；属种行内微按钮与顶栏图标按钮用户明确暂缓，勿擅自开工。
