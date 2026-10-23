# 修复报告：换图 / 新建项目后的清理状态残留

> 执行者：Lead（接手 `cleanup-fixer` 中断的任务）
> 代码绑定：`sha256sum straditize_core/image.py` 与 `session_parts/core.py` 见 §5
> 门禁：`pixi run lint` 全绿 ｜ `pixi run test` **382 passed / 3 skipped**

---

## 1. 缺陷（B-03）

换图后旧图确认过的清理几何**原样残留**，并在**新图**上继续剔除墨迹，用户无从得知。

**修前实测**：
```
换图前几何 24 条 → 换图后 24 条
B-03 是否仍存在: True
```
影响量级：1 条残留 → 剔除 2400 px；24 条 → 13454 px。

## 2. 根因（四条，缺一不可）

| # | 位置 | 问题 |
| --: | :--- | :--- |
| 1 | `session_parts/core.py:247-269` | `load_image()` 的清理清单不含 `line_candidates` / `exclusion_regions` / `line_strokes`（grep 三项 = 0 命中） |
| 2 | `session_parts/project.py:126-137` | `project_new()` 同样不含这三项（grep = 0） |
| 3 | `session_parts/roi.py:23-26` | `_init_rois()` 把 `_roi_counter` 归零 → 新图 ROI 又叫 `roi_1`，与旧几何 `roi_id` **同名** |
| 4 | `session_parts/cleanup.py:240` | `if not self._geometry_in_scope(cand): continue` 的过滤因第 3 条而失效 |

第 3 条是让缺陷"成立"的关键：**仅靠 roi_id 无法区分跨图几何**。

## 3. 修法：两层防御

### 3.1 主动清理（补上遗漏）

`load_image()` 与 `project_new()` 都清空：
```python
self.line_candidates = []
self.exclusion_regions = []
self.line_strokes = []
self.selected_candidate_ids = set()
```

### 3.2 纵深防御（更重要）

只靠"记得清理"是脆弱的 —— 任何新增字段都可能再次漏清。`cleanup.py` 已有
`_geometry_scope()` / `_geometry_in_scope()`：给每条几何打上"属于哪张图"的标记
（`image_path` + 宽 + 高），跨图几何因此**不可用**而非**有害**。

**验证：即使强行绕过清理，防御仍生效**
```
强塞旧几何: 1 条, roi_id= roi_1
新图上剔除像素: 0
=> 纵深防御生效（应为 0）: True
```

## 4. 回归测试（7 项）

`tests/unit/test_cross_image_cleanup.py`：

| 类 | 断言 |
| :--- | :--- |
| `TestLoadImageClearsCleanupState` | 换图后三项 + `selected_candidate_ids` 全清（4 项） |
| `TestProjectNewClearsCleanupState` | `project_new(clear_image=False)` 同样清空（1 项） |
| `TestDefenceInDepth` | 绕过清理强塞旧几何 → `geometry_removed_pixels == 0`（1 项） |
| 反向验证 | **同图几何仍必须生效**（`> 0`），防止防御做成禁止（1 项） |

最后一项是必要的反向钉子：只测"跨图不生效"会漏掉"把功能彻底关死"这种过度修复。

## 5. 门禁

```
pixi run lint        → ruff All checks passed + consistency 11 项全 OK
pixi run test        → 382 passed, 3 skipped, 92 subtests passed
```

修后实测：
```
[load_image]  换图前 24 条 → 换图后 0 条
[project_new] 前 25 条 → 后 0 条
  exclusion_regions: 0
  line_strokes: 0
```

## 6. 遗留

1. `support/serve_e2e_backend.py:51-63` 里的手工 `_init_cleanup()` 调用，在本次修复后
   已属冗余。**未改动它**（85 项 e2e 依赖），但可以简化 —— 交后续清理。
2. `_geometry_scope()` 用 `image_path + width + height` 作身份。同名同尺寸的两张不同图
   仍会共享 scope。这是已知边界，实际影响极小（PDF 翻页已因路径+尺寸相同被正确识别的
   反例不存在于当前 corpus）。
