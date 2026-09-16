# CLAUDE.md — straditize 项目上下文

> 本文件是 Codex 会话记录（2026-03 ~ 2026-05）的工作总结，供跨设备接力使用。
> 文件位置：`d:\users\chmzs\Documents\Pixi_env\straditize\CLAUDE.md`

---

## 项目概况

**straditize** 是一个 Python + PyQt5 古气候数据数值化工具，从图表图像中提取数据。
源码目录：`straditize/straditize/`
测试命令：`pixi run python -m pytest -q`（当前约 272 passed, 5 skipped）
启动命令：`pixi run python -m straditize`

---

## 已完成的 Codex 修复（4个提交）

### 1. `71185fa fix: rebuild full-data curves after control edits`
**文件**：[straditize/widgets/data.py](straditize/straditize/widgets/data.py)
**问题**：`Edit full data` 里 `Shift+左键` 新增控制点时，只改了点击那一行的值，没有用"当前控制点集合"重建整段曲线，导致视觉上只是在该行竖着冒出一个折点，没有真正延伸到点击位置。
**修复**：把"控制点集合 → 整列重建"抽成统一逻辑，新增/删除/拖拽三条路径共用。
**测试**：[tests/widgets/test_data.py](straditize/tests/widgets/test_data.py)

### 2. `1ad3a62 fix: persist edited full-data rows safely`
**文件**：[straditize/binary.py](straditize/straditize/binary.py)
**问题**：`full_data` 错误复用图像的 `ydata` 维度，编辑后行数变化时序列化到 NetCDF 会冲突。
**修复**：改成独立维度 `full_data_y`，保存行索引；`bars` 的 `full_data_orig` 同样处理。
**测试**：[tests/test_binary.py](straditize/tests/test_binary.py)、[tests/widgets/test_menu_actions.py](straditize/tests/widgets/test_menu_actions.py)

### 3. `43c2a20 fix: handle multi-edge y navigation`
**文件**：[straditize/widgets/marker_control.py](straditize/straditize/widgets/marker_control.py) 第928行
**问题**：`go_to_greater_y_mark()` 用 `mark.ya > y` 的布尔掩码索引 `mark.xa`，当 mark 是"多个x/单个y"时触发维度不匹配。
**测试**：[tests/widgets/test_marker_control.py](straditize/tests/widgets/test_marker_control.py#L208)

### 4. `4d1a90b fix: reduce noisy digitizer warnings`
**文件**：[straditize/magnifier.py#L59](straditize/straditize/magnifier.py#L59)、[straditize/straditizer.py#L181](straditize/straditize/straditizer.py#L181)、[straditize/binary.py#L2730](straditize/straditize/binary.py#L2730)
**修复**：清除后台 warning（matplotlib set_window_title 弃用、`load_samples` pandas FutureWarning、多点 mark 时 traceback）
**测试**：[tests/test_straditizer.py#L58](straditize/tests/test_straditizer.py#L58)、[tests/test_straditizer.py#L73](straditize/tests/test_straditizer.py#L73)、[tests/widgets/test_data.py#L306](straditize/tests/widgets/test_data.py#L306)

---

## ⚠️ 未解决的核心问题（正在进行）

### 问题描述（用户 2026-04-15 反馈）

> "问题并没有被解决，依然只是点击增加点，但是曲线是沿着Y轴平行增加，其x轴对应的值是常数，而不是我点哪里到哪里。另外交互的按键没有保持统一风格，现在shift右键和直接右键都是删除。"

### Codex 根因分析

1. **曲线X轴不变问题**：手动控制点虽然被加进去了，但**同一列里原有的"自动拐点锚点"密密麻麻还保留着**，所以手动点只在一个很小的局部生效，看起来像沿Y轴竖着冒出一小截。真正的延伸需要清除或覆盖这些自动锚点。

2. **交互风格混乱**："删整行"和"删控制点"都绑到了右键家族上，`Shift+右键` 和直接 `右键` 都是删除，学习成本高。

### Codex 在 Plan Mode 中等待回答的两个偏好问题（未得到回答）

Codex 在制定完整方案前，需要用户回答：

1. **控制点删除方案** — 两种方案待选（具体是哪两种，Codex 在会话中已列出但被打断）
2. **交互风格统一** — 需要确认用哪种按键映射

---

## 待修复项（来自 warning 清理清单）

以下 warning 值得修但暂未处理：

- `straditize/widgets/__init__.py#L479`：插入 null QAction 的 Qt 警告
- `straditize/binary.py#L1562` 和 `binary.py#L1767`：`invalid value encountered in true_divide`，建议改成 `np.divide(..., where=denominator != 0)`
- `straditize/widgets/data.py#L2115-2117`：`add_subplot('1...')` 格式问题

---

## 下一步

1. 在 Codex 中继续回答 Plan Mode 里提出的两个偏好问题
2. Codex 输出 `<proposed_plan>` 后切换执行模式完成修复
3. 验证：`pixi run python -m pytest -q tests`

---

## 项目结构关键文件

| 文件 | 作用 |
|------|------|
| `straditize/widgets/data.py` | Edit full data 交互逻辑，控制点重建 |
| `straditize/binary.py` | 数据持久化、full_data 维度 |
| `straditize/widgets/marker_control.py` | 控制点拖拽、导航 |
| `straditize/straditizer.py` | 主界面，magnifier |
| `straditize/tests/widgets/test_data.py` | Edit full data 回归测试 |
| `straditize/tests/test_binary.py` | 数据持久化回归测试 |