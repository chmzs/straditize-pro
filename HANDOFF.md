# straditize 开发交接卡 (HANDOFF.md)
- 更新时间：2026-09-20 06:50 | 分支 dev-v2-modern | HEAD 0cc100b
- 规则：**分节追加** —— 只改自己那一节，严禁整文件覆盖或改写他节；每节 ≤8 行，全文 ≤30 行，超限时最旧节整段移入 `HANDOFF-archive/`。
- 一键验证：`pixi run lint` ｜ `pixi run test` ｜ `cd frontend && npm run build`
- 当前结果：lint ✓ ｜ build ✓ ｜ test **122/122 passed (100% 通过)**

## [AGEDEPTH] 2026-09-20 05:10 — 年代-深度识别 + 集合 + 速率（已提交 339a34d/df7dff3）
- 识别：废弃「整图二值化 + 最大连通域 + 每行 argmin」，改逐行剖面双阈值 + 垂直支撑度引导 + 连续性追踪 + 长直线剔除 + PAVA 保序 + gap 插值；搜索窗由**轴规则实际跨度**推导（刻度之外还有曲线）。
- 年龄集合：改在**沉积速率空间**做相关高斯过程再积分，单调性由构造保证（旧实现 2cm 步长下 32.9% 成员有隐性年代倒转，被 `maximum.accumulate` 掩盖）；相关长度是物理深度，不随重采样步长漂移。
- 单位固定 `cm`/`cal BP`，换算由用户自己做（ka×1000、AD→BP=1950−AD），界面写明；保留 **AD 方向闸门**：方向声明与图矛盾时直接拒绝，不静默压平（实测两种约定各还原 2901yr，两种误声明均被拒）。
- 速率：`volume_ar_cm_per_yr`（单位面积下 = 线性速率）与区间速率，**带集合后验 95% 区间**（速率比年龄更不确定）；导出列由用户勾选且列名自带单位（`acc_rate (cal BP per cm)`），**MAR 明确不做**（干容重逐样品不同、图里读不出，系用户自查换算）。
- 回归：合成图 0.19%/p95 1.0%/覆盖 100%；真实图两图带宽误差 3%/14%；`test_age_ensemble.py` 锁单调性/步长不变性/带宽量级。下一步：实测上传本地图谱手动标定链路；包络在测年层位后收窄处无钉扎模型不能减方差，保守偏宽并有 `envelope_mismatch_vs_extracted` 如实记录。
## [I18N+PROVENANCE] 2026-09-20 06:00 — 多语言 + 数据来源完整性（已提交 a3f02d5/83f88ca/0cc100b）
- i18n：`frontend/src/i18n/`（t/setLocale/onLocaleChange + zh/en 字典 + 数值错误码映射）；`en.ts` 用 `satisfies Record<MessageKey,string>` 做漏翻门禁；顶栏 `#btn-toggle-locale` 一键切换、无需重启。
- `RpcClient` 拆出 `backendOnline` / `demoMode` 两个独立状态，删除全部静默伪造（等分分列、随机抖动曲线、固定名单 OCR、前端自算导出、范例前端夹具）。
- 后端不可达 → 阻塞闸门（重新连接 / 显式进入演示模式）+ 常驻横幅；演示模式拒绝 digitize/export/OCR；胶囊区分 RPC / 演示 / 离线。
- 顺带修掉被兜底掩盖的真实缺陷：`core.detectColumns` 前端发 `x_bounds/y_bounds` 而后端要 `data_xlim/data_ylim`，修后 S1→S2→S3 由真算法产出 29 列。
- 实机复核（8942 真后端 / 8955 静态页）：无后端时 `app_rendered=false` 并弹闸门；演示模式导出被拒；后端中途断开→红色横幅 + 胶囊转「离线」。
- 范例修复（0cc100b）：`sample_key` 改基于 `__file__` 定位 + 修 beginner 文件名 + 未知 key/缺图如实报错；`session.py` 两条 message→code 已由 2d92b4a 落地。

## 黑名单（跨会话共享，只追加不覆盖）
- ❌ 文字/描边严禁写死 `#fff`/`#38bdf8`/`#f59e0b`（日间隐形或低对比），必须用 `--text-heading`/`--accent-*`；
- ❌ 弹窗页脚与条带禁止写死半透明黑，必须用 `--bg-footer`；CSS 覆盖前核对真实类名（`.agedepth-dialog` 无连字符）；
- ❌ 严禁未分列前预置属种列；严禁打开 OCR 弹窗即自动跑识别；命名统一 `col01,col02...`；
- ❌ 年代图识别严禁用「整图二值化 + 最大连通域」或「每行取最暗像素」：Bacon 云是连通实心块、Bchron 是几十条不连通细线，
  两种渲染都会翻车；必须逐行剖面 + 单调先验，且标定框不等于数据区（轴规则常伸出到刻度之外）；
- ❌ 严禁在生产路径用替代数据掩盖后端失败（等分分列 / 随机曲线 / 固定名单 OCR / 前端自算导出）；数据只能来自后端真实计算或用户【显式】演示模式。

## 索引
- 历史归档：`HANDOFF-archive/` ｜ 规范：`AGENTS.md` ｜ 截图：`verify_logo_light.png`
