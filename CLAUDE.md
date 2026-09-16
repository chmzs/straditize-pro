# CLAUDE.md — straditize 项目上下文

> 本文件是 Codex 会话记录（2026-03 ~ 2026-05）的工作总结，供跨设备接力使用。
> 文件位置：`I:\software_dev\straditize\CLAUDE.md`（源项目原记录已迁移至本机）

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

## ✅ 已攻克的核心交互问题（2026-05-17 深度解决）

### 问题回顾（用户 2026-04-15 反馈）

> "问题并没有被解决，依然只是点击增加点，但是曲线是沿着Y轴平行增加，其x轴对应的值是常数，而不是我点哪里到哪里。另外交互的按键没有保持统一风格，现在shift右键和直接右键都是删除。"

### 深度根因与最终攻关修复

1. **X轴不跟随鼠标/只沿Y轴加点根因**：
   - 当用户在普通左键点击时（未按 Shift），原流程执行的是 `_add_full_data_row(y)`，新行的 X 坐标完全由旧曲线插值产生（常数），完全抛弃了鼠标点击的 `event.xdata`；
   - 即使用户按了 Shift，局部密集的小自动拐点（`_full_data_auto_rows`）依然死锁前后 1 像素，导致视觉上曲线被夹紧成尖刺。
2. **按键风格分裂根因**：
   - 原代码中普通右键居然直接触发 `_remove_nearest_full_data_row(y)`，手滑右击就会摧毁整行（所有 50 列花粉数据）！而 Shift+右键才是删控制点。
3. **彻底落地的统一交互设计**：
   - **左键单击任意位置（无论是否 Shift）**：
     - 若点击在已有控制点上：进入原生 Matplotlib 拖动模式，不销毁重建 marks；
     - 若点击在空白处/曲线上：精准捕获鼠标的 `event.xdata`，将该列拉伸到鼠标点击位置，作为强控制锚点（manual），并修剪紧邻的自动噪点；
     - 若未传 xdata（测试/纯Y轴操作）：执行底层加行。
   - **右键单击（无论是否 Shift）**：
     - 只要鼠标在控制点附近：**直接删除该控制点**并由剩余控制点重新平滑插值！告别反人类的强制 Shift；
     - 只有显式按住 `Ctrl + 右键`（或纯Y轴无xdata）：才执行整行删除保护，防止误删整个地层剖面数据。
4. **回归测试覆盖**：
   - `test_edit_full_data_plain_left_click_updates_x_value_to_cursor`
   - `test_edit_full_data_plain_right_click_removes_control_point`
   - 全套 13 个 full_data 编辑测试与全量 283 个测试全部 PASS。

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