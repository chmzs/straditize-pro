# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-20 06:00 | 分支 dev-v2-modern | HEAD a3f02d5
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤30 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `cd frontend && npm run build`
- 当前结果：lint ✓ ｜ build ✓ ｜ test **112/112 passed (100% 通过)**

## [AGEDEPTH] 2026-09-20 05:10 — 年代-深度识别重构（未提交）
- `straditize_core/age_depth.py`：废弃「整图二值化 + 最大连通域 + 每行 argmin」，改为逐行剖面双阈值 + 连续性追踪 + 长直线剔除 + PAVA 单调保序 + gap 插值 + 网格重采样；ROI 改由轴规则实际跨度推导。
- 回归量化：合成图 `tests/test_age_depth_extraction_quality.py` 中位误差 0.19%/p95 1.0%/包络覆盖 100%；真实图 `tests/test_age_depth_real_figures.py` 锁定两个已修失效（`szek` 文本劫持引导、ROI 卡刻度漏掉曲线尾段）。
- `session.py` 标定与提取范围解耦（`depth_range`）+ 分轴 `*_log` + `resample_step` + `exclude_boxes`，`mapped_samples` 回传 `px_y`/`px_x_curve`；`AgeDepthModal.ts` 四点标定点击交互（可拖拽）+ 批量填值 + 矩形橡皮擦，并补 `min-height:0`（控制栏变高会顶飞画布）。
- 下一步：实测「上传本地图谱」完整手动标定链路；决定负年代（示例图曲线越过 0 刻度）是否在映射预览中提示。

## [I18N+PROVENANCE] 2026-09-20 06:00 — 多语言 + 数据来源完整性（未提交）
- i18n：`frontend/src/i18n/`（t/setLocale/onLocaleChange + zh/en 字典 + 数值错误码映射）；`en.ts` 用 `satisfies Record<MessageKey,string>` 做漏翻门禁；顶栏 `#btn-toggle-locale` 一键切换、无需重启。
- `RpcClient` 拆出 `backendOnline` / `demoMode` 两个独立状态，删除全部静默伪造（等分分列、随机抖动曲线、固定名单 OCR、前端自算导出、范例前端夹具）。
- 后端不可达 → 阻塞闸门（重新连接 / 显式进入演示模式）+ 常驻横幅；演示模式拒绝 digitize/export/OCR；胶囊区分 RPC / 演示 / 离线。
- 顺带修掉被兜底掩盖的真实缺陷：`core.detectColumns` 前端发 `x_bounds/y_bounds` 而后端要 `data_xlim/data_ylim`，修后 S1→S2→S3 由真算法产出 29 列。
- 实机复核（8942 真后端 / 8955 静态页）：无后端时 `app_rendered=false` 并弹闸门；演示模式导出被拒；后端中途断开→红色横幅 + 胶囊转「离线」。
- 注：`session.py` 两条 message→code 与 [AGEDEPTH] 同文件，随该节提交；本批只提交 `frontend/`。

## 黑名单（跨会话共享，只追加不覆盖）
- ❌ 文字/描边严禁写死 `#fff`/`#38bdf8`/`#f59e0b`（日间隐形或低对比），必须用 `--text-heading`/`--accent-*`；
- ❌ 弹窗页脚与条带禁止写死半透明黑，必须用 `--bg-footer`；CSS 覆盖前核对真实类名（`.agedepth-dialog` 无连字符）；
- ❌ 严禁未分列前预置属种列；严禁打开 OCR 弹窗即自动跑识别；命名统一 `col01,col02...`；
- ❌ 年代图识别严禁用「整图二值化 + 最大连通域」或「每行取最暗像素」：Bacon 云是连通实心块、Bchron 是几十条不连通细线，
  两种渲染都会翻车；必须逐行剖面 + 单调先验，且标定框不等于数据区（轴规则常伸出到刻度之外）；
- ❌ 严禁在生产路径用替代数据掩盖后端失败（等分分列 / 随机曲线 / 固定名单 OCR / 前端自算导出）；数据只能来自后端真实计算或用户【显式】演示模式。

## 索引
- 历史归档：`HANDOFF-archive/` ｜ 规范：`AGENTS.md` ｜ 截图：`verify_logo_light.png`
