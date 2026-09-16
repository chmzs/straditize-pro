# straditize 开发代理指南

## 项目定位

`straditize/` 是源码仓库目录；项目根目录同时保存 Pixi 环境配置和分析资料。应用是 Python + PyQt5 的古气候图表数值化工具。

## 环境与依赖

- 使用项目根目录的 Pixi 环境；不要使用全局 Python。
- Python 约束见 `pixi.toml`，当前为 Python 3.12。
- 默认优先 PyPI wheel，以减小环境体积；只有 PyPI 不可用或缺少系统/原生依赖时才放入 `[dependencies]`（conda-forge）。
- 修改 `pixi.toml` 后运行 `pixi install` 并检查 `pixi.lock` 的变化。
- Python 包安装使用 Pixi 任务或 `pixi run python -m pip`，不要直接污染全局环境。

## 常用命令

```bash
pixi run install       # 源码 editable 安装
pixi run test          # pytest 全量测试
pixi run lint          # ruff 检查
pixi run format        # ruff 格式化
pixi run run-straditize # 启动应用
```

## 修改规范

- 先读相关模块和测试，再修改；优先补充回归测试。
- 不擅自删除或重命名公共 API。
- 捕获具体异常类型；顶层 GUI 主循环如需兜底必须记录异常。
- 修改数据持久化、交互事件或 Qt 信号时，必须覆盖旧文件兼容性和边界行为。
- 不提交 `.pixi/`、缓存、构建产物和本地 IDE 状态。
- 不自动执行破坏性 Git 操作；提交前保留用户现有修改。

## 验收门槛

提交或交付前至少运行：

1. `pixi run lint`
2. `pixi run test`

GUI 测试在无显示环境失败时，记录 `QT_QPA_PLATFORM=offscreen` 或具体失败原因，不把环境限制误判为代码回归。

## 交接

每轮工作更新根目录 `HANDOFF.md`：记录日期、改动、验证结果、剩余问题和下一步。历史记录按时间倒序追加到文件顶部。
