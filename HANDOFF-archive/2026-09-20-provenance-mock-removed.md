# [PROVENANCE] 2026-09-20 08:00 — 数据来源完整性：Mock 已整体删除（a136dfe）
（归档自 HANDOFF.md，内容已提交于 a136dfe / c4aa52b）

- i18n：`frontend/src/i18n/`（t/setLocale/onLocaleChange + zh/en 字典 + 数值错误码映射）；`en.ts` 用 `satisfies Record<MessageKey,string>` 做漏翻门禁；顶栏 `#btn-toggle-locale` 一键切换、无需重启。
- `RpcClient.call()` 只剩两条路径：离线即报错 / 真后端。已删除 `MockBackend.ts`(649 行)、`mockExecute`、`demoMode`、`generateExportData` 及前端 3 张重复示例图。
- 初始 ROI 建议改由后端 `Session.suggest_data_region()` 提供（随 `core.loadImage` 返回 `suggested_calibration`）；范例图由后端 `/image/current` 供图。
- 顺带修掉被兜底掩盖的真实缺陷：`core.detectColumns` 前端发 `x_bounds/y_bounds` 而后端要 `data_xlim/data_ylim`，修后 S1→S2→S3 由真算法产出 29 列。
- 启动闸门只剩「重新连接」，胶囊只剩 RPC / 离线；实机复核（8943/8961）：`/image/current` 供图 70064B、S1→S2→S3 真算法 31 列、bundle 394→339KB。
- 安全（c4aa52b）：原 `Access-Control-Allow-Origin: *` + 零 Origin/Host 校验 = **用户浏览的任意网页都能读写本机后端**；现改为回环 Host 校验（防 DNS rebinding）+ 同源 Origin 校验，跨源默认拒绝；`vite.config.ts` 加代理使开发也同源。
