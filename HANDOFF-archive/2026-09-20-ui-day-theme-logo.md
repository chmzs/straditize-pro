## [UI] 2026-09-20 00:30 — 日间主题 / Logo 适配
- 顶栏 Logo 日间隐形根因：`.brand-name` 写死 `color:#fff` → `var(--text-heading)`（style.css:413-418）；
  新增 `body.theme-light .brand-icon-rect{fill:#0284c7}`（style.css:421），日间 Logo 底板由深板岩转品牌蓝。
- 全站写死 `#38bdf8`（color/border-color ~20 处）→ `var(--accent-blue)`（暗色取值不变，日间转深海蓝）；
  弹窗外壳残留：`.modal-footer` → `--bg-footer`（style.css:10/38/1701）、AgeDepth 条带 → `.ad-tab-strip`（:2555）。
- 实机复核：日间 brandName rgb(15,23,42)/logoFill rgb(2,132,199)；夜间 rgb(248,250,252)/rgb(30,41,59)，无回归；主题开关+重载持久化正常。
- 下一步：前端配色改动可提交（build/lint 均绿）。
