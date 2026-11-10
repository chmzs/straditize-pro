# 提交后验证清单（2026-11-10，commit `436317b`）

> 用途：你自己在两分钟内判断"这批修复到底生效了没有"。
> 前提：**必须重新构建前端并重启应用**（后端托管 `frontend/dist`，旧进程不会自动换新产物）。

## 0 重建与启动

```bash
npm --prefix frontend run build      # 必须，否则跑的是旧产物
pixi run app                         # 或重启你现有的实例
```

## 1 五条"一眼可验"的

| # | 操作 | 期望（修复后） | 修复前是什么样 |
| --- | --- | --- | --- |
| 1 | 打开你的工程包 → 点「导出」 | 预览表**有数**，不是整表 NA | 整表 NA |
| 2 | 同上 → 看预览行数 vs 下载 CSV 行数 | **两者相等**，且选择器旁写明「按…层位（N 行）」 | 预览 125 行 / 下载 35 行 |
| 3 | 步骤 3 看「主轴」 | 与你保存时一致（你包里是"深度"） | 载入后一律显示"深度" |
| 4 | 步骤 4 涂一笔 → 保存 → 重置 → 重开该包 | 笔迹/排除区**还在**，统计里 `实际剔除 > 0` | 归 0，且无提示 |
| 5 | 步骤 2 建两个 ROI（各分列）→ 导出 | CSV 有数；`data.csv` = **主 ROI 一张表**，另出 `data/<roi>.csv` | CSV 可能整表空（0/5040） |

## 2 命令行复核（我跑过的同一批）

```bash
npm --prefix frontend run build       # exit 0
pixi run lint                         # exit 0（一致性核对通过 + §4A matches）
.pixi\envs\default\python.exe -m pytest -q \
  tests/unit/test_roi_id_uniqueness.py \
  tests/unit/test_project_axis_stroke_roundtrip.py \
  tests/unit/test_project_cleanup_persistence.py \
  tests/unit/test_project_load_cleanup_state.py \
  tests/unit/test_project_manual_points.py \
  tests/unit/test_project_state_persistence.py \
  tests/unit/test_export_csv_multi_roi.py \
  tests/unit/test_export_chain_equality.py
# 38 passed in 218s，exit 0
```

## 3 已知仍未修（别拿这几条判"没修好"）

| 项 | 现状 |
| --- | --- |
| 撤销 / 重做 | 整体不成立：同一动作的撤销会落到 `roi.update` / `applyLineRemoval` / `measureRuler` / 一条都不发，**永不命中被撤销的动作** |
| 列删除 | 后端 `column.remove` 干净（索引重排、零错位），**前端没有入口** |
| QA 范围 | 只校验 active ROI，导出却覆盖全部 ⇒ active 是空/小 ROI 时"绿灯 + 漏检" |
| 导出模态自检行 | 仍可能写「质检达标 0 层位质检」（含前端哨兵 999999）——在修 |
| `reader_types` | 进包了但后端**只写不读** |
| 缺测表示 | CSV 写文本 `NA`、XLSX 写空单元格（两种表示） |
| `#wpd-na-fill` | 默认值 `0.0 (地学)`（误导），但实测不影响 CSV/XLSX 产物 |
| 保存项目 | 零反馈（无"已保存"提示） |
| 模态框 | Esc 不关闭（点关闭按钮可） |
| 步骤 6 面板 | 同屏「标定进度 0/4 列」与「已标定」矛盾 |
| 步骤 7 | 「提取采样共识层位」点击无反馈（35→35 无变化） |

## 4 数据使用建议（在未修完之前）

- **单 ROI**：导出 CSV 可信（与修复前逐字节相同）。
- **多 ROI**：用 XLSX（每 ROI 一个 sheet）或 TAR（`data/<roi>.csv`），**不要用扁平 CSV**。
- **缺测**：CSV 里是 `NA`，XLSX 里是空单元格；两者都表示"未测"，**不要当成 0**。
- 你之前那份包重存后 `data.csv` 可能多出一些"全空列"（未数字化过的列），这是三链一致的代价。
