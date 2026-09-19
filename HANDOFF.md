# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-20 08:00 | 分支 dev-v2-modern | HEAD a136dfe
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤30 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `cd frontend && npm run build`
- 当前结果：lint ✓ ｜ build ✓ ｜ test **122/122 passed (100% 通过)** ｜ `pixi run rpc-server` 在 8765 服务新代码

## [AGEDEPTH] 2026-09-20 05:10 — 年代-深度识别 + 集合 + 速率（已提交 339a34d/df7dff3/e452fb5）
- 识别改为逐行剖面双阈值 + 垂直支撑度引导 + 连续性追踪 + 长直线剔除 + PAVA 保序；搜索窗由**轴规则实际跨度**推导（`age_depth.py:_detect_axis_rule_box`，标定框 ≠ 数据区）。集合改在**沉积速率空间**构造相关高斯过程再积分，单调性由构造保证，相关长度是物理深度、不随重采样步长漂移；幅度见 `_solve_amplitude`(:266)。
- 单位固定 `cm`/`cal BP`，换算用户自理（ka×1000、AD→BP=1950−AD）；保留 **AD 方向闸门**(:1359)：声明与图矛盾直接拒绝，不静默压平。速率给 `volume_ar_cm_per_yr` + 区间速率并**带集合后验 95% 区间**，导出列用户勾选、列名自带单位（白名单 `session.py:AGE_DEPTH_RATE_COLUMNS`）；**MAR 不做**（干容重逐样品不同、图里读不出）。
- **停滞断点**：(a) WebR 引擎未实现，`AgeDepthModal.ts:933` 如实拒绝（伪造实现已在 :918 注明）；(b) 包络在测年层位后**收窄**处无钉扎模型不能减方差(:687)，保守偏宽并由 `envelope_mismatch_vs_extracted`(:697) 记录；(c) 上传本地图谱的**手动四点标定链路未实机走通**（已验种子标定与范例图）。
- 下一步原子动作：启动 8765 → 年代弹窗 → `📁 上传本地图谱` → 手点 4 点 → 填值 → 识别，确认标定值经 `age_px/age_vals` 落到后端而非种子位置。

## [PROVENANCE] 2026-09-20 08:00 — 数据来源完整性：Mock 已整体删除（a136dfe）
- i18n：`frontend/src/i18n/`（t/setLocale/onLocaleChange + zh/en 字典 + 数值错误码映射）；`en.ts` 用 `satisfies Record<MessageKey,string>` 做漏翻门禁；顶栏 `#btn-toggle-locale` 一键切换、无需重启。
- `RpcClient.call()` 只剩两条路径：离线即报错 / 真后端。已删除 `MockBackend.ts`(649 行)、`mockExecute`、`demoMode`、`generateExportData` 及前端 3 张重复示例图。
- 初始 ROI 建议改由后端 `Session.suggest_data_region()` 提供（随 `core.loadImage` 返回 `suggested_calibration`）；范例图由后端 `/image/current` 供图。
- 顺带修掉被兜底掩盖的真实缺陷：`core.detectColumns` 前端发 `x_bounds/y_bounds` 而后端要 `data_xlim/data_ylim`，修后 S1→S2→S3 由真算法产出 29 列。
- 启动闸门只剩「重新连接」——没有后端就没有结果可展示；胶囊只剩 RPC / 离线两态。无后端实测：闸门出现、无演示按钮、`app_rendered=false`。
- 实机复核（8943 真后端 / 8961 静态页）：`/image/current` 供图 70064B；S1→S2→S3 真算法产出 31 列；bundle 394→339KB；lint ✓ ｜ test 122 ✓。

## 黑名单（跨会话共享，只追加不覆盖）
- ❌ 文字/描边严禁写死 `#fff`/`#38bdf8`/`#f59e0b`（日间隐形或低对比），必须用 `--text-heading`/`--accent-*`；
- ❌ 弹窗页脚与条带禁止写死半透明黑，必须用 `--bg-footer`；CSS 覆盖前核对真实类名（`.agedepth-dialog` 无连字符）；
- ❌ 严禁未分列前预置属种列；严禁打开 OCR 弹窗即自动跑识别；命名统一 `col01,col02...`；
- ❌ 年代图识别严禁用「整图二值化 + 最大连通域」或「每行取最暗像素」：Bacon 云是连通实心块、Bchron 是几十条不连通细线，两种渲染都会翻车；必须逐行剖面 + 单调先验，且标定框 ≠ 数据区（轴规则常伸出到刻度之外）；
- ❌ 严禁在生产路径用替代数据掩盖后端失败（等分分列 / 随机曲线 / 固定名单 OCR / 前端自算导出）；数据只能来自后端真实计算或用户【显式】演示模式；
- ❌ 年龄集合严禁「按采样点序号做 AR(1) + `maximum.accumulate` 事后排序」：前者使相关长度随重采样步长漂移（2→10cm 改 2.8×，特征层位差 4cm），后者掩盖倒转并引入与步长相关的单向偏差；必须在速率空间构造，且拟合须读图形**原生采样**而非重采样后的包络。

## 索引
- 历史归档：`HANDOFF-archive/` ｜ 规范：`AGENTS.md` ｜ 截图：`verify_logo_light.png`
