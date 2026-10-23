# 软件问题与修改建议（逐条核实版）

> 核实时间：2026-10-20 ｜ 核实方式：**逐条跑实验，不靠读代码推断**
> 判定只有两种：**已验证仍存在** / **已验证已修复**。
> 「我已测错」的条目单列，不算软件问题。

---

## 一、已验证**仍是**软件问题（8 条）

### 1. 【严重】步骤 6 自动写入编造读数 —— ✅ 已修复

- **现象**：进入步骤 6 时前端自动点「自动提取」，用硬编码 `0` / `20` 当"用户读数"写进后端
- **实测（修前）**：零输入 → 8 次 `column.calibrateXTicks`，改变 6362 个导出数值格，最大偏差 31.51 个百分点
- **现状**：`InspectorBridge.ts:361-363` 的 `?? 0` / `?? 20` 已移除；无真实读数时只记齿位不写 `x_ticks`
- **验证**：零输入实测 `calibrateXTicks_请求数 8 → 0`

### 2. 【严重】中灰填充被二值阈值整体丢弃 —— ❌ 未修复

- **现象**：`Caryophyllaceae` 列主填充色 `(182,182,182)`（明度 182）> Otsu 阈值 138 → 整列判为背景
- **实测现状**：`mode=otsu, threshold=138.0`，中灰 6,427 px **覆盖率 0.0%**
- **影响**：该列曲线在数字化结果中**完全消失**（提取 max = 0.00%，论文报 4.29%）
- **根因**：`extract_foreground()` 用**单一灰度阈值**，而该图有**三层**（纸 255 / 阴影 229 / 实心 153–182）
- **建议修法**（依据 `adjudication-caryophyllaceae.md` §4）：
  分层判据改为**按颜色簇**而非亮度。已验证的做法：
  ```
  深色实心层（深红/深蓝/纯黑）→ 100% 纳入
  浅色阴影层（浅粉/浅蓝/浅灰）→ 0% 纳入（正确，阴影不该进读数）
  中灰填充 (182,182,182) → 应该纳入，当前 0%
  ```
  即现有逻辑**只差"中灰区间"这一档**。

### 3. 【严重】换图后旧清理几何残留，并在新图上继续剔除墨迹 —— ❌ 未修复

- **实测现状**（刚跑）：
  ```
  换图前几何 24 条 → 换图后 24 条
  B-03 是否仍存在: True
  ```
- **根因**（`file:line`）：
  - `session_parts/core.py:246-269` `load_image` 清理清单**不含** `line_candidates` / `exclusion_regions` / `line_strokes`
  - `session_parts/project.py:114` `project_new` 同样**不含**（grep 计数 = 0）
  - `session_parts/roi.py:23-25` `_init_rois()` 把 `_roi_counter` 归零 → 新图 ROI 又叫 `roi_1`，与旧几何 `roi_id` 同名
  - `cleanup.py:193` 的 `if cand.get("roi_id") != roi_id: continue` 因此失效
- **影响**：换图后数字化结果被无提示削掉一条带（1 条残留 → 2400 px；24 条 → 13454 px）
- **建议修法**：`project_new` 与 `load_image` 都调用 `self._init_cleanup()`。
  `support/serve_e2e_backend.py:51-63` 已证明这是正确做法，只是没进产品路径。

### 4. 【中】挪 ROI 边界 ≥18px 即静默清空 `x_ticks` —— ❌ 未修复

- **现象**：守卫失败分支「不写、不报、不计」——用户标定凭空消失且无任何提示
- **根因**：`core.py:742-746` 的区间守卫，`lo = min(start,end)-10`、`hi = max(start,end)+10`，
  刻度像素落在区间外时**静默丢弃**
- **实测**：首次被抹在 Δ=18px（此时列数仍是 28→28）；同一读数换算值 13.92% → 47.62%
- **建议修法**：守卫失败时**显式告知**用户"列边界已变化，标定已清空"，或按相对位置尽力迁移

### 5. 【中】草稿恢复只写前端镜像 —— ❌ 未修复

- **实测**：`main.ts` 的 `#btn-restore-draft` click handler 中 `rpcClient` / `.call(` 出现次数 = **0**
- **影响**：恢复后界面显示 28 列，后端仍是 0 列
- **建议修法**：恢复时把草稿内容真正下发后端（或明确标注"仅前端预览，需重新载入"）

### 6. 【中】【重置全部操作】必然报 `-32001` —— ❌ 未修复

- **实测**：点重置必产生一条 `algorithm.applyLineRemoval [-32001] 前置状态缺失：未找到 ROI 'roi_1'`
- **影响**：重置本身生效（rois 1→0），但用户看到红色失败框，以为操作失败
- **建议修法**：重置流程里先重建 ROI 再重算掩膜，或把该错误降级为静默重试

### 7. 【中】`extraction_mode` 曾在产品链路中不可达 —— ⚠️ 部分修复

- **原状**：`image.py` 里实现了 `light-overlay-white` 等 4 种模式，但三处调用点全部无参调用
  （`core.py:617`、`core.py:1114`、`digitize.py:84`），RPC 与前端从未暴露 → 那套能力是**死代码**
- **现状**：`_extract_foreground_from_settings()` 已加入，调用点已透传
- **仍未做**：前端 UI 没有切换入口；`solid-over-shadow` 因双向分离未解决而被**显式拒绝**（止损正确）
- **建议**：Step 1 检测到双层图时让用户**显式选模式**，把"选错模式 ×5"变成可见选择，而非静默默认值

### 8. 【低】无锁共享会话，两标签页并发读会出现撕裂态 —— ❌ 未修复

- **根因**：`rpc_server.py:318` 是 `ThreadingHTTPServer`（每请求一线程），而
  `protocol.py:240` 的 `JsonRpcDispatcher` **无任何锁**（该文件 grep `Lock|threading` 零命中）
- **实测**：两标签页并发稳定复现（30 次撕裂）；单标签页测不出（前端把请求串行化了）
- **性质**：瞬时自愈，未构造出"用户看着错误界面停留"的场景 → P3

---

## 二、已验证**已修复**（3 条）

| 编号 | 问题 | 修复 | 验证 |
| :--- | :--- | :--- | :--- |
| B-01 | 步骤 6 编造读数 | 去掉 `?? 0` / `?? 20` | 零输入请求数 8 → **0** |
| B-08 相关 | 步骤 8 导出按钮点不中（无限重挂） | `QaPanel.ts` 加摘要指纹 | `journey.spec.ts` 由红转绿 |
| 新增 | CSV 深度列出现 `-0.0` | `export.py` 字符串层规整 | 含 `-0.0` 行数 **0** |

---

## 三、**不算**软件问题（我的度量错误，都已推翻）

诚实列出，避免污染判断：

| 我曾声称 | 实际 | 错在哪 |
| :--- | :--- | :--- |
| "9/15 列提取失败、丢失 14804 像素" | 14/15 列覆盖率 97.9%–99.8% | 用「最深 10% 像素」当填充参考，那是抗锯齿边缘 |
| "Caryophyllaceae 覆盖率 1.4%" | 三方各得 1.4% / 80.9% / 37.5%，**三个都不对** | 用**亮度**代理**按颜色定义**的填充层 |
| "15 列刻距统一 12.3px" | 实测四值：12.0 / 12.5 / 13.0 / 19.0 | 我自己测到 19.0 却写成"全部一致"，自相矛盾 |
| "浅色阴影被误判"（默认路径） | 阴影覆盖率 **0%**，软件行为正确 | 把 `solid-over-shadow` 实验模式的问题当成默认路径 |
| "可按格数比例外推满量程" | 实测误差 −84% ~ +151% | 每格数值是作图书版设定，图上无信息可推 |
| "`paper_range` 列大幅负偏是算法缺陷" | 是方法论错误 | 把「论文历史极值」当「图版轴上限」，两者无函数关系 |

**共同教训**：用代理指标（亮度、最深百分比）代替**按颜色定义的被测对象**，且没先验证代理本身。
回归钉子：`tests/unit/test_metric_sanity.py`（11 项，含"最深 10% 不是填充色"的永久报警）。

---

## 四、优先级建议

| 优先级 | 动作 | 依据 |
| :--- | :--- | :--- |
| **P1** | 中灰填充提取（问题 2） | 唯一会让数据**整列消失**的缺陷 |
| **P1** | 跨图几何残留（问题 3） | 会让新图数据被无提示削掉 |
| P2 | `x_ticks` 静默清空（问题 4） | 用户标定凭空消失 |
| P2 | 草稿恢复 / 重置报错（问题 5、6） | 状态与界面不一致 |
| P3 | 并发写锁（问题 8） | 投产前必须解决 |

---

## 五、复现命令

```bash
# 问题 3：换图后几何残留
pixi run python -c "
import sys; sys.path.insert(0,'.')
from straditize_core.session import StraditizeSession
s=StraditizeSession(); s._init_cleanup()
s.load_image(sample_key='hoya')
s.detect_columns([315,1946],[511,1311], roi_id=s.rois[0]['id'])
r=s.rois[0]['id']; s.detect_line_candidates(roi_id=r)
c=[x for x in s.line_candidates if x.get('roi_id')==r]
s.set_line_geometry_status(candidate_id=max(c,key=lambda x:x.get('width',0))['id'],status='removed',roi_id=r)
b=len(s.line_candidates); s.load_image(sample_key='beginner')
print(f'换图前 {b} 条 → 换图后 {len(s.line_candidates)} 条')
"

# 问题 2：中灰填充覆盖率
pixi run python -c "
import sys; sys.path.insert(0,'.')
import numpy as np; from PIL import Image
from straditize_core.session import StraditizeSession
a=np.array(Image.open('output/han2026_ngamring/fig3_raw.jpeg').convert('RGB')).astype(int)
s=StraditizeSession(); s._init_cleanup(); s.load_image('output/han2026_ngamring/fig3_raw.jpeg')
s.extract_foreground(); m=s.foreground_mask
mid=(np.abs(a-np.array([182,182,182])).max(axis=-1)<=8)
print(f'中灰 {int(mid.sum())}px 覆盖 {(mid&m).sum()/mid.sum()*100:.1f}%')
"
```

---

## 六、本轮修复状态更新（2026-10-20 14:30）

| 问题 | 状态 | 证据 |
| :--- | :--- | :--- |
| 问题 2：中灰填充被丢弃 | ✅ **已修复** | 覆盖率 0.0% → **100.0%**（8 类色簇全对） |
| 问题 3：换图几何残留 | ✅ **已修复** | 24 条 → **0 条**；纵深防御：绕过清理仍剔除 **0 px** |
| `grey_matrix` 通道不足崩溃 | ✅ **已修复** | `shape=(H,W,2)` 不再抛 IndexError |
| `colour_path = ext_mode != "standard"` 断点 | ✅ **已修复** | 默认路径终于调用 `build_foreground` |

门禁：`pixi run lint` 全绿 ｜ `pixi run test` **382 passed / 3 skipped**（基线 342，+40）

### 新增已知局限（必须让用户知道）

| 局限 | 方向 | 缓解 |
| :--- | :--- | :--- |
| 阴影画得比 0.84·纸更暗（明度 ≤214）时整块漏进实心 | **多读（×5 放大）** | 测试 `test_boundary_is_a_fixed_ratio_so_dark_shading_leaks` 会报警 |
| 彩色彩色包络极差 ≈40 的中间态分不开 | 多读 | 真实图版包络极差 18–19，不在该区间 |

**正解**：按**列**统计直方图（单层图与多层图常并存，图级直方图分不开），需改 `session_parts/`。

### 仍未修（4 条）

测试环境下后端未运行，以下 4 条本轮**未重新验证**，保持原判定：
问题 4（`x_ticks` 静默清空）、问题 5（草稿恢复）、问题 6（重置报 -32001）、问题 8（并发无锁）。
