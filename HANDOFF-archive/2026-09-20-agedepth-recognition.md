# [AGEDEPTH] 2026-09-20 05:10 — 年代-深度识别 + 集合 + 速率（归档自 HANDOFF.md）

- 识别：逐行剖面双阈值 + 垂直支撑度引导 + 连续性追踪 + 长直线剔除 + PAVA 保序；搜索窗由**轴规则实际跨度**推导（`age_depth.py:_detect_axis_rule_box`）。集合改在**沉积速率空间**构造相关高斯过程再积分，单调性由构造保证、相关长度不随重采样步长漂移（`_solve_amplitude`:266）。
- 单位固定 `cm`/`cal BP`，换算用户自理（ka×1000、AD→BP=1950−AD）；保留 **AD 方向闸门**(:1359) 拒绝与图矛盾的方向声明。速率带集合后验 95% 区间，导出列用户勾选、列名自带单位（白名单 `session.py:AGE_DEPTH_RATE_COLUMNS`）；**MAR 不做**。上传图现经 `agedepth.loadModelDiagram{base64_data}` 显式交后端（a55cffc 修：原先只设本地画布，后端仍在提取旧图）。
- **停滞断点**：(a) **最高优先**：红色虚线中位线 + 黑色虚点包络这一常见画法会让追踪锁到**包络外框**——灰度化把色彩线索丢了（红=76灰、黑=0）；实测 `bacon_lithology.jpg` 0cm→−105（真值~0）、150cm→4269（真值~5900）约低 27%，L 压在梯子下限 1.64cm；(b) WebR 引擎未实现，`AgeDepthModal.ts:933` 如实拒绝；(c) 包络在测年层位后收窄处无钉扎模型不能减方差(:687)，保守偏宽并有 `envelope_mismatch_vs_extracted`(:697) 记录。
- 下一步原子动作：在 `extract_age_depth_model` 灰度化前加**色度判别**（高饱和细笔画优先当中位线，无彩色时回落暗度），以 `bacon_lithology.jpg` 作回归基准（真值：0cm≈0、50cm≈1570、100cm≈3720、150cm≈5880 cal BP）。
