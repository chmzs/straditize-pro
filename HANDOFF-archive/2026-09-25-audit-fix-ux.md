# [AUDIT-FIX-UX] 2026-09-25 21:35 — 5大病灶清零、Y1/Y2选点靶心反馈与浮动工具条收敛
> 由 HANDOFF.md 按「全文 ≤50 行、超限把最旧节整段移入本目录」规则归档（2026-09-28）。

- 病灶清零：网格外推至完整 `[roi.yMin, roi.yMax]`（`SplineInterpolator.ts:183`）；`conftest.py` 隔离临时配置；Step 4 排除区/画笔接线与分列防抖 Loading 完成；`PropertyPanel.ts` 直连后端 `export.tar/csv/r`。
- Y1/Y2 强视觉反馈：`GeologyCanvas.ts:1968` 绘制 Y1(橙)/Y2(绿) 双环靶心 + 深色胶囊铭牌 + 鼠标实时准星预览；`YCalibPanel.ts` 支持单点/双点实时回填与画布双向联动。
- 浮动工具栏收敛：移除左下角冗余 `标定(Y)` 与 `ROI(R)`，按当前步骤 `display:none` 动态显隐（`GeologyCanvas.ts:2530`）。
- 停滞断点：W1–W5 主干（T01–T11, T14）已全部竣工；仅剩延后增强项 T12（`straditize_core/layers.py` 双层放大曲线分层）与年代弹窗手工控制点（`AgeDepthModal.ts`）。
- 下一步原子动作：若开启 T12，新建 `straditize_core/layers.py` 与 `frontend/src/components/steps/LayersPanel.ts` 实现色相分组双峰阈值分层；否则直接进入发版打包验收（`pixi run build-windows`）。
